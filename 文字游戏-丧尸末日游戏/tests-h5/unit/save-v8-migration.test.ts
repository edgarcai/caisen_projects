import { describe, expect, it } from "vitest";
import gameDocument from "../../config/game_config.json";
import v7ToV8MigrationDocument from "../../config/save_migrations/v7_to_v8.json";
import shelterLayoutDocument from "../../config/shelter_layout.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import { demoSystemsConfig } from "../../src/config/demoSystemsConfig";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type {
  GameConfigDocument,
  StoryConfigDocument,
  V7ToV8SaveMigrationConfig,
} from "../../src/domain/content";
import type { EncounterBattleState } from "../../src/domain/demo-systems";
import type { GameState } from "../../src/domain/game-state";
import { parseShelterLayoutConfig } from "../../src/domain/shelter-layout";
import {
  LocalStorageSaveRepository,
  MemoryStorage,
  SaveStateValidator,
  V7ToV8SaveMigrator,
} from "../../src/infrastructure";
import {
  ArchiveStorageService,
  ShelterLayoutService,
  ShelterLayoutStateProjector,
} from "../../src/services";
import { buildH5Harness, requireState } from "../helpers/H5TestHarness";

const game = gameDocument as unknown as GameConfigDocument;
const story = storyDocument as unknown as StoryConfigDocument;
const migration: V7ToV8SaveMigrationConfig = v7ToV8MigrationDocument;
const STORAGE_KEY = "v8-migration-test";
const shelterLayout = new ShelterLayoutService(
  parseShelterLayoutConfig(shelterLayoutDocument),
);
const shelterLayoutState = new ShelterLayoutStateProjector(
  shelterLayout,
  story.companions,
);
const archiveStorage = new ArchiveStorageService(demoSystemsConfig.archive_storage);

/** 创建注入权威文献分类的 v7 到 v8 迁移器。 */
function createMigrator(
  configuration: V7ToV8SaveMigrationConfig = migration,
): V7ToV8SaveMigrator {
  return new V7ToV8SaveMigrator(
    configuration,
    demoSystemsConfig.archive_storage.collections,
  );
}

/** 使用权威地图、生存系统与内容 ID 创建当前存档校验器。 */
function createValidator(): SaveStateValidator {
  return new SaveStateValidator(
    game.rules,
    story.facilities,
    story.facility_management,
    story.defaults.companions.map((companion) => companion.companion_id),
    validateSurvivalSystemsConfig(survivalSystemsDocument),
    game.campaign_profiles,
    game.cities,
    shelterLayoutState,
    archiveStorage,
  );
}

/** 创建启用真实 v8 迁移链与房间领域校验的隔离仓库。 */
function createRepository(
  storage: MemoryStorage,
  slotCount = 1,
): LocalStorageSaveRepository {
  return new LocalStorageSaveRepository({
    storage,
    storageKey: STORAGE_KEY,
    schemaVersion: 8,
    slotCount,
    backupSlots: 0,
    validator: createValidator(),
    migrators: [createMigrator()],
  });
}

/** 将完整 v8 状态包装为可直接写入本地存储的文档。 */
function createSaveDocument(state: GameState): string {
  return JSON.stringify({
    schema_version: 8,
    saved_at: "2166-01-10T06:00:00.000Z",
    game_state: state,
  });
}

/** 创建覆盖前后排、冷却、补给和日志的最小合法遭遇战快照。 */
function createEncounterBattle(): EncounterBattleState {
  return {
    encounter_id: "migration_ambush",
    encounter_name: "迁移测试伏击",
    round_number: 2,
    outcome: "ongoing",
    party: [{
      member_id: "player:0",
      name: "迁移所长",
      row: "front",
      maximum_health: 100,
      health: 81,
      attack: 12,
      defense: 8,
      agility: 7,
      skill_ids: ["precise_strike"],
      guarding: false,
      skill_cooldowns: { precise_strike: 1 },
    }],
    enemies: [{
      enemy_id: "zombie:swift:0",
      name: "迅捷感染者",
      row: "front",
      maximum_health: 36,
      health: 24,
      attack: 9,
      defense: 3,
      agility: 8,
      guarding: false,
      intent_id: "rending_claw",
    }],
    pending_party_member_ids: ["player:0"],
    supplies: { field_dressing: 1 },
    log: [{ round_number: 2, message: "敌方意图已确认。" }],
  };
}

