import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  buildCityReconPrompt,
  buildOutpostDetailPrompt,
  buildOutpostTypePrompt,
  buildSettlementNetworkPrompt,
} from "../../src/ui/pages/SettlementNetworkPages";
import type { GameUiSnapshot } from "../../src/ui/ports/GameUiPort";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";

const webConfig = parseWebGameConfig(webConfigDocument);

/** 从同步 UI 命令结果中读取完整快照。 */
function requireSnapshot(snapshot: GameUiSnapshot | undefined): GameUiSnapshot {
  if (snapshot === undefined) throw new Error("命令未返回 UI 快照。");
  return snapshot;
}

/** 为侦察测试补足情报并装备一辆陆地载具。 */
function prepareReconResources(state: ReturnType<typeof requireState>): void {
  state.shelter.newspapers = 20;
  state.inventory.crafted_items.armored_car = 1;
  state.inventory.equipped_transport_ids = ["armored_car"];
}

describe("城市侦察与分避难所 UI 端到端契约", () => {
  it("快照使用配置成本，并仅使满足条件的未解锁城市可侦察", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["网络所长"],
    });
    const state = requireState(application);
    prepareReconResources(state);

    const snapshot = adapter.getSnapshot();
    const homeCity = snapshot.settlementCities.find((city) => city.id === "city_a");
    const targetCity = snapshot.settlementCities.find((city) => city.id === "city_b");

    expect(snapshot.settlementNetworkRules).toEqual({
      reconDurationDays: 7,
      maximumOutposts: 8,
      outpostCoinCost: 80,
      outpostPartCost: 120,
      supplyIntervalDays: 7,
      supplyFoodCost: 12,
      supplyPartCost: 8,
      supplyCoinCost: 10,
      supplyMedicalSupplyCost: 1,
    });
    expect(snapshot.outpostShelterTypes).toHaveLength(10);
    expect(snapshot.settlementAvailableCompanions.length).toBeGreaterThan(0);
    expect(homeCity).toMatchObject({ unlocked: true, canStartRecon: false });
    expect(homeCity?.disabledReason).toBe(
      webConfig.texts.settlement_recon_already_unlocked,
    );
    expect(targetCity).toMatchObject({
      unlocked: false,
      canStartRecon: true,
      intelligenceCurrent: 20,
      intelligenceRequired: 3,
    });
    expect(targetCity?.transportNames).toContain("加固越野车");
  });

  it("命令端可完成侦察、解锁、建站、派驻、召回和周补给", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["分站所长"],
    });
    prepareReconResources(requireState(application));
    const initial = adapter.getSnapshot();
    const companionId = initial.settlementAvailableCompanions[0]?.id;
    if (companionId === undefined) throw new Error("测试缺少可用角色。");

    const started = adapter.execute({
      type: "city_recon_start",
      cityId: "city_b",
      companionId,
    });
    const activeSnapshot = requireSnapshot(started.snapshot);
    const mission = activeSnapshot.cityReconMissions[0];

    expect(started.accepted).toBe(true);
    expect(mission).toMatchObject({
      cityId: "city_b",
      companionId,
      daysRemaining: 7,
      ready: false,
    });
    expect(activeSnapshot.settlementAvailableCompanions.map((item) => item.id))
      .not.toContain(companionId);

    const reconState = requireState(application);
    reconState.survival_days = mission?.completionDay ?? reconState.survival_days;
    const completed = adapter.execute({
      type: "city_recon_complete",
      cityId: "city_b",
    });
    const unlockedSnapshot = requireSnapshot(completed.snapshot);
    expect(completed.accepted).toBe(true);
    expect(unlockedSnapshot.cityReconMissions).toEqual([]);
    expect(unlockedSnapshot.settlementCities.find((city) => city.id === "city_b"))
      .toMatchObject({ unlocked: true, canStartRecon: false });

    const buildState = requireState(application);
    requirePlayer(buildState).coins = 500;
    requirePlayer(buildState).parts = 500;
    const districtId = application.content.city("city_b").districts[0]?.id;
    const shelterTypeId = unlockedSnapshot.outpostShelterTypes[0]?.id;
    if (districtId === undefined || shelterTypeId === undefined) {
      throw new Error("测试缺少区划或避难所类型。");
    }
    const established = adapter.execute({
      type: "outpost_establish",
      cityId: "city_b",
      districtId,
      shelterTypeId,
    });
    const outpostSnapshot = requireSnapshot(established.snapshot);
    const outpost = outpostSnapshot.outposts[0];
    if (outpost === undefined) throw new Error("分避难所未成功建立。");

    expect(established.accepted).toBe(true);
    expect(requirePlayer(requireState(application))).toMatchObject({
      coins: 420,
      parts: 380,
    });
    const assigned = adapter.execute({
      type: "outpost_assign",
      outpostId: outpost.outpostId,
      companionId,
    });
    expect(requireSnapshot(assigned.snapshot).outposts[0]?.assignedCompanionIds)
      .toEqual([companionId]);
    expect(requireSnapshot(assigned.snapshot).settlementAvailableCompanions
      .map((item) => item.id)).not.toContain(companionId);

    const recalled = adapter.execute({ type: "outpost_recall", companionId });
    expect(requireSnapshot(recalled.snapshot).outposts[0]?.assignedCompanionIds)
      .toEqual([]);
    expect(requireSnapshot(recalled.snapshot).settlementAvailableCompanions
      .map((item) => item.id)).toContain(companionId);

    const supplyState = requireState(application);
    supplyState.survival_days = outpost.nextSupplyDay;
    requirePlayer(supplyState).food = 30;
    requirePlayer(supplyState).medical_supplies = 2;
    const partsBeforeSupply = requirePlayer(supplyState).parts;
    const coinsBeforeSupply = requirePlayer(supplyState).coins;
    const supplied = adapter.execute({
      type: "outpost_supply",
      outpostId: outpost.outpostId,
    });
    expect(supplied.accepted).toBe(true);
    expect(requirePlayer(requireState(application)).food).toBe(18);
    expect(requirePlayer(requireState(application)).parts).toBe(partsBeforeSupply - 8);
    expect(requirePlayer(requireState(application)).coins).toBe(coinsBeforeSupply - 10);
    expect(requirePlayer(requireState(application)).medical_supplies).toBe(1);
    expect(requireSnapshot(supplied.snapshot).outposts[0]).toMatchObject({
      lastSuppliedDay: outpost.nextSupplyDay,
      supplyReady: false,
      operations: {
        food: 16,
        parts: 12,
        coins: 22,
        medicalSupplies: 2,
      },
    });
  });

  it("页面提示完整展示侦察需求、建设成本和周物流", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["页面所长"],
    });
    const snapshot = adapter.getSnapshot();
    const city = snapshot.settlementCities[0];
    const district = city?.districts[0];
    const shelterType = snapshot.outpostShelterTypes[0];
    if (city === undefined || district === undefined || shelterType === undefined) {
      throw new Error("页面测试缺少基础配置。");
    }

    const overview = buildSettlementNetworkPrompt(
      webConfig,
      snapshot.cityReconMissions,
      snapshot.outposts,
      snapshot.settlementNetworkRules,
    );
    const recon = buildCityReconPrompt(webConfig, snapshot.settlementCities);
    const typePrompt = buildOutpostTypePrompt(
      webConfig,
      city,
      district,
      [shelterType],
      snapshot.settlementNetworkRules,
    );

    expect(overview.options.map((option) => option.label)).toContain(
      webConfig.texts.settlement_network_start_recon,
    );
    expect(overview.options.find(
      (option) => option.label === webConfig.texts.settlement_network_build_outpost,
    )?.description).toContain("80 金币");
    expect(recon.options.find((option) => option.id === "city_a"))
      .toMatchObject({ disabled: true });
    expect(typePrompt.body).toContain("120 零件");
    expect(typePrompt.options[0]?.description).toContain(
      String(shelterType.startingCapacity),
    );

    const outpostPrompt = buildOutpostDetailPrompt(
      webConfig,
      {
        outpostId: "city_a~a_district",
        cityId: "city_a",
        cityName: "A市",
        districtId: "a_district",
        districtName: "A区",
        shelterTypeId: shelterType.id,
        shelterTypeLabel: shelterType.label,
        capacity: shelterType.startingCapacity,
        assignedCompanionIds: [],
        assignedCompanionNames: [],
        lastSuppliedDay: 1,
        nextSupplyDay: 8,
        supplyReady: true,
        operations: {
          population: 2,
          hope: 70,
          activity: 50,
          innerWallHealth: 100,
          outerWallHealth: 100,
          food: 4,
          parts: 4,
          medicalSupplies: 1,
          coins: 12,
          facilityLevel: 1,
        },
      },
      snapshot.settlementAvailableCompanions,
      snapshot.settlementNetworkRules,
    );
    expect(outpostPrompt.options.find(
      (option) => option.label === webConfig.texts.outpost_supply,
    )?.description).toContain("12 食物");
    expect(requireState(application).story.flags.some(
      (flag) => flag.startsWith("settlement_network."),
    )).toBe(false);
  });
});
