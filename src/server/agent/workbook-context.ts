import type ExcelJS from "exceljs";
import type { WorkbookReportView } from "@/lib/workbook-report";
import { workbookDocument } from "../workbook";
import { reportSummary } from "../workbook-report";
import { documentSections, type DocumentCheckpoint } from "./document-pipeline";
import { digest } from "./store";
export function structuredWorkbookContext(
  workbook: ExcelJS.Workbook,
  view: WorkbookReportView,
): DocumentCheckpoint {
  const text = workbookDocument(workbook);
  return {
    version: 2,
    sourceHash: digest(text),
    nodes: documentSections(text, 3000).map((part, index) => ({
      id: `trecho-${index + 1}`,
      text: part,
      summary:
        "Fonte tabular preservada; campos reconhecidos pelo mapeamento local.",
      method: "structured",
    })),
    reductions: {},
    context: reportSummary(view),
  };
}
