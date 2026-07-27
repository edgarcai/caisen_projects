import type { GameApplication } from "../application";
import type { WebGameConfig } from "../config/types";
import type { GameState } from "../domain/game-state";
import type {
  UiCityReconMissionView,
  UiCityView,
  UiExpeditionCompanionView,
  UiOutpostShelterTypeView,
  UiOutpostView,
  UiSettlementCityView,
  UiSettlementNetworkRulesView,
} from "../ui/ports/GameUiPort";
import { formatUiTemplate } from "../ui/formatting/formatUiTemplate";

/** 城市侦察与分避难所 UI 需要的完整不可变投影。 */
export interface SettlementNetworkUiProjection {
  readonly rules: UiSettlementNetworkRulesView;
  readonly cities: readonly UiSettlementCityView[];
  readonly missions: readonly UiCityReconMissionView[];
  readonly shelterTypes: readonly UiOutpostShelterTypeView[];
  readonly outposts: readonly UiOutpostView[];
  readonly availableCompanions: readonly UiExpeditionCompanionView[];
}

/** 从应用用例与已有城市视图组装分避难所网络的 UI 投影。 */
export function buildSettlementNetworkUiProjection(
  application: GameApplication,
  state: GameState,
  webConfig: WebGameConfig,
  cityViews: readonly UiCityView[],
  availableCompanions: readonly UiExpeditionCompanionView[],
): SettlementNetworkUiProjection {
  const domainRules = application.settlementNetworkRules();
  const missions = application.cityReconMissions().map((mission) => ({ ...mission }));
  const activeCityIds = new Set(missions.map((mission) => mission.cityId));
  const availableCompanionCount = availableCompanions.length;
  const domainCities = new Map(
    application.expeditionCities().map((decision) => [decision.city.id, decision.city]),
  );
  const cities = cityViews.map((cityView): UiSettlementCityView => {
    const city = domainCities.get(cityView.id);
    if (city === undefined) {
      throw new Error(`分避难所城市投影缺失：${cityView.id}`);
    }
    const unlocked = application.settlementCityUnlocked(city.id);
    const reconActive = activeCityIds.has(city.id);
    const intelligenceCurrent = state.shelter.newspapers;
    const intelligenceReady =
      intelligenceCurrent >= city.intelligence_newspapers_required;
    const transportReady = hasRequiredTransport(
      state.inventory.equipped_transport_ids,
      city.transport_item_ids,
      city.transport_match,
    );
    const canStartRecon = !unlocked
      && !reconActive
      && intelligenceReady
      && transportReady
      && availableCompanionCount > 0;
    return {
      id: city.id,
      label: city.name,
      description: city.description,
      districts: cityView.districts,
      unlocked,
      canStartRecon,
      intelligenceCurrent,
      intelligenceRequired: city.intelligence_newspapers_required,
      transportNames: transportNames(cityView, webConfig),
      transportStatusLabel: transportReady
        ? webConfig.texts.settlement_recon_transport_ready
        : webConfig.texts.settlement_recon_transport_locked,
      statusLabel: cityStatusLabel(
        webConfig,
        unlocked,
        reconActive,
        canStartRecon,
      ),
      disabledReason: canStartRecon
        ? undefined
        : cityDisabledReason(
            webConfig,
            unlocked,
            reconActive,
            intelligenceReady,
            intelligenceCurrent,
            city.intelligence_newspapers_required,
            transportReady,
            availableCompanionCount,
          ),
    };
  });
  return {
    rules: {
      reconDurationDays: domainRules.recon_duration_days,
      maximumOutposts: domainRules.maximum_outposts,
      outpostCoinCost: domainRules.outpost_coin_cost,
      outpostPartCost: domainRules.outpost_part_cost,
      supplyIntervalDays: domainRules.supply_interval_days,
      supplyFoodCost: domainRules.supply_food_cost,
      supplyPartCost: domainRules.supply_part_cost,
      supplyCoinCost: domainRules.supply_coin_cost,
      supplyMedicalSupplyCost: domainRules.supply_medical_supply_cost,
    },
    cities,
    missions,
    shelterTypes: application.outpostShelterTypes().map((shelterType) => ({
      id: shelterType.id,
      label: shelterType.label,
      description: shelterType.description,
      bonuses: [...shelterType.bonuses],
      startingCapacity: shelterType.starting_capacity,
    })),
    outposts: application.outposts().map((outpost) => ({
      ...outpost,
      assignedCompanionIds: [...outpost.assignedCompanionIds],
      assignedCompanionNames: [...outpost.assignedCompanionNames],
      operations: { ...outpost.operations },
    })),
    availableCompanions,
  };
}

