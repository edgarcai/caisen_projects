import gameDocument from "../../config/game_config.json";
import v1ToV2MigrationDocument from "../../config/save_migrations/v1_to_v2.json";
import v2ToV3MigrationDocument from "../../config/save_migrations/v2_to_v3.json";
import v3ToV4MigrationDocument from "../../config/save_migrations/v3_to_v4.json";
import v4ToV5MigrationDocument from "../../config/save_migrations/v4_to_v5.json";
import v5ToV6MigrationDocument from "../../config/save_migrations/v5_to_v6.json";
import v6ToV7MigrationDocument from "../../config/save_migrations/v6_to_v7.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import { createGameApplication } from "../../src/application";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type {
  GameConfigDocument,
  SaveMigrationConfig,
  StoryConfigDocument,
  V2ToV3SaveMigrationConfig,
  V3ToV4SaveMigrationConfig,
  V4ToV5SaveMigrationConfig,
  V5ToV6SaveMigrationConfig,
  V6ToV7SaveMigrationConfig,
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
  SaveStateValidator,
  V1ToV2SaveMigrator,
  V2ToV3SaveMigrator,
  V5ToV6SaveMigrator,
  V6ToV7SaveMigrator,
} from "../../src/infrastructure";
import type { V6ToV7SaveMigrationContext } from "../../src/infrastructure";
import type { SaveDocument } from "../../src/infrastructure/SaveMigration";
import { V3ToV4SaveMigrator } from "../../src/infrastructure/V3ToV4SaveMigrator";
import { V4ToV5SaveMigrator } from "../../src/infrastructure/V4ToV5SaveMigrator";
import { describe, expect, it } from "vitest";

const game = gameDocument as unknown as GameConfigDocument;
const story = storyDocument as unknown as StoryConfigDocument;
const v1ToV2Config = v1ToV2MigrationDocument as unknown as SaveMigrationConfig;
const v2ToV3Config = v2ToV3MigrationDocument as unknown as V2ToV3SaveMigrationConfig;
const v3ToV4Config: V3ToV4SaveMigrationConfig = v3ToV4MigrationDocument;
const v4ToV5Config: V4ToV5SaveMigrationConfig = v4ToV5MigrationDocument;
const v5ToV6Config: V5ToV6SaveMigrationConfig = v5ToV6MigrationDocument;
const v6ToV7Config: V6ToV7SaveMigrationConfig = v6ToV7MigrationDocument;

/** 使用权威内容构造 v6→v7 迁移上下文。 */
function createV7MigrationContext(): V6ToV7SaveMigrationContext {
  return {
    facilities: story.facilities,
    facilityManagement: story.facility_management,
    allowedHomeCityIds: game.rules.world_map.home_city_ids,
  };
}

/** 把 v6 文档提升到当前 v7，供语义校验复用。 */
function migrateToCurrent(document: Readonly<SaveDocument>): SaveDocument {
  return new V6ToV7SaveMigrator(
    v6ToV7Config,
    createV7MigrationContext(),
  ).migrate(document);
}

/** 为状态夹具提供不产生外部副作用的存档端口。 */
class FixtureSaveRepository implements SaveRepository {
  private selectedSlotId = 1;

  /** 夹具不提供可读存档摘要。 */
  public listSlots(): readonly SaveSlotSummary[] {
    return [];
  }

  /** 夹具始终表示本地无存档。 */
  public exists(): boolean {
    return false;
  }

  /** 夹具忽略不属于本组用例的写入。 */
  public save(): void {
    // 迁移单测只需要创建合法领域状态。
  }

  /** 拒绝本组用例未覆盖的读取行为。 */
  public load(): GameState {
    throw new Error("状态夹具不支持读档。");
  }

  /** 记录新游戏选择的活动槽位。 */
  public selectSlot(slotId: number): void {
    this.selectedSlotId = slotId;
  }

  /** 返回状态夹具当前活动槽位。 */
  public activeSlot(): number {
    return this.selectedSlotId;
  }
}

/** 使用真实配置创建存档语义校验器。 */
function createValidator(): SaveStateValidator {
  return new SaveStateValidator(
    game.rules,
    story.facilities,
    story.facility_management,
    story.defaults.companions.map((companion) => companion.companion_id),
    validateSurvivalSystemsConfig(survivalSystemsDocument),
    game.campaign_profiles,
    game.cities,
  );
}

/** 从当前应用工厂创建一份完整 v4 新游戏状态。 */
function createCurrentState(): GameState {
  const application = createGameApplication({ repository: new FixtureSaveRepository() });
  application.startNewGame(["白菜"], "single");
  const state = application.state;
  if (state === null) throw new Error("新游戏状态未创建。");
  return structuredClone(state);
}

