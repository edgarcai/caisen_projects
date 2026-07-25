"""验证游戏时间跨日、跨月、闰年和跨年行为。"""

import unittest

from apocalypse_game.domain import GameClock


class GameClockTests(unittest.TestCase):
    """覆盖原代码最容易出错的日期边界。"""

    def test_last_action_hour_moves_to_next_day(self) -> None:
        """17 点行动一小时后应进入次日 6 点。"""

        clock = GameClock(year=2166, month=1, day=1, hour=17)
        result = clock.advance(hours=1, day_start_hour=6, day_end_hour=18)
        self.assertEqual(
            (2166, 1, 2, 6), (clock.year, clock.month, clock.day, clock.hour)
        )
        self.assertTrue(result.day_changed)
        self.assertFalse(result.month_changed)

    def test_month_keeps_its_last_day(self) -> None:
        """1 月 31 日必须存在，完成最后一个行动后才进入 2 月。"""

        clock = GameClock(year=2166, month=1, day=31, hour=17)
        result = clock.advance(hours=1, day_start_hour=6, day_end_hour=18)
        self.assertEqual(
            (2166, 2, 1, 6), (clock.year, clock.month, clock.day, clock.hour)
        )
        self.assertTrue(result.month_changed)

    def test_leap_year_contains_february_29(self) -> None:
        """闰年的 2 月 28 日后应是 2 月 29 日。"""

        clock = GameClock(year=2168, month=2, day=28, hour=17)
        clock.advance(hours=1, day_start_hour=6, day_end_hour=18)
        self.assertEqual(
            (2168, 2, 29, 6), (clock.year, clock.month, clock.day, clock.hour)
        )

    def test_year_rollover(self) -> None:
        """12 月 31 日的最后一次行动应进入下一年 1 月 1 日。"""

        clock = GameClock(year=2166, month=12, day=31, hour=17)
        result = clock.advance(hours=1, day_start_hour=6, day_end_hour=18)
        self.assertEqual(
            (2167, 1, 1, 6), (clock.year, clock.month, clock.day, clock.hour)
        )
        self.assertTrue(result.year_changed)

    def test_multiple_playable_days_can_advance_at_once(self) -> None:
        """一次推进多个行动日时仍应保持正确小时与日期。"""

        clock = GameClock(year=2166, month=3, day=1, hour=6)
        clock.advance(hours=25, day_start_hour=6, day_end_hour=18)
        self.assertEqual(
            (2166, 3, 3, 7), (clock.year, clock.month, clock.day, clock.hour)
        )

    def test_boundary_flags_remember_intermediate_months(self) -> None:
        """即使最终月份相同，跨越整年也必须报告曾跨月和跨年。"""

        clock = GameClock(year=2166, month=1, day=1, hour=6)
        result = clock.advance(hours=365 * 12, day_start_hour=6, day_end_hour=18)
        self.assertEqual(
            (2167, 1, 1, 6), (clock.year, clock.month, clock.day, clock.hour)
        )
        self.assertTrue(result.month_changed)
        self.assertTrue(result.year_changed)


if __name__ == "__main__":
    unittest.main()
