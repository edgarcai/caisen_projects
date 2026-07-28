import type {
  EventChoiceConfig,
  EventConfig,
  EventOutcomeConfig,
  NumericEffectConfig,
  RequirementConfig,
} from "../domain/content";
import { formatTemplate } from "../domain/content";
import { ExplorationError, StateOperationError } from "../domain/errors";
import { cloneGameState, type GameState } from "../domain/game-state";
import type { RandomSource } from "../domain/ports";
import type { EventPrompt, EventResolution } from "../domain/reports";
import type { CampaignDifficultyRules } from "./CampaignDifficultyRules";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";

type EventPayload = EventConfig | EventChoiceConfig | EventOutcomeConfig;

/** 负责按区划权重抽取并原子结算配置化探索事件。 */
export class ExplorationService {
  private readonly content: GameContent;
  private readonly operations: StateOperations;
  private readonly random: RandomSource;
  private readonly difficultyRules: CampaignDifficultyRules;

  /** 注入内容、状态操作器、可复现随机源与难度掉落投影器。 */
  public constructor(
    content: GameContent,
    operations: StateOperations,
    random: RandomSource,
    difficultyRules: CampaignDifficultyRules,
  ) {
    this.content = content;
    this.operations = operations;
    this.random = random;
    this.difficultyRules = difficultyRules;
  }

  /** 按伙伴和设施的分类权重修正抽取所选区划事件。 */
  public prepare(
    cityId: string,
    districtId: string,
    weightModifiers: Readonly<Record<string, number>> = {},
  ): EventPrompt {
    const district = this.content.district(cityId, districtId);
    const events = district.event_ids.map((eventId) => this.content.event(eventId));
    if (events.length === 0) {
      throw new ExplorationError(`区划 ${districtId} 没有配置探索事件。`);
    }
    const weights = events.map((event) => {
      const modifier = weightModifiers[event.category ?? "common"] ?? 0;
      return event.weight * Math.max(1, 100 + modifier);
    });
    return this.buildPrompt(this.random.weightedChoice(events, weights));
  }

  /** 根据已持久化事件 ID 重建提示，不再次抽取。 */
  public prompt(eventId: string): EventPrompt {
    return this.buildPrompt(this.content.event(eventId));
  }

  /** 检查旧事件结算选项当前是否满足条件，不执行随机抽取或数值效果。 */
  public canResolve(
    eventId: string,
    choiceId: string | null,
    state: GameState,
  ): boolean {
    const event = this.content.event(eventId);
    const payload = this.resolveChoice(event, choiceId);
    const requirements = "requirements" in payload
      ? payload.requirements ?? []
      : [];
    return this.requirementsMet(requirements, state);
  }

  /** 原子应用事件开场效果，并返回开场文案。 */
  public applyPrelude(eventId: string, state: GameState): string | null {
    const event = this.content.event(eventId);
    const effects = event.pre_effects ?? [];
    if (effects.length === 0 && event.pre_result === undefined) {
      return null;
    }
    const working = cloneGameState(state);
    const tokens = this.applyEffects(effects, working);
    const message = event.pre_result === undefined
      ? null
      : this.formatResult(eventId, event.pre_result, tokens);
    this.commit(working, state);
    return message;
  }

  /** 在状态副本上解析事件、随机结果与数值效果。 */
  public resolve(
    eventId: string,
    choiceId: string | null,
    state: GameState,
    outcomeId: string | null = null,
  ): EventResolution {
    const event = this.content.event(eventId);
    const payload = this.resolveChoice(event, choiceId);
    const requirements = "requirements" in payload
      ? payload.requirements ?? []
      : [];
    if (!this.requirementsMet(requirements, state)) {
      return {
        message: this.content.text("event_requirement_failed"),
        applied: false,
      };
    }
    const resolved = this.selectOutcome(payload, outcomeId);
    const working = cloneGameState(state);
    const effects: NumericEffectConfig[] = [...(event.pre_effects ?? [])];
    if (resolved !== event) {
      effects.push(...(event.effects ?? []));
    }
    effects.push(...(resolved.effects ?? []));
    const tokens = this.applyEffects(effects, working);
    if (resolved.result === undefined) {
      throw new ExplorationError(`事件 ${eventId} 缺少结果文案。`);
    }
    let message = this.formatResult(eventId, resolved.result, tokens);
    if (event.pre_result !== undefined) {
      message = `${this.formatResult(eventId, event.pre_result, tokens)} ${message}`;
    }
    this.commit(working, state);
    return { message, applied: true };
  }