/** 删除一份可回档 v4 状态中只属于 v4 的字段。 */
function downgradeRestorableState(
  rawState: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const state: Record<string, unknown> = structuredClone(rawState);
  delete state.management_cycle_usage;
  delete asObject(state.inventory).equipped_transport_ids;
  delete state.last_expedition_failure;
  for (const player of state.players as Record<string, unknown>[]) {
    delete player.age;
    delete player.lifespan;
  }
  delete asObject(state.shelter).hope;
  for (const companion of state.companions as Record<string, unknown>[]) {
    delete companion.equipped_weapon_id;
    delete companion.equipped_armor_id;
    delete companion.interaction_cooldown_turns;
    delete companion.interaction_count;
  }
  delete state.campaign;
  if (typeof state.expedition === "object" && state.expedition !== null) {
    const expedition = state.expedition as Record<string, unknown>;
    delete expedition.travel_step_cost;
    delete expedition.district_id;
  }
  return state;
}

/** 创建包含活动远征和十日检查点的真实 v3 结构。 */
function createV3StateWithCheckpoint(): Record<string, unknown> {
  const state = createCurrentState();
  state.survival_days = 10;
  state.turn_number = 8;
  state.expedition = {
    city_id: "city_a",
    district_id: "city_a_district_a",
    travel_step_cost: 1,
    leader_player_index: 0,
    companion_ids: [],
    carried_items: {},
    loot: { food: 2 },
    remaining_steps: 3,
    maximum_steps: 4,
    events_resolved: 1,
  };
  const snapshot = structuredClone(state) as unknown as Record<string, unknown>;
  delete snapshot.checkpoint;
  state.checkpoint = {
    survival_day: 10,
    created_turn: 8,
    snapshot: snapshot as unknown as RestorableGameState,
  };
  const downgraded = downgradeRestorableState(
    state as unknown as Record<string, unknown>,
  );
  const checkpoint = downgraded.checkpoint as Record<string, unknown>;
  checkpoint.snapshot = downgradeRestorableState(
    checkpoint.snapshot as Record<string, unknown>,
  );
  return downgraded;
}

/** 从当前状态选取只允许出现在 v1 中的字段。 */
function createV1State(): Record<string, unknown> {
  const state = downgradeRestorableState(
    createCurrentState() as unknown as Record<string, unknown>,
  );
  return {
    mode: state.mode,
    players: state.players,
    active_player_index: state.active_player_index,
    shelter: state.shelter,
    clock: structuredClone(state.clock),
    turn_number: 9,
    ended: false,
    ending_message: "",
  };
}

