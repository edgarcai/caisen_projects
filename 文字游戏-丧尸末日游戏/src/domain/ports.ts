import type {
  GameClockState,
  GameMode,
  GameState,
} from "./game-state";
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

/** 一个手动存档槽当前可恢复性的稳定状态。 */
export type SaveSlotStatus = "empty" | "valid" | "recoverable" | "corrupted";

/**
 * 存档选择页无需读取领域聚合即可展示的独立槽位摘要。
 */
export interface SaveSlotSummary {
  readonly slotId: number;
  readonly status: SaveSlotStatus;
  readonly mode: GameMode | null;
  readonly playerName: string | null;
  readonly playerNames: readonly string[];
  readonly survivalDays: number | null;
  readonly clock: GameClockState | null;
  readonly difficultyId: string | null;
  readonly originId: string | null;
  readonly traitId: string | null;
  readonly homeCityId: string | null;
  readonly savedAt: string | null;
}

export interface SaveRepository {
  /** 返回全部配置化手动槽位的只读摘要。 */
  listSlots(): readonly SaveSlotSummary[];

  /** 返回指定槽或任一槽是否存在可尝试读取的数据。 */
  exists(slotId?: number): boolean;

  /** 保存完整状态到指定槽；省略槽位时使用当前活动槽。 */
  save(state: GameState, slotId?: number): void;

  /** 从指定槽读取、迁移并校验状态；省略槽位时使用当前活动槽。 */
  load(slotId?: number): GameState;

  /** 选择后续省略 slotId 的保存和读取所使用的活动槽。 */
  selectSlot(slotId: number): void;

  /** 返回当前活动槽的稳定正整数 ID。 */
  activeSlot(): number;
}

/** 跨存档栏保留的成就元进度端口。 */
export interface AchievementProgressPort {
  /** 返回当前浏览器已解锁的稳定成就 ID。 */
  unlockedAchievementIds(): readonly string[];

  /** 幂等解锁一项成就；仅首次解锁返回 true。 */
  unlock(achievementId: string): boolean;
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
