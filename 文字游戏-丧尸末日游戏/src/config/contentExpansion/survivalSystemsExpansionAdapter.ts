import type {
  CraftingRecipeConfig,
  CraftedWarehouseItemConfig,
  DiscoverySourceLocationConfig,
  PlayerCombatAttribute,
  ResearchProjectConfig,
  ResourceCostConfig,
  SurvivalSystemsConfigDocument,
  WarehouseItemCategory,
} from "../../domain/survival-systems";
import type {
  ContentSourceConfig,
  ExpansionItemCategory,
  ExpansionItemConfig,
  ManufacturingBlueprintConfig,
  ManufacturingCatalog,
  ManufacturingCostConfig,
  ManufacturingRecipeConfig,
} from "./types";

/** 将扩展目录投影到旧生存系统时使用的显式映射。 */
export interface SurvivalSystemsExpansionAdapterConfig {
  readonly costTargetByResourceId: Readonly<Record<string, string>>;
  readonly barterItemCategory: WarehouseItemCategory;
  readonly barterItemCarryable: boolean;
  readonly barterItemDescription: string;
  readonly categoryMap: Readonly<Record<ExpansionItemCategory, WarehouseItemCategory>>;
  readonly carryableCategories: readonly ExpansionItemCategory[];
  readonly advancedProjectIdPrefix: string;
  readonly advancedProjectExpeditionBonus: number;
}

/** 对当前存档数值目标兼容的默认制造目录投影配置。 */
export const DEFAULT_SURVIVAL_SYSTEMS_EXPANSION_ADAPTER_CONFIG = {
  costTargetByResourceId: {
    coins: "player.coins",
    parts: "player.parts",
  },
  barterItemCategory: "material",
  barterItemCarryable: true,
  barterItemDescription: "用于制造配方以物易物的交换物资。",
  categoryMap: {
    raw_food: "consumable",
    semi_finished_food: "consumable",
    prepared_food: "consumable",
    medicine: "consumable",
    material: "material",
    tool: "tool",
    weapon: "weapon",
    armor: "armor",
    transport: "transport",
    trade_good: "material",
    archive: "archive",
  },
  carryableCategories: [
    "raw_food",
    "semi_finished_food",
    "prepared_food",
    "medicine",
    "material",
    "tool",
    "trade_good",
  ],
  advancedProjectIdPrefix: "research_",
  advancedProjectExpeditionBonus: 0,
} as const satisfies SurvivalSystemsExpansionAdapterConfig;

/** 以纯函数方式把扩展制造目录合并进旧生存系统配置。 */
export function mergeManufacturingCatalogIntoSurvivalSystems(
  base: SurvivalSystemsConfigDocument,
  catalog: ManufacturingCatalog,
  adapterConfig: SurvivalSystemsExpansionAdapterConfig
    = DEFAULT_SURVIVAL_SYSTEMS_EXPANSION_ADAPTER_CONFIG,
): SurvivalSystemsConfigDocument {
  requireNoCatalogCollisions(base, catalog, adapterConfig);
  const blueprintById = new Map(
    catalog.blueprints.map((blueprint) => [blueprint.blueprintId, blueprint]),
  );
  const basicRecipes = catalog.basicRecipes.map((recipe) =>
    adaptRecipe(recipe, null, recipe.source, adapterConfig),
  );
  const advancedRecipes = catalog.advancedRecipes.map((recipe) => {
    const blueprint = requireRecipeBlueprint(recipe, blueprintById);
    return adaptRecipe(
      recipe,
      advancedProjectId(blueprint.blueprintId, adapterConfig),
      blueprint.source,
      adapterConfig,
    );
  });
  const advancedProjects = catalog.blueprints.map((blueprint) =>
    adaptBlueprintProject(blueprint, adapterConfig),
  );
  const outputItems = catalog.items.map((item) => adaptOutputItem(item, adapterConfig));
  const blueprintItems = catalog.blueprints.map(adaptBlueprintItem);
  const barterItems = adaptBarterItems(base, catalog, adapterConfig);
  return {
    ...base,
    warehouse: {
      ...base.warehouse,
      crafted_items: [
        ...base.warehouse.crafted_items,
        ...barterItems,
        ...outputItems,
        ...blueprintItems,
      ],
    },
    research: {
      ...base.research,
      projects: [
        ...base.research.projects,
        ...advancedProjects,
      ],
    },
    crafting: {
      ...base.crafting,
      recipes: [
        ...base.crafting.recipes,
        ...basicRecipes,
        ...advancedRecipes,
      ],
    },
  };
}

