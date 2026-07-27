import { describe, expect, it } from "vitest";
import migrationDocument from "../../config/save_migrations/v8_to_v9.json";
import type { V8ToV9SaveMigrationConfig } from "../../src/domain/content";
import type { GameState } from "../../src/domain/game-state";
import { manufacturingBlueprints } from "../../src/config/contentExpansion";
import { V8ToV9SaveMigrator } from "../../src/infrastructure";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
  ScriptedRandomSource,
} from "../helpers/H5TestHarness";

const migration: V8ToV9SaveMigrationConfig = migrationDocument;

/** 启动一局可以控制风险和产出随机数的测试游戏。 */
function startedGame(integers: readonly number[] = [90]) {
  const harness = buildH5Harness({
    random: new ScriptedRandomSource(integers),
  });
  harness.application.startNewGame(["研究所长"], "single");
  return harness;
}

/** 从当前 v9 聚合移除研究槽与墙体分项，构造真实 v8 输入。 */
function downgradeToV8(state: GameState): Record<string, unknown> {
  const raw = structuredClone(state) as unknown as Record<string, unknown>;
  const downgrade = (restorable: Record<string, unknown>): void => {
    const shelter = restorable.shelter as Record<string, unknown>;
    delete shelter.inner_wall_health;
    delete shelter.outer_wall_health;
    const research = restorable.research as Record<string, unknown>;
    delete research.slotted_item_id;
  };
  downgrade(raw);
  const checkpoint = raw.checkpoint as Record<string, unknown> | null;
  if (checkpoint !== null) downgrade(checkpoint.snapshot as Record<string, unknown>);
  return raw;
}

describe("v9 研究台、配方出处与高级制造", () => {
  it("新开局展示全部基础配方并隐藏未研究高级配方", () => {
    const { application } = startedGame();
    const recipes = application.craftingRecipes();

    expect(recipes).toHaveLength(200);
    expect(recipes.every((recipe) =>
      recipe.recipeId.startsWith("basic_recipe_"),
    )).toBe(true);
  });

  it("研究物可持久放入单槽，研究后显示对应配方", () => {
    const { application } = startedGame();
    const state = requireState(application);
    const player = requirePlayer(state);
    state.shelter.books = 1;
    state.archive_collection_totals.books = 1;
    player.parts = 8;
    player.coins = 4;

    const project = application.researchProjects().find(
      (candidate) => candidate.projectId === "field_logistics",
    );
    expect(project).toMatchObject({
      requiredItemId: "books",
      sourceDescription: "A市·C区",
      slotted: false,
      available: false,
    });
    expect(application.craftingRecipes()).toHaveLength(200);

    expect(application.slotResearchItem("books").stateChanged).toBe(true);
    expect(application.researchWorkbench()).toMatchObject({
      slotCount: 1,
      slottedItemId: "books",
      slottedItemName: "旧书",
    });
    expect(application.researchProjects().find(
      (candidate) => candidate.projectId === "field_logistics",
    )).toMatchObject({ slotted: true, available: true });

    application.saveGame();
    state.research.slotted_item_id = null;
    application.loadGame();
    const loadedState = requireState(application);
    expect(loadedState.research.slotted_item_id).toBe("books");

    const report = application.completeResearch("field_logistics");
    expect(report.stateChanged).toBe(true);
    expect(loadedState.research.completed_project_ids).toContain("field_logistics");
    expect(loadedState.research.slotted_item_id).toBeNull();
    expect(loadedState.shelter.books).toBe(0);
    expect(requirePlayer(loadedState).parts).toBe(0);
    expect(requirePlayer(loadedState).coins).toBe(0);
    expect(application.craftingRecipes()).toContainEqual(expect.objectContaining({
      recipeId: "field_ration",
      blueprintSourceDescription: "A市·C区",
    }));
  });

  it("高级蓝图在真实应用链研究完成后只解锁对应配方", () => {
    const { application } = startedGame();
    const state = requireState(application);
    const player = requirePlayer(state);
    const blueprint = manufacturingBlueprints[0];
    if (blueprint === undefined) throw new Error("测试缺少高级蓝图。");
    const project = application.researchProjects().find(
      (candidate) => candidate.requiredItemId === blueprint.blueprintId,
    );
    if (project === undefined) throw new Error("高级蓝图未注册为研究项。");
    state.inventory.crafted_items[blueprint.blueprintId] = 1;
    player.coins = 1_000_000;
    player.parts = 1_000_000;

    expect(application.slotResearchItem(blueprint.blueprintId).stateChanged).toBe(true);
    expect(application.completeResearch(project.projectId).stateChanged).toBe(true);

    const visibleRecipes = application.craftingRecipes();
    expect(visibleRecipes).toHaveLength(201);
    expect(visibleRecipes).toContainEqual(expect.objectContaining({
      recipeId: blueprint.unlockRecipeId,
      unlocked: true,
    }));
  });
});

