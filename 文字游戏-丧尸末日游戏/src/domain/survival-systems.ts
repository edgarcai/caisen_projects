/** 仓库物品支持的稳定分类。 */
export type WarehouseItemCategory =
  | "consumable"
  | "material"
  | "archive"
  | "key_item"
  | "morale"
  | "tool"
  | "transport"
  | "armor"
  | "weapon";

/** 装备可修正的玩家战斗属性。 */
export type PlayerCombatAttribute = "attack" | "defense" | "agility";

/** 载具能够覆盖的稳定通行地貌。 */
export type TransportMode = "land" | "sea" | "air";

/** 由既有状态目标提供数量的仓库物品。 */
export interface ResourceWarehouseItemConfig {
  readonly item_id: string;
  readonly name: string;
  readonly category: WarehouseItemCategory;
  readonly state_target: string;
  readonly carryable: boolean;
  readonly description: string;
}

/** 由制作系统提供数量的仓库物品。 */
export interface CraftedWarehouseItemConfig {
  readonly item_id: string;
  readonly name: string;
  readonly category: WarehouseItemCategory;
  readonly carryable: boolean;
  readonly description: string;
  readonly equipment_bonuses?: Partial<Readonly<Record<PlayerCombatAttribute, number>>>;
  readonly transport_mode?: TransportMode;
}

/** 由剧情配置注入仓库的只读关键物品档案。 */
export interface KeyItemWarehouseConfig {
  readonly item_id: string;
  readonly name: string;
  readonly description: string;
}

/** 玩家装备后的实时战斗属性。 */
export interface EffectivePlayerAttributes {
  readonly attack: number;
  readonly defense: number;
  readonly agility: number;
}

/** 研发与制作允许使用的固定、正整数资源成本。 */
export interface ResourceCostConfig {
  readonly target: string;
  readonly operation: "subtract";
  readonly amount: number;
}

/** 单项配置化研发项目。 */
export interface ResearchProjectConfig {
  readonly project_id: string;
  readonly name: string;
  readonly description: string;
  readonly required_project_ids: readonly string[];
  readonly turns_consumed: number;
  readonly costs: readonly ResourceCostConfig[];
  readonly unlock_recipe_ids: readonly string[];
  readonly expedition_step_bonus: number;
}

/** 单项配置化制作配方。 */
export interface CraftingRecipeConfig {
  readonly recipe_id: string;
  readonly name: string;
  readonly description: string;
  readonly required_project_id: string;
  readonly turns_consumed: number;
  readonly costs: readonly ResourceCostConfig[];
  readonly output_item_id: string;
  readonly output_quantity: number;
}

/** 伙伴信任对应的远征步数阈值。 */
export interface CompanionTrustStepConfig {
  readonly trust: number;
  readonly steps: number;
}

/** 一名伙伴为远征提供的配置化技能加成。 */
export interface CompanionStepBonusConfig {
  readonly companion_id: string;
  readonly trait_name: string;
  readonly base_steps: number;
  readonly trust_thresholds: readonly CompanionTrustStepConfig[];
}

/** 可被强制返程损失规则追踪的物资目标。 */
export interface ExpeditionLootTargetConfig {
  readonly item_id: string;
  readonly state_target: string;
}

/** 仓库、研发、制作与远征共享的版本化配置。 */
export interface SurvivalSystemsConfigDocument {
  readonly schema_version: number;
  readonly warehouse: {
    readonly resource_items: readonly ResourceWarehouseItemConfig[];
    readonly crafted_items: readonly CraftedWarehouseItemConfig[];
    readonly category_labels: Readonly<Record<WarehouseItemCategory, string>>;
    readonly empty_text: string;
    readonly unknown_item_text: string;
    readonly invalid_transfer_quantity_text: string;
    readonly invalid_equipment_text: string;
    readonly equipment_unavailable_text: string;
    readonly equipped_text: string;
  };
  readonly research: {
    readonly projects: readonly ResearchProjectConfig[];
    readonly completed_text: string;
    readonly already_completed_text: string;
    readonly locked_text: string;
    readonly insufficient_text: string;
    readonly unknown_text: string;
  };
  readonly crafting: {
    readonly recipes: readonly CraftingRecipeConfig[];
    readonly crafted_text: string;
    readonly locked_text: string;
    readonly insufficient_text: string;
    readonly unknown_text: string;
  };
  readonly transport_loadout: {
    readonly maximum_active_transports: number;
    readonly mode_labels: Readonly<Record<TransportMode, string>>;
    readonly equipped_text: string;
    readonly unequipped_text: string;
    readonly unavailable_text: string;
    readonly capacity_reached_text: string;
    readonly invalid_transport_text: string;
  };
  readonly expedition: {
    readonly action_food_item_id: string;
    readonly food_units_per_action: number;
    readonly base_steps: number;
    readonly maximum_companions: number;
    readonly maximum_carried_item_types: number;
    readonly maximum_carried_units: number;
    readonly event_step_cost: number;
    readonly companion_step_bonuses: readonly CompanionStepBonusConfig[];
    readonly carried_item_step_bonuses: Readonly<Record<string, number>>;
    readonly loot_targets: readonly ExpeditionLootTargetConfig[];
    readonly forced_return_keep_percent: number;
    readonly forced_return_health_range: readonly [number, number];
    readonly prepared_text: string;
    readonly action_text: string;
    readonly safe_return_text: string;
    readonly forced_return_text: string;
    readonly no_active_text: string;
    readonly selection_invalid_text: string;
  };
  readonly display: {
    readonly cost_item_format: string;
    readonly cost_separator: string;
    readonly step_bonus_format: string;
  };
}

