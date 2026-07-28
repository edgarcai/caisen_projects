import { resolveResponsiveLayout } from "../styles/ResponsiveLayout";
import { coopDemoConfig } from "../config/coopDemoConfig";
import type { ResponsiveLayout } from "../styles/ResponsiveLayout";
import type {
  CoverThemeTokens,
  GameUiConfig,
  NavigationToken,
} from "../styles/GameTheme";
import { UiFactory } from "./components/UiFactory";
import { formatUiTemplate } from "./formatting/formatUiTemplate";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
  LayaStageLike,
} from "./laya/LayaRuntime";
import { resolveVisibleDisplayNodeBounds } from "./laya/DisplayNodeLocator";
import { PageStack } from "./navigation/PageStack";
import type { GameRoute } from "./navigation/PageStack";
import {
  DEFAULT_DASHBOARD_NAVIGATION_POLICY,
  resolveDashboardNavigationIntent,
  type DashboardNavigationIntent,
  type DashboardNavigationPolicy,
} from "./navigation/DashboardNavigationStrategy";
import { DeferredResizeCoordinator } from "./interactions/DeferredResizeCoordinator";
import type { NativeTextInputPolicyPort } from "./interactions/NativeTextInputPolicy";
import {
  buildCoverThemeSelectionStates,
  isCoverThemeUnlocked,
  resolveCoverThemeArtwork,
  resolveSelectedCoverTheme,
} from "./models/CoverThemeModel";
import {
  buildEncounterBattlePageView,
  buildEncounterPreparationPageView,
  emptyEncounterBattleSelection,
  emptyEncounterPreparationSelection,
  resolveEncounterExecutionDraft,
  resolveEncounterPreparationPlan,
  type EncounterBattleSelection,
  type EncounterPreparationSelection,
} from "./models/DemoSystemPresenters";
import { archiveDocumentViewKey } from "./models/DemoSystemViewModels";
import {
  resolveExpeditionEntryScreen,
  resolveExpeditionProgressScreen,
} from "./navigation/ExpeditionNavigation";
import { resolveStoryProgressScreen } from "./navigation/StoryNavigation";
import { createChoicePage } from "./pages/ChoicePage";
import {
  createCompanionDetailPage,
  createCompanionEquipmentPage,
  createCompanionInteractionPage,
  createCompanionsPage,
} from "./pages/CompanionsPage";
import { ConnectionPage } from "./pages/ConnectionPage";
import { CoverPage } from "./pages/CoverPage";
import {
  buildCommunicationLogDocument,
  DashboardPage,
} from "./pages/DashboardPage";
import { createDocumentPage } from "./pages/DocumentPage";
import {
  createArchiveCollectionPage,
  createArchiveDocumentPage,
  createArchiveStoragePage,
  createEncounterBattlePage,
  createEncounterCatalogPage,
  createEncounterPreparationPage,
  createReturnIncidentPage,
} from "./pages/DemoSystemsPages";
import {
  createDistrictExplorationTreePage,
  createExpeditionCityDetailPage,
  createExpeditionCityListPage,
  createExpeditionDistrictDetailPage,
  createExpeditionDistrictListPage,
  createExpeditionFailurePage,
  createExpeditionPreparePage,
  createExpeditionStatusPage,
  resolveExpeditionDistrict,
  type ExpeditionDraft,
} from "./pages/ExpeditionPages";
import { createGuidedTutorialPage } from "./pages/GuidedTutorialPage";
import { createManagementOptionDetailPage } from "./pages/ManagementPages";
import { createNewGameSetupPage } from "./pages/NewGameSetupPage";
import {
  createCityReconSelectionPage,
  createOutpostAssignmentPage,
  createOutpostCitySelectionPage,
  createOutpostDetailPage,
  createOutpostDistrictSelectionPage,
  createOutpostTypeSelectionPage,
  createReconCompanionSelectionPage,
  createSettlementNetworkPage,
} from "./pages/SettlementNetworkPages";
import { createCoopAccountPage } from "./pages/CoopAccountPage";
import { createConfirmPage } from "./pages/ConfirmPage";
import type { PageTransientState, PageView } from "./pages/PageView";
import { createPreGameNoticePage } from "./pages/PreGameNoticePage";
import { createPublisherSplashPage } from "./pages/PublisherSplashPage";
import { createSaveSlotsPage } from "./pages/SaveSlotsPage";
import {
  createShelterMapPage,
  createShelterRoomPlanningPage,
} from "./pages/ShelterMapPage";
import { createSuppliesPage } from "./pages/SuppliesPage";
import {
  createCraftingPage,
  createHistoryPage,
  createResearchPage,
  createTransportManagementPage,
  createWarehousePage,
} from "./pages/SystemFeaturePages";
import {
  createAccountLoginPage,
  createCreditsPage,
  createCoverThemeSelectorPage,
  createExitConfirmPage,
  createFunctionMenuPage,
  createReturnMenuConfirmPage,
  createRollbackConfirmPage,
  createSettingsPage,
  createStorePage,
  createTextRecordsPage,
} from "./pages/SystemMenuPages";
import type {
  GameMode,
  GameScreenId,
  GameUiCommand,
  GameUiPort,
  GameUiSnapshot,
  SaveSlotsPageMode,
  UiCampaignProfileSelection,
  UiCompanionEquipmentSlot,
  UiDocumentView,
  UiNavigationDirective,
  UiOptionView,
  UiPromptView,
} from "./ports/GameUiPort";
import type { CoopUiPort, CoopUiSnapshot } from "./ports/CoopUiPort";
import type {
  UiPreferences,
  UiSettingsPort,
} from "./ports/UiSettingsPort";

/** 已创建页面与其稳定路由的绑定。 */
interface RenderedPage {
  readonly route: GameRoute;
  readonly view: PageView;
}

/** 建档页与开局提示之间暂存的完整不可变开局协议。 */
interface PendingNewGameRequest {
  readonly mode: GameMode;
  readonly playerNames: readonly string[];
  readonly profile: UiCampaignProfileSelection;
  readonly saveSlotId: number;
}

/**
 * LayaAir 游戏界面入口，只依赖应用层提供的 GameUiPort。
 */
export class GameShell {
  private readonly stage: LayaStageLike;
  private readonly config: GameUiConfig;
  private readonly port: GameUiPort;
  private readonly runtime: LayaRuntimeLike;
  private readonly factory: UiFactory;
  private readonly host: LayaSpriteLike;
  private readonly navigation: PageStack;
  private readonly settingsPort: UiSettingsPort;
  private readonly nativeTextInputPolicy: NativeTextInputPolicyPort;
  private readonly dashboardNavigationPolicy: DashboardNavigationPolicy;
  private readonly coopPort: CoopUiPort | null;
  private snapshot: GameUiSnapshot | null;
  private coopSnapshot: CoopUiSnapshot | null;
  private renderedPages: RenderedPage[];
  private preferences: UiPreferences;
  private unsubscribe: (() => void) | null;
  private unsubscribeCoop: (() => void) | null;
  private canLoad: boolean;
  private mounted: boolean;
  private executing: boolean;
  private browserGuardInstalled: boolean;
  private exitVerificationTimer: ReturnType<typeof setTimeout> | null;
  private connectionTimer: ReturnType<typeof setTimeout> | null;
  private readonly resizeCoordinator: DeferredResizeCoordinator;
  private viewportListenersInstalled: boolean;
  private expeditionDraft: ExpeditionDraft;
  private encounterSelection: EncounterBattleSelection;
  private encounterPreparationSelection: EncounterPreparationSelection;
  private pendingNewGameRequest: PendingNewGameRequest | null;

  /**
   * 保存舞台、配置和倒置端口，但不在构造阶段触发领域请求。
   */
  public constructor(
    runtime: unknown,
    stage: unknown,
    config: GameUiConfig,
    port: GameUiPort,
    settingsPort: UiSettingsPort,
    nativeTextInputPolicy: NativeTextInputPolicyPort,
    dashboardNavigationPolicy: DashboardNavigationPolicy =
      DEFAULT_DASHBOARD_NAVIGATION_POLICY,
    coopPort: CoopUiPort | null = null,
  ) {
    this.runtime = expectLayaRuntime(runtime);
    this.stage = expectLayaStage(stage);
    this.config = config;
    this.port = port;
    this.settingsPort = settingsPort;
    this.nativeTextInputPolicy = nativeTextInputPolicy;
    this.dashboardNavigationPolicy = dashboardNavigationPolicy;
    this.coopPort = coopPort;
    this.factory = new UiFactory(
      this.runtime,
      config.theme,
      config.typography,
      config.controls,
    );
    this.host = this.factory.container("game-ui-root");
    this.navigation = new PageStack({ screen: "publisher_splash" });
    this.snapshot = null;
    this.coopSnapshot = coopPort?.getSnapshot() ?? null;
    this.renderedPages = [];
    this.preferences = settingsPort.load({
      reducedMotion: config.motion.reduced_motion,
      selectedCoverThemeId: config.assets.cover_themes.default_id,
    });
    this.unsubscribe = null;
    this.unsubscribeCoop = null;
    this.canLoad = false;
    this.mounted = false;
    this.executing = false;
    this.browserGuardInstalled = false;
    this.exitVerificationTimer = null;
    this.connectionTimer = null;
    this.resizeCoordinator = new DeferredResizeCoordinator(
      {
        debounceMs: config.responsive.resize_debounce_ms,
        keyboardSettleMs: config.responsive.keyboard_resize_settle_ms,
      },
      this.hasActiveTextEntry,
      this.commitResize,
    );
    this.viewportListenersInstalled = false;
    this.expeditionDraft = emptyExpeditionDraft();
    this.encounterSelection = emptyEncounterBattleSelection();
    this.encounterPreparationSelection = emptyEncounterPreparationSelection();
    this.pendingNewGameRequest = null;
  }

  /**
   * 读取初始快照和存档状态，并把 UI 挂载到 Laya 舞台。
   */
  public async mount(): Promise<void> {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.stage.getChildByName?.("engine-boot-status")?.destroy(true);
    this.stage.addChild(this.host);
    this.stage.on(this.runtime.Event.RESIZE, this, this.handleResize);
    this.stage.on(this.runtime.Event.KEY_DOWN, this, this.handleKeyDown);
    this.installBrowserBackGuard();
    this.installViewportListeners();
    this.unsubscribe = this.port.subscribe(this.handleSnapshot);
    this.unsubscribeCoop = this.coopPort?.subscribe(this.handleCoopSnapshot)
      ?? null;
    const [snapshot, canLoad] = await Promise.all([
      Promise.resolve(this.port.getSnapshot()),
      Promise.resolve(this.port.canLoadGame()),
    ]);
    this.snapshot = snapshot;
    this.canLoad = canLoad;
    this.render(true);
  }

