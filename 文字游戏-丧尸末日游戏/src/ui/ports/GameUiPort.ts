/**
 * UI 可以展示的稳定页面标识。
 */
export type GameScreenId =
  | "menu"
  | "name_input"
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
  | "return_menu_confirm";

/**
 * 游戏支持的启动模式。
 */
export type GameMode = "single" | "multiplayer";

/**
 * 通用提示的语义颜色，不携带具体视觉值。
 */
export type UiTone = "default" | "primary" | "success" | "warning" | "danger";

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
  readonly mode: GameMode | null;
  readonly ended: boolean;
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
    }
  | { readonly type: "load_game" }
  | { readonly type: "save_game" }
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
  canLoadGame(): MaybePromise<boolean>;
}
