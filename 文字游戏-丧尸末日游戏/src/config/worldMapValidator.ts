import type {
  CityConfig,
  CityDistrictConfig,
  CityTerrain,
  EventsConfigDocument,
  GameConfigDocument,
} from "../domain/content";

const CITY_TERRAINS = ["land", "river", "coastal", "island"] as const;

/** 表示城市拓扑或区划内容无法安全装配。 */
export class WorldMapConfigError extends Error {
  /** 保留稳定错误名，便于启动层和测试识别配置问题。 */
  public constructor(message: string) {
    super(message);
    this.name = "WorldMapConfigError";
  }
}

/** 城市拓扑验证所需的配置化约束。 */
interface WorldMapConstraints {
  readonly minimumDistrictsPerCity: number;
  readonly homeCityIds: readonly string[];
  readonly neighborLimitsByTerrain: Readonly<Record<
    CityTerrain,
    { minimum: number; maximum: number }
  >>;
  readonly isolatedTerrains: ReadonlySet<CityTerrain>;
}

/** 校验城市、区划、大陆拓扑、岛屿隔离和事件引用的完整世界地图。 */
export function validateWorldMapConfig(
  game: GameConfigDocument,
  events: EventsConfigDocument,
): void {
  const constraints = readConstraints(game);
  const eventIds = indexEventIds(events);
  const cities = game.cities;
  if (cities.length === 0) {
    throw new WorldMapConfigError("世界地图至少需要一座城市。");
  }
  const cityById = indexCities(cities);
  validateHomeCities(game, cityById, constraints);
  const districtIds = new Set<string>();
  for (const city of cities) {
    validateCity(
      city,
      cityById,
      eventIds,
      districtIds,
      constraints,
    );
  }
  validateSymmetricTopology(cities, cityById);
  validateConnectedTopology(cities, cityById, constraints.isolatedTerrains);
}

/** 从主配置读取最小区划数、各地貌邻接范围与允许隔离地貌。 */
function readConstraints(game: GameConfigDocument): WorldMapConstraints {
  const worldMap: unknown = (
    game.rules as unknown as Readonly<Record<string, unknown>>
  )["world_map"];
  if (typeof worldMap !== "object" || worldMap === null) {
    throw new WorldMapConfigError("缺少 rules.world_map 配置。");
  }
  const source = worldMap as Readonly<Record<string, unknown>>;
  const rawLimits = requireObject(
    source["neighbor_limits_by_terrain"],
    "rules.world_map.neighbor_limits_by_terrain",
  );
  const neighborLimitsByTerrain = Object.fromEntries(
    CITY_TERRAINS.map((terrain) => {
      const limit = requireObject(
        rawLimits[terrain],
        `rules.world_map.neighbor_limits_by_terrain.${terrain}`,
      );
      const minimum = requireInteger(
        limit["minimum"],
        `rules.world_map.neighbor_limits_by_terrain.${terrain}.minimum`,
        0,
      );
      const maximum = requireInteger(
        limit["maximum"],
        `rules.world_map.neighbor_limits_by_terrain.${terrain}.maximum`,
        0,
      );
      if (minimum > maximum) {
        throw new WorldMapConfigError(
          `地貌 ${terrain} 的最小邻接数不能大于最大邻接数。`,
        );
      }
      return [terrain, { minimum, maximum }];
    }),
  ) as Record<CityTerrain, { minimum: number; maximum: number }>;
  const isolatedTerrains = new Set(
    requireStringArray(
      source["isolated_terrains"],
      "rules.world_map.isolated_terrains",
    ).map((terrain) => {
      if (!CITY_TERRAINS.includes(terrain as CityTerrain)) {
        throw new WorldMapConfigError(`未知隔离地貌：${terrain}。`);
      }
      return terrain as CityTerrain;
    }),
  );
  return {
    minimumDistrictsPerCity: requireInteger(
      source["minimum_districts_per_city"],
      "rules.world_map.minimum_districts_per_city",
      1,
    ),
    homeCityIds: requireStringArray(
      source["home_city_ids"],
      "rules.world_map.home_city_ids",
    ),
    neighborLimitsByTerrain,
    isolatedTerrains,
  };
}