  /**
   * 取消订阅并释放当前 UI 显示树。
   */
  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeCoop?.();
    this.unsubscribeCoop = null;
    this.stage.off(this.runtime.Event.RESIZE, this, this.handleResize);
    this.stage.off(this.runtime.Event.KEY_DOWN, this, this.handleKeyDown);
    this.removeBrowserBackGuard();
    this.removeViewportListeners();
    this.resizeCoordinator.destroy();
    this.clearExitVerificationTimer();
    this.clearConnectionTimer();
    this.destroyRenderedPages();
    this.host.offAll();
    this.host.destroy(true);
    const browserWindow = getBrowserWindow();
    if (browserWindow !== null) {
      delete browserWindow.document.body.dataset.gameScreen;
      delete browserWindow.document.body.dataset.gameLayout;
      delete browserWindow.document.body.dataset.gameCoverTheme;
      delete browserWindow.document.body.dataset.gameCoverAsset;
    }
    this.mounted = false;
  }

  /**
   * 返回当前稳定页面标识，供自动化测试读取。
   */
  public getCurrentScreen(): GameScreenId {
    return this.navigation.current().screen;
  }

  /**
   * 接收端口推送的新快照并刷新当前页面。
   */
  private readonly handleSnapshot = (snapshot: GameUiSnapshot): void => {
    this.snapshot = snapshot;
    if (this.mounted && !this.executing) {
      this.render(true);
    }
  };

  /** 接收本地联机会话变化，并仅刷新当前覆盖页。 */
  private readonly handleCoopSnapshot = (snapshot: CoopUiSnapshot): void => {
    this.coopSnapshot = snapshot;
    if (this.mounted && !this.executing) this.render(true);
  };

  /**
   * 舞台尺寸变化时重新计算断点和安全区。
   */
  private readonly handleResize = (): void => {
    this.resizeCoordinator.request();
  };

  /** 原生输入结束后等待软键盘动画稳定，再执行被延迟的刷新。 */
  private readonly handleTextEntryFocusOut = (): void => {
    this.resizeCoordinator.settleAfterTextEntry();
  };

  /** 返回当前文档是否正由原生输入控件持有焦点。 */
  private readonly hasActiveTextEntry = (): boolean => {
    const browserWindow = getBrowserWindow();
    return browserWindow !== null &&
      isTextEntryElement(browserWindow.document.activeElement);
  };

  /** 在尺寸事件稳定且无原生输入焦点时重建当前响应式页面。 */
  private readonly commitResize = (): void => {
    if (this.mounted) {
      this.render(true);
    }
  };

  /**
   * 把 Escape 键转换为功能菜单的打开或逐层关闭语义。
   */
  private readonly handleKeyDown = (event?: unknown): void => {
    if (isEscapeEvent(event)) {
      this.toggleFunctionMenu();
    }
  };

  /**
   * 截获浏览器返回并使用游戏页面栈，避免直接离开进行中的战役。
   */
  private readonly handleBrowserBack = (): void => {
    if (this.navigation.current().screen === "menu") {
      return;
    }
    const browserWindow = getBrowserWindow();
    browserWindow?.history.pushState({ gameUi: true }, browserWindow.document.title);
    this.requestBack();
  };

  /**
   * 按路由前缀增量对齐覆盖式显示树；刷新时重建全部页面快照。
   */
  private render(refreshAll = false): void {
    if (this.snapshot === null) {
      return;
    }
    this.host.size(this.stage.width, this.stage.height);
    const layout = resolveResponsiveLayout(
      this.stage.width,
      this.stage.height,
      this.config,
    );
    const transientStates = refreshAll
      ? this.captureRenderedPageStates()
      : new Map<GameRoute, PageTransientState>();
    if (refreshAll) {
      this.destroyRenderedPages();
    }
    const routes = this.navigation.entries();
    let sharedDepth = 0;
    while (
      sharedDepth < this.renderedPages.length &&
      sharedDepth < routes.length &&
      this.renderedPages[sharedDepth]?.route === routes[sharedDepth]
    ) {
      sharedDepth += 1;
    }
    for (
      let index = this.renderedPages.length - 1;
      index >= sharedDepth;
      index -= 1
    ) {
      this.renderedPages[index]?.view.destroy();
    }
    this.renderedPages.length = sharedDepth;
    for (let index = sharedDepth; index < routes.length; index += 1) {
      const route = routes[index];
      if (route === undefined) {
        continue;
      }
      const view = this.createPage(route, layout, this.snapshot);
      const transientState = transientStates.get(route);
      if (transientState !== undefined) {
        view.restoreTransientState?.(transientState);
      }
      this.host.addChild(view.root);
      this.renderedPages.push({ route, view });
    }
    const topIndex = this.renderedPages.length - 1;
    this.renderedPages.forEach((entry, index) => {
      const active = index === topIndex;
      entry.view.root.visible = index >= Math.max(0, topIndex - 1);
      entry.view.root.mouseEnabled = active;
      entry.view.root.zOrder = index;
      entry.view.setActive?.(active);
    });
    const browserWindow = getBrowserWindow();
    if (browserWindow !== null) {
      const activeCoverTheme = this.resolveActiveCoverTheme(this.requireSnapshot());
      browserWindow.document.body.dataset.gameScreen = this.navigation.current().screen;
      browserWindow.document.body.dataset.gameLayout = layout.kind;
      browserWindow.document.body.dataset.gameCoverTheme = activeCoverTheme.id;
      browserWindow.document.body.dataset.gameCoverAsset =
        resolveCoverThemeArtwork(activeCoverTheme, layout).asset;
    }
  }

  /** 按稳定路由对象保存页面瞬态状态，避免把状态误套到新路由。 */
  private captureRenderedPageStates(): Map<GameRoute, PageTransientState> {
    const states = new Map<GameRoute, PageTransientState>();
    this.renderedPages.forEach((entry) => {
      const state = entry.view.captureTransientState?.();
      if (state !== undefined) {
        states.set(entry.route, state);
      }
    });
    return states;
  }

  /** 销毁全部已渲染页面并清空宿主显示列表。 */
  private destroyRenderedPages(): void {
    for (let index = this.renderedPages.length - 1; index >= 0; index -= 1) {
      this.renderedPages[index]?.view.destroy();
    }
    this.renderedPages = [];
    this.host.removeChildren();
  }

  /**
   * 按路由创建对应页面，实现完整单窗口页面流。
   */
  private createPage(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    switch (route.screen) {
      case "publisher_splash":
        return createPublisherSplashPage(
          this.runtime,
          this.factory,
          this.config,
          layout,
          this.completePublisherSplash,
          this.preferences.reducedMotion,
        );
      case "menu":
        return this.createCover(layout, snapshot);
      case "name_input":
        return this.createNameInput(route, layout, snapshot);
      case "pre_game_notice":
        return createPreGameNoticePage(
          this.runtime,
          this.factory,
          this.config,
          layout,
          {
            back: this.closePreGameNotice,
            continueGame: (): void => {
              void this.startPendingNewGame(false);
            },
            openTutorial: (): void => {
              void this.startPendingNewGame(true);
            },
          },
        );
      case "update_log":
        return this.createDocumentRoute(
          layout,
          "page-update-log",
          this.updateLogDocument(),
          this.config.texts.close,
          this.goBack,
        );
      case "save_slots":
        return this.createSaveSlots(route, layout, snapshot);
      case "connection":
        return this.createConnection(layout);
      case "dashboard":
        return this.createDashboard(layout, snapshot);
      case "story":
        return this.createStory(layout, snapshot);
      case "exploration_city":
        return this.createExplorationCities(layout, snapshot);
      case "exploration_event":
        return this.createExplorationEvent(layout, snapshot);
      case "battle":
        return this.createBattle(layout, snapshot);
      case "management_categories":
        return this.createManagementCategories(layout, snapshot);
      case "management_options":
        return this.createManagementOptions(route, layout, snapshot);
      case "management_option_detail":
        return this.createManagementOptionDetail(route, layout, snapshot);
      case "companions":
        return this.createCompanions(layout, snapshot);
      case "companion_detail":
        return this.createCompanionDetail(route, layout, snapshot);
      case "companion_equipment":
        return this.createCompanionEquipment(route, layout, snapshot);
      case "companion_interaction":
        return this.createCompanionInteraction(route, layout, snapshot);
      case "shelter_map":
        return this.createShelterMap(layout, snapshot);
      case "shelter_room_planning":
        return this.createShelterRoomPlanning(route, layout, snapshot);
      case "archive_storage":
        return this.createArchiveStorage(layout, snapshot);
      case "archive_collection":
        return this.createArchiveCollection(route, layout, snapshot);
      case "archive_document":
        return this.createArchiveDocument(route, layout, snapshot);
      case "encounter_catalog":
        return this.createEncounterCatalog(layout, snapshot);
      case "encounter_preparation":
        return this.createEncounterPreparation(route, layout, snapshot);
      case "encounter_battle":
        return this.createEncounterBattle(layout, snapshot);
      case "return_incident":
        return this.createReturnIncident(layout, snapshot);
      case "supplies":
        return this.createSupplies(layout, snapshot);
      case "warehouse":
        return this.createWarehouse(layout, snapshot);
      case "transport_management":
        return this.createTransportManagement(layout, snapshot);
      case "research":
        return this.createResearch(layout, snapshot);
      case "crafting":
        return this.createCrafting(layout, snapshot);
      case "expedition_city_list":
        return this.createExpeditionCityList(layout, snapshot);
      case "expedition_city_detail":
        return this.createExpeditionCityDetail(route, layout, snapshot);
      case "expedition_district_list":
        return this.createExpeditionDistrictList(route, layout, snapshot);
      case "expedition_district_detail":
        return this.createExpeditionDistrictDetail(route, layout, snapshot);
      case "district_exploration_tree":
        return this.createDistrictExplorationTree(route, layout, snapshot);
      case "expedition_retreat_confirm":
        return this.createExpeditionRetreatConfirm(layout);
      case "expedition_prepare":
        return this.createExpeditionPrepare(layout, snapshot);
      case "expedition_status":
        return this.createExpeditionStatus(layout, snapshot);
      case "expedition_failure":
        return this.createExpeditionFailure(layout, snapshot);
      case "settlement_network":
        return this.createSettlementNetwork(layout, snapshot);
      case "settlement_recon_city":
        return this.createSettlementReconCities(layout, snapshot);
      case "settlement_recon_companion":
        return this.createSettlementReconCompanions(route, layout, snapshot);
      case "outpost_build_city":
        return this.createOutpostBuildCities(layout, snapshot);
      case "outpost_build_district":
        return this.createOutpostBuildDistricts(route, layout, snapshot);
      case "outpost_build_type":
        return this.createOutpostBuildTypes(route, layout, snapshot);
      case "outpost_detail":
        return this.createOutpostDetail(route, layout, snapshot);
      case "outpost_assign":
        return this.createOutpostAssignment(route, layout, snapshot);
      case "communication_log":
        return this.createDocumentRoute(
          layout,
          "page-communication-log",
          buildCommunicationLogDocument(this.config, snapshot.logs),
          this.config.texts.back,
          this.goBack,
        );
      case "history":
        return this.createHistory(layout, snapshot);
      case "tutorial":
        return createGuidedTutorialPage(
          this.runtime,
          this.factory,
          this.config,
          layout,
          (targetTestId) => {
            this.revealTutorialTarget(targetTestId);
            return resolveVisibleDisplayNodeBounds(this.host, targetTestId);
          },
          {
            onComplete: this.closeGuidedTutorial,
            onSkip: this.closeGuidedTutorial,
          },
        );
      case "message":
        return this.createDocumentRoute(
          layout,
          "page-message",
          route.context?.document ?? this.emptyDocument(""),
          this.config.texts.close,
          this.goBack,
        );
      case "ending":
        return this.createDocumentRoute(
          layout,
          "page-ending",
          snapshot.ending ?? route.context?.document ?? this.emptyDocument(""),
          this.config.texts.close,
          this.closeEnding,
        );
      case "return_menu_confirm":
        return this.createReturnConfirm(layout);
      case "function_menu":
        return this.createFunctionMenu(layout, snapshot);
      case "settings":
        return this.createSettings(layout);
      case "cover_theme_selector":
        return this.createCoverThemeSelector(layout, snapshot);
      case "rollback_confirm":
        return this.createRollbackConfirm(layout);
      case "exit_confirm":
        return this.createExitConfirm(layout);
      case "credits":
        return createCreditsPage(
          this.runtime,
          this.factory,
          this.config,
          layout,
          this.goBack,
        );
      case "account_login":
        return this.createAccountLogin(layout);
      case "store":
        return createStorePage(
          this.runtime,
          this.factory,
          this.config,
          layout,
          this.goBack,
        );
      case "text_records":
        return this.createTextRecords(layout, snapshot);
    }
  }

  /** 创建真实账户、房间通讯与本地交易页，未注入端口时保留兼容提示。 */
  private createAccountLogin(layout: ResponsiveLayout): PageView {
    if (this.coopPort === null || this.coopSnapshot === null) {
      return createAccountLoginPage(
        this.runtime,
        this.factory,
        this.config,
        layout,
        this.goBack,
      );
    }
    return createCoopAccountPage(
      this.runtime,
      this.factory,
      this.config,
      coopDemoConfig,
      layout,
      this.coopSnapshot,
      {
        back: this.goBack,
        prepareTextInput: (): void => { this.nativeTextInputPolicy.prepare(); },
        textInputBlurred: this.handleTextEntryFocusOut,
        login: (displayName): void => {
          this.executeCoopAction((): void => { this.coopPort?.login(displayName); });
        },
        logout: (): void => {
          this.executeCoopAction((): void => { this.coopPort?.logout(); });
        },
        joinRoom: (roomId, shelterName): void => {
          this.executeCoopAction((): void => {
            this.coopPort?.joinRoom(roomId, shelterName);
          });
        },
        leaveRoom: (): void => {
          this.executeCoopAction((): void => { this.coopPort?.leaveRoom(); });
        },
        sendCommunication: (message): void => {
          this.executeCoopAction((): void => {
            this.coopPort?.sendCommunication(message);
          });
        },
        sendDemoTrade: (targetAccountId): void => {
          this.executeCoopAction((): void => {
            this.coopPort?.sendDemoTrade(targetAccountId);
          });
        },
        replyTradeOffer: (offerEventId, accepted): void => {
          this.executeCoopAction((): void => {
            this.coopPort?.replyTradeOffer(offerEventId, accepted);
          });
        },
      },
    );
  }

  /** 执行联机意图并把输入校验或浏览器能力错误投影为覆盖消息页。 */
  private executeCoopAction(action: () => void): void {
    try {
      action();
      this.coopSnapshot = this.coopPort?.getSnapshot() ?? null;
      this.render(true);
    } catch (error) {
      this.navigation.push({
        screen: "message",
        context: {
          document: {
            title: coopDemoConfig.texts.operationFailedTitle,
            body: error instanceof Error ? error.message : String(error),
            tone: "warning",
          },
        },
      });
      this.render();
    }
  }

  /**
   * 创建封面并绑定六个配置化入口。
   */
  private createCover(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): CoverPage {
    const coverTheme = this.resolveActiveCoverTheme(snapshot);
    return new CoverPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.brand,
      coverTheme,
      this.canLoad,
      {
        startSingle: (): void => { this.openNameInput("single"); },
        loadGame: (): void => {
          this.openSaveSlots("load");
        },
        startMultiplayer: (): void => { this.openNameInput("multiplayer"); },
        startStory: (): void => { this.openNameInput("story"); },
        showCredits: (): void => {
          this.navigation.push({ screen: "credits" });
          this.render();
        },
        showAccountLogin: (): void => {
          this.navigation.push({ screen: "account_login" });
          this.render();
        },
        showStore: (): void => {
          this.navigation.push({ screen: "store" });
          this.render();
        },
        showTextRecords: (): void => {
          this.navigation.push({ screen: "text_records" });
          this.render();
        },
        showUpdateLog: (): void => {
          this.navigation.push({ screen: "update_log" });
          this.render();
        },
        openSettings: (): void => {
          this.openSettings();
        },
      },
    );
  }

  /** 创建姓名、模式、难度、起源、特性、出生城市与栏位开局页。 */
  private createNameInput(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const mode = route.context?.mode ?? "single";
    const view = createNewGameSetupPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      mode,
      snapshot.playerCounts,
      snapshot.campaignProfileOptions,
      snapshot.saveSlots,
      this.goBack,
      (names, profile, slotId, selectedMode): void => {
        this.openPreGameNotice({
          mode: selectedMode,
          playerNames: [...names],
          profile: { ...profile },
          saveSlotId: slotId,
        });
      },
      (): void => {
        this.nativeTextInputPolicy.prepare();
      },
      this.handleTextEntryFocusOut,
    );
    return view.page;
  }

  /** 创建读档或保存语义明确的六栏存档覆盖页。 */
  private createSaveSlots(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const mode = route.context?.saveSlotsMode ?? "load";
    return createSaveSlotsPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.saveSlots,
      mode,
      (slotId): void => {
        if (mode === "load") {
          void this.loadGame(slotId);
        } else {
          void this.saveGame(slotId);
        }
      },
      this.goBack,
    );
  }

  /**
   * 创建响应式指挥台。
   */
  private createDashboard(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): DashboardPage {
    return new DashboardPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot,
      {
        selectEntry: this.handleDashboardEntry,
      },
    );
  }

  /** 创建新游戏和读档成功后共用的配置化通讯过场。 */
  private createConnection(layout: ResponsiveLayout): ConnectionPage {
    return new ConnectionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      this.connectionDuration(),
    );
  }

  /**
   * 创建当前剧情选择页，战斗和结局由入口方法提前分流。
   */
  private createStory(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const prompt = snapshot.storyPrompt ?? this.emptyPrompt(this.navigationLabel("story"));
    return createChoicePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      {
        testId: "page-story",
        title: this.navigationLabel("story"),
        prompt,
        onBack: this.goBack,
        onSelect: (option): void => {
          void this.chooseStory(option.id);
        },
      },
    );
  }

  /**
   * 创建城市选择页。
   */
  private createExplorationCities(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const prompt: UiPromptView = {
      id: "exploration-cities",
      title: this.navigationLabel("explore"),
      body: snapshot.mission?.objective ?? "",
      options: snapshot.cities,
    };
    return createChoicePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      {
        testId: "page-exploration-city",
        title: this.navigationLabel("explore"),
        prompt,
        onBack: this.goBack,
        onSelect: (option): void => {
          void this.prepareExploration(option.id);
        },
      },
    );
  }

  /**
   * 创建已经持久化抽取结果的探索事件页。
   */
  private createExplorationEvent(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const prompt = snapshot.explorationPrompt ?? this.emptyPrompt(this.navigationLabel("explore"));
    return createChoicePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      {
        testId: "page-exploration-event",
        title: prompt.title,
        prompt,
        onBack: (): void => {
          void this.retreatExploration();
        },
        onSelect: (option): void => {
          void this.resolveExploration(option.id);
        },
      },
    );
  }

  /**
   * 创建首领战页面，返回只暂停，不执行撤退命令。
   */
  private createBattle(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const battle = snapshot.battle;
    const prompt: UiPromptView = battle === null
      ? this.emptyPrompt("")
      : {
          id: battle.bossId,
          title: `${battle.bossName} · ${battle.phaseLabel}`,
          body: `${String(battle.health)}/${String(battle.maximumHealth)}\n\n${battle.body}`,
          options: battle.actions,
        };
    return createChoicePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      {
        testId: "page-battle",
        title: battle?.bossName ?? "",
        prompt,
        onBack: this.goBack,
        onSelect: (option): void => {
          void this.performCombatAction(option.id);
        },
      },
    );
  }

  /**
   * 创建经营类别页面。
   */
  private createManagementCategories(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const title = this.navigationLabel("management");
    const prompt: UiPromptView = {
      id: "management-categories",
      title,
      body: snapshot.mission?.objective ?? "",
      options: snapshot.managementCategories,
    };
    return createChoicePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      {
        testId: "page-management-categories",
        title,
        prompt,
        onBack: this.goBack,
        onSelect: (option): void => { this.openManagementOptions(option.id); },
      },
    );
  }

  /**
   * 创建某个经营类别的项目列表。
   */
  private createManagementOptions(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const categoryId = route.context?.categoryId ?? "";
    const category = snapshot.managementCategories.find(
      (candidate) => candidate.id === categoryId,
    );
    const prompt: UiPromptView = {
      id: categoryId,
      title: category?.label ?? this.navigationLabel("management"),
      body: this.managementOverviewBody(category?.description ?? "", snapshot),
      options: category?.options ?? [],
    };
    return createChoicePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      {
        testId: "page-management-options",
        title: prompt.title,
        prompt,
        onBack: this.goBack,
        onSelect: (option): void => { this.openManagementOptionDetail(
          categoryId,
          option.id,
        ); },
      },
    );
  }

  /** 创建经营项目的需求与说明页，工作可选择配置化循环次数。 */
  private createManagementOptionDetail(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const categoryId = route.context?.categoryId ?? "";
    const optionId = route.context?.optionId ?? "";
    const option = snapshot.managementCategories
      .find((category) => category.id === categoryId)
      ?.options.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.management_detail_title,
      );
    }
    return createManagementOptionDetailPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      option,
      route.context?.repetitions,
      {
        back: this.goBack,
        cycleRepetitions: (repetitions): void => {
          this.navigation.replace({
            screen: route.screen,
            context: { ...route.context, repetitions },
          });
          this.render();
        },
        confirm: (repetitions): void => {
          void this.performManagementAction(categoryId, option.id, repetitions);
        },
      },
    );
  }

  /** 在经营项目列表中追加分层墙体实时耐久，不复用旧总耐久镜像。 */
  private managementOverviewBody(
    description: string,
    snapshot: GameUiSnapshot,
  ): string {
    const walls = snapshot.shelterWalls;
    if (walls === null) return description;
    const summary = formatUiTemplate(this.config.texts.shelter_wall_summary_format, {
      inner: walls.innerHealth,
      inner_maximum: walls.innerMaximum,
      outer: walls.outerHealth,
      outer_maximum: walls.outerMaximum,
      total: walls.totalHealth,
      total_maximum: walls.totalMaximum,
    });
    return [description, summary].filter((value) => value.length > 0).join("\n\n");
  }

  /** 创建仅展示已拥有角色的档案页面。 */
  private createCompanions(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createCompanionsPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.companions,
      {
        back: this.goBack,
        openCompanion: this.openCompanionDetail,
      },
    );
  }

  /** 创建可滚动的避难所横切面，房间点击后继续叠加规划页。 */
  private createShelterMap(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const view = snapshot.shelterLayout;
    if (view === null) {
      return this.createMissingSelectionPage(
        layout,
        snapshot.shelterLayoutConfig.title,
      );
    }
    return createShelterMapPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.shelterLayoutConfig,
      view,
      {
        back: this.goBack,
        openRoom: this.openShelterRoomPlanning,
      },
    );
  }

  /** 创建指定房间的人员规划页，并保留横切面作为上一级。 */
  private createShelterRoomPlanning(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const roomId = route.context?.roomId ?? "";
    const room = snapshot.shelterLayout?.rooms.find(
      (candidate) => candidate.roomId === roomId,
    );
    if (room === undefined) {
      return this.createMissingSelectionPage(
        layout,
        snapshot.shelterLayoutConfig.title,
      );
    }
    return createShelterRoomPlanningPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.shelterLayoutConfig,
      room,
      snapshot.shelterRoomAssignmentOptions[roomId] ?? [],
      {
        back: this.goBack,
        changeAssignment: (residentId, targetRoomId): void => {
          void this.changeShelterRoomAssignment(residentId, targetRoomId);
        },
      },
    );
  }

  /** 创建报纸与书籍的文献存储总览。 */
  private createArchiveStorage(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const view = snapshot.archiveStorage;
    if (view === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.archive_storage_title,
      );
    }
    return createArchiveStoragePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      view,
      {
        back: this.goBack,
        openCollection: this.openArchiveCollection,
      },
    );
  }

  /**
   * 封面文本记录优先复用当前局或最近存档的文献目录，无进度时显示空状态。
   */
  private createTextRecords(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    if (snapshot.archiveStorage === null) {
      return createTextRecordsPage(
        this.runtime,
        this.factory,
        this.config,
        layout,
        this.goBack,
      );
    }
    return createArchiveStoragePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      {
        ...snapshot.archiveStorage,
        title: this.config.texts.text_records_title,
      },
      {
        back: this.goBack,
        openCollection: this.openArchiveCollection,
      },
    );
  }

  /** 创建指定文献分类的锁定与已解锁目录。 */
  private createArchiveCollection(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const collectionId = route.context?.collectionId ?? "";
    const view = snapshot.archiveCollections[collectionId];
    if (view === undefined) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.archive_storage_title,
      );
    }
    return createArchiveCollectionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      view,
      {
        back: this.goBack,
        openDocument: (documentId, unlocked): void => {
          this.openArchiveDocument(collectionId, documentId, unlocked);
        },
      },
    );
  }

  /** 创建一篇支持鼠标滚轮与手机拖动的长文献正文页。 */
  private createArchiveDocument(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const collectionId = route.context?.collectionId ?? "";
    const documentId = route.context?.documentId ?? "";
    const view = snapshot.archiveDocuments[
      archiveDocumentViewKey(collectionId, documentId)
    ];
    if (view === undefined) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.archive_storage_title,
      );
    }
    return createArchiveDocumentPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      view,
      this.goBack,
    );
  }

  /** 创建可手动进入的配置化遭遇目录。 */
  private createEncounterCatalog(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const view = snapshot.encounterCatalog;
    if (view === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.encounter_catalog_title,
      );
    }
    return createEncounterCatalogPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      view,
      {
        back: this.goBack,
        prepareEncounter: (encounterId): void => {
          this.openEncounterPreparation(encounterId);
        },
      },
    );
  }

  /** 创建职责、治疗和显式开战组成的战前整备页。 */
  private createEncounterPreparation(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const encounterId = route.context?.encounterId ?? "";
    const runtime = snapshot.encounterPreparations[encounterId];
    if (runtime === undefined) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.encounter_catalog_title,
      );
    }
    const view = buildEncounterPreparationPageView(
      runtime,
      this.config.texts,
      this.encounterPreparationSelection,
    );
    return createEncounterPreparationPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      view,
      {
        back: this.goBack,
        selectRole: this.selectEncounterPreparationRole,
        toggleTreatment: this.toggleEncounterPreparationTreatment,
        startBattle: (): void => {
          void this.startEncounter(encounterId);
        },
      },
    );
  }

  /** 创建前后排、敌人意图与逐人下令完整可见的遭遇战页。 */
  private createEncounterBattle(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const runtime = snapshot.encounterBattle;
    if (runtime === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.encounter_catalog_title,
      );
    }
    const view = buildEncounterBattlePageView(
      runtime,
      this.config.texts,
      this.encounterSelection,
      this.config.texts.profile_field_separator,
    );
    return createEncounterBattlePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      view,
      {
        back: this.goBack,
        selectPartyMember: this.selectEncounterActor,
        selectEnemy: this.selectEncounterTarget,
        selectAction: this.selectEncounterAction,
        selectTarget: this.selectEncounterTarget,
        execute: (): void => {
          void this.executeEncounterSelection();
        },
      },
    );
  }

  /** 创建探索返程后必须处理的避难所随机事项。 */
  private createReturnIncident(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const view = snapshot.returnIncident;
    if (view === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.return_incident_choice_title,
      );
    }
    return createReturnIncidentPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      view,
      {
        defer: (): void => undefined,
        choose: (choiceId): void => {
          void this.chooseReturnIncident(choiceId);
        },
      },
    );
  }

  /** 创建单个伙伴的立绘与公开/解锁档案页。 */
  private createCompanionDetail(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const companion = this.companion(snapshot, route.context?.companionId);
    if (companion === null) {
      return this.createMissingSelectionPage(layout, this.config.texts.companion_detail_title);
    }
    return createCompanionDetailPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      companion,
      {
        back: this.goBack,
        openEquipment: this.openCompanionEquipment,
        openInteraction: this.openCompanionInteraction,
      },
    );
  }

  /** 创建使用实时仓库目录的单栏位配装页。 */
  private createCompanionEquipment(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const companion = this.companion(snapshot, route.context?.companionId);
    const slot = route.context?.equipmentSlot;
    if (companion === null || slot === undefined) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.companion_equipment_title,
      );
    }
    return createCompanionEquipmentPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      companion,
      slot,
      {
        back: this.goBack,
        equip: (companionId, equipmentSlot, itemId): void => {
          void this.equipCompanion(companionId, equipmentSlot, itemId);
        },
      },
    );
  }

  /** 创建带冷却和条件的角色互动页。 */
  private createCompanionInteraction(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const companion = this.companion(snapshot, route.context?.companionId);
    if (companion === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.companion_interaction_title,
      );
    }
    return createCompanionInteractionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      companion,
      {
        back: this.goBack,
        interact: (companionId, interactionId): void => {
          void this.interactWithCompanion(companionId, interactionId);
        },
      },
    );
  }

  /**
   * 创建完整物资和基地保障页面。
   */
  private createSupplies(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createSuppliesPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      this.navigationLabel("supplies"),
      snapshot.resources,
      snapshot.shelterStats,
      snapshot.actionGroups,
      this.goBack,
      this.handleSupplyAction,
    );
  }

  /** 创建真实库存页并将可装备项接入装备命令。 */
  private createWarehouse(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createWarehousePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.warehouseItems,
      this.goBack,
      (itemId): void => { void this.equipWarehouseItem(itemId); },
    );
  }

  /** 创建载具设置页并将装备或卸下意图接入真实命令。 */
  private createTransportManagement(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createTransportManagementPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.transportLoadoutOptions,
      this.goBack,
      (itemId): void => { void this.toggleTransport(itemId); },
    );
  }

  /** 创建研发页并提交选中的研发项目。 */
  private createResearch(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    if (snapshot.researchWorkbench === null) {
      return this.createMissingSelectionPage(layout, this.config.texts.research_title);
    }
    return createResearchPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.researchProjects,
      snapshot.researchWorkbench,
      {
        back: this.goBack,
        slot: (itemId): void => { void this.slotResearchItem(itemId); },
        clear: (): void => { void this.clearResearchSlot(); },
        complete: (projectId): void => { void this.completeResearch(projectId); },
      },
    );
  }

  /** 创建制作工坊页并提交选中配方。 */
  private createCrafting(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createCraftingPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.craftingRecipes,
      this.goBack,
      (recipeId): void => { void this.craftItem(recipeId); },
    );
  }

  /** 创建保留 UI 草稿的远征整备页。 */
  private createExpeditionPrepare(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createExpeditionPreparePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.expeditionCompanions,
      snapshot.expeditionCarryItems,
      this.expeditionDraft,
      {
        back: this.goBack,
        toggleCompanion: this.toggleExpeditionCompanion,
        increaseItem: this.increaseExpeditionItem,
        decreaseItem: this.decreaseExpeditionItem,
        begin: (): void => { void this.beginExpedition(); },
      },
    );
  }

  /** 创建远征城市列表，锁定城市仍可进入下一层详情。 */
  private createExpeditionCityList(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createExpeditionCityListPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.cities,
      {
        back: this.goBack,
        openCity: this.openExpeditionCity,
      },
    );
  }

  /** 创建路由所选城市的情报和通行需求详情页。 */
  private createExpeditionCityDetail(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const city = this.expeditionCity(snapshot, route.context?.cityId);
    if (city === null) {
      return this.createMissingExpeditionSelection(layout);
    }
    return createExpeditionCityDetailPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      city,
      {
        back: this.goBack,
        continueToDistricts: (): void => {
          const district = resolveExpeditionDistrict(city, this.expeditionDraft.districtId);
          this.expeditionDraft = {
            ...this.expeditionDraft,
            cityId: city.id,
            districtId: district?.id ?? null,
          };
          this.navigation.push({
            screen: "expedition_district_list",
            context: { cityId: city.id },
          });
          this.render();
        },
      },
    );
  }

  /** 创建所选城市内由配置生成的区划列表页。 */
  private createExpeditionDistrictList(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const city = this.expeditionCity(snapshot, route.context?.cityId);
    if (city === null) {
      return this.createMissingExpeditionSelection(layout);
    }
    return createExpeditionDistrictListPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      city,
      {
        back: this.goBack,
        openDistrict: (districtId): void => {
          this.expeditionDraft = {
            ...this.expeditionDraft,
            cityId: city.id,
            districtId,
          };
          this.navigation.push({
            screen: "expedition_district_detail",
            context: { cityId: city.id, districtId },
          });
          this.render();
        },
      },
    );
  }

  /** 创建所选区划的危险等级、行动消耗和事件倾向详情页。 */
  private createExpeditionDistrictDetail(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const city = this.expeditionCity(snapshot, route.context?.cityId);
    if (city === null) {
      return this.createMissingExpeditionSelection(layout);
    }
    const district = resolveExpeditionDistrict(
      city,
      route.context?.districtId ?? this.expeditionDraft.districtId,
    );
    if (district === null) {
      return this.createMissingExpeditionSelection(layout);
    }
    return createExpeditionDistrictDetailPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      district,
      {
        back: this.goBack,
        continueToPrepare: (): void => {
          this.expeditionDraft = {
            cityId: city.id,
            districtId: district.id,
            companionIds: new Set<string>(),
            carriedItems: {},
          };
          this.navigation.push({ screen: "expedition_prepare" });
          this.render();
        },
      },
    );
  }

  /** 按路由路径只读取并展示区划探索树当前一层。 */
  private createDistrictExplorationTree(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const status = snapshot.expeditionStatus;
    const city = this.expeditionCity(
      snapshot,
      route.context?.cityId ?? status?.cityId,
    );
    const district = city === null
      ? null
      : resolveExpeditionDistrict(
          city,
          route.context?.districtId ?? status?.districtId ?? null,
        );
    if (
      city === null
      || district === null
      || status === null
      || snapshot.explorationPrompt === null
      || city.id !== status.cityId
      || district.id !== status.districtId
    ) {
      return this.createMissingExpeditionSelection(layout);
    }
    const projection = this.port.getDistrictExplorationLayer(
      city.id,
      district.id,
      route.context?.districtExplorationPath ?? [],
    );
    return createDistrictExplorationTreePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      projection,
      {
        back: (): void => { this.backFromDistrictExplorationTree(route); },
        chooseOption: (option): void => {
          if (option.terminal) {
            this.navigation.replace({ screen: "exploration_event" });
          } else {
            this.navigation.push({
              screen: "district_exploration_tree",
              context: {
                cityId: city.id,
                districtId: district.id,
                districtExplorationPath: option.address.path,
              },
            });
          }
          this.render();
        },
      },
    );
  }

  /** 为失效路由提供可返回的安全页面，避免旧草稿导致渲染崩溃。 */
  private createMissingExpeditionSelection(layout: ResponsiveLayout): PageView {
    return this.createMissingSelectionPage(
      layout,
      this.config.texts.expedition_prepare_title,
    );
  }

  /** 区划事件深层返回上一层，根层返回则先要求确认远征撤离。 */
  private backFromDistrictExplorationTree(route: GameRoute): void {
    if ((route.context?.districtExplorationPath?.length ?? 0) > 0) {
      this.goBack();
      return;
    }
    this.navigation.push({ screen: "expedition_retreat_confirm" });
    this.render();
  }

  /** 创建会明确说明行动代价的远征撤离二次确认页。 */
  private createExpeditionRetreatConfirm(layout: ResponsiveLayout): PageView {
    return createConfirmPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      "page-expedition-retreat-confirm",
      {
        title: this.config.texts.expedition_retreat_confirm_title,
        body: this.config.texts.expedition_retreat_confirm_body,
        tone: "warning",
      },
      (): void => { void this.retreatExploration(); },
      this.goBack,
    );
  }

  /** 为任意失效上下文创建可返回的配置化降级页。 */
  private createMissingSelectionPage(
    layout: ResponsiveLayout,
    title: string,
  ): PageView {
    return this.createDocumentRoute(
      layout,
      "page-selection-missing",
      { title, body: this.config.texts.expedition_unselected },
      this.config.texts.back,
      this.goBack,
    );
  }

  /** 从路由或草稿中解析当前城市，失效 ID 不隐式跳到其他城市。 */
  private expeditionCity(
    snapshot: GameUiSnapshot,
    routeCityId?: string,
  ) {
    const cityId = routeCityId ?? this.expeditionDraft.cityId;
    return snapshot.cities.find((city) => city.id === cityId) ?? null;
  }

  /** 按路由上下文解析伙伴，失效 ID 不隐式切换成其他人。 */
  private companion(
    snapshot: GameUiSnapshot,
    companionId?: string,
  ): GameUiSnapshot["companions"][number] | null {
    return snapshot.companions.find((candidate) => candidate.id === companionId) ?? null;
  }

  /** 创建继续深入与安全返程的远征状态页。 */
  private createExpeditionStatus(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const status = snapshot.expeditionStatus;
    if (status === null) {
      return this.createDocumentRoute(
        layout,
        "page-expedition-status-empty",
        {
          title: this.config.texts.expedition_status_title,
          body: this.config.texts.expedition_unselected,
        },
        this.config.texts.back,
        this.goBack,
      );
    }
    return createExpeditionStatusPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      status,
      snapshot.expeditionCompanions,
      this.expeditionItemNameMap(snapshot),
      {
        back: this.goBack,
        continueExpedition: (): void => { void this.continueExpedition(); },
        safeReturn: (): void => { void this.safeReturnExpedition(); },
      },
    );
  }

  /** 创建步数耗尽后必须确认的物资与生命损失结算页。 */
  private createExpeditionFailure(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    if (snapshot.expeditionFailure === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.expedition_failure_title,
      );
    }
    return createExpeditionFailurePage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.expeditionFailure,
      { returnToDashboard: this.continueAfterExpeditionFailure },
    );
  }

  /** 创建城市侦察、分避难所和周物流的统一总览页。 */
  private createSettlementNetwork(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createSettlementNetworkPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.cityReconMissions,
      snapshot.outposts,
      snapshot.settlementNetworkRules,
      {
        back: this.goBack,
        startRecon: (): void => {
          this.navigation.push({ screen: "settlement_recon_city" });
          this.render();
        },
        buildOutpost: (): void => {
          this.navigation.push({ screen: "outpost_build_city" });
          this.render();
        },
        completeRecon: (cityId): void => {
          void this.execute(
            { type: "city_recon_complete", cityId },
            (): void => undefined,
            true,
          );
        },
        openOutpost: (outpostId): void => {
          this.navigation.push({
            screen: "outpost_detail",
            context: { outpostId },
          });
          this.render();
        },
      },
    );
  }

  /** 创建侦察城市选择页，将所有条件不足原因保留在灰态情报中。 */
  private createSettlementReconCities(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createCityReconSelectionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.settlementCities,
      {
        back: this.goBack,
        selectCity: (cityId): void => {
          this.navigation.push({
            screen: "settlement_recon_companion",
            context: { cityId },
          });
          this.render();
        },
      },
    );
  }

  /** 创建侦察角色选择页，命令成功后回到分避难所总览。 */
  private createSettlementReconCompanions(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const city = this.settlementCity(snapshot, route.context?.cityId);
    if (city === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.settlement_recon_city_title,
      );
    }
    return createReconCompanionSelectionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      city,
      snapshot.settlementAvailableCompanions,
      {
        back: this.goBack,
        startRecon: (companionId): void => {
          void this.execute(
            { type: "city_recon_start", cityId: city.id, companionId },
            this.returnToSettlementOverview,
            true,
          );
        },
      },
    );
  }

  /** 创建只允许已解锁且仍有空闲区划的建设城市页。 */
  private createOutpostBuildCities(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createOutpostCitySelectionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.settlementCities,
      snapshot.outposts,
      {
        back: this.goBack,
        selectCity: (cityId): void => {
          this.navigation.push({
            screen: "outpost_build_district",
            context: { cityId },
          });
          this.render();
        },
      },
    );
  }

  /** 创建指定城市的分避难所区划选择页。 */
  private createOutpostBuildDistricts(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const city = this.settlementCity(snapshot, route.context?.cityId);
    if (city === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.outpost_build_city_title,
      );
    }
    return createOutpostDistrictSelectionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      city,
      snapshot.outposts,
      {
        back: this.goBack,
        selectDistrict: (districtId): void => {
          this.navigation.push({
            screen: "outpost_build_type",
            context: { cityId: city.id, districtId },
          });
          this.render();
        },
      },
    );
  }

  /** 创建含容量、加成与实时成本的分避难所类型页。 */
  private createOutpostBuildTypes(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const city = this.settlementCity(snapshot, route.context?.cityId);
    const district = city?.districts.find(
      (candidate) => candidate.id === route.context?.districtId,
    ) ?? null;
    if (city === null || district === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.outpost_build_district_title,
      );
    }
    return createOutpostTypeSelectionPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      city,
      district,
      snapshot.outpostShelterTypes,
      snapshot.settlementNetworkRules,
      {
        back: this.goBack,
        establish: (shelterTypeId): void => {
          void this.execute(
            {
              type: "outpost_establish",
              cityId: city.id,
              districtId: district.id,
              shelterTypeId,
            },
            this.returnToSettlementOverview,
            true,
          );
        },
      },
    );
  }

  /** 创建单座分避难所的驻守、召回与周物流页。 */
  private createOutpostDetail(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const outpost = this.outpost(snapshot, route.context?.outpostId);
    if (outpost === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.outpost_detail_title,
      );
    }
    return createOutpostDetailPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      outpost,
      snapshot.settlementAvailableCompanions,
      snapshot.settlementNetworkRules,
      {
        back: this.goBack,
        assignCompanion: (): void => {
          this.navigation.push({
            screen: "outpost_assign",
            context: { outpostId: outpost.outpostId },
          });
          this.render();
        },
        recallCompanion: (companionId): void => {
          void this.execute(
            { type: "outpost_recall", companionId },
            (): void => undefined,
            true,
          );
        },
        supply: (): void => {
          void this.execute(
            { type: "outpost_supply", outpostId: outpost.outpostId },
            (): void => undefined,
            true,
          );
        },
      },
    );
  }

  /** 创建只展示当前未被占用角色的分避难所派驻页。 */
  private createOutpostAssignment(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const outpost = this.outpost(snapshot, route.context?.outpostId);
    if (outpost === null) {
      return this.createMissingSelectionPage(
        layout,
        this.config.texts.outpost_assign_title,
      );
    }
    return createOutpostAssignmentPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      outpost,
      snapshot.settlementAvailableCompanions,
      {
        back: this.goBack,
        assign: (companionId): void => {
          void this.execute(
            {
              type: "outpost_assign",
              outpostId: outpost.outpostId,
              companionId,
            },
            (): void => { this.navigation.pop(); },
            true,
          );
        },
      },
    );
  }

  /** 按路由中的城市 ID 返回分避难所网络城市，失效时不隐式切换。 */
  private settlementCity(
    snapshot: GameUiSnapshot,
    cityId?: string,
  ): GameUiSnapshot["settlementCities"][number] | null {
    return snapshot.settlementCities.find((city) => city.id === cityId) ?? null;
  }

  /** 按路由中的分避难所 ID 返回实时快照，失效时返回空。 */
  private outpost(
    snapshot: GameUiSnapshot,
    outpostId?: string,
  ): GameUiSnapshot["outposts"][number] | null {
    return snapshot.outposts.find(
      (candidate) => candidate.outpostId === outpostId,
    ) ?? null;
  }

  /** 重建“指挥台 → 分避难所总览”页面链，避免成功后残留旧建设上下文。 */
  private readonly returnToSettlementOverview = (): void => {
    this.navigation.reset({ screen: "dashboard" });
    this.navigation.push({ screen: "settlement_network" });
  };

  /** 创建按周封存的历史通讯页。 */
  private createHistory(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createHistoryPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.weeklyArchives,
      this.goBack,
    );
  }

  /**
   * 创建教程、消息或结局页面。
   */
  private createDocumentRoute(
    layout: ResponsiveLayout,
    testId: string,
    documentView: UiDocumentView,
    closeLabel: string,
    onClose: () => void,
  ): PageView {
    return createDocumentPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      testId,
      documentView,
      closeLabel,
      onClose,
    );
  }

  /**
   * 创建返回主菜单的独立确认页。
   */
  private createReturnConfirm(layout: ResponsiveLayout): PageView {
    return createReturnMenuConfirmPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      (): void => {
        void this.returnToMenu();
      },
      this.goBack,
    );
  }

  /** 创建可由 Escape 随时叠加的功能菜单。 */
  private createFunctionMenu(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createFunctionMenuPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.canRollback,
      {
        save: (): void => {
          this.openSaveSlots("save");
        },
        openSettings: (): void => {
          this.openSettings();
        },
        openRollback: (): void => {
          this.navigation.push({ screen: "rollback_confirm" });
          this.render();
        },
        openExit: (): void => {
          this.navigation.push({ screen: "exit_confirm" });
          this.render();
        },
        close: this.goBack,
      },
    );
  }

  /** 创建封面与局内共用的设置页，并仅在局内追加系统导航。 */
  private createSettings(layout: ResponsiveLayout): PageView {
    const inGame = this.navigation.entries()[0]?.screen === "dashboard";
    return createSettingsPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      this.preferences,
      {
        openCoverThemes: (): void => {
          this.navigation.push({ screen: "cover_theme_selector" });
          this.render();
        },
        toggleReducedMotion: this.toggleReducedMotion,
        ...(inGame
          ? {
              openTutorial: (): void => {
                this.openGuidedTutorial();
              },
              openReturnMenu: (): void => {
                this.navigation.push({ screen: "return_menu_confirm" });
                this.render();
              },
            }
          : {}),
        close: this.goBack,
      },
    );
  }

  /** 创建可显示成就锁定状态的主界面封面选择页。 */
  private createCoverThemeSelector(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createCoverThemeSelectorPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      buildCoverThemeSelectionStates(
        this.config.assets.cover_themes,
        this.preferences.selectedCoverThemeId,
        snapshot.unlockedAchievementIds,
      ),
      this.selectCoverTheme,
      this.goBack,
    );
  }

  /** 创建调用独立 rollback_checkpoint 命令的回档确认页。 */
  private createRollbackConfirm(layout: ResponsiveLayout): PageView {
    return createRollbackConfirmPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      (): void => {
        void this.rollbackCheckpoint();
      },
      this.goBack,
    );
  }

  /** 创建封面和游戏内共用的 Web 退出确认页。 */
  private createExitConfirm(layout: ResponsiveLayout): PageView {
    return createExitConfirmPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      this.requestWebExit,
      this.goBack,
    );
  }

  /**
   * 打开指定模式的姓名输入页。
   */
  private openNameInput(mode: GameMode): void {
    this.pendingNewGameRequest = null;
    this.navigation.push({ screen: "name_input", context: { mode } });
    this.render();
  }

  /** 暂存完整建档选择，并把教程位置提示压在建档页之上。 */
  private openPreGameNotice(request: PendingNewGameRequest): void {
    this.pendingNewGameRequest = request;
    this.navigation.push({ screen: "pre_game_notice" });
    this.render();
  }

  /** 关闭开局提示并回到仍保留输入状态的建档页。 */
  private readonly closePreGameNotice = (): void => {
    this.pendingNewGameRequest = null;
    this.goBack();
  };

  /** 从设置退出覆盖页链，确保教程直接叠加在真实指挥台上。 */
  private openGuidedTutorial(): void {
    this.navigation.reset({ screen: "dashboard" });
    this.navigation.push({ screen: "tutorial" });
    this.render(true);
  }

  /** 让紧凑布局中的教程目标先滚入视口，再计算聚焦边界。 */
  private revealTutorialTarget(targetTestId: string): void {
    const dashboard = [...this.renderedPages]
      .reverse()
      .find((entry) => entry.route.screen === "dashboard")?.view;
    if (dashboard instanceof DashboardPage) {
      dashboard.revealTutorialTarget(
        targetTestId,
        this.config.guided_tutorial.spotlight_padding,
      );
    }
  }

  /** 完成或跳过分步引导后回到它下方的指挥台。 */
  private readonly closeGuidedTutorial = (): void => {
    this.navigation.pop();
    this.render(true);
  };

  /** 播放制作方开场后再建立封面与自动更新日志层级。 */
  private readonly completePublisherSplash = (): void => {
    if (this.navigation.current().screen !== "publisher_splash") {
      return;
    }
    this.navigation.reset({ screen: "menu" });
    if (this.config.update_log.auto_open) {
      this.navigation.push({ screen: "update_log" });
    }
    this.render(true);
  };

  /** 按读取或写入语义打开六栏存档覆盖页。 */
  private openSaveSlots(mode: SaveSlotsPageMode): void {
    this.navigation.push({
      screen: "save_slots",
      context: { saveSlotsMode: mode },
    });
    this.render();
  }

  /** 返回由配置提供的更新日志长文档。 */
  private updateLogDocument(): UiDocumentView {
    return {
      title: this.config.texts.update_log_title,
      body: this.config.texts.update_log_body,
      tone: "default",
    };
  }

  /**
   * 进入剧情，并优先恢复战斗或展示已生成结局。
   */
  private openStory(): void {
    const snapshot = this.requireSnapshot();
    if (snapshot.ending !== null || snapshot.ended) {
      this.navigation.push({ screen: "ending" });
    } else if (snapshot.battle !== null) {
      this.navigation.push({ screen: "battle" });
    } else {
      this.navigation.push({ screen: "story" });
    }
    this.render();
  }

  /**
   * 打开经营类别中的项目页。
   */
  private openManagementOptions(categoryId: string): void {
    this.navigation.push({
      screen: "management_options",
      context: { categoryId },
    });
    this.render();
  }

  /** 在经营项目执行前先压入需求详情页。 */
  private openManagementOptionDetail(categoryId: string, optionId: string): void {
    const option = this.requireSnapshot().managementCategories
      .find((category) => category.id === categoryId)
      ?.options.find((candidate) => candidate.id === optionId);
    this.navigation.push({
      screen: "management_option_detail",
      context: {
        categoryId,
        optionId,
        repetitions: option?.repetitionOptions[0],
      },
    });
    this.render();
  }

  /** 从伙伴列表压入指定人物的完整档案。 */
  private readonly openCompanionDetail = (companionId: string): void => {
    this.navigation.push({ screen: "companion_detail", context: { companionId } });
    this.render();
  };

  /** 从角色档案直接打开武器或防具实时仓库列表。 */
  private readonly openCompanionEquipment = (
    companionId: string,
    equipmentSlot: UiCompanionEquipmentSlot,
  ): void => {
    this.navigation.push({
      screen: "companion_equipment",
      context: { companionId, equipmentSlot },
    });
    this.render();
  };

  /** 从角色档案直接打开配置化互动列表。 */
  private readonly openCompanionInteraction = (companionId: string): void => {
    this.navigation.push({
      screen: "companion_interaction",
      context: { companionId },
    });
    this.render();
  };

  /** 将选中房间作为纯展示路由上下文压入页面栈。 */
  private readonly openShelterRoomPlanning = (roomId: string): void => {
    this.navigation.push({
      screen: "shelter_room_planning",
      context: { roomId },
    });
    this.render();
  };

  /** 把文献分类作为二级页叠加在存储总览上。 */
  private readonly openArchiveCollection = (collectionId: string): void => {
    this.navigation.push({
      screen: "archive_collection",
      context: { collectionId },
    });
    this.render();
  };

  /** 打开已解锁正文；锁定项则叠加需求说明页。 */
  private openArchiveDocument(
    collectionId: string,
    documentId: string,
    unlocked: boolean,
  ): void {
    if (!unlocked) {
      const document = this.requireSnapshot().archiveCollections[collectionId]
        ?.documents.find((candidate) => candidate.documentId === documentId);
      this.navigation.push({
        screen: "message",
        context: {
          document: {
            title: document?.title ?? this.config.texts.archive_storage_title,
            body: document?.requirementText ?? this.config.texts.encounter_unavailable,
            tone: "warning",
          },
        },
      });
      this.render();
      return;
    }
    this.navigation.push({
      screen: "archive_document",
      context: { collectionId, documentId },
    });
    this.render();
  }

  /** 把选中的遭遇作为路由上下文压入页面栈，并重置旧整备草稿。 */
  private openEncounterPreparation(encounterId: string): void {
    this.encounterPreparationSelection = emptyEncounterPreparationSelection();
    this.navigation.push({
      screen: "encounter_preparation",
      context: { encounterId },
    });
    this.render();
  }

  /** 为一名参战单位选择职责并保留其他单位与治疗草稿。 */
  private readonly selectEncounterPreparationRole = (
    memberId: string,
    roleId: string,
  ): void => {
    this.encounterPreparationSelection = {
      ...this.encounterPreparationSelection,
      roleIdsByMember: {
        ...this.encounterPreparationSelection.roleIdsByMember,
        [memberId]: roleId,
      },
    };
    this.render(true);
  };

  /** 切换一名单位的战前治疗计划，实际医疗物资延迟到开战时扣除。 */
  private readonly toggleEncounterPreparationTreatment = (memberId: string): void => {
    const selected = new Set(this.encounterPreparationSelection.treatedMemberIds);
    if (selected.has(memberId)) {
      selected.delete(memberId);
    } else {
      selected.add(memberId);
    }
    this.encounterPreparationSelection = {
      ...this.encounterPreparationSelection,
      treatedMemberIds: [...selected],
    };
    this.render(true);
  };

  /** 切换当前待行动队员并清除旧行动和目标草稿。 */
  private readonly selectEncounterActor = (actorId: string): void => {
    this.encounterSelection = { actorId, actionId: null, targetId: null };
    this.render(true);
  };

  /** 选择一项战斗行动并要求重新确认目标。 */
  private readonly selectEncounterAction = (actionId: string): void => {
    this.encounterSelection = {
      ...this.encounterSelection,
      actionId,
      targetId: null,
    };
    this.render(true);
  };

  /** 选择攻击、治疗或道具作用目标。 */
  private readonly selectEncounterTarget = (targetId: string): void => {
    this.encounterSelection = { ...this.encounterSelection, targetId };
    this.render(true);
  };

  /** 根据待决事件和远征上下文打开正确的探索页。 */
  private openExpedition(): void {
    const snapshot = this.requireSnapshot();
    const screen = resolveExpeditionEntryScreen(snapshot);
    if (screen === "expedition_city_list") {
      this.expeditionDraft = emptyExpeditionDraft();
    }
    this.navigation.push({ screen });
    this.render();
  }

  /** 把远征状态作为底页，并仅在出发成功时叠加开场事件栏。 */
  private routeToExpeditionOpeningEvent(snapshot: GameUiSnapshot): boolean {
    const status = snapshot.expeditionStatus;
    if (status === null || snapshot.explorationPrompt === null) {
      return false;
    }
    this.navigation.reset({ screen: "dashboard" });
    this.navigation.push({ screen: "expedition_status" });
    this.navigation.push({
      screen: "district_exploration_tree",
      context: {
        cityId: status.cityId,
        districtId: status.districtId,
        districtExplorationPath: [],
      },
    });
    return true;
  }

  /** 打开手机、电脑和功能菜单共用的设置页面。 */
  private openSettings(): void {
    this.navigation.push({ screen: "settings" });
    this.render();
  }

  /**
   * 把指挥台行动和导航统一解析为无副作用意图。
   */
  private readonly handleDashboardEntry = (entryId: string): void => {
    const intent = resolveDashboardNavigationIntent(
      entryId,
      this.dashboardNavigationPolicy,
    );
    if (intent !== null) {
      this.executeDashboardNavigationIntent(intent);
    }
  };

  /** 执行已解析的局内导航意图，并集中维护页面栈副作用。 */
  private executeDashboardNavigationIntent(
    intent: DashboardNavigationIntent,
  ): void {
    switch (intent.type) {
      case "reset_dashboard":
        this.navigation.reset({ screen: "dashboard" });
        break;
      case "open_story":
        this.openStory();
        return;
      case "open_expedition":
        this.openExpedition();
        return;
      case "open_management_category":
        this.openManagementOptions(intent.categoryId);
        return;
      case "push_screen":
        if (intent.screen === "settings") {
          this.openSettings();
          return;
        }
        if (
          intent.screen === "encounter_catalog"
          && this.requireSnapshot().encounterBattle !== null
        ) {
          this.navigation.push({ screen: "encounter_battle" });
          break;
        }
        this.navigation.push({ screen: intent.screen });
        break;
      case "save_game":
        this.openSaveSlots("save");
        return;
      case "perform_supply_action":
        void this.performSupplyAction(intent.actionId);
        return;
    }
    this.render();
  }

  /**
   * 处理物资页中的保障行动。
   */
  private readonly handleSupplyAction = (action: UiOptionView): void => {
    void this.performSupplyAction(action.id);
  };

  /**
   * 返回上一页；探索事件另有带代价的专用返回处理。
   */
  private readonly goBack = (): void => {
    this.navigation.pop();
    this.render();
  };

  /**
   * 关闭结局后回到已结束的指挥台。
   */
  private readonly closeEnding = (): void => {
    this.navigation.reset({ screen: "dashboard" });
    this.render();
  };

  /**
   * 向应用层提交新游戏命令。
   */
  private async startGame(
    mode: GameMode,
    playerNames: readonly string[],
    profile: UiCampaignProfileSelection,
    saveSlotId: number,
    showTutorial = false,
  ): Promise<void> {
    this.expeditionDraft = emptyExpeditionDraft();
    this.encounterSelection = emptyEncounterBattleSelection();
    this.encounterPreparationSelection = emptyEncounterPreparationSelection();
    await this.execute(
      { type: "start_game", mode, playerNames, profile, saveSlotId },
      (): void => {
        this.pendingNewGameRequest = null;
        this.beginConnectionTransition(showTutorial);
      },
    );
  }

  /** 按开局提示选择启动战役，并决定通讯完成后是否叠加引导。 */
  private async startPendingNewGame(showTutorial: boolean): Promise<void> {
    const request = this.pendingNewGameRequest;
    if (request === null) {
      this.closePreGameNotice();
      return;
    }
    await this.startGame(
      request.mode,
      request.playerNames,
      request.profile,
      request.saveSlotId,
      showTutorial,
    );
  }

  /**
   * 从本地存档恢复游戏。
   */
  private async loadGame(slotId: number): Promise<void> {
    this.expeditionDraft = emptyExpeditionDraft();
    this.encounterSelection = emptyEncounterBattleSelection();
    this.encounterPreparationSelection = emptyEncounterPreparationSelection();
    await this.execute(
      { type: "load_game", slotId },
      (): void => { this.beginConnectionTransition(); },
    );
  }

  /** 以配置化时长启动通讯过场，完成后进入指挥台或已生成结局。 */
  private beginConnectionTransition(showTutorial = false): void {
    this.clearConnectionTimer();
    this.navigation.reset({ screen: "connection" });
    this.connectionTimer = globalThis.setTimeout(() => {
      this.connectionTimer = null;
      if (!this.mounted || this.navigation.current().screen !== "connection") {
        return;
      }
      this.navigation.reset({ screen: "dashboard" });
      if (this.requireSnapshot().ended) {
        this.navigation.push({ screen: "ending" });
      } else if (this.requireSnapshot().expeditionFailure !== null) {
        this.navigation.push({ screen: "expedition_failure" });
      } else if (this.requireSnapshot().returnIncident !== null) {
        this.navigation.push({ screen: "return_incident" });
      } else if (this.requireSnapshot().encounterBattle !== null) {
        this.navigation.push({ screen: "encounter_battle" });
      } else if (showTutorial) {
        this.navigation.push({ screen: "tutorial" });
      }
      this.render(true);
    }, this.connectionDuration());
  }

  /** 尊重减少动效偏好并只使用配置中的过场时长。 */
  private connectionDuration(): number {
    return this.preferences.reducedMotion
      ? this.config.motion.page_transition_ms
      : this.config.motion.connection_transition_ms;
  }

  /** 取消未完成的通讯过场计时。 */
  private clearConnectionTimer(): void {
    if (this.connectionTimer === null) {
      return;
    }
    globalThis.clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  /**
   * 保存当前完整进度。
   */
  private async saveGame(slotId: number): Promise<void> {
    await this.execute(
      { type: "save_game", slotId },
      (): void => { this.navigation.pop(); },
      true,
    );
    this.canLoad = await Promise.resolve(this.port.canLoadGame());
  }

  /** 回到最近领域检查点，禁止退化为普通读档命令。 */
  private async rollbackCheckpoint(): Promise<void> {
    await this.execute(
      { type: "rollback_checkpoint" },
      (): void => { this.navigation.reset({ screen: "dashboard" }); },
      true,
    );
    this.canLoad = await Promise.resolve(this.port.canLoadGame());
  }

  /** 切换并持久化减少动效偏好，然后刷新当前设置页。 */
  private readonly toggleReducedMotion = (): void => {
    this.preferences = {
      ...this.preferences,
      reducedMotion: !this.preferences.reducedMotion,
    };
    this.settingsPort.save(this.preferences);
    this.render(true);
  };

  /** 仅允许选择已解锁主题，并把偏好保存到独立设置仓库。 */
  private readonly selectCoverTheme = (themeId: string): void => {
    const theme = this.config.assets.cover_themes.items.find(
      (candidate) => candidate.id === themeId,
    );
    const unlockedIds = this.requireSnapshot().unlockedAchievementIds;
    if (theme === undefined || !isCoverThemeUnlocked(theme, unlockedIds)) {
      return;
    }
    this.preferences = {
      ...this.preferences,
      selectedCoverThemeId: theme.id,
    };
    this.settingsPort.save(this.preferences);
    this.render(true);
  };

  /** 根据当前偏好与元成就进度返回实际可渲染封面。 */
  private resolveActiveCoverTheme(snapshot: GameUiSnapshot): CoverThemeTokens {
    return resolveSelectedCoverTheme(
      this.config.assets.cover_themes,
      this.preferences.selectedCoverThemeId,
      snapshot.unlockedAchievementIds,
    );
  }

  /** 按配置策略尝试关闭或回退当前 Web 页面。 */
  private readonly requestWebExit = (): void => {
    const browserWindow = getBrowserWindow();
    if (browserWindow === null) {
      this.showExitFailure();
      return;
    }
    this.clearExitVerificationTimer();
    this.removeBrowserBackGuard();
    const strategy = this.config.web_exit.strategy;
    try {
      if (strategy === "close_only" || strategy === "close_then_history_back") {
        browserWindow.close();
      }
      if (strategy === "history_back" || strategy === "close_then_history_back") {
        browserWindow.history.go(-this.config.web_exit.history_back_steps);
      }
    } catch {
      this.installBrowserBackGuard();
      this.showExitFailure();
      return;
    }
    this.exitVerificationTimer = globalThis.setTimeout(() => {
      this.exitVerificationTimer = null;
      if (
        this.mounted &&
        !browserWindow.closed &&
        browserWindow.document.visibilityState !== "hidden"
      ) {
        this.installBrowserBackGuard();
        this.showExitFailure();
      }
    }, this.config.web_exit.verification_delay_ms);
  };

  /** 展示浏览器阻止关闭时的配置化提示页。 */
  private showExitFailure(): void {
    if (this.navigation.current().screen === "exit_confirm") {
      this.navigation.pop();
    }
    this.navigation.push({
      screen: "message",
      context: {
        document: {
          title: this.config.texts.exit_failed_title,
          body: this.config.texts.exit_failed_body,
          tone: "warning",
        },
      },
    });
    this.render();
  }

  /** 取消尚未完成的退出验证计时。 */
  private clearExitVerificationTimer(): void {
    if (this.exitVerificationTimer === null) {
      return;
    }
    globalThis.clearTimeout(this.exitVerificationTimer);
    this.exitVerificationTimer = null;
  }

  /**
   * 提交剧情选择并按战斗或结局状态导航。
   */
  private async chooseStory(choiceId: string): Promise<void> {
    await this.execute(
      { type: "story_choice", choiceId },
      (): void => {
        const snapshot = this.requireSnapshot();
        const nextScreen = resolveStoryProgressScreen(snapshot);
        if (nextScreen === "dashboard") {
          this.navigation.reset({ screen: "dashboard" });
        } else {
          this.navigation.replace({ screen: nextScreen });
        }
      },
      true,
    );
  }

  /**
   * 抽取并锁定城市探索事件。
   */
  private async prepareExploration(cityId: string): Promise<void> {
    await this.execute(
      { type: "exploration_prepare", cityId },
      (): void => { this.navigation.replace({ screen: "exploration_event" }); },
    );
  }

  /**
   * 结算探索事件选择。
   */
  private async resolveExploration(choiceId: string): Promise<void> {
    await this.execute(
      { type: "exploration_resolve", choiceId },
      (): void => { this.navigateAfterExpeditionProgress(); },
    );
  }

  /**
   * 执行探索事件的有代价撤离。
   */
  private async retreatExploration(): Promise<void> {
    await this.execute(
      { type: "exploration_retreat" },
      (): void => {
        this.navigation.reset({
          screen: this.requireSnapshot().returnIncident === null
            ? "dashboard"
            : "return_incident",
        });
      },
    );
  }

  /** 提交一项研发并将领域反馈作为独立消息页展示。 */
  private async completeResearch(projectId: string): Promise<void> {
    await this.execute(
      { type: "research_complete", projectId },
      (): void => undefined,
      true,
    );
  }

  /** 将仓库样本放入研究台单槽，并保留研究台作为底层页面。 */
  private async slotResearchItem(itemId: string): Promise<void> {
    await this.execute(
      { type: "research_slot", itemId },
      (): void => undefined,
      true,
    );
  }

  /** 取回研究台样本，并保留研究台作为底层页面。 */
  private async clearResearchSlot(): Promise<void> {
    await this.execute(
      { type: "research_clear" },
      (): void => undefined,
      true,
    );
  }

  /** 提交一张制作配方并保留工坊为底层页面。 */
  private async craftItem(recipeId: string): Promise<void> {
    await this.execute(
      { type: "craft_item", recipeId },
      (): void => undefined,
      true,
    );
  }

  /** 提交一件可用装备并保留仓库为底层页面。 */
  private async equipWarehouseItem(itemId: string): Promise<void> {
    await this.execute(
      { type: "equip_item", itemId },
      (): void => undefined,
      true,
    );
  }

  /** 提交一辆载具的装备或卸下意图并保留设置页。 */
  private async toggleTransport(itemId: string): Promise<void> {
    await this.execute(
      { type: "transport_toggle", itemId },
      (): void => undefined,
      true,
    );
  }

  /** 向应用层提交伙伴栏位装备或卸下意图。 */
  private async equipCompanion(
    companionId: string,
    slot: UiCompanionEquipmentSlot,
    itemId: string | null,
  ): Promise<void> {
    await this.execute(
      { type: "companion_equip", companionId, slot, itemId },
      (): void => undefined,
      true,
    );
  }

  /** 向应用层提交一次配置化伙伴互动。 */
  private async interactWithCompanion(
    companionId: string,
    interactionId: string,
  ): Promise<void> {
    await this.execute(
      { type: "companion_interact", companionId, interactionId },
      (): void => undefined,
      true,
    );
  }

  /** 提交一次房间人员调动，成功后原位刷新规划页。 */
  private async changeShelterRoomAssignment(
    residentId: string,
    targetRoomId: string | null,
  ): Promise<void> {
    await this.execute(
      {
        type: "shelter_room_assignment_change",
        residentId,
        targetRoomId,
      },
      (): void => undefined,
    );
  }

  /** 提交完整战前整备方案，并在原子校验成功后用战斗页替换整备页。 */
  private async startEncounter(encounterId: string): Promise<void> {
    const runtime = this.requireSnapshot().encounterPreparations[encounterId];
    if (runtime === undefined) return;
    const plan = resolveEncounterPreparationPlan(
      runtime,
      this.encounterPreparationSelection,
    );
    if (plan === null) return;
    await this.execute(
      {
        type: "encounter_start",
        encounterId,
        roleIdsByMember: plan.role_ids_by_member,
        treatedMemberIds: plan.treated_member_ids,
      },
      (): void => {
        this.encounterSelection = emptyEncounterBattleSelection();
        this.encounterPreparationSelection = emptyEncounterPreparationSelection();
        this.navigation.replace({ screen: "encounter_battle" });
      },
    );
  }

  /** 执行当前完整战斗草稿，或在战斗结束后归档并返回指挥台。 */
  private async executeEncounterSelection(): Promise<void> {
    const runtime = this.requireSnapshot().encounterBattle;
    if (runtime === null) return;
    if (runtime.state.outcome !== "ongoing") {
      await this.execute(
        { type: "encounter_finish" },
        (): void => {
          this.encounterSelection = emptyEncounterBattleSelection();
          this.navigation.reset({ screen: "dashboard" });
        },
      );
      return;
    }
    const draft = resolveEncounterExecutionDraft(runtime, this.encounterSelection);
    if (draft === null) return;
    await this.execute(
      { type: "encounter_action", ...draft },
      (): void => {
        this.encounterSelection = emptyEncounterBattleSelection();
        const snapshot = this.requireSnapshot();
        if (snapshot.ending !== null || snapshot.ended) {
          this.navigation.replace({ screen: "ending" });
        }
      },
    );
  }

  /** 结算归来事项并回到指挥台或失败结局。 */
  private async chooseReturnIncident(choiceId: string): Promise<void> {
    await this.execute(
      { type: "return_incident_choose", choiceId },
      (): void => {
        const snapshot = this.requireSnapshot();
        this.navigation.reset({
          screen: snapshot.ending !== null || snapshot.ended
            ? "ending"
            : "dashboard",
        });
      },
      true,
    );
  }

  /** 保存远征目标城市并进入详情页，区划选择随城市切换而重置。 */
  private readonly openExpeditionCity = (cityId: string): void => {
    this.expeditionDraft = {
      ...this.expeditionDraft,
      cityId,
      districtId: null,
    };
    this.navigation.push({
      screen: "expedition_city_detail",
      context: { cityId },
    });
    this.render();
  };

  /** 切换一名同行伙伴的 UI 草稿选中态。 */
  private readonly toggleExpeditionCompanion = (companionId: string): void => {
    const companionIds = new Set(this.expeditionDraft.companionIds);
    if (companionIds.has(companionId)) {
      companionIds.delete(companionId);
    } else {
      companionIds.add(companionId);
    }
    this.expeditionDraft = { ...this.expeditionDraft, companionIds };
    this.render(true);
  };

  /** 将一份可用库存加入远征携带草稿。 */
  private readonly increaseExpeditionItem = (itemId: string): void => {
    this.adjustExpeditionItemQuantity(itemId, 1);
  };

  /** 从远征携带草稿中减少一份物资。 */
  private readonly decreaseExpeditionItem = (itemId: string): void => {
    this.adjustExpeditionItemQuantity(itemId, -1);
  };

  /** 在零和可用库存之间夹取远征携带数量。 */
  private adjustExpeditionItemQuantity(itemId: string, delta: -1 | 1): void {
    const item = this.requireSnapshot().expeditionCarryItems.find(
      (candidate) => candidate.id === itemId,
    );
    if (item === undefined) {
      return;
    }
    const currentItems = this.expeditionDraft.carriedItems;
    const currentQuantity = currentItems[itemId] ?? 0;
    const nextQuantity = Math.max(
      0,
      Math.min(item.availableQuantity, currentQuantity + delta),
    );
    if (nextQuantity === currentQuantity) {
      return;
    }
    const carriedItems = nextQuantity === 0
      ? Object.fromEntries(
          Object.entries(currentItems).filter(([candidateId]) => candidateId !== itemId),
        )
      : { ...currentItems, [itemId]: nextQuantity };
    this.expeditionDraft = { ...this.expeditionDraft, carriedItems };
    this.render(true);
  }

  /** 提交整备草稿并进入已锁定的首个远征事件。 */
  private async beginExpedition(): Promise<void> {
    const cityId = this.expeditionDraft.cityId;
    if (cityId === null || this.expeditionDraft.districtId === null) {
      return;
    }
    await this.execute(
      {
        type: "expedition_begin",
        cityId,
        districtId: this.expeditionDraft.districtId,
        companionIds: [...this.expeditionDraft.companionIds],
        carriedItems: { ...this.expeditionDraft.carriedItems },
      },
      (): void => {
        this.expeditionDraft = emptyExpeditionDraft();
        this.navigateAfterExpeditionBegin();
      },
    );
  }

  /** 出发成功后先弹出一次区划开场事件，强制返程则走通用结算。 */
  private navigateAfterExpeditionBegin(): void {
    const snapshot = this.requireSnapshot();
    if (this.routeToExpeditionOpeningEvent(snapshot)) {
      return;
    }
    this.navigateAfterExpeditionProgress();
  }

  /** 扣除远征步数并在可继续时进入新事件。 */
  private async continueExpedition(): Promise<void> {
    await this.execute(
      { type: "expedition_continue" },
      (): void => { this.navigateAfterExpeditionProgress(); },
    );
  }

  /** 结算携带物与战利品后回到指挥台。 */
  private async safeReturnExpedition(): Promise<void> {
    await this.execute(
      { type: "expedition_safe_return" },
      (): void => {
        this.navigation.reset({
          screen: this.requireSnapshot().returnIncident === null
            ? "dashboard"
            : "return_incident",
        });
      },
    );
  }

  /** 根据命令后快照替换为事件、远征状态或指挥台。 */
  private navigateAfterExpeditionProgress(): void {
    const snapshot = this.requireSnapshot();
    const screen = resolveExpeditionProgressScreen(snapshot);
    if (screen === "expedition_failure") {
      this.navigation.reset({ screen: "dashboard" });
      this.navigation.push({ screen });
      return;
    }
    if (snapshot.returnIncident !== null) {
      this.navigation.reset({ screen: "return_incident" });
      return;
    }
    if (screen === "dashboard") {
      this.navigation.reset({ screen });
    } else if (screen === "expedition_status") {
      this.navigation.reset({ screen: "dashboard" });
      this.navigation.push({ screen });
    } else {
      this.navigation.replace({ screen });
    }
  }

  /** 确认强制返程损失后，优先处理已排队的归来事项。 */
  private readonly continueAfterExpeditionFailure = (): void => {
    this.navigation.reset({
      screen: this.requireSnapshot().returnIncident === null
        ? "dashboard"
        : "return_incident",
    });
    this.render();
  };

  /**
   * 执行一个战斗回合。
   */
  private async performCombatAction(actionId: string): Promise<void> {
    await this.execute(
      { type: "combat_action", actionId },
      (): void => {
        const snapshot = this.requireSnapshot();
        if (snapshot.ending !== null || snapshot.ended) {
          this.navigation.replace({ screen: "ending" });
        } else if (snapshot.battle === null) {
          this.navigation.reset({ screen: "dashboard" });
        }
      },
      true,
    );
  }

  /**
   * 执行经营项目并保留当前经营类别上下文。
   */
  private async performManagementAction(
    categoryId: string,
    optionId: string,
    repetitions = 1,
  ): Promise<void> {
    await this.execute(
      { type: "management_action", categoryId, optionId, repetitions },
      (): void => undefined,
      true,
    );
  }

  /**
   * 执行进食、治疗、供餐或修复行动。
   */
  private async performSupplyAction(actionId: string): Promise<void> {
    await this.execute(
      { type: "supply_action", actionId },
      (): void => undefined,
      true,
    );
  }

  /**
   * 确认返回封面，并通知应用层释放当前指挥上下文。
   */
  private async returnToMenu(): Promise<void> {
    this.clearConnectionTimer();
    this.expeditionDraft = emptyExpeditionDraft();
    this.encounterSelection = emptyEncounterBattleSelection();
    this.encounterPreparationSelection = emptyEncounterPreparationSelection();
    this.pendingNewGameRequest = null;
    await this.execute(
      { type: "return_to_menu" },
      (): void => { this.navigation.reset({ screen: "menu" }); },
    );
    this.canLoad = await Promise.resolve(this.port.canLoadGame());
  }

  /**
   * 串行执行领域命令，应用导航指令并选择性展示独立消息页。
   */
  private async execute(
    command: GameUiCommand,
    fallbackNavigation: () => void,
    showNoticePage = false,
  ): Promise<void> {
    if (this.executing) {
      return;
    }
    this.executing = true;
    try {
      const result = await Promise.resolve(this.port.execute(command));
      this.snapshot =
        result.snapshot ?? (await Promise.resolve(this.port.getSnapshot()));
      if (result.navigation !== undefined) {
        this.applyNavigation(result.navigation);
      } else if (result.accepted) {
        fallbackNavigation();
      }
      const notice = result.notice ?? this.snapshot.notice;
      if (notice !== null && (showNoticePage || !result.accepted)) {
        this.navigation.push({
          screen: "message",
          context: {
            document: {
              title: notice.title ?? "",
              body: notice.message,
              tone: notice.tone,
            },
          },
        });
      }
      this.render(true);
    } finally {
      this.executing = false;
    }
  }

  /**
   * 把应用层导航指令映射到本地页面栈。
   */
  private applyNavigation(directive: UiNavigationDirective): void {
    if (directive.operation === "stay") {
      return;
    }
    if (directive.operation === "pop") {
      this.navigation.pop();
      return;
    }
    if (directive.screen === undefined) {
      return;
    }
    const route: GameRoute = { screen: directive.screen };
    if (directive.operation === "push") {
      this.navigation.push(route);
    } else if (directive.operation === "replace") {
      this.navigation.replace(route);
    } else {
      this.navigation.reset(route);
    }
  }

  /** Escape 在游戏中打开功能菜单，在菜单链内部则只关闭最上层。 */
  private toggleFunctionMenu(): void {
    const screen = this.navigation.current().screen;
    if (
      screen === "publisher_splash"
      || screen === "menu"
      || screen === "connection"
    ) {
      return;
    }
    const routes = this.navigation.entries();
    if (routes[0]?.screen === "menu") {
      this.requestBack();
      return;
    }
    const functionMenuDepth = routes.findIndex(
      (route) => route.screen === "function_menu",
    );
    if (functionMenuDepth >= 0) {
      this.goBack();
      return;
    }
    if (this.snapshot?.mode === null || screen === "name_input") {
      this.requestBack();
      return;
    }
    this.navigation.push({ screen: "function_menu" });
    this.render();
  }

  /**
   * 按当前页面执行统一返回语义。
   */
  private requestBack(): void {
    const route = this.navigation.current();
    const screen = route.screen;
    if (screen === "menu") {
      return;
    }
    if (screen === "dashboard") {
      this.navigation.push({ screen: "function_menu" });
      this.render();
      return;
    }
    if (screen === "exploration_event") {
      void this.retreatExploration();
      return;
    }
    if (screen === "district_exploration_tree") {
      this.backFromDistrictExplorationTree(route);
      return;
    }
    if (screen === "return_incident") {
      return;
    }
    if (screen === "ending") {
      this.closeEnding();
      return;
    }
    this.goBack();
  }

  /**
   * 安装单个浏览器历史哨兵，使系统返回键先回退游戏页面。
   */
  private installBrowserBackGuard(): void {
    const browserWindow = getBrowserWindow();
    if (browserWindow === null || this.browserGuardInstalled) {
      return;
    }
    browserWindow.history.replaceState(
      { gameUi: true },
      browserWindow.document.title,
    );
    browserWindow.history.pushState(
      { gameUi: true },
      browserWindow.document.title,
    );
    browserWindow.addEventListener("popstate", this.handleBrowserBack);
    this.browserGuardInstalled = true;
  }

  /**
   * 移除浏览器返回监听，防止热重载后重复处理。
   */
  private removeBrowserBackGuard(): void {
    const browserWindow = getBrowserWindow();
    if (browserWindow === null || !this.browserGuardInstalled) {
      return;
    }
    browserWindow.removeEventListener("popstate", this.handleBrowserBack);
    this.browserGuardInstalled = false;
  }

  /** 监听可视视口和原生输入焦点，覆盖手机软键盘的独立 resize 链路。 */
  private installViewportListeners(): void {
    const browserWindow = getBrowserWindow();
    if (browserWindow === null || this.viewportListenersInstalled) {
      return;
    }
    browserWindow.document.addEventListener(
      "focusout",
      this.handleTextEntryFocusOut,
    );
    browserWindow.visualViewport?.addEventListener(
      "resize",
      this.handleResize,
    );
    this.viewportListenersInstalled = true;
  }

  /** 移除手机视口与输入焦点监听，避免热重载留下重复回调。 */
  private removeViewportListeners(): void {
    const browserWindow = getBrowserWindow();
    if (browserWindow === null || !this.viewportListenersInstalled) {
      return;
    }
    browserWindow.document.removeEventListener(
      "focusout",
      this.handleTextEntryFocusOut,
    );
    browserWindow.visualViewport?.removeEventListener(
      "resize",
      this.handleResize,
    );
    this.viewportListenersInstalled = false;
  }

  /**
   * 返回配置中的底部导航标签。
   */
  private navigationLabel(id: string): string {
    return this.findNavigation(id)?.label ?? "";
  }

  /**
   * 查找配置化底部导航项。
   */
  private findNavigation(id: string): NavigationToken | undefined {
    return this.config.navigation.find((item) => item.id === id);
  }

  /** 从远征领域读模型建立稳定名称映射，避免读档后泄露内部 ID。 */
  private expeditionItemNameMap(
    snapshot: GameUiSnapshot,
  ): ReadonlyMap<string, string> {
    return new Map(Object.entries(snapshot.expeditionStatus?.itemNames ?? {}));
  }

  /**
   * 构造缺少内容时仍可安全渲染的空选择模型。
   */
  private emptyPrompt(title: string): UiPromptView {
    return { id: "empty", title, body: "", options: [] };
  }

  /**
   * 构造缺少内容时仍可安全渲染的空文档模型。
   */
  private emptyDocument(title: string): UiDocumentView {
    return { title, body: "" };
  }

  /**
   * 获取当前快照；未挂载时抛出明确错误。
   */
  private requireSnapshot(): GameUiSnapshot {
    if (this.snapshot === null) {
      throw new Error("游戏 UI 尚未收到领域快照。");
    }
    return this.snapshot;
  }
}

