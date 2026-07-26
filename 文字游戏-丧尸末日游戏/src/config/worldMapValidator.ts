import type {
  CityConfig,
  CityDistrictConfig,
  EventsConfigDocument,
  GameConfigDocument,
} from "../domain/content";

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
  readonly requiredNeighborDegree: number;
}

/** 校验城市、区划、环形拓扑和事件引用的完整世界地图。 */
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
  if (cities.length <= constraints.requiredNeighborDegree) {
    throw new WorldMapConfigError("城市数量必须大于每座城市的邻接度数。");
  }
  const cityById = indexCities(cities);
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
  validateConnectedTopology(cities, cityById);
}

/** 从主配置读取最小区划数和固定邻接度数。 */
function readConstraints(game: GameConfigDocument): WorldMapConstraints {
  const worldMap: unknown = (
    game.rules as unknown as Readonly<Record<string, unknown>>
  )["world_map"];
  if (typeof worldMap !== "object" || worldMap === null) {
    throw new WorldMapConfigError("缺少 rules.world_map 配置。");
  }
  const source = worldMap as Readonly<Record<string, unknown>>;
  return {
    minimumDistrictsPerCity: requireInteger(
      source["minimum_districts_per_city"],
      "rules.world_map.minimum_districts_per_city",
      1,
    ),
    requiredNeighborDegree: requireInteger(
      source["required_neighbor_degree"],
      "rules.world_map.required_neighbor_degree",
      1,
    ),
  };
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
  validateNeighborIds(city, cityById, constraints.requiredNeighborDegree);
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
  requiredDegree: number,
): void {
  if (city.neighbor_ids.length !== requiredDegree) {
    throw new WorldMapConfigError(
      `城市 ${city.id} 必须配置 ${String(requiredDegree)} 个邻接城市。`,
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

/** 从首座城市遍历拓扑，确保不存在孤立的城市环。 */
function validateConnectedTopology(
  cities: readonly CityConfig[],
  cityById: ReadonlyMap<string, CityConfig>,
): void {
  const firstCity = cities[0];
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
  if (visited.size !== cities.length) {
    throw new WorldMapConfigError("城市拓扑必须是一个连通的环。");
  }
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
