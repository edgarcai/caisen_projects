"""验证剧情条件与效果的错误必须在配置加载阶段暴露。"""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, Mapping

from apocalypse_game.config import ConfigError, ConfigLoader
from tests.helpers import CONFIG_PATH, PROJECT_ROOT


DELETE_FIELD = object()


class StoryConfigFailFastTests(unittest.TestCase):
    """使用真实配置的单点变异覆盖加载期安全边界。"""

    def setUp(self) -> None:
        """复制主配置和事件目录，为每个剧情变异准备隔离目录。"""

        self._temporary_directory = tempfile.TemporaryDirectory()
        self._project_root = Path(self._temporary_directory.name)
        self._config_directory = self._project_root / "config"
        self._config_directory.mkdir(parents=True)
        self._main_document = self._load_json(CONFIG_PATH)
        self._story_document = self._load_json(
            PROJECT_ROOT / self._main_document["paths"]["story"]
        )
        event_document = self._load_json(
            PROJECT_ROOT / self._main_document["paths"]["events"]
        )
        self._write_json(
            self._config_directory / "game_config.json",
            self._main_document,
        )
        self._write_json(self._config_directory / "events.json", event_document)

    def tearDown(self) -> None:
        """删除配置变异测试的临时项目目录。"""

        self._temporary_directory.cleanup()

    def test_invalid_requirement_fields_fail_during_loading(self) -> None:
        """各条件类型的缺失字段、越权目标和错误阈值均应被拒绝。"""

        cases = (
            ("attribute_missing_target", "attribute", "target", DELETE_FIELD),
            ("attribute_invalid_operator", "attribute", "operator", "between"),
            ("attribute_non_integer_value", "attribute", "value", "six"),
            (
                "computed_attribute_unknown_target",
                "computed_attribute",
                "target",
                "active_player.unknown_power",
            ),
            (
                "facility_level_missing_facility",
                "facility_level",
                "facility_id",
                DELETE_FIELD,
            ),
            (
                "scene_completed_missing_scene",
                "scene_completed",
                "scene_id",
                DELETE_FIELD,
            ),
            ("flag_missing_id", "flag", "flag_id", DELETE_FIELD),
            (
                "flag_absent_missing_id",
                "flag_absent",
                "flag_id",
                DELETE_FIELD,
            ),
            ("key_item_missing_id", "key_item", "key_item_id", DELETE_FIELD),
            ("any_key_item_empty_ids", "any_key_item", "key_item_ids", []),
            (
                "boss_resolved_missing_id",
                "boss_resolved",
                "boss_id",
                DELETE_FIELD,
            ),
            (
                "boss_outcome_missing_outcomes",
                "boss_outcome_any",
                "outcomes",
                DELETE_FIELD,
            ),
            ("any_of_empty_requirements", "any_of", "requirements", []),
            ("all_of_empty_requirements", "all_of", "requirements", []),
        )

        for case_name, requirement_type, field_name, invalid_value in cases:
            with self.subTest(case_name=case_name):
                document = copy.deepcopy(self._story_document)
                requirement = self._find_requirement(document, requirement_type)
                if invalid_value is DELETE_FIELD:
                    requirement.pop(field_name, None)
                else:
                    requirement[field_name] = invalid_value
                with self.assertRaises(ConfigError):
                    self._load_mutated_story(document)

    def test_unknown_story_effect_target_fails_during_loading(self) -> None:
        """StateOperations 不支持的属性不得通过根名伪装成合法效果。"""

        document = copy.deepcopy(self._story_document)
        first_effect = document["scenes"][0]["choices"][0]["effects"][0]
        first_effect["target"] = "player.nonexistent_stat"

        with self.assertRaises(ConfigError):
            self._load_mutated_story(document)

    def _load_mutated_story(self, document: Mapping[str, Any]) -> None:
        """写入一份变异剧情配置，并调用真实加载器校验。"""

        self._write_json(self._config_directory / "story.json", document)
        ConfigLoader.load(self._config_directory / "game_config.json")

    @staticmethod
    def _find_requirement(
        value: Any,
        requirement_type: str,
    ) -> Dict[str, Any]:
        """递归定位第一个指定类型的剧情条件对象。"""

        if isinstance(value, dict):
            if value.get("type") == requirement_type:
                return value
            for child in value.values():
                try:
                    return StoryConfigFailFastTests._find_requirement(
                        child,
                        requirement_type,
                    )
                except LookupError:
                    continue
        elif isinstance(value, list):
            for child in value:
                try:
                    return StoryConfigFailFastTests._find_requirement(
                        child,
                        requirement_type,
                    )
                except LookupError:
                    continue
        raise LookupError("未找到条件类型：{}".format(requirement_type))

    @staticmethod
    def _load_json(path: Path) -> Dict[str, Any]:
        """读取测试基线 JSON 对象。"""

        with path.open("r", encoding="utf-8") as handle:
            document = json.load(handle)
        if not isinstance(document, dict):
            raise AssertionError("{} 顶层必须是对象".format(path))
        return document

    @staticmethod
    def _write_json(path: Path, document: Mapping[str, Any]) -> None:
        """以 UTF-8 写入测试配置，保留中文便于失败排查。"""

        with path.open("w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    unittest.main()
