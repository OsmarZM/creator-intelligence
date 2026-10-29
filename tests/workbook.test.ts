import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { loadWorkbook, isImportTable, workbookDocument } from "../src/server/workbook";

test("XLSX com namespace prefixado preserva abas, fórmulas salvas, datas e texto", async () => {
  const source = new ExcelJS.Workbook();
  const summary = source.addWorksheet("Resumo");
  summary.addRow(["Relatório de vários criadores"]);
  summary.addRow(["Valor recebido", { formula: "SUM(Vendas!B2:B3)", result: 42.5 }]);
  summary.addRow(["x:worksheet em texto não deve mudar & < >"]);
  const sales = source.addWorksheet("Vendas");
  sales.addRow(["Perfil", "Valor pago", "Data"]);
  sales.addRow(["@primeiro", 42.5, new Date("2026-10-22T12:00:00Z")]);
  sales.addRow(["@segundo", 0.016]);
  sales.getCell("B3").numFmt = "0.0%";
  source.addWorksheet("Pendências").addRow(["Não atribuir @segundo a @primeiro"]);
  source.addWorksheet("Metodologia").addRow(["Períodos diferentes, não somar resumo e detalhes"]);
  const zip = await JSZip.loadAsync(await source.xlsx.writeBuffer());
  for (const entry of Object.values(zip.files)) {
    if (!/^xl\/(workbook|styles|sharedStrings|worksheets\/sheet\d+)\.xml$/.test(entry.name)) continue;
    let xml = await entry.async("string");
    xml = xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
    xml = xml.replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, "<$1x:$2");
    zip.file(entry.name, xml);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const before = Buffer.from(buffer);
  const read = await loadWorkbook(buffer);
  assert.deepEqual(buffer, before, "Leitura não altera o arquivo recebido");
  assert.deepEqual(read.worksheets.map((sheet) => sheet.name), ["Resumo", "Vendas", "Pendências", "Metodologia"]);
  assert.equal(isImportTable(read), false);
  assert.equal(read.worksheets[0].getCell("B2").result, 42.5);
  assert.equal((read.worksheets[1].getCell("C2").value as Date).toISOString(), "2026-10-22T12:00:00.000Z");
  const text = workbookDocument(read);
  assert.match(text, /x:worksheet em texto não deve mudar & < >/);
  assert.match(text, /Não atribuir @segundo a @primeiro/);
  assert.match(text, /resultado salvo de fórmula/);
  assert.match(text, /Metodologia/);
  assert.match(text, /B3="0\.016" \[formato Excel: "0\.0%"\]/);
});

test("XLSX rejeita XML com DTD e conteúdo acima do orçamento sem truncar", async () => {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<!DOCTYPE workbook><workbook/>');
  await assert.rejects(loadWorkbook(await zip.generateAsync({ type: "nodebuffer" })), /DOCTYPE/);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dados");
  for (let i = 0; i < 100; i++) sheet.addRow(["a".repeat(2000)]);
  assert.throws(() => workbookDocument(workbook), /180.000/);
});
