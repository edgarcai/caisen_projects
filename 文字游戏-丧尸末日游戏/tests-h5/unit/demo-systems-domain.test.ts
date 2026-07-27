import { describe, expect, it } from "vitest";
import { demoSystemsConfig, parseDemoSystemsConfig } from "../../src/config/demoSystemsConfig";
import type { EncounterBattleConfig, EncounterPartyMemberInput } from "../../src/domain/demo-systems";
import type { RandomSource } from "../../src/domain/ports";
import { ArchiveStorageService } from "../../src/services/ArchiveStorageService";
import { EncounterBattleService } from "../../src/services/EncounterBattleService";
import { ReturnIncidentService } from "../../src/services/ReturnIncidentService";
import { StateOperations } from "../../src/services/StateOperations";
import { buildH5Harness, requirePlayer, requireState } from "../helpers/H5TestHarness";

/** 为三套 Demo 领域服务提供可复现的整数和加权选择。 */
class DemoRandomSource implements RandomSource {
  private readonly integers: number[];
  private readonly choices: number[];

  /** 保存预设队列；耗尽后使用整数上界和首个加权候选。 */
  public constructor(integers: readonly number[] = [], choices: readonly number[] = []) {
    this.integers = [...integers];
    this.choices = [...choices];
  }

  /** 返回队首整数，并拒绝测试脚本提供越界数据。 */
  public randint(minimum: number, maximum: number): number {
    const value = this.integers.shift() ?? maximum;
    if (value < minimum || value > maximum) {
      throw new RangeError(`测试随机值 ${String(value)} 超出 ${String(minimum)}..${String(maximum)}。`);
    }
    return value;
  }

  /** 按预设索引选中一个加权候选项。 */
  public weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError("测试加权候选项无效。");
    }
    const item = items[this.choices.shift() ?? 0];
    if (item === undefined) throw new RangeError("测试加权索引越界。");
    return item;
  }
}

/** 返回包含前后排、攻击与治疗技能的两人测试小队。 */
function demoParty(): EncounterPartyMemberInput[] {
  return [
    {
      member_id: "leader",
      name: "所长",
      row: "front",
      maximum_health: 100,
      attack: 120,
      defense: 12,
      agility: 9,
      skill_ids: ["crushing_blow", "catch_breath"],
    },
    {
      member_id: "medic",
      name: "医师",
      row: "back",
      maximum_health: 82,
      attack: 26,
      defense: 7,
      agility: 11,
      skill_ids: ["field_first_aid"],
    },
  ];
}

/** 创建一份只有单体弱敌人的配置，便于验证明确胜负。 */
function singleEnemyConfig(options: {
  readonly enemyHealth: number;
  readonly enemyAttack: number;
}): EncounterBattleConfig {
  const config = structuredClone(demoSystemsConfig.encounter_battle);
  return {
    ...config,
    encounters: [{
      encounter_id: "test_encounter",
      name: "测试遭遇",
      description: "只用于验证领域回合。",
      enemies: [{
        enemy_id: "test_enemy",
        name: "测试感染者",
        row: "front",
        maximum_health: options.enemyHealth,
        attack: options.enemyAttack,
        defense: 0,
        agility: 1,
        intents: [{
          intent_id: "test_attack",
          label: "测试攻击",
          description: "攻击单个前排目标。",
          kind: "attack_single",
          power_percent: 100,
          weight: 1,
        }],
      }],
    }],
  };
}

