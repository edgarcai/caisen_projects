import { describe, expect, it } from "vitest";
import eventsDocument from "../../config/events.json";
import gameDocument from "../../config/game_config.json";
import { validateWorldMapConfig } from "../../src/config/worldMapValidator";
import type {
  CityConfig,
  CityDistrictConfig,
  EventsConfigDocument,
  GameConfigDocument,
} from "../../src/domain/content";

const configuredEvents = eventsDocument as unknown as EventsConfigDocument;

/** 为破坏性验证用例创建一份不会污染真实配置的深拷贝。 */
function cloneGameConfig(): GameConfigDocument {
  return structuredClone(gameDocument) as unknown as GameConfigDocument;
}

/** 按稳定 ID 取得可供用例定向修改的城市。 */
function requireCity(game: GameConfigDocument, cityId: string): CityConfig {
  const city = game.cities.find((candidate) => candidate.id === cityId);
  if (city === undefined) {
    throw new Error(`测试配置缺少城市 ${cityId}。`);
  }
  return city;
}

/** 仅在隔离测试副本中替换一座城市的邻接列表。 */
function setNeighbors(city: CityConfig, neighborIds: readonly string[]): void {
  (city as CityConfig & { neighbor_ids: string[] }).neighbor_ids = [...neighborIds];
}

/** 返回可移除或改写的区划数组视图。 */
function mutableDistricts(city: CityConfig): CityDistrictConfig[] {
  return city.districts as CityDistrictConfig[];
}

describe("世界地图配置验证", () => {
  it("真实 A-H 城市形成严格环形且每市配置六个完整区划", () => {
    const game = cloneGameConfig();
    const expectedTopology: Readonly<Record<string, readonly string[]>> = {
      city_a: ["city_h", "city_b"],
      city_b: ["city_a", "city_c"],
      city_c: ["city_b", "city_d"],
      city_d: ["city_c", "city_e"],
      city_e: ["city_d", "city_f"],
      city_f: ["city_e", "city_g"],
      city_g: ["city_f", "city_h"],
      city_h: ["city_g", "city_a"],
    };

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).not.toThrow();
    expect(game.cities.map((city) => city.name)).toEqual([
      "A市", "B市", "C市", "D市", "E市", "F市", "G市", "H市",
    ]);
    for (const city of game.cities) {
      expect(city.neighbor_ids, city.id).toEqual(expectedTopology[city.id]);
      expect(city.districts, city.id).toHaveLength(
        game.rules.world_map.minimum_districts_per_city,
      );
      expect(city.districts.map((district) => district.code)).toEqual([
        "A区", "B区", "C区", "D区", "E区", "F区",
      ]);
      expect(city.districts.some(
        (district) => district.id === city.default_district_id,
      )).toBe(true);
      for (const district of city.districts) {
        expect(district.name.trim()).not.toBe("");
        expect(district.description.trim()).not.toBe("");
        expect(district.event_ids.length).toBeGreaterThan(0);
      }
    }
  });

  it("拒绝单向邻接，避免运行时以双向查找掩盖配置错误", () => {
    const game = cloneGameConfig();
    setNeighbors(requireCity(game, "city_h"), ["city_g", "city_b"]);

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).toThrow(
      /城市邻接必须对称/,
    );
  });

  it("拒绝邻接度数与配置化环形约束不符的城市", () => {
    const game = cloneGameConfig();
    setNeighbors(requireCity(game, "city_d"), ["city_c"]);

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).toThrow(
      /必须配置 2 个邻接城市/,
    );
  });

  it("拒绝由多个孤立环组成的非连通拓扑", () => {
    const game = cloneGameConfig();
    const disconnectedTopology: Readonly<Record<string, readonly string[]>> = {
      city_a: ["city_b", "city_d"],
      city_b: ["city_a", "city_c"],
      city_c: ["city_b", "city_d"],
      city_d: ["city_c", "city_a"],
      city_e: ["city_f", "city_h"],
      city_f: ["city_e", "city_g"],
      city_g: ["city_f", "city_h"],
      city_h: ["city_g", "city_e"],
    };
    for (const city of game.cities) {
      setNeighbors(city, disconnectedTopology[city.id] ?? []);
    }

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).toThrow(
      /必须是一个连通的环/,
    );
  });

  it("拒绝少于配置下限的城市区划", () => {
    const game = cloneGameConfig();
    mutableDistricts(requireCity(game, "city_a")).pop();

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).toThrow(
      /至少需要 6 个区划/,
    );
  });

  it("拒绝跨城市重复的区划 ID", () => {
    const game = cloneGameConfig();
    const sourceDistrict = mutableDistricts(requireCity(game, "city_a"))[0];
    const targetDistrict = mutableDistricts(requireCity(game, "city_b"))[0];
    if (sourceDistrict === undefined || targetDistrict === undefined) {
      throw new Error("测试配置缺少区划。");
    }
    targetDistrict.id = sourceDistrict.id;

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).toThrow(
      /区划 ID 重复/,
    );
  });

  it("拒绝不属于当前城市的默认区划", () => {
    const game = cloneGameConfig();
    requireCity(game, "city_d").default_district_id = "city_e_district_a";

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).toThrow(
      /默认区划 .* 不属于该城市/,
    );
  });

  it("拒绝区划引用未配置的探索事件", () => {
    const game = cloneGameConfig();
    const district = mutableDistricts(requireCity(game, "city_g"))[0];
    if (district === undefined) {
      throw new Error("测试配置缺少区划。");
    }
    (district as CityDistrictConfig & { event_ids: string[] }).event_ids = [
      "unknown_event",
    ];

    expect(() => {
      validateWorldMapConfig(game, configuredEvents);
    }).toThrow(
      /引用了未知事件 unknown_event/,
    );
  });
});
