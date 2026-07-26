import type { NumericEffectConfig, NumericAmount } from "../domain/content";
import { StateOperationError } from "../domain/errors";
import {
  findCompanion,
  type GameState,
  type PlayerState,
} from "../domain/game-state";
import type { RandomSource } from "../domain/ports";

const PLAYER_FIELDS = new Set([
  "health",
  "attack",
  "defense",
  "agility",
  "medical_supplies",
  "food",
  "hunger",
  "intelligence",
  "coins",
  "parts",
  "negative_status",
  "antidotes",
]);

const SHELTER_FIELDS = new Set([
  "population",
  "group_hunger",
  "health",
  "defense_damage",
  "activity",
  "newspapers",
  "books",
  "magazines",
  "toys",
  "game_consoles",
]);

const STORY_FIELDS = new Set(["humanity", "evidence", "infection_pressure"]);

/** 集中执行配置化数值读写，防止 JSON 越权修改状态。 */
export class StateOperations {
  private readonly random: RandomSource;

  /** 注入可替换的随机源以支持稳定测试。 */
  public constructor(random: RandomSource) {
    this.random = random;
  }

  /** 读取允许公开给配置的整数状态或派生计数。 */
  public read(
    target: string,
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): number {
    if (target === "story.key_item_count") {
      return state.story.key_items.length;
    }
    if (target === "story.active_companion_count") {
      return state.companions.filter((companion) => companion.status === "active").length;
    }
    if (target === "story.average_trust") {
      const trusts = state.companions
        .filter((companion) => companion.status === "active")
        .map((companion) => companion.trust);
      return trusts.length === 0
        ? 0
        : Math.floor(trusts.reduce((sum, trust) => sum + trust, 0) / trusts.length);
    }
    if (target === "story.total_companion_trust") {
      return state.companions
        .filter((companion) => companion.status === "active")
        .reduce((sum, companion) => sum + companion.trust, 0);
    }
    if (target === "story.boss_count") {
      return Object.keys(state.story.boss_outcomes).length;
    }

    const parts = target.split(".");
    if (parts.length === 2) {
      const [root, field] = parts;
      if (root === "player" && field !== undefined) {
        this.requireAllowed(field, PLAYER_FIELDS, target);
        return this.readNumericField(this.playerAt(state, playerIndex), field, target);
      }
      if (root === "shelter" && field !== undefined) {
        this.requireAllowed(field, SHELTER_FIELDS, target);
        return this.readNumericField(state.shelter, field, target);
      }
      if (root === "story" && field !== undefined) {
        this.requireAllowed(field, STORY_FIELDS, target);
        return this.readNumericField(state.story, field, target);
      }
      if (root === "facility" && field !== undefined) {
        const value = state.facility_levels[field];
        if (value === undefined) {
          throw new StateOperationError(`未知设施目标：${target}`);
        }
        return value;
      }
    }
    if (parts.length === 3 && parts[0] === "companion" && parts[2] === "trust") {
      const companionId = parts[1];
      const companion = companionId === undefined ? undefined : findCompanion(state, companionId);
      if (companion === undefined) {
        throw new StateOperationError(`伙伴尚未加入：${target}`);
      }
      return companion.trust;
    }
    throw new StateOperationError(`未知状态目标：${target}`);
  }

  /** 更新允许由配置修改的整数状态。 */
  public write(
    target: string,
    value: number,
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): void {
    if (!Number.isInteger(value)) {
      throw new StateOperationError(`状态目标必须写入整数：${target}`);
    }
    const parts = target.split(".");
    if (parts.length === 2) {
      const [root, field] = parts;
      if (root === "player" && field !== undefined) {
        this.requireAllowed(field, PLAYER_FIELDS, target);
        this.writeNumericField(this.playerAt(state, playerIndex), field, value, target);
        return;
      }
      if (root === "shelter" && field !== undefined) {
        this.requireAllowed(field, SHELTER_FIELDS, target);
        this.writeNumericField(state.shelter, field, value, target);
        return;
      }
      if (root === "story" && field !== undefined) {
        this.requireAllowed(field, STORY_FIELDS, target);
        this.writeNumericField(state.story, field, value, target);
        return;
      }
      if (root === "facility" && field !== undefined && state.facility_levels[field] !== undefined) {
        state.facility_levels[field] = value;
        return;
      }
    }
    if (parts.length === 3 && parts[0] === "companion" && parts[2] === "trust") {
      const companionId = parts[1];
      const companion = companionId === undefined ? undefined : findCompanion(state, companionId);
      if (companion === undefined) {
        throw new StateOperationError(`伙伴尚未加入：${target}`);
      }
      companion.trust = value;
      return;
    }
    throw new StateOperationError(`状态目标不可写：${target}`);
  }

  /** 依次应用数值效果，并收集结果文案需要的变量。 */
  public applyEffects(
    effects: readonly NumericEffectConfig[],
    state: GameState,
  ): Record<string, number> {
    const tokens: Record<string, number> = {};
    for (const effect of effects) {
      let amount = this.rollAmount(effect.amount);
      const current = this.read(effect.target, state);
      if (effect.operation === "subtract" && effect.limit_to_available === true) {
        amount = Math.min(amount, current);
      }
      const nextValue = this.applyOperation(current, effect.operation, amount);
      this.write(effect.target, nextValue, state);
      if (effect.token !== undefined) {
        tokens[effect.token] = amount;
      }
    }
    return tokens;
  }

  /** 读取固定数值或从闭区间抽取整数。 */
  public rollAmount(amount: NumericAmount): number {
    if (typeof amount === "number") {
      if (!Number.isInteger(amount)) {
        throw new StateOperationError("效果固定 amount 必须是整数。");
      }
      return amount;
    }
    const [minimum, maximum] = amount;
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) {
      throw new StateOperationError("效果随机 amount 边界必须是整数。");
    }
    return this.random.randint(minimum, maximum);
  }

  /** 对当前数值应用配置化加、减或设置操作。 */
  private applyOperation(
    current: number,
    operation: NumericEffectConfig["operation"],
    amount: number,
  ): number {
    if (operation === "add") {
      return current + amount;
    }
    if (operation === "subtract") {
      return current - amount;
    }
    return amount;
  }

  /** 从已通过白名单检查的对象读取整数字段。 */
  private readNumericField(owner: object, field: string, target: string): number {
    const value = Reflect.get(owner, field) as unknown;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new StateOperationError(`目标不是整数属性：${target}`);
    }
    return value;
  }

  /** 向已通过白名单检查的对象写入整数字段。 */
  private writeNumericField(
    owner: object,
    field: string,
    value: number,
    target: string,
  ): void {
    const current = Reflect.get(owner, field) as unknown;
    if (typeof current !== "number" || !Number.isInteger(current)) {
      throw new StateOperationError(`目标不是整数属性：${target}`);
    }
    Reflect.set(owner, field, value);
  }

  /** 要求目标字段位于配置可访问白名单中。 */
  private requireAllowed(field: string, allowed: ReadonlySet<string>, target: string): void {
    if (!allowed.has(field)) {
      throw new StateOperationError(`状态目标未列入白名单：${target}`);
    }
  }

  /** 返回指定索引的所长，拒绝远征存档中的越界领导者索引。 */
  private playerAt(state: GameState, playerIndex: number): PlayerState {
    const player = state.players[playerIndex];
    if (player === undefined) {
      throw new StateOperationError(`所长索引越界：${String(playerIndex)}`);
    }
    return player;
  }
}
