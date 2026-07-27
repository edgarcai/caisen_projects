"""验证新游戏、物品、多人轮换和失败判定。"""

import tempfile
import unittest
from pathlib import Path

from apocalypse_game.application import GameApplicationError
from apocalypse_game.rules import GameRules
from tests.helpers import CONFIG_PATH, QueueRandomSource, build_test_application
from apocalypse_game.config import ConfigLoader


class ApplicationTests(unittest.TestCase):
    """覆盖应用层最关键的可玩纵向流程。"""

    def setUp(self) -> None:
        """为每个用例创建互不影响的临时存档目录。"""

        self._temporary_directory = tempfile.TemporaryDirectory()
        save_path = Path(self._temporary_directory.name) / "savegame.json"
        self.random_source = QueueRandomSource()
        self.application = build_test_application(save_path, self.random_source)

    def tearDown(self) -> None:
        """清理测试创建的临时存档目录。"""

        self._temporary_directory.cleanup()

    def test_menu_labels_are_exact(self) -> None:
        """主菜单必须精确包含用户指定的三个中文选项。"""

        menu = self.application.config.section("menu")
        self.assertEqual("新的游戏", menu["new_game"])
        self.assertEqual("游玩存档", menu["load_game"])
        self.assertEqual("多人游戏", menu["multiplayer"])

    def test_new_game_uses_english_domain_fields(self) -> None:
        """新游戏应创建英文属性领域对象而不是中文键字典。"""

        self.application.start_new_game(["测试所长"], "single")
        player = self.application.state.active_player
        self.assertEqual("测试所长", player.name)
        self.assertEqual(100, player.health)
        self.assertTrue(hasattr(player, "medical_supplies"))
        self.assertFalse(hasattr(player, "医疗用品"))

    def test_food_action_changes_state_and_advances_turn(self) -> None:
        """成功进食应扣除食物、降低饥饿并结算回合消耗。"""

        self.application.start_new_game(["白菜"], "single")
        state = self.application.state
        state.active_player.food = 15
        state.active_player.hunger = 30
        report = self.application.perform_action("use_food")
        self.assertTrue(report.state_changed)
        self.assertEqual(10, state.active_player.food)
        expected_hunger = (
            30
            - self.application.config.section("rules")["items"]["player_food"][
                "hunger_reduction"
            ]
            + self.application.config.section("rules")["turn_costs"][
                "player_hunger_gain"
            ]
        )
        self.assertEqual(expected_hunger, state.active_player.hunger)
        self.assertEqual(1, state.turn_number)

    def test_failed_item_action_does_not_advance_turn(self) -> None:
        """库存不足的行动应给出反馈但不消耗时间和回合。"""

        self.application.start_new_game(["白菜"], "single")
        state = self.application.state
        state.active_player.medical_supplies = 0
        report = self.application.perform_action("use_medicine")
        self.assertFalse(report.state_changed)
        self.assertEqual(0, state.turn_number)
        self.assertEqual(6, state.clock.hour)

    def test_full_targets_do_not_consume_supplies_or_turns(self) -> None:
        """生命、饥饿或耐久已在最佳值时不得浪费物资和回合。"""

        self.application.start_new_game(["白菜"], "single")
        state = self.application.state
        limits = self.application.config.section("rules")["limits"]
        state.active_player.food = 100
        state.active_player.medical_supplies = 100
        state.active_player.parts = 100
        state.active_player.hunger = 0
        state.active_player.health = limits["player_max_health"]
        state.shelter.group_hunger = 0
        state.shelter.health = limits["shelter_max_health"]

        for action_id in (
            "use_food",
            "use_medicine",
            "feed_shelter",
            "repair_shelter",
        ):
            with self.subTest(action_id=action_id):
                before = state.to_dict()
                report = self.application.perform_action(action_id)
                self.assertFalse(report.state_changed)
                self.assertEqual(before, state.to_dict())

    def test_multiplayer_rotates_after_successful_action(self) -> None:
        """本地双人模式应在一次有效行动后切换当前所长。"""

        self.application.start_new_game(["白菜", "豪菜"], "multiplayer")
        state = self.application.state
        state.active_player.food = 5
        state.active_player.hunger = self.application.config.section("rules")["items"][
            "player_food"
        ]["hunger_reduction"]
        self.assertEqual("白菜", state.active_player.name)
        self.application.perform_action("use_food")
        self.assertEqual("豪菜", state.active_player.name)
        hunger_gain = self.application.config.section("rules")["turn_costs"][
            "player_hunger_gain"
        ]
        self.assertEqual(
            [hunger_gain, hunger_gain],
            [player.hunger for player in state.players],
        )

    def test_multiplayer_requires_two_distinct_names(self) -> None:
        """多人模式拒绝缺少玩家或重复姓名。"""

        with self.assertRaises(GameApplicationError):
            self.application.start_new_game(["白菜", "白菜"], "multiplayer")

    def test_multiplayer_player_defeat_reports_broken_command_chain(self) -> None:
        """任一多人所长倒下时应宣告双人指挥链中断，而非全员死亡。"""

        self.application.start_new_game(["甲", "乙"], "multiplayer")
        state = self.application.state
        state.players[0].health = 0

        report = self.application.resolve_story_choice(
            "last_pot_of_porridge",
            "give_up_share",
        )

        expected_message = self.application.config.text(
            "game_over_player_multiplayer",
            player_name="甲",
        )
        self.assertTrue(report.game_over)
        self.assertEqual(expected_message, report.messages[-1])
        self.assertEqual(100, state.players[1].health)
        self.assertNotIn("最后的指挥者", expected_message)

    def test_game_over_thresholds_keep_fixed_priority(self) -> None:
        """避难所耐久失败应优先于玩家和饥饿失败。"""

        self.application.start_new_game(["白菜"], "single")
        state = self.application.state
        state.shelter.health = 0
        state.active_player.health = 0
        state.active_player.hunger = 150
        rules = GameRules(ConfigLoader.load(CONFIG_PATH))
        ending = rules.check_game_over(state)
        self.assertEqual(self.application.config.text("game_over_shelter"), ending)

    def test_game_over_boundaries_are_inclusive(self) -> None:
        """饥饿与活跃度阈值在配置边界处应立即触发失败。"""

        self.application.start_new_game(["白菜"], "single")
        state = self.application.state
        rules = GameRules(ConfigLoader.load(CONFIG_PATH))
        state.active_player.hunger = 149
        self.assertIsNone(rules.check_game_over(state))
        state.active_player.hunger = 150
        self.assertEqual(
            self.application.config.text("game_over_player_hunger", player_name="白菜"),
            rules.check_game_over(state),
        )
        state.active_player.hunger = 0
        state.shelter.group_hunger = 260
        self.assertEqual(
            self.application.config.text("game_over_group_hunger"),
            rules.check_game_over(state),
        )

    def test_hope_and_lifespan_boundaries_are_inclusive(self) -> None:
        """希望归零或年龄达到寿命时应立即触发对应失败。"""

        self.application.start_new_game(["白菜"], "single")
        state = self.application.state
        rules = GameRules(ConfigLoader.load(CONFIG_PATH))
        state.shelter.hope = 1
        self.assertIsNone(rules.check_game_over(state))
        state.shelter.hope = 0
        self.assertEqual(
            self.application.config.text("game_over_hope"),
            rules.check_game_over(state),
        )

        state.shelter.hope = self.application.config.section("defaults")["shelter"][
            "hope"
        ]
        state.active_player.age = state.active_player.lifespan
        self.assertEqual(
            self.application.config.text(
                "game_over_lifespan",
                player_name="白菜",
                lifespan=state.active_player.lifespan,
            ),
            rules.check_game_over(state),
        )

    def test_year_boundary_increases_player_age(self) -> None:
        """跨年行动应把每位所长年龄增加一岁并记录提示。"""

        self.application.start_new_game(["白菜"], "single")
        state = self.application.state
        state.clock.year = 2166
        state.clock.month = 12
        state.clock.day = 31
        state.clock.hour = 17
        initial_age = state.active_player.age

        messages = GameRules(ConfigLoader.load(CONFIG_PATH)).advance_turn(state)

        self.assertEqual(initial_age + 1, state.active_player.age)
        self.assertIn(
            self.application.config.text(
                "player_aged",
                player_name="白菜",
                age=state.active_player.age,
                lifespan=state.active_player.lifespan,
            ),
            messages,
        )


if __name__ == "__main__":
    unittest.main()
