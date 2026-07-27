import {
  formatTemplate,
  type FacilityConfig,
  type FacilityActionConfig,
  type FacilityLevelConfig,
  type JobConfig,
  type ModeRestrictedContentConfig,
  type NumericEffectConfig,
  type RecruitConfig,
  type RequirementConfig,
  type ShelterActivityConfig,
  type TradeConfig,
} from "../domain/content";
import { ShelterManagementError, StateOperationError } from "../domain/errors";
import { activePlayer, cloneGameState, type GameState } from "../domain/game-state";
import type { RandomSource, RuleModifierProvider } from "../domain/ports";
import type {
  ManagementCategory,
  ManagementField,
  ManagementOption,
  ManagementRequirement,
  ManagementResolution,
} from "../domain/reports";
import { isStaticStateOperationTargetSupported } from "../domain/state-operation-targets";
import type { CampaignDifficultyRules } from "./CampaignDifficultyRules";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";
import type { StoryService } from "./StoryService";
import type { TradeAmbushService } from "./TradeAmbushService";
import { playableTurnsPerDay, weekdayIndex } from "./GameClock";

interface TradeCycleSnapshot {
  readonly cycleIndex: number;
  readonly used: number;
  readonly maximum: number;
}

/** 实现设施、工作、交易、招募和被动规则修正。 */
export class ShelterService implements RuleModifierProvider {
  private readonly content: GameContent;
  private readonly operations: StateOperations;
  private readonly story: StoryService;
  private readonly random: RandomSource;
  private readonly tradeAmbush: TradeAmbushService;
  private readonly difficultyRules: CampaignDifficultyRules;
  private readonly facilityById: ReadonlyMap<string, FacilityConfig>;
  private readonly facilityActionById: ReadonlyMap<string, FacilityActionConfig>;
  private readonly jobById: ReadonlyMap<string, JobConfig>;
  private readonly activityById: ReadonlyMap<string, ShelterActivityConfig>;
  private readonly tradeById: ReadonlyMap<string, TradeConfig>;
  private readonly recruitById: ReadonlyMap<string, RecruitConfig>;

  /** 注入内容、状态操作器、剧情条件、随机源、交易风险与难度经济规则。 */
  public constructor(
    content: GameContent,
    operations: StateOperations,
    story: StoryService,
    random: RandomSource,
    tradeAmbush: TradeAmbushService,
    difficultyRules: CampaignDifficultyRules,
  ) {
    this.content = content;
    this.operations = operations;
    this.story = story;
    this.random = random;
    this.tradeAmbush = tradeAmbush;
    this.difficultyRules = difficultyRules;
    this.facilityById = new Map(
      content.story.facilities.map((facility) => [facility.facility_id, facility]),
    );
    this.facilityActionById = new Map(
      content.story.facility_actions.map((action) => [action.action_id, action]),
    );
    this.validateFacilityActions();
    this.jobById = new Map(content.story.jobs.map((job) => [job.job_id, job]));
    this.activityById = new Map(
      content.story.activities.map((activity) => [activity.activity_id, activity]),
    );
    this.tradeById = new Map(content.story.trades.map((trade) => [trade.trade_id, trade]));
    this.recruitById = new Map(
      content.story.recruits.map((recruit) => [recruit.recruit_id, recruit]),
    );
  }

  /** 返回所有设施、工作、活动、买卖和招募项目的实时可用状态。 */
  public options(state: GameState): ManagementOption[] {
    return [
      ...this.facilityOptions(state),
      ...this.facilityActionOptions(state),
      ...this.jobOptions(state),
      ...this.activityOptions(state),
      ...this.tradeOptions(state),
      ...this.recruitOptions(state),
    ].filter((option) => this.isManagementOptionAllowed(
      state,
      option.category,
      option.optionId,
    ));
  }

