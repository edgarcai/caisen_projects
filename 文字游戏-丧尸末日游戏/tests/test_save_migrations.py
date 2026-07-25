"""验证真实 v1 存档经仓库迁移到 v2 的兼容性和事务边界。"""

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict

from apocalypse_game.ports import SaveDataError
from tests.helpers import QueueRandomSource, build_test_application


class SaveMigrationTests(unittest.TestCase):
    """覆盖未结束、已结束和损坏 v1 存档的完整迁移行为。"""

    def setUp(self) -> None:
        """为每个迁移用例创建独立存档路径和当前版本仓库。"""

        self._temporary_directory = tempfile.TemporaryDirectory()
        self.save_path = Path(self._temporary_directory.name) / "slot" / "save.json"
        self.application = build_test_application(
            self.save_path,
            QueueRandomSource(),
        )

    def tearDown(self) -> None:
        """删除迁移测试产生的主档、备份和临时目录。"""

        self._temporary_directory.cleanup()

    @staticmethod
    def _legacy_player(name: str, offset: int) -> Dict[str, Any]:
        """构造字段集合与旧版 PlayerState 完全一致的玩家数据。"""

        return {
            "name": name,
            "health": 92 - offset,
            "attack": 12 + offset,
            "defense": 20 + offset,
            "agility": 7 + offset,
            "medical_supplies": 4 + offset,
            "food": 33 - offset,
            "hunger": 22 + offset,
            "intelligence": 101 + offset,
            "coins": 123 - offset,
            "parts": 45 - offset,
            "negative_status": offset % 2,
            "antidotes": 2,
        }

    def _unfinished_v1_document(self) -> Dict[str, Any]:
        """构造一份包含双人轮换和非默认数值的合法未结束 v1 存档。"""

        return {
            "schema_version": 1,
            "saved_at": "2023-08-20T12:34:56+00:00",
            "game_state": {
                "mode": "multiplayer",
                "players": [
                    self._legacy_player("旧所长甲", 1),
                    self._legacy_player("旧所长乙", 2),
                ],
                "active_player_index": 1,
                "shelter": {
                    "population": 5,
                    "group_hunger": 88,
                    "health": 432,
                    "defense_damage": 27,
                    "activity": 123,
                    "newspapers": 2,
                    "books": 3,
                    "magazines": 4,
                    "toys": 5,
                    "game_consoles": 1,
                },
                "clock": {
                    "year": 2167,
                    "month": 12,
                    "day": 30,
                    "hour": 17,
                },
                "turn_number": 347,
                "ended": False,
                "ending_message": "",
            },
        }

    def _finished_v1_document(self) -> Dict[str, Any]:
        """从合法旧档构造具有真实失败状态和旧结局文案的 v1 存档。"""

        document = self._unfinished_v1_document()
        state = document["game_state"]
        state["players"][1]["health"] = 0
        state["ended"] = True
        state["ending_message"] = "旧档中，第二位所长伤势过重倒下了。"
        return document

    def _write_document(self, document: Dict[str, Any]) -> None:
        """把测试存档写到当前应用仓库绑定的主档位置。"""

        self.save_path.parent.mkdir(parents=True, exist_ok=True)
        self.save_path.write_text(
            json.dumps(document, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _migration_configuration(self) -> Dict[str, Any]:
        """读取正式 v1 到 v2 迁移配置作为默认状态断言来源。"""

        path = self.application.config.resolve_path("save_migration_v1_to_v2")
        return json.loads(path.read_text(encoding="utf-8"))

    def assert_legacy_state_preserved(
        self,
        legacy_state: Dict[str, Any],
    ) -> None:
        """断言迁移没有改变旧玩家、避难所、时间、轮换和回合数据。"""

        migrated = self.application.state
        self.assertEqual(legacy_state["mode"], migrated.mode)
        self.assertEqual(
            legacy_state["players"], [player.to_dict() for player in migrated.players]
        )
        self.assertEqual(
            legacy_state["active_player_index"], migrated.active_player_index
        )
        self.assertEqual(
            legacy_state["players"][legacy_state["active_player_index"]]["name"],
            migrated.active_player.name,
        )
        self.assertEqual(legacy_state["shelter"], migrated.shelter.to_dict())
        self.assertEqual(legacy_state["clock"], migrated.clock.to_dict())
        self.assertEqual(legacy_state["turn_number"], migrated.turn_number)

    def assert_v2_defaults_added(self, expect_ending: bool) -> None:
        """断言迁移补齐剧情、伙伴、设施和进行中交互的固定默认值。"""

        defaults = self._migration_configuration()["state_defaults"]
        state = self.application.state
        self.assertEqual(defaults["story"], state.story.to_dict())
        self.assertEqual(
            defaults["companions"],
            [companion.to_dict() for companion in state.companions],
        )
        self.assertEqual(defaults["facility_levels"], state.facility_levels)
        self.assertIsNone(state.battle)
        self.assertIsNone(state.pending_exploration)
        if expect_ending:
            self.assertIsNotNone(state.ending)
        else:
            self.assertIsNone(state.ending)

    def test_unfinished_v1_loads_and_can_be_saved_as_schema_two(self) -> None:
        """未结束 v1 档应完整迁移，并在主动保存后落为 schema 2。"""

        document = self._unfinished_v1_document()
        legacy_state = deepcopy(document["game_state"])
        self._write_document(document)

        report = self.application.load_game()
        self.assertTrue(report.state_changed)
        self.assertFalse(report.game_over)
        self.assert_legacy_state_preserved(legacy_state)
        self.assert_v2_defaults_added(expect_ending=False)

        self.application.save_game()
        saved_document = json.loads(self.save_path.read_text(encoding="utf-8"))
        self.assertEqual(2, saved_document["schema_version"])
        self.assertNotIn("ended", saved_document["game_state"])
        self.assertNotIn("ending_message", saved_document["game_state"])
        self.assertIn("story", saved_document["game_state"])
        self.assertIsNone(saved_document["game_state"]["ending"])

    def test_finished_v1_maps_to_single_failure_ending_state(self) -> None:
        """已结束 v1 档应保留旧文案并映射为唯一 failure EndingState。"""

        document = self._finished_v1_document()
        legacy_state = deepcopy(document["game_state"])
        self._write_document(document)

        report = self.application.load_game()
        self.assertTrue(report.game_over)
        self.assert_legacy_state_preserved(legacy_state)
        self.assert_v2_defaults_added(expect_ending=True)
        self.assertTrue(self.application.state.ended)
        self.assertFalse(self.application.state.victory)
        self.assertEqual("legacy_failure", self.application.state.ending.ending_id)
        self.assertEqual("failure", self.application.state.ending.outcome)
        self.assertEqual(
            legacy_state["ending_message"],
            self.application.state.ending.message,
        )

    def test_invalid_v1_load_does_not_replace_current_application_state(self) -> None:
        """损坏 v1 档迁移失败时不得覆盖当前正在运行的完整状态。"""

        self.application.start_new_game(["当前所长"], "single")
        self.application.state.active_player.coins = 321
        current_state = self.application.state.to_dict()
        invalid_document = self._unfinished_v1_document()
        del invalid_document["game_state"]["clock"]["hour"]
        self._write_document(invalid_document)

        with self.assertRaises(SaveDataError):
            self.application.load_game()
        self.assertEqual(current_state, self.application.state.to_dict())


if __name__ == "__main__":
    unittest.main()
