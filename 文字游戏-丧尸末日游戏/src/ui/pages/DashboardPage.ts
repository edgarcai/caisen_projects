import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import { ScrollRegion } from "../components/ScrollRegion";
import {
  DashboardNavigationChrome,
  type DashboardHeaderNavigationGeometry,
  shouldRenderDashboardMission,
} from "../components/DashboardNavigationChrome";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
} from "../laya/LayaRuntime";
import type {
  GameUiSnapshot,
  UiActionGroupView,
  UiDocumentView,
  UiStatView,
} from "../ports/GameUiPort";
import type { PageView } from "./PageView";

/**
 * 指挥台可触发的导航和领域意图。
 */
export interface DashboardActions {
  readonly selectEntry: (entryId: string) => void;
}

/**
 * 移动端单列与桌面三栏共用的指挥台页面。
 */
export class DashboardPage implements PageView {
  public readonly root: LayaSpriteLike;
  private readonly scrolls: readonly ScrollRegion[];

  /**
   * 根据舞台断点创建手机或桌面指挥台。
   */
  public constructor(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
    actions: DashboardActions,
  ) {
    this.root = factory.container("page-dashboard");
    this.root.size(layout.stageWidth, layout.stageHeight);
    this.root.graphics.drawRect(
      0,
      0,
      layout.stageWidth,
      layout.stageHeight,
      config.theme.background,
    );
    const navigationChrome = new DashboardNavigationChrome(
      factory,
      config,
      layout,
      snapshot,
      actions,
    );
    this.renderHeader(
      factory,
      config,
      layout,
      snapshot,
      navigationChrome.headerGeometry(),
    );
    if (layout.usesCompactUi) {
      this.scrolls = [
        this.renderMobile(
          runtime,
          factory,
          config,
          layout,
          snapshot,
          actions,
        ),
      ];
    } else {
      this.scrolls = this.renderDesktop(
        runtime,
        factory,
        config,
        layout,
        snapshot,
        actions,
      );
    }
    navigationChrome.render(this.root);
  }

  /**
   * 释放指挥台滚动监听和显示树。
   */
  public destroy(): void {
    this.scrolls.forEach((scroll) => { scroll.destroy(); });
    this.root.offAll();
    this.root.destroy(true);
  }

  /** 在任一可滚动分栏中找到并显示教程目标。 */
  public revealTutorialTarget(nodeName: string, padding: number): boolean {
    return this.scrolls.some((scroll) => scroll.revealNode(nodeName, padding));
  }

  /**
   * 绘制始终优先展示的日期、回合和当前所长。
   */
  private renderHeader(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
    navigationGeometry: DashboardHeaderNavigationGeometry | null,
  ): void {
    const headerLeft = layout.safeArea.left + layout.outerPadding;
    const headerTop = layout.safeArea.top + layout.outerPadding;
    const headerWidth =
      layout.stageWidth -
      layout.safeArea.left -
      layout.safeArea.right -
      layout.outerPadding * 2;
    const textWidth = navigationGeometry === null
      ? headerWidth
      : Math.max(
          config.controls.minimum_touch_size,
          navigationGeometry.left - headerLeft - config.controls.button_gap,
        );
    const clockText = snapshot.clock === null
      ? ""
      : `${snapshot.clock.dateLabel}  ${snapshot.clock.timeLabel}`;
    const activePlayerText = snapshot.activePlayer === null
      ? ""
      : this.formatProfileField(
          config,
          config.texts.profile_name_label,
          snapshot.activePlayer.name,
        );
    const campaignText = this.campaignProfileText(config, snapshot);
    factory.text(this.root, {
      testId: "dashboard-clock",
      text: clockText,
      x: headerLeft,
      y: headerTop,
      width: textWidth,
      height: config.typography.section_title_size + layout.sectionGap,
      fontSize: config.typography.section_title_size,
      color: config.theme.accent,
      bold: true,
      valign: "middle",
    });
    factory.text(this.root, {
      testId: "dashboard-active-player",
      text: activePlayerText,
      x: headerLeft,
      y: headerTop + config.typography.section_title_size + layout.sectionGap,
      width: textWidth,
      height: config.typography.body_line_height,
      fontSize: config.typography.body_size,
      color: config.theme.text,
    });
    factory.text(this.root, {
      testId: "dashboard-campaign-profile",
      text: campaignText,
      x: headerLeft,
      y:
        headerTop +
        config.typography.section_title_size +
        layout.sectionGap +
        config.typography.body_line_height,
      width: textWidth,
      height: config.typography.body_line_height * 2,
      fontSize: config.typography.caption_size,
      color: config.theme.muted_text,
    });
    factory.text(this.root, {
      testId: "dashboard-turn",
      text: snapshot.clock?.turnLabel ?? "",
      x: headerLeft,
      y: headerTop,
      width: textWidth,
      height: config.typography.section_title_size + layout.sectionGap,
      fontSize: config.typography.caption_size,
      color: config.theme.muted_text,
      align: "right",
      valign: "middle",
    });
  }

