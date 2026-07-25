"""与界面无关的游戏领域模型。"""

from __future__ import annotations

import calendar
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple


@dataclass
class PlayerState:
    """保存一名所长的个人属性与背包资源。"""

    name: str
    health: int
    attack: int
    defense: int
    agility: int
    medical_supplies: int
    food: int
    hunger: int
    intelligence: int
    coins: int
    parts: int
    negative_status: int
    antidotes: int

    def to_dict(self) -> Dict[str, Any]:
        """把玩家状态转换为可写入 JSON 的字典。"""

        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PlayerState":
        """从经过存档层校验的字典恢复玩家状态。"""

        return cls(**data)


@dataclass
class ShelterState:
    """保存所有玩家共享的避难所状态。"""

    population: int
    group_hunger: int
    health: int
    defense_damage: int
    activity: int
    newspapers: int
    books: int
    magazines: int
    toys: int
    game_consoles: int

    def to_dict(self) -> Dict[str, Any]:
        """把避难所状态转换为可写入 JSON 的字典。"""

        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ShelterState":
        """从经过存档层校验的字典恢复避难所状态。"""

        return cls(**data)


@dataclass(frozen=True)
class ClockAdvance:
    """描述一次时间推进跨越了哪些日期边界。"""

    day_changed: bool
    month_changed: bool
    year_changed: bool


@dataclass
class GameClock:
    """维护 2166 年世界中的年、月、日与行动小时。"""

    year: int
    month: int
    day: int
    hour: int

    def advance(
        self, hours: int, day_start_hour: int, day_end_hour: int
    ) -> ClockAdvance:
        """按可行动时段推进时间，并正确处理月、年与闰年边界。"""

        if hours < 0:
            raise ValueError("推进小时数不能为负数")
        if not day_start_hour <= self.hour < day_end_hour:
            raise ValueError("当前小时不在配置的行动时段内")
        playable_hours = day_end_hour - day_start_hour
        if playable_hours <= 0:
            raise ValueError("每日结束时间必须晚于开始时间")

        current_offset = self.hour - day_start_hour
        days_to_advance, next_offset = divmod(current_offset + hours, playable_hours)
        self.hour = day_start_hour + next_offset
        month_changed = False
        year_changed = False
        for _ in range(days_to_advance):
            previous_month = self.month
            previous_year = self.year
            self._advance_one_day()
            month_changed = month_changed or self.month != previous_month
            year_changed = year_changed or self.year != previous_year
        return ClockAdvance(
            day_changed=days_to_advance > 0,
            month_changed=month_changed,
            year_changed=year_changed,
        )

    def _advance_one_day(self) -> None:
        """把日期推进一天，并借助标准库计算当月真实天数。"""

        days_in_month = calendar.monthrange(self.year, self.month)[1]
        self.day += 1
        if self.day <= days_in_month:
            return
        self.day = 1
        self.month += 1
        if self.month <= 12:
            return
        self.month = 1
        self.year += 1

    def to_dict(self) -> Dict[str, int]:
        """把时钟转换为可序列化字典。"""

        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GameClock":
        """从存档字典恢复游戏时钟。"""

        return cls(**data)


@dataclass
class CompanionState:
    """保存剧情伙伴的信任度与当前去向。"""

    companion_id: str
    trust: int
    status: str

    def to_dict(self) -> Dict[str, Any]:
        """把伙伴状态转换为可写入存档的字典。"""

        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CompanionState":
        """从存档字典恢复伙伴状态。"""

        return cls(**data)


