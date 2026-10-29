import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AgentSettings } from "@/lib/agent";
import type { RuntimeProvider } from "../secure-settings";
import { dataDirectory } from "../data-directory";
import { ProviderError } from "../inference-retry";

export async function hermesRuntime(
  settings: Pick<AgentSettings, "hermesRoot" | "hermesPython">,
) {
  const bundled = process.env.CI_HERMES_RUNTIME;
  const root = bundled
    ? path.join(bundled, "source")
    : settings.hermesRoot ||
      path.join(
        process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"),
        "hermes-agent",
      );
  const python = bundled
    ? path.join(bundled, "python/python.exe")
    : settings.hermesPython ||
      path.join(
        root,
        process.platform === "win32"
          ? "venv/Scripts/python.exe"
          : "venv/bin/python",
      );
  if (!path.isAbsolute(root) || !path.isAbsolute(python))
    throw new Error("Informe caminhos absolutos para o Hermes e seu Python.");
  try {
    await Promise.all([
      access(path.join(root, "run_agent.py")),
      access(python),
    ]);
  } catch {
    throw new Error(
      bundled
        ? "O motor incluído está incompleto. Repare ou reinstale o Creator Intelligence; não é necessário instalar o Hermes separadamente."
        : "Runtime de desenvolvimento não encontrado. Configure os caminhos do Hermes e Python.",
    );
  }
  return { root, python };
}

type Result = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
};
type Pending = {
  id: string;
  phase: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
  progress?: (message: string) => Promise<void>;
};
type Worker = {
  key: string;
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  updates: Promise<void>;
  pending?: Pending;
  idle?: ReturnType<typeof setTimeout>;
};
let worker: Worker | undefined;
let queue: Promise<unknown> = Promise.resolve();