  /** 把模式、难度、起源、特性与市区连接为独立档案摘要。 */
  private campaignProfileText(
    config: GameUiConfig,
    snapshot: GameUiSnapshot,
  ): string {
    const profile = snapshot.campaignProfile;
    if (profile === null) {
      return "";
    }
    return [
      this.formatProfileField(
        config,
        config.texts.profile_mode_label,
        profile.modeLabel,
      ),
      this.formatProfileField(
        config,
        config.texts.profile_difficulty_label,
        profile.difficultyLabel,
      ),
      this.formatProfileField(
        config,
        config.texts.profile_origin_label,
        profile.originLabel,
      ),
      this.formatProfileField(
        config,
        config.texts.profile_trait_label,
        profile.traitLabel,
      ),
      this.formatProfileField(
        config,
        config.texts.profile_secondary_trait_label,
        profile.secondaryTraitLabel,
      ),
      this.formatProfileField(
        config,
        config.texts.profile_city_label,
        profile.homeCityLabel,
      ),
      this.formatProfileField(
        config,
        config.texts.profile_district_label,
        profile.districtLabel,
      ),
      this.formatProfileField(
        config,
        config.texts.profile_shelter_type_label,
        profile.shelterTypeLabel,
      ),
    ].join(config.texts.profile_field_separator);
  }

  /** 使用配置化模板格式化一个所长档案字段。 */
  private formatProfileField(
    config: GameUiConfig,
    label: string,
    value: string,
  ): string {
    return config.texts.profile_field_format
      .replace("{label}", label)
      .replace("{value}", value);
  }

  /**
   * 绘制手机端滚动内容和首屏核心行动。
   */
  private renderMobile(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
    actions: DashboardActions,
  ): ScrollRegion {
    const scroll = new ScrollRegion(
      runtime,
      this.root,
      "dashboard-mobile-scroll",
      layout.contentLeft,
      layout.contentTop,
      layout.contentWidth,
      layout.contentHeight,
      config.controls.scroll_step,
      config.controls.drag_threshold,
    );
    let cursorY = this.renderMeters(
      factory,
      config,
      layout,
      scroll.content,
      snapshot,
      0,
      0,
      layout.contentWidth,
      config.layout.mobile.quick_action_columns,
    );
    cursorY += layout.sectionGap;
    cursorY = this.renderMobileResources(
      factory,
      config,
      layout,
      scroll.content,
      snapshot.resources,
      cursorY,
    );
    if (shouldRenderDashboardMission(snapshot)) {
      cursorY += layout.sectionGap;
      cursorY = this.renderMission(
        factory,
        config,
        layout,
        scroll.content,
        snapshot,
        0,
        cursorY,
        layout.contentWidth,
        config.layout.mobile.mission_height,
      );
      cursorY += layout.sectionGap;
    }
    cursorY = this.renderMobileLogPreview(
      factory,
      config,
      layout,
      scroll.content,
      snapshot.logs,
      cursorY,
      actions,
    );
    cursorY += layout.sectionGap;
    cursorY = this.renderActionGroups(
      factory,
      config,
      layout,
      scroll.content,
      snapshot.actionGroups,
      0,
      cursorY,
      layout.contentWidth,
      config.layout.mobile.quick_action_columns,
      actions,
    );
    scroll.setContentHeight(cursorY + layout.sectionGap);
    return scroll;
  }