@dataclass
class StoryState:
    """保存主线节点、叙事数值与已做出的关键选择。"""

    current_scene_id: str = ""
    chapter_id: str = ""
    humanity: int = 0
    evidence: int = 0
    infection_pressure: int = 0
    completed_scene_ids: List[str] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)
    key_items: List[str] = field(default_factory=list)
    boss_outcomes: Dict[str, str] = field(default_factory=dict)

    def add_flag(self, flag: str) -> None:
        """添加一个不重复的剧情标记。"""

        if flag not in self.flags:
            self.flags.append(flag)

    def add_key_item(self, item_id: str) -> None:
        """添加一个不重复的隐藏关键物品。"""

        if item_id not in self.key_items:
            self.key_items.append(item_id)

    def to_dict(self) -> Dict[str, Any]:
        """把完整剧情状态转换为稳定的 JSON 结构。"""

        return {
            "current_scene_id": self.current_scene_id,
            "chapter_id": self.chapter_id,
            "humanity": self.humanity,
            "evidence": self.evidence,
            "infection_pressure": self.infection_pressure,
            "completed_scene_ids": list(self.completed_scene_ids),
            "flags": list(self.flags),
            "key_items": list(self.key_items),
            "boss_outcomes": dict(self.boss_outcomes),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StoryState":
        """从经过 v2 校验的存档字典恢复剧情状态。"""

        return cls(
            current_scene_id=data["current_scene_id"],
            chapter_id=data["chapter_id"],
            humanity=data["humanity"],
            evidence=data["evidence"],
            infection_pressure=data["infection_pressure"],
            completed_scene_ids=list(data["completed_scene_ids"]),
            flags=list(data["flags"]),
            key_items=list(data["key_items"]),
            boss_outcomes=dict(data["boss_outcomes"]),
        )


@dataclass
class BattleState:
    """保存可中途退出并继续的剧情 Boss 战状态。"""

    boss_id: str
    boss_name: str
    health: int
    max_health: int
    round_number: int = 1
    guarding: bool = False
    focused: bool = False
    finished: bool = False
    victory: bool = False
    retreated: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """把当前 Boss 战状态转换为可序列化字典。"""

        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BattleState":
        """从经过 v2 校验的字典恢复 Boss 战。"""

        return cls(**data)


@dataclass
class PendingExplorationState:
    """保存已抽取但尚未结算的探索事件。"""

    city_id: str
    event_id: str

    def to_dict(self) -> Dict[str, str]:
        """把待结算探索转换为可序列化字典。"""

        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PendingExplorationState":
        """从经过 v2 校验的字典恢复待结算探索。"""

        return cls(**data)


@dataclass
class EndingState:
    """作为游戏是否结束以及结果类型的唯一事实来源。"""

    ending_id: str
    outcome: str
    message: str

    def to_dict(self) -> Dict[str, str]:
        """把结局状态转换为可序列化字典。"""

        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EndingState":
        """从经过 v2 校验的字典恢复结局状态。"""

        return cls(**data)


@dataclass
class GameState:
    """聚合一局游戏中需要保存的全部可变状态。"""

    mode: str
    players: List[PlayerState]
    active_player_index: int
    shelter: ShelterState
    clock: GameClock
    story: StoryState = field(default_factory=StoryState)
    companions: List[CompanionState] = field(default_factory=list)
    facility_levels: Dict[str, int] = field(default_factory=dict)
    battle: Optional[BattleState] = None
    pending_exploration: Optional[PendingExplorationState] = None
    ending: Optional[EndingState] = None
    turn_number: int = 0

    @property
    def active_player(self) -> PlayerState:
        """返回当前负责执行行动的所长。"""

        return self.players[self.active_player_index]

    @property
    def ended(self) -> bool:
        """从唯一结局对象派生本局是否已结束。"""

        return self.ending is not None

    @property
    def victory(self) -> bool:
        """从唯一结局对象派生本局是否以胜利结束。"""

        return self.ending is not None and self.ending.outcome == "victory"

    @property
    def ending_message(self) -> str:
        """从唯一结局对象返回结局文案。"""

        return self.ending.message if self.ending is not None else ""

    def companion(self, companion_id: str) -> Optional[CompanionState]:
        """按稳定英文 ID 查找伙伴状态。"""

        for companion in self.companions:
            if companion.companion_id == companion_id:
                return companion
        return None

    def rotate_player(self) -> None:
        """在多人模式中轮换当前所长，单人模式保持不变。"""

        if len(self.players) > 1:
            self.active_player_index = (self.active_player_index + 1) % len(
                self.players
            )

    def to_dict(self) -> Dict[str, Any]:
        """把聚合状态转换为稳定的 JSON 结构。"""

        return {
            "mode": self.mode,
            "players": [player.to_dict() for player in self.players],
            "active_player_index": self.active_player_index,
            "shelter": self.shelter.to_dict(),
            "clock": self.clock.to_dict(),
            "story": self.story.to_dict(),
            "companions": [companion.to_dict() for companion in self.companions],
            "facility_levels": dict(self.facility_levels),
            "battle": self.battle.to_dict() if self.battle is not None else None,
            "pending_exploration": (
                self.pending_exploration.to_dict()
                if self.pending_exploration is not None
                else None
            ),
            "ending": self.ending.to_dict() if self.ending is not None else None,
            "turn_number": self.turn_number,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GameState":
        """从存档字典恢复聚合状态，并重建嵌套领域对象。"""

        players_data = data["players"]
        return cls(
            mode=data["mode"],
            players=[PlayerState.from_dict(item) for item in players_data],
            active_player_index=data["active_player_index"],
            shelter=ShelterState.from_dict(data["shelter"]),
            clock=GameClock.from_dict(data["clock"]),
            story=StoryState.from_dict(data["story"]),
            companions=[CompanionState.from_dict(item) for item in data["companions"]],
            facility_levels=dict(data["facility_levels"]),
            battle=(
                BattleState.from_dict(data["battle"])
                if data["battle"] is not None
                else None
            ),
            pending_exploration=(
                PendingExplorationState.from_dict(data["pending_exploration"])
                if data["pending_exploration"] is not None
                else None
            ),
            ending=(
                EndingState.from_dict(data["ending"])
                if data["ending"] is not None
                else None
            ),
            turn_number=data["turn_number"],
        )


@dataclass(frozen=True)
class EventChoice:
    """表示探索事件中可由玩家选择的一个分支。"""

    choice_id: str
    label: str


@dataclass(frozen=True)
class EventPrompt:
    """表示探索事件在应用效果前展示给界面的内容。"""

    event_id: str
    title: str
    intro: str
    choices: Tuple[EventChoice, ...]


@dataclass(frozen=True)
class EventResolution:
    """表示事件是否成功应用以及应展示的结果文案。"""

    message: str
    applied: bool


@dataclass(frozen=True)
class StoryChoice:
    """表示主线场景中的一个玩家选择。"""

    choice_id: str
    label: str
    available: bool = True
    locked_reason: str = ""


@dataclass(frozen=True)
class StoryPrompt:
    """表示当前主线场景、目标与可选分支。"""

    scene_id: str
    chapter_title: str
    title: str
    body: str
    objective: str
    choices: Tuple[StoryChoice, ...]
    locked_reason: str = ""


@dataclass(frozen=True)
class StoryStatus:
    """提供给界面的简洁章节和任务状态。"""

    chapter_title: str
    mission_title: str
    objective: str
    progress_text: str


@dataclass(frozen=True)
class CombatReport:
    """描述一次战斗操作的消息与战斗终态。"""

    messages: Tuple[str, ...]
    finished: bool
    victory: bool
    retreated: bool


@dataclass(frozen=True)
class ActionReport:
    """把一次行动产生的消息和状态结果返回给展示层。"""

    messages: Tuple[str, ...]
    state_changed: bool
    game_over: bool = False

    @classmethod
    def from_messages(
        cls,
        messages: Sequence[str],
        state_changed: bool,
        game_over: bool = False,
    ) -> "ActionReport":
        """便捷创建不可变的行动报告。"""

        return cls(tuple(messages), state_changed, game_over)
