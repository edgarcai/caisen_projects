import type {
  EventChoiceConfig,
  EventOutcomeConfig,
  NumericEffectConfig,
  TradeAmbushConfig,
} from "../domain/content";
import { formatTemplate } from "../domain/content";
import { ShelterManagementError, StateOperationError } from "../domain/errors";
import { cloneGameState, type GameState } from "../domain/game-state";
import type { RandomSource } from "../domain/ports";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";

/** 一次交易途中风险判定的只读结果。 */
export interface TradeAmbushResolution {
  readonly occurred: boolean;
  readonly eventTitle: string;
  readonly message: string;
}

/** 独立解析交易伏击事件，避免交易流程依赖探索页面状态。 */
export class TradeAmbushService {
  private readonly content: GameContent;
  private readonly operations: StateOperations;
  private readonly random: RandomSource;

  /** 注入配置内容、状态操作器与可复现随机源。 */
  public constructor(
    content: GameContent,
    operations: StateOperations,
    random: RandomSource,
  ) {
    this.content = content;
    this.operations = operations;
    this.random = random;
  }

  /** 判定伏击并在完整结算成功后一次提交状态。 */
  public resolve(
    state: GameState,
    configuration: TradeAmbushConfig,
  ): TradeAmbushResolution {
    this.validateConfiguration(configuration);
    if (
      configuration.chance_percent === 0
      || this.random.randint(1, 100) > configuration.chance_percent
    ) {
      return { occurred: false, eventTitle: "", message: "" };
    }

    const event = this.content.event(configuration.event_id);
    const choice = event.choices?.find(
      (candidate) => candidate.id === configuration.choice_id,
    );
    if (choice === undefined) {
      throw new ShelterManagementError(this.content.text(
        "shelter_trade_ambush_choice_missing",
        {
          event_id: configuration.event_id,
          choice_id: configuration.choice_id,
        },
      ));
    }

    const outcome = this.selectOutcome(choice);
    const resultTemplate = outcome?.result ?? choice.result ?? event.result;
    if (resultTemplate === undefined) {
      throw new ShelterManagementError(this.content.text(
        "shelter_trade_ambush_result_missing",
        { event_id: configuration.event_id },
      ));
    }

    const working = cloneGameState(state);
    const effects: NumericEffectConfig[] = [
      ...(event.pre_effects ?? []),
      ...(event.effects ?? []),
      ...(choice.effects ?? []),
      ...(outcome?.effects ?? []),
    ];
    const tokens = this.applyEffects(effects, working);
    const messages = event.pre_result === undefined
      ? [this.formatResult(resultTemplate, tokens, configuration.event_id)]
      : [
          this.formatResult(event.pre_result, tokens, configuration.event_id),
          this.formatResult(resultTemplate, tokens, configuration.event_id),
        ];
    Object.assign(state, working);
    return {
      occurred: true,
      eventTitle: event.title,
      message: messages.join(this.content.text("shelter_trade_ambush_separator")),
    };
  }

  /** 按配置权重选择一个伏击叶结果；无随机结果时返回空。 */
  private selectOutcome(choice: EventChoiceConfig): EventOutcomeConfig | null {
    const outcomes = choice.outcomes ?? [];
    if (outcomes.length === 0) return null;
    return this.random.weightedChoice(
      outcomes,
      outcomes.map((outcome) => outcome.weight ?? 1),
    );
  }

  /** 原子副本中应用配置效果，并将目标错误转为经营错误。 */
  private applyEffects(
    effects: readonly NumericEffectConfig[],
    state: GameState,
  ): Record<string, number> {
    try {
      return this.operations.applyEffects(effects, state);
    } catch (error: unknown) {
      if (error instanceof StateOperationError) {
        throw new ShelterManagementError(this.content.text(
          "shelter_trade_ambush_effect_failed",
          { error: error.message },
        ));
      }
      throw error;
    }
  }

  /** 使用结算变量格式化伏击结果并转换缺失占位符错误。 */
  private formatResult(
    template: string,
    tokens: Readonly<Record<string, number>>,
    eventId: string,
  ): string {
    try {
      return formatTemplate(template, tokens);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ShelterManagementError(this.content.text(
        "shelter_trade_ambush_format_failed",
        { event_id: eventId, error: message },
      ));
    }
  }

  /** 校验伏击概率与配置 ID，防止无效内容进入随机结算。 */
  private validateConfiguration(configuration: TradeAmbushConfig): void {
    if (
      !Number.isInteger(configuration.chance_percent)
      || configuration.chance_percent < 0
      || configuration.chance_percent > 100
      || configuration.event_id.length === 0
      || configuration.choice_id.length === 0
    ) {
      throw new ShelterManagementError(
        this.content.text("shelter_trade_ambush_invalid_config"),
      );
    }
  }
}
