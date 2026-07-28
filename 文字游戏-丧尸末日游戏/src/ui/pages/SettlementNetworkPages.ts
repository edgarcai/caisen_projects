import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { UiFactory } from "../components/UiFactory";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiCityDistrictView,
  UiCityReconMissionView,
  UiExpeditionCompanionView,
  UiOptionView,
  UiOutpostShelterTypeView,
  UiOutpostView,
  UiPromptView,
  UiSettlementCityView,
  UiSettlementNetworkRulesView,
} from "../ports/GameUiPort";
import { createChoicePage } from "./ChoicePage";
import type { PageView } from "./PageView";

const START_RECON_OPTION_ID = "settlement:start-recon";
const BUILD_OUTPOST_OPTION_ID = "settlement:build-outpost";
const ASSIGN_COMPANION_OPTION_ID = "outpost:assign-companion";
const SUPPLY_OUTPOST_OPTION_ID = "outpost:supply";
const RECON_MISSION_PREFIX = "settlement:complete-recon:";
const OUTPOST_DETAIL_PREFIX = "settlement:outpost:";
const OUTPOST_RECALL_PREFIX = "outpost:recall:";

/** 分避难所总览页可发出的稳定意图。 */
export interface SettlementNetworkOverviewActions {
  readonly back: () => void;
  readonly startRecon: () => void;
  readonly buildOutpost: () => void;
  readonly completeRecon: (cityId: string) => void;
  readonly openOutpost: (outpostId: string) => void;
}

/** 侦察城市选择页的稳定导航意图。 */
export interface CityReconSelectionActions {
  readonly back: () => void;
  readonly selectCity: (cityId: string) => void;
}

/** 侦察角色选择页的稳定命令意图。 */
export interface ReconCompanionSelectionActions {
  readonly back: () => void;
  readonly startRecon: (companionId: string) => void;
}

/** 分避难所城市选择页的稳定导航意图。 */
export interface OutpostCitySelectionActions {
  readonly back: () => void;
  readonly selectCity: (cityId: string) => void;
}

/** 分避难所区划选择页的稳定导航意图。 */
export interface OutpostDistrictSelectionActions {
  readonly back: () => void;
  readonly selectDistrict: (districtId: string) => void;
}

/** 分避难所类型选择页的稳定命令意图。 */
export interface OutpostTypeSelectionActions {
  readonly back: () => void;
  readonly establish: (shelterTypeId: string) => void;
}

/** 分避难所详情页可发出的人员与物流意图。 */
export interface OutpostDetailActions {
  readonly back: () => void;
  readonly assignCompanion: () => void;
  readonly recallCompanion: (companionId: string) => void;
  readonly supply: () => void;
}

/** 分避难所派驻页可发出的稳定命令意图。 */
export interface OutpostAssignmentActions {
  readonly back: () => void;
  readonly assign: (companionId: string) => void;
}

/** 创建城市侦察、分避难所与周物流的总览页。 */
export function createSettlementNetworkPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  missions: readonly UiCityReconMissionView[],
  outposts: readonly UiOutpostView[],
  rules: UiSettlementNetworkRulesView,
  actions: SettlementNetworkOverviewActions,
): PageView {
  const prompt = buildSettlementNetworkPrompt(config, missions, outposts, rules);
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-settlement-network",
    title: config.texts.settlement_network_title,
    prompt,
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => {
      if (option.id === START_RECON_OPTION_ID) {
        actions.startRecon();
        return;
      }
      if (option.id === BUILD_OUTPOST_OPTION_ID) {
        actions.buildOutpost();
        return;
      }
      const mission = missions.find(
        (candidate) => reconMissionOptionId(candidate.cityId) === option.id,
      );
      if (mission !== undefined) {
        actions.completeRecon(mission.cityId);
        return;
      }
      const outpost = outposts.find(
        (candidate) => outpostDetailOptionId(candidate.outpostId) === option.id,
      );
      if (outpost !== undefined) actions.openOutpost(outpost.outpostId);
    },
  });
}