/** 创建一份同时包含当前状态与十日检查点的完整 v8 状态。 */
function createV8StateWithCheckpoint(): GameState {
  const application = buildH5Harness().application;
  application.startNewGame(["迁移所长"], "single");
  const state = structuredClone(requireState(application));
  state.survival_days = game.rules.timeline.checkpoint_interval_days;
  state.turn_number = 4;
  state.shelter_room_assignments = {
    command_center: ["player:0"],
  };
  const snapshot = structuredClone(state) as unknown as Record<string, unknown>;
  delete snapshot.checkpoint;
  state.checkpoint = {
    survival_day: state.survival_days,
    created_turn: state.turn_number,
    snapshot: snapshot as never,
  };
  return state;
}

/** 从可恢复状态移除 v8 新字段，构造字段集合精确的 v7 状态。 */
function downgradeRestorableState(rawState: Record<string, unknown>): void {
  delete rawState.archive_collection_totals;
  delete rawState.shelter_room_assignments;
  delete rawState.encounter_battle;
  delete rawState.pending_return_incident_id;
}

/** 同时降级当前状态与检查点快照，保留旧档的全部业务进度。 */
function createV7StateWithCheckpoint(): Record<string, unknown> {
  const rawState = structuredClone(
    createV8StateWithCheckpoint(),
  ) as unknown as Record<string, unknown>;
  downgradeRestorableState(rawState);
  const checkpoint = rawState.checkpoint as Record<string, unknown>;
  downgradeRestorableState(checkpoint.snapshot as Record<string, unknown>);
  return rawState;
}

/** 返回检查点中的可恢复状态，并在测试夹具损坏时立即失败。 */
function checkpointSnapshotOf(
  state: GameState,
): NonNullable<GameState["checkpoint"]>["snapshot"] {
  const checkpoint = state.checkpoint;
  if (checkpoint === null) throw new Error("测试状态缺少检查点。");
  return checkpoint.snapshot;
}

describe("v7 到 v8 存档迁移", () => {
  it("同步补齐当前状态与检查点且不修改 v7 输入", () => {
    const validator = createValidator();
    const source = createV7StateWithCheckpoint();
    const sourceBeforeMigration = structuredClone(source);
    validator.validateRawV7(source);

    const document = createMigrator().migrate({
      schema_version: 7,
      saved_at: "2166-01-10T06:00:00.000Z",
      game_state: source,
    });
    const state = document.game_state as Record<string, unknown>;
    const checkpoint = state.checkpoint as Record<string, unknown>;
    const snapshot = checkpoint.snapshot as Record<string, unknown>;

    expect(document.schema_version).toBe(8);
    expect(document.saved_at).toBe("2166-01-10T06:00:00.000Z");
    expect(source).toEqual(sourceBeforeMigration);
    expect(state.archive_collection_totals).toEqual({ newspapers: 0, books: 0 });
    expect(state.shelter_room_assignments).toEqual({});
    expect(state.encounter_battle).toBeNull();
    expect(state.pending_return_incident_id).toBeNull();
    expect(snapshot.shelter_room_assignments).toEqual({});
    expect(snapshot.encounter_battle).toBeNull();
    expect(snapshot.pending_return_incident_id).toBeNull();
    expect(snapshot.archive_collection_totals).toEqual({ newspapers: 0, books: 0 });
    expect(state.shelter_room_assignments).not.toBe(snapshot.shelter_room_assignments);
    expect(() => validator.parse(state)).not.toThrow();
  });

  it("通过存档仓库执行 v7 结构校验、单步迁移和 v8 领域解析", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({
      schema_version: 7,
      saved_at: "2166-01-10T06:00:00.000Z",
      game_state: createV7StateWithCheckpoint(),
    }));
    const repository = createRepository(storage);

    const loaded = repository.load();

    expect(loaded.shelter_room_assignments).toEqual({});
    expect(loaded.encounter_battle).toBeNull();
    expect(loaded.pending_return_incident_id).toBeNull();
    expect(loaded.archive_collection_totals).toEqual({ newspapers: 0, books: 0 });
    expect(checkpointSnapshotOf(loaded).shelter_room_assignments).toEqual({});
  });

  it("拒绝错误版本链、额外默认字段和带运行态数据的迁移配置", () => {
    expect(() => createMigrator({
      ...migration,
      to_version: 9,
    })).toThrow("版本链无效");

    const withExtraDefault = structuredClone(migration) as unknown as Record<string, unknown>;
    const extraDefaults = withExtraDefault.state_defaults as Record<string, unknown>;
    extraDefaults.unknown_container = null;
    expect(() => createMigrator(
      withExtraDefault as unknown as V7ToV8SaveMigrationConfig,
    )).toThrow("字段集合不匹配");

    expect(() => createMigrator({
      ...migration,
      state_defaults: {
        ...migration.state_defaults,
        shelter_room_assignments: { command_center: ["player:0"] },
      },
    })).toThrow("必须为空对象");

    const withPendingIncident = {
      ...migration,
      state_defaults: {
        ...migration.state_defaults,
        pending_return_incident_id: "forged_incident",
      },
    } as unknown as V7ToV8SaveMigrationConfig;
    expect(() => createMigrator(withPendingIncident)).toThrow(
      "默认遭遇状态必须为空",
    );
  });
});

