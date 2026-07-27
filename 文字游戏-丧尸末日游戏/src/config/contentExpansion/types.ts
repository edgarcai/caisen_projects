/** 扩展内容中可定位的城市稳定 ID。 */
export type ExpansionCityId =
  | "city_a"
  | "city_b"
  | "city_c"
  | "city_d"
  | "city_e"
  | "city_f"
  | "city_g"
  | "city_h";

/** 扩展内容中可定位的城市区划。 */
export type ExpansionDistrictCode = "A" | "B" | "C" | "D" | "E" | "F";

/** 内容可能出处的获取方式。 */
export type DiscoveryMethod =
  | "district_search"
  | "character_expedition"
  | "trade"
  | "document_decoding";

/** 一个可由页面直接展示的配方、蓝图或物品出处。 */
export interface ContentSourceConfig {
  readonly cityId: ExpansionCityId;
  readonly cityName: string;
  readonly districtCode: ExpansionDistrictCode;
  readonly districtName: string;
  readonly method: DiscoveryMethod;
  readonly hint: string;
}

/** 扩展物品的细分类别。 */
export type ExpansionItemCategory =
  | "raw_food"
  | "semi_finished_food"
  | "prepared_food"
  | "medicine"
  | "material"
  | "tool"
  | "weapon"
  | "armor"
  | "transport"
  | "trade_good"
  | "archive";

/** 载具能够覆盖的出行方式。 */
export type ExpansionTransportMode = "land" | "sea" | "air";

/** 可由状态结算器解析的数值修正。 */
export interface ExpansionNumericModifier {
  readonly target: string;
  readonly operation: "add" | "subtract" | "multiply_percent";
  readonly amount: number;
  readonly description: string;
}

/** 一个在特定行为下触发的随机数值奖励。 */
export interface TriggeredBonusConfig {
  readonly triggerId: string;
  readonly target: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly chancePercent: number;
  readonly description: string;
}

/** 制造与掉落系统共享的扩展物品。 */
export interface ExpansionItemConfig {
  readonly itemId: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: ExpansionItemCategory;
  readonly rarity: number;
  readonly tags: readonly string[];
  readonly source: ContentSourceConfig;
  readonly transportMode?: ExpansionTransportMode;
  readonly modifiers?: readonly ExpansionNumericModifier[];
}

/** 制造成本支持资源支付与以物易物。 */
export interface ManufacturingCostConfig {
  readonly resourceId: string;
  readonly displayName: string;
  readonly quantity: number;
  readonly kind: "currency" | "material" | "barter";
}

/** 基础与高级制造的层级。 */
export type ManufacturingTier = "basic" | "advanced";

/** 一项完整制造配方，高级配方必须关联蓝图。 */
export interface ManufacturingRecipeConfig {
  readonly recipeId: string;
  readonly displayName: string;
  readonly description: string;
  readonly tier: ManufacturingTier;
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly durationDays: number;
  readonly costs: readonly ManufacturingCostConfig[];
  readonly requiredBlueprintId: string | null;
  readonly source: ContentSourceConfig;
}

/** 研究台可解析的一份高级制造蓝图。 */
export interface ManufacturingBlueprintConfig {
  readonly blueprintId: string;
  readonly displayName: string;
  readonly description: string;
  readonly unlockRecipeId: string;
  readonly researchCoinCost: number;
  readonly researchPartsCost: number;
  readonly researchDurationDays: number;
  readonly source: ContentSourceConfig;
}

/** 制造目录生成器的单个产品族模板。 */
export interface ManufacturingFamilyTemplate {
  readonly familyId: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: ExpansionItemCategory;
  readonly tags: readonly string[];
  readonly baseCoinCost: number;
  readonly basePartsCost: number;
  readonly baseBarterCost: number;
  readonly barterItemId: string;
  readonly barterItemName: string;
  readonly outputQuantity: number;
  readonly transportMode?: ExpansionTransportMode;
  readonly modifierTarget?: string;
  readonly modifierPerGrade?: number;
}

/** 制造目录生成器的等级模板。 */
export interface ManufacturingGradeTemplate {
  readonly gradeId: string;
  readonly displayPrefix: string;
  readonly costMultiplierPercent: number;
  readonly durationDays: number;
  readonly rarity: number;
}

