import { DomainError } from "../domain/errors";
import {
  findCompanion,
  type GameState,
  type PlayerState,
} from "../domain/game-state";
import type { EncounterPartyAttributeProvider } from "../domain/ports";
import type {
  CraftedWarehouseItemConfig,
  EffectivePlayerAttributes,
  PlayerCombatAttribute,
  SurvivalSystemsConfigDocument,
} from "../domain/survival-systems";

/** 以装备 ID 与配置化加成投影玩家或伙伴的有效属性。 */
export class EquipmentService implements EncounterPartyAttributeProvider {
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
    return this.effectiveAttributes(state, playerIndex)[attribute];
  }

  /** 返回指定玩家在当前装备下的完整战斗属性。 */
  public effectiveAttributes(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): EffectivePlayerAttributes {
    return this.projectAttributes(
      this.playerAt(state, playerIndex),
      [state.inventory.equipped_weapon_id, state.inventory.equipped_armor_id],
    );
  }

  /** 在显式伙伴基线上叠加该伙伴存档中的武器与防具加成。 */
  public effectiveCompanionAttributes(
    state: GameState,
    companionId: string,
    baseline: EffectivePlayerAttributes,
  ): EffectivePlayerAttributes {
    const companion = findCompanion(state, companionId);
    if (companion === undefined) {
      throw new DomainError(`存档引用了未知伙伴：${companionId}`);
    }
    return this.projectAttributes(
      baseline,
      [companion.equipped_weapon_id, companion.equipped_armor_id],
    );
  }

  /** 返回攻击、防御与敏捷之和的有效战斗力。 */
  public combatPower(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): number {
    const attributes = this.effectiveAttributes(state, playerIndex);
    return attributes.attack + attributes.defense + attributes.agility;
  }

  /** 对一份明确基线应用指定装备列表，并返回不可变属性投影。 */
  private projectAttributes(
    baseline: EffectivePlayerAttributes,
    equippedIds: readonly (string | null)[],
  ): EffectivePlayerAttributes {
    return {
      attack: baseline.attack + this.equipmentBonus(equippedIds, "attack"),
      defense: baseline.defense + this.equipmentBonus(equippedIds, "defense"),
      agility: baseline.agility + this.equipmentBonus(equippedIds, "agility"),
    };
  }

  /** 累加指定装备对一项战斗属性的配置化加成。 */
  private equipmentBonus(
    equippedIds: readonly (string | null)[],
    attribute: PlayerCombatAttribute,
  ): number {
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
