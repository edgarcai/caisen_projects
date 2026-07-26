import { DomainError } from "../domain/errors";
import {
  activePlayer,
  isEnded,
  rotatePlayer,
  type EndingState,
  type GameState,
} from "../domain/game-state";
import type { RuleModifierProvider } from "../domain/ports";
import { advanceClock } from "./GameClock";
import type { GameContent } from "./GameContent";

/** 集中处理世界时间、生存消耗、不变量和失败优先级。 */
export class GameRules {
  private readonly content: GameContent;
  private readonly modifiers: RuleModifierProvider;

  /** 注入统一配置和避难所被动修正提供者。 */
  public constructor(content: GameContent, modifiers: RuleModifierProvider) {
    this.content = content;
    this.modifiers = modifiers;
  }

  /** 暴露已经配置的生存上限，供应用服务复用。 */
  public get limits(): GameContent["game"]["rules"]["limits"] {
    return this.content.game.rules.limits;
  }

  /** 结算一个或多个生存回合，整项行动后再轮换所长。 */
  public advanceTurn(
    state: GameState,
    rotate = true,
    turns = 1,
  ): string[] {
    if (isEnded(state)) {
      return [state.ending?.message ?? ""];
    }
    if (!Number.isInteger(turns) || turns < 1) {
      throw new RangeError("生存回合数必须是正整数。");
    }
    const messages: string[] = [];
    for (let index = 0; index < turns; index += 1) {
      messages.push(...this.advanceSingleTurn(state));
      if (isEnded(state)) {
        return messages;
      }
    }
    if (rotate) {
      rotatePlayer(state);
      if (state.players.length > 1) {
        messages.push(this.content.text("next_player", { player_name: activePlayer(state).name }));
      }
    }
    return messages;
  }

  /** 统一维护库存非负、生命上限和避难所耐久上限。 */
  public normalize(state: GameState): void {
    const playerFields = [
      "health",
      "medical_supplies",
      "food",
      "hunger",
      "coins",
      "parts",
      "negative_status",
      "antidotes",
    ] as const;
    for (const player of state.players) {
      for (const field of playerFields) {
        player[field] = Math.max(0, player[field]);
      }
      player.health = Math.min(player.health, this.limits.player_max_health);
    }
    state.shelter.health = Math.max(
      0,
      Math.min(state.shelter.health, this.limits.shelter_max_health),
    );
    state.shelter.group_hunger = Math.max(0, state.shelter.group_hunger);
    const shelterFields = [
      "population",
      "defense_damage",
      "newspapers",
      "books",
      "magazines",
      "toys",
      "game_consoles",
    ] as const;
    for (const field of shelterFields) {
      state.shelter[field] = Math.max(0, state.shelter[field]);
    }
  }

  /** 按固定优先级检查所有配置化失败条件。 */
  public checkFailure(state: GameState): EndingState | null {
    if (state.shelter.health <= 0) {
      return this.failureEnding("shelter", state.mode);
    }
    for (const player of state.players) {
      if (player.health <= 0) {
        return this.failureEnding("player_health", state.mode, { player_name: player.name });
      }
      if (player.hunger >= this.limits.player_hunger_game_over) {
        return this.failureEnding("player_hunger", state.mode, { player_name: player.name });
      }
    }
    if (state.shelter.group_hunger >= this.limits.group_hunger_game_over) {
      return this.failureEnding("group_hunger", state.mode);
    }
    if (state.shelter.activity <= this.limits.activity_min_game_over) {
      return this.failureEnding("activity_low", state.mode);
    }
    if (state.shelter.activity >= this.limits.activity_max_game_over) {
      return this.failureEnding("activity_high", state.mode);
    }
    return null;
  }

  /** 为首领战中倒下的所长创建配置化失败结局。 */
  public combatFailure(playerName: string, mode: GameState["mode"]): EndingState {
    return this.failureEnding("combat", mode, { player_name: playerName });
  }

  /** 结算一个基础行动时段的消耗、日历、产出和失败。 */
  private advanceSingleTurn(state: GameState): string[] {
    const { turn_costs: costs, time } = this.content.game.rules;
    const negativePercent = 100 + this.modifier(
      state,
      "rules.negative_status_health_loss_percent",
    );
    for (const player of state.players) {
      const healthLoss = Math.max(
        0,
        Math.floor(
          (costs.health_loss_per_negative_status *
            player.negative_status *
            negativePercent) /
            100,
        ),
      );
      player.health -= healthLoss;
      player.hunger += costs.player_hunger_gain;
    }
    const shelterDamagePercent = 100 + this.modifier(
      state,
      "rules.shelter_turn_damage_percent",
    );
    state.shelter.health -= Math.max(
      0,
      Math.floor((costs.shelter_health_loss * shelterDamagePercent) / 100),
    );
    const hungerPercent = 100 + this.modifier(state, "rules.group_hunger_gain_percent");
    state.shelter.group_hunger += Math.max(
      0,
      Math.floor(
        (costs.group_hunger_gain_per_person * state.shelter.population * hungerPercent) /
          100,
      ),
    );
    state.shelter.activity -= costs.activity_loss;
    state.turn_number += 1;

    const advance = advanceClock(state.clock, time.hours_per_action, time);
    this.normalize(state);
    const messages: string[] = [];
    if (advance.dayChanged) {
      messages.push(this.content.text("turn_day"));
      const produced = Math.max(0, this.modifier(state, "rules.daily_food_production"));
      if (produced > 0) {
        activePlayer(state).food += produced;
        messages.push(this.content.text("daily_food_produced", { produced }));
      }
    }
    if (advance.monthChanged) {
      messages.push(this.content.text("turn_month"));
    }
    if (advance.yearChanged) {
      messages.push(this.content.text("turn_year"));
    }
    const ending = this.checkFailure(state);
    if (ending !== null) {
      state.ending = ending;
      messages.push(ending.message);
    }
    return messages;
  }

  /** 读取某个生存规则的累计被动修正。 */
  private modifier(state: GameState, target: string): number {
    return this.modifiers.passiveModifier(state, target);
  }

  /** 根据失败类型和游戏模式创建唯一结局对象。 */
  private failureEnding(
    failureId: string,
    mode: GameState["mode"],
    values: Readonly<Record<string, string | number>> = {},
  ): EndingState {
    const failure = this.content.game.rules.failure_endings[failureId];
    if (failure === undefined) {
      throw new DomainError(`缺少失败结局配置：${failureId}`);
    }
    const textKey = failure.mode_text_keys?.[mode] ?? failure.text_key;
    return {
      ending_id: failure.ending_id,
      outcome: "failure",
      message: this.content.text(textKey, values),
    };
  }
}
