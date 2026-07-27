import { describe, expect, it } from "vitest";
import { ManufacturingDiscoveryService } from "../../src/services/ManufacturingDiscoveryService";
import { buildH5Harness, requireState, ScriptedRandomSource } from "../helpers/H5TestHarness";

describe("区划制造目录发现", () => {
  it("只会将匹配当前城市区划出处的蓝图放入仓库", () => {
    const random = new ScriptedRandomSource([70, 1, 1], [0]);
    const service = new ManufacturingDiscoveryService(
      {
        chancePercent: 100,
        blueprintWeight: 6,
        archiveItemWeight: 4,
        regularItemWeight: 1,
        quantityMinimum: 1,
        quantityMaximum: 1,
        advancedProjectIdPrefix: "research_",
        discoveredText: "在{city_name}{district_code}区找到{item_name}×{quantity}。",
      },
      [
        {
          itemId: "blueprint_test",
          itemName: "测试蓝图",
          kind: "blueprint",
          cityId: "city_a",
          districtId: "city_a_district_c",
        },
        {
          itemId: "blueprint_remote",
          itemName: "远城蓝图",
          kind: "blueprint",
          cityId: "city_b",
          districtId: "city_b_district_c",
        },
      ],
      random,
      {
        cityName: (cityId): string => cityId === "city_a" ? "A 市" : "B 市",
        districtCode: (_cityId, districtId): string =>
          districtId.endsWith("_c") ? "C" : "未知",
      },
    );
    const { application } = buildH5Harness({ random });
    application.startNewGame(["发现测试员"], "single");
    const state = requireState(application);

    const messages = service.tryDiscover(
      state,
      "city_a",
      "city_a_district_c",
    );

    expect(messages[0]).toContain("测试蓝图");
    expect(state.inventory.crafted_items.blueprint_test).toBe(1);
    expect(state.inventory.crafted_items.blueprint_remote).toBeUndefined();
  });
});
