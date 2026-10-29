import { dateSchema } from "@/lib/domain";

/** Narrow, deterministic reader for the observed Inbazz Instagram export.
 * Unknown layouts fall through to the general extractor; missing dates stay missing.
 */
export function readSocialReport(
  text: string,
  creator?: { id: string; name: string },
) {
  if (
    !creator ||
    !/Creator sem compartilhamento de métricas privadas/i.test(text) ||
    !/Inbazz/i.test(text) ||
    !/últimos 30 dias/i.test(text)
  )
    return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (
    lines.filter((line) => /^Instagram$/i.test(line)).length !== 1 ||
    lines.some((line) => /^TikTok$/i.test(line))
  )
    return null;
  const name = lines.find(Boolean)?.replace(/\s*\(novo\)\s*$/i, "");
  if (
    name?.replace(/^@/, "").toLowerCase() !==
    creator.name.replace(/^@/, "").toLowerCase()
  )
    return null;
  const followerValues = [
    ...text.matchAll(/^Seguidores\s*\r?\n\s*(\d{1,3}(?:\.\d{3})+|\d+)\s*$/gim),
  ];
  if (followerValues.length !== 1) return null;
  const value = Number(followerValues[0][1].replaceAll(".", ""));
  if (!Number.isSafeInteger(value) || value > 1_000_000_000) return null;
  const dates = [
    ...text.matchAll(
      /^Data (?:da coleta|de referência):\s*(\d{4}-\d{2}-\d{2})\s*$/gim,
    ),
  ];
  const uniqueDates = [...new Set(dates.map((match) => match[1]))];
  const date =
    uniqueDates.length === 1 && dateSchema.safeParse(uniqueDates[0]).success
      ? uniqueDates[0]
      : undefined;
  return {
    records: [
      {
        type: "metric",
        metric: "followers",
        kind: "snapshot",
        value,
        entity: `instagram:${creator.name.replace(/^@/, "")}`,
        source: "Inbazz / Instagram",
        ...(date ? { startDate: date, endDate: date } : {}),
      },
    ],
    notes: `Leitura local do relatório Inbazz: ${value.toLocaleString("pt-BR")} seguidores no Instagram de ${creator.name}. Métricas privadas indisponíveis por falta de compartilhamento; os zeros de médias/alcance/visualizações não foram importados como medições confirmadas. “Últimos 30 dias” não informa a data deste snapshot. ${date ? `Data da coleta informada: ${date}.` : "Qual é a data da coleta desse número de seguidores? Responda: Data da coleta: AAAA-MM-DD. Não vou usar a data de hoje nem o filtro do painel automaticamente."}`,
    chunks: 0,
  };
}
