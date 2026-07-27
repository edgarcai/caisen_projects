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
import type { ChronicleService } from "./ChronicleService";
import type { CampaignProfileService } from "./CampaignProfileService";
import type { GameContent } from "./GameContent";

/** 集中处理世界时间、生存消耗、不变量和失败优先级。 */
export class GameRules {
  private readonly content: GameContent;
  private readonly modifiers: RuleModifierProvider;
  private readonly chronicle: ChronicleService;
  private readonly campaignProfiles: CampaignProfileService;

  /** 注入统一配置、避难所被动修正、开局档案与时间线记录服务。 */
  public constructor(
    content: GameContent,
    modifiers: RuleModifierProvider,
    chronicle: ChronicleService,
    campaignProfiles: CampaignProfileService,
  ) {
    this.content = content;
    this.modifiers = modifiers;
    this.chronicle = chronicle;
    this.campaignProfiles = campaignProfiles;
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
    actionType?: string,
  ): string[] {
    if (isEnded(state)) {
      return [state.ending?.message ?? ""];
    }
    if (!Number.isInteger(turns) || turns < 1) {
      throw new RangeError(this.content.text("invalid_survival_turn_count"));
    }
    const hungerCosts = this.actionHungerCosts(actionType);
    const survivalCostPercent = this.survivalCostPercent(state);
    const shouldAdvanceInteractionCooldowns = actionType
      !== this.content.game.rules.companion_interaction_action_type;
    const messages: string[] = [];
    for (let index = 0; index < turns; index += 1) {
      messages.push(...this.advanceSingleTurn(
        state,
        hungerCosts,
        survivalCostPercent,
        shouldAdvanceInteractionCooldowns,
      ));
      if (isEnded(state)) {
        return messages;
      }
    }
    if (rotate) {
      rotatePlayer(state);
      if (state.players.length > 1) {
        const nextPlayerMessage = this.content.text("next_player", {
          player_name: activePlayer(state).name,
        });
        messages.push(nextPlayerMessage);
        this.chronicle.record(state, [nextPlayerMessage]);
      }
    }
    return messages;
  }