  /** 把事件配置转换为不可变的展示提示。 */
  private buildPrompt(event: EventConfig): EventPrompt {
    return {
      eventId: event.id,
      title: event.title,
      intro: event.intro,
      choices: (event.choices ?? []).map((choice) => ({
        choiceId: choice.id,
        label: choice.label,
      })),
    };
  }

  /** 根据事件定义返回玩家选中的分支。 */
  private resolveChoice(event: EventConfig, choiceId: string | null): EventConfig | EventChoiceConfig {
    const choices = event.choices ?? [];
    if (choices.length === 0) {
      if (choiceId !== null) {
        throw new ExplorationError(`事件 ${event.id} 不接受分支选择。`);
      }
      return event;
    }
    if (choiceId === null) {
      throw new ExplorationError(`事件 ${event.id} 需要玩家选择。`);
    }
    const choice = choices.find((candidate) => candidate.id === choiceId);
    if (choice === undefined) {
      throw new ExplorationError(`事件 ${event.id} 不存在选择 ${choiceId}。`);
    }
    return choice;
  }

  /** 在分支含有多个随机叶结果时按权重抽取一项。 */
  private selectOutcome(
    payload: EventConfig | EventChoiceConfig,
    outcomeId: string | null,
  ): EventPayload {
    const outcomes = "outcomes" in payload ? payload.outcomes ?? [] : [];
    if (outcomes.length === 0) {
      if (outcomeId !== null) {
        throw new ExplorationError(`探索结算不存在随机结果 ${outcomeId}。`);
      }
      return payload;
    }
    if (outcomeId !== null) {
      const selected = outcomes.find((outcome) => outcome.id === outcomeId);
      if (selected === undefined) {
        throw new ExplorationError(`探索结算不存在随机结果 ${outcomeId}。`);
      }
      return selected;
    }
    return this.random.weightedChoice(
      outcomes,
      outcomes.map((outcome) => outcome.weight ?? 1),
    );
  }

  /** 检查事件分支声明的全部数值前置条件。 */
  private requirementsMet(
    requirements: readonly RequirementConfig[],
    state: GameState,
  ): boolean {
    for (const requirement of requirements) {
      if (requirement.target === undefined || requirement.value === undefined) {
        throw new ExplorationError("探索条件缺少目标或阈值。");
      }
      const current = this.operations.read(requirement.target, state);
      const operator = requirement.operator;
      if (operator === "gte" && current < requirement.value) return false;
      if (operator === "lte" && current > requirement.value) return false;
      if (operator === "eq" && current !== requirement.value) return false;
      if (operator !== "gte" && operator !== "lte" && operator !== "eq") {
        throw new ExplorationError(`不支持的探索条件运算：${String(operator)}`);
      }
    }
    return true;
  }

  /** 应用配置化事件效果，并转换状态目标错误。 */
  private applyEffects(
    effects: readonly NumericEffectConfig[],
    state: GameState,
  ): Record<string, number> {
    try {
      return this.operations.applyEffects(
        this.difficultyRules.explorationEffects(effects, state),
        state,
      );
    } catch (error: unknown) {
      if (error instanceof StateOperationError) {
        throw new ExplorationError(`探索效果无法应用：${error.message}`);
      }
      throw error;
    }
  }

  /** 用已结算的变量格式化事件结果文案。 */
  private formatResult(
    eventId: string,
    template: string,
    tokens: Readonly<Record<string, number>>,
  ): string {
    try {
      return formatTemplate(template, tokens);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExplorationError(`事件 ${eventId} 文案格式化失败：${message}`);
    }
  }

  /** 将已完整结算的玩家和避难所状态一次提交。 */
  private commit(source: GameState, target: GameState): void {
    target.players = source.players;
    target.active_player_index = source.active_player_index;
    target.shelter = source.shelter;
    target.archive_collection_totals = source.archive_collection_totals;
  }
}
