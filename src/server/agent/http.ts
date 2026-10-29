import { NextRequest } from "next/server";
import { z } from "zod";
import path from "node:path";
import { chartSchema } from "@/lib/domain";
import { filters } from "../analytics";
import { agentStream, runningJob } from "./orchestrator";
import { session, readJob, resetSession } from "./store";
import { saveSession } from "./store";
import { db } from "../db";
import { validTimeZone } from "./temporal-context";
import { workbookForJob, workbookApplying } from "./workbook-import";
export async function recordConfirmation(batch: {
  id: string;
  creatorId: string;
}) {
  const state = await session(),
    id = `import-${batch.id}`;
  if (state.messages.some((message) => message.id === id)) return;
  const [creator, count] = await Promise.all([
    db().creator.findUniqueOrThrow({ where: { id: batch.creatorId } }),
    db().pendingChange.count({
      where: { importId: batch.id, status: "approved" },
    }),
  ]);
  state.messages.push({
    id,
    role: "assistant",
    text: `Lote confirmado para **${creator.name}**. ${count} registros foram aprovados. Os indicadores já consultam a base atualizada.`,
    creatorId: batch.creatorId,
  });
  state.creatorId = batch.creatorId;
  await saveSession(state);
}
export async function publicSession() {
  const state = await session();
  const job = state.activeJobId ? await readJob(state.activeJobId) : null;
  const messages = state.messages
    .slice(-100)
    .map((message) => ({ ...message }));
  const seen = new Set<string>();
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || !message.jobId) continue;
    try {
      const report = (await workbookForJob(message.jobId))?.report.view;
      if (report && !seen.has(report.hash)) {
        message.report = report;
        seen.add(report.hash);
      }
    } catch {
      /* A malformed older attachment must not hide the conversation. */
    }
  }
  return {
    messages,
    lastWorkbook: state.lastWorkbook,
    creatorId: state.creatorId,
    activeJobId: state.activeJobId,
    jobStatus: job?.status,
  };
}
export async function newConversation() {
  if (runningJob() || workbookApplying())
    throw new Error(
      "Aguarde a análise atual terminar antes de iniciar outra conversa.",
    );
  await resetSession();
  return publicSession();
}
export async function turn(request: NextRequest) {
  if (workbookApplying())
    throw new Error(
      "Aguarde a importação terminar antes de iniciar outra análise.",
    );
  if (Number(request.headers.get("content-length")) > 6 * 1024 * 1024)
    throw new Error("Envio limitado a 5 MB por arquivo.");
  const form = await request.formData();
  const id = z.string().uuid().parse(form.get("jobId"));
  if (form.get("resume") === "1") return agentStream(id);
  const message = z
    .string()
    .max(180000)
    .parse(form.get("message") ?? "");
  const timeZone = z
    .string()
    .max(100)
    .refine(validTimeZone, "Fuso horário inválido.")
    .optional()
    .parse(form.get("timeZone") ?? undefined);
  const file = form.get("file");
  if (!message.trim() && !(file instanceof File))
    throw new Error("Envie uma mensagem ou arquivo.");
  if (
    file instanceof File &&
    (file.size > 5 * 1024 * 1024 || !/\.(csv|xlsx|txt|md)$/i.test(file.name))
  )
    throw new Error("Use CSV, XLSX, TXT ou MD com até 5 MB.");
  const period = filters(
    new URLSearchParams({
      from: String(form.get("from")),
      to: String(form.get("to")),
      currency: String(form.get("currency") ?? "BRL"),
    }),
  );
  const charts = z
    .array(chartSchema)
    .max(12)
    .parse(JSON.parse(String(form.get("charts") ?? "[]")));
  if (workbookApplying())
    throw new Error(
      "Aguarde a importação terminar antes de iniciar outra análise.",
    );
  return agentStream(id, {
    message: message.trim(),
    ...period,
    charts,
    ...(timeZone ? { timeZone } : {}),
    ...(file instanceof File
      ? {
          filename: path.basename(file.name).slice(0, 250),
          fileBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        }
      : {}),
  });
}