/** 在未开局时仍返回配置化规则，其余投影保持空集合。 */
export function buildEmptySettlementNetworkUiProjection(
  application: GameApplication,
): SettlementNetworkUiProjection {
  const rules = application.settlementNetworkRules();
  return {
    rules: {
      reconDurationDays: rules.recon_duration_days,
      maximumOutposts: rules.maximum_outposts,
      outpostCoinCost: rules.outpost_coin_cost,
      outpostPartCost: rules.outpost_part_cost,
      supplyIntervalDays: rules.supply_interval_days,
      supplyFoodCost: rules.supply_food_cost,
      supplyPartCost: rules.supply_part_cost,
      supplyCoinCost: rules.supply_coin_cost,
      supplyMedicalSupplyCost: rules.supply_medical_supply_cost,
    },
    cities: [],
    missions: [],
    shelterTypes: [],
    outposts: [],
    availableCompanions: [],
  };
}

/** 按城市的 any/all 匹配规则校验已装备载具。 */
function hasRequiredTransport(
  equippedTransportIds: readonly string[],
  requiredTransportIds: readonly string[],
  match: "any" | "all",
): boolean {
  const equipped = new Set(equippedTransportIds);
  if (match === "all") {
    return requiredTransportIds.length > 0
      && requiredTransportIds.every((itemId) => equipped.has(itemId));
  }
  return requiredTransportIds.some((itemId) => equipped.has(itemId));
}

/** 从既有城市详情字段中取出已本地化的载具名称。 */
function transportNames(
  city: UiCityView,
  webConfig: WebGameConfig,
): string {
  return city.fields.find((field) => field.id === "transport-items")?.value
    ?? webConfig.texts.expedition_empty_value;
}

/** 根据解锁、任务和条件状态选择城市短标签。 */
function cityStatusLabel(
  webConfig: WebGameConfig,
  unlocked: boolean,
  reconActive: boolean,
  canStartRecon: boolean,
): string {
  if (unlocked) return webConfig.texts.settlement_city_status_unlocked;
  if (reconActive) return webConfig.texts.settlement_city_status_active;
  return canStartRecon
    ? webConfig.texts.settlement_city_status_available
    : webConfig.texts.settlement_city_status_locked;
}

/** 按与领域校验相同的优先级返回配置化阻断原因。 */
function cityDisabledReason(
  webConfig: WebGameConfig,
  unlocked: boolean,
  reconActive: boolean,
  intelligenceReady: boolean,
  intelligenceCurrent: number,
  intelligenceRequired: number,
  transportReady: boolean,
  availableCompanionCount: number,
): string {
  if (unlocked) return webConfig.texts.settlement_recon_already_unlocked;
  if (reconActive) return webConfig.texts.settlement_recon_already_active;
  if (!intelligenceReady) {
    return formatUiTemplate(webConfig.texts.settlement_recon_need_intelligence, {
      current: intelligenceCurrent,
      required: intelligenceRequired,
    });
  }
  if (!transportReady) return webConfig.texts.settlement_recon_need_transport;
  if (availableCompanionCount === 0) {
    return webConfig.texts.settlement_recon_need_companion;
  }
  return webConfig.texts.settlement_city_status_locked;
}
