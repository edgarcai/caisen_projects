import { formatTemplate } from "../domain/content";
import type { GameState } from "../domain/game-state";
import type { RandomSource } from "../domain/ports";
import type { StateOperations } from "./StateOperations";

/** 一项由起源或特性触发的明确随机加成。 */
export interface ProfileTriggeredBonusDefinition {
  readonly triggerId: string;
  readonly target: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly chancePercent: number;
  readonly description: string;
}

/** 拥有稳定 ID 和展示名的起源或特性加成集。 */
export interface ProfileTriggeredBonusSource {
  readonly type: "origin" | "trait";
  readonly id: string;
  readonly name: string;
  readonly bonuses: readonly ProfileTriggeredBonusDefinition[];
}

/** 触发检测与奖励写入使用的配置化映射。 */
export interface ProfileTriggeredBonusConfig {
  readonly secondaryTraitFlagPrefix: string;
  readonly triggerObservationTargets: Readonly<Record<string, readonly string[]>>;
  readonly rewardStateTargets: Readonly<Record<string, string>>;
  readonly activatedText: string;
}

/** 在探索状态差异上结算起源与双特性的随机加成。 */
export class ProfileTriggeredBonusService {
  private readonly config: ProfileTriggeredBonusConfig;
  private readonly sources: readonly ProfileTriggeredBonusSource[];
  private readonly operations: StateOperations;
  private readonly random: RandomSource;

  /** 注入映射配置、内容目录、状态操作和随机端口。 */
  public constructor(
    config: ProfileTriggeredBonusConfig,
    sources: readonly ProfileTriggeredBonusSource[],
    operations: StateOperations,
    random: RandomSource,
  ) {
    this.config = structuredClone(config);
    this.sources = structuredClone(sources);
    this.operations = operations;
    this.random = random;
    this.validateConfig();
  }

  /** 比较探索前后资源，为当前起源和双特性结算可支持加成。 */
  public applyExplorationBonuses(
    before: GameState,
    state: GameState,
  ): readonly string[] {
    const activeSources = this.activeSources(state);
    const messages: string[] = [];
    for (const source of activeSources) {
      for (const bonus of source.bonuses) {
        if (!this.triggeredByStateChange(bonus.triggerId, before, state)) continue;
        const rewardTarget = this.config.rewardStateTargets[bonus.target];
        if (rewardTarget === undefined) continue;
        if (this.random.randint(1, 100) > bonus.chancePercent) continue;
        const amount = this.random.randint(bonus.minimum, bonus.maximum);
        const current = this.operations.read(rewardTarget, state);
        this.operations.write(rewardTarget, current + amount, state);
        messages.push(formatTemplate(this.config.activatedText, {
          profile_name: source.name,
          amount,
          description: bonus.description,
        }));
      }
    }
    return messages;
  }

  /** 验证概率、区间、映射和特性标记配置。 */
  private validateConfig(): void {
    if (
      this.config.secondaryTraitFlagPrefix.trim() === ""
      || this.config.activatedText.trim() === ""
    ) {
      throw new Error("开局档案触发加成配置无效。");
    }
    for (const source of this.sources) {
      for (const bonus of source.bonuses) {
        if (
          !Number.isInteger(bonus.minimum)
          || !Number.isInteger(bonus.maximum)
          || bonus.minimum < 0
          || bonus.maximum < bonus.minimum
          || !Number.isInteger(bonus.chancePercent)
          || bonus.chancePercent < 0
          || bonus.chancePercent > 100
        ) {
          throw new Error(`档案加成配置无效：${source.id}/${bonus.triggerId}。`);
        }
      }
    }
  }

  /** 返回当前起源、主特性和 story.flags 中的第二特性。 */
  private activeSources(state: GameState): readonly ProfileTriggeredBonusSource[] {
    const secondaryTraitId = state.story.flags.find((flag) =>
      flag.startsWith(this.config.secondaryTraitFlagPrefix),
    )?.slice(this.config.secondaryTraitFlagPrefix.length);
    const identities = new Set([
      `origin:${state.campaign.origin_id}`,
      `trait:${state.campaign.trait_id}`,
      ...(secondaryTraitId === undefined ? [] : [`trait:${secondaryTraitId}`]),
    ]);
    return this.sources.filter((source) => identities.has(`${source.type}:${source.id}`));
  }

  /** 判断触发器配置的任一观测资源是否在探索中增加。 */
  private triggeredByStateChange(
    triggerId: string,
    before: GameState,
    state: GameState,
  ): boolean {
    const targets = this.config.triggerObservationTargets[triggerId];
    if (targets === undefined) return false;
    return targets.some((target) =>
      this.operations.read(target, state) > this.operations.read(target, before),
    );
  }
}
