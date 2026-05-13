"use client";

import { Copy, Download, Share2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { createShareLink } from "@/lib/diagnosis-api";
import { cn } from "@/lib/cn";

type AnalystResult = {
  label?: string;
  text?: string;
  failed?: boolean;
  error?: string;
};

type DebateTurn = {
  round: number;
  master: string;
  name?: string;
  text: string;
};

type RiskReport =
  | string
  | {
      label?: string;
      text?: string;
      failed?: boolean;
      error?: string;
    };

type InvestmentManagerReport =
  | string
  | {
      label?: string;
      text?: string;
      failed?: boolean;
      error?: string;
    };

interface ReportShape {
  status?: string;
  report_summary?: InvestmentManagerReport;
  analysts?: Record<string, AnalystResult>;
  report_card?: string;
  debate?: { transcript?: DebateTurn[] };
  risk?: Record<string, RiskReport>;
  investment_manager?: InvestmentManagerReport;
  masters_selected?: string[];
}

interface Props {
  diagnosisId: string;
  report: ReportShape;
  readonly?: boolean;
  reportTitle?: string;
}

const ANALYST_ORDER = ["fundamental", "sentiment", "news", "technical"];
const RISK_LABEL: Record<string, string> = {
  aggressive: "激进派",
  conservative: "保守派",
};
const TABS = [
  { id: "summary", label: "报告摘要" },
  { id: "analysts", label: "分析师报告" },
  { id: "roundtable", label: "大师圆桌观点" },
  { id: "risk", label: "风控审核" },
  { id: "manager", label: "投资经理决策" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function renderText(value: unknown, fallback = "暂无内容"): string {
  if (typeof value === "string") return value || fallback;
  if (value && typeof value === "object") {
    const obj = value as { text?: unknown; error?: unknown; failed?: unknown };
    if (typeof obj.text === "string" && obj.text) return obj.text;
    if (obj.failed && typeof obj.error === "string" && obj.error) return obj.error;
    return JSON.stringify(value, null, 2);
  }
  return fallback;
}

function excerpt(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "暂无内容";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function buildSummary(report: ReportShape): { label: string; text: string }[] {
  const analystTexts = ANALYST_ORDER.map((role) => {
    const item = report.analysts?.[role];
    return `${item?.label ?? role}：${item?.failed ? item.error ?? "该分析师失败" : item?.text || ""}`;
  }).filter(Boolean);
  const turns = report.debate?.transcript ?? [];
  const risk = report.risk ?? {};
  return [
    { label: "分析师报告", text: excerpt(analystTexts.join(" ")) },
    {
      label: "大师圆桌观点",
      text: excerpt(turns.map((turn) => `${turn.name ?? turn.master}：${turn.text}`).join(" ")),
    },
    {
      label: "风控审核",
      text: excerpt(Object.keys(RISK_LABEL).map((key) => renderText(risk[key], "")).join(" ")),
    },
    { label: "投资经理决策", text: excerpt(renderText(report.investment_manager)) },
  ];
}

function buildMarkdown(diagnosisId: string, report: ReportShape, reportTitle: string) {
  const lines: string[] = [
    `# ${reportTitle}`,
    "",
    `- 会话 ID：${diagnosisId}`,
    `- 导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
  ];

  lines.push("## 报告摘要", "");
  const formalSummary = renderText(report.report_summary, "");
  if (formalSummary) {
    lines.push(formalSummary, "");
  } else {
    for (const item of buildSummary(report)) {
      lines.push(`### ${item.label}`, "", item.text, "");
    }
  }

  lines.push("## 分析师报告", "");
  for (const role of ANALYST_ORDER) {
    const item = report.analysts?.[role];
    lines.push(`### ${item?.label ?? role}`, "");
    lines.push(item?.failed ? item.error ?? "该分析师失败" : item?.text || "暂无内容", "");
  }

  lines.push("## 大师圆桌观点", "");
  const turns = report.debate?.transcript ?? [];
  if (turns.length === 0) {
    lines.push("未生成大师圆桌观点。", "");
  } else {
    for (const turn of turns) {
      lines.push(`### ${turn.name ?? turn.master} · 第 ${turn.round} 轮`, "");
      lines.push(turn.text, "");
    }
  }

  lines.push("## 风控审核", "");
  const risk = report.risk ?? {};
  for (const [key, label] of Object.entries(RISK_LABEL)) {
    lines.push(`### ${label}`, "");
    lines.push(renderText(risk[key]), "");
  }

  lines.push("## 投资经理决策", "");
  lines.push(renderText(report.investment_manager), "");

  return lines.join("\n");
}

export function DiagnosisReportView({
  diagnosisId,
  report,
  readonly = false,
  reportTitle = "华山论股·股票报告",
}: Props) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const analysts = report.analysts ?? {};
  const turns = report.debate?.transcript ?? [];
  const risk = report.risk ?? {};
  const summary = useMemo(() => buildSummary(report), [report]);
  const formalSummary = renderText(report.report_summary, "");

  async function handleShare() {
    setSharing(true);
    try {
      const res = await createShareLink(diagnosisId);
      const absolute = `${window.location.origin}${res.url}`;
      setShareUrl(absolute);
      await navigator.clipboard?.writeText(absolute);
    } finally {
      setSharing(false);
    }
  }

  function downloadMarkdown() {
    const markdown = buildMarkdown(diagnosisId, report, reportTitle);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `huashan-report-${diagnosisId.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloadOpen(false);
  }

  function downloadPdf() {
    const markdown = buildMarkdown(diagnosisId, report, reportTitle);
    const html = markdownToPrintHtml(markdown, reportTitle);
    const win = window.open("", "_blank");
    if (!win) {
      window.alert("浏览器拦截了打印窗口，请允许弹窗后重试。");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
    setDownloadOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white/60 p-4">
        <div>
          <p className="text-sm font-semibold text-ink-800">完整报告已生成</p>
          <p className="mt-1 text-xs text-ink-500">
            会话 ID：<span className="font-mono">{diagnosisId}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDownloadOpen(true)} variant="outline">
            <Download className="h-4 w-4" />
            下载报告
          </Button>
          {!readonly && (
            <Button onClick={handleShare} disabled={sharing} variant="outline">
              <Share2 className="h-4 w-4" />
              {sharing ? "生成中..." : "生成分享链接"}
            </Button>
          )}
        </div>
        {shareUrl && (
          <div className="flex w-full items-center gap-2 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            <Copy className="h-3.5 w-3.5" />
            <span className="truncate">{shareUrl}</span>
          </div>
        )}
      </div>

      {downloadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 px-4">
          <div className="w-full max-w-sm rounded-lg border border-ink-200 bg-[#fffdf8] p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-900">选择下载格式</h2>
              <button
                type="button"
                onClick={() => setDownloadOpen(false)}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3">
              <Button onClick={downloadPdf}>
                <Download className="h-4 w-4" />
                PDF 格式
              </Button>
              <Button onClick={downloadMarkdown} variant="outline">
                <Download className="h-4 w-4" />
                Markdown 格式
              </Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-500">
              PDF 会打开浏览器打印窗口，选择“保存为 PDF”即可。
            </p>
          </div>
        </div>
      )}

      <nav className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-ink-200 bg-paper/95 py-2 backdrop-blur">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition",
              activeTab === tab.id
                ? "border-scarlet-600 text-scarlet-700"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "summary" && (
        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink-800">报告摘要</h2>
          {formalSummary ? (
            <article className="rounded-lg border border-ink-200 bg-white/70 p-4">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
                {formalSummary}
              </pre>
            </article>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {summary.map((item) => (
                <article key={item.label} className="rounded-lg border border-ink-200 bg-white/70 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-ink-800">{item.label}</h3>
                  <p className="text-sm leading-relaxed text-ink-700">{item.text}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "analysts" && (
        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink-800">分析师报告</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {ANALYST_ORDER.map((role) => {
              const item = analysts[role];
              return (
                <article key={role} className="rounded-lg border border-ink-200 bg-white/70 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-ink-800">
                    {item?.label ?? role}
                  </h3>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
                    {item?.failed ? item.error ?? "该分析师失败" : item?.text || "暂无内容"}
                  </pre>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "roundtable" && (
        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink-800">大师圆桌观点</h2>
          <div className="space-y-4">
            {turns.length > 0 ? (
              turns.map((turn, idx) => (
                <article
                  key={`${turn.master}-${turn.round}-${idx}`}
                  className="rounded-lg border border-ink-200 bg-white/70 p-4"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <span className="font-semibold text-ink-800">{turn.name ?? turn.master}</span>
                    <span className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-500">
                      第 {turn.round} 轮
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
                    {turn.text}
                  </pre>
                </article>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-ink-300 bg-white/40 p-6 text-sm text-ink-500">
                未生成大师圆桌观点。
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "risk" && (
        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink-800">风控审核</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {Object.entries(RISK_LABEL).map(([key, label]) => (
              <article key={key} className="rounded-lg border border-ink-200 bg-white/70 p-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-800">{label}</h3>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
                  {renderText(risk[key])}
                </pre>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeTab === "manager" && (
        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink-800">投资经理决策</h2>
          <article className="rounded-lg border border-ink-200 bg-white/70 p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
              {renderText(report.investment_manager)}
            </pre>
          </article>
        </section>
      )}
    </div>
  );
}

function markdownToPrintHtml(markdown: string, title: string): string {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = escaped
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br />");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Noto Serif SC", serif; color: #241d13; line-height: 1.75; padding: 40px; }
    h1 { font-size: 28px; margin: 0 0 24px; }
    h2 { font-size: 20px; margin: 28px 0 12px; border-bottom: 1px solid #d6cdbc; padding-bottom: 6px; }
    h3 { font-size: 16px; margin: 18px 0 8px; }
    p { margin: 0 0 12px; white-space: normal; }
    li { margin-left: 20px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body><p>${body}</p></body>
</html>`;
}
