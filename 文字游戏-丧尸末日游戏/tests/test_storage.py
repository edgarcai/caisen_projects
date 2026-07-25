"""验证 JSON 存档往返、版本和损坏处理。"""

import json
import tempfile
import unittest
from pathlib import Path

from apocalypse_game.config import ConfigLoader
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
