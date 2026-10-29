import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creatorContext,
  mentionedCreators,
  isDataQuestion,
} from "../src/lib/creator-context";
import { retryInference, ProviderError } from "../src/server/inference-retry";
const creators = [
  { id: "a", name: "ana.demo", slug: "ana-demo" },
  { id: "b", name: "José Silva", slug: "jose-silva" },
];
test("contexto reconhece nome completo sem acentos e handle, sem correspondencia parcial", () => {
  assert.equal(
    creatorContext("dados de @ana.demo", creators).creator?.id,
    "a",
  );
  assert.equal(
    creatorContext("como esta JOSE SILVA?", creators).creator?.id,
    "b",
  );
  assert.equal(
    mentionedCreators("outroana.demo e ana.demo.extra", creators).length,
    0,
  );
  assert.equal(creatorContext("ele cresceu?", creators, "a").creator?.id, "a");
  assert.equal(
    creatorContext("dados de Jose Silva", creators, "a").needsChoice,
    true,
  );
  assert.equal(
    creatorContext("ana.demo e José Silva", creators).needsChoice,
    true,
  );
  assert.equal(creatorContext("dados sem nome", creators).creator, undefined);
});
test("perguntas no gestor de dados nao viram importacao", () => {
  for (const text of [
    "Como importar esses dados",
    "o que voce precisa?",
    "Qual creator esta ativo?",
    "Oi",
    "Compare os resultados",
  ])
    assert.equal(isDataQuestion(text), true);
  assert.equal(
    isDataQuestion(
      "ana.demo: seguidores 1200 em 2026-10-27, origem exportacao",
    ),
    false,
  );
});
test("retry recupera falha transitoria e limita tentativas; credencial nao repete", async () => {
  let calls = 0;
  assert.equal(
    await retryInference(
      async () => {
        if (++calls === 1) throw new ProviderError("timeout", true);
        return "ok";
      },
      async () => {},
    ),
    "ok",
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    () =>
      retryInference(
        async () => {
          calls++;
          throw new ProviderError("timeout", true);
        },
        async () => {},
      ),
    /timeout/,
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    () =>
      retryInference(
        async () => {
          calls++;
          throw new ProviderError("401", false);
        },
        async () => {},
      ),
    /401/,
  );
  assert.equal(calls, 1);
});
import { parseChatReply } from "../src/server/chat-reply";
test("resposta conversacional aceita texto e JSON; proposta quebrada nao vira grafico", () => {
  assert.equal(
    parseChatReply("Olá! De qual criador vamos falar?").reply,
    "Olá! De qual criador vamos falar?",
  );
  assert.equal(parseChatReply('{"reply":"Sem dados"}').charts, null);
  assert.throws(() => parseChatReply('{"reply":"incompleto"'), /incompleta/);
  assert.throws(
    () => parseChatReply('{"reply":"ok","charts":[{"id":"bad"}]}'),
    /validação/,
  );
});
