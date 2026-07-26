/** 局内主导航的稳定入口 ID。 */
export const IN_GAME_NAVIGATION_IDS = [
  "dashboard",
  "story",
  "explore",
  "management",
  "supplies",
  "settings",
] as const;

/** 局内主导航可用的稳定入口 ID 类型。 */
export type InGameNavigationId = (typeof IN_GAME_NAVIGATION_IDS)[number];

/** 当前指挥台已支持的稳定行动 ID。 */
export const DASHBOARD_ACTION_IDS = [
  "story",
  "explore",
  "shelter_management",
  "companions",
  "use_food",
  "use_medicine",
  "feed_shelter",
  "repair_shelter",
  "tutorial",
  "save",
  "return_menu",
  "warehouse",
  "research",
  "crafting",
  "expedition",
  "history",
] as const;

/** 指挥台可用的稳定行动 ID 类型。 */
export type DashboardActionId = (typeof DASHBOARD_ACTION_IDS)[number];

/** 会进入领域物资命令的行动 ID。 */
export type SupplyActionId = Extract<
  DashboardActionId,
  "use_food" | "use_medicine" | "feed_shelter" | "repair_shelter"
>;

/** 局内入口的稳定 ID 联合。 */
export type DashboardEntryId = InGameNavigationId | DashboardActionId;

/** 可直接压入页面栈的局内页面。 */
export type DashboardPushScreen =
  | "management_categories"
  | "companions"
  | "supplies"
  | "settings"
  | "warehouse"
  | "research"
  | "crafting"
  | "history"
  | "tutorial"
  | "return_menu_confirm";

/**
 * 指挥台与底部导航共享的无副作用意图，由 UI 边界统一解释执行。
 */
export type DashboardNavigationIntent =
  | { readonly type: "reset_dashboard" }
  | { readonly type: "open_story" }
  | { readonly type: "open_expedition" }
  | { readonly type: "push_screen"; readonly screen: DashboardPushScreen }
  | { readonly type: "save_game" }
  | { readonly type: "perform_supply_action"; readonly actionId: SupplyActionId };

/**
 * 入口 ID 到局内意图的可替换策略，允许上层通过配置扩展新入口。
 */
export interface DashboardNavigationPolicy {
  readonly entries: Readonly<Record<string, DashboardNavigationIntent>>;
}

const STORY_INTENT = Object.freeze({ type: "open_story" } as const);
const EXPEDITION_INTENT = Object.freeze({ type: "open_expedition" } as const);

const DEFAULT_POLICY_ENTRIES = Object.freeze({
  dashboard: { type: "reset_dashboard" },
  story: STORY_INTENT,
  explore: EXPEDITION_INTENT,
  management: { type: "push_screen", screen: "management_categories" },
  supplies: { type: "push_screen", screen: "supplies" },
  settings: { type: "push_screen", screen: "settings" },
  shelter_management: { type: "push_screen", screen: "management_categories" },
  companions: { type: "push_screen", screen: "companions" },
  use_food: { type: "perform_supply_action", actionId: "use_food" },
  use_medicine: { type: "perform_supply_action", actionId: "use_medicine" },
  feed_shelter: { type: "perform_supply_action", actionId: "feed_shelter" },
  repair_shelter: { type: "perform_supply_action", actionId: "repair_shelter" },
  tutorial: { type: "push_screen", screen: "tutorial" },
  save: { type: "save_game" },
  return_menu: { type: "push_screen", screen: "return_menu_confirm" },
  warehouse: { type: "push_screen", screen: "warehouse" },
  research: { type: "push_screen", screen: "research" },
  crafting: { type: "push_screen", screen: "crafting" },
  expedition: EXPEDITION_INTENT,
  history: { type: "push_screen", screen: "history" },
} satisfies Readonly<Record<DashboardEntryId, DashboardNavigationIntent>>);

/** 保留当前行为的默认局内导航策略。 */
export const DEFAULT_DASHBOARD_NAVIGATION_POLICY: DashboardNavigationPolicy =
  Object.freeze({ entries: DEFAULT_POLICY_ENTRIES });

/**
 * 将指挥台或底部导航入口解析为稳定意图；未配置入口安全返回 null。
 */
export function resolveDashboardNavigationIntent(
  entryId: string,
  policy: DashboardNavigationPolicy = DEFAULT_DASHBOARD_NAVIGATION_POLICY,
): DashboardNavigationIntent | null {
  return policy.entries[entryId] ?? null;
}
