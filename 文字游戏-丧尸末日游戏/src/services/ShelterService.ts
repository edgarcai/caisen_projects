import type {
  FacilityConfig,
  FacilityLevelConfig,
  JobConfig,
  NumericEffectConfig,
  RecruitConfig,
  TradeConfig,
} from "../domain/content";
import { ShelterManagementError, StateOperationError } from "../domain/errors";
import { activePlayer, type GameState } from "../domain/game-state";
import type { RandomSource, RuleModifierProvider } from "../domain/ports";
import type {
  ManagementCategory,
  ManagementOption,
  ManagementResolution,
} from "../domain/reports";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";
import type { StoryService } from "./StoryService";

/** 实现设施、工作、交易、招募和被动规则修正。 */
export class ShelterService implements RuleModifierProvider {
  private readonly content: GameContent;
  private readonly operations: StateOperations;
  private readonly story: StoryService;
  private readonly random: RandomSource;
  private readonly facilityById: ReadonlyMap<string, FacilityConfig>;
  private readonly jobById: ReadonlyMap<string, JobConfig>;
  private readonly tradeById: ReadonlyMap<string, TradeConfig>;
  private readonly recruitById: ReadonlyMap<string, RecruitConfig>;

  /** 注入内容、状态操作器、剧情条件检查器与随机源。 */
  public constructor(
    content: GameContent,
    operations: StateOperations,
    story: StoryService,
    random: RandomSource,
  ) {
    this.content = content;
    this.operations = operations;
    this.story = story;
    this.random = random;
    this.facilityById = new Map(
      content.story.facilities.map((facility) => [facility.facility_id, facility]),
    );
    this.jobById = new Map(content.story.jobs.map((job) => [job.job_id, job]));
    this.tradeById = new Map(content.story.trades.map((trade) => [trade.trade_id, trade]));
    this.recruitById = new Map(
      content.story.recruits.map((recruit) => [recruit.recruit_id, recruit]),
    );
  }

  /** 返回所有设施、工作、买卖和招募项目的实时可用状态。 */
  public options(state: GameState): ManagementOption[] {
    return [
      ...this.facilityOptions(state),
      ...this.jobOptions(state),
      ...this.tradeOptions(state),
      ...this.recruitOptions(state),
    ];
  }

  /** 按经营类别路由一个具体命令。 */
  public perform(
    state: GameState,
    category: ManagementCategory,
    optionId: string,
  ): ManagementResolution {
    switch (category) {
      case "facility": return this.upgradeFacility(state, optionId);
      case "job": return this.performJob(state, optionId);
      case "trade_buy": return this.buyTrade(state, optionId);
      case "trade_sell": return this.sellTrade(state, optionId);
      case "recruit": return this.recruit(state, optionId);
      default:
        throw new ShelterManagementError(
          this.content.text("shelter_unknown_management_category", {
            category: String(category),
          }),
        );
    }
  }

  /** 生成设施等级、人口和当前可执行项目的总览。 */
  public overview(state: GameState): string {
    const facilityLines = this.content.story.facilities.map((facility) => {
      const level = state.facility_levels[facility.facility_id] ?? 0;
      return this.content.text("shelter_facility_overview_line", {
        facility_name: facility.name,
        level,
        max_level: facility.max_level,
        description: facility.description,
      });
    });
    const availableCount = this.options(state).filter((option) => option.available).length;
    return this.content.text("shelter_overview", {
      population: state.shelter.population,
      available_count: availableCount,
      facility_lines: facilityLines.join("\n"),
    });
  }

  /** 汇总设施、招募成员与同行伙伴提供的规则修正。 */
  public passiveModifier(state: GameState, target: string): number {
    let total = 0;
    for (const facility of this.content.story.facilities) {
      const currentLevel = state.facility_levels[facility.facility_id] ?? 0;
      for (const level of facility.levels) {
        if (level.level <= currentLevel) {
          total = this.accumulateModifier(total, level.effects ?? [], target);
        }
      }
    }
    for (const recruit of this.content.story.recruits) {
      if (recruit.add_flags.some((flag) => state.story.flags.includes(flag))) {
        total = this.accumulateModifier(total, recruit.effects ?? [], target);
      }
    }
    for (const profile of this.content.story.companions) {
      const companion = state.companions.find(
        (candidate) => candidate.companion_id === profile.companion_id,
      );
      if (companion === undefined || companion.status !== "active") {
        continue;
      }
      for (const perk of profile.trust_perks ?? []) {
        if (companion.trust >= perk.unlock_trust) {
          total = this.accumulateModifier(total, perk.effects ?? [], target);
        }
      }
    }
    return total;
  }

