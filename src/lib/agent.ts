import { z } from "zod";
import type { ChartConfig } from "./domain";
import type { ChatVisual } from "./chat-visuals";
import type { WorkbookReportView } from "./workbook-report";
export const agentSettingsSchema = z
  .object({
    engine: z.enum(["direct", "hermes"]).default("direct"),
    hermesRoot: z.string().trim().max(1000).default(""),
    hermesPython: z.string().trim().max(1000).default(""),
    routerModel: z.string().trim().max(200).default(""),
    extractorModel: z.string().trim().max(200).default(""),
    summaryModel: z.string().trim().max(200).default(""),
    answerModel: z.string().trim().max(200).default(""),
    auxiliaryConnection: z.enum(["primary", "fallback"]).default("primary"),
    chunkChars: z.number().int().min(2000).max(8000).default(5000),
    answerTokens: z.number().int().min(300).max(8192).default(1500),
  })
  .strict();
export type AgentSettings = z.infer<typeof agentSettingsSchema>;
export type AgentTask = "router" | "extractor" | "summary" | "answer";
export type AgentMessage = {
  visuals?: ChatVisual[];
  report?: WorkbookReportView;
  id: string;
  role: "user" | "assistant";
  text: string;
  creatorId?: string;
  charts?: ChartConfig[];
  jobId?: string;
  meta?: string;
  error?: string;
};
export type AgentEvent = {
  visuals?: ChatVisual[];
  report?: WorkbookReportView;
  type: "progress" | "reply" | "complete" | "error";
  jobId: string;
  text?: string;
  creatorId?: string;
  batchId?: string;
  charts?: ChartConfig[];
  retryAfterMs?: number;
  meta?: string;
};
