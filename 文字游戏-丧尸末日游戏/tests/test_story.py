"""验证主线推进、伙伴关系、Boss 路线与多结局应用契约。"""

import tempfile
import unittest
from pathlib import Path

from apocalypse_game.story import StoryError
from tests.helpers import QueueRandomSource, build_test_application


class StoryApplicationTests(unittest.TestCase):
    """通过真实配置和应用服务覆盖主线最关键的纵向流程。"""

    def setUp(self) -> None:
        """为每个剧情用例创建独立应用和临时存档目录。"""

        self._temporary_directory = tempfile.TemporaryDirectory()
        self.application = self._build_started_application("default")

    def tearDown(self) -> None:
        """清理剧情测试使用的临时目录。"""

        self._temporary_directory.cleanup()

    def _build_started_application(self, slot_name: str):
        """构建使用确定性随机源且已经开始单人游戏的应用。"""

        save_path = Path(self._temporary_directory.name) / "{}.json".format(slot_name)
        application = build_test_application(save_path, QueueRandomSource())
        application.start_new_game(["剧情测试所长"], "single")
        return application

    @staticmethod
    def _move_to_scene(application, scene_id: str, completed_scene_ids) -> None:
        """把测试状态放到一个满足场景入口要求的稳定剧情位置。"""

        scene = application.config.story_scene(scene_id)
        application.state.story.current_scene_id = scene_id
        application.state.story.chapter_id = scene["chapter_id"]
        application.state.story.completed_scene_ids = list(completed_scene_ids)

    def _prepare_final_scene(self, application, ending_id: str) -> str:
        """为指定结局构造满足最终广播选择及其优先级的合法状态。"""

        state = application.state
        prior_scene_ids = [
            scene["scene_id"]
            for scene in application.config.story["scenes"]
            if scene["scene_id"] != "the_last_broadcast"
        ]
        self._move_to_scene(application, "the_last_broadcast", prior_scene_ids)
        state.story.boss_outcomes = {
            "rail_butcher": "spared",
            "chorus_matriarch": "neutralized",
            "uncrowned_king": "guardian_preserved",
        }

        if ending_id == "white_tower_ashes":
            return "detonate_and_evacuate"
        if ending_id == "ember_road":
            state.shelter.population = 4
            state.shelter.health = 100
            state.story.add_flag("everyone_home")
            return "detonate_and_evacuate"
        if ending_id == "long_night_watch":
            state.story.add_flag("guardian_preserved")
            state.story.add_key_item("guardian_truth")
            return "continue_shepherd_protocol"
        if ending_id == "silent_crown":
            state.story.add_key_item("crown_core")
            return "continue_shepherd_protocol"
        if ending_id == "rekindled_dawn":
            state.story.evidence = 6
            state.story.humanity = 6
            state.active_player.antidotes = 1
            for companion_id in ("yangguan", "haocai", "linlan"):
                companion = state.companion(companion_id)
                self.assertIsNotNone(companion)
                companion.trust = 2
            for item_id in (
                "counter_frequency",
                "maintenance_key",
                "hive_memory",
            ):
                state.story.add_key_item(item_id)
            return "broadcast_reversal"
        self.fail("测试未定义结局准备逻辑：{}".format(ending_id))

    def test_new_game_uses_stable_opening_scene_id(self) -> None:
        """新游戏必须使用配置声明的稳定场景 ID，而不是易漂移的序号。"""

        state = self.application.state
        configured_scene_id = self.application.config.story["defaults"]["story_state"][
            "current_scene_id"
        ]
        prompt = self.application.current_story_prompt()

        self.assertEqual("last_pot_of_porridge", configured_scene_id)
        self.assertEqual(configured_scene_id, state.story.current_scene_id)
        self.assertEqual(configured_scene_id, prompt.scene_id)
        self.assertFalse(hasattr(state.story, "scene_index"))

    def test_normal_choice_advances_and_forged_choice_is_atomic(self) -> None:
        """伪造选择必须被拒绝且不留副作用，合法选择随后正常推进。"""

        state = self.application.state
        before_forgery = state.to_dict()
        with self.assertRaises(StoryError):
            self.application.resolve_story_choice(
                "last_pot_of_porridge",
                "forged_choice",
            )
        self.assertEqual(before_forgery, state.to_dict())

        report = self.application.resolve_story_choice(
            "last_pot_of_porridge",
            "give_up_share",
        )
        self.assertTrue(report.state_changed)
        self.assertEqual("money_and_secrets", state.story.current_scene_id)
        self.assertIn("last_pot_of_porridge", state.story.completed_scene_ids)
        self.assertEqual(1, state.turn_number)

    def test_locked_choice_does_not_change_state(self) -> None:
        """资源不足的锁定选择必须保留完整状态且不消耗回合。"""

        state = self.application.state
        state.active_player.food = 0
        prompt = self.application.current_story_prompt()
        share_choice = next(
            choice for choice in prompt.choices if choice.choice_id == "share_rations"
        )
        self.assertFalse(share_choice.available)
        self.assertEqual("食物至少需要 6", share_choice.locked_reason)
        before_choice = state.to_dict()

        report = self.application.resolve_story_choice(
            "last_pot_of_porridge",
            "share_rations",
        )
        self.assertFalse(report.state_changed)
        self.assertFalse(report.game_over)
        self.assertEqual(("条件不足：食物至少需要 6",), report.messages)
        self.assertEqual(before_choice, state.to_dict())

    def test_locked_reason_recursively_describes_any_and_all_requirements(self) -> None:
        """嵌套任一与全部条件应逐层显示具体目标、运算符和阈值。"""

        state = self.application.state
        self._move_to_scene(
            self.application,
            "chorus_matriarch",
            ["the_city_starts_singing"],
        )
        state.active_player.parts = 0
        state.active_player.intelligence = 0
        state.story.flags = []
        state.companion("haocai").trust = 0

        prompt = self.application.current_story_prompt()
        retune_choice = next(
            choice
            for choice in prompt.choices
            if choice.choice_id == "retune_frequency"
        )

        self.assertFalse(retune_choice.available)
        self.assertEqual(
            "需要满足任一条件："
            "需要同时满足：达成剧情状态【小满已加入】；并且 零件至少需要 15；或者 "
            "需要同时满足：智力至少需要 150；并且 豪菜信任至少需要 1",
            retune_choice.locked_reason,
        )

    def test_story_choice_updates_companion_trust_and_status(self) -> None:
        """救援伙伴的剧情效果必须同时更新信任度和加入状态。"""

        state = self.application.state
        self._move_to_scene(
            self.application,
            "doctor_in_the_rain",
            ["last_pot_of_porridge", "money_and_secrets"],
        )
        linlan = state.companion("linlan")
        self.assertIsNotNone(linlan)
        self.assertEqual((0, "locked"), (linlan.trust, linlan.status))

        report = self.application.resolve_story_choice(
            "doctor_in_the_rain",
            "medical_rescue",
        )
        linlan = state.companion("linlan")
        self.assertIsNotNone(linlan)
        self.assertTrue(report.state_changed)
        self.assertEqual((2, "active"), (linlan.trust, linlan.status))
        self.assertIn("linlan_joined", state.story.flags)
        self.assertEqual("rail_butcher", state.story.current_scene_id)

    def test_split_team_requirement_reads_total_active_companion_trust(self) -> None:
        """第十一幕必须能计算同行伙伴总信任，不能令整个剧情窗口崩溃。"""

        state = self.application.state
        prior_scene_ids = [
            scene["scene_id"]
            for scene in self.application.config.story["scenes"]
            if scene["scene_id"] not in {"seventeen_minutes", "the_uncrowned_king"}
        ]
        self._move_to_scene(self.application, "seventeen_minutes", prior_scene_ids)
        state.shelter.population = 4
        state.active_player.parts = 20
        for companion in state.companions:
            companion.status = "active"
            companion.trust = 2

        prompt = self.application.current_story_prompt()

        split_choice = next(
            choice for choice in prompt.choices if choice.choice_id == "split_team"
        )
        self.assertTrue(split_choice.available)

    def test_retune_frequency_has_reachable_engineer_route(self) -> None:
        """未救出小满时，高智力与一格豪菜信任仍能解锁调谐路线。"""

        state = self.application.state
        self._move_to_scene(
            self.application,
            "chorus_matriarch",
            ["the_city_starts_singing"],
        )
        state.active_player.parts = 0
        state.active_player.intelligence = 158
        state.story.flags = []
        state.companion("haocai").trust = 1

        prompt = self.application.current_story_prompt()

        retune_choice = next(
            choice
            for choice in prompt.choices
            if choice.choice_id == "retune_frequency"
        )
        self.assertTrue(retune_choice.available)

    def test_secret_ending_accepts_linked_hive_memory_evidence_chain(self) -> None:
        """群巢连接路线应以蜂巢记忆替代互斥的调谐频率进入秘密结局。"""

        choice_id = self._prepare_final_scene(self.application, "rekindled_dawn")
        state = self.application.state
        state.story.boss_outcomes["chorus_matriarch"] = "linked"
        state.story.key_items.remove("counter_frequency")

        prompt = self.application.current_story_prompt()
        secret_choice = next(
            choice for choice in prompt.choices if choice.choice_id == choice_id
        )
        self.assertTrue(secret_choice.available)

        report = self.application.resolve_story_choice(
            "the_last_broadcast",
            choice_id,
        )
        self.assertTrue(report.game_over)
        self.assertEqual("rekindled_dawn", state.ending.ending_id)

    def test_boss_route_rewards_only_after_victory_and_then_advances(self) -> None:
        """Boss 路线先锁定不领奖，战斗胜利后才结算并推进场景。"""

        state = self.application.state
        self._move_to_scene(
            self.application,
            "rail_butcher",
            [
                "last_pot_of_porridge",
                "money_and_secrets",
                "doctor_in_the_rain",
            ],
        )
        initial_parts = state.active_player.parts
        initial_evidence = state.story.evidence

        route_report = self.application.resolve_story_choice(
            "rail_butcher",
            "overload_rail",
        )
        self.assertTrue(route_report.state_changed)
        self.assertIsNotNone(state.battle)
        self.assertEqual("rail_butcher", state.battle.boss_id)
        self.assertEqual("rail_butcher", state.story.current_scene_id)
        self.assertEqual(initial_parts, state.active_player.parts)
        self.assertEqual(initial_evidence, state.story.evidence)
        self.assertNotIn("grain_sample", state.story.key_items)
        self.assertNotIn("rail_butcher", state.story.boss_outcomes)
        self.assertNotIn("rail_butcher", state.story.completed_scene_ids)
        self.assertIn(
            "boss_route::rail_butcher::overload_rail",
            state.story.flags,
        )

        state.battle.health = 1
        victory_report = self.application.perform_combat_action("attack")
        self.assertTrue(victory_report.state_changed)
        self.assertFalse(victory_report.game_over)
        self.assertIsNone(state.battle)
        self.assertEqual("yangguans_day_forty_seven", state.story.current_scene_id)
        self.assertEqual("spared", state.story.boss_outcomes["rail_butcher"])
        self.assertIn("grain_sample", state.story.key_items)
        self.assertIn("rail_butcher", state.story.completed_scene_ids)
        self.assertGreater(state.active_player.parts, initial_parts)
        self.assertGreater(state.story.evidence, initial_evidence)
        self.assertNotIn(
            "boss_route::rail_butcher::overload_rail",
            state.story.flags,
        )

    def test_all_five_endings_are_reachable_with_configured_priority(self) -> None:
        """五个最终结局都能由公开选择解析，且高优先级覆盖其兜底结局。"""

        ending_ids = (
            "white_tower_ashes",
            "ember_road",
            "long_night_watch",
            "silent_crown",
            "rekindled_dawn",
        )
        for ending_id in ending_ids:
            with self.subTest(ending_id=ending_id):
                application = self._build_started_application(ending_id)
                choice_id = self._prepare_final_scene(application, ending_id)
                report = application.resolve_story_choice(
                    "the_last_broadcast",
                    choice_id,
                )

                self.assertTrue(report.state_changed)
                self.assertTrue(report.game_over)
                self.assertTrue(application.state.victory)
                self.assertEqual(ending_id, application.state.ending.ending_id)
                self.assertEqual("", application.state.story.current_scene_id)


if __name__ == "__main__":
    unittest.main()
