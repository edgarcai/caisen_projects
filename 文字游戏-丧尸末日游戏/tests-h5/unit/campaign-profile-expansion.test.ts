import { describe, expect, it } from "vitest";
import { readCampaignMetadataFlag } from "../../src/domain/campaign-profile-metadata";
import { isStaticStateOperationTargetSupported } from "../../src/domain/state-operation-targets";
import { buildH5Harness, requirePlayer, requireState } from "../helpers/H5TestHarness";

/** 返回一个已通过真实内容组装的开局应用。 */
function createApplication() {
  return buildH5Harness().application;
}

describe("扩展开局档案运行时集成", () => {
  it("将 7 难度、10 起源、20 特性与 10 避难所类型注入运行时内容", () => {
    const application = createApplication();
    const profiles = application.content.game.campaign_profiles;

    expect(profiles.difficulties).toHaveLength(7);
    expect(profiles.origins).toHaveLength(10);
    expect(profiles.traits).toHaveLength(20);
    expect(profiles.shelter_types).toHaveLength(10);
    expect(profiles.trait_selection_rules.maximum_selections).toBe(2);
    expect(application.content.game.rules.world_map.home_city_ids.every((cityId) =>
      application.content.city(cityId).districts.length >= 6
    )).toBe(true);

    const effects = [
      ...profiles.difficulties.flatMap((option) => option.starting_effects),
      ...profiles.origins.flatMap((option) => option.starting_effects),
      ...profiles.traits.flatMap((option) => option.starting_effects),
      ...profiles.shelter_types.flatMap((option) => option.starting_effects),
    ];
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.every((effect) =>
      (effect.operation === "add" || effect.operation === "subtract")
      && isStaticStateOperationTargetSupported(effect.target)
    )).toBe(true);
  });

  it("使用双特性、出生区划和避难所原型创建可保存的 v9 状态", () => {
    const application = createApplication();
    const slotId = application.saveSlots()[0]?.slotId;
    if (slotId === undefined) throw new Error("测试要求至少一个存档栏位。");
    application.startNewGame({
      mode: "single",
      playerNames: ["林岚"],
      saveSlotId: slotId,
      profile: {
        difficulty_id: "newcomer",
        origin_id: "municipal_engineer",
        trait_id: "hot_blooded",
        secondary_trait_id: "rallying_voice",
        home_city_id: "city_a",
        home_district_id: "city_a_district_c",
        shelter_type_id: "air_raid_bunker",
      },
    });

    const state = requireState(application);
    const player = requirePlayer(state);
    const profiles = application.content.game.campaign_profiles;
    const defaults = application.content.game.defaults;
    const flags = profiles.metadata_flags;
    expect(Object.keys(state.campaign).sort()).toEqual([
      "difficulty_id",
      "home_city_id",
      "origin_id",
      "trait_id",
    ]);
    expect(readCampaignMetadataFlag(
      state.story.flags,
      flags.secondary_trait_prefix,
    )).toBe("rallying_voice");
    expect(readCampaignMetadataFlag(
      state.story.flags,
      flags.home_district_prefix,
    )).toBe("city_a_district_c");
    expect(readCampaignMetadataFlag(
      state.story.flags,
      flags.shelter_type_prefix,
    )).toBe("air_raid_bunker");
    expect(readCampaignMetadataFlag(
      state.story.flags,
      flags.shelter_capacity_prefix,
    )).toBe("18");
    expect(readCampaignMetadataFlag(
      state.story.flags,
      flags.shelter_facility_slots_prefix,
    )).toBe("5");
    expect(player).toMatchObject({
      food: defaults.player.food + 30,
      medical_supplies: defaults.player.medical_supplies + 20,
      parts: defaults.player.parts + 15,
      attack: defaults.player.attack + 6,
      defense: defaults.player.defense - 2,
    });
    expect(state.shelter).toMatchObject({
      hope: defaults.shelter.hope + 35,
      inner_wall_health: 520,
      outer_wall_health: 300,
      health: 820,
    });
    expect(state.shelter.health).toBeLessThanOrEqual(
      application.content.game.rules.limits.shelter_max_health,
    );

    application.saveGame(slotId);
    expect(application.saveSlots()[0]).toMatchObject({
      secondaryTraitId: "rallying_voice",
      homeDistrictId: "city_a_district_c",
      shelterTypeId: "air_raid_bunker",
    });
  });

  it("拒绝重复、互斥特性和跨城市出生区划", () => {
    const createSetup = (
      secondaryTraitId: string,
      districtId = "city_a_district_a",
    ) => ({
      mode: "single" as const,
      playerNames: ["所长"],
      saveSlotId: 1,
      profile: {
        difficulty_id: "survivor",
        origin_id: "old_city_patrol",
        trait_id: "hot_blooded",
        secondary_trait_id: secondaryTraitId,
        home_city_id: "city_a",
        home_district_id: districtId,
        shelter_type_id: "air_raid_bunker",
      },
    });

    expect(() => createApplication().startNewGame(
      createSetup("hot_blooded"),
    )).toThrow();
    expect(() => createApplication().startNewGame(
      createSetup("calm_under_fire"),
    )).toThrow();
    expect(() => createApplication().startNewGame(
      createSetup("rallying_voice", "city_b_district_a"),
    )).toThrow();
  });
});
