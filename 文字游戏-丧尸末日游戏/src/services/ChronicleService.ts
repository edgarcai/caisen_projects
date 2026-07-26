import { DomainError } from "../domain/errors";
import {
  isEnded,
  type CheckpointState,
  type GameClockState,
  type GameDateState,
  type GameState,
} from "../domain/game-state";
import { daysInMonth } from "./GameClock";
import type { GameContent } from "./GameContent";

export interface CheckpointRollback {
  readonly state: GameState;
  readonly message: string;
}

/** 管理可持久通讯、周归档、生存日与自动检查点。 */
export class ChronicleService {
  private readonly content: GameContent;

  /** 注入时间线规则和所有可展示文案。 */
  public constructor(content: GameContent) {
    this.content = content;
  }

  /** 按原有顺序记录非空通讯，并按配置限制当前日志容量。 */
  public record(state: GameState, messages: readonly string[]): void {
    this.recordAt(state, messages, state.clock, state.survival_days);
  }

  /** 在跨日结算点原子完成周归档与十日检查点。 */
  public completeDay(
    state: GameState,
    completedClock: GameClockState,
    messages: readonly string[],
  ): string[] {
    state.survival_days += 1;
    this.recordAt(state, messages, completedClock, state.survival_days);
    const timeline = this.content.game.rules.timeline;
    const weeklyInterval = this.positiveInteger(
      timeline.weekly_archive_interval_days,
      "weekly_archive_interval_days",
    );
    const checkpointInterval = this.positiveInteger(
      timeline.checkpoint_interval_days,
      "checkpoint_interval_days",
    );
    const notices: string[] = [];
    if (state.survival_days % weeklyInterval === 0) {
      const weekNumber = Math.floor(state.survival_days / weeklyInterval);
      const endDate = this.dateOnly(completedClock);
      const entries = structuredClone(state.communication_log);
      const summary = this.content.text("weekly_summary_format", {
        week_number: weekNumber,
        entry_count: entries.length,
        shelter_health: state.shelter.health,
        group_hunger: state.shelter.group_hunger,
        completed_scenes: state.story.completed_scene_ids.length,
      });
      state.weekly_archives.push({
        week_number: weekNumber,
        start_date: this.rewindDate(endDate, weeklyInterval - 1),
        end_date: endDate,
        summary,
        entries,
      });
      state.communication_log = [];
      notices.push(this.content.text("weekly_archive_notice", {
        week_number: weekNumber,
      }));
    }
    if (!isEnded(state) && state.survival_days % checkpointInterval === 0) {
      state.checkpoint = this.createCheckpoint(state);
      notices.push(this.content.text("checkpoint_created", {
        survival_days: state.survival_days,
      }));
    }
    this.record(state, notices);
    return notices;
  }

  /** 从最新自动检查点恢复全部玩法状态，无检查点时返回 null。 */
  public rollback(state: GameState): CheckpointRollback | null {
    const checkpoint = state.checkpoint;
    if (checkpoint === null) {
      return null;
    }
    const restored: GameState = {
      ...structuredClone(checkpoint.snapshot),
      checkpoint: structuredClone(checkpoint),
    };
    const message = this.content.text("checkpoint_rollback_success", {
      survival_days: checkpoint.survival_day,
    });
    this.record(restored, [message]);
    return { state: restored, message };
  }

  /** 返回当前通讯日志的纯文本投影。 */
  public messages(state: GameState): string[] {
    return state.communication_log.map((entry) => entry.message);
  }

  /** 创建不包含 checkpoint 自身的可回档快照。 */
  private createCheckpoint(state: GameState): CheckpointState {
    const cloned = structuredClone(state);
    const { checkpoint: _excludedCheckpoint, ...snapshot } = cloned;
    void _excludedCheckpoint;
    return {
      survival_day: state.survival_days,
      created_turn: state.turn_number,
      snapshot,
    };
  }

  /** 在指定游戏时刻追加通讯条目。 */
  private recordAt(
    state: GameState,
    messages: readonly string[],
    clock: GameClockState,
    survivalDay: number,
  ): void {
    for (const message of messages) {
      if (message.trim() === "") continue;
      state.communication_log.push({
        survival_day: survivalDay,
        turn_number: state.turn_number,
        clock: structuredClone(clock),
        message,
      });
    }
    const maximum = this.positiveInteger(
      this.content.game.rules.timeline.communication_log_max_entries,
      "communication_log_max_entries",
    );
    if (state.communication_log.length > maximum) {
      state.communication_log = state.communication_log.slice(-maximum);
    }
  }

  /** 返回只含年、月、日的游戏日期。 */
  private dateOnly(clock: GameClockState): GameDateState {
    return { year: clock.year, month: clock.month, day: clock.day };
  }

  /** 按公历向前回退指定天数。 */
  private rewindDate(source: GameDateState, days: number): GameDateState {
    const date = structuredClone(source);
    for (let index = 0; index < days; index += 1) {
      date.day -= 1;
      if (date.day >= 1) continue;
      date.month -= 1;
      if (date.month < 1) {
        date.year -= 1;
        date.month = 12;
      }
      date.day = daysInMonth(date.year, date.month);
    }
    return date;
  }

  /** 校验时间线整数配置并返回安全值。 */
  private positiveInteger(value: number, key: string): number {
    if (!Number.isInteger(value) || value < 1) {
      throw new DomainError(this.content.text("invalid_timeline_rule", { rule_key: key }));
    }
    return value;
  }
}
