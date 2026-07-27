import { describe, expect, it } from "vitest";
import survivalSystemsDocument from "../../config/survival_systems.json";
import type { GameApplication } from "../../src/application";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type { CityConfig, CityDistrictConfig } from "../../src/domain/content";
import type { GameMode } from "../../src/domain/game-state";
import {
  CityAccessService,
  GameContent,
  type CityTravelRelation,
} from "../../src/services";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";

/** 自定义开局测试仅需覆盖的档案字段。 */
interface StartOptions {
  readonly mode?: GameMode;
  readonly difficultyId?: string;
  readonly homeCityId?: string;
}

/** 使用真实配置和隔离存储创建指定模式、难度与出生城市的游戏。 */
function startConfiguredGame(options: StartOptions = {}): GameApplication {
  const application = buildH5Harness().application;
  const profile = application.content.game.campaign_profiles.migration_default;
  const mode = options.mode ?? "single";
  const firstSlot = application.saveSlots()[0];
  if (firstSlot === undefined) {
    throw new Error("测试要求至少配置一个存档槽位。");
  }
  application.startNewGame({
    mode,
    playerNames: mode === "multiplayer" ? ["甲", "乙"] : ["所长"],
    saveSlotId: firstSlot.slotId,
    profile: {
      ...structuredClone(profile),
      difficulty_id: options.difficultyId ?? profile.difficulty_id,
      home_city_id: options.homeCityId ?? profile.home_city_id,
    },
  });
  return application;
}

/** 按双向邻接拓扑计算两座城市之间的预期关系。 */
function expectedRelation(
  homeCity: CityConfig,
  destination: CityConfig,
): CityTravelRelation {
  if (homeCity.id === destination.id) {
    return "home";
  }
  return homeCity.neighbor_ids.includes(destination.id)
    || destination.neighbor_ids.includes(homeCity.id)
    ? "neighbor"
    : "remote";
}

/** 从游戏规则读取指定城市关系的配置化出发路费。 */
function configuredTravelCost(
  application: GameApplication,
  relation: CityTravelRelation,
): number {
  const travel = application.content.game.rules.city_travel;
  if (relation === "home") return travel.home_step_cost;
  if (relation === "neighbor") return travel.neighbor_step_cost;
  return travel.remote_step_cost;
}

/** 返回城市在内容配置中指定的默认区划。 */
function configuredDefaultDistrict(
  application: GameApplication,
  cityId: string,
): CityDistrictConfig {
  const city = application.content.city(cityId);
  return application.content.district(city.id, city.default_district_id);
}

/** 使用真实七日侦察用例解锁一座已满足交通条件的远城。 */
function completeConfiguredRecon(
  application: GameApplication,
  cityId: string,
  companionId = "haocai",
): void {
  const state = requireState(application);
  state.shelter.newspapers = Math.max(
    state.shelter.newspapers,
    application.content.city(cityId).intelligence_newspapers_required,
  );
  const started = application.startCityRecon(cityId, companionId);
  expect(started.stateChanged, `开始侦察 ${cityId}`).toBe(true);
  state.survival_days += 7;
  const completed = application.completeCityRecon(cityId);
  expect(completed.stateChanged, `完成侦察 ${cityId}`).toBe(true);
}

describe("游戏模式能力隔离", () => {
  it("单人和多人仅保留生存能力，剧情模式独占叙事与首领战", () => {
    const matrix = [
      { mode: "single", narrative: false, bossCombat: false },
      { mode: "multiplayer", narrative: false, bossCombat: false },
      { mode: "story", narrative: true, bossCombat: true },
    ] as const;

    for (const row of matrix) {
      const application = startConfiguredGame({ mode: row.mode });
      expect(application.supportsCapability("narrative")).toBe(row.narrative);
      expect(application.supportsCapability("boss_combat")).toBe(row.bossCombat);
      expect(application.currentStoryPrompt() !== null).toBe(row.narrative);
      expect(application.storyStatus() !== null).toBe(row.narrative);
      if (!row.bossCombat) {
        expect(() => application.performCombatAction("attack")).toThrow(
          application.content.text("mode_capability_unavailable", {
            capability: "boss_combat",
          }),
        );
      }
    }
  });

  it("多人开局通讯使用内容配置中的姓名分隔符", () => {
    const application = buildH5Harness().application;
    const separatorKey = "multiplayer_name_separator";
    const originalSeparator = application.content.game.texts[separatorKey];
    if (originalSeparator === undefined) {
      throw new Error("测试要求配置多人姓名分隔符。");
    }
    application.content.game.texts[separatorKey] = " / ";
    try {
      const firstSlot = application.saveSlots()[0];
      if (firstSlot === undefined) {
        throw new Error("测试要求至少配置一个存档槽位。");
      }

      const report = application.startNewGame({
        mode: "multiplayer",
        playerNames: ["甲", "乙"],
        saveSlotId: firstSlot.slotId,
        profile: structuredClone(
          application.content.game.campaign_profiles.migration_default,
        ),
      });

      expect(report.messages[0]).toContain("甲 / 乙");
    } finally {
      application.content.game.texts[separatorKey] = originalSeparator;
    }
  });
});

