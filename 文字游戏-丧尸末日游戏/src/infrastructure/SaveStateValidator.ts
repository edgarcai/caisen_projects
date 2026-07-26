import type { CampaignProfilesConfig, GameRuleConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type {
  BattleState,
  CommunicationLogEntry,
  GameClockState,
  GameDateState,
  GameState,
  WeeklyArchiveState,
} from "../domain/game-state";
import type {
  CraftedWarehouseItemConfig,
  SurvivalSystemsConfigDocument,
} from "../domain/survival-systems";

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
const RESTORABLE_V3_STATE_FIELDS = [
  ...V2_STATE_FIELDS,
  "survival_days",
  "communication_log",
  "weekly_archives",
  "inventory",
  "research",
  "expedition",
] as const;
const V3_STATE_FIELDS = [...RESTORABLE_V3_STATE_FIELDS, "checkpoint"] as const;
const RESTORABLE_V4_STATE_FIELDS = [...RESTORABLE_V3_STATE_FIELDS, "campaign"] as const;
const V4_STATE_FIELDS = [...RESTORABLE_V4_STATE_FIELDS, "checkpoint"] as const;
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
const LOG_ENTRY_FIELDS = ["survival_day", "turn_number", "clock", "message"] as const;
const WEEKLY_ARCHIVE_FIELDS = [
  "week_number",
  "start_date",
  "end_date",
  "summary",
  "entries",
] as const;
const DATE_FIELDS = ["year", "month", "day"] as const;
const CHECKPOINT_FIELDS = ["survival_day", "created_turn", "snapshot"] as const;
const INVENTORY_FIELDS = [
  "crafted_items",
  "equipped_weapon_id",
  "equipped_armor_id",
] as const;
const RESEARCH_FIELDS = ["completed_project_ids"] as const;
const CAMPAIGN_FIELDS = [
  "difficulty_id",
  "origin_id",
  "trait_id",
  "home_city_id",
] as const;
const V3_EXPEDITION_FIELDS = [
  "city_id",
  "leader_player_index",
  "companion_ids",
  "carried_items",
  "loot",
  "remaining_steps",
  "maximum_steps",
  "events_resolved",
] as const;
const V4_EXPEDITION_FIELDS = [
  ...V3_EXPEDITION_FIELDS,
  "travel_step_cost",
] as const;
const COMPANION_STATUSES = new Set(["active", "locked", "exiled", "lost", "dead"]);

/** 严格校验版本化存档的字段集合、数据类型与领域不变量。 */
export class SaveStateValidator {
  private readonly rules: GameRuleConfig;
  private readonly facilityIds: readonly string[];
  private readonly companionIds: readonly string[];
  private readonly survivalSystems: SurvivalSystemsConfigDocument;
  private readonly campaignDifficultyIds: ReadonlySet<string>;
  private readonly campaignOriginIds: ReadonlySet<string>;
  private readonly campaignTraitIds: ReadonlySet<string>;

  /** 注入生存规则、内容 ID、开局档案与生存系统的版本化配置。 */
  public constructor(
    rules: GameRuleConfig,
    facilityIds: readonly string[],
    companionIds: readonly string[],
    survivalSystems: SurvivalSystemsConfigDocument,
    campaignProfiles: CampaignProfilesConfig,
  ) {
    this.rules = rules;
    this.facilityIds = [...facilityIds];
    this.companionIds = [...companionIds];
    this.survivalSystems = survivalSystems;
    this.campaignDifficultyIds = new Set(
      campaignProfiles.difficulties.map((difficulty) => difficulty.id),
    );
    this.campaignOriginIds = new Set(
      campaignProfiles.origins.map((origin) => origin.id),
    );
    this.campaignTraitIds = new Set(
      campaignProfiles.traits.map((trait) => trait.id),
    );
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
    this.validateGameplayContainers(state, "v2");
    return state;
  }

  /** 在构造领域对象前验证 v3 及检查点快照的精确结构。 */
  public validateRawV3(rawState: unknown): JsonObject {
    const state = exactObject(rawState, V3_STATE_FIELDS, "v3 game_state");
    this.validateRawSurvivalBase(state, "v3 game_state", V3_EXPEDITION_FIELDS);
    if (state.checkpoint !== null) {
      const checkpoint = exactObject(state.checkpoint, CHECKPOINT_FIELDS, "v3 checkpoint");
      const snapshot = exactObject(
        checkpoint.snapshot,
        RESTORABLE_V3_STATE_FIELDS,
        "v3 checkpoint.snapshot",
      );
      this.validateRawSurvivalBase(
        snapshot,
        "v3 checkpoint.snapshot",
        V3_EXPEDITION_FIELDS,
      );
    }
    return state;
  }

  /** 在构造领域对象前验证 v4 及检查点快照的精确结构。 */
  public validateRawV4(rawState: unknown): JsonObject {
    const state = exactObject(rawState, V4_STATE_FIELDS, "v4 game_state");
    this.validateRawV4Base(state, "v4 game_state");
    if (state.checkpoint !== null) {
      const checkpoint = exactObject(state.checkpoint, CHECKPOINT_FIELDS, "v4 checkpoint");
      const snapshot = exactObject(
        checkpoint.snapshot,
        RESTORABLE_V4_STATE_FIELDS,
        "v4 checkpoint.snapshot",
      );
      this.validateRawV4Base(snapshot, "v4 checkpoint.snapshot");
    }
    return state;
  }

  /** 从已通过 v4 结构检查的数据创建副本并验证完整状态。 */
  public parse(rawState: unknown): GameState {
    const state = structuredClone(this.validateRawV4(rawState)) as unknown as GameState;
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
    requireInteger(state.survival_days, "survival_days", 0);
    this.validateCampaign(state);
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
      this.requireKnownCity(
        state.pending_exploration.city_id,
        "pending_exploration.city_id",
      );
    }
    if (state.battle !== null && !state.battle.finished && state.pending_exploration !== null) {
      throw new SaveDataError("不能同时存在进行中的首领战和待结算探索。");
    }
    this.validateEnding(state);
    this.validateChronicle(state);
    this.validateInventory(state);
    this.validateResearch(state);
    this.validateExpedition(state);
    this.validateCheckpoint(state);
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

  /** 校验 v2 与 v3 共用的剧情、伙伴及交互容器。 */
  private validateGameplayContainers(state: JsonObject, version: string): void {
    this.validateCommonContainers(state);
    exactObject(state.story, STORY_FIELDS, `${version} story`);
    const companions = requireArray(state.companions, `${version} companions`);
    for (const [index, companion] of companions.entries()) {
      exactObject(companion, COMPANION_FIELDS, `${version} companions[${String(index)}]`);
    }
    requireObject(state.facility_levels, `${version} facility_levels`);
    this.validateOptionalObject(state.battle, BATTLE_FIELDS, `${version} battle`);
    this.validateOptionalObject(
      state.pending_exploration,
      PENDING_FIELDS,
      `${version} pending_exploration`,
    );
    this.validateOptionalObject(state.ending, ENDING_FIELDS, `${version} ending`);
  }

  /** 校验 v3/v4 当前状态与可回档快照共用的生存容器。 */
  private validateRawSurvivalBase(
    state: JsonObject,
    path: string,
    expeditionFields: readonly string[],
  ): void {
    this.validateGameplayContainers(state, path);
    const communicationLog = requireArray(state.communication_log, `${path}.communication_log`);
    for (const [index, entry] of communicationLog.entries()) {
      const item = exactObject(
        entry,
        LOG_ENTRY_FIELDS,
        `${path}.communication_log[${String(index)}]`,
      );
      exactObject(item.clock, CLOCK_FIELDS, `${path}.communication_log[${String(index)}].clock`);
    }
    const weeklyArchives = requireArray(state.weekly_archives, `${path}.weekly_archives`);
    for (const [index, archive] of weeklyArchives.entries()) {
      const item = exactObject(
        archive,
        WEEKLY_ARCHIVE_FIELDS,
        `${path}.weekly_archives[${String(index)}]`,
      );
      exactObject(item.start_date, DATE_FIELDS, `${path}.weekly_archives[${String(index)}].start_date`);
      exactObject(item.end_date, DATE_FIELDS, `${path}.weekly_archives[${String(index)}].end_date`);
      const entries = requireArray(item.entries, `${path}.weekly_archives[${String(index)}].entries`);
      for (const [entryIndex, entry] of entries.entries()) {
        const logEntry = exactObject(
          entry,
          LOG_ENTRY_FIELDS,
          `${path}.weekly_archives[${String(index)}].entries[${String(entryIndex)}]`,
        );
        exactObject(
          logEntry.clock,
          CLOCK_FIELDS,
          `${path}.weekly_archives[${String(index)}].entries[${String(entryIndex)}].clock`,
        );
      }
    }
    const inventory = exactObject(state.inventory, INVENTORY_FIELDS, `${path}.inventory`);
    requireObject(inventory.crafted_items, `${path}.inventory.crafted_items`);
    exactObject(state.research, RESEARCH_FIELDS, `${path}.research`);
    this.validateOptionalObject(state.expedition, expeditionFields, `${path}.expedition`);
  }

  /** 校验 v4 可回档状态的新开局档案与远征路费容器。 */
  private validateRawV4Base(state: JsonObject, path: string): void {
    this.validateRawSurvivalBase(state, path, V4_EXPEDITION_FIELDS);
    exactObject(state.campaign, CAMPAIGN_FIELDS, `${path}.campaign`);
  }

  /** 校验一个可空对象的精确字段集合。 */
  private validateOptionalObject(
    value: unknown,
    keys: readonly string[],
    path: string,
  ): void {
    if (value !== null) exactObject(value, keys, path);
  }

  /** 校验开局难度、起源、特性与出生城市均引用已配置 ID。 */
  private validateCampaign(state: GameState): void {
    const campaign = state.campaign;
    requireNonEmptyString(campaign.difficulty_id, "campaign.difficulty_id");
    requireNonEmptyString(campaign.origin_id, "campaign.origin_id");
    requireNonEmptyString(campaign.trait_id, "campaign.trait_id");
    requireNonEmptyString(campaign.home_city_id, "campaign.home_city_id");
    if (!this.campaignDifficultyIds.has(campaign.difficulty_id)) {
      throw new SaveDataError(`开局档案引用未知难度：${campaign.difficulty_id}。`);
    }
    if (!this.campaignOriginIds.has(campaign.origin_id)) {
      throw new SaveDataError(`开局档案引用未知起源：${campaign.origin_id}。`);
    }
    if (!this.campaignTraitIds.has(campaign.trait_id)) {
      throw new SaveDataError(`开局档案引用未知特性：${campaign.trait_id}。`);
    }
    this.requireKnownCity(campaign.home_city_id, "campaign.home_city_id");
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
    this.validateClockValue(state.clock, "clock");
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

  /** 校验当前通讯、历史周归档与稳定周序号。 */
  private validateChronicle(state: GameState): void {
    requireInteger(
      this.rules.timeline.communication_log_max_entries,
      "rules.timeline.communication_log_max_entries",
      1,
    );
    requireInteger(
      this.rules.timeline.weekly_archive_interval_days,
      "rules.timeline.weekly_archive_interval_days",
      1,
    );
    if (!Array.isArray(state.communication_log)) {
      throw new SaveDataError("communication_log 必须是列表。");
    }
    if (state.communication_log.length > this.rules.timeline.communication_log_max_entries) {
      throw new SaveDataError("当前通讯日志超过配置上限。");
    }
    this.validateLogEntries(
      state.communication_log,
      "communication_log",
      state.survival_days,
      state.turn_number,
    );
    if (!Array.isArray(state.weekly_archives)) {
      throw new SaveDataError("weekly_archives 必须是列表。");
    }
    let previousWeek = 0;
    for (const [index, archive] of state.weekly_archives.entries()) {
      const path = `weekly_archives[${String(index)}]`;
      requireInteger(archive.week_number, `${path}.week_number`, 1);
      if (archive.week_number <= previousWeek) {
        throw new SaveDataError("周归档序号必须严格递增。");
      }
      if (
        archive.week_number * this.rules.timeline.weekly_archive_interval_days
        > state.survival_days
      ) {
        throw new SaveDataError("周归档序号超过当前生存日。");
      }
      previousWeek = archive.week_number;
      this.validateWeeklyArchive(archive, path, state);
    }
  }

  /** 校验一份周归档的日期范围、摘要和通讯条目。 */
  private validateWeeklyArchive(
    archive: WeeklyArchiveState,
    path: string,
    state: GameState,
  ): void {
    this.validateDateValue(archive.start_date, `${path}.start_date`);
    this.validateDateValue(archive.end_date, `${path}.end_date`);
    const duration = this.dateOrdinal(archive.end_date) - this.dateOrdinal(archive.start_date);
    if (duration !== this.rules.timeline.weekly_archive_interval_days - 1) {
      throw new SaveDataError(`${path} 起止日期不是一个完整归档周期。`);
    }
    requireNonEmptyString(archive.summary, `${path}.summary`);
    if (!Array.isArray(archive.entries)) {
      throw new SaveDataError(`${path}.entries 必须是列表。`);
    }
    if (archive.entries.length > this.rules.timeline.communication_log_max_entries) {
      throw new SaveDataError(`${path}.entries 超过配置上限。`);
    }
    this.validateLogEntries(
      archive.entries,
      `${path}.entries`,
      state.survival_days,
      state.turn_number,
    );
  }

  /** 校验通讯条目的时钟、生存日、回合和非空文案。 */
  private validateLogEntries(
    entries: readonly CommunicationLogEntry[],
    path: string,
    maximumSurvivalDay: number,
    maximumTurn: number,
  ): void {
    for (const [index, entry] of entries.entries()) {
      const entryPath = `${path}[${String(index)}]`;
      requireInteger(entry.survival_day, `${entryPath}.survival_day`, 0);
      requireInteger(entry.turn_number, `${entryPath}.turn_number`, 0);
      if (entry.survival_day > maximumSurvivalDay || entry.turn_number > maximumTurn) {
        throw new SaveDataError(`${entryPath} 超过当前时间线。`);
      }
      this.validateClockValue(entry.clock, `${entryPath}.clock`);
      requireNonEmptyString(entry.message, `${entryPath}.message`);
    }
  }

  /** 校验制作物 ID、数量，以及武器和防具槽位的分类与持有数量。 */
  private validateInventory(state: GameState): void {
    const quantities = this.validateQuantityMap(
      state.inventory.crafted_items,
      "inventory.crafted_items",
      0,
    );
    const craftedItems = new Map(
      this.survivalSystems.warehouse.crafted_items.map((item) => [item.item_id, item]),
    );
    for (const itemId of Object.keys(quantities)) {
      if (!craftedItems.has(itemId)) {
        throw new SaveDataError(`制作物库存引用未知物品：${itemId}。`);
      }
    }
    this.validateEquippedItem(
      state.inventory.equipped_weapon_id,
      "inventory.equipped_weapon_id",
      "weapon",
      craftedItems,
      quantities,
    );
    this.validateEquippedItem(
      state.inventory.equipped_armor_id,
      "inventory.equipped_armor_id",
      "armor",
      craftedItems,
      quantities,
    );
  }

  /** 校验已完成研究 ID 的唯一性、配置引用和前置项目闭包。 */
  private validateResearch(state: GameState): void {
    requireUniqueStringList(
      state.research.completed_project_ids,
      "research.completed_project_ids",
    );
    const completedIds = new Set(state.research.completed_project_ids);
    const projects = new Map(
      this.survivalSystems.research.projects.map((project) => [project.project_id, project]),
    );
    for (const projectId of completedIds) {
      const project = projects.get(projectId);
      if (project === undefined) {
        throw new SaveDataError(`研究状态引用未知项目：${projectId}。`);
      }
      if (project.required_project_ids.some((requiredId) => !completedIds.has(requiredId))) {
        throw new SaveDataError(`研究项目 ${projectId} 缺少已完成的前置项目。`);
      }
    }
  }

  /** 校验远征城市、队伍上限、物资白名单、携带容量与步数不变量。 */
  private validateExpedition(state: GameState): void {
    const expedition = state.expedition;
    if (expedition === null) return;
    requireNonEmptyString(expedition.city_id, "expedition.city_id");
    this.requireKnownCity(expedition.city_id, "expedition.city_id");
    requireInteger(expedition.travel_step_cost, "expedition.travel_step_cost", 1);
    const configuredTravelStepCosts = new Set(Object.values(this.rules.city_travel));
    if (!configuredTravelStepCosts.has(expedition.travel_step_cost)) {
      throw new SaveDataError("远征城市路费不在配置允许的范围内。");
    }
    requireInteger(expedition.leader_player_index, "expedition.leader_player_index", 0);
    if (expedition.leader_player_index >= state.players.length) {
      throw new SaveDataError("远征所长索引越界。");
    }
    requireUniqueStringList(expedition.companion_ids, "expedition.companion_ids");
    if (
      expedition.companion_ids.length
      > this.survivalSystems.expedition.maximum_companions
    ) {
      throw new SaveDataError("远征同行人数超过配置上限。");
    }
    for (const companionId of expedition.companion_ids) {
      if (!this.companionIds.includes(companionId)) {
        throw new SaveDataError(`远征队伍引用未知伙伴：${companionId}。`);
      }
    }
    const carriedItems = this.validateQuantityMap(
      expedition.carried_items,
      "expedition.carried_items",
      1,
    );
    const carriedEntries = Object.entries(carriedItems);
    if (
      carriedEntries.length
      > this.survivalSystems.expedition.maximum_carried_item_types
    ) {
      throw new SaveDataError("远征携带物种类超过配置上限。");
    }
    const carryableItemIds = new Set([
      ...this.survivalSystems.warehouse.resource_items,
      ...this.survivalSystems.warehouse.crafted_items,
    ].filter((item) => item.carryable).map((item) => item.item_id));
    let carriedUnits = 0;
    for (const [itemId, quantity] of carriedEntries) {
      if (!carryableItemIds.has(itemId)) {
        throw new SaveDataError(`远征携带物引用未知或不可携带物品：${itemId}。`);
      }
      carriedUnits += quantity;
    }
    if (carriedUnits > this.survivalSystems.expedition.maximum_carried_units) {
      throw new SaveDataError("远征携带物数量超过配置容量。");
    }
    const loot = this.validateQuantityMap(expedition.loot, "expedition.loot", 1);
    const lootItemIds = new Set(
      this.survivalSystems.expedition.loot_targets.map((target) => target.item_id),
    );
    for (const itemId of Object.keys(loot)) {
      if (!lootItemIds.has(itemId)) {
        throw new SaveDataError(`远征战利品引用未知物品：${itemId}。`);
      }
    }
    requireInteger(expedition.remaining_steps, "expedition.remaining_steps", 0);
    requireInteger(
      expedition.maximum_steps,
      "expedition.maximum_steps",
      this.survivalSystems.expedition.base_steps,
    );
    requireInteger(expedition.events_resolved, "expedition.events_resolved", 0);
    if (expedition.remaining_steps > expedition.maximum_steps) {
      throw new SaveDataError("远征剩余步数不能超过最大步数。");
    }
    if (
      state.pending_exploration !== null
      && state.pending_exploration.city_id !== expedition.city_id
    ) {
      throw new SaveDataError("远征城市与待结算探索城市不一致。");
    }
  }

  /** 校验装备槽只引用对应分类且库存总量至少保留一件的制作物。 */
  private validateEquippedItem(
    itemId: string | null,
    path: string,
    expectedCategory: "weapon" | "armor",
    items: ReadonlyMap<string, CraftedWarehouseItemConfig>,
    quantities: Readonly<Record<string, number>>,
  ): void {
    requireNullableNonEmptyString(itemId, path);
    if (itemId === null) return;
    const item = items.get(itemId);
    if (item === undefined || item.category !== expectedCategory) {
      throw new SaveDataError(`${path} 引用了未知物品或错误装备分类。`);
    }
    if ((quantities[itemId] ?? 0) < 1) {
      throw new SaveDataError(`${path} 引用的装备不在制作物库存中。`);
    }
  }

  /** 要求城市 ID 存在于配置化远征城市成本表中。 */
  private requireKnownCity(cityId: string, path: string): void {
    if (!Object.hasOwn(this.survivalSystems.expedition.city_step_costs, cityId)) {
      throw new SaveDataError(`${path} 引用未知城市：${cityId}。`);
    }
  }

  /** 校验检查点元数据、建立周期与无递归快照。 */
  private validateCheckpoint(state: GameState): void {
    const checkpoint = state.checkpoint;
    if (checkpoint === null) return;
    requireInteger(
      this.rules.timeline.checkpoint_interval_days,
      "rules.timeline.checkpoint_interval_days",
      1,
    );
    requireInteger(checkpoint.survival_day, "checkpoint.survival_day", 1);
    requireInteger(checkpoint.created_turn, "checkpoint.created_turn", 0);
    if (checkpoint.survival_day % this.rules.timeline.checkpoint_interval_days !== 0) {
      throw new SaveDataError("检查点不在配置的生存日边界。");
    }
    if (checkpoint.survival_day > state.survival_days) {
      throw new SaveDataError("检查点不能晚于当前生存日。");
    }
    if (
      checkpoint.snapshot.survival_days !== checkpoint.survival_day
      || checkpoint.snapshot.turn_number !== checkpoint.created_turn
    ) {
      throw new SaveDataError("检查点元数据与快照不一致。");
    }
    if ("checkpoint" in checkpoint.snapshot) {
      throw new SaveDataError("检查点快照不能递归包含 checkpoint。");
    }
    const snapshotState: GameState = {
      ...structuredClone(checkpoint.snapshot),
      checkpoint: null,
    };
    this.validate(snapshotState);
  }

  /** 校验物品 ID 到满足指定下限的整数数量映射，并返回安全只读视图。 */
  private validateQuantityMap(
    values: unknown,
    path: string,
    minimum: number,
  ): Readonly<Record<string, number>> {
    const mapping = requireObject(values, path);
    for (const [itemId, quantity] of Object.entries(mapping)) {
      requireNonEmptyString(itemId, `${path} 的键`);
      requireInteger(quantity, `${path}.${itemId}`, minimum);
    }
    return mapping as Record<string, number>;
  }

  /** 校验一个游戏时钟的公历日期与行动时段。 */
  private validateClockValue(clock: GameClockState, path: string): void {
    this.validateDateValue(clock, path);
    requireInteger(clock.hour, `${path}.hour`, 0);
    const time = this.rules.time;
    if (clock.hour < time.day_start_hour || clock.hour >= time.day_end_hour) {
      throw new SaveDataError(`${path}.hour 不在行动时段内。`);
    }
  }

  /** 校验一个年、月、日组成的真实公历日期。 */
  private validateDateValue(date: GameDateState, path: string): void {
    requireInteger(date.year, `${path}.year`, 1);
    requireInteger(date.month, `${path}.month`, 1);
    requireInteger(date.day, `${path}.day`, 1);
    if (date.month > 12) {
      throw new SaveDataError(`${path}.month 无效。`);
    }
    const lastDay = new Date(Date.UTC(date.year, date.month, 0)).getUTCDate();
    if (date.day > lastDay) {
      throw new SaveDataError(`${path} 不是有效公历日期。`);
    }
  }

  /** 将公历日期转换为可比较的 UTC 日序数。 */
  private dateOrdinal(date: GameDateState): number {
    return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
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

/** 要求值为 null 或去除空白后仍非空的字符串。 */
function requireNullableNonEmptyString(
  value: unknown,
  path: string,
): asserts value is string | null {
  if (value === null) return;
  requireNonEmptyString(value, path);
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
