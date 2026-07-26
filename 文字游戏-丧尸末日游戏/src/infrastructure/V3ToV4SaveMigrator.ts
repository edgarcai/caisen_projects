import type { V3ToV4SaveMigrationConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

const CAMPAIGN_FIELDS = [
  "difficulty_id",
  "origin_id",
  "trait_id",
  "home_city_id",
] as const;

/** 为 v3 存档补齐开局档案与城市旅行路费。 */
export class V3ToV4SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly configuration: V3ToV4SaveMigrationConfig;

  /** 严格校验并冻结不随新游戏默认值漂移的迁移配置。 */
  public constructor(configuration: V3ToV4SaveMigrationConfig) {
    this.validateConfiguration(configuration);
    this.configuration = structuredClone(configuration);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
  }

  /** 保留 v3 全部进度，并同步提升当前状态与检查点快照。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const rawState = requireObject(document.game_state, "v3 存档 game_state");
    const state = this.migrateRestorableState(rawState, "v3 存档 game_state");
    if (state.checkpoint !== null) {
      const checkpoint = requireObject(state.checkpoint, "v3 存档 checkpoint");
      const snapshot = requireObject(
        checkpoint.snapshot,
        "v3 存档 checkpoint.snapshot",
      );
      state.checkpoint = {
        ...checkpoint,
        snapshot: this.migrateRestorableState(
          snapshot,
          "v3 存档 checkpoint.snapshot",
        ),
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 给一份可回档状态添加 v4 字段，不改写其他进度。 */
  private migrateRestorableState(
    rawState: Readonly<Record<string, unknown>>,
    path: string,
  ): Record<string, unknown> {
    const state: Record<string, unknown> = structuredClone(rawState);
    state.campaign = structuredClone(this.configuration.state_defaults.campaign);
    if (state.expedition !== null) {
      const expedition = requireObject(state.expedition, `${path}.expedition`);
      state.expedition = {
        ...expedition,
        travel_step_cost: this.configuration.state_defaults.expedition_travel_step_cost,
      };
    }
    return state;
  }

  /** 严格验证 3→4 版本链、开局档案与正整数路费默认值。 */
  private validateConfiguration(configuration: V3ToV4SaveMigrationConfig): void {
    const root = requireExactKeys(
      configuration,
      ["schema_version", "from_version", "to_version", "state_defaults"],
      "v3 到 v4 存档迁移配置",
    );
    if (root.schema_version !== 1) {
      throw new SaveDataError("不支持的 v3 到 v4 迁移配置版本。");
    }
    if (root.from_version !== 3 || root.to_version !== 4) {
      throw new SaveDataError("迁移配置版本链必须为 3 到 4。");
    }
    const defaults = requireExactKeys(
      root.state_defaults,
      ["campaign", "expedition_travel_step_cost"],
      "v4 迁移默认状态",
    );
    const campaign = requireExactKeys(
      defaults.campaign,
      CAMPAIGN_FIELDS,
      "v4 迁移开局档案",
    );
    for (const field of CAMPAIGN_FIELDS) {
      requireNonEmptyString(campaign[field], `v4 迁移开局档案.${field}`);
    }
    requirePositiveInteger(
      defaults.expedition_travel_step_cost,
      "v4 迁移默认城市路费",
    );
  }
}

/** 要求未知值是 JSON 对象而非数组或 null。 */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path}必须是对象。`);
  }
  return value as Record<string, unknown>;
}

/** 要求对象字段集合与预期完全一致并返回安全视图。 */
function requireExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  const object = requireObject(value, path);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SaveDataError(`${path}字段集合不匹配。`);
  }
  return object;
}

/** 要求值是去除空白后仍非空的字符串。 */
function requireNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SaveDataError(`${path}必须是非空字符串。`);
  }
}

/** 要求值是大于零的整数。 */
function requirePositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SaveDataError(`${path}必须是正整数。`);
  }
}
