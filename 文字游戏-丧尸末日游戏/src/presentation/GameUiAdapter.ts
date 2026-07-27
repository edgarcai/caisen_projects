import type { GameApplication } from "../application";
import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import { activePlayer, isEnded, isVictory } from "../domain/game-state";
import type {
  CampaignProfileState,
  CompanionState,
  GameMode,
  GameState,
  ShelterState,
} from "../domain/game-state";
import type {
  ActionReport,
  ManagementCategory,
  ManagementOption,
} from "../domain/reports";
import type { WebGameConfig } from "../config/types";
import type {
  GameUiCommand,
  GameUiCommandResult,
  GameUiPort,
  GameUiSnapshot,
  UiActionGroupView,
  UiBattleView,
  UiCampaignProfileOptionsView,
  UiCampaignProfileSelection,
  UiCampaignProfileView,
  UiCityView,
  UiCompanionView,
  UiCraftingRecipeView,
  UiExpeditionCarryItemView,
  UiExpeditionCompanionView,
  UiExpeditionFailureView,
  UiExpeditionStatusView,
  UiHistoryEntryView,
  UiManagementCategoryView,
  UiManagementOptionView,
  UiMeterView,
  UiNoticeView,
  UiPromptView,
  UiResearchProjectView,
  UiSaveSlotView,
  UiStoryAccess,
  UiStatView,
  UiTone,
  UiTransportLoadoutOptionView,
  UiPlayerView,
  UiWarehouseItemView,
  UiWeeklyArchiveView,
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

interface ManagementCategoryPresentation {
  readonly id: string;
  readonly label: string;
  readonly action_ids?: readonly string[];
  readonly domain_categories?: readonly ManagementCategory[];
}

interface H5Presentation {
  readonly log_limit: number;
  readonly date_format: string;
  readonly time_format: string;
  readonly turn_format: string;
  readonly story_body_format: string;
  readonly story_title_format: string;
  readonly companion_biography_format: string;
  readonly trust_format: string;
  readonly battle_default_phase: string;
  readonly message_separator: string;
  readonly companion_status_labels: Readonly<Record<string, string>>;
}

interface GamePresentationConfig {
  readonly interface: {
    readonly cover: { readonly title: string; readonly subtitle: string };
    readonly pages: {
      readonly management_categories: readonly ManagementCategoryPresentation[];
    };
    readonly dashboard: {
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
  private persistentLogs: string[] = [];
  private sessionLogs: string[];
  private notice: UiNoticeView | null = null;
  private lastAutoSavedCheckpointDay: number | null = null;

  /** 保存应用服务与配置化展示内容，不复制任何领域状态。 */
  public constructor(application: GameApplication, webConfig: WebGameConfig) {
    this.application = application;
    this.webConfig = webConfig;
    this.presentation = application.content.game as unknown as GamePresentationConfig;
    this.sessionLogs = [application.content.text("welcome_log")];
  }

  /** 构建当前游戏状态对应的完整不可变快照。 */
  public getSnapshot(): GameUiSnapshot {
    const state = this.application.state;
    const storyAccess = this.resolveStoryAccess(state);
    const storyStatus = storyAccess === "mode"
      ? this.application.storyStatus()
      : null;
    return {
      revision: this.revision,
      brand: {
        title: this.presentation.interface.cover.title,
        subtitle: this.presentation.interface.cover.subtitle,
      },
      unlockedAchievementIds: this.application.unlockedAchievementIds(),
      playerCounts: this.playerCounts(),
      campaignProfileOptions: this.campaignProfileOptions(),
      campaignProfile: state === null ? null : this.campaignProfileView(state),
      saveSlots: this.saveSlotViews(),
      mode: state?.mode ?? null,
      storyAccess,
      ended: state === null ? false : isEnded(state),
      canRollback: state?.checkpoint !== null && state?.checkpoint !== undefined,
      activePlayer: state === null ? null : this.playerView(state, state.active_player_index),
      players: state === null
        ? []
        : state.players.map((_player, index) => this.playerView(state, index)),
      clock: state === null ? null : this.clockView(state),
      meters: state === null ? [] : this.meterViews(state),
      resources: state === null ? [] : this.resourceViews(state),
      shelterStats: state === null ? [] : this.shelterStatViews(state.shelter),
      mission: storyStatus === null
        ? null
        : {
            chapterLabel: storyStatus.chapterTitle,
            title: storyStatus.missionTitle,
            objective: storyStatus.objective,
            progressLabel: storyStatus.progressText,
          },
      logs: this.visibleLogs(),
      actionGroups: state === null ? [] : this.actionGroupViews(state),
      storyPrompt: storyAccess === "mode" ? this.storyPromptView() : null,
      cities: state === null ? [] : this.cityViews(state),
      explorationPrompt: state === null ? null : this.explorationPromptView(state),
      battle: state === null ? null : this.battleView(state),
      managementCategories: state === null ? [] : this.managementCategoryViews(state),
      companions: state === null ? [] : this.companionViews(state),
      warehouseItems: state === null ? [] : this.warehouseItemViews(state),
      transportLoadoutOptions: state === null ? [] : this.transportLoadoutOptionViews(),
      researchProjects: state === null ? [] : this.researchProjectViews(),
      craftingRecipes: state === null ? [] : this.craftingRecipeViews(),
      expeditionCompanions: state === null ? [] : this.expeditionCompanionViews(),
      expeditionCarryItems: state === null ? [] : this.expeditionCarryItemViews(),
      expeditionStatus: state === null ? null : this.expeditionStatusView(),
      expeditionFailure: state === null ? null : this.expeditionFailureView(),
      weeklyArchives: state === null ? [] : this.weeklyArchiveViews(),
      tutorial: {
        title: this.actionLabel("tutorial"),
        body: state?.mode === "story"
          ? this.application.content.game.game.tutorial
          : this.application.content.game.game.tutorial_survival,
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

  /**
   * 集中投影剧情模式访问权，并仅为旧存档的剧情战斗或剧情结局保留恢复入口。
   */
  private resolveStoryAccess(state: GameState | null): UiStoryAccess {
    if (state === null) {
      return "hidden";
    }
    return state.mode === "story" ? "mode" : "hidden";
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
        this.updateLogsFromReport(command, execution.report);
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
      this.appendSessionMessages([this.notice.message]);
      this.revision += 1;
      const snapshot = this.getSnapshot();
      this.emit(snapshot);
      return { accepted: false, snapshot, notice: this.notice };
    }
  }

  /** 查询指定栏位或全部栏位中是否至少有一个可完整恢复的存档。 */
  public canLoadGame(slotId?: number): boolean {
    const slots = this.application.saveSlots();
    const candidates = slotId === undefined
      ? slots
      : slots.filter((slot) => slot.slotId === slotId);
    return candidates.some(
      (slot) => slot.status === "valid" || slot.status === "recoverable",
    );
  }

  /** 执行一个已经过判别联合约束的命令。 */
  private executeCommand(
    command: GameUiCommand,
  ): { readonly accepted: boolean; readonly report: ActionReport | null } {
    switch (command.type) {
      case "start_game": {
        const report = this.application.startNewGame({
          mode: command.mode,
          playerNames: command.playerNames,
          saveSlotId: command.saveSlotId ?? this.application.saveSlots()[0]?.slotId ?? 1,
          profile: this.toDomainCampaignProfile(
            command.profile ?? this.campaignProfileOptions().defaultSelection,
          ),
        });
        this.lastAutoSavedCheckpointDay = null;
        return { accepted: true, report };
      }
      case "load_game": {
        if (!this.application.hasSave(command.slotId)) {
          throw new GameApplicationError(this.application.content.text("no_save"));
        }
        const report = this.application.loadGame(command.slotId);
        this.lastAutoSavedCheckpointDay =
          this.application.state?.checkpoint?.survival_day ?? null;
        return { accepted: true, report };
      }
      case "save_game": {
        const report = this.application.saveGame(command.slotId);
        this.lastAutoSavedCheckpointDay =
          this.application.state?.checkpoint?.survival_day ?? null;
        return { accepted: true, report };
      }
      case "rollback_checkpoint": {
        const report = this.application.rollbackToCheckpoint();
        if (report.stateChanged) {
          this.persistRollback();
        }
        return { accepted: report.stateChanged, report };
      }
      case "research_complete": {
        const report = this.application.completeResearch(command.projectId);
        return { accepted: report.stateChanged, report };
      }
      case "craft_item": {
        const report = this.application.craftItem(command.recipeId);
        return { accepted: report.stateChanged, report };
      }
      case "equip_item": {
        const report = this.application.equipItem(command.itemId);
        return { accepted: report.stateChanged, report };
      }
      case "transport_toggle": {
        const report = this.application.toggleTransport(command.itemId);
        return { accepted: report.stateChanged, report };
      }
      case "companion_equip": {
        const report = this.application.equipCompanion(
          command.companionId,
          command.slot,
          command.itemId,
        );
        return { accepted: report.stateChanged, report };
      }
      case "companion_interact": {
        const report = this.application.interactWithCompanion(
          command.companionId,
          command.interactionId,
        );
        return { accepted: report.stateChanged, report };
      }
      case "expedition_begin": {
        const report = this.application.prepareExpedition(
          command.cityId,
          command.districtId,
          command.companionIds,
          command.carriedItems,
        );
        return { accepted: report.stateChanged, report };
      }
      case "expedition_continue": {
        const report = this.application.continueExpedition();
        return { accepted: report.stateChanged, report };
      }
      case "expedition_safe_return": {
        const report = this.application.returnExpeditionSafely();
        return { accepted: report.stateChanged, report };
      }
      case "story_choice": {
        if (this.application.state?.mode !== "story") {
          throw new GameApplicationError(
            this.application.content.text("story_mode_required"),
          );
        }
        const prompt = this.application.currentStoryPrompt();
        if (prompt === null) {
          throw new GameApplicationError(this.application.content.text("story_complete"));
        }
        const report = this.application.resolveStoryChoice(prompt.sceneId, command.choiceId);
        return { accepted: report.stateChanged, report };
      }
      case "exploration_prepare": {
        this.application.prepareExploration(command.cityId);
        this.syncPersistentMessages();
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
        const supplyActionId = this.resolveManagementSupplyAction(
          command.categoryId,
          command.optionId,
        );
        if (supplyActionId !== null) {
          const report = this.application.performAction(supplyActionId);
          return { accepted: report.stateChanged, report };
        }
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

  /** 仅在领域生成新的十日检查点时自动落盘，避免每次行动覆盖存档。 */
  private autoSave(): void {
    const state = this.application.state;
    if (!this.webConfig.storage.auto_save || state === null) {
      return;
    }
    const checkpointDay = state.checkpoint?.survival_day;
    if (
      checkpointDay === undefined
      || checkpointDay === this.lastAutoSavedCheckpointDay
    ) {
      return;
    }
    try {
      this.application.saveGame();
      this.lastAutoSavedCheckpointDay = checkpointDay;
      this.appendSessionMessages([this.webConfig.texts.auto_saved]);
    } catch {
      this.appendSessionMessages([this.webConfig.texts.storage_unavailable]);
    }
  }

  /** 回档是显式用户决策，成功后立即持久化恢复结果。 */
  private persistRollback(): void {
    try {
      this.application.saveGame();
      this.lastAutoSavedCheckpointDay =
        this.application.state?.checkpoint?.survival_day ?? null;
    } catch {
      this.appendSessionMessages([this.webConfig.texts.storage_unavailable]);
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
        : command.type === "rollback_checkpoint"
          ? this.webConfig.texts.rollback_title
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

  /** 返回由主配置定义的全部游戏模式输入框数量。 */
  private playerCounts(): Readonly<Record<GameMode, number>> {
    const rules = this.application.content.game.rules.player_counts;
    const single = rules.single?.maximum;
    const multiplayer = rules.multiplayer?.maximum;
    const story = rules.story?.maximum;
    const endless = rules.endless?.maximum;
    if (
      single === undefined
      || multiplayer === undefined
      || story === undefined
      || endless === undefined
    ) {
      throw new Error("游戏模式缺少玩家数量配置。");
    }
    return { single, multiplayer, story, endless };
  }

  /** 把领域配置中的难度、起源、特性与城市转换为开局选择模型。 */
  private campaignProfileOptions(): UiCampaignProfileOptionsView {
    const game = this.application.content.game;
    const allowedHomeCityIds = new Set(game.rules.world_map.home_city_ids);
    return {
      difficulties: game.campaign_profiles.difficulties.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
      })),
      origins: game.campaign_profiles.origins.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
      })),
      traits: game.campaign_profiles.traits.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
      })),
      cities: game.cities
        .filter((city) => allowedHomeCityIds.has(city.id))
        .map((city) => ({
          id: city.id,
          label: `${city.name} · ${city.district}`,
          description: city.description,
        })),
      defaultSelection: {
        difficultyId: game.campaign_profiles.migration_default.difficulty_id,
        originId: game.campaign_profiles.migration_default.origin_id,
        traitId: game.campaign_profiles.migration_default.trait_id,
        homeCityId: game.campaign_profiles.migration_default.home_city_id,
      },
    };
  }

  /** 把当前聚合中的稳定 ID 解析为独立的中文开局档案。 */
  private campaignProfileView(state: GameState): UiCampaignProfileView {
    const profiles = this.application.content.game.campaign_profiles;
    const city = this.application.content.city(state.campaign.home_city_id);
    return {
      modeLabel: this.presentation.mode_labels[state.mode],
      difficultyLabel: this.requireCampaignLabel(
        profiles.difficulties,
        state.campaign.difficulty_id,
      ),
      originLabel: this.requireCampaignLabel(
        profiles.origins,
        state.campaign.origin_id,
      ),
      traitLabel: this.requireCampaignLabel(
        profiles.traits,
        state.campaign.trait_id,
      ),
      homeCityLabel: [city.name, city.district].join(
        this.webConfig.texts.profile_field_separator,
      ),
      districtLabel: city.district,
    };
  }

  /** 从配置化选项中按稳定 ID 读取标签。 */
  private requireCampaignLabel(
    options: readonly { readonly id: string; readonly label: string }[],
    optionId: string,
  ): string {
    const option = options.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      throw new Error(this.application.content.text("invalid_campaign_profile"));
    }
    return option.label;
  }

  /** 将 UI 使用的驼峰字段转换为领域存档使用的稳定字段名。 */
  private toDomainCampaignProfile(
    selection: UiCampaignProfileSelection,
  ): CampaignProfileState {
    return {
      difficulty_id: selection.difficultyId,
      origin_id: selection.originId,
      trait_id: selection.traitId,
      home_city_id: selection.homeCityId,
    };
  }

  /** 把基础设施槽位摘要格式化为六栏存档页面模型。 */
  private saveSlotViews(): UiSaveSlotView[] {
    return this.application.saveSlots().map((slot) => {
      const statusLabel = this.webConfig.texts[`save_slot_status_${slot.status}`];
      const title = formatTemplate(this.webConfig.texts.save_slot_title_format, {
        slot: slot.slotId,
        status: statusLabel,
      });
      if (slot.status === "empty" || slot.status === "corrupted") {
        return {
          slotId: slot.slotId,
          status: slot.status,
          title,
          details: slot.status === "empty"
            ? this.webConfig.texts.save_slot_empty_details
            : this.webConfig.texts.save_slot_corrupted_details,
          loadable: false,
          writable: true,
        };
      }
      const difficulty = this.application.content.game.campaign_profiles.difficulties.find(
        (item) => item.id === slot.difficultyId,
      )?.label ?? this.webConfig.texts.save_slot_unknown_value;
      const city = slot.homeCityId === null
        ? null
        : this.application.content.game.cities.find((item) => item.id === slot.homeCityId);
      return {
        slotId: slot.slotId,
        status: slot.status,
        title,
        details: formatTemplate(this.webConfig.texts.save_slot_details_format, {
          mode: slot.mode === null
            ? this.webConfig.texts.save_slot_unknown_value
            : this.presentation.mode_labels[slot.mode],
          names: slot.playerNames.join(this.webConfig.texts.save_slot_name_separator),
          difficulty,
          days: slot.survivalDays ?? this.webConfig.texts.save_slot_unknown_value,
          city: city === undefined || city === null
            ? this.webConfig.texts.save_slot_unknown_value
            : `${city.name} · ${city.district}`,
          saved_at: slot.savedAt ?? this.webConfig.texts.save_slot_unknown_value,
        }),
        loadable: true,
        writable: true,
      };
    });
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

  /** 把当前所长背包和计入装备的有效属性转换为统计行。 */
  private resourceViews(state: GameState): UiStatView[] {
    const player = activePlayer(state);
    const attributes = this.application.effectivePlayerAttributes();
    return this.presentation.labels.player_stats.map(([field, label]) => ({
      id: `player-${field}`,
      label,
      value: String(field === "attack" || field === "defense" || field === "agility"
        ? attributes[field]
        : this.readNumericField(player, field)),
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
    const itemNames = new Map(
      this.application.warehouseItemCatalog().map((item) => [item.itemId, item.name]),
    );
    return this.application.expeditionCities().map((access) => {
      const pendingLocked = hasPending
        && state.pending_exploration?.city_id !== access.city.id;
      const disabled = pendingLocked || !access.accessible;
      const disabledReason = pendingLocked
        ? this.application.content.text("pending_event_locked")
        : access.accessible ? undefined : access.reason;
      const listSeparator = this.webConfig.texts.save_slot_name_separator;
      const districts = access.city.districts.map((district) => {
        const eventStepCost = this.application.expeditionEventStepCost(
          access.city.id,
          district.id,
        );
        return {
        id: district.id,
        code: district.code,
        name: district.name,
        label: [district.code, district.name].join(
          this.webConfig.texts.profile_field_separator,
        ),
        description: district.description,
        dangerLevel: district.danger_level,
        eventStepCost,
        eventLabels: district.event_ids.map((eventId) =>
          this.application.content.event(eventId).title),
        fields: [
          {
            id: "danger",
            label: this.webConfig.texts.expedition_field_danger,
            value: String(district.danger_level),
          },
          {
            id: "event-steps",
            label: this.webConfig.texts.expedition_field_event_steps,
            value: String(eventStepCost),
          },
          {
            id: "events",
            label: this.webConfig.texts.expedition_field_events,
            value: district.event_ids.map((eventId) =>
              this.application.content.event(eventId).title).join(listSeparator),
          },
        ],
        requirements: [{
          id: "district-step-cost",
          label: this.webConfig.texts.expedition_district_requirement,
          description: String(eventStepCost),
          status: "informational" as const,
        }],
        };
      });
      return {
        id: access.city.id,
        label: access.city.name,
        description: access.city.description,
        disabled,
        disabledReason,
        tone: access.accessible ? "primary" : "default",
        districtLabel: access.city.district,
        terrainLabel: this.application.content.text(
          `city_terrain_${access.city.terrain}`,
        ),
        relationLabel: this.application.content.text(
          `city_relation_${access.relation}`,
        ),
        travelStepCost: access.travelStepCost,
        defaultDistrictId: access.city.default_district_id
          || districts[0]?.id
          || "",
        districts,
        fields: [
          {
            id: "neighbors",
            label: this.webConfig.texts.expedition_field_neighbors,
            value: access.city.neighbor_ids.length > 0
              ? access.city.neighbor_ids.map((cityId) =>
                  this.application.content.city(cityId).name).join(listSeparator)
              : this.webConfig.texts.expedition_empty_value,
          },
          {
            id: "relation",
            label: this.webConfig.texts.expedition_field_relation,
            value: this.application.content.text(`city_relation_${access.relation}`),
          },
          {
            id: "terrain",
            label: this.webConfig.texts.expedition_field_terrain,
            value: this.application.content.text(`city_terrain_${access.city.terrain}`),
          },
          {
            id: "travel-steps",
            label: this.webConfig.texts.expedition_field_travel_steps,
            value: String(access.travelStepCost),
          },
          {
            id: "intelligence",
            label: this.webConfig.texts.expedition_field_intelligence,
            value: String(access.city.intelligence_newspapers_required),
          },
          {
            id: "path-items",
            label: this.webConfig.texts.expedition_field_path_items,
            value: this.cityAccessItemNames(
              access.city.path_item_ids,
              itemNames,
              listSeparator,
            ),
          },
          {
            id: "transport-items",
            label: this.webConfig.texts.expedition_field_transport_items,
            value: this.cityAccessItemNames(
              access.city.transport_item_ids,
              itemNames,
              listSeparator,
            ),
          },
        ],
        requirements: [{
          id: "city-access",
          label: this.webConfig.texts.expedition_access_requirement,
          description: [access.accessSummary, disabledReason ?? access.reason].join("\n"),
          status: disabled ? "unmet" : "met",
        }],
      };
    });
  }

  /** 把通行物品 ID 转为配置名称，空集合使用统一占位文案。 */
  private cityAccessItemNames(
    itemIds: readonly string[],
    itemNames: ReadonlyMap<string, string>,
    separator: string,
  ): string {
    if (itemIds.length === 0) {
      return this.webConfig.texts.expedition_empty_value;
    }
    return itemIds.map((itemId) => itemNames.get(itemId) ?? itemId).join(separator);
  }

  /** 从已持久化事件 ID 构建探索事件页，不触发新的随机抽取。 */
  private explorationPromptView(state: GameState): UiPromptView | null {
    const pending = state.pending_exploration;
    if (pending === null) {
      return null;
    }
    const event = this.application.content.event(pending.event_id);
    const city = this.application.content.city(pending.city_id);
    const district = this.application.content.district(
      pending.city_id,
      pending.district_id,
    );
    const choices = event.choices ?? [];
    return {
      id: event.id,
      title: event.title,
      body: formatTemplate(this.webConfig.texts.exploration_location_format, {
        city: city.name,
        district: [district.code, district.name].join(
          this.webConfig.texts.profile_field_separator,
        ),
        intro: event.intro,
      }),
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

  /** 按配置汇总经营、活动与升级页面，不在适配器硬编码领域类别映射。 */
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
      const configuredActionIds = category.action_ids ?? [];
      const domainCategories = category.domain_categories ?? [];
      const categoryOptions = [
        ...configuredActionIds.map((actionId) =>
          this.managementSupplyOptionView(category.id, actionId, state),
        ),
        ...options
          .filter((option) => domainCategories.includes(option.category))
          .map((option) => this.managementOptionView(option)),
      ];
      return {
        id: category.id,
        label: category.label,
        description: this.application.content.text("management_category_prompt"),
        disabled: categoryOptions.length === 0,
        tone: "primary",
        options: categoryOptions,
      };
    });
  }

  /** 把伙伴状态、信任与档案转换为独立资料卡。 */
  private companionViews(state: GameState): UiCompanionView[] {
    const catalog = new Map(
      this.application.warehouseItemCatalog().map((item) => [item.itemId, item]),
    );
    return this.application.companionManagementViews().map((companion) => {
      const stateCompanion = state.companions.find(
        (candidate) => candidate.companion_id === companion.companionId,
      );
      if (stateCompanion === undefined) {
        throw new Error(`缺少伙伴状态：${companion.companionId}`);
      }
      const secret = companion.secretUnlocked
        ? companion.secret
        : this.webConfig.texts.companion_secret_locked;
      const equipmentOptions = (slot: "weapon" | "armor") => companion.status === "active"
        ? this.application.companionEquipmentOptions(companion.companionId, slot)
        : [];
      const equippedItem = (itemId: string | null, name: string | null) => {
        if (itemId === null || name === null) return null;
        return {
          id: itemId,
          name,
          description: catalog.get(itemId)?.description ?? "",
        };
      };
      return {
        id: companion.companionId,
        name: companion.name,
        role: companion.role,
        portraitKey: companion.portraitKey,
        portraitAssetPath:
          this.webConfig.assets.companion_portraits.items[companion.portraitKey] ?? "",
        statusLabel:
          this.presentation.interface.h5.companion_status_labels[companion.status]
          ?? companion.status,
        trustLabel: formatTemplate(this.presentation.interface.h5.trust_format, {
          trust: companion.trust,
        }),
        introduction: companion.introduction,
        biography: formatTemplate(
          this.presentation.interface.h5.companion_biography_format,
          { introduction: companion.introduction, secret },
        ),
        secret,
        secretUnlocked: companion.secretUnlocked,
        canManage: companion.status === "active",
        interactionCooldownTurns: companion.interactionCooldownTurns,
        interactionCount: companion.interactionCount,
        equippedWeapon: equippedItem(
          companion.equippedWeaponId,
          companion.equippedWeaponName,
        ),
        equippedArmor: equippedItem(
          companion.equippedArmorId,
          companion.equippedArmorName,
        ),
        weaponOptions: equipmentOptions("weapon").map((option) => ({
          id: option.itemId,
          name: option.name,
          slot: option.slot,
          description: option.description,
          availableQuantity: option.availableQuantity,
          equipped: option.equipped,
          disabled: !option.available,
          disabledReason: option.available
            ? undefined
            : this.application.content.text("management_failed"),
        })),
        armorOptions: equipmentOptions("armor").map((option) => ({
          id: option.itemId,
          name: option.name,
          slot: option.slot,
          description: option.description,
          availableQuantity: option.availableQuantity,
          equipped: option.equipped,
          disabled: !option.available,
          disabledReason: option.available
            ? undefined
            : this.application.content.text("management_failed"),
        })),
        interactionOptions: this.application
          .companionInteractionOptions(companion.companionId)
          .map((option) => ({
            id: option.interactionId,
            label: option.label,
            description: option.description,
            disabled: !option.available,
            disabledReason: option.unavailableReason || undefined,
            tone: option.available ? "success" as const : "default" as const,
          })),
        tone: this.companionTone(stateCompanion),
      };
    });
  }

  /** 把统一仓库投影为可显示装备状态的库存清单。 */
  private warehouseItemViews(state: GameState): UiWarehouseItemView[] {
    return this.application.warehouseItems().map((item) => ({
      id: item.itemId,
      name: item.name,
      category: item.category,
      categoryLabel: item.categoryLabel,
      quantity: item.quantity,
      carryable: item.carryable,
      equippable: item.category === "weapon" || item.category === "armor",
      equipped: state.inventory.equipped_weapon_id === item.itemId
        || state.inventory.equipped_armor_id === item.itemId,
      description: item.description,
    }));
  }

  /** 把载具服务投影为可装备、可卸载且能解释缺失状态的页面模型。 */
  private transportLoadoutOptionViews(): UiTransportLoadoutOptionView[] {
    return this.application.transportLoadoutOptions().map((option) => ({
      id: option.itemId,
      name: option.name,
      modeLabel: option.modeLabel,
      description: option.description,
      ownedQuantity: option.ownedQuantity,
      equipped: option.equipped,
      disabled: !option.available && !option.equipped,
      disabledReason: option.available || option.equipped
        ? undefined
        : this.webConfig.texts.transport_unavailable,
    }));
  }

  /** 把研发服务结果转换为不泄漏可变领域状态的页面模型。 */
  private researchProjectViews(): UiResearchProjectView[] {
    return this.application.researchProjects().map((project) => ({
      id: project.projectId,
      name: project.name,
      description: project.description,
      completed: project.completed,
      available: project.available,
      costDescription: project.costDescription,
      expeditionStepBonus: project.expeditionStepBonus,
    }));
  }

  /** 把制作服务结果转换为配方页面模型。 */
  private craftingRecipeViews(): UiCraftingRecipeView[] {
    return this.application.craftingRecipes().map((recipe) => ({
      id: recipe.recipeId,
      name: recipe.name,
      description: recipe.description,
      available: recipe.available,
      unlocked: recipe.unlocked,
      costDescription: recipe.costDescription,
      outputItemId: recipe.outputItemId,
      outputQuantity: recipe.outputQuantity,
    }));
  }

  /** 把可用伙伴投影为远征准备选项。 */
  private expeditionCompanionViews(): UiExpeditionCompanionView[] {
    return this.application.expeditionCompanions().map((companion) => ({
      id: companion.companionId,
      name: companion.name,
      traitName: companion.traitName,
      trust: companion.trust,
      stepBonus: companion.stepBonus,
    }));
  }

  /** 把可调拨库存投影为远征携带物选项。 */
  private expeditionCarryItemViews(): UiExpeditionCarryItemView[] {
    return this.application.expeditionCarryItems().map((item) => ({
      id: item.itemId,
      name: item.name,
      availableQuantity: item.availableQuantity,
      stepBonusPerUnit: item.stepBonusPerUnit,
    }));
  }

  /** 把当前远征上下文转换为状态页摘要。 */
  private expeditionStatusView(): UiExpeditionStatusView | null {
    const status = this.application.expeditionStatus();
    if (status === null) return null;
    const district = this.application.content.district(
      status.cityId,
      status.districtId,
    );
    return {
      cityId: status.cityId,
      cityName: this.application.content.city(status.cityId).name,
      districtId: status.districtId,
      districtName: [district.code, district.name].join(
        this.webConfig.texts.profile_field_separator,
      ),
      travelStepCost: status.travelStepCost,
      remainingSteps: status.remainingSteps,
      maximumSteps: status.maximumSteps,
      eventsResolved: status.eventsResolved,
      companionIds: [...status.companionIds],
      carriedItems: { ...status.carriedItems },
      loot: { ...status.loot },
      itemNames: { ...status.itemNames },
      eventStepCost: this.application.expeditionEventStepCost(
        status.cityId,
        status.districtId,
      ),
    };
  }

  /** 把最近一次步数耗尽损失投影为独立失败页模型。 */
  private expeditionFailureView(): UiExpeditionFailureView | null {
    const failure = this.application.lastExpeditionFailure();
    if (failure === null) return null;
    return {
      reason: this.webConfig.texts.expedition_failure_steps_reason,
      keptPercent: failure.kept_percent,
      healthBefore: failure.health_before,
      healthAfter: failure.health_after,
      totalBefore: failure.total_original,
      totalKept: failure.total_kept,
      totalLost: failure.total_lost,
      items: failure.items.map((item) => ({
        id: `${item.source}:${item.item_id}`,
        name: item.item_name,
        source: item.source,
        before: item.original_quantity,
        kept: item.kept_quantity,
        lost: item.lost_quantity,
      })),
    };
  }

  /** 把周档案和其中的通讯时间戳转换为历史页面模型。 */
  private weeklyArchiveViews(): UiWeeklyArchiveView[] {
    return this.application.weeklyArchives().map((archive) => ({
      weekNumber: archive.week_number,
      startDateLabel: this.formatDate(
        archive.start_date.year,
        archive.start_date.month,
        archive.start_date.day,
      ),
      endDateLabel: this.formatDate(
        archive.end_date.year,
        archive.end_date.month,
        archive.end_date.day,
      ),
      summary: archive.summary,
      entries: archive.entries.map((entry) => this.historyEntryView(entry)),
    }));
  }

  /** 格式化一条历史通讯记录的日期、时刻和来源回合。 */
  private historyEntryView(
    entry: ReturnType<GameApplication["weeklyArchives"]>[number]["entries"][number],
  ): UiHistoryEntryView {
    return {
      survivalDay: entry.survival_day,
      turnNumber: entry.turn_number,
      dateLabel: this.formatDate(entry.clock.year, entry.clock.month, entry.clock.day),
      timeLabel: formatTemplate(this.presentation.interface.h5.time_format, {
        hour: entry.clock.hour,
      }),
      message: entry.message,
    };
  }

  /** 使用统一日期模板格式化不带时刻的游戏日期。 */
  private formatDate(year: number, month: number, day: number): string {
    return formatTemplate(this.presentation.interface.h5.date_format, {
      year,
      month,
      day,
      hour: 0,
    });
  }

  /** 按 Web 行动分组装配指挥台按钮，并应用阻塞状态。 */
  private actionGroupViews(state: GameState): UiActionGroupView[] {
    const actions = new Map(this.actionPresentations().map((action) => [action.id, action]));
    return this.webConfig.action_groups.map((group) => ({
      id: group.id,
      label: group.label,
      actions: group.action_ids
        .filter((actionId) => this.actionVisibleInMode(actionId))
        .map((actionId) => {
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

  /** 按模式能力配置彻底隐藏普通模式中的剧情行动。 */
  private actionVisibleInMode(actionId: string): boolean {
    if (actionId !== "story") {
      return true;
    }
    return this.application.supportsCapability("narrative");
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
  private managementOptionView(option: ManagementOption): UiManagementOptionView {
    const firstUnmet = option.requirements.find((requirement) => !requirement.met);
    return {
      id: this.managementOptionId(option),
      label: option.label,
      description: option.description,
      disabled: false,
      lockedAppearance: !option.available,
      disabledReason: option.available
        ? undefined
        : firstUnmet?.description
          ?? this.application.content.text("management_failed"),
      tone: option.available ? "primary" : "default",
      fields: option.fields,
      requirements: option.requirements.map((requirement) => ({
        id: requirement.id,
        label: requirement.label,
        description: requirement.description,
        status: requirement.met ? "met" : "unmet",
      })),
    };
  }

  /** 把配置化基础行动包装为避难所管理中的二级选项。 */
  private managementSupplyOptionView(
    categoryId: string,
    actionId: string,
    state: GameState,
  ): UiManagementOptionView {
    const action = this.actionPresentations().find((candidate) => candidate.id === actionId);
    if (action === undefined) {
      throw new Error(this.application.content.text("unknown_action", {
        action_id: actionId,
      }));
    }
    const blockedReason = this.actionBlockedReason(state, actionId);
    return {
      id: `${categoryId}${MANAGEMENT_OPTION_SEPARATOR}${actionId}`,
      label: action.label,
      description: "",
      disabled: false,
      lockedAppearance: blockedReason !== null,
      disabledReason: blockedReason ?? undefined,
      tone: this.actionTone(action.style),
      fields: [],
      requirements: [{
        id: `${actionId}-availability`,
        label: this.application.content.text("management_requirement_action_label"),
        description: blockedReason
          ?? this.application.content.text("management_action_available"),
        status: blockedReason === null ? "met" : "unmet",
      }],
    };
  }

  /** 校验管理页提交的配置化基础行动，未命中时交由领域经营命令处理。 */
  private resolveManagementSupplyAction(
    categoryId: string,
    uiOptionId: string,
  ): string | null {
    const category = this.presentation.interface.pages.management_categories.find(
      (candidate) => candidate.id === categoryId,
    );
    const actionId = category?.action_ids?.find(
      (candidate) => `${categoryId}${MANAGEMENT_OPTION_SEPARATOR}${candidate}` === uiOptionId,
    );
    return actionId ?? null;
  }

  /** 校验 UI 经营项目仍与当前领域选项一致。 */
  private resolveManagementOption(categoryId: string, uiOptionId: string): ManagementOption {
    const category = this.presentation.interface.pages.management_categories.find(
      (candidate) => candidate.id === categoryId,
    );
    const option = this.application.managementOptions().find(
      (candidate) => this.managementOptionId(candidate) === uiOptionId,
    );
    if (
      option === undefined
      || category?.domain_categories?.includes(option.category) !== true
    ) {
      throw new GameApplicationError(this.application.content.text("management_failed"));
    }
    return option;
  }

  /** 为买入和卖出同 ID 商品生成不冲突的选择 ID。 */
  private managementOptionId(option: ManagementOption): string {
    return `${option.category}${MANAGEMENT_OPTION_SEPARATOR}${option.optionId}`;
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
    return this.actionPresentations().find((action) => action.id === actionId)?.label ?? "";
  }

  /** 合并领域动作与 H5 专属页面入口，形成统一展示清单。 */
  private actionPresentations(): readonly GameActionPresentation[] {
    return [...this.presentation.actions, ...this.webConfig.actions];
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

  /** 按报告类型同步持久通讯，并把存档或失败提示留在当前会话。 */
  private updateLogsFromReport(command: GameUiCommand, report: ActionReport): void {
    if (!report.stateChanged) {
      this.appendSessionMessages(report.messages);
      return;
    }
    if (
      command.type === "start_game"
      || command.type === "load_game"
      || command.type === "rollback_checkpoint"
    ) {
      this.sessionLogs = [];
    }
    this.syncPersistentMessages();
    if (command.type === "load_game") {
      this.appendSessionMessages(report.messages);
    }
  }

  /** 从应用聚合根恢复已持久化通讯，避免成功报告重复显示。 */
  private syncPersistentMessages(): void {
    this.persistentLogs = [...this.application.communicationMessages()];
  }

  /** 追加不进入存档的会话提示，并单独执行容量钳制。 */
  private appendSessionMessages(messages: readonly string[]): void {
    this.sessionLogs.push(...messages.filter((message) => message.trim().length > 0));
    const limit = this.presentation.interface.h5.log_limit;
    if (this.sessionLogs.length > limit) {
      this.sessionLogs = this.sessionLogs.slice(this.sessionLogs.length - limit);
    }
  }

  /** 合并持久通讯和会话提示，并只向 UI 暴露配置化最大条数。 */
  private visibleLogs(): string[] {
    const combined = [...this.persistentLogs, ...this.sessionLogs];
    const limit = this.presentation.interface.h5.log_limit;
    return combined.length > limit ? combined.slice(combined.length - limit) : combined;
  }

  /** 向所有订阅者推送同一份不可变快照。 */
  private emit(snapshot: GameUiSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
