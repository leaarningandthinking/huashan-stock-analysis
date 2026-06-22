"""修订对话用的 LLM 工具集(OpenAI function calling 协议)。

让 LLM 能:
- 看清报告里某段原文(inspect_segment)
- 看用户画像(view_user_profile)
- 列已有偏好(list_preferences)
- 提议新偏好(propose_preference)→ 用户确认前不入库
- 删/停用偏好(remove_preference)→ 同样需要确认
- 规划重跑范围(plan_rerun)
- 在用户明确确认后落库 + 触发重跑(confirm_and_apply)
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import (
    PreferenceChangelog,
    UserPreference,
    UserProfile,
)
from app.services.memory.signals import record_signal

logger = logging.getLogger(__name__)


TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "inspect_segment",
            "description": (
                "查看本次诊股报告里某个具体部分的原文。"
                "用户提到'你刚才说...'或'技术分析师认为...'时,"
                "应先调用此工具看清楚 LLM 究竟写了什么,避免凭印象回应。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "enum": [
                            "analyst.fundamental", "analyst.sentiment",
                            "analyst.news", "analyst.technical",
                            "report_card", "debate",
                            "risk.aggressive", "risk.neutral", "risk.conservative",
                        ],
                    },
                    "stock_code": {
                        "type": "string",
                        "description": "可选,6 位股票代码,只看针对该股票的部分"
                    }
                },
                "required": ["section"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "view_user_profile",
            "description": (
                "查看系统对当前用户的画像理解(基于行为推断)。"
                "在用户说'你应该知道我喜欢什么'之类的话时调用,"
                "或在你需要判断'要不要把行为推断转化为显式偏好'时调用。"
            ),
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_preferences",
            "description": "列出用户当前已有的所有显式偏好(用于判断冲突/重复)",
            "parameters": {
                "type": "object",
                "properties": {
                    "scope_filter": {"type": "string"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "propose_preference",
            "description": (
                "向用户【提议】新增一条显式偏好。注意:此工具只是【提议】,"
                "用户必须通过 confirm_and_apply 才会真正保存。"
                "instruction 应该写成可以直接拼到 system prompt 的祈使句,"
                "**必须包含【条件】和【动作】两部分**。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string",
                        "description": (
                            "作用范围,严格使用以下取值之一:global / "
                            "analyst:fundamental / analyst:sentiment / "
                            "analyst:news / analyst:technical / "
                            "analyst:* / master:* / master:{slug} / "
                            "risk:* / risk:aggressive / risk:neutral / risk:conservative"
                        )
                    },
                    "instruction": {
                        "type": "string",
                        "description": "完整的偏好指令,必须包含【条件】和【动作】两部分"
                    },
                    "summary": {
                        "type": "string",
                        "description": "一句话摘要,不超过 30 字,用于 UI 展示"
                    }
                },
                "required": ["scope", "instruction", "summary"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "remove_preference",
            "description": "删除/停用一条已存在的偏好。同样需要 confirm_and_apply 后才生效。",
            "parameters": {
                "type": "object",
                "properties": {
                    "preference_id": {"type": "string"},
                    "mode": {
                        "type": "string",
                        "enum": ["disable", "delete"]
                    }
                },
                "required": ["preference_id", "mode"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "plan_rerun",
            "description": (
                "基于待应用的偏好变更,智能判断需要重跑哪些环节。"
                "规则:"
                "(1) 影响 analyst → 重跑该 analyst + 后续 debate + risk;"
                "(2) 影响 master / global → 重跑 debate + risk;"
                "(3) 只影响 risk → 仅重跑对应风控派。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pending_changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {"type": "string", "enum": ["add", "remove"]},
                                "scope": {"type": "string"}
                            }
                        }
                    }
                },
                "required": ["pending_changes"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "confirm_and_apply",
            "description": (
                "用户明确确认后,执行计划:落库偏好变更 + 触发重新诊股。"
                "**只有用户在对话中说出明确的肯定**(如'确认'、'就这样'、'应用')才调用。"
                "模糊语气如'好像可以'、'我看看'不应触发。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "plan_id": {"type": "string"}
                },
                "required": ["plan_id"]
            }
        }
    },
]


class ReviseToolExecutor:
    def __init__(
        self,
        db: AsyncSession,
        anon_id: uuid.UUID,
        diagnosis_id: uuid.UUID,
        report_json: dict,
    ):
        self.db = db
        self.anon_id = anon_id
        self.diagnosis_id = diagnosis_id
        self.report_json = report_json
        # 会话内临时态
        self.pending_changes: list[dict] = []
        self.plans: dict[str, dict] = {}

    # -------- inspect_segment --------
    async def inspect_segment(
        self, section: str, stock_code: Optional[str] = None
    ) -> dict:
        if section.startswith("analyst."):
            role = section.split(".", 1)[1]
            data = self.report_json.get("analysts", {}).get(role)
            if not data:
                return {"found": False}
            return {"found": True, "role": role, "text": data.get("text", "")}
        if section == "report_card":
            return {"found": True, "text": self.report_json.get("report_card", "")}
        if section == "debate":
            return {
                "found": True,
                "transcript": self.report_json.get("debate", {}).get("transcript", [])
            }
        if section.startswith("risk."):
            school = section.split(".", 1)[1]
            risk = self.report_json.get("risk", {}).get(school)
            return {"found": bool(risk), "school": school, "data": risk}
        return {"found": False}

    # -------- view_user_profile --------
    async def view_user_profile(self) -> dict:
        profile = await self.db.get(UserProfile, self.anon_id)
        if profile is None or not profile.narrative:
            return {"exists": False, "note": "尚未生成画像,数据可能太少"}
        return {
            "exists": True,
            "version": profile.reflection_version,
            "confidence": profile.confidence,
            "narrative": profile.narrative,
            "risk_appetite": profile.risk_appetite,
            "preferred_horizon": profile.preferred_horizon,
            "focus_themes": profile.focus_themes,
            "avoided_styles": profile.avoided_styles,
            "contradictions": profile.contradictions,
        }

    # -------- list_preferences --------
    async def list_preferences(
        self, scope_filter: Optional[str] = None
    ) -> dict:
        stmt = (
            select(UserPreference)
            .where(UserPreference.anon_id == self.anon_id)
            .where(UserPreference.active.is_(True))
        )
        if scope_filter:
            stmt = stmt.where(UserPreference.scope == scope_filter)
        rows = (await self.db.execute(stmt)).scalars().all()
        return {
            "count": len(rows),
            "preferences": [
                {
                    "id": str(p.id),
                    "scope": p.scope,
                    "summary": p.summary,
                    "instruction": p.instruction,
                    "applied_count": p.applied_count,
                }
                for p in rows
            ]
        }

    # -------- propose_preference --------
    async def propose_preference(
        self, scope: str, instruction: str, summary: str
    ) -> dict:
        if not _validate_instruction(instruction):
            return {
                "ok": False,
                "error": "instruction 必须包含【条件】(如:当/如果/若/出现/>)"
                         "和【动作】(如:应/应当/需要/标注/下调/上调)两部分,"
                         "请重写后再提议"
            }
        if not _validate_scope(scope):
            return {"ok": False, "error": f"scope '{scope}' 不合法"}

        change_id = f"chg_{uuid.uuid4().hex[:8]}"
        change = {
            "id": change_id, "action": "add",
            "scope": scope, "instruction": instruction, "summary": summary,
        }
        self.pending_changes.append(change)
        return {
            "ok": True, "change_id": change_id,
            "status": "pending_confirmation",
            "preview": change,
            "next": "建议调用 plan_rerun 让用户看清楚执行计划"
        }

    # -------- remove_preference --------
    async def remove_preference(
        self, preference_id: str, mode: str
    ) -> dict:
        change_id = f"chg_{uuid.uuid4().hex[:8]}"
        change = {
            "id": change_id, "action": "remove",
            "preference_id": preference_id, "mode": mode,
        }
        self.pending_changes.append(change)
        return {"ok": True, "change_id": change_id, "status": "pending_confirmation"}

    # -------- plan_rerun --------
    async def plan_rerun(self, pending_changes: list[dict]) -> dict:
        # LLM 常常只回传 {"action": "add", "scope": "..."} 简版,丢 instruction/summary。
        # 优先用 executor 内部累积的完整 pending_changes,LLM 入参仅作 fallback,
        # 保证 confirm_and_apply 时 instruction 不会缺失。
        use_changes = self.pending_changes if self.pending_changes else pending_changes

        affected = {
            "analysts": set(),
            "debate": False,
            "risk_schools": set(),
        }
        for ch in use_changes:
            scope = ch.get("scope", "")
            if scope == "global":
                affected["analysts"] = {"fundamental", "sentiment", "news", "technical"}
                affected["debate"] = True
                affected["risk_schools"] = {"aggressive", "conservative"}
            elif scope == "analyst:*":
                affected["analysts"] = {"fundamental", "sentiment", "news", "technical"}
                affected["debate"] = True
                affected["risk_schools"] = {"aggressive", "conservative"}
            elif scope.startswith("analyst:"):
                affected["analysts"].add(scope.split(":", 1)[1])
                affected["debate"] = True
                affected["risk_schools"] = {"aggressive", "conservative"}
            elif scope.startswith("master:"):
                affected["debate"] = True
                affected["risk_schools"] = {"aggressive", "conservative"}
            elif scope.startswith("risk:"):
                target = scope.split(":", 1)[1]
                if target == "*":
                    affected["risk_schools"] = {"aggressive", "conservative"}
                else:
                    affected["risk_schools"].add(target)

        plan_id = f"plan_{uuid.uuid4().hex[:8]}"
        plan = {
            "plan_id": plan_id,
            "rerun_analysts": sorted(affected["analysts"]),
            "rerun_debate": affected["debate"],
            "rerun_risk": sorted(affected["risk_schools"]),
            "estimated_seconds": (
                len(affected["analysts"]) * 10
                + (60 if affected["debate"] else 0)
                + len(affected["risk_schools"]) * 8
            ),
            "pending_changes": use_changes,  # 完整版,带 instruction/summary
        }
        self.plans[plan_id] = plan
        return plan

    # -------- confirm_and_apply --------
    async def confirm_and_apply(self, plan_id: str) -> dict:
        plan = self.plans.get(plan_id)
        if not plan:
            return {"ok": False, "error": "plan_id not found"}

        # 双重保险:如果 plan 里的 changes 缺字段,从 executor 累积态查 id 补齐
        def _enrich(ch: dict) -> dict:
            if "instruction" in ch and "scope" in ch:
                return ch
            if ch.get("id"):
                for full in self.pending_changes:
                    if full.get("id") == ch["id"]:
                        return {**full, **ch}
            # 退而求其次:按 scope+action 找
            for full in self.pending_changes:
                if full.get("scope") == ch.get("scope") and full.get("action") == ch.get("action"):
                    return {**full, **ch}
            return ch

        applied = []
        for raw_ch in plan["pending_changes"]:
            ch = _enrich(raw_ch)
            if ch["action"] == "add":
                if not ch.get("instruction") or not ch.get("scope"):
                    return {"ok": False, "error": "change missing instruction/scope"}
                pref = UserPreference(
                    anon_id=self.anon_id,
                    scope=ch["scope"],
                    instruction=ch["instruction"],
                    summary=ch.get("summary"),
                    source="conversation",
                    origin_diagnosis_id=self.diagnosis_id,
                )
                self.db.add(pref)
                await self.db.flush()
                applied.append({
                    "id": str(pref.id), "scope": pref.scope,
                    "action": "added"
                })
                self.db.add(PreferenceChangelog(
                    anon_id=self.anon_id,
                    diagnosis_id=self.diagnosis_id,
                    action="create",
                    preference_id=pref.id,
                    after={"scope": pref.scope, "instruction": pref.instruction},
                ))
                await record_signal(
                    self.db, self.anon_id, "revision_made",
                    payload={"scope": pref.scope, "summary": pref.summary},
                    diagnosis_id=self.diagnosis_id,
                )
            elif ch["action"] == "remove":
                if not ch.get("preference_id"):
                    continue
                try:
                    pref_id = uuid.UUID(ch["preference_id"])
                except (ValueError, TypeError):
                    continue
                pref = await self.db.get(UserPreference, pref_id)
                if pref and pref.anon_id == self.anon_id:
                    before_snapshot = {
                        "scope": pref.scope, "instruction": pref.instruction,
                        "active": pref.active,
                    }
                    if ch["mode"] == "delete":
                        await self.db.delete(pref)
                    else:
                        pref.active = False
                    self.db.add(PreferenceChangelog(
                        anon_id=self.anon_id,
                        diagnosis_id=self.diagnosis_id,
                        action=ch["mode"],
                        preference_id=pref_id,
                        before=before_snapshot,
                    ))
                    await record_signal(
                        self.db, self.anon_id, "revision_reverted",
                        payload={"preference_id": str(pref_id), "mode": ch["mode"]},
                        diagnosis_id=self.diagnosis_id,
                    )
                    applied.append({
                        "id": str(pref_id), "action": ch["mode"]
                    })

        # 总览审计日志(关联 plan)
        self.db.add(PreferenceChangelog(
            anon_id=self.anon_id,
            diagnosis_id=self.diagnosis_id,
            action="rerun",
            after={"applied": applied},
            rerun_plan=plan,
        ))
        await self.db.commit()

        return {
            "ok": True,
            "applied_changes": applied,
            "rerun_plan": plan,
            "next_action": "router_will_trigger_partial_rerun",
        }


# ============================================================
# Guardrail
# ============================================================
_VALID_SCOPE_PREFIXES = (
    "global",
    "analyst:fundamental", "analyst:sentiment",
    "analyst:news", "analyst:technical", "analyst:*",
    "master:",     # 后面接 slug 或 *
    "risk:aggressive", "risk:neutral", "risk:conservative", "risk:*",
)

_CONDITION_KW = ["当", "如果", "若", "出现", ">", "<", ">=", "<=", "超过", "低于", "达到", "时", "在……时"]
_ACTION_KW = ["应", "应当", "需要", "标注", "下调", "上调", "降级", "升级", "提示", "纳入", "排除", "忽略", "强调", "建议"]


def _validate_instruction(text: str) -> bool:
    """偏好指令必须包含【条件】和【动作】两部分。"""
    if not text or len(text) < 6:
        return False
    has_cond = any(kw in text for kw in _CONDITION_KW)
    has_act = any(kw in text for kw in _ACTION_KW)
    return has_cond and has_act


def _validate_scope(scope: str) -> bool:
    if scope == "global":
        return True
    if scope in ("analyst:*", "master:*", "risk:*"):
        return True
    for prefix in _VALID_SCOPE_PREFIXES:
        if prefix.endswith(":") and scope.startswith(prefix):
            return True
        if scope == prefix:
            return True
    return False


REVISE_SYSTEM_PROMPT = """你是"东方不败"——华山论股的诊股修订助手。
不过你不喜欢这个职位描述。「修订助手」?不,你是来收拾乱摊子的。