/** 将已知对象断言为可变 JSON 容器，便于测试注入单一损坏字段。 */
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("测试值不是 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

describe("v3 到 v4 存档迁移", () => {
  it("保留当前进度并同时提升活动远征和检查点快照", () => {
    const validator = createValidator();
    const migrator = new V3ToV4SaveMigrator(v3ToV4Config);
    const sourceState = createV3StateWithCheckpoint();
    const original = structuredClone(sourceState);
    validator.validateRawV3(sourceState);

    const migrated = migrator.migrate({
      schema_version: 3,
      saved_at: "2166-01-11T08:00:00.000Z",
      game_state: sourceState,
    });
    const state = asObject(migrated.game_state);
    const expedition = asObject(state.expedition);
    const checkpoint = asObject(state.checkpoint);
    const checkpointSnapshot = asObject(checkpoint.snapshot);
    const checkpointExpedition = asObject(checkpointSnapshot.expedition);

    expect(migrated.schema_version).toBe(4);
    expect(state.campaign).toEqual(v3ToV4Config.state_defaults.campaign);
    expect(expedition.travel_step_cost).toBe(1);
    expect(checkpointSnapshot.campaign).toEqual(v3ToV4Config.state_defaults.campaign);
    expect(checkpointExpedition.travel_step_cost).toBe(1);
    expect(state.turn_number).toBe(8);
    expect(sourceState).toEqual(original);
    expect(() => validator.validateRawV3(state)).toThrow("v3 game_state 字段集合不匹配");
    validator.validateRawV4(state);
    const v5Document = new V4ToV5SaveMigrator(v4ToV5Config, game.cities).migrate(
      migrated,
    );
    const v6Document = new V5ToV6SaveMigrator(v5ToV6Config).migrate(v5Document);
    const v7Document = migrateToCurrent(v6Document);
    expect(validator.parse(v7Document.game_state).checkpoint?.snapshot.campaign).toEqual(
      v3ToV4Config.state_defaults.campaign,
    );
  });

  it("按 1→2→3→4→5→6→7 连续迁移老存档并通过当前语义校验", () => {
    const validator = createValidator();
    let document: SaveDocument = {
      schema_version: 1,
      saved_at: "2023-08-20T12:34:56.000Z",
      game_state: createV1State(),
    };
    validator.validateRawV1(document.game_state);
    document = new V1ToV2SaveMigrator(v1ToV2Config).migrate(document);
    validator.validateRawV2(document.game_state);
    document = new V2ToV3SaveMigrator(v2ToV3Config).migrate(document);
    validator.validateRawV3(document.game_state);
    document = new V3ToV4SaveMigrator(v3ToV4Config).migrate(document);
    validator.validateRawV4(document.game_state);
    document = new V4ToV5SaveMigrator(v4ToV5Config, game.cities).migrate(document);
    document = new V5ToV6SaveMigrator(v5ToV6Config).migrate(document);
    document = migrateToCurrent(document);

    const restored = validator.parse(document.game_state);

    expect(document.schema_version).toBe(7);
    expect(restored.turn_number).toBe(9);
    expect(restored.story.flags).toContain("legacy_save");
    expect(restored.campaign).toEqual(v3ToV4Config.state_defaults.campaign);
  });

  it("拒绝错误版本链、空档案 ID、非正整数路费和额外配置字段", () => {
    const wrongChain = structuredClone(v3ToV4Config);
    wrongChain.to_version = 5;
    expect(() => new V3ToV4SaveMigrator(wrongChain)).toThrow("必须为 3 到 4");

    const emptyProfile = structuredClone(v3ToV4Config);
    emptyProfile.state_defaults.campaign.trait_id = " ";
    expect(() => new V3ToV4SaveMigrator(emptyProfile)).toThrow("必须是非空字符串");

    const invalidCost = structuredClone(v3ToV4Config);
    invalidCost.state_defaults.expedition_travel_step_cost = 0;
    expect(() => new V3ToV4SaveMigrator(invalidCost)).toThrow("必须是正整数");

    const extraField = structuredClone(v3ToV4Config) as unknown as Record<string, unknown>;
    extraField.unexpected = true;
    expect(() => new V3ToV4SaveMigrator(
      extraField as unknown as V3ToV4SaveMigrationConfig,
    )).toThrow("字段集合不匹配");
  });
});

describe("v4 存档严格校验", () => {
  it("v3 拒绝提前出现 v4 字段，v4 拒绝缺失档案或远征路费", () => {
    const validator = createValidator();
    const v3State = createV3StateWithCheckpoint();
    const premature = structuredClone(v3State);
    premature.campaign = structuredClone(v3ToV4Config.state_defaults.campaign);
    expect(() => validator.validateRawV3(premature)).toThrow("字段集合不匹配");

    const migrated = new V3ToV4SaveMigrator(v3ToV4Config).migrate({
      schema_version: 3,
      game_state: v3State,
    });
    const missingCampaign = structuredClone(asObject(migrated.game_state));
    delete missingCampaign.campaign;
    expect(() => validator.validateRawV4(missingCampaign)).toThrow("字段集合不匹配");

    const missingTravelCost = structuredClone(asObject(migrated.game_state));
    delete asObject(missingTravelCost.expedition).travel_step_cost;
    expect(() => validator.validateRawV4(missingTravelCost)).toThrow("字段集合不匹配");
  });

  it.each([
    ["difficulty_id", "unknown_difficulty"],
    ["origin_id", "unknown_origin"],
    ["trait_id", "unknown_trait"],
    ["home_city_id", "unknown_city"],
  ] as const)("拒绝开局档案的未知 %s", (field, value) => {
    const validator = createValidator();
    const migrated = new V3ToV4SaveMigrator(v3ToV4Config).migrate({
      schema_version: 3,
      game_state: createV3StateWithCheckpoint(),
    });
    const state = asObject(migrated.game_state);
    asObject(state.campaign)[field] = value;

    const v5 = new V4ToV5SaveMigrator(v4ToV5Config, game.cities).migrate({
      schema_version: 4,
      game_state: state,
    });
    const v6 = new V5ToV6SaveMigrator(v5ToV6Config).migrate(v5);
    const v7 = migrateToCurrent(v6);
    expect(() => validator.parse(v7.game_state)).toThrow();
  });

  it("拒绝未在城市旅行配置中声明的远征路费", () => {
    const validator = createValidator();
    const migrated = new V3ToV4SaveMigrator(v3ToV4Config).migrate({
      schema_version: 3,
      game_state: createV3StateWithCheckpoint(),
    });
    const state = asObject(migrated.game_state);
    asObject(state.expedition).travel_step_cost = 99;

    const v5 = new V4ToV5SaveMigrator(v4ToV5Config, game.cities).migrate({
      schema_version: 4,
      game_state: state,
    });
    const v6 = new V5ToV6SaveMigrator(v5ToV6Config).migrate(v5);
    const v7 = migrateToCurrent(v6);
    expect(() => validator.parse(v7.game_state)).toThrow(
      "远征城市路费不在配置允许的范围内",
    );
  });

  it("对 JSON 往返后的完整 v4 状态返回隔离副本", () => {
    const validator = createValidator();
    const migrated = new V3ToV4SaveMigrator(v3ToV4Config).migrate({
      schema_version: 3,
      game_state: createV3StateWithCheckpoint(),
    });
    const v5 = new V4ToV5SaveMigrator(v4ToV5Config, game.cities).migrate(migrated);
    const v6 = new V5ToV6SaveMigrator(v5ToV6Config).migrate(v5);
    const v7 = migrateToCurrent(v6);
    const rawState = JSON.parse(JSON.stringify(v7.game_state)) as unknown;

    const parsed = validator.parse(rawState);

    expect(parsed).toEqual(rawState);
    expect(parsed).not.toBe(rawState);
  });
});
