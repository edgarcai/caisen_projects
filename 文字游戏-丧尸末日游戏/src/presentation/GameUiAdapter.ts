import type { GameApplication } from "../application";
import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import { activePlayer, isEnded, isVictory } from "../domain/game-state";
import type {
  CompanionState,
  GameMode,
  GameState,
  PlayerState,
  ShelterState,
} from "../domain/game-state";
import type { ActionReport, ManagementOption } from "../domain/reports";
import type { WebGameConfig } from "../config/types";
import type {
  GameUiCommand,
  GameUiCommandResult,
  GameUiPort,
  GameUiSnapshot,
  UiActionGroupView,
  UiBattleView,
  UiCityView,
  UiCompanionView,
  UiManagementCategoryView,
  UiMeterView,
  UiNoticeView,
  UiOptionView,
  UiPromptView,
  UiStatView,
  UiTone,
  UiPlayerView,
} from "../ui/ports/GameUiPort";

interface GameActionPresentation {
  readonly id: string;
  readonly label: string;
  readonly style: string;
  readonly icon: string;
}

interface DashboardMeterPresentation {
  readonly scope: "player" | "shelter";
  readonly field: string;
  readonly label: string;
  readonly maximum_path: string;
  readonly direction: "lower_is_worse" | "higher_is_worse";
  readonly thresholds: { readonly warning: number; readonly danger: number };
}

interface H5Presentation {
  readonly log_limit: number;
  readonly date_format: string;
  readonly time_format: string;
  readonly turn_format: string;
  readonly story_body_format: string;
  readonly story_title_format: string;
  readonly exploration_log_format: string;
  readonly companion_biography_format: string;
  readonly trust_format: string;
  readonly locked_secret_trust: number;
  readonly locked_secret_text: string;
  readonly battle_default_phase: string;
  readonly message_separator: string;
  readonly companion_status_labels: Readonly<Record<string, string>>;
}

interface GamePresentationConfig {
  readonly interface: {
    readonly cover: { readonly title: string; readonly subtitle: string };
    readonly pages: {
      readonly management_categories: readonly {
        readonly id: string;
        readonly label: string;
      }[];
    };
    readonly dashboard: {
      readonly log_hint: string;
      readonly meters: readonly DashboardMeterPresentation[];
    };
    readonly h5: H5Presentation;
  };
  readonly dialogs: Readonly<Record<string, string>>;
  readonly mode_labels: Readonly<Record<GameMode, string>>;
  readonly labels: {
    readonly player_stats: readonly (readonly [string, string])[];
    readonly shelter_stats: readonly (readonly [string, string])[];
  };
  readonly actions: readonly GameActionPresentation[];
}

const CONTINUE_OPTION_ID = "__continue__";
const MANAGEMENT_OPTION_SEPARATOR = "::";

/**
 * 把完整领域应用转换为 LayaAir 所需的只读展示快照与命令端口。
 */
export class GameUiAdapter implements GameUiPort {
  private readonly application: GameApplication;
  private readonly webConfig: WebGameConfig;
  private readonly presentation: GamePresentationConfig;
  private readonly listeners = new Set<(snapshot: GameUiSnapshot) => void>();
  private revision = 0;
  private logs: string[];
  private notice: UiNoticeView | null = null;

  /** 保存应用服务与配置化展示内容，不复制任何领域状态。 */
  public constructor(application: GameApplication, webConfig: WebGameConfig) {
    this.application = application;
    this.webConfig = webConfig;
    this.presentation = application.content.game as unknown as GamePresentationConfig;
    this.logs = [application.content.text("welcome_log")];
  }

