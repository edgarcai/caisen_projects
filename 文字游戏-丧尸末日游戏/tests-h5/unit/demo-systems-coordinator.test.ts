import { describe, expect, it } from "vitest";
import survivalSystemsDocument from "../../config/survival_systems.json";
import { demoSystemsConfig } from "../../src/config/demoSystemsConfig";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type {
  DemoSystemsConfig,
  EncounterPreparationMember,
  EncounterPreparationSnapshot,
} from "../../src/domain/demo-systems";
import type { GameMode, GameState } from "../../src/domain/game-state";
import type {
  EncounterPartyAttributeProvider,
  RandomSource,
} from "../../src/domain/ports";
import type {
  EffectivePlayerAttributes,
  PlayerCombatAttribute,
} from "../../src/domain/survival-systems";
import { ArchiveStorageService } from "../../src/services/ArchiveStorageService";
import { DemoSystemsCoordinator } from "../../src/services/DemoSystemsCoordinator";
import { EncounterBattleService } from "../../src/services/EncounterBattleService";
import type { GameContent } from "../../src/services/GameContent";
import { ReturnIncidentService } from "../../src/services/ReturnIncidentService";
import { StateOperations } from "../../src/services/StateOperations";
import { buildH5Harness, requirePlayer, requireState } from "../helpers/H5TestHarness";

/** 为协调器测试提供可复现的整数与加权抽取，并暴露调用次数。 */
class CoordinatorRandomSource implements RandomSource {
  public integerCalls = 0;
  public weightedChoiceCalls = 0;
  private readonly integers: number[];
  private readonly choiceIndexes: number[];

  /** 保存预设随机队列；耗尽时选择整数上界和首个加权候选。 */
  public constructor(
    integers: readonly number[] = [],
    choiceIndexes: readonly number[] = [],
  ) {
    this.integers = [...integers];
    this.choiceIndexes = [...choiceIndexes];
  }

  /** 返回闭区间中的下一个预设整数。 */
  public randint(minimum: number, maximum: number): number {
    this.integerCalls += 1;
    const value = this.integers.shift() ?? maximum;
    if (value < minimum || value > maximum) {
      throw new RangeError(`测试随机值 ${String(value)} 超出 ${String(minimum)}..${String(maximum)}。`);
    }
    return value;
  }

  /** 返回预设索引对应的加权候选项。 */
  public weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    this.weightedChoiceCalls += 1;
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError("测试加权候选项无效。");
    }
    const selected = items[this.choiceIndexes.shift() ?? 0];
    if (selected === undefined) throw new RangeError("测试加权索引越界。");
    return selected;
  }
}

/** 按玩家索引返回独立属性，便于验证小队投影没有混用所长数据。 */
class IndexedAttributeProvider implements EncounterPartyAttributeProvider {
  private readonly values: readonly EffectivePlayerAttributes[];

  /** 保存各玩家的测试属性。 */
  public constructor(values: readonly EffectivePlayerAttributes[]) {
    this.values = values;
  }

  /** 返回指定玩家的一项有效属性。 */
  public effectiveAttribute(
    state: GameState,
    attribute: PlayerCombatAttribute,
    playerIndex: number = state.active_player_index,
  ): number {
    return this.attributesAt(playerIndex)[attribute];
  }

  /** 返回指定玩家的完整有效属性副本。 */
  public effectiveAttributes(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): EffectivePlayerAttributes {
    return { ...this.attributesAt(playerIndex) };
  }

  /** 返回协调器传入的伙伴显式基线，避免测试替身引入装备规则。 */
  public effectiveCompanionAttributes(
    _state: GameState,
    _companionId: string,
    baseline: EffectivePlayerAttributes,
  ): EffectivePlayerAttributes {
    return { ...baseline };
  }

  /** 返回指定玩家的有效战斗力。 */
  public combatPower(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): number {
    const attributes = this.effectiveAttributes(state, playerIndex);
    return attributes.attack + attributes.defense + attributes.agility;
  }

  /** 要求测试已为玩家索引提供属性。 */
  private attributesAt(playerIndex: number): EffectivePlayerAttributes {
    const attributes = this.values[playerIndex];
    if (attributes === undefined) {
      throw new RangeError(`测试属性索引 ${String(playerIndex)} 越界。`);
    }
    return attributes;
  }
}

interface CoordinatorHarness {
  readonly coordinator: DemoSystemsCoordinator;
  readonly random: CoordinatorRandomSource;
  readonly state: GameState;
}

