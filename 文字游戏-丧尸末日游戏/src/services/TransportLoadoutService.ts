import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import { cloneGameState, type GameState } from "../domain/game-state";
import type {
  CraftedWarehouseItemConfig,
  SurvivalSystemResolution,
  SurvivalSystemsConfigDocument,
  TransportLoadoutOptionView,
} from "../domain/survival-systems";

/** 维护可驾驶载具配装，并把仓库持有与实际出发配置明确分离。 */
export class TransportLoadoutService {
  private readonly config: SurvivalSystemsConfigDocument;
  private readonly transports: readonly CraftedWarehouseItemConfig[];

  /** 注入唯一生存系统配置并缓存已验证载具目录。 */
  public constructor(config: SurvivalSystemsConfigDocument) {
    this.config = config;
    this.transports = config.warehouse.crafted_items.filter(
      (item) => item.category === "transport",
    );
  }

  /** 返回全部载具的持有、装备与通行模式状态。 */
  public options(state: GameState): readonly TransportLoadoutOptionView[] {
    const equippedIds = new Set(state.inventory.equipped_transport_ids);
    return this.transports.map((item) => {
      const mode = item.transport_mode;
      if (mode === undefined) {
        throw new GameApplicationError(this.invalidTransportMessage(item));
      }
      const ownedQuantity = state.inventory.crafted_items[item.item_id] ?? 0;
      return {
        itemId: item.item_id,
        name: item.name,
        mode,
        modeLabel: this.config.transport_loadout.mode_labels[mode],
        description: item.description,
        ownedQuantity,
        equipped: equippedIds.has(item.item_id),
        available: ownedQuantity > 0,
      };
    });
  }

  /** 在配置容量内装备载具，或把已装备载具卸下。 */
  public toggle(state: GameState, itemId: string): SurvivalSystemResolution {
    const item = this.requireTransport(itemId);
    const working = cloneGameState(state);
    const equippedIds = working.inventory.equipped_transport_ids;
    const equippedIndex = equippedIds.indexOf(itemId);
    if (equippedIndex >= 0) {
      equippedIds.splice(equippedIndex, 1);
      state.inventory = working.inventory;
      return this.resolution(this.config.transport_loadout.unequipped_text, item);
    }
    if ((working.inventory.crafted_items[itemId] ?? 0) < 1) {
      return {
        applied: false,
        messages: [formatTemplate(this.config.transport_loadout.unavailable_text, {
          item_name: item.name,
        })],
        turnsConsumed: 0,
      };
    }
    if (
      equippedIds.length
      >= this.config.transport_loadout.maximum_active_transports
    ) {
      return {
        applied: false,
        messages: [formatTemplate(
          this.config.transport_loadout.capacity_reached_text,
          { maximum: this.config.transport_loadout.maximum_active_transports },
        )],
        turnsConsumed: 0,
      };
    }
    equippedIds.push(itemId);
    state.inventory = working.inventory;
    return this.resolution(this.config.transport_loadout.equipped_text, item);
  }

  /** 按稳定 ID 返回载具配置并拒绝伪造的普通物品。 */
  private requireTransport(itemId: string): CraftedWarehouseItemConfig {
    const item = this.config.warehouse.crafted_items.find(
      (candidate) => candidate.item_id === itemId,
    );
    if (item === undefined) {
      throw new GameApplicationError(formatTemplate(
        this.config.warehouse.unknown_item_text,
        { item_id: itemId },
      ));
    }
    if (item.category !== "transport" || item.transport_mode === undefined) {
      throw new GameApplicationError(this.invalidTransportMessage(item));
    }
    return item;
  }

  /** 生成一条成功配装或卸载的零耗时结算。 */
  private resolution(
    template: string,
    item: CraftedWarehouseItemConfig,
  ): SurvivalSystemResolution {
    return {
      applied: true,
      messages: [formatTemplate(template, { item_name: item.name })],
      turnsConsumed: 0,
    };
  }

  /** 使用配置模板解释目标为何不是合法载具。 */
  private invalidTransportMessage(item: CraftedWarehouseItemConfig): string {
    return formatTemplate(this.config.transport_loadout.invalid_transport_text, {
      item_name: item.name,
    });
  }
}
