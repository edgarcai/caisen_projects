import { DomainError } from "../domain/errors";
import type { GameState, PlayerState } from "../domain/game-state";
import type { PlayerAttributeProvider } from "../domain/ports";
import type {
  CraftedWarehouseItemConfig,
  EffectivePlayerAttributes,
  PlayerCombatAttribute,
  SurvivalSystemsConfigDocument,
} from "../domain/survival-systems";

/** 以装备 ID 与配置化加成投影玩家有效属性，不污染存档中的基础属性。 */
export class EquipmentService implements PlayerAttributeProvider {
  private readonly equipmentById: ReadonlyMap<string, CraftedWarehouseItemConfig>;

  /** 从已验证的生存系统配置建立装备索引。 */
  public constructor(config: SurvivalSystemsConfigDocument) {
    this.equipmentById = new Map(
      config.warehouse.crafted_items
        .filter((item) => item.category === "weapon" || item.category === "armor")
        .map((item) => [item.item_id, item]),
    );
  }

  /** 返回指定玩家在当前装备下的一项有效属性。 */
  public effectiveAttribute(
    state: GameState,
    attribute: PlayerCombatAttribute,
    playerIndex: number = state.active_player_index,
  ): number {
    const player = this.playerAt(state, playerIndex);
    return player[attribute] + this.equipmentBonus(state, attribute);
  }

  /** 返回指定玩家在当前装备下的完整战斗属性。 */
  public effectiveAttributes(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): EffectivePlayerAttributes {
    return {
      attack: this.effectiveAttribute(state, "attack", playerIndex),
      defense: this.effectiveAttribute(state, "defense", playerIndex),
      agility: this.effectiveAttribute(state, "agility", playerIndex),
    };
  }

  /** 返回攻击、防御与敏捷之和的有效战斗力。 */
  public combatPower(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): number {
    const attributes = this.effectiveAttributes(state, playerIndex);
    return attributes.attack + attributes.defense + attributes.agility;
  }

  /** 累加已装备武器和防具对指定属性的配置加成。 */
  private equipmentBonus(state: GameState, attribute: PlayerCombatAttribute): number {
    const equippedIds = [
      state.inventory.equipped_weapon_id,
      state.inventory.equipped_armor_id,
    ];
    return equippedIds.reduce((total, itemId) => {
      if (itemId === null) return total;
      const item = this.equipmentById.get(itemId);
      if (item === undefined) {
        throw new DomainError(`存档引用了未知装备：${itemId}`);
      }
      return total + (item.equipment_bonuses?.[attribute] ?? 0);
    }, 0);
  }

  /** 返回指定玩家，并拒绝越界索引。 */
  private playerAt(state: GameState, playerIndex: number): PlayerState {
    const player = state.players[playerIndex];
    if (player === undefined) {
      throw new DomainError(`玩家索引越界：${String(playerIndex)}`);
    }
    return player;
  }
}
