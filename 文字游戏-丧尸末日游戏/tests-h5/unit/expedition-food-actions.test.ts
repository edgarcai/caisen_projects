import { describe, expect, it } from "vitest";
import type { GameApplication } from "../../src/application";
import { MemoryStorage } from "../../src/infrastructure";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
  resolvePendingExplorationBranch,
} from "../helpers/H5TestHarness";

/** 创建已进入普通求生的隔离测试应用。 */
function startedApplication(): GameApplication {
  const application = buildH5Harness().application;
  application.startNewGame(["白菜"], "single");
  return application;
}

describe("远征食物行动规则", () => {
  it("每携带一份食物提供一次行动，城市和首次区划消耗会真实扣粮", () => {
    const application = startedApplication();
    const state = requireState(application);
    const player = requirePlayer(state);
    const districtId = application.content.city("city_a").default_district_id;
    const foodBefore = player.food;

    const report = application.prepareExpedition(
      "city_a",
      districtId,
      [],
      { food: 5 },
    );

    expect(report.stateChanged).toBe(true);
    expect(report.messages.join("\n")).toContain("携带食物");
    expect(report.messages.join("\n")).not.toContain("步数");
    expect(requirePlayer(state).food).toBe(foodBefore - 5);
    expect(state.expedition?.maximum_steps).toBe(5);
    expect(state.expedition?.remaining_steps).toBe(3);
    expect(state.expedition?.carried_items.food).toBe(3);
    expect(application.expeditionStatus()).toMatchObject({
      maximumSteps: 5,
      remainingSteps: 3,
    });
  });

  it("伙伴、研发与其他携带物不再生成免费行动", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.inventory.crafted_items.signal_beacon = 1;
    state.research.completed_project_ids.push("field_logistics", "signal_navigation");
    const districtId = application.content.city("city_a").default_district_id;

    application.prepareExpedition(
      "city_a",
      districtId,
      ["yangguan"],
      { food: 5, signal_beacon: 1 },
    );

    expect(state.expedition?.maximum_steps).toBe(5);
    expect(application.expeditionStatus()?.maximumSteps).toBe(5);
  });

  it("食物不足下一次区划行动时强制返程并结算80%损失", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.inventory.crafted_items.field_ration = 5;

    application.prepareExpedition(
      "city_a",
      "city_a_district_c",
      [],
      { food: 4, field_ration: 5 },
    );
    resolvePendingExplorationBranch(application);
    expect(application.expeditionStatus()?.remainingSteps).toBe(1);

    const report = application.continueExpedition();
    const failure = state.last_expedition_failure;

    expect(report.stateChanged).toBe(true);
    expect(report.messages.join("\n")).toContain("携带食物");
    expect(state.expedition).toBeNull();
    expect(failure?.kept_percent).toBe(20);
    expect(failure?.items).toContainEqual(expect.objectContaining({
      item_id: "field_ration",
      original_quantity: 5,
      kept_quantity: 1,
      lost_quantity: 4,
    }));
    expect(requirePlayer(state).health).toBeGreaterThanOrEqual(7);
    expect(requirePlayer(state).health).toBeLessThanOrEqual(45);
  });

  it("v8 进行中远征可直接读取，旧额度按真实携粮收敛", () => {
    const storage = new MemoryStorage();
    const source = buildH5Harness({ storage }).application;
    source.startNewGame(["白菜"], "single");
    const state = requireState(source);
    state.expedition = {
      city_id: "city_a",
      district_id: "city_a_district_a",
      travel_step_cost: 1,
      leader_player_index: 0,
      companion_ids: [],
      carried_items: { food: 2 },
      loot: {},
      remaining_steps: 9,
      maximum_steps: 10,
      events_resolved: 1,
    };
    source.saveGame();

    const restored = buildH5Harness({ storage }).application;
    const load = restored.loadGame();

    expect(load.stateChanged).toBe(true);
    expect(restored.expeditionStatus()?.remainingSteps).toBe(2);
    expect(requireState(restored).expedition?.remaining_steps).toBe(9);
  });
});