describe("Demo 系统配置", () => {
  it("加载三套配置并满足事项和文献的内容数量门槛", () => {
    const requirements = demoSystemsConfig.content_requirements;
    expect(demoSystemsConfig.encounter_battle.encounters).toHaveLength(3);
    expect(demoSystemsConfig.encounter_battle.preparation.roles.map(
      (role) => role.label,
    )).toEqual(["牵制", "攻击", "游走", "救护"]);
    expect(demoSystemsConfig.encounter_battle.preparation.treatment_cost).toBeGreaterThan(0);
    expect(demoSystemsConfig.return_incidents.incidents.length).toBeGreaterThanOrEqual(
      requirements.minimum_return_incidents,
    );
    expect(demoSystemsConfig.return_incidents.incidents.every(
      (incident) => incident.choices.length >= requirements.minimum_incident_choices,
    )).toBe(true);
    expect(demoSystemsConfig.archive_storage.collections.length).toBeGreaterThanOrEqual(
      requirements.minimum_archive_collections,
    );
    for (const collection of demoSystemsConfig.archive_storage.collections) {
      expect(collection.documents.length).toBeGreaterThanOrEqual(
        requirements.minimum_documents_per_collection,
      );
      expect(collection.documents.every((document) => document.body.length > 80)).toBe(true);
    }
  });

  it("由 content_requirements 分别约束事项、选择、文献分类和正文数量", () => {
    const requirements = demoSystemsConfig.content_requirements;
    const stricterDocuments = [
      {
        ...demoSystemsConfig,
        content_requirements: {
          ...requirements,
          minimum_return_incidents:
            demoSystemsConfig.return_incidents.incidents.length + 1,
        },
      },
      {
        ...demoSystemsConfig,
        content_requirements: {
          ...requirements,
          minimum_incident_choices:
            Math.max(...demoSystemsConfig.return_incidents.incidents.map(
              (incident) => incident.choices.length,
            )) + 1,
        },
      },
      {
        ...demoSystemsConfig,
        content_requirements: {
          ...requirements,
          minimum_archive_collections:
            demoSystemsConfig.archive_storage.collections.length + 1,
        },
      },
      {
        ...demoSystemsConfig,
        content_requirements: {
          ...requirements,
          minimum_documents_per_collection:
            Math.max(...demoSystemsConfig.archive_storage.collections.map(
              (collection) => collection.documents.length,
            )) + 1,
        },
      },
    ];

    for (const document of stricterDocuments) {
      expect(() => parseDemoSystemsConfig(document)).toThrow(/至少需要/);
    }
  });

  it("启动期拒绝负数普通攻击倍率", () => {
    const invalid = {
      ...demoSystemsConfig,
      encounter_battle: {
        ...demoSystemsConfig.encounter_battle,
        rules: {
          ...demoSystemsConfig.encounter_battle.rules,
          basic_attack_power_percent: -1,
        },
      },
    };

    expect(() => parseDemoSystemsConfig(invalid)).toThrow(/basic_attack_power_percent/);
  });

  it("启动期拒绝重复事项稳定 ID", () => {
    const first = demoSystemsConfig.return_incidents.incidents[0];
    const second = demoSystemsConfig.return_incidents.incidents[1];
    if (first === undefined || second === undefined) throw new Error("测试配置缺少事项。");
    const invalid = {
      ...demoSystemsConfig,
      return_incidents: {
        ...demoSystemsConfig.return_incidents,
        incidents: demoSystemsConfig.return_incidents.incidents.map((incident, index) => (
          index === 1 ? { ...incident, incident_id: first.incident_id } : incident
        )),
      },
    };
    expect(() => parseDemoSystemsConfig(invalid)).toThrow(/重复稳定 ID/);
  });
});

