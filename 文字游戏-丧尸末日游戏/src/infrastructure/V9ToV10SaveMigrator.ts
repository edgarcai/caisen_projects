import type { V9ToV10SaveMigrationConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

type JsonObject = Record<string, unknown>;

/** 为 v9 待决探索状态增加可持久的分支节点与路径。 */
export class V9ToV10SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly branchNodeIdDefault: null;
  private readonly branchPathDefault: readonly string[];

  /** 校验单步版本链与空分支游标默认值。 */
  public constructor(configuration: V9ToV10SaveMigrationConfig) {
    validateConfiguration(configuration);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
    this.branchNodeIdDefault = configuration.state_defaults.branch_node_id;
    this.branchPathDefault = [...configuration.state_defaults.branch_path];
  }

  /** 同步迁移当前状态及十日回档快照中的待决探索。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const state = this.migrateRestorableState(
      requireObject(document.game_state, "v9 存档 game_state"),
    );
    if (state.checkpoint !== null) {
      const checkpoint = requireObject(state.checkpoint, "v9 存档 checkpoint");
      state.checkpoint = {
        ...checkpoint,
        snapshot: this.migrateRestorableState(
          requireObject(
            checkpoint.snapshot,
            "v9 存档 checkpoint.snapshot",
          ),
        ),
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 仅为存在的待决探索添加独立默认游标。 */
  private migrateRestorableState(rawState: Readonly<JsonObject>): JsonObject {
    const state = structuredClone(rawState) as JsonObject;
    if (state.pending_exploration === null) return state;
    const pending = requireObject(
      state.pending_exploration,
      "v9 存档 pending_exploration",
    );
    state.pending_exploration = {
      ...pending,
      branch_node_id: this.branchNodeIdDefault,
      branch_path: [...this.branchPathDefault],
    };
    return state;
  }
}

/** 严格校验 v9 到 v10 迁移配置的字段集与空游标约束。 */
function validateConfiguration(configuration: V9ToV10SaveMigrationConfig): void {
  const root = requireObject(configuration, "v9 到 v10 存档迁移配置");
  requireExactKeys(
    root,
    ["schema_version", "from_version", "to_version", "state_defaults"],
    "v9 到 v10 存档迁移配置",
  );
  if (
    configuration.schema_version !== 1
    || configuration.from_version !== 9
    || configuration.to_version !== 10
  ) {
    throw new SaveDataError("v9 到 v10 存档迁移配置版本链无效。");
  }
  const defaults = requireObject(configuration.state_defaults, "v10 迁移默认值");
  requireExactKeys(
    defaults,
    ["branch_node_id", "branch_path"],
    "v10 迁移默认值",
  );
  if (defaults.branch_node_id !== null) {
    throw new SaveDataError("v10 迁移默认分支节点必须为空。");
  }
  if (
    !Array.isArray(defaults.branch_path)
    || defaults.branch_path.length !== 0
  ) {
    throw new SaveDataError("v10 迁移默认分支路径必须为空列表。");
  }
}

/** 要求未知值为普通 JSON 对象。 */
function requireObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path}必须是对象。`);
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
    throw new SaveDataError(`${path}字段集合不匹配。`);
  }
}