/** 用于构建完整制造目录的配置。 */
export interface ManufacturingGenerationConfig {
  readonly basicFamilies: readonly ManufacturingFamilyTemplate[];
  readonly advancedFamilies: readonly ManufacturingFamilyTemplate[];
  readonly grades: readonly ManufacturingGradeTemplate[];
  readonly cityIds: readonly ExpansionCityId[];
  readonly districtCodes: readonly ExpansionDistrictCode[];
  readonly blueprintSourceOffset: number;
  readonly recipeSourceOffset: number;
  readonly blueprintResearchCoinBase: number;
  readonly blueprintResearchPartsBase: number;
  readonly blueprintResearchDaysBase: number;
}

/** 生成后可被制造、研究和仓库共享的完整目录。 */
export interface ManufacturingCatalog {
  readonly basicRecipes: readonly ManufacturingRecipeConfig[];
  readonly advancedRecipes: readonly ManufacturingRecipeConfig[];
  readonly blueprints: readonly ManufacturingBlueprintConfig[];
  readonly items: readonly ExpansionItemConfig[];
}

/** 难度对全局系统的明确百分比修正。 */
export interface DifficultyMultipliersConfig {
  readonly survivalCostPercent: number;
  readonly enemyHealthPercent: number;
  readonly enemyDamagePercent: number;
  readonly commonLootPercent: number;
  readonly textLootPercent: number;
  readonly researchCostPercent: number;
  readonly tradePricePercent: number;
  readonly hopeLossPercent: number;
}

/** 一档可选开局难度。 */
export interface ExpansionDifficultyConfig {
  readonly difficultyId: string;
  readonly displayName: string;
  readonly description: string;
  readonly rank: number;
  readonly multipliers: DifficultyMultipliersConfig;
  readonly startingModifiers: readonly ExpansionNumericModifier[];
}

/** 一个带有开局与触发加成的所长起源。 */
export interface ExpansionOriginConfig {
  readonly originId: string;
  readonly displayName: string;
  readonly description: string;
  readonly startingModifiers: readonly ExpansionNumericModifier[];
  readonly triggeredBonuses: readonly TriggeredBonusConfig[];
}

/** 一个可与其他特性搭配的所长特性。 */
export interface ExpansionTraitConfig {
  readonly traitId: string;
  readonly displayName: string;
  readonly description: string;
  readonly modifiers: readonly ExpansionNumericModifier[];
  readonly triggeredBonuses: readonly TriggeredBonusConfig[];
  readonly incompatibleTraitIds: readonly string[];
}

/** 特性选择页的数量与唯一性规则。 */
export interface TraitSelectionRulesConfig {
  readonly minimumSelections: number;
  readonly maximumSelections: number;
  readonly requireUnique: boolean;
}

/** 避难所初始建筑类型及其内外墙基础数值。 */
export interface ShelterArchetypeConfig {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly bonuses: readonly string[];
  readonly starting_capacity: number;
  readonly initialFacilitySlots: number;
  readonly innerWallHealth: number;
  readonly outerWallHealth: number;
  readonly allowedTerrain: readonly (ExpansionTransportMode | "underground")[];
  readonly modifiers: readonly ExpansionNumericModifier[];
}

/** 可被结局系统匹配的失败结局。 */
export interface FailureEndingConfig {
  readonly endingId: string;
  readonly displayName: string;
  readonly triggerId: string;
  readonly priority: number;
  readonly summary: string;
  readonly epilogue: string;
}

/** 内容目录的数量门槛，用于启动校验和回归测试。 */
export interface ContentExpansionThresholds {
  readonly minimumBasicRecipes: number;
  readonly minimumAdvancedRecipes: number;
  readonly requiredTraitCount: number;
  readonly maximumSelectedTraits: number;
  readonly requiredOriginCount: number;
  readonly requiredShelterTypeCount: number;
  readonly requiredFailureEndingCount: number;
  readonly minimumTransportItems: number;
  readonly minimumRawFoodItems: number;
  readonly minimumSemiFinishedFoodItems: number;
}

/** 页面与领域服务可一次注入的扩展内容聚合。 */
export interface ContentExpansionCatalog {
  readonly manufacturing: ManufacturingCatalog;
  readonly difficulties: readonly ExpansionDifficultyConfig[];
  readonly origins: readonly ExpansionOriginConfig[];
  readonly traits: readonly ExpansionTraitConfig[];
  readonly traitSelectionRules: TraitSelectionRulesConfig;
  readonly shelterTypes: readonly ShelterArchetypeConfig[];
  readonly failureEndings: readonly FailureEndingConfig[];
  readonly thresholds: ContentExpansionThresholds;
}

/** 特性选择校验的结构化结果。 */
export interface TraitSelectionValidation {
  readonly valid: boolean;
  readonly error: string | null;
}
