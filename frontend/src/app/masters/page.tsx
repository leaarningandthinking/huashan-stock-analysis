import type { MasterSummary } from "@/lib/api";
import { STATIC_MASTERS } from "@/lib/masters-static";

const SCHOOL_ORDER: Array<MasterSummary["school"]> = ["huaren", "western", "technical"];

const SCHOOL_INTRO: Record<MasterSummary["school"], string> = {
  huaren: "华人五绝 · 立足本土",
  western: "欧美七雄 · 价值投资正脉",
  technical: "技术四杰 · K 线图上的修罗",
};

export default function MastersPage() {
  const grouped = SCHOOL_ORDER.map((school) => ({
    school,
    label: SCHOOL_INTRO[school],
    list: STATIC_MASTERS.filter((m) => m.school === school),
  }));

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <header className="mb-9">
        <h1 className="text-4xl font-black tracking-tight text-ink-900">大师百科</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
          了解每位投资大师的判断框架、风格偏好和常见盲区。选大师时可以用这里作为角色参考。
        </p>
      </header>

      {grouped.map(({ school, label, list }) => (
        <section key={school} className="mb-10">
          <h2 className="mb-4 border-l-4 border-scarlet-600 pl-3 text-lg font-black text-ink-800">
            {label}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((m) => (
              <article
                key={m.slug}
                className="flex min-h-[116px] gap-4 rounded-2xl border border-ink-200 bg-[#fffdf8] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#e6b8b1] hover:shadow-md"
              >
                <div className="h-16 w-16 flex-none overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.avatar_url ?? ""} alt={m.name} className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-ink-900">{m.name}</h3>
                  <p className="mt-1 text-xs font-semibold text-scarlet-600">{m.school_label}</p>
                  <p className="mt-2 text-sm leading-6 text-ink-500">{m.tagline}</p>
                  {m.tags && m.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.tags.map((tag) => (
                        <span key={tag} className="rounded bg-ink-50 px-2 py-1 text-[11px] font-semibold text-ink-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.bio && <p className="mt-3 text-xs leading-5 text-ink-500">{m.bio}</p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
