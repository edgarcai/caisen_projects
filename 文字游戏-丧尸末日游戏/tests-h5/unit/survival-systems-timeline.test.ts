import { describe, expect, it } from "vitest";
import type { GameApplication } from "../../src/application";
import { SaveDataError } from "../../src/domain/errors";
import type { GameState } from "../../src/domain/game-state";
import { MemoryStorage } from "../../src/infrastructure";
import { ChronicleService } from "../../src/services";
import {
  buildH5Harness,
  H5_TEST_STORAGE_KEY,
  requirePlayer,
  requireState,
  ScriptedRandomSource,
} from "../helpers/H5TestHarness";

/** 创建已进入单人模式的隔离应用。 */
function startedApplication(
  random: ScriptedRandomSource = new ScriptedRandomSource(),
  mode: GameState["mode"] = "single",
): GameApplication {
  const application = buildH5Harness({ random }).application;
  application.startNewGame(["白菜"], mode);
  return application;
}

/** 创建一个只有主档的合法存档，再按测试用例注入指定损坏状态。 */
function corruptedStorage(mutator: (state: GameState) => void): MemoryStorage {
  const storage = new MemoryStorage();
  const source = buildH5Harness({ storage }).application;
  source.startNewGame(["白菜"], "single");
  source.saveGame();
  const serialized = storage.getItem(H5_TEST_STORAGE_KEY);
  if (serialized === null) throw new Error("测试主档没有写入隔离存储。");
  const document = JSON.parse(serialized) as { game_state: GameState };
  mutator(document.game_state);
  storage.setItem(H5_TEST_STORAGE_KEY, JSON.stringify(document));
  return storage;
}

/** 从 v3 聚合中只选择 v2 存档允许出现的字段。 */
function asV2State(state: GameState): Record<string, unknown> {
  return {
    mode: state.mode,
    players: structuredClone(state.players),
    active_player_index: state.active_player_index,
    shelter: structuredClone(state.shelter),
    clock: structuredClone(state.clock),
    story: structuredClone(state.story),
    companions: structuredClone(state.companions),
    facility_levels: structuredClone(state.facility_levels),
    battle: structuredClone(state.battle),
    pending_exploration: structuredClone(state.pending_exploration),
    ending: structuredClone(state.ending),
    turn_number: state.turn_number,
  };
}

/** 为直接时间线测试完成一个指定日期的生存日。 */
function completeTimelineDay(
  chronicle: ChronicleService,
  state: GameState,
  day: number,
): void {
  state.clock = { year: 2166, month: 1, day, hour: 17 };
  chronicle.completeDay(state, structuredClone(state.clock), [`第${String(day)}日记录`]);
}

