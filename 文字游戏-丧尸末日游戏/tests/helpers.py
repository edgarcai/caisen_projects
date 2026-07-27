"""为领域测试提供确定性随机数和应用构建辅助。"""

from __future__ import annotations

from pathlib import Path
from typing import List, Sequence, TypeVar

from apocalypse_game.application import GameApplication
from apocalypse_game.combat import CombatService
from apocalypse_game.config import ConfigLoader
from apocalypse_game.events import ExplorationEventService
from apocalypse_game.infrastructure import JsonSaveRepository, V1ToV2SaveMigrator
from apocalypse_game.rules import GameRules
from apocalypse_game.shelter import ShelterService
from apocalypse_game.state_ops import StateOperations
from apocalypse_game.story import StoryService


ItemType = TypeVar("ItemType")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "game_config.json"


class QueueRandomSource:
    """按队列返回预设结果，使随机事件测试不依赖随机种子细节。"""

    def __init__(
        self,
        integers: Sequence[int] = (),
        choice_indexes: Sequence[int] = (),
    ) -> None:
        """保存将被依次消费的整数与候选索引。"""

        self._integers: List[int] = list(integers)
        self._choice_indexes: List[int] = list(choice_indexes)

    def randint(self, minimum: int, maximum: int) -> int:
        """返回队首整数，并断言其位于调用方要求的区间。"""

        value = self._integers.pop(0) if self._integers else minimum
        if not minimum <= value <= maximum:
            raise AssertionError(
                "预设随机数 {} 不在 [{}, {}]".format(value, minimum, maximum)
            )
        return value

    def weighted_choice(
        self, items: Sequence[ItemType], weights: Sequence[int]
    ) -> ItemType:
        """按预设索引选择候选项，不重新实现权重算法。"""

        if len(items) != len(weights):
            raise AssertionError("候选项与权重长度不一致")
        index = self._choice_indexes.pop(0) if self._choice_indexes else 0
        return items[index]


def build_test_application(
    save_path: Path, random_source: QueueRandomSource
) -> GameApplication:
    """使用真实配置和临时存档路径构建测试应用。"""

    config = ConfigLoader.load(CONFIG_PATH)
    validation_rules = build_save_validation_rules(config)
    operations = StateOperations(random_source)
    story_service = StoryService(config, operations)
    shelter_service = ShelterService(
        config,
        operations,
        story_service,
        random_source,
    )
    return GameApplication(
        config=config,
        event_service=ExplorationEventService(config, random_source),
        story_service=story_service,
        combat_service=CombatService(config.story, random_source, shelter_service),
        shelter_service=shelter_service,
        rules=GameRules(config, shelter_service),
        repository=JsonSaveRepository(
            save_path,
            config.desktop_save_schema_version,
            validation_rules,
            migrators=[
                V1ToV2SaveMigrator.from_path(
                    config.resolve_path("save_migration_v1_to_v2")
                )
            ],
        ),
        random_source=random_source,
    )


def build_save_validation_rules(config):
    """从主配置提取存档层所需的模式、时间与状态上限规则。"""

    rules = config.section("rules")
    return {
        "player_counts": rules["player_counts"],
        "time": rules["time"],
        "limits": rules["limits"],
    }
