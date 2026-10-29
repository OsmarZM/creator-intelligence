import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartSchema,
  dateSchema,
  defaultCharts,
  followerChange,
  moneyToCents,
  recordSchema,
} from "../src/lib/domain";
import { getChartData } from "../src/lib/chart-data";
import type { Analytics } from "../src/lib/types";
test("datas impossíveis e períodos invertidos são rejeitados", () => {
  assert.equal(dateSchema.safeParse("2026-02-30").success, false);
  assert.equal(
    recordSchema.safeParse({
      type: "metric",
      metric: "views",
      kind: "interval",
      value: 10,
      startDate: "2026-10-02",
      endDate: "2026-10-01",
      entity: "video",
      source: "csv",
    }).success,
    false,
  );
});
test("seguidores acumulados não aceitam intervalo ou valores negativos", () => {
  const r = {
    type: "metric",
    metric: "followers",
    kind: "interval",
    value: 10,
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    entity: "instagram:gab",
    source: "csv",
  };
  assert.equal(recordSchema.safeParse(r).success, false);
  assert.equal(
    recordSchema.safeParse({ ...r, kind: "snapshot", value: -10 }).success,
    false,
  );
});
test("dinheiro exige moeda, ID e precisão de centavos", () => {
  const r = {
    type: "sale",
    source: "loja",
    externalId: "1",
    date: "2026-10-01",
    amount: 0.1,
    currency: "BRL",
  };
  assert.equal(moneyToCents(0.1) + moneyToCents(0.2), 30);
  assert.equal(recordSchema.safeParse({ ...r, amount: 1.999 }).success, false);
  assert.equal(
    recordSchema.safeParse({ ...r, currency: undefined }).success,
    false,
  );
  assert.equal(recordSchema.safeParse({ ...r, externalId: "" }).success, false);
});
test("crescimento exige histórico por entidade e preserva base zero", () => {
  assert.deepEqual(followerChange([]), { delta: null, percent: null });
  assert.deepEqual(
    followerChange([
      { entity: "a", source: "csv", date: "2026-10-01", value: 100 },
    ]),
    { delta: null, percent: null },
  );
  assert.deepEqual(
    followerChange([
      { entity: "a", source: "csv", date: "2026-10-01", value: 100 },
      { entity: "a", source: "csv", date: "2026-10-20", value: 80 },
    ]),
    { delta: -20, percent: -20 },
  );
  assert.deepEqual(
    followerChange([
      { entity: "a", source: "csv", date: "2026-10-01", value: 0 },
      { entity: "a", source: "csv", date: "2026-10-20", value: 80 },
    ]),
    { delta: 80, percent: null },
  );
});
test("builder bloqueia soma de snapshots e pizza temporal", () => {
  assert.equal(
    chartSchema.safeParse({
      ...defaultCharts[0],
      metric: "followers",
      aggregation: "sum",
    }).success,
    false,
  );
  assert.equal(
    chartSchema.safeParse({
      ...defaultCharts[0],
      type: "pie",
      groupBy: "month",
    }).success,
    false,
  );
  assert.equal(
    chartSchema.safeParse({
      ...defaultCharts[0],
      metric: "orders",
      aggregation: "average",
    }).success,
    false,
  );
});
test("gráfico usa a última medição de cada perfil em vez de somar snapshots", () => {
  const data = {
    creators: [{ id: "1", name: "Gab", slug: "gab" }],
    sales: [],
    metrics: [
      {
        creatorId: "1",
        metric: "followers",
        kind: "snapshot",
        value: 100,
        startDate: "2026-10-01",
        endDate: "2026-10-01",
        entity: "instagram:gab",
        source: "csv",
      },
      {
        creatorId: "1",
        metric: "followers",
        kind: "snapshot",
        value: 150,
        startDate: "2026-10-20",
        endDate: "2026-10-20",
        entity: "instagram:gab",
        source: "csv",
      },
    ],
  } as unknown as Analytics;
  assert.deepEqual(
    getChartData(data, {
      ...defaultCharts[0],
      metric: "followers",
      aggregation: "latest",
      groupBy: "creator",
    }),
    [{ label: "Gab", value: 150 }],
  );
});