describe("v9 工作循环与周末交易日程", () => {
  it("工作按配置次数循环并合并推进回合", () => {
    const { application } = startedGame([90, 7, 100, 8, 100, 9, 100]);
    const state = requireState(application);
    const partsBefore = requirePlayer(state).parts;

    const report = application.performManagement("job", "sort_salvage", 3);

    expect(report.stateChanged).toBe(true);
    expect(state.turn_number).toBe(6);
    expect(requirePlayer(state).parts).toBe(partsBefore + 24);
    const snapshot = structuredClone(state);
    expect(application.performManagement("job", "sort_salvage", 4).stateChanged)
      .toBe(false);
    expect(state).toEqual(snapshot);
  });

  it("只允许周五、周六每周成交一次，成交后推进两天", () => {
    const { application } = startedGame([90, 100]);
    const state = requireState(application);
    requirePlayer(state).coins = 1_000;

    expect(application.performManagement("trade_buy", "caravan_food").stateChanged)
      .toBe(false);
    state.clock = { year: 2166, month: 1, day: 3, hour: 6 };
    state.survival_days = 2;

    const report = application.performManagement("trade_buy", "caravan_food");

    expect(report.stateChanged).toBe(true);
    expect(state.clock).toEqual({ year: 2166, month: 1, day: 5, hour: 6 });
    expect(state.survival_days).toBe(4);
    expect(state.turn_number).toBe(24);
    expect(state.management_cycle_usage.weekly_trade).toEqual({
      cycle_index: 0,
      count: 1,
    });
  });
});

describe("v9 内外墙职责与升级预览", () => {
  it("避难所维护只修内墙，外墙巡逻只修外墙", () => {
    const { application } = startedGame([90, 0, 10, 100]);
    const state = requireState(application);
    const player = requirePlayer(state);
    state.shelter.inner_wall_health = 50;
    state.shelter.outer_wall_health = 40;
    state.shelter.health = 90;
    player.parts = 100;

    expect(application.performAction("repair_shelter").stateChanged).toBe(true);
    const afterMaintenance = application.shelterWallStatus();
    expect(afterMaintenance.innerWallHealth).toBeGreaterThan(50);
    expect(afterMaintenance.outerWallHealth).toBe(39);

    expect(application.performManagement("job", "wall_patrol").stateChanged).toBe(true);
    const afterPatrol = application.shelterWallStatus();
    expect(afterPatrol.innerWallHealth).toBe(afterMaintenance.innerWallHealth);
    expect(afterPatrol.outerWallHealth).toBeGreaterThan(afterMaintenance.outerWallHealth);
    expect(afterPatrol.totalHealth).toBe(
      afterPatrol.innerWallHealth + afterPatrol.outerWallHealth,
    );
  });

  it("设施详情明确展示下一级能力", () => {
    const { application } = startedGame();
    const option = application.managementOptions().find(
      (candidate) => candidate.category === "facility"
        && candidate.optionId === "outer_wall",
    );
    expect(option?.description).toContain("升级后");
    const upgradeBenefit = option?.fields.find(
      (field) => field.id === "upgrade-benefit",
    );
    expect(upgradeBenefit?.value).toContain("外墙耐久");
  });
});

describe("v8 到 v9 存档迁移", () => {
  it("同步迁移当前状态与检查点，并严格保留总耐久", () => {
    const { application } = startedGame();
    const state = requireState(application);
    state.shelter.health = 261;
    const snapshot = structuredClone(state) as unknown as Record<string, unknown>;
    delete snapshot.checkpoint;
    state.checkpoint = {
      survival_day: 10,
      created_turn: 0,
      snapshot: snapshot as never,
    };
    const source = downgradeToV8(state);
    const sourceBefore = structuredClone(source);

    const document = new V8ToV9SaveMigrator(migration).migrate({
      schema_version: 8,
      saved_at: "2166-01-10T06:00:00.000Z",
      game_state: source,
    });
    const migrated = document.game_state as Record<string, unknown>;
    const shelter = migrated.shelter as Record<string, unknown>;
    const research = migrated.research as Record<string, unknown>;
    const checkpoint = migrated.checkpoint as Record<string, unknown>;
    const checkpointShelter = (
      checkpoint.snapshot as Record<string, unknown>
    ).shelter as Record<string, unknown>;

    expect(source).toEqual(sourceBefore);
    expect(document.schema_version).toBe(9);
    expect(shelter).toMatchObject({
      health: 261,
      inner_wall_health: 130,
      outer_wall_health: 131,
    });
    expect(research.slotted_item_id).toBeNull();
    expect(checkpointShelter).toMatchObject({
      inner_wall_health: 130,
      outer_wall_health: 131,
    });
  });

  it("拒绝错误版本链与非整数墙体分配", () => {
    expect(() => new V8ToV9SaveMigrator({
      ...migration,
      to_version: 10,
    })).toThrow("版本链无效");
    expect(() => new V8ToV9SaveMigrator({
      ...migration,
      wall_distribution: { inner_wall_percent: 50.5 },
    })).toThrow("0 到 100 的整数");
  });
});