  /** 按经营类别路由一个具体命令。 */
  public perform(
    state: GameState,
    category: ManagementCategory,
    optionId: string,
    repetitions = 1,
  ): ManagementResolution {
    this.assertManagementOptionAllowed(state, category, optionId);
    switch (category) {
      case "facility": return this.upgradeFacility(state, optionId);
      case "facility_use": return this.useFacility(state, optionId);
      case "job": return this.performJobRepeated(state, optionId, repetitions);
      case "activity": return this.performActivity(state, optionId);
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

  /** 返回指定模式是否可以查看和执行该经营项。 */
  private isManagementOptionAllowed(
    state: GameState,
    category: ManagementCategory,
    optionId: string,
  ): boolean {
    const capability = this.managementOptionConfig(category, optionId)
      ?.required_mode_capability;
    return capability === undefined
      || this.content.game.mode_capabilities[state.mode].includes(capability);
  }

  /** 拒绝通过伪造界面命令越过模式内容边界。 */
  private assertManagementOptionAllowed(
    state: GameState,
    category: ManagementCategory,
    optionId: string,
  ): void {
    const capability = this.managementOptionConfig(category, optionId)
      ?.required_mode_capability;
    if (
      capability !== undefined
      && !this.content.game.mode_capabilities[state.mode].includes(capability)
    ) {
      throw new ShelterManagementError(this.content.text(
        "mode_capability_unavailable",
        { capability },
      ));
    }
  }

  /** 按经营类别与稳定 ID 返回可选的模式限制配置。 */
  private managementOptionConfig(
    category: ManagementCategory,
    optionId: string,
  ): ModeRestrictedContentConfig | undefined {
    switch (category) {
      case "facility": return this.facilityById.get(optionId);
      case "facility_use": return this.facilityActionById.get(optionId);
      case "job": return this.jobById.get(optionId);
      case "activity": return this.activityById.get(optionId);
      case "trade_buy":
      case "trade_sell": return this.tradeById.get(optionId);
      case "recruit": return this.recruitById.get(optionId);
      default: return undefined;
    }
  }

  /** 构造已建设设施的主动能力，并显示等级、成本与执行耗时。 */
  private facilityActionOptions(state: GameState): ManagementOption[] {
    return this.content.story.facility_actions.map((action) => {
      const facility = this.requireFacility(action.facility_id);
      const currentLevel = state.facility_levels[facility.facility_id] ?? 0;
      const levelRequirement = this.facilityUseLevelRequirement(
        action,
        facility,
        currentLevel,
      );
      const requirements = [
        levelRequirement,
        ...this.effectCostRequirements(action.action_id, action.costs ?? [], state),
      ];
      return {
        optionId: action.action_id,
        label: this.content.text("shelter_facility_use_label", {
          action_name: action.name,
        }),
        category: "facility_use",
        available: requirements.every((requirement) => requirement.met),
        description: this.content.text("shelter_facility_use_description", {
          facility_name: facility.name,
          description: action.description,
          minimum_level: action.minimum_level,
          duration_hours: action.duration_hours,
        }),
        fields: [
          {
            id: "level",
            label: this.content.text("management_field_current_level_label"),
            value: this.content.text("management_level_value", {
              current: currentLevel,
              maximum: facility.max_level,
            }),
          },
          this.durationField(action.duration_hours),
        ],
        requirements,
      };
    });
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
      total_level: this.totalFacilityLevel(state),
      level_limit: this.facilityLevelLimit(state),
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
        const requirements = [this.facilityLevelRequirement(facility, currentLevel)];
        return {
          optionId: facility.facility_id,
          label: this.content.text("shelter_facility_max_label", {
            facility_name: facility.name,
          }),
          category: "facility",
          available: false,
          description: facility.description,
          fields: this.facilityFields(state, facility, null),
          requirements,
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
      const benefit = this.facilityBenefitDescription(level);
      const requirements = [
        this.facilityLevelRequirement(facility, currentLevel),
        this.unlockRequirement(
          `${facility.facility_id}-unlock`,
          facility.unlock_requirements ?? [],
          state,
        ),
        this.facilityCapacityRequirement(state, facility),
        this.resourceRequirement(
          `${facility.facility_id}-parts`,
          "player.parts",
          partsCost,
          state,
        ),
        this.resourceRequirement(
          `${facility.facility_id}-coins`,
          "player.coins",
          coinsCost,
          state,
        ),
      ];
      return {
        optionId: facility.facility_id,
        label: this.content.text("shelter_facility_upgrade_label", {
          facility_name: facility.name,
          level: level.level,
        }),
        category: "facility",
        available: requirements.every((requirement) => requirement.met),
        description: this.content.text("shelter_facility_upgrade_description", {
          description: facility.description,
          parts_cost: partsCost,
          coins_cost: coinsCost,
          build_hours: level.build_hours,
          benefit,
        }),
        fields: this.facilityFields(state, facility, level),
        requirements,
      };
    });
  }

  /** 构造所有配置化工作选项。 */
  private jobOptions(state: GameState): ManagementOption[] {
    return this.content.story.jobs.map((job) => {
      const requirements = [
        this.unlockRequirement(`${job.job_id}-unlock`, job.requirements ?? [], state),
        ...this.effectCostRequirements(job.job_id, job.costs ?? [], state),
      ];
      const fields: ManagementField[] = [
        this.durationField(job.duration_hours),
        {
          id: "repetitions",
          label: this.content.text("management_field_repetitions_label"),
          value: this.content.text("management_repetitions_value", {
            options: this.content.story.work.repetition_options.join(" / "),
            maximum: this.content.story.work.maximum_repetitions,
          }),
        },
      ];
      if (job.risk !== undefined) {
        fields.push({
          id: "risk",
          label: this.content.text("management_field_risk_label"),
          value: this.content.text("management_percent_value", {
            percent: job.risk.chance_percent,
          }),
        });
      }
      return {
        optionId: job.job_id,
        label: this.content.text("shelter_job_label", { job_name: job.name }),
        category: "job",
        available: requirements.every((requirement) => requirement.met),
        description: this.content.text("shelter_job_description", {
          description: job.description,
          duration_hours: job.duration_hours,
        }),
        fields,
        requirements,
      };
    });
  }

  /** 构造所有配置化避难所活动选项。 */
  private activityOptions(state: GameState): ManagementOption[] {
    return this.content.story.activities.map((activity) => {
      const requirements = [
        this.unlockRequirement(
          `${activity.activity_id}-unlock`,
          activity.requirements ?? [],
          state,
        ),
        ...this.effectCostRequirements(activity.activity_id, activity.costs ?? [], state),
      ];
      return {
        optionId: activity.activity_id,
        label: this.content.text("shelter_activity_label", {
          activity_name: activity.name,
        }),
        category: "activity",
        available: requirements.every((requirement) => requirement.met),
        description: this.content.text("shelter_activity_description", {
          description: activity.description,
          duration_hours: activity.duration_hours,
        }),
        fields: [this.durationField(activity.duration_hours)],
        requirements,
      };
    });
  }

  /** 为每个商品同时构造购买和出售选项。 */
  private tradeOptions(state: GameState): ManagementOption[] {
    const options: ManagementOption[] = [];
    for (const trade of this.content.story.trades) {
      const buyPrice = this.tradeBuyPrice(state, trade);
      const sellPrice = this.tradeSellPrice(state, trade);
      const sharedRequirements = [
        this.unlockRequirement(
          `${trade.trade_id}-unlock`,
          trade.unlock_requirements ?? [],
          state,
        ),
        this.tradeCycleRequirement(state),
        this.tradeScheduleRequirement(state),
      ];
      const buyRequirements = [
        ...sharedRequirements,
        this.resourceRequirement(
          `${trade.trade_id}-buy-coins`,
          "player.coins",
          buyPrice,
          state,
        ),
      ];
      options.push({
        optionId: trade.trade_id,
        label: this.content.text("shelter_trade_buy_label", {
          item_name: trade.item_name,
          quantity: trade.quantity,
        }),
        category: "trade_buy",
        available: buyRequirements.every((requirement) => requirement.met),
        description: this.content.text("shelter_trade_buy_description", {
          vendor_name: trade.vendor_name,
          price: buyPrice,
        }),
        fields: this.tradeFields(trade, buyPrice),
        requirements: buyRequirements,
      });
      const sellRequirements = [
        ...sharedRequirements,
        this.resourceRequirement(
          `${trade.trade_id}-sell-resource`,
          trade.resource_target,
          trade.quantity,
          state,
        ),
      ];
      options.push({
        optionId: trade.trade_id,
        label: this.content.text("shelter_trade_sell_label", {
          item_name: trade.item_name,
          quantity: trade.quantity,
        }),
        category: "trade_sell",
        available: sellRequirements.every((requirement) => requirement.met),
        description: this.content.text("shelter_trade_sell_description", {
          vendor_name: trade.vendor_name,
          price: sellPrice,
        }),
        fields: this.tradeFields(trade, sellPrice),
        requirements: sellRequirements,
      });
    }
    return options;
  }

  /** 构造人员招募选项并阻止重复招募。 */
  private recruitOptions(state: GameState): ManagementOption[] {
    return this.content.story.recruits.map((recruit) => {
      const alreadyRecruited = recruit.add_flags.some((flag) => state.story.flags.includes(flag));
      const requirements = [
        this.recruitAvailabilityRequirement(recruit, alreadyRecruited),
        this.unlockRequirement(
          `${recruit.recruit_id}-unlock`,
          recruit.requirements ?? [],
          state,
        ),
        ...this.effectCostRequirements(recruit.recruit_id, recruit.costs ?? [], state),
      ];
      return {
        optionId: recruit.recruit_id,
        label: this.content.text("shelter_recruit_label", {
          recruit_name: recruit.name,
          role: recruit.role,
        }),
        category: "recruit",
        available: requirements.every((requirement) => requirement.met),
        description: alreadyRecruited
          ? this.content.text("shelter_recruit_already_joined_description")
          : recruit.description,
        fields: [{
          id: "role",
          label: this.content.text("management_field_role_label"),
          value: recruit.role,
        }],
        requirements,
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
    if (!this.facilityCapacityRequirement(state, facility).met) {
      return this.unavailable(
        this.content.text("shelter_facility_capacity_insufficient", {
          current: this.totalFacilityLevel(state),
          maximum: this.facilityLevelLimit(state),
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

  /** 校验设施等级与资源后执行一次配置化设施能力。 */
  private useFacility(
    state: GameState,
    actionId: string,
  ): ManagementResolution {
    const action = this.facilityActionById.get(actionId);
    if (action === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_facility_action", { action_id: actionId }),
      );
    }
    const facility = this.requireFacility(action.facility_id);
    const currentLevel = state.facility_levels[facility.facility_id] ?? 0;
    if (currentLevel < action.minimum_level) {
      return this.unavailable(this.content.text("shelter_facility_use_locked", {
        facility_name: facility.name,
        minimum_level: action.minimum_level,
      }));
    }
    if (!this.canPayEffects(state, action.costs ?? [])) {
      return this.unavailable(
        this.content.text("shelter_facility_use_resources_insufficient"),
      );
    }
    this.applyEffects(action.costs ?? [], state);
    this.applyEffects(action.rewards ?? [], state);
    return {
      messages: [action.result_text],
      applied: true,
      consumesTurn: true,
      turnsConsumed: this.durationTurns(action.duration_hours),
    };
  }

  /** 在副本中循环执行配置次数，全部成功后才原子提交工作收益。 */
  private performJobRepeated(
    state: GameState,
    jobId: string,
    repetitions: number,
  ): ManagementResolution {
    const work = this.content.story.work;
    const job = this.jobById.get(jobId);
    if (job === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_job", { job_id: jobId }),
      );
    }
    if (
      !Number.isInteger(repetitions)
      || repetitions < 1
      || repetitions > work.maximum_repetitions
      || !work.repetition_options.includes(repetitions)
    ) {
      return this.unavailable(this.content.text("shelter_job_repetition_invalid"));
    }
    const working = cloneGameState(state);
    const messages: string[] = [];
    let turnsConsumed = 0;
    for (let index = 0; index < repetitions; index += 1) {
      const resolution = this.performJob(working, jobId);
      if (!resolution.applied) return resolution;
      messages.push(...resolution.messages);
      turnsConsumed += resolution.turnsConsumed;
    }
    if (repetitions > 1) {
      messages.push(this.content.text("shelter_job_repeated_success", {
        job_name: job.name,
        repetitions,
      }));
    }
    this.commitJobState(working, state);
    return {
      messages,
      applied: true,
      consumesTurn: true,
      turnsConsumed,
    };
  }

  /** 结算单次工作成本、随机产出和风险事件。 */
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

  /** 只提交工作效果允许改动的聚合字段。 */
  private commitJobState(source: GameState, target: GameState): void {
    target.players = source.players;
    target.shelter = source.shelter;
    target.story = source.story;
    target.archive_collection_totals = source.archive_collection_totals;
  }

  /** 支付活动成本并结算希望、活跃度等配置化收益。 */
  private performActivity(
    state: GameState,
    activityId: string,
  ): ManagementResolution {
    const activity = this.activityById.get(activityId);
    if (activity === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_activity", { activity_id: activityId }),
      );
    }
    if (!this.story.requirementsMet(activity.requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_activity_locked"));
    }
    if (!this.canPayEffects(state, activity.costs ?? [])) {
      return this.unavailable(
        this.content.text("shelter_activity_resources_insufficient"),
      );
    }
    this.applyEffects(activity.costs ?? [], state);
    this.applyEffects(activity.rewards ?? [], state);
    return {
      messages: [activity.result_text],
      applied: true,
      consumesTurn: true,
      turnsConsumed: this.durationTurns(activity.duration_hours),
    };
  }

  /** 支付金币并购入一份配置化商品。 */
  private buyTrade(state: GameState, tradeId: string): ManagementResolution {
    const trade = this.trade(tradeId);
    if (!this.tradeScheduleAvailable(state)) {
      return this.unavailable(this.tradeScheduleUnavailableMessage());
    }
    if (!this.tradeCycleAvailable(state)) {
      return this.unavailable(this.content.text("shelter_trade_cycle_exhausted"));
    }
    if (!this.story.requirementsMet(trade.unlock_requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_trade_locked"));
    }
    const price = this.tradeBuyPrice(state, trade);
    if (activePlayer(state).coins < price) {
      return this.unavailable(
        this.content.text("shelter_trade_coins_insufficient"),
      );
    }
    const ambushed = this.ambushedTradeResolution(state, trade);
    if (ambushed !== null) return ambushed;
    activePlayer(state).coins -= price;
    const current = this.operations.read(trade.resource_target, state);
    this.operations.write(trade.resource_target, current + trade.quantity, state);
    this.markTradeUsage(state);
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
      consumesTurn: true,
      turnsConsumed: this.tradeDurationTurns(),
    };
  }

  /** 出售一份配置化商品并获得金币。 */
  private sellTrade(state: GameState, tradeId: string): ManagementResolution {
    const trade = this.trade(tradeId);
    if (!this.tradeScheduleAvailable(state)) {
      return this.unavailable(this.tradeScheduleUnavailableMessage());
    }
    if (!this.tradeCycleAvailable(state)) {
      return this.unavailable(this.content.text("shelter_trade_cycle_exhausted"));
    }
    if (!this.story.requirementsMet(trade.unlock_requirements ?? [], state)) {
      return this.unavailable(this.content.text("shelter_trade_locked"));
    }
    const current = this.operations.read(trade.resource_target, state);
    if (current < trade.quantity) {
      return this.unavailable(
        this.content.text("shelter_trade_resources_insufficient"),
      );
    }
    const ambushed = this.ambushedTradeResolution(state, trade);
    if (ambushed !== null) return ambushed;
    const price = this.tradeSellPrice(state, trade);
    this.operations.write(trade.resource_target, current - trade.quantity, state);
    activePlayer(state).coins += price;
    this.markTradeUsage(state);
    return {
      messages: [
        this.content.text("shelter_trade_sell_success", {
          vendor_name: trade.vendor_name,
          item_name: trade.item_name,
          quantity: trade.quantity,
          price,
        }),
      ],
      applied: true,
      consumesTurn: true,
      turnsConsumed: this.tradeDurationTurns(),
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

  /** 构造设施等级、容量与建造耗时的结构化详情。 */
  private facilityFields(
    state: GameState,
    facility: FacilityConfig,
    level: FacilityLevelConfig | null,
  ): ManagementField[] {
    const fields: ManagementField[] = [
      {
        id: "level",
        label: this.content.text("management_field_current_level_label"),
        value: this.content.text("management_level_value", {
          current: state.facility_levels[facility.facility_id] ?? 0,
          maximum: facility.max_level,
        }),
      },
      {
        id: "capacity",
        label: this.content.text("management_field_capacity_label"),
        value: this.content.text("management_capacity_value", {
          current: this.totalFacilityLevel(state),
          maximum: this.facilityLevelLimit(state),
        }),
      },
    ];
    if (level !== null) {
      fields.push({
        id: "upgrade-benefit",
        label: this.content.text("management_field_upgrade_benefit_label"),
        value: this.facilityBenefitDescription(level),
      });
      fields.push(this.durationField(level.build_hours));
    }
    return fields;
  }

  /** 把下一级配置化效果转为玩家可直接理解的能力预览。 */
  private facilityBenefitDescription(level: FacilityLevelConfig): string {
    const configuration = this.content.story.facility_management;
    return (level.effects ?? []).map((effect) => {
      const effectName = configuration.effect_target_names[effect.target];
      if (effectName === undefined) {
        throw new ShelterManagementError(`设施效果缺少展示名称：${effect.target}`);
      }
      const amount = typeof effect.amount === "number"
        ? String(effect.amount)
        : `${String(effect.amount[0])}~${String(effect.amount[1])}`;
      const template = effect.operation === "add"
        ? configuration.effect_add_format
        : effect.operation === "subtract"
          ? configuration.effect_subtract_format
          : configuration.effect_set_format;
      return formatTemplate(template, { effect_name: effectName, amount });
    }).join(configuration.effect_separator);
  }

  /** 说明设施是否仍有可建设等级。 */
  private facilityLevelRequirement(
    facility: FacilityConfig,
    currentLevel: number,
  ): ManagementRequirement {
    const met = currentLevel < facility.max_level;
    return {
      id: `${facility.facility_id}-level`,
      label: this.content.text("management_requirement_level_label"),
      description: this.content.text(
        met ? "management_facility_level_available" : "management_facility_level_full",
        { current: currentLevel, maximum: facility.max_level },
      ),
      met,
    };
  }

  /** 说明主动设施能力所需等级是否已经满足。 */
  private facilityUseLevelRequirement(
    action: FacilityActionConfig,
    facility: FacilityConfig,
    currentLevel: number,
  ): ManagementRequirement {
    const met = currentLevel >= action.minimum_level;
    return {
      id: `${action.action_id}-level`,
      label: this.content.text("management_requirement_level_label"),
      description: this.content.text("management_facility_use_level", {
        facility_name: facility.name,
        current: currentLevel,
        required: action.minimum_level,
      }),
      met,
    };
  }

  /** 把配置化剧情或设施前置条件聚合为一项可读需求。 */
  private unlockRequirement(
    id: string,
    requirements: readonly RequirementConfig[],
    state: GameState,
  ): ManagementRequirement {
    const met = this.story.requirementsMet(requirements, state);
    const description = requirements.length === 0
      ? this.content.text("management_unlock_not_required")
      : met
        ? this.content.text("management_unlock_satisfied")
        : this.story.unmetRequirementsDescription(requirements, state);
    return {
      id,
      label: this.content.text("management_requirement_unlock_label"),
      description,
      met,
    };
  }

  /** 说明一次设施升级是否超出当前总建设等级容量。 */
  private facilityCapacityRequirement(
    state: GameState,
    facility: FacilityConfig,
  ): ManagementRequirement {
    const current = this.totalFacilityLevel(state);
    const maximum = this.facilityLevelLimit(state);
    const next = current + (facility.counts_toward_total_level_limit ? 1 : 0);
    const met = !facility.counts_toward_total_level_limit || next <= maximum;
    return {
      id: `${facility.facility_id}-capacity`,
      label: this.content.text("management_requirement_capacity_label"),
      description: facility.counts_toward_total_level_limit
        ? this.content.text("management_capacity_requirement", {
            current,
            next,
            maximum,
          })
        : this.content.text("management_capacity_exempt"),
      met,
    };
  }

  /** 构造一项当前数量与必需数量的实时资源要求。 */
  private resourceRequirement(
    id: string,
    target: string,
    required: number,
    state: GameState,
  ): ManagementRequirement {
    const current = this.operations.read(target, state);
    const resourceName = this.targetDisplayName(target);
    return {
      id,
      label: resourceName,
      description: this.content.text("management_resource_requirement", {
        resource_name: resourceName,
        current,
        required,
      }),
      met: current >= required,
    };
  }

  /** 把所有减少型经营成本转换为结构化资源要求。 */
  private effectCostRequirements(
    ownerId: string,
    effects: readonly NumericEffectConfig[],
    state: GameState,
  ): ManagementRequirement[] {
    return effects.flatMap((effect, index) => {
      if (effect.operation !== "subtract") return [];
      const required = typeof effect.amount === "number"
        ? effect.amount
        : effect.amount[1];
      return [this.resourceRequirement(
        `${ownerId}-cost-${String(index)}`,
        effect.target,
        required,
        state,
      )];
    });
  }

  /** 构造经营项目统一的耗时字段。 */
  private durationField(hours: number): ManagementField {
    return {
      id: "duration",
      label: this.content.text("management_field_duration_label"),
      value: this.content.text("management_hours_value", { hours }),
    };
  }

  /** 构造交易商、商品数量与结算价格字段。 */
  private tradeFields(trade: TradeConfig, price: number): ManagementField[] {
    return [
      {
        id: "vendor",
        label: this.content.text("management_field_vendor_label"),
        value: trade.vendor_name,
      },
      {
        id: "quantity",
        label: this.content.text("management_field_quantity_label"),
        value: this.content.text("management_quantity_value", {
          item_name: trade.item_name,
          quantity: trade.quantity,
        }),
      },
      {
        id: "price",
        label: this.content.text("management_field_price_label"),
        value: this.content.text("management_coins_value", { coins: price }),
      },
      {
        id: "schedule",
        label: this.content.text("management_field_trade_schedule_label"),
        value: this.content.text("management_trade_schedule_value", {
          weekdays: this.tradeAllowedWeekdaysDescription(),
          duration_days: this.content.story.trade.cycle.duration_days,
        }),
      },
    ];
  }

  /** 生成交易周期剩余次数的实时需求。 */
  private tradeCycleRequirement(state: GameState): ManagementRequirement {
    const cycle = this.tradeCycleSnapshot(state);
    return {
      id: "trade-cycle",
      label: this.content.text("management_requirement_cycle_label"),
      description: this.content.text("management_cycle_requirement", {
        cycle: cycle.cycleIndex + 1,
        used: cycle.used,
        maximum: cycle.maximum,
      }),
      met: cycle.used < cycle.maximum,
    };
  }

  /** 生成当前日期是否位于周五、周六交易窗口的实时需求。 */
  private tradeScheduleRequirement(state: GameState): ManagementRequirement {
    const currentWeekday = weekdayIndex(state.clock);
    return {
      id: "trade-schedule",
      label: this.content.text("management_requirement_schedule_label"),
      description: this.content.text("management_schedule_requirement", {
        weekdays: this.tradeAllowedWeekdaysDescription(),
        current_weekday: this.tradeWeekdayLabel(currentWeekday),
      }),
      met: this.tradeScheduleAvailable(state),
    };
  }

  /** 说明人员是否已经加入，避免重复招募。 */
  private recruitAvailabilityRequirement(
    recruit: RecruitConfig,
    alreadyRecruited: boolean,
  ): ManagementRequirement {
    return {
      id: `${recruit.recruit_id}-availability`,
      label: this.content.text("management_requirement_recruit_label"),
      description: this.content.text(
        alreadyRecruited
          ? "management_recruit_already_joined"
          : "management_recruit_available",
      ),
      met: !alreadyRecruited,
    };
  }

  /** 统计显式声明占用容量的全部设施等级。 */
  private totalFacilityLevel(state: GameState): number {
    return this.content.story.facilities.reduce((total, facility) => (
      facility.counts_toward_total_level_limit
        ? total + (state.facility_levels[facility.facility_id] ?? 0)
        : total
    ), 0);
  }

  /** 返回基础容量叠加扩建设施被动修正后的总上限。 */
  private facilityLevelLimit(state: GameState): number {
    const configuration = this.content.story.facility_management;
    return configuration.initial_total_level_limit + this.passiveModifier(
      state,
      configuration.capacity_modifier_target,
    );
  }

  /** 读取当前七日周期及已经结算的交易次数。 */
  private tradeCycleSnapshot(state: GameState): TradeCycleSnapshot {
    const configuration = this.content.story.trade.cycle;
    if (
      configuration.usage_key.length === 0
      || !Number.isInteger(configuration.days)
      || configuration.days <= 0
      || !Number.isInteger(configuration.maximum_transactions)
      || configuration.maximum_transactions <= 0
      || !Number.isInteger(configuration.duration_days)
      || configuration.duration_days <= 0
      || configuration.allowed_weekdays.length === 0
      || configuration.allowed_weekdays.some(
        (weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6,
      )
      || new Set(configuration.allowed_weekdays).size
        !== configuration.allowed_weekdays.length
    ) {
      throw new ShelterManagementError(
        this.content.text("shelter_trade_cycle_invalid_config"),
      );
    }
    const cycleIndex = Math.floor(state.survival_days / configuration.days);
    const persisted = state.management_cycle_usage[configuration.usage_key];
    return {
      cycleIndex,
      used: persisted?.cycle_index === cycleIndex ? persisted.count : 0,
      maximum: configuration.maximum_transactions,
    };
  }

  /** 检查本周期是否仍有可结算交易额度。 */
  private tradeCycleAvailable(state: GameState): boolean {
    const cycle = this.tradeCycleSnapshot(state);
    return cycle.used < cycle.maximum;
  }

  /** 检查当前公历日期是否位于配置化买卖窗口。 */
  private tradeScheduleAvailable(state: GameState): boolean {
    return this.content.story.trade.cycle.allowed_weekdays.includes(
      weekdayIndex(state.clock),
    );
  }

  /** 将交易窗口的星期索引格式化为可读列表。 */
  private tradeAllowedWeekdaysDescription(): string {
    return this.content.story.trade.cycle.allowed_weekdays
      .map((weekday) => this.tradeWeekdayLabel(weekday))
      .join("、");
  }

  /** 从交易配置返回指定星期的展示名称。 */
  private tradeWeekdayLabel(weekday: number): string {
    const label = this.content.story.trade.cycle.weekday_labels[String(weekday)];
    if (label === undefined || label.trim() === "") {
      throw new ShelterManagementError(
        this.content.text("shelter_trade_cycle_invalid_config"),
      );
    }
    return label;
  }

  /** 返回非交易日时的配置化阻断文案。 */
  private tradeScheduleUnavailableMessage(): string {
    return this.content.text("shelter_trade_schedule_unavailable", {
      weekdays: this.tradeAllowedWeekdaysDescription(),
    });
  }

  /** 把成交占用的生存日换算为世界回合数。 */
  private tradeDurationTurns(): number {
    return this.content.story.trade.cycle.duration_days
      * playableTurnsPerDay(this.content.game.rules.time);
  }

  /** 在成功成交或遭遇伏击后记录本周期一次交易。 */
  private markTradeUsage(state: GameState): void {
    const configuration = this.content.story.trade.cycle;
    const cycle = this.tradeCycleSnapshot(state);
    state.management_cycle_usage[configuration.usage_key] = {
      cycle_index: cycle.cycleIndex,
      count: cycle.used + 1,
    };
  }

  /** 结算交易途中伏击；发生时替代原交易并消耗本周额度。 */
  private ambushedTradeResolution(
    state: GameState,
    trade: TradeConfig,
  ): ManagementResolution | null {
    const resolution = this.tradeAmbush.resolve(
      state,
      this.content.story.trade.ambush,
    );
    if (!resolution.occurred) return null;
    this.markTradeUsage(state);
    return {
      messages: [this.content.text("shelter_trade_ambush_result", {
        vendor_name: trade.vendor_name,
        event_title: resolution.eventTitle,
        result: resolution.message,
      })],
      applied: true,
      consumesTurn: true,
      turnsConsumed: this.tradeDurationTurns(),
    };
  }

  /** 从配置化目标名称表读取玩家可理解的资源名。 */
  private targetDisplayName(target: string): string {
    const name = this.content.story.requirement_display.target_names[target];
    if (name === undefined) {
      throw new ShelterManagementError(this.content.text(
        "management_resource_name_missing",
        { target },
      ));
    }
    return name;
  }

  /** 按稳定 ID 返回设施配置，避免主动能力引用不存在的设施。 */
  private requireFacility(facilityId: string): FacilityConfig {
    const facility = this.facilityById.get(facilityId);
    if (facility === undefined) {
      throw new ShelterManagementError(
        this.content.text("shelter_unknown_facility", { facility_id: facilityId }),
      );
    }
    return facility;
  }

  /** 启动时验证主动设施目录的 ID、设施引用、等级、耗时与数值目标。 */
  private validateFacilityActions(): void {
    const seenIds = new Set<string>();
    for (const action of this.content.story.facility_actions) {
      const facility = this.facilityById.get(action.facility_id);
      const effects = [...(action.costs ?? []), ...(action.rewards ?? [])];
      const invalidEffect = effects.some((effect) => {
        const amount: unknown = effect.amount;
        return !isStaticStateOperationTargetSupported(effect.target)
          || !isValidFacilityEffectAmount(amount);
      });
      if (
        action.action_id.trim() === ""
        || action.name.trim() === ""
        || action.description.trim() === ""
        || action.result_text.trim() === ""
        || seenIds.has(action.action_id)
        || facility === undefined
        || !Number.isInteger(action.minimum_level)
        || action.minimum_level < 1
        || action.minimum_level > facility.max_level
        || !Number.isInteger(action.duration_hours)
        || action.duration_hours < 1
        || invalidEffect
      ) {
        throw new ShelterManagementError(this.content.text(
          "shelter_facility_action_invalid",
          { action_id: action.action_id },
        ));
      }
      seenIds.add(action.action_id);
    }
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
    const passivePrice = Math.max(1, Math.floor((trade.buy_price * percent) / 100));
    return this.difficultyRules.tradeBuyPrice(passivePrice, state);
  }

  /** 按难度经济倍率的倒数计算实际卖出价。 */
  private tradeSellPrice(state: GameState, trade: TradeConfig): number {
    return this.difficultyRules.tradeSellPrice(trade.sell_price, state);
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

/** 校验设施数值效果是非负整数或有序的二元随机区间。 */
function isValidFacilityEffectAmount(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0;
  }
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const minimum: unknown = value[0];
  const maximum: unknown = value[1];
  return typeof minimum === "number"
    && typeof maximum === "number"
    && Number.isInteger(minimum)
    && Number.isInteger(maximum)
    && minimum >= 0
    && maximum >= minimum;
}
