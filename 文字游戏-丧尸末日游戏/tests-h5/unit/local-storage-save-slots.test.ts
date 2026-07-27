import { describe, expect, it } from "vitest";
import gameConfigDocument from "../../config/game_config.json";
import type { GameMode, GameState } from "../../src/domain/game-state";
import { SaveDataError } from "../../src/domain/errors";
import {
  LocalStorageSaveRepository,
  MemoryStorage,
  type SaveStateValidationPort,
} from "../../src/infrastructure";

const STORAGE_KEY = "slot-repository-test";
const SLOT_COUNT = 3;
const BACKUP_COUNT = 2;
const SAVED_AT = "2166-04-05T06:07:08.000Z";

/** 为仓库单元测试提供不引入内容配置的结构透传校验端口。 */
class PassThroughSaveValidator implements SaveStateValidationPort {
  /** 原样返回 v1 测试数据。 */
  public validateRawV1(rawState: unknown): unknown {
    return rawState;
  }

  /** 原样返回 v2 测试数据。 */
  public validateRawV2(rawState: unknown): unknown {
    return rawState;
  }

  /** 原样返回 v3 测试数据。 */
  public validateRawV3(rawState: unknown): unknown {
    return rawState;
  }

  /** 接受测试创建的完整领域状态。 */
  public validate(state: GameState): void {
    void state;
    // 测试只验证仓库选槽、键名和备份职责，领域结构由专用校验器测试负责。
  }

  /** 把测试 JSON 深拷贝为隔离的游戏状态。 */
  public parse(rawState: unknown): GameState {
    return structuredClone(rawState) as GameState;
  }
}

interface StateOptions {
  readonly mode?: GameMode;
  readonly playerNames?: readonly string[];
  readonly survivalDays?: number;
  readonly hour?: number;
  readonly difficultyId?: string;
  readonly originId?: string;
  readonly traitId?: string;
  readonly homeCityId?: string;
}

/** 根据权威内容配置解析测试城市的默认区划。 */
function configuredDefaultDistrictId(cityId: string): string {
  const city = gameConfigDocument.cities.find((candidate) => candidate.id === cityId);
  if (city === undefined) {
    throw new Error(`测试城市 ${cityId} 未在内容配置中声明。`);
  }
  return city.default_district_id;
}

/** 创建包含最新 campaign 与远征步数成本字段的完整测试状态。 */
function createState(options: StateOptions = {}): GameState {
  const playerNames = options.playerNames ?? ["白菜"];
  return {
    mode: options.mode ?? "single",
    campaign: {
      difficulty_id: options.difficultyId ?? "survivor",
      origin_id: options.originId ?? "old_city_patrol",
      trait_id: options.traitId ?? "meticulous",
      home_city_id: options.homeCityId ?? "city_a",
    },
    players: playerNames.map((name) => ({
      name,
      age: 25,
      lifespan: 95,
      health: 100,
      attack: 5,
      defense: 15,
      agility: 5,
      medical_supplies: 0,
      food: 0,
      hunger: 0,
      intelligence: 158,
      coins: 0,
      parts: 0,
      negative_status: 0,
      antidotes: 0,
    })),
    active_player_index: 0,
    shelter: {
      population: 3,
      hope: 60,
      group_hunger: 0,
      health: 200,
      defense_damage: 15,
      activity: 30,
      newspapers: 0,
      books: 0,
      magazines: 0,
      toys: 0,
      game_consoles: 0,
    },
    clock: {
      year: 2166,
      month: 4,
      day: 5,
      hour: options.hour ?? 6,
    },
    story: {
      current_scene_id: "last_pot_of_porridge",
      chapter_id: "chapter_1_hunger_speaks",
      humanity: 0,
      evidence: 0,
      infection_pressure: 0,
      completed_scene_ids: [],
      flags: [],
      key_items: [],
      boss_outcomes: {},
    },
    companions: [],
    facility_levels: {},
    battle: null,
    pending_exploration: null,
    ending: null,
    turn_number: 0,
    survival_days: options.survivalDays ?? 0,
    communication_log: [],
    weekly_archives: [],
    checkpoint: null,
    inventory: {
      crafted_items: {},
      equipped_weapon_id: null,
      equipped_armor_id: null,
      equipped_transport_ids: [],
    },
    research: {
      completed_project_ids: [],
    },
    archive_collection_totals: {
      newspapers: 0,
      books: 0,
    },
    management_cycle_usage: {},
    expedition: {
      city_id: "city_a",
      district_id: configuredDefaultDistrictId("city_a"),
      travel_step_cost: 2,
      leader_player_index: 0,
      companion_ids: [],
      carried_items: {},
      loot: {},
      remaining_steps: 4,
      maximum_steps: 6,
      events_resolved: 1,
    },
    last_expedition_failure: null,
    shelter_room_assignments: {},
    encounter_battle: null,
    pending_return_incident_id: null,
  };
}

/** 使用统一槽数、备份数和固定时间创建隔离仓库。 */
function createRepository(storage: MemoryStorage): LocalStorageSaveRepository {
  return new LocalStorageSaveRepository({
    storage,
    storageKey: STORAGE_KEY,
    schemaVersion: 3,
    slotCount: SLOT_COUNT,
    backupSlots: BACKUP_COUNT,
    validator: new PassThroughSaveValidator(),
    now: () => new Date(SAVED_AT),
  });
}

