import { z } from "zod";
import { chartSchema } from "@/lib/domain";
import { parseAIJson } from "./ai";
import { ProviderError } from "./inference-retry";
import { chatVisualSchema } from "@/lib/chat-visuals";
const chatReply = z
  .object({
    reply: z.string().trim().min(1).max(12000),
    charts: z.array(chartSchema).max(12).nullable().default(null),
    visuals: z.array(chatVisualSchema).max(6).optional(),
  })
  .strict();
export function parseChatReply(text: string) {
  let value: unknown;
  try {
    value = parseAIJson(text);
  } catch {
    // Accept a normal conversational answer, but never salvage broken chart JSON.
    if (/^\s*(?:```|[\[{])/.test(text))
      throw new ProviderError(
        "A IA retornou uma proposta incompleta. Tente novamente; nenhum dado foi confirmado.",
        false,
      );
    value = { reply: text, charts: null };
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "visuals" in value
  ) {
    const packet = value as Record<string, unknown>;
    const visuals = Array.isArray(packet.visuals)
      ? packet.visuals.slice(0, 6).flatMap((visual) => {
          const parsed = chatVisualSchema.safeParse(visual);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    value = {
      ...packet,
      visuals,
      ...(typeof packet.reply === "string" &&
      !packet.reply.trim() &&
      visuals.length
        ? { reply: "Organizei os dados na visualização abaixo." }
        : {}),
    };
  }
  const result = chatReply.safeParse(value);
  if (!result.success)
    throw new ProviderError(
      "A resposta da IA não passou na validação. Tente novamente; nenhum gráfico ou dado foi alterado.",
      false,
    );
  return result.data;
}
