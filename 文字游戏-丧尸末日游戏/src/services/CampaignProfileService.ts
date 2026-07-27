import type {
  CampaignDifficultyConfig,
  CampaignOriginConfig,
  CampaignShelterTypeConfig,
  CampaignTraitConfig,
  CityDistrictConfig,
  NumericEffectConfig,
} from "../domain/content";
import {
  readCampaignMetadataFlag,
  writeCampaignMetadataFlag,
} from "../domain/campaign-profile-metadata";
import { GameApplicationError } from "../domain/errors";
import type {
  CampaignProfileState,
  GameState,
  NewGameCampaignProfileSelection,
} from "../domain/game-state";
import { synchronizeShelterHealth } from "../domain/shelter-fortification";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";

/** 已完成配置校验且可安全用于创建新游戏的开局档案。 */
export interface ResolvedCampaignProfile {
  readonly state: CampaignProfileState;
  readonly difficulty: CampaignDifficultyConfig;
  readonly origin: CampaignOriginConfig;
  readonly trait: CampaignTraitConfig;
  readonly secondaryTrait: CampaignTraitConfig;
  readonly homeDistrict: CityDistrictConfig;
  readonly shelterType: CampaignShelterTypeConfig;
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
  public resolve(
    profile: NewGameCampaignProfileSelection,
  ): ResolvedCampaignProfile {
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
    const secondaryTraitId = profile.secondary_trait_id
      ?? profiles.additional_defaults.secondary_trait_id;
    const secondaryTrait = profiles.traits.find(
      (candidate) => candidate.id === secondaryTraitId,
    );
    const city = this.content.city(profile.home_city_id);
    const homeDistrictId = profile.home_district_id ?? city.default_district_id;
    const homeDistrict = city.districts.find(
      (candidate) => candidate.id === homeDistrictId,
    );
    const shelterTypeId = profile.shelter_type_id
      ?? profiles.additional_defaults.shelter_type_id;
    const shelterType = profiles.shelter_types.find(
      (candidate) => candidate.id === shelterTypeId,
    );
    const homeCityAllowed = this.content.game.rules.world_map.home_city_ids.includes(
      profile.home_city_id,
    );
    if (
      difficulty === undefined
      || origin === undefined
      || trait === undefined
      || secondaryTrait === undefined
      || homeDistrict === undefined
      || shelterType === undefined
      || !homeCityAllowed
      || !this.traitPairAllowed(trait, secondaryTrait)
    ) {
      throw new GameApplicationError(
        this.content.text("invalid_campaign_profile"),
      );
    }
    return {
      state: {
        difficulty_id: profile.difficulty_id,
        origin_id: profile.origin_id,
        trait_id: profile.trait_id,
        home_city_id: profile.home_city_id,
      },
      difficulty,
      origin,
      trait,
      secondaryTrait,
      homeDistrict,
      shelterType,
    };
  }

  /** 初始化避难所原型、元数据标记，再应用双特性及其他开局效果。 */
  public applyStartingEffects(
    state: GameState,
    resolved: ResolvedCampaignProfile,
  ): void {
    this.initializeShelterProfile(state, resolved);
    const effects = [
      ...resolved.difficulty.starting_effects,
      ...resolved.origin.starting_effects,
      ...resolved.trait.starting_effects,
      ...resolved.secondaryTrait.starting_effects,
      ...resolved.shelterType.starting_effects,
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
    const resolved = this.resolve(state.campaign);
    const secondaryTraitId = readCampaignMetadataFlag(
      state.story.flags,
      this.content.game.campaign_profiles.metadata_flags.secondary_trait_prefix,
    );
    const secondaryBonus = secondaryTraitId === null
      ? 0
      : this.content.game.campaign_profiles.traits.find(
        (trait) => trait.id === secondaryTraitId,
      )?.expedition_step_bonus ?? 0;
    return resolved.trait.expedition_step_bonus + secondaryBonus;
  }

  /** 返回所有开局效果，供配置校验或测试检查。 */
  public startingEffects(
    profile: NewGameCampaignProfileSelection,
  ): readonly NumericEffectConfig[] {
    const resolved = this.resolve(profile);
    return [
      ...resolved.difficulty.starting_effects,
      ...resolved.origin.starting_effects,
      ...resolved.trait.starting_effects,
      ...resolved.secondaryTrait.starting_effects,
      ...resolved.shelterType.starting_effects,
    ];
  }

  /** 校验双特性的数量、唯一性和双向互斥关系。 */
  private traitPairAllowed(
    primary: CampaignTraitConfig,
    secondary: CampaignTraitConfig,
  ): boolean {
    const rules = this.content.game.campaign_profiles.trait_selection_rules;
    const selectionCount = 2;
    if (
      selectionCount < rules.minimum_selections
      || selectionCount > rules.maximum_selections
    ) {
      return false;
    }
    if (rules.require_unique && primary.id === secondary.id) return false;
    return !primary.incompatible_trait_ids.includes(secondary.id)
      && !secondary.incompatible_trait_ids.includes(primary.id);
  }

  /** 写入选中的出生区划、第二特性与避难所原型，并建立墙体初值。 */
  private initializeShelterProfile(
    state: GameState,
    resolved: ResolvedCampaignProfile,
  ): void {
    const flags = this.content.game.campaign_profiles.metadata_flags;
    writeCampaignMetadataFlag(
      state.story.flags,
      flags.secondary_trait_prefix,
      resolved.secondaryTrait.id,
    );
    writeCampaignMetadataFlag(
      state.story.flags,
      flags.home_district_prefix,
      resolved.homeDistrict.id,
    );
    writeCampaignMetadataFlag(
      state.story.flags,
      flags.shelter_type_prefix,
      resolved.shelterType.id,
    );
    writeCampaignMetadataFlag(
      state.story.flags,
      flags.shelter_capacity_prefix,
      resolved.shelterType.starting_capacity,
    );
    writeCampaignMetadataFlag(
      state.story.flags,
      flags.shelter_facility_slots_prefix,
      resolved.shelterType.initial_facility_slots,
    );
    state.shelter.inner_wall_health = resolved.shelterType.inner_wall_health;
    state.shelter.outer_wall_health = resolved.shelterType.outer_wall_health;
    synchronizeShelterHealth(state.shelter);
  }
}
