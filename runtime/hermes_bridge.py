"""Pinned tool-free Hermes worker. JSON lines over private stdio.
The host owns durable checkpoints and all validated data writes.
"""
import contextlib
import io
import json
import logging
import os
import sys
import traceback
import threading
import time
import faulthandler

WIRE = sys.stdout
logging.disable(logging.CRITICAL)
if os.environ.get('CI_HERMES_DEBUG') == '1':
    _trace = open('bridge-stack.log', 'w', encoding='utf-8')
    faulthandler.dump_traceback_later(35, repeat=True, file=_trace)

def watch_host():
    # The backend owns this worker. Exit even if it is killed during an API call.
    # psutil checks process identity safely on Windows; os.kill(pid, 0) does not.
    import psutil
    try:
        parent = psutil.Process(int(os.environ['CI_HERMES_HOST_PID']))
        while parent.is_running():
            time.sleep(2)
    except (KeyError, ValueError, psutil.Error):
        pass
    os._exit(0)

if os.environ.get('CI_HERMES_HOST_PID'):
    threading.Thread(target=watch_host, daemon=True).start()

def emit(packet):
    print(json.dumps(packet, ensure_ascii=False), file=WIRE, flush=True)

def load_agent():
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        # Do not load the installation's personal .env or external vaults.
        import hermes_cli.env_loader as env_loader
        env_loader.load_hermes_dotenv = lambda **kwargs: []
        # Tool-free embedding must not discover/import all optional integrations.
        import tools.registry as tool_registry
        tool_registry.discover_builtin_tools = lambda *args, **kwargs: []
        import hermes_cli.plugins as plugins
        plugins.discover_plugins = lambda *args, **kwargs: None
        from run_agent import AIAgent
        return AIAgent

def run(payload, agent_class):
    request_id = payload['id']
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        emit({'id': request_id, 'event': 'initializing'})
        agent = agent_class(
            provider='custom', api_mode='chat_completions',
            base_url=payload['baseUrl'], api_key=payload['key'] or 'local-no-key',
            model=payload['model'], enabled_toolsets=[], quiet_mode=True,
            skip_context_files=True, skip_memory=True, skip_background_review=True,
            load_soul_identity=False, save_trajectories=False, max_iterations=4,
            max_tokens=payload['maxTokens'], reasoning_config={'enabled': False},
            platform='creator-intelligence', run_budget_seconds=100,
        )
        try:
            # The host publishes complete parts, not token deltas. Use Hermes'
            # pinned non-streaming path so an aggregator's unfinished SSE stream
            # cannot keep an otherwise complete part open until the deadline.
            agent._disable_streaming = True
            if agent.tools:
                raise RuntimeError('Unexpected tools in isolated Hermes profile')
            # Hermes may boost output caps during length recovery. Keep every
            # request inside the host stage budget, including those retries.
            token_parameter = agent._max_tokens_param
            agent._max_tokens_param = lambda value: token_parameter(min(value, payload['maxTokens']))
            emit({'id': request_id, 'event': 'running'})
            result = agent.run_conversation(
                user_message=payload['prompt'], system_message=payload['system'],
                conversation_history=payload.get('history', []),
            )
        finally:
            emit({'id': request_id, 'event': 'closing'})
            agent.close()
    text = result.get('final_response') or ''
    completed = result.get('completed', True) and not result.get('partial', False)
    if result.get('error') or not completed or not text.strip():
        return {'id': request_id, 'error': 'incomplete'}
    return {'id': request_id, 'text': text, 'engine': 'hermes', 'tools': 0,
            'inputTokens': getattr(agent, 'session_prompt_tokens', 0) or None,
            'outputTokens': getattr(agent, 'session_completion_tokens', 0) or None}

agent_class = None
for line in sys.stdin:
    request_id = None
    try:
        payload = json.loads(line)
        request_id = payload['id']
        if agent_class is None:
            emit({'id': request_id, 'event': 'loading'})
            agent_class = load_agent()
        emit(run(payload, agent_class))
    except Exception as error:
        if os.environ.get('CI_HERMES_DEBUG') == '1':
            with open('bridge-error.log', 'w', encoding='utf-8') as log:
                for frame in traceback.extract_tb(error.__traceback__):
                    log.write(f'{frame.filename}:{frame.lineno} {frame.name}\n')
                log.write(type(error).__name__)
        emit({'id': request_id, 'error': 'runtime', 'exception': type(error).__name__})
