import {
  formatTemplate,
  type CampaignDifficultyConfig,
  type CampaignOriginConfig,
  type CampaignShelterTypeConfig,
  type CampaignTraitConfig,
  type GameConfigDocument,
  type NumericEffectConfig,
} from "../domain/content";
import { isStaticStateOperationTargetSupported } from "../domain/state-operation-targets";
import type {
  ContentExpansionCatalog,
  ExpansionDifficultyConfig,
  ExpansionNumericModifier,
  ExpansionOriginConfig,
  ExpansionTraitConfig,
  FailureEndingConfig,
  ShelterArchetypeConfig,
} from "./contentExpansion";

/** 扩展目录触发器与领域失败条件的稳定映射。 */
const FAILURE_RULE_ID_BY_TRIGGER = {
  outer_wall_health_zero: "outer_wall",
  inner_wall_health_zero: "inner_wall",
  hope_zero: "hope",
  group_hunger_limit: "famine",
  infection_pressure_limit: "infection",
  all_commanders_dead: "commander",
  activity_minimum: "activity_low",
  activity_maximum: "activity_high",
} as const satisfies Readonly<Record<string, string>>;

/** 新建战役附加元数据在 story.flags 中的稳定命名空间。 */
export const CAMPAIGN_PROFILE_METADATA_FLAGS = {
  secondary_trait_prefix: "campaign_profile::secondary_trait::",
  home_district_prefix: "campaign_profile::home_district::",
  shelter_type_prefix: "campaign_profile::shelter_type::",
  shelter_capacity_prefix: "campaign_profile::shelter_capacity::",
  shelter_facility_slots_prefix: "campaign_profile::shelter_facility_slots::",
} as const;

/** 将扩展目录合并为完整运行时开局配置，不修改导入的 JSON 对象。 */
export function mergeCampaignProfileExpansion(
  base: GameConfigDocument,
  catalog: ContentExpansionCatalog,
): GameConfigDocument {
  const game = structuredClone(base);
  const primaryTraitId = game.campaign_profiles.migration_default.trait_id;
  const secondaryTraitId = resolveSecondaryDefaultTraitId(
    primaryTraitId,
    catalog.traits,
  );
  const shelterTypeId = requireFirstShelterType(catalog.shelterTypes).id;
  game.campaign_profiles = {
    difficulties: catalog.difficulties.map(mapDifficulty),
    origins: catalog.origins.map(mapOrigin),
    traits: catalog.traits.map(mapTrait),
    shelter_types: catalog.shelterTypes.map(mapShelterType),
    trait_selection_rules: {
      minimum_selections: catalog.traitSelectionRules.minimumSelections,
      maximum_selections: catalog.traitSelectionRules.maximumSelections,
      require_unique: catalog.traitSelectionRules.requireUnique,
    },
    metadata_flags: CAMPAIGN_PROFILE_METADATA_FLAGS,
    additional_defaults: {
      secondary_trait_id: secondaryTraitId,
      shelter_type_id: shelterTypeId,
    },
    migration_default: structuredClone(game.campaign_profiles.migration_default),
  };
  expandShelterWallLimits(game, catalog.shelterTypes);
  mergeFailureEndingExpansion(game, catalog.failureEndings);
  return game;
}

/** 将八个失败尾声注入运行时规则与文案表。 */
function mergeFailureEndingExpansion(
  game: GameConfigDocument,
  endings: readonly FailureEndingConfig[],
): void {
  const messageTemplate = game.texts.failure_ending_message_format;
  if (messageTemplate === undefined || messageTemplate.trim().length === 0) {
    throw new Error("失败结局文案模板 failure_ending_message_format 不能为空。");
  }
  const entries = endings.map((ending) => {
    if (!(ending.triggerId in FAILURE_RULE_ID_BY_TRIGGER)) {
      throw new Error(`失败结局 ${ending.endingId} 使用了未映射触发器：${ending.triggerId}。`);
    }
    const ruleId = FAILURE_RULE_ID_BY_TRIGGER[
      ending.triggerId as keyof typeof FAILURE_RULE_ID_BY_TRIGGER
    ];
    const textKey = `failure_ending_${ending.endingId}`;
    game.texts[textKey] = formatFailureEndingText(messageTemplate, ending);
    return [ruleId, {
      ending_id: ending.endingId,
      text_key: textKey,
      priority: ending.priority,
    }] as const;
  });
  const ruleIds = entries.map(([ruleId]) => ruleId);
  if (new Set(ruleIds).size !== ruleIds.length) {
    throw new Error("失败结局目录存在重复的领域触发条件。");
  }
  const missingRuleIds = Object.values(FAILURE_RULE_ID_BY_TRIGGER).filter(
    (ruleId) => !ruleIds.includes(ruleId),
  );
  if (missingRuleIds.length > 0) {
    throw new Error(`失败结局目录缺少规则：${missingRuleIds.join("、")}。`);
  }
  game.rules.failure_endings = Object.fromEntries(entries);
}

/** 使用配置模板组合失败原因、结局标题与尾声。 */
function formatFailureEndingText(
  template: string,
  ending: FailureEndingConfig,
): string {
  return formatTemplate(template, {
    failure_reason: ending.summary,
    ending_title: ending.displayName,
    epilogue: ending.epilogue,
  });
}

