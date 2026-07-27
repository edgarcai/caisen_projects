import type {
  ShelterAssignmentOption,
  ShelterLayoutConfig,
  ShelterLayoutView,
} from "../../domain/shelter-layout";
import type { DistrictExplorationLayerProjection } from "../../domain/district-exploration-tree";
import type {
  UiArchiveCollectionPageView,
  UiArchiveDocumentPageView,
  UiArchiveStoragePageView,
  UiEncounterBattleRuntimeView,
  UiEncounterCatalogPageView,
  UiEncounterPreparationRuntimeView,
  UiReturnIncidentPageView,
} from "../models/DemoSystemViewModels";

/**
 * UI 可以展示的稳定页面标识。
 */
export type GameScreenId =
  | "publisher_splash"
  | "menu"
  | "name_input"
  | "pre_game_notice"
  | "save_slots"
  | "update_log"
  | "connection"
  | "dashboard"
  | "story"
  | "exploration_city"
  | "exploration_event"
  | "battle"
  | "management_categories"
  | "management_options"
  | "management_option_detail"
  | "companions"
  | "companion_detail"
  | "companion_equipment"
  | "companion_interaction"
  | "shelter_map"
  | "shelter_room_planning"
  | "archive_storage"
  | "archive_collection"
  | "archive_document"
  | "encounter_catalog"
  | "encounter_preparation"
  | "encounter_battle"
  | "return_incident"
  | "supplies"
  | "tutorial"
  | "message"
  | "ending"
  | "return_menu_confirm"
  | "function_menu"
  | "settings"
  | "cover_theme_selector"
  | "warehouse"
  | "transport_management"
  | "research"
  | "crafting"
  | "expedition_city_list"
  | "expedition_city_detail"
  | "expedition_district_list"
  | "expedition_district_detail"
  | "district_exploration_tree"
  | "expedition_prepare"
  | "expedition_status"
  | "expedition_failure"
  | "settlement_network"
  | "settlement_recon_city"
  | "settlement_recon_companion"
  | "outpost_build_city"
  | "outpost_build_district"
  | "outpost_build_type"
  | "outpost_detail"
  | "outpost_assign"
  | "communication_log"
  | "history"
  | "rollback_confirm"
  | "exit_confirm"
  | "credits"
  | "account_login"
  | "store"
  | "text_records";

/**
 * 游戏支持的启动模式。
 */
export type GameMode = "single" | "multiplayer" | "story" | "endless";

/** 存档栏位页当前执行的稳定读写语义。 */
export type SaveSlotsPageMode = "load" | "save";

/**
 * 当前快照对剧情功能的访问级别。
 */
export type UiStoryAccess = "hidden" | "mode" | "legacy_resume";

/**
 * 通用提示的语义颜色，不携带具体视觉值。
 */
export type UiTone =
  | "default"
  | "muted"
  | "primary"
  | "success"
  | "warning"
  | "danger";

/**
 * 允许端口同步或异步返回结果，避免 UI 绑定具体基础设施。
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * 页面上的可选择项目。
 */
export interface UiOptionView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
  /** 保留锁定灰态但不禁止点击，用于先查看需求再解锁的入口。 */
  readonly lockedAppearance?: boolean;
  readonly disabledReason?: string;
  readonly tone?: UiTone;
}

/**
 * 指挥台上的一组行动。
 */
export interface UiActionGroupView {
  readonly id: string;
  readonly label: string;
  readonly actions: readonly UiOptionView[];
}

/**
 * 用于风险条展示的只读数值。
 */
export interface UiMeterView {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly maximum: number;
  readonly risk: "normal" | "warning" | "danger";
}

/**
 * 一项资源或避难所统计。
 */
export interface UiStatView {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly emphasized?: boolean;
}

/**
 * 当前行动所长的摘要。
 */
export interface UiPlayerView {
  readonly id: string;
  readonly name: string;
  readonly roleLabel: string;
}

/** 开局配置中一个可选择项。 */
export interface UiCampaignOptionView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly incompatibleIds?: readonly string[];
}

