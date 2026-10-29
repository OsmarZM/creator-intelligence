import { parse } from "csv-parse/sync";
import { loadWorkbook } from "./workbook";
import { recordSchema, type DataRecord } from "@/lib/domain";
import { extractText } from "./agent/extraction";
export type ParsedRow = {
  row: number;
  payload: unknown;
  record?: DataRecord;
  reason?: string;
};
function normalize(row: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== "" && value !== null && value !== undefined)
      result[key.trim()] = typeof value === "string" ? value.trim() : value;
  }
  if (!result.type) result.type = result.externalId ? "sale" : "metric";
  return result;
}
export async function parseInput(
  buffer: Buffer,
  filename: string,
  creator?: { id: string; name: string },
  progress?: (message: string) => Promise<void>,
): Promise<{ rows: ParsedRow[]; interpretation: string }> {
  const ext = filename.toLowerCase().split(".").at(-1);
  let rows: unknown[];
  let interpretation =
    "Parser determinístico; nenhuma informação enviada à IA.";
  if (ext === "csv")
    rows = parse(buffer, {
      bom: true,
      columns: (headers: string[]) => {
        const names = headers.map((header) => header.trim());
        if (names.some((name) => !name) || new Set(names).size !== names.length)
          throw new Error("Cabeçalhos vazios ou repetidos no CSV.");
        return names;
      },
      skip_empty_lines: true,
      trim: true,
      delimiter: buffer.toString("utf8").split(/\r?\n/)[0].includes(";")
        ? ";"
        : ",",
      max_record_size: 20000,
    });
  else if (ext === "xlsx") {
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 2001 || sheet.columnCount > 30)
      throw new Error(
        "Planilha deve ter até 2.000 linhas e 30 colunas, na primeira aba.",
      );
    const headers = Array.from({ length: sheet.columnCount }, (_, i) =>
      sheet
        .getRow(1)
        .getCell(i + 1)
        .text.trim(),
    );
    if (new Set(headers).size !== headers.length || headers.some((h) => !h))
      throw new Error("Cabeçalhos vazios ou repetidos na primeira aba.");
    rows = [];
    sheet.eachRow((row, n) => {
      if (n > 1)
        rows.push(
          Object.fromEntries(
            headers.map((h, i) => {
              const cell = row.getCell(i + 1);
              return [
                h,
                cell.value instanceof Date
                  ? cell.value.toISOString().slice(0, 10)
                  : cell.text,
              ];
            }),
          ),
        );
    });
  } else if (["txt", "md"].includes(ext ?? "")) {
    const text = buffer.toString("utf8");
    const extracted = await extractText(text, creator, progress);
    rows = extracted.records;
    interpretation =
      extracted.chunks === 0
        ? extracted.notes
        : extracted.chunks + " blocos processados. " + extracted.notes;
  } else throw new Error("Formato aceito: CSV, XLSX, TXT ou MD.");
  if (!rows.length || rows.length > 2000)
    throw new Error("Envie entre 1 e 2.000 registros por lote.");
  return {
    interpretation,
    rows: rows.map((raw, i) => {
      const payload =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? normalize(raw as Record<string, unknown>)
          : raw;
      const parsed = recordSchema.safeParse(payload);
      return parsed.success
        ? { row: i + 2, payload: parsed.data, record: parsed.data }
        : {
            row: i + 2,
            payload,
            reason: parsed.error.issues
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("; "),
          };
    }),
  };
}
