import type {
  ContentExpansionCatalog,
  ExpansionItemConfig,
  ManufacturingRecipeConfig,
} from "./types";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** 在组合根或测试中校验扩展目录的数量和引用不变量。 */
export function validateContentExpansionCatalog(
  catalog: ContentExpansionCatalog,
): ContentExpansionCatalog {
  const { manufacturing, thresholds } = catalog;
  requireMinimumLength(
    manufacturing.basicRecipes,
    thresholds.minimumBasicRecipes,
    "基础制造配方",
  );
  requireMinimumLength(
    manufacturing.advancedRecipes,
    thresholds.minimumAdvancedRecipes,
    "高级制造配方",
  );
  requireExactLength(catalog.traits, thresholds.requiredTraitCount, "特性");
  requireExactLength(catalog.origins, thresholds.requiredOriginCount, "起源");
  requireExactLength(
    catalog.shelterTypes,
    thresholds.requiredShelterTypeCount,
    "避难所类型",
  );
  requireExactLength(
    catalog.failureEndings,
    thresholds.requiredFailureEndingCount,
    "失败结局",
  );
  validateManufacturing(catalog);
  validateProfiles(catalog);
  validateSheltersAndEndings(catalog);
  return catalog;
}

/** 校验制造项、产物与蓝图的一对一引用。 */
function validateManufacturing(catalog: ContentExpansionCatalog): void {
  const { manufacturing, thresholds } = catalog;
  const recipes = [
    ...manufacturing.basicRecipes,
    ...manufacturing.advancedRecipes,
  ];
  requireUnique(recipes.map((recipe) => recipe.recipeId), "recipeId");
  requireUnique(manufacturing.items.map((item) => item.itemId), "itemId");
  requireUnique(
    manufacturing.blueprints.map((blueprint) => blueprint.blueprintId),
    "blueprintId",
  );
  const itemIds = new Set(manufacturing.items.map((item) => item.itemId));
  const advancedRecipeIds = new Set(
    manufacturing.advancedRecipes.map((recipe) => recipe.recipeId),
  );
  const blueprintIds = new Set(
    manufacturing.blueprints.map((blueprint) => blueprint.blueprintId),
  );
  for (const recipe of manufacturing.basicRecipes) {
    requireStableId(recipe.recipeId, "recipeId");
    if (recipe.requiredBlueprintId !== null) {
      throw new Error(`基础配方 ${recipe.recipeId} 不得需要蓝图。`);
    }
    validateRecipe(recipe, itemIds);
  }
  for (const recipe of manufacturing.advancedRecipes) {
    requireStableId(recipe.recipeId, "recipeId");
    if (
      recipe.requiredBlueprintId === null
      || !blueprintIds.has(recipe.requiredBlueprintId)
    ) {
      throw new Error(`高级配方 ${recipe.recipeId} 必须引用有效蓝图。`);
    }
    validateRecipe(recipe, itemIds);
  }
  for (const blueprint of manufacturing.blueprints) {
    requireStableId(blueprint.blueprintId, "blueprintId");
    if (!advancedRecipeIds.has(blueprint.unlockRecipeId)) {
      throw new Error(`蓝图 ${blueprint.blueprintId} 引用了未知高级配方。`);
    }
    requirePositiveInteger(blueprint.researchCoinCost, "蓝图金币成本");
    requirePositiveInteger(blueprint.researchPartsCost, "蓝图零件成本");
    requirePositiveInteger(blueprint.researchDurationDays, "蓝图研究时长");
    requireSource(blueprint.source.hint, blueprint.blueprintId);
  }
  requireCategoryMinimum(
    manufacturing.items,
    "transport",
    thresholds.minimumTransportItems,
  );
  requireCategoryMinimum(
    manufacturing.items,
    "raw_food",
    thresholds.minimumRawFoodItems,
  );
  requireCategoryMinimum(
    manufacturing.items,
    "semi_finished_food",
    thresholds.minimumSemiFinishedFoodItems,
  );
}

/** 校验单个配方的产物、成本、时长与出处。 */
function validateRecipe(
  recipe: ManufacturingRecipeConfig,
  itemIds: ReadonlySet<string>,
): void {
  if (!itemIds.has(recipe.outputItemId)) {
    throw new Error(`配方 ${recipe.recipeId} 引用了未知产物。`);
  }
  requirePositiveInteger(recipe.outputQuantity, "配方产量");
  requirePositiveInteger(recipe.durationDays, "配方制造时长");
  if (recipe.costs.length === 0) {
    throw new Error(`配方 ${recipe.recipeId} 至少需要一项成本。`);
  }
  recipe.costs.forEach((cost) => {
    requirePositiveInteger(cost.quantity, "配方成本");
  });
  requireSource(recipe.source.hint, recipe.recipeId);
}

