import type { GameUiConfig, SafeAreaInsets } from "./GameTheme";
import { isMobileEnvironment } from "../services/DeviceCapabilityResolver";

/** 响应式界面的三个稳定布局等级。 */
export type ResponsiveLayoutKind = "mobile" | "compact" | "desktop";

/** 纯布局计算所需的舞台、设备和安全区快照。 */
export interface ResponsiveLayoutMetrics {
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly isMobileDevice: boolean;
  readonly safeArea: SafeAreaInsets;
}

/**
 * 当前舞台对应的响应式页面几何信息。
 */
export interface ResponsiveLayout {
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly kind: ResponsiveLayoutKind;
  readonly usesCompactUi: boolean;
  readonly isLandscape: boolean;
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
 * 根据设备类型和安全区内可用宽度解析唯一的响应式布局等级。
 */
export function resolveResponsiveLayoutKind(
  availableStageWidth: number,
  isMobileDevice: boolean,
  desktopMinimumStageWidth: number,
): ResponsiveLayoutKind {
  if (isMobileDevice) {
    return "mobile";
  }
  return availableStageWidth < desktopMinimumStageWidth
    ? "compact"
    : "desktop";
}

/**
 * 根据显式舞台指标执行无浏览器副作用的响应式几何计算。
 */
export function resolveResponsiveLayoutFromMetrics(
  metrics: ResponsiveLayoutMetrics,
  config: GameUiConfig,
): ResponsiveLayout {
  const availableStageWidth = Math.max(
    0,
    metrics.stageWidth - metrics.safeArea.left - metrics.safeArea.right,
  );
  const kind = resolveResponsiveLayoutKind(
    availableStageWidth,
    metrics.isMobileDevice,
    config.responsive.desktop_min_stage_width,
  );
  const usesCompactUi = kind !== "desktop";
  const layout = usesCompactUi ? config.layout.mobile : config.layout.desktop;
  const outerPadding = layout.outer_padding;
  const headerHeight = layout.header_height;
  const footerHeight = usesCompactUi
    ? config.layout.mobile.bottom_navigation_height
    : config.layout.desktop.bottom_bar_height;
  const panelPadding = layout.panel_padding;
  const sectionGap = layout.section_gap;
  const horizontalInsets =
    metrics.safeArea.left + metrics.safeArea.right + outerPadding * 2;
  const verticalInsets =
    metrics.safeArea.top +
    metrics.safeArea.bottom +
    outerPadding * 2 +
    headerHeight +
    footerHeight;
  return {
    stageWidth: metrics.stageWidth,
    stageHeight: metrics.stageHeight,
    kind,
    usesCompactUi,
    isLandscape: metrics.stageWidth > metrics.stageHeight,
    safeArea: metrics.safeArea,
    outerPadding,
    contentLeft: metrics.safeArea.left + outerPadding,
    contentTop: metrics.safeArea.top + outerPadding + headerHeight,
    contentWidth: Math.max(
      config.controls.minimum_touch_size,
      metrics.stageWidth - horizontalInsets,
    ),
    contentHeight: Math.max(
      config.controls.minimum_touch_size,
      metrics.stageHeight - verticalInsets,
    ),
    headerHeight,
    footerHeight,
    panelPadding,
    sectionGap,
    optionColumns: usesCompactUi
      ? config.layout.page.mobile_option_columns
      : config.layout.page.desktop_option_columns,
  };
}

/**
 * 根据设备能力、舞台尺寸和配置计算手机、紧凑或桌面布局。
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
  const browserDocument = (globalThis as { document?: Document }).document;
  const isMobileDevice = browserDocument !== undefined &&
    isMobileEnvironment(browserDocument, config.responsive);
  return resolveResponsiveLayoutFromMetrics({
    stageWidth,
    stageHeight,
    safeArea: resolvedSafeArea,
    isMobileDevice,
  }, config);
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
