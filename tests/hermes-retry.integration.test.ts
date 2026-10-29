import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { askAI } from "../src/server/ai";
import { closeHermesRuntime } from "../src/server/agent/hermes";

test("Hermes: falha técnica repete só a inferência; resposta inválida não repete", {
  skip: process.env.RUN_HERMES_TESTS !== "1", timeout: 120000,
}, async () => {
  const names = ["CI_DATA_DIR", "CI_HERMES_RUNTIME", "CI_HERMES_BRIDGE", "CI_IGNORE_SAVED_SETTINGS", "AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_API_KEY", "AI_FALLBACK_PROVIDER"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const directory = await mkdtemp(path.join(os.tmpdir(), "ci-hermes-retry-"));
  const bridge = path.join(directory, "bridge.py");
  await writeFile(bridge, `import sys,json,os
from pathlib import Path
counter=Path(${JSON.stringify(path.join(directory, "counter.json"))})
for line in sys.stdin:
 p=json.loads(line)
 n=(int(counter.read_text()) if counter.exists() else 0)+1
 counter.write_text(str(n))
 if n==1: os._exit(1)
 result={'id':p['id'],'error':'runtime'} if p['prompt']=='invalid' else {'id':p['id'],'text':'Etapa recuperada','tools':0,'inputTokens':10,'outputTokens':5}
 print(json.dumps(result),flush=True)
`);
  try {
    process.env.CI_DATA_DIR = directory;
    process.env.CI_HERMES_RUNTIME = path.resolve(".desktop-resources/hermes");
    process.env.CI_HERMES_BRIDGE = bridge;
    process.env.CI_IGNORE_SAVED_SETTINGS = "1";
    process.env.AI_PROVIDER = "freellmapi";
    process.env.AI_BASE_URL = "http://127.0.0.1:9/v1";
    process.env.AI_MODEL = "fixture";
    process.env.AI_API_KEY = "fixture";
    process.env.AI_FALLBACK_PROVIDER = "";
    await writeFile(path.join(directory, "agent-settings.json"), JSON.stringify({engine:"hermes",answerTokens:4096}));
    const progress: string[] = [];
    const result = await askAI("Resumo curto", "recover", {task:"summary",onProgress:async(text)=>{progress.push(text);}});
    assert.equal(result.text, "Etapa recuperada");
    assert.equal(result.engine, "hermes");
    assert.equal(await readFile(path.join(directory, "counter.json"), "utf8"), "2");
    assert.equal(progress.filter((text) => text.includes("Reenviando somente")).length, 1);
    await assert.rejects(askAI("Resumo curto", "invalid", {task:"summary"}), /Hermes não concluiu/);
    assert.equal(await readFile(path.join(directory, "counter.json"), "utf8"), "3");
  } finally {
    closeHermesRuntime();
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
});
