import type {
  ContentSourceConfig,
  ExpansionItemConfig,
  ManufacturingBlueprintConfig,
  ManufacturingCatalog,
  ManufacturingCostConfig,
  ManufacturingFamilyTemplate,
  ManufacturingGenerationConfig,
  ManufacturingGradeTemplate,
  ManufacturingRecipeConfig,
  ManufacturingTier,
} from "./types";

/** 使用纯函数和确定性索引生成全量制造与蓝图目录。 */
export function createManufacturingCatalog(
  config: ManufacturingGenerationConfig,
): ManufacturingCatalog {
  const basic = createTierCatalog("basic", config.basicFamilies, config);
  const advanced = createTierCatalog("advanced", config.advancedFamilies, config);
  return {
    basicRecipes: basic.recipes,
    advancedRecipes: advanced.recipes,
    blueprints: advanced.blueprints,
    items: [...basic.items, ...advanced.items],
  };
}

/** 仅返回基础配方与已完成蓝图研究的高级配方。 */
export function selectVisibleManufacturingRecipes(
  catalog: ManufacturingCatalog,
  completedBlueprintIds: ReadonlySet<string>,
): readonly ManufacturingRecipeConfig[] {
  return [
    ...catalog.basicRecipes,
    ...catalog.advancedRecipes.filter((recipe) =>
      recipe.requiredBlueprintId !== null
      && completedBlueprintIds.has(recipe.requiredBlueprintId),
    ),
  ];
}

/** 按制造层级展开“产品族 × 品质等级”笛卡尔积。 */
function createTierCatalog(
  tier: ManufacturingTier,
  families: readonly ManufacturingFamilyTemplate[],
  config: ManufacturingGenerationConfig,
): {
  readonly recipes: readonly ManufacturingRecipeConfig[];
  readonly blueprints: readonly ManufacturingBlueprintConfig[];
  readonly items: readonly ExpansionItemConfig[];
} {
  const recipes: ManufacturingRecipeConfig[] = [];
  const blueprints: ManufacturingBlueprintConfig[] = [];
  const items: ExpansionItemConfig[] = [];
  families.forEach((family, familyIndex) => {
    config.grades.forEach((grade, gradeIndex) => {
      const sequence = familyIndex * config.grades.length + gradeIndex;
      const source = createSource(sequence + config.recipeSourceOffset, config);
      const itemId = `${tier}_${family.familyId}_${grade.gradeId}`;
      const recipeId = `${tier}_recipe_${family.familyId}_${grade.gradeId}`;
      const blueprintId = tier === "advanced"
        ? `blueprint_${family.familyId}_${grade.gradeId}`
        : null;
      items.push(createItem(itemId, family, grade, source));
      recipes.push(createRecipe(
        recipeId,
        itemId,
        blueprintId,
        tier,
        family,
        grade,
        source,
      ));
      if (blueprintId !== null) {
        blueprints.push(createBlueprint(
          blueprintId,
          recipeId,
          family,
          grade,
          sequence,
          config,
        ));
      }
    });
  });
  return { recipes, blueprints, items };
}

/** 构建一项可入库的制造产物。 */
function createItem(
  itemId: string,
  family: ManufacturingFamilyTemplate,
  grade: ManufacturingGradeTemplate,
  source: ContentSourceConfig,
): ExpansionItemConfig {
  const modifierAmount = family.modifierPerGrade === undefined
    ? undefined
    : family.modifierPerGrade * grade.rarity;
  const modifiers = family.modifierTarget === undefined || modifierAmount === undefined
    ? undefined
    : [{
        target: family.modifierTarget,
        operation: "add" as const,
        amount: modifierAmount,
        description: `${family.displayName}的 ${family.modifierTarget} 加成 +${String(modifierAmount)}。`,
      }];
  return {
    itemId,
    displayName: `${grade.displayPrefix}${family.displayName}`,
    description: `${family.description}当前为${grade.displayPrefix}规格。`,
    category: family.category,
    rarity: grade.rarity,
    tags: [...family.tags, grade.gradeId],
    source,
    ...(family.transportMode === undefined ? {} : { transportMode: family.transportMode }),
    ...(modifiers === undefined ? {} : { modifiers }),
  };
}