describe("v8 存档新字段校验", () => {
  it("接受合法房间规划、归来事项与完整手动遭遇战", () => {
    const state = createV8StateWithCheckpoint();
    state.shelter_room_assignments = {
      command_center: ["player:0"],
      workshop: ["companion:haocai"],
    };
    state.pending_return_incident_id = "radio_aftershock";
    state.encounter_battle = createEncounterBattle();

    expect(() => createValidator().parse(state)).not.toThrow();
  });

  it("当前状态和检查点都必须包含精确的 v8 字段集合", () => {
    const missingCurrentField = structuredClone(
      createV8StateWithCheckpoint(),
    ) as unknown as Record<string, unknown>;
    delete missingCurrentField.pending_return_incident_id;
    expect(() => createValidator().validateRawV8(missingCurrentField)).toThrow(
      "v8 game_state 字段集合不匹配",
    );

    const missingCheckpointField = createV8StateWithCheckpoint();
    const snapshot = checkpointSnapshotOf(missingCheckpointField) as unknown as Record<
      string,
      unknown
    >;
    delete snapshot.encounter_battle;
    expect(() => createValidator().validateRawV8(missingCheckpointField)).toThrow(
      "v8 checkpoint.snapshot 字段集合不匹配",
    );
  });

  it("拒绝重复分配住民、空事项 ID 与遭遇战嵌套额外字段", () => {
    const duplicateResident = createV8StateWithCheckpoint();
    duplicateResident.shelter_room_assignments = {
      command_center: ["player:0"],
      workshop: ["player:0"],
    };
    expect(() => createValidator().parse(duplicateResident)).toThrow(
      "全部住民 不能包含重复项",
    );

    const emptyIncident = createV8StateWithCheckpoint();
    emptyIncident.pending_return_incident_id = "   ";
    expect(() => createValidator().validateRawV8(emptyIncident)).toThrow(
      "pending_return_incident_id 必须是非空字符串",
    );

    const extraBattleField = createV8StateWithCheckpoint();
    const battle = createEncounterBattle();
    const firstPartyMember = battle.party[0] as unknown as Record<string, unknown>;
    firstPartyMember.debug_flag = true;
    extraBattleField.encounter_battle = battle;
    expect(() => createValidator().validateRawV8(extraBattleField)).toThrow(
      "encounter_battle.party[0] 字段集合不匹配",
    );
  });

  it("拒绝生命越界、伪造待行动队员及检查点中的非法战斗", () => {
    const healthOverflow = createV8StateWithCheckpoint();
    healthOverflow.encounter_battle = createEncounterBattle();
    const currentEnemy = healthOverflow.encounter_battle.enemies[0];
    if (currentEnemy === undefined) throw new Error("测试遭遇战缺少敌人。");
    currentEnemy.health = currentEnemy.maximum_health + 1;
    expect(() => createValidator().parse(healthOverflow)).toThrow(
      "health 不能超过最大生命",
    );

    const forgedPendingActor = createV8StateWithCheckpoint();
    forgedPendingActor.encounter_battle = createEncounterBattle();
    forgedPendingActor.encounter_battle.pending_party_member_ids = ["player:99"];
    expect(() => createValidator().parse(forgedPendingActor)).toThrow(
      "待行动队员不属于当前队伍",
    );

    const invalidCheckpointBattle = createV8StateWithCheckpoint();
    const snapshot = checkpointSnapshotOf(invalidCheckpointBattle);
    snapshot.encounter_battle = createEncounterBattle();
    const snapshotPartyMember = snapshot.encounter_battle.party[0];
    if (snapshotPartyMember === undefined) throw new Error("测试遭遇战缺少队员。");
    (snapshotPartyMember as unknown as Record<string, unknown>).row = "rear";
    expect(() => createValidator().parse(invalidCheckpointBattle)).toThrow(
      "encounter_battle.party[0].row 无效",
    );
  });

  it("拒绝当前状态中的伪造房间与未知住民", () => {
    const unknownRoom = createV8StateWithCheckpoint();
    unknownRoom.shelter_room_assignments = {
      forged_room: ["player:0"],
    };
    expect(() => createValidator().parse(unknownRoom)).toThrow("forged_room");

    const unknownResident = createV8StateWithCheckpoint();
    unknownResident.shelter_room_assignments = {
      command_center: ["companion:unknown"],
    };
    expect(() => createValidator().parse(unknownResident)).toThrow(
      "companion:unknown",
    );
  });

  it("按实时状态拒绝性别错误、未解锁房间与超容量分配", () => {
    const wrongGender = createV8StateWithCheckpoint();
    wrongGender.shelter_room_assignments = {
      female_dormitory: ["companion:haocai"],
    };
    expect(() => createValidator().parse(wrongGender)).toThrow("性别限制");

    const lockedRoom = createV8StateWithCheckpoint();
    lockedRoom.shelter_room_assignments = {
      generator_room: ["player:0"],
    };
    expect(() => createValidator().parse(lockedRoom)).toThrow("尚未解锁");

    const capacityOverflow = createV8StateWithCheckpoint();
    capacityOverflow.shelter_room_assignments = {
      workshop: [
        "player:0",
        "companion:haocai",
        "companion:yangguan",
      ],
    };
    expect(() => createValidator().parse(capacityOverflow)).toThrow(
      "超过当前容量",
    );
  });

  it("允许已知非活跃伙伴保留合法房间记录且容量只统计在岗人员", () => {
    const inactiveResident = createV8StateWithCheckpoint();
    inactiveResident.shelter_room_assignments = {
      female_dormitory: ["companion:linlan"],
      workshop: [
        "player:0",
        "companion:haocai",
        "companion:xiaoman",
      ],
    };

    expect(() => createValidator().parse(inactiveResident)).not.toThrow();
  });

  it("对检查点快照递归执行同一套房间校验", () => {
    const forgedCheckpoint = createV8StateWithCheckpoint();
    checkpointSnapshotOf(forgedCheckpoint).shelter_room_assignments = {
      forged_room: ["player:0"],
    };

    expect(() => createValidator().parse(forgedCheckpoint)).toThrow(
      "forged_room",
    );
  });

  it("在六栏摘要、读档与写档边界统一拒绝伪造分配", () => {
    const corruptedStorage = new MemoryStorage();
    const corruptedState = createV8StateWithCheckpoint();
    corruptedState.shelter_room_assignments = {
      forged_room: ["player:0"],
    };
    corruptedStorage.setItem(STORAGE_KEY, createSaveDocument(corruptedState));
    const repository = createRepository(corruptedStorage, 6);

    expect(repository.listSlots().map((slot) => slot.status)).toEqual([
      "corrupted",
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(() => repository.load(1)).toThrow("主存档与备份均不可用");

    const invalidWrite = createV8StateWithCheckpoint();
    invalidWrite.shelter_room_assignments = {
      command_center: ["player:1"],
    };
    expect(() => {
      createRepository(new MemoryStorage()).save(invalidWrite, 1);
    }).toThrow(
      "无法写入存档槽",
    );
  });
});