/** 校验出生城市白名单非空、无重复、已配置且不属于隔离地貌。 */
function validateHomeCities(
  game: GameConfigDocument,
  cityById: ReadonlyMap<string, CityConfig>,
  constraints: WorldMapConstraints,
): void {
  if (constraints.homeCityIds.length === 0) {
    throw new WorldMapConfigError("rules.world_map.home_city_ids 至少需要一座出生城市。");
  }
  const uniqueIds = new Set(constraints.homeCityIds);
  if (uniqueIds.size !== constraints.homeCityIds.length) {
    throw new WorldMapConfigError("rules.world_map.home_city_ids 不能包含重复城市。");
  }
  for (const cityId of constraints.homeCityIds) {
    const city = cityById.get(cityId);
    if (city === undefined) {
      throw new WorldMapConfigError(`出生城市白名单引用未知城市：${cityId}。`);
    }
    if (constraints.isolatedTerrains.has(city.terrain)) {
      throw new WorldMapConfigError(`隔离地貌城市 ${cityId} 不能作为出生城市。`);
    }
  }
  if (!uniqueIds.has(game.campaign_profiles.migration_default.home_city_id)) {
    throw new WorldMapConfigError("迁移默认出生城市必须位于出生城市白名单。");
  }
}

/** 建立事件 ID 索引，并拒绝空值或重复事件。 */
function indexEventIds(events: EventsConfigDocument): ReadonlySet<string> {
  const eventIds = new Set<string>();
  for (const [index, event] of events.events.entries()) {
    const eventId = requireNonEmptyString(
      event.id,
      `events.events[${String(index)}].id`,
    );
    if (eventIds.has(eventId)) {
      throw new WorldMapConfigError(`探索事件 ID 重复：${eventId}。`);
    }
    eventIds.add(eventId);
  }
  return eventIds;
}

/** 建立城市 ID 索引，并拒绝空值或重复城市。 */
function indexCities(cities: readonly CityConfig[]): ReadonlyMap<string, CityConfig> {
  const cityById = new Map<string, CityConfig>();
  for (const [index, city] of cities.entries()) {
    const cityId = requireNonEmptyString(
      city.id,
      `cities[${String(index)}].id`,
    );
    if (cityById.has(cityId)) {
      throw new WorldMapConfigError(`城市 ID 重复：${cityId}。`);
    }
    cityById.set(cityId, city);
  }
  return cityById;
}

/** 校验单座城市的简介、邻接、兼容事件池和全部区划。 */
function validateCity(
  city: CityConfig,
  cityById: ReadonlyMap<string, CityConfig>,
  eventIds: ReadonlySet<string>,
  globalDistrictIds: Set<string>,
  constraints: WorldMapConstraints,
): void {
  const cityPath = `cities.${city.id}`;
  requireNonEmptyString(city.name, `${cityPath}.name`);
  requireNonEmptyString(city.description, `${cityPath}.description`);
  validateNeighborIds(
    city,
    cityById,
    constraints.neighborLimitsByTerrain[city.terrain],
  );
  validateCityAccessPolicy(city);
  validateEventReferences(city.event_ids, eventIds, `${cityPath}.event_ids`);
  if (city.districts.length < constraints.minimumDistrictsPerCity) {
    throw new WorldMapConfigError(
      `城市 ${city.id} 至少需要 ${String(constraints.minimumDistrictsPerCity)} 个区划。`,
    );
  }
  const localDistrictIds = new Set<string>();
  const localDistrictCodes = new Set<string>();
  for (const [index, district] of city.districts.entries()) {
    validateDistrict(
      city,
      district,
      index,
      eventIds,
      globalDistrictIds,
      localDistrictIds,
      localDistrictCodes,
    );
  }
  const districtEventIds = new Set(
    city.districts.flatMap((district) => district.event_ids),
  );
  for (const legacyEventId of city.event_ids) {
    if (!districtEventIds.has(legacyEventId)) {
      throw new WorldMapConfigError(
        `城市 ${city.id} 的兼容事件 ${legacyEventId} 未归入任何区划。`,
      );
    }
  }
  const defaultDistrictId = requireNonEmptyString(
    city.default_district_id,
    `${cityPath}.default_district_id`,
  );
  if (!localDistrictIds.has(defaultDistrictId)) {
    throw new WorldMapConfigError(
      `城市 ${city.id} 的默认区划 ${defaultDistrictId} 不属于该城市。`,
    );
  }
}