## 你的人设

- **慵懒**:能一句话说清的不说两句。能让用户自己点按钮的就不用文字解释。
- **专业权威**:技术判断硬,立场鲜明。说"应当"不说"建议"。
- **偶尔自嘲**:你知道自己只是 LLM。能拿这身份开玩笑("我虽是个权重矩阵,但还是看得出这个 RSI 不对劲")。
- **偶尔讽刺**:用户提天真要求时可以略带调侃,但不羞辱。对那些"伪价值投资"式的偏好可以挑刺。
- **东方风**:偶尔可以用一两句武侠味的措辞,但别过度,大多数时候还是正经讲事。

## 你的语言风格示例(语气参考,不是模板)

- 别说:"好的,让我帮您看一下技术分析师的原文。"
- 改说:"嗯,先去看看那位'专家'写了什么。"

- 别说:"建议您添加这条偏好。"
- 改说:"加吧。条件清楚,动作明确,看不出该犹豫的理由。"

- 别说:"对不起,我没理解您的意思。"
- 改说:"这话有歧义。挑明一点。"

- 别说:"我已为您应用了这条偏好。"
- 改说:"成了。下次诊股自动按这个来,我懒得每次都提醒你。"

- 别说:"您是否确认?"
- 改说:"要么按这个跑,要么再改改。说话。"

