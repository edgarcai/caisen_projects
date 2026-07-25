"""验证避难所设施、工作、交易与招募的完整经营闭环。"""

import tempfile
import unittest
from pathlib import Path
from typing import Any, Mapping, Sequence

from tests.helpers import QueueRandomSource, build_test_application


class ManagementTests(unittest.TestCase):
    """覆盖配置化经营项目的查询、结算和失败原子性。"""

    def setUp(self) -> None:
        """为每个用例创建独立应用、确定性随机源和临时存档。"""

        self._temporary_directory = tempfile.TemporaryDirectory()
        self._save_path = Path(self._temporary_directory.name) / "savegame.json"
        self.random_source = QueueRandomSource()
        self.application = build_test_application(
            self._save_path,
            self.random_source,
        )
        self.application.start_new_game(["经营测试所长"], "single")

    def tearDown(self) -> None:
        """清理测试产生的临时存档目录。"""

        self._temporary_directory.cleanup()

    def _rebuild_with_random(self, integers: Sequence[int]) -> None:
        """使用指定整数队列重建应用，使工作产出与风险完全可复现。"""

        self.random_source = QueueRandomSource(integers=integers)
        self.application = build_test_application(
            self._save_path,
            self.random_source,
        )
        self.application.start_new_game(["经营测试所长"], "single")

    def _configured_item(
        self,
        collection_name: str,
        id_field: str,
        item_id: str,
    ) -> Mapping[str, Any]:
        """按稳定英文 ID 从剧情配置中读取一项经营定义。"""

        collection = self.application.config.story[collection_name]
        return next(item for item in collection if item[id_field] == item_id)

    def test_facility_upgrade_pays_cost_and_applies_immediate_effects(self) -> None:
        """设施升级应支付配置成本、提升等级并立即应用非规则效果。"""

        state = self.application.state
        player = state.active_player
        player.parts = 100
        player.coins = 100
        facility = self._configured_item(
            "facilities",
            "facility_id",
            "outer_wall",
        )
        level = facility["levels"][0]
        health_effect = next(
            effect
            for effect in level["effects"]
            if effect["target"] == "shelter.health"
        )
        defense_effect = next(
            effect
            for effect in level["effects"]
            if effect["target"] == "shelter.defense_damage"
        )
        turn_costs = self.application.config.section("rules")["turn_costs"]
        limits = self.application.config.section("rules")["limits"]
        before_health = state.shelter.health
        before_defense = state.shelter.defense_damage
        hours_per_turn = self.application.config.section("rules")["time"][
            "hours_per_action"
        ]
        turns = (level["build_hours"] + hours_per_turn - 1) // hours_per_turn

        report = self.application.perform_management("facility", "outer_wall")

        self.assertTrue(report.state_changed)
        self.assertEqual(turns, state.turn_number)
        self.assertEqual(level["level"], state.facility_levels["outer_wall"])
        self.assertEqual(100 - level["parts_cost"], state.active_player.parts)
        self.assertEqual(100 - level["coins_cost"], state.active_player.coins)
        expected_health = (
            min(
                limits["shelter_max_health"],
                before_health + health_effect["amount"],
            )
            - turn_costs["shelter_health_loss"] * turns
        )
        self.assertEqual(expected_health, state.shelter.health)
        self.assertEqual(
            before_defense + defense_effect["amount"],
            state.shelter.defense_damage,
        )

    def test_job_applies_configured_output_and_triggered_risk(self) -> None:
        """工作应结算区间产出，并在命中风险概率时应用风险效果。"""

        produced_parts = 7
        risk_roll = 1
        risk_damage = 4
        self._rebuild_with_random([produced_parts, risk_roll, risk_damage])
        state = self.application.state
        state.active_player.parts = 10
        state.active_player.health = 100
        state.shelter.activity = 50
        job = self._configured_item("jobs", "job_id", "sort_salvage")
        turn_costs = self.application.config.section("rules")["turn_costs"]
        hours_per_turn = self.application.config.section("rules")["time"][
            "hours_per_action"
        ]
        turns = (job["duration_hours"] + hours_per_turn - 1) // hours_per_turn

        report = self.application.perform_management("job", "sort_salvage")

        self.assertTrue(report.state_changed)
        self.assertEqual(turns, state.turn_number)
        self.assertEqual(10 + produced_parts, state.active_player.parts)
        self.assertEqual(100 - risk_damage, state.active_player.health)
        self.assertEqual(
            50 - job["costs"][0]["amount"] - turn_costs["activity_loss"] * turns,
            state.shelter.activity,
        )
        self.assertIn(job["risk"]["message"], report.messages)

    def test_trade_buy_and_sell_use_configured_values_without_turn(self) -> None:
        """同一商品买入与卖出应使用配置数量和价格，且交易不消耗回合。"""

        state = self.application.state
        state.active_player.coins = 100
        state.active_player.food = 0
        trade = self._configured_item("trades", "trade_id", "caravan_food")

        buy_report = self.application.perform_management(
            "trade_buy",
            trade["trade_id"],
        )

        self.assertTrue(buy_report.state_changed)
        self.assertEqual(0, state.turn_number)
        self.assertEqual(100 - trade["buy_price"], state.active_player.coins)
        self.assertEqual(trade["quantity"], state.active_player.food)

        sell_report = self.application.perform_management(
            "trade_sell",
            trade["trade_id"],
        )

        self.assertTrue(sell_report.state_changed)
        self.assertEqual(0, state.turn_number)
        self.assertEqual(
            100 - trade["buy_price"] + trade["sell_price"],
            state.active_player.coins,
        )
        self.assertEqual(0, state.active_player.food)

    def test_companion_trust_perks_reduce_facility_and_trade_costs(self) -> None:
        """豪菜与小满达到信任门槛后必须真实降低建设和买入成本。"""

        state = self.application.state
        state.active_player.parts = 100
        state.active_player.coins = 100
        haocai = state.companion("haocai")
        haocai.trust = 1
        outer_wall = self._configured_item(
            "facilities",
            "facility_id",
            "outer_wall",
        )
        base_parts_cost = outer_wall["levels"][0]["parts_cost"]

        self.application.perform_management("facility", "outer_wall")

        expected_parts_cost = base_parts_cost * 90 // 100
        self.assertEqual(100 - expected_parts_cost, state.active_player.parts)

        xiaoman = state.companion("xiaoman")
        xiaoman.status = "active"
        xiaoman.trust = 3
        state.active_player.coins = 100
        state.active_player.food = 0
        trade = self._configured_item("trades", "trade_id", "caravan_food")

        self.application.perform_management("trade_buy", trade["trade_id"])

        expected_buy_price = trade["buy_price"] * 90 // 100
        self.assertEqual(100 - expected_buy_price, state.active_player.coins)

    def test_linlan_trust_perk_increases_item_healing(self) -> None:
        """林岚加入并取得信任后，配置声明的治疗加成必须生效。"""

        self._rebuild_with_random([10])
        state = self.application.state
        linlan = state.companion("linlan")
        linlan.status = "active"
        linlan.trust = 1
        state.active_player.health = 50
        state.active_player.medical_supplies = 5

        self.application.perform_action("use_medicine")

        self.assertEqual(62, state.active_player.health)

    def test_recruit_cannot_be_added_twice(self) -> None:
        """成功招募后应写入稳定标记，重复请求不得再次扣费或增加人口。"""

        state = self.application.state
        state.active_player.coins = 100
        state.facility_levels["hydroponic_greenhouse"] = 1
        state.story.humanity = 1
        recruit = self._configured_item("recruits", "recruit_id", "su_yao")
        before_population = state.shelter.population

        first_report = self.application.perform_management(
            "recruit",
            recruit["recruit_id"],
        )

        self.assertTrue(first_report.state_changed)
        self.assertEqual(1, state.turn_number)
        self.assertEqual(before_population + 1, state.shelter.population)
        self.assertEqual(100 - recruit["costs"][0]["amount"], state.active_player.coins)
        self.assertIn(recruit["add_flags"][0], state.story.flags)
        state_after_first_recruit = state.to_dict()

        second_report = self.application.perform_management(
            "recruit",
            recruit["recruit_id"],
        )

        self.assertFalse(second_report.state_changed)
        self.assertEqual(state_after_first_recruit, state.to_dict())

    def test_insufficient_resources_never_consume_a_turn(self) -> None:
        """设施、工作、购买和招募资源不足时都必须保持完整状态不变。"""

        state = self.application.state
        state.active_player.parts = 0
        state.active_player.coins = 0
        state.shelter.activity = 0
        state.facility_levels["hydroponic_greenhouse"] = 1
        state.story.humanity = 1
        unavailable_requests = (
            ("facility", "outer_wall"),
            ("job", "sort_salvage"),
            ("trade_buy", "caravan_food"),
            ("recruit", "su_yao"),
        )

        for category, option_id in unavailable_requests:
            with self.subTest(category=category, option_id=option_id):
                before = state.to_dict()
                report = self.application.perform_management(category, option_id)
                self.assertFalse(report.state_changed)
                self.assertEqual(before, state.to_dict())
                self.assertEqual(0, state.turn_number)
                self.assertEqual(6, state.clock.hour)

    def test_every_configured_management_item_is_queryable(self) -> None:
        """每项设施、工作、交易和招募都应出现在经营选项查询结果中。"""

        options = self.application.management_options()
        option_ids_by_category = {
            category: {
                option.option_id for option in options if option.category == category
            }
            for category in (
                "facility",
                "job",
                "trade_buy",
                "trade_sell",
                "recruit",
            )
        }
        expected_facilities = {
            item["facility_id"] for item in self.application.config.story["facilities"]
        }
        expected_jobs = {
            item["job_id"] for item in self.application.config.story["jobs"]
        }
        expected_trades = {
            item["trade_id"] for item in self.application.config.story["trades"]
        }
        expected_recruits = {
            item["recruit_id"] for item in self.application.config.story["recruits"]
        }

        self.assertEqual(expected_facilities, option_ids_by_category["facility"])
        self.assertEqual(expected_jobs, option_ids_by_category["job"])
        self.assertEqual(expected_trades, option_ids_by_category["trade_buy"])
        self.assertEqual(expected_trades, option_ids_by_category["trade_sell"])
        self.assertEqual(expected_recruits, option_ids_by_category["recruit"])


if __name__ == "__main__":
    unittest.main()