  /** 用紧凑双列资源板让手机首屏也能读取并聚焦真实库存。 */
  private renderMobileResources(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    parent: LayaSpriteLike,
    resources: readonly UiStatView[],
    y: number,
  ): number {
    if (resources.length === 0) {
      return y;
    }
    const columns = Math.max(1, config.layout.mobile.quick_action_columns);
    const rows = Math.ceil(resources.length / columns);
    const padding = layout.panelPadding;
    const rowHeight = Math.max(
      config.layout.mobile.resource_bar_height,
      config.typography.body_line_height,
    );
    const height = padding * 2 + rows * rowHeight;
    const panel = factory.panel(parent, {
      testId: "dashboard-mobile-resources",
      x: 0,
      y,
      width: layout.contentWidth,
      height,
      elevated: true,
    });
    const gap = config.controls.button_gap;
    const itemWidth = (
      layout.contentWidth - padding * 2 - gap * (columns - 1)
    ) / columns;
    resources.forEach((resource, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      factory.text(panel, {
        testId: `dashboard-resource-${resource.id}`,
        text: `${resource.label}  ${resource.value}`,
        x: padding + column * (itemWidth + gap),
        y: padding + row * rowHeight,
        width: itemWidth,
        height: rowHeight,
        fontSize: config.typography.caption_size,
        color: resource.emphasized === true
          ? config.theme.accent
          : config.theme.text,
        valign: "middle",
      });
    });
    return y + height;
  }

  /** 在手机指挥台提供固定高度摘要和独立日志入口。 */
  private renderMobileLogPreview(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    parent: LayaSpriteLike,
    logs: readonly string[],
    y: number,
    actions: DashboardActions,
  ): number {
    const height = config.layout.mobile.log_preview_height;
    const panel = factory.panel(parent, {
      testId: "dashboard-mobile-log-panel",
      x: 0,
      y,
      width: layout.contentWidth,
      height,
      elevated: true,
    });
    const padding = layout.panelPadding;
    const buttonHeight = config.controls.compact_button_height;
    const textHeight = Math.max(
      config.typography.body_line_height,
      height - padding * 3 - buttonHeight,
    );
    factory.text(panel, {
      testId: "dashboard-log",
      text: recentCommunicationLogs(config, logs),
      x: padding,
      y: padding,
      width: layout.contentWidth - padding * 2,
      height: textHeight,
      fontSize: config.typography.caption_size,
      color: config.theme.muted_text,
    });
    factory.button(panel, {
      testId: "dashboard-mobile-log-open",
      label: config.texts.communication_log_open,
      x: padding,
      y: height - padding - buttonHeight,
      width: layout.contentWidth - padding * 2,
      height: buttonHeight,
      tone: "primary",
      onClick: (): void => { actions.selectEntry("communication_log"); },
    });
    return y + height;
  }

