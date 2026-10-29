import type { ChartConfig } from "./domain";
export function chartPresentation(
  config: Pick<ChartConfig, "type" | "groupBy">,
  data: { label: string; value: number }[],
) {
  const temporal = ["day", "week", "month"].includes(config.groupBy);
  const ranking = config.type === "bar" && !temporal;
  const sorted =
    ranking || config.type === "pie"
      ? [...data].sort((a, b) => b.value - a.value)
      : data;
  const limit = config.type === "pie" ? 5 : 12;
  const visible =
    (ranking || config.type === "pie") && sorted.length > limit
      ? [
          ...sorted.slice(0, limit),
          {
            label: `Outros (${sorted.length - limit})`,
            value: sorted
              .slice(limit)
              .reduce((sum, item) => sum + item.value, 0),
          },
        ]
      : sorted;
  return { temporal, ranking, sorted, visible, limit };
}
