import { DomainError } from "./errors";
import type { EncounterBattleState } from "./demo-systems";

export type GameMode = "single" | "multiplayer" | "story" | "endless";

/** 一局游戏与所长姓名分离保存的开局档案。 */
export interface CampaignProfileState {
  difficulty_id: string;
  origin_id: string;
  trait_id: string;
  home_city_id: string;
}

/** 新游戏临时提交的扩展档案；附加字段会转存到 story.flags。 */
export interface NewGameCampaignProfileSelection extends CampaignProfileState {
  secondary_trait_id?: string;
  home_district_id?: string;
  shelter_type_id?: string;
}

/** 新游戏创建时由界面一次性提交的完整配置。 */
export interface NewGameSetup {
  mode: GameMode;
  playerNames: readonly string[];
  saveSlotId: number;
  profile: NewGameCampaignProfileSelection;
}

export interface PlayerState {
  name: string;
  age: number;
  lifespan: number;
  health: number;
  attack: number;
  defense: number;
  agility: number;
  medical_supplies: number;
  food: number;
  hunger: number;
  intelligence: number;
  coins: number;
  parts: number;
  negative_status: number;
  antidotes: number;
}

export interface ShelterState {
  population: number;
  hope: number;
  group_hunger: number;
  /** v9 起分离保存的内墙耐久，由避难所维护恢复。 */
  inner_wall_health: number;
  /** v9 起分离保存的外墙耐久，由外墙巡逻恢复。 */
  outer_wall_health: number;
  /** 内外墙耐久之和，保留给旧内容与界面作兼容镜像。 */
  health: number;
  defense_damage: number;
  activity: number;
  newspapers: number;
  books: number;
  magazines: number;
  toys: number;
  game_consoles: number;
}