/** 把扩展产物类别、装备与载具数值投影到旧仓库物品。 */
function adaptOutputItem(
  item: ExpansionItemConfig,
  config: SurvivalSystemsExpansionAdapterConfig,
): CraftedWarehouseItemConfig {
  const equipmentBonuses = equipmentBonusesOf(item);
  return {
    item_id: item.itemId,
    name: item.displayName,
    category: config.categoryMap[item.category],
    carryable: config.carryableCategories.includes(item.category),
    description: `${item.description}出处：${item.source.hint}。`,
    ...(equipmentBonuses === undefined
      ? {}
      : { equipment_bonuses: equipmentBonuses }),
    ...(item.transportMode === undefined
      ? {}
      : { transport_mode: item.transportMode }),
  };
}

/** 把蓝图作为可放入研究台的关键物品注册进仓库。 */
function adaptBlueprintItem(
  blueprint: ManufacturingBlueprintConfig,
): CraftedWarehouseItemConfig {
  return {
    item_id: blueprint.blueprintId,
    name: blueprint.displayName,
    category: "key_item",
    carryable: false,
    description: `${blueprint.description}出处：${blueprint.source.hint}。`,
  };
}

/** 把扩展配方投影为旧制造服务可直接执行的格式。 */
function adaptRecipe(
  recipe: ManufacturingRecipeConfig,
  projectId: string | null,
  blueprintSource: ContentSourceConfig,
  config: SurvivalSystemsExpansionAdapterConfig,
): CraftingRecipeConfig {
  return {
    recipe_id: recipe.recipeId,
    name: recipe.displayName,
    description: recipe.description,
    required_project_id: projectId,
    turns_consumed: recipe.durationDays,
    costs: adaptCosts(recipe.costs, config),
    output_item_id: recipe.outputItemId,
    output_quantity: recipe.outputQuantity,
    blueprint_source_locations: [adaptSourceLocation(blueprintSource)],
  };
}

/** 把一份蓝图投影为消耗蓝图物品、金币和零件的研究项目。 */
function adaptBlueprintProject(
  blueprint: ManufacturingBlueprintConfig,
  config: SurvivalSystemsExpansionAdapterConfig,
): ResearchProjectConfig {
  return {
    project_id: advancedProjectId(blueprint.blueprintId, config),
    name: `研究·${blueprint.displayName}`,
    description: blueprint.description,
    required_project_ids: [],
    turns_consumed: blueprint.researchDurationDays,
    costs: [
      {
        target: requireCostTarget("coins", config),
        operation: "subtract",
        amount: blueprint.researchCoinCost,
      },
      {
        target: requireCostTarget("parts", config),
        operation: "subtract",
        amount: blueprint.researchPartsCost,
      },
    ],
    unlock_recipe_ids: [blueprint.unlockRecipeId],
    expedition_step_bonus: config.advancedProjectExpeditionBonus,
    research_input_item_id: blueprint.blueprintId,
    source_locations: [adaptSourceLocation(blueprint.source)],
  };
}

/** 把扩展配方成本分别投影为状态资源与仓库物品扣减。 */
function adaptCosts(
  costs: readonly ManufacturingCostConfig[],
  config: SurvivalSystemsExpansionAdapterConfig,
): readonly ResourceCostConfig[] {
  const stateTotals = new Map<string, number>();
  const itemTotals = new Map<string, number>();
  for (const cost of costs) {
    if (cost.kind === "barter") {
      itemTotals.set(
        cost.resourceId,
        (itemTotals.get(cost.resourceId) ?? 0) + cost.quantity,
      );
      continue;
    }
    const target = config.costTargetByResourceId[cost.resourceId];
    if (target === undefined) {
      throw new Error(`扩展制造成本缺少状态目标映射：${cost.resourceId}。`);
    }
    stateTotals.set(target, (stateTotals.get(target) ?? 0) + cost.quantity);
  }
  if (stateTotals.size + itemTotals.size === 0) {
    throw new Error("扩展配方没有可投影到旧生存系统的成本。");
  }
  return [
    ...[...stateTotals.entries()].map(([target, amount]) => ({
      target,
      operation: "subtract" as const,
      amount,
    })),
    ...[...itemTotals.entries()].map(([item_id, amount]) => ({ item_id, amount })),
  ];
}

/** 为扩展配方中尚未注册的以物易物材料建立稳定仓库条目。 */
function adaptBarterItems(
  base: SurvivalSystemsConfigDocument,
  catalog: ManufacturingCatalog,
  config: SurvivalSystemsExpansionAdapterConfig,
): readonly CraftedWarehouseItemConfig[] {
  const registeredIds = new Set([
    ...base.warehouse.resource_items,
    ...base.warehouse.crafted_items,
  ].map((item) => item.item_id));
  catalog.items.forEach((item) => registeredIds.add(item.itemId));
  catalog.blueprints.forEach((blueprint) => registeredIds.add(blueprint.blueprintId));
  const barterNames = new Map<string, string>();
  for (const recipe of [...catalog.basicRecipes, ...catalog.advancedRecipes]) {
    for (const cost of recipe.costs) {
      if (cost.kind !== "barter" || registeredIds.has(cost.resourceId)) continue;
      const knownName = barterNames.get(cost.resourceId);
      if (knownName !== undefined && knownName !== cost.displayName) {
        throw new Error(`以物易物材料 ${cost.resourceId} 存在冲突名称。`);
      }
      barterNames.set(cost.resourceId, cost.displayName);
    }
  }
  return [...barterNames.entries()].map(([item_id, name]) => ({
    item_id,
    name,
    category: config.barterItemCategory,
    carryable: config.barterItemCarryable,
    description: config.barterItemDescription,
  }));
}

