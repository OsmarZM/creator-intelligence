import { test } from "node:test";
import assert from "node:assert/strict";
import { reportFixture } from "./fixtures/workbook-report";
import { readWorkbookReport } from "../src/server/workbook-report";
import { chartPresentation } from "../src/lib/chart-presentation";
import { parseChatReply } from "../src/server/chat-reply";
test("relatório: perfil/username são vínculos explícitos, dinheiro vem do detalhe e não da soma de abas", async () => {
  const workbook = reportFixture();
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const report = readWorkbookReport(
    workbook,
    buffer,
    "origem.xlsx",
    "fixture",
  )!;
  assert.equal(report.view.profiles.length, 3);
  assert.equal(report.view.orders, 2);
  assert.equal(report.view.paid, 52.5);
  assert.equal(report.view.pendingOrders, 1);
  assert.equal(report.view.pendingPaid, 7.5);
  assert.equal(report.view.profiles[0].engagementPercent, 1.6);
  assert.equal(report.sales[1].handle, "@bia_fixture");
  assert.deepEqual(report.view.period, {
    from: "2026-09-01",
    to: "2026-10-01",
  });
  assert.ok(
    report.sales.every(
      ({ record }) =>
        record.source === "Origem fixture" && record.currency === "BRL",
    ),
  );
});
test("relatório: divergência no controle e IDs repetidos bloqueiam o lote", async () => {
  const workbook = reportFixture();
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  workbook.getWorksheet("Resumo")!.getCell("B2").value = 53;
  assert.throws(
    () => readWorkbookReport(workbook, buffer, "origem.xlsx", "fixture"),
    /não confere/,
  );
  workbook.getWorksheet("Resumo")!.getCell("B2").value = 52.5;
  workbook.getWorksheet("Vendas")!.getCell("E3").value = "pedido-1";
  assert.throws(
    () => readWorkbookReport(workbook, buffer, "origem.xlsx", "fixture"),
    /Pedido repetido/,
  );
});
test("gráfico: categorias agrupadas preservam o total e a tabela mantém os dados originais", () => {
  const data = Array.from({ length: 18 }, (_, i) => ({
    label: `Perfil ${i}`,
    value: i + 1,
  }));
  const original = structuredClone(data);
  const result = chartPresentation({ type: "pie", groupBy: "creator" }, data);
  assert.equal(result.visible.length, 6);
  assert.equal(
    result.visible.reduce((sum, item) => sum + item.value, 0),
    171,
  );
  assert.equal(result.sorted.length, 18);
  assert.deepEqual(data, original);
  assert.equal(result.visible[0].label, "Perfil 17");
});
test("chat: tabelas e fluxos validados renderizam dados; visual inválido preserva a resposta textual", () => {
  const valid = parseChatReply(
    JSON.stringify({
      reply: "",
      charts: null,
      visuals: [
        {
          type: "table",
          title: "Valores",
          columns: ["Creator", "Valor"],
          rows: [["Ana", 42.5]],
        },
        {
          type: "flow",
          title: "Importação",
          steps: [{ title: "Ler" }, { title: "Confirmar" }],
        },
      ],
    }),
  );
  assert.equal(valid.visuals?.length, 2);
  assert.ok(valid.reply.length);
  const invalid = parseChatReply(
    JSON.stringify({
      reply: "Texto preservado",
      charts: null,
      visuals: [
        { type: "table", title: "Inválida", columns: ["A"], rows: [[1, 2]] },
        { type: "html", content: "<script/>" },
      ],
    }),
  );
  assert.equal(invalid.reply, "Texto preservado");
  assert.deepEqual(invalid.visuals, []);
});
