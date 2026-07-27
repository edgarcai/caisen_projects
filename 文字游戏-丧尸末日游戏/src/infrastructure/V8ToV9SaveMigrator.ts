import type { V8ToV9SaveMigrationConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

type JsonObject = Record<string, unknown>;

/** 为 v8 状态拆分内外墙耐久，并增加可持久研究台槽位。 */
export class V8ToV9SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly slottedItemDefault: null;
  private readonly innerWallPercent: number;

  /** 校验单步版本链、空研究槽和墙体分配比例。 */
  public constructor(configuration: V8ToV9SaveMigrationConfig) {
    validateConfiguration(configuration);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
    this.slottedItemDefault = configuration.state_defaults.research_slotted_item_id;
    this.innerWallPercent = configuration.wall_distribution.inner_wall_percent;
  }

  /** 同步迁移当前状态及十日回档快照。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const state = this.migrateRestorableState(
      requireObject(document.game_state, "v8 存档 game_state"),
    );
    if (state.checkpoint !== null) {
      const checkpoint = requireObject(state.checkpoint, "v8 存档 checkpoint");
      state.checkpoint = {
        ...checkpoint,
        snapshot: this.migrateRestorableState(
          requireObject(checkpoint.snapshot, "v8 存档 checkpoint.snapshot"),
        ),
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 从旧总耐久按配置比例生成内外墙，并保持总和完全不变。 */
  private migrateRestorableState(rawState: Readonly<JsonObject>): JsonObject {
    const state = structuredClone(rawState) as JsonObject;
    const shelter = requireObject(state.shelter, "v8 存档 shelter");
    const totalHealth = requireNonNegativeInteger(
      shelter.health,
      "v8 存档 shelter.health",
    );
    const innerWallHealth = Math.floor(
      (totalHealth * this.innerWallPercent) / 100,
    );
    state.shelter = {
      ...shelter,
      inner_wall_health: innerWallHealth,
      outer_wall_health: totalHealth - innerWallHealth,
    };
    state.research = {
      ...requireObject(state.research, "v8 存档 research"),
      slotted_item_id: this.slottedItemDefault,
    };
    return state;
  }
}

/** 严格校验 v8 到 v9 迁移配置的字段集与值域。 */
function validateConfiguration(configuration: V8ToV9SaveMigrationConfig): void {
  const root = requireObject(configuration, "v8 到 v9 存档迁移配置");
  requireExactKeys(
    root,
    ["schema_version", "from_version", "to_version", "state_defaults", "wall_distribution"],
    "v8 到 v9 存档迁移配置",
  );
  if (
    configuration.schema_version !== 1
    || configuration.from_version !== 8
    || configuration.to_version !== 9
  ) {
    throw new SaveDataError("v8 到 v9 存档迁移配置版本链无效。");
  }
  const defaults = requireObject(configuration.state_defaults, "v9 迁移默认值");
  requireExactKeys(defaults, ["research_slotted_item_id"], "v9 迁移默认值");
  if (defaults.research_slotted_item_id !== null) {
    throw new SaveDataError("v9 迁移默认研究槽必须为空。");
  }
  const wallDistribution = requireObject(
    configuration.wall_distribution,
    "v9 墙体分配配置",
  );
  requireExactKeys(wallDistribution, ["inner_wall_percent"], "v9 墙体分配配置");
  const percent = configuration.wall_distribution.inner_wall_percent;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new SaveDataError("v9 内墙分配比例必须是 0 到 100 的整数。");
  }
}

/** 要求未知值为普通 JSON 对象。 */
function requireObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path}必须是对象。`);
  }
  return value as JsonObject;
}

/** 要求未知值是非负整数。 */
function requireNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SaveDataError(`${path}必须是非负整数。`);
  }
  return value;
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
    throw new SaveDataError(`${path}字段集合不匹配。`);
  }
}