/** 出生区划选项额外保留所属城市，供页面联动过滤。 */
export interface UiCampaignDistrictOptionView extends UiCampaignOptionView {
  readonly cityId: string;
}

/** 姓名之外独立保存的模式、难度、起源、特性与出生城市选择。 */
export interface UiCampaignProfileSelection {
  readonly difficultyId: string;
  readonly originId: string;
  readonly traitId: string;
  readonly secondaryTraitId: string;
  readonly homeCityId: string;
  readonly homeDistrictId: string;
  readonly shelterTypeId: string;
}

/** 新游戏页面可使用的全部配置化开局选项。 */
export interface UiCampaignProfileOptionsView {
  readonly difficulties: readonly UiCampaignOptionView[];
  readonly origins: readonly UiCampaignOptionView[];
  readonly traits: readonly UiCampaignOptionView[];
  readonly cities: readonly UiCampaignOptionView[];
  readonly districts: readonly UiCampaignDistrictOptionView[];
  readonly shelterTypes: readonly UiCampaignOptionView[];
  readonly defaultSelection: UiCampaignProfileSelection;
}

/** 局内抬头独立展示的完整开局档案。 */
export interface UiCampaignProfileView {
  readonly modeLabel: string;
  readonly difficultyLabel: string;
  readonly originLabel: string;
  readonly traitLabel: string;
  readonly secondaryTraitLabel: string;
  readonly homeCityLabel: string;
  readonly districtLabel: string;
  readonly shelterTypeLabel: string;
}

/** 六栏存档页中的一栏摘要。 */
export interface UiSaveSlotView {
  readonly slotId: number;
  readonly status: "empty" | "valid" | "recoverable" | "corrupted";
  readonly title: string;
  readonly details: string;
  readonly loadable: boolean;
  readonly writable: boolean;
}

/**
 * 封面展示的配置化作品名称。
 */
export interface UiBrandView {
  readonly title: string;
  readonly subtitle: string;
}

/**
 * 世界时钟的格式化展示值。
 */
export interface UiClockView {
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly turnLabel: string;
}

/**
 * 当前主线任务摘要。
 */
export interface UiMissionView {
  readonly chapterLabel: string;
  readonly title: string;
  readonly objective: string;
  readonly progressLabel: string;
}

/**
 * 剧情或探索选择页面的正文与选项。
 */
export interface UiPromptView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly options: readonly UiOptionView[];
}

/** 配置驱动详情页中的一行只读信息。 */
export interface UiDetailFieldView {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

/** 配置驱动详情页中的一项条件或风险提示。 */
export interface UiRequirementView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly status: "met" | "unmet" | "informational";
}

/** 城市内一个可配置、可独立选择的探索区划。 */
export interface UiCityDistrictView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly dangerLevel: number;
  readonly eventStepCost: number;
  readonly eventLabels: readonly string[];
  readonly fields: readonly UiDetailFieldView[];
  readonly requirements: readonly UiRequirementView[];
}

/**
 * 一座可探索城市。
 */
export interface UiCityView extends UiOptionView {
  readonly dangerLabel?: string;
  readonly districtLabel: string;
  readonly terrainLabel: string;
  readonly relationLabel: string;
  readonly travelStepCost: number;
  readonly defaultDistrictId: string;
  readonly districts: readonly UiCityDistrictView[];
  readonly fields: readonly UiDetailFieldView[];
  readonly requirements: readonly UiRequirementView[];
}

/** 城市侦察与分避难所共用的经济和时间规则投影。 */
export interface UiSettlementNetworkRulesView {
  readonly reconDurationDays: number;
  readonly maximumOutposts: number;
  readonly outpostCoinCost: number;
  readonly outpostPartCost: number;
  readonly supplyIntervalDays: number;
  readonly supplyFoodCost: number;
  readonly supplyPartCost: number;
  readonly supplyCoinCost: number;
  readonly supplyMedicalSupplyCost: number;
}

/** 一座城市对侦察和建立分避难所的实时可用性。 */
export interface UiSettlementCityView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly districts: readonly UiCityDistrictView[];
  readonly unlocked: boolean;
  readonly canStartRecon: boolean;
  readonly intelligenceCurrent: number;
  readonly intelligenceRequired: number;
  readonly transportNames: string;
  readonly transportStatusLabel: string;
  readonly statusLabel: string;
  readonly disabledReason?: string;
}

