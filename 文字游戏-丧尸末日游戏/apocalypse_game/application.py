"""编排剧情、战斗、探索、经营、生存规则与存档的应用服务。"""

from __future__ import annotations

import copy
from typing import List, Optional, Sequence, Tuple

from apocalypse_game.combat import CombatAction, CombatService
from apocalypse_game.config import GameConfig
from apocalypse_game.domain import (
    ActionReport,
    EventPrompt,
    GameClock,
    GameState,
    PendingExplorationState,
    PlayerState,
    ShelterState,
    StoryPrompt,
    StoryStatus,
)
from apocalypse_game.events import ExplorationEventService
from apocalypse_game.ports import RandomSource, SaveRepository
from apocalypse_game.rules import GameRules
from apocalypse_game.shelter import ManagementOption, ShelterService
from apocalypse_game.story import StoryService


class GameApplicationError(RuntimeError):
    """表示当前游戏状态无法执行请求的应用用例。"""


class GameApplication:
    """为界面提供完整游戏用例，并维护整局状态的事务提交边界。"""

    def __init__(
        self,
        config: GameConfig,
        event_service: ExplorationEventService,
        story_service: StoryService,
        combat_service: CombatService,
        shelter_service: ShelterService,
        rules: GameRules,
        repository: SaveRepository,
        random_source: RandomSource,
    ) -> None:
        """通过构造器注入全部服务和端口，应用层只负责编排用例。"""

        self.config = config
        self._events = event_service
        self._story = story_service
        self._combat = combat_service
        self._shelter = shelter_service
        self._rules = rules
        self._repository = repository
        self._random = random_source
        self.state: Optional[GameState] = None

    def start_new_game(self, player_names: Sequence[str], mode: str) -> ActionReport:
        """根据配置创建包含剧情、伙伴、设施和战斗槽位的全新游戏。"""

        clean_names = [name.strip() for name in player_names if name.strip()]
        if not clean_names:
            raise GameApplicationError(self.config.text("invalid_player_name"))
        player_counts = self.config.section("rules")["player_counts"]
        mode_limits = player_counts.get(mode)
        if mode_limits is None:
            raise GameApplicationError(self.config.text("unknown_mode", mode=mode))
        if not mode_limits["minimum"] <= len(clean_names) <= mode_limits["maximum"]:
            raise GameApplicationError(self.config.text("invalid_names"))
        if len(set(clean_names)) != len(clean_names):
            raise GameApplicationError(self.config.text("invalid_names"))

        defaults = self.config.section("defaults")
        time_config = self.config.section("rules")["time"]
        players = [
            PlayerState(name=name, **dict(defaults["player"])) for name in clean_names
        ]
        self.state = GameState(
            mode=mode,
            players=players,
            active_player_index=0,
            shelter=ShelterState(**dict(defaults["shelter"])),
            clock=GameClock(
                year=time_config["start_year"],
                month=time_config["start_month"],
                day=time_config["start_day"],
                hour=time_config["start_hour"],
            ),
            story=self._story.create_story_state(),
            companions=self._story.create_companions(),
            facility_levels=self._story.create_facility_levels(),
        )
        if mode == "multiplayer":
            opening = self.config.text(
                "multiplayer_started", player_names="、".join(clean_names)
            )
        else:
            opening = self.config.text("new_game_started", player_name=clean_names[0])
        return ActionReport.from_messages(
            [opening, self.config.text("story_started")],
            state_changed=True,
        )

    def has_save(self) -> bool:
        """查询是否存在可尝试读取的主存档或备份。"""

        return self._repository.exists()

    def save_game(self) -> ActionReport:
        """把包含待探索与 Boss 战状态的完整聚合原子写入本地。"""

        state = self._require_state()
        self._repository.save(state)
        message_key = (
            "battle_saved" if self._has_active_battle(state) else "save_success"
        )
        return ActionReport.from_messages(
            [self.config.text(message_key)],
            state_changed=False,
        )

    def load_game(self) -> ActionReport:
        """读取 v2 或迁移后的 v1 存档，并验证剧情引用仍可解析。"""

        candidate_state = self._repository.load()
        self._rules.normalize(candidate_state)
        self._story.status(candidate_state)
        if candidate_state.pending_exploration is not None:
            self._events.prompt(candidate_state.pending_exploration.event_id)
        if self._has_active_battle(candidate_state):
            self._combat.available_actions(candidate_state)
        self.state = candidate_state
        return ActionReport.from_messages(
            [self.config.text("load_success")],
            state_changed=True,
            game_over=self.state.ended,
        )

    def story_status(self) -> StoryStatus:
        """返回主界面可直接展示的当前章节和任务状态。"""

        return self._story.status(self._require_state())

    def current_story_prompt(self) -> Optional[StoryPrompt]:
        """返回当前主线场景；主线结束时返回 ``None``。"""

        return self._story.current_prompt(self._require_state())

    def resolve_story_choice(self, scene_id: str, choice_id: str) -> ActionReport:
        """在整局工作副本上结算剧情选择，并按需启动配置化 Boss 战。"""

        current = self._require_free_playable_state()
        working = copy.deepcopy(current)
        resolution = self._story.resolve_choice(working, scene_id, choice_id)
        if not resolution.applied:
            return ActionReport.from_messages(
                resolution.messages,
                state_changed=False,
            )
        messages = list(resolution.messages)
        if resolution.boss_id is not None:
            percent = self._story.boss_starting_health_percent(
                working, resolution.boss_id
            )
            combat_report = self._combat.start(
                working,
                resolution.boss_id,
                starting_health_percent=percent,
            )
            messages.extend(combat_report.messages)
            self._store_state(working)
            return ActionReport.from_messages(messages, state_changed=True)
        return self._commit_action(
            working,
            messages,
            consumes_turn=resolution.consumes_turn,
        )

    def combat_actions(self) -> Tuple[CombatAction, ...]:
        """返回进行中 Boss 战可用的所有配置化行动。"""

        state = self._require_state()
        return self._combat.available_actions(state)

    def perform_combat_action(self, action_id: str) -> ActionReport:
        """结算一个战斗回合，并处理胜利推进、撤退或战败终局。"""

        current = self._require_playable_state()
        if not self._has_active_battle(current):
            raise GameApplicationError("当前没有正在进行的首领战。")
        working = copy.deepcopy(current)
        boss_id = working.battle.boss_id
        report = self._combat.perform_action(working, action_id)
        messages = list(report.messages)
        if not report.state_changed:
            return ActionReport.from_messages(messages, state_changed=False)
        if not report.finished:
            self._rules.normalize(working)
            self._store_state(working)
            return ActionReport.from_messages(messages, state_changed=True)
        if report.victory:
            story_report = self._story.complete_boss(working, boss_id)
            messages.extend(story_report.messages)
            working.battle = None
            return self._commit_action(
                working,
                messages,
                consumes_turn=story_report.consumes_turn,
                rotate_player=False,
            )
        if report.retreated:
            self._story.abandon_boss_route(working, boss_id)
            return self._commit_action(
                working,
                messages,
                consumes_turn=True,
                rotate_player=False,
            )
        working.battle = None
        working.pending_exploration = None
        fallen_player = min(working.players, key=lambda player: player.health)
        working.ending = self._rules.combat_failure(
            fallen_player.name,
            working.mode,
        )
        if not messages or messages[-1] != working.ending.message:
            messages.append(working.ending.message)
        self._store_state(working)
        return ActionReport.from_messages(
            messages,
            state_changed=True,
            game_over=True,
        )

    def prepare_exploration(self, city_id: str) -> EventPrompt:
        """抽取并持久化城市探索事件，使保存和读档都不能免费重抽。"""

        state = self._require_playable_state()
        if self._has_active_battle(state):
            raise GameApplicationError(self.config.text("battle_in_progress"))
        pending = state.pending_exploration
        if pending is None:
            prompt = self._events.prepare(
                city_id,
                weight_modifiers={
                    "discovery": self._shelter.passive_modifier(
                        state,
                        "rules.discovery_weight_percent",
                    ),
                    "ambush": self._shelter.passive_modifier(
                        state,
                        "rules.ambush_weight_percent",
                    ),
                },
            )
            state.pending_exploration = PendingExplorationState(
                city_id=city_id,
                event_id=prompt.event_id,
            )
            return prompt
        return self._events.prompt(pending.event_id)

    def resolve_exploration(
        self,
        event_id: str,
        choice_id: Optional[str] = None,
    ) -> ActionReport:
        """在聚合副本上结算持久化探索事件并推进一个有效回合。"""

        current = self._require_playable_state()
        pending = current.pending_exploration
        if pending is None:
            raise GameApplicationError(self.config.text("no_pending_event"))
        if pending.event_id != event_id:
            raise GameApplicationError(
                self.config.text(
                    "pending_event_mismatch",
                    expected=pending.event_id,
                    actual=event_id,
                )
            )
        working = copy.deepcopy(current)
        resolution = self._events.resolve(event_id, choice_id, working)
        if not resolution.applied:
            return ActionReport.from_messages(
                [resolution.message],
                state_changed=False,
            )
        working.pending_exploration = None
        return self._commit_action(
            working,
            [resolution.message],
            consumes_turn=True,
        )

    def cancel_exploration(self) -> ActionReport:
        """结算事件开场效果后放弃机会，清除待结算状态并消耗回合。"""

        current = self._require_playable_state()
        pending = current.pending_exploration
        if pending is None:
            raise GameApplicationError(self.config.text("no_pending_event"))
        working = copy.deepcopy(current)
        messages: List[str] = []
        prelude_message = self._events.apply_prelude(pending.event_id, working)
        if prelude_message is not None:
            messages.append(prelude_message)
        messages.append(self.config.text("exploration_abandoned"))
        working.pending_exploration = None
        return self._commit_action(
            working,
            messages,
            consumes_turn=True,
        )

    def management_options(self) -> Tuple[ManagementOption, ...]:
        """返回当前避难所设施、工作、交易与招募选项。"""

        state = self._require_free_playable_state()
        return self._shelter.options(state)

    def shelter_overview(self) -> str:
        """返回避难所经营总览。"""

        return self._shelter.overview(self._require_state())

    def companion_summary(self) -> str:
        """返回伙伴身份、状态、信任和秘密提示。"""

        return self._story.companion_summary(self._require_state())

    def perform_management(self, category: str, option_id: str) -> ActionReport:
        """在整局副本上执行设施、工作、交易或招募命令。"""

        current = self._require_free_playable_state()
        working = copy.deepcopy(current)
        resolution = self._shelter.perform(working, category, option_id)
        if not resolution.applied:
            return ActionReport.from_messages(
                resolution.messages,
                state_changed=False,
            )
        return self._commit_action(
            working,
            list(resolution.messages),
            consumes_turn=resolution.consumes_turn,
            turns_consumed=resolution.turns_consumed,
        )

    def perform_action(self, action_id: str) -> ActionReport:
        """执行物品或基础避难所行动。"""

        handlers = {
            "use_food": self._use_food,
            "use_medicine": self._use_medicine,
            "feed_shelter": self._feed_shelter,
            "repair_shelter": self._repair_shelter,
        }
        handler = handlers.get(action_id)
        if handler is None:
            raise GameApplicationError(
                self.config.text("unknown_action", action_id=action_id)
            )
        return handler()

    def _use_food(self) -> ActionReport:
        """配置化消耗个人食物并降低当前所长饥饿值。"""

        current = self._require_free_playable_state()
        working = copy.deepcopy(current)
        item = self.config.section("rules")["items"]["player_food"]
        player = working.active_player
        cost = self._adjusted_cost(item["cost"], working)
        if player.hunger <= 0:
            return ActionReport.from_messages(
                [self.config.text("food_not_needed", player_name=player.name)],
                state_changed=False,
            )
        if player.food < cost:
            return ActionReport.from_messages(
                [self.config.text("food_failed", cost=cost)],
                state_changed=False,
            )
        player.food -= cost
        before = player.hunger
        reduction = item["hunger_reduction"] + self._shelter.passive_modifier(
            working, "rules.player_food_hunger_reduction"
        )
        player.hunger = max(0, player.hunger - reduction)
        message = self.config.text(
            "food_success", cost=cost, reduced=before - player.hunger
        )
        return self._commit_action(working, [message], consumes_turn=True)

    def _use_medicine(self) -> ActionReport:
        """配置化消耗医疗用品并随机治疗当前所长。"""

        current = self._require_free_playable_state()
        working = copy.deepcopy(current)
        item = self.config.section("rules")["items"]["medical_supplies"]
        player = working.active_player
        cost = item["cost"]
        if player.health >= self._rules.limits["player_max_health"]:
            return ActionReport.from_messages(
                [self.config.text("medicine_not_needed", player_name=player.name)],
                state_changed=False,
            )
        if player.medical_supplies < cost:
            return ActionReport.from_messages(
                [self.config.text("medicine_failed", cost=cost)],
                state_changed=False,
            )
        player.medical_supplies -= cost
        before = player.health
        rolled_heal = self._random.randint(item["heal_min"], item["heal_max"])
        heal_percent = 100 + self._shelter.passive_modifier(
            working, "rules.medicine_heal_percent"
        )
        player.health = min(
            self._rules.limits["player_max_health"],
            player.health + rolled_heal * heal_percent // 100,
        )
        message = self.config.text(
            "medicine_success", cost=cost, healed=player.health - before
        )
        return self._commit_action(working, [message], consumes_turn=True)

    def _feed_shelter(self) -> ActionReport:
        """消耗当前所长食物并降低共享群体饥饿值。"""

        current = self._require_free_playable_state()
        working = copy.deepcopy(current)
        item = self.config.section("rules")["items"]["shelter_food"]
        player = working.active_player
        cost = self._adjusted_cost(item["cost"], working)
        if working.shelter.group_hunger <= 0:
            return ActionReport.from_messages(
                [self.config.text("shelter_food_not_needed")],
                state_changed=False,
            )
        if player.food < cost:
            return ActionReport.from_messages(
                [self.config.text("shelter_food_failed", cost=cost)],
                state_changed=False,
            )
        player.food -= cost
        before = working.shelter.group_hunger
        reduction = item["group_hunger_reduction"] + self._shelter.passive_modifier(
            working, "rules.shelter_food_hunger_reduction"
        )
        working.shelter.group_hunger = max(0, working.shelter.group_hunger - reduction)
        message = self.config.text(
            "shelter_food_success",
            cost=cost,
            reduced=before - working.shelter.group_hunger,
        )
        return self._commit_action(working, [message], consumes_turn=True)

    def _repair_shelter(self) -> ActionReport:
        """消耗零件并按设施加成修复共享避难所耐久。"""

        current = self._require_free_playable_state()
        working = copy.deepcopy(current)
        item = self.config.section("rules")["items"]["shelter_repair"]
        player = working.active_player
        cost = item["parts_cost"]
        if working.shelter.health >= self._rules.limits["shelter_max_health"]:
            return ActionReport.from_messages(
                [self.config.text("repair_not_needed")],
                state_changed=False,
            )
        if player.parts < cost:
            return ActionReport.from_messages(
                [self.config.text("repair_failed", cost=cost)],
                state_changed=False,
            )
        player.parts -= cost
        before = working.shelter.health
        restore = item["health_restore"] + self._shelter.passive_modifier(
            working, "rules.repair_health_restore"
        )
        working.shelter.health = min(
            self._rules.limits["shelter_max_health"],
            working.shelter.health + restore,
        )
        message = self.config.text(
            "repair_success",
            cost=cost,
            restored=working.shelter.health - before,
        )
        return self._commit_action(working, [message], consumes_turn=True)

    def _commit_action(
        self,
        working: GameState,
        messages: List[str],
        consumes_turn: bool,
        rotate_player: bool = True,
        turns_consumed: int = 1,
    ) -> ActionReport:
        """统一完成状态钳制、生存回合、失败优先级与原子聚合替换。"""

        self._rules.normalize(working)
        if consumes_turn and not working.ended:
            messages.extend(
                self._rules.advance_turn(
                    working,
                    rotate_player=rotate_player,
                    turns=turns_consumed,
                )
            )
        if working.ended:
            working.pending_exploration = None
            working.battle = None
        self._store_state(working)
        return ActionReport.from_messages(
            messages,
            state_changed=True,
            game_over=working.ended,
        )

    def _adjusted_cost(self, base_cost: int, state: GameState) -> int:
        """按战地厨房的配置化百分比调整食物消耗且至少为一。"""

        modifier = self._shelter.passive_modifier(state, "rules.food_cost_percent")
        return max(1, base_cost * (100 + modifier) // 100)

    def _store_state(self, source: GameState) -> None:
        """一次性替换聚合字段，同时保留外部持有的 GameState 对象引用。"""

        if self.state is None:
            self.state = source
            return
        self.state.mode = source.mode
        self.state.players = source.players
        self.state.active_player_index = source.active_player_index
        self.state.shelter = source.shelter
        self.state.clock = source.clock
        self.state.story = source.story
        self.state.companions = source.companions
        self.state.facility_levels = source.facility_levels
        self.state.battle = source.battle
        self.state.pending_exploration = source.pending_exploration
        self.state.ending = source.ending
        self.state.turn_number = source.turn_number

    def _require_state(self) -> GameState:
        """返回当前状态，尚未开局时抛出可展示错误。"""

        if self.state is None:
            raise GameApplicationError(self.config.text("game_not_started"))
        return self.state

    def _require_playable_state(self) -> GameState:
        """返回未结束状态，结束后拒绝继续改变玩法数据。"""

        state = self._require_state()
        if state.ended:
            raise GameApplicationError(self.config.text("game_already_over"))
        return state

    def _require_free_playable_state(self) -> GameState:
        """要求没有进行中战斗或待结算探索的可自由行动状态。"""

        state = self._require_playable_state()
        if self._has_active_battle(state):
            raise GameApplicationError(self.config.text("battle_in_progress"))
        if state.pending_exploration is not None:
            raise GameApplicationError("请先结算或取消已经抽取的探索事件。")
        return state

    @staticmethod
    def _has_active_battle(state: GameState) -> bool:
        """判断存档中的 Boss 战是否仍需要继续操作。"""

        return state.battle is not None and not state.battle.finished