describe("手动遭遇战", () => {
  it("公开敌人意图并由前排阻挡对后排敌人的单体攻击", () => {
    const service = new EncounterBattleService(
      demoSystemsConfig.encounter_battle,
      new DemoRandomSource(),
    );
    const state = service.start("parking_horde", demoParty(), { trauma_kit: 1 });
    const attack = service.availableActions(state, "leader").find(
      (action) => action.action === "attack",
    );

    expect(service.enemyIntents(state)).toHaveLength(3);
    expect(attack?.targetIds).toEqual(["parking_brute", "parking_runner"]);
    expect(attack?.targetIds).not.toContain("parking_howler");
  });

  it("普通攻击使用配置化攻击倍率", () => {
    const baseConfig = singleEnemyConfig({ enemyHealth: 100, enemyAttack: 1 });
    const config: EncounterBattleConfig = {
      ...baseConfig,
      rules: {
        ...baseConfig.rules,
        basic_attack_power_percent: 50,
        critical_chance_percent: 0,
      },
    };
    const service = new EncounterBattleService(config, new DemoRandomSource());
    const result = service.performAction(
      service.start("test_encounter", demoParty().slice(0, 1)),
      { action: "attack", actor_id: "leader", target_id: "test_enemy" },
    );

    expect(result.state.enemies[0]?.health).toBe(40);
  });

  it("逐人执行攻击与防御，最后一人行动后结算敌方阶段和下一回合", () => {
    const service = new EncounterBattleService(
      demoSystemsConfig.encounter_battle,
      new DemoRandomSource(),
    );
    const original = service.start("parking_horde", demoParty());
    const first = service.performAction(original, {
      action: "attack",
      actor_id: "leader",
      target_id: "parking_brute",
    });

    expect(original.enemies[0]?.health).toBe(96);
    expect(first.state.enemies[0]?.health).toBe(0);
    expect(first.state.pending_party_member_ids).toEqual(["medic"]);
    expect(first.roundAdvanced).toBe(false);

    const second = service.performAction(first.state, {
      action: "guard",
      actor_id: "medic",
    });
    expect(second.roundAdvanced).toBe(true);
    expect(second.state.round_number).toBe(2);
    expect(second.state.pending_party_member_ids).toEqual(["leader", "medic"]);
    expect(second.messages.some((message) => message.includes("第 2 回合"))).toBe(true);
    expect(second.state.party[0]?.health).toBeLessThan(100);
  });

  it("技能具有冷却、物品会消耗库存且输入快照保持不变", () => {
    const service = new EncounterBattleService(
      singleEnemyConfig({ enemyHealth: 500, enemyAttack: 1 }),
      new DemoRandomSource(),
    );
    const party = demoParty().slice(0, 1);
    const start = service.start("test_encounter", party, { trauma_kit: 1 });
    const skill = service.performAction(start, {
      action: "skill",
      actor_id: "leader",
      ability_id: "crushing_blow",
      target_id: "test_enemy",
    });

    expect(start.party[0]?.skill_cooldowns.crushing_blow).toBe(0);
    expect(skill.state.party[0]?.skill_cooldowns.crushing_blow).toBe(2);
    const skillView = service.availableActions(skill.state, "leader").find(
      (action) => action.abilityId === "crushing_blow",
    );
    expect(skillView?.available).toBe(false);
    expect(skillView?.unavailableReason).toContain("冷却");

    const leader = skill.state.party[0];
    if (leader === undefined) throw new Error("测试战斗缺少所长。");
    leader.health = 40;
    const item = service.performAction(skill.state, {
      action: "item",
      actor_id: "leader",
      ability_id: "trauma_kit",
      target_id: "leader",
    });
    expect(item.state.supplies.trauma_kit).toBe(0);
    expect(item.state.party[0]?.health).toBeGreaterThan(40);
  });

  it("支持敏捷判定撤退、主动击败敌人和敌方击败小队", () => {
    const retreatService = new EncounterBattleService(
      singleEnemyConfig({ enemyHealth: 30, enemyAttack: 1 }),
      new DemoRandomSource([1]),
    );
    const retreated = retreatService.performAction(
      retreatService.start("test_encounter", demoParty().slice(0, 1)),
      { action: "retreat", actor_id: "leader" },
    );
    expect(retreated.state.outcome).toBe("retreated");

    const victoryService = new EncounterBattleService(
      singleEnemyConfig({ enemyHealth: 1, enemyAttack: 1 }),
      new DemoRandomSource(),
    );
    const victory = victoryService.performAction(
      victoryService.start("test_encounter", demoParty().slice(0, 1)),
      { action: "attack", actor_id: "leader", target_id: "test_enemy" },
    );
    expect(victory.state.outcome).toBe("victory");

    const defeatService = new EncounterBattleService(
      singleEnemyConfig({ enemyHealth: 999, enemyAttack: 999 }),
      new DemoRandomSource(),
    );
    const fragileLeader = demoParty()[0];
    if (fragileLeader === undefined) throw new Error("测试小队缺少所长。");
    const fragileParty = [{ ...fragileLeader, health: 1 }];
    const defeat = defeatService.performAction(
      defeatService.start("test_encounter", fragileParty),
      { action: "guard", actor_id: "leader" },
    );
    expect(defeat.state.outcome).toBe("defeat");
  });
});

describe("探索归来事项", () => {
  it("按概率和权重生成事项并允许排除近期重复事件", () => {
    const harness = buildH5Harness();
    harness.application.startNewGame(["事项测试员"], "single");
    const state = requireState(harness.application);
    const random = new DemoRandomSource([1], [1]);
    const service = new ReturnIncidentService(
      demoSystemsConfig.return_incidents,
      new StateOperations(random),
      random,
    );
    const firstIncident = demoSystemsConfig.return_incidents.incidents[0];
    if (firstIncident === undefined) throw new Error("测试配置缺少事项。");
    const excluded = [firstIncident.incident_id];
    const prompt = service.tryDraw(state, excluded);

    expect(prompt).not.toBeNull();
    expect(prompt?.incidentId).not.toBe(excluded[0]);
  });

  it("未达到触发概率时不生成事项", () => {
    const harness = buildH5Harness();
    harness.application.startNewGame(["静夜测试员"], "single");
    const state = requireState(harness.application);
    const random = new DemoRandomSource([100]);
    const service = new ReturnIncidentService(
      demoSystemsConfig.return_incidents,
      new StateOperations(random),
      random,
    );
    expect(service.tryDraw(state)).toBeNull();
  });

  it("根据资源灰显选择，并在副本中原子结算资源、希望和活动度", () => {
    const harness = buildH5Harness();
    harness.application.startNewGame(["裁决测试员"], "single");
    const state = requireState(harness.application);
    const player = requirePlayer(state);
    player.food = 0;
    const random = new DemoRandomSource([6]);
    const service = new ReturnIncidentService(
      demoSystemsConfig.return_incidents,
      new StateOperations(random),
      random,
    );
    const locked = service.prompt(state, "quarantine_knock");
    expect(locked.choices[0]?.available).toBe(false);
    const before = JSON.stringify(state);
    expect(() => service.resolve(state, "quarantine_knock", "accept")).toThrow(/食物/);
    expect(JSON.stringify(state)).toBe(before);

    player.food = 10;
    const population = state.shelter.population;
    const hope = state.shelter.hope;
    const resolution = service.resolve(state, "quarantine_knock", "accept");
    expect(requirePlayer(state).food).toBe(6);
    expect(state.shelter.population).toBe(population + 1);
    expect(state.shelter.hope).toBe(hope + 6);
    expect(state.shelter.activity).toBeGreaterThan(0);
    expect(resolution.message).toContain("隔离门外的三声敲击");
  });
});