describe("研发、制作与仓库不变量", () => {
  it("研发和制作在资源不足时保持聚合原子，成功后才扣料并推进配置回合", () => {
    const application = startedApplication();
    const state = requireState(application);
    const player = requirePlayer(state);
    player.parts = 7;
    state.shelter.books = 1;
    const beforeResearch = structuredClone(state);

    const rejectedResearch = application.completeResearch("field_logistics");

    expect(rejectedResearch.stateChanged).toBe(false);
    expect(state).toEqual(beforeResearch);

    player.parts = 8;
    const completedResearch = application.completeResearch("field_logistics");

    expect(completedResearch.stateChanged).toBe(true);
    expect(state.research.completed_project_ids).toContain("field_logistics");
    expect(requirePlayer(state).parts).toBe(0);
    expect(state.shelter.books).toBe(0);
    expect(state.turn_number).toBe(3);
    expect(requirePlayer(state).hunger).toBe(0);

    requirePlayer(state).food = 3;
    requirePlayer(state).parts = 1;
    const beforeCrafting = structuredClone(state);
    const rejectedCrafting = application.craftItem("field_ration");

    expect(rejectedCrafting.stateChanged).toBe(false);
    expect(state).toEqual(beforeCrafting);

    requirePlayer(state).food = 4;
    const crafted = application.craftItem("field_ration");

    expect(crafted.stateChanged).toBe(true);
    expect(requirePlayer(state).food).toBe(0);
    expect(requirePlayer(state).parts).toBe(0);
    expect(state.inventory.crafted_items.field_ration).toBe(1);
    expect(state.turn_number).toBe(4);
    expect(requirePlayer(state).hunger).toBe(0);
  });

  it("装备保留制作物总量，但从仓库可用清单中排除", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.inventory.crafted_items.reinforced_coat = 1;

    expect(application.warehouseItems().map((item) => item.itemId))
      .toContain("reinforced_coat");

    const equipped = application.equipItem("reinforced_coat");

    expect(equipped.stateChanged).toBe(true);
    expect(state.inventory.crafted_items.reinforced_coat).toBe(1);
    expect(state.inventory.equipped_armor_id).toBe("reinforced_coat");
    expect(application.warehouseItems().map((item) => item.itemId))
      .not.toContain("reinforced_coat");
  });

  it("关键物品以只读档案进入仓库，且不能携带或装备", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.story.key_items.push("dawn_ledger", "physical_tower_key");

    const keyItems = application.warehouseItems().filter(
      (item) => item.category === "key_item",
    );

    expect(keyItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: "dawn_ledger",
        name: "晨曦计划账本",
        categoryLabel: "关键物品",
        quantity: 1,
        carryable: false,
      }),
      expect.objectContaining({
        itemId: "physical_tower_key",
        name: "灯塔实体钥匙",
        quantity: 1,
        carryable: false,
      }),
    ]));
    expect(application.expeditionCarryItems().map((item) => item.itemId))
      .not.toContain("physical_tower_key");
  });

  it("装备加成不改写基础属性，但同时更新 UI 与剧情战斗力", () => {
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "story", playerNames: ["白菜"] });
    const state = requireState(harness.application);
    const player = requirePlayer(state);
    state.story.current_scene_id = "rail_butcher";
    state.story.completed_scene_ids.push("doctor_in_the_rain");
    player.attack = 5;
    player.defense = 10;
    player.agility = 5;
    state.inventory.crafted_items.pipe_rifle = 1;
    const beforeChoice = harness.application.currentStoryPrompt()?.choices.find(
      (choice) => choice.choiceId === "kill_lu_chen",
    );

    harness.application.equipItem("pipe_rifle");

    const afterChoice = harness.application.currentStoryPrompt()?.choices.find(
      (choice) => choice.choiceId === "kill_lu_chen",
    );
    const attackStat = harness.adapter.getSnapshot().resources.find(
      (stat) => stat.id === "player-attack",
    );
    expect(beforeChoice?.available).toBe(false);
    expect(player.attack).toBe(5);
    expect(harness.application.effectivePlayerAttributes().attack).toBe(17);
    expect(attackStat?.value).toBe("17");
    expect(afterChoice?.available).toBe(true);
  });

  it("武器与防具的配置加成同时参与玩家伤害和首领反击结算", () => {
    const baseline = startedApplication(
      new ScriptedRandomSource([100, 100, 100]),
      "story",
    );
    const baselineState = requireState(baseline);
    const baselinePlayer = requirePlayer(baselineState);
    baselinePlayer.attack = 20;
    baselinePlayer.defense = 15;
    baselinePlayer.agility = 5;
    baselineState.battle = {
      boss_id: "rail_butcher",
      boss_name: "铁轨屠夫·陆沉",
      health: 180,
      max_health: 180,
      round_number: 1,
      guarding: false,
      focused: false,
      finished: false,
      victory: false,
      retreated: false,
    };

    const equipped = startedApplication(
      new ScriptedRandomSource([100, 100, 100]),
      "story",
    );
    const equippedState = requireState(equipped);
    const equippedPlayer = requirePlayer(equippedState);
    equippedPlayer.attack = 20;
    equippedPlayer.defense = 15;
    equippedPlayer.agility = 5;
    equippedState.inventory.crafted_items.pipe_rifle = 1;
    equippedState.inventory.crafted_items.reinforced_coat = 1;
    equipped.equipItem("pipe_rifle");
    equipped.equipItem("reinforced_coat");
    equippedState.battle = structuredClone(baselineState.battle);

    baseline.performCombatAction("attack");
    equipped.performCombatAction("attack");

    expect(baselineState.battle.health).toBe(146);
    expect(equippedState.battle.health).toBe(129);
    expect(requirePlayer(baselineState).health).toBe(84);
    expect(requirePlayer(equippedState).health).toBe(89);
  });
});