/** 校验一座城市的邻接数量、唯一性、自环和引用。 */
function validateNeighborIds(
  city: CityConfig,
  cityById: ReadonlyMap<string, CityConfig>,
  limits: { minimum: number; maximum: number } | undefined,
): void {
  if (limits === undefined) {
    throw new WorldMapConfigError(`城市 ${city.id} 使用了未知地貌 ${city.terrain}。`);
  }
  if (
    city.neighbor_ids.length < limits.minimum
    || city.neighbor_ids.length > limits.maximum
  ) {
    throw new WorldMapConfigError(
      `城市 ${city.id} 的邻接数必须位于 ${String(limits.minimum)} 到 ${String(limits.maximum)}。`,
    );
  }
  const uniqueNeighborIds = new Set(city.neighbor_ids);
  if (uniqueNeighborIds.size !== city.neighbor_ids.length) {
    throw new WorldMapConfigError(`城市 ${city.id} 的邻接城市不能重复。`);
  }
  for (const neighborId of city.neighbor_ids) {
    requireNonEmptyString(neighborId, `cities.${city.id}.neighbor_ids`);
    if (neighborId === city.id) {
      throw new WorldMapConfigError(`城市 ${city.id} 不能与自身相邻。`);
    }
    if (!cityById.has(neighborId)) {
      throw new WorldMapConfigError(
        `城市 ${city.id} 引用了未知邻接城市 ${neighborId}。`,
      );
    }
  }
}

/** 校验路线绕行开关与载具匹配策略，避免岛屿条件被默认逻辑绕过。 */
function validateCityAccessPolicy(city: CityConfig): void {
  const allowPathItems: unknown = city.allow_path_items;
  const transportMatch: unknown = city.transport_match;
  if (typeof allowPathItems !== "boolean") {
    throw new WorldMapConfigError(`城市 ${city.id} 缺少 allow_path_items 布尔配置。`);
  }
  if (transportMatch !== "any" && transportMatch !== "all") {
    throw new WorldMapConfigError(`城市 ${city.id} 的 transport_match 无效。`);
  }
  if (city.transport_item_ids.length === 0) {
    throw new WorldMapConfigError(`城市 ${city.id} 至少需要一种可用载具。`);
  }
  if (!allowPathItems && city.path_item_ids.length > 0) {
    throw new WorldMapConfigError(
      `城市 ${city.id} 禁止路线道具时不得继续配置 path_item_ids。`,
    );
  }
}

/** 校验单个区划的稳定字段、危险数值与事件池。 */
function validateDistrict(
  city: CityConfig,
  district: CityDistrictConfig,
  index: number,
  eventIds: ReadonlySet<string>,
  globalDistrictIds: Set<string>,
  localDistrictIds: Set<string>,
  localDistrictCodes: Set<string>,
): void {
  const districtPath = `cities.${city.id}.districts[${String(index)}]`;
  const districtId = requireNonEmptyString(district.id, `${districtPath}.id`);
  if (globalDistrictIds.has(districtId)) {
    throw new WorldMapConfigError(`区划 ID 重复：${districtId}。`);
  }
  globalDistrictIds.add(districtId);
  localDistrictIds.add(districtId);
  const districtCode = requireNonEmptyString(district.code, `${districtPath}.code`);
  if (localDistrictCodes.has(districtCode)) {
    throw new WorldMapConfigError(
      `城市 ${city.id} 的区划编号重复：${districtCode}。`,
    );
  }
  localDistrictCodes.add(districtCode);
  requireNonEmptyString(district.name, `${districtPath}.name`);
  requireNonEmptyString(district.description, `${districtPath}.description`);
  requireInteger(district.danger_level, `${districtPath}.danger_level`, 1);
  requireInteger(district.event_step_cost, `${districtPath}.event_step_cost`, 0);
  validateEventReferences(district.event_ids, eventIds, `${districtPath}.event_ids`);
}

