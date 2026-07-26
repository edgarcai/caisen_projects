import gameDocument from "../../config/game_config.json";
import v4ToV5MigrationDocument from "../../config/save_migrations/v4_to_v5.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import { createGameApplication } from "../../src/application";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type {
  GameConfigDocument,
  StoryConfigDocument,
  V4ToV5SaveMigrationConfig,
} from "../../src/domain/content";
import type {
  GameState,
  RestorableGameState,
} from "../../src/domain/game-state";
import type {
  SaveRepository,
  SaveSlotSummary,
} from "../../src/domain/ports";
import {
  MemoryStorage,
  SaveStateValidator,
  V4ToV5SaveMigrator,
} from "../../src/infrastructure";
import { describe, expect, it } from "vitest";

const game = gameDocument as unknown as GameConfigDocument;
const story = storyDocument as unknown as StoryConfigDocument;
const migrationConfig: V4ToV5SaveMigrationConfig = v4ToV5MigrationDocument;

/** 为迁移夹具提供无外部写入的最小存档端口。 */
class FixtureSaveRepository implements SaveRepository {
  /** 迁移夹具没有可展示槽位。 */
  public listSlots(): readonly SaveSlotSummary[] { return []; }

  /** 迁移夹具始终视为没有存档。 */
  public exists(): boolean { return false; }

  /** 忽略迁移夹具不关心的保存调用。 */
  public save(): void { /* 测试只创建领域状态。 */ }

  /** 拒绝迁移夹具不支持的读取。 */
  public load(): GameState { throw new Error("迁移夹具不支持读档。"); }

  /** 迁移夹具无需记录槽位。 */
  public selectSlot(): void { /* 无外部状态。 */ }

  /** 返回配置中的首个槽位。 */
  public activeSlot(): number { return 1; }
}

/** 使用权威地图与系统配置创建 v5 状态校验器。 */
function createValidator(): SaveStateValidator {
  return new SaveStateValidator(
    game.rules,
    Object.keys(story.defaults.facility_levels),
    story.defaults.companions.map((companion) => companion.companion_id),
    validateSurvivalSystemsConfig(survivalSystemsDocument),
    game.campaign_profiles,
    game.cities,
  );
}

/** 创建一份可按需写入远征与检查点的当前状态。 */
function createCurrentState(): GameState {
  const application = createGameApplication({ repository: new FixtureSaveRepository() });
  application.startNewGame(["迁移所长"], "single");
  if (application.state === null) throw new Error("测试新游戏状态未创建。");
  return structuredClone(application.state);
}

/** 创建活动远征和待决事件都尚未含区划字段的合法 v4 状态。 */
function createV4StateWithCheckpoint(): Record<string, unknown> {
  const state = createCurrentState();
  state.survival_days = 10;
  state.turn_number = 8;
  state.expedition = {
    city_id: "city_a",
    district_id: "city_a_district_b",
    travel_step_cost: 1,
    leader_player_index: 0,
    companion_ids: [],
    carried_items: {},
    loot: { coins: 2 },
    remaining_steps: 3,
    maximum_steps: 6,
    events_resolved: 1,
  };
  state.pending_exploration = {
    city_id: "city_a",
    district_id: "city_a_district_b",
    event_id: "bank",
  };
  const snapshot = structuredClone(state);
  if (snapshot.expedition === null) throw new Error("检查点远征夹具未创建。");
  snapshot.expedition = {
    ...snapshot.expedition,
    city_id: "city_d",
    district_id: "city_d_district_b",
    travel_step_cost: 3,
  };
  snapshot.pending_exploration = {
    city_id: "city_d",
    district_id: "city_d_district_b",
    event_id: "skyscraper",
  };
  const restorableSnapshot = snapshot as unknown as Record<string, unknown>;
  delete restorableSnapshot.checkpoint;
  state.checkpoint = {
    survival_day: 10,
    created_turn: 8,
    snapshot: restorableSnapshot as unknown as RestorableGameState,
  };
  return downgradeToV4(state as unknown as Record<string, unknown>);
}

/** 从当前状态和检查点快照删除仅属于 v5 的区划字段。 */
function downgradeToV4(rawState: Record<string, unknown>): Record<string, unknown> {
  const state = structuredClone(rawState);
  deleteDistrictFields(state);
  const checkpoint = asOptionalObject(state.checkpoint);
  const snapshot = checkpoint === null ? null : asObject(checkpoint.snapshot);
  if (snapshot !== null) deleteDistrictFields(snapshot);
  return state;
}

/** 删除一份可回档状态中的远征与待决事件区划字段。 */
function deleteDistrictFields(state: Record<string, unknown>): void {
  const expedition = asOptionalObject(state.expedition);
  if (expedition !== null) delete expedition.district_id;
  const pending = asOptionalObject(state.pending_exploration);
  if (pending !== null) delete pending.district_id;
}

