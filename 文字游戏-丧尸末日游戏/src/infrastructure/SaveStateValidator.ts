import type { GameRuleConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { BattleState, GameState } from "../domain/game-state";

type JsonObject = Record<string, unknown>;

const V1_STATE_FIELDS = [
  "mode",
  "players",
  "active_player_index",
  "shelter",
  "clock",
  "turn_number",
  "ended",
  "ending_message",
] as const;
const V2_STATE_FIELDS = [
  "mode",
  "players",
  "active_player_index",
  "shelter",
  "clock",
  "story",
  "companions",
  "facility_levels",
  "battle",
  "pending_exploration",
  "ending",
  "turn_number",
] as const;
const PLAYER_FIELDS = [
  "name",
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
] as const;
const SHELTER_FIELDS = [
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
] as const;
const CLOCK_FIELDS = ["year", "month", "day", "hour"] as const;
const STORY_FIELDS = [
  "current_scene_id",
  "chapter_id",
  "humanity",
  "evidence",
  "infection_pressure",
  "completed_scene_ids",
  "flags",
  "key_items",
  "boss_outcomes",
] as const;
const COMPANION_FIELDS = ["companion_id", "trust", "status"] as const;
const BATTLE_FIELDS = [
  "boss_id",
  "boss_name",
  "health",
  "max_health",
  "round_number",
  "guarding",
  "focused",
  "finished",
  "victory",
  "retreated",
] as const;
const PENDING_FIELDS = ["city_id", "event_id"] as const;
const ENDING_FIELDS = ["ending_id", "outcome", "message"] as const;
const COMPANION_STATUSES = new Set(["active", "locked", "exiled", "lost", "dead"]);

/** 严格校验版本化存档的字段集合、数据类型与领域不变量。 */
export class SaveStateValidator {
  private readonly rules: GameRuleConfig;
  private readonly facilityIds: readonly string[];
  private readonly companionIds: readonly string[];

  /** 注入生存规则及当前内容中允许出现的设施和伙伴 ID。 */
  public constructor(
    rules: GameRuleConfig,
    facilityIds: readonly string[],
    companionIds: readonly string[],
  ) {
    this.rules = rules;
    this.facilityIds = [...facilityIds];
    this.companionIds = [...companionIds];
  }

  /** 在迁移前验证旧 v1 生存状态的精确结构。 */
  public validateRawV1(rawState: unknown): JsonObject {
    const state = exactObject(rawState, V1_STATE_FIELDS, "v1 game_state");
    this.validateCommonContainers(state);
    requireBoolean(state.ended, "v1 ended");
    requireString(state.ending_message, "v1 ending_message");
    if (state.ended && state.ending_message.trim() === "") {
      throw new SaveDataError("已结束的 v1 存档缺少结局文案。");
    }
    return state;
  }

  /** 在构造领域对象前验证 v2 所有嵌套字段集合。 */
  public validateRawV2(rawState: unknown): JsonObject {
    const state = exactObject(rawState, V2_STATE_FIELDS, "v2 game_state");
    this.validateCommonContainers(state);
    exactObject(state.story, STORY_FIELDS, "v2 story");
    const companions = requireArray(state.companions, "v2 companions");
    for (const [index, companion] of companions.entries()) {
      exactObject(companion, COMPANION_FIELDS, `v2 companions[${String(index)}]`);
    }
    requireObject(state.facility_levels, "v2 facility_levels");
    this.validateOptionalObject(state.battle, BATTLE_FIELDS, "v2 battle");
    this.validateOptionalObject(
      state.pending_exploration,
      PENDING_FIELDS,
      "v2 pending_exploration",
    );
    this.validateOptionalObject(state.ending, ENDING_FIELDS, "v2 ending");
    return state;
  }

  /** 从已通过 v2 结构检查的数据创建副本并验证完整状态。 */
  public parse(rawState: unknown): GameState {
    const state = structuredClone(this.validateRawV2(rawState)) as unknown as GameState;
    this.validate(state);
    return state;
  }

  /** 验证待保存或已解析的完整游戏聚合。 */
  public validate(state: GameState): void {
    const modeLimits = this.rules.player_counts[state.mode];
    if (modeLimits === undefined) {
      throw new SaveDataError("存档游戏模式无效。");
    }
    if (!Array.isArray(state.players)) {
      throw new SaveDataError("玩家集合必须是列表。");
    }
    if (
      state.players.length < modeLimits.minimum
      || state.players.length > modeLimits.maximum
    ) {
      throw new SaveDataError("玩家数量与游戏模式不匹配。");
    }
    requireInteger(state.active_player_index, "active_player_index", 0);
    if (state.active_player_index >= state.players.length) {
      throw new SaveDataError("当前玩家索引越界。");
    }
    requireInteger(state.turn_number, "turn_number", 0);
    this.validatePlayers(state);
    this.validateShelter(state);
    this.validateStory(state);
    this.validateCompanions(state);
    this.validateFacilities(state);
    this.validateClock(state);
    if (state.battle !== null) this.validateBattle(state.battle);
    if (state.pending_exploration !== null) {
      requireNonEmptyString(state.pending_exploration.city_id, "pending_exploration.city_id");
      requireNonEmptyString(state.pending_exploration.event_id, "pending_exploration.event_id");
    }
    if (state.battle !== null && !state.battle.finished && state.pending_exploration !== null) {
      throw new SaveDataError("不能同时存在进行中的首领战和待结算探索。");
    }
    this.validateEnding(state);
  }

  /** 校验玩家和共享容器的 v1/v2 公共字段集合。 */
  private validateCommonContainers(state: JsonObject): void {
    const players = requireArray(state.players, "players");
    for (const [index, player] of players.entries()) {
      exactObject(player, PLAYER_FIELDS, `players[${String(index)}]`);
    }
    exactObject(state.shelter, SHELTER_FIELDS, "shelter");
    exactObject(state.clock, CLOCK_FIELDS, "clock");
  }

  /** 校验一个可空对象的精确字段集合。 */
  private validateOptionalObject(
    value: unknown,
    keys: readonly string[],
    path: string,
  ): void {
    if (value !== null) exactObject(value, keys, path);
  }

  /** 校验玩家姓名、资源整数、唯一性和生命上限。 */
  private validatePlayers(state: GameState): void {
    const numericFields = PLAYER_FIELDS.filter((field) => field !== "name");
    const names: string[] = [];
    for (const [index, player] of state.players.entries()) {
      requireNonEmptyString(player.name, `players[${String(index)}].name`);
      names.push(player.name.trim());
      for (const field of numericFields) {
        requireInteger(player[field], `players[${String(index)}].${field}`, 0);
      }
      if (player.health > this.rules.limits.player_max_health) {
        throw new SaveDataError("玩家生命超过配置上限。");
      }
    }
    requireUnique(names, "玩家姓名");
  }

  /** 校验共享避难所的整数资源和耐久上限。 */
  private validateShelter(state: GameState): void {
    const nonNegativeFields = SHELTER_FIELDS.filter((field) => field !== "activity");
    for (const field of nonNegativeFields) {
      requireInteger(state.shelter[field], `shelter.${field}`, 0);
    }
    requireInteger(state.shelter.activity, "shelter.activity");
    if (state.shelter.health > this.rules.limits.shelter_max_health) {
      throw new SaveDataError("避难所耐久超过配置上限。");
    }
  }

  /** 校验剧情字符串、数值、唯一列表和首领结果映射。 */
  private validateStory(state: GameState): void {
    if (state.ending === null) {
      requireNonEmptyString(state.story.current_scene_id, "story.current_scene_id");
    } else if (typeof state.story.current_scene_id !== "string") {
      throw new SaveDataError("story.current_scene_id 必须是字符串。");
    }
    requireNonEmptyString(state.story.chapter_id, "story.chapter_id");
    requireInteger(state.story.humanity, "story.humanity");
    requireInteger(state.story.evidence, "story.evidence", 0);
    requireInteger(state.story.infection_pressure, "story.infection_pressure", 0);
    requireUniqueStringList(state.story.completed_scene_ids, "story.completed_scene_ids");
    requireUniqueStringList(state.story.flags, "story.flags");
    requireUniqueStringList(state.story.key_items, "story.key_items");
    requireStringMap(state.story.boss_outcomes, "story.boss_outcomes");
  }

  /** 校验伙伴 ID、状态、信任与配置集合的一致性。 */
  private validateCompanions(state: GameState): void {
    if (!Array.isArray(state.companions)) {
      throw new SaveDataError("companions 必须是列表。");
    }
    const ids: string[] = [];
    for (const [index, companion] of state.companions.entries()) {
      requireNonEmptyString(
        companion.companion_id,
        `companions[${String(index)}].companion_id`,
      );
      requireInteger(companion.trust, `companions[${String(index)}].trust`);
      if (!COMPANION_STATUSES.has(companion.status)) {
        throw new SaveDataError(`companions[${String(index)}].status 无效。`);
      }
      ids.push(companion.companion_id);
    }
    requireUnique(ids, "伙伴 ID");
    requireExactStringSet(ids, this.companionIds, "伙伴 ID");
  }

  /** 校验设施等级映射与配置中的设施集合完全一致。 */
  private validateFacilities(state: GameState): void {
    const ids = Object.keys(state.facility_levels);
    requireExactStringSet(ids, this.facilityIds, "设施 ID");
    for (const [facilityId, level] of Object.entries(state.facility_levels)) {
      requireInteger(level, `facility_levels.${facilityId}`, 0);
    }
  }

  /** 校验公历日期和配置化每日行动时段。 */
  private validateClock(state: GameState): void {
    requireInteger(state.clock.year, "clock.year", 1);
    requireInteger(state.clock.month, "clock.month", 1);
    requireInteger(state.clock.day, "clock.day", 1);
    requireInteger(state.clock.hour, "clock.hour", 0);
    if (state.clock.month > 12) {
      throw new SaveDataError("存档月份无效。");
    }
    const lastDay = new Date(Date.UTC(state.clock.year, state.clock.month, 0)).getUTCDate();
    if (state.clock.day > lastDay) {
      throw new SaveDataError("存档日期无效。");
    }
    const time = this.rules.time;
    if (state.clock.hour < time.day_start_hour || state.clock.hour >= time.day_end_hour) {
      throw new SaveDataError("存档小时不在行动时段内。");
    }
  }

  /** 校验战斗布尔终态和生命范围的一致性。 */
  private validateBattle(battle: BattleState): void {
    requireNonEmptyString(battle.boss_id, "battle.boss_id");
    requireNonEmptyString(battle.boss_name, "battle.boss_name");
    requireInteger(battle.health, "battle.health", 0);
    requireInteger(battle.max_health, "battle.max_health", 1);
    requireInteger(battle.round_number, "battle.round_number", 1);
    if (battle.health > battle.max_health) {
      throw new SaveDataError("首领当前生命不能超过生命上限。");
    }
    for (const field of ["guarding", "focused", "finished", "victory", "retreated"] as const) {
      requireBoolean(battle[field], `battle.${field}`);
    }
    if ((battle.victory || battle.retreated) && !battle.finished) {
      throw new SaveDataError("战斗终态要求 finished 为真。");
    }
    if (battle.victory && battle.retreated) {
      throw new SaveDataError("战斗不能同时胜利和撤退。");
    }
    if (battle.victory && battle.health !== 0) {
      throw new SaveDataError("战斗胜利时首领生命必须为零。");
    }
  }

  /** 校验结局对象、交互清理和失败状态的一致性。 */
  private validateEnding(state: GameState): void {
    if (state.ending !== null) {
      requireNonEmptyString(state.ending.ending_id, "ending.ending_id");
      const outcome: unknown = state.ending.outcome;
      if (outcome !== "victory" && outcome !== "failure") {
        throw new SaveDataError("ending.outcome 只能是 victory 或 failure。");
      }
      requireNonEmptyString(state.ending.message, "ending.message");
      if (state.battle !== null || state.pending_exploration !== null) {
        throw new SaveDataError("已结束存档不能保留进行中交互。");
      }
      return;
    }
    const limits = this.rules.limits;
    const failed = state.shelter.health <= 0
      || state.players.some(
        (player) => player.health <= 0 || player.hunger >= limits.player_hunger_game_over,
      )
      || state.shelter.group_hunger >= limits.group_hunger_game_over
      || state.shelter.activity <= limits.activity_min_game_over
      || state.shelter.activity >= limits.activity_max_game_over;
    if (failed) {
      throw new SaveDataError("未结束存档包含失败状态。");
    }
  }
}

/** 要求对象字段集合与配置完全一致。 */
function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): JsonObject {
  const object = requireObject(value, path);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SaveDataError(`${path} 字段集合不匹配。`);
  }
  return object;
}

