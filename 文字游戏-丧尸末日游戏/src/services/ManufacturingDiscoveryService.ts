import { formatTemplate } from "../domain/content";
import type { GameState } from "../domain/game-state";
import type { RandomSource } from "../domain/ports";

/** 可由区划探索发现的一件制造目录物品。 */
export interface ManufacturingDiscoveryItem {
  readonly itemId: string;
  readonly itemName: string;
  readonly kind: "blueprint" | "archive" | "regular";
  readonly cityId: string;
  readonly districtId: string;
}

/** 制造发现的概率、权重、数量和文案配置。 */
export interface ManufacturingDiscoveryConfig {
  readonly chancePercent: number;
  readonly blueprintWeight: number;
  readonly archiveItemWeight: number;
  readonly regularItemWeight: number;
  readonly quantityMinimum: number;
  readonly quantityMaximum: number;
  readonly advancedProjectIdPrefix: string;
  readonly discoveredText: string;
}

/** 为制造发现提供配置世界中的城市与区划展示名。 */
export interface ManufacturingDiscoveryLocationProvider {
  cityName(cityId: string): string;
  districtCode(cityId: string, districtId: string): string;
}

/** 按城市区划出处向探索结算注入蓝图或文献发现。 */
export class ManufacturingDiscoveryService {
  private readonly config: ManufacturingDiscoveryConfig;
  private readonly items: readonly ManufacturingDiscoveryItem[];
  private readonly random: RandomSource;
  private readonly locations: ManufacturingDiscoveryLocationProvider;

  /** 注入配置化概率、可发现目录与随机端口。 */
  public constructor(
    config: ManufacturingDiscoveryConfig,
    items: readonly ManufacturingDiscoveryItem[],
    random: RandomSource,
    locations: ManufacturingDiscoveryLocationProvider,
  ) {
    this.config = structuredClone(config);
    this.items = structuredClone(items);
    this.random = random;
    this.locations = locations;
    this.validateConfig();
  }

  /** 在一次成功探索后尝试发现一件符合出处的物品。 */
  public tryDiscover(
    state: GameState,
    cityId: string,
    districtId: string,
  ): readonly string[] {
    if (this.random.randint(1, 100) > this.config.chancePercent) return [];
    const candidates = this.items.filter((item) =>
      item.cityId === cityId
      && item.districtId === districtId
      && !this.alreadyResearched(state, item),
    );
    if (candidates.length === 0) return [];
    const selected = this.random.weightedChoice(
      candidates,
      candidates.map((item) => this.weight(item.kind)),
    );
    const quantity = this.random.randint(
      this.config.quantityMinimum,
      this.config.quantityMaximum,
    );
    state.inventory.crafted_items[selected.itemId] =
      (state.inventory.crafted_items[selected.itemId] ?? 0) + quantity;
    return [formatTemplate(this.config.discoveredText, {
      city_name: this.locations.cityName(cityId),
      district_code: this.locations.districtCode(cityId, districtId),
      item_name: selected.itemName,
      quantity,
    })];
  }

  /** 验证概率、权重和数量范围，防止无效配置进入运行时。 */
  private validateConfig(): void {
    const weights = [
      this.config.blueprintWeight,
      this.config.archiveItemWeight,
      this.config.regularItemWeight,
    ];
    if (
      !Number.isInteger(this.config.chancePercent)
      || this.config.chancePercent < 0
      || this.config.chancePercent > 100
      || weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
      || !Number.isInteger(this.config.quantityMinimum)
      || !Number.isInteger(this.config.quantityMaximum)
      || this.config.quantityMinimum < 1
      || this.config.quantityMaximum < this.config.quantityMinimum
      || this.config.advancedProjectIdPrefix.trim() === ""
      || this.config.discoveredText.trim() === ""
    ) {
      throw new Error("制造目录探索发现配置无效。");
    }
  }

  /** 已完成研究的蓝图不再进入候选集。 */
  private alreadyResearched(
    state: GameState,
    item: ManufacturingDiscoveryItem,
  ): boolean {
    return item.kind === "blueprint"
      && state.research.completed_project_ids.includes(
        `${this.config.advancedProjectIdPrefix}${item.itemId}`,
      );
  }

  /** 返回一类目录物品的抽取权重。 */
  private weight(kind: ManufacturingDiscoveryItem["kind"]): number {
    if (kind === "blueprint") return this.config.blueprintWeight;
    if (kind === "archive") return this.config.archiveItemWeight;
    return this.config.regularItemWeight;
  }

}
