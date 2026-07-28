/** 分避难所类型的配置化定义。 */
export interface ShelterArchetypeConfig {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly bonuses: readonly string[];
  readonly starting_capacity: number;
}

/** 跨城侦察与分避难所共同使用的经济和时间规则。 */
export interface SettlementNetworkRulesConfig {
  readonly recon_duration_days: number;
  readonly maximum_outposts: number;
  readonly outpost_coin_cost: number;
  readonly outpost_part_cost: number;
  readonly supply_interval_days: number;
  readonly supply_food_cost: number;
  readonly supply_part_cost: number;
  readonly supply_coin_cost: number;
  readonly supply_medical_supply_cost: number;
  readonly outpost_operations: OutpostOperationsRulesConfig;
  readonly flag_namespace: string;
}

/** 分避难所初始状态、资源上限与经营行动参数。 */
export interface OutpostOperationsRulesConfig {
  readonly starting_population: number;
  readonly starting_hope: number;
  readonly starting_activity: number;
  readonly starting_inner_wall_health: number;
  readonly starting_outer_wall_health: number;
  readonly starting_food: number;
  readonly starting_parts: number;
  readonly starting_medical_supplies: number;
  readonly starting_coins: number;
  readonly maximum_wall_health: number;
  readonly maximum_hope: number;
  readonly maximum_activity: number;
  readonly maximum_facility_level: number;
  readonly maintenance_part_cost: number;
  readonly maintenance_repair: number;
  readonly patrol_part_cost: number;
  readonly patrol_repair: number;
  readonly patrol_activity_gain: number;
  readonly activity_food_cost: number;
  readonly activity_hope_gain: number;
  readonly activity_activity_gain: number;
  readonly upgrade_coin_base_cost: number;
  readonly upgrade_coin_growth: number;
  readonly upgrade_part_base_cost: number;
  readonly upgrade_part_growth: number;
}

/** 分避难所可独立运行的经营与库存状态。 */
export interface OutpostOperationalState {
  readonly population: number;
  readonly hope: number;
  readonly activity: number;
  readonly innerWallHealth: number;
  readonly outerWallHealth: number;
  readonly food: number;
  readonly parts: number;
  readonly medicalSupplies: number;
  readonly coins: number;
  readonly facilityLevel: number;
}

/** 分避难所详情页可执行的配置化经营行动。 */
export type OutpostManagementAction = "maintenance" | "patrol" | "activity" | "upgrade";

/** SettlementNetworkService 的完整不可变配置。 */
export interface SettlementNetworkConfig {
  readonly rules: SettlementNetworkRulesConfig;
  readonly shelter_types: readonly ShelterArchetypeConfig[];
  readonly texts: Readonly<Record<string, string>>;
}

/** 一项正在进行或已经可以结算的跨城侦察。 */
export interface CityReconMissionView {
  readonly cityId: string;
  readonly cityName: string;
  readonly companionId: string;
  readonly companionName: string;
  readonly startedDay: number;
  readonly completionDay: number;
  readonly daysRemaining: number;
  readonly ready: boolean;
}

/** 一个已经建立的分避难所及其物流状态。 */
export interface OutpostView {
  readonly outpostId: string;
  readonly cityId: string;
  readonly cityName: string;
  readonly districtId: string;
  readonly districtName: string;
  readonly shelterTypeId: string;
  readonly shelterTypeLabel: string;
  readonly capacity: number;
  readonly assignedCompanionIds: readonly string[];
  readonly assignedCompanionNames: readonly string[];
  readonly lastSuppliedDay: number;
  readonly nextSupplyDay: number;
  readonly supplyReady: boolean;
  readonly operations: OutpostOperationalState;
}

/** 一次侦察、建设、派驻或补给命令的统一结果。 */
export interface SettlementNetworkResolution {
  readonly applied: boolean;
  readonly messages: readonly string[];
  readonly turnsConsumed: number;
}