/** 校验一个非空事件池只含唯一且已配置的事件 ID。 */
function validateEventReferences(
  references: readonly string[],
  eventIds: ReadonlySet<string>,
  path: string,
): void {
  if (references.length === 0) {
    throw new WorldMapConfigError(`${path} 不得为空。`);
  }
  const uniqueReferences = new Set(references);
  if (uniqueReferences.size !== references.length) {
    throw new WorldMapConfigError(`${path} 不得包含重复事件。`);
  }
  for (const eventId of references) {
    requireNonEmptyString(eventId, path);
    if (!eventIds.has(eventId)) {
      throw new WorldMapConfigError(`${path} 引用了未知事件 ${eventId}。`);
    }
  }
}

/** 确保每条城市邻接边都在对端城市中反向声明。 */
function validateSymmetricTopology(
  cities: readonly CityConfig[],
  cityById: ReadonlyMap<string, CityConfig>,
): void {
  for (const city of cities) {
    for (const neighborId of city.neighbor_ids) {
      const neighbor = cityById.get(neighborId);
      if (neighbor === undefined || !neighbor.neighbor_ids.includes(city.id)) {
        throw new WorldMapConfigError(
          `城市邻接必须对称：${city.id} 与 ${neighborId}。`,
        );
      }
    }
  }
}

/** 从首座大陆城市遍历拓扑，并允许配置声明的岛屿地貌独立存在。 */
function validateConnectedTopology(
  cities: readonly CityConfig[],
  cityById: ReadonlyMap<string, CityConfig>,
  isolatedTerrains: ReadonlySet<CityTerrain>,
): void {
  const connectedCities = cities.filter(
    (city) => !isolatedTerrains.has(city.terrain),
  );
  const firstCity = connectedCities[0];
  if (firstCity === undefined) {
    return;
  }
  const visited = new Set<string>();
  const pending = [firstCity.id];
  while (pending.length > 0) {
    const cityId = pending.shift();
    if (cityId === undefined || visited.has(cityId)) {
      continue;
    }
    visited.add(cityId);
    const city = cityById.get(cityId);
    if (city !== undefined) {
      pending.push(...city.neighbor_ids.filter((neighborId) => !visited.has(neighborId)));
    }
  }
  if (visited.size !== connectedCities.length) {
    throw new WorldMapConfigError("非岛屿城市拓扑必须保持连通。");
  }
}

/** 读取普通对象供动态规则字段安全解析。 */
function requireObject(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorldMapConfigError(`${path} 必须是对象。`);
  }
  return value as Readonly<Record<string, unknown>>;
}

/** 读取不重复的非空字符串数组。 */
function requireStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new WorldMapConfigError(`${path} 必须是数组。`);
  }
  const items = value.map((item) => requireNonEmptyString(item, path));
  if (new Set(items).size !== items.length) {
    throw new WorldMapConfigError(`${path} 不得包含重复值。`);
  }
  return items;
}

/** 读取非空字符串，并保留原始内容供索引使用。 */
function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorldMapConfigError(`${path} 必须是非空字符串。`);
  }
  return value;
}

/** 读取不小于配置下限的整数。 */
function requireInteger(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new WorldMapConfigError(
      `${path} 必须是不小于 ${String(minimum)} 的整数。`,
    );
  }
  return value;
}
