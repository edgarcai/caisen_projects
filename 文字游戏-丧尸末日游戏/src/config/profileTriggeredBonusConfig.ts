import {
  CAMPAIGN_PROFILE_METADATA_FLAGS,
} from "./campaignProfileExpansionAdapter";
import {
  originOptions,
  traitOptions,
} from "./contentExpansion";
import type {
  ProfileTriggeredBonusConfig,
  ProfileTriggeredBonusSource,
} from "../services/ProfileTriggeredBonusService";

/** 探索资源差异与起源/特性触发器的配置化映射。 */
export const profileTriggeredBonusConfig: ProfileTriggeredBonusConfig = {
  secondaryTraitFlagPrefix: CAMPAIGN_PROFILE_METADATA_FLAGS.secondary_trait_prefix,
  triggerObservationTargets: {
    search_parts: ["player.parts"],
    search_material: ["player.parts"],
    search_vehicle: ["player.parts"],
    search_medicine: ["player.medical_supplies"],
    search_raw_food: ["player.food"],
    search_archive: ["shelter.newspapers", "shelter.books", "shelter.magazines"],
    collect_text: ["shelter.newspapers", "shelter.books", "shelter.magazines"],
  },
  rewardStateTargets: {
    "loot.parts": "player.parts",
    "loot.medical_supplies": "player.medical_supplies",
    "loot.raw_food": "player.food",
    "loot.archive": "shelter.newspapers",
    "city.intelligence": "shelter.newspapers",
  },
  activatedText: "【{profile_name}】触发加成，额外获得 {amount}：{description}",
};

/** 将扩展起源与特性目录投影为触发加成数据源。 */
export function createProfileTriggeredBonusSources(): readonly ProfileTriggeredBonusSource[] {
  return [
    ...originOptions.map((origin) => ({
      type: "origin" as const,
      id: origin.id,
      name: origin.label,
      bonuses: origin.triggeredBonuses,
    })),
    ...traitOptions.map((trait) => ({
      type: "trait" as const,
      id: trait.id,
      name: trait.label,
      bonuses: trait.triggeredBonuses,
    })),
  ];
}