/** 创建真实领域服务组成的协调器测试夹具。 */
function buildCoordinatorHarness(options: {
  readonly config?: DemoSystemsConfig;
  readonly mode?: GameMode;
  readonly playerNames?: readonly string[];
  readonly integers?: readonly number[];
  readonly choiceIndexes?: readonly number[];
  readonly attributes?: readonly EffectivePlayerAttributes[];
} = {}): CoordinatorHarness {
  const applicationHarness = buildH5Harness();
  const mode = options.mode ?? "single";
  const playerNames = options.playerNames ?? ["测试所长"];
  applicationHarness.application.startNewGame(playerNames, mode);
  const config = options.config ?? demoSystemsConfig;
  const random = new CoordinatorRandomSource(
    options.integers,
    options.choiceIndexes,
  );
  const operations = new StateOperations(random);
  const attributes = options.attributes ?? [{ attack: 37, defense: 11, agility: 8 }];
  return {
    coordinator: createCoordinator(
      config,
      random,
      operations,
      new IndexedAttributeProvider(attributes),
      applicationHarness.application.content,
    ),
    random,
    state: requireState(applicationHarness.application),
  };
}

/** 使用共享配置、随机源和状态操作器装配协调器。 */
function createCoordinator(
  config: DemoSystemsConfig,
  random: RandomSource,
  operations: StateOperations,
  attributes: EncounterPartyAttributeProvider,
  content: GameContent,
): DemoSystemsCoordinator {
  return new DemoSystemsCoordinator(
    config,
    new EncounterBattleService(config.encounter_battle, random),
    new ReturnIncidentService(config.return_incidents, operations, random),
    new ArchiveStorageService(config.archive_storage),
    attributes,
    content,
  );
}

/** 从战前整备快照中返回指定成员，缺失时立即阻断测试。 */
function requirePreparationMember(
  snapshot: EncounterPreparationSnapshot,
  memberId: string,
): EncounterPreparationMember {
  const member = snapshot.members.find((candidate) => candidate.member_id === memberId);
  if (member === undefined) throw new Error(`战前整备缺少成员 ${memberId}。`);
  return member;
}

/** 返回一份仅调整战斗物品初始数量的不可变测试配置。 */
function configWithStartingQuantities(
  quantities: Readonly<Record<string, number>>,
): DemoSystemsConfig {
  return {
    ...demoSystemsConfig,
    encounter_battle: {
      ...demoSystemsConfig.encounter_battle,
      items: demoSystemsConfig.encounter_battle.items.map((item) => ({
        ...item,
        starting_quantity: quantities[item.item_id] ?? item.starting_quantity,
      })),
    },
  };
}

/** 为测试遭遇中的全部单位生成同一职责且不治疗的有效整备方案。 */
function encounterPlan(
  coordinator: DemoSystemsCoordinator,
  state: GameState,
  encounterId: string,
  roleId = "containment",
) {
  const preparation = coordinator.encounterPreparation(state, encounterId);
  return {
    role_ids_by_member: Object.fromEntries(
      preparation.members.map((member) => [member.member_id, roleId]),
    ),
    treated_member_ids: [],
  };
}

