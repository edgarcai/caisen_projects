"""用公开应用接口验证默认资源下的完整主线随机种子通关率。"""

import random
import tempfile
import unittest
from pathlib import Path
from typing import List, Sequence, TypeVar

from tests.helpers import build_test_application


ItemType = TypeVar("ItemType")


class SeededRandomSource:
    """以固定种子提供与正式随机端口一致的可复现实现。"""

    def __init__(self, seed: int) -> None:
        """创建只属于一局战役的伪随机生成器。"""

        self._random = random.Random(seed)

    def randint(self, minimum: int, maximum: int) -> int:
        """返回闭区间内的可复现随机整数。"""

        return self._random.randint(minimum, maximum)

    def weighted_choice(
        self,
        items: Sequence[ItemType],
        weights: Sequence[int],
    ) -> ItemType:
        """按配置权重从候选项中抽取一个结果。"""

        return self._random.choices(list(items), weights=list(weights), k=1)[0]


class CampaignPlaythroughTests(unittest.TestCase):
    """固定一条公开秘密路线并统计多随机种子的真实完成率。"""

    ROUTE = (
        ("last_pot_of_porridge", "share_rations"),
        ("money_and_secrets", "decrypt_ledger"),
        ("doctor_in_the_rain", "medical_rescue"),
        ("rail_butcher", "call_his_name"),
        ("yangguans_day_forty_seven", "study_yangguan"),
        ("patient_zero_archive", "restore_power_grid"),
        ("the_city_starts_singing", "follow_hive_song"),
        ("chorus_matriarch", "retune_frequency"),
        ("three_dishes_and_soup", "investigate_banquet"),
        ("haocais_old_key", "forgive_haocai"),
        ("seventeen_minutes", "defend_shelter"),
        ("the_uncrowned_king", "break_the_crown"),
        ("the_last_broadcast", "broadcast_reversal"),
    )

    def setUp(self) -> None:
        """创建所有随机种子共用且会自动清理的临时存档目录。"""

        self._temporary_directory = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        """清理战役模拟产生的临时存档目录。"""

        self._temporary_directory.cleanup()

    def _play_seed(self, seed: int) -> str:
        """使用一条无探索路线游玩到结局，并返回结局或失败说明。"""

        save_path = Path(self._temporary_directory.name) / "seed-{}.json".format(seed)
        application = build_test_application(save_path, SeededRandomSource(seed))
        application.start_new_game(["种子{}号所长".format(seed)], "single")

        for scene_id, choice_id in self.ROUTE:
            prompt = application.current_story_prompt()
            if prompt is None or prompt.scene_id != scene_id:
                return "场景中断:{}".format(scene_id)
            choice = next(
                candidate
                for candidate in prompt.choices
                if candidate.choice_id == choice_id
            )
            if not choice.available:
                return "选择锁定:{}".format(choice_id)
            report = application.resolve_story_choice(scene_id, choice_id)
            if application.state.battle is not None:
                battle_failure = self._finish_battle(application)
                if battle_failure:
                    return battle_failure
            if report.game_over and scene_id != "the_last_broadcast":
                return "剧情失败:{}".format(scene_id)

        ending = application.state.ending
        return ending.ending_id if ending is not None else "没有结局"

    @staticmethod
    def _finish_battle(application) -> str:
        """以普通攻击为主、低血用药的保守策略完成当前首领战。"""

        actions = 0
        while application.state.battle is not None:
            state = application.state
            player = state.active_player
            battle = state.battle
            minimum_damage = CampaignPlaythroughTests._minimum_attack_damage(
                application
            )
            can_finish = battle.health <= minimum_damage
            should_heal = not can_finish and player.health <= 30
            if battle.boss_id == "uncrowned_king" and battle.health <= 80:
                should_heal = should_heal or player.health <= 40
            action_id = (
                "medicine" if should_heal and player.medical_supplies >= 3 else "attack"
            )
            report = application.perform_combat_action(action_id)
            actions += 1
            if report.game_over:
                return "战斗失败:{}".format(battle.boss_id)
            if actions > 30:
                return "战斗未收敛:{}".format(battle.boss_id)
        return ""

    @staticmethod
    def _minimum_attack_damage(application) -> int:
        """根据公开配置计算当前普通攻击不含暴击的最低伤害。"""

        state = application.state
        player = state.active_player
        battle = state.battle
        story = application.config.story
        rules = story["combat"]["rules"]
        boss = next(
            candidate
            for candidate in story["bosses"]
            if candidate["boss_id"] == battle.boss_id
        )
        action = next(
            candidate
            for candidate in story["combat"]["actions"]
            if candidate["action_id"] == "attack"
        )
        base_damage = (
            player.attack * rules["player_attack_weight_percent"] // 100
            + player.defense * rules["player_defense_damage_weight_percent"] // 100
            + state.shelter.defense_damage
            * rules["shelter_defense_damage_weight_percent"]
            // 100
            - boss["defense"]
        )
        damage = max(rules["minimum_damage"], base_damage)
        damage = damage * action["damage_multiplier_percent"] // 100
        damage = damage * action["damage_random_percent"][0] // 100
        return max(rules["minimum_damage"], damage)

    def test_default_campaign_reaches_secret_ending_in_at_least_95_percent(
        self,
    ) -> None:
        """一百个固定种子中至少九十五局无需探索即可完成公开秘密路线。"""

        results: List[str] = [self._play_seed(seed) for seed in range(100)]
        victories = results.count("rekindled_dawn")
        failures = sorted(
            set(result for result in results if result != "rekindled_dawn")
        )
        self.assertGreaterEqual(victories, 95, "失败原因：{}".format(failures))


if __name__ == "__main__":
    unittest.main()
