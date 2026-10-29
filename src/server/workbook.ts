import ExcelJS from "exceljs";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { Readable } from "node:stream";

const spreadsheetNamespace =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const escapeXML = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ExcelJS matches literal tag names and misses valid OOXML with x:workbook,
// x:worksheet, etc. Normalize names using resolved namespaces, never a regex
// over user text. This only changes the in-memory copy, not the source file.
function normalizeSpreadsheetXML(xml: string) {
  const parser = new SaxesParser({ xmlns: true });
  const output: string[] = [];
  parser.on("doctype", () => { throw new Error("DOCTYPE não é permitido em XLSX."); });
  parser.on("opentag", (tag) => {
    const name = tag.uri === spreadsheetNamespace ? tag.local : tag.name;
    const attrs = Object.values(tag.attributes).map((attr) =>
      ` ${attr.name}="${escapeXML(attr.value)}"`,
    ).join("");
    output.push(`<${name}${attrs}>`);
  });
  parser.on("closetag", (tag) => {
    output.push(`</${tag.uri === spreadsheetNamespace ? tag.local : tag.name}>`);
  });
  parser.on("text", (text) => output.push(escapeXML(text)));
  parser.on("cdata", (text) => output.push(escapeXML(text)));
  parser.write(xml.replace(/^\uFEFF/, "")).close();
  return output.join("");
}

export async function loadWorkbook(buffer: Buffer) {
  if (buffer.length > 5 * 1024 * 1024) throw new Error("Arquivo limitado a 5 MB.");
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > 1000) throw new Error("XLSX contém partes demais.");
  let total = 0;
  for (const entry of entries) {
    // Images, printer settings and embedded objects have no role in data reading.
    if (!/^(\[Content_Types\]\.xml|_rels\/\.rels|xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/.test(entry.name)) {
      zip.remove(entry.name);
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = new Readable({ read() {} }).wrap(entry.nodeStream());
    for await (const part of stream) {
      const chunk = Buffer.from(part);
      size += chunk.length;
      total += chunk.length;
      if (size > 8 * 1024 * 1024 || total > 24 * 1024 * 1024)
        throw new Error("Conteúdo descompactado do XLSX excede o limite de leitura.");
      chunks.push(chunk);
    }
    zip.file(entry.name, normalizeSpreadsheetXML(Buffer.concat(chunks).toString("utf8")));
  }
  const workbook = new ExcelJS.Workbook();
  const normalized = await zip.generateAsync({ type: "nodebuffer" });
  await workbook.xlsx.load(normalized as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  if (!workbook.worksheets.length) throw new Error("O XLSX não contém abas legíveis.");
  if (workbook.worksheets.length > 20 || workbook.worksheets.some((sheet) => sheet.rowCount > 2001 || sheet.columnCount > 60))
    throw new Error("Use até 20 abas, 2.000 linhas por aba e 60 colunas.");
  return workbook;
}

export function isImportTable(workbook: ExcelJS.Workbook) {
  const sheet = workbook.worksheets[0];
  const headers = Array.from({ length: sheet.columnCount }, (_, index) => sheet.getRow(1).getCell(index + 1).text.trim());
  return headers.includes("source") &&
    (headers.includes("externalId") || (headers.includes("metric") && headers.includes("entity")));
}

export function workbookDocument(workbook: ExcelJS.Workbook) {
  const lines = [
    "Documento XLSX recebido, ainda não confirmado nos indicadores. Todas as abas abaixo são partes do mesmo arquivo; resumos e detalhes podem repetir os mesmos valores e não devem ser somados entre si.",
    "Fórmulas: exibimos o resultado salvo no arquivo, sem recalcular nem executar fórmulas. Datas das células são da planilha, não necessariamente a data da coleta. Preserve os vínculos pendentes e as ressalvas da metodologia.",
  ];
  for (const sheet of workbook.worksheets) {
    const heading = `\n## Aba ${JSON.stringify(sheet.name)} (${sheet.rowCount} linhas)`;
    let header = "", headerCells = 0;
    sheet.eachRow((row, number) => {
      if (number > 10) return;
      const cells: string[] = [];
      row.eachCell((cell) => {
        if (cell.text && (!cell.isMerged || cell.master.address === cell.address))
          cells.push(`${cell.col}=${JSON.stringify(cell.text)}`);
      });
      if (cells.length > headerCells) {
        headerCells = cells.length;
        header = `Referência de colunas (linha ${number}): ${cells.join(" | ")}`;
      }
    });
    lines.push(heading, header);
    let blockSize = 0;
    sheet.eachRow((row, number) => {
      const cells: string[] = [];
      row.eachCell((cell) => {
        const value = cell.value;
        if (value === null || value === undefined || cell.isMerged && cell.master.address !== cell.address) return;
        const formula = typeof value === "object" && "formula" in value;
        const raw = formula ? cell.result : value;
        const text = raw instanceof Date ? raw.toISOString() :
          formula && raw === undefined ? "[fórmula sem resultado salvo]" : cell.text;
        const percentageFormat = typeof raw === "number" && cell.numFmt?.includes("%")
          ? ` [formato Excel: ${JSON.stringify(cell.numFmt)}]` : "";
        if (text) cells.push(`${cell.address}=${JSON.stringify(text)}${percentageFormat}${formula ? " [resultado salvo de fórmula]" : ""}`);
      });
      if (cells.length) {
        if (blockSize > 1500) {
          lines.push(heading + " · continuação", header);
          blockSize = 0;
        }
        const line = `Linha ${number}: ${cells.join(" | ")}`;
        lines.push(line);
        blockSize += line.length;
      }
    });
  }
  const text = lines.join("\n");
  if (text.length > 180000) throw new Error("A planilha ultrapassa 180.000 caracteres de conteúdo. Envie as abas em arquivos menores; nenhuma linha foi descartada silenciosamente.");
  return text;
}