/** 校验难度、起源、特性与互斥关系。 */
function validateProfiles(catalog: ContentExpansionCatalog): void {
  requireUnique(catalog.difficulties.map((option) => option.difficultyId), "difficultyId");
  requireUnique(catalog.difficulties.map((option) => String(option.rank)), "difficulty rank");
  requireUnique(catalog.origins.map((option) => option.originId), "originId");
  requireUnique(catalog.traits.map((option) => option.traitId), "traitId");
  const traitById = new Map(catalog.traits.map((trait) => [trait.traitId, trait]));
  catalog.difficulties.forEach((option) => {
    requireStableId(option.difficultyId, "difficultyId");
    const multipliers: readonly number[] = [
      option.multipliers.survivalCostPercent,
      option.multipliers.enemyHealthPercent,
      option.multipliers.enemyDamagePercent,
      option.multipliers.commonLootPercent,
      option.multipliers.textLootPercent,
      option.multipliers.researchCostPercent,
      option.multipliers.tradePricePercent,
      option.multipliers.hopeLossPercent,
    ];
    multipliers.forEach((multiplier) => {
      requirePositiveInteger(multiplier, `${option.difficultyId} 难度倍率`);
    });
  });
  catalog.origins.forEach((option) => {
    requireStableId(option.originId, "originId");
    if (option.startingModifiers.length === 0 || option.triggeredBonuses.length === 0) {
      throw new Error(`起源 ${option.originId} 缺少明确的开局或触发加成。`);
    }
  });
  catalog.traits.forEach((option) => {
    requireStableId(option.traitId, "traitId");
    if (option.modifiers.length === 0 && option.triggeredBonuses.length === 0) {
      throw new Error(`特性 ${option.traitId} 缺少明确数值。`);
    }
    option.incompatibleTraitIds.forEach((incompatibleId) => {
      const incompatible = traitById.get(incompatibleId);
      if (incompatible === undefined) {
        throw new Error(`特性 ${option.traitId} 引用未知互斥特性。`);
      }
      if (!incompatible.incompatibleTraitIds.includes(option.traitId)) {
        throw new Error(`特性 ${option.traitId} 的互斥关系不对称。`);
      }
    });
  });
  if (
    catalog.traitSelectionRules.maximumSelections
    !== catalog.thresholds.maximumSelectedTraits
  ) {
    throw new Error("特性选择上限与内容门槛不一致。");
  }
}

/** 校验避难所类型和失败结局的稳定 ID 与基础数值。 */
function validateSheltersAndEndings(catalog: ContentExpansionCatalog): void {
  requireUnique(catalog.shelterTypes.map((option) => option.id), "shelter type id");
  requireUnique(catalog.failureEndings.map((option) => option.endingId), "endingId");
  catalog.shelterTypes.forEach((option) => {
    requireStableId(option.id, "shelter type id");
    requirePositiveInteger(option.starting_capacity, "避难所初始容量");
    requirePositiveInteger(option.innerWallHealth, "避难所内墙耐久");
    requirePositiveInteger(option.outerWallHealth, "避难所外墙耐久");
    if (option.bonuses.length === 0) {
      throw new Error(`避难所类型 ${option.id} 至少需要一项加成。`);
    }
  });
  catalog.failureEndings.forEach((option) => {
    requireStableId(option.endingId, "endingId");
    requirePositiveInteger(option.priority, "失败结局优先级");
  });
}

/** 校验一个列表至少达到门槛。 */
function requireMinimumLength(
  values: readonly unknown[],
  minimum: number,
  label: string,
): void {
  if (values.length < minimum) {
    throw new Error(`${label}至少需要 ${String(minimum)} 项。`);
  }
}

/** 校验一个列表数量与配置完全一致。 */
function requireExactLength(
  values: readonly unknown[],
  expected: number,
  label: string,
): void {
  if (values.length !== expected) {
    throw new Error(`${label}必须恰好包含 ${String(expected)} 项。`);
  }
}

/** 校验一组稳定 ID 不重复。 */
function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} 存在重复值。`);
  }
}

/** 校验 ID 仅使用英文小写、数字与下划线。 */
function requireStableId(value: string, label: string): void {
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new Error(`${label} 不是有效英文稳定 ID：${value}。`);
  }
}

/** 校验数值是正整数。 */
function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}必须是正整数。`);
  }
}

/** 校验条目提供了可直接展示的城市与区划出处。 */
function requireSource(hint: string, id: string): void {
  if (!hint.includes("市") || !hint.includes("区")) {
    throw new Error(`${id} 缺少城市与区划出处。`);
  }
}

/** 校验一类丰富物品至少达到给定数量。 */
function requireCategoryMinimum(
  items: readonly ExpansionItemConfig[],
  category: ExpansionItemConfig["category"],
  minimum: number,
): void {
  const count = items.filter((item) => item.category === category).length;
  if (count < minimum) {
    throw new Error(`物品分类 ${category} 至少需要 ${String(minimum)} 项。`);
  }
}