  /** 构建当前游戏状态对应的完整不可变快照。 */
  public getSnapshot(): GameUiSnapshot {
    const state = this.application.state;
    const storyStatus = state === null ? null : this.application.storyStatus();
    return {
      revision: this.revision,
      brand: {
        title: this.presentation.interface.cover.title,
        subtitle: this.presentation.interface.cover.subtitle,
      },
      playerCounts: this.playerCounts(),
      mode: state?.mode ?? null,
      ended: state === null ? false : isEnded(state),
      activePlayer: state === null ? null : this.playerView(state, state.active_player_index),
      players: state === null
        ? []
        : state.players.map((_player, index) => this.playerView(state, index)),
      clock: state === null ? null : this.clockView(state),
      meters: state === null ? [] : this.meterViews(state),
      resources: state === null ? [] : this.resourceViews(activePlayer(state)),
      shelterStats: state === null ? [] : this.shelterStatViews(state.shelter),
      mission: storyStatus === null
        ? null
        : {
            chapterLabel: storyStatus.chapterTitle,
            title: storyStatus.missionTitle,
            objective: storyStatus.objective,
            progressLabel: storyStatus.progressText,
          },
      logs: [...this.logs],
      actionGroups: state === null ? [] : this.actionGroupViews(state),
      storyPrompt: state === null ? null : this.storyPromptView(),
      cities: state === null ? [] : this.cityViews(state),
      explorationPrompt: state === null ? null : this.explorationPromptView(state),
      battle: state === null ? null : this.battleView(state),
      managementCategories: state === null ? [] : this.managementCategoryViews(state),
      companions: state === null ? [] : this.companionViews(state),
      tutorial: {
        title: this.actionLabel("tutorial"),
        body: this.application.content.game.game.tutorial,
        tone: "primary",
      },
      ending: state?.ending === null || state?.ending === undefined
        ? null
        : {
            title: this.endingTitle(state),
            body: state.ending.message,
            tone: isVictory(state) ? "success" : "danger",
          },
      notice: this.notice,
    };
  }

