"""验证三名 Boss、战斗行动、持久化、双人轮换与终局编排。"""

import tempfile
import unittest
from pathlib import Path

from apocalypse_game.domain import EndingState
from tests.helpers import QueueRandomSource, build_test_application


class CombatTests(unittest.TestCase):
    """使用确定性随机源覆盖完整 Boss 战纵向流程。"""

    def setUp(self) -> None:
        """为每个用例创建独立存档目录和路径计数器。"""

        self._temporary_directory = tempfile.TemporaryDirectory()
        self._application_index = 0

    def tearDown(self) -> None:
        """清理战斗用例生成的所有临时存档。"""

        self._temporary_directory.cleanup()

    def _build_application(
        self,
        random_source: QueueRandomSource = None,
        mode: str = "single",
    ):
        """构建并启动一局使用独立存档路径的测试游戏。"""

        self._application_index += 1
        save_path = Path(self._temporary_directory.name) / "combat-{}.json".format(
            self._application_index
        )
        source = random_source or QueueRandomSource()
        application = build_test_application(save_path, source)
        names = ["甲所长", "乙所长"] if mode == "multiplayer" else ["甲所长"]
        application.start_new_game(names, mode)
        return application

    def _prepare_boss(
        self,
        application,
        boss_id: str,
        choice_index: int = 0,
    ):
        """把测试状态定位到指定 Boss 场景，满足条件并由应用层开战。"""

        story_config = application.config.story
        scene = next(
            item for item in story_config["scenes"] if item.get("boss_id") == boss_id
        )
        state = application.state
        state.story.current_scene_id = scene["scene_id"]
        state.story.chapter_id = scene["chapter_id"]
        state.story.completed_scene_ids = [
            requirement["scene_id"]
            for requirement in scene.get("entry_requirements", [])
            if requirement["type"] == "scene_completed"
        ]
        state.story.boss_outcomes.clear()
        state.story.flags = ["xiaoman_joined"]
        state.story.key_items = ["lu_badge", "dawn_ledger"]
        state.pending_exploration = None
        state.battle = None
        state.ending = None
        for player in state.players:
            player.health = 100
            player.attack = 100
            player.defense = 100
            player.agility = 100
            player.intelligence = 200
            player.medical_supplies = 100
            player.food = 100
            player.parts = 100
            player.antidotes = 10
        for companion in state.companions:
            companion.trust = 5
            companion.status = "active"
        choice = scene["choices"][choice_index]
        report = application.resolve_story_choice(
            scene["scene_id"],
            choice["choice_id"],
        )
        self.assertTrue(report.state_changed)
        self.assertIsNotNone(state.battle)
        self.assertEqual(boss_id, state.battle.boss_id)
        return scene, choice

    def test_all_three_configured_bosses_can_start(self) -> None:
        """铁轨屠夫、鸣钟母体和无冕王都应能通过剧情用例开战。"""

        for boss_id in ("rail_butcher", "chorus_matriarch", "uncrowned_king"):
            with self.subTest(boss_id=boss_id):
                application = self._build_application()
                self._prepare_boss(application, boss_id)
                self.assertGreater(application.state.battle.health, 0)
                self.assertGreater(application.state.battle.max_health, 0)
                self.assertFalse(application.state.battle.finished)

    def test_story_can_weaken_or_reinforce_boss_starting_health(self) -> None:
        """剧情路线的低于及高于百分百生命修正都必须真实生效。"""

        weakened_application = self._build_application()
        self._prepare_boss(
            weakened_application,
            "rail_butcher",
            choice_index=2,
        )
        weakened_battle = weakened_application.state.battle
        self.assertEqual(180, weakened_battle.max_health)
        self.assertEqual(81, weakened_battle.health)

        reinforced_application = self._build_application()
        reinforced_state = reinforced_application.state
        self._prepare_boss(reinforced_application, "uncrowned_king")
        reinforced_state.story.add_flag(
            "battle_modifier::battle.uncrowned_king." "starting_health_percent::add::20"
        )
        reinforced_state.battle = None
        reinforced_application.resolve_story_choice(
            "the_uncrowned_king",
            "break_the_crown",
        )
        reinforced_battle = reinforced_state.battle
        base_health = next(
            boss["max_health"]
            for boss in reinforced_application.config.story["bosses"]
            if boss["boss_id"] == "uncrowned_king"
        )
        expected_health = base_health * 120 // 100
        self.assertEqual(expected_health, reinforced_battle.max_health)
        self.assertEqual(expected_health, reinforced_battle.health)

    def test_attack_guard_focus_medicine_and_retreat(self) -> None:
        """五种配置化战斗行动都应产生各自的领域效果。"""

        for action_id in ("attack", "guard", "focus", "medicine", "retreat"):
            with self.subTest(action_id=action_id):
                random_source = (
                    QueueRandomSource(integers=[1])
                    if action_id == "retreat"
                    else QueueRandomSource()
                )
                application = self._build_application(random_source)
                self._prepare_boss(application, "rail_butcher")
                state = application.state
                state.active_player.attack = 20
                state.active_player.defense = 15
                state.active_player.agility = 5
                boss_health_before = state.battle.health
                if action_id == "medicine":
                    state.active_player.health = 40
                supplies_before = state.active_player.medical_supplies

                report = application.perform_combat_action(action_id)

                self.assertTrue(report.state_changed)
                if action_id in {"attack", "guard", "focus"}:
                    self.assertLess(state.battle.health, boss_health_before)
                if action_id == "guard":
                    self.assertFalse(state.battle.guarding)
                    self.assertTrue(
                        any("防御" in message for message in report.messages)
                    )
                if action_id == "focus":
                    self.assertTrue(state.battle.focused)
                if action_id == "medicine":
                    self.assertEqual(
                        supplies_before - 3,
                        state.active_player.medical_supplies,
                    )
                    self.assertTrue(
                        any("恢复" in message for message in report.messages)
                    )
                if action_id == "retreat":
                    self.assertTrue(state.battle.finished)
                    self.assertTrue(state.battle.retreated)

    def test_active_battle_save_and_load_round_trip(self) -> None:
        """战斗中的 Boss 生命、回合、专注与剧情路线必须完整读回。"""

        application = self._build_application()
        self._prepare_boss(application, "rail_butcher")
        application.perform_combat_action("focus")
        expected = application.state.to_dict()

        application.save_game()
        application.state = None
        load_report = application.load_game()

        self.assertTrue(load_report.state_changed)
        self.assertEqual(expected, application.state.to_dict())
        self.assertIsNotNone(application.state.battle)
        self.assertTrue(application.state.battle.focused)
        self.assertEqual(2, application.state.battle.round_number)

    def test_multiplayer_rotates_after_every_valid_combat_action(self) -> None:
        """双人模式每个成功战斗回合只轮换一次行动所长。"""

        application = self._build_application(mode="multiplayer")
        self._prepare_boss(application, "rail_butcher")
        self.assertEqual(0, application.state.active_player_index)

        application.perform_combat_action("guard")
        self.assertEqual(1, application.state.active_player_index)
        application.perform_combat_action("guard")
        self.assertEqual(0, application.state.active_player_index)

    def test_yangguan_warning_perk_reduces_boss_damage(self) -> None:
        """阳关达到三格信任后，配置化回声预警必须降低首领伤害。"""

        health_after_actions = []
        for trust in (0, 3):
            application = self._build_application()
            self._prepare_boss(application, "rail_butcher")
            state = application.state
            state.companion("yangguan").trust = trust
            state.active_player.attack = 1
            state.active_player.defense = 15
            state.shelter.defense_damage = 0

            application.perform_combat_action("attack")

            health_after_actions.append(state.active_player.health)

        self.assertGreater(health_after_actions[1], health_after_actions[0])

    def test_victory_advances_scene_and_writes_configured_outcome(self) -> None:
        """战斗胜利应由应用层结算已选路线，而非留下临时胜利标记。"""

        application = self._build_application()
        scene, choice = self._prepare_boss(
            application,
            "rail_butcher",
            choice_index=1,
        )
        application.state.battle.health = 1

        report = application.perform_combat_action("attack")

        expected_outcome = choice["boss_resolution"]
        self.assertTrue(report.state_changed)
        self.assertFalse(report.game_over)
        self.assertIsNone(application.state.battle)
        self.assertEqual(
            expected_outcome,
            application.state.story.boss_outcomes["rail_butcher"],
        )
        self.assertIn(scene["scene_id"], application.state.story.completed_scene_ids)
        self.assertEqual(
            choice.get("next_scene_id", scene["next_scene_id"]),
            application.state.story.current_scene_id,
        )

    def test_defeat_creates_one_ending_state_source(self) -> None:
        """战败应只构造一个 EndingState，兼容属性均由它派生。"""

        application = self._build_application()
        self._prepare_boss(application, "rail_butcher")
        player = application.state.active_player
        player.health = 1
        player.attack = 1
        player.defense = 0
        player.agility = 0

        report = application.perform_combat_action("attack")

        configured_ending_id = application.config.section("rules")["failure_endings"][
            "combat"
        ]["ending_id"]
        state = application.state
        self.assertTrue(report.game_over)
        self.assertIsInstance(state.ending, EndingState)
        self.assertEqual(configured_ending_id, state.ending.ending_id)
        self.assertEqual("failure", state.ending.outcome)
        self.assertTrue(state.ended)
        self.assertFalse(state.victory)
        self.assertEqual(state.ending.message, state.ending_message)
        self.assertIsNone(state.battle)
        serialized = state.to_dict()
        self.assertIn("ending", serialized)
        self.assertNotIn("ended", serialized)
        self.assertNotIn("victory", serialized)
        self.assertNotIn("ending_message", serialized)


if __name__ == "__main__":
    unittest.main()