/**
 * 在组合边界验证注入的 Laya 构造器和事件常量。
 */
function expectLayaRuntime(value: unknown): LayaRuntimeLike {
  const valueType = typeof value;
  if (
    value === null ||
    (valueType !== "object" && valueType !== "function")
  ) {
    throw new Error("GameShell 需要一个有效的 LayaAir 运行时。");
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const eventType = typeof candidate.Event;
  if (
    typeof candidate.Sprite !== "function" ||
    typeof candidate.Text !== "function" ||
    typeof candidate.Input !== "function" ||
    typeof candidate.Image !== "function" ||
    typeof candidate.Rectangle !== "function" ||
    (eventType !== "function" && eventType !== "object") ||
    candidate.Event === null ||
    typeof candidate.stage !== "object" ||
    candidate.stage === null
  ) {
    throw new Error("传入对象不满足 LayaAir 运行时契约。");
  }
  return value as unknown as LayaRuntimeLike;
}

/**
 * 判断未知键盘事件是否表示 Escape。
 */
function isEscapeEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) {
    return false;
  }
  const keyboardEvent = event as {
    readonly key?: unknown;
    readonly keyCode?: unknown;
  };
  return keyboardEvent.key === "Escape" || keyboardEvent.keyCode === 27;
}

/**
 * 在浏览器环境中返回 Window，在无 DOM 测试环境返回空值。
 */
function getBrowserWindow(): Window | null {
  return (globalThis as { window?: Window }).window ?? null;
}

/** 判断当前活动元素是否为会唤起手机软键盘的文本输入控件。 */
function isTextEntryElement(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" ||
    tagName === "textarea" ||
    element.getAttribute("contenteditable") === "true";
}

/** 创建一份不共享可变容器的空远征整备草稿。 */
function emptyExpeditionDraft(): ExpeditionDraft {
  return {
    cityId: null,
    districtId: null,
    companionIds: new Set<string>(),
    carriedItems: {},
  };
}

/**
 * 在边界处验证引擎舞台具有 UI 所需的最小能力。
 */
function expectLayaStage(value: unknown): LayaStageLike {
  if (typeof value !== "object" || value === null) {
    throw new Error("GameShell 需要一个有效的 LayaAir 舞台。");
  }
  const candidate = value as Partial<LayaStageLike>;
  if (
    typeof candidate.addChild !== "function" ||
    typeof candidate.on !== "function" ||
    typeof candidate.off !== "function" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number"
  ) {
    throw new Error("传入对象不满足 LayaAir 舞台契约。");
  }
  return value as LayaStageLike;
}