/** 把侦察任务、分避难所和配置成本组装为总览选项。 */
export function buildSettlementNetworkPrompt(
  config: GameUiConfig,
  missions: readonly UiCityReconMissionView[],
  outposts: readonly UiOutpostView[],
  rules: UiSettlementNetworkRulesView,
): UiPromptView {
  const missionSummary = missions.length === 0
    ? config.texts.settlement_network_no_missions
    : formatUiTemplate(config.texts.settlement_network_mission_count, {
        count: missions.length,
      });
  const outpostSummary = outposts.length === 0
    ? config.texts.settlement_network_no_outposts
    : formatUiTemplate(config.texts.settlement_network_outpost_count, {
        count: outposts.length,
        maximum: rules.maximumOutposts,
      });
  return {
    id: "settlement-network",
    title: config.texts.settlement_network_title,
    body: formatUiTemplate(config.texts.settlement_network_body, {
      missions: missionSummary,
      outposts: outpostSummary,
    }),
    options: [
      {
        id: START_RECON_OPTION_ID,
        label: config.texts.settlement_network_start_recon,
        description: formatUiTemplate(
          config.texts.settlement_network_start_recon_description,
          { days: rules.reconDurationDays },
        ),
        disabled: false,
        tone: "primary",
      },
      {
        id: BUILD_OUTPOST_OPTION_ID,
        label: config.texts.settlement_network_build_outpost,
        description: formatUiTemplate(
          config.texts.settlement_network_build_outpost_description,
          {
            coins: rules.outpostCoinCost,
            parts: rules.outpostPartCost,
            maximum: rules.maximumOutposts,
          },
        ),
        disabled: outposts.length >= rules.maximumOutposts,
        disabledReason: outposts.length >= rules.maximumOutposts
          ? formatUiTemplate(config.texts.settlement_network_outpost_limit, {
              maximum: rules.maximumOutposts,
            })
          : undefined,
        tone: "primary",
      },
      ...missions.map((mission): UiOptionView => ({
        id: reconMissionOptionId(mission.cityId),
        label: formatUiTemplate(config.texts.settlement_network_mission_format, {
          city: mission.cityName,
          companion: mission.companionName,
        }),
        description: mission.ready
          ? config.texts.settlement_network_mission_ready
          : formatUiTemplate(config.texts.settlement_network_mission_progress, {
              completion_day: mission.completionDay,
              days: mission.daysRemaining,
            }),
        disabled: !mission.ready,
        disabledReason: mission.ready
          ? undefined
          : formatUiTemplate(config.texts.settlement_network_mission_progress, {
              completion_day: mission.completionDay,
              days: mission.daysRemaining,
            }),
        tone: mission.ready ? "success" : "default",
      })),
      ...outposts.map((outpost): UiOptionView => ({
        id: outpostDetailOptionId(outpost.outpostId),
        label: formatUiTemplate(config.texts.settlement_network_outpost_format, {
          city: outpost.cityName,
          district: outpost.districtName,
          type: outpost.shelterTypeLabel,
        }),
        description: formatUiTemplate(config.texts.settlement_network_outpost_summary, {
          residents: outpost.assignedCompanionNames.length,
          next_supply_day: outpost.nextSupplyDay,
        }),
        disabled: false,
        tone: outpost.supplyReady ? "warning" : "default",
      })),
    ],
  };
}

/** 创建详细展示情报、载具和侦察状态的城市选择页。 */
export function createCityReconSelectionPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  cities: readonly UiSettlementCityView[],
  actions: CityReconSelectionActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-settlement-recon-city",
    title: config.texts.settlement_recon_city_title,
    prompt: buildCityReconPrompt(config, cities),
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => { actions.selectCity(option.id); },
  });
}

/** 把城市的解锁、报纸情报和载具需求组装为侦察选项。 */
export function buildCityReconPrompt(
  config: GameUiConfig,
  cities: readonly UiSettlementCityView[],
): UiPromptView {
  return {
    id: "settlement-recon-city",
    title: config.texts.settlement_recon_city_title,
    body: config.texts.settlement_recon_city_body,
    options: cities.map((city): UiOptionView => ({
      id: city.id,
      label: formatUiTemplate(config.texts.settlement_recon_city_format, {
        city: city.label,
        status: city.statusLabel,
      }),
      description: formatUiTemplate(config.texts.settlement_recon_city_detail, {
        description: city.description,
        intelligence_current: city.intelligenceCurrent,
        intelligence_required: city.intelligenceRequired,
        transports: city.transportNames,
        transport_status: city.transportStatusLabel,
      }),
      disabled: !city.canStartRecon,
      disabledReason: city.disabledReason,
      tone: city.canStartRecon ? "primary" : "default",
    })),
  };
}

