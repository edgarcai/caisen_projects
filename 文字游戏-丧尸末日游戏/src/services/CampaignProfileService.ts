import type {
  CampaignDifficultyConfig,
  CampaignOriginConfig,
  CampaignTraitConfig,
  NumericEffectConfig,
} from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import type {
  CampaignProfileState,
  GameState,
} from "../domain/game-state";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";

/** 已完成配置校验且可安全用于创建新游戏的开局档案。 */
export interface ResolvedCampaignProfile {
  readonly state: CampaignProfileState;
  readonly difficulty: CampaignDifficultyConfig;
  readonly origin: CampaignOriginConfig;
  readonly trait: CampaignTraitConfig;
}

/** 集中校验、应用和解释难度、起源、特性与出生城市。 */
export class CampaignProfileService {
  private readonly content: GameContent;
  private readonly operations: StateOperations;

  /** 注入只读内容和配置化状态写入器。 */
  public constructor(content: GameContent, operations: StateOperations) {
    this.content = content;
    this.operations = operations;
  }

  /** 解析全部稳定 ID，并拒绝任何未配置的开局选项。 */
  public resolve(profile: CampaignProfileState): ResolvedCampaignProfile {
    const profiles = this.content.game.campaign_profiles;
    const difficulty = profiles.difficulties.find(
      (candidate) => candidate.id === profile.difficulty_id,
    );
    const origin = profiles.origins.find(
      (candidate) => candidate.id === profile.origin_id,
    );
    const trait = profiles.traits.find(
      (candidate) => candidate.id === profile.trait_id,
    );
    this.content.city(profile.home_city_id);
    const homeCityAllowed = this.content.game.rules.world_map.home_city_ids.includes(
      profile.home_city_id,
    );
    if (
      difficulty === undefined
      || origin === undefined
      || trait === undefined
      || !homeCityAllowed
    ) {
      throw new GameApplicationError(
        this.content.text("invalid_campaign_profile"),
      );
    }
    return {
      state: structuredClone(profile),
      difficulty,
      origin,
      trait,
    };
  }

  /** 把配置化开局效果应用到每位所长与共享避难所。 */
  public applyStartingEffects(
    state: GameState,
    resolved: ResolvedCampaignProfile,
  ): void {
    const effects = [
      ...resolved.difficulty.starting_effects,
      ...resolved.origin.starting_effects,
      ...resolved.trait.starting_effects,
    ];
    const playerEffects = effects.filter((effect) =>
      effect.target.startsWith("player."),
    );
    const sharedEffects = effects.filter((effect) =>
      !effect.target.startsWith("player."),
    );
    state.players.forEach((_player, index) => {
      this.operations.applyEffects(playerEffects, state, index);
    });
    this.operations.applyEffects(sharedEffects, state);
  }

  /** 返回当前难度作用于生存损耗的配置化百分比。 */
  public survivalCostPercent(state: GameState): number {
    return this.resolve(state.campaign).difficulty.survival_cost_percent;
  }

  /** 返回当前所长特性带来的固定远征步数加成。 */
  public expeditionStepBonus(state: GameState): number {
    return this.resolve(state.campaign).trait.expedition_step_bonus;
  }

  /** 返回所有开局效果，供配置校验或测试检查。 */
  public startingEffects(profile: CampaignProfileState): readonly NumericEffectConfig[] {
    const resolved = this.resolve(profile);
    return [
      ...resolved.difficulty.starting_effects,
      ...resolved.origin.starting_effects,
      ...resolved.trait.starting_effects,
    ];
  }
}
