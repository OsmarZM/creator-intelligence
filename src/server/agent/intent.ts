import { isDataQuestion } from "@/lib/creator-context";
export function quickIntent(
  message: string,
  filename?: string,
): "answer" | "ingest" | null {
  if (filename && /\.(csv|xlsx)$/i.test(filename)) return "ingest";
  if (
    isDataQuestion(message) ||
    /^(analise|analisa|explique|resuma|compare|o que|quanto|quantas|quantos)\b/i.test(
      message.trim(),
    )
  )
    return "answer";
  if (message.length > 1500 || (message.match(/\?/g)?.length ?? 0) > 1)
    return null;
  if (
    /\d/.test(message) &&
    /vendeu|vendas|receita|seguidores|visualiza|alcance|pedidos|faturou|curtidas|engajamento/i.test(
      message,
    )
  )
    return "ingest";
  return null;
}