/** 创建只展示当前可出勤角色的侦察人选页。 */
export function createReconCompanionSelectionPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  city: UiSettlementCityView,
  companions: readonly UiExpeditionCompanionView[],
  actions: ReconCompanionSelectionActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-settlement-recon-companion",
    title: config.texts.settlement_recon_companion_title,
    prompt: buildReconCompanionPrompt(config, city, companions),
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => { actions.startRecon(option.id); },
  });
}

/** 把可出勤角色转换为含词条、信任与目标城市的侦察选项。 */
export function buildReconCompanionPrompt(
  config: GameUiConfig,
  city: UiSettlementCityView,
  companions: readonly UiExpeditionCompanionView[],
): UiPromptView {
  return {
    id: `settlement-recon-companion-${city.id}`,
    title: city.label,
    body: companions.length === 0
      ? config.texts.settlement_recon_no_companion
      : formatUiTemplate(config.texts.settlement_recon_companion_body, {
          city: city.label,
        }),
    options: companions.map((companion): UiOptionView => ({
      id: companion.id,
      label: companion.name,
      description: formatUiTemplate(config.texts.settlement_recon_companion_format, {
        trait: companion.traitName,
        trust: companion.trust,
      }),
      disabled: false,
      tone: "primary",
    })),
  };
}

/** 创建只允许已解锁城市继续建设的分避难所城市页。 */
export function createOutpostCitySelectionPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  cities: readonly UiSettlementCityView[],
  outposts: readonly UiOutpostView[],
  actions: OutpostCitySelectionActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-outpost-build-city",
    title: config.texts.outpost_build_city_title,
    prompt: buildOutpostCityPrompt(config, cities, outposts),
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => { actions.selectCity(option.id); },
  });
}

/** 按城市解锁状态与剩余可建区划组装建设城市选项。 */
export function buildOutpostCityPrompt(
  config: GameUiConfig,
  cities: readonly UiSettlementCityView[],
  outposts: readonly UiOutpostView[],
): UiPromptView {
  return {
    id: "outpost-build-city",
    title: config.texts.outpost_build_city_title,
    body: config.texts.outpost_build_city_body,
    options: cities.map((city): UiOptionView => {
      const occupiedDistrictIds = new Set(
        outposts.filter((outpost) => outpost.cityId === city.id)
          .map((outpost) => outpost.districtId),
      );
      const remainingDistricts = city.districts.filter(
        (district) => !occupiedDistrictIds.has(district.id),
      ).length;
      const disabled = !city.unlocked || remainingDistricts === 0;
      return {
        id: city.id,
        label: formatUiTemplate(config.texts.outpost_build_city_format, {
          city: city.label,
          remaining: remainingDistricts,
        }),
        description: city.description,
        disabled,
        disabledReason: !city.unlocked
          ? config.texts.outpost_build_city_locked
          : remainingDistricts === 0
            ? config.texts.outpost_build_city_full
            : undefined,
        tone: disabled ? "default" : "primary",
      };
    }),
  };
}

/** 创建指定城市的区划选择页，已建设区划保留灰态。 */
export function createOutpostDistrictSelectionPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  city: UiSettlementCityView,
  outposts: readonly UiOutpostView[],
  actions: OutpostDistrictSelectionActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-outpost-build-district",
    title: config.texts.outpost_build_district_title,
    prompt: buildOutpostDistrictPrompt(config, city, outposts),
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => { actions.selectDistrict(option.id); },
  });
}

