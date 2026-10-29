export type ReportProfile = {
  handle: string;
  username: string;
  validated: boolean;
  orders: number;
  paid: number;
  pendingOrders: number;
  followersIG: number | null;
  followersTikTok: number | null;
  engagementPercent: number | null;
};
export type WorkbookReportView = {
  jobId: string;
  hash: string;
  filename: string;
  source: string;
  status: "ready" | "applied";
  profiles: ReportProfile[];
  orders: number;
  paid: number;
  pendingOrders: number;
  pendingPaid: number;
  period: { from: string; to: string };
  currency: "BRL";
  warnings: string[];
  applied?: {
    createdCreators: number;
    reusedCreators: number;
    insertedSales: number;
    duplicateSales: number;
    importIds: string[];
  };
};