/** 一项进行中或已可结算的跨城侦察任务。 */
export interface UiCityReconMissionView {
  readonly cityId: string;
  readonly cityName: string;
  readonly companionId: string;
  readonly companionName: string;
  readonly startedDay: number;
  readonly completionDay: number;
  readonly daysRemaining: number;
  readonly ready: boolean;
}

/** 可用于建立分避难所的配置化类型。 */
export interface UiOutpostShelterTypeView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly bonuses: readonly string[];
  readonly startingCapacity: number;
}

/** 已建立分避难所的位置、驻守人员和周物流状态。 */
export interface UiOutpostView {
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
  readonly operations: {
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
  };
}

/**
 * 当前首领战的只读展示模型。
 */
export interface UiBattleView {
  readonly bossId: string;
  readonly bossName: string;
  readonly phaseLabel: string;
  readonly health: number;
  readonly maximumHealth: number;
  readonly body: string;
  readonly actions: readonly UiOptionView[];
}

/**
 * 一项经营类别及其可执行项目。
 */
export interface UiManagementOptionView extends UiOptionView {
  readonly fields: readonly UiDetailFieldView[];
  readonly requirements: readonly UiRequirementView[];
  /** 仅工作类项目提供的配置化循环次数；其他项目保持空数组。 */
  readonly repetitionOptions: readonly number[];
}

/** 一项经营类别及其全部结构化项目。 */
export interface UiManagementCategoryView extends UiOptionView {
  readonly options: readonly UiManagementOptionView[];
}

/**
 * 角色档案的展示模型。
 */
export interface UiCompanionView {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly portraitKey: string;
  readonly portraitAssetPath: string;
  readonly statusLabel: string;
  readonly trustLabel: string;
  readonly introduction: string;
  readonly biography: string;
  readonly secret: string;
  readonly secretUnlocked: boolean;
  readonly canManage: boolean;
  readonly interactionCooldownTurns: number;
  readonly interactionCount: number;
  readonly equippedWeapon: UiCompanionEquippedItemView | null;
  readonly equippedArmor: UiCompanionEquippedItemView | null;
  readonly weaponOptions: readonly UiCompanionEquipmentOptionView[];
  readonly armorOptions: readonly UiCompanionEquipmentOptionView[];
  readonly interactionOptions: readonly UiCompanionInteractionOptionView[];
  readonly tone?: UiTone;
}

/** 伙伴可装备栏位的稳定语义。 */
export type UiCompanionEquipmentSlot = "weapon" | "armor";

/** 伙伴当前已穿戴的一件装备。 */
export interface UiCompanionEquippedItemView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** 伙伴配装页中来自实时仓库的一个候选项。 */
export interface UiCompanionEquipmentOptionView {
  readonly id: string;
  readonly name: string;
  readonly slot: UiCompanionEquipmentSlot;
  readonly description: string;
  readonly availableQuantity: number;
  readonly ownedQuantity: number;
  readonly equipped: boolean;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

/** 伙伴互动页中的一个可执行选项。 */
export interface UiCompanionInteractionOptionView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly tone?: UiTone;
}

/**
 * 仓库中一项可展示、可装备或可携带的实时库存。
 */
export interface UiWarehouseItemView {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly categoryLabel: string;
  readonly quantity: number;
  readonly carryable: boolean;
  readonly equippable: boolean;
  readonly equipped: boolean;
  readonly description: string;
}

/** 载具设置页中的一辆可驾驶载具。 */
export interface UiTransportLoadoutOptionView {
  readonly id: string;
  readonly name: string;
  readonly modeLabel: string;
  readonly description: string;
  readonly ownedQuantity: number;
  readonly equipped: boolean;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

/**
 * 一项研发计划的前置、成本与远征收益投影。
 */
export interface UiResearchProjectView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly completed: boolean;
  readonly available: boolean;
  readonly costDescription: string;
  readonly expeditionStepBonus: number;
  readonly requiredItemId: string;
  readonly requiredItemName: string;
  readonly sourceDescription: string;
  readonly slotted: boolean;
}

