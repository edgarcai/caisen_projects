import type { CityConfig } from "../domain/content";
import type { GameState } from "../domain/game-state";
import type { SurvivalSystemsConfigDocument } from "../domain/survival-systems";
import type { GameContent } from "./GameContent";

/** 城市相对出生地的稳定关系。 */
export type CityTravelRelation = "home" | "neighbor" | "remote";

/** 城市按钮和远征领域共同消费的通行判定。 */
export interface CityAccessDecision {
  readonly city: CityConfig;
  readonly relation: CityTravelRelation;
  readonly travelStepCost: number;
  readonly accessible: boolean;
  readonly reason: string;
  readonly accessSummary: string;
}

/** 依据城市拓扑、报纸情报、路径道具和交通工具判定通行。 */
export class CityAccessService {
  private readonly content: GameContent;
  private readonly survivalSystems: SurvivalSystemsConfigDocument;

  /** 注入唯一的城市内容源和仓库物品目录。 */
  public constructor(
    content: GameContent,
    survivalSystems: SurvivalSystemsConfigDocument,
  ) {
    this.content = content;
    this.survivalSystems = survivalSystems;
  }

  /** 计算指定城市当前是否可达以及出发时需要扣除的步数。 */
  public evaluate(state: GameState, cityId: string): CityAccessDecision {
    const city = this.content.city(cityId);
    const homeCity = this.content.city(state.campaign.home_city_id);
    const relation = this.relation(homeCity, city);
    const travelStepCost = this.travelStepCost(relation);
    if (relation === "home") {
      return this.allowed(city, relation, travelStepCost, "city_access_home");
    }
    if (relation === "neighbor") {
      return this.allowed(city, relation, travelStepCost, "city_access_neighbor");
    }
    const hasIntelligence =
      state.shelter.newspapers >= city.intelligence_newspapers_required;
    const hasPath = city.path_item_ids.some((itemId) => this.hasItem(state, itemId));
    const hasTransport = city.transport_item_ids.some((itemId) =>
      this.hasItem(state, itemId),
    );
    const accessible = hasIntelligence && (hasPath || hasTransport);
    const reason = accessible
      ? this.content.text("city_access_remote_ready", { steps: travelStepCost })
      : this.remoteLockedReason(city, hasIntelligence, hasPath || hasTransport);
    return {
      city,
      relation,
      travelStepCost,
      accessible,
      reason,
      accessSummary: this.accessSummary(city, relation, travelStepCost),
    };
  }

  /** 返回出生地、邻城或远城的拓扑关系。 */
  private relation(homeCity: CityConfig, city: CityConfig): CityTravelRelation {
    if (homeCity.id === city.id) return "home";
    if (
      homeCity.neighbor_ids.includes(city.id)
      || city.neighbor_ids.includes(homeCity.id)
    ) {
      return "neighbor";
    }
    return "remote";
  }

  /** 从规则配置读取三种关系对应的出发步数。 */
  private travelStepCost(relation: CityTravelRelation): number {
    const travel = this.content.game.rules.city_travel;
    if (relation === "home") return travel.home_step_cost;
    if (relation === "neighbor") return travel.neighbor_step_cost;
    return travel.remote_step_cost;
  }

  /** 构造无需额外物资即可通行的判定。 */
  private allowed(
    city: CityConfig,
    relation: CityTravelRelation,
    travelStepCost: number,
    textKey: string,
  ): CityAccessDecision {
    return {
      city,
      relation,
      travelStepCost,
      accessible: true,
      reason: this.content.text(textKey, { steps: travelStepCost }),
      accessSummary: this.accessSummary(city, relation, travelStepCost),
    };
  }

  /** 组合地貌、城区、简介和路费，供悬停与移动端正文展示。 */
  private accessSummary(
    city: CityConfig,
    relation: CityTravelRelation,
    travelStepCost: number,
  ): string {
    return this.content.text("city_access_summary", {
      district: city.district,
      terrain: this.content.text(`city_terrain_${city.terrain}`),
      relation: this.content.text(`city_relation_${relation}`),
      steps: travelStepCost,
      description: city.description,
    });
  }

  /** 解释远城被锁定的是情报还是路径与交通工具。 */
  private remoteLockedReason(
    city: CityConfig,
    hasIntelligence: boolean,
    hasRoute: boolean,
  ): string {
    if (!hasIntelligence) {
      return this.content.text("city_access_need_intelligence", {
        required: city.intelligence_newspapers_required,
      });
    }
    if (!hasRoute) {
      const itemNames = [
        ...city.path_item_ids,
        ...city.transport_item_ids,
      ].map((itemId) => this.configuredItemName(itemId));
      return this.content.text("city_access_need_route", {
        items: itemNames.join(this.content.text("city_access_item_separator")),
      });
    }
    return this.content.text("city_access_unavailable");
  }

  /** 判断制作物或剧情关键物品中是否持有指定通行道具。 */
  private hasItem(state: GameState, itemId: string): boolean {
    return (state.inventory.crafted_items[itemId] ?? 0) > 0
      || state.story.key_items.includes(itemId);
  }

  /** 从仓库配置解析通行物品中文名。 */
  private configuredItemName(itemId: string): string {
    const items = [
      ...this.survivalSystems.warehouse.resource_items,
      ...this.survivalSystems.warehouse.crafted_items,
    ];
    return items.find((item) => item.item_id === itemId)?.name ?? itemId;
  }
}