describe("配置化远征", () => {
  it("基础、特性、研发、伙伴信任与携带物共同增加步数，路费和城市成本在首事件前扣除", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.research.completed_project_ids.push("field_logistics");
    state.inventory.crafted_items.field_ration = 2;
    state.inventory.crafted_items.route_map = 1;
    state.shelter.newspapers = 5;
    const haocai = state.companions.find((companion) => (
      companion.companion_id === "haocai"
    ));
    if (haocai === undefined) throw new Error("测试伙伴豪菜不存在。");
    haocai.trust = 3;

    const report = application.prepareExpedition(
      "city_d",
      ["haocai"],
      { field_ration: 2 },
    );

    expect(report.stateChanged).toBe(true);
    expect(application.expeditionStatus()).toMatchObject({
      cityId: "city_d",
      travelStepCost: 3,
      maximumSteps: 14,
      remainingSteps: 9,
      companionIds: ["haocai"],
      carriedItems: { field_ration: 2 },
    });
    expect(state.pending_exploration).not.toBeNull();
    expect(state.turn_number).toBe(0);
  });

  it("高危城市比安全城市消耗更多首事件步数", () => {
    const safe = startedApplication();
    safe.prepareExpedition("city_a", [], {});
    const dangerous = startedApplication();
    const dangerousState = requireState(dangerous);
    dangerousState.shelter.newspapers = 10;
    dangerousState.inventory.crafted_items.route_map = 1;
    dangerous.prepareExpedition("city_h", [], {});

    expect(safe.expeditionStatus()).toMatchObject({
      travelStepCost: 1,
      maximumSteps: 6,
      remainingSteps: 4,
    });
    expect(dangerous.expeditionStatus()).toMatchObject({
      travelStepCost: 3,
      maximumSteps: 6,
      remainingSteps: 0,
    });
  });

  it("继续远征锁定下一事件，安全返程保留战利品并清理上下文", () => {
    const application = startedApplication();
    const state = requireState(application);
    state.expedition = {
      city_id: "city_a",
      travel_step_cost: 1,
      leader_player_index: 0,
      companion_ids: [],
      carried_items: {},
      loot: { coins: 9 },
      remaining_steps: 3,
      maximum_steps: 4,
      events_resolved: 1,
    };

    const continued = application.continueExpedition();

    expect(continued.stateChanged).toBe(true);
    expect(state.pending_exploration).not.toBeNull();
    expect(application.expeditionStatus()?.remainingSteps).toBe(2);

    const pending = state.pending_exploration;
    if (pending === null) throw new Error("继续远征没有锁定事件。");
    application.resolveExploration(pending.event_id);
    const coinsBeforeReturn = requirePlayer(state).coins;
    const expeditionCoins = application.expeditionStatus()?.loot.coins ?? 0;
    const returned = application.returnExpeditionSafely();

    expect(returned.stateChanged).toBe(true);
    expect(state.expedition).toBeNull();
    expect(state.pending_exploration).toBeNull();
    expect(requirePlayer(state).coins).toBe(coinsBeforeReturn + expeditionCoins);
  });

  it("多人轮换后仍由出发所长接收远征战利品", () => {
    const random = new ScriptedRandomSource([50, 60], [0, 0]);
    const application = buildH5Harness({ random }).application;
    application.startNewGame(["白菜", "豪菜"], "multiplayer");
    const state = requireState(application);

    application.prepareExpedition("city_a", [], {});
    const firstEvent = state.pending_exploration;
    if (firstEvent === null) throw new Error("首个远征事件不存在。");
    application.resolveExploration(firstEvent.event_id);

    expect(state.active_player_index).toBe(1);
    expect(application.expeditionStatus()?.loot).toEqual({ coins: 50 });
    expect(requirePlayer(state, 0).coins).toBe(40);
    expect(requirePlayer(state, 1).coins).toBe(40);

    application.continueExpedition();
    const secondEvent = state.pending_exploration;
    if (secondEvent === null) throw new Error("继续远征没有生成事件。");
    application.resolveExploration(secondEvent.event_id);
    application.returnExpeditionSafely();

    expect(requirePlayer(state, 0).coins).toBe(150);
    expect(requirePlayer(state, 1).coins).toBe(40);
  });

  it("活跃远征读档后由领域摘要恢复携带物与战利品名称", () => {
    const storage = new MemoryStorage();
    const source = buildH5Harness({ storage }).application;
    source.startNewGame(["白菜"], "single");
    const sourceState = requireState(source);
    sourceState.inventory.crafted_items.field_ration = 2;
    source.prepareExpedition("city_a", [], { field_ration: 2 });
    if (sourceState.expedition === null) throw new Error("测试远征未建立。");
    sourceState.expedition.loot.game_consoles = 1;
    source.saveGame();

    const restored = buildH5Harness({ storage }).application;
    restored.loadGame();

    expect(restored.expeditionCarryItems()).not.toContainEqual(expect.objectContaining({
      itemId: "field_ration",
    }));
    expect(restored.expeditionStatus()?.itemNames).toEqual({
      field_ration: "行军口粮",
      game_consoles: "游戏机",
    });
  });

  it("步数不足时全部远征物资只保留20%并把生命钳制到7至45", () => {
    const random = new ScriptedRandomSource([45]);
    const application = startedApplication(random);
    const state = requireState(application);
    const player = requirePlayer(state);
    player.food = 100;
    state.expedition = {
      city_id: "city_h",
      travel_step_cost: 3,
      leader_player_index: 0,
      companion_ids: [],
      carried_items: { food: 4 },
      loot: { food: 6 },
      remaining_steps: 2,
      maximum_steps: 4,
      events_resolved: 2,
    };

    const report = application.continueExpedition();

    expect(report.stateChanged).toBe(true);
    expect(report.messages.join("\n")).toContain("20%远征物资");
    expect(requirePlayer(state).food).toBe(102);
    expect(requirePlayer(state).health).toBe(45);
    expect(requirePlayer(state).health).toBeGreaterThanOrEqual(7);
    expect(requirePlayer(state).health).toBeLessThanOrEqual(45);
    expect(state.expedition).toBeNull();
    expect(state.pending_exploration).toBeNull();
  });
});

