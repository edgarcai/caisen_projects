import type { V7ToV8SaveMigrationConfig } from "../domain/content";
import type { ArchiveCollectionConfig } from "../domain/demo-systems";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

type JsonObject = Record<string, unknown>;

/** 为 v7 状态补齐避难所房间规划、遭遇战和归来事项容器。 */
export class V7ToV8SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly defaults: V7ToV8SaveMigrationConfig["state_defaults"];
  private readonly archiveCollections: readonly ArchiveCollectionConfig[];

  /** 校验单步版本和空白默认状态后保存不可变配置。 */
  public constructor(
    configuration: V7ToV8SaveMigrationConfig,
    archiveCollections: readonly ArchiveCollectionConfig[] = [],
  ) {
    validateConfiguration(configuration);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
    this.defaults = structuredClone(configuration.state_defaults);
    this.archiveCollections = structuredClone(archiveCollections);
  }

  /** 同步迁移当前状态及十日回档快照。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const rawState = requireObject(document.game_state, "v7 存档 game_state");
    const state = this.migrateRestorableState(rawState);
    if (state.checkpoint !== null) {
      const checkpoint = requireObject(state.checkpoint, "v7 存档 checkpoint");
      state.checkpoint = {
        ...checkpoint,
        snapshot: this.migrateRestorableState(
          requireObject(checkpoint.snapshot, "v7 存档 checkpoint.snapshot"),
        ),
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 为一份可恢复状态添加 v8 根字段，保留全部旧版进度。 */
  private migrateRestorableState(rawState: Readonly<JsonObject>): JsonObject {
    return {
      ...structuredClone(rawState),
      archive_collection_totals: Object.fromEntries(
        this.archiveCollections.map((collection) => [
          collection.collection_id,
          readArchiveInventory(rawState, collection.state_target),
        ]),
      ),
      shelter_room_assignments: structuredClone(
        this.defaults.shelter_room_assignments,
      ),
      encounter_battle: this.defaults.encounter_battle,
      pending_return_incident_id: this.defaults.pending_return_incident_id,
    };
  }
}

/** 严格校验 v7 到 v8 迁移配置只声明允许的空白默认字段。 */
function validateConfiguration(configuration: V7ToV8SaveMigrationConfig): void {
  if (
    configuration.schema_version !== 1
    || configuration.from_version !== 7
    || configuration.to_version !== 8
  ) {
    throw new SaveDataError("v7 到 v8 存档迁移配置版本链无效。");
  }
  const root = requireObject(configuration, "v7 到 v8 存档迁移配置");
  requireExactKeys(
    root,
    ["schema_version", "from_version", "to_version", "state_defaults"],
    "v7 到 v8 存档迁移配置",
  );
  const defaults = requireObject(
    configuration.state_defaults,
    "v8 迁移默认值",
  );
  requireExactKeys(
    defaults,
    [
      "shelter_room_assignments",
      "archive_collection_totals",
      "encounter_battle",
      "pending_return_incident_id",
    ],
    "v8 迁移默认值",
  );
  const assignments = requireObject(
    configuration.state_defaults.shelter_room_assignments,
    "v8 默认房间分配",
  );
  if (Object.keys(assignments).length !== 0) {
    throw new SaveDataError("v8 迁移默认房间分配必须为空对象。");
  }
  const archiveTotals = requireObject(
    configuration.state_defaults.archive_collection_totals,
    "v8 默认文献馆藏进度",
  );
  if (Object.keys(archiveTotals).length !== 0) {
    throw new SaveDataError("v8 迁移默认文献馆藏进度必须为空对象。");
  }
  if (
    defaults.encounter_battle !== null
    || defaults.pending_return_incident_id !== null
  ) {
    throw new SaveDataError("v8 迁移默认遭遇状态必须为空。");
  }
}

/** 按文献配置的点路径读取 v7 当前库存作为初始累计值。 */
function readArchiveInventory(state: Readonly<JsonObject>, target: string): number {
  let value: unknown = state;
  for (const segment of target.split(".")) {
    value = requireObject(value, `v7 文献库存目标 ${target}`)[segment];
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SaveDataError(`v7 文献库存目标必须是非负整数：${target}`);
  }
  return value;
}

/** 要求未知值为普通 JSON 对象。 */
function requireObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path} 必须是对象。`);
  }
  return value as JsonObject;
}

/** 要求对象字段与预期字段集合完全一致。 */
function requireExactKeys(
  value: JsonObject,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new SaveDataError(`${path} 字段集合不匹配。`);
  }
}
