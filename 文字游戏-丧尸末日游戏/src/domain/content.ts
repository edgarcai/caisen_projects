import type {
  CampaignProfileState,
  CheckpointState,
  CommunicationLogEntry,
  CompanionState,
  ExpeditionFailureState,
  ExpeditionState,
  GameDateState,
  GameMode,
  InventoryState,
  PlayerState,
  ResearchState,
  ShelterState,
  StoryState,
  WeeklyArchiveState,
} from "./game-state";

export type NumericAmount = number | readonly [number, number];
export type NumericOperation = "add" | "subtract" | "set";
export type ComparisonOperator = "gte" | "lte" | "gt" | "lt" | "eq" | "neq";

export interface NumericEffectConfig {
  target: string;
  operation: NumericOperation;
  amount: NumericAmount;
  token?: string;
  limit_to_available?: boolean;
}

export interface RequirementConfig {
  type: string;
  target?: string;
  operator?: ComparisonOperator;
  value?: number;
  id?: string;
  present?: boolean;
  defeated?: boolean;
  status?: string;
  outcomes?: readonly string[];
  scene_id?: string;
  flag_id?: string;
  key_item_id?: string;
  key_item_ids?: readonly string[];
  boss_id?: string;
  facility_id?: string;
  requirements?: readonly RequirementConfig[];
}

export interface GameRuleConfig {
  companion_secret_unlock_trust: number;
  companion_interaction_action_type: string;
  lifespan: {
    minimum: number;
    maximum: number;
  };
  world_map: {
    minimum_districts_per_city: number;
    required_neighbor_degree: number;
  };
  player_counts: Record<string, { minimum: number; maximum: number }>;
  mode_survival_cost_percent: Record<GameMode, number>;
  city_travel: {
    home_step_cost: number;
    neighbor_step_cost: number;
    remote_step_cost: number;
  };
  default_survival_action_type: string;
  action_hunger_costs: Record<
    string,
    { player_hunger_gain: number; group_hunger_gain_per_person: number }
  >;
  timeline: {
    weekly_archive_interval_days: number;
    checkpoint_interval_days: number;
    communication_log_max_entries: number;
  };
  time: {
    start_year: number;
    start_month: number;
    start_day: number;
    start_hour: number;
    day_start_hour: number;
    day_end_hour: number;
    hours_per_action: number;
  };
  limits: {
    player_max_health: number;
    shelter_max_health: number;
    shelter_max_hope: number;
    hope_min_game_over: number;
    player_hunger_game_over: number;
    group_hunger_game_over: number;
    activity_min_game_over: number;
    activity_max_game_over: number;
  };
  turn_costs: {
    health_loss_per_negative_status: number;
    shelter_health_loss: number;
    player_hunger_gain: number;
    group_hunger_gain_per_person: number;
    activity_loss: number;
    hope_loss: number;
  };
  failure_endings: Record<
    string,
    { ending_id: string; text_key: string; mode_text_keys?: Record<string, string> }
  >;
  items: {
    medical_supplies: { cost: number; heal_min: number; heal_max: number };
    player_food: { cost: number; hunger_reduction: number };
    shelter_food: { cost: number; group_hunger_reduction: number };
    shelter_repair: { parts_cost: number; health_restore: number };
  };
}

/** 可在新游戏中选择的难度及其生存损耗倍率。 */
export interface CampaignDifficultyConfig {
  id: string;
  label: string;
  description: string;
  survival_cost_percent: number;
  starting_effects: readonly NumericEffectConfig[];
}

/** 可在新游戏中选择的所长起源。 */
export interface CampaignOriginConfig {
  id: string;
  label: string;
  description: string;
  starting_effects: readonly NumericEffectConfig[];
}

/** 可在新游戏中选择的性格特性及远征步数收益。 */
export interface CampaignTraitConfig {
  id: string;
  label: string;
  description: string;
  expedition_step_bonus: number;
  starting_effects: readonly NumericEffectConfig[];
}

