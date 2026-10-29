import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentSections,
  processDocument,
  type DocumentCheckpoint,
} from "../src/server/agent/document-pipeline";
import { ProviderError } from "../src/server/inference-retry";

test("documento: seções mantêm origem e limites por bloco", () => {
  const text =
    "Informações gerais\nPerfil: ana\nInstagram\nSeguidores\n123\nMétricas privadas\nIndisponíveis";
  const parts = documentSections(text, 2000);
  assert.equal(parts.length, 3);
  assert.match(parts[1], /^Instagram/);
  assert.match(parts[2], /^Métricas privadas/);
  assert.ok(
    documentSections("texto ".repeat(1200), 800).every(
      (part) => part.length <= 800,
    ),
  );
});

test("documento: falha intermediária retoma somente trechos ainda não concluídos", async () => {
  let saved: DocumentCheckpoint | undefined;
  const calls: string[] = [];
  let fail = true;
  const text =
    "# Primeiro\n" + "a ".repeat(200) + "\n# Segundo\n" + "b ".repeat(200);
  const summarize = async (_text: string, id: string) => {
    calls.push(id);
    if (id === "trecho-2" && fail) throw new ProviderError("temporário", true);
    return `${id}: dado declarado, data ausente`;
  };
  const persist = async (value: DocumentCheckpoint) => {
    saved = structuredClone(value);
  };
  await assert.rejects(
    processDocument(text, 2000, undefined, summarize, persist, async () => {}),
    /temporário/,
  );
  assert.ok(saved?.nodes[0].summary);
  fail = false;
  const result = await processDocument(
    text,
    2000,
    saved,
    summarize,
    persist,
    async () => {},
  );
  assert.deepEqual(calls, ["trecho-1", "trecho-2", "trecho-2"]);
  assert.match(result.context!, /trecho-1/);
  await processDocument(text, 2000, result, summarize, persist, async () => {});
  assert.equal(calls.length, 3);
});

test("documento: saída limitada subdivide e persiste evidência sem tratar trecho literal como interpretação", async () => {
  let saved: DocumentCheckpoint | undefined;
  const result = await processDocument(
    "a ".repeat(600),
    2000,
    undefined,
    async () => {
      throw new ProviderError("limite", false, "output_limit");
    },
    async (value) => {
      saved = structuredClone(value);
    },
    async () => {},
  );
  assert.ok(saved?.nodes[0].children?.length);
  assert.match(result.context!, /Fonte literal não interpretada/);
  assert.equal(result.nodes[0].children![0].children![0].method, "literal");
});

test("documento: conteúdo diferente invalida checkpoints anteriores", async () => {
  let calls = 0;
  const summarize = async (text: string) => {
    calls++;
    return text;
  };
  const first = await processDocument(
    "Primeira origem",
    2000,
    undefined,
    summarize,
    async () => {},
    async () => {},
  );
  const second = await processDocument(
    "Outra origem",
    2000,
    first,
    summarize,
    async () => {},
    async () => {},
  );
  assert.equal(
    calls,
    0,
    "Trechos curtos preservam a fonte sem gastar uma chamada de resumo",
  );
  assert.notEqual(first.sourceHash, second.sourceHash);
  assert.equal(second.nodes[0].text, "Outra origem");
});

test("documento: fronteiras preferem frases completas para preservar negações", () => {
  const sentence =
    "A campanha não possui pedidos identificados, moeda ou receita comprovada. ";
  const parts = documentSections(sentence.repeat(45), 1000);
  assert.ok(parts.slice(0, -1).every((part) => part.endsWith("comprovada.")));
  assert.ok(parts.every((part) => !part.startsWith("identificados")));
});
