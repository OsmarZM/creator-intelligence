import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCollectionDate,
  localDate,
  validTimeZone,
} from "../src/server/agent/temporal-context";
import {
  initialPendingReply,
  resolvePendingDate,
  isCancellation,
  conversationHistory,
  groundedConversationReply,
  type PendingContext,
} from "../src/server/agent/conversation-context";
import { readFileSync } from "node:fs";
const clock = "2026-10-27T15:00:00Z",
  zone = "America/Sao_Paulo";
const pending: PendingContext = {
  kind: "import",
  missing: ["collectionDate"],
  question: "Qual foi a data?",
  collection: {},
};

test("reenvio do relatório reconhece o mês preservado e pergunta somente pelo dia", () => {
  const report = readFileSync("tests/fixtures/inbazz-instagram.txt", "utf8");
  const reply = initialPendingReply(
    { ...pending, collection: { month: "2026-10" } },
    report,
    { id: "fixture", name: "ana.demo" },
    "",
  );
  assert.match(reply, /outubro de 2026/);
  assert.match(reply, /somente o dia real/);
  assert.doesNotMatch(reply, /Qual é a data da coleta/);
});
test("mês informado vira contexto parcial e dia posterior completa a data", () => {
  const month = resolvePendingDate(
    "foi desse mes a coleta de dados",
    pending,
    clock,
    zone,
  )!;
  assert.equal(month.context.collection?.month, "2026-10");
  assert.match(month.reply ?? "", /outubro de 2026/);
  assert.match(month.reply ?? "", /lembra o dia/);
  assert.equal(month.date, undefined);
  const day = resolvePendingDate("dia 15", month.context, clock, zone)!;
  assert.equal(day.date, "2026-10-15");
  const unknown = resolvePendingDate(
    "não lembro o dia",
    month.context,
    clock,
    zone,
  )!;
  assert.equal(unknown.context.collection?.deferred, true);
  assert.equal(unknown.context.collection?.month, "2026-10");
  assert.match(unknown.reply ?? "", /Podemos seguir/);
});
test("resposta não oferece inventar dia para completar informação pendente", () => {
  const state = {
    messages: [],
    summary: "",
    pending: {
      message: "relatório",
      creatorId: "fixture",
      context: { ...pending, collection: { month: "2026-10" } },
    },
  };
  const unsafe =
    "Você confirmou outubro. Se não lembrar, posso sugerir um dia dentro do período (1 a 27 de outubro) ou deixar em aberto.";
  assert.match(
    groundedConversationReply(unsafe, state),
    /sem escolher uma data fictícia/,
  );
  const helpful =
    "Entendi outubro. Você lembra o dia? Se não lembrar, podemos deixar pendente.";
  assert.equal(groundedConversationReply(helpful, state), helpful);
});
test("dia sem mês também permanece parcial e datas impossíveis não são inventadas", () => {
  const hint = resolvePendingDate("dia 31", pending, clock, zone)!;
  assert.equal(hint.context.collection?.day, 31);
  assert.equal(hint.date, undefined);
  const invalid = resolvePendingDate(
    "fevereiro de 2026",
    hint.context,
    clock,
    zone,
  )!;
  assert.equal(invalid.date, undefined);
  assert.match(invalid.reply ?? "", /não existe/);
  assert.equal(
    resolvePendingDate("dia 28", invalid.context, clock, zone)!.date,
    "2026-02-28",
  );
});
test("datas naturais respeitam o relógio do turno e o fuso do cliente", () => {
  assert.equal(localDate("2026-11-01T01:30:00Z", zone), "2026-10-31");
  assert.deepEqual(
    resolveCollectionDate("foi hoje", {}, "2026-11-01T01:30:00Z", zone),
    { kind: "day", date: "2026-10-31", evidence: "foi hoje" },
  );
  const yesterday = resolveCollectionDate(
    "foi ontem",
    {},
    "2026-03-01T15:00:00Z",
    zone,
  );
  assert.equal(yesterday.kind === "day" && yesterday.date, "2026-02-28");
  const previous = resolveCollectionDate(
    "mês passado",
    {},
    "2026-01-01T15:00:00Z",
    zone,
  );
  assert.equal(previous.kind === "month" && previous.month, "2025-12");
  assert.equal(validTimeZone("not/a/timezone"), false);
});
test("datas explícitas aceitam português e não resolvem negação, pergunta ou conflito", () => {
  for (const text of [
    "foi em 15/10/2026",
    "15 de outubro de 2026",
    "Data da coleta: 2026-10-15",
  ]) {
    const result = resolveCollectionDate(text, {}, clock, zone);
    assert.equal(result.kind === "day" && result.date, "2026-10-15");
  }
  for (const text of [
    "não foi hoje",
    "foi hoje?",
    "acho que foi ontem",
    "entre dia 10 e 15",
  ])
    assert.equal(
      resolveCollectionDate(text, {}, clock, zone).kind,
      "unrecognized",
    );
  assert.equal(
    resolveCollectionDate("2026-10-15 ou 2026-10-16", {}, clock, zone).kind,
    "invalid",
  );
});
test("cancelamento é explícito e histórico enviado preserva papéis", () => {
  assert.ok(isCancellation("pode cancelar"));
  assert.equal(isCancellation("o pedido foi cancelado ontem"), false);
  const history = conversationHistory(
    {
      summary: "",
      messages: [
        { id: "1", role: "user", text: "relatório", jobId: "old" },
        { id: "2", role: "assistant", text: "Qual mês?", jobId: "old" },
        { id: "3", role: "user", text: "atual", jobId: "current" },
      ],
    },
    "current",
  );
  assert.deepEqual(history, [
    { role: "user", content: "relatório" },
    { role: "assistant", content: "Qual mês?" },
  ]);
});
