import { describe, expect, it } from "vitest";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";

describe("探索内容扩展接线", () => {
  it("通过应用用例结算探索时会执行区划出处发现", () => {
    const { application } = buildH5Harness();
    application.startNewGame(["发现接线员"], "single");
    const state = requireState(application);
    requirePlayer(state).food = 20;
    const city = application.content.city("city_a");
    const district = application.content.district(city.id, city.default_district_id);
    application.prepareExpedition(city.id, district.id, [], { food: 10 });
    const pending = state.pending_exploration;
    if (pending === null) throw new Error("测试要求探索事件已锁定。");
    const beforeItems = { ...state.inventory.crafted_items };

    let report = application.resolveExplorationBranch(
      application.explorationBranchPrompt()?.choices.find(
        (choice) => application.explorationBranchChoiceAvailable(choice.id),
      )?.id ?? "missing_choice",
    );
    while (state.pending_exploration !== null) {
      const choice = application.explorationBranchPrompt()?.choices.find(
        (candidate) => application.explorationBranchChoiceAvailable(candidate.id),
      );
      if (choice === undefined) throw new Error("探索分支没有可执行选项。");
      report = application.resolveExplorationBranch(choice.id);
    }

    expect(report.stateChanged).toBe(true);
    expect(report.messages.some((message) => message.includes("出处一致"))).toBe(true);
    expect(Object.entries(state.inventory.crafted_items).some(
      ([itemId, quantity]) => quantity > (beforeItems[itemId] ?? 0),
    )).toBe(true);
  });
});
