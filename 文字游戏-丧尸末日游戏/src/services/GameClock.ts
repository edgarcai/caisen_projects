import type { GameRuleConfig } from "../domain/content";
import type { GameClockState } from "../domain/game-state";

export interface ClockAdvance {
  dayChanged: boolean;
  monthChanged: boolean;
  yearChanged: boolean;
}

/** 返回公历日期的星期索引，周日为 0、周六为 6。 */
export function weekdayIndex(clock: GameClockState): number {
  return new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
}

/** 按配置化活动时段计算一个生存日包含的回合数。 */
export function playableTurnsPerDay(time: GameRuleConfig["time"]): number {
  const playableHours = time.day_end_hour - time.day_start_hour;
  if (
    !Number.isInteger(playableHours)
    || playableHours <= 0
    || !Number.isInteger(time.hours_per_action)
    || time.hours_per_action <= 0
    || playableHours % time.hours_per_action !== 0
  ) {
    throw new RangeError("每日行动时段与单回合小时数无法整除。");
  }
  return playableHours / time.hours_per_action;
}

/** 判断指定公历年是否为闰年。 */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** 返回指定公历年月的天数。 */
export function daysInMonth(year: number, month: number): number {
  const regular = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  const days = regular[month - 1];
  if (days === undefined) {
    throw new RangeError(`月份无效：${String(month)}`);
  }
  return month === 2 && isLeapYear(year) ? 29 : days;
}

/** 按可行动时段推进时钟，并报告跨越的日历边界。 */
export function advanceClock(
  clock: GameClockState,
  hours: number,
  time: GameRuleConfig["time"],
): ClockAdvance {
  if (!Number.isInteger(hours) || hours < 0) {
    throw new RangeError("推进小时必须是非负整数。");
  }
  if (clock.hour < time.day_start_hour || clock.hour >= time.day_end_hour) {
    throw new RangeError("当前小时不在配置的行动时段内。");
  }
  const playableHours = time.day_end_hour - time.day_start_hour;
  if (playableHours <= 0) {
    throw new RangeError("每日结束时间必须晚于开始时间。");
  }
  const currentOffset = clock.hour - time.day_start_hour;
  const totalOffset = currentOffset + hours;
  const daysToAdvance = Math.floor(totalOffset / playableHours);
  clock.hour = time.day_start_hour + (totalOffset % playableHours);

  let monthChanged = false;
  let yearChanged = false;
  for (let index = 0; index < daysToAdvance; index += 1) {
    const previousMonth = clock.month;
    const previousYear = clock.year;
    advanceOneDay(clock);
    monthChanged ||= clock.month !== previousMonth;
    yearChanged ||= clock.year !== previousYear;
  }
  return {
    dayChanged: daysToAdvance > 0,
    monthChanged,
    yearChanged,
  };
}

/** 将时钟推进一个公历日并处理月末和年末。 */
function advanceOneDay(clock: GameClockState): void {
  clock.day += 1;
  if (clock.day <= daysInMonth(clock.year, clock.month)) {
    return;
  }
  clock.day = 1;
  clock.month += 1;
  if (clock.month <= 12) {
    return;
  }
  clock.month = 1;
  clock.year += 1;
}
