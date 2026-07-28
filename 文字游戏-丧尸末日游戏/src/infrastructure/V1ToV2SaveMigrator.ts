import type { SaveMigrationConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

/** 使用冻结的迁移默认值把旧版生存存档提升为 v2 剧情存档。 */
export class V1ToV2SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly configuration: SaveMigrationConfig;

  /** 校验并保存不随当前新游戏默认值漂移的迁移配置。 */
  public constructor(configuration: SaveMigrationConfig) {
    this.validateConfiguration(configuration);
    this.configuration = structuredClone(configuration);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
  }

  /** 保留 v1 生存字段，移除旧终局字段并补齐全部 v2 状态。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const rawState = document.game_state;
    if (!isObject(rawState)) {
      throw new SaveDataError("v1 存档缺少 game_state。");
    }
    const state = structuredClone(rawState);
    const wasEnded = state.ended;
    const endingMessage = state.ending_message;
    if (typeof wasEnded !== "boolean" || typeof endingMessage !== "string") {
      throw new SaveDataError("v1 终局字段无效。");
    }
    delete state.ended;
    delete state.ending_message;
    Object.assign(state, structuredClone(this.configuration.state_defaults));
    if (wasEnded) {
      state.ending = {
        ending_id: this.configuration.legacy_failure.ending_id,
        outcome: this.configuration.legacy_failure.outcome,
        message: endingMessage,
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 严格验证迁移配置版本链和默认字段集合。 */
  private validateConfiguration(configuration: SaveMigrationConfig): void {
    requireExactKeys(
      configuration,
      ["schema_version", "from_version", "to_version", "state_defaults", "legacy_failure"],
      "存档迁移配置",
    );
    if (configuration.schema_version !== 1) {
      throw new SaveDataError("不支持的迁移配置版本。");
    }
    if (configuration.from_version !== 1 || configuration.to_version !== 2) {
      throw new SaveDataError("迁移配置版本链必须为 1 到 2。");
    }
    requireExactKeys(
      configuration.state_defaults,
      ["story", "companions", "facility_levels", "battle", "pending_exploration", "ending"],
      "迁移默认状态",
    );
    requireExactKeys(
      configuration.legacy_failure,
      ["ending_id", "outcome"],
      "旧档失败结局映射",
    );
    if (configuration.legacy_failure.ending_id.trim() === "") {
      throw new SaveDataError("旧档失败结局 ID 无效。");
    }
    const outcome: unknown = configuration.legacy_failure.outcome;
    if (outcome !== "failure") {
      throw new SaveDataError("旧档结局类型必须为 failure。");
    }
  }
}

/** 判断未知值是否是普通 JSON 对象容器。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 要求对象的字段集合精确匹配预期。 */
function requireExactKeys(
  value: object,
  expectedKeys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SaveDataError(`${path}字段集合不匹配。`);
  }
}