/** 将未知值读取为对象，并为测试失败提供清晰错误。 */
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("测试值不是对象。");
  }
  return value as Record<string, unknown>;
}

/** 将可空未知值读取为可空对象。 */
function asOptionalObject(value: unknown): Record<string, unknown> | null {
  return value === null ? null : asObject(value);
}

describe("v4 到 v5 区划存档迁移", () => {
  it("按待决事件选择区划并同步迁移当前状态与检查点", () => {
    const source = createV4StateWithCheckpoint();
    const original = structuredClone(source);
    const validator = createValidator();
    validator.validateRawV4(source);

    const migrated = new V4ToV5SaveMigrator(migrationConfig, game.cities).migrate({
      schema_version: 4,
      game_state: source,
    });
    const state = asObject(migrated.game_state);
    const checkpoint = asObject(state.checkpoint);
    const snapshot = asObject(checkpoint.snapshot);

    expect(migrated.schema_version).toBe(5);
    expect(asObject(state.expedition).district_id).toBe("city_a_district_b");
    expect(asObject(state.pending_exploration).district_id).toBe("city_a_district_b");
    expect(asObject(snapshot.expedition).district_id).toBe("city_d_district_b");
    expect(asObject(snapshot.pending_exploration).district_id).toBe("city_d_district_b");
    expect(source).toEqual(original);
    expect(() => validator.parse(state)).not.toThrow();
  });

  it("没有待决事件时使用城市默认区划", () => {
    const source = createV4StateWithCheckpoint();
    source.pending_exploration = null;
    const checkpoint = asObject(source.checkpoint);
    asObject(checkpoint.snapshot).pending_exploration = null;

    const migrated = new V4ToV5SaveMigrator(migrationConfig, game.cities).migrate({
      schema_version: 4,
      game_state: source,
    });
    const state = asObject(migrated.game_state);
    const snapshot = asObject(asObject(state.checkpoint).snapshot);

    expect(asObject(state.expedition).district_id).toBe("city_a_district_a");
    expect(asObject(snapshot.expedition).district_id).toBe("city_d_district_a");
  });

  it("拒绝错误迁移链与无效默认区划配置", () => {
    const wrongChain = { ...migrationConfig, to_version: 6 };
    expect(() => new V4ToV5SaveMigrator(wrongChain, game.cities)).toThrow(
      "必须为 4 到 5",
    );
    const brokenCities = structuredClone(game.cities);
    const firstCity = brokenCities[0];
    if (firstCity === undefined) throw new Error("测试地图缺少城市。");
    firstCity.default_district_id = "missing_district";
    expect(() => new V4ToV5SaveMigrator(migrationConfig, brokenCities)).toThrow(
      "默认区划无效",
    );
  });
});

describe("v5 区划存档不变量", () => {
  it("拒绝待决事件与活动远征使用不同区划", () => {
    const state = createCurrentState();
    state.expedition = {
      city_id: "city_a",
      district_id: "city_a_district_a",
      travel_step_cost: 1,
      leader_player_index: 0,
      companion_ids: [],
      carried_items: {},
      loot: {},
      remaining_steps: 3,
      maximum_steps: 6,
      events_resolved: 0,
    };
    state.pending_exploration = {
      city_id: "city_a",
      district_id: "city_a_district_b",
      event_id: "bank",
    };

    expect(() => createValidator().parse(state)).toThrow("远征城市或区划");
  });

  it("拒绝不属于所选区划事件池的待决事件", () => {
    const state = createCurrentState();
    state.expedition = {
      city_id: "city_a",
      district_id: "city_a_district_a",
      travel_step_cost: 1,
      leader_player_index: 0,
      companion_ids: [],
      carried_items: {},
      loot: {},
      remaining_steps: 3,
      maximum_steps: 6,
      events_resolved: 0,
    };
    state.pending_exploration = {
      city_id: "city_a",
      district_id: "city_a_district_a",
      event_id: "bank",
    };

    expect(() => createValidator().parse(state)).toThrow("不属于所选区划事件池");
  });

  it("保存与读取往返后保留活动区划", () => {
    const storage = new MemoryStorage();
    const source = createGameApplication({ storage });
    source.startNewGame(["区划所长"], "single");
    source.prepareExpedition("city_a", "city_a_district_e", [], {});
    source.saveGame();

    const restored = createGameApplication({ storage });
    restored.loadGame();

    expect(restored.expeditionStatus()?.districtId).toBe("city_a_district_e");
    expect(restored.state?.pending_exploration?.district_id).toBe(
      "city_a_district_e",
    );
  });
});