/** 把扩展难度转为领域可直接消费的难度配置。 */
function mapDifficulty(option: ExpansionDifficultyConfig): CampaignDifficultyConfig {
  return {
    id: option.difficultyId,
    label: option.displayName,
    description: describeOption(option.description, option.startingModifiers),
    survival_cost_percent: option.multipliers.survivalCostPercent,
    enemy_health_percent: option.multipliers.enemyHealthPercent,
    enemy_damage_percent: option.multipliers.enemyDamagePercent,
    common_loot_percent: option.multipliers.commonLootPercent,
    text_loot_percent: option.multipliers.textLootPercent,
    research_cost_percent: option.multipliers.researchCostPercent,
    trade_price_percent: option.multipliers.tradePricePercent,
    hope_loss_percent: option.multipliers.hopeLossPercent,
    starting_effects: mapSupportedStartingEffects(option.startingModifiers),
  };
}

/** 把扩展起源转为领域可直接消费的起源配置。 */
function mapOrigin(option: ExpansionOriginConfig): CampaignOriginConfig {
  return {
    id: option.originId,
    label: option.displayName,
    description: describeOption(option.description, option.startingModifiers),
    starting_effects: mapSupportedStartingEffects(option.startingModifiers),
  };
}

/** 把扩展特性转为领域特性，并保留行动容量修正与互斥关系。 */
function mapTrait(option: ExpansionTraitConfig): CampaignTraitConfig {
  return {
    id: option.traitId,
    label: option.displayName,
    description: describeOption(option.description, option.modifiers),
    expedition_step_bonus: readExpeditionActionCapacityModifier(option.modifiers),
    starting_effects: mapSupportedStartingEffects(option.modifiers),
    incompatible_trait_ids: [...option.incompatibleTraitIds],
  };
}

/** 把避难所原型转为开局配置，仅保留当前状态写入器可落地的数值效果。 */
function mapShelterType(option: ShelterArchetypeConfig): CampaignShelterTypeConfig {
  return {
    id: option.id,
    label: option.label,
    description: option.description,
    bonuses: [...option.bonuses],
    starting_capacity: option.starting_capacity,
    initial_facility_slots: option.initialFacilitySlots,
    inner_wall_health: option.innerWallHealth,
    outer_wall_health: option.outerWallHealth,
    starting_effects: mapSupportedStartingEffects(option.modifiers),
  };
}

/** 只把 StateOperations 静态白名单支持的整数加减修正转为开局效果。 */
function mapSupportedStartingEffects(
  modifiers: readonly ExpansionNumericModifier[],
): readonly NumericEffectConfig[] {
  return modifiers
    .filter((modifier) => (
      (modifier.operation === "add" || modifier.operation === "subtract")
      && Number.isInteger(modifier.amount)
      && isStaticStateOperationTargetSupported(modifier.target)
    ))
    .map((modifier) => ({
      target: modifier.target,
      operation: modifier.operation as "add" | "subtract",
      amount: modifier.amount,
    }));
}

/** 在详情中附上目录已配置的明确数值，不在页面中复制游戏文案。 */
function describeOption(
  description: string,
  modifiers: readonly ExpansionNumericModifier[],
): string {
  const modifierDescriptions = modifiers.map((modifier) => modifier.description);
  return modifierDescriptions.length === 0
    ? description
    : [description, ...modifierDescriptions].join("\n");
}

/** 从扩展修正中提取旧远征协议仍需要的行动容量加成。 */
function readExpeditionActionCapacityModifier(
  modifiers: readonly ExpansionNumericModifier[],
): number {
  const modifier = modifiers.find((candidate) => (
    candidate.target === "expedition.action_capacity"
    && (candidate.operation === "add" || candidate.operation === "subtract")
  ));
  if (modifier === undefined || !Number.isInteger(modifier.amount)) return 0;
  return modifier.operation === "subtract" ? -modifier.amount : modifier.amount;
}

/** 按主特性和双向互斥关系选取第一个稳定的第二默认特性。 */
function resolveSecondaryDefaultTraitId(
  primaryTraitId: string,
  traits: readonly ExpansionTraitConfig[],
): string {
  const primary = traits.find((trait) => trait.traitId === primaryTraitId);
  if (primary === undefined) {
    throw new Error(`扩展特性缺少迁移默认项：${primaryTraitId}`);
  }
  const secondary = traits.find((candidate) => (
    candidate.traitId !== primaryTraitId
    && !primary.incompatibleTraitIds.includes(candidate.traitId)
    && !candidate.incompatibleTraitIds.includes(primaryTraitId)
  ));
  if (secondary === undefined) {
    throw new Error("扩展特性缺少可与默认主特性搭配的第二选项。");
  }
  return secondary.traitId;
}

/** 读取目录中的默认避难所原型并在配置缺失时立即失败。 */
function requireFirstShelterType(
  shelterTypes: readonly ShelterArchetypeConfig[],
): ShelterArchetypeConfig {
  const shelterType = shelterTypes[0];
  if (shelterType === undefined) throw new Error("扩展目录缺少避难所类型。");
  return shelterType;
}

/** 按全部避难所原型的最大值扩展墙体上限，避免开局强度被归一化截断。 */
function expandShelterWallLimits(
  game: GameConfigDocument,
  shelterTypes: readonly ShelterArchetypeConfig[],
): void {
  const innerMaximum = Math.max(
    game.rules.limits.inner_wall_max_health,
    ...shelterTypes.map((option) => option.innerWallHealth),
  );
  const outerMaximum = Math.max(
    game.rules.limits.outer_wall_max_health,
    ...shelterTypes.map((option) => option.outerWallHealth),
  );
  game.rules.limits.inner_wall_max_health = innerMaximum;
  game.rules.limits.outer_wall_max_health = outerMaximum;
  game.rules.limits.shelter_max_health = innerMaximum + outerMaximum;
}
