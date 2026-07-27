import gameDocument from "../../config/game_config.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import { describe, expect, it } from "vitest";
import type { GameApplication } from "../../src/application";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type { GameConfigDocument } from "../../src/domain/content";
import { buildH5Harness, requirePlayer, requireState, ScriptedRandomSource } from "../helpers/H5TestHarness";

const game = gameDocument as unknown as GameConfigDocument;

/** 启动一局可预测寿命与后续随机的单人游戏。 */
function startedApplication(integers: readonly number[] = [90]): GameApplication {
  const application = buildH5Harness({
    random: new ScriptedRandomSource(integers),
  }).application;
  application.startNewGame(["测试所长"], "single");
  return application;
}

describe("v6 希望、寿命与模式规则", () => {
  it("用注入随机源抽取寿命，并提供可落地的无尽求生模式", () => {
    const application = buildH5Harness({
      random: new ScriptedRandomSource([120]),
    }).application;

    application.startNewGame(["无尽所长"], "endless");
    const state = requireState(application);

    expect(requirePlayer(state).lifespan).toBe(120);
    expect(requirePlayer(state).age).toBe(game.defaults.player.age);
    expect(application.supportsCapability("endless_survival")).toBe(true);
    expect(game.rules.player_counts.endless).toEqual({ minimum: 1, maximum: 1 });
    expect(game.rules.mode_survival_cost_percent.endless).toBe(115);
    expect(game.campaign_profiles.origins).toHaveLength(5);
    expect(new Set(game.campaign_profiles.origins.map((origin) => origin.id)).size).toBe(5);
    expect(Object.keys(game.rules.player_counts).sort()).toEqual([
      "endless",
      "multiplayer",
      "single",
      "story",
    ]);
  });

  it("寿命随机包含70与120两端，并为双人所长分别抽取", () => {
    const random = new ScriptedRandomSource([70, 120]);
    const application = buildH5Harness({ random }).application;

    application.startNewGame(["甲", "乙"], "multiplayer");

    expect(requireState(application).players.map((player) => player.lifespan))
      .toEqual([70, 120]);
    expect(random.integerCalls).toBe(2);
  });

  it("希望按配置逐回合下降并在归零时失败", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.shelter.hope = game.rules.turn_costs.hope_loss;
    requirePlayer(state).hunger = 10;

    const report = application.performAction("use_food");

    expect(report.gameOver).toBe(true);
    expect(state.shelter.hope).toBe(0);
    expect(state.ending?.ending_id).toBe("last_hope_extinguished");
  });

  it("跨年时增加年龄并在到达寿命后生成失败结局", () => {
    const application = startedApplication([70]);
    const state = requireState(application);
    const player = requirePlayer(state);
    player.age = 69;
    player.lifespan = 70;
    player.hunger = 10;
    state.clock = { year: 2166, month: 12, day: 31, hour: 17 };

    const report = application.performAction("use_food");

    expect(report.gameOver).toBe(true);
    expect(requirePlayer(state).age).toBe(70);
    expect(state.ending?.ending_id).toBe("natural_lifespan_ended");
  });
});

