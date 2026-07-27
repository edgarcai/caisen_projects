import { describe, expect, it } from "vitest";
import survivalSystemsDocument from "../../config/survival_systems.json";
import type { GameApplication } from "../../src/application";
import type { GameMode } from "../../src/domain/game-state";
import {
  CampaignDifficultyRules,
  ExplorationService,
  StateOperations,
} from "../../src/services";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
  ScriptedRandomSource,
  type H5TestHarness,
} from "../helpers/H5TestHarness";

/** 以指定难度和可复现随机序列启动真实 H5 应用。 */
function startDifficulty(
  difficultyId: string,
  mode: GameMode = "single",
  integers: readonly number[] = [],
): H5TestHarness {
  const harness = buildH5Harness({
    random: new ScriptedRandomSource(integers),
  });
  const slot = harness.application.saveSlots()[0];
  if (slot === undefined) throw new Error("难度测试需要至少一个存档槽。");
  const profile = harness.application.content.game.campaign_profiles.migration_default;
  harness.application.startNewGame({
    mode,
    playerNames: ["难度测试员"],
    saveSlotId: slot.slotId,
    profile: {
      ...structuredClone(profile),
      difficulty_id: difficultyId,
    },
  });
  return harness;
}

/** 从仓库物品类别构建与生产装配一致的难度规则。 */
function difficultyRules(application: GameApplication): CampaignDifficultyRules {
  const resources = survivalSystemsDocument.warehouse.resource_items;
  return new CampaignDifficultyRules(application.content, {
    common: resources
      .filter((item) => item.category !== "archive")
      .map((item) => item.state_target),
    text: resources
      .filter((item) => item.category === "archive")
      .map((item) => item.state_target),
  });
}

/** 设置真实剧情前置并进入铁路屠夫首领战。 */
function startRailButcherBattle(application: GameApplication): void {
  const state = requireState(application);
  state.story.current_scene_id = "rail_butcher";
  state.story.completed_scene_ids.push("doctor_in_the_rain");
  requirePlayer(state).parts = 20;
  application.resolveStoryChoice("rail_butcher", "overload_rail");
}

describe("难度倍率行为接线", () => {
  it("探索只缩放正向普通与文本掉落", () => {
    const { application } = startDifficulty("newcomer");
    const state = requireState(application);
    const rules = difficultyRules(application);
    expect(rules.snapshot(state)).toMatchObject({
      commonLootPercent: 165,
      textLootPercent: 180,
    });
    const random = new ScriptedRandomSource([5, 3], [2]);
    const exploration = new ExplorationService(
      application.content,
      new StateOperations(random),
      random,
      rules,
    );
    const partsBefore = requirePlayer(state).parts;
    const newspapersBefore = state.shelter.newspapers;

    const result = exploration.resolve("bank", null, state);

    expect(result).toMatchObject({ applied: true });
    expect(requirePlayer(state).parts - partsBefore).toBe(3);
    expect(state.shelter.newspapers - newspapersBefore).toBe(5);
    expect(result.message).toContain("5份灾变报纸");
    expect(result.message).toContain("3个门禁零件");
  });

  it("首领生命与反击伤害随难度同步变化", () => {
    const newcomer = startDifficulty("newcomer", "story", [90, 100, 100]);
    const nightmare = startDifficulty("eternal_nightmare", "story", [90, 100, 100]);
    startRailButcherBattle(newcomer.application);
    startRailButcherBattle(nightmare.application);
    const newcomerState = requireState(newcomer.application);
    const nightmareState = requireState(nightmare.application);

    expect(newcomerState.battle).toMatchObject({ max_health: 117, health: 81 });
    expect(nightmareState.battle).toMatchObject({ max_health: 414, health: 289 });
    const newcomerHealth = requirePlayer(newcomerState).health;
    const nightmareHealth = requirePlayer(nightmareState).health;

    newcomer.application.performCombatAction("guard");
    nightmare.application.performCombatAction("guard");

    const newcomerDamage = newcomerHealth - requirePlayer(newcomerState).health;
    const nightmareDamage = nightmareHealth - requirePlayer(nightmareState).health;
    expect(newcomerDamage).toBeGreaterThan(0);
    expect(nightmareDamage).toBeGreaterThan(newcomerDamage);
  });

  it("研究与交易读取同一份高难度经济投影", () => {
    const buyer = startDifficulty("eternal_nightmare", "single", [90, 100]);
    const state = requireState(buyer.application);
    const player = requirePlayer(state);
    state.shelter.books = 1;
    state.archive_collection_totals.books = 1;
    player.parts = 16;
    player.coins = 8;
    expect(buyer.application.researchProjects().find(
      (project) => project.projectId === "field_logistics",
    )?.costDescription).toBe("通用零件×16、旧金币×8");
    expect(buyer.application.slotResearchItem("books").stateChanged).toBe(true);
    expect(buyer.application.completeResearch("field_logistics").stateChanged).toBe(true);
    expect(requirePlayer(state).parts).toBe(0);
    expect(requirePlayer(state).coins).toBe(0);

    state.clock = { year: 2166, month: 1, day: 3, hour: 6 };
    state.survival_days = 2;
    requirePlayer(state).coins = 100;
    expect(buyer.application.performManagement("trade_buy", "caravan_food").stateChanged)
      .toBe(true);
    expect(requirePlayer(state).coins).toBe(68);

    const seller = startDifficulty("eternal_nightmare", "single", [90, 100]);
    const sellerState = requireState(seller.application);
    const sellerPlayer = requirePlayer(sellerState);
    sellerState.clock = { year: 2166, month: 1, day: 3, hour: 6 };
    sellerState.survival_days = 2;
    sellerPlayer.food = 10;
    sellerPlayer.coins = 0;
    expect(seller.application.performManagement("trade_sell", "caravan_food").stateChanged)
      .toBe(true);
    expect(requirePlayer(sellerState).coins).toBe(5);
  });

  it("希望损失使用专属倍率而不重复叠加通用生存倍率", () => {
    const newcomer = startDifficulty("newcomer", "single", [90, 7, 100]);
    const nightmare = startDifficulty("eternal_nightmare", "single", [90, 7, 100]);
    const newcomerState = requireState(newcomer.application);
    const nightmareState = requireState(nightmare.application);
    const newcomerHope = newcomerState.shelter.hope;
    const nightmareHope = nightmareState.shelter.hope;

    newcomer.application.performManagement("job", "sort_salvage");
    nightmare.application.performManagement("job", "sort_salvage");

    expect(newcomerHope - newcomerState.shelter.hope).toBe(2);
    expect(nightmareHope - nightmareState.shelter.hope).toBe(4);
  });
});
