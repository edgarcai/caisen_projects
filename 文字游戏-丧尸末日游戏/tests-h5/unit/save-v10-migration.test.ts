import { describe, expect, it } from "vitest";
import gameDocument from "../../config/game_config.json";
import migrationDocument from "../../config/save_migrations/v9_to_v10.json";
import shelterLayoutDocument from "../../config/shelter_layout.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import { mergeCampaignProfileExpansion } from "../../src/config/campaignProfileExpansionAdapter";
import { contentExpansionCatalog } from "../../src/config/contentExpansion";
import { demoSystemsConfig } from "../../src/config/demoSystemsConfig";
import { expeditionBranchingEventConfig } from "../../src/config/expeditionBranchingEventConfig";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type {
  GameConfigDocument,
  StoryConfigDocument,
  V9ToV10SaveMigrationConfig,
} from "../../src/domain/content";
import type { GameState } from "../../src/domain/game-state";
import { parseShelterLayoutConfig } from "../../src/domain/shelter-layout";
import {
  MemoryStorage,
  LocalStorageSaveRepository,
  SaveStateValidator,
  V9ToV10SaveMigrator,
} from "../../src/infrastructure";
import {
  ArchiveStorageService,
  ExpeditionBranchingEventService,
  ShelterLayoutService,
  ShelterLayoutStateProjector,
} from "../../src/services";
import { buildH5Harness, requireState } from "../helpers/H5TestHarness";

type JsonObject = Record<string, unknown>;

const game = mergeCampaignProfileExpansion(
  gameDocument as unknown as GameConfigDocument,
  contentExpansionCatalog,
);
const story = storyDocument as unknown as StoryConfigDocument;
const migration: V9ToV10SaveMigrationConfig = migrationDocument;
const STORAGE_KEY = "v10-branch-cursor-migration-test";
const shelterLayout = new ShelterLayoutService(
  parseShelterLayoutConfig(shelterLayoutDocument),
);
const shelterLayoutState = new ShelterLayoutStateProjector(
  shelterLayout,
  story.companions,
);
const archiveStorage = new ArchiveStorageService(demoSystemsConfig.archive_storage);
const expeditionBranches = new ExpeditionBranchingEventService(
  expeditionBranchingEventConfig,
);

/** 使用权威地图、生存配置与房间端口创建当前存档校验器。 */
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
    expeditionBranches,
  );
}

/** 创建当前状态与检查点均含待决探索的合法 v10 聚合。 */
function createV10StateWithCheckpoint(): GameState {
  const application = buildH5Harness().application;
  application.startNewGame(["分支迁移所长"], "single");
  const state = structuredClone(requireState(application));
  const city = application.content.city("city_a");
  const district = application.content.district(
    city.id,
    city.default_district_id,
  );
  const eventId = district.event_ids[0];
  if (eventId === undefined) throw new Error("测试区划缺少探索事件。");
  state.pending_exploration = {
    city_id: city.id,
    district_id: district.id,
    event_id: eventId,
    branch_node_id: null,
    branch_path: [],
  };
  state.survival_days = game.rules.timeline.checkpoint_interval_days;
  const snapshot = structuredClone(state) as unknown as JsonObject;
  delete snapshot.checkpoint;
  state.checkpoint = {
    survival_day: state.survival_days,
    created_turn: state.turn_number,
    snapshot: snapshot as never,
  };
  return state;
}

/** 从待决探索删除 v10 分支游标，得到精确 v9 结构。 */
function removeBranchCursor(state: JsonObject): void {
  if (state.pending_exploration === null) return;
  const pending = requireObject(state.pending_exploration, "pending_exploration");
  delete pending.branch_node_id;
  delete pending.branch_path;
}

/** 同时降级当前状态和检查点快照为 v9 精确字段集。 */
function createV9StateWithCheckpoint(): JsonObject {
  const state = structuredClone(
    createV10StateWithCheckpoint(),
  ) as unknown as JsonObject;
  removeBranchCursor(state);
  const checkpoint = requireObject(state.checkpoint, "checkpoint");
  removeBranchCursor(requireObject(checkpoint.snapshot, "checkpoint.snapshot"));
  return state;
}

/** 迁移一份 v9 状态并返回可定向破坏的 v10 对象。 */
function migrateV9State(): JsonObject {
  const document = new V9ToV10SaveMigrator(migration).migrate({
    schema_version: 9,
    saved_at: "2166-04-10T06:00:00.000Z",
    game_state: createV9StateWithCheckpoint(),
  });
  return document.game_state as JsonObject;
}

/** 要求未知值是测试可修改的普通对象。 */
function requireObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`测试值 ${path} 不是对象。`);
  }
  return value as JsonObject;
}

/** 返回状态中必须存在的待决探索对象。 */
function requirePending(state: JsonObject): JsonObject {
  return requireObject(state.pending_exploration, "pending_exploration");
}

/** 返回检查点快照中必须存在的待决探索对象。 */
function requireCheckpointPending(state: JsonObject): JsonObject {
  const checkpoint = requireObject(state.checkpoint, "checkpoint");
  const snapshot = requireObject(checkpoint.snapshot, "checkpoint.snapshot");
  return requirePending(snapshot);
}

