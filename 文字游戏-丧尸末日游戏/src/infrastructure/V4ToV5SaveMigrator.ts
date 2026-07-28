import type {
  CityConfig,
  V4ToV5SaveMigrationConfig,
} from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

/** 为 v4 存档补齐活动远征和待决事件的区划归属。 */
export class V4ToV5SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly cityById: ReadonlyMap<string, CityConfig>;

  /** 校验迁移链并从世界地图建立只读城市索引。 */
  public constructor(
    configuration: V4ToV5SaveMigrationConfig,
    cities: readonly CityConfig[],
  ) {
    validateConfiguration(configuration);
    this.validateCities(cities);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
    this.cityById = new Map(cities.map((city) => [city.id, structuredClone(city)]));
  }

  /** 同步迁移当前状态与检查点快照，不改写其他游戏进度。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const rawState = requireObject(document.game_state, "v4 存档 game_state");
    const state = this.migrateRestorableState(rawState, "v4 存档 game_state");
    if (state.checkpoint !== null) {
      const checkpoint = requireObject(state.checkpoint, "v4 存档 checkpoint");
      state.checkpoint = {
        ...checkpoint,
        snapshot: this.migrateRestorableState(
          requireObject(checkpoint.snapshot, "v4 存档 checkpoint.snapshot"),
          "v4 存档 checkpoint.snapshot",
        ),
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 为一份可回档状态选择稳定区划并写入两个关联容器。 */
  private migrateRestorableState(
    rawState: Readonly<Record<string, unknown>>,
    path: string,
  ): Record<string, unknown> {
    const state: Record<string, unknown> = structuredClone(rawState);
    const expedition = state.expedition === null
      ? null
      : requireObject(state.expedition, `${path}.expedition`);
    const pending = state.pending_exploration === null
      ? null
      : requireObject(state.pending_exploration, `${path}.pending_exploration`);
    if (expedition !== null && pending !== null) {
      const expeditionCityId = requireNonEmptyString(
        expedition.city_id,
        `${path}.expedition.city_id`,
      );
      const pendingCityId = requireNonEmptyString(
        pending.city_id,
        `${path}.pending_exploration.city_id`,
      );
      if (expeditionCityId !== pendingCityId) {
        throw new SaveDataError(`${path} 的远征城市与待决事件城市不一致。`);
      }
    }
    const expeditionDistrictId = expedition === null
      ? null
      : this.selectDistrictId(
          requireNonEmptyString(expedition.city_id, `${path}.expedition.city_id`),
          pending === null
            ? null
            : requireNonEmptyString(
                pending.event_id,
                `${path}.pending_exploration.event_id`,
              ),
        );
    if (expedition !== null && expeditionDistrictId !== null) {
      state.expedition = { ...expedition, district_id: expeditionDistrictId };
    }
    if (pending !== null) {
      const pendingCityId = requireNonEmptyString(
        pending.city_id,
        `${path}.pending_exploration.city_id`,
      );
      const eventId = requireNonEmptyString(
        pending.event_id,
        `${path}.pending_exploration.event_id`,
      );
      state.pending_exploration = {
        ...pending,
        district_id: expeditionDistrictId
          ?? this.selectDistrictId(pendingCityId, eventId),
      };
    }
    return state;
  }

  /** 优先选择包含待决事件的区划，否则回退城市配置的默认区划。 */
  private selectDistrictId(cityId: string, eventId: string | null): string {
    const city = this.cityById.get(cityId);
    if (city === undefined) {
      throw new SaveDataError(`v4 存档引用未知城市：${cityId}。`);
    }
    const matched = eventId === null
      ? undefined
      : city.districts.find((district) => district.event_ids.includes(eventId));
    return matched?.id ?? city.default_district_id;
  }

  /** 验证迁移依赖的城市 ID、区划与默认区划不含空值或重复项。 */
  private validateCities(cities: readonly CityConfig[]): void {
    if (cities.length === 0) {
      throw new SaveDataError("v4 到 v5 迁移至少需要一座城市配置。");
    }
    const cityIds = new Set<string>();
    for (const city of cities) {
      const cityId = requireNonEmptyString(city.id, "迁移城市.id");
      if (cityIds.has(cityId)) {
        throw new SaveDataError(`迁移城市 ID 重复：${cityId}。`);
      }
      cityIds.add(cityId);
      const districtIds = new Set(city.districts.map((district) => district.id));
      if (!districtIds.has(city.default_district_id)) {
        throw new SaveDataError(`迁移城市 ${cityId} 的默认区划无效。`);
      }
    }
  }
}

/** 严格验证 4→5 配置文件只声明受支持的单步版本链。 */
function validateConfiguration(configuration: V4ToV5SaveMigrationConfig): void {
  const root = requireObject(configuration, "v4 到 v5 存档迁移配置");
  const actualKeys = Object.keys(root).sort();
  const expectedKeys = ["schema_version", "from_version", "to_version"].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new SaveDataError("v4 到 v5 存档迁移配置字段集合不匹配。");
  }
  if (configuration.schema_version !== 1) {
    throw new SaveDataError("不支持的 v4 到 v5 迁移配置版本。");
  }
  if (configuration.from_version !== 4 || configuration.to_version !== 5) {
    throw new SaveDataError("迁移配置版本链必须为 4 到 5。");
  }
}

/** 要求未知值是 JSON 对象而非数组或 null。 */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path}必须是对象。`);
  }
  return value as Record<string, unknown>;
}

/** 返回去除空白后仍非空的字符串。 */
function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SaveDataError(`${path}必须是非空字符串。`);
  }
  return value;
}