  /**
   * 绘制桌面端状态、任务日志和行动三栏。
   */
  private renderDesktop(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    snapshot: GameUiSnapshot,
    actions: DashboardActions,
  ): readonly ScrollRegion[] {
    const leftWidth = config.layout.desktop.left_rail_width;
    const rightWidth = config.layout.desktop.right_rail_width;
    const centerWidth = Math.max(
      config.controls.minimum_touch_size,
      layout.contentWidth -
        leftWidth -
        rightWidth -
        config.layout.desktop.column_gap * 2,
    );
    const leftPanel = factory.panel(this.root, {
      testId: "dashboard-left-rail",
      x: layout.contentLeft,
      y: layout.contentTop,
      width: leftWidth,
      height: layout.contentHeight,
    });
    const centerLeft =
      layout.contentLeft + leftWidth + config.layout.desktop.column_gap;
    const centerPanel = factory.panel(this.root, {
      testId: "dashboard-center",
      x: centerLeft,
      y: layout.contentTop,
      width: centerWidth,
      height: layout.contentHeight,
      elevated: true,
    });
    const rightLeft =
      centerLeft + centerWidth + config.layout.desktop.column_gap;
    const rightPanel = factory.panel(this.root, {
      testId: "dashboard-right-rail",
      x: rightLeft,
      y: layout.contentTop,
      width: rightWidth,
      height: layout.contentHeight,
    });
    const panelPadding = config.layout.desktop.panel_padding;
    const leftInnerWidth = leftWidth - panelPadding * 2;
    const railHeight = Math.max(
      config.controls.minimum_touch_size,
      layout.contentHeight - panelPadding * 2,
    );
    const leftScroll = new ScrollRegion(
      runtime,
      leftPanel,
      "dashboard-desktop-status-scroll",
      panelPadding,
      panelPadding,
      leftInnerWidth,
      railHeight,
      config.controls.scroll_step,
      config.controls.drag_threshold,
    );
    let leftCursor = this.renderMeters(
      factory,
      config,
      layout,
      leftScroll.content,
      snapshot,
      0,
      0,
      leftInnerWidth,
      config.layout.page.mobile_option_columns,
    );
    leftCursor += layout.sectionGap;
    leftCursor = this.renderStats(
      factory,
      config,
      leftScroll.content,
      snapshot.resources,
      0,
      leftCursor,
      leftInnerWidth,
      "dashboard-resource",
    );
    leftScroll.setContentHeight(leftCursor + layout.sectionGap);
    const centerPadding = config.layout.desktop.panel_padding;
    const centerInnerWidth = centerWidth - centerPadding * 2;
    const missionBottom = shouldRenderDashboardMission(snapshot)
      ? this.renderMission(
          factory,
          config,
          layout,
          centerPanel,
          snapshot,
          centerPadding,
          centerPadding,
          centerInnerWidth,
          config.layout.desktop.mission_height,
        )
      : centerPadding - layout.sectionGap;
    const logTop = missionBottom + layout.sectionGap;
    this.renderLogs(
      factory,
      config,
      centerPanel,
      snapshot.logs,
      centerPadding,
      logTop,
      centerInnerWidth,
      Math.max(
        config.layout.desktop.log_min_height,
        layout.contentHeight - logTop - centerPadding,
      ),
    );
    const rightInnerWidth = rightWidth - panelPadding * 2;
    const rightScroll = new ScrollRegion(
      runtime,
      rightPanel,
      "dashboard-desktop-actions-scroll",
      panelPadding,
      panelPadding,
      rightInnerWidth,
      railHeight,
      config.controls.scroll_step,
      config.controls.drag_threshold,
    );
    const actionBottom = this.renderActionGroups(
      factory,
      config,
      layout,
      rightScroll.content,
      snapshot.actionGroups,
      0,
      0,
      rightInnerWidth,
      config.layout.page.desktop_option_columns,
      actions,
    );
    rightScroll.setContentHeight(actionBottom + layout.sectionGap);
    return [leftScroll, rightScroll];
  }

  /**
   * 绘制生命、饥饿和基地风险条。
   */
  private renderMeters(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    parent: LayaSpriteLike,
    snapshot: GameUiSnapshot,
    startX: number,
    startY: number,
    width: number,
    columns: number,
  ): number {
    const gap = config.controls.button_gap;
    const safeColumns = Math.max(1, columns);
    const meterWidth = (width - gap * (safeColumns - 1)) / safeColumns;
    const meterHeight =
      config.typography.stat_size * 2 + config.controls.button_gap * 2;
    snapshot.meters.forEach((meter, index) => {
      const column = index % safeColumns;
      const row = Math.floor(index / safeColumns);
      factory.meter(
        parent,
        `dashboard-meter-${meter.id}`,
        meter,
        startX + column * (meterWidth + gap),
        startY + row * (meterHeight + layout.sectionGap),
        meterWidth,
        meterHeight,
      );
    });
    return startY + (
      Math.ceil(snapshot.meters.length / safeColumns) *
      (meterHeight + layout.sectionGap)
    );
  }

  /**
   * 绘制当前章节和任务目标。
   */
  private renderMission(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    parent: LayaSpriteLike,
    snapshot: GameUiSnapshot,
    x: number,
    y: number,
    width: number,
    height: number,
  ): number {
    const panel = factory.panel(parent, {
      testId: "dashboard-mission",
      x,
      y,
      width,
      height,
      elevated: true,
      active: true,
    });
    const padding = layout.panelPadding;
    const innerWidth = width - padding * 2;
    const mission = snapshot.mission;
    factory.text(panel, {
      testId: "dashboard-mission-chapter",
      text: mission?.chapterLabel ?? "",
      x: padding,
      y: padding,
      width: innerWidth,
      height: config.typography.body_line_height,
      fontSize: config.typography.caption_size,
      color: config.theme.accent,
    });
    factory.text(panel, {
      testId: "dashboard-mission-title",
      text: mission?.title ?? "",
      x: padding,
      y: padding + config.typography.body_line_height,
      width: innerWidth,
      height: config.typography.body_line_height * 2,
      fontSize: config.typography.section_title_size,
      bold: true,
    });
    factory.text(panel, {
      testId: "dashboard-mission-objective",
      text: mission?.objective ?? "",
      x: padding,
      y: padding + config.typography.body_line_height * 3,
      width: innerWidth,
      height: Math.max(
        config.typography.body_line_height,
        height - padding * 2 - config.typography.body_line_height * 4,
      ),
      fontSize: config.typography.body_size,
      color: config.theme.muted_text,
    });
    factory.text(panel, {
      testId: "dashboard-mission-progress",
      text: mission?.progressLabel ?? "",
      x: padding,
      y: height - padding - config.typography.body_line_height,
      width: innerWidth,
      height: config.typography.body_line_height,
      fontSize: config.typography.caption_size,
      color: config.theme.accent,
      align: "right",
    });
    return y + height;
  }