function stopWorker(target: Worker) {
  if (worker === target) worker = undefined;
  if (target.idle) clearTimeout(target.idle);
  if (process.platform === "win32" && target.child.pid)
    spawn("taskkill", ["/PID", String(target.child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => target.child.kill());
  else target.child.kill();
}
export function closeHermesRuntime() {
  if (!worker) return;
  const target = worker;
  if (target.pending) {
    clearTimeout(target.pending.timer);
    target.pending.reject(
      new ProviderError("Motor encerrado. Retome dos trechos salvos.", true),
    );
    target.pending = undefined;
  }
  stopWorker(target);
}
function settle(
  target: Worker,
  error?: Error,
  text?: string,
  usage?: { inputTokens?: unknown; outputTokens?: unknown },
) {
  const pending = target.pending;
  if (!pending) return;
  target.pending = undefined;
  clearTimeout(pending.timer);
  if (error) pending.reject(error);
  else
    pending.resolve({
      text: text!,
      inputTokens: Number.isSafeInteger(usage?.inputTokens)
        ? (usage!.inputTokens as number)
        : null,
      outputTokens: Number.isSafeInteger(usage?.outputTokens)
        ? (usage!.outputTokens as number)
        : null,
    });
  target.idle = setTimeout(() => stopWorker(target), 60000);
}
function stageTimer(target: Worker, milliseconds: number) {
  return setTimeout(() => {
    const preparing = ["loading", "initializing"].includes(
      target.pending?.phase ?? "",
    );
    settle(
      target,
      new ProviderError(
        preparing
          ? "A preparação do motor local excedeu o prazo. Os dados estão salvos; confira a instalação e retome."
          : "A chamada de análise excedeu o prazo. Retome dos trechos salvos.",
        true,
      ),
    );
    stopWorker(target);
  }, milliseconds);
}
async function getWorker(settings: AgentSettings) {
  const runtime = await hermesRuntime(settings);
  const home = path.join(dataDirectory(), "agent/hermes-profile");
  await mkdir(home, { recursive: true });
  const bridge =
    process.env.CI_HERMES_BRIDGE ||
    path.join(process.cwd(), "runtime/hermes_bridge.py");
  await access(bridge);
  const key = JSON.stringify({ runtime, home, bridge });
  if (worker?.key === key && !worker.child.killed) {
    if (worker.idle) clearTimeout(worker.idle);
    return worker;
  }
  if (worker) stopWorker(worker);
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const name of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "PATH",
    "Path",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
    "NUMBER_OF_PROCESSORS",
  ])
    if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, {
    HERMES_HOME: home,
    PYTHONPATH: runtime.root,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHON_DOTENV_DISABLED: "1",
    HERMES_TELEMETRY_DISABLED: "1",
    HERMES_DISABLE_LAZY_INSTALLS: "1",
    CI_HERMES_HOST_PID: String(process.pid),
  });
  if (process.env.CI_HERMES_DEBUG === "1") env.CI_HERMES_DEBUG = "1";
  const child = spawn(runtime.python, ["-u", bridge], {
    cwd: home,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const target: Worker = { key, child, buffer: "", updates: Promise.resolve() };
  worker = target;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    target.buffer += chunk;
    if (target.buffer.length > 100000) {
      settle(
        target,
        new ProviderError(
          "Resposta do motor acima do orçamento.",
          false,
          "output_limit",
        ),
      );
      stopWorker(target);
      return;
    }
    let boundary: number;
    while ((boundary = target.buffer.indexOf("\n")) >= 0) {
      const line = target.buffer.slice(0, boundary);
      target.buffer = target.buffer.slice(boundary + 1);
      try {
        const packet = JSON.parse(line),
          pending = target.pending;
        if (!pending || packet.id !== pending.id) continue;
        if (
          ["loading", "initializing", "running", "closing"].includes(
            packet.event,
          )
        ) {
          const previousPhase = pending.phase;
          pending.phase = packet.event;
          if (packet.event === "running" && previousPhase !== "running") {
            clearTimeout(pending.timer);
            pending.timer = stageTimer(target, 120000);
          }
          if (
            ["loading", "initializing", "running"].includes(packet.event) &&
            pending.progress
          ) {
            target.updates = target.updates.then(() =>
              pending.progress!(
                packet.event === "running"
                  ? "Hermes · interpretando esta etapa…"
                  : "Preparando o motor local do chat…",
              ),
            );
            void target.updates.catch((error) => {
              settle(target, error);
              stopWorker(target);
            });
          }
        } else if (packet.error)
          settle(
            target,
            new ProviderError(
              "O Hermes não concluiu esta etapa. Os trechos anteriores estão salvos; confira o modelo e retome.",
              false,
              packet.error === "incomplete" ? "output_limit" : "invalid",
            ),
          );
        else if (
          typeof packet.text === "string" &&
          packet.text.trim() &&
          packet.tools === 0
        )
          settle(target, undefined, packet.text, packet);
        else {
          settle(
            target,
            new ProviderError(
              "Resposta inválida da ponte Hermes.",
              false,
              "invalid",
            ),
          );
          stopWorker(target);
        }
      } catch {
        settle(
          target,
          new ProviderError(
            "Protocolo inválido da ponte Hermes.",
            false,
            "invalid",
          ),
        );
        stopWorker(target);
      }
    }
  });
  child.stderr.on("data", () => {});
  child.stdin.on("error", () => {});
  child.on("error", () => {
    settle(
      target,
      new ProviderError(
        "Não foi possível iniciar o motor incluído. Repare a instalação do aplicativo.",
        false,
        "invalid",
      ),
    );
    if (worker === target) worker = undefined;
  });
  child.on("close", () => {
    settle(
      target,
      new ProviderError(
        "O motor foi interrompido. Retome dos trechos salvos.",
        true,
      ),
    );
    if (worker === target) worker = undefined;
    if (target.idle) clearTimeout(target.idle);
  });
  return target;
}

export async function runHermes(
  config: RuntimeProvider,
  system: string,
  prompt: string,
  maxTokens: number,
  history: { role: "user" | "assistant"; content: string }[],
  settings: AgentSettings,
  onProgress?: (message: string) => Promise<void>,
) {
  if (!["freellmapi", "openrouter", "openai"].includes(config.provider))
    throw new ProviderError(
      "O Hermes integrado requer uma conexão OpenAI-compatible. Use seu gateway ou selecione o motor direto para Claude/Gemini nativos.",
      false,
      "invalid",
    );
  const operation = queue
    .catch(() => {})
    .then(async () => {
      const target = await getWorker(settings),
        id = randomUUID();
      return new Promise<Result>((resolve, reject) => {
        const timer = stageTimer(target, 180000);
        target.pending = {
          id,
          phase: "loading",
          timer,
          resolve,
          reject,
          progress: onProgress,
        };
        target.child.stdin.write(
          JSON.stringify({
            id,
            baseUrl: config.baseUrl,
            key: config.key,
            model: config.model,
            system,
            prompt,
            maxTokens,
            history,
          }) + "\n",
        );
      }).finally(() => target.updates);
    });
  queue = operation;
  return operation;
}