/**
 * 一项制作配方的解锁、成本与产物投影。
 */
export interface UiCraftingRecipeView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly available: boolean;
  readonly unlocked: boolean;
  readonly costDescription: string;
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly blueprintSourceDescription: string;
}

/** 研究台中一件可放入单槽的仓库样本。 */
export interface UiResearchWorkbenchCandidateView {
  readonly id: string;
  readonly name: string;
  readonly ownedQuantity: number;
  readonly sourceDescription: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly researchCompleted: boolean;
  readonly available: boolean;
}

/** 单槽研究台的实时展示状态。 */
export interface UiResearchWorkbenchView {
  readonly slotCount: number;
  readonly slottedItemId: string | null;
  readonly slottedItemName: string | null;
  readonly candidates: readonly UiResearchWorkbenchCandidateView[];
}

/** 避难所内墙、外墙及兼容总耐久的实时展示状态。 */
export interface UiShelterWallView {
  readonly innerHealth: number;
  readonly innerMaximum: number;
  readonly outerHealth: number;
  readonly outerMaximum: number;
  readonly totalHealth: number;
  readonly totalMaximum: number;
}

/**
 * 远征准备页中的同行伙伴选项。
 */
export interface UiExpeditionCompanionView {
  readonly id: string;
  readonly name: string;
  readonly traitName: string;
  readonly trust: number;
  readonly stepBonus: number;
}

/**
 * 远征准备页中的可携带物资选项。
 */
export interface UiExpeditionCarryItemView {
  readonly id: string;
  readonly name: string;
  readonly availableQuantity: number;
  readonly stepBonusPerUnit: number;
}

/**
 * 一次正在进行的远征摘要。
 */
export interface UiExpeditionStatusView {
  readonly cityId: string;
  readonly cityName: string;
  readonly districtId: string;
  readonly districtName: string;
  readonly travelStepCost: number;
  readonly remainingSteps: number;
  readonly maximumSteps: number;
  readonly eventsResolved: number;
  readonly companionIds: readonly string[];
  readonly carriedItems: Readonly<Record<string, number>>;
  readonly loot: Readonly<Record<string, number>>;
  readonly itemNames: Readonly<Record<string, string>>;
  readonly eventStepCost: number;
}

/** 强制返程时一项携带物或战利品的结算明细。 */
export interface UiExpeditionLossItemView {
  readonly id: string;
  readonly name: string;
  readonly source: "carried" | "loot";
  readonly before: number;
  readonly kept: number;
  readonly lost: number;
}

/** 步数不足导致强制返程的完整、只读结算。 */
export interface UiExpeditionFailureView {
  readonly reason: string;
  readonly keptPercent: number;
  readonly healthBefore: number;
  readonly healthAfter: number;
  readonly totalBefore: number;
  readonly totalKept: number;
  readonly totalLost: number;
  readonly items: readonly UiExpeditionLossItemView[];
}

/**
 * 周档案中的一条不可变通讯记录。
 */
export interface UiHistoryEntryView {
  readonly survivalDay: number;
  readonly turnNumber: number;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly message: string;
}

/**
 * 每七个生存日生成的一份历史档案。
 */
export interface UiWeeklyArchiveView {
  readonly weekNumber: number;
  readonly startDateLabel: string;
  readonly endDateLabel: string;
  readonly summary: string;
  readonly entries: readonly UiHistoryEntryView[];
}

/**
 * 教程、消息和结局等长文本页面。
 */
export interface UiDocumentView {
  readonly title: string;
  readonly body: string;
  readonly tone?: UiTone;
}

/**
 * 一条不会直接修改领域状态的 UI 提示。
 */
export interface UiNoticeView {
  readonly title?: string;
  readonly message: string;
  readonly tone: UiTone;
}

/**
 * UI 每次渲染所需的完整只读快照。
 */
