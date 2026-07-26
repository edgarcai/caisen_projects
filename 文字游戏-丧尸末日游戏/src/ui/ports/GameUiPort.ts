/**
 * UI 可以展示的稳定页面标识。
 */
export type GameScreenId =
  | "menu"
  | "name_input"
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
  | "companions"
  | "supplies"
  | "tutorial"
  | "message"
  | "ending"
  | "return_menu_confirm"
  | "function_menu"
  | "settings"
  | "warehouse"
  | "research"
  | "crafting"
  | "expedition_prepare"
  | "expedition_status"
  | "history"
  | "rollback_confirm"
  | "exit_confirm"
  | "credits";

/**
 * 游戏支持的启动模式。
 */
export type GameMode = "single" | "multiplayer" | "story";

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
}

/** 姓名之外独立保存的模式、难度、起源、特性与出生城市选择。 */
export interface UiCampaignProfileSelection {
  readonly difficultyId: string;
  readonly originId: string;
  readonly traitId: string;
  readonly homeCityId: string;
}

/** 新游戏页面可使用的全部配置化开局选项。 */
export interface UiCampaignProfileOptionsView {
  readonly difficulties: readonly UiCampaignOptionView[];
  readonly origins: readonly UiCampaignOptionView[];
  readonly traits: readonly UiCampaignOptionView[];
  readonly cities: readonly UiCampaignOptionView[];
  readonly defaultSelection: UiCampaignProfileSelection;
}

/** 局内抬头独立展示的完整开局档案。 */
export interface UiCampaignProfileView {
  readonly modeLabel: string;
  readonly difficultyLabel: string;
  readonly originLabel: string;
  readonly traitLabel: string;
  readonly homeCityLabel: string;
  readonly districtLabel: string;
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

/**
 * 一座可探索城市。
 */
export interface UiCityView extends UiOptionView {
  readonly dangerLabel?: string;
  readonly districtLabel: string;
  readonly terrainLabel: string;
  readonly relationLabel: string;
  readonly travelStepCost: number;
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
export interface UiManagementCategoryView extends UiOptionView {
  readonly options: readonly UiOptionView[];
}

/**
 * 伙伴档案的展示模型。
 */
export interface UiCompanionView {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly statusLabel: string;
  readonly trustLabel: string;
  readonly biography: string;
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
  readonly travelStepCost: number;
  readonly remainingSteps: number;
  readonly maximumSteps: number;
  readonly eventsResolved: number;
  readonly companionIds: readonly string[];
  readonly carriedItems: Readonly<Record<string, number>>;
  readonly loot: Readonly<Record<string, number>>;
  readonly itemNames: Readonly<Record<string, string>>;
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
  readonly mission: UiMissionView | null;
  readonly logs: readonly string[];
  readonly actionGroups: readonly UiActionGroupView[];
  readonly storyPrompt: UiPromptView | null;
  readonly cities: readonly UiCityView[];
  readonly explorationPrompt: UiPromptView | null;
  readonly battle: UiBattleView | null;
  readonly managementCategories: readonly UiManagementCategoryView[];
  readonly companions: readonly UiCompanionView[];
  readonly warehouseItems: readonly UiWarehouseItemView[];
  readonly researchProjects: readonly UiResearchProjectView[];
  readonly craftingRecipes: readonly UiCraftingRecipeView[];
  readonly expeditionCompanions: readonly UiExpeditionCompanionView[];
  readonly expeditionCarryItems: readonly UiExpeditionCarryItemView[];
  readonly expeditionStatus: UiExpeditionStatusView | null;
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
  | { readonly type: "research_complete"; readonly projectId: string }
  | { readonly type: "craft_item"; readonly recipeId: string }
  | { readonly type: "equip_item"; readonly itemId: string }
  | {
      readonly type: "expedition_begin";
      readonly cityId: string;
      readonly companionIds: readonly string[];
      readonly carriedItems: Readonly<Record<string, number>>;
    }
  | { readonly type: "expedition_continue" }
  | { readonly type: "expedition_safe_return" }
  | { readonly type: "story_choice"; readonly choiceId: string }
  | { readonly type: "exploration_prepare"; readonly cityId: string }
  | { readonly type: "exploration_resolve"; readonly choiceId: string }
  | { readonly type: "exploration_retreat" }
  | { readonly type: "combat_action"; readonly actionId: string }
  | {
      readonly type: "management_action";
      readonly categoryId: string;
      readonly optionId: string;
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
}