/** 配置化开局档案选项集合。 */
export interface CampaignProfilesConfig {
  difficulties: readonly CampaignDifficultyConfig[];
  origins: readonly CampaignOriginConfig[];
  traits: readonly CampaignTraitConfig[];
  migration_default: CampaignProfileState;
}

/** 城市所处地貌，决定可用于远行的交通工具。 */
export type CityTerrain = "land" | "river" | "coastal" | "island";

/** 一座城市内可被独立选择、介绍和抽取事件的区划。 */
export interface CityDistrictConfig {
  id: string;
  code: string;
  name: string;
  description: string;
  danger_level: number;
  event_step_cost: number;
  event_ids: readonly string[];
}

/** 一座包含拓扑、通行条件和多个可探索区划的城市。 */
export interface CityConfig {
  id: string;
  name: string;
  /** 城市列表和存档摘要使用的区划概览名称。 */
  district: string;
  description: string;
  terrain: CityTerrain;
  neighbor_ids: readonly string[];
  intelligence_newspapers_required: number;
  path_item_ids: readonly string[];
  transport_item_ids: readonly string[];
  default_district_id: string;
  districts: readonly CityDistrictConfig[];
  /** 城市事件全集，用于验证各区划事件引用的完整性。 */
  event_ids: readonly string[];
}

export interface GameConfigDocument {
  schema_version: number;
  save_schema_version: number;
  game: {
    tutorial: string;
    tutorial_survival: string;
  };
  mode_labels: Record<string, string>;
  defaults: {
    player: Omit<PlayerState, "name">;
    shelter: ShelterState;
    survival_days: number;
    communication_log: CommunicationLogEntry[];
    weekly_archives: WeeklyArchiveState[];
    checkpoint: CheckpointState | null;
    inventory: InventoryState;
    research: ResearchState;
    expedition: ExpeditionState | null;
    last_expedition_failure: ExpeditionFailureState | null;
  };
  campaign_profiles: CampaignProfilesConfig;
  mode_capabilities: Record<GameMode, readonly string[]>;
  rules: GameRuleConfig;
  cities: readonly CityConfig[];
  actions: readonly { id: string; label: string; style: string; icon: string }[];
  texts: Record<string, string>;
}

export interface StoryChoiceConfig {
  choice_id: string;
  label: string;
  result_text: string;
  requirements?: readonly RequirementConfig[];
  effects?: readonly NumericEffectConfig[];
  add_flags?: readonly string[];
  add_key_items?: readonly string[];
  next_scene_id?: string | null;
  ending_id?: string;
  boss_id?: string;
  boss_resolution?: string;
}

export interface StorySceneConfig {
  scene_id: string;
  chapter_id: string;
  title: string;
  body: string;
  objective: string;
  entry_requirements?: readonly RequirementConfig[];
  choices: readonly StoryChoiceConfig[];
  next_scene_id?: string | null;
  boss_id?: string;
}

export interface StoryChapterConfig {
  chapter_id: string;
  number: number;
  title: string;
  summary: string;
  scene_ids: readonly string[];
}

export interface CompanionProfileConfig {
  companion_id: string;
  name: string;
  role: string;
  initial_status: string;
  recruit_scene_id: string | null;
  portrait_key: string;
  introduction: string;
  secret: string;
  trust_perks?: readonly {
    perk_id: string;
    name: string;
    unlock_trust: number;
    description: string;
    effects?: readonly NumericEffectConfig[];
  }[];
}

/** 玩家可向已入队伙伴发起的配置化互动。 */
export interface CompanionInteractionConfig {
  interaction_id: string;
  label: string;
  description: string;
  result_text: string;
  cooldown_turns: number;
  turns_consumed: number;
  trust_gain: number;
  hope_gain: number;
  requirements?: readonly RequirementConfig[];
  costs?: readonly NumericEffectConfig[];
}

