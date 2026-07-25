"""配置驱动的主线剧情、伙伴关系、隐藏发现与结局服务。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from apocalypse_game.config import GameConfig
from apocalypse_game.domain import (
    CompanionState,
    EndingState,
    GameState,
    StoryChoice,
    StoryPrompt,
    StoryState,
    StoryStatus,
)
from apocalypse_game.state_ops import StateOperationError, StateOperations


class StoryError(RuntimeError):
    """表示剧情节点、选择或配置化条件无法被安全结算。"""


@dataclass(frozen=True)
class StoryResolution:
    """描述一次剧情选择产生的消息、战斗入口与回合语义。"""

    messages: Tuple[str, ...]
    applied: bool
    consumes_turn: bool
    boss_id: Optional[str] = None
    boss_outcome: Optional[str] = None


class StoryService:
    """管理稳定场景图、剧情条件、选择效果、伙伴状态与多结局。"""

    def __init__(self, config: GameConfig, operations: StateOperations) -> None:
        """注入统一配置和受白名单保护的状态操作器。"""

        self._config = config
        self._operations = operations
        self._story = config.story
        self._scenes = {scene["scene_id"]: scene for scene in self._story["scenes"]}
        self._chapters = {
            chapter["chapter_id"]: chapter for chapter in self._story["chapters"]
        }
        self._bosses = {boss["boss_id"]: boss for boss in self._story["bosses"]}
        self._endings = {
            ending["ending_id"]: ending for ending in self._story["endings"]
        }

    def create_story_state(self) -> StoryState:
        """根据剧情默认配置创建一份互不共享可变容器的新状态。"""

        defaults = self._story["defaults"]["story_state"]
        return StoryState(
            current_scene_id=defaults["current_scene_id"],
            chapter_id=defaults["chapter_id"],
            humanity=defaults["humanity"],
            evidence=defaults["evidence"],
            infection_pressure=defaults["infection_pressure"],
            completed_scene_ids=list(defaults["completed_scene_ids"]),
            flags=list(defaults["flags"]),
            key_items=list(defaults["key_items"]),
            boss_outcomes=dict(defaults["boss_outcomes"]),
        )

    def create_companions(self) -> List[CompanionState]:
        """根据剧情默认配置创建全部伙伴的独立可变状态。"""

        return [
            CompanionState(
                companion_id=companion["companion_id"],
                trust=companion["trust"],
                status=companion["status"],
            )
            for companion in self._story["defaults"]["companions"]
        ]

    def create_facility_levels(self) -> Dict[str, int]:
        """复制剧情配置中的初始设施等级。"""

        return dict(self._story["defaults"]["facility_levels"])

    def current_prompt(self, state: GameState) -> Optional[StoryPrompt]:
        """把当前稳定场景转换为包含锁定原因的界面提示。"""

        if state.ended or not state.story.current_scene_id:
            return None
        scene = self._scene(state.story.current_scene_id)
        entry_requirements = scene.get("entry_requirements", [])
        entry_available = self.requirements_met(entry_requirements, state)
        entry_reason = (
            "" if entry_available else self._locked_reason(entry_requirements)
        )
        route_choice_id = self._selected_boss_choice(state, scene["scene_id"])
        choices: List[StoryChoice] = []
        for choice in scene["choices"]:
            available = entry_available and self.requirements_met(
                choice.get("requirements", []), state
            )
            locked_reason = ""
            if route_choice_id is not None and choice["choice_id"] != route_choice_id:
                available = False
                locked_reason = "本次首领战已经确定了另一条战术路线"
            elif not available:
                locked_reason = entry_reason or self._locked_reason(
                    choice.get("requirements", [])
                )
            choices.append(
                StoryChoice(
                    choice_id=choice["choice_id"],
                    label=choice["label"],
                    available=available,
                    locked_reason=locked_reason,
                )
            )
        chapter = self._chapters[scene["chapter_id"]]
        return StoryPrompt(
            scene_id=scene["scene_id"],
            chapter_title="第{}章 · {}".format(chapter["number"], chapter["title"]),
            title=scene["title"],
            body=scene["body"],
            objective=scene["objective"],
            choices=tuple(choices),
            locked_reason=entry_reason,
        )

    def status(self, state: GameState) -> StoryStatus:
        """返回主界面需要的章节、任务、目标与总进度摘要。"""

        total_scenes = len(self._scenes)
        completed = len(state.story.completed_scene_ids)
        if state.ended:
            ending = self._endings.get(state.ending.ending_id, {})
            return StoryStatus(
                chapter_title="旅程终章",
                mission_title=ending.get("title", state.ending.ending_id),
                objective="本局故事已经结束",
                progress_text="完成度 {}/{}".format(completed, total_scenes),
            )
        scene = self._scenes.get(state.story.current_scene_id)
        if scene is None:
            return StoryStatus(
                chapter_title="余烬之后",
                mission_title="等待新的广播",
                objective="主线内容已经完成",
                progress_text="完成度 {}/{}".format(completed, total_scenes),
            )
        chapter = self._chapters[scene["chapter_id"]]
        return StoryStatus(
            chapter_title="第{}章 · {}".format(chapter["number"], chapter["title"]),
            mission_title=scene["title"],
            objective=scene["objective"],
            progress_text="主线 {}/{} · 证据 {} · 人性 {}".format(
                completed,
                total_scenes,
                state.story.evidence,
                state.story.humanity,
            ),
        )

    def resolve_choice(
        self,
        state: GameState,
        scene_id: str,
        choice_id: str,
    ) -> StoryResolution:
        """验证并结算剧情选择；Boss 场景只锁定路线，胜利后才发放效果。"""

        if state.ended:
            raise StoryError("本局游戏已经结束")
        if state.battle is not None and not state.battle.retreated:
            raise StoryError("首领战尚未结束")
        if state.story.current_scene_id != scene_id:
            raise StoryError(
                "剧情场景不匹配：当前为 {}".format(state.story.current_scene_id)
            )
        scene = self._scene(scene_id)
        choice = self._choice(scene, choice_id)
        if not self.requirements_met(scene.get("entry_requirements", []), state):
            return self._locked_resolution(scene.get("entry_requirements", []))
        if not self.requirements_met(choice.get("requirements", []), state):
            return self._locked_resolution(choice.get("requirements", []))

        boss_id = choice.get("boss_id") or scene.get("boss_id")
        if boss_id is not None:
            route_choice_id = self._selected_boss_choice(state, scene_id)
            if route_choice_id is not None and route_choice_id != choice_id:
                return StoryResolution(
                    messages=("已经确定另一条首领战路线，撤退后才能重新选择。",),
                    applied=False,
                    consumes_turn=False,
                )
            if route_choice_id is None:
                state.story.add_flag(self._boss_route_flag(scene_id, choice_id))
            boss = self._bosses[boss_id]
            return StoryResolution(
                messages=(
                    "你选择了【{}】。{}正从阴影中逼近。".format(
                        choice["label"], boss["name"]
                    ),
                ),
                applied=True,
                consumes_turn=False,
                boss_id=boss_id,
                boss_outcome=choice.get("boss_resolution", "resolved"),
            )

        messages = self._apply_completed_choice(state, scene, choice)
        return StoryResolution(
            messages=tuple(messages),
            applied=True,
            consumes_turn=state.ending is None,
        )

    def complete_boss(self, state: GameState, boss_id: str) -> StoryResolution:
        """在首领战胜利后原子发放路线效果并推进到下一场景。"""

        scene = self._scene(state.story.current_scene_id)
        if scene.get("boss_id") != boss_id:
            raise StoryError("当前场景不对应已击败的首领 {}".format(boss_id))
        choice_id = self._selected_boss_choice(state, scene["scene_id"])
        if choice_id is None:
            raise StoryError("Boss 战缺少已锁定的剧情路线")
        choice = self._choice(scene, choice_id)
        messages = self._apply_completed_choice(state, scene, choice)
        outcome = choice.get("boss_resolution", "resolved")
        state.story.boss_outcomes[boss_id] = outcome
        self._remove_boss_route(state, scene["scene_id"])
        messages.insert(
            0,
            "首领路线已结算：{}（{}）".format(
                self._bosses[boss_id]["name"], choice["label"]
            ),
        )
        return StoryResolution(
            messages=tuple(messages),
            applied=True,
            consumes_turn=True,
            boss_id=boss_id,
            boss_outcome=outcome,
        )

    def abandon_boss_route(self, state: GameState, boss_id: str) -> None:
        """成功撤退后清除未结算路线，使玩家整备后可以重新选择。"""

        scene = self._scene(state.story.current_scene_id)
        if scene.get("boss_id") == boss_id:
            self._remove_boss_route(state, scene["scene_id"])

    def requirements_met(
        self,
        requirements: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> bool:
        """递归检查剧情配置支持的资源、标记、线索与派生属性条件。"""

        for requirement in requirements:
            requirement_type = requirement["type"]
            if requirement_type == "any_of":
                if not any(
                    self.requirements_met([nested], state)
                    for nested in requirement["requirements"]
                ):
                    return False
                continue
            if requirement_type == "all_of":
                if not self.requirements_met(requirement["requirements"], state):
                    return False
                continue
            if not self._requirement_met(requirement, state):
                return False
        return True

    def companion_summary(self, state: GameState) -> str:
        """生成包含身份、状态、信任与人物秘密提示的伙伴档案文本。"""

        status_labels = {
            "active": "同行",
            "locked": "尚未加入",
            "exiled": "已离队",
            "lost": "失联",
            "dead": "牺牲",
        }
        sections: List[str] = []
        for companion in state.companions:
            profile = self._config.companion_profile(companion.companion_id)
            sections.append(
                "【{} · {}】\n状态：{}｜信任：{}\n{}\n\n未公开档案：{}".format(
                    profile["name"],
                    profile["role"],
                    status_labels.get(companion.status, companion.status),
                    companion.trust,
                    profile["introduction"],
                    self._secret_hint(profile, companion),
                )
            )
        return "\n\n".join(sections)

    def boss_starting_health_percent(self, state: GameState, boss_id: str) -> int:
        """读取当前 Boss 路线配置的可选起始生命百分比修正。"""

        combat_rules = self._story["combat"]["rules"]
        minimum_percent = combat_rules["minimum_starting_health_percent"]
        maximum_percent = combat_rules["maximum_starting_health_percent"]
        target = "battle.{}.starting_health_percent".format(boss_id)
        percent = 100
        prefix = "battle_modifier::{}::".format(target)
        for flag in state.story.flags:
            if not flag.startswith(prefix):
                continue
            _, _, operation, raw_amount = flag.rsplit("::", 3)
            percent = self._apply_percent_operation(percent, operation, int(raw_amount))
        scene = self._scene(state.story.current_scene_id)
        choice_id = self._selected_boss_choice(state, scene["scene_id"])
        if choice_id is None:
            return max(minimum_percent, min(percent, maximum_percent))
        choice = self._choice(scene, choice_id)
        for effect in choice.get("effects", []):
            if effect["target"] == target:
                amount = effect["amount"]
                value = amount if isinstance(amount, int) else amount[0]
                percent = self._apply_percent_operation(
                    percent, effect["operation"], value
                )
        return max(minimum_percent, min(percent, maximum_percent))

    def _apply_completed_choice(
        self,
        state: GameState,
        scene: Mapping[str, Any],
        choice: Mapping[str, Any],
    ) -> List[str]:
        """应用非战斗状态效果、剧情标记、发现、伙伴状态和场景推进。"""

        regular_effects = [
            effect
            for effect in choice.get("effects", [])
            if effect["target"].split(".")[0] not in {"battle", "rules"}
        ]
        for effect in choice.get("effects", []):
            if effect["target"].startswith("battle."):
                amount = effect["amount"]
                if isinstance(amount, int):
                    state.story.add_flag(
                        "battle_modifier::{}::{}::{}".format(
                            effect["target"], effect["operation"], amount
                        )
                    )
        try:
            self._operations.apply_effects(regular_effects, state)
        except StateOperationError as error:
            raise StoryError("剧情效果无法应用：{}".format(error)) from error
        for flag in choice.get("add_flags", []):
            state.story.add_flag(flag)
        for item_id in choice.get("add_key_items", []):
            state.story.add_key_item(item_id)
        scene_id = scene["scene_id"]
        if scene_id not in state.story.completed_scene_ids:
            state.story.completed_scene_ids.append(scene_id)
        self._sync_companion_statuses(state)
        messages = [choice["result_text"]]
        messages.extend(self._discovery_messages(scene_id, choice["choice_id"], state))

        next_scene_id = choice.get("next_scene_id") or scene.get("next_scene_id")
        if next_scene_id is not None:
            next_scene = self._scene(next_scene_id)
            state.story.current_scene_id = next_scene_id
            state.story.chapter_id = next_scene["chapter_id"]
        else:
            state.story.current_scene_id = ""
            ending = self._resolve_ending(state, choice.get("ending_id"))
            state.ending = ending
            messages.append(ending.message)
        self._normalize_story_values(state)
        return messages

    def _requirement_met(
        self,
        requirement: Mapping[str, Any],
        state: GameState,
    ) -> bool:
        """检查一个已经过配置层结构校验的叶子剧情条件。"""

        requirement_type = requirement["type"]
        if requirement_type == "scene_completed":
            return requirement["scene_id"] in state.story.completed_scene_ids
        if requirement_type == "flag":
            return requirement["flag_id"] in state.story.flags
        if requirement_type == "flag_absent":
            return requirement["flag_id"] not in state.story.flags
        if requirement_type == "key_item":
            return requirement["key_item_id"] in state.story.key_items
        if requirement_type == "any_key_item":
            return any(
                item_id in state.story.key_items
                for item_id in requirement["key_item_ids"]
            )
        if requirement_type == "boss_resolved":
            return requirement["boss_id"] in state.story.boss_outcomes
        if requirement_type == "boss_outcome_any":
            return (
                state.story.boss_outcomes.get(requirement["boss_id"])
                in requirement["outcomes"]
            )
        if requirement_type == "facility_level":
            current = state.facility_levels.get(requirement["facility_id"], 0)
            return self._compare(
                current, requirement.get("operator", "gte"), requirement["value"]
            )
        if requirement_type in {"attribute", "computed_attribute"}:
            current = self._read_requirement_target(requirement["target"], state)
            return self._compare(
                current, requirement.get("operator", "gte"), requirement["value"]
            )
        raise StoryError("不支持的剧情条件：{}".format(requirement_type))

    def _read_requirement_target(self, target: str, state: GameState) -> int:
        """读取剧情条件允许使用的白名单状态或战斗力派生值。"""

        if target == "active_player.combat_power":
            player = state.active_player
            return player.attack + player.defense + player.agility
        try:
            return self._operations.read(target, state)
        except StateOperationError as error:
            raise StoryError("剧情条件目标无效：{}".format(target)) from error

    @staticmethod
    def _compare(current: int, operator: str, expected: int) -> bool:
        """使用配置声明的整数比较运算检查一个条件。"""

        operators = {
            "gte": current >= expected,
            "lte": current <= expected,
            "gt": current > expected,
            "lt": current < expected,
            "eq": current == expected,
            "neq": current != expected,
        }
        if operator not in operators:
            raise StoryError("不支持的条件运算：{}".format(operator))
        return operators[operator]

    def _resolve_ending(
        self,
        state: GameState,
        fallback_ending_id: Optional[str],
    ) -> EndingState:
        """按配置优先级选择唯一结局，并用建议结局或全局回退兜底。"""

        ordered_endings = sorted(
            self._endings.values(),
            key=lambda ending: ending["priority"],
            reverse=True,
        )
        selected = next(
            (
                ending
                for ending in ordered_endings
                if self.requirements_met(ending.get("requirements", []), state)
            ),
            None,
        )
        if selected is None and fallback_ending_id:
            selected = self._endings.get(fallback_ending_id)
        if selected is None:
            fallback = self._story["ending_resolution"]["fallback_ending_id"]
            selected = self._endings[fallback]
        message = "《{}》\n\n{}\n\n—— {} ——".format(
            selected["title"],
            selected["body"],
            selected["epilogue_title"],
        )
        return EndingState(
            ending_id=selected["ending_id"],
            outcome="victory",
            message=message,
        )

    def _sync_companion_statuses(self, state: GameState) -> None:
        """依据配置化剧情标记同步伙伴加入、流放、失联或牺牲状态。"""

        for companion in state.companions:
            companion_id = companion.companion_id
            if "{}_dead".format(companion_id) in state.story.flags:
                companion.status = "dead"
            elif "{}_lost".format(companion_id) in state.story.flags:
                companion.status = "lost"
            elif "{}_exiled".format(companion_id) in state.story.flags:
                companion.status = "exiled"
            elif "{}_joined".format(companion_id) in state.story.flags:
                companion.status = "active"

    def _normalize_story_values(self, state: GameState) -> None:
        """按剧情配置钳制人性、证据、感染压力和伙伴信任。"""

        limits = self._story["defaults"]["limits"]
        state.story.humanity = max(
            limits["humanity_min"],
            min(state.story.humanity, limits["humanity_max"]),
        )
        state.story.evidence = max(
            limits["evidence_min"],
            min(state.story.evidence, limits["evidence_max"]),
        )
        state.story.infection_pressure = max(
            limits["infection_pressure_min"],
            min(state.story.infection_pressure, limits["infection_pressure_max"]),
        )
        for companion in state.companions:
            companion.trust = max(
                limits["trust_min"],
                min(companion.trust, limits["trust_max"]),
            )

    def _discovery_messages(
        self,
        scene_id: str,
        choice_id: str,
        state: GameState,
    ) -> List[str]:
        """为本次选择获得的隐藏线索生成不重复的揭示消息。"""

        messages: List[str] = []
        for discovery in self._story["discoveries"]:
            if discovery["source_scene_id"] != scene_id:
                continue
            if choice_id not in discovery.get("source_choice_ids", []):
                continue
            if discovery["discovery_id"] not in state.story.key_items:
                continue
            messages.append(
                "隐藏线索【{}】：{}".format(discovery["name"], discovery["description"])
            )
        return messages

    def _locked_resolution(
        self,
        requirements: Sequence[Mapping[str, Any]],
    ) -> StoryResolution:
        """构造不会修改状态或消耗回合的锁定选择报告。"""

        return StoryResolution(
            messages=("条件不足：{}".format(self._locked_reason(requirements)),),
            applied=False,
            consumes_turn=False,
        )

    def _locked_reason(self, requirements: Sequence[Mapping[str, Any]]) -> str:
        """把配置化条件转换为简短中文锁定提示。"""

        if not requirements:
            return "剧情前置条件尚未达成"
        requirement = requirements[0]
        requirement_type = requirement["type"]
        descriptions = {
            "scene_completed": "需要先完成前一项主线任务",
            "flag": "需要此前作出特定选择",
            "flag_absent": "此前的选择已经关闭这条路线",
            "key_item": "缺少关键线索或物品",
            "any_key_item": "缺少可替代的关键线索",
            "boss_resolved": "需要先解决当前首领",
            "boss_outcome_any": "首领处理方式不符合这条路线",
            "facility_level": "避难所设施等级不足",
            "any_of": "至少需要满足其中一个准备条件",
            "all_of": "需要满足全部准备条件",
        }
        if requirement_type in {"attribute", "computed_attribute"}:
            return "资源、能力或伙伴信任尚未达到要求"
        return descriptions.get(requirement_type, "剧情条件尚未满足")

    def _secret_hint(
        self,
        profile: Mapping[str, Any],
        companion: CompanionState,
    ) -> str:
        """按信任度决定伙伴秘密显示完整文本还是朦胧提示。"""

        if companion.trust >= 2:
            return profile["secret"]
        return "信任达到 2 后，或许会听见对方不愿提起的过去。"

    @staticmethod
    def _apply_percent_operation(current: int, operation: str, amount: int) -> int:
        """对一个百分比依次应用配置化加、减或设置操作。"""

        if operation == "add":
            return current + amount
        if operation == "subtract":
            return current - amount
        if operation == "set":
            return amount
        raise StoryError("不支持的战斗百分比操作：{}".format(operation))

    def _scene(self, scene_id: str) -> Mapping[str, Any]:
        """按稳定 ID 返回场景，未知 ID 转换为剧情错误。"""

        scene = self._scenes.get(scene_id)
        if scene is None:
            raise StoryError("未知剧情场景：{}".format(scene_id))
        return scene

    @staticmethod
    def _choice(
        scene: Mapping[str, Any],
        choice_id: str,
    ) -> Mapping[str, Any]:
        """在指定场景中查找选择并拒绝伪造的选择 ID。"""

        for choice in scene["choices"]:
            if choice["choice_id"] == choice_id:
                return choice
        raise StoryError("场景 {} 不存在选择 {}".format(scene["scene_id"], choice_id))

    @staticmethod
    def _boss_route_flag(scene_id: str, choice_id: str) -> str:
        """生成不会与普通剧情标记冲突的 Boss 路线标记。"""

        return "boss_route::{}::{}".format(scene_id, choice_id)

    @staticmethod
    def _selected_boss_choice(state: GameState, scene_id: str) -> Optional[str]:
        """从持久化剧情标记中恢复已经锁定的 Boss 路线选择。"""

        prefix = "boss_route::{}::".format(scene_id)
        for flag in state.story.flags:
            if flag.startswith(prefix):
                return flag[len(prefix) :]
        return None

    @staticmethod
    def _remove_boss_route(state: GameState, scene_id: str) -> None:
        """移除指定场景的持久化 Boss 路线标记。"""

        prefix = "boss_route::{}::".format(scene_id)
        state.story.flags = [
            flag for flag in state.story.flags if not flag.startswith(prefix)
        ]
