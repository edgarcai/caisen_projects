import type {
  GameUiConfig,
  NavigationPlacementToken,
  NavigationToken,
} from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { LayaSpriteLike } from "../laya/LayaRuntime";
import type { GameUiSnapshot } from "../ports/GameUiPort";
import type { UiFactory } from "./UiFactory";

/** 指挥台标题栏导航的配置化几何结果。 */
export interface DashboardHeaderNavigationGeometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly itemWidth: number;
  readonly gap: number;
}

/** 指挥台导航组件依赖的唯一交互出口。 */
export interface DashboardNavigationChromeActions {
  readonly selectEntry: (entryId: string) => void;
}

/** 判断旧存档是否需要保留主线恢复入口，避免战斗或结局死锁。 */
export function hasRestorableStoryState(snapshot: GameUiSnapshot): boolean {
  return snapshot.storyAccess === "legacy_resume";
}

/** 判断当前模式是否应展示剧情任务卡。 */
export function shouldRenderDashboardMission(
  snapshot: GameUiSnapshot,
): boolean {
  return snapshot.storyAccess !== "hidden" && snapshot.mission !== null;
}

/** 按布局返回当前标题栏使用的导航位置。 */
export function resolveDashboardHeaderPlacement(
  layout: ResponsiveLayout,
): NavigationPlacementToken {
  return layout.usesCompactUi ? "mobile_header" : "desktop_header";
}

/** 按游戏模式、导航位置和旧存档恢复状态筛选可见入口。 */
export function resolveVisibleDashboardNavigation(
  navigation: readonly NavigationToken[],
  placement: NavigationPlacementToken,
  snapshot: GameUiSnapshot,
): readonly NavigationToken[] {
  const mode = snapshot.mode;
  if (mode === null) {
    return [];
  }
  return navigation.filter((item) => {
    if (!item.placements.includes(placement)) {
      return false;
    }
    if (item.modes.includes(mode) && (
      item.id !== "story" || snapshot.storyAccess === "mode"
    )) {
      return true;
    }
    return item.id === "story" && hasRestorableStoryState(snapshot);
  });
}

/** 根据配置与可见入口数量计算标题栏按钮区域。 */
export function resolveDashboardHeaderNavigationGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
  itemCount: number,
): DashboardHeaderNavigationGeometry | null {
  if (itemCount <= 0) {
    return null;
  }
  const headerLeft = layout.safeArea.left + layout.outerPadding;
  const headerWidth = Math.max(
    config.controls.minimum_touch_size,
    layout.stageWidth -
      layout.safeArea.left -
      layout.safeArea.right -
      layout.outerPadding * 2,
  );
  const preferredWidth = layout.usesCompactUi
    ? config.layout.mobile.header_navigation_width
    : config.layout.desktop.header_navigation_width;
  const gap = config.controls.button_gap;
  const minimumWidth =
    config.controls.minimum_touch_size * itemCount + gap * (itemCount - 1);
  const width = Math.min(
    headerWidth,
    Math.max(preferredWidth, minimumWidth),
  );
  const anchor = layout.kind === "mobile"
    ? config.layout.mobile.header_navigation_anchor
    : config.layout.desktop.header_navigation_anchor;
  return {
    left: anchor === "left" ? headerLeft : headerLeft + headerWidth - width,
    top: layout.safeArea.top + layout.outerPadding,
    width,
    height: Math.min(
      config.controls.compact_button_height,
      layout.headerHeight,
    ),
    itemWidth: (width - gap * (itemCount - 1)) / itemCount,
    gap,
  };
}

/**
 * 只负责指挥台标题栏与紧凑布局底栏，页面主体不感知入口过滤规则。
 */
export class DashboardNavigationChrome {
  private readonly factory: UiFactory;
  private readonly config: GameUiConfig;
  private readonly layout: ResponsiveLayout;
  private readonly snapshot: GameUiSnapshot;
  private readonly actions: DashboardNavigationChromeActions;

  /** 保存导航绘制依赖，渲染时始终从已校验配置读取入口。 */
  public constructor(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
    actions: DashboardNavigationChromeActions,
  ) {
    this.factory = factory;
    this.config = config;
    this.layout = layout;
    this.snapshot = snapshot;
    this.actions = actions;
  }

  /** 返回本次渲染实际占用的标题栏导航几何。 */
  public headerGeometry(): DashboardHeaderNavigationGeometry | null {
    const items = resolveVisibleDashboardNavigation(
      this.config.navigation,
      resolveDashboardHeaderPlacement(this.layout),
      this.snapshot,
    );
    return resolveDashboardHeaderNavigationGeometry(
      this.config,
      this.layout,
      items.length,
    );
  }

  /** 绘制当前布局允许出现的标题栏和底部导航。 */
  public render(parent: LayaSpriteLike): void {
    this.renderHeaderNavigation(parent);
    if (this.layout.usesCompactUi) {
      this.renderBottomNavigation(parent);
    }
  }

  /** 绘制手机设置键或电脑剧情、设置入口。 */
  private renderHeaderNavigation(parent: LayaSpriteLike): void {
    const items = resolveVisibleDashboardNavigation(
      this.config.navigation,
      resolveDashboardHeaderPlacement(this.layout),
      this.snapshot,
    );
    const geometry = resolveDashboardHeaderNavigationGeometry(
      this.config,
      this.layout,
      items.length,
    );
    if (geometry === null) {
      return;
    }
    items.forEach((item, index) => {
      this.factory.button(parent, {
        testId: `dashboard-${item.id}`,
        label: item.label,
        icon: item.icon,
        x: geometry.left + index * (geometry.itemWidth + geometry.gap),
        y: geometry.top,
        width: geometry.itemWidth,
        height: geometry.height,
        tone: item.id === "story" ? "primary" : "default",
        fontSize: this.config.typography.caption_size,
        onClick: (): void => { this.actions.selectEntry(item.id); },
      });
    });
  }

  /** 绘制紧凑布局的模式化底栏，并按过滤后的数量分配宽度。 */
  private renderBottomNavigation(parent: LayaSpriteLike): void {
    const items = resolveVisibleDashboardNavigation(
      this.config.navigation,
      "mobile_bottom",
      this.snapshot,
    );
    if (items.length === 0) {
      return;
    }
    const navigationHeight = this.config.layout.mobile.bottom_navigation_height;
    const navigationTop =
      this.layout.stageHeight - this.layout.safeArea.bottom - navigationHeight;
    const navigationWidth =
      this.layout.stageWidth -
      this.layout.safeArea.left -
      this.layout.safeArea.right;
    const bar = this.factory.panel(parent, {
      testId: "mobile-bottom-navigation",
      x: this.layout.safeArea.left,
      y: navigationTop,
      width: navigationWidth,
      height: navigationHeight + this.layout.safeArea.bottom,
      elevated: true,
    });
    const itemWidth = navigationWidth / items.length;
    items.forEach((item, index) => {
      this.factory.button(bar, {
        testId: `bottom-nav-${item.id}`,
        label: item.label,
        icon: item.icon,
        iconPlacement: "stacked",
        x: index * itemWidth,
        y: 0,
        width: itemWidth,
        height: navigationHeight,
        fontSize: this.config.typography.caption_size,
        tone: item.id === "dashboard" ? "primary" : "default",
        onClick: (): void => { this.actions.selectEntry(item.id); },
      });
    });
  }
}