describe("生存系统存档校验", () => {
  it.each([
    {
      name: "未知制作物",
      mutate: (state: GameState): void => {
        state.inventory.crafted_items.unknown_item = 1;
      },
    },
    {
      name: "负数制作物数量",
      mutate: (state: GameState): void => {
        state.inventory.crafted_items.field_ration = -1;
      },
    },
    {
      name: "防具占用武器槽",
      mutate: (state: GameState): void => {
        state.inventory.crafted_items.reinforced_coat = 1;
        state.inventory.equipped_weapon_id = "reinforced_coat";
      },
    },
    {
      name: "未持有的已装备武器",
      mutate: (state: GameState): void => {
        state.inventory.equipped_weapon_id = "pipe_rifle";
      },
    },
    {
      name: "未知研究项目",
      mutate: (state: GameState): void => {
        state.research.completed_project_ids.push("unknown_research");
      },
    },
    {
      name: "缺少前置的研究项目",
      mutate: (state: GameState): void => {
        state.research.completed_project_ids.push("trauma_response");
      },
    },
    {
      name: "未知远征城市",
      mutate: (state: GameState): void => {
        state.expedition = {
          city_id: "unknown_city",
          travel_step_cost: 1,
          leader_player_index: 0,
          companion_ids: [],
          carried_items: {},
          loot: {},
          remaining_steps: 4,
          maximum_steps: 4,
          events_resolved: 0,
        };
      },
    },
    {
      name: "未知远征战利品",
      mutate: (state: GameState): void => {
        state.expedition = {
          city_id: "city_a",
          travel_step_cost: 1,
          leader_player_index: 0,
          companion_ids: [],
          carried_items: {},
          loot: { unknown_loot: 1 },
          remaining_steps: 4,
          maximum_steps: 4,
          events_resolved: 0,
        };
      },
    },
    {
      name: "超过配置携带容量",
      mutate: (state: GameState): void => {
        state.expedition = {
          city_id: "city_a",
          travel_step_cost: 1,
          leader_player_index: 0,
          companion_ids: [],
          carried_items: { food: 7 },
          loot: {},
          remaining_steps: 4,
          maximum_steps: 4,
          events_resolved: 0,
        };
      },
    },
    {
      name: "超过配置携带种类",
      mutate: (state: GameState): void => {
        state.expedition = {
          city_id: "city_a",
          travel_step_cost: 1,
          leader_player_index: 0,
          companion_ids: [],
          carried_items: {
            food: 1,
            medical_supplies: 1,
            antidotes: 1,
            parts: 1,
          },
          loot: {},
          remaining_steps: 4,
          maximum_steps: 4,
          events_resolved: 0,
        };
      },
    },
    {
      name: "配置禁止携带的物品",
      mutate: (state: GameState): void => {
        state.expedition = {
          city_id: "city_a",
          travel_step_cost: 1,
          leader_player_index: 0,
          companion_ids: [],
          carried_items: { coins: 1 },
          loot: {},
          remaining_steps: 4,
          maximum_steps: 4,
          events_resolved: 0,
        };
      },
    },
    {
      name: "超过配置同行人数",
      mutate: (state: GameState): void => {
        state.expedition = {
          city_id: "city_a",
          travel_step_cost: 1,
          leader_player_index: 0,
          companion_ids: ["haocai", "yangguan", "linlan"],
          carried_items: {},
          loot: {},
          remaining_steps: 4,
          maximum_steps: 4,
          events_resolved: 0,
        };
      },
    },
  ])("拒绝包含$name的损坏存档", ({ mutate }) => {
    const storage = corruptedStorage(mutate);
    const restored = buildH5Harness({ storage }).application;

    expect(() => restored.loadGame()).toThrow(SaveDataError);
  });
});

