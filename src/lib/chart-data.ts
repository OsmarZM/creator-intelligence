import { groupDate, moneyToCents, type ChartConfig } from "./domain";
import type { Analytics } from "./types";
export function getChartData(data: Analytics, config: ChartConfig) {
  const names = new Map(data.creators.map((c) => [c.id, c.name]));
  const buckets = new Map<string, number[]>();
  const add = (key: string, value: number) =>
    buckets.set(key, [...(buckets.get(key) ?? []), value]);
  if (["revenue", "orders"].includes(config.metric)) {
    for (const s of data.sales.filter((s) => s.status === "valid")) {
      const key =
        config.groupBy === "creator"
          ? names.get(s.creatorId)!
          : config.groupBy === "product"
            ? (s.product ?? "Sem produto")
            : config.groupBy === "campaign"
              ? (s.campaign ?? "Sem campanha")
              : groupDate(s.date, config.groupBy);
      add(key, config.metric === "orders" ? 1 : moneyToCents(s.amount));
    }
  } else {
    const latest = new Map<string, (typeof data.metrics)[number]>();
    for (const m of data.metrics.filter(
      (m) => m.metric === config.metric && m.kind === "snapshot",
    )) {
      const key =
        config.groupBy === "creator"
          ? names.get(m.creatorId)!
          : config.groupBy === "entity"
            ? m.entity
            : groupDate(m.endDate, config.groupBy);
      latest.set(`${key}/${m.creatorId}/${m.entity}/${m.source}`, m);
    }
    for (const m of latest.values())
      add(
        config.groupBy === "creator"
          ? names.get(m.creatorId)!
          : config.groupBy === "entity"
            ? m.entity
            : groupDate(m.endDate, config.groupBy),
        m.value,
      );
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, values]) => {
      const sum = values.reduce((a, b) => a + b, 0);
      const value =
        config.aggregation === "average"
          ? sum / values.length
          : config.aggregation === "max"
            ? Math.max(...values)
            : config.aggregation === "min"
              ? Math.min(...values)
              : config.aggregation === "count"
                ? values.length
                : sum;
      return {
        label,
        value: config.metric === "revenue" ? value / 100 : value,
      };
    });
}