describe("Demo 系统协调器", () => {
  it("战前职责与治疗在开战时原子结算，并同步所长生命与医疗库存", () => {
    const { coordinator, state } = buildCoordinatorHarness({
      attributes: [{ attack: 40, defense: 20, agility: 10 }],
    });
    const player = requirePlayer(state);
    player.health = 42;
    player.medical_supplies = 5;
    const plan = encounterPlan(coordinator, state, "parking_horde", "assault");
    const messages = coordinator.startEncounter(state, "parking_horde", {
      ...plan,
      treated_member_ids: ["player:0"],
    });

    expect(player.medical_supplies).toBe(2);
    expect(player.health).toBe(72);
    expect(state.encounter_battle?.party.find(
      (member) => member.member_id === "player:0",
    )).toMatchObject({
      health: 72,
      row: "front",
      attack: 56,
      defense: 16,
      agility: 10,
    });
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining("战前整备完成"),
      expect.stringContaining("担任【攻击】"),
      expect.stringContaining("恢复 30 点生命"),
    ]));
  });

  it("职责缺失或医疗物资不足时拒绝开战且不产生部分扣除", () => {
    const { coordinator, state } = buildCoordinatorHarness();
    const player = requirePlayer(state);
    player.health = 30;
    player.medical_supplies = 2;
    const completePlan = encounterPlan(coordinator, state, "parking_horde");

    expect(() => coordinator.startEncounter(state, "parking_horde", {
      ...completePlan,
      role_ids_by_member: {},
    })).toThrow("必须为每名参战单位分配职责");
    expect(() => coordinator.startEncounter(state, "parking_horde", {
      ...completePlan,
      treated_member_ids: ["player:0"],
    })).toThrow("当前只有 2 份");
    expect(state.encounter_battle).toBeNull();
    expect(player.health).toBe(30);
    expect(player.medical_supplies).toBe(2);
  });

  it("按配置化 starting_quantity 创建每场独立战术库存", () => {
    const config = configWithStartingQuantities({
      trauma_kit: 7,
      field_ration: 0,
      incendiary_bottle: 4,
    });
    const { coordinator, state } = buildCoordinatorHarness({ config });

    coordinator.startEncounter(
      state,
      "parking_horde",
      encounterPlan(coordinator, state, "parking_horde"),
    );

    expect(state.encounter_battle?.supplies).toEqual({
      trauma_kit: 7,
      field_ration: 0,
      incendiary_bottle: 4,
    });
    if (state.encounter_battle === null) throw new Error("协调器未创建遭遇战。");
    state.encounter_battle.supplies.trauma_kit = 1;
    expect(config.encounter_battle.items.map((item) => item.starting_quantity))
      .toEqual([7, 0, 4]);
  });

  it("按远征选择组建玩家与伙伴小队，并在手动回合后同步玩家生命", () => {
    const { coordinator, state } = buildCoordinatorHarness({
      mode: "multiplayer",
      playerNames: ["北辰", "南乔"],
      attributes: [
        { attack: 41, defense: 3, agility: 7 },
        { attack: 63, defense: 4, agility: 12 },
      ],
    });
    state.active_player_index = 1;
    state.expedition = {
      city_id: "city_a",
      district_id: "city_a_district_a",
      travel_step_cost: 1,
      leader_player_index: 1,
      companion_ids: ["yangguan"],
      carried_items: {},
      loot: {},
      remaining_steps: 10,
      maximum_steps: 10,
      events_resolved: 0,
    };

    coordinator.startEncounter(
      state,
      "parking_horde",
      encounterPlan(coordinator, state, "parking_horde", "assault"),
    );
    const battle = state.encounter_battle;
    if (battle === null) throw new Error("协调器未创建遭遇战。");
    expect(battle.party.map((member) => member.member_id)).toEqual([
      "player:0",
      "player:1",
      "companion:yangguan",
    ]);
    expect(battle.party.map((member) => member.name)).toEqual(["北辰", "南乔", "阳关"]);
    expect(battle.party.find((member) => member.member_id === "player:0")?.attack).toBe(57);
    expect(battle.party.find((member) => member.member_id === "player:1")?.attack).toBe(88);
    const assaultRole = demoSystemsConfig.encounter_battle.preparation.roles.find(
      (role) => role.role_id === "assault",
    );
    if (assaultRole === undefined) throw new Error("测试配置缺少攻击职责。");
    const referencePlayer = requirePlayer(state, state.active_player_index);
    expect(battle.party.find((member) => member.member_id === "companion:yangguan")?.attack)
      .toBe(Math.floor((referencePlayer.attack * assaultRole.attack_percent) / 100));
    expect(battle.party.some((member) => member.member_id === "companion:haocai"))
      .toBe(false);
    expect(coordinator.availableEncounterActions(state, "player:0").map(
      (action) => action.action,
    )).toEqual(expect.arrayContaining(["attack", "guard", "skill", "item", "retreat"]));

    const firstAction = coordinator.performEncounterAction(state, {
      action: "attack",
      actor_id: "player:0",
      target_id: "parking_brute",
    });
    expect(firstAction.state.enemies[0]?.health).toBeLessThan(96);
    const remainingActors = [...firstAction.state.pending_party_member_ids];
    let lastResolution = firstAction;
    for (const actorId of remainingActors) {
      lastResolution = coordinator.performEncounterAction(state, {
        action: "guard",
        actor_id: actorId,
      });
    }

    expect(lastResolution.roundAdvanced).toBe(true);
    expect(state.encounter_battle?.round_number).toBe(2);
    for (const playerIndex of [0, 1]) {
      const player = requirePlayer(state, playerIndex);
      const member = state.encounter_battle?.party.find(
        (candidate) => candidate.member_id === `player:${String(playerIndex)}`,
      );
      expect(member).toBeDefined();
      expect(player.health).toBe(member?.health);
      expect(player.health).toBeLessThan(100);
    }
  });

  it("伙伴装备与卸下武器防具会独立改变战前属性", () => {
    const { application } = buildH5Harness();
    application.startNewGame(["测试所长"], "single");
    const state = requireState(application);
    const equipmentConfig = validateSurvivalSystemsConfig(survivalSystemsDocument);
    const cases = [
      { itemId: "pipe_rifle", slot: "weapon" },
      { itemId: "reinforced_coat", slot: "armor" },
    ] as const;
    for (const entry of cases) state.inventory.crafted_items[entry.itemId] = 1;

    for (const entry of cases) {
      const item = equipmentConfig.warehouse.crafted_items.find(
        (candidate) => candidate.item_id === entry.itemId,
      );
      if (item === undefined) throw new Error(`测试配置缺少装备 ${entry.itemId}。`);
      const before = application.encounterPreparation("parking_horde");
      const playerBefore = requirePreparationMember(before, "player:0");
      const companionBefore = requirePreparationMember(before, "companion:haocai");

      expect(application.equipCompanion(
        "haocai",
        entry.slot,
        entry.itemId,
      ).stateChanged).toBe(true);
      const equipped = application.encounterPreparation("parking_horde");
      const playerEquipped = requirePreparationMember(equipped, "player:0");
      const companionEquipped = requirePreparationMember(equipped, "companion:haocai");

      expect(playerEquipped).toMatchObject({
        attack: playerBefore.attack,
        defense: playerBefore.defense,
        agility: playerBefore.agility,
      });
      expect(companionEquipped).toMatchObject({
        attack: companionBefore.attack + (item.equipment_bonuses?.attack ?? 0),
        defense: companionBefore.defense + (item.equipment_bonuses?.defense ?? 0),
        agility: companionBefore.agility + (item.equipment_bonuses?.agility ?? 0),
      });

      expect(application.equipCompanion("haocai", entry.slot, null).stateChanged)
        .toBe(true);
      const unequipped = application.encounterPreparation("parking_horde");
      const playerUnequipped = requirePreparationMember(unequipped, "player:0");
      const companionUnequipped = requirePreparationMember(
        unequipped,
        "companion:haocai",
      );
      expect(playerUnequipped).toMatchObject({
        attack: playerBefore.attack,
        defense: playerBefore.defense,
        agility: playerBefore.agility,
      });
      expect(companionUnequipped).toMatchObject({
        attack: companionBefore.attack,
        defense: companionBefore.defense,
        agility: companionBefore.agility,
      });
    }
  });

  it("聚合报纸和书籍完成度，并拒绝提前读取锁定正文", () => {
    const { coordinator, state } = buildCoordinatorHarness();
    state.shelter.newspapers = 1;
    state.shelter.books = 3;
    state.archive_collection_totals.newspapers = 1;
    state.archive_collection_totals.books = 3;

    const overview = coordinator.archiveOverview(state);
    const newspaperList = coordinator.archiveList(state, "newspapers");

    expect(overview.find((entry) => entry.collectionId === "newspapers")).toMatchObject({
      collectedCopies: 1,
      unlockedDocuments: 1,
      totalDocuments: 8,
    });
    expect(overview.find((entry) => entry.collectionId === "books")).toMatchObject({
      collectedCopies: 3,
      unlockedDocuments: 3,
      totalDocuments: 8,
    });
    expect(newspaperList[0]).toMatchObject({ documentId: "newspaper_01", unlocked: true });
    expect(newspaperList[1]).toMatchObject({ documentId: "newspaper_02", unlocked: false });
    expect(coordinator.archiveDetail(state, "newspapers", "newspaper_01").body)
      .toContain("市卫生署");
    expect(() => coordinator.archiveDetail(state, "newspapers", "newspaper_02"))
      .toThrow(/需要收集 2 份/);
  });

  it("归来事项只排队一次，失败选择保持待办，成功结算后清空并回写资源", () => {
    const { coordinator, random, state } = buildCoordinatorHarness({
      integers: [1, 6],
      choiceIndexes: [0],
    });
    const player = requirePlayer(state);
    player.food = 0;
    const populationBefore = state.shelter.population;
    const hopeBefore = state.shelter.hope;

    const first = coordinator.tryQueueReturnIncident(state);
    const randomCallsAfterQueue = {
      integers: random.integerCalls,
      choices: random.weightedChoiceCalls,
    };
    const repeated = coordinator.tryQueueReturnIncident(state);

    expect(first?.incidentId).toBe("quarantine_knock");
    expect(repeated).toEqual(first);
    expect(coordinator.returnIncidentPrompt(state)).toEqual(first);
    expect(state.pending_return_incident_id).toBe("quarantine_knock");
    expect(random.integerCalls).toBe(randomCallsAfterQueue.integers);
    expect(random.weightedChoiceCalls).toBe(randomCallsAfterQueue.choices);
    expect(() => coordinator.resolveReturnIncident(state, "accept")).toThrow(/食物/);
    expect(state.pending_return_incident_id).toBe("quarantine_knock");

    player.food = 10;
    const resolution = coordinator.resolveReturnIncident(state, "accept");

    expect(resolution).toMatchObject({
      incidentId: "quarantine_knock",
      choiceId: "accept",
      stateChanged: true,
    });
    expect(resolution.message).toContain("隔离门外的三声敲击");
    expect(requirePlayer(state).food).toBe(6);
    expect(state.shelter.population).toBe(populationBefore + 1);
    expect(state.shelter.hope).toBe(hopeBefore + 6);
    expect(state.pending_return_incident_id).toBeNull();
    expect(coordinator.returnIncidentPrompt(state)).toBeNull();
  });
});
