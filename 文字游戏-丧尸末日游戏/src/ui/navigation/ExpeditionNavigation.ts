import type {
  GameScreenId,
  GameUiSnapshot,
} from "../ports/GameUiPort";

/** 远征导航只需要的快照字段，避免路由决策依赖完整页面模型。 */
export type ExpeditionNavigationSnapshot = Pick<
  GameUiSnapshot,
  "explorationPrompt" | "expeditionStatus"
>;

/**
 * 为指挥台的“探索”入口选择安全页面：先恢复待决事件，再恢复远征，否则进入城市列表。
 */
export function resolveExpeditionEntryScreen(
  snapshot: ExpeditionNavigationSnapshot,
): GameScreenId {
  if (snapshot.explorationPrompt !== null) {
    return "exploration_event";
  }
  if (snapshot.expeditionStatus !== null) {
    return "expedition_status";
  }
  return "expedition_city_list";
}

/**
 * 远征命令结束后按领域快照转向事件、远征状态或指挥台。
 */
export function resolveExpeditionProgressScreen(
  snapshot: ExpeditionNavigationSnapshot,
): GameScreenId {
  if (snapshot.explorationPrompt !== null) {
    return "exploration_event";
  }
  if (snapshot.expeditionStatus !== null) {
    return "expedition_status";
  }
  return "dashboard";
}