/** 把城市区划和已有分避难所对齐为建设选项。 */
export function buildOutpostDistrictPrompt(
  config: GameUiConfig,
  city: UiSettlementCityView,
  outposts: readonly UiOutpostView[],
): UiPromptView {
  const occupiedDistrictIds = new Set(
    outposts.filter((outpost) => outpost.cityId === city.id)
      .map((outpost) => outpost.districtId),
  );
  return {
    id: `outpost-build-district-${city.id}`,
    title: city.label,
    body: config.texts.outpost_build_district_body,
    options: city.districts.map((district): UiOptionView => ({
      id: district.id,
      label: district.label,
      description: district.description,
      disabled: occupiedDistrictIds.has(district.id),
      disabledReason: occupiedDistrictIds.has(district.id)
        ? config.texts.outpost_build_district_occupied
        : undefined,
      tone: occupiedDistrictIds.has(district.id) ? "default" : "primary",
    })),
  };
}

/** 创建含容量、加成与实时成本的避难所类型选择页。 */
export function createOutpostTypeSelectionPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  city: UiSettlementCityView,
  district: UiCityDistrictView,
  shelterTypes: readonly UiOutpostShelterTypeView[],
  rules: UiSettlementNetworkRulesView,
  actions: OutpostTypeSelectionActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-outpost-build-type",
    title: config.texts.outpost_build_type_title,
    prompt: buildOutpostTypePrompt(config, city, district, shelterTypes, rules),
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => { actions.establish(option.id); },
  });
}

/** 把配置化避难所类型及经济需求组装为最终建设选项。 */
export function buildOutpostTypePrompt(
  config: GameUiConfig,
  city: UiSettlementCityView,
  district: UiCityDistrictView,
  shelterTypes: readonly UiOutpostShelterTypeView[],
  rules: UiSettlementNetworkRulesView,
): UiPromptView {
  return {
    id: `outpost-build-type-${city.id}-${district.id}`,
    title: formatUiTemplate(config.texts.outpost_build_location_format, {
      city: city.label,
      district: district.label,
    }),
    body: formatUiTemplate(config.texts.outpost_build_type_body, {
      coins: rules.outpostCoinCost,
      parts: rules.outpostPartCost,
    }),
    options: shelterTypes.map((shelterType): UiOptionView => ({
      id: shelterType.id,
      label: shelterType.label,
      description: formatUiTemplate(config.texts.outpost_build_type_format, {
        description: shelterType.description,
        capacity: shelterType.startingCapacity,
        bonuses: shelterType.bonuses.join(config.texts.save_slot_name_separator),
      }),
      disabled: false,
      tone: "primary",
    })),
  };
}

/** 创建分避难所的派驻、召回与周物流详情页。 */
export function createOutpostDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  outpost: UiOutpostView,
  availableCompanions: readonly UiExpeditionCompanionView[],
  rules: UiSettlementNetworkRulesView,
  actions: OutpostDetailActions,
): PageView {
  const prompt = buildOutpostDetailPrompt(
    config,
    outpost,
    availableCompanions,
    rules,
  );
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-outpost-detail",
    title: config.texts.outpost_detail_title,
    prompt,
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => {
      if (option.id === ASSIGN_COMPANION_OPTION_ID) {
        actions.assignCompanion();
        return;
      }
      if (option.id === SUPPLY_OUTPOST_OPTION_ID) {
        actions.supply();
        return;
      }
      const companionId = outpost.assignedCompanionIds.find(
        (candidate) => recallOptionId(candidate) === option.id,
      );
      if (companionId !== undefined) actions.recallCompanion(companionId);
    },
  });
}

