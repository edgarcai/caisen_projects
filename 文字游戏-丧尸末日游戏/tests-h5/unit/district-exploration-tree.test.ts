import { describe, expect, it } from "vitest";
import districtExplorationTreeDocument from "../../config/district_exploration_tree.json";
import gameDocument from "../../config/game_config.json";
import {
  districtExplorationTreeConfig,
  parseDistrictExplorationTreeConfig,
} from "../../src/config/districtExplorationTreeConfig";
import type {
  DistrictExplorationCatalogPort,
  DistrictExplorationCityReference,
  DistrictExplorationDistrictReference,
} from "../../src/domain/district-exploration-tree";
import { DistrictExplorationTreeService } from "../../src/services/DistrictExplorationTreeService";

type TestDistrict = DistrictExplorationDistrictReference;

interface TestCity extends DistrictExplorationCityReference {
  readonly districts: readonly TestDistrict[];
}

const cities = gameDocument.cities as readonly TestCity[];

/** 使用真实城市配置提供最小目录端口，并拒绝跨城市区划。 */
class TestDistrictCatalog implements DistrictExplorationCatalogPort {
  /** 按稳定 ID 返回真实城市。 */
  public city(cityId: string): TestCity {
    const city = cities.find((candidate) => candidate.id === cityId);
    if (city === undefined) {
      throw new Error(`未知测试城市：${cityId}`);
    }
    return city;
  }

  /** 按城市和区划 ID 返回真实区划。 */
  public district(cityId: string, districtId: string): TestDistrict {
    const district = this.city(cityId).districts.find(
      (candidate) => candidate.id === districtId,
    );
    if (district === undefined) {
      throw new Error(`城市 ${cityId} 不包含区划 ${districtId}`);
    }
    return district;
  }
}

/** 创建使用真实规则和真实城市目录的确定性服务。 */
function createService(): DistrictExplorationTreeService {
  return new DistrictExplorationTreeService(
    districtExplorationTreeConfig,
    new TestDistrictCatalog(),
  );
}

/** 返回第一座城市的第一个真实区划。 */
function firstDistrict(): {
  readonly city: TestCity;
  readonly district: TestDistrict;
} {
  const city = cities[0];
  const district = city?.districts[0];
  if (city === undefined || district === undefined) {
    throw new Error("真实配置缺少测试区划。");
  }
  return { city, district };
}

describe("区划多层探索配置", () => {
  it("把所有数量、深度和占位模板从 JSON 装配出来", () => {
    expect(districtExplorationTreeConfig.depth_policy).toEqual({
      minimum_depth: 4,
      maximum_depth: 5,
    });
    expect(districtExplorationTreeConfig.layers.map((layer) => (
      layer.option_count
    ))).toEqual([40, 20, 10, 10, 10]);
    expect(districtExplorationTreeConfig.layers.every((layer) => (
      layer.label_templates.length > 0
      && layer.description_templates.length > 0
    ))).toBe(true);
  });

  it("拒绝层级缺口、无效数量和未知文案占位符", () => {
    const missingLayer = structuredClone(districtExplorationTreeDocument);
    missingLayer.layers.splice(2, 1);
    expect(() => parseDistrictExplorationTreeConfig(missingLayer)).toThrow(
      /每一层提供规则/u,
    );

    const invalidCount = structuredClone(districtExplorationTreeDocument);
    const firstLayer = invalidCount.layers[0];
    if (firstLayer === undefined) throw new Error("测试配置缺少第一层。");
    firstLayer.option_count = 0;
    expect(() => parseDistrictExplorationTreeConfig(invalidCount)).toThrow(
      /option_count/u,
    );

    const invalidTemplate = structuredClone(districtExplorationTreeDocument);
    const secondLayer = invalidTemplate.layers[1];
    if (secondLayer === undefined) throw new Error("测试配置缺少第二层。");
    secondLayer.label_templates = ["未知参数 {random_value}"];
    expect(() => parseDistrictExplorationTreeConfig(invalidTemplate)).toThrow(
      /未知占位符/u,
    );
  });
});

describe("区划多层探索懒生成服务", () => {
  it("为全部 48 个真实区划即时投影 40 个一层入口", () => {
    const service = createService();
    const selectedDepths = new Set<number>();
    let districtCount = 0;

    for (const city of cities) {
      for (const district of city.districts) {
        districtCount += 1;
        const root = service.projectRoot(city.id, district.id);
        selectedDepths.add(root.maximumDepth);
        expect(root.depth).toBe(1);
        expect(root.options).toHaveLength(40);
        expect(new Set(root.options.map((option) => option.nodeId)).size).toBe(40);
        expect(root.options.every((option) => option.childCount === 20)).toBe(true);
      }
    }

    expect(districtCount).toBe(48);
    expect([...selectedDepths].sort()).toEqual([4, 5]);
  });

  it("一层生成 20 个二层分支，后续只生成当前层的 10 个选项", () => {
    const service = createService();
    const { city, district } = firstDistrict();
    const root = service.projectRoot(city.id, district.id);
    let current = root.options[0];
    if (current === undefined) throw new Error("第一层没有测试入口。");

    const second = service.projectChildren(
      city.id,
      district.id,
      current.address.path,
    );
    expect(second.depth).toBe(2);
    expect(second.options).toHaveLength(20);
    current = second.options[0] ?? current;

    while (!current.terminal) {
      const next = service.projectChildren(
        city.id,
        district.id,
        current.address.path,
      );
      expect(next.options).toHaveLength(10);
      const nextNode = next.options[0];
      if (nextNode === undefined) throw new Error("后续层没有测试选项。");
      current = nextNode;
    }

    expect(current.depth).toBe(root.maximumDepth);
    expect(current.childCount).toBe(0);
    expect(() => service.projectChildren(
      city.id,
      district.id,
      current.address.path,
    )).toThrow(/终点/u);
  });

  it("相同地址始终得到相同 ID 与文案，非法路径会被拒绝", () => {
    const service = createService();
    const { city, district } = firstDistrict();
    const firstProjection = service.projectRoot(city.id, district.id);
    const secondProjection = service.projectRoot(city.id, district.id);

    expect(secondProjection).toEqual(firstProjection);
    const selected = firstProjection.options[12];
    if (selected === undefined) throw new Error("缺少稳定节点测试项。");
    expect(service.projectNode(selected.address)).toEqual(selected);
    expect(selected.nodeId).toMatch(
      /^district-path~city_[a-h]~city_[a-h]_district_[a-f]~\d{2}$/u,
    );
    expect(() => service.projectNode({
      cityId: city.id,
      districtId: district.id,
      path: [41],
    })).toThrow(/索引/u);
  });

  it("投影只包含当前层，不在节点内递归携带子树", () => {
    const service = createService();
    const { city, district } = firstDistrict();
    const root = service.projectRoot(city.id, district.id);

    expect(root.options).toHaveLength(40);
    expect(root.options.every((option) => !("children" in option))).toBe(true);
    const first = root.options[0];
    if (first === undefined) throw new Error("第一层没有测试入口。");
    const second = service.projectChildren(
      city.id,
      district.id,
      first.address.path,
    );
    expect(second.options).toHaveLength(20);
    expect(second.options.every((option) => !("children" in option))).toBe(true);
  });
});
