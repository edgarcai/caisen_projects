"""验证完整剧情配置中与运行时接口无关的内容契约。"""

import json
import unittest
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STORY_PATH = PROJECT_ROOT / "config" / "story.json"


def load_story_document() -> Dict[str, Any]:
    """读取剧情 JSON，并要求顶层结构为对象。"""

    with STORY_PATH.open("r", encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise AssertionError("story.json 顶层必须是 JSON 对象")
    return document


def collect_key_values(value: Any, key: str) -> List[Any]:
    """递归收集嵌套 JSON 结构中指定字段的全部值。"""

    collected: List[Any] = []
    if isinstance(value, Mapping):
        for child_key, child_value in value.items():
            if child_key == key:
                collected.append(child_value)
            collected.extend(collect_key_values(child_value, key))
    elif isinstance(value, list):
        for child_value in value:
            collected.extend(collect_key_values(child_value, key))
    return collected


class StoryContentContractTests(unittest.TestCase):
    """固定剧情规模、标识唯一性和场景跳转引用完整性。"""

    def assert_unique_ids(
        self,
        items: Iterable[Mapping[str, Any]],
        id_field: str,
        label: str,
    ) -> List[str]:
        """断言一组内容对象具有非空且互不重复的字符串 ID。"""

        identifiers: List[str] = []
        for index, item in enumerate(items):
            self.assertIsInstance(
                item, Mapping, "{}第{}项必须是对象".format(label, index)
            )
            identifier = item.get(id_field)
            self.assertIsInstance(
                identifier,
                str,
                "{}第{}项缺少字符串字段 {}".format(label, index, id_field),
            )
            self.assertTrue(
                identifier.strip(),
                "{}第{}项的 {} 不能为空".format(label, index, id_field),
            )
            identifiers.append(identifier)
        duplicates = sorted(
            identifier
            for identifier in set(identifiers)
            if identifiers.count(identifier) > 1
        )
        self.assertEqual([], duplicates, "{} ID 重复：{}".format(label, duplicates))
        return identifiers

    def require_list(
        self,
        document: Mapping[str, Any],
        key: str,
        label: str,
    ) -> Sequence[Mapping[str, Any]]:
        """读取必需的非空列表配置，并给出面向内容作者的错误。"""

        items = document.get(key)
        self.assertIsInstance(items, list, "{}必须是列表".format(label))
        self.assertTrue(items, "{}不能为空".format(label))
        return items

    def test_story_json_is_valid_object(self) -> None:
        """story.json 必须存在、使用合法 JSON，并以对象作为顶层。"""

        self.assertTrue(STORY_PATH.is_file(), "缺少 config/story.json")
        try:
            document = load_story_document()
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            self.fail("story.json 无法作为 UTF-8 JSON 读取：{}".format(error))
        self.assertIsInstance(document, dict)

    def test_scene_ids_and_next_scene_references(self) -> None:
        """13 个场景 ID 必须唯一，所有非空后继场景引用必须存在。"""

        document = load_story_document()
        scenes = self.require_list(document, "scenes", "scenes")
        self.assertEqual(13, len(scenes), "完整主线必须包含 13 个场景")
        scene_ids = set(self.assert_unique_ids(scenes, "scene_id", "场景"))

        for next_scene_id in collect_key_values(scenes, "next_scene_id"):
            if next_scene_id is None:
                continue
            self.assertIsInstance(
                next_scene_id, str, "next_scene_id 必须是字符串或 null"
            )
            self.assertIn(
                next_scene_id,
                scene_ids,
                "next_scene_id 引用了不存在的场景：{}".format(next_scene_id),
            )

    def test_choice_ids_are_unique_inside_each_scene(self) -> None:
        """同一场景内的所有选择 ID 必须唯一且非空。"""

        scenes = self.require_list(load_story_document(), "scenes", "scenes")
        for scene in scenes:
            scene_id = scene.get("scene_id", "<unknown>")
            choices = scene.get("choices")
            self.assertIsInstance(
                choices,
                list,
                "场景 {} 的 choices 必须是列表".format(scene_id),
            )
            self.assertTrue(choices, "场景 {} 至少需要一个选择".format(scene_id))
            self.assert_unique_ids(
                choices,
                "choice_id",
                "场景 {} 的选择".format(scene_id),
            )

    def test_boss_ids_are_unique(self) -> None:
        """完整剧情必须配置 3 个具有唯一 ID 的 Boss。"""

        bosses = self.require_list(load_story_document(), "bosses", "bosses")
        self.assertEqual(3, len(bosses), "完整主线必须包含 3 个 Boss")
        self.assert_unique_ids(bosses, "boss_id", "Boss")

    def test_ending_ids_are_unique(self) -> None:
        """完整剧情必须配置 5 个具有唯一 ID 的结局。"""

        endings = self.require_list(load_story_document(), "endings", "endings")
        self.assertEqual(5, len(endings), "完整主线必须包含 5 个结局")
        self.assert_unique_ids(endings, "ending_id", "结局")

    def test_facility_job_and_trade_ids_are_unique(self) -> None:
        """设施、工作及交易内容的稳定 ID 必须在各自命名空间内唯一。"""

        document = load_story_document()
        facilities = self.require_list(document, "facilities", "facilities")
        jobs = self.require_list(document, "jobs", "jobs")
        self.assert_unique_ids(facilities, "facility_id", "设施")
        self.assert_unique_ids(jobs, "job_id", "工作")

        checked_trade_groups = 0
        trades = document.get("trades")
        if isinstance(trades, list) and trades:
            self.assert_unique_ids(trades, "trade_id", "交易")
            checked_trade_groups += 1

        trade = document.get("trade")
        if isinstance(trade, Mapping):
            vendors = trade.get("vendors")
            items = trade.get("items")
            if isinstance(vendors, list) and vendors:
                self.assert_unique_ids(vendors, "vendor_id", "交易商人")
                checked_trade_groups += 1
            if isinstance(items, list) and items:
                self.assert_unique_ids(items, "item_id", "交易物品")
                checked_trade_groups += 1

        self.assertGreater(checked_trade_groups, 0, "至少需要一组可校验 ID 的交易配置")


if __name__ == "__main__":
    unittest.main()
