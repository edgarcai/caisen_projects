"""文件存档与随机数源等基础设施实现。"""

from __future__ import annotations

import copy
import json
import os
import random
import shutil
import tempfile
from calendar import IllegalMonthError, monthrange
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Mapping, Protocol, Sequence, TypeVar

from apocalypse_game.domain import GameState
from apocalypse_game.ports import SaveDataError


ItemType = TypeVar("ItemType")


class StdRandomSource:
    """使用独立 ``random.Random`` 实例提供可注入随机数。"""

    def __init__(self, seed: int = None) -> None:
        """可选使用固定种子初始化随机数源。"""

        self._random = random.Random(seed)

    def randint(self, minimum: int, maximum: int) -> int:
        """返回闭区间内的随机整数。"""

        return self._random.randint(minimum, maximum)

    def weighted_choice(
        self, items: Sequence[ItemType], weights: Sequence[int]
    ) -> ItemType:
        """按权重选择一个候选项。"""

        if not items or len(items) != len(weights):
            raise ValueError("候选项与权重必须非空且长度一致")
        return self._random.choices(list(items), weights=list(weights), k=1)[0]


class SaveMigrator(Protocol):
    """定义单步存档版本迁移器的最小接口。"""

    from_version: int
    to_version: int

    def migrate(self, document: Mapping[str, Any]) -> Dict[str, Any]:
        """把已通过旧版结构校验的文档迁移到下一版。"""


class V1ToV2SaveMigrator:
    """使用版本固定的配置默认值将 v1 存档迁移到 v2。"""

    from_version = 1
    to_version = 2

    def __init__(self, configuration: Mapping[str, Any]) -> None:
        """校验并保存不随新游戏默认值变化的迁移配置。"""

        self._validate_configuration(configuration)
        self._state_defaults = copy.deepcopy(configuration["state_defaults"])
        self._legacy_failure = copy.deepcopy(configuration["legacy_failure"])

    @classmethod
    def from_path(cls, path: Path) -> "V1ToV2SaveMigrator":
        """从 UTF-8 JSON 文件读取并构建 v1 到 v2 迁移器。"""

        try:
            with path.open("r", encoding="utf-8") as handle:
                configuration = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise SaveDataError("无法读取存档迁移配置：{}".format(error)) from error
        if not isinstance(configuration, Mapping):
            raise SaveDataError("存档迁移配置顶层必须是对象")
        return cls(configuration)

    def migrate(self, document: Mapping[str, Any]) -> Dict[str, Any]:
        """保留 v1 生存数据，并在副本上补全 v2 剧情状态。"""

        migrated = copy.deepcopy(dict(document))
        state = copy.deepcopy(dict(migrated["game_state"]))
        was_ended = state.pop("ended")
        old_message = state.pop("ending_message")
        for field_name, default_value in self._state_defaults.items():
            state[field_name] = copy.deepcopy(default_value)
        if was_ended:
            state["ending"] = {
                "ending_id": self._legacy_failure["ending_id"],
                "outcome": self._legacy_failure["outcome"],
                "message": old_message,
            }
        migrated["schema_version"] = self.to_version
        migrated["game_state"] = state
        return migrated

    @staticmethod
    def _validate_configuration(configuration: Mapping[str, Any]) -> None:
        """严格校验迁移配置的版本、默认状态与旧档结局映射。"""

        required_fields = {
            "schema_version",
            "from_version",
            "to_version",
            "state_defaults",
            "legacy_failure",
        }
        if set(configuration) != required_fields:
            raise SaveDataError("存档迁移配置字段集合不匹配")
        if configuration["schema_version"] != 1:
            raise SaveDataError("不支持的迁移配置版本")
        if configuration["from_version"] != 1 or configuration["to_version"] != 2:
            raise SaveDataError("迁移配置版本链必须为 1 到 2")
        defaults = configuration["state_defaults"]
        required_default_fields = {
            "story",
            "companions",
            "facility_levels",
            "battle",
            "pending_exploration",
            "ending",
        }
        if (
            not isinstance(defaults, Mapping)
            or set(defaults) != required_default_fields
        ):
            raise SaveDataError("迁移默认状态字段集合不匹配")
        legacy_failure = configuration["legacy_failure"]
        if not isinstance(legacy_failure, Mapping) or set(legacy_failure) != {
            "ending_id",
            "outcome",
        }:
            raise SaveDataError("旧档失败结局映射无效")
        if (
            not isinstance(legacy_failure["ending_id"], str)
            or not legacy_failure["ending_id"]
        ):
            raise SaveDataError("旧档失败结局 ID 无效")
        if legacy_failure["outcome"] != "failure":
            raise SaveDataError("旧档结局类型必须为 failure")


