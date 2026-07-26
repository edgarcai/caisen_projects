import type { GameState } from "./game-state";
import type {
  EffectivePlayerAttributes,
  PlayerCombatAttribute,
} from "./survival-systems";

export interface RandomSource {
  /** 返回闭区间内的一个整数。 */
  randint(minimum: number, maximum: number): number;

  /** 按与候选项一一对应的权重选择一项。 */
  weightedChoice<T>(items: readonly T[], weights: readonly number[]): T;
}

export interface SaveRepository {
  /** 返回是否存在可尝试读取的存档。 */
  exists(): boolean;

  /** 保存完整的当前版本游戏状态。 */
  save(state: GameState): void;

  /** 读取、迁移并校验游戏状态。 */
  load(): GameState;
}

export interface StorageLike {
  /** 按键读取字符串数据。 */
  getItem(key: string): string | null;

  /** 按键写入字符串数据。 */
  setItem(key: string, value: string): void;

  /** 删除指定键。 */
  removeItem(key: string): void;
}

export interface RuleModifierProvider {
  /** 返回某个配置化规则目标的累计修正值。 */
  passiveModifier(state: GameState, target: string): number;
}

/** 为剧情、战斗与展示层统一提供装备后的有效属性。 */
export interface PlayerAttributeProvider {
  /** 返回指定玩家在当前装备下的一项有效属性。 */
  effectiveAttribute(
    state: GameState,
    attribute: PlayerCombatAttribute,
    playerIndex?: number,
  ): number;

  /** 返回指定玩家在当前装备下的完整战斗属性。 */
  effectiveAttributes(state: GameState, playerIndex?: number): EffectivePlayerAttributes;

  /** 返回攻击、防御与敏捷之和的有效战斗力。 */
  combatPower(state: GameState, playerIndex?: number): number;
}