  /**
   * 绘制分组行动按钮。
   */
  private renderActionGroups(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    parent: LayaSpriteLike,
    groups: readonly UiActionGroupView[],
    x: number,
    startY: number,
    width: number,
    columns: number,
    actions: DashboardActions,
  ): number {
    const safeColumns = Math.max(1, columns);
    const gap = config.controls.button_gap;
    const buttonWidth = (width - gap * (safeColumns - 1)) / safeColumns;
    let cursorY = startY;
    groups.forEach((group) => {
      factory.text(parent, {
        testId: `dashboard-action-group-${group.id}`,
        text: group.label,
        x,
        y: cursorY,
        width,
        height: config.typography.body_line_height,
        fontSize: config.typography.caption_size,
        color: config.theme.accent,
        bold: true,
      });
      cursorY += config.typography.body_line_height + gap;
      group.actions.forEach((action, index) => {
        const column = index % safeColumns;
        const row = Math.floor(index / safeColumns);
        factory.button(parent, {
          testId: `dashboard-action-${action.id}`,
          label: action.label,
          x: x + column * (buttonWidth + gap),
          y: cursorY + row * (config.controls.compact_button_height + gap),
          width: buttonWidth,
          height: config.controls.compact_button_height,
          tone: action.tone,
          disabled: action.disabled,
          onClick: (): void => { actions.selectEntry(action.id); },
        });
      });
      const rows = Math.ceil(group.actions.length / safeColumns);
      cursorY += rows * (config.controls.compact_button_height + gap) + layout.sectionGap;
    });
    return cursorY;
  }

  /**
   * 绘制资源或避难所统计列表。
   */
  private renderStats(
    factory: UiFactory,
    config: GameUiConfig,
    parent: LayaSpriteLike,
    stats: readonly UiStatView[],
    x: number,
    startY: number,
    width: number,
    testIdPrefix: string,
  ): number {
    let cursorY = startY;
    stats.forEach((stat) => {
      factory.text(parent, {
        testId: `${testIdPrefix}-${stat.id}`,
        text: `${stat.label}  ${stat.value}`,
        x,
        y: cursorY,
        width,
        height: config.typography.body_line_height,
        fontSize: config.typography.stat_size,
        color: stat.emphasized === true ? config.theme.accent : config.theme.text,
      });
      cursorY += config.typography.body_line_height;
    });
    return cursorY;
  }

  /**
   * 绘制最近行动日志摘要。
   */
  private renderLogs(
    factory: UiFactory,
    config: GameUiConfig,
    parent: LayaSpriteLike,
    logs: readonly string[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const text = logs.join("\n\n");
    factory.text(parent, {
      testId: "dashboard-log",
      text,
      x,
      y,
      width,
      height,
      fontSize: config.typography.body_size,
      color: config.theme.muted_text,
    });
  }

}

/** 把本周通讯记录组成可滚动的独立文档页。 */
export function buildCommunicationLogDocument(
  config: GameUiConfig,
  logs: readonly string[],
): UiDocumentView {
  return {
    title: config.texts.communication_log_title,
    body: logs.length > 0
      ? logs.join(
          config.texts.option_intelligence_separator
          + config.texts.option_intelligence_separator,
        )
      : config.texts.communication_log_empty,
    tone: "default",
  };
}

/** 仅截取配置数量的最新日志，避免手机首屏挤压触控区。 */
export function recentCommunicationLogs(
  config: GameUiConfig,
  logs: readonly string[],
): string {
  const visible = logs.slice(-config.layout.mobile.log_preview_entries);
  return visible.length > 0
    ? visible.join(config.texts.option_intelligence_separator)
    : config.texts.communication_log_empty;
}
