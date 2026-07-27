import type { ExpeditionState } from "../domain/game-state";
import type { SurvivalSystemsConfigDocument } from "../domain/survival-systems";

/** 使用旧存档字段承载新食物行动规则的单一职责策略。 */
export class ExpeditionFoodActionPolicy {
  private readonly foodItemId: string;
  private readonly foodUnitsPerAction: number;

  /** 从已校验的生存系统配置中读取行动食物和换算比例。 */
  public constructor(config: SurvivalSystemsConfigDocument) {
    this.foodItemId = config.expedition.action_food_item_id;
    this.foodUnitsPerAction = config.expedition.food_units_per_action;
  }

  /** 返回作为远征行动能源的配置物品 ID。 */
  public actionFoodItemId(): string {
    return this.foodItemId;
  }

  /** 把携带食物数量换算为可用移动或探索行动数。 */
  public actionCapacity(carriedItems: Readonly<Record<string, number>>): number {
    const foodQuantity = carriedItems[this.foodItemId] ?? 0;
    return Math.floor(foodQuantity / this.foodUnitsPerAction);
  }

  /** 返回当前实际可用行动数，并将旧档额度收敛到真实携粮。 */
  public remainingActions(expedition: ExpeditionState): number {
    return Math.min(
      expedition.remaining_steps,
      this.actionCapacity(expedition.carried_items),
    );
  }

  /** 尝试消耗配置数量的行动和食物，不足时保持状态不变。 */
  public spend(expedition: ExpeditionState, actionCost: number): boolean {
    const availableActions = this.remainingActions(expedition);
    if (availableActions < actionCost) {
      return false;
    }
    const foodCost = actionCost * this.foodUnitsPerAction;
    const remainingFood = (expedition.carried_items[this.foodItemId] ?? 0) - foodCost;
    if (remainingFood > 0) {
      expedition.carried_items[this.foodItemId] = remainingFood;
    } else {
      expedition.carried_items = Object.fromEntries(
        Object.entries(expedition.carried_items).filter(
          ([itemId]) => itemId !== this.foodItemId,
        ),
      );
    }
    expedition.remaining_steps = availableActions - actionCost;
    return true;
  }
}
