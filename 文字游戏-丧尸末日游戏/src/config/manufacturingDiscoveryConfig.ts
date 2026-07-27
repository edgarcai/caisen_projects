import type { ManufacturingDiscoveryConfig } from "../services/ManufacturingDiscoveryService";
import type { ManufacturingDiscoveryItem } from "../services/ManufacturingDiscoveryService";
import type {
  ExpansionItemCategory,
  ManufacturingCatalog,
} from "./contentExpansion";

/** 可从区划中直接搜索到的基础物品类别。 */
const DISCOVERABLE_BASIC_CATEGORIES: ReadonlySet<ExpansionItemCategory> = new Set([
  "raw_food",
  "semi_finished_food",
  "material",
  "trade_good",
  "archive",
]);

/** 探索成功后发现制造蓝图与文献物品的配置化规则。 */
export const manufacturingDiscoveryConfig: ManufacturingDiscoveryConfig = {
  chancePercent: 42,
  blueprintWeight: 6,
  archiveItemWeight: 4,
  regularItemWeight: 1,
  quantityMinimum: 1,
  quantityMaximum: 1,
  advancedProjectIdPrefix: "research_",
  discoveredText: "你在 {city_name}{district_code} 区的夹层中发现【{item_name}】×{quantity}；这与档案中标注的出处一致。",
};

/** 将制造目录投影为区划可发现蓝图、文献和基础物品。 */
export function createManufacturingDiscoveryItems(
  catalog: ManufacturingCatalog,
): readonly ManufacturingDiscoveryItem[] {
  const blueprints: ManufacturingDiscoveryItem[] = catalog.blueprints.map((blueprint) => ({
    itemId: blueprint.blueprintId,
    itemName: blueprint.displayName,
    kind: "blueprint",
    cityId: blueprint.source.cityId,
    districtId: districtId(blueprint.source.cityId, blueprint.source.districtCode),
  }));
  const basicItems: ManufacturingDiscoveryItem[] = catalog.items.flatMap((item) => {
    if (
      !item.itemId.startsWith("basic_")
      || !DISCOVERABLE_BASIC_CATEGORIES.has(item.category)
    ) {
      return [];
    }
    return [{
      itemId: item.itemId,
      itemName: item.displayName,
      kind: item.category === "archive" ? "archive" : "regular",
      cityId: item.source.cityId,
      districtId: districtId(item.source.cityId, item.source.districtCode),
    }];
  });
  return [...blueprints, ...basicItems];
}

/** 将扩展出处组合为游戏世界使用的稳定区划 ID。 */
function districtId(cityId: string, districtCode: string): string {
  return `${cityId}_district_${districtCode.toLowerCase()}`;
}
