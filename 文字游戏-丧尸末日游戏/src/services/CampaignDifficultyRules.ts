import type {
  CampaignDifficultyConfig,
  NumericAmount,
  NumericEffectConfig,
} from "../domain/content";
import { DomainError } from "../domain/errors";
import type { GameState } from "../domain/game-state";
import type { GameContent } from "./GameContent";

const PERCENT_BASE = 100;

/** 运行时系统只消费这份不可变难度投影。 */
export interface CampaignDifficultySnapshot {
  readonly survivalCostPercent: number;
  readonly enemyHealthPercent: number;
  readonly enemyDamagePercent: number;
  readonly commonLootPercent: number;
  readonly textLootPercent: number;
  readonly researchCostPercent: number;
  readonly tradePricePercent: number;
  readonly hopeLossPercent: number;
}

const DIFFICULTY_SNAPSHOT_KEYS = [
  "survivalCostPercent",
  "enemyHealthPercent",
  "enemyDamagePercent",
  "commonLootPercent",
  "textLootPercent",
  "researchCostPercent",
  "tradePricePercent",
  "hopeLossPercent",
] as const satisfies readonly (keyof CampaignDifficultySnapshot)[];

/** 探索效果按仓库目录分类，避免在规则服务内硬编码资源字段。 */
export interface CampaignDifficultyLootTargets {
  readonly common: readonly string[];
  readonly text: readonly string[];
}

/** 集中解析并投影难度倍率，业务服务无需了解难度 ID 或配置结构。 */
export class CampaignDifficultyRules {
  private readonly content: GameContent;
  private readonly snapshots: ReadonlyMap<string, CampaignDifficultySnapshot>;
  private readonly commonLootTargets: ReadonlySet<string>;
  private readonly textLootTargets: ReadonlySet<string>;

  /** 注入运行时内容与由仓库目录生成的掉落目标分类。 */
  public constructor(
    content: GameContent,
    lootTargets: CampaignDifficultyLootTargets,
  ) {
    this.content = content;
    this.commonLootTargets = new Set(lootTargets.common);
    this.textLootTargets = new Set(lootTargets.text);
    this.validateLootTargets();
    this.snapshots = new Map(
      content.game.campaign_profiles.difficulties.map((difficulty) => [
        difficulty.id,
        this.createSnapshot(difficulty),
      ]),
    );
  }

  /** 返回当前存档难度的完整、类型化倍率快照。 */
  public snapshot(state: GameState): CampaignDifficultySnapshot {
    const snapshot = this.snapshots.get(state.campaign.difficulty_id);
    if (snapshot === undefined) {
      throw new DomainError(this.content.text("invalid_campaign_profile"));
    }
    return snapshot;
  }

  /** 缩放首领的初始与最大生命。 */
  public enemyHealth(base: number, state: GameState): number {
    return this.scalePositiveInteger(base, this.snapshot(state).enemyHealthPercent);
  }

  /** 缩放首领反击在玩家守备减伤前的实际伤害。 */
  public enemyDamage(base: number, state: GameState): number {
    return this.scalePositiveInteger(base, this.snapshot(state).enemyDamagePercent);
  }

  /** 缩放探索中普通仓库资源的正向掉落。 */
  public commonLoot(base: number, state: GameState): number {
    return this.scalePositiveInteger(base, this.snapshot(state).commonLootPercent);
  }

  /** 缩放探索中报纸、书籍与杂志等文本资源掉落。 */
  public textLoot(base: number, state: GameState): number {
    return this.scalePositiveInteger(base, this.snapshot(state).textLootPercent);
  }

  /** 缩放研究项目的聚合资源成本。 */
  public researchCost(base: number, state: GameState): number {
    return this.scalePositiveInteger(base, this.snapshot(state).researchCostPercent);
  }

  /** 按难度经济倍率缩放商队买入价。 */
  public tradeBuyPrice(base: number, state: GameState): number {
    return this.scalePositiveInteger(base, this.snapshot(state).tradePricePercent);
  }

  /** 以买入倍率的倒数投影卖出价，使高难度同时买贵卖便宜。 */
  public tradeSellPrice(base: number, state: GameState): number {
    const percent = this.snapshot(state).tradePricePercent;
    this.assertPositiveInteger(base, "交易卖出基础价");
    if (base === 0) return 0;
    return Math.max(1, Math.floor((base * PERCENT_BASE) / percent));
  }

