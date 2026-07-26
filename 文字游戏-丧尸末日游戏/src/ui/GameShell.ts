import { resolveResponsiveLayout } from "../styles/ResponsiveLayout";
import type { ResponsiveLayout } from "../styles/ResponsiveLayout";
import type { GameUiConfig, NavigationToken } from "../styles/GameTheme";
import { UiFactory } from "./components/UiFactory";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
  LayaStageLike,
} from "./laya/LayaRuntime";
import { PageStack } from "./navigation/PageStack";
import type { GameRoute } from "./navigation/PageStack";
import { DeferredResizeCoordinator } from "./interactions/DeferredResizeCoordinator";
import {
  resolveExpeditionEntryScreen,
  resolveExpeditionProgressScreen,
} from "./navigation/ExpeditionNavigation";
import { createChoicePage } from "./pages/ChoicePage";
import { createCompanionsPage } from "./pages/CompanionsPage";
import { createConfirmPage } from "./pages/ConfirmPage";
import { ConnectionPage } from "./pages/ConnectionPage";
import { CoverPage } from "./pages/CoverPage";
import { DashboardPage } from "./pages/DashboardPage";
import { createDocumentPage } from "./pages/DocumentPage";
import {
  createExpeditionPreparePage,
  createExpeditionStatusPage,
  type ExpeditionDraft,
} from "./pages/ExpeditionPages";
import { createNameInputPage } from "./pages/NameInputPage";
import type { PageView } from "./pages/PageView";
import { createSuppliesPage } from "./pages/SuppliesPage";
import {
  createCraftingPage,
  createHistoryPage,
  createResearchPage,
  createWarehousePage,
} from "./pages/SystemFeaturePages";
import {
  createCreditsPage,
  createExitConfirmPage,
  createFunctionMenuPage,
  createRollbackConfirmPage,
  createSettingsPage,
} from "./pages/SystemMenuPages";
import type {
  GameMode,
  GameScreenId,
  GameUiCommand,
  GameUiPort,
  GameUiSnapshot,
  UiActionGroupView,
  UiDocumentView,
  UiNavigationDirective,
  UiOptionView,
  UiPromptView,
} from "./ports/GameUiPort";
import type {
  UiPreferences,
  UiSettingsPort,
} from "./ports/UiSettingsPort";

/** 已创建页面与其稳定路由的绑定。 */
interface RenderedPage {
  readonly route: GameRoute;
  readonly view: PageView;
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
  private snapshot: GameUiSnapshot | null;
  private renderedPages: RenderedPage[];
  private preferences: UiPreferences;
  private unsubscribe: (() => void) | null;
  private canLoad: boolean;
  private mounted: boolean;
  private executing: boolean;
  private browserGuardInstalled: boolean;
  private exitVerificationTimer: ReturnType<typeof setTimeout> | null;
  private connectionTimer: ReturnType<typeof setTimeout> | null;
  private readonly resizeCoordinator: DeferredResizeCoordinator;
  private viewportListenersInstalled: boolean;
  private expeditionDraft: ExpeditionDraft;