describe("v9 到 v10 分支游标存档迁移", () => {
  it("同步补齐当前状态与检查点且不修改 v9 输入", () => {
    const validator = createValidator();
    const source = createV9StateWithCheckpoint();
    const original = structuredClone(source);
    validator.validateRawV9(source);

    const document = new V9ToV10SaveMigrator(migration).migrate({
      schema_version: 9,
      saved_at: "2166-04-10T06:00:00.000Z",
      game_state: source,
    });
    const state = document.game_state as JsonObject;
    const currentPending = requirePending(state);
    const checkpointPending = requireCheckpointPending(state);

    expect(document.schema_version).toBe(10);
    expect(document.saved_at).toBe("2166-04-10T06:00:00.000Z");
    expect(source).toEqual(original);
    expect(currentPending.branch_node_id).toBeNull();
    expect(currentPending.branch_path).toEqual([]);
    expect(checkpointPending.branch_node_id).toBeNull();
    expect(checkpointPending.branch_path).toEqual([]);
    expect(currentPending.branch_path).not.toBe(checkpointPending.branch_path);
    expect(() => validator.validateRawV10(state)).not.toThrow();
  });

  it("通过正式仓库在迁移前校验 v9 并恢复为 v10", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({
      schema_version: 9,
      saved_at: "2166-04-10T06:00:00.000Z",
      game_state: createV9StateWithCheckpoint(),
    }));
    const repository = new LocalStorageSaveRepository({
      storage,
      storageKey: STORAGE_KEY,
      schemaVersion: 10,
      slotCount: 1,
      backupSlots: 0,
      validator: createValidator(),
      migrators: [new V9ToV10SaveMigrator(migration)],
    });

    const restored = repository.load();

    expect(restored.pending_exploration).toMatchObject({
      branch_node_id: null,
      branch_path: [],
    });
    expect(restored.checkpoint?.snapshot.pending_exploration).toMatchObject({
      branch_node_id: null,
      branch_path: [],
    });
  });

  it("严格拒绝错误版本链、额外字段与非空默认游标", () => {
    expect(() => new V9ToV10SaveMigrator({
      ...migration,
      to_version: 11,
    })).toThrow("版本链无效");

    const extraField = structuredClone(migration) as unknown as JsonObject;
    requireObject(extraField.state_defaults, "state_defaults").debug = null;
    expect(() => new V9ToV10SaveMigrator(
      extraField as unknown as V9ToV10SaveMigrationConfig,
    )).toThrow("字段集合不匹配");

    expect(() => new V9ToV10SaveMigrator({
      ...migration,
      state_defaults: { branch_node_id: null, branch_path: ["root"] },
    })).toThrow("分支路径必须为空列表");

    const occupiedNode = {
      ...migration,
      state_defaults: { branch_node_id: "root", branch_path: [] },
    } as unknown as V9ToV10SaveMigrationConfig;
    expect(() => new V9ToV10SaveMigrator(occupiedNode)).toThrow(
      "分支节点必须为空",
    );
  });
});

describe("v10 分支游标精确校验", () => {
  it("当前状态和检查点都必须包含两个游标字段", () => {
    const validator = createValidator();
    const missingCurrent = migrateV9State();
    delete requirePending(missingCurrent).branch_node_id;
    expect(() => validator.validateRawV10(missingCurrent)).toThrow(
      "v10 game_state pending_exploration 字段集合不匹配",
    );

    const missingCheckpoint = migrateV9State();
    delete requireCheckpointPending(missingCheckpoint).branch_path;
    expect(() => validator.validateRawV10(missingCheckpoint)).toThrow(
      "v10 checkpoint.snapshot pending_exploration 字段集合不匹配",
    );
  });

  it("节点只允许 null 或非空字符串，路径只允许非空字符串元素", () => {
    const validator = createValidator();
    const blankNode = migrateV9State();
    requirePending(blankNode).branch_node_id = "   ";
    expect(() => validator.validateRawV10(blankNode)).toThrow(
      "branch_node_id 必须是非空字符串",
    );

    const blankPathItem = migrateV9State();
    requirePending(blankPathItem).branch_path = ["root", " "];
    expect(() => validator.validateRawV10(blankPathItem)).toThrow(
      "branch_path[1] 必须是非空字符串",
    );

    const nonListPath = migrateV9State();
    requireCheckpointPending(nonListPath).branch_path = "root";
    expect(() => validator.validateRawV10(nonListPath)).toThrow(
      "branch_path 必须是列表",
    );
  });

  it("接受可重放的当前与检查点分支游标并拒绝伪造路径", () => {
    const state = migrateV9State();
    const current = requirePending(state);
    const currentEventId = current.event_id;
    if (typeof currentEventId !== "string") throw new Error("当前事件 ID 无效。");
    const currentRoot = expeditionBranches.prompt(currentEventId, null);
    const currentChoice = currentRoot.choices[0];
    if (currentChoice === undefined) throw new Error("当前分支入口没有选择。");
    const currentTransition = expeditionBranches.choose(
      currentEventId,
      currentRoot.nodeId,
      currentChoice.id,
    );
    if (currentTransition.kind !== "advanced") throw new Error("入口选择意外终结。");
    current.branch_node_id = currentTransition.nextNodeId;
    current.branch_path = [currentChoice.id];

    const checkpoint = requireCheckpointPending(state);
    const checkpointEventId = checkpoint.event_id;
    if (typeof checkpointEventId !== "string") throw new Error("检查点事件 ID 无效。");
    const checkpointRoot = expeditionBranches.prompt(checkpointEventId, null);
    const checkpointChoice = checkpointRoot.choices[1];
    if (checkpointChoice === undefined) throw new Error("检查点分支入口缺少第二选择。");
    const checkpointTransition = expeditionBranches.choose(
      checkpointEventId,
      checkpointRoot.nodeId,
      checkpointChoice.id,
    );
    if (checkpointTransition.kind !== "advanced") throw new Error("入口选择意外终结。");
    checkpoint.branch_node_id = checkpointTransition.nextNodeId;
    checkpoint.branch_path = [checkpointChoice.id];

    expect(() => createValidator().validateRawV10(state)).not.toThrow();

    current.branch_node_id = "forged_node";
    expect(() => createValidator().validateRawV10(state)).toThrow(
      "分支游标无效",
    );
  });
});
