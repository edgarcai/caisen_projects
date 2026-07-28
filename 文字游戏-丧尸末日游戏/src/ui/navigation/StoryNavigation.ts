import type { GameScreenId, GameUiSnapshot } from "../ports/GameUiPort";

/** 根据剧情结算后的领域快照决定下一覆盖页，避免每个选择都返回指挥台。 */
export function resolveStoryProgressScreen(
  snapshot: Pick<
    GameUiSnapshot,
    "battle" | "ending" | "ended" | "storyAccess" | "storyPrompt"
  >,
): Extract<GameScreenId, "battle" | "ending" | "story" | "dashboard"> {
  if (snapshot.battle !== null) return "battle";
  if (snapshot.ending !== null || snapshot.ended) return "ending";
  if (snapshot.storyAccess === "mode" && snapshot.storyPrompt !== null) {
    return "story";
  }
  return "dashboard";
}