describe("城市拓扑与通行矩阵", () => {
  it("配置允许的出生城市均按双向邻接解析所在、附近和远处关系及路费", () => {
    const application = startConfiguredGame();
    const cities = application.content.game.cities;
    const allowedHomeCityIds = application.content.game.rules.world_map.home_city_ids;

    for (const homeCityId of allowedHomeCityIds) {
      const homeCity = cities.find((city) => city.id === homeCityId);
      if (homeCity === undefined) throw new Error(`白名单引用未知城市 ${homeCityId}。`);
      const application = startConfiguredGame({ homeCityId: homeCity.id });
      const decisions = new Map(
        application.expeditionCities().map((decision) => [decision.city.id, decision]),
      );
      for (const destination of cities) {
        const relation = expectedRelation(homeCity, destination);
        const decision = decisions.get(destination.id);
        expect(decision, `${homeCity.id} → ${destination.id}`).toMatchObject({
          relation,
          travelStepCost: configuredTravelCost(application, relation),
        });
        if (relation !== "remote") {
          expect(decision?.accessible, `${homeCity.id} → ${destination.id}`).toBe(true);
        }
      }
    }
  });

  it("领域层拒绝以隔离岛屿作为出生城市绕过双载具限制", () => {
    expect(() => startConfiguredGame({ homeCityId: "city_h" })).toThrow(/出生城市/);
  });

  it("大陆链远城要求情报、载具与七日侦察，路线图不能替代", () => {
    const application = startConfiguredGame({ homeCityId: "city_a" });
    const state = requireState(application);
    const initial = new Map(
      application.expeditionCities().map((decision) => [decision.city.id, decision]),
    );

    expect(initial.get("city_a")?.accessible).toBe(true);
    expect(initial.get("city_b")?.accessible).toBe(true);
    for (const cityId of ["city_c", "city_d", "city_e", "city_f", "city_g", "city_h"]) {
      expect(initial.get(cityId)?.accessible, cityId).toBe(false);
    }

    state.shelter.newspapers = 10;
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_g",
    )?.accessible).toBe(false);

    state.inventory.crafted_items.route_map = 1;
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_c",
    )?.accessible).toBe(false);
    state.inventory.crafted_items.armored_car = 1;
    state.inventory.equipped_transport_ids = ["armored_car"];
    for (const cityId of ["city_c", "city_d", "city_e", "city_f", "city_g"]) {
      completeConfiguredRecon(application, cityId);
      expect(application.expeditionCities().find(
        (decision) => decision.city.id === cityId,
      )?.accessible, cityId).toBe(true);
    }
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_h",
    )?.accessible).toBe(false);
  });

  it("非 A 出生时仍需载具与七日侦察开放远处 A 市", () => {
    const routeApplication = startConfiguredGame({ homeCityId: "city_d" });
    const routeState = requireState(routeApplication);
    const cityA = routeApplication.content.game.cities.find(
      (city) => city.id === "city_a",
    );
    if (cityA === undefined) {
      throw new Error("测试要求配置 A 市。");
    }
    const initial = routeApplication.expeditionCities().find(
      (decision) => decision.city.id === "city_a",
    );
    expect(initial).toMatchObject({
      relation: "remote",
      travelStepCost: routeApplication.content.game.rules.city_travel.remote_step_cost,
      accessible: false,
    });

    routeState.shelter.newspapers = cityA.intelligence_newspapers_required;
    expect(routeApplication.expeditionCities().find(
      (decision) => decision.city.id === "city_a",
    )?.accessible).toBe(false);
    routeState.inventory.crafted_items.route_map = 1;
    expect(routeApplication.expeditionCities().find(
      (decision) => decision.city.id === "city_a",
    )?.accessible).toBe(false);

    routeState.inventory.crafted_items.armored_car = 1;
    routeState.inventory.equipped_transport_ids = ["armored_car"];
    completeConfiguredRecon(routeApplication, "city_a");
    expect(routeApplication.expeditionCities().find(
      (decision) => decision.city.id === "city_a",
    )?.accessible).toBe(true);

    const transportApplication = startConfiguredGame({ homeCityId: "city_d" });
    const transportState = requireState(transportApplication);
    transportState.shelter.newspapers = cityA.intelligence_newspapers_required;
    transportState.inventory.crafted_items.armored_car = 1;
    transportState.inventory.equipped_transport_ids = ["armored_car"];
    completeConfiguredRecon(transportApplication, "city_a");
    expect(transportApplication.expeditionCities().find(
      (decision) => decision.city.id === "city_a",
    )).toMatchObject({ relation: "remote", accessible: true });
  });

  it("岛屿无邻城，且必须同时装备海上与飞行载具", () => {
    const application = startConfiguredGame({ homeCityId: "city_d" });
    const state = requireState(application);
    state.shelter.newspapers = 10;
    state.inventory.crafted_items.armored_car = 1;
    state.inventory.equipped_transport_ids = ["armored_car"];

    const landTransport = new Map(
      application.expeditionCities().map((decision) => [decision.city.id, decision]),
    );
    expect(landTransport.get("city_d")?.accessible).toBe(true);
    expect(landTransport.get("city_g")?.accessible).toBe(false);
    expect(landTransport.get("city_h")?.accessible).toBe(false);

    completeConfiguredRecon(application, "city_g");
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_g",
    )?.accessible).toBe(true);

    state.inventory.crafted_items.motorboat = 1;
    state.inventory.equipped_transport_ids = ["motorboat"];
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_h",
    )?.accessible).toBe(false);

    state.inventory.crafted_items.helicopter = 1;
    state.inventory.equipped_transport_ids = ["motorboat", "helicopter"];
    completeConfiguredRecon(application, "city_h");
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_h",
    )?.accessible).toBe(true);
  });

  it("载具设置按两槽容量装备与卸下，并实时驱动岛屿通行", () => {
    const application = startConfiguredGame({ homeCityId: "city_d" });
    const state = requireState(application);
    state.shelter.newspapers = 10;
    state.inventory.crafted_items.motorboat = 1;
    state.inventory.crafted_items.helicopter = 1;
    state.inventory.crafted_items.armored_car = 1;

    expect(application.toggleTransport("motorboat").stateChanged).toBe(true);
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_h",
    )?.accessible).toBe(false);
    expect(application.toggleTransport("helicopter").stateChanged).toBe(true);
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_h",
    )?.accessible).toBe(false);
    completeConfiguredRecon(application, "city_h");
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_h",
    )?.accessible).toBe(true);

    const capacity = application.toggleTransport("armored_car");
    expect(capacity.stateChanged).toBe(false);
    expect(state.inventory.equipped_transport_ids).toEqual([
      "motorboat",
      "helicopter",
    ]);

    expect(application.toggleTransport("motorboat").stateChanged).toBe(true);
    expect(state.inventory.equipped_transport_ids).toEqual(["helicopter"]);
    expect(application.expeditionCities().find(
      (decision) => decision.city.id === "city_h",
    )?.accessible).toBe(false);
  });

  it("远城锁定原因使用内容配置中的通行道具分隔符", () => {
    const application = startConfiguredGame({ homeCityId: "city_d" });
    const state = requireState(application);
    state.shelter.newspapers = 10;
    const game = structuredClone(application.content.game);
    game.texts.city_access_item_separator = " / ";
    const access = new CityAccessService(
      new GameContent(game, application.content.story, application.content.events),
      validateSurvivalSystemsConfig(survivalSystemsDocument),
    );

    const decision = access.evaluate(state, "city_h");

    expect(decision.accessible).toBe(false);
    expect(decision.reason).toContain(
      "浅水机动艇 / 轻型直升机",
    );
    expect(decision.reason).not.toContain("区域安全路线图");
  });
});

