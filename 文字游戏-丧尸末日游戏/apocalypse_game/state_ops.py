"""为剧情与经营系统提供配置化状态读取、条件判断和数值效果。"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Sequence

from apocalypse_game.domain import GameState
from apocalypse_game.ports import RandomSource


PLAYER_TARGET_FIELDS = frozenset(
    {
        "health",
        "attack",
        "defense",
        "agility",
        "medical_supplies",
        "food",
        "hunger",
        "intelligence",
        "coins",
        "parts",
        "negative_status",
        "antidotes",
    }
)
SHELTER_TARGET_FIELDS = frozenset(
    {
        "population",
        "group_hunger",
        "health",
        "defense_damage",
        "activity",
        "newspapers",
        "books",
        "magazines",
        "toys",
        "game_consoles",
    }
)
STORY_TARGET_FIELDS = frozenset({"humanity", "evidence", "infection_pressure"})


class StateOperationError(RuntimeError):
    """表示配置请求了不支持的状态目标或操作。"""


class StateOperations:
    """集中实现跨系统复用的数值效果和剧情条件协议。"""

    def __init__(self, random_source: RandomSource) -> None:
        """注入可复现的随机数源。"""

        self._random = random_source

    def requirements_met(
        self,
        requirements: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> bool:
        """检查数值、标记、关键物品与 Boss 状态组成的全部条件。"""

        operators = {
            "gte": lambda current, expected: current >= expected,
            "lte": lambda current, expected: current <= expected,
            "eq": lambda current, expected: current == expected,
            "neq": lambda current, expected: current != expected,
        }
        for requirement in requirements:
            requirement_type = requirement.get("type", "value")
            if requirement_type == "flag":
                present = requirement["id"] in state.story.flags
                if present != requirement.get("present", True):
                    return False
                continue
            if requirement_type == "key_item":
                present = requirement["id"] in state.story.key_items
                if present != requirement.get("present", True):
                    return False
                continue
            if requirement_type == "boss":
                present = requirement["id"] in state.story.boss_outcomes
                if present != requirement.get("defeated", True):
                    return False
                expected_outcomes = requirement.get("outcomes")
                if present and expected_outcomes is not None:
                    if (
                        state.story.boss_outcomes[requirement["id"]]
                        not in expected_outcomes
                    ):
                        return False
                continue
            if requirement_type == "companion_status":
                companion = state.companion(requirement["id"])
                if companion is None or companion.status != requirement["status"]:
                    return False
                continue
            current = self.read(requirement["target"], state)
            operator_name = requirement.get("operator", "gte")
            operator = operators.get(operator_name)
            if operator is None:
                raise StateOperationError("不支持的条件运算：{}".format(operator_name))
            if not operator(current, requirement["value"]):
                return False
        return True

    def apply_effects(
        self,
        effects: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> Dict[str, int]:
        """按顺序应用配置化数值效果，并返回可用于文案的变量。"""

        tokens: Dict[str, int] = {}
        for effect in effects:
            amount = self._roll_amount(effect["amount"])
            current = self.read(effect["target"], state)
            operation = effect["operation"]
            if operation == "subtract" and effect.get("limit_to_available", False):
                amount = min(amount, current)
            if operation == "add":
                next_value = current + amount
            elif operation == "subtract":
                next_value = current - amount
            elif operation == "set":
                next_value = amount
            else:
                raise StateOperationError("不支持的状态操作：{}".format(operation))
            self.write(effect["target"], next_value, state)
            token = effect.get("token")
            if token:
                tokens[token] = amount
        return tokens

    def read(self, target: str, state: GameState) -> int:
        """读取允许公开给配置系统的整数状态或派生计数。"""

        if target == "story.key_item_count":
            return len(state.story.key_items)
        if target == "story.active_companion_count":
            return sum(
                1 for companion in state.companions if companion.status == "active"
            )
        if target == "story.average_trust":
            active = [
                companion.trust
                for companion in state.companions
                if companion.status == "active"
            ]
            return sum(active) // len(active) if active else 0
        if target == "story.total_companion_trust":
            return sum(
                companion.trust
                for companion in state.companions
                if companion.status == "active"
            )
        if target == "story.boss_count":
            return len(state.story.boss_outcomes)

        parts = target.split(".")
        if len(parts) == 2:
            root, attribute = parts
            if root == "player":
                self._require_allowed(attribute, PLAYER_TARGET_FIELDS, target)
                return self._integer_attribute(state.active_player, attribute, target)
            if root == "shelter":
                self._require_allowed(attribute, SHELTER_TARGET_FIELDS, target)
                return self._integer_attribute(state.shelter, attribute, target)
            if root == "story":
                self._require_allowed(attribute, STORY_TARGET_FIELDS, target)
                return self._integer_attribute(state.story, attribute, target)
            if root == "facility":
                value = state.facility_levels.get(attribute)
                if not isinstance(value, int):
                    raise StateOperationError("未知设施目标：{}".format(target))
                return value
        if len(parts) == 3 and parts[0] == "companion" and parts[2] == "trust":
            companion = state.companion(parts[1])
            if companion is None:
                raise StateOperationError("伙伴尚未加入：{}".format(parts[1]))
            return companion.trust
        raise StateOperationError("未知状态目标：{}".format(target))

    def write(self, target: str, value: int, state: GameState) -> None:
        """更新允许由配置系统修改的整数状态。"""

        parts = target.split(".")
        if len(parts) == 2:
            root, attribute = parts
            if root == "player":
                self._require_allowed(attribute, PLAYER_TARGET_FIELDS, target)
                self._set_integer_attribute(
                    state.active_player, attribute, value, target
                )
                return
            if root == "shelter":
                self._require_allowed(attribute, SHELTER_TARGET_FIELDS, target)
                self._set_integer_attribute(state.shelter, attribute, value, target)
                return
            if root == "story":
                self._require_allowed(attribute, STORY_TARGET_FIELDS, target)
                self._set_integer_attribute(state.story, attribute, value, target)
                return
            if root == "facility" and attribute in state.facility_levels:
                state.facility_levels[attribute] = value
                return
        if len(parts) == 3 and parts[0] == "companion" and parts[2] == "trust":
            companion = state.companion(parts[1])
            if companion is None:
                raise StateOperationError("伙伴尚未加入：{}".format(parts[1]))
            companion.trust = value
            return
        raise StateOperationError("状态目标不可写：{}".format(target))

    def _roll_amount(self, value: Any) -> int:
        """读取固定整数或从闭区间配置中抽取数值。"""

        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if (
            isinstance(value, list)
            and len(value) == 2
            and all(
                isinstance(item, int) and not isinstance(item, bool) for item in value
            )
        ):
            return self._random.randint(value[0], value[1])
        raise StateOperationError("效果 amount 必须是整数或两个整数组成的区间")

    @staticmethod
    def _integer_attribute(owner: Any, attribute: str, target: str) -> int:
        """读取对象的真实整数属性并拒绝派生方法或字符串。"""

        value = getattr(owner, attribute, None)
        if isinstance(value, bool) or not isinstance(value, int):
            raise StateOperationError("目标不是整数属性：{}".format(target))
        return value

    @staticmethod
    def _set_integer_attribute(
        owner: Any,
        attribute: str,
        value: int,
        target: str,
    ) -> None:
        """仅在目标已有整数属性时写入新整数值。"""

        current = getattr(owner, attribute, None)
        if isinstance(current, bool) or not isinstance(current, int):
            raise StateOperationError("目标不是整数属性：{}".format(target))
        setattr(owner, attribute, value)

    @staticmethod
    def _require_allowed(
        attribute: str,
        allowed_fields: frozenset,
        target: str,
    ) -> None:
        """只允许配置访问显式公开的状态字段。"""

        if attribute not in allowed_fields:
            raise StateOperationError("状态目标未列入白名单：{}".format(target))
