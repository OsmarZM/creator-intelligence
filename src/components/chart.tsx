"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartConfig } from "@/lib/domain";
import { useTheme } from "@/lib/theme";
import { chartPresentation } from "@/lib/chart-presentation";
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  CanvasRenderer,
]);
type Datum = { label: string; value: number };
export default function Chart({
  config,
  data,
  currency,
}: {
  config: ChartConfig;
  data: Datum[];
  currency: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<ReturnType<typeof echarts.init> | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const theme = useTheme();
  const { temporal, ranking, sorted, visible, limit } = useMemo(
    () => chartPresentation(config, data),
    [config, data],
  );
  const height = ranking
    ? Math.max(320, Math.min(580, visible.length * 38 + 65))
    : 340;
  const format = useCallback(
    (value: number, compact = false) =>
      new Intl.NumberFormat(
        "pt-BR",
        config.metric === "revenue"
          ? {
              style: "currency",
              currency,
              ...(compact
                ? { notation: "compact" as const, maximumFractionDigits: 1 }
                : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            }
          : {
              ...(compact ? { notation: "compact" as const } : {}),
              maximumFractionDigits: 1,
            },
      ).format(value),
    [config.metric, currency],
  );
  useEffect(
    () => () => {
      observer.current?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!ref.current) return;
    if (!data.length) {
      instance.current?.clear();
      return;
    }
    if (!instance.current) {
      instance.current = echarts.init(ref.current);
      observer.current = new ResizeObserver(() => instance.current?.resize());
      observer.current.observe(ref.current);
    }
    const colors = getComputedStyle(document.documentElement);
    const muted = colors.getPropertyValue("--muted").trim(),
      text = colors.getPropertyValue("--text").trim(),
      border = colors.getPropertyValue("--border").trim();
    const total = data.reduce((sum, item) => sum + item.value, 0);
    const labelDate = (label: string, full = false) => {
      if (!temporal) return label;
      if (/^\d{4}-\d{2}$/.test(label))
        return new Intl.DateTimeFormat("pt-BR", {
          month: "short",
          year: "2-digit",
          timeZone: "UTC",
        }).format(new Date(label + "-01T12:00:00Z"));
      return /^\d{4}-\d{2}-\d{2}$/.test(label)
        ? label.slice(8, 10) +
            "/" +
            label.slice(5, 7) +
            (full ? "/" + label.slice(0, 4) : "")
        : label;
    };
    const category = {
      type: "category",
      data: visible.map((item) => item.label),
      ...(ranking ? { inverse: true } : {}),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        fontSize: 13,
        width: ranking ? 145 : 90,
        overflow: "truncate",
        hideOverlap: !ranking,
        formatter: (value: string) => labelDate(value),
      },
    };
    const value = {
      type: "value",
      min: 0,
      splitNumber: 3,
      axisLine: { show: false },
      splitLine: {
        lineStyle: { color: border, type: "dashed", opacity: 0.45 },
      },
      axisLabel: {
        color: muted,
        fontSize: 12,
        hideOverlap: true,
        formatter: (number: number) => format(number, true),
      },
    };
    instance.current.setOption(
      {
        animationDuration: 350,
        color: [
          config.color,
          "#c4a1ff",
          "#60a5fa",
          "#f7a35c",
          "#e89bce",
          "#a1a1b8",
        ],
        textStyle: {
          fontFamily: "Arial, Helvetica, sans-serif",
          color: text,
          fontSize: 13,
        },
        tooltip: {
          trigger: config.type === "pie" ? "item" : "axis",
          renderMode: "richText",
          backgroundColor: colors.getPropertyValue("--surface-raised").trim(),
          borderColor: border,
          textStyle: { color: text, fontSize: 14 },
          confine: true,
          formatter: (params: unknown) => {
            const items = (Array.isArray(params) ? params : [params]) as {
              name: string;
              value: number;
              percent?: number;
            }[];
            return items
              .map(
                (item) =>
                  `${labelDate(item.name, true)}\n${format(Number(item.value))}${item.percent === undefined ? "" : ` · ${item.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}`,
              )
              .join("\n");
          },
        },
        legend: {
          show: config.type === "pie" ? config.legend : false,
          bottom: 0,
          type: "scroll",
          textStyle: { color: muted, fontSize: 12 },
        },
        ...(config.type === "pie"
          ? {
              title: {
                text: format(total, true),
                subtext:
                  config.metric === "orders"
                    ? "pedidos importados"
                    : "total importado",
                left: "center",
                top: "39%",
                textStyle: { color: text, fontSize: 26, fontWeight: 500 },
                subtextStyle: { color: muted, fontSize: 12 },
              },
            }
          : {
              grid: {
                left: ranking ? 155 : 78,
                right: ranking ? 105 : 28,
                top: 25,
                bottom: temporal && data.length > 24 ? 72 : 48,
              },
              xAxis: ranking ? value : category,
              yAxis: ranking ? category : value,
              ...(temporal && data.length > 24
                ? {
                    dataZoom: [
                      { type: "inside", filterMode: "none" },
                      {
                        type: "slider",
                        height: 15,
                        bottom: 9,
                        borderColor: border,
                        textStyle: { color: muted },
                        fillerColor: "rgba(167,139,250,.18)",
                        handleStyle: { color: config.color },
                      },
                    ],
                  }
                : {}),
            }),
        series: [
          config.type === "pie"
            ? {
                name: config.title,
                type: "pie",
                radius: ["44%", "66%"],
                center: ["50%", "46%"],
                avoidLabelOverlap: true,
                itemStyle: {
                  borderRadius: 7,
                  borderWidth: 3,
                  borderColor: colors.getPropertyValue("--surface").trim(),
                },
                label: {
                  color: text,
                  fontSize: 12,
                  formatter: (item: { name: string; percent: number }) =>
                    `${item.name.length > 21 ? item.name.slice(0, 20) + "…" : item.name}\n${item.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
                },
                labelLayout: { hideOverlap: true },
                data: visible.map((item) => ({
                  name: item.label,
                  value: item.value,
                })),
              }
            : {
                name: config.title,
                type: config.type === "area" ? "line" : config.type,
                data: visible.map((item) => item.value),
                smooth: false,
                showSymbol: data.length < 35,
                symbolSize: 7,
                lineStyle: { width: 3 },
                ...(config.type === "area"
                  ? { areaStyle: { opacity: 0.15 } }
                  : {}),
                barMaxWidth: 25,
                itemStyle: {
                  borderRadius: ranking ? [0, 7, 7, 0] : [7, 7, 0, 0],
                },
                label: {
                  show: ranking,
                  position: "right",
                  color: text,
                  fontSize: 12,
                  formatter: (item: { value: number }) =>
                    format(item.value, true),
                },
                emphasis: { focus: "series" },
              },
        ],
      },
      true,
    );
    const frame = requestAnimationFrame(() => instance.current?.resize());
    return () => cancelAnimationFrame(frame);
  }, [config, data, theme, temporal, ranking, visible, format]);
  return (
    <div className="chart-content">
      <div
        ref={ref}
        className="chart-canvas"
        style={{ height, display: data.length ? "block" : "none" }}
        role="img"
        aria-label={`${config.title}. ${data.length} categorias. Os valores completos estão na tabela de dados abaixo.`}
      />
      {!data.length ? (
        <div className="chart-empty">
          <span className="empty-bars">▂ ▅ ▃ ▇ ▄</span>
          <p>Ainda sem dados neste período</p>
          <small>Confirme uma importação ou ajuste o período.</small>
        </div>
      ) : (
        <>
          {(ranking || config.type === "pie") && data.length > limit && (
            <p className="chart-note">
              {limit} maiores categorias e demais agrupadas em “Outros”.
            </p>
          )}
          <details className="chart-data-table">
            <summary>Ver valores completos · {data.length} categorias</summary>
            <div className="chat-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{temporal ? "Período" : "Categoria"}</th>
                    <th scope="col">
                      {config.metric === "revenue"
                        ? `Valor pago (${currency})`
                        : "Quantidade"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td>{format(item.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
