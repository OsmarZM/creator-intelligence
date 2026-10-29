import { z } from "zod";

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Data inválida; use AAAA-MM-DD",
  );
export const saleSchema = z
  .object({
    type: z.literal("sale"),
    externalId: z.string().trim().min(1).max(120),
    source: z.string().trim().min(1).max(120),
    date: dateSchema,
    amount: z.coerce
      .number()
      .finite()
      .min(0)
      .max(1_000_000_000)
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001,
        "Valor deve ter no máximo 2 casas decimais",
      ),
    currency: z.string().regex(/^[A-Z]{3}$/),
    product: z.string().max(200).optional(),
    campaign: z.string().max(200).optional(),
    coupon: z.string().max(120).optional(),
    status: z.enum(["valid", "cancelled", "refunded"]).default("valid"),
  })
  .strict();
export const metricSchema = z
  .object({
    type: z.literal("metric"),
    metric: z.enum([
      "followers",
      "follower_gain",
      "views",
      "likes",
      "comments",
      "shares",
      "saves",
      "reach",
    ]),
    kind: z.enum(["snapshot", "interval"]),
    value: z.coerce
      .number()
      .finite()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .int(),
    startDate: dateSchema,
    endDate: dateSchema,
    entity: z.string().trim().min(1).max(250),
    source: z.string().trim().min(1).max(120),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.startDate > v.endDate)
      ctx.addIssue({ code: "custom", message: "Período invertido" });
    if (v.kind === "snapshot" && v.startDate !== v.endDate)
      ctx.addIssue({
        code: "custom",
        message: "Snapshot precisa de uma única data",
      });
    if (v.metric === "followers" && v.kind !== "snapshot")
      ctx.addIssue({
        code: "custom",
        message: "Total de seguidores deve ser snapshot",
      });
    if (v.metric === "follower_gain" && v.kind !== "interval")
      ctx.addIssue({
        code: "custom",
        message: "Ganho de seguidores deve identificar um intervalo",
      });
    if (v.metric !== "follower_gain" && v.value < 0)
      ctx.addIssue({
        code: "custom",
        message: "Esta métrica não aceita valor negativo",
      });
  });
export const recordSchema = z.union([saleSchema, metricSchema]);
export type DataRecord = z.infer<typeof recordSchema>;
export const chartSchema = z
  .object({
    id: z.string().max(100),
    title: z.string().trim().min(1).max(120),
    type: z.enum(["bar", "line", "area", "pie"]),
    metric: z.enum(["revenue", "orders", "followers", "views"]),
    groupBy: z.enum([
      "day",
      "week",
      "month",
      "creator",
      "entity",
      "product",
      "campaign",
    ]),
    aggregation: z.enum(["sum", "average", "count", "max", "min", "latest"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    legend: z.boolean(),
    width: z.enum(["half", "full"]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === "pie" && ["day", "week", "month"].includes(v.groupBy))
      ctx.addIssue({
        code: "custom",
        message: "Pizza exige comparação por categoria",
      });
    if (["followers", "views"].includes(v.metric) && v.aggregation !== "latest")
      ctx.addIssue({
        code: "custom",
        message:
          "Snapshots usam a última medição por entidade, nunca soma de medições",
      });
    if (["revenue", "orders"].includes(v.metric) && v.aggregation === "latest")
      ctx.addIssue({ code: "custom", message: "Vendas não são snapshots" });
    if (v.metric === "orders" && v.aggregation !== "count")
      ctx.addIssue({ code: "custom", message: "Pedidos usam contagem" });
    if (
      ["followers", "views"].includes(v.metric) &&
      ["product", "campaign"].includes(v.groupBy)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Métricas sociais não têm vínculo comprovado com produto/campanha",
      });
    if (["revenue", "orders"].includes(v.metric) && v.groupBy === "entity")
      ctx.addIssue({
        code: "custom",
        message: "Vendas não têm vínculo comprovado com postagem/perfil",
      });
  });
export type ChartConfig = z.infer<typeof chartSchema>;
export const defaultCharts: ChartConfig[] = [
  {
    id: "revenue",
    title: "Evolução do valor importado",
    type: "area",
    metric: "revenue",
    groupBy: "day",
    aggregation: "sum",
    color: "#a78bfa",
    legend: false,
    width: "full",
  },
  {
    id: "creators",
    title: "Valor pago por creator",
    type: "bar",
    metric: "revenue",
    groupBy: "creator",
    aggregation: "sum",
    color: "#a78bfa",
    legend: false,
    width: "half",
  },
  { id: "orders-creators", title: "Pedidos por creator", type: "bar", metric: "orders", groupBy: "creator", aggregation: "count", color: "#c4a1ff", legend: false, width: "half" },
  { id: "share", title: "Participação no valor importado", type: "pie", metric: "revenue", groupBy: "creator", aggregation: "sum", color: "#a78bfa", legend: true, width: "full" },
];
export function moneyToCents(value: number | string) {
  return Math.round(Number(value) * 100);
}
export function followerChange(
  records: { entity: string; source: string; date: string; value: number }[],
) {
  const groups = new Map<string, typeof records>();
  for (const r of records) {
    const key = `${r.entity}|${r.source}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  let initial = 0,
    final = 0;
  if (!groups.size) return { delta: null, percent: null };
  for (const group of groups.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(group.map((r) => r.date)).size < 2)
      return { delta: null, percent: null };
    initial += group[0].value;
    final += group.at(-1)!.value;
  }
  return {
    delta: final - initial,
    percent: initial === 0 ? null : ((final - initial) / initial) * 100,
  };
}
export function groupDate(date: string, group: string) {
  if (group === "month") return date.slice(0, 7);
  if (group === "week") {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return date;
}