  /**
   * 保存舞台、配置和倒置端口，但不在构造阶段触发领域请求。
   */
  public constructor(
    runtime: unknown,
    stage: unknown,
    config: GameUiConfig,
    port: GameUiPort,
    settingsPort: UiSettingsPort,
  ) {
    this.runtime = expectLayaRuntime(runtime);
    this.stage = expectLayaStage(stage);
    this.config = config;
    this.port = port;
    this.settingsPort = settingsPort;
    this.factory = new UiFactory(
      this.runtime,
      config.theme,
      config.typography,
      config.controls,
    );
    this.host = this.factory.container("game-ui-root");
    this.navigation = new PageStack({ screen: "menu" });
    this.snapshot = null;
    this.renderedPages = [];
    this.preferences = settingsPort.load({
      reducedMotion: config.motion.reduced_motion,
    });
    this.unsubscribe = null;
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
      this.host.addChild(view.root);
      this.renderedPages.push({ route, view });
    }
    const topIndex = this.renderedPages.length - 1;
    this.renderedPages.forEach((entry, index) => {
      entry.view.root.visible = index >= Math.max(0, topIndex - 1);
      entry.view.root.mouseEnabled = index === topIndex;
      entry.view.root.zOrder = index;
    });
    const browserWindow = getBrowserWindow();
    if (browserWindow !== null) {
      browserWindow.document.body.dataset.gameScreen = this.navigation.current().screen;
      browserWindow.document.body.dataset.gameLayout = layout.isMobile ? "mobile" : "desktop";
    }
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
      case "menu":
        return this.createCover(layout, snapshot);
      case "name_input":
        return this.createNameInput(route, layout, snapshot);
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
      case "companions":
        return this.createCompanions(layout, snapshot);
      case "supplies":
        return this.createSupplies(layout, snapshot);
      case "warehouse":
        return this.createWarehouse(layout, snapshot);
      case "research":
        return this.createResearch(layout, snapshot);
      case "crafting":
        return this.createCrafting(layout, snapshot);
      case "expedition_prepare":
        return this.createExpeditionPrepare(layout, snapshot);
      case "expedition_status":
        return this.createExpeditionStatus(layout, snapshot);
      case "history":
        return this.createHistory(layout, snapshot);
      case "tutorial":
        return this.createDocumentRoute(
          layout,
          "page-tutorial",
          snapshot.tutorial ?? this.emptyDocument(this.findActionLabel("tutorial")),
          this.config.texts.close,
          this.goBack,
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
    }
  }

  /**
   * 创建封面并绑定六个配置化入口。
   */
  private createCover(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): CoverPage {
    return new CoverPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.brand,
      this.canLoad,
      {
        startSingle: (): void => { this.openNameInput("single"); },
        loadGame: (): void => {
          void this.loadGame();
        },
        startMultiplayer: (): void => { this.openNameInput("multiplayer"); },
        startStory: (): void => { this.openNameInput("story"); },
        showCredits: (): void => {
          this.navigation.push({ screen: "credits" });
          this.render();
        },
        exitGame: (): void => {
          this.navigation.push({ screen: "exit_confirm" });
          this.render();
        },
      },
    );
  }

  /**
   * 创建单人或本地双人姓名页。
   */
  private createNameInput(
    route: GameRoute,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    const mode = route.context?.mode ?? "single";
    const view = createNameInputPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      mode,
      snapshot.playerCounts[mode],
      this.goBack,
      (names): void => {
        void this.startGame(mode, names);
      },
    );
    return view.page;
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
        selectAction: this.handleDashboardAction,
        selectNavigation: this.handleBottomNavigation,
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
      body: category?.description ?? "",
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
        onSelect: (option): void => {
          void this.performManagementAction(categoryId, option.id);
        },
      },
    );
  }

  /**
   * 创建伙伴档案页面。
   */
  private createCompanions(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createCompanionsPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      this.findActionLabel("companions"),
      snapshot.companions,
      this.goBack,
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

  /** 创建研发页并提交选中的研发项目。 */
  private createResearch(
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
  ): PageView {
    return createResearchPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      snapshot.researchProjects,
      this.goBack,
      (projectId): void => { void this.completeResearch(projectId); },
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
      snapshot.cities,
      snapshot.expeditionCompanions,
      snapshot.expeditionCarryItems,
      this.expeditionDraft,
      {
        back: this.goBack,
        selectCity: this.selectExpeditionCity,
        toggleCompanion: this.toggleExpeditionCompanion,
        cycleItem: this.cycleExpeditionItem,
        begin: (): void => { void this.beginExpedition(); },
      },
    );
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
    const action = this.findAction("return_menu");
    const documentView: UiDocumentView = {
      title: action?.label ?? "",
      body: action?.description ?? "",
      tone: "danger",
    };
    return createConfirmPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      "page-return-menu-confirm",
      documentView,
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
          void this.saveGame();
        },
        openSettings: (): void => {
          this.navigation.push({ screen: "settings" });
          this.render();
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

  /** 创建持久化“减少动效”偏好的设置页。 */
  private createSettings(layout: ResponsiveLayout): PageView {
    return createSettingsPage(
      this.runtime,
      this.factory,
      this.config,
      layout,
      this.preferences,
      this.toggleReducedMotion,
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
    this.navigation.push({ screen: "name_input", context: { mode } });
    this.render();
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

  /** 根据待决事件和远征上下文打开正确的探索页。 */
  private openExpedition(): void {
    this.navigation.push({
      screen: resolveExpeditionEntryScreen(this.requireSnapshot()),
    });
    this.render();
  }

  /**
   * 处理指挥台行动入口。
   */
  private readonly handleDashboardAction = (action: UiOptionView): void => {
    switch (action.id) {
      case "story":
        this.openStory();
        return;
      case "explore":
        this.openExpedition();
        return;
      case "shelter_management":
        this.navigation.push({ screen: "management_categories" });
        break;
      case "companions":
        this.navigation.push({ screen: "companions" });
        break;
      case "warehouse":
        this.navigation.push({ screen: "warehouse" });
        break;
      case "research":
        this.navigation.push({ screen: "research" });
        break;
      case "crafting":
        this.navigation.push({ screen: "crafting" });
        break;
      case "expedition":
        this.openExpedition();
        return;
      case "history":
        this.navigation.push({ screen: "history" });
        break;
      case "tutorial":
        this.navigation.push({ screen: "tutorial" });
        break;
      case "save":
        void this.saveGame();
        return;
      case "return_menu":
        this.navigation.push({ screen: "return_menu_confirm" });
        break;
      default:
        void this.performSupplyAction(action.id);
        return;
    }
    this.render();
  };

  /**
   * 处理手机底部五入口。
   */
  private readonly handleBottomNavigation = (navigationId: string): void => {
    switch (navigationId) {
      case "dashboard":
        this.navigation.reset({ screen: "dashboard" });
        break;
      case "story":
        this.openStory();
        return;
      case "explore":
        this.openExpedition();
        return;
      case "management":
        this.navigation.push({ screen: "management_categories" });
        break;
      case "supplies":
        this.navigation.push({ screen: "supplies" });
        break;
      default:
        return;
    }
    this.render();
  };

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
  ): Promise<void> {
    this.expeditionDraft = emptyExpeditionDraft();
    await this.execute(
      { type: "start_game", mode, playerNames },
      (): void => { this.beginConnectionTransition(); },
    );
  }

  /**
   * 从本地存档恢复游戏。
   */
  private async loadGame(): Promise<void> {
    this.expeditionDraft = emptyExpeditionDraft();
    await this.execute(
      { type: "load_game" },
      (): void => { this.beginConnectionTransition(); },
    );
  }

  /** 以配置化时长启动通讯过场，完成后进入指挥台或已生成结局。 */
  private beginConnectionTransition(): void {
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
  private async saveGame(): Promise<void> {
    await this.execute({ type: "save_game" }, (): void => undefined, true);
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
      reducedMotion: !this.preferences.reducedMotion,
    };
    this.settingsPort.save(this.preferences);
    this.render(true);
  };

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
        if (snapshot.battle !== null) {
          this.navigation.replace({ screen: "battle" });
        } else if (snapshot.ending !== null || snapshot.ended) {
          this.navigation.replace({ screen: "ending" });
        } else {
          this.navigation.reset({ screen: "dashboard" });
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
        this.navigation.reset({ screen: "dashboard" });
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

  /** 保存远征目标城市并刷新整备页选中态。 */
  private readonly selectExpeditionCity = (cityId: string): void => {
    this.expeditionDraft = {
      ...this.expeditionDraft,
      cityId,
    };
    this.render(true);
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

  /** 在零到可用库存之间循环远征携带数量。 */
  private readonly cycleExpeditionItem = (itemId: string): void => {
    const item = this.requireSnapshot().expeditionCarryItems.find(
      (candidate) => candidate.id === itemId,
    );
    if (item === undefined || item.availableQuantity <= 0) {
      return;
    }
    const currentItems = this.expeditionDraft.carriedItems;
    const nextQuantity = (currentItems[itemId] ?? 0) + 1;
    const carriedItems = nextQuantity > item.availableQuantity
      ? Object.fromEntries(
          Object.entries(currentItems).filter(([candidateId]) => candidateId !== itemId),
        )
      : { ...currentItems, [itemId]: nextQuantity };
    this.expeditionDraft = { ...this.expeditionDraft, carriedItems };
    this.render(true);
  };

  /** 提交整备草稿并进入已锁定的首个远征事件。 */
  private async beginExpedition(): Promise<void> {
    const cityId = this.expeditionDraft.cityId;
    if (cityId === null) {
      return;
    }
    await this.execute(
      {
        type: "expedition_begin",
        cityId,
        companionIds: [...this.expeditionDraft.companionIds],
        carriedItems: { ...this.expeditionDraft.carriedItems },
      },
      (): void => {
        this.expeditionDraft = emptyExpeditionDraft();
        this.navigateAfterExpeditionProgress();
      },
    );
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
        this.navigation.reset({ screen: "dashboard" });
      },
    );
  }

  /** 根据命令后快照替换为事件、远征状态或指挥台。 */
  private navigateAfterExpeditionProgress(): void {
    const screen = resolveExpeditionProgressScreen(this.requireSnapshot());
    if (screen === "dashboard") {
      this.navigation.reset({ screen });
    } else {
      this.navigation.replace({ screen });
    }
  }

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
  ): Promise<void> {
    await this.execute(
      { type: "management_action", categoryId, optionId },
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
    if (screen === "menu" || screen === "connection") {
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
    const screen = this.navigation.current().screen;
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

  /**
   * 返回指挥台行动标签。
   */
  private findActionLabel(id: string): string {
    return this.findAction(id)?.label ?? "";
  }

  /**
   * 在所有行动组中查找指定行动。
   */
  private findAction(id: string): UiOptionView | undefined {
    const groups: readonly UiActionGroupView[] =
      this.snapshot?.actionGroups ?? [];
    for (const group of groups) {
      const action = group.actions.find((candidate) => candidate.id === id);
      if (action !== undefined) {
        return action;
      }
    }
    return undefined;
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
