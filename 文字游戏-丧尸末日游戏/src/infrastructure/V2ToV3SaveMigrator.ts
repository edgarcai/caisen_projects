import type { V2ToV3SaveMigrationConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { GameDateState } from "../domain/game-state";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

const MILLISECONDS_PER_DAY = 86_400_000;

/** 为 v2 存档补齐时间线、日志与后续玩法容器。 */
export class V2ToV3SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly configuration: V2ToV3SaveMigrationConfig;

  /** 校验并冻结不随新游戏默认值漂移的迁移配置。 */
  public constructor(configuration: V2ToV3SaveMigrationConfig) {
    this.validateConfiguration(configuration);
    this.configuration = structuredClone(configuration);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
  }

  /** 保留 v2 完整进度，并按日历推导已跨过的生存日数。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const rawState = document.game_state;
    if (!isObject(rawState)) {
      throw new SaveDataError("v2 存档缺少 game_state。");
    }
    const clock = rawState.clock;
    if (!isObject(clock)) {
      throw new SaveDataError("v2 存档时钟无效。");
    }
    const currentDate = this.readDate(clock, "v2 存档时钟");
    const state = structuredClone(rawState);
    Object.assign(state, structuredClone(this.configuration.state_defaults));
    state.survival_days = this.elapsedDays(
      this.configuration.campaign_start_date,
      currentDate,
    );
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 严格校验迁移链、战役起日和 v3 默认容器。 */
  private validateConfiguration(configuration: V2ToV3SaveMigrationConfig): void {
    requireExactKeys(
      configuration,
      ["schema_version", "from_version", "to_version", "campaign_start_date", "state_defaults"],
      "v2 到 v3 存档迁移配置",
    );
    if (configuration.schema_version !== 1) {
      throw new SaveDataError("不支持的 v2 到 v3 迁移配置版本。");
    }
    if (configuration.from_version !== 2 || configuration.to_version !== 3) {
      throw new SaveDataError("迁移配置版本链必须为 2 到 3。");
    }
    this.readDate(configuration.campaign_start_date, "战役起始日期");
    const defaults = configuration.state_defaults;
    requireExactKeys(
      defaults,
      [
        "communication_log",
        "weekly_archives",
        "checkpoint",
        "inventory",
        "research",
        "expedition",
      ],
      "v3 迁移默认状态",
    );
    if (!Array.isArray(defaults.communication_log) || !Array.isArray(defaults.weekly_archives)) {
      throw new SaveDataError("v3 迁移日志默认值必须是列表。");
    }
    if (defaults.checkpoint !== null || defaults.expedition !== null) {
      throw new SaveDataError("v3 迁移检查点与远征默认值必须为 null。");
    }
    requireExactKeys(
      defaults.inventory,
      ["crafted_items", "equipped_weapon_id", "equipped_armor_id"],
      "v3 迁移背包默认状态",
    );
    requireExactKeys(defaults.research, ["completed_project_ids"], "v3 迁移研究默认状态");
    if (!isObject(defaults.inventory.crafted_items)) {
      throw new SaveDataError("v3 迁移制作物品默认值必须是对象。");
    }
    if (!Array.isArray(defaults.research.completed_project_ids)) {
      throw new SaveDataError("v3 迁移研究项目默认值必须是列表。");
    }
  }

  /** 从未知对象中读取一个真实存在的公历日期。 */
  private readDate(value: unknown, path: string): GameDateState {
    if (!isObject(value)) {
      throw new SaveDataError(`${path}必须是对象。`);
    }
    const year = value.year;
    const month = value.month;
    const day = value.day;
    if (
      typeof year !== "number"
      || !Number.isInteger(year)
      || typeof month !== "number"
      || !Number.isInteger(month)
      || typeof day !== "number"
      || !Number.isInteger(day)
    ) {
      throw new SaveDataError(`${path}必须包含整数年、月、日。`);
    }
    const date = { year, month, day };
    const timestamp = utcTimestamp(date);
    const roundTrip = new Date(timestamp);
    if (
      year < 1
      || roundTrip.getUTCFullYear() !== year
      || roundTrip.getUTCMonth() + 1 !== month
      || roundTrip.getUTCDate() !== day
    ) {
      throw new SaveDataError(`${path}不是有效公历日期。`);
    }
    return date;
  }

  /** 按 UTC 日界线计算从战役起日到存档日期的天数。 */
  private elapsedDays(start: GameDateState, current: GameDateState): number {
    const elapsed = Math.floor((utcTimestamp(current) - utcTimestamp(start)) / MILLISECONDS_PER_DAY);
    if (elapsed < 0) {
      throw new SaveDataError("v2 存档日期早于战役起始日期。");
    }
    return elapsed;
  }
}

/** 判断未知值是否为普通 JSON 对象。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 要求对象字段集合精确匹配预期。 */
function requireExactKeys(value: object, expectedKeys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SaveDataError(`${path}字段集合不匹配。`);
  }
}

/** 将公历日期转换为不受本地时区影响的毫秒数。 */
function utcTimestamp(date: GameDateState): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}
