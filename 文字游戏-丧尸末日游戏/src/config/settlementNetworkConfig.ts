import type {
  SettlementNetworkConfig,
  ShelterArchetypeConfig,
} from "../domain/settlement-network";

/** 跨城侦察、分避难所与物流共用的配置化规则。 */
const SETTLEMENT_NETWORK_RULES = {
  recon_duration_days: 7,
  maximum_outposts: 8,
  outpost_coin_cost: 80,
  outpost_part_cost: 120,
  supply_interval_days: 7,
  supply_food_cost: 12,
  supply_part_cost: 8,
  supply_coin_cost: 10,
  supply_medical_supply_cost: 1,
  outpost_operations: {
    starting_population: 2,
    starting_hope: 70,
    starting_activity: 50,
    starting_inner_wall_health: 100,
    starting_outer_wall_health: 100,
    starting_food: 4,
    starting_parts: 4,
    starting_medical_supplies: 1,
    starting_coins: 12,
    maximum_wall_health: 200,
    maximum_hope: 100,
    maximum_activity: 100,
    maximum_facility_level: 10,
    maintenance_part_cost: 4,
    maintenance_repair: 20,
    patrol_part_cost: 3,
    patrol_repair: 16,
    patrol_activity_gain: 4,
    activity_food_cost: 2,
    activity_hope_gain: 6,
    activity_activity_gain: 8,
    upgrade_coin_base_cost: 10,
    upgrade_coin_growth: 5,
    upgrade_part_base_cost: 8,
    upgrade_part_growth: 4,
  },
  flag_namespace: "settlement_network.v1",
} as const;

/** 跨城侦察与分避难所的可替换中文文案。 */
const SETTLEMENT_NETWORK_TEXTS = {
  shelter_type_unknown: "未知的避难所类型：{shelter_type_id}。",
  companion_unknown: "未找到角色档案：{companion_id}。",
  recon_already_unlocked: "{city_name}已经完成侦察解锁。",
  recon_already_active: "{city_name}的一周侦察任务正在进行。",
  recon_companion_unavailable: "{companion_name}当前无法执行侦察任务。",
  recon_need_intelligence: "情报不足，需要至少 {required} 份报纸还原城市路线。",
  recon_need_transport: "尚未装备能够抵达 {city_name} 的载具。",
  recon_started: "{companion_name}已出发侦察 {city_name}，预计 {days} 天后返程。",
  recon_not_found: "没有找到城市 {city_id} 的侦察任务。",
  recon_not_ready: "侦察队尚未返程，还需要 {days} 天。",
  recon_completed: "{companion_name}：“{city_name}的主干路已标记，我们现在可以进入。我还在废墟墙上看到了一个避难所的求援符号。”",
  recon_city_access_locked: "需装备匹配载具、收集足够报纸情报，再派出一名角色侦察一周后解锁 {city_name}。",
  outpost_city_locked: "{city_name}尚未完成侦察，无法建立分避难所。",
  outpost_limit: "分避难所数量已达上限 {maximum}。",
  outpost_exists: "{district_name}已建有分避难所。",
  outpost_resource_shortage: "建立分避难所需要 {coins} 金币与 {parts} 零件。",
  outpost_established: "已在 {city_name}{district_name} 建立【{shelter_type}】。",
  outpost_unknown: "未找到分避难所：{outpost_id}。",
  outpost_companion_unavailable: "{companion_name}当前不能派驻。",
  outpost_companion_assigned: "{companion_name}已前往 {city_name} 驻守，将按周发回通讯。",
  outpost_companion_not_assigned: "{companion_name}当前没有驻守分避难所。",
  outpost_companion_recalled: "{companion_name}：“我从 {city_name} 回来了。那里的人已经能够独立守住外墙。”",
  outpost_supply_not_ready: "本周物流已经送达，下次可在第 {day} 天运送。",
  outpost_supply_shortage: "周物流需要 {food} 食物、{parts} 零件、{coins} 金币与 {medical} 医疗用品。",
  outpost_supplied: "前往 {city_name} 的周物流已入库：食物 +{food}、零件 +{parts}、金币 +{coins}、医疗用品 +{medical}。",
} as const;

/** 用扩展内容目录的避难所类型组装完整网络配置。 */
export function createSettlementNetworkConfig(
  shelterTypes: readonly ShelterArchetypeConfig[],
): SettlementNetworkConfig {
  return {
    rules: SETTLEMENT_NETWORK_RULES,
    shelter_types: structuredClone(shelterTypes),
    texts: SETTLEMENT_NETWORK_TEXTS,
  };
}