describe("v6 伙伴管理与避难所活动", () => {
  it("返回立绘档案，并原子结算伙伴配装与互动冷却", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.inventory.crafted_items.pipe_rifle = 1;
    const profile = application.companionManagementViews().find(
      (companion) => companion.companionId === "haocai",
    );

    expect(profile).toMatchObject({
      portraitKey: "companion_haocai",
      interactionCooldownTurns: 0,
    });
    expect(profile?.introduction.length).toBeGreaterThan(0);
    expect(application.companionEquipmentOptions("haocai", "weapon"))
      .toContainEqual(expect.objectContaining({
        itemId: "pipe_rifle",
        available: true,
      }));

    application.equipCompanion("haocai", "weapon", "pipe_rifle");
    const hopeBefore = state.shelter.hope;
    const interaction = application.interactWithCompanion(
      "haocai",
      "quiet_conversation",
    );
    const companion = state.companions.find(
      (candidate) => candidate.companion_id === "haocai",
    );

    expect(interaction.stateChanged).toBe(true);
    expect(companion).toMatchObject({
      equipped_weapon_id: "pipe_rifle",
      trust: 1,
      interaction_cooldown_turns: 2,
      interaction_count: 1,
    });
    expect(state.shelter.hope).toBe(hopeBefore + 3 - game.rules.turn_costs.hope_loss);
    expect(application.companionInteractionOptions("haocai")[0]).toMatchObject({
      available: false,
      cooldownTurns: 2,
    });
    expect(application.warehouseItems().map((item) => item.itemId))
      .not.toContain("pipe_rifle");
  });

  it("活动作为独立经营类别支付成本、提升希望并消耗配置回合", () => {
    const application = startedApplication();
    const state = requireState(application);
    const player = requirePlayer(state);
    player.food = 10;
    state.shelter.hope = 40;

    const option = application.managementOptions().find(
      (candidate) => candidate.category === "activity"
        && candidate.optionId === "shared_supper",
    );
    const report = application.performManagement("activity", "shared_supper");

    expect(option?.available).toBe(true);
    expect(report.stateChanged).toBe(true);
    expect(requirePlayer(state).food).toBe(4);
    expect(state.turn_number).toBe(2);
    expect(state.shelter.hope).toBe(47);
  });
});

describe("v6 远征步数与强制返程", () => {
  it("基础步数为10，谨慎周密使最大步数减一", () => {
    const application = startedApplication();
    application.prepareExpedition("city_a", "city_a_district_a", [], {});

    expect(survivalSystemsDocument.expedition.base_steps).toBe(10);
    expect(game.campaign_profiles.traits.find((trait) => trait.id === "meticulous"))
      .toMatchObject({ expedition_step_bonus: -1 });
    expect(application.expeditionStatus()?.maximumSteps).toBe(9);
  });

  it("拒绝会导致运行态与存档契约不一致的小数返程比例", () => {
    const invalid = structuredClone(survivalSystemsDocument);
    invalid.expedition.forced_return_keep_percent = 20.5;

    expect(() => validateSurvivalSystemsConfig(invalid)).toThrow("必须是不小于 0 的整数");
  });

  it("强制返程按携带物与战利品分行标注损失，且不会使低血量回升", () => {
    const application = startedApplication([90, 45]);
    const state = requireState(application);
    const player = requirePlayer(state);
    player.food = 12;
    application.prepareExpedition(
      "city_a",
      "city_a_district_a",
      [],
      { food: 5 },
    );
    if (state.expedition === null || state.pending_exploration === null) {
      throw new Error("测试要求已开始远征。");
    }
    state.expedition.remaining_steps = 0;
    state.expedition.loot.food = 5;
    state.pending_exploration.event_id = "quiet_street";
    requirePlayer(state).health = 3;

    const report = application.resolveExploration("quiet_street");
    const failure = application.lastExpeditionFailure();

    expect(report.messages.join("\n")).toContain("步数耗尽");
    expect(requirePlayer(state).health).toBe(3);
    expect(failure).toMatchObject({
      reason: "steps_exhausted",
      health_before: 3,
      health_after: 3,
      total_original: 10,
      total_kept: 2,
      total_lost: 8,
    });
    expect(failure?.items).toEqual([
      expect.objectContaining({
        source: "carried",
        item_id: "food",
        original_quantity: 5,
        kept_quantity: 1,
        lost_quantity: 4,
      }),
      expect.objectContaining({
        source: "loot",
        item_id: "food",
        original_quantity: 5,
        kept_quantity: 1,
        lost_quantity: 4,
      }),
    ]);
  });

  it("高生命所长强制返程时可以降到配置下限7", () => {
    const application = startedApplication([90, 7]);
    const state = requireState(application);
    const player = requirePlayer(state);
    player.health = 100;
    state.expedition = {
      city_id: "city_a",
      district_id: "city_a_district_a",
      travel_step_cost: 1,
      leader_player_index: 0,
      companion_ids: [],
      carried_items: {},
      loot: {},
      remaining_steps: 0,
      maximum_steps: 10,
      events_resolved: 1,
    };

    application.continueExpedition();

    expect(requirePlayer(state).health).toBe(7);
    expect(application.lastExpeditionFailure()).toMatchObject({
      health_before: 100,
      health_after: 7,
    });
  });
});
