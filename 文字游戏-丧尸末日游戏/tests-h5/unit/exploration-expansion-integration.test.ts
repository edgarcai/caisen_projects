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
    const prompt = application.prepareExploration("city_a");
    const pending = state.pending_exploration;
    if (pending === null) throw new Error("测试要求探索事件已锁定。");
    const event = application.content.event(prompt.eventId);
    const choiceId = event.choices?.find(
      (choice) => (choice.requirements ?? []).length === 0,
    )?.id ?? null;
    const beforeItems = { ...state.inventory.crafted_items };

    const report = application.resolveExploration(prompt.eventId, choiceId);

    expect(report.stateChanged).toBe(true);
    expect(report.messages.some((message) => message.includes("出处一致"))).toBe(true);
    expect(Object.entries(state.inventory.crafted_items).some(
      ([itemId, quantity]) => quantity > (beforeItems[itemId] ?? 0),
    )).toBe(true);
  });
});
