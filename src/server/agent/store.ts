import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentMessage, AgentEvent } from "@/lib/agent";
import type { ChartConfig } from "@/lib/domain";
import { dataDirectory } from "../data-directory";
import type { PendingContext } from "./conversation-context";
import type { DocumentCheckpoint } from "./document-pipeline";
import type { WorkbookReportView } from "@/lib/workbook-report";
import type { ChatVisual } from "@/lib/chat-visuals";
export type TurnInput = {
  message: string;
  filename?: string;
  fileBase64?: string;
  from: string;
  to: string;
  currency: string;
  charts: ChartConfig[];
  timeZone?: string;
};
export type Session = {
  lastWorkbook?: Pick<
    WorkbookReportView,
    "jobId" | "hash" | "period" | "currency"
  >;
  documents?: {
    jobId: string;
    creatorId?: string;
    sourceHash: string;
    context: string;
  }[];
  messages: AgentMessage[];
  creatorId?: string;
  summary: string;
  memories?: Record<string, { text: string; count: number }>;
  pending?: {
    message: string;
    filename?: string;
    fileBase64?: string;
    creatorId?: string;
    context?: PendingContext;
  };
  activeJobId?: string;
};
export type AgentJob = {
  workbookReport?: WorkbookReportView;
  visuals?: ChatVisual[];
  document?: DocumentCheckpoint;
  id: string;
  input: TurnInput;
  status: "running" | "done" | "failed";
  events: AgentEvent[];
  parts: string[];
  summaries: string[];
  usage?: {
    engine?: "hermes" | "direct";
    task: string;
    provider: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
  }[];
  charts?: ChartConfig[];
  plan?: {
    intent: "answer" | "ingest" | "clarify";
    creatorId?: string;
    question?: string;
    sections: string[];
    preservePending?: boolean;
    clearPending?: boolean;
  };
  source?: TurnInput;
  error?: string;
  batchId?: string;
  createdAt: string;
};
function folder() {
  return path.join(dataDirectory(), "agent");
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export async function readJSON<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(folder(), name), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function writeJSON(name: string, value: unknown) {
  const target = path.join(folder(), name);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, target);
}
export async function session(): Promise<Session> {
  return (
    (await readJSON<Session>("session.json")) ?? { messages: [], summary: "" }
  );
}
export const saveSession = (value: Session) => writeJSON("session.json", value);
export const saveJob = (job: AgentJob) => writeJSON(`jobs/${job.id}.json`, job);
export const readJob = (id: string) => readJSON<AgentJob>(`jobs/${id}.json`);
export async function resetSession() {
  const previous = await session();
  if (previous.messages.length)
    await writeJSON(`sessions/${randomUUID()}.json`, previous);
  const value: Session = { messages: [], summary: "" };
  await saveSession(value);
  return value;
}