  /** 构造每项设施的下一等级升级选项。 */
  private facilityOptions(state: GameState): ManagementOption[] {
    return this.content.story.facilities.map((facility) => {
      const currentLevel = state.facility_levels[facility.facility_id] ?? 0;
      if (currentLevel >= facility.max_level) {
        return {
          optionId: facility.facility_id,
          label: this.content.text("shelter_facility_max_label", {
            facility_name: facility.name,
          }),
          category: "facility",
          available: false,
          description: facility.description,
        };
      }
      const level = facility.levels[currentLevel];
      if (level === undefined) {
        throw new ShelterManagementError(
          this.content.text("shelter_facility_level_missing", {
            facility_id: facility.facility_id,
          }),
        );
      }
      const [partsCost, coinsCost] = this.facilityCosts(state, level);
      const available = this.story.requirementsMet(
        facility.unlock_requirements ?? [],
        state,
      ) && this.canPayFacility(state, level);
      return {
        optionId: facility.facility_id,
        label: this.content.text("shelter_facility_upgrade_label", {
          facility_name: facility.name,
          level: level.level,
        }),
        category: "facility",
        available,
        description: this.content.text("shelter_facility_upgrade_description", {
          description: facility.description,
          parts_cost: partsCost,
          coins_cost: coinsCost,
          build_hours: level.build_hours,
        }),
      };
    });
  }

  /** 构造所有配置化工作选项。 */
  private jobOptions(state: GameState): ManagementOption[] {
    return this.content.story.jobs.map((job) => ({
      optionId: job.job_id,
      label: this.content.text("shelter_job_label", { job_name: job.name }),
      category: "job",
      available: this.story.requirementsMet(job.requirements ?? [], state)
        && this.canPayEffects(state, job.costs ?? []),
      description: this.content.text("shelter_job_description", {
        description: job.description,
        duration_hours: job.duration_hours,
      }),
    }));
  }

  /** 为每个商品同时构造购买和出售选项。 */
  private tradeOptions(state: GameState): ManagementOption[] {
    const options: ManagementOption[] = [];
    for (const trade of this.content.story.trades) {
      const unlocked = this.story.requirementsMet(trade.unlock_requirements ?? [], state);
      const current = this.operations.read(trade.resource_target, state);
      const buyPrice = this.tradeBuyPrice(state, trade);
      options.push({
        optionId: trade.trade_id,
        label: this.content.text("shelter_trade_buy_label", {
          item_name: trade.item_name,
          quantity: trade.quantity,
        }),
        category: "trade_buy",
        available: unlocked && activePlayer(state).coins >= buyPrice,
        description: this.content.text("shelter_trade_buy_description", {
          vendor_name: trade.vendor_name,
          price: buyPrice,
        }),
      });
      options.push({
        optionId: trade.trade_id,
        label: this.content.text("shelter_trade_sell_label", {
          item_name: trade.item_name,
          quantity: trade.quantity,
        }),
        category: "trade_sell",
        available: unlocked && current >= trade.quantity,
        description: this.content.text("shelter_trade_sell_description", {
          vendor_name: trade.vendor_name,
          price: trade.sell_price,
        }),
      });
    }
    return options;
  }

  /** 构造人员招募选项并阻止重复招募。 */
  private recruitOptions(state: GameState): ManagementOption[] {
    return this.content.story.recruits.map((recruit) => {
      const alreadyRecruited = recruit.add_flags.some((flag) => state.story.flags.includes(flag));
      return {
        optionId: recruit.recruit_id,
        label: this.content.text("shelter_recruit_label", {
          recruit_name: recruit.name,
          role: recruit.role,
        }),
        category: "recruit",
        available: !alreadyRecruited
          && this.story.requirementsMet(recruit.requirements ?? [], state)
          && this.canPayEffects(state, recruit.costs ?? []),
        description: alreadyRecruited
          ? this.content.text("shelter_recruit_already_joined_description")
          : recruit.description,
      };
    });
  }

