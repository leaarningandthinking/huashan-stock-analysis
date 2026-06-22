import { apiGet, apiPost } from "@/lib/api";

export interface StockInfo {
  code: string;
  name: string;
  exchange: "sh" | "sz" | "bj" | "hk" | "us";
}

export interface ManualHolding {
  code: string;
  shares?: number | null;
  cost?: number | null;
  value?: number | null;
  weight?: number | null;
}

export type PortfolioMode = "single" | "batch" | "portfolio";

export interface ParseRequest {
  mode: PortfolioMode;
  manual?: ManualHolding[];
  text?: string;
  codes?: string[];
  /** 截图来源（仅 text 路径用）：auto 自动判别 / ths 同花顺 / generic 通用 */
  source?: "auto" | "ths" | "generic";
}

export interface HoldingItem {
  code: string;
  name: string;
  exchange: string;
  shares: number | null;
  cost: number | null;
  value: number | null;
  weight: number | null;
  pnl: number | null;
  valid: boolean;
  warning: string | null;
}

export interface PortfolioOverview {
  total_count: number;
  total_value: number | null;
  concentration_top3: number | null;
  overall_pnl: number | null;
}

export interface ParseResponse {
  portfolio_id: string;
  mode: PortfolioMode;
  holdings: HoldingItem[];
  overview: PortfolioOverview;
  warnings: string[];
}

export interface RecentPortfolio {
  portfolio_id: string;
  created_at: string;
  holdings: HoldingItem[];
  overview: PortfolioOverview;
}

export function searchStocks(q: string, limit = 10): Promise<StockInfo[]> {
  return apiGet<StockInfo[]>(
    `/api/stock/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
}

export function parsePortfolio(req: ParseRequest): Promise<ParseResponse> {
  return apiPost<ParseResponse>("/api/portfolio/parse", req);
}

export function listRecentPortfolios(limit = 3): Promise<RecentPortfolio[]> {
  return apiGet<RecentPortfolio[]>(`/api/portfolio/recent?limit=${limit}`);
}