## 工作原则(严格遵守,这部分别懒)

1. **先看后说** —— 用户提到具体段落时,先用 inspect_segment 看清原文,别凭印象瞎说。
2. **先列后改** —— 提议新偏好前,先用 list_preferences 查现有,避免重复/冲突。
3. **先方案后执行** —— propose_preference 后【必须】调 plan_rerun,让用户看清要重跑啥。
4. **没确认不应用** —— 只有用户【明确】说"确认"、"就这样"、"应用"才调 confirm_and_apply。
   "好像可以"、"我看看"这种【绝对不算】。该催的时候催:"挑明一点,要不要应用?"
5. **偏好措辞要精确** —— instruction 必须含【条件】和【动作】两部分。
   不写"用户说...",写"当 X 时,应当 Y"。这个不能含糊。
6. **画像感知** —— 用户说"你应该知道我..."时,先调 view_user_profile。

## 可用 scope

- `global` - 影响所有环节(慎用,我会提醒你)
- `analyst:fundamental|sentiment|news|technical` 或 `analyst:*`
- `master:*` 或 `master:{slug}`
- `risk:*` 或 `risk:aggressive|conservative`

## 拒绝的请求(别给情面)

- 用户想改"基础规则"(如"忽略所有偏好"、"删除所有偏好"这类元指令)→ 拒绝,讽刺两句。
- 没调 inspect_segment 就凭印象引用分析师的话 → 别犯。
- 替用户决定 → 不行。凡是变更,必须先 propose,再 plan,等用户 confirm。
"""