  /** 支付成本并将指定设施提升一级。 */
  private upgradeFacility(state: GameState, facilityId: string): ManagementResolution {
    const facility = this.facilityById.get(facilityId);
    if (facility === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_facility", { facility_id: facilityId }),
      );
    }
    const currentLevel = state.facility_levels[facilityId] ?? 0;
    if (currentLevel >= facility.max_level) {
      return this.unavailable(
        this.content.text("shelter_facility_already_max", {
          facility_name: facility.name,
        }),
      );
    }
    if (!this.story.requirementsMet(facility.unlock_requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_facility_locked"));
    }
    const level = facility.levels[currentLevel];
    if (level === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_facility_level_missing", {
          facility_id: facilityId,
        }),
      );
    }
    if (!this.canPayFacility(state, level)) {
      return this.unavailable(
        this.content.text("shelter_facility_resources_insufficient"),
      );
    }
    const [partsCost, coinsCost] = this.facilityCosts(state, level);
    activePlayer(state).parts -= partsCost;
    activePlayer(state).coins -= coinsCost;
    state.facility_levels[facilityId] = level.level;
    this.applyEffects(
      (level.effects ?? []).filter((effect) => !effect.target.startsWith("rules.")),
      state,
    );
    return {
      messages: [
        this.content.text("shelter_facility_upgrade_success", {
          facility_name: facility.name,
          level: level.level,
        }),
      ],
      applied: true,
      consumesTurn: true,
      turnsConsumed: this.durationTurns(level.build_hours),
    };
  }

  /** 结算工作成本、随机产出和风险事件。 */
  private performJob(state: GameState, jobId: string): ManagementResolution {
    const job = this.jobById.get(jobId);
    if (job === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_job", { job_id: jobId }),
      );
    }
    if (!this.story.requirementsMet(job.requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_job_locked"));
    }
    if (!this.canPayEffects(state, job.costs ?? [])) {
      return this.unavailable(
        this.content.text("shelter_job_resources_insufficient"),
      );
    }
    this.applyEffects(job.costs ?? [], state);
    this.applyEffects(job.rewards ?? [], state);
    const evidenceBonus = this.passiveModifier(state, "rules.story_evidence_job_bonus");
    if (evidenceBonus > 0 && (job.rewards ?? []).some(
      (reward) => reward.target === "story.evidence",
    )) {
      state.story.evidence += evidenceBonus;
    }
    const messages = [this.content.text("shelter_job_success", {
      job_name: job.name,
      description: job.description,
    })];
    if (job.risk !== undefined && this.random.randint(1, 100) <= job.risk.chance_percent) {
      this.applyEffects(job.risk.effects ?? [], state);
      messages.push(job.risk.message);
    }
    return {
      messages,
      applied: true,
      consumesTurn: true,
      turnsConsumed: this.durationTurns(job.duration_hours),
    };
  }

  /** 支付金币并购入一份配置化商品。 */
  private buyTrade(state: GameState, tradeId: string): ManagementResolution {
    const trade = this.trade(tradeId);
    if (!this.story.requirementsMet(trade.unlock_requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_trade_locked"));
    }
    const price = this.tradeBuyPrice(state, trade);
    if (activePlayer(state).coins < price) {
      return this.unavailable(
        this.content.text("shelter_trade_coins_insufficient"),
      );
    }
    activePlayer(state).coins -= price;
    const current = this.operations.read(trade.resource_target, state);
    this.operations.write(trade.resource_target, current + trade.quantity, state);
    return {
      messages: [
        this.content.text("shelter_trade_buy_success", {
          vendor_name: trade.vendor_name,
          item_name: trade.item_name,
          quantity: trade.quantity,
          price,
        }),
      ],
      applied: true,
      consumesTurn: false,
      turnsConsumed: 0,
    };
  }

  /** 出售一份配置化商品并获得金币。 */
  private sellTrade(state: GameState, tradeId: string): ManagementResolution {
    const trade = this.trade(tradeId);
    if (!this.story.requirementsMet(trade.unlock_requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_trade_locked"));
    }
    const current = this.operations.read(trade.resource_target, state);
    if (current < trade.quantity) {
      return this.unavailable(
        this.content.text("shelter_trade_resources_insufficient"),
      );
    }
    this.operations.write(trade.resource_target, current - trade.quantity, state);
    activePlayer(state).coins += trade.sell_price;
    return {
      messages: [
        this.content.text("shelter_trade_sell_success", {
          vendor_name: trade.vendor_name,
          item_name: trade.item_name,
          quantity: trade.quantity,
          price: trade.sell_price,
        }),
      ],
      applied: true,
      consumesTurn: false,
      turnsConsumed: 0,
    };
  }

  /** 支付招募成本、应用成员效果并写入不可重复标记。 */
  private recruit(state: GameState, recruitId: string): ManagementResolution {
    const recruit = this.recruitById.get(recruitId);
    if (recruit === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_recruit", { recruit_id: recruitId }),
      );
    }
    if (recruit.add_flags.some((flag) => state.story.flags.includes(flag))) {
      return this.unavailable(
        this.content.text("shelter_recruit_already_joined"),
      );
    }
    if (!this.story.requirementsMet(recruit.requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_recruit_locked"));
    }
    if (!this.canPayEffects(state, recruit.costs ?? [])) {
      return this.unavailable(
        this.content.text("shelter_recruit_resources_insufficient"),
      );
    }
    this.applyEffects(recruit.costs ?? [], state);
    this.applyEffects(
      (recruit.effects ?? []).filter((effect) => !effect.target.startsWith("rules.")),
      state,
    );
    for (const flag of recruit.add_flags) {
      if (!state.story.flags.includes(flag)) {
        state.story.flags.push(flag);
      }
    }
    return {
      messages: [this.content.text("shelter_recruit_success", {
        recruit_name: recruit.name,
        role: recruit.role,
        description: recruit.description,
      })],
      applied: true,
      consumesTurn: true,
      turnsConsumed: 1,
    };
  }

  /** 检查当前所长能否支付设施升级的实际成本。 */
  private canPayFacility(state: GameState, level: FacilityLevelConfig): boolean {
    const [partsCost, coinsCost] = this.facilityCosts(state, level);
    return activePlayer(state).parts >= partsCost && activePlayer(state).coins >= coinsCost;
  }

  /** 按伙伴被动修正计算设施本级零件与金币成本。 */
  private facilityCosts(state: GameState, level: FacilityLevelConfig): [number, number] {
    const percent = 100 + this.passiveModifier(state, "rules.facility_parts_cost_percent");
    return [Math.max(0, Math.floor((level.parts_cost * percent) / 100)), level.coins_cost];
  }

  /** 按设施和伙伴议价特性计算实际买入价。 */
  private tradeBuyPrice(state: GameState, trade: TradeConfig): number {
    const percent = 100 + this.passiveModifier(state, "rules.trade_buy_price_percent");
    return Math.max(1, Math.floor((trade.buy_price * percent) / 100));
  }

  /** 将配置耗时换算为至少一个完整生存回合。 */
  private durationTurns(durationHours: number): number {
    const hoursPerTurn = this.content.game.rules.time.hours_per_action;
    return Math.max(1, Math.ceil(durationHours / hoursPerTurn));
  }

  /** 检查所有减少型成本都不会使对应资源为负数。 */
  private canPayEffects(state: GameState, effects: readonly NumericEffectConfig[]): boolean {
    for (const effect of effects) {
      if (effect.operation !== "subtract") continue;
      const required = typeof effect.amount === "number"
        ? effect.amount
        : effect.amount[1];
      if (this.operations.read(effect.target, state) < required) {
        return false;
      }
    }
    return true;
  }

  /** 应用经营数值效果并转换目标读写错误。 */
  private applyEffects(effects: readonly NumericEffectConfig[], state: GameState): void {
    try {
      this.operations.applyEffects(effects, state);
    } catch (error: unknown) {
      if (error instanceof StateOperationError) {
        throw new ShelterManagementError(
          this.content.text("shelter_effect_failed", { error: error.message }),
        );
      }
      throw error;
    }
  }

  /** 按稳定 ID 返回交易配置。 */
  private trade(tradeId: string): TradeConfig {
    const trade = this.tradeById.get(tradeId);
    if (trade === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_trade", { trade_id: tradeId }),
      );
    }
    return trade;
  }

  /** 把一组匹配目标的规则效果累加到当前修正值。 */
  private accumulateModifier(
    current: number,
    effects: readonly NumericEffectConfig[],
    target: string,
  ): number {
    let result = current;
    for (const effect of effects) {
      if (effect.target !== target || typeof effect.amount !== "number") continue;
      if (effect.operation === "add") result += effect.amount;
      else if (effect.operation === "subtract") result -= effect.amount;
      else result = effect.amount;
    }
    return result;
  }

  /** 构造一个不改变状态也不消耗回合的经营失败结果。 */
  private unavailable(message: string): ManagementResolution {
    return {
      messages: [message],
      applied: false,
      consumesTurn: false,
      turnsConsumed: 0,
    };
  }
}