/** 从内存存储信封中读取游戏状态供备份断言使用。 */
function readStoredState(storage: MemoryStorage, key: string): GameState {
  const serialized = storage.getItem(key);
  if (serialized === null) throw new Error(`测试存档键不存在：${key}`);
  const document = JSON.parse(serialized) as { game_state: GameState };
  return document.game_state;
}

describe("LocalStorageSaveRepository 配置化手动槽位", () => {
  it("一号槽沿用旧键并允许显式选择活动槽", () => {
    const storage = new MemoryStorage();
    const repository = createRepository(storage);

    expect(repository.activeSlot()).toBe(1);
    expect(repository.slotKey(1)).toBe(STORAGE_KEY);
    expect(repository.slotKey(2)).toBe(`${STORAGE_KEY}:slot:2`);
    expect(repository.backupKey(1, 1)).toBe(`${STORAGE_KEY}:backup:1`);
    expect(repository.backupKey(1, 2)).toBe(`${STORAGE_KEY}:slot:2:backup:1`);

    repository.selectSlot(3);
    repository.save(createState({ survivalDays: 30 }));

    expect(repository.activeSlot()).toBe(3);
    expect(storage.getItem(`${STORAGE_KEY}:slot:3`)).not.toBeNull();
    expect(repository.load().survival_days).toBe(30);
    expect(() => {
      repository.selectSlot(0);
    }).toThrow(RangeError);
    expect(() => {
      repository.selectSlot(SLOT_COUNT + 1);
    }).toThrow(RangeError);
  });

  it("列出全部槽并独立投影姓名、模式、时间与开局档案", () => {
    const storage = new MemoryStorage();
    const repository = createRepository(storage);
    repository.save(createState({ survivalDays: 8 }), 1);
    repository.save(createState({
      mode: "multiplayer",
      playerNames: ["甲", "乙"],
      survivalDays: 19,
      hour: 15,
      difficultyId: "nightmare",
      originId: "field_medic",
      traitId: "scavenger",
      homeCityId: "city_h",
    }), 2);

    const summaries = repository.listSlots();

    expect(summaries).toHaveLength(SLOT_COUNT);
    expect(summaries[0]).toMatchObject({
      slotId: 1,
      status: "valid",
      mode: "single",
      playerName: "白菜",
      playerNames: ["白菜"],
      survivalDays: 8,
      difficultyId: "survivor",
      originId: "old_city_patrol",
      traitId: "meticulous",
      homeCityId: "city_a",
      savedAt: SAVED_AT,
    });
    expect(summaries[1]).toMatchObject({
      slotId: 2,
      status: "valid",
      mode: "multiplayer",
      playerName: "甲",
      playerNames: ["甲", "乙"],
      survivalDays: 19,
      clock: { year: 2166, month: 4, day: 5, hour: 15 },
      difficultyId: "nightmare",
      originId: "field_medic",
      traitId: "scavenger",
      homeCityId: "city_h",
      savedAt: SAVED_AT,
    });
    expect(summaries[2]).toEqual({
      slotId: 3,
      status: "empty",
      mode: null,
      playerName: null,
      playerNames: [],
      survivalDays: null,
      clock: null,
      difficultyId: null,
      originId: null,
      traitId: null,
      homeCityId: null,
      savedAt: null,
    });
    expect(repository.exists()).toBe(true);
    expect(repository.exists(1)).toBe(true);
    expect(repository.exists(2)).toBe(true);
    expect(repository.exists(3)).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(`${STORAGE_KEY}:slot:1`)).toBeNull();
  });

  it("每个手动槽独立滚动备份并从损坏主档恢复摘要与状态", () => {
    const storage = new MemoryStorage();
    const repository = createRepository(storage);
    repository.save(createState({ survivalDays: 1 }), 1);
    repository.save(createState({ survivalDays: 11 }), 2);
    repository.save(createState({ survivalDays: 2 }), 1);
    repository.save(createState({ survivalDays: 12 }), 2);

    expect(readStoredState(storage, repository.backupKey(1, 1)).survival_days).toBe(1);
    expect(readStoredState(storage, repository.backupKey(1, 2)).survival_days).toBe(11);

    storage.setItem(repository.slotKey(2), "{broken");
    storage.setItem(repository.slotKey(3), "{broken");
    const summaries = repository.listSlots();

    expect(summaries[0]?.status).toBe("valid");
    expect(summaries[1]).toMatchObject({
      status: "recoverable",
      survivalDays: 11,
    });
    expect(summaries[2]?.status).toBe("corrupted");
    expect(repository.load(2).survival_days).toBe(11);
    expect(repository.activeSlot()).toBe(2);
  });

  it("拒绝未配置槽数和越界显式操作", () => {
    const options = {
      storage: new MemoryStorage(),
      storageKey: STORAGE_KEY,
      schemaVersion: 3,
      backupSlots: BACKUP_COUNT,
      validator: new PassThroughSaveValidator(),
    };

    expect(() => new LocalStorageSaveRepository({ ...options, slotCount: 0 }))
      .toThrow(SaveDataError);
    const repository = new LocalStorageSaveRepository({ ...options, slotCount: SLOT_COUNT });
    expect(() => repository.exists(4)).toThrow(RangeError);
    expect(() => {
      repository.save(createState(), 4);
    }).toThrow(RangeError);
    expect(() => repository.load(4)).toThrow(RangeError);
  });
});