/** 构建一项包含货币、零件和可选以物易物成本的配方。 */
function createRecipe(
  recipeId: string,
  itemId: string,
  blueprintId: string | null,
  tier: ManufacturingTier,
  family: ManufacturingFamilyTemplate,
  grade: ManufacturingGradeTemplate,
  source: ContentSourceConfig,
): ManufacturingRecipeConfig {
  return {
    recipeId,
    displayName: `制作·${grade.displayPrefix}${family.displayName}`,
    description: `${family.description}配方可能在${source.cityName}${source.districtName}找到。`,
    tier,
    outputItemId: itemId,
    outputQuantity: family.outputQuantity,
    durationDays: grade.durationDays,
    costs: createCosts(family, grade),
    requiredBlueprintId: blueprintId,
    source,
  };
}

/** 按品质百分比伸缩制造成本，并忽略零数量资源。 */
function createCosts(
  family: ManufacturingFamilyTemplate,
  grade: ManufacturingGradeTemplate,
): readonly ManufacturingCostConfig[] {
  const costs: ManufacturingCostConfig[] = [];
  appendCost(costs, "coins", "金币", family.baseCoinCost, "currency", grade);
  appendCost(costs, "parts", "零件", family.basePartsCost, "material", grade);
  appendCost(
    costs,
    family.barterItemId,
    family.barterItemName,
    family.baseBarterCost,
    "barter",
    grade,
  );
  return costs;
}

/** 在基础数量为正数时向配方成本追加一项整数支付。 */
function appendCost(
  target: ManufacturingCostConfig[],
  resourceId: string,
  displayName: string,
  baseQuantity: number,
  kind: ManufacturingCostConfig["kind"],
  grade: ManufacturingGradeTemplate,
): void {
  if (baseQuantity <= 0) return;
  target.push({
    resourceId,
    displayName,
    quantity: Math.max(1, Math.ceil(baseQuantity * grade.costMultiplierPercent / 100)),
    kind,
  });
}

/** 构建一份只能通过研究解锁对应高级配方的蓝图。 */
function createBlueprint(
  blueprintId: string,
  recipeId: string,
  family: ManufacturingFamilyTemplate,
  grade: ManufacturingGradeTemplate,
  sequence: number,
  config: ManufacturingGenerationConfig,
): ManufacturingBlueprintConfig {
  const source = createSource(sequence + config.blueprintSourceOffset, config);
  return {
    blueprintId,
    displayName: `${grade.displayPrefix}${family.displayName}蓝图`,
    description: `解析后解锁“制作·${grade.displayPrefix}${family.displayName}”；可能在${source.cityName}${source.districtName}找到。`,
    unlockRecipeId: recipeId,
    researchCoinCost: config.blueprintResearchCoinBase + grade.rarity * family.baseCoinCost,
    researchPartsCost: config.blueprintResearchPartsBase + grade.rarity * family.basePartsCost,
    researchDurationDays: config.blueprintResearchDaysBase + grade.durationDays,
    source,
  };
}

/** 把稳定序号循环映射到 A-H 市与 A-F 区。 */
function createSource(
  sequence: number,
  config: ManufacturingGenerationConfig,
): ContentSourceConfig {
  const districtCount = config.districtCodes.length;
  const cityIndex = Math.floor(sequence / districtCount) % config.cityIds.length;
  const districtIndex = sequence % districtCount;
  const cityId = config.cityIds[cityIndex];
  const districtCode = config.districtCodes[districtIndex];
  if (cityId === undefined || districtCode === undefined) {
    throw new Error("制造出处生成器缺少城市或区划配置。");
  }
  const cityName = `${cityId.slice(-1).toUpperCase()}市`;
  const districtName = `${districtCode}区`;
  return {
    cityId,
    cityName,
    districtCode,
    districtName,
    method: sequence % 4 === 0 ? "document_decoding" : "district_search",
    hint: `可能在 ${cityName} ${districtName} 找到`,
  };
}
