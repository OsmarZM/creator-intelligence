import { dateSchema, followerChange, moneyToCents } from "@/lib/domain";
import { db } from "./db";
export type Filters = {
  creatorId?: string;
  from: string;
  to: string;
  currency: string;
};
export function filters(params: URLSearchParams): Filters {
  const from = dateSchema.parse(params.get("from")),
    to = dateSchema.parse(params.get("to"));
  if (from > to) throw new Error("Período invertido.");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 1096)
    throw new Error("Consulte no máximo três anos por vez.");
  const currency = params.get("currency") || "BRL";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Moeda inválida.");
  return {
    creatorId: params.get("creatorId") || undefined,
    from,
    to,
    currency,
  };
}
export async function getAnalytics(f: Filters) {
  const [sales, metrics, creators] = await Promise.all([
    db().sale.findMany({
      where: {
        creatorId: f.creatorId,
        date: { gte: new Date(f.from), lte: new Date(f.to) },
        currency: f.currency,
      },
      orderBy: { date: "asc" },
    }),
    db().metricRecord.findMany({
      where: {
        creatorId: f.creatorId,
        startDate: { gte: new Date(f.from) },
        endDate: { lte: new Date(f.to) },
      },
      orderBy: { endDate: "asc" },
    }),
    db().creator.findMany({ orderBy: { name: "asc" } }),
  ]);
  const valid = sales.filter((s) => s.status === "valid");
  const cents = valid.reduce(
    (sum, s) => sum + moneyToCents(String(s.amount)),
    0,
  );
  if (!Number.isSafeInteger(cents))
    throw new Error("Total excede a precisão monetária suportada.");
  const followers = metrics.filter(
    (m) => m.metric === "followers" && m.kind === "snapshot",
  );
  const growth = followerChange(
    followers.map((m) => ({
      entity: `${m.creatorId}/${m.entity}`,
      source: m.source,
      date: m.endDate.toISOString().slice(0, 10),
      value: Number(m.value),
    })),
  );
  const latest = new Map<string, (typeof metrics)[number]>();
  for (const m of metrics.filter((m) => m.kind === "snapshot"))
    latest.set(`${m.creatorId}/${m.metric}/${m.entity}/${m.source}`, m);
  const views = [...latest.values()].filter((m) => m.metric === "views");
  return {
    period: { from: f.from, to: f.to },
    currency: f.currency,
    summary: {
      revenue: sales.length ? cents / 100 : null,
      orders: sales.length ? valid.length : null,
      averageTicket: valid.length ? cents / 100 / valid.length : null,
      followerDelta: growth.delta,
      followerPercent: growth.percent,
      views: views.length
        ? views.reduce((n, m) => n + Number(m.value), 0)
        : null,
    },
    sources: [
      ...new Set([
        ...sales.map((s) => s.source),
        ...metrics.map((m) => m.source),
      ]),
    ],
    warnings: [
      "Ausência de registros não significa zero.",
      "Vendas canceladas e estornadas excluídas da receita válida.",
      "Seguidores: última menos primeira medição disponível dentro do período, por perfil e origem; exige duas datas por série.",
      "Visualizações: última medição disponível por entidade/origem no período; fontes diferentes não são deduplicadas automaticamente.",
      "Métricas de intervalo entram apenas quando integralmente contidas no filtro.",
    ],
    creators,
    sales: sales.map((s) => ({
      ...s,
      amount: Number(s.amount),
      date: s.date.toISOString().slice(0, 10),
    })),
    metrics: metrics.map((m) => ({
      ...m,
      value: Number(m.value),
      startDate: m.startDate.toISOString().slice(0, 10),
      endDate: m.endDate.toISOString().slice(0, 10),
    })),
  };
}
export { getChartData as chartData } from "@/lib/chart-data";
