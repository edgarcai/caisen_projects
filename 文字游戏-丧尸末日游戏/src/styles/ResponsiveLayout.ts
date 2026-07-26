import type { GameUiConfig, SafeAreaInsets } from "./GameTheme";

/**
 * 当前舞台对应的响应式页面几何信息。
 */
export interface ResponsiveLayout {
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly isMobile: boolean;
  readonly isCompact: boolean;
  readonly safeArea: SafeAreaInsets;
  readonly outerPadding: number;
  readonly contentLeft: number;
  readonly contentTop: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly headerHeight: number;
  readonly footerHeight: number;
  readonly panelPadding: number;
  readonly sectionGap: number;
  readonly optionColumns: number;
}

/**
 * 从浏览器 CSS 环境变量读取安全区，失败时使用配置值。
 */
export function readSafeArea(fallback: SafeAreaInsets): SafeAreaInsets {
  const browserDocument = (globalThis as { document?: Document }).document;
  if (browserDocument === undefined) {
    return fallback;
  }
  const probe = browserDocument.createElement("div");
  probe.style.cssText = [
    "position:fixed",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top)",
    "padding-right:env(safe-area-inset-right)",
    "padding-bottom:env(safe-area-inset-bottom)",
    "padding-left:env(safe-area-inset-left)",
  ].join(";");
  browserDocument.body.append(probe);
  const computed = getComputedStyle(probe);
  const resolved = {
    top: parseInset(computed.paddingTop, fallback.top),
    right: parseInset(computed.paddingRight, fallback.right),
    bottom: parseInset(computed.paddingBottom, fallback.bottom),
    left: parseInset(computed.paddingLeft, fallback.left),
  };
  probe.remove();
  return resolved;
}

/**
 * 把 CSS 像素值转换为有限数值。
 */
function parseInset(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 根据舞台尺寸和 Web 配置计算手机或桌面布局。
 */
export function resolveResponsiveLayout(
  stageWidth: number,
  stageHeight: number,
  config: GameUiConfig,
  safeArea?: SafeAreaInsets,
): ResponsiveLayout {
  const resolvedSafeArea =
    safeArea ??
    scaleSafeAreaToStage(
      readSafeArea(config.responsive.safe_area_fallback),
      stageWidth,
      stageHeight,
    );
  const isMobile = stageWidth <= config.responsive.mobile_max_stage_width;
  const isCompact = stageHeight <= config.responsive.compact_max_stage_height;
  const layout = isMobile ? config.layout.mobile : config.layout.desktop;
  const outerPadding = layout.outer_padding;
  const headerHeight = layout.header_height;
  const footerHeight = isMobile
    ? config.layout.mobile.bottom_navigation_height
    : config.layout.desktop.bottom_bar_height;
  const panelPadding = layout.panel_padding;
  const sectionGap = layout.section_gap;
  const horizontalInsets =
    resolvedSafeArea.left + resolvedSafeArea.right + outerPadding * 2;
  const verticalInsets =
    resolvedSafeArea.top +
    resolvedSafeArea.bottom +
    outerPadding * 2 +
    headerHeight +
    footerHeight;
  return {
    stageWidth,
    stageHeight,
    isMobile,
    isCompact,
    safeArea: resolvedSafeArea,
    outerPadding,
    contentLeft: resolvedSafeArea.left + outerPadding,
    contentTop: resolvedSafeArea.top + outerPadding + headerHeight,
    contentWidth: Math.max(config.controls.minimum_touch_size, stageWidth - horizontalInsets),
    contentHeight: Math.max(
      config.controls.minimum_touch_size,
      stageHeight - verticalInsets,
    ),
    headerHeight,
    footerHeight,
    panelPadding,
    sectionGap,
    optionColumns: isMobile
      ? config.layout.page.mobile_option_columns
      : config.layout.page.desktop_option_columns,
  };
}

/**
 * 把浏览器 CSS 像素安全区换算为 Laya 舞台逻辑坐标。
 */
function scaleSafeAreaToStage(
  safeArea: SafeAreaInsets,
  stageWidth: number,
  stageHeight: number,
): SafeAreaInsets {
  const browserWindow = (globalThis as { window?: Window }).window;
  if (browserWindow === undefined) {
    return safeArea;
  }
  const viewportWidth =
    browserWindow.visualViewport?.width ?? browserWindow.innerWidth;
  const viewportHeight =
    browserWindow.visualViewport?.height ?? browserWindow.innerHeight;
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return safeArea;
  }
  const horizontalScale = stageWidth / viewportWidth;
  const verticalScale = stageHeight / viewportHeight;
  return {
    top: safeArea.top * verticalScale,
    right: safeArea.right * horizontalScale,
    bottom: safeArea.bottom * verticalScale,
    left: safeArea.left * horizontalScale,
  };
}
