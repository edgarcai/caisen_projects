import { describe, expect, it } from "vitest";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";

describe("设施主动使用", () => {
  it("工作、购买、贩卖、设施使用与升级分别进入独立分类", () => {
    const { application, adapter } = buildH5Harness();
    application.startNewGame(["分类测试员"], "single");

    const categories = adapter.getSnapshot().managementCategories;

    expect(categories.map((category) => category.id)).toEqual(expect.arrayContaining([
      "work",
      "trade_buy",
      "trade_sell",
      "facility_use",
      "upgrade",
    ]));
    const managementOptions = application.managementOptions();
    const jobIds = new Set(managementOptions
      .filter((option) => option.category === "job")
      .map((option) => option.optionId));
    const facilityUseIds = new Set(managementOptions
      .filter((option) => option.category === "facility_use")
      .map((option) => option.optionId));
    expect(categories.find((category) => category.id === "work")?.options.every(
      (option) => jobIds.has(option.id.split("::").at(-1) ?? ""),
    )).toBe(true);
    expect(categories.find((category) => category.id === "facility_use")?.options.every(
      (option) => facilityUseIds.has(option.id.split("::").at(-1) ?? ""),
    )).toBe(true);
  });

  it("未建设的设施会显示等级需求且不会消耗资源", () => {
    const { application } = buildH5Harness();
    application.startNewGame(["设施测试员"], "single");
    const state = requireState(application);
    const before = structuredClone(state);
    const option = application.managementOptions().find(
      (candidate) => candidate.category === "facility_use"
        && candidate.optionId === "field_kitchen_meal",
    );

    expect(option?.available).toBe(false);
    expect(option?.requirements.some(
      (requirement) => !requirement.met && requirement.id.endsWith("-level"),
    )).toBe(true);
    expect(application.performManagement(
      "facility_use",
      "field_kitchen_meal",
    ).stateChanged).toBe(false);
    expect(state).toEqual(before);
  });

  it("设施建成后会按配置消耗物资并应用实际功能", () => {
    const { application } = buildH5Harness();
    application.startNewGame(["设施测试员"], "single");
    const state = requireState(application);
    const player = requirePlayer(state);
    state.facility_levels.field_kitchen = 1;
    player.food = 10;
    player.hunger = 80;
    const beforeTurn = state.turn_number;

    const report = application.performManagement(
      "facility_use",
      "field_kitchen_meal",
    );

    expect(report.stateChanged).toBe(true);
    expect(requirePlayer(state).food).toBeLessThan(10);
    expect(requirePlayer(state).hunger).toBeLessThan(80);
    expect(state.turn_number).toBeGreaterThan(beforeTurn);
    expect(report.messages.join("\n")).toContain("厨房升起久违的热气");
  });
});
