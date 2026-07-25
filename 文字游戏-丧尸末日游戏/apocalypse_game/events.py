"""配置驱动的城市探索事件解析器。"""

from __future__ import annotations

import copy
from typing import Any, Dict, Mapping, Optional, Sequence

from apocalypse_game.config import GameConfig
from apocalypse_game.domain import EventChoice, EventPrompt, EventResolution, GameState
from apocalypse_game.ports import RandomSource


class EventError(RuntimeError):
    """表示探索事件或玩家选择不合法。"""


class ExplorationEventService:
    """负责选择、校验并应用配置化探索事件。"""

    def __init__(self, config: GameConfig, random_source: RandomSource) -> None:
        """注入统一配置与可替换的随机数源。"""

        self._config = config
        self._random = random_source

    def prepare(
        self,
        city_id: str,
        weight_modifiers: Optional[Mapping[str, int]] = None,
    ) -> EventPrompt:
        """按伙伴与设施的分类权重修正抽取城市事件。"""

        city = self._config.city(city_id)
        event_ids = city.get("event_ids")
        if not isinstance(event_ids, list) or not event_ids:
            raise EventError("城市 {} 没有配置探索事件".format(city_id))
        try:
            events = [self._config.events[event_id] for event_id in event_ids]
        except KeyError as error:
            raise EventError("城市引用了不存在的事件：{}".format(error)) from error
        modifiers = weight_modifiers or {}
        weights = [
            item["weight"]
            * max(1, 100 + modifiers.get(item.get("category", "common"), 0))
            for item in events
        ]
        event = self._random.weighted_choice(events, weights)
        return self._build_prompt(event)

    def prompt(self, event_id: str) -> EventPrompt:
        """按已持久化事件 ID 重建提示，不重新抽取随机事件。"""

        event = self._config.events.get(event_id)
        if event is None:
            raise EventError("未知探索事件：{}".format(event_id))
        return self._build_prompt(event)

    @staticmethod
    def _build_prompt(event: Mapping[str, Any]) -> EventPrompt:
        """把一个事件配置转换为不可变的界面提示对象。"""

        choices_value = event.get("choices", [])
        choices = tuple(
            EventChoice(choice_id=item["id"], label=item["label"])
            for item in choices_value
        )
        return EventPrompt(
            event_id=event["id"],
            title=event["title"],
            intro=event["intro"],
            choices=choices,
        )

    def resolve(
        self,
        event_id: str,
        choice_id: Optional[str],
        state: GameState,
    ) -> EventResolution:
        """在状态副本上完整解析事件，成功后再原子提交全部效果。"""

        event = self._config.events.get(event_id)
        if event is None:
            raise EventError("未知探索事件：{}".format(event_id))
        payload = self._resolve_choice(event, choice_id)
        requirements = payload.get("requirements", [])
        if not self._requirements_met(requirements, state):
            return EventResolution(
                message=self._config.text("event_requirement_failed"),
                applied=False,
            )
        resolved_payload = self._select_outcome(payload)
        working_state = copy.deepcopy(state)
        effects = list(event.get("pre_effects", []))
        if resolved_payload is not event:
            effects.extend(event.get("effects", []))
        effects.extend(resolved_payload.get("effects", []))
        tokens = self._apply_effects(effects, working_state)
        result_template = resolved_payload.get("result")
        if not isinstance(result_template, str):
            raise EventError("事件 {} 缺少结果文案".format(event_id))
        try:
            result_message = result_template.format(**tokens)
            pre_result = event.get("pre_result")
            if pre_result:
                result_message = "{} {}".format(
                    pre_result.format(**tokens),
                    result_message,
                )
        except (KeyError, ValueError, IndexError) as error:
            raise EventError(
                "事件 {} 文案缺少变量：{}".format(event_id, error)
            ) from error
        self._commit_state(working_state, state)
        return EventResolution(message=result_message, applied=True)

    def _resolve_choice(
        self,
        event: Mapping[str, Any],
        choice_id: Optional[str],
    ) -> Mapping[str, Any]:
        """根据事件定义返回玩家选中的分支配置。"""

        choices = event.get("choices")
        if not choices:
            if choice_id is not None:
                raise EventError("事件 {} 不接受分支选择".format(event["id"]))
            return event
        if choice_id is None:
            raise EventError("事件 {} 需要玩家选择".format(event["id"]))
        for choice in choices:
            if choice.get("id") == choice_id:
                return choice
        raise EventError("事件 {} 不存在选择 {}".format(event["id"], choice_id))

    def _select_outcome(self, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        """在分支包含随机结果时按配置权重选择其中一个。"""

        outcomes = payload.get("outcomes")
        if not outcomes:
            return payload
        return self._random.weighted_choice(
            outcomes,
            [outcome.get("weight", 1) for outcome in outcomes],
        )

    def _requirements_met(
        self,
        requirements: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> bool:
        """检查一个事件分支声明的全部资源前置条件。"""

        operators = {
            "gte": lambda current, expected: current >= expected,
            "lte": lambda current, expected: current <= expected,
            "eq": lambda current, expected: current == expected,
        }
        for requirement in requirements:
            current = self._read_target(requirement["target"], state)
            operator_name = requirement.get("operator")
            operator = operators.get(operator_name)
            if operator is None:
                raise EventError("不支持的条件运算：{}".format(operator_name))
            if not operator(current, requirement["value"]):
                return False
        return True

    def _apply_effects(
        self,
        effects: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> Dict[str, int]:
        """按顺序应用数值效果，并收集结果文案需要的变量。"""

        tokens: Dict[str, int] = {}
        for effect in effects:
            amount = self._roll_amount(effect.get("amount"))
            current = self._read_target(effect["target"], state)
            operation = effect.get("operation")
            if operation == "subtract" and effect.get("limit_to_available", False):
                amount = min(amount, current)
            if operation == "add":
                next_value = current + amount
            elif operation == "subtract":
                next_value = current - amount
            elif operation == "set":
                next_value = amount
            else:
                raise EventError("不支持的事件操作：{}".format(operation))
            self._write_target(effect["target"], next_value, state)
            token = effect.get("token")
            if token:
                tokens[token] = amount
        return tokens

    def _roll_amount(self, value: Any) -> int:
        """读取固定数值或从配置的闭区间抽取随机数值。"""

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
        raise EventError("事件效果 amount 必须是整数或两个整数构成的区间")

    def _read_target(self, target: str, state: GameState) -> int:
        """安全读取事件允许访问的玩家或避难所数值属性。"""

        owner, attribute = self._resolve_target(target, state)
        value = getattr(owner, attribute, None)
        if not isinstance(value, int):
            raise EventError("事件目标不是整数属性：{}".format(target))
        return value

    def _write_target(self, target: str, value: int, state: GameState) -> None:
        """安全更新事件允许访问的玩家或避难所数值属性。"""

        owner, attribute = self._resolve_target(target, state)
        current = getattr(owner, attribute, None)
        if not isinstance(current, int):
            raise EventError("事件目标不是整数属性：{}".format(target))
        setattr(owner, attribute, value)

    @staticmethod
    def _commit_state(source: GameState, target: GameState) -> None:
        """把验证成功的事件状态一次性提交到原始游戏聚合。"""

        target.players = source.players
        target.active_player_index = source.active_player_index
        target.shelter = source.shelter

    @staticmethod
    def _resolve_target(target: str, state: GameState) -> tuple:
        """把 ``player.stat`` 或 ``shelter.stat`` 解析为对象与属性名。"""

        parts = target.split(".")
        if len(parts) != 2:
            raise EventError("事件目标格式无效：{}".format(target))
        root, attribute = parts
        if root == "player":
            return state.active_player, attribute
        if root == "shelter":
            return state.shelter, attribute
        raise EventError("事件目标根对象无效：{}".format(root))
