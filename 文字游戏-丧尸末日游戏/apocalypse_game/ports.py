"""定义应用层依赖的最小外部接口。"""

from __future__ import annotations

from typing import Protocol, Sequence, TypeVar

from apocalypse_game.domain import GameState


ItemType = TypeVar("ItemType")


class SaveDataError(RuntimeError):
    """表示持久化端口无法安全保存或恢复游戏状态。"""


class SaveRepository(Protocol):
    """定义游戏存档仓库需要提供的行为。"""

    def exists(self) -> bool:
        """返回主存档是否存在。"""

    def save(self, state: GameState) -> None:
        """原子保存一份完整游戏状态。"""

    def load(self) -> GameState:
        """读取并校验一份完整游戏状态。"""


class RandomSource(Protocol):
    """隔离业务逻辑与全局随机模块，便于稳定测试。"""

    def randint(self, minimum: int, maximum: int) -> int:
        """返回闭区间内的一个整数。"""

    def weighted_choice(
        self, items: Sequence[ItemType], weights: Sequence[int]
    ) -> ItemType:
        """按对应权重从候选序列中选择一项。"""
