import { describe, expect, it } from "vitest";
import survivalSystemsDocument from "../../config/survival_systems.json";
import {
  CONTENT_EXPANSION_THRESHOLDS,
  TRAIT_SELECTION_RULES,
  advancedManufacturingRecipes,
  basicManufacturingRecipes,
  contentExpansionCatalog,
  difficultyOptions,
  expansionItems,
  failureEndings,
  manufacturingBlueprints,
  manufacturingCatalog,
  mergeManufacturingCatalogIntoSurvivalSystems,
  originOptions,
  selectVisibleManufacturingRecipes,
  shelterTypes,
  traitOptions,
  validateContentExpansionCatalog,
  validateTraitSelection,
} from "../../src/config/contentExpansion";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** 返回数组中某一字段的唯一值数量。 */
function uniqueCount<T>(
  values: readonly T[],
  select: (value: T) => string,
): number {
  return new Set(values.map(select)).size;
}

/** 在不依赖字面量窄化的情况下判断数值为正数。 */
function isPositive(value: number): boolean {
  return value > 0;
}

/** 在不依赖元组长度窄化的情况下判断列表非空。 */
function isNonEmpty(values: readonly unknown[]): boolean {
  return values.length > 0;
}

describe("扩展制造与蓝图目录", () => {
  it("在运行时完整展开 200 基础与 200 高级配方", () => {
    expect(basicManufacturingRecipes).toHaveLength(200);
    expect(advancedManufacturingRecipes).toHaveLength(200);
    expect(manufacturingBlueprints).toHaveLength(200);
    expect(expansionItems).toHaveLength(400);
    expect(uniqueCount(basicManufacturingRecipes, (recipe) => recipe.recipeId)).toBe(200);
    expect(uniqueCount(advancedManufacturingRecipes, (recipe) => recipe.recipeId)).toBe(200);
    expect(uniqueCount(manufacturingBlueprints, (blueprint) => blueprint.blueprintId)).toBe(200);
    expect(uniqueCount(expansionItems, (item) => item.itemId)).toBe(400);
  });

  it("为每个配方与蓝图标注城市区划出处", () => {
    const sourcedEntries = [
      ...basicManufacturingRecipes,
      ...advancedManufacturingRecipes,
      ...manufacturingBlueprints,
    ];
    expect(sourcedEntries.every((entry) =>
      entry.source.hint.includes("市") && entry.source.hint.includes("区"),
    )).toBe(true);
    expect(sourcedEntries.some((entry) =>
      entry.source.cityId === "city_a"
      && entry.source.districtCode === "C"
      && entry.source.hint === "可能在 A市 C区 找到",
    )).toBe(true);
  });

  it("高级配方全部需要一对一蓝图研究", () => {
    const blueprintById = new Map(
      manufacturingBlueprints.map((blueprint) => [blueprint.blueprintId, blueprint]),
    );
    for (const recipe of advancedManufacturingRecipes) {
      expect(recipe.requiredBlueprintId).not.toBeNull();
      const blueprint = recipe.requiredBlueprintId === null
        ? undefined
        : blueprintById.get(recipe.requiredBlueprintId);
      expect(blueprint?.unlockRecipeId).toBe(recipe.recipeId);
      expect(blueprint?.researchCoinCost).toBeGreaterThan(0);
      expect(blueprint?.researchPartsCost).toBeGreaterThan(0);
    }
    expect(basicManufacturingRecipes.every((recipe) =>
      recipe.requiredBlueprintId === null,
    )).toBe(true);
  });

  it("在未研究时完全隐藏高级配方，研究后仅显示对应项", () => {
    const hidden = selectVisibleManufacturingRecipes(
      manufacturingCatalog,
      new Set(),
    );
    const firstBlueprint = manufacturingBlueprints[0];
    if (firstBlueprint === undefined) {
      throw new Error("测试要求至少存在一份蓝图。");
    }
    const revealed = selectVisibleManufacturingRecipes(
      manufacturingCatalog,
      new Set([firstBlueprint.blueprintId]),
    );

    expect(hidden).toHaveLength(200);
    expect(hidden.every((recipe) => recipe.tier === "basic")).toBe(true);
    expect(revealed).toHaveLength(201);
    expect(revealed.map((recipe) => recipe.recipeId))
      .toContain(firstBlueprint.unlockRecipeId);
    expect(revealed.filter((recipe) => recipe.tier === "advanced")).toHaveLength(1);
  });

  it("提供大量生食、半成品和多地貌载具", () => {
    expect(expansionItems.filter((item) => item.category === "raw_food").length)
      .toBeGreaterThanOrEqual(CONTENT_EXPANSION_THRESHOLDS.minimumRawFoodItems);
    expect(expansionItems.filter((item) => item.category === "semi_finished_food").length)
      .toBeGreaterThanOrEqual(
        CONTENT_EXPANSION_THRESHOLDS.minimumSemiFinishedFoodItems,
      );
    const transports = expansionItems.filter((item) => item.category === "transport");
    expect(transports.length)
      .toBeGreaterThanOrEqual(CONTENT_EXPANSION_THRESHOLDS.minimumTransportItems);
    expect(new Set(transports.map((item) => item.transportMode)))
      .toEqual(new Set(["land", "sea", "air"]));
  });

  it("纯函数适配后将完整制造与蓝图并入生存系统", () => {
    const base = validateSurvivalSystemsConfig(survivalSystemsDocument);
    const merged = mergeManufacturingCatalogIntoSurvivalSystems(
      base,
      manufacturingCatalog,
    );
    const validated = validateSurvivalSystemsConfig(merged);
    const firstBlueprint = manufacturingBlueprints[0];
    if (firstBlueprint === undefined) {
      throw new Error("测试要求至少存在一份蓝图。");
    }
    const advancedProject = validated.research.projects.find(
      (project) => project.research_input_item_id === firstBlueprint.blueprintId,
    );
    const registeredCatalogIds = new Set([
      ...base.warehouse.resource_items.map((item) => item.item_id),
      ...base.warehouse.crafted_items.map((item) => item.item_id),
      ...expansionItems.map((item) => item.itemId),
      ...manufacturingBlueprints.map((blueprint) => blueprint.blueprintId),
    ]);
    const synthesizedBarterIds = new Set([
      ...basicManufacturingRecipes,
      ...advancedManufacturingRecipes,
    ].flatMap((recipe) => recipe.costs.flatMap((cost) =>
      cost.kind === "barter" && !registeredCatalogIds.has(cost.resourceId)
        ? [cost.resourceId]
        : [],
    )));

    expect(base.warehouse.crafted_items).toHaveLength(9);
    expect(validated.warehouse.crafted_items).toHaveLength(
      base.warehouse.crafted_items.length
        + expansionItems.length
        + manufacturingBlueprints.length
        + synthesizedBarterIds.size,
    );
    expect(validated.crafting.recipes).toHaveLength(base.crafting.recipes.length + 400);
    expect(validated.research.projects).toHaveLength(base.research.projects.length + 200);
    expect(advancedProject).toMatchObject({
      research_input_item_id: firstBlueprint.blueprintId,
      unlock_recipe_ids: [firstBlueprint.unlockRecipeId],
    });
    const adaptedBasicRecipes = validated.crafting.recipes.filter((recipe) =>
      basicManufacturingRecipes.some((source) => source.recipeId === recipe.recipe_id),
    );
    expect(adaptedBasicRecipes).toHaveLength(200);
    expect(adaptedBasicRecipes.every((recipe) =>
      recipe.required_project_id === null,
    )).toBe(true);
  });
});

