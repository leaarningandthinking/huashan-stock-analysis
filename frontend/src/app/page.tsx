import Link from "next/link";
import {
  ArrowRight,
  Activity,
  Briefcase,
  CandlestickChart,
  Layers3,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

const PRIMARY_ACTIONS = [
  {
    href: "/debate/single",
    title: "论股 Agent",
    desc: "输入一只股票，由分析师起报告，再组织大师辩论给出多空诊断。",
    icon: CandlestickChart,
    accent: "text-scarlet-600",
  },
  {
    href: "/short-term",
    title: "短线分析",
    desc: "选一只股票，按趋势、量能、动量和关键价位生成短线观察计划。",
    icon: Activity,
    accent: "text-sky-700",
  },
  {
    href: "/debate/portfolio",
    title: "持仓诊断",
    desc: "录入或上传持仓，生成组合风险、集中度、回撤压力和调仓建议。",
    icon: Briefcase,
    accent: "text-emerald-700",
  },
  {
    href: "/debate/batch",
    title: "批量分析",
    desc: "一次比较多只候选股，让不同风格的大师给出排序、分歧点和入选理由。",
    icon: Layers3,
    accent: "text-amber-600",
  },
  {
    href: "/masters",
    title: "大师百科",
    desc: "查看 16 位投资大师画像，理解每个角色的偏好、盲区与框架。",
    icon: UsersRound,
    accent: "text-indigo-700",
  },
];

const METRICS = [
  { label: "大师角色", value: "16", note: "多策略人格" },
  { label: "诊断维度", value: "4", note: "基本面 / 技术 / 情绪 / 风控" },
  { label: "支持场景", value: "3", note: "单股 / 批量 / 持仓" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <section>
        <div className="max-w-5xl">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs font-semibold text-ink-500 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-scarlet-600" />
            16 位投资大师 · 大师圆桌观点 · 风控审核 · 投资经理决策
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
            把股票放上华山，<span className="text-scarlet-600">让大师们开盘论剑。</span>
          </h1>
          <div className="mt-6 max-w-3xl border-l-4 border-scarlet-600 bg-white/60 px-5 py-4 shadow-sm">
            <p className="text-base leading-8 text-ink-700">
              从个股分析到组合诊断，系统会组织不同投资风格的 Agent 进行推演、反驳、风控复核与投资经理决策，输出可追溯的交易判断。
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {PRIMARY_ACTIONS.map(({ href, title, desc, icon: Icon, accent }) => (
              <Link
                key={href}
                href={href}
                className="group min-h-[166px] rounded-lg border border-ink-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-[#e6b8b1] hover:shadow-md"
              >
                <div className="mb-5 flex items-center justify-between">
                  <Icon className={`h-9 w-9 ${accent} transition group-hover:scale-110`} />
                  <ArrowRight className="h-5 w-5 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-scarlet-600" />
                </div>
                <h2 className="text-xl font-black tracking-tight text-ink-900">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-ink-500">{desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        {METRICS.map((metric) => (
          <div key={metric.label} className="border-y border-ink-200 bg-white/40 px-1 py-5">
            <div className="text-sm font-bold text-ink-500">{metric.label}</div>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-4xl font-black text-ink-900">{metric.value}</span>
              <span className="pb-1 text-sm text-ink-500">{metric.note}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-10 border-y border-ink-200 bg-white/60 px-1 py-6">
        <div className="mb-5 flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-emerald-700" />
          <h2 className="text-xl font-black text-ink-900">风控底线</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {["集中度", "回撤压力", "交易纪律"].map((item) => (
            <div key={item} className="rounded-xl bg-ink-50 px-4 py-5 text-sm font-bold text-ink-700">
              {item}
            </div>
          ))}
        </div>
      </section>

      <footer className="pt-10 text-center text-xs text-ink-400">
        本工具仅供研究参考，不构成任何投资建议。
      </footer>
    </main>
  );
}