export interface GameClockState {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export interface GameDateState {
  year: number;
  month: number;
  day: number;
}

export interface StoryState {
  current_scene_id: string;
  chapter_id: string;
  humanity: number;
  evidence: number;
  infection_pressure: number;
  completed_scene_ids: string[];
  flags: string[];
  key_items: string[];
  boss_outcomes: Record<string, string>;
}

export type CompanionStatus = "active" | "locked" | "exiled" | "lost" | "dead";

export interface CompanionState {
  companion_id: string;
  trust: number;
  status: CompanionStatus;
  equipped_weapon_id: string | null;
  equipped_armor_id: string | null;
  interaction_cooldown_turns: number;
  interaction_count: number;
}

export interface BattleState {
  boss_id: string;
  boss_name: string;
  health: number;
  max_health: number;
  round_number: number;
  guarding: boolean;
  focused: boolean;
  finished: boolean;
  victory: boolean;
  retreated: boolean;
}

export interface PendingExplorationState {
  city_id: string;
  district_id: string;
  event_id: string;
  branch_node_id: string | null;
  branch_path: string[];
}

export interface InventoryState {
  crafted_items: Record<string, number>;
  equipped_weapon_id: string | null;
  equipped_armor_id: string | null;
  equipped_transport_ids: string[];
}

export interface ResearchState {
  completed_project_ids: string[];
  /** 研究台唯一方格中当前放入的物品。 */
  slotted_item_id: string | null;
}

/** 按配置化文献分类保存历史累计入库份数。 */
export type ArchiveCollectionTotalsState = Record<string, number>;

/** 一个配置化经营周期内已使用的次数。 */
export interface ManagementCycleUsageState {
  cycle_index: number;
  count: number;
}

export interface ExpeditionState {
  city_id: string;
  district_id: string;
  travel_step_cost: number;
  leader_player_index: number;
  companion_ids: string[];
  carried_items: Record<string, number>;
  loot: Record<string, number>;
  /** v1-v8 存档兼容字段：当前表示由携带食物支撑的剩余行动数。 */
  remaining_steps: number;
  /** v1-v8 存档兼容字段：当前表示出发时食物能支撑的总行动数。 */
  maximum_steps: number;
  events_resolved: number;
}

/** 强制返程时一种物资的可审计损失。 */
export interface ExpeditionLossItemState {
  source: "carried" | "loot";
  item_id: string;
  item_name: string;
  original_quantity: number;
  kept_quantity: number;
  lost_quantity: number;
}

/** 携带食物耗尽后供失败页和存档共用的结构化摘要。 */
export interface ExpeditionFailureState {
  /** 保留旧枚举值，使 v1-v8 存档无需破坏性迁移。 */
  reason: "steps_exhausted";
  kept_percent: number;
  health_before: number;
  health_after: number;
  total_original: number;
  total_kept: number;
  total_lost: number;
  items: ExpeditionLossItemState[];
}

export interface CommunicationLogEntry {
  survival_day: number;
  turn_number: number;
  clock: GameClockState;
  message: string;
}

export interface WeeklyArchiveState {
  week_number: number;
  start_date: GameDateState;
  end_date: GameDateState;
  summary: string;
  entries: CommunicationLogEntry[];
}

export type EndingOutcome = "victory" | "failure";

export interface EndingState {
  ending_id: string;
  outcome: EndingOutcome;
  message: string;
}

export interface RestorableGameState {
  mode: GameMode;
  campaign: CampaignProfileState;
  players: PlayerState[];
  active_player_index: number;
  shelter: ShelterState;
  clock: GameClockState;
  story: StoryState;
  companions: CompanionState[];
  facility_levels: Record<string, number>;
  battle: BattleState | null;
  pending_exploration: PendingExplorationState | null;
  ending: EndingState | null;
  turn_number: number;
  survival_days: number;
  communication_log: CommunicationLogEntry[];
  weekly_archives: WeeklyArchiveState[];
  inventory: InventoryState;
  research: ResearchState;
  archive_collection_totals: ArchiveCollectionTotalsState;
  management_cycle_usage: Record<string, ManagementCycleUsageState>;
  expedition: ExpeditionState | null;
  last_expedition_failure: ExpeditionFailureState | null;
  shelter_room_assignments: Record<string, string[]>;
  encounter_battle: EncounterBattleState | null;
  pending_return_incident_id: string | null;
}

export interface CheckpointState {
  survival_day: number;
  created_turn: number;
  snapshot: RestorableGameState;
}

export interface GameState extends RestorableGameState {
  checkpoint: CheckpointState | null;
}

/** 返回当前执行行动的所长，并拒绝越界索引。 */
export function activePlayer(state: GameState): PlayerState {
  const player = state.players[state.active_player_index];
  if (player === undefined) {
    throw new DomainError("当前所长索引越界。");
  }
  return player;
}

/** 在多人模式中轮换所长，单人模式保持不变。 */
export function rotatePlayer(state: GameState): void {
  if (state.players.length > 1) {
    state.active_player_index = (state.active_player_index + 1) % state.players.length;
  }
}

/** 返回一局游戏是否已有唯一结局。 */
export function isEnded(state: GameState): boolean {
  return state.ending !== null;
}

/** 返回当前结局是否为胜利。 */
export function isVictory(state: GameState): boolean {
  return state.ending?.outcome === "victory";
}

/** 创建只包含 JSON 数据的游戏状态深副本。 */
export function cloneGameState(state: GameState): GameState {
  return structuredClone(state);
}

/** 按稳定 ID 查找伙伴状态。 */
export function findCompanion(
  state: GameState,
  companionId: string,
): CompanionState | undefined {
  return state.companions.find((companion) => companion.companion_id === companionId);
}

/** 向剧情状态添加不重复的标记。 */
export function addStoryFlag(state: GameState, flag: string): void {
  if (!state.story.flags.includes(flag)) {
    state.story.flags.push(flag);
  }
}

/** 向剧情状态添加不重复的关键物品。 */
export function addKeyItem(state: GameState, itemId: string): void {
  if (!state.story.key_items.includes(itemId)) {
    state.story.key_items.push(itemId);
  }
}