describe("文献存储目录", () => {
  it("每收集一份报纸按顺序多解锁一篇正文", () => {
    const harness = buildH5Harness();
    harness.application.startNewGame(["馆员"], "single");
    const state = requireState(harness.application);
    const service = new ArchiveStorageService(demoSystemsConfig.archive_storage);
    service.initializeProgress(state);
    const operations = new StateOperations(new DemoRandomSource(), [service]);

    expect(service.list(state, "newspapers").filter((item) => item.unlocked)).toHaveLength(0);
    operations.write("shelter.newspapers", 1, state);
    const directory = service.list(state, "newspapers");
    expect(directory.filter((item) => item.unlocked)).toHaveLength(1);
    expect(service.detail(state, "newspapers", "newspaper_01").body.length).toBeGreaterThan(80);
    expect(() => service.detail(state, "newspapers", "newspaper_02")).toThrow(/需要收集 2 份/);
  });

  it("研发消耗不会重新上锁，再次收集会继续累计解锁", () => {
    const harness = buildH5Harness();
    harness.application.startNewGame(["馆藏测试员"], "single");
    const state = requireState(harness.application);
    const service = new ArchiveStorageService(demoSystemsConfig.archive_storage);
    service.initializeProgress(state);
    const operations = new StateOperations(new DemoRandomSource(), [service]);

    operations.write("shelter.books", 1, state);
    expect(service.detail(state, "books", "book_01").document_id).toBe("book_01");
    operations.write("shelter.books", 0, state);
    expect(service.detail(state, "books", "book_01").document_id).toBe("book_01");

    operations.write("shelter.books", 1, state);
    expect(state.archive_collection_totals.books).toBe(2);
    expect(service.detail(state, "books", "book_02").document_id).toBe("book_02");
  });

  it("研发扣除旧书后仍可阅读并在读档后保留解锁", () => {
    const harness = buildH5Harness();
    harness.application.startNewGame(["存档馆员"], "single");
    const state = requireState(harness.application);
    state.shelter.books = 1;
    state.archive_collection_totals.books = 1;
    requirePlayer(state).parts = 8;

    expect(harness.application.archiveDetail("books", "book_01").document_id).toBe("book_01");
    expect(harness.application.completeResearch("field_logistics").stateChanged).toBe(true);
    expect(state.shelter.books).toBe(0);
    expect(harness.application.archiveDetail("books", "book_01").document_id).toBe("book_01");
    harness.application.saveGame();

    const restored = buildH5Harness({ storage: harness.storage });
    restored.application.loadGame();
    expect(restored.application.archiveDetail("books", "book_01").document_id).toBe("book_01");
    expect(requireState(restored.application).archive_collection_totals.books).toBe(1);
  });

  it("分别统计报纸和书籍，并报告一次收集新解锁的正文", () => {
    const harness = buildH5Harness();
    harness.application.startNewGame(["档案测试员"], "single");
    const state = requireState(harness.application);
    state.shelter.newspapers = 3;
    state.shelter.books = 8;
    const service = new ArchiveStorageService(demoSystemsConfig.archive_storage);
    service.initializeProgress(state);
    const overview = service.overview(state);

    expect(overview.find((item) => item.collectionId === "newspapers")?.unlockedDocuments)
      .toBe(3);
    expect(overview.find((item) => item.collectionId === "books")?.unlockedDocuments)
      .toBe(8);
    expect(service.newlyUnlocked("newspapers", 2, 5).map((item) => item.document_id))
      .toEqual(["newspaper_03", "newspaper_04", "newspaper_05"]);
  });
});
