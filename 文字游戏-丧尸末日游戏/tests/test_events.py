"""验证配置驱动探索事件的选择、分支与数值效果。"""

import copy
import tempfile
import unittest
from pathlib import Path

from apocalypse_game.application import GameApplicationError
from apocalypse_game.config import GameConfig
from apocalypse_game.events import EventError, ExplorationEventService
from tests.helpers import QueueRandomSource, build_test_application


class RecordingRandomSource(QueueRandomSource):
    """记录最近一次加权抽取参数，便于验证伙伴权重特性。"""

    def __init__(self) -> None:
        """初始化空队列和尚未记录的权重。"""

        super().__init__()
        self.last_weights = ()

    def weighted_choice(self, items, weights):
        """保存权重并稳定返回第一个候选事件。"""

        self.last_weights = tuple(weights)
        return items[0]


class ExplorationEventTests(unittest.TestCase):
    """使用队列随机源精确覆盖主要探索分支。"""

    def setUp(self) -> None:
        """创建临时应用并开始一局单人游戏。"""

        self._temporary_directory = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        """删除测试临时目录。"""

        self._temporary_directory.cleanup()

    def _build_application(self, random_source: QueueRandomSource):
        """使用当前用例的随机队列创建应用。"""

        save_path = Path(self._temporary_directory.name) / "save.json"
        application = build_test_application(save_path, random_source)
        application.start_new_game(["白菜"], "single")
        return application

    def test_bank_event_rewards_configured_coins(self) -> None:
        """A 市的银行事件应按配置奖励金币。"""

        application = self._build_application(
            QueueRandomSource(integers=[77], choice_indexes=[0])
        )
        prompt = application.prepare_exploration("city_a")
        self.assertEqual("bank", prompt.event_id)
        before = application.state.active_player.coins
        report = application.resolve_exploration(prompt.event_id)
        self.assertIn("77", report.messages[0])
        self.assertEqual(before + 77, application.state.active_player.coins)

    def test_companion_perks_modify_discovery_and_ambush_weights(self) -> None:
        """小满与阳关的信任特性必须改变对应探索分类的抽取权重。"""

        random_source = RecordingRandomSource()
        application = self._build_application(random_source)
        state = application.state
        state.companion("yangguan").trust = 1
        xiaoman = state.companion("xiaoman")
        xiaoman.status = "active"
        xiaoman.trust = 1

        application.prepare_exploration("city_a")

        event_ids = application.config.city("city_a")["event_ids"]
        weights = dict(zip(event_ids, random_source.last_weights))
        self.assertEqual(120, weights["bank"])
        self.assertEqual(85, weights["thief"])
        self.assertEqual(400, weights["quiet_street"])

    def test_thief_tracking_can_recover_coins(self) -> None:
        """小偷应先偷钱，再按追踪结果返还配置区间内的金币。"""

        application = self._build_application(
            QueueRandomSource(integers=[7, 35], choice_indexes=[3, 2])
        )
        application.state.active_player.coins = 20
        prompt = application.prepare_exploration("city_a")
        self.assertEqual("thief", prompt.event_id)
        application.resolve_exploration(prompt.event_id, "track")
        self.assertEqual(48, application.state.active_player.coins)

    def test_elder_requirement_prevents_negative_food(self) -> None:
        """食物不足时帮助老人不会扣出负库存或增加攻击。"""

        application = self._build_application(QueueRandomSource())
        state = application.state
        state.active_player.food = 0
        attack_before = state.active_player.attack
        service = ExplorationEventService(application.config, QueueRandomSource())
        resolution = service.resolve("elder", "help", state)
        self.assertEqual(
            application.config.text("event_requirement_failed"), resolution.message
        )
        self.assertFalse(resolution.applied)
        self.assertEqual(0, state.active_player.food)
        self.assertEqual(attack_before, state.active_player.attack)

    def test_commercial_food_store_changes_inventory(self) -> None:
        """商业街食品店结果应增加食物并保留状态下限。"""

        application = self._build_application(
            QueueRandomSource(integers=[21], choice_indexes=[5, 4])
        )
        prompt = application.prepare_exploration("city_a")
        self.assertEqual("commercial_street", prompt.event_id)
        before = application.state.active_player.food
        application.resolve_exploration(prompt.event_id, "enter")
        self.assertEqual(before + 21, application.state.active_player.food)

    def test_pending_event_cannot_be_rerolled_or_forged(self) -> None:
        """应用层必须锁定待结算事件，并拒绝未准备或不匹配的事件 ID。"""

        application = self._build_application(QueueRandomSource(choice_indexes=[0, 3]))
        first = application.prepare_exploration("city_a")
        second = application.prepare_exploration("city_b")
        self.assertEqual(first, second)
        with self.assertRaises(GameApplicationError):
            application.resolve_exploration("thief", "ignore")

        fresh_application = self._build_application(QueueRandomSource())
        with self.assertRaises(GameApplicationError):
            fresh_application.resolve_exploration("bank")

    def test_cancelled_exploration_consumes_turn(self) -> None:
        """看到事件后撤离应清除待结算状态并推进一个回合。"""

        application = self._build_application(QueueRandomSource(choice_indexes=[1]))
        application.prepare_exploration("city_a")
        report = application.cancel_exploration()
        self.assertTrue(report.state_changed)
        self.assertEqual(1, application.state.turn_number)
        with self.assertRaises(GameApplicationError):
            application.resolve_exploration("elder", "leave")

    def test_cancelling_thief_event_applies_configured_prelude_atomically(self) -> None:
        """小偷现身后撤离仍应扣款，并显示由 pre_result 格式化的文案。"""

        application = self._build_application(
            QueueRandomSource(integers=[7], choice_indexes=[3])
        )
        application.state.active_player.coins = 20
        prompt = application.prepare_exploration("city_a")

        report = application.cancel_exploration()

        self.assertEqual("thief", prompt.event_id)
        self.assertEqual(13, application.state.active_player.coins)
        self.assertEqual(
            (
                "他们先摸走了你钱袋中的7枚金币。",
                application.config.text("exploration_abandoned"),
            ),
            report.messages[:2],
        )
        self.assertEqual(1, application.state.turn_number)
        self.assertIsNone(application.state.pending_exploration)

    def test_failed_event_requirement_does_not_consume_turn(self) -> None:
        """资源不足时应锁定原事件，不推进回合也不允许重抽。"""

        application = self._build_application(QueueRandomSource(choice_indexes=[1]))
        application.state.active_player.food = 0
        prompt = application.prepare_exploration("city_a")
        report = application.resolve_exploration(prompt.event_id, "help")
        self.assertFalse(report.state_changed)
        self.assertEqual(0, application.state.turn_number)
        self.assertIsNotNone(application.state.pending_exploration)
        self.assertEqual(
            prompt.event_id,
            application.state.pending_exploration.event_id,
        )
        self.assertEqual(
            prompt,
            application.prepare_exploration("city_b"),
        )

    def test_event_effects_commit_atomically(self) -> None:
        """后续效果无效时，先前效果不得残留在真实状态中。"""

        application = self._build_application(QueueRandomSource())
        events = copy.deepcopy(dict(application.config.events))
        events["atomic_probe"] = {
            "id": "atomic_probe",
            "weight": 1,
            "title": "原子探针",
            "intro": "测试事件",
            "result": "不应成功",
            "effects": [
                {"target": "player.coins", "operation": "add", "amount": 10},
                {"target": "player.coins", "operation": "invalid", "amount": 10},
            ],
        }
        probe_config = GameConfig(
            data=application.config.data,
            events=events,
            project_root=application.config.project_root,
        )
        service = ExplorationEventService(probe_config, QueueRandomSource())
        before = application.state.active_player.coins
        with self.assertRaises(EventError):
            service.resolve("atomic_probe", None, application.state)
        self.assertEqual(before, application.state.active_player.coins)

    def test_every_configured_event_branch_resolves(self) -> None:
        """遍历全部事件叶分支，防止文案变量或效果配置在运行时才崩溃。"""

        application = self._build_application(QueueRandomSource())
        checked = 0
        for event_id, event in application.config.events.items():
            branches = event.get("choices") or [None]
            for branch in branches:
                choice_id = branch["id"] if branch else None
                payload = branch or event
                outcomes = payload.get("outcomes") or [None]
                for outcome_index in range(len(outcomes)):
                    random_source = QueueRandomSource(choice_indexes=[outcome_index])
                    service = ExplorationEventService(application.config, random_source)
                    rich_state = copy.deepcopy(application.state)
                    rich_state.active_player.food = 100
                    rich_state.active_player.coins = 100
                    rich_state.active_player.parts = 100
                    resolution = service.resolve(event_id, choice_id, rich_state)
                    self.assertTrue(resolution.message)
                    checked += 1
        self.assertEqual(25, checked)


if __name__ == "__main__":
    unittest.main()
