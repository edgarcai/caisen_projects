"""验证 JSON 存档往返、版本和损坏处理。"""

import json
import tempfile
import unittest
from pathlib import Path

from apocalypse_game.config import ConfigLoader
from apocalypse_game.domain import PendingExplorationState
from apocalypse_game.infrastructure import JsonSaveRepository
from apocalypse_game.ports import SaveDataError
from tests.helpers import (
    CONFIG_PATH,
    QueueRandomSource,
    build_save_validation_rules,
    build_test_application,
)


class JsonSaveRepositoryTests(unittest.TestCase):
    """覆盖存档的可恢复性和错误边界。"""

    def setUp(self) -> None:
        """为每个存档用例创建独立路径。"""

        self._temporary_directory = tempfile.TemporaryDirectory()
        self.save_path = Path(self._temporary_directory.name) / "slot" / "save.json"
        self.config = ConfigLoader.load(CONFIG_PATH)
        self.validation_rules = build_save_validation_rules(self.config)

    def tearDown(self) -> None:
        """删除临时存档及其备份。"""

        self._temporary_directory.cleanup()

    @staticmethod
    def _start_rail_butcher_battle(application) -> None:
        """通过公开剧情用例推进至铁轨屠夫战。"""

        route = (
            ("last_pot_of_porridge", "share_rations"),
            ("money_and_secrets", "decrypt_ledger"),
            ("doctor_in_the_rain", "medical_rescue"),
            ("rail_butcher", "call_his_name"),
        )
        for scene_id, choice_id in route:
            report = application.resolve_story_choice(scene_id, choice_id)
            if not report.state_changed:
                raise AssertionError("测试路线未能推进剧情")
        if application.state.battle is None:
            raise AssertionError("测试路线未能启动首领战")

    def test_save_and_load_round_trip(self) -> None:
        """保存后读取应完整恢复玩家、避难所、时钟与模式。"""

        application = build_test_application(self.save_path, QueueRandomSource())
        application.start_new_game(["白菜", "豪菜"], "multiplayer")
        application.state.active_player.food = 5
        application.perform_action("use_food")
        expected = application.state.to_dict()
        application.save_game()
        application.state = None
        application.load_game()
        self.assertEqual(expected, application.state.to_dict())

    def test_retreated_battle_and_pending_exploration_round_trip(self) -> None:
        """撤退整备期应同时保存待探索事件与 Boss 剩余生命。"""

        application = build_test_application(
            self.save_path,
            QueueRandomSource(integers=[1]),
        )
        application.start_new_game(["白菜"], "single")
        self._start_rail_butcher_battle(application)

        application.perform_combat_action("retreat")
        retreated_battle = application.state.battle
        self.assertTrue(retreated_battle.finished)
        self.assertTrue(retreated_battle.retreated)
        self.assertLess(retreated_battle.health, retreated_battle.max_health)
        retreated_health = retreated_battle.health
        prompt = application.prepare_exploration("city_a")

        application.save_game()
        application.state = None
        application.load_game()

        restored_battle = application.state.battle
        restored_pending = application.state.pending_exploration
        self.assertIsNotNone(restored_battle)
        self.assertTrue(restored_battle.finished)
        self.assertTrue(restored_battle.retreated)
        self.assertEqual(retreated_health, restored_battle.health)
        self.assertIsNotNone(restored_pending)
        self.assertEqual(prompt.event_id, restored_pending.event_id)
        self.assertEqual("city_a", restored_pending.city_id)

        application.cancel_exploration()
        application.resolve_story_choice("rail_butcher", "call_his_name")
        self.assertFalse(application.state.battle.finished)
        self.assertFalse(application.state.battle.retreated)
        self.assertEqual(retreated_health, application.state.battle.health)

    def test_active_battle_and_pending_exploration_are_rejected(self) -> None:
        """进行中的首领战仍不得与待结算探索同时入档。"""

        application = build_test_application(self.save_path, QueueRandomSource())
        application.start_new_game(["白菜"], "single")
        self._start_rail_butcher_battle(application)
        application.state.pending_exploration = PendingExplorationState(
            city_id="city_a",
            event_id="bank",
        )

        with self.assertRaises(SaveDataError):
            application.save_game()

    def test_second_save_creates_backup(self) -> None:
        """覆盖现有存档前应保留最近一次备份。"""

        application = build_test_application(self.save_path, QueueRandomSource())
        application.start_new_game(["白菜"], "single")
        application.save_game()
        application.perform_action("use_food")
        application.save_game()
        self.assertTrue(self.save_path.with_suffix(".bak").is_file())

    def test_corrupt_json_raises_clear_error(self) -> None:
        """损坏 JSON 不应被静默吞掉或覆盖。"""

        self.save_path.parent.mkdir(parents=True)
        self.save_path.write_text("{broken", encoding="utf-8")
        repository = JsonSaveRepository(
            self.save_path,
            schema_version=1,
            validation_rules=self.validation_rules,
        )
        with self.assertRaises(SaveDataError):
            repository.load()

    def test_unknown_schema_version_is_rejected(self) -> None:
        """未来版本存档必须显式迁移，不能盲目读取。"""

        self.save_path.parent.mkdir(parents=True)
        self.save_path.write_text(
            '{"schema_version": 99, "game_state": {}}',
            encoding="utf-8",
        )
        repository = JsonSaveRepository(
            self.save_path,
            schema_version=1,
            validation_rules=self.validation_rules,
        )
        with self.assertRaises(SaveDataError):
            repository.load()

    def test_valid_backup_recovers_corrupt_main_save(self) -> None:
        """主档损坏时仓库应自动读取最近一次通过校验的备份。"""

        application = build_test_application(self.save_path, QueueRandomSource())
        application.start_new_game(["白菜"], "single")
        application.save_game()
        application.state.active_player.food = 5
        application.perform_action("use_food")
        application.save_game()
        self.save_path.write_text("{broken", encoding="utf-8")
        recovered = application._repository.load()
        self.assertEqual(0, recovered.turn_number)

    def test_malformed_state_fields_are_rejected(self) -> None:
        """合法 JSON 中的错误类型、日期、小时和模式也必须被拒绝。"""

        application = build_test_application(self.save_path, QueueRandomSource())
        application.start_new_game(["白菜"], "single")
        application.save_game()
        base_document = json.loads(self.save_path.read_text(encoding="utf-8"))
        mutations = (
            lambda state: state["players"][0].__setitem__("health", "100"),
            lambda state: state["clock"].__setitem__("day", 99),
            lambda state: state["clock"].__setitem__("hour", 99),
            lambda state: state.__setitem__("mode", "invalid"),
            lambda state: state.__setitem__("ended", "false"),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                document = json.loads(json.dumps(base_document))
                mutation(document["game_state"])
                self.save_path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaises(SaveDataError):
                    application._repository.load()

    def test_failed_load_preserves_current_application_state(self) -> None:
        """读取坏档失败后不得覆盖当前正在运行的游戏状态。"""

        application = build_test_application(self.save_path, QueueRandomSource())
        application.start_new_game(["当前所长"], "single")
        self.save_path.parent.mkdir(parents=True)
        self.save_path.write_text("{broken", encoding="utf-8")
        with self.assertRaises(SaveDataError):
            application.load_game()
        self.assertEqual("当前所长", application.state.active_player.name)

    def test_save_path_failure_is_wrapped(self) -> None:
        """父路径不可创建时应统一转换为可展示的存档错误。"""

        application = build_test_application(
            Path("/dev/null/save.json"), QueueRandomSource()
        )
        application.start_new_game(["白菜"], "single")
        with self.assertRaises(SaveDataError):
            application.save_game()


if __name__ == "__main__":
    unittest.main()