class JsonSaveRepository:
    """以版本化 JSON 和原子替换方式持久化游戏状态。"""

    def __init__(
        self,
        save_path: Path,
        schema_version: int,
        validation_rules: Mapping[str, Any],
        migrators: Sequence[SaveMigrator] = (),
    ) -> None:
        """绑定存档路径、当前版本、校验规则与单步迁移器。"""

        self._save_path = save_path
        self._schema_version = schema_version
        self._validation_rules = validation_rules
        self._migrators: Dict[int, SaveMigrator] = {}
        for migrator in migrators:
            if migrator.from_version in self._migrators:
                raise ValueError(
                    "存档版本 {} 存在重复迁移器".format(migrator.from_version)
                )
            if migrator.to_version != migrator.from_version + 1:
                raise ValueError("存档迁移器必须每次只前进一个版本")
            self._migrators[migrator.from_version] = migrator

    @property
    def save_path(self) -> Path:
        """返回当前仓库使用的绝对存档路径。"""

        return self._save_path

    @property
    def backup_path(self) -> Path:
        """返回主存档对应的最近一次备份路径。"""

        return self._save_path.with_suffix(".bak")

    def exists(self) -> bool:
        """检查主存档或可恢复备份是否存在。"""

        return self._save_path.is_file() or self.backup_path.is_file()

    def save(self, state: GameState) -> None:
        """先写临时文件并同步磁盘，再原子替换主存档。"""

        temporary_name = ""
        try:
            if self._schema_version != 2:
                raise SaveDataError("v2 领域状态只能写入 schema_version=2 的存档")
            self._validate_state(state)
            self._save_path.parent.mkdir(parents=True, exist_ok=True)
            document = {
                "schema_version": self._schema_version,
                "saved_at": datetime.now(timezone.utc).isoformat(),
                "game_state": state.to_dict(),
            }
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=str(self._save_path.parent),
                prefix="save-",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporary_name = handle.name
                json.dump(document, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            if self._save_path.exists() and self._is_valid_save(self._save_path):
                shutil.copy2(self._save_path, self.backup_path)
            os.replace(temporary_name, self._save_path)
            temporary_name = ""
        except (OSError, TypeError, ValueError, SaveDataError) as error:
            raise SaveDataError("无法写入存档：{}".format(error)) from error
        finally:
            if temporary_name:
                try:
                    Path(temporary_name).unlink(missing_ok=True)
                except OSError:
                    pass

    def load(self) -> GameState:
        """读取存档、验证版本与关键结构后恢复领域状态。"""

        if not self.exists():
            raise SaveDataError("存档文件不存在")
        errors = []
        for candidate_path in (self._save_path, self.backup_path):
            if not candidate_path.is_file():
                continue
            try:
                return self._load_path(candidate_path)
            except SaveDataError as error:
                errors.append("{}：{}".format(candidate_path.name, error))
        raise SaveDataError("主存档与备份均不可用（{}）".format("；".join(errors)))

    def _load_path(self, path: Path) -> GameState:
        """从单一路径读取、构造并完整校验游戏状态。"""

        try:
            with path.open("r", encoding="utf-8") as handle:
                document = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise SaveDataError("存档已损坏：{}".format(error)) from error
        prepared_document = self._prepare_document(document)
        try:
            state = GameState.from_dict(prepared_document["game_state"])
            self._validate_state(state)
        except (KeyError, TypeError, ValueError, SaveDataError) as error:
            raise SaveDataError("存档状态字段不完整：{}".format(error)) from error
        return state

    def _is_valid_save(self, path: Path) -> bool:
        """判断现有主档能否作为覆盖前的可信备份。"""

        try:
            self._load_path(path)
        except SaveDataError:
            return False
        return True

    def _prepare_document(self, document: Any) -> Dict[str, Any]:
        """先按源版本严格校验，再逐版迁移并严格校验 v2。"""

        if self._schema_version != 2:
            raise SaveDataError("当前领域模型仅支持读取 schema_version=2")
        self._validate_document_envelope(document)
        prepared = copy.deepcopy(dict(document))
        version = prepared["schema_version"]
        if version > self._schema_version:
            raise SaveDataError("不支持的未来存档版本：{}".format(version))
        if version < 1:
            raise SaveDataError("存档版本必须为正整数")
        while version < self._schema_version:
            if version == 1:
                self._validate_raw_v1_state(prepared["game_state"])
            else:
                raise SaveDataError("缺少存档版本 {} 的结构校验器".format(version))
            migrator = self._migrators.get(version)
            if migrator is None:
                raise SaveDataError(
                    "缺少存档版本 {} 到 {} 的迁移器".format(version, version + 1)
                )
            prepared = migrator.migrate(prepared)
            self._validate_document_envelope(prepared)
            version = prepared["schema_version"]
            if version != migrator.to_version:
                raise SaveDataError("存档迁移器返回了错误的目标版本")
        self._validate_raw_v2_state(prepared["game_state"])
        return prepared

    @staticmethod
    def _validate_document_envelope(document: Any) -> None:
        """严格校验存档顶层字段、版本类型与游戏状态容器。"""

        if not isinstance(document, Mapping):
            raise SaveDataError("存档顶层必须是对象")
        if (
            not {"schema_version", "game_state"}
            <= set(document)
            <= {
                "schema_version",
                "saved_at",
                "game_state",
            }
        ):
            raise SaveDataError("存档顶层字段集合不匹配")
        version = document.get("schema_version")
        if isinstance(version, bool) or not isinstance(version, int):
            raise SaveDataError("schema_version 必须是整数")
        if "saved_at" in document and not isinstance(document["saved_at"], str):
            raise SaveDataError("saved_at 必须是字符串")
        if not isinstance(document.get("game_state"), Mapping):
            raise SaveDataError("存档缺少 game_state")

    @staticmethod
    def _validate_raw_v1_state(state_data: Mapping[str, Any]) -> None:
        """在迁移前按原始 v1 字段集合严格校验旧存档。"""

        required_state_fields = {
            "mode",
            "players",
            "active_player_index",
            "shelter",
            "clock",
            "turn_number",
            "ended",
            "ending_message",
        }
        required_player_fields = {
            "name",
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
        required_shelter_fields = {
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
        required_clock_fields = {"year", "month", "day", "hour"}
        if set(state_data) != required_state_fields:
            raise SaveDataError("game_state 字段集合不匹配")
        players = state_data.get("players")
        if not isinstance(players, list) or any(
            not isinstance(player, Mapping) or set(player) != required_player_fields
            for player in players
        ):
            raise SaveDataError("玩家字段集合不匹配")
        shelter = state_data.get("shelter")
        if not isinstance(shelter, Mapping) or set(shelter) != required_shelter_fields:
            raise SaveDataError("避难所字段集合不匹配")
        clock = state_data.get("clock")
        if not isinstance(clock, Mapping) or set(clock) != required_clock_fields:
            raise SaveDataError("时钟字段集合不匹配")
        if not isinstance(state_data.get("ended"), bool):
            raise SaveDataError("v1 ended 必须是布尔值")
        if not isinstance(state_data.get("ending_message"), str):
            raise SaveDataError("v1 ending_message 必须是字符串")
        if state_data["ended"] and not state_data["ending_message"].strip():
            raise SaveDataError("已结束的 v1 存档缺少结局文案")

    @staticmethod
    def _validate_raw_v2_state(state_data: Mapping[str, Any]) -> None:
        """构造领域对象前严格校验 v2 所有嵌套字段集合。"""

        required_state_fields = {
            "mode",
            "players",
            "active_player_index",
            "shelter",
            "clock",
            "story",
            "companions",
            "facility_levels",
            "battle",
            "pending_exploration",
            "ending",
            "turn_number",
        }
        required_player_fields = {
            "name",
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
        optional_player_fields = {"age", "lifespan"}
        required_shelter_fields = {
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
        optional_shelter_fields = {"hope"}
        required_clock_fields = {"year", "month", "day", "hour"}
        required_story_fields = {
            "current_scene_id",
            "chapter_id",
            "humanity",
            "evidence",
            "infection_pressure",
            "completed_scene_ids",
            "flags",
            "key_items",
            "boss_outcomes",
        }
        required_companion_fields = {"companion_id", "trust", "status"}
        required_battle_fields = {
            "boss_id",
            "boss_name",
            "health",
            "max_health",
            "round_number",
            "guarding",
            "focused",
            "finished",
            "victory",
            "retreated",
        }
        required_pending_fields = {"city_id", "event_id"}
        required_ending_fields = {"ending_id", "outcome", "message"}
        if set(state_data) != required_state_fields:
            raise SaveDataError("v2 game_state 字段集合不匹配")
        players = state_data.get("players")
        if not isinstance(players, list) or any(
            not isinstance(player, Mapping)
            or not required_player_fields <= set(player)
            or not set(player) <= required_player_fields | optional_player_fields
            for player in players
        ):
            raise SaveDataError("v2 玩家字段集合不匹配")
        shelter = state_data.get("shelter")
        if (
            not isinstance(shelter, Mapping)
            or not required_shelter_fields <= set(shelter)
            or not set(shelter) <= required_shelter_fields | optional_shelter_fields
        ):
            raise SaveDataError("v2 避难所字段集合不匹配")
        clock = state_data.get("clock")
        if not isinstance(clock, Mapping) or set(clock) != required_clock_fields:
            raise SaveDataError("v2 时钟字段集合不匹配")
        story = state_data.get("story")
        if not isinstance(story, Mapping) or set(story) != required_story_fields:
            raise SaveDataError("v2 剧情字段集合不匹配")
        companions = state_data.get("companions")
        if not isinstance(companions, list) or any(
            not isinstance(companion, Mapping)
            or set(companion) != required_companion_fields
            for companion in companions
        ):
            raise SaveDataError("v2 伙伴字段集合不匹配")
        if not isinstance(state_data.get("facility_levels"), Mapping):
            raise SaveDataError("v2 facility_levels 必须是对象")
        battle = state_data.get("battle")
        if battle is not None and (
            not isinstance(battle, Mapping) or set(battle) != required_battle_fields
        ):
            raise SaveDataError("v2 战斗字段集合不匹配")
        pending = state_data.get("pending_exploration")
        if pending is not None and (
            not isinstance(pending, Mapping) or set(pending) != required_pending_fields
        ):
            raise SaveDataError("v2 待结算探索字段集合不匹配")
        ending = state_data.get("ending")
        if ending is not None and (
            not isinstance(ending, Mapping) or set(ending) != required_ending_fields
        ):
            raise SaveDataError("v2 结局字段集合不匹配")

    def _validate_state(self, state: GameState) -> None:
        """严格验证模式、玩家、资源、日期和布尔状态的类型与范围。"""

        player_counts = self._validation_rules["player_counts"]
        time_rules = self._validation_rules["time"]
        limits = self._validation_rules["limits"]
        if not isinstance(state.mode, str) or state.mode not in player_counts:
            raise SaveDataError("存档游戏模式无效")
        if not isinstance(state.players, list):
            raise SaveDataError("玩家集合必须是列表")
        mode_limits = player_counts[state.mode]
        if not mode_limits["minimum"] <= len(state.players) <= mode_limits["maximum"]:
            raise SaveDataError("玩家数量与游戏模式不匹配")
        self._require_integer(
            state.active_player_index, "active_player_index", minimum=0
        )
        if state.active_player_index >= len(state.players):
            raise SaveDataError("当前玩家索引越界")
        self._require_integer(state.turn_number, "turn_number", minimum=0)
        if not isinstance(state.ended, bool):
            raise SaveDataError("ended 必须是布尔值")
        if not isinstance(state.ending_message, str):
            raise SaveDataError("ending_message 必须是字符串")

        player_fields = (
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
            "age",
            "lifespan",
        )
        for index, player in enumerate(state.players):
            if not isinstance(player.name, str) or not player.name.strip():
                raise SaveDataError("玩家 {} 姓名无效".format(index))
            for field_name in player_fields:
                self._require_integer(
                    getattr(player, field_name),
                    "players[{}].{}".format(index, field_name),
                    minimum=0,
                )
            if player.health > limits["player_max_health"]:
                raise SaveDataError("玩家生命超过配置上限")
            if player.lifespan < player.age:
                raise SaveDataError("玩家寿命不能小于当前年龄")
        player_names = [player.name.strip() for player in state.players]
        if len(set(player_names)) != len(player_names):
            raise SaveDataError("玩家姓名不能重复")

        shelter_fields = (
            "population",
            "group_hunger",
            "health",
            "defense_damage",
            "newspapers",
            "books",
            "magazines",
            "toys",
            "game_consoles",
            "hope",
        )
        for field_name in shelter_fields:
            self._require_integer(
                getattr(state.shelter, field_name),
                "shelter.{}".format(field_name),
                minimum=0,
            )
        if state.shelter.health > limits["shelter_max_health"]:
            raise SaveDataError("避难所耐久超过配置上限")
        if state.shelter.hope > limits["shelter_max_hope"]:
            raise SaveDataError("避难所希望超过配置上限")
        self._require_integer(state.shelter.activity, "shelter.activity")

        if state.ended:
            if not isinstance(state.story.current_scene_id, str):
                raise SaveDataError("story.current_scene_id 必须是字符串")
        else:
            self._require_non_empty_string(
                state.story.current_scene_id,
                "story.current_scene_id",
            )
        self._require_non_empty_string(state.story.chapter_id, "story.chapter_id")
        self._require_integer(state.story.humanity, "story.humanity")
        self._require_integer(state.story.evidence, "story.evidence", minimum=0)
        self._require_integer(
            state.story.infection_pressure,
            "story.infection_pressure",
            minimum=0,
        )
        self._require_unique_string_list(
            state.story.completed_scene_ids,
            "story.completed_scene_ids",
        )
        self._require_unique_string_list(state.story.flags, "story.flags")
        self._require_unique_string_list(state.story.key_items, "story.key_items")
        self._require_string_mapping(
            state.story.boss_outcomes,
            "story.boss_outcomes",
        )

        if not isinstance(state.companions, list):
            raise SaveDataError("companions 必须是列表")
        companion_ids = []
        for index, companion in enumerate(state.companions):
            self._require_non_empty_string(
                companion.companion_id,
                "companions[{}].companion_id".format(index),
            )
            self._require_integer(
                companion.trust,
                "companions[{}].trust".format(index),
            )
            self._require_non_empty_string(
                companion.status,
                "companions[{}].status".format(index),
            )
            companion_ids.append(companion.companion_id)
        if len(set(companion_ids)) != len(companion_ids):
            raise SaveDataError("伙伴 ID 不能重复")

        if not isinstance(state.facility_levels, dict):
            raise SaveDataError("facility_levels 必须是字典")
        for facility_id, level in state.facility_levels.items():
            self._require_non_empty_string(facility_id, "facility_levels 的设施 ID")
            self._require_integer(
                level,
                "facility_levels.{}".format(facility_id),
                minimum=0,
            )

        if state.battle is not None:
            self._validate_battle(state)
        if state.pending_exploration is not None:
            self._require_non_empty_string(
                state.pending_exploration.city_id,
                "pending_exploration.city_id",
            )
            self._require_non_empty_string(
                state.pending_exploration.event_id,
                "pending_exploration.event_id",
            )
        battle_in_progress = state.battle is not None and not state.battle.finished
        if battle_in_progress and state.pending_exploration is not None:
            raise SaveDataError("不能同时存在进行中的 Boss 战和待结算探索")

        if state.ending is not None:
            self._require_non_empty_string(state.ending.ending_id, "ending.ending_id")
            if state.ending.outcome not in {"victory", "failure"}:
                raise SaveDataError("ending.outcome 只能是 victory 或 failure")
            self._require_non_empty_string(state.ending.message, "ending.message")
            if state.battle is not None or state.pending_exploration is not None:
                raise SaveDataError("已结束存档不能保留进行中交互")

        has_ending_condition = (
            state.shelter.health <= 0
            or any(
                player.health <= 0 or player.hunger >= limits["player_hunger_game_over"]
                for player in state.players
            )
            or state.shelter.group_hunger >= limits["group_hunger_game_over"]
            or state.shelter.activity <= limits["activity_min_game_over"]
            or state.shelter.activity >= limits["activity_max_game_over"]
            or state.shelter.hope <= limits["hope_min_game_over"]
            or any(player.age >= player.lifespan for player in state.players)
        )
        if not state.ended and has_ending_condition:
            raise SaveDataError("未结束存档包含失败状态")

        for field_name in ("year", "month", "day", "hour"):
            self._require_integer(
                getattr(state.clock, field_name),
                "clock.{}".format(field_name),
                minimum=0,
            )
        try:
            days_in_month = monthrange(state.clock.year, state.clock.month)[1]
        except (IllegalMonthError, ValueError) as error:
            raise SaveDataError("存档月份无效") from error
        if state.clock.year < 1 or not 1 <= state.clock.day <= days_in_month:
            raise SaveDataError("存档日期无效")
        if (
            not time_rules["day_start_hour"]
            <= state.clock.hour
            < time_rules["day_end_hour"]
        ):
            raise SaveDataError("存档小时不在行动时段内")

    @staticmethod
    def _require_integer(
        value: Any,
        field_name: str,
        minimum: int = None,
    ) -> None:
        """拒绝布尔冒充整数，并按需检查整数下限。"""

        if isinstance(value, bool) or not isinstance(value, int):
            raise SaveDataError("{} 必须是整数".format(field_name))
        if minimum is not None and value < minimum:
            raise SaveDataError("{} 不能小于 {}".format(field_name, minimum))

    @classmethod
    def _validate_battle(cls, state: GameState) -> None:
        """校验进行中或待收尾 Boss 战的数值与终态一致性。"""

        battle = state.battle
        if battle is None:
            return
        cls._require_non_empty_string(battle.boss_id, "battle.boss_id")
        cls._require_non_empty_string(battle.boss_name, "battle.boss_name")
        cls._require_integer(battle.health, "battle.health", minimum=0)
        cls._require_integer(battle.max_health, "battle.max_health", minimum=1)
        cls._require_integer(battle.round_number, "battle.round_number", minimum=1)
        if battle.health > battle.max_health:
            raise SaveDataError("Boss 当前生命不能超过生命上限")
        for field_name in ("guarding", "focused", "finished", "victory", "retreated"):
            if not isinstance(getattr(battle, field_name), bool):
                raise SaveDataError("battle.{} 必须是布尔值".format(field_name))
        if battle.victory and not battle.finished:
            raise SaveDataError("战斗胜利时 finished 必须为真")
        if battle.retreated and not battle.finished:
            raise SaveDataError("战斗撤退时 finished 必须为真")
        if battle.victory and battle.retreated:
            raise SaveDataError("战斗不能同时胜利和撤退")
        if battle.victory and battle.health != 0:
            raise SaveDataError("战斗胜利时 Boss 生命必须为 0")

    @staticmethod
    def _require_non_empty_string(value: Any, field_name: str) -> None:
        """要求字段为去除首尾空白后仍非空的字符串。"""

        if not isinstance(value, str) or not value.strip():
            raise SaveDataError("{} 必须是非空字符串".format(field_name))

    @classmethod
    def _require_unique_string_list(cls, value: Any, field_name: str) -> None:
        """要求字段为由不重复非空字符串组成的列表。"""

        if not isinstance(value, list):
            raise SaveDataError("{} 必须是列表".format(field_name))
        for item in value:
            cls._require_non_empty_string(item, field_name)
        if len(set(value)) != len(value):
            raise SaveDataError("{} 不能包含重复项".format(field_name))

    @classmethod
    def _require_string_mapping(cls, value: Any, field_name: str) -> None:
        """要求字段为非空字符串到非空字符串的映射。"""

        if not isinstance(value, dict):
            raise SaveDataError("{} 必须是字典".format(field_name))
        for key, item in value.items():
            cls._require_non_empty_string(key, "{} 的键".format(field_name))
            cls._require_non_empty_string(item, "{} 的值".format(field_name))
