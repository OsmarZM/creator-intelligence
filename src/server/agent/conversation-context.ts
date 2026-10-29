import { readSocialReport } from "./social-report";
import {
  describeMonth,
  resolveCollectionDate,
  type CollectionContext,
} from "./temporal-context";
import { dateSchema } from "@/lib/domain";
import { readJob, type Session } from "./store";

export type PendingContext = {
  kind: "import";
  missing: string[];
  question: string;
  collection?: CollectionContext;
};
export function pendingText(pending: NonNullable<Session["pending"]>) {
  return pending.fileBase64 && /\.(txt|md)$/i.test(pending.filename ?? "")
    ? Buffer.from(pending.fileBase64, "base64").toString("utf8") +
        "\n" +
        pending.message
    : pending.message;
}
/** Upgrade saved sessions without rewriting historical turns or guessing their dates. */
export async function hydratePendingContext(
  state: Session,
  creators: { id: string; name: string }[],
  excludeJobId: string,
) {
  const pending = state.pending;
  if (!pending || pending.context) return;
  pending.context = pendingContext(
    pendingText(pending),
    creators.find((creator) => creator.id === pending.creatorId),
  );
  if (!pending.context.collection) return;
  for (const message of state.messages
    .filter(
      (message) =>
        message.role === "user" &&
        (!message.creatorId || message.creatorId === pending.creatorId) &&
        message.jobId !== excludeJobId &&
        message.text.length < 300 &&
        pending.message.includes(message.text),
    )
    .slice(-8)) {
    if (!message.jobId) continue;
    const job = await readJob(message.jobId);
    if (!job) continue;
    const result = resolvePendingDate(
      message.text,
      pending.context,
      job.createdAt,
      job.input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    if (result) pending.context = result.context;
  }
}
export function initialPendingReply(
  context: PendingContext,
  text: string,
  creator: { id: string; name: string },
  fallback: string,
) {
  const social = readSocialReport(text, creator);
  if (
    social &&
    context.missing.includes("collectionDate") &&
    context.collection?.month
  )
    return `Os dados de **${creator.name}** continuam preservados. A coleta já foi informada como **${describeMonth(context.collection.month)}**; falta somente o dia real. ${context.collection.deferred ? "O dia continua em aberto e podemos seguir com outras perguntas." : "Você lembra o dia? Pode responder só com o número ou manter essa informação pendente."}`;
  return social && context.missing.includes("collectionDate")
    ? `Recebi **${social.records[0].value.toLocaleString("pt-BR")} seguidores** de **${creator.name}** no Instagram. As métricas privadas estão indisponíveis e ficam fora dos indicadores.\n\nQual é a data da coleta? Pode responder naturalmente, como “hoje”, “ontem” ou informar o dia, mês e ano.`
    : `Os dados de **${creator.name}** continuam pendentes de informações para revisão.\n\n${fallback || context.question}`;
}
export function pendingContext(
  text: string,
  creator?: { id: string; name: string },
  question = "Quais informações faltam para completar os registros?",
  previous?: PendingContext,
): PendingContext {
  const social = readSocialReport(text, creator);
  return social && !social.records[0].startDate
    ? {
        kind: "import",
        missing: ["collectionDate"],
        question: "Em que dia foi feita a coleta dos seguidores?",
        collection: previous?.collection ?? {},
      }
    : { kind: "import", missing: ["recordDetails"], question };
}
export function isCancellation(text: string) {
  return /^(?:pode\s+)?(?:cancel(?:a|ar|e)|esque[cç](?:a|e))(?:\s+(?:isso|o envio|a importa[cç][aã]o|esses dados))?[.!]?$/i.test(
    text.trim(),
  );
}
export function resolvePendingDate(
  message: string,
  context: PendingContext,
  instant: string,
  timeZone: string,
): { date?: string; context: PendingContext; reply?: string } | null {
  if (!context.missing.includes("collectionDate")) return null;
  const resolved = resolveCollectionDate(
    message,
    context.collection ?? {},
    instant,
    timeZone,
  );
  if (resolved.kind === "unrecognized") return null;
  if (resolved.kind === "day")
    return {
      date: resolved.date,
      context: {
        ...context,
        collection: {
          date: resolved.date,
          month: resolved.date.slice(0, 7),
          evidence: resolved.evidence,
          deferred: false,
        },
      },
      reply: undefined,
    };
  if (resolved.kind === "month") {
    if (context.collection?.day) {
      const date = `${resolved.month}-${String(context.collection.day).padStart(2, "0")}`;
      if (dateSchema.safeParse(date).success)
        return {
          date,
          context: {
            ...context,
            collection: {
              date,
              month: resolved.month,
              evidence: resolved.evidence,
            },
          },
          reply: undefined,
        };
      return {
        context: { ...context, collection: { month: resolved.month } },
        reply: `O dia ${context.collection.day} não existe em ${describeMonth(resolved.month)}. Você lembra outro dia?`,
      };
    }
    const repeated = context.collection?.month === resolved.month;
    return {
      context: {
        ...context,
        collection: {
          ...context.collection,
          date: undefined,
          month: resolved.month,
          evidence: resolved.evidence,
        },
      },
      reply: `${repeated ? "Sim, o mês já ficou registrado" : "Entendi"}: a coleta foi em **${describeMonth(resolved.month)}**. Você lembra o dia? Pode responder só “dia 15”, por exemplo. Se não lembrar, posso manter esse dado pendente e continuar a conversa.`,
    };
  }
  if (resolved.kind === "day_hint")
    return {
      context: {
        ...context,
        collection: {
          ...context.collection,
          day: resolved.day,
          evidence: resolved.evidence,
        },
      },
      reply: `Entendi o dia **${resolved.day}**. De qual mês e ano foi a coleta?`,
    };
  if (resolved.kind === "unknown")
    return {
      context: {
        ...context,
        collection: { ...context.collection, deferred: true },
      },
      reply: `Sem problema.${context.collection?.month ? ` Mantive **${describeMonth(context.collection.month)}** como referência.` : ""} Os seguidores ficam como informação recebida, pendente de data exata, sem entrar na série diária. Podemos seguir com outras perguntas; se lembrar o dia depois, eu retomo esse envio.`,
    };
  return { context, reply: resolved.message };
}
export function conversationSnapshot(state: Session) {
  return {
    documents: state.documents?.slice(-2).map((document) => ({
      jobId: document.jobId,
      sourceHash: document.sourceHash,
      context: document.context.slice(0, 900),
      status: "Contexto declarado, não confirmado nos indicadores",
    })),
    activeCreatorId: state.creatorId ?? null,
    pendingTask: state.pending
      ? {
          creatorId: state.pending.creatorId ?? null,
          ...state.pending.context,
          question: state.pending.context?.question.slice(0, 600),
          original: state.pending.message.slice(0, 800),
        }
      : null,
  };
}
export function conversationHistory(state: Session, excludeJobId: string) {
  const recent = state.messages
    .filter(
      (message) =>
        message.jobId !== excludeJobId && !message.error && message.text.trim(),
    )
    .slice(-6);
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser < 0
    ? []
    : recent.slice(firstUser).map((message) => ({
        role: message.role,
        content: message.text.slice(0, 700),
      }));
}
/** Keep a model from offering a fabricated day to satisfy a required data field. */
export function groundedConversationReply(reply: string, state: Session) {
  const context = state.pending?.context;
  if (
    context?.missing.includes("collectionDate") &&
    !context.collection?.date &&
    /\b(?:sugerir|escolher|assumir|adotar|preencher|usar|use|preencha|escolha)\b.{0,45}\b(?:um dia|uma data|qualquer dia|qualquer data|primeiro dia|último dia|dia aproximado|data aproximada)\b/i.test(
      reply,
    )
  )
    return `${context.collection?.month ? `Entendi que a coleta foi em **${describeMonth(context.collection.month)}**.` : "Os dados do relatório continuam preservados."} Para colocar o total de seguidores na série diária, falta o dia real da coleta. Se você não lembrar, podemos manter essa informação pendente e continuar com outras perguntas, sem escolher uma data fictícia.`;
  return reply;
}
