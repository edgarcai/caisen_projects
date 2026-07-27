import { describe, expect, it } from "vitest";
import type { SettlementNetworkConfig } from "../../src/domain/settlement-network";
import { SettlementNetworkService } from "../../src/services/SettlementNetworkService";
import { buildH5Harness, requirePlayer, requireState } from "../helpers/H5TestHarness";

const TEST_CONFIG: SettlementNetworkConfig = {
  rules: {
    recon_duration_days: 7,
    maximum_outposts: 4,
    outpost_coin_cost: 12,
    outpost_part_cost: 18,
    supply_interval_days: 7,
    supply_food_cost: 3,
    supply_part_cost: 2,
    supply_coin_cost: 1,
    supply_medical_supply_cost: 1,
    outpost_operations: {
      starting_population: 2,
      starting_hope: 70,
      starting_activity: 50,
      starting_inner_wall_health: 100,
      starting_outer_wall_health: 100,
      starting_food: 1,
      starting_parts: 1,
      starting_medical_supplies: 0,
      starting_coins: 1,
      maximum_wall_health: 200,
      maximum_hope: 100,
      maximum_activity: 100,
      maximum_facility_level: 10,
      maintenance_part_cost: 1,
      maintenance_repair: 20,
      patrol_part_cost: 1,
      patrol_repair: 15,
      patrol_activity_gain: 3,
      activity_food_cost: 1,
      activity_hope_gain: 5,
      activity_activity_gain: 5,
      upgrade_coin_base_cost: 1,
      upgrade_coin_growth: 1,
      upgrade_part_base_cost: 1,
      upgrade_part_growth: 1,
    },
    flag_namespace: "network",
  },
  shelter_types: [{
    id: "air_raid_bunker",
    label: "防空洞避难所",
    description: "依托旧式防空洞建立的稳定据点。",
    bonuses: ["内墙耐久提高"],
    starting_capacity: 8,
  }],
  texts: {
    recon_already_unlocked: "{city_name}已经解锁。",
    recon_already_active: "{city_name}已有侦察。",
    recon_companion_unavailable: "{companion_name}当前不可派遣。",
    recon_need_intelligence: "需要{required}份报纸情报。",
    recon_need_transport: "缺少前往{city_name}的载具。",
    recon_started: "{companion_name}已前往{city_name}，将在{days}天后返回。",
    recon_not_found: "没有城市{city_id}的侦察。",
    recon_not_ready: "还需{days}天。",
    recon_completed: "{companion_name}：{city_name}的路线已经标好，我们可以过去了。",
    outpost_city_locked: "{city_name}尚未解锁。",
    outpost_limit: "最多建立{maximum}个分避难所。",
    outpost_exists: "{district_name}已经存在分避难所。",
    outpost_resource_shortage: "需要{coins}金币和{parts}零件。",
    outpost_established: "已在{city_name}{district_name}建立{shelter_type}。",
    outpost_unknown: "未知分避难所{outpost_id}。",
    outpost_companion_unavailable: "{companion_name}当前不可派驻。",
    outpost_companion_assigned: "{companion_name}已驻守{city_name}。",
    outpost_companion_not_assigned: "{companion_name}没有被派驻。",
    outpost_companion_recalled: "{companion_name}：我从{city_name}回来了。",
    outpost_supply_not_ready: "第{day}天才能再次补给。",
    outpost_supply_shortage: "补给需要{food}食物和{parts}零件。",
    outpost_supplied: "前往{city_name}的补给队已经出发。",
    shelter_type_unknown: "未知类型{shelter_type_id}。",
    companion_unknown: "未知角色{companion_id}。",
  },
};

/** 创建一局具备隔离存储的标准单人游戏。 */
function createNetworkTest() {
  const harness = buildH5Harness();
  harness.application.startNewGame(["网络测试员"], "single");
  return {
    application: harness.application,
    state: requireState(harness.application),
    service: new SettlementNetworkService(TEST_CONFIG, harness.application.content),
  };
}

describe("跨城侦察与分避难所", () => {
  it("要求情报和已装备载具，满七天后解锁城市并生成归来对话", () => {
    const { application, state, service } = createNetworkTest();
    const city = application.content.city("city_c");
    const companionId = "haocai";

    expect(service.startRecon(state, city.id, companionId).applied).toBe(false);
    state.shelter.newspapers = city.intelligence_newspapers_required;
    state.inventory.crafted_items.armored_car = 1;
    state.inventory.equipped_transport_ids = ["armored_car"];
    expect(service.startRecon(state, city.id, companionId).applied).toBe(true);
    expect(service.reconMissions(state)[0]).toMatchObject({
      cityId: city.id,
      daysRemaining: 7,
      ready: false,
    });

    state.survival_days += TEST_CONFIG.rules.recon_duration_days;
    const completed = service.completeRecon(state, city.id);
    expect(completed.applied).toBe(true);
    expect(completed.messages[0]).toContain(city.name);
    expect(service.cityUnlocked(state, city.id)).toBe(true);
  });

  it("建立分避难所后支持派驻、周期补给和带对话召回", () => {
    const { state, service } = createNetworkTest();
    const cityId = "city_c";
    const districtId = "city_c_district_a";
    const companionId = "haocai";
    state.story.flags.push("network.city|city_c");
    const player = requirePlayer(state);
    player.coins = 100;
    player.parts = 100;
    player.food = 100;
    player.medical_supplies = 100;

    expect(service.establishOutpost(
      state,
      cityId,
      districtId,
      "air_raid_bunker",
    ).applied).toBe(true);
    const outpost = service.outposts(state)[0];
    expect(outpost).toMatchObject({
      cityId,
      districtId,
      capacity: 8,
      supplyReady: false,
      operations: { food: 1, parts: 1, coins: 1, medicalSupplies: 0 },
    });
    if (outpost === undefined) throw new Error("测试要求已建立分避难所。");
    expect(service.assignCompanion(state, outpost.outpostId, companionId).applied).toBe(true);
    expect(service.companionAssigned(state, companionId)).toBe(true);

    state.survival_days += TEST_CONFIG.rules.supply_interval_days;
    expect(service.supplyOutpost(state, outpost.outpostId).applied).toBe(true);
    expect(service.outposts(state)[0]?.operations).toMatchObject({
      food: 4,
      parts: 3,
      coins: 2,
      medicalSupplies: 1,
    });
    expect(player).toMatchObject({
      food: 97,
      parts: 80,
      coins: 87,
      medical_supplies: 99,
    });
    const recalled = service.recallCompanion(state, companionId);
    expect(recalled.applied).toBe(true);
    expect(recalled.messages[0]).toContain("回来了");
    expect(service.companionAssigned(state, companionId)).toBe(false);
  });
});