  /** 统一维护库存非负、生命上限和避难所耐久上限。 */
  public normalize(state: GameState): void {
    const playerFields = [
      "age",
      "lifespan",
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
    state.shelter.hope = Math.max(
      0,
      Math.min(state.shelter.hope, this.limits.shelter_max_hope),
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
    if (state.shelter.hope <= this.limits.hope_min_game_over) {
      return this.failureEnding("hope", state.mode);
    }
    for (const player of state.players) {
      if (player.health <= 0) {
        return this.failureEnding("player_health", state.mode, { player_name: player.name });
      }
      if (player.hunger >= this.limits.player_hunger_game_over) {
        return this.failureEnding("player_hunger", state.mode, { player_name: player.name });
      }
      if (player.age >= player.lifespan) {
        return this.failureEnding("lifespan", state.mode, {
          player_name: player.name,
          lifespan: player.lifespan,
        });
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
  private advanceSingleTurn(
    state: GameState,
    hungerCosts: GameContent["game"]["rules"]["action_hunger_costs"][string],
    survivalCostPercent: number,
    shouldAdvanceInteractionCooldowns: boolean,
  ): string[] {
    const { turn_costs: costs, time } = this.content.game.rules;
    const negativePercent = 100 + this.modifier(
      state,
      "rules.negative_status_health_loss_percent",
    );
    for (const player of state.players) {
      const healthLoss = this.scaledSurvivalCost(
        costs.health_loss_per_negative_status * player.negative_status,
        negativePercent,
        survivalCostPercent,
      );
      player.health -= healthLoss;
      player.hunger += this.scaledSurvivalCost(
        hungerCosts.player_hunger_gain,
        100,
        survivalCostPercent,
      );
    }
    const shelterDamagePercent = 100 + this.modifier(
      state,
      "rules.shelter_turn_damage_percent",
    );
    state.shelter.health -= this.scaledSurvivalCost(
      costs.shelter_health_loss,
      shelterDamagePercent,
      survivalCostPercent,
    );
    const hungerPercent = 100 + this.modifier(state, "rules.group_hunger_gain_percent");
    state.shelter.group_hunger += this.scaledSurvivalCost(
      hungerCosts.group_hunger_gain_per_person * state.shelter.population,
      hungerPercent,
      survivalCostPercent,
    );
    state.shelter.activity -= this.scaledSurvivalCost(
      costs.activity_loss,
      100,
      survivalCostPercent,
    );
    state.shelter.hope -= this.scaledSurvivalCost(
      costs.hope_loss,
      100,
      survivalCostPercent,
    );
    if (shouldAdvanceInteractionCooldowns) {
      for (const companion of state.companions) {
        companion.interaction_cooldown_turns = Math.max(
          0,
          companion.interaction_cooldown_turns - 1,
        );
      }
    }
    state.turn_number += 1;

    const completedClock = structuredClone(state.clock);
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
      for (const player of state.players) {
        player.age += 1;
        messages.push(this.content.text("player_aged", {
          player_name: player.name,
          age: player.age,
          lifespan: player.lifespan,
        }));
      }
    }
    const ending = this.checkFailure(state);
    if (ending !== null) {
      state.ending = ending;
      messages.push(ending.message);
    }
    if (advance.dayChanged) {
      messages.push(...this.chronicle.completeDay(state, completedClock, messages));
    } else {
      this.chronicle.record(state, messages);
    }
    return messages;
  }

  /** 读取并校验指定行动类型的个人与群体饥饿增量。 */
  private actionHungerCosts(
    actionType?: string,
  ): GameContent["game"]["rules"]["action_hunger_costs"][string] {
    const rules = this.content.game.rules;
    const resolvedType = actionType ?? rules.default_survival_action_type;
    const costs = rules.action_hunger_costs[resolvedType];
    if (costs === undefined) {
      throw new DomainError(this.content.text("unknown_survival_action_type", {
        action_type: resolvedType,
      }));
    }
    if (
      !Number.isInteger(costs.player_hunger_gain)
      || costs.player_hunger_gain < 0
      || !Number.isInteger(costs.group_hunger_gain_per_person)
      || costs.group_hunger_gain_per_person < 0
    ) {
      throw new DomainError(this.content.text("invalid_action_hunger_config", {
        action_type: resolvedType,
      }));
    }
    return costs;
  }

  /** 读取当前模式的生存损耗百分比。 */
  private modeSurvivalCostPercent(mode: GameState["mode"]): number {
    const percent = this.content.game.rules.mode_survival_cost_percent[mode];
    if (!Number.isInteger(percent) || percent < 0) {
      throw new DomainError(this.content.text("invalid_mode_survival_cost", { mode }));
    }
    return percent;
  }

  /** 合并游戏模式与难度档案的生存损耗比例。 */
  private survivalCostPercent(state: GameState): number {
    const modePercent = this.modeSurvivalCostPercent(state.mode);
    const difficultyPercent = this.campaignProfiles.survivalCostPercent(state);
    if (!Number.isInteger(difficultyPercent) || difficultyPercent < 0) {
      throw new DomainError(this.content.text("invalid_campaign_profile"));
    }
    return Math.floor((modePercent * difficultyPercent) / 100);
  }

  /** 将基础损耗、被动修正和模式比例合并为非负整数。 */
  private scaledSurvivalCost(
    base: number,
    modifierPercent: number,
    survivalCostPercent: number,
  ): number {
    if (base <= 0 || modifierPercent <= 0 || survivalCostPercent <= 0) return 0;
    return Math.max(
      1,
      Math.floor((base * modifierPercent * survivalCostPercent) / 10_000),
    );
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
      throw new DomainError(this.content.text("missing_failure_ending", {
        failure_id: failureId,
      }));
    }
    const textKey = failure.mode_text_keys?.[mode] ?? failure.text_key;
    return {
      ending_id: failure.ending_id,
      outcome: "failure",
      message: this.content.text(textKey, values),
    };
  }
}
