import { GameApplicationError } from "../domain/errors";
import type { GameMode } from "../domain/game-state";
import type { GameContent } from "./GameContent";

/** 当前版本需要在应用层强制执行的模式能力。 */
export type GameModeCapability = "narrative" | "boss_combat";

/** 从配置读取模式权限并为应用用例提供统一守卫。 */
export class GameModeCapabilityPolicy {
  private readonly content: GameContent;

  /** 注入只读配置内容。 */
  public constructor(content: GameContent) {
    this.content = content;
  }

  /** 返回指定模式是否声明了某项能力。 */
  public allows(mode: GameMode, capability: GameModeCapability): boolean {
    return this.content.game.mode_capabilities[mode].includes(capability);
  }

  /** 在能力未授权时抛出稳定且可本地化的应用错误。 */
  public assertAllowed(mode: GameMode, capability: GameModeCapability): void {
    if (!this.allows(mode, capability)) {
      throw new GameApplicationError(
        this.content.text("mode_capability_unavailable", { capability }),
      );
    }
  }
}