/** 把分避难所基础档案、驻守人员和补给周期组装为操作选项。 */
export function buildOutpostDetailPrompt(
  config: GameUiConfig,
  outpost: UiOutpostView,
  availableCompanions: readonly UiExpeditionCompanionView[],
  rules: UiSettlementNetworkRulesView,
): UiPromptView {
  const assigned = outpost.assignedCompanionNames.length === 0
    ? config.texts.outpost_detail_no_companion
    : outpost.assignedCompanionNames.join(config.texts.save_slot_name_separator);
  const body = formatUiTemplate(config.texts.outpost_detail_body, {
    city: outpost.cityName,
    district: outpost.districtName,
    type: outpost.shelterTypeLabel,
    companions: assigned,
    last_supply_day: outpost.lastSuppliedDay,
    next_supply_day: outpost.nextSupplyDay,
    population: outpost.operations.population,
    capacity: outpost.capacity,
    hope: outpost.operations.hope,
    activity: outpost.operations.activity,
    inner_wall: outpost.operations.innerWallHealth,
    outer_wall: outpost.operations.outerWallHealth,
    facility_level: outpost.operations.facilityLevel,
    food: outpost.operations.food,
    parts: outpost.operations.parts,
    coins: outpost.operations.coins,
    medical: outpost.operations.medicalSupplies,
  });
  const supplyDescription = outpost.supplyReady
    ? formatUiTemplate(config.texts.outpost_supply_ready, {
        food: rules.supplyFoodCost,
        parts: rules.supplyPartCost,
        coins: rules.supplyCoinCost,
        medical: rules.supplyMedicalSupplyCost,
      })
    : formatUiTemplate(config.texts.outpost_supply_waiting, {
        day: outpost.nextSupplyDay,
      });
  return {
    id: `outpost-detail-${outpost.outpostId}`,
    title: formatUiTemplate(config.texts.outpost_detail_title_format, {
      city: outpost.cityName,
      district: outpost.districtName,
    }),
    body,
    options: [
      {
        id: ASSIGN_COMPANION_OPTION_ID,
        label: config.texts.outpost_assign_companion,
        description: config.texts.outpost_assign_companion_description,
        disabled: availableCompanions.length === 0,
        disabledReason: availableCompanions.length === 0
          ? config.texts.outpost_assign_no_companion
          : undefined,
        tone: "primary",
      },
      ...outpost.assignedCompanionIds.map((companionId, index): UiOptionView => ({
        id: recallOptionId(companionId),
        label: formatUiTemplate(config.texts.outpost_recall_companion_format, {
          companion: outpost.assignedCompanionNames[index] ?? companionId,
        }),
        description: config.texts.outpost_recall_companion_description,
        disabled: false,
        tone: "warning",
      })),
      {
        id: SUPPLY_OUTPOST_OPTION_ID,
        label: config.texts.outpost_supply,
        description: supplyDescription,
        disabled: !outpost.supplyReady,
        disabledReason: outpost.supplyReady ? undefined : supplyDescription,
        tone: outpost.supplyReady ? "success" : "default",
      },
    ],
  };
}

/** 创建一个仅包含未被其他任务占用角色的分避难所派驻页。 */
export function createOutpostAssignmentPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  outpost: UiOutpostView,
  companions: readonly UiExpeditionCompanionView[],
  actions: OutpostAssignmentActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-outpost-assign",
    title: config.texts.outpost_assign_title,
    prompt: buildOutpostAssignmentPrompt(config, outpost, companions),
    onBack: actions.back,
    includeOptionIntelligence: true,
    onSelect: (option): void => { actions.assign(option.id); },
  });
}

/** 把可用角色的词条和信任组装为分避难所派驻选项。 */
export function buildOutpostAssignmentPrompt(
  config: GameUiConfig,
  outpost: UiOutpostView,
  companions: readonly UiExpeditionCompanionView[],
): UiPromptView {
  return {
    id: `outpost-assign-${outpost.outpostId}`,
    title: formatUiTemplate(config.texts.outpost_assign_location_format, {
      city: outpost.cityName,
      district: outpost.districtName,
    }),
    body: companions.length === 0
      ? config.texts.outpost_assign_no_companion
      : config.texts.outpost_assign_body,
    options: companions.map((companion): UiOptionView => ({
      id: companion.id,
      label: companion.name,
      description: formatUiTemplate(config.texts.outpost_assign_companion_format, {
        trait: companion.traitName,
        trust: companion.trust,
      }),
      disabled: false,
      tone: "primary",
    })),
  };
}

/** 把城市 ID 编码为侦察任务的稳定选项 ID。 */
function reconMissionOptionId(cityId: string): string {
  return `${RECON_MISSION_PREFIX}${cityId}`;
}

/** 把分避难所 ID 编码为详情页的稳定选项 ID。 */
function outpostDetailOptionId(outpostId: string): string {
  return `${OUTPOST_DETAIL_PREFIX}${outpostId}`;
}

/** 把角色 ID 编码为召回命令的稳定选项 ID。 */
function recallOptionId(companionId: string): string {
  return `${OUTPOST_RECALL_PREFIX}${companionId}`;
}
