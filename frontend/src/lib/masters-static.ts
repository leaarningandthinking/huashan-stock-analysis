import type { MasterSummary } from "@/lib/api";

function avatar(seed: string) {
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${seed}&backgroundColor=ebe6dd,d6cdbc`;
}

export const STATIC_MASTERS: MasterSummary[] = [
  { slug: "sanhuyi", name: "散户乙", tagline: "贴近 A 股散户语境的交易纪律观察者。", school: "huaren", school_label: "华人五绝", avatar_url: avatar("tree") },
  { slug: "duan", name: "段永平", tagline: "长期主义、商业模式与机会成本。", school: "huaren", school_label: "华人五绝", avatar_url: avatar("mountain") },
  { slug: "lilu", name: "李录", tagline: "价值投资与长期复利框架。", school: "huaren", school_label: "华人五绝", avatar_url: avatar("scholar") },
  { slug: "guan", name: "管我财", tagline: "财报质量、估值约束与组合纪律。", school: "huaren", school_label: "华人五绝", avatar_url: avatar("bamboo") },
  { slug: "ludingong", name: "超级鹿鼎公", tagline: "本土市场经验与仓位管理。", school: "huaren", school_label: "华人五绝", avatar_url: avatar("temple") },
  { slug: "graham", name: "格雷厄姆", tagline: "安全边际与低估值防守。", school: "western", school_label: "欧美七雄", avatar_url: avatar("library") },
  { slug: "fisher", name: "费雪", tagline: "成长质量与长期竞争力。", school: "western", school_label: "欧美七雄", avatar_url: avatar("growth") },
  { slug: "buffett", name: "巴菲特", tagline: "好生意、好价格与护城河。", school: "western", school_label: "欧美七雄", avatar_url: avatar("eagle") },
  { slug: "munger", name: "芒格", tagline: "多元思维模型与反脆弱判断。", school: "western", school_label: "欧美七雄", avatar_url: avatar("philosophy") },
  { slug: "lynch", name: "林奇", tagline: "生活观察、成长股与十倍股线索。", school: "western", school_label: "欧美七雄", avatar_url: avatar("street") },
  { slug: "soros", name: "索罗斯", tagline: "反身性、宏观拐点与风险暴露。", school: "western", school_label: "欧美七雄", avatar_url: avatar("storm") },
  { slug: "schloss", name: "施洛斯", tagline: "分散低估值与资产折价。", school: "western", school_label: "欧美七雄", avatar_url: avatar("vintage") },
  { slug: "dow", name: "查尔斯·道", tagline: "趋势结构与市场确认。", school: "technical", school_label: "技术四杰", avatar_url: avatar("chart") },
  { slug: "gann", name: "威廉·江恩", tagline: "周期、价量与关键位。", school: "technical", school_label: "技术四杰", avatar_url: avatar("compass") },
  { slug: "murphy", name: "约翰·墨菲", tagline: "技术分析体系与多周期共振。", school: "technical", school_label: "技术四杰", avatar_url: avatar("graph") },
  { slug: "livermore", name: "杰西·利弗莫尔", tagline: "趋势交易、止损与情绪纪律。", school: "technical", school_label: "技术四杰", avatar_url: avatar("trader") },
];
