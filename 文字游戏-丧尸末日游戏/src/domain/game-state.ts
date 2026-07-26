import { DomainError } from "./errors";

export type GameMode = "single" | "multiplayer" | "story";

export interface PlayerState {
  name: string;
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
  group_hunger: number;
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
  event_id: string;
}

export interface InventoryState {
  crafted_items: Record<string, number>;
  equipped_weapon_id: string | null;
  equipped_armor_id: string | null;
}

export interface ResearchState {
  completed_project_ids: string[];
}

export interface ExpeditionState {
  city_id: string;
  leader_player_index: number;
  companion_ids: string[];
  carried_items: Record<string, number>;
  loot: Record<string, number>;
  remaining_steps: number;
  maximum_steps: number;
  events_resolved: number;
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
  expedition: ExpeditionState | null;
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
