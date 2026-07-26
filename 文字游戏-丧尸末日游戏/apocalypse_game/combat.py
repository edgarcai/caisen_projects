"""提供与界面、剧情推进和存档仓库解耦的配置化 Boss 战服务。"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence, Tuple

from apocalypse_game.domain import BattleState, CombatReport, GameState
from apocalypse_game.ports import RandomSource


class CombatError(RuntimeError):
    """表示战斗配置或当前战斗请求无法安全执行。"""


class CombatModifierProvider(Protocol):
    """定义战斗服务读取设施和伙伴规则修正所需的最小接口。"""

    def passive_modifier(self, state: GameState, target: str) -> int:
        """返回指定配置化战斗规则的累计百分比修正。"""


@dataclass(frozen=True)
class CombatAction:
    """描述界面可展示的一项战斗行动及其可用性。"""

    action_id: str
    label: str
    description: str
    available: bool
    unavailable_reason: str = ""


DEFAULT_RULES: Mapping[str, Any] = {
    "minimum_damage": 1,
    "damage_variance_percent": [90, 110],
    "player_attack_weight_percent": 100,
    "player_defense_damage_weight_percent": 25,
    "shelter_defense_damage_weight_percent": 100,
    "boss_attack_weight_percent": 100,
    "player_defense_mitigation_percent": 45,
    "guard_damage_reduction_percent": 55,
    "focus_damage_bonus_percent": 65,
    "focus_critical_bonus_percent": 20,
    "base_critical_chance_percent": 8,
    "critical_damage_multiplier_percent": 150,
    "medicine_cost": 3,
    "medicine_heal_range": [12, 24],
    "retreat_base_chance_percent": 35,
    "retreat_agility_bonus_percent_per_point": 2,
    "retreat_max_chance_percent": 85,
    "retreat_failure_damage_multiplier_percent": 75,
    "round_limit_failure_health": 1,
    "victory_activity_reward": 10,
    "retreat_activity_penalty": 4,
    "defeat_activity_penalty": 12,
    "player_max_health": 100,
    "victory_outcome": "defeated",
}


DEFAULT_ACTIONS: Tuple[Mapping[str, Any], ...] = (
    {
        "action_id": "attack",
        "label": "攻击",
        "description": "使用当前武器发动稳定攻击。",
        "requirements": [],
        "resource_costs": [],
        "damage_multiplier_percent": 100,
        "damage_random_percent": [90, 110],
        "healing_multiplier_percent": 0,
        "healing_random_range": [0, 0],
        "defense_multiplier_percent": 100,
        "focus_gain": 0,
        "ends_round": True,
    },
    {
        "action_id": "guard",
        "label": "防御",
        "description": "降低本回合受到的伤害。",
        "requirements": [],
        "resource_costs": [],
        "damage_multiplier_percent": 35,
        "damage_random_percent": [95, 105],
        "healing_multiplier_percent": 0,
        "healing_random_range": [0, 0],
        "defense_multiplier_percent": 155,
        "focus_gain": 0,
        "ends_round": True,
    },
    {
        "action_id": "focus",
        "label": "专注",
        "description": "令下一次攻击更强并提高暴击概率。",
        "requirements": [],
        "resource_costs": [],
        "damage_multiplier_percent": 20,
        "damage_random_percent": [100, 100],
        "healing_multiplier_percent": 0,
        "healing_random_range": [0, 0],
        "defense_multiplier_percent": 110,
        "focus_gain": 1,
        "ends_round": True,
    },
    {
        "action_id": "medicine",
        "label": "使用医疗用品",
        "description": "消耗医疗用品在战斗中治疗伤势。",
        "requirements": [
            {
                "type": "attribute",
                "target": "player.medical_supplies",
                "operator": "gte",
                "value": 3,
            }
        ],
        "resource_costs": [
            {
                "target": "player.medical_supplies",
                "operation": "subtract",
                "amount": 3,
            }
        ],
        "damage_multiplier_percent": 0,
        "damage_random_percent": [0, 0],
        "healing_multiplier_percent": 100,
        "healing_random_range": [12, 24],
        "defense_multiplier_percent": 100,
        "focus_gain": 0,
        "ends_round": True,
    },
    {
        "action_id": "retreat",
        "label": "撤退",
        "description": "尝试脱离战斗，失败时会遭受追击。",
        "requirements": [],
        "resource_costs": [],
        "damage_multiplier_percent": 0,
        "damage_random_percent": [0, 0],
        "healing_multiplier_percent": 0,
        "healing_random_range": [0, 0],
        "defense_multiplier_percent": 75,
        "focus_gain": 0,
        "success_chance_percent": 35,
        "success_random_roll": [1, 100],
        "ends_round": True,
    },
)


DEFAULT_TEXTS: Mapping[str, str] = {
    "battle_start": "{boss_name}挡住了去路。战斗开始。",
    "round_start": "第{round_number}回合｜你的生命：{player_health}｜{boss_name}生命：{boss_health}/{boss_max_health}",
    "attack": "你对{boss_name}造成{damage}点伤害。",
    "critical_attack": "攻击命中要害，对{boss_name}造成{damage}点暴击伤害。",
    "guard": "你稳住重心进入防御。",
    "focus": "你屏住呼吸观察弱点，下一次攻击将获得专注加成。",
    "medicine": "你消耗{cost}份医疗用品，恢复{healed}点生命。",
    "medicine_failed": "医疗用品不足，需要至少{cost}份。",
    "medicine_not_needed": "当前所长生命值已满，无需消耗医疗用品。",
    "boss_attack": "{boss_name}发动攻击，你受到{damage}点伤害。",
    "boss_special": "{special_text}你受到{damage}点伤害。",
    "guard_reduced": "防御生效，本次伤害由{raw_damage}降低至{damage}。",
    "retreat_success": "你成功脱离{boss_name}的攻击范围。",
    "retreat_failed": "撤退路线被封死，{boss_name}趁机发动追击。",
    "victory": "{boss_name}停止了攻击。你赢得了选择其命运的机会。",
    "victory_rewards": "伙伴完成紧急救治，并回收了战场补给。",
    "defeat": "你倒在{boss_name}面前。",
    "round_limit": "战斗拖得太久，你必须撤出战场。",
    "invalid_action": "当前无法执行战斗行动：{action_id}。",
    "battle_not_active": "当前没有正在进行的Boss战。",
}


ALLOWED_NUMERIC_TARGETS = frozenset(
    {
        "player.health",
        "player.attack",
        "player.defense",
        "player.agility",
        "player.medical_supplies",
        "player.food",
        "player.hunger",
        "player.intelligence",
        "player.coins",
        "player.parts",
        "player.negative_status",
        "player.antidotes",
        "shelter.population",
        "shelter.group_hunger",
        "shelter.health",
        "shelter.defense_damage",
        "shelter.activity",
        "story.humanity",
        "story.evidence",
        "story.infection_pressure",
    }
)


class CombatService:
    """从剧情配置执行可测试、可恢复的 Boss 回合战斗。"""

    def __init__(
        self,
        story_config: Mapping[str, Any],
        random_source: RandomSource,
        modifier_provider: Optional[CombatModifierProvider] = None,
    ) -> None:
        """注入剧情、随机源和可选规则修正器，并预先校验引用。"""

        self._random = random_source
        self._modifiers = modifier_provider
        combat_config = story_config.get("combat")
        if not isinstance(combat_config, Mapping):
            combat_config = {}
        configured_rules = combat_config.get("rules", {})
        self._rules = dict(DEFAULT_RULES)
        if isinstance(configured_rules, Mapping):
            self._rules.update(configured_rules)
        configured_texts = combat_config.get("texts", {})
        self._texts = dict(DEFAULT_TEXTS)
        if isinstance(configured_texts, Mapping):
            self._texts.update(configured_texts)
        configured_actions = combat_config.get("actions", DEFAULT_ACTIONS)
        self._actions = self._build_action_map(configured_actions)
        self._bosses = self._build_boss_map(story_config.get("bosses", []))
        self._validate_configuration()

    def start(
        self,
        state: GameState,
        boss_id: str,
        starting_health_percent: int = 100,
    ) -> CombatReport:
        """按剧情修正开始 Boss 战，或保留伤害恢复已撤退战斗。"""

        if state.ended:
            raise CombatError("已结束游戏不能开始 Boss 战")
        if state.pending_exploration is not None:
            raise CombatError("请先结算或取消待处理探索事件")
        boss = self._bosses.get(boss_id)
        if boss is None:
            raise CombatError("未知 Boss：{}".format(boss_id))
        if (
            isinstance(starting_health_percent, bool)
            or not isinstance(starting_health_percent, int)
            or starting_health_percent <= 0
        ):
            raise CombatError("Boss 初始生命百分比必须是正整数")
        if boss_id in state.story.boss_outcomes:
            raise CombatError("Boss {} 已经完成战斗结算".format(boss_id))

        working_state = copy.deepcopy(state)
        existing = working_state.battle
        base_max_health = boss["max_health"]
        configured_health = max(
            1,
            base_max_health * starting_health_percent // 100,
        )
        if existing is not None:
            if existing.boss_id != boss_id:
                raise CombatError("已存在另一场未收尾的 Boss 战")
            if not existing.retreated:
                raise CombatError("当前 Boss 战已经开始")
            existing.finished = False
            existing.victory = False
            existing.retreated = False
            existing.guarding = False
            existing.max_health = max(base_max_health, configured_health)
            existing.health = min(existing.health, configured_health)
        else:
            working_state.battle = BattleState(
                boss_id=boss_id,
                boss_name=boss["name"],
                health=configured_health,
                max_health=max(base_max_health, configured_health),
            )
        battle = working_state.battle
        messages = [self._text("battle_start", boss_name=battle.boss_name)]
        messages.append(self._round_message(working_state))
        self._commit(working_state, state)
        return CombatReport(tuple(messages), False, False, False)

    def available_actions(self, state: GameState) -> Tuple[CombatAction, ...]:
        """返回当前战斗中全部配置行动以及资源条件可用性。"""

        battle = state.battle
        if battle is None or battle.finished:
            return ()
        result = []
        for action in self._actions.values():
            available = self._requirements_met(
                action.get("requirements", []),
                state,
            )
            if (
                action["action_id"] == "medicine"
                and state.active_player.health >= self._rules["player_max_health"]
            ):
                available = False
                reason = self._text("medicine_not_needed")
            else:
                reason = "" if available else self._unavailable_reason(action)
            result.append(
                CombatAction(
                    action_id=action["action_id"],
                    label=action["label"],
                    description=action["description"],
                    available=available,
                    unavailable_reason=reason,
                )
            )
        return tuple(result)

    def perform_action(self, state: GameState, action_id: str) -> CombatReport:
        """原子执行一个有效战斗行动、Boss 反击、回合上限与双人轮换。"""

        battle = state.battle
        if battle is None or battle.finished:
            raise CombatError(self._text("battle_not_active"))
        action = self._actions.get(action_id)
        if action is None:
            raise CombatError(self._text("invalid_action", action_id=action_id))
        if not self._requirements_met(action.get("requirements", []), state):
            if action_id == "medicine":
                cost = self._medicine_cost(action)
                return CombatReport(
                    (self._text("medicine_failed", cost=cost),),
                    False,
                    False,
                    False,
                    state_changed=False,
                )
            raise CombatError(self._text("invalid_action", action_id=action_id))
        if (
            action_id == "medicine"
            and state.active_player.health >= self._rules["player_max_health"]
        ):
            return CombatReport(
                (self._text("medicine_not_needed"),),
                False,
                False,
                False,
                state_changed=False,
            )

        working_state = copy.deepcopy(state)
        messages = self._perform_on_working_state(working_state, action)
        current_battle = working_state.battle
        report = CombatReport(
            tuple(messages),
            current_battle.finished,
            current_battle.victory,
            current_battle.retreated,
        )
        self._commit(working_state, state)
        return report

    def _perform_on_working_state(
        self,
        state: GameState,
        action: Mapping[str, Any],
    ) -> List[str]:
        """在工作副本上结算玩家行动与本回合后续效果。"""

        battle = state.battle
        boss = self._bosses[battle.boss_id]
        action_id = action["action_id"]
        messages: List[str] = []
        self._apply_resource_costs(action.get("resource_costs", []), state)

        if action_id == "retreat":
            return self._resolve_retreat(state, action)

        if action_id == "guard":
            battle.guarding = True
            messages.append(self._text("guard"))
        elif action_id == "focus":
            messages.append(self._text("focus"))
        elif action_id == "medicine":
            messages.append(self._resolve_medicine(state, action))

        damage_multiplier = action.get("damage_multiplier_percent", 0)
        if damage_multiplier > 0:
            damage, critical = self._player_damage(state, action)
            battle.health = max(0, battle.health - damage)
            message_key = "critical_attack" if critical else "attack"
            messages.append(
                self._text(
                    message_key,
                    boss_name=battle.boss_name,
                    damage=damage,
                )
            )

        if action_id == "focus" and action.get("focus_gain", 0) > 0:
            battle.focused = True

        if battle.health <= 0:
            self._resolve_victory(state, boss, messages)
        else:
            messages.extend(self._resolve_boss_response(state, action, boss))

        if action.get("ends_round", True):
            self._finish_round(state, boss, messages)
        return messages

    def _resolve_retreat(
        self,
        state: GameState,
        action: Mapping[str, Any],
    ) -> List[str]:
        """按配置概率处理撤退，失败时执行一次降低伤害的追击。"""

        battle = state.battle
        boss = self._bosses[battle.boss_id]
        player = state.active_player
        base_chance = action.get(
            "success_chance_percent",
            self._rules["retreat_base_chance_percent"],
        )
        agility_bonus = (
            player.agility * self._rules["retreat_agility_bonus_percent_per_point"]
        )
        chance = min(
            self._rules["retreat_max_chance_percent"],
            base_chance + agility_bonus,
        )
        roll_range = action.get("success_random_roll", [1, 100])
        roll = self._random.randint(roll_range[0], roll_range[1])
        messages: List[str] = []
        if roll <= chance:
            battle.finished = True
            battle.retreated = True
            battle.guarding = False
            state.shelter.activity -= self._rules["retreat_activity_penalty"]
            messages.append(self._text("retreat_success", boss_name=battle.boss_name))
        else:
            messages.append(self._text("retreat_failed", boss_name=battle.boss_name))
            messages.extend(
                self._resolve_boss_response(
                    state,
                    action,
                    boss,
                    damage_multiplier=self._rules[
                        "retreat_failure_damage_multiplier_percent"
                    ],
                )
            )
        if action.get("ends_round", True):
            self._finish_round(state, boss, messages)
        return messages

    def _resolve_medicine(
        self,
        state: GameState,
        action: Mapping[str, Any],
    ) -> str:
        """按行动配置治疗当前所长，并返回格式化战斗文案。"""

        player = state.active_player
        heal_range = action.get(
            "healing_random_range",
            self._rules["medicine_heal_range"],
        )
        rolled_heal = self._random.randint(heal_range[0], heal_range[1])
        multiplier = action.get("healing_multiplier_percent", 100)
        heal_amount = rolled_heal * multiplier // 100
        before = player.health
        player.health = min(
            self._rules["player_max_health"],
            player.health + heal_amount,
        )
        return self._text(
            "medicine",
            cost=self._medicine_cost(action),
            healed=player.health - before,
        )

    def _player_damage(
        self,
        state: GameState,
        action: Mapping[str, Any],
    ) -> Tuple[int, bool]:
        """根据玩家属性、Boss 防御、行动倍率和专注状态计算伤害。"""

        player = state.active_player
        battle = state.battle
        boss = self._bosses[battle.boss_id]
        base_damage = (
            player.attack * self._rules["player_attack_weight_percent"] // 100
            + player.defense
            * self._rules["player_defense_damage_weight_percent"]
            // 100
            + state.shelter.defense_damage
            * self._rules["shelter_defense_damage_weight_percent"]
            // 100
            - boss["defense"]
        )
        damage = max(self._rules["minimum_damage"], base_damage)
        tool_damage_percent = 100 + self._modifier(
            state,
            "rules.boss_tool_damage_percent",
        )
        damage = damage * max(0, tool_damage_percent) // 100
        damage = damage * action.get("damage_multiplier_percent", 100) // 100
        focus_active = battle.focused and action["action_id"] == "attack"
        critical_chance = self._rules["base_critical_chance_percent"]
        if focus_active:
            damage = damage * (100 + self._rules["focus_damage_bonus_percent"]) // 100
            critical_chance += self._rules["focus_critical_bonus_percent"]
            battle.focused = False
        variance = action.get(
            "damage_random_percent",
            self._rules["damage_variance_percent"],
        )
        damage = damage * self._random.randint(variance[0], variance[1]) // 100
        critical = (
            action["action_id"] == "attack"
            and self._random.randint(1, 100) <= critical_chance
        )
        if critical:
            damage = damage * self._rules["critical_damage_multiplier_percent"] // 100
        return max(self._rules["minimum_damage"], damage), critical

    def _resolve_boss_response(
        self,
        state: GameState,
        action: Mapping[str, Any],
        boss: Mapping[str, Any],
        damage_multiplier: int = 100,
    ) -> List[str]:
        """按当前生命阶段处理 Boss 普通攻击或周期特殊招式。"""

        battle = state.battle
        player = state.active_player
        phase = self._current_phase(boss, battle.health, battle.max_health)
        special = (
            phase is not None
            and battle.round_number % phase["special_every_rounds"] == 0
        )
        boss_power = boss["attack"] * self._rules["boss_attack_weight_percent"] // 100
        if special:
            boss_power += phase["special_damage"]
        boss_damage_percent = 100 + self._modifier(
            state,
            "rules.boss_damage_percent",
        )
        boss_power = boss_power * max(0, boss_damage_percent) // 100
        defense_multiplier = action.get("defense_multiplier_percent", 100)
        mitigation = (
            player.defense
            * self._rules["player_defense_mitigation_percent"]
            * defense_multiplier
            // 10000
        )
        raw_damage = max(self._rules["minimum_damage"], boss_power - mitigation)
        variance = self._rules["damage_variance_percent"]
        raw_damage = raw_damage * self._random.randint(variance[0], variance[1]) // 100
        raw_damage = max(self._rules["minimum_damage"], raw_damage)
        raw_damage = max(
            self._rules["minimum_damage"],
            raw_damage * damage_multiplier // 100,
        )
        damage = raw_damage
        messages: List[str] = []
        if battle.guarding:
            damage = max(
                self._rules["minimum_damage"],
                raw_damage
                * (100 - self._rules["guard_damage_reduction_percent"])
                // 100,
            )
            messages.append(
                self._text(
                    "guard_reduced",
                    raw_damage=raw_damage,
                    damage=damage,
                )
            )
            battle.guarding = False
        player.health = max(0, player.health - damage)
        if special:
            messages.append(
                self._text(
                    "boss_special",
                    special_text=phase["special_text"],
                    damage=damage,
                )
            )
        else:
            messages.append(
                self._text(
                    "boss_attack",
                    boss_name=battle.boss_name,
                    damage=damage,
                )
            )
        if player.health <= 0:
            battle.finished = True
            state.shelter.activity -= self._rules["defeat_activity_penalty"]
            messages.append(self._text("defeat", boss_name=battle.boss_name))
        return messages

    def _finish_round(
        self,
        state: GameState,
        boss: Mapping[str, Any],
        messages: List[str],
    ) -> None:
        """在每个有效且结束回合的行动后处理上限、轮换与下回合提示。"""

        battle = state.battle
        if not battle.finished and battle.round_number >= boss["round_limit"]:
            state.active_player.health = min(
                state.active_player.health,
                self._rules["round_limit_failure_health"],
            )
            battle.finished = True
            state.shelter.activity -= self._rules["defeat_activity_penalty"]
            messages.append(self._text("round_limit"))
        state.rotate_player()
        if not battle.finished:
            battle.round_number += 1
            messages.append(self._round_message(state))

    def _resolve_victory(
        self,
        state: GameState,
        boss: Mapping[str, Any],
        messages: List[str],
    ) -> None:
        """标记战斗胜利、颁发基础奖励并写入不推进场景的 Boss 成果。"""

        battle = state.battle
        battle.health = 0
        battle.finished = True
        battle.victory = True
        battle.retreated = False
        state.story.boss_outcomes[battle.boss_id] = self._rules["victory_outcome"]
        self._apply_rewards(boss.get("base_rewards", {}), state)
        state.shelter.activity += self._rules["victory_activity_reward"]
        messages.append(self._text("victory", boss_name=battle.boss_name))
        messages.append(self._text("victory_rewards"))

    def _apply_rewards(
        self,
        rewards: Mapping[str, Any],
        state: GameState,
    ) -> None:
        """把已在启动时校验的 Boss 基础数值奖励应用到领域状态。"""

        for target, amount in rewards.items():
            owner, attribute = self._resolve_numeric_target(target, state)
            setattr(owner, attribute, getattr(owner, attribute) + amount)

    def _requirements_met(
        self,
        requirements: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> bool:
        """检查战斗行动声明的全部数值前置条件。"""

        for requirement in requirements:
            owner, attribute = self._resolve_numeric_target(
                requirement["target"],
                state,
            )
            current = getattr(owner, attribute)
            expected = requirement["value"]
            operator = requirement.get("operator", "gte")
            if operator == "gte" and current < expected:
                return False
            if operator == "lte" and current > expected:
                return False
            if operator == "eq" and current != expected:
                return False
        return True

    def _apply_resource_costs(
        self,
        costs: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> None:
        """在工作副本上应用已通过前置校验的行动资源消耗。"""

        for cost in costs:
            owner, attribute = self._resolve_numeric_target(cost["target"], state)
            amount = cost["amount"]
            operation = cost.get("operation", "subtract")
            current = getattr(owner, attribute)
            if operation == "subtract":
                setattr(owner, attribute, current - amount)
            elif operation == "add":
                setattr(owner, attribute, current + amount)
            else:
                raise CombatError("不支持的战斗资源操作：{}".format(operation))

    def _resolve_numeric_target(self, target: str, state: GameState) -> Tuple[Any, str]:
        """通过明确根对象解析允许的玩家、避难所或剧情数值目标。"""

        if target not in ALLOWED_NUMERIC_TARGETS:
            raise CombatError("战斗数值目标不在白名单中：{}".format(target))
        parts = target.split(".")
        if len(parts) != 2:
            raise CombatError("战斗数值目标格式无效：{}".format(target))
        root, attribute = parts
        if root == "player":
            owner = state.active_player
        elif root == "shelter":
            owner = state.shelter
        elif root == "story":
            owner = state.story
        else:
            raise CombatError("战斗数值目标根对象无效：{}".format(target))
        value = getattr(owner, attribute, None)
        if isinstance(value, bool) or not isinstance(value, int):
            raise CombatError("战斗数值目标不是整数属性：{}".format(target))
        return owner, attribute

    def _current_phase(
        self,
        boss: Mapping[str, Any],
        health: int,
        max_health: int,
    ) -> Optional[Mapping[str, Any]]:
        """按 Boss 当前生命百分比选择阈值最低的已触发阶段。"""

        percent = health * 100 / max_health
        selected = None
        for phase in sorted(
            boss.get("phases", []),
            key=lambda item: item["health_threshold_percent"],
            reverse=True,
        ):
            if percent <= phase["health_threshold_percent"]:
                selected = phase
        return selected

    def _round_message(self, state: GameState) -> str:
        """根据当前行动者和战斗状态生成回合提示。"""

        battle = state.battle
        return self._text(
            "round_start",
            round_number=battle.round_number,
            player_health=state.active_player.health,
            boss_name=battle.boss_name,
            boss_health=battle.health,
            boss_max_health=battle.max_health,
        )

    def _medicine_cost(self, action: Mapping[str, Any]) -> int:
        """从药品行动资源消耗中读取配置用量。"""

        for cost in action.get("resource_costs", []):
            if cost.get("target") == "player.medical_supplies":
                return cost["amount"]
        return self._rules["medicine_cost"]

    def _unavailable_reason(self, action: Mapping[str, Any]) -> str:
        """为资源条件不足的行动生成简短展示文案。"""

        if action["action_id"] == "medicine":
            return self._text("medicine_failed", cost=self._medicine_cost(action))
        return self._text("invalid_action", action_id=action["action_id"])

    def _modifier(self, state: GameState, target: str) -> int:
        """读取可选战斗修正提供者，无提供者时保持基础规则。"""

        if self._modifiers is None:
            return 0
        return self._modifiers.passive_modifier(state, target)

    def _text(self, key: str, **values: Any) -> str:
        """读取战斗文案并对格式化参数做统一错误转换。"""

        template = self._texts.get(key)
        if not isinstance(template, str):
            raise CombatError("战斗配置缺少文案：{}".format(key))
        try:
            return template.format(**values)
        except (KeyError, ValueError, IndexError) as error:
            raise CombatError("战斗文案 {} 格式化失败".format(key)) from error

    @staticmethod
    def _build_action_map(actions: Any) -> Dict[str, Mapping[str, Any]]:
        """将配置中的行动列表或映射统一转换为 ID 索引。"""

        if isinstance(actions, Mapping):
            candidates = list(actions.values())
        elif isinstance(actions, Sequence) and not isinstance(actions, (str, bytes)):
            candidates = list(actions)
        else:
            raise CombatError("combat.actions 必须是列表或对象")
        result: Dict[str, Mapping[str, Any]] = {}
        for action in candidates:
            if not isinstance(action, Mapping):
                raise CombatError("战斗行动必须是对象")
            action_id = action.get("action_id")
            if not isinstance(action_id, str) or not action_id or action_id in result:
                raise CombatError("战斗行动 ID 缺失或重复")
            result[action_id] = action
        return result

    @staticmethod
    def _build_boss_map(bosses: Any) -> Dict[str, Mapping[str, Any]]:
        """将 Boss 配置列表转换为稳定 ID 索引。"""

        if not isinstance(bosses, list):
            raise CombatError("story.bosses 必须是列表")
        result: Dict[str, Mapping[str, Any]] = {}
        for boss in bosses:
            if not isinstance(boss, Mapping):
                raise CombatError("Boss 配置必须是对象")
            boss_id = boss.get("boss_id")
            if not isinstance(boss_id, str) or not boss_id or boss_id in result:
                raise CombatError("Boss ID 缺失或重复")
            result[boss_id] = boss
        return result

    def _validate_configuration(self) -> None:
        """在战斗开始前深度校验规则、行动、Boss 阶段与奖励目标。"""

        required_actions = {"attack", "guard", "focus", "medicine", "retreat"}
        if not required_actions <= set(self._actions):
            missing = ", ".join(sorted(required_actions - set(self._actions)))
            raise CombatError("战斗配置缺少行动：{}".format(missing))
        for key, value in self._rules.items():
            if key == "victory_outcome":
                if not isinstance(value, str) or not value:
                    raise CombatError("combat.rules.victory_outcome 必须是非空字符串")
                continue
            if (
                key.endswith("_range")
                or key.endswith("_percent")
                and isinstance(value, list)
            ):
                self._validate_range(value, "combat.rules.{}".format(key))
                continue
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise CombatError("combat.rules.{} 必须是非负整数".format(key))
        for action in self._actions.values():
            self._validate_action(action)
        if not self._bosses:
            raise CombatError("至少需要配置一名 Boss")
        for boss in self._bosses.values():
            self._validate_boss(boss)

    def _validate_action(self, action: Mapping[str, Any]) -> None:
        """校验单个战斗行动的文案、数值、条件与消耗。"""

        for field_name in ("label", "description"):
            if not isinstance(action.get(field_name), str):
                raise CombatError("战斗行动缺少 {}".format(field_name))
        for field_name in (
            "damage_multiplier_percent",
            "healing_multiplier_percent",
            "defense_multiplier_percent",
            "focus_gain",
        ):
            value = action.get(field_name, 0)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise CombatError("战斗行动 {} 必须是非负整数".format(field_name))
        for field_name in ("damage_random_percent", "healing_random_range"):
            self._validate_range(action.get(field_name, [0, 0]), field_name)
        if not isinstance(action.get("ends_round", True), bool):
            raise CombatError("战斗行动 ends_round 必须是布尔值")
        requirements = action.get("requirements", [])
        costs = action.get("resource_costs", [])
        if not isinstance(requirements, list) or not isinstance(costs, list):
            raise CombatError("战斗行动条件和消耗必须是列表")
        for requirement in requirements:
            self._validate_requirement(requirement)
        for cost in costs:
            self._validate_cost(cost)
        if action["action_id"] == "retreat":
            self._validate_range(
                action.get("success_random_roll", [1, 100]), "success_random_roll"
            )

    def _validate_requirement(self, requirement: Any) -> None:
        """校验战斗行动的数值前置条件。"""

        if not isinstance(requirement, Mapping):
            raise CombatError("战斗条件必须是对象")
        if requirement.get("type", "attribute") != "attribute":
            raise CombatError("战斗行动只支持 attribute 条件")
        if requirement.get("operator", "gte") not in {"gte", "lte", "eq"}:
            raise CombatError("战斗条件运算符无效")
        if not isinstance(requirement.get("target"), str):
            raise CombatError("战斗条件目标无效")
        if requirement["target"] not in ALLOWED_NUMERIC_TARGETS:
            raise CombatError("战斗条件目标不在白名单中")
        value = requirement.get("value")
        if isinstance(value, bool) or not isinstance(value, int):
            raise CombatError("战斗条件数值必须是整数")

    def _validate_cost(self, cost: Any) -> None:
        """校验战斗行动的资源消耗结构。"""

        if not isinstance(cost, Mapping):
            raise CombatError("战斗资源消耗必须是对象")
        if cost.get("operation", "subtract") not in {"add", "subtract"}:
            raise CombatError("战斗资源操作无效")
        if not isinstance(cost.get("target"), str):
            raise CombatError("战斗资源目标无效")
        if cost["target"] not in ALLOWED_NUMERIC_TARGETS:
            raise CombatError("战斗资源目标不在白名单中")
        amount = cost.get("amount")
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
            raise CombatError("战斗资源数量必须是非负整数")

    def _validate_boss(self, boss: Mapping[str, Any]) -> None:
        """校验 Boss 基础属性、回合上限、阶段与基础奖励。"""

        if not isinstance(boss.get("name"), str) or not boss["name"]:
            raise CombatError("Boss 缺少名称")
        for field_name in ("max_health", "attack", "defense", "round_limit"):
            value = boss.get(field_name)
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise CombatError("Boss {} 必须是正整数".format(field_name))
        phases = boss.get("phases", [])
        if not isinstance(phases, list) or not phases:
            raise CombatError("Boss 至少需要一个阶段")
        phase_ids = set()
        for phase in phases:
            if not isinstance(phase, Mapping):
                raise CombatError("Boss 阶段必须是对象")
            phase_id = phase.get("phase_id")
            if not isinstance(phase_id, str) or not phase_id or phase_id in phase_ids:
                raise CombatError("Boss 阶段 ID 缺失或重复")
            phase_ids.add(phase_id)
            for field_name in (
                "health_threshold_percent",
                "special_every_rounds",
                "special_damage",
            ):
                value = phase.get(field_name)
                if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                    raise CombatError("Boss 阶段 {} 必须是正整数".format(field_name))
            if not isinstance(phase.get("special_text"), str):
                raise CombatError("Boss 阶段缺少 special_text")
        rewards = boss.get("base_rewards", {})
        if not isinstance(rewards, Mapping):
            raise CombatError("Boss base_rewards 必须是对象")
        allowed_reward_targets = {
            "player.health",
            "player.attack",
            "player.defense",
            "player.agility",
            "player.medical_supplies",
            "player.food",
            "player.coins",
            "player.parts",
            "player.antidotes",
            "shelter.health",
            "shelter.activity",
            "story.humanity",
            "story.evidence",
            "story.infection_pressure",
        }
        for target, amount in rewards.items():
            if target not in allowed_reward_targets:
                raise CombatError("Boss 奖励目标不受支持：{}".format(target))
            if isinstance(amount, bool) or not isinstance(amount, int):
                raise CombatError("Boss 奖励值必须是整数")

    @staticmethod
    def _validate_range(value: Any, field_name: str) -> None:
        """校验由两个递增整数组成的闭区间。"""

        if (
            not isinstance(value, list)
            or len(value) != 2
            or any(
                isinstance(item, bool) or not isinstance(item, int) for item in value
            )
            or value[0] > value[1]
        ):
            raise CombatError("{} 必须是两个递增整数组成的区间".format(field_name))

    @staticmethod
    def _commit(source: GameState, target: GameState) -> None:
        """在战斗完整结算成功后一次性提交所有可变领域状态。"""

        target.players = source.players
        target.active_player_index = source.active_player_index
        target.shelter = source.shelter
        target.story = source.story
        target.companions = source.companions
        target.facility_levels = source.facility_levels
        target.battle = source.battle