  /** 合并模式与难度希望倍率，避免再叠加通用难度生存损耗。 */
  public hopeLoss(
    base: number,
    modePercent: number,
    state: GameState,
  ): number {
    this.assertPositiveInteger(base, "希望损失基础值");
    this.assertPositiveInteger(modePercent, "模式希望损失百分比");
    if (base === 0 || modePercent === 0) return 0;
    const difficultyPercent = this.snapshot(state).hopeLossPercent;
    return Math.max(
      1,
      Math.floor(
        (base * modePercent * difficultyPercent)
        / (PERCENT_BASE * PERCENT_BASE),
      ),
    );
  }

  /** 只投影配置为仓库掉落的正向 add 效果，损失与属性收益保持原值。 */
  public explorationEffects(
    effects: readonly NumericEffectConfig[],
    state: GameState,
  ): readonly NumericEffectConfig[] {
    const snapshot = this.snapshot(state);
    return effects.map((effect) => {
      if (effect.operation !== "add" || !this.positiveAmount(effect.amount)) {
        return effect;
      }
      const percent = this.textLootTargets.has(effect.target)
        ? snapshot.textLootPercent
        : this.commonLootTargets.has(effect.target)
          ? snapshot.commonLootPercent
          : null;
      if (percent === null) return effect;
      return {
        ...effect,
        amount: this.scaleAmount(effect.amount, percent),
      };
    });
  }

  /** 将领域难度配置转为驼峰命名的运行时快照并完成防御性校验。 */
  private createSnapshot(
    difficulty: CampaignDifficultyConfig,
  ): CampaignDifficultySnapshot {
    const snapshot: CampaignDifficultySnapshot = {
      survivalCostPercent: difficulty.survival_cost_percent,
      enemyHealthPercent: difficulty.enemy_health_percent,
      enemyDamagePercent: difficulty.enemy_damage_percent,
      commonLootPercent: difficulty.common_loot_percent,
      textLootPercent: difficulty.text_loot_percent,
      researchCostPercent: difficulty.research_cost_percent,
      tradePricePercent: difficulty.trade_price_percent,
      hopeLossPercent: difficulty.hope_loss_percent,
    };
    for (const key of DIFFICULTY_SNAPSHOT_KEYS) {
      this.assertStrictlyPositiveInteger(snapshot[key], `${difficulty.id}.${key}`);
    }
    return Object.freeze(snapshot);
  }

  /** 将固定整数或随机区间的两端使用同一倍率投影。 */
  private scaleAmount(amount: NumericAmount, percent: number): NumericAmount {
    if (typeof amount === "number") {
      return this.scalePositiveInteger(amount, percent);
    }
    return [
      this.scalePositiveInteger(amount[0], percent),
      this.scalePositiveInteger(amount[1], percent),
    ];
  }

  /** 按百分比向下取整，但保证原本存在的正整数不会消失。 */
  private scalePositiveInteger(base: number, percent: number): number {
    this.assertPositiveInteger(base, "难度投影基础值");
    this.assertStrictlyPositiveInteger(percent, "难度投影百分比");
    if (base === 0) return 0;
    return Math.max(1, Math.floor((base * percent) / PERCENT_BASE));
  }

  /** 判断效果的固定值或区间是否至少包含一个正向数量。 */
  private positiveAmount(amount: NumericAmount): boolean {
    return typeof amount === "number" ? amount > 0 : amount[1] > 0;
  }

  /** 拒绝普通掉落与文本掉落分类交叉，防止同一效果产生歧义。 */
  private validateLootTargets(): void {
    for (const target of this.commonLootTargets) {
      if (this.textLootTargets.has(target)) {
        throw new DomainError(`难度掉落目标重复分类：${target}`);
      }
    }
  }

  /** 校验允许为零的整数数量。 */
  private assertPositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new DomainError(`${label}必须是非负整数。`);
    }
  }

  /** 校验不允许为零的整数倍率。 */
  private assertStrictlyPositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new DomainError(`${label}必须是正整数。`);
    }
  }
}
