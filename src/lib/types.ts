export type Creator = { id: string; name: string; slug: string };
export type Analytics = {
  period: { from: string; to: string };
  currency: string;
  summary: {
    revenue: number | null;
    orders: number | null;
    averageTicket: number | null;
    followerDelta: number | null;
    followerPercent: number | null;
    views: number | null;
  };
  sources: string[];
  warnings: string[];
  creators: Creator[];
  sales: {
    id: string;
    creatorId: string;
    source: string;
    externalId: string;
    date: string;
    amount: number;
    currency: string;
    product: string | null;
    campaign: string | null;
    status: string;
  }[];
  metrics: {
    creatorId: string;
    metric: string;
    kind: string;
    value: number;
    startDate: string;
    endDate: string;
    entity: string;
    source: string;
  }[];
};
export type ImportChange = {
  id: string;
  row: number;
  type: string;
  classification: string;
  payload: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  reason: string | null;
  status: string;
};
export type ImportBatch = {
  id: string;
  creatorId: string;
  filename: string;
  status: string;
  changes: ImportChange[];
  interpretation?: string;
};
export type ImportHistory = {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
  creatorId: string;
};
