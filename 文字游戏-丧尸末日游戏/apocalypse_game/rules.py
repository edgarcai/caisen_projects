"""游戏回合消耗、状态钳制与失败判定规则。"""

from __future__ import annotations

from typing import List, Optional, Protocol

from apocalypse_game.config import GameConfig
from apocalypse_game.domain import EndingState, GameState


class RuleModifierProvider(Protocol):
    """定义设施和招募对基础生存规则提供修正的最小接口。"""

    def passive_modifier(self, state: GameState, target: str) -> int:
        """返回指定 rules.* 目标的累计配置修正。"""


class GameRules:
    """集中执行所有与界面无关的生存数值规则。"""

    def __init__(
        self,
        config: GameConfig,
        modifier_provider: Optional[RuleModifierProvider] = None,
    ) -> None:
        """从统一配置中读取时间、阈值和每回合消耗。"""

        self._config = config
        rules = config.section("rules")
        self._time = rules["time"]
        self._limits = rules["limits"]
        self._turn_costs = rules["turn_costs"]
        self._failure_endings = rules["failure_endings"]
        self._modifiers = modifier_provider

    @property
    def limits(self):
        """返回供应用层复用的数值上限配置。"""

        return self._limits

    def advance_turn(
        self,
        state: GameState,
        rotate_player: bool = True,
        turns: int = 1,
    ) -> List[str]:
        """结算一个或多个生存回合，并在整项行动结束后轮换玩家。"""

        if state.ended:
            return [state.ending_message]
        if isinstance(turns, bool) or not isinstance(turns, int) or turns < 1:
            raise ValueError("生存回合数必须是正整数")
        messages: List[str] = []
        for _ in range(turns):
            messages.extend(self._advance_single_turn(state))
            if state.ended:
                return messages
        if rotate_player:
            state.rotate_player()
        if rotate_player and len(state.players) > 1:
            messages.append(
                self._config.text("next_player", player_name=state.active_player.name)
            )
        return messages

    def _advance_single_turn(self, state: GameState) -> List[str]:
        """结算一个基础行动时段的消耗、日历边界、产出与失败。"""

        negative_health_loss_percent = 100 + self._modifier(
            state,
            "rules.negative_status_health_loss_percent",
        )
        for player in state.players:
            player.health -= max(
                0,
                self._turn_costs["health_loss_per_negative_status"]
                * player.negative_status
                * negative_health_loss_percent
                // 100,
            )
            player.hunger += self._turn_costs["player_hunger_gain"]
        shelter_damage_percent = 100 + self._modifier(
            state, "rules.shelter_turn_damage_percent"
        )
        shelter_damage = max(
            0,
            self._turn_costs["shelter_health_loss"] * shelter_damage_percent // 100,
        )
        state.shelter.health -= shelter_damage
        group_hunger_percent = 100 + self._modifier(
            state, "rules.group_hunger_gain_percent"
        )
        group_hunger_gain = max(
            0,
            self._turn_costs["group_hunger_gain_per_person"]
            * state.shelter.population
            * group_hunger_percent
            // 100,
        )
        state.shelter.group_hunger += group_hunger_gain
        state.shelter.activity -= self._turn_costs["activity_loss"]
        state.turn_number += 1

        advance = state.clock.advance(
            self._time["hours_per_action"],
            self._time["day_start_hour"],
            self._time["day_end_hour"],
        )
        self.normalize(state)
        messages: List[str] = []
        if advance.day_changed:
            messages.append(self._config.text("turn_day"))
            food_produced = max(
                0,
                self._modifier(state, "rules.daily_food_production"),
            )
            if food_produced:
                state.active_player.food += food_produced
                messages.append(
                    self._config.text("daily_food_produced", produced=food_produced)
                )
        if advance.month_changed:
            messages.append(self._config.text("turn_month"))
        if advance.year_changed:
            messages.append(self._config.text("turn_year"))

        ending = self.check_failure(state)
        if ending is not None:
            state.ending = ending
            messages.append(ending.message)
        return messages

    def normalize(self, state: GameState) -> None:
        """集中维护库存非负、生命上限和避难所耐久上限等不变量。"""

        non_negative_player_fields = (
            "health",
            "medical_supplies",
            "food",
            "hunger",
            "coins",
            "parts",
            "negative_status",
            "antidotes",
        )
        for player in state.players:
            for field_name in non_negative_player_fields:
                setattr(player, field_name, max(getattr(player, field_name), 0))
            player.health = min(player.health, self._limits["player_max_health"])
        state.shelter.health = max(
            0,
            min(state.shelter.health, self._limits["shelter_max_health"]),
        )
        state.shelter.group_hunger = max(state.shelter.group_hunger, 0)
        for field_name in (
            "population",
            "defense_damage",
            "newspapers",
            "books",
            "magazines",
            "toys",
            "game_consoles",
        ):
            setattr(
                state.shelter, field_name, max(getattr(state.shelter, field_name), 0)
            )

    def check_game_over(self, state: GameState) -> Optional[str]:
        """按固定优先级检查所有配置化失败条件。"""

        ending = self.check_failure(state)
        return ending.message if ending is not None else None

    def check_failure(self, state: GameState) -> Optional[EndingState]:
        """按固定优先级构造单一来源的失败结局对象。"""

        if state.shelter.health <= 0:
            return self._failure_ending("shelter", state.mode)
        for player in state.players:
            if player.health <= 0:
                return self._failure_ending(
                    "player_health",
                    state.mode,
                    player_name=player.name,
                )
            if player.hunger >= self._limits["player_hunger_game_over"]:
                return self._failure_ending(
                    "player_hunger",
                    state.mode,
                    player_name=player.name,
                )
        if state.shelter.group_hunger >= self._limits["group_hunger_game_over"]:
            return self._failure_ending("group_hunger", state.mode)
        if state.shelter.activity <= self._limits["activity_min_game_over"]:
            return self._failure_ending("activity_low", state.mode)
        if state.shelter.activity >= self._limits["activity_max_game_over"]:
            return self._failure_ending("activity_high", state.mode)
        return None

    def _modifier(self, state: GameState, target: str) -> int:
        """读取可选规则修正提供者的累计值，无提供者时返回零。"""

        if self._modifiers is None:
            return 0
        return self._modifiers.passive_modifier(state, target)

    def combat_failure(self, player_name: str, mode: str) -> EndingState:
        """按当前模式为 Boss 战中倒下的所长构造配置化失败结局。"""

        return self._failure_ending("combat", mode, player_name=player_name)

    def _failure_ending(
        self,
        failure_id: str,
        mode: str,
        **values: str,
    ) -> EndingState:
        """根据失败类型和游戏模式创建单一来源的结局对象。"""

        failure = self._failure_endings[failure_id]
        text_key = failure.get("mode_text_keys", {}).get(mode, failure["text_key"])
        return EndingState(
            ending_id=failure["ending_id"],
            outcome="failure",
            message=self._config.text(text_key, **values),
        )
