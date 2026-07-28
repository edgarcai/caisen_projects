import { describe, expect, it } from "vitest";
import { cloneGameState } from "../../src/domain/game-state";
import {
  ProfileTriggeredBonusService,
} from "../../src/services/ProfileTriggeredBonusService";
import { StateOperations } from "../../src/services/StateOperations";
import { buildH5Harness, requirePlayer, requireState, ScriptedRandomSource } from "../helpers/H5TestHarness";

describe("起源与特性触发加成", () => {
  it("市政工程师在探索获得零件时额外增加 1 到 20 个零件", () => {
    const { application } = buildH5Harness();
    application.startNewGame(["加成测试员"], "single");
    const state = requireState(application);
    state.campaign.origin_id = "municipal_engineer";
    const before = cloneGameState(state);
    requirePlayer(state).parts += 3;
    const random = new ScriptedRandomSource([1, 12]);
    const service = new ProfileTriggeredBonusService(
      {
        secondaryTraitFlagPrefix: "campaign_profile::secondary_trait::",
        triggerObservationTargets: { search_parts: ["player.parts"] },
        rewardStateTargets: { "loot.parts": "player.parts" },
        activatedText: "{profile_name}额外获得{amount}：{description}",
      },
      [{
        type: "origin",
        id: "municipal_engineer",
        name: "市政工程师",
        bonuses: [{
          triggerId: "search_parts",
          target: "loot.parts",
          minimum: 1,
          maximum: 20,
          chancePercent: 100,
          description: "搜索到零件时额外增加 1~20 个零件。",
        }],
      }],
      new StateOperations(random),
      random,
    );

    const messages = service.applyExplorationBonuses(before, state);

    expect(requirePlayer(state).parts - requirePlayer(before).parts).toBe(15);
    expect(messages[0]).toContain("市政工程师");
    expect(messages[0]).toContain("12");
  });
});
