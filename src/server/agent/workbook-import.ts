import { loadWorkbook } from "../workbook";
import {
  readWorkbookReport,
  applyWorkbookReport,
  reportSummary,
} from "../workbook-report";
import { readJob, saveJob, session, saveSession } from "./store";
import { agentBusy } from "./orchestrator";
import { structuredWorkbookContext } from "./workbook-context";
export async function workbookForJob(jobId: string) {
  const job = await readJob(jobId);
  if (
    !job?.input.fileBase64 ||
    !job.input.filename?.toLowerCase().endsWith(".xlsx")
  )
    return null;
  const buffer = Buffer.from(job.input.fileBase64, "base64");
  const workbook = await loadWorkbook(buffer);
  const report = readWorkbookReport(
    workbook,
    buffer,
    job.input.filename,
    jobId,
  );
  if (!report) return null;
  if (
    job.workbookReport?.status === "applied" &&
    job.workbookReport.hash === report.view.hash
  )
    report.view = job.workbookReport;
  return { job, buffer, report, workbook };
}
let applying = false;
export const workbookApplying = () => applying;
export async function applyJobWorkbook(jobId: string, hash: string) {
  if (applying || agentBusy())
    throw new Error(
      "Aguarde a análise atual terminar antes de aplicar os dados.",
    );
  applying = true;
  try {
    const input = await workbookForJob(jobId);
    if (!input || input.report.view.hash !== hash)
      throw new Error(
        "A prévia não corresponde ao arquivo salvo. Atualize a conversa.",
      );
    const view = await applyWorkbookReport(input.report, input.buffer);
    input.job.workbookReport = view;
    if (input.job.document) input.job.document.context = reportSummary(view);
    else input.job.document = structuredWorkbookContext(input.workbook, view);
    await saveJob(input.job);
    const state = await session();
    state.lastWorkbook = {
      jobId,
      hash,
      period: view.period,
      currency: view.currency,
    };
    state.creatorId = undefined;
    const document = state.documents?.find((entry) => entry.jobId === jobId);
    if (document) document.context = reportSummary(view);
    else
      (state.documents ??= []).push({
        jobId,
        sourceHash: input.job.document.sourceHash,
        context: reportSummary(view),
      });
    await saveSession(state);
    return view;
  } finally {
    applying = false;
  }
}
