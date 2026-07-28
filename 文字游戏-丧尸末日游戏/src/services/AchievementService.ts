import type { GameState } from "../domain/game-state";
import type { AchievementProgressPort } from "../domain/ports";
import type { GameContent } from "./GameContent";

/**
 * 根据已提交游戏状态评估结局成就，并管理跨档元进度。
 */
export class AchievementService {
  private readonly achievementByEndingId: ReadonlyMap<string, string>;
  private readonly progress: AchievementProgressPort;

  /** 建立结局到成就的配置索引，并注入持久化端口。 */
  public constructor(
    content: GameContent,
    progress: AchievementProgressPort,
  ) {
    this.achievementByEndingId = new Map(
      content.story.endings.map((ending) => [
        ending.ending_id,
        ending.achievement_id,
      ]),
    );
    this.progress = progress;
  }

  /** 评估已产生的胜利结局，并返回本次首次解锁的 ID。 */
  public evaluate(state: GameState): readonly string[] {
    if (state.ending?.outcome !== "victory") {
      return [];
    }
    const achievementId = this.achievementByEndingId.get(state.ending.ending_id);
    if (achievementId === undefined || achievementId.trim() === "") {
      return [];
    }
    return this.progress.unlock(achievementId) ? [achievementId] : [];
  }

  /** 返回脱离基础设施内部集合的已解锁成就副本。 */
  public unlockedAchievementIds(): readonly string[] {
    return [...this.progress.unlockedAchievementIds()];
  }
}
