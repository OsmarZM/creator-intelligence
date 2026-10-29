import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { askAI, testProvider } from "../src/server/ai";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
async function readBody(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return JSON.parse(text);
}

test("saída truncada ajusta orçamento auxiliar sem dividir texto curto e respeita teto explícito", async () => {
  const keys = [
    "CI_DATA_DIR",
    "CI_IGNORE_SAVED_SETTINGS",
    "AI_PROVIDER",
    "AI_BASE_URL",
    "AI_MODEL",
    "AI_API_KEY",
    "AI_FALLBACK_PROVIDER",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const budgets: number[] = [];
  let alwaysTruncated = false;
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    budgets.push(body.max_tokens);
    const truncated = alwaysTruncated || budgets.length < 3;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: truncated ? "length" : "stop",
            message: {
              content: truncated
                ? '{"records":['
                : '{"records":[],"notes":"falta data"}',
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    process.env.CI_DATA_DIR = await mkdtemp(
      path.join(tmpdir(), "ci-generation-budget-"),
    );
    process.env.CI_IGNORE_SAVED_SETTINGS = "1";
    process.env.AI_PROVIDER = "freellmapi";
    process.env.AI_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.AI_MODEL = "fixture";
    process.env.AI_API_KEY = "fixture";
    delete process.env.AI_FALLBACK_PROVIDER;
    const progress: string[] = [];
    const result = await askAI("Extraia JSON", "Seguidores 51.816", {
      task: "extractor",
      onProgress: async (text) => {
        progress.push(text);
      },
    });
    assert.deepEqual(budgets, [1400, 2800, 4096]);
    assert.equal(progress.length, 2);
    assert.deepEqual(JSON.parse(result.text), {
      records: [],
      notes: "falta data",
    });
    alwaysTruncated = true;
    budgets.length = 0;
    await assert.rejects(
      () => askAI("Resuma", "texto curto", { task: "summary" }),
      (error) =>
        error instanceof Error &&
        "kind" in error &&
        error.kind === "output_limit",
    );
    assert.deepEqual(budgets, [500, 1000, 2000]);
    budgets.length = 0;
    await assert.rejects(() =>
      askAI("Resuma", "texto", { task: "summary", maxTokens: 700 }),
    );
    assert.deepEqual(budgets, [700]);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("teste de conexão distingue saída truncada de autenticação inválida", async () => {
  const previous = process.env.CI_IGNORE_SAVED_SETTINGS;
  process.env.CI_IGNORE_SAVED_SETTINGS = "1";
  let status = 200;
  const server = createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: "" } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const draft = {
    slot: "primary",
    connection: {
      provider: "freellmapi",
      baseUrl: `http://127.0.0.1:${address.port}`,
      model: "fixture",
      apiKey: "fixture",
    },
  };
  try {
    const result = await testProvider(draft);
    assert.match(result.warning ?? "", /Conexão aceita/);
    status = 401;
    await assert.rejects(() => testProvider(draft), /HTTP 401/);
  } finally {
    if (previous === undefined) delete process.env.CI_IGNORE_SAVED_SETTINGS;
    else process.env.CI_IGNORE_SAVED_SETTINGS = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("adaptadores normalizam OpenAI-compatible, Claude e Gemini; fallback somente técnico", async () => {
  const keys = [
    "CI_IGNORE_SAVED_SETTINGS",
    "AI_PROVIDER",
    "AI_BASE_URL",
    "AI_MODEL",
    "AI_API_KEY",
    "AI_FALLBACK_PROVIDER",
    "AI_FALLBACK_BASE_URL",
    "AI_FALLBACK_MODEL",
    "AI_FALLBACK_API_KEY",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.CI_IGNORE_SAVED_SETTINGS = "1";
  let fail = 0,
    calls = 0;
  const server = createServer(async (req, res) => {
    calls++;
    const body = await readBody(req);
    if (req.url?.startsWith("/primary") && fail) {
      res.writeHead(fail);
      res.end("failure");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("/messages")) {
      assert.equal(req.headers["x-api-key"], "test-key");
      assert.equal(body.system, "system");
      if (body.messages.length > 1)
        assert.deepEqual(
          body.messages.map((message: { role: string }) => message.role),
          ["user", "assistant", "user"],
        );
      res.end(
        JSON.stringify({ content: [{ type: "text", text: "Claude OK" }] }),
      );
    } else if (req.url?.includes(":generateContent")) {
      assert.equal(req.headers["x-goog-api-key"], "test-key");
      assert.equal(body.systemInstruction.parts[0].text, "system");
      if (body.contents.length > 1)
        assert.deepEqual(
          body.contents.map((message: { role: string }) => message.role),
          ["user", "model", "user"],
        );
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Gemini OK" }] } }],
        }),
      );
    } else {
      assert.equal(req.headers.authorization, "Bearer test-key");
      assert.equal(body.messages[0].content, "system");
      if (body.messages.length > 2)
        assert.deepEqual(
          body.messages.map((message: { role: string }) => message.role),
          ["system", "user", "assistant", "user"],
        );
      assert.equal(body.stream, false);
      if (process.env.AI_PROVIDER === "openai") {
        assert.equal(body.max_completion_tokens, 4096);
        assert.equal(body.max_tokens, undefined);
      } else {
        assert.equal(body.max_tokens, 4096);
      }
      res.end(
        JSON.stringify({ choices: [{ message: { content: "Compat OK" } }] }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    process.env.AI_MODEL = "test-model";
    process.env.AI_API_KEY = "test-key";
    delete process.env.AI_FALLBACK_PROVIDER;
    for (const provider of [
      "freellmapi",
      "openai",
      "openrouter",
      "anthropic",
      "gemini",
    ]) {
      process.env.AI_PROVIDER = provider;
      process.env.AI_BASE_URL = base;
      const r = await askAI("system", "prompt");
      assert.equal(r.provider, provider);
      assert.match(r.text, /OK/);
      const contextual = await askAI("system", "prompt", {
        history: [
          { role: "user", content: "Qual mês?" },
          { role: "assistant", content: "Outubro." },
        ],
      });
      assert.match(contextual.text, /OK/);
    }
    process.env.AI_PROVIDER = "freellmapi";
    process.env.AI_BASE_URL = `${base}/primary`;
    process.env.AI_FALLBACK_PROVIDER = "openrouter";
    process.env.AI_FALLBACK_BASE_URL = base;
    process.env.AI_FALLBACK_MODEL = "backup";
    process.env.AI_FALLBACK_API_KEY = "test-key";
    fail = 503;
    assert.equal((await askAI("system", "prompt")).fallback, true);
    fail = 401;
    const before = calls;
    await assert.rejects(() => askAI("system", "prompt"), /HTTP 401/);
    assert.equal(calls, before + 1);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
