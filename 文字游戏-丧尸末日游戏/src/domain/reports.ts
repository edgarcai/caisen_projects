export interface ActionReport {
  messages: readonly string[];
  stateChanged: boolean;
  gameOver: boolean;
}

export interface EventChoice {
  choiceId: string;
  label: string;
}

export interface EventPrompt {
  eventId: string;
  title: string;
  intro: string;
  choices: readonly EventChoice[];
}

export interface EventResolution {
  message: string;
  applied: boolean;
}

export interface StoryChoice {
  choiceId: string;
  label: string;
  available: boolean;
  lockedReason: string;
}

export interface StoryPrompt {
  sceneId: string;
  chapterTitle: string;
  title: string;
  body: string;
  objective: string;
  choices: readonly StoryChoice[];
  lockedReason: string;
}

export interface StoryStatus {
  chapterTitle: string;
  missionTitle: string;
  objective: string;
  progressText: string;
}

export interface StoryResolution {
  messages: readonly string[];
  applied: boolean;
  consumesTurn: boolean;
  bossId: string | null;
  bossOutcome: string | null;
}

export interface CombatAction {
  actionId: string;
  label: string;
  description: string;
  available: boolean;
  unavailableReason: string;
}

export interface CombatReport {
  messages: readonly string[];
  finished: boolean;
  victory: boolean;
  retreated: boolean;
  stateChanged: boolean;
}

export type ManagementCategory =
  | "facility"
  | "job"
  | "activity"
  | "trade_buy"
  | "trade_sell"
  | "recruit";

/** 经营项目详情页中的一行稳定信息。 */
export interface ManagementField {
  id: string;
  label: string;
  value: string;
}

/** 经营项目的一项实时前置或资源要求。 */
export interface ManagementRequirement {
  id: string;
  label: string;
  description: string;
  met: boolean;
}

export interface ManagementOption {
  optionId: string;
  label: string;
  category: ManagementCategory;
  available: boolean;
  description: string;
  fields: readonly ManagementField[];
  requirements: readonly ManagementRequirement[];
}

export interface ManagementResolution {
  messages: readonly string[];
  applied: boolean;
  consumesTurn: boolean;
  turnsConsumed: number;
}

/** 创建一个统一的应用行动报告。 */
export function actionReport(
  messages: readonly string[],
  stateChanged: boolean,
  gameOver = false,
): ActionReport {
  return { messages, stateChanged, gameOver };
}