describe("开局难度生存倍率", () => {
  it("三档难度按配置百分比缩放同一工作行动的个人饥饿增量", () => {
    const template = startConfiguredGame();
    const difficulties = template.content.game.campaign_profiles.difficulties;
    const baseHunger = template.content.game.rules
      .action_hunger_costs.job?.player_hunger_gain;
    const modePercent = template.content.game.rules.mode_survival_cost_percent.single;
    const job = template.content.story.jobs.find(
      (candidate) => candidate.job_id === "sort_salvage",
    );
    if (baseHunger === undefined) {
      throw new Error("测试要求工作行动配置个人饥饿成本。");
    }
    if (job === undefined) {
      throw new Error("测试要求配置整理废料工作。");
    }
    const turnsConsumed = Math.ceil(
      job.duration_hours / template.content.game.rules.time.hours_per_action,
    );

    for (const difficulty of difficulties) {
      const application = startConfiguredGame({ difficultyId: difficulty.id });
      const player = requirePlayer(requireState(application));
      const hungerBefore = player.hunger;

      const report = application.performManagement("job", "sort_salvage");

      const scaledPercent = Math.floor(
        (modePercent * difficulty.survival_cost_percent) / 100,
      );
      const rawExpected = Math.floor((baseHunger * scaledPercent) / 100);
      const expectedHunger = baseHunger > 0 && scaledPercent > 0
        ? Math.max(1, rawExpected)
        : 0;
      expect(report.stateChanged, difficulty.id).toBe(true);
      expect(
        requirePlayer(requireState(application)).hunger - hungerBefore,
        difficulty.id,
      ).toBe(expectedHunger * turnsConsumed);
    }
  });
});