/** 伙伴配装与互动的共享规则及文案。 */
export interface CompanionManagementConfig {
  interactions: readonly CompanionInteractionConfig[];
  slot_labels: Readonly<Record<"weapon" | "armor", string>>;
  texts: {
    unavailable_status: string;
    cooldown: string;
    requirement_locked: string;
    insufficient_resources: string;
    equipped: string;
    unequipped: string;
    already_equipped: string;
    equipment_unavailable: string;
    invalid_slot: string;
  };
}

export interface BossPhaseConfig {
  phase_id: string;
  health_threshold_percent: number;
  name: string;
  special_every_rounds: number;
  special_damage: number;
  special_text: string;
}

export interface BossConfig {
  boss_id: string;
  name: string;
  scene_id: string;
  max_health: number;
  attack: number;
  defense: number;
  agility: number;
  round_limit: number;
  phases: readonly BossPhaseConfig[];
  possible_outcomes: readonly string[];
  base_rewards?: Record<string, number>;
}

export interface CombatActionConfig {
  action_id: string;
  label: string;
  description: string;
  requirements?: readonly RequirementConfig[];
  resource_costs?: readonly NumericEffectConfig[];
  damage_multiplier_percent: number;
  damage_random_percent: readonly [number, number];
  healing_multiplier_percent: number;
  healing_random_range: readonly [number, number];
  defense_multiplier_percent: number;
  focus_gain: number;
  success_chance_percent?: number;
  success_random_roll?: readonly [number, number];
  ends_round: boolean;
}

export interface CombatConfig {
  rules: Record<string, number | string | readonly [number, number]>;
  actions: readonly CombatActionConfig[];
  texts: Record<string, string>;
}

export interface DiscoveryConfig {
  discovery_id: string;
  name: string;
  source_scene_id: string;
  source_choice_ids: readonly string[];
  description: string;
}

export interface FacilityLevelConfig {
  level: number;
  parts_cost: number;
  coins_cost: number;
  build_hours: number;
  effects?: readonly NumericEffectConfig[];
}

export interface FacilityConfig {
  facility_id: string;
  name: string;
  description: string;
  max_level: number;
  unlock_requirements?: readonly RequirementConfig[];
  levels: readonly FacilityLevelConfig[];
}

export interface JobConfig {
  job_id: string;
  name: string;
  description: string;
  duration_hours: number;
  requirements?: readonly RequirementConfig[];
  costs?: readonly NumericEffectConfig[];
  rewards?: readonly NumericEffectConfig[];
  risk?: {
    chance_percent: number;
    effects?: readonly NumericEffectConfig[];
    message: string;
  };
}

/** 避难所中可由所长组织的群体活动。 */
export interface ShelterActivityConfig {
  activity_id: string;
  name: string;
  description: string;
  duration_hours: number;
  requirements?: readonly RequirementConfig[];
  costs?: readonly NumericEffectConfig[];
  rewards?: readonly NumericEffectConfig[];
  result_text: string;
}

export interface TradeConfig {
  trade_id: string;
  vendor_id: string;
  vendor_name: string;
  item_id: string;
  item_name: string;
  unlock_requirements?: readonly RequirementConfig[];
  resource_target: string;
  quantity: number;
  buy_price: number;
  sell_price: number;
}

export interface RecruitConfig {
  recruit_id: string;
  name: string;
  role: string;
  description: string;
  requirements?: readonly RequirementConfig[];
  costs?: readonly NumericEffectConfig[];
  effects?: readonly NumericEffectConfig[];
  add_flags: readonly string[];
}

export interface EndingConfig {
  ending_id: string;
  achievement_id: string;
  title: string;
  body: string;
  epilogue_title: string;
  priority: number;
  requirements?: readonly RequirementConfig[];
}