export interface GameUiSnapshot {
  readonly revision: number;
  readonly brand: UiBrandView;
  readonly unlockedAchievementIds: readonly string[];
  readonly playerCounts: Readonly<Record<GameMode, number>>;
  readonly campaignProfileOptions: UiCampaignProfileOptionsView;
  readonly campaignProfile: UiCampaignProfileView | null;
  readonly saveSlots: readonly UiSaveSlotView[];
  readonly mode: GameMode | null;
  readonly storyAccess: UiStoryAccess;
  readonly ended: boolean;
  readonly canRollback: boolean;
  readonly activePlayer: UiPlayerView | null;
  readonly players: readonly UiPlayerView[];
  readonly clock: UiClockView | null;
  readonly meters: readonly UiMeterView[];
  readonly resources: readonly UiStatView[];
  readonly shelterStats: readonly UiStatView[];
  readonly shelterWalls: UiShelterWallView | null;
  readonly mission: UiMissionView | null;
  readonly logs: readonly string[];
  readonly actionGroups: readonly UiActionGroupView[];
  readonly storyPrompt: UiPromptView | null;
  readonly cities: readonly UiCityView[];
  readonly explorationPrompt: UiPromptView | null;
  readonly battle: UiBattleView | null;
  readonly managementCategories: readonly UiManagementCategoryView[];
  readonly companions: readonly UiCompanionView[];
  readonly shelterLayoutConfig: ShelterLayoutConfig;
  readonly shelterLayout: ShelterLayoutView | null;
  readonly shelterRoomAssignmentOptions: Readonly<
    Record<string, readonly ShelterAssignmentOption[]>
  >;
  readonly archiveStorage: UiArchiveStoragePageView | null;
  readonly archiveCollections: Readonly<Record<string, UiArchiveCollectionPageView>>;
  readonly archiveDocuments: Readonly<Record<string, UiArchiveDocumentPageView>>;
  readonly encounterCatalog: UiEncounterCatalogPageView | null;
  readonly encounterPreparations: Readonly<
    Record<string, UiEncounterPreparationRuntimeView>
  >;
  readonly encounterBattle: UiEncounterBattleRuntimeView | null;
  readonly returnIncident: UiReturnIncidentPageView | null;
  readonly warehouseItems: readonly UiWarehouseItemView[];
  readonly transportLoadoutOptions: readonly UiTransportLoadoutOptionView[];
  readonly researchWorkbench: UiResearchWorkbenchView | null;
  readonly researchProjects: readonly UiResearchProjectView[];
  readonly craftingRecipes: readonly UiCraftingRecipeView[];
  readonly expeditionCompanions: readonly UiExpeditionCompanionView[];
  readonly expeditionCarryItems: readonly UiExpeditionCarryItemView[];
  readonly expeditionStatus: UiExpeditionStatusView | null;
  readonly expeditionFailure: UiExpeditionFailureView | null;
  readonly settlementNetworkRules: UiSettlementNetworkRulesView;
  readonly settlementCities: readonly UiSettlementCityView[];
  readonly cityReconMissions: readonly UiCityReconMissionView[];
  readonly outpostShelterTypes: readonly UiOutpostShelterTypeView[];
  readonly outposts: readonly UiOutpostView[];
  readonly settlementAvailableCompanions: readonly UiExpeditionCompanionView[];
  readonly weeklyArchives: readonly UiWeeklyArchiveView[];
  readonly tutorial: UiDocumentView | null;
  readonly ending: UiDocumentView | null;
  readonly notice: UiNoticeView | null;
}

/**
 * UI 可提交给应用层的全部命令。
 */
