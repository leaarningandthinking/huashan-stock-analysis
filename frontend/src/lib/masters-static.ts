import type { MasterSummary } from "@/lib/api";

function avatar(seed: string) {
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${seed}&backgroundColor=ebe6dd,d6cdbc`;
}

const BASE_MASTERS: MasterSummary[] = [
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

const MASTER_DETAILS: Record<string, Pick<MasterSummary, "tags" | "bio">> = {
  sanhuyi: {
    tags: ["A股生态", "散户行为", "交易纪律", "题材情绪"],
    bio: "贴近普通投资者语境，擅长识别追涨杀跌、仓位失衡和信息噪音，适合审视 A 股题材股与情绪交易风险。",
  },
  duan: {
    tags: ["消费", "游戏", "互联网", "长期持有"],
    bio: "擅长消费、游戏和互联网商业模式，重视企业文化、现金流和机会成本，适合判断好生意能否长期持有。",
  },
  lilu: {
    tags: ["价值投资", "护城河", "中概/消费", "长期复利"],
    bio: "强调理性、能力圈和长期复利，擅长从企业竞争优势和资本配置角度评估长期价值。",
  },
  guan: {
    tags: ["财报质量", "估值约束", "现金流", "组合纪律"],
    bio: "偏重财务报表、估值安全垫和组合纪律，适合检查利润质量、负债压力和估值过热风险。",
  },
  ludingong: {
    tags: ["煤炭", "水电", "周期行业", "仓位管理"],
    bio: "本土实战派视角，擅长煤炭、水电等高股息周期资产，重视市场位置、仓位控制和交易节奏。",
  },
  graham: {
    tags: ["低估值", "安全边际", "防守型", "困境反转"],
    bio: "强调安全边际、资产折价和避免永久亏损，适合评估低估值、防守型和困境反转标的。",
  },
  fisher: {
    tags: ["成长股", "研发创新", "管理层", "长期竞争力"],
    bio: "关注企业成长质量、研发能力和长期竞争优势，适合分析科技、医药和高成长行业。",
  },
  buffett: {
    tags: ["消费", "金融", "护城河", "现金流"],
    bio: "强调好生意、好价格和可持续护城河，擅长评估消费、金融和现金流稳定的优质公司。",
  },
  munger: {
    tags: ["多元思维", "商业质量", "反脆弱", "行为偏差"],
    bio: "以多元思维模型和逆向思考著称，擅长识别商业质量、激励机制和投资者认知偏差。",
  },
  lynch: {
    tags: ["成长股", "消费观察", "中小盘", "十倍股"],
    bio: "擅长从生活观察寻找成长线索，重视企业增长路径和估值匹配，适合中小盘成长股分析。",
  },
  soros: {
    tags: ["宏观", "反身性", "拐点", "风险暴露"],
    bio: "强调市场反身性和宏观变量冲击，擅长识别趋势反转、政策拐点和系统性风险。",
  },
  schloss: {
    tags: ["分散投资", "资产折价", "低市净率", "烟蒂股"],
    bio: "偏好分散持有低估资产，重视账面价值和价格折扣，适合审视深度价值与资产型公司。",
  },
  dow: {
    tags: ["趋势确认", "指数结构", "技术分析", "市场阶段"],
    bio: "关注趋势结构和市场确认信号，适合判断大盘环境、趋势阶段和多空转换。",
  },
  gann: {
    tags: ["周期", "关键位", "价量关系", "交易节奏"],
    bio: "以周期、价格区间和关键位分析闻名，适合辅助判断波段节奏和重要支撑压力。",
  },
  murphy: {
    tags: ["多周期共振", "形态分析", "行业轮动", "技术体系"],
    bio: "系统化整理技术分析框架，擅长多周期、形态、趋势和行业轮动的综合判断。",
  },
  livermore: {
    tags: ["趋势交易", "止损", "情绪纪律", "突破"],
    bio: "强调顺势、突破、止损和交易纪律，适合评估强趋势标的和高波动交易风险。",
  },
};

export const STATIC_MASTERS: MasterSummary[] = BASE_MASTERS.map((master) => ({
  ...master,
  ...(MASTER_DETAILS[master.slug] ?? {}),
}));
