import type { CompanionProfileConfig } from "../domain/content";
import type { GameState } from "../domain/game-state";
import {
  shelterCompanionResidentId,
  shelterPlayerResidentId,
  type ShelterLayoutContext,
  type ShelterResidentProfile,
} from "../domain/shelter-layout";
import type { ShelterLayoutService } from "./ShelterLayoutService";

/** 在游戏聚合与房间领域模型之间提供单一状态投影。 */
export class ShelterLayoutStateProjector {
  private readonly shelterLayout: ShelterLayoutService;
  private readonly companionNameById: ReadonlyMap<string, string>;

  /** 注入房间规则服务与稳定伙伴名称目录。 */
  public constructor(
    shelterLayout: ShelterLayoutService,
    companionProfiles: readonly Pick<CompanionProfileConfig, "companion_id" | "name">[],
  ) {
    this.shelterLayout = shelterLayout;
    this.companionNameById = new Map(
      companionProfiles.map((profile) => [profile.companion_id, profile.name]),
    );
  }

  /** 为新游戏状态生成符合当前人员目录的默认分配。 */
  public createDefaultAssignments(state: GameState): Record<string, string[]> {
    return this.shelterLayout.createDefaultAssignments(this.createResidents(state));
  }

  /** 把游戏聚合投影为房间解锁、容量与人员规划的实时上下文。 */
  public createContext(state: GameState): ShelterLayoutContext {
    return this.shelterLayout.createContext(
      this.createResidents(state),
      state.facility_levels,
      this.createResources(state),
    );
  }

  /** 使用与页面展示相同的状态投影验证持久化房间分配。 */
  public validatePersistentState(state: GameState): void {
    this.shelterLayout.validatePersistentAssignments(
      state.shelter_room_assignments,
      this.createContext(state),
    );
  }

  /** 从所长与伙伴状态构建稳定住民目录。 */
  private createResidents(state: GameState): readonly ShelterResidentProfile[] {
    const players = state.players.map((player, index): ShelterResidentProfile => ({
      residentId: shelterPlayerResidentId(index),
      name: player.name,
      gender: "unspecified",
      active: true,
      likes: [],
      dislikes: [],
      preferenceNote: "",
    }));
    const companions = state.companions.map((companion): ShelterResidentProfile => ({
      residentId: shelterCompanionResidentId(companion.companion_id),
      name: this.companionNameById.get(companion.companion_id)
        ?? companion.companion_id,
      gender: "unspecified",
      active: companion.status === "active",
      likes: [],
      dislikes: [],
      preferenceNote: "",
    }));
    return [...players, ...companions];
  }

  /** 仅汇总布局配置实际引用的数值资源。 */
  private createResources(state: GameState): Record<string, number> {
    return Object.fromEntries(
      this.shelterLayout.resourceRequirementIds().map((resourceId) => {
        const playerTotal = state.players.reduce(
          (total, player) => total + this.numericResource(player, resourceId),
          0,
        );
        const shelterTotal = this.numericResource(state.shelter, resourceId);
        const craftedTotal = state.inventory.crafted_items[resourceId] ?? 0;
        return [resourceId, playerTotal + shelterTotal + craftedTotal];
      }),
    );
  }

  /** 安全读取配置引用的数值资源字段。 */
  private numericResource(owner: object, resourceId: string): number {
    const value = Reflect.get(owner, resourceId) as unknown;
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, value)
      : 0;
  }
}
