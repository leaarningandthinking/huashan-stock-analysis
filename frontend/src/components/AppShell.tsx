"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  Briefcase,
  ChevronLeft,
  CircleDot,
  DatabaseZap,
  ListChecks,
  SlidersHorizontal,
  MessageSquareText,
  Mountain,
  PanelLeft,
  Settings2,
  UsersRound,
} from "lucide-react";
import { listDiagnosisTasks } from "@/lib/diagnosis-api";
import { buildRecentStocks, type RecentStock } from "@/lib/recent-stocks";

const NAV_ITEMS = [
  { label: "首页", icon: BarChart3, href: "/" },
  { label: "论股 Agent", icon: Bot, href: "/debate/single" },
  { label: "持仓诊断", icon: Briefcase, href: "/debate/portfolio" },
  { label: "分析任务", icon: ListChecks, href: "/tasks" },
  { label: "大师百科", icon: UsersRound, href: "/masters" },
  { label: "模型配置", icon: SlidersHorizontal, href: "/settings/llm" },
  { label: "数据源", icon: DatabaseZap, href: "/settings/datasource" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/debate/single") {
    return pathname.startsWith("/debate") && !pathname.startsWith("/debate/portfolio");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [recentStocks, setRecentStocks] = useState<RecentStock[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  async function refreshRecentStocks() {
    try {
      const tasks = await listDiagnosisTasks();
      setRecentStocks(buildRecentStocks(tasks, 5));
    } catch {
      setRecentStocks([]);
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("huashan-sidebar-collapsed");
    setCollapsed(saved === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("huashan-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    refreshRecentStocks();
    const timer = window.setInterval(refreshRecentStocks, 60_000);
    window.addEventListener("focus", refreshRecentStocks);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshRecentStocks);
    };
  }, [pathname]);

  return (
    <div className={`min-h-screen bg-[#f6f3ee] text-ink-900 transition-[padding] duration-200 ${collapsed ? "lg:pl-[88px]" : "lg:pl-[282px]"}`}>
      <aside className={`fixed inset-y-0 left-0 z-40 hidden border-r border-ink-200/80 bg-[#fbfaf7] transition-[width] duration-200 lg:flex lg:flex-col ${collapsed ? "w-[88px]" : "w-[282px]"}`}>
        <Link
          href="/"
          className={`flex h-20 items-center gap-3 border-b border-ink-200/80 ${collapsed ? "justify-center px-0" : "px-5"}`}
          title="华山论股"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-scarlet-600 text-white shadow-sm">
            <Mountain className="h-5 w-5" />
          </div>
          <div className={collapsed ? "hidden" : ""}>
            <div className="text-lg font-bold tracking-tight">华山论股</div>
            <div className="text-xs text-ink-500">Huashan Market Debate</div>
          </div>
        </Link>

        <nav className={`space-y-2 py-5 ${collapsed ? "px-3" : "px-4"}`}>
          {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={label}
                href={href}
                title={label}
                className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
                  collapsed ? "justify-center" : ""
                } ${
                  active
                    ? "bg-[#fff1ed] text-scarlet-600 shadow-sm ring-1 ring-[#f3d0c8]"
                    : "text-ink-500 hover:bg-ink-100/70 hover:text-ink-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>

        {!collapsed && (
        <div className="border-t border-ink-200/80 px-5 py-4">
          <div className="mb-3 flex items-center justify-between text-sm font-bold text-ink-600">
            <span className="inline-flex items-center gap-2">
              <MessageSquareText className="h-4 w-4" />
              最近论股
            </span>
            <Link href="/tasks" className="text-xs font-semibold text-ink-400 hover:text-scarlet-600">
              全部
            </Link>
          </div>
          {recentStocks.length > 0 ? (
            <div className="space-y-2">
              {recentStocks.map((stock) => (
                <Link
                  key={`${stock.diagnosis_id}-${stock.code}`}
                  href={stock.href}
                  className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-xs leading-5 text-ink-500 transition hover:bg-ink-100/70 hover:text-ink-800"
                >
                  <CircleDot className="mt-1 h-3 w-3 shrink-0 fill-emerald-300 text-emerald-300" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink-700">{stock.name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-400">{stock.code}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-ink-200 bg-white/40 p-3 text-xs leading-5 text-ink-400">
              暂无历史论股
            </div>
          )}
        </div>
        )}

        <div className={`mt-auto border-t border-ink-200/80 py-5 ${collapsed ? "px-3" : "px-5"}`}>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={`flex w-full items-center rounded-xl px-3 py-2 text-sm text-ink-500 transition hover:bg-ink-100/70 hover:text-ink-800 ${collapsed ? "justify-center" : "justify-between"}`}
            title={collapsed ? "展开工作台" : "收起工作台"}
          >
            <span className="inline-flex items-center gap-2">
              <PanelLeft className="h-4 w-4" />
              {!collapsed && "收起"}
            </span>
            {!collapsed && <ChevronLeft className="h-4 w-4" />}
          </button>
          {!collapsed && <div className="mt-4 text-xs text-ink-400">v0.1.7</div>}
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ink-200/80 bg-[#fbfaf7]/90 px-5 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-scarlet-600 text-white">
            <Mountain className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold">华山论股</span>
        </Link>
        <Link href="/settings/llm" aria-label="模型配置">
          <Settings2 className="h-5 w-5 text-ink-500" />
        </Link>
      </header>

      <div className="min-h-screen">{children}</div>
    </div>
  );
}