describe("v3 时间线与迁移", () => {
  it("把 v2 日历进度迁移为 v3 生存日并补齐全部新增容器", () => {
    const storage = new MemoryStorage();
    const source = startedApplication();
    const sourceState = requireState(source);
    sourceState.clock = { year: 2166, month: 1, day: 11, hour: 13 };
    sourceState.turn_number = 23;
    storage.setItem(H5_TEST_STORAGE_KEY, JSON.stringify({
      schema_version: 2,
      saved_at: "2166-01-11T13:00:00.000Z",
      game_state: asV2State(sourceState),
    }));
    const application = buildH5Harness({ storage }).application;

    application.loadGame();

    const migrated = requireState(application);
    expect(migrated.survival_days).toBe(10);
    expect(migrated.communication_log).toEqual([]);
    expect(migrated.weekly_archives).toEqual([]);
    expect(migrated.checkpoint).toBeNull();
    expect(migrated.inventory).toEqual({
      crafted_items: {},
      equipped_weapon_id: null,
      equipped_armor_id: null,
    });
    expect(migrated.research).toEqual({ completed_project_ids: [] });
    expect(migrated.expedition).toBeNull();
    expect(migrated.turn_number).toBe(23);
  });

  it("第7日封存周档案并清空旧通讯，只保留归档通知", () => {
    const application = startedApplication();
    const state = requireState(application);
    const chronicle = new ChronicleService(application.content);

    for (let day = 1; day <= 7; day += 1) {
      completeTimelineDay(chronicle, state, day);
    }

    expect(state.survival_days).toBe(7);
    expect(state.weekly_archives).toHaveLength(1);
    expect(state.weekly_archives[0]).toMatchObject({
      week_number: 1,
      start_date: { year: 2166, month: 1, day: 1 },
      end_date: { year: 2166, month: 1, day: 7 },
    });
    expect(state.weekly_archives[0]?.entries.some((entry) => (
      entry.message === "第1日记录"
    ))).toBe(true);
    expect(state.weekly_archives[0]?.summary).toContain("远征与经营");
    expect(state.weekly_archives[0]?.summary).not.toContain("主线");
    expect(state.communication_log.some((entry) => entry.message === "第1日记录"))
      .toBe(false);
    expect(state.communication_log).toHaveLength(1);
    expect(state.communication_log[0]?.message).toContain("第1周");
  });

  it("第10日生成无递归检查点，回档恢复进度且保留检查点", () => {
    const application = startedApplication();
    const state = requireState(application);
    const chronicle = new ChronicleService(application.content);
    for (let day = 1; day <= 10; day += 1) {
      completeTimelineDay(chronicle, state, day);
    }
    const checkpoint = state.checkpoint;
    if (checkpoint === null) throw new Error("第10日没有生成检查点。");
    const savedFood = requirePlayer(state).food;

    expect(checkpoint.survival_day).toBe(10);
    expect(Object.hasOwn(checkpoint.snapshot, "checkpoint")).toBe(false);

    requirePlayer(state).food = savedFood + 99;
    state.story.flags.push("checkpoint_should_remove");
    state.survival_days = 12;
    const report = application.rollbackToCheckpoint();
    const restored = requireState(application);

    expect(report.stateChanged).toBe(true);
    expect(restored.survival_days).toBe(10);
    expect(requirePlayer(restored).food).toBe(savedFood);
    expect(restored.story.flags).not.toContain("checkpoint_should_remove");
    expect(restored.checkpoint).toEqual(checkpoint);
  });
});

describe("行动饥饿白名单", () => {
  it("零增量行动与正增量行动都由完整配置显式声明", () => {
    const application = startedApplication();
    const costs = application.content.game.rules.action_hunger_costs;
    const zeroCostActions = [
      "default",
      "story",
      "recruit",
      "research",
      "crafting",
      "equipment",
      "use_food",
      "use_medicine",
      "feed_shelter",
    ];
    for (const actionType of zeroCostActions) {
      expect(costs[actionType], actionType).toEqual({
        player_hunger_gain: 0,
        group_hunger_gain_per_person: 0,
      });
    }
    expect(costs.exploration).toEqual({
      player_hunger_gain: 4,
      group_hunger_gain_per_person: 2,
    });
    expect(costs.combat).toEqual({
      player_hunger_gain: 3,
      group_hunger_gain_per_person: 2,
    });
    expect(costs.facility).toEqual({
      player_hunger_gain: 3,
      group_hunger_gain_per_person: 1,
    });
    expect(costs.job).toEqual({
      player_hunger_gain: 4,
      group_hunger_gain_per_person: 2,
    });
    expect(costs.repair_shelter).toEqual({
      player_hunger_gain: 3,
      group_hunger_gain_per_person: 1,
    });
  });
});