export interface RequirementDisplayConfig {
  templates: Record<string, string>;
  separators: Record<string, string>;
  operators: Record<string, string>;
  target_names: Record<string, string>;
  flag_names: Record<string, string>;
  key_item_names: Record<string, string>;
  boss_outcome_names: Record<string, string>;
}

export interface StoryConfigDocument {
  schema_version: number;
  campaign_id: string;
  defaults: {
    story_state: StoryState;
    companions: readonly CompanionState[];
    facility_levels: Record<string, number>;
    limits: Record<string, number>;
  };
  chapters: readonly StoryChapterConfig[];
  companions: readonly CompanionProfileConfig[];
  companion_management: CompanionManagementConfig;
  scenes: readonly StorySceneConfig[];
  bosses: readonly BossConfig[];
  combat: CombatConfig;
  discoveries: readonly DiscoveryConfig[];
  facilities: readonly FacilityConfig[];
  jobs: readonly JobConfig[];
  activities: readonly ShelterActivityConfig[];
  trades: readonly TradeConfig[];
  recruits: readonly RecruitConfig[];
  endings: readonly EndingConfig[];
  ending_resolution: { fallback_ending_id: string };
  requirement_display: RequirementDisplayConfig;
}

export interface EventOutcomeConfig {
  weight?: number;
  result: string;
  effects?: readonly NumericEffectConfig[];
}

export interface EventChoiceConfig {
  id: string;
  label: string;
  result?: string;
  requirements?: readonly RequirementConfig[];
  effects?: readonly NumericEffectConfig[];
  outcomes?: readonly EventOutcomeConfig[];
}

export interface EventConfig {
  id: string;
  category?: string;
  weight: number;
  title: string;
  intro: string;
  result?: string;
  pre_result?: string;
  pre_effects?: readonly NumericEffectConfig[];
  effects?: readonly NumericEffectConfig[];
  choices?: readonly EventChoiceConfig[];
}

export interface EventsConfigDocument {
  schema_version: number;
  events: readonly EventConfig[];
}

export interface SaveMigrationConfig {
  schema_version: number;
  from_version: number;
  to_version: number;
  state_defaults: {
    story: StoryState;
    companions: readonly CompanionState[];
    facility_levels: Record<string, number>;
    battle: null;
    pending_exploration: null;
    ending: null;
  };
  legacy_failure: { ending_id: string; outcome: "failure" };
}

export interface V2ToV3SaveMigrationConfig {
  schema_version: number;
  from_version: number;
  to_version: number;
  campaign_start_date: GameDateState;
  state_defaults: {
    communication_log: CommunicationLogEntry[];
    weekly_archives: WeeklyArchiveState[];
    checkpoint: CheckpointState | null;
    inventory: InventoryState;
    research: ResearchState;
    expedition: ExpeditionState | null;
  };
}

/** v3 存档补齐开局档案与远征路费后的迁移配置。 */
export interface V3ToV4SaveMigrationConfig {
  schema_version: number;
  from_version: number;
  to_version: number;
  state_defaults: {
    campaign: CampaignProfileState;
    expedition_travel_step_cost: number;
  };
}

/** v4 存档升级为区划化远征状态时使用的版本链配置。 */
export interface V4ToV5SaveMigrationConfig {
  schema_version: number;
  from_version: number;
  to_version: number;
}

/** v5 存档补齐希望、寿命、伙伴管理与远征失败字段的配置。 */
export interface V5ToV6SaveMigrationConfig {
  schema_version: number;
  from_version: number;
  to_version: number;
  state_defaults: {
    player_age: number;
    player_lifespan: number;
    shelter_hope: number;
    companion_equipped_weapon_id: null;
    companion_equipped_armor_id: null;
    companion_interaction_cooldown_turns: number;
    companion_interaction_count: number;
    last_expedition_failure: null;
  };
}

/** 格式化 JSON 文案中的简单花括号占位符。 */
export function formatTemplate(
  template: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`文案缺少格式化参数：${key}`);
    }
    return String(value);
  });
}