  /** 订阅快照变更，并返回幂等的取消订阅函数。 */
  public subscribe(listener: (snapshot: GameUiSnapshot) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** 把 UI 意图路由为应用用例，并统一处理日志、自动存档与错误。 */
  public execute(command: GameUiCommand): GameUiCommandResult {
    try {
      const execution = this.executeCommand(command);
      if (execution.report !== null) {
        this.appendMessages(execution.report.messages);
        this.notice = this.noticeFromReport(command, execution.report);
        if (execution.report.stateChanged) {
          this.autoSave();
        }
      } else {
        this.notice = null;
      }
      this.revision += 1;
      const snapshot = this.getSnapshot();
      this.emit(snapshot);
      return {
        accepted: execution.accepted,
        snapshot,
        notice: this.notice ?? undefined,
      };
    } catch (error: unknown) {
      this.notice = {
        title: this.dialog("error_title"),
        message: error instanceof Error ? error.message : String(error),
        tone: "danger",
      };
      this.appendMessages([this.notice.message]);
      this.revision += 1;
      const snapshot = this.getSnapshot();
      this.emit(snapshot);
      return { accepted: false, snapshot, notice: this.notice };
    }
  }

  /** 查询主档或备份是否存在。 */
  public canLoadGame(): boolean {
    return this.application.hasSave();
  }

  /** 执行一个已经过判别联合约束的命令。 */
  private executeCommand(
    command: GameUiCommand,
  ): { readonly accepted: boolean; readonly report: ActionReport | null } {
    switch (command.type) {
      case "start_game": {
        const report = this.application.startNewGame(command.playerNames, command.mode);
        return { accepted: true, report };
      }
      case "load_game": {
        if (!this.application.hasSave()) {
          throw new GameApplicationError(this.application.content.text("no_save"));
        }
        return { accepted: true, report: this.application.loadGame() };
      }
      case "save_game":
        return { accepted: true, report: this.application.saveGame() };
      case "story_choice": {
        const prompt = this.application.currentStoryPrompt();
        if (prompt === null) {
          throw new GameApplicationError(this.application.content.text("story_complete"));
        }
        const report = this.application.resolveStoryChoice(prompt.sceneId, command.choiceId);
        return { accepted: report.stateChanged, report };
      }
      case "exploration_prepare": {
        const prompt = this.application.prepareExploration(command.cityId);
        this.appendMessages([
          formatTemplate(this.presentation.interface.h5.exploration_log_format, {
            title: prompt.title,
            intro: prompt.intro,
          }),
        ]);
        this.autoSave();
        return { accepted: true, report: null };
      }
      case "exploration_resolve": {
        const pending = this.requireState().pending_exploration;
        if (pending === null) {
          throw new GameApplicationError(this.application.content.text("no_pending_event"));
        }
        const choiceId = command.choiceId === CONTINUE_OPTION_ID
          ? null
          : command.choiceId;
        const report = this.application.resolveExploration(pending.event_id, choiceId);
        return { accepted: report.stateChanged, report };
      }
      case "exploration_retreat": {
        const report = this.application.cancelExploration();
        return { accepted: report.stateChanged, report };
      }
      case "combat_action": {
        const report = this.application.performCombatAction(command.actionId);
        return { accepted: report.stateChanged, report };
      }
      case "management_action": {
        const option = this.resolveManagementOption(command.categoryId, command.optionId);
        const report = this.application.performManagement(option.category, option.optionId);
        return { accepted: report.stateChanged, report };
      }
      case "supply_action": {
        const report = this.application.performAction(command.actionId);
        return { accepted: report.stateChanged, report };
      }
      case "return_to_menu":
        return { accepted: true, report: null };
    }
  }

  /** 在自动存档开启时保存状态；失败只降级提示，不回滚已完成行动。 */
  private autoSave(): void {
    if (!this.webConfig.storage.auto_save || this.application.state === null) {
      return;
    }
    try {
      this.application.saveGame();
    } catch {
      this.appendMessages([this.webConfig.texts.storage_unavailable]);
    }
  }

  /** 依据领域报告生成独立消息页需要的语义提示。 */
  private noticeFromReport(
    command: GameUiCommand,
    report: ActionReport,
  ): UiNoticeView | null {
    if (report.messages.length === 0) {
      return null;
    }
    const title = command.type === "save_game"
      ? this.dialog("save_title")
      : command.type === "load_game"
        ? this.dialog("load_title")
        : this.dialog("info_title");
    const state = this.application.state;
    const tone: UiTone = report.gameOver
      ? state !== null && isVictory(state) ? "success" : "danger"
      : report.stateChanged ? "success" : "warning";
    return {
      title,
      message: report.messages.join(this.presentation.interface.h5.message_separator),
      tone,
    };
  }

  /** 返回由主配置定义的单人和多人输入框数量。 */
  private playerCounts(): Readonly<Record<GameMode, number>> {
    const rules = this.application.content.game.rules.player_counts;
    const single = rules.single?.maximum;
    const multiplayer = rules.multiplayer?.maximum;
    if (single === undefined || multiplayer === undefined) {
      throw new Error("游戏模式缺少玩家数量配置。");
    }
    return { single, multiplayer };
  }

  /** 把一名所长转换为标题栏展示模型。 */
  private playerView(state: GameState, index: number): UiPlayerView {
    const player = state.players[index];
    if (player === undefined) {
      throw new Error(`所长索引越界：${String(index)}`);
    }
    return {
      id: `player-${String(index)}`,
      name: player.name,
      roleLabel: this.presentation.mode_labels[state.mode],
    };
  }

  /** 使用配置模板格式化日期、时间和回合。 */
  private clockView(state: GameState): NonNullable<GameUiSnapshot["clock"]> {
    const h5 = this.presentation.interface.h5;
    return {
      dateLabel: formatTemplate(h5.date_format, {
        year: state.clock.year,
        month: state.clock.month,
        day: state.clock.day,
        hour: state.clock.hour,
      }),
      timeLabel: formatTemplate(h5.time_format, { hour: state.clock.hour }),
      turnLabel: formatTemplate(h5.turn_format, { turn: state.turn_number }),
    };
  }

  /** 按配置化字段、方向和阈值生成四项风险条。 */
  private meterViews(state: GameState): UiMeterView[] {
    return this.presentation.interface.dashboard.meters.map((meter) => {
      const owner = meter.scope === "player" ? activePlayer(state) : state.shelter;
      const value = this.readNumericField(owner, meter.field);
      const maximum = this.resolveLimit(meter.maximum_path);
      const ratio = maximum <= 0 ? 0 : value / maximum;
      const risk = meter.direction === "lower_is_worse"
        ? ratio <= meter.thresholds.danger
          ? "danger"
          : ratio <= meter.thresholds.warning ? "warning" : "normal"
        : ratio >= meter.thresholds.danger
          ? "danger"
          : ratio >= meter.thresholds.warning ? "warning" : "normal";
      return {
        id: `${meter.scope}-${meter.field}`,
        label: meter.label,
        value,
        maximum,
        risk,
      };
    });
  }

  /** 把当前所长背包和属性转换为配置化统计行。 */
  private resourceViews(player: PlayerState): UiStatView[] {
    return this.presentation.labels.player_stats.map(([field, label]) => ({
      id: `player-${field}`,
      label,
      value: String(this.readNumericField(player, field)),
      emphasized: field === "food" || field === "medical_supplies" || field === "parts",
    }));
  }

  /** 把共享避难所状态转换为配置化统计行。 */
  private shelterStatViews(shelter: ShelterState): UiStatView[] {
    return this.presentation.labels.shelter_stats.map(([field, label]) => ({
      id: `shelter-${field}`,
      label,
      value: String(this.readNumericField(shelter, field)),
      emphasized: field === "population" || field === "activity",
    }));
  }

  /** 把当前剧情场景与锁定条件转换为选择页模型。 */
  private storyPromptView(): UiPromptView | null {
    const prompt = this.application.currentStoryPrompt();
    if (prompt === null) {
      return null;
    }
    return {
      id: prompt.sceneId,
      title: formatTemplate(this.presentation.interface.h5.story_title_format, {
        chapter: prompt.chapterTitle,
        title: prompt.title,
      }),
      body: formatTemplate(this.presentation.interface.h5.story_body_format, {
        body: prompt.body,
        objective: prompt.objective,
      }),
      options: prompt.choices.map((choice) => ({
        id: choice.choiceId,
        label: choice.label,
        description: "",
        disabled: !choice.available,
        disabledReason: choice.lockedReason || undefined,
        tone: choice.available ? "primary" : "default",
      })),
    };
  }

  /** 返回八座配置化城市；待事件存在时禁止免费重抽。 */
  private cityViews(state: GameState): UiCityView[] {
    const hasPending = state.pending_exploration !== null;
    return this.application.content.game.cities.map((city) => {
      const disabled = hasPending && state.pending_exploration?.city_id !== city.id;
      return {
        id: city.id,
        label: city.name,
        description: "",
        disabled,
        disabledReason: disabled
          ? this.application.content.text("pending_event_locked")
          : undefined,
        tone: "primary",
      };
    });
  }

  /** 从已持久化事件 ID 构建探索事件页，不触发新的随机抽取。 */
  private explorationPromptView(state: GameState): UiPromptView | null {
    const pending = state.pending_exploration;
    if (pending === null) {
      return null;
    }
    const event = this.application.content.event(pending.event_id);
    const choices = event.choices ?? [];
    return {
      id: event.id,
      title: event.title,
      body: event.intro,
      options: choices.length === 0
        ? [{
            id: CONTINUE_OPTION_ID,
            label: this.webConfig.texts.continue,
            description: "",
            disabled: false,
            tone: "primary",
          }]
        : choices.map((choice) => ({
            id: choice.id,
            label: choice.label,
            description: "",
            disabled: false,
            tone: "primary",
          })),
    };
  }

  /** 把进行中的首领战状态和行动转换为专用展示模型。 */
  private battleView(state: GameState): UiBattleView | null {
    const battle = state.battle;
    if (battle === null || battle.finished) {
      return null;
    }
    const boss = this.application.content.boss(battle.boss_id);
    const percent = (battle.health * 100) / battle.max_health;
    const phase = [...boss.phases]
      .sort((left, right) => right.health_threshold_percent - left.health_threshold_percent)
      .reduce<string | null>((selected, candidate) => (
        percent <= candidate.health_threshold_percent ? candidate.name : selected
      ), null);
    const player = activePlayer(state);
    return {
      bossId: battle.boss_id,
      bossName: battle.boss_name,
      phaseLabel: phase ?? this.presentation.interface.h5.battle_default_phase,
      health: battle.health,
      maximumHealth: battle.max_health,
      body: this.application.content.text("battle_page_body", {
        boss_name: battle.boss_name,
        round_number: battle.round_number,
        boss_health: battle.health,
        boss_max_health: battle.max_health,
        player_name: player.name,
        player_health: player.health,
      }),
      actions: this.application.combatActions().map((action) => ({
        id: action.actionId,
        label: action.label,
        description: action.description,
        disabled: !action.available,
        disabledReason: action.unavailableReason || undefined,
        tone: action.actionId === "retreat" ? "danger" : "primary",
      })),
    };
  }

  /** 按设施、工作、交易和招募四组构造经营页面。 */
  private managementCategoryViews(state: GameState): UiManagementCategoryView[] {
    if (
      isEnded(state)
      || (state.battle !== null && !state.battle.finished)
      || state.pending_exploration !== null
    ) {
      return [];
    }
    const options = this.application.managementOptions();
    return this.presentation.interface.pages.management_categories.map((category) => {
      const categoryOptions = options.filter((option) => this.outerCategory(option) === category.id);
      return {
        id: category.id,
        label: category.label,
        description: this.application.content.text("management_category_prompt"),
        disabled: categoryOptions.length === 0,
        tone: "primary",
        options: categoryOptions.map((option) => this.managementOptionView(option)),
      };
    });
  }

  /** 把伙伴状态、信任与档案转换为独立资料卡。 */
  private companionViews(state: GameState): UiCompanionView[] {
    return state.companions.map((companion) => {
      const profile = this.application.content.story.companions.find(
        (candidate) => candidate.companion_id === companion.companion_id,
      );
      if (profile === undefined) {
        throw new Error(`缺少伙伴展示配置：${companion.companion_id}`);
      }
      const secret = companion.trust >= this.presentation.interface.h5.locked_secret_trust
        ? profile.secret
        : this.presentation.interface.h5.locked_secret_text;
      return {
        id: companion.companion_id,
        name: profile.name,
        role: profile.role,
        statusLabel:
          this.presentation.interface.h5.companion_status_labels[companion.status]
          ?? companion.status,
        trustLabel: formatTemplate(this.presentation.interface.h5.trust_format, {
          trust: companion.trust,
        }),
        biography: formatTemplate(
          this.presentation.interface.h5.companion_biography_format,
          { introduction: profile.introduction, secret },
        ),
        tone: this.companionTone(companion),
      };
    });
  }

  /** 按 Web 行动分组装配指挥台按钮，并应用阻塞状态。 */
  private actionGroupViews(state: GameState): UiActionGroupView[] {
    const actions = new Map(this.presentation.actions.map((action) => [action.id, action]));
    return this.webConfig.action_groups.map((group) => ({
      id: group.id,
      label: group.label,
      actions: group.action_ids.map((actionId) => {
        const action = actions.get(actionId);
        if (action === undefined) {
          throw new Error(`行动分组引用未知行动：${actionId}`);
        }
        const blockedReason = this.actionBlockedReason(state, actionId);
        return {
          id: action.id,
          label: action.label,
          description: action.id === "return_menu"
            ? this.dialog("confirm_return_message")
            : "",
          disabled: blockedReason !== null,
          disabledReason: blockedReason ?? undefined,
          tone: this.actionTone(action.style),
        };
      }),
    }));
  }

  /** 返回行动当前的领域阻塞原因。 */
  private actionBlockedReason(state: GameState, actionId: string): string | null {
    const alwaysAllowed = new Set(["tutorial", "save", "return_menu", "companions"]);
    if (isEnded(state)) {
      return alwaysAllowed.has(actionId)
        ? null
        : this.application.content.text("game_already_over");
    }
    if (state.battle !== null && !state.battle.finished) {
      return actionId === "story" || alwaysAllowed.has(actionId)
        ? null
        : this.application.content.text("battle_in_progress");
    }
    if (state.pending_exploration !== null) {
      return actionId === "explore" || alwaysAllowed.has(actionId)
        ? null
        : this.application.content.text("pending_event_locked");
    }
    return null;
  }

  /** 将配置化经营选项转换为稳定且无冲突的 UI ID。 */
  private managementOptionView(option: ManagementOption): UiOptionView {
    return {
      id: this.managementOptionId(option),
      label: option.label,
      description: option.description,
      disabled: !option.available,
      disabledReason: option.available
        ? undefined
        : this.application.content.text("management_failed"),
      tone: option.available ? "primary" : "default",
    };
  }

  /** 校验 UI 经营项目仍与当前领域选项一致。 */
  private resolveManagementOption(categoryId: string, uiOptionId: string): ManagementOption {
    const option = this.application.managementOptions().find(
      (candidate) => this.managementOptionId(candidate) === uiOptionId,
    );
    if (option === undefined || this.outerCategory(option) !== categoryId) {
      throw new GameApplicationError(this.application.content.text("management_failed"));
    }
    return option;
  }

  /** 为买入和卖出同 ID 商品生成不冲突的选择 ID。 */
  private managementOptionId(option: ManagementOption): string {
    return `${option.category}${MANAGEMENT_OPTION_SEPARATOR}${option.optionId}`;
  }

  /** 将五类领域经营命令折叠为四个页面分类。 */
  private outerCategory(option: ManagementOption): string {
    return option.category === "trade_buy" || option.category === "trade_sell"
      ? "trade"
      : option.category;
  }

  /** 把主配置按钮风格映射为 UI 语义色。 */
  private actionTone(style: string): UiTone {
    if (style === "primary") return "primary";
    if (style === "danger") return "danger";
    return "default";
  }

  /** 根据伙伴状态返回资料卡语义色。 */
  private companionTone(companion: CompanionState): UiTone {
    if (companion.status === "active") return "success";
    if (companion.status === "dead" || companion.status === "lost") return "danger";
    return "default";
  }

  /** 读取一个由配置白名单引用的整数展示字段。 */
  private readNumericField(owner: object, field: string): number {
    const value = Reflect.get(owner, field) as unknown;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`展示字段不是数值：${field}`);
    }
    return value;
  }

  /** 解析风险条允许引用的 rules.limits 数值。 */
  private resolveLimit(path: string): number {
    const prefix = "rules.limits.";
    if (!path.startsWith(prefix)) {
      throw new Error(`风险条上限路径越界：${path}`);
    }
    const key = path.slice(prefix.length);
    const value = Reflect.get(this.application.content.game.rules.limits, key) as unknown;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`风险条上限不是数值：${path}`);
    }
    return value;
  }

  /** 返回配置中的对话标题或提示。 */
  private dialog(key: string): string {
    return this.presentation.dialogs[key] ?? "";
  }

  /** 返回主配置中的行动标签。 */
  private actionLabel(actionId: string): string {
    return this.presentation.actions.find((action) => action.id === actionId)?.label ?? "";
  }

  /** 返回故事胜利标题或配置化失败页标题。 */
  private endingTitle(state: GameState): string {
    if (!isVictory(state)) {
      return this.application.content.text("failure_page_title");
    }
    const endingId = state.ending?.ending_id;
    return this.application.content.story.endings.find(
      (ending) => ending.ending_id === endingId,
    )?.title ?? this.application.content.text("victory_page_title");
  }

  /** 要求当前已经开局。 */
  private requireState(): GameState {
    const state = this.application.state;
    if (state === null) {
      throw new GameApplicationError(this.application.content.text("game_not_started"));
    }
    return state;
  }

  /** 追加行动日志并按配置保留最近记录。 */
  private appendMessages(messages: readonly string[]): void {
    this.logs.push(...messages.filter((message) => message.trim().length > 0));
    const limit = this.presentation.interface.h5.log_limit;
    if (this.logs.length > limit) {
      this.logs = this.logs.slice(this.logs.length - limit);
    }
  }

  /** 向所有订阅者推送同一份不可变快照。 */
  private emit(snapshot: GameUiSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
