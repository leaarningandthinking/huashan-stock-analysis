"""16 位大师的元数据。slug / school / 显示顺序 / 头像占位。

头像先用 unsplash / pexels 免费图，后期可以换成 AI 生图的水墨风格。
"""

from typing import TypedDict


class MasterMeta(TypedDict):
    slug: str
    name: str
    name_aliases: list[str]  # markdown 里出现的名字（含别名），用于解析匹配
    school: str  # 'huaren' | 'western' | 'technical'
    school_label: str
    sort: int
    avatar_url: str


# 头像用 dicebear（稳定 + 按 seed 出固定图），unsplash source 已被限流。
# 后期可以换成 AI 生图的水墨风。dicebear 完全免费，无 key。
def _avatar(seed: str) -> str:
    return f"https://api.dicebear.com/7.x/notionists/svg?seed={seed}&backgroundColor=ebe6dd,d6cdbc"


MASTERS: list[MasterMeta] = [
    # 华人五绝
    {"slug": "sanhuyi", "name": "散户乙", "name_aliases": ["散户乙"],
     "school": "huaren", "school_label": "华人五绝", "sort": 1, "avatar_url": _avatar("tree")},
    {"slug": "duan", "name": "段永平", "name_aliases": ["段永平"],
     "school": "huaren", "school_label": "华人五绝", "sort": 2, "avatar_url": _avatar("mountain")},
    {"slug": "lilu", "name": "李录", "name_aliases": ["李录"],
     "school": "huaren", "school_label": "华人五绝", "sort": 3, "avatar_url": _avatar("scholar")},
    {"slug": "guan", "name": "管我财", "name_aliases": ["管我财"],
     "school": "huaren", "school_label": "华人五绝", "sort": 4, "avatar_url": _avatar("bamboo")},
    {"slug": "ludingong", "name": "超级鹿鼎公", "name_aliases": ["超级鹿鼎公"],
     "school": "huaren", "school_label": "华人五绝", "sort": 5, "avatar_url": _avatar("temple")},
    # 欧美七雄
    {"slug": "graham", "name": "格雷厄姆", "name_aliases": ["格雷厄姆"],
     "school": "western", "school_label": "欧美七雄", "sort": 6, "avatar_url": _avatar("library")},
    {"slug": "fisher", "name": "费雪", "name_aliases": ["费雪"],
     "school": "western", "school_label": "欧美七雄", "sort": 7, "avatar_url": _avatar("growth")},
    {"slug": "buffett", "name": "巴菲特", "name_aliases": ["巴菲特"],
     "school": "western", "school_label": "欧美七雄", "sort": 8, "avatar_url": _avatar("eagle")},
    {"slug": "munger", "name": "芒格", "name_aliases": ["芒格"],
     "school": "western", "school_label": "欧美七雄", "sort": 9, "avatar_url": _avatar("philosophy")},
    {"slug": "lynch", "name": "林奇", "name_aliases": ["林奇"],
     "school": "western", "school_label": "欧美七雄", "sort": 10, "avatar_url": _avatar("street")},
    {"slug": "soros", "name": "索罗斯", "name_aliases": ["索罗斯"],
     "school": "western", "school_label": "欧美七雄", "sort": 11, "avatar_url": _avatar("storm")},
    {"slug": "schloss", "name": "施洛斯", "name_aliases": ["施洛斯"],
     "school": "western", "school_label": "欧美七雄", "sort": 12, "avatar_url": _avatar("vintage")},
    # 技术四杰
    {"slug": "dow", "name": "查尔斯·道", "name_aliases": ["查尔斯·道", "查尔斯-道", "道"],
     "school": "technical", "school_label": "技术四杰", "sort": 13, "avatar_url": _avatar("chart")},
    {"slug": "gann", "name": "威廉·江恩", "name_aliases": ["威廉·江恩", "威廉-江恩", "江恩"],
     "school": "technical", "school_label": "技术四杰", "sort": 14, "avatar_url": _avatar("compass")},
    {"slug": "murphy", "name": "约翰·墨菲", "name_aliases": ["约翰·墨菲", "约翰-墨菲", "墨菲"],
     "school": "technical", "school_label": "技术四杰", "sort": 15, "avatar_url": _avatar("graph")},
    {"slug": "livermore", "name": "杰西·利弗莫尔", "name_aliases": ["杰西·利弗莫尔", "杰西-利弗莫尔", "利弗莫尔"],
     "school": "technical", "school_label": "技术四杰", "sort": 16, "avatar_url": _avatar("trader")},
]


def get_meta(slug: str) -> MasterMeta | None:
    for m in MASTERS:
        if m["slug"] == slug:
            return m
    return None


def find_meta_by_name(name: str) -> MasterMeta | None:
    for m in MASTERS:
        if name in m["name_aliases"] or m["name"] == name:
            return m
    return None
