import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseInput } from "../src/server/parser";
import { readFile } from "node:fs/promises";
import { readSocialReport } from "../src/server/agent/social-report";

test("relatório Inbazz mantém seguidores, pede data e não converte indisponibilidade em zero", async () => {
  const text = await readFile("tests/fixtures/inbazz-instagram.txt", "utf8");
  const creator = { id: "fixture", name: "ana.demo" };
  const missing = await parseInput(Buffer.from(text), "conversa.txt", creator);
  assert.equal(missing.rows.length, 1);
  assert.equal(missing.rows[0].record, undefined);
  assert.equal((missing.rows[0].payload as { value: number }).value, 51816);
  assert.match(missing.interpretation, /Qual é a data da coleta/);
  assert.match(missing.interpretation, /indisponíveis/);
  const complete = await parseInput(
    Buffer.from(text + "\nData da coleta: 2026-10-27"),
    "conversa.txt",
    creator,
  );
  assert.deepEqual(complete.rows[0].record, {
    type: "metric",
    metric: "followers",
    kind: "snapshot",
    value: 51816,
    source: "Inbazz / Instagram",
    entity: "instagram:ana.demo",
    startDate: "2026-10-27",
    endDate: "2026-10-27",
  });
  assert.equal(readSocialReport(text, { id: "other", name: "outro" }), null);
  assert.equal(
    readSocialReport(
      text.replace("Instagram\n", "Instagram\nTikTok\n"),
      creator,
    ),
    null,
  );
  assert.equal(
    readSocialReport(text.replace("51.816", "51.816,5"), creator),
    null,
  );
  const conflicting = readSocialReport(
    text + "\nData da coleta: 2026-10-27\nData da coleta: 2026-10-26",
    creator,
  );
  assert.ok(conflicting && !("startDate" in conflicting.records[0]));
});
test("CSV processa moeda explícita e rejeita data ambígua sem chamar IA", async () => {
  const result = await parseInput(
    Buffer.from(
      "type;externalId;source;date;amount;currency\nsale;1;loja;2026-10-01;12.35;BRL\nsale;2;loja;01/10/2026;9.00;BRL",
    ),
    "vendas.csv",
  );
  assert.equal(result.rows[0].record?.type, "sale");
  assert.equal(result.rows[1].record, undefined);
  assert.match(result.rows[1].reason!, /date/);
  assert.match(result.interpretation, /nenhuma informação enviada/);
});
test("XLSX lê números e datas da primeira aba, sem LLM", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Vendas");
  sheet.addRow(["type", "externalId", "source", "date", "amount", "currency"]);
  sheet.addRow([
    "sale",
    "excel-1",
    "loja",
    new Date("2026-10-01T00:00:00Z"),
    42.5,
    "BRL",
  ]);
  const result = await parseInput(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "vendas.xlsx",
  );
  assert.equal(result.rows[0].record?.type, "sale");
  assert.equal(
    result.rows[0].record?.type === "sale" && result.rows[0].record.amount,
    42.5,
  );
});