describe("扩展开局、避难所与失败内容", () => {
  it("提供 20 特性、10 起源、10 避难所与 8 失败结局", () => {
    expect(traitOptions).toHaveLength(20);
    expect(originOptions).toHaveLength(10);
    expect(shelterTypes).toHaveLength(10);
    expect(failureEndings).toHaveLength(8);
    expect(uniqueCount(traitOptions, (option) => option.id)).toBe(20);
    expect(uniqueCount(originOptions, (option) => option.id)).toBe(10);
    expect(uniqueCount(shelterTypes, (option) => option.id)).toBe(10);
    expect(uniqueCount(failureEndings, (option) => option.id)).toBe(8);
    expect([
      ...traitOptions,
      ...originOptions,
      ...shelterTypes,
      ...failureEndings,
    ].every((option) => STABLE_ID_PATTERN.test(option.id))).toBe(true);
  });

  it("允许至多两个唯一特性，并拒绝重复或互斥组合", () => {
    expect(TRAIT_SELECTION_RULES.maximumSelections).toBe(2);
    expect(validateTraitSelection(
      ["field_medic", "bookworm"],
      contentExpansionCatalog.traits,
      TRAIT_SELECTION_RULES,
    )).toEqual({ valid: true, error: null });
    expect(validateTraitSelection(
      ["field_medic", "field_medic"],
      contentExpansionCatalog.traits,
      TRAIT_SELECTION_RULES,
    )).toMatchObject({ valid: false });
    expect(validateTraitSelection(
      ["hot_blooded", "calm_under_fire"],
      contentExpansionCatalog.traits,
      TRAIT_SELECTION_RULES,
    )).toMatchObject({ valid: false });
    expect(validateTraitSelection(
      ["field_medic", "bookworm", "gardener"],
      contentExpansionCatalog.traits,
      TRAIT_SELECTION_RULES,
    )).toMatchObject({ valid: false });
  });

  it("难度从新手递增到永恒梦魇并完整声明数值", () => {
    expect(difficultyOptions[0]).toMatchObject({
      id: "newcomer",
      label: "新手",
      rank: 1,
    });
    expect(difficultyOptions.at(-1)).toMatchObject({
      id: "eternal_nightmare",
      label: "永恒梦魇",
      rank: 7,
    });
    expect(difficultyOptions.every((option) =>
      Object.values(option.multipliers).every((value) =>
        Number.isInteger(value) && value > 0,
      ),
    )).toBe(true);
    expect(difficultyOptions.map((option) => option.multipliers.enemyDamagePercent))
      .toEqual([60, 80, 100, 115, 140, 175, 220]);
  });

  it("为起源和避难所提供可结算的明确加成", () => {
    expect(originOptions.find((option) => option.id === "municipal_engineer"))
      .toEqual(expect.objectContaining({
        triggeredBonuses: [expect.objectContaining({
          target: "loot.parts",
          minimum: 1,
          maximum: 20,
          chancePercent: 100,
        })],
      }));
    expect(originOptions.every((option) =>
      isNonEmpty(option.startingModifiers) && isNonEmpty(option.triggeredBonuses),
    )).toBe(true);
    expect(shelterTypes.every((option) =>
      isPositive(option.starting_capacity)
      && isPositive(option.innerWallHealth)
      && isPositive(option.outerWallHealth)
      && isNonEmpty(option.bonuses),
    )).toBe(true);
  });

  it("完整目录通过唯一性、数量与引用校验", () => {
    expect(validateContentExpansionCatalog(contentExpansionCatalog))
      .toBe(contentExpansionCatalog);
  });
});