/** 从扩展装备修正中提取旧战斗系统支持的三项属性。 */
function equipmentBonusesOf(
  item: ExpansionItemConfig,
): Partial<Readonly<Record<PlayerCombatAttribute, number>>> | undefined {
  if (item.category !== "weapon" && item.category !== "armor") return undefined;
  const bonuses: Partial<Record<PlayerCombatAttribute, number>> = {};
  item.modifiers?.forEach((modifier) => {
    const attribute = modifier.target.startsWith("player.")
      ? modifier.target.slice("player.".length)
      : "";
    if (
      modifier.operation === "add"
      && (attribute === "attack" || attribute === "defense" || attribute === "agility")
    ) {
      bonuses[attribute] = (bonuses[attribute] ?? 0) + modifier.amount;
    }
  });
  if (Object.keys(bonuses).length === 0) {
    throw new Error(`扩展装备 ${item.itemId} 缺少旧战斗系统可用的属性加成。`);
  }
  return bonuses;
}

/** 把扩展出处转为现有城市与区划稳定 ID。 */
function adaptSourceLocation(
  source: ContentSourceConfig,
): DiscoverySourceLocationConfig {
  return {
    city_id: source.cityId,
    district_id: `${source.cityId}_district_${source.districtCode.toLowerCase()}`,
  };
}

/** 根据可配置前缀生成高级蓝图研究项目 ID。 */
function advancedProjectId(
  blueprintId: string,
  config: SurvivalSystemsExpansionAdapterConfig,
): string {
  return `${config.advancedProjectIdPrefix}${blueprintId}`;
}

/** 要求高级配方关联的蓝图确实存在。 */
function requireRecipeBlueprint(
  recipe: ManufacturingRecipeConfig,
  blueprintById: ReadonlyMap<string, ManufacturingBlueprintConfig>,
): ManufacturingBlueprintConfig {
  const blueprint = recipe.requiredBlueprintId === null
    ? undefined
    : blueprintById.get(recipe.requiredBlueprintId);
  if (blueprint === undefined) {
    throw new Error(`高级配方 ${recipe.recipeId} 缺少有效蓝图。`);
  }
  return blueprint;
}

/** 要求适配器配置了必需资源的旧状态目标。 */
function requireCostTarget(
  resourceId: string,
  config: SurvivalSystemsExpansionAdapterConfig,
): string {
  const target = config.costTargetByResourceId[resourceId];
  if (target === undefined) {
    throw new Error(`扩展制造成本缺少状态目标映射：${resourceId}。`);
  }
  return target;
}

/** 在合并前拒绝任何物品、配方或研究项目 ID 冲突。 */
function requireNoCatalogCollisions(
  base: SurvivalSystemsConfigDocument,
  catalog: ManufacturingCatalog,
  config: SurvivalSystemsExpansionAdapterConfig,
): void {
  const baseItemIds = new Set([
    ...base.warehouse.resource_items,
    ...base.warehouse.crafted_items,
  ].map((item) => item.item_id));
  const baseRecipeIds = new Set(base.crafting.recipes.map((recipe) => recipe.recipe_id));
  const baseProjectIds = new Set(base.research.projects.map((project) => project.project_id));
  const collision = [
    ...catalog.items.map((item) => item.itemId),
    ...catalog.blueprints.map((blueprint) => blueprint.blueprintId),
  ].find((itemId) => baseItemIds.has(itemId));
  if (collision !== undefined) {
    throw new Error(`扩展仓库物品 ID 冲突：${collision}。`);
  }
  const recipeCollision = [
    ...catalog.basicRecipes,
    ...catalog.advancedRecipes,
  ].find((recipe) => baseRecipeIds.has(recipe.recipeId));
  if (recipeCollision !== undefined) {
    throw new Error(`扩展制造配方 ID 冲突：${recipeCollision.recipeId}。`);
  }
  const projectCollision = catalog.blueprints.find((blueprint) =>
    baseProjectIds.has(advancedProjectId(blueprint.blueprintId, config)),
  );
  if (projectCollision !== undefined) {
    throw new Error(`扩展研究项目 ID 冲突：${projectCollision.blueprintId}。`);
  }
}