describe("远征路费与首事件步数", () => {
  it("所在、邻近和远处城市扣除路费与所选区划首事件总成本", () => {
    const scenarios = [
      { cityId: "city_a", relation: "home" },
      { cityId: "city_b", relation: "neighbor" },
      { cityId: "city_d", relation: "remote" },
    ] as const;

    for (const scenario of scenarios) {
      const application = startConfiguredGame({ homeCityId: "city_a" });
      const state = requireState(application);
      const district = configuredDefaultDistrict(application, scenario.cityId);
      if (scenario.relation === "remote") {
        state.shelter.newspapers = 10;
        state.inventory.crafted_items.armored_car = 1;
        state.inventory.equipped_transport_ids = ["armored_car"];
        completeConfiguredRecon(application, scenario.cityId);
      }
      const report = application.prepareExpedition(
        scenario.cityId,
        district.id,
        [],
        { food: 12 },
      );
      const status = application.expeditionStatus();
      if (status === null) {
        throw new Error(`远征 ${scenario.cityId} 未创建状态。`);
      }
      const travelCost = configuredTravelCost(application, scenario.relation);
      const eventStepCost = survivalSystemsDocument.expedition.event_step_cost
        + district.event_step_cost;
      const expectedMaximum = 12;
      const expectedRemaining =
        expectedMaximum -
        travelCost -
        eventStepCost;

      expect(report.stateChanged, scenario.cityId).toBe(true);
      expect(
        application.expeditionEventStepCost(scenario.cityId, district.id),
        scenario.cityId,
      ).toBe(eventStepCost);
      expect(status, scenario.cityId).toMatchObject({
        cityId: scenario.cityId,
        districtId: district.id,
        travelStepCost: travelCost,
        maximumSteps: expectedMaximum,
        remainingSteps: expectedRemaining,
        eventsResolved: 0,
      });
      expect(state.pending_exploration, scenario.cityId).toMatchObject({
        city_id: scenario.cityId,
        district_id: district.id,
      });
      const pendingEventId = state.pending_exploration?.event_id;
      expect(pendingEventId, scenario.cityId).toBeDefined();
      expect(district.event_ids, scenario.cityId).toContain(pendingEventId);
    }
  });

  it("跨城市伪造区划被拒绝且不修改远征状态", () => {
    const application = startConfiguredGame({ homeCityId: "city_a" });
    const state = requireState(application);
    const foreignDistrict = configuredDefaultDistrict(application, "city_b");
    const before = structuredClone(state);

    expect(() => application.prepareExpedition(
      "city_a",
      foreignDistrict.id,
      [],
      {},
    )).toThrow();
    expect(state).toEqual(before);
  });
});