export type GameUiCommand =
  | {
      readonly type: "start_game";
      readonly mode: GameMode;
      readonly playerNames: readonly string[];
      readonly saveSlotId?: number;
      readonly profile?: UiCampaignProfileSelection;
    }
  | { readonly type: "load_game"; readonly slotId?: number }
  | { readonly type: "save_game"; readonly slotId?: number }
  | { readonly type: "rollback_checkpoint" }
  | { readonly type: "research_slot"; readonly itemId: string }
  | { readonly type: "research_clear" }
  | { readonly type: "research_complete"; readonly projectId: string }
  | { readonly type: "craft_item"; readonly recipeId: string }
  | { readonly type: "equip_item"; readonly itemId: string }
  | { readonly type: "transport_toggle"; readonly itemId: string }
  | {
      readonly type: "expedition_begin";
      readonly cityId: string;
      readonly districtId: string;
      readonly companionIds: readonly string[];
      readonly carriedItems: Readonly<Record<string, number>>;
    }
  | { readonly type: "expedition_continue" }
  | { readonly type: "expedition_safe_return" }
  | {
      readonly type: "city_recon_start";
      readonly cityId: string;
      readonly companionId: string;
    }
  | { readonly type: "city_recon_complete"; readonly cityId: string }
  | {
      readonly type: "outpost_establish";
      readonly cityId: string;
      readonly districtId: string;
      readonly shelterTypeId: string;
    }
  | {
      readonly type: "outpost_assign";
      readonly outpostId: string;
      readonly companionId: string;
    }
  | { readonly type: "outpost_recall"; readonly companionId: string }
  | { readonly type: "outpost_supply"; readonly outpostId: string }
  | {
      readonly type: "companion_equip";
      readonly companionId: string;
      readonly slot: UiCompanionEquipmentSlot;
      readonly itemId: string | null;
    }
  | {
      readonly type: "companion_interact";
      readonly companionId: string;
      readonly interactionId: string;
    }
  | {
      readonly type: "shelter_room_assignment_change";
      readonly residentId: string;
      readonly targetRoomId: string | null;
    }
  | {
      readonly type: "encounter_start";
      readonly encounterId: string;
      readonly roleIdsByMember: Readonly<Record<string, string>>;
      readonly treatedMemberIds: readonly string[];
    }
  | {
      readonly type: "encounter_action";
      readonly action: "attack" | "guard" | "skill" | "item" | "retreat";
      readonly actorId: string;
      readonly abilityId?: string;
      readonly targetId?: string;
    }
  | { readonly type: "encounter_finish" }
  | { readonly type: "return_incident_choose"; readonly choiceId: string }
  | { readonly type: "story_choice"; readonly choiceId: string }
  | { readonly type: "exploration_prepare"; readonly cityId: string }
  | { readonly type: "exploration_resolve"; readonly choiceId: string }
  | { readonly type: "exploration_retreat" }
  | { readonly type: "combat_action"; readonly actionId: string }
  | {
      readonly type: "management_action";
      readonly categoryId: string;
      readonly optionId: string;
      readonly repetitions?: number;
    }
  | { readonly type: "supply_action"; readonly actionId: string }
  | { readonly type: "return_to_menu" };

/**
 * 应用层可以要求页面栈执行的导航动作。
 */
export interface UiNavigationDirective {
  readonly operation: "stay" | "push" | "replace" | "pop" | "reset";
  readonly screen?: GameScreenId;
}

/**
 * 一次应用命令的原子返回结果。
 */
export interface GameUiCommandResult {
  readonly accepted: boolean;
  readonly snapshot?: GameUiSnapshot;
  readonly navigation?: UiNavigationDirective;
  readonly notice?: UiNoticeView;
}

/**
 * 领域和基础设施向 LayaAir UI 暴露的最小依赖倒置端口。
 */
export interface GameUiPort {
  /**
   * 获取当前游戏的不可变展示快照。
   */
  getSnapshot(): MaybePromise<GameUiSnapshot>;

  /**
   * 订阅领域快照变化，并返回取消订阅函数。
   */
  subscribe(listener: (snapshot: GameUiSnapshot) => void): () => void;

  /**
   * 把用户意图作为命令交给应用层原子执行。
   */
  execute(command: GameUiCommand): MaybePromise<GameUiCommandResult>;

  /**
   * 查询当前浏览器是否存在可读取的存档。
   */
  canLoadGame(slotId?: number): MaybePromise<boolean>;

  /** 按需读取一个区划当前层的稳定选项，不递归生成整棵树。 */
  getDistrictExplorationLayer(
    cityId: string,
    districtId: string,
    parentPath: readonly number[],
  ): DistrictExplorationLayerProjection;
}
