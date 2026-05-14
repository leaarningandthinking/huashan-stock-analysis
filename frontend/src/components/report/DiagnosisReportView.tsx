"use client";

import {
  BarChart3,
  BookOpenText,
  BrainCircuit,
  Copy,
  Download,
  MessageSquareText,
  ShieldCheck,
  Share2,
  Target,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

type ResearchManagerReport = InvestmentManagerReport;

export interface ReportShape {
  status?: string;
  report_summary?: InvestmentManagerReport;
  analysts?: Record<string, AnalystResult>;
  report_card?: string;
  research_manager?: ResearchManagerReport;
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
  { id: "research", label: "投研经理分析" },
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
    { label: "投研经理分析", text: excerpt(renderText(report.research_manager)) },
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

export function buildMarkdown(diagnosisId: string, report: ReportShape, reportTitle: string) {
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

  lines.push("## 投研经理分析", "");
  lines.push(renderText(report.research_manager), "");

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToArticleHtml(text: string): string {
  return text
    .split(/\n/)
    .map((raw) => {
      const line = escapeHtml(raw.trimEnd()).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      if (!line.trim()) return "";
      if (line.startsWith("### ")) return `<h5>${line.slice(4)}</h5>`;
      if (line.startsWith("## ")) return `<h4>${line.slice(3)}</h4>`;
      if (line.startsWith("# ")) return `<h3>${line.slice(2)}</h3>`;
      if (/^【[^】]+】$/.test(line.trim())) return `<p class="label-heading">${line}</p>`;
      if (/^[-*]\s+/.test(line)) return `<p class="bullet"><span></span>${line.replace(/^[-*]\s+/, "")}</p>`;
      const numbered = line.match(/^(\d+)[.、]\s*(.*)$/);
      if (numbered) {
        return `<p class="numbered"><span class="number-badge">${numbered[1]}</span><span class="numbered-content">${numbered[2]}</span></p>`;
      }
      return `<p>${line}</p>`;
    })
    .join("\n");
}

export function buildPrintHtml(diagnosisId: string, report: ReportShape, title: string): string {
  const sections = [
    ["summary", "报告摘要", renderText(report.report_summary)],
    [
      "analysts",
      "分析师报告",
      ANALYST_ORDER.map((role) => {
        const item = report.analysts?.[role];
        return `### ${item?.label ?? role}\n${item?.failed ? item.error ?? "该分析师失败" : item?.text || "暂无内容"}`;
      }).join("\n\n"),
    ],
    ["research", "投研经理分析", renderText(report.research_manager)],
    [
      "roundtable",
      "大师圆桌观点",
      (report.debate?.transcript ?? [])
        .map((turn) => `### ${turn.name ?? turn.master} · 第 ${turn.round} 轮\n${turn.text}`)
        .join("\n\n") || "未生成大师圆桌观点。",
    ],
    [
      "risk",
      "风控审核",
      Object.entries(RISK_LABEL)
        .map(([key, label]) => `### ${label}\n${renderText(report.risk?.[key])}`)
        .join("\n\n"),
    ],
    ["manager", "投资经理决策", renderText(report.investment_manager)],
  ] as const;

  const toc = sections
    .map(([id, label], idx) => `<a href="#${id}"><span class="toc-index">${String(idx + 1).padStart(2, "0")}</span><span>${label}</span></a>`)
    .join("");
  const body = sections
    .map(
      ([id, label, text], idx) => `
        <section id="${id}" class="section">
          <header class="section-header">
            <div class="section-index">${String(idx + 1).padStart(2, "0")}</div>
            <div>
              <div class="section-kicker">REPORT SECTION</div>
              <h2>${label}</h2>
            </div>
          </header>
          <div class="article">${markdownToArticleHtml(text)}</div>
        </section>
      `,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4;
      margin: 16mm 15mm 17mm;
      @bottom-right {
        content: counter(page);
        color: #8d8374;
        font-size: 9px;
      }
    }
    * { box-sizing: border-box; }
    html {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      margin: 0;
      background: #ffffff;
      color: #211d18;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      line-height: 1.68;
      font-size: 11.5px;
    }
    .cover {
      padding: 24px 28px 22px;
      background: #2f251c;
      color: white;
      border-radius: 12px;
      margin-bottom: 14px;
      min-height: 118px;
    }
    .cover .eyebrow {
      color: #eadfd0;
      font-size: 9.5px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    h1 {
      margin: 10px 0 14px;
      font-size: 23px;
      line-height: 1.28;
      font-weight: 760;
      letter-spacing: 0;
    }
    .meta {
      display: inline-block;
      color: #f3eee7;
      font-size: 10px;
      line-height: 1.8;
      border-top: 1px solid rgba(255,255,255,.22);
      padding-top: 10px;
    }
    .toc {
      margin: 0 0 16px;
      padding: 12px 14px;
      border: 1px solid #e5ded3;
      border-radius: 10px;
      background: #fbfaf7;
      page-break-after: always;
    }
    .toc::before {
      content: "目录";
      display: block;
      margin: 0 0 8px;
      color: #211d18;
      font-size: 16px;
      font-weight: 760;
    }
    .toc a {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #eee8df;
      color: #332d25;
      text-decoration: none;
      font-weight: 680;
      font-size: 11px;
    }
    .toc a:last-child { border-bottom: 0; }
    .toc-index {
      display: inline-flex;
      width: 24px;
      color: #a83232;
      font-variant-numeric: tabular-nums;
    }
    .section {
      margin: 0 0 12px;
      padding: 0;
      background: #ffffff;
      break-inside: auto;
      page-break-inside: auto;
    }
    .section + .section {
      border-top: 1px solid #e5ded3;
      padding-top: 12px;
    }
    .section-header {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      margin: 0 0 8px;
      break-after: avoid;
      page-break-after: avoid;
    }
    .section-index {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: #a83232;
      color: white;
      display: grid;
      place-items: center;
      font-size: 10px;
      font-weight: 760;
    }
    .section-kicker {
      color: #9f8d76;
      font-size: 8.5px;
      font-weight: 760;
      letter-spacing: .1em;
    }
    h2 {
      margin: 1px 0 0;
      font-size: 17px;
      line-height: 1.35;
      color: #211d18;
      font-weight: 760;
      letter-spacing: 0;
    }
    .article {
      padding-left: 44px;
    }
    .article h3 {
      margin: 9px 0 6px;
      padding: 5px 0 5px 9px;
      border-left: 2px solid #a83232;
      background: transparent;
      color: #2e2922;
      font-size: 12px;
      line-height: 1.45;
      font-weight: 720;
      break-after: avoid;
      page-break-after: avoid;
    }
    .article h4 {
      margin: 10px 0 5px;
      color: #7d2c2c;
      font-size: 11.5px;
      line-height: 1.45;
      font-weight: 720;
      break-after: avoid;
      page-break-after: avoid;
    }
    .article h5 {
      margin: 9px 0 5px;
      color: #3b3329;
      font-size: 11px;
      line-height: 1.45;
      font-weight: 720;
      break-after: avoid;
      page-break-after: avoid;
    }
    p {
      margin: 0 0 6px;
      color: #332d25;
      font-size: 10.5px;
      line-height: 1.68;
      orphans: 2;
      widows: 2;
    }
    .label-heading {
      margin: 8px 0 5px;
      color: #7d2c2c;
      font-size: 10.6px;
      font-weight: 760;
    }
    strong { color: #0f0c08; font-weight: 750; }
    .bullet, .numbered {
      position: relative;
      margin: 0 0 5px;
      padding: 0 0 0 14px;
      background: transparent;
      border: 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .bullet span {
      position: absolute;
      left: 0;
      top: .72em;
      width: 4px;
      height: 4px;
      border-radius: 999px;
      background: #a83232;
    }
    .numbered {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 6px;
      padding-left: 0;
      color: #2a2520;
    }
    .number-badge {
      display: inline-grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: #f2eee8;
      color: #7d2c2c;
      font-size: 8.5px;
      font-weight: 760;
      line-height: 1;
    }
    .numbered-content {
      display: block;
      min-width: 0;
    }
    @media print {
      body { background: white; }
      .cover, .toc { border-radius: 0; }
    }
  </style>
</head>
<body>
  <main>
    <section class="cover">
      <div class="eyebrow">Huashan Equity Research</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">会话 ID：${escapeHtml(diagnosisId)} · 导出时间：${escapeHtml(new Date().toLocaleString("zh-CN"))}</div>
    </section>
    <nav class="toc">${toc}</nav>
    ${body}
  </main>
</body>
</html>`;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="font-semibold text-ink-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function RichText({ text }: { text: string }) {
  const lines = text.split(/\n/);
  return (
    <div className="space-y-3 text-sm leading-7 text-ink-700">
      {lines.map((raw, idx) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={idx} className="h-1" />;
        if (line.startsWith("### ")) {
          return (
            <h4 key={idx} className="pt-3 text-base font-semibold text-ink-900">
              {renderInline(line.slice(4))}
            </h4>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3 key={idx} className="pt-4 text-lg font-semibold text-ink-900">
              {renderInline(line.slice(3))}
            </h3>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={idx} className="pt-4 text-xl font-semibold text-ink-900">
              {renderInline(line.slice(2))}
            </h2>
          );
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <div key={idx} className="flex gap-3 rounded-md bg-ink-50/70 px-3 py-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-scarlet-600" />
              <p>{renderInline(line.replace(/^[-*]\s+/, ""))}</p>
            </div>
          );
        }
        if (/^\d+[.、]\s*/.test(line)) {
          return (
            <p key={idx} className="rounded-md border-l-2 border-ink-200 bg-white/50 px-3 py-2">
              {renderInline(line)}
            </p>
          );
        }
        return <p key={idx}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function ReportPanel({
  title,
  eyebrow,
  text,
  tone = "default",
}: {
  title: string;
  eyebrow?: string;
  text: string;
  tone?: "default" | "accent" | "risk" | "manager";
}) {
  const toneClass = {
    default: "border-ink-200",
    accent: "border-scarlet-200",
    risk: "border-amber-200",
    manager: "border-emerald-200",
  }[tone];
  return (
    <article className={cn("rounded-lg border bg-white/85 p-5 shadow-sm", toneClass)}>
      {eyebrow && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
          {eyebrow}
        </p>
      )}
      <h3 className="mb-4 text-lg font-semibold text-ink-900">{title}</h3>
      <RichText text={text} />
    </article>
  );
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
  const sectionRefs = useRef<Partial<Record<TabId, HTMLElement | null>>>({});
  const analysts = report.analysts ?? {};
  const turns = report.debate?.transcript ?? [];
  const risk = report.risk ?? {};
  const formalSummary = renderText(report.report_summary, "");
  const researchText = renderText(report.research_manager);
  const managerText = renderText(report.investment_manager);

  useEffect(() => {
    const sections = TABS.map((tab) => sectionRefs.current[tab.id]).filter(
      (section): section is HTMLElement => Boolean(section),
    );
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.getAttribute("data-section-id") as TabId | null;
        if (id) setActiveTab(id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0.1, 0.25, 0.5] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  function scrollToSection(id: TabId) {
    setActiveTab(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
    const html = buildPrintHtml(diagnosisId, report, reportTitle);
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
      <section className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
        <div className="border-b border-ink-100 bg-ink-900 px-5 py-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-200">
                Huashan Equity Research
              </p>
              <h1 className="text-2xl font-semibold">{reportTitle}</h1>
              <p className="mt-2 text-xs text-ink-200">
                会话 ID：<span className="font-mono">{diagnosisId}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDownloadOpen(true)} variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20">
                <Download className="h-4 w-4" />
                下载报告
              </Button>
              {!readonly && (
                <Button onClick={handleShare} disabled={sharing} variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20">
                  <Share2 className="h-4 w-4" />
                  {sharing ? "生成中..." : "分享链接"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {shareUrl && (
          <div className="m-5 flex items-center gap-2 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            <Copy className="h-3.5 w-3.5" />
            <span className="truncate">{shareUrl}</span>
          </div>
        )}
      </section>

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
              PDF 会打开浏览器打印窗口，选择“保存为 PDF”。建议在更多设置里关闭“页眉和页脚”，避免出现日期和 about:blank。
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <nav className="rounded-lg border border-ink-200 bg-white/80 p-2 shadow-sm">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => scrollToSection(tab.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold transition",
                  activeTab === tab.id
                    ? "bg-scarlet-600 text-white shadow-sm"
                    : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
                )}
              >
                <TabIcon id={tab.id} />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 space-y-8">
          <div
            ref={(el) => {
              sectionRefs.current.summary = el;
            }}
            data-section-id="summary"
            className="scroll-mt-6 space-y-5"
          >
            <ReportPanel
              title="报告摘要"
              eyebrow="Executive summary"
              text={formalSummary || "暂无正式摘要"}
              tone="accent"
            />
          </div>

          <div
            ref={(el) => {
              sectionRefs.current.analysts = el;
            }}
            data-section-id="analysts"
            className="scroll-mt-6 grid gap-4 xl:grid-cols-2"
          >
            {ANALYST_ORDER.map((role) => {
              const item = analysts[role];
              return (
                <ReportPanel
                  key={role}
                  title={item?.label ?? role}
                  eyebrow="Analyst memo"
                  text={item?.failed ? item.error ?? "该分析师失败" : item?.text || "暂无内容"}
                />
              );
            })}
          </div>

          <div
            ref={(el) => {
              sectionRefs.current.research = el;
            }}
            data-section-id="research"
            className="scroll-mt-6"
          >
            <ReportPanel
              title="投研经理分析"
              eyebrow="Dispute map"
              text={researchText}
              tone="accent"
            />
          </div>

          <div
            ref={(el) => {
              sectionRefs.current.roundtable = el;
            }}
            data-section-id="roundtable"
            className="scroll-mt-6"
          >
            <div className="space-y-4">
              {turns.length > 0 ? (
                turns.map((turn, idx) => (
                  <ReportPanel
                    key={`${turn.master}-${turn.round}-${idx}`}
                    title={`${turn.name ?? turn.master} · 第 ${turn.round} 轮`}
                    eyebrow="Master roundtable"
                    text={turn.text}
                  />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-ink-300 bg-white/60 p-8 text-sm text-ink-500">
                  未生成大师圆桌观点。
                </div>
              )}
            </div>
          </div>

          <div
            ref={(el) => {
              sectionRefs.current.risk = el;
            }}
            data-section-id="risk"
            className="scroll-mt-6"
          >
            <div className="grid gap-4 xl:grid-cols-2">
              {Object.entries(RISK_LABEL).map(([key, label]) => (
                <ReportPanel
                  key={key}
                  title={label}
                  eyebrow="Risk review"
                  text={renderText(risk[key])}
                  tone="risk"
                />
              ))}
            </div>
          </div>

          <div
            ref={(el) => {
              sectionRefs.current.manager = el;
            }}
            data-section-id="manager"
            className="scroll-mt-6"
          >
            <ReportPanel
              title="投资经理决策"
              eyebrow="Final decision"
              text={managerText}
              tone="manager"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function TabIcon({ id }: { id: TabId }) {
  const className = "h-4 w-4 shrink-0";
  if (id === "summary") return <BookOpenText className={className} />;
  if (id === "analysts") return <BarChart3 className={className} />;
  if (id === "research") return <BrainCircuit className={className} />;
  if (id === "roundtable") return <MessageSquareText className={className} />;
  if (id === "risk") return <ShieldCheck className={className} />;
  return <Target className={className} />;
}
