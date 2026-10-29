import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runHermes,
  closeHermesRuntime,
  hermesRuntime,
} from "../src/server/agent/hermes";
import { agentSettingsSchema } from "../src/lib/agent";
import { ProviderError } from "../src/server/inference-retry";

test(
  "Hermes incluído: sem instalação pessoal, histórico real, JSON e isolamento entre chamadas",
  { skip: process.env.RUN_HERMES_TESTS !== "1", timeout: 240000 },
  async () => {
    const keys = ["CI_DATA_DIR", "HERMES_HOME", "CI_HERMES_RUNTIME"];
    const previous = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    const requests: {
      tools?: unknown[];
      messages: { role: string; content: string }[];
      max_tokens: number;
      stream?: boolean;
    }[] = [];
    let lengthOnce = false;
    const server = createServer(async (req, res) => {
      if (req.method === "GET") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({ data: [{ id: "test", context_length: 131072 }] }),
        );
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const finishReason = lengthOnce ? "length" : "stop";
      lengthOnce = false;
      requests.push(body);
      assert.equal(req.headers.authorization, "Bearer fixture-private");
      if (!body.stream) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          id: "fixture", object: "chat.completion", created: 1, model: "test",
          choices: [{index: 0, message: {role: "assistant", content: "Outubro registrado; falta somente o dia."}, finish_reason: finishReason}],
          usage: {prompt_tokens: 100, completion_tokens: 10},
        }));
        return;
      }
      res.setHeader("content-type", "text/event-stream");
      res.write(
        "data: " +
          JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "test",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: "Outubro registrado; falta somente o dia.",
                },
                finish_reason: null,
              },
            ],
          }) +
          "\n\n",
      );
      res.write(
        "data: " +
          JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "test",
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
          }) +
          "\n\n",
      );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      process.env.CI_DATA_DIR = await mkdtemp(
        path.join(os.tmpdir(), "ci-bundled-hermes-"),
      );
      process.env.HERMES_HOME = path.join(
        process.env.CI_DATA_DIR,
        "personal-hermes-does-not-exist",
      );
      process.env.CI_HERMES_RUNTIME ||= path.resolve(
        ".desktop-resources/hermes",
      );
      const settings = agentSettingsSchema.parse({
        engine: "hermes",
        hermesRoot: "C:/does-not-exist",
        hermesPython: "C:/does-not-exist/python.exe",
      });
      const runtime = await hermesRuntime(settings);
      assert.ok(runtime.root.startsWith(process.env.CI_HERMES_RUNTIME));
      assert.ok(runtime.python.startsWith(process.env.CI_HERMES_RUNTIME));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const config = {
        provider: "freellmapi" as const,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "test",
        key: "fixture-private",
      };
      const result = await runHermes(
        config,
        "Atenda o contexto do produto.",
        "O que falta?",
        4096,
        [
          { role: "user", content: "A coleta foi em outubro." },
          { role: "assistant", content: "Mês preservado." },
        ],
        settings,
      );
      assert.match(result.text, /falta somente o dia/);
      await runHermes(
        config,
        "Outra sessão.",
        "Pergunta independente.",
        4096,
        [],
        settings,
      );
      assert.equal(requests.length, 2);
      assert.deepEqual(
        requests[0].messages.map((message) => message.role),
        ["system", "user", "assistant", "user"],
      );
      assert.ok(!requests[0].tools?.length);
      assert.equal(requests[0].max_tokens, 4096);
      assert.ok(requests.every((request) => !request.stream), "O host recebe partes completas por JSON, sem depender do encerramento SSE do provedor");
      assert.ok(
        !JSON.stringify(requests[1].messages).includes(
          "A coleta foi em outubro",
        ),
        "Uma nova chamada não herda histórico oculto do worker",
      );
      lengthOnce = true;
      try {
        await runHermes(config,"Resposta curta.","Teste de limite.",4096,[],settings);
      } catch (error) {
        assert.ok(error instanceof ProviderError && error.kind === "output_limit", "Saída incompleta deve permanecer uma falha recuperável, nunca sucesso inventado");
      }
      assert.ok(requests.slice(2).every(request=>request.max_tokens<=4096), "Recuperação interna respeita o teto de cada chamada do host");
    } finally {
      closeHermesRuntime();
      server.closeAllConnections();
      server.close();
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  },
);