/** 要求值是非空数组容器。 */
function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SaveDataError(`${path} 必须是列表。`);
  }
  return value;
}

/** 要求值是 JSON 对象而非数组或 null。 */
function requireObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path} 必须是对象。`);
  }
  return value as JsonObject;
}

/** 要求值是字符串。 */
function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new SaveDataError(`${path} 必须是字符串。`);
  }
}

/** 要求值是去除空白后仍非空的字符串。 */
function requireNonEmptyString(value: unknown, path: string): asserts value is string {
  requireString(value, path);
  if (value.trim() === "") {
    throw new SaveDataError(`${path} 必须是非空字符串。`);
  }
}

/** 要求值是布尔值。 */
function requireBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new SaveDataError(`${path} 必须是布尔值。`);
  }
}

/** 要求值是整数，并可选限制最小值。 */
function requireInteger(value: unknown, path: string, minimum?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SaveDataError(`${path} 必须是整数。`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new SaveDataError(`${path} 不能小于 ${String(minimum)}。`);
  }
}

/** 要求字符串列表内容非空且不重复。 */
function requireUniqueStringList(value: unknown, path: string): asserts value is string[] {
  const list = requireArray(value, path);
  for (const item of list) requireNonEmptyString(item, path);
  requireUnique(list as string[], path);
}

/** 要求对象是非空字符串到非空字符串的映射。 */
function requireStringMap(value: unknown, path: string): asserts value is Record<string, string> {
  const mapping = requireObject(value, path);
  for (const [key, item] of Object.entries(mapping)) {
    requireNonEmptyString(key, `${path} 的键`);
    requireNonEmptyString(item, `${path}.${key}`);
  }
}

/** 要求字符串集合没有重复项。 */
function requireUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new SaveDataError(`${path} 不能包含重复项。`);
  }
}

/** 要求实际字符串集合与预期集合完全一致。 */
function requireExactStringSet(
  actualValues: readonly string[],
  expectedValues: readonly string[],
  path: string,
): void {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new SaveDataError(`${path} 与当前配置不匹配。`);
  }
}