/** 仓库页面展示的一项实时库存。 */
export interface WarehouseItemView {
  readonly itemId: string;
  readonly name: string;
  readonly category: WarehouseItemCategory;
  readonly categoryLabel: string;
  readonly quantity: number;
  readonly carryable: boolean;
  readonly description: string;
}

/** 不依赖当前库存数量的完整仓库物品目录项。 */
export interface WarehouseItemCatalogEntry {
  readonly itemId: string;
  readonly name: string;
  readonly category: WarehouseItemCategory;
  readonly categoryLabel: string;
  readonly carryable: boolean;
  readonly description: string;
}

/** 载具设置页展示的一辆已制作或待制作载具。 */
export interface TransportLoadoutOptionView {
  readonly itemId: string;
  readonly name: string;
  readonly mode: TransportMode;
  readonly modeLabel: string;
  readonly description: string;
  readonly ownedQuantity: number;
  readonly equipped: boolean;
  readonly available: boolean;
}

/** 研发页面展示的一项实时状态。 */
export interface ResearchProjectView {
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly completed: boolean;
  readonly available: boolean;
  readonly costDescription: string;
  readonly expeditionStepBonus: number;
}

/** 制作页面展示的一项实时配方。 */
export interface CraftingRecipeView {
  readonly recipeId: string;
  readonly name: string;
  readonly description: string;
  readonly available: boolean;
  readonly unlocked: boolean;
  readonly costDescription: string;
  readonly outputItemId: string;
  readonly outputQuantity: number;
}

/** 出发准备页展示的一名可同行伙伴。 */
export interface ExpeditionCompanionView {
  readonly companionId: string;
  readonly name: string;
  readonly traitName: string;
  readonly trust: number;
  readonly stepBonus: number;
}

/** 出发准备页展示的一项可携带物资。 */
export interface ExpeditionCarryItemView {
  readonly itemId: string;
  readonly name: string;
  readonly availableQuantity: number;
  readonly stepBonusPerUnit: number;
}

/** 远征状态页需要的稳定摘要。 */
export interface ExpeditionStatusView {
  readonly cityId: string;
  readonly districtId: string;
  readonly travelStepCost: number;
  readonly leaderPlayerIndex: number;
  readonly remainingSteps: number;
  readonly maximumSteps: number;
  readonly eventsResolved: number;
  readonly companionIds: readonly string[];
  readonly carriedItems: Readonly<Record<string, number>>;
  readonly loot: Readonly<Record<string, number>>;
  readonly itemNames: Readonly<Record<string, string>>;
}

/** 伙伴可使用的稳定装备槽位。 */
export type CompanionEquipmentSlot = "weapon" | "armor";

/** 伙伴档案页与管理页共用的完整读模型。 */
export interface CompanionManagementView {
  readonly companionId: string;
  readonly name: string;
  readonly role: string;
  readonly portraitKey: string;
  readonly introduction: string;
  readonly secret: string;
  readonly secretUnlocked: boolean;
  readonly status: string;
  readonly trust: number;
  readonly equippedWeaponId: string | null;
  readonly equippedArmorId: string | null;
  readonly equippedWeaponName: string | null;
  readonly equippedArmorName: string | null;
  readonly interactionCooldownTurns: number;
  readonly interactionCount: number;
}

/** 伙伴一个槽位可选装备的实时库存投影。 */
export interface CompanionEquipmentOptionView {
  readonly itemId: string;
  readonly name: string;
  readonly slot: CompanionEquipmentSlot;
  readonly description: string;
  readonly availableQuantity: number;
  readonly equipped: boolean;
  readonly available: boolean;
}

/** 伙伴互动选项的收益、冷却和可用状态。 */
export interface CompanionInteractionOptionView {
  readonly interactionId: string;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly unavailableReason: string;
  readonly trustGain: number;
  readonly hopeGain: number;
  readonly cooldownTurns: number;
  readonly turnsConsumed: number;
}

/** 研发、制作或返程操作的原子结算结果。 */
export interface SurvivalSystemResolution {
  readonly applied: boolean;
  readonly messages: readonly string[];
  readonly turnsConsumed: number;
}
