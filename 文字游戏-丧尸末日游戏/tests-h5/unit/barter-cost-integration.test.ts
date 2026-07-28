import { describe, expect, it } from "vitest";
import survivalSystemsDocument from "../../config/survival_systems.json";
import {
  manufacturingCatalog,
  mergeManufacturingCatalogIntoSurvivalSystems,
} from "../../src/config/contentExpansion";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type { SurvivalSystemsConfigDocument } from "../../src/domain/survival-systems";
import {
  CampaignDifficultyRules,
  ResearchCraftingService,
  StateOperations,
} from "../../src/services";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
  ScriptedRandomSource,
} from "../helpers/H5TestHarness";

/** 返回已经过扩展适配与启动校验的生存系统配置。 */
function expandedSurvivalSystems(): SurvivalSystemsConfigDocument {
  const base = validateSurvivalSystemsConfig(survivalSystemsDocument);
  return validateSurvivalSystemsConfig(
    mergeManufacturingCatalogIntoSurvivalSystems(base, manufacturingCatalog),
  );
}

/** 启动一局可直接验证制造事务的测试游戏。 */
function startedGame() {
  const harness = buildH5Harness();
  harness.application.startNewGame(["以物易物测试"], "single");
  return harness;
}

describe("以物易物成本适配", () => {
  it("完整保留全部扩展配方的以物易物条目并注册仓库物品", () => {
    const config = expandedSurvivalSystems();
    const recipeById = new Map(
      config.crafting.recipes.map((recipe) => [recipe.recipe_id, recipe]),
    );
    const warehouseIds = new Set([
      ...config.warehouse.resource_items,
      ...config.warehouse.crafted_items,
    ].map((item) => item.item_id));
    let expectedBarterCosts = 0;
    let adaptedBarterCosts = 0;

    for (const source of [
      ...manufacturingCatalog.basicRecipes,
      ...manufacturingCatalog.advancedRecipes,
    ]) {
      const adapted = recipeById.get(source.recipeId);
      expect(adapted).toBeDefined();
      for (const cost of source.costs) {
        if (cost.kind !== "barter") continue;
        expectedBarterCosts += 1;
        const projected = adapted?.costs.find(
          (candidate) => "item_id" in candidate
            && candidate.item_id === cost.resourceId,
        );
        expect(projected).toEqual({
          item_id: cost.resourceId,
          amount: cost.quantity,
        });
        expect(warehouseIds.has(cost.resourceId)).toBe(true);
        adaptedBarterCosts += projected === undefined ? 0 : 1;
      }
    }

    expect(expectedBarterCosts).toBeGreaterThan(0);
    expect(adaptedBarterCosts).toBe(expectedBarterCosts);
  });

  it("缺少交换物时不改状态，齐备后同时扣除金币和仓库物品", () => {
    const { application } = startedGame();
    const state = requireState(application);
    const player = requirePlayer(state);
    const recipeId = "basic_recipe_wild_tuber_rough";
    const outputItemId = "basic_wild_tuber_rough";
    state.research.completed_project_ids.push("field_logistics");
    player.coins = 10;
    const before = structuredClone(state);

    expect(application.craftingRecipes().find(
      (recipe) => recipe.recipeId === recipeId,
    )).toMatchObject({
      available: false,
      costDescription: "旧金币×1、洁净水×1",
    });
    expect(application.craftItem(recipeId).stateChanged).toBe(false);
    expect(state).toEqual(before);

    state.inventory.crafted_items.clean_water = 1;
    expect(application.craftItem(recipeId).stateChanged).toBe(true);
    expect(requirePlayer(state).coins).toBe(9);
    expect(state.inventory.crafted_items.clean_water).toBeUndefined();
    expect(state.inventory.crafted_items[outputItemId]).toBe(3);
  });

  it("研究项目也会预留研究样本并原子扣除交换物", () => {
    const baseConfig = expandedSurvivalSystems();
    const config = validateSurvivalSystemsConfig({
      ...baseConfig,
      research: {
        ...baseConfig.research,
        projects: baseConfig.research.projects.map((project) =>
          project.project_id === "field_logistics"
            ? {
                ...project,
                costs: [...project.costs, { item_id: "clean_water", amount: 1 }],
              }
            : project,
        ),
      },
    });
    const { application } = startedGame();
    const state = requireState(application);
    const player = requirePlayer(state);
    const service = new ResearchCraftingService(
      config,
      new StateOperations(new ScriptedRandomSource()),
      application.content,
      new CampaignDifficultyRules(application.content, {
        common: config.warehouse.resource_items
          .filter((item) => item.category !== "archive")
          .map((item) => item.state_target),
        text: config.warehouse.resource_items
          .filter((item) => item.category === "archive")
          .map((item) => item.state_target),
      }),
    );
    state.shelter.books = 1;
    player.parts = 8;
    player.coins = 4;
    expect(service.slotResearchItem(state, "books").applied).toBe(true);
    const before = structuredClone(state);

    expect(service.researchProjects(state).find(
      (project) => project.projectId === "field_logistics",
    )?.costDescription).toContain("洁净水×1");
    expect(service.completeResearch(state, "field_logistics").applied).toBe(false);
    expect(state).toEqual(before);

    state.inventory.crafted_items.clean_water = 1;
    expect(service.completeResearch(state, "field_logistics").applied).toBe(true);
    expect(state.inventory.crafted_items.clean_water).toBeUndefined();
    expect(state.shelter.books).toBe(0);
    expect(requirePlayer(state).parts).toBe(0);
    expect(requirePlayer(state).coins).toBe(0);
  });
});
