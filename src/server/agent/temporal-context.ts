import { dateSchema } from "@/lib/domain";

export type CollectionContext = {
  month?: string;
  date?: string;
  evidence?: string;
  deferred?: boolean;
  day?: number;
};
export type TemporalResolution =
  | { kind: "day"; date: string; evidence: string }
  | { kind: "month"; month: string; evidence: string }
  | { kind: "day_hint"; day: number; evidence: string }
  | { kind: "unknown" }
  | { kind: "invalid"; message: string }
  | { kind: "unrecognized" };

export function localDate(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (name: string) =>
    parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const months = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export function describeMonth(month: string) {
  return `${months[Number(month.slice(5)) - 1]} de ${month.slice(0, 4)}`;
}
/** Resolve only explicit calendar statements; never turn a month/range into a day. */
export function resolveCollectionDate(
  message: string,
  context: CollectionContext,
  instant: string,
  timeZone: string,
): TemporalResolution {
  const text = normalize(message),
    today = localDate(instant, timeZone);
  if (text.includes("?")) return { kind: "unrecognized" };
  if (
    /\b(nao foi|nao era|nao e|nao coletei|talvez|acho|pode ter|se for)\b/.test(
      text,
    )
  )
    return { kind: "unrecognized" };
  const day = (date: string): TemporalResolution =>
    dateSchema.safeParse(date).success
      ? { kind: "day", date, evidence: message }
      : {
          kind: "invalid",
          message:
            "Essa data não existe no calendário. Qual foi a data da coleta?",
        };
  const dates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(
    (match) => match[1],
  );
  const brazilian = [
    ...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g),
  ].map(
    (match) =>
      `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`,
  );
  const explicit = [...new Set([...dates, ...brazilian])];
  if (explicit.length > 1)
    return {
      kind: "invalid",
      message:
        "Você mencionou mais de uma data. Em qual delas os seguidores foram medidos?",
    };
  if (explicit.length === 1) return day(explicit[0]);
  if (
    /\b(nao (?:sei|lembro|recordo)|sem (?:o )?dia|so (?:sei|lembro) (?:o )?mes|nao tenho (?:o |a )?(?:dia|data))\b/.test(
      text,
    )
  )
    return { kind: "unknown" };
  if (!/\?|\b(se|talvez|acho|entre|ate|periodo|semana|meados)\b/.test(text)) {
    if (/\b(?:hoje|ontem|anteontem)\b/.test(text)) {
      const offset = /\banteontem\b/.test(text)
        ? 2
        : /\bontem\b/.test(text)
          ? 1
          : 0;
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - offset);
      return day(date.toISOString().slice(0, 10));
    }
    const named = text.match(
      /\b(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(\d{4})\b/,
    );
    if (named)
      return day(
        `${named[3]}-${String(months.indexOf(named[2]) + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`,
      );
    const shortDay = text.match(
      /^(?:(?:foi|era|coletei|a coleta foi|foi coletado|foi coletada)\s+)?(?:no\s+)?(?:dia\s+)?(\d{1,2})[.!]?$/,
    );
    if (shortDay) {
      if (Number(shortDay[1]) < 1 || Number(shortDay[1]) > 31)
        return {
          kind: "invalid",
          message:
            "Esse dia não existe no calendário. Qual foi o dia da coleta?",
        };
      if (!context.month)
        return {
          kind: "day_hint",
          day: Number(shortDay[1]),
          evidence: message,
        };
      return day(`${context.month}-${shortDay[1].padStart(2, "0")}`);
    }
  }
  if (/\b(?:desse|deste|nesse|neste|esse|este) mes\b|\bmes atual\b/.test(text))
    return { kind: "month", month: today.slice(0, 7), evidence: message };
  if (/\bmes passado\b/.test(text)) {
    const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return {
      kind: "month",
      month: date.toISOString().slice(0, 7),
      evidence: message,
    };
  }
  const monthYear = text.match(
    /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(\d{4})\b/,
  );
  if (monthYear)
    return {
      kind: "month",
      month: `${monthYear[2]}-${String(months.indexOf(monthYear[1]) + 1).padStart(2, "0")}`,
      evidence: message,
    };
  const numericMonth = text.match(/\b(0?[1-9]|1[0-2])\/(\d{4})\b/);
  if (numericMonth)
    return {
      kind: "month",
      month: `${numericMonth[2]}-${numericMonth[1].padStart(2, "0")}`,
      evidence: message,
    };
  return { kind: "unrecognized" };
}
