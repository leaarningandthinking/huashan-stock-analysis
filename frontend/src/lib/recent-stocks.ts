import type { DiagnosisTaskSummary } from "@/lib/diagnosis-api";
import type { StockInfo } from "@/lib/portfolio-api";

export interface RecentStock extends StockInfo {
  diagnosis_id: string;
  status: DiagnosisTaskSummary["status"];
  mode: DiagnosisTaskSummary["mode"];
  created_at: string;
  href: string;
}

function exchangeFromCode(code: string): StockInfo["exchange"] {
  if (code.endsWith(".HK")) return "hk";
  if (/^[A-Z]/i.test(code)) return "us";
  if (code.startsWith("6")) return "sh";
  if (code.startsWith("8") || code.startsWith("4")) return "bj";
  return "sz";
}

export function buildRecentStocks(tasks: DiagnosisTaskSummary[], limit = 8): RecentStock[] {
  const seen = new Set<string>();
  const sorted = [...tasks].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const result: RecentStock[] = [];

  for (const task of sorted) {
    for (const stock of task.stocks) {
      if (!stock.code || seen.has(stock.code)) continue;
      seen.add(stock.code);
      result.push({
        code: stock.code,
        name: stock.name || stock.code,
        exchange: exchangeFromCode(stock.code),
        diagnosis_id: task.diagnosis_id,
        status: task.status,
        mode: task.mode,
        created_at: task.created_at,
        href:
          task.status === "done"
            ? `/debate/${task.diagnosis_id}/report`
            : `/debate/${task.diagnosis_id}`,
      });
      if (result.length >= limit) return result;
    }
  }

  return result;
}
