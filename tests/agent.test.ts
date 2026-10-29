import { test } from "node:test";
import assert from "node:assert/strict";
import { splitText, boundedJSON, sampleText } from "../src/server/agent/budget";
import { quickIntent } from "../src/server/agent/intent";
import { retryInference, ProviderError } from "../src/server/inference-retry";
test("blocos preservam palavras e Unicode sem ultrapassar o orçamento", () => {
  const words = Array.from({ length: 900 }, (_, index) => `métrica-${index}🟣`),
    source = words.join("\n"),
    blocks = splitText(source, 2000);
  assert.ok(blocks.length > 3);
  assert.ok(blocks.every((block) => block.length <= 2000));
  assert.deepEqual(
    blocks.flatMap((block) => block.split(/\s+/)),
    words,
  );
  assert.throws(() => splitText("a".repeat(50000), 500), /48 blocos/);
});
test("orçamento rejeita contexto grande antes de chamar o provedor", () => {
  assert.throws(
    () => boundedJSON({ value: "a".repeat(5000) }, 1000),
    /orçamento/,
  );
  const sampled = sampleText("início" + "x".repeat(10000) + "final", 1000);
  assert.ok(sampled.startsWith("início"));
  assert.ok(sampled.endsWith("final"));
  assert.ok(sampled.length < 1100);
});
test("chat único distingue declaração de venda de pergunta e arquivo tabular", () => {
  assert.equal(quickIntent("ana.demo vendeu 1200 reais ontem"), "ingest");
  assert.equal(quickIntent("Quanto ana.demo vendeu neste mês?"), "answer");
  assert.equal(quickIntent("Oi!"), "answer");
  assert.equal(quickIntent("", "dados.xlsx"), "ingest");
  assert.equal(quickIntent("Vou explicar uma situação diferente"), null);
  assert.equal(
    quickIntent(
      "Analise este documento e explique as lacunas.\n" +
        "Contexto declarado. ".repeat(150),
    ),
    "answer",
  );
});
test("Retry-After longo interrompe retries rápidos, preservando o limite do provedor", async () => {
  let calls = 0,
    waits = 0;
  await assert.rejects(
    () =>
      retryInference(
        async () => {
          calls++;
          throw new ProviderError("quota", true, "transient", 30000);
        },
        async () => {
          waits++;
        },
      ),
    /quota/,
  );
  assert.equal(calls, 1);
  assert.equal(waits, 0);
});
