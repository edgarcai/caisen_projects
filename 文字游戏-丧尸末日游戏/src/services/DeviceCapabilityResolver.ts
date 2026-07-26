/** 移动设备识别所需的最小配置契约。 */
export interface MobileDetectionConfig {
  readonly mobile_max_css_short_edge: number;
}

/** 浏览器能力探测结果，供引擎和响应式布局共享。 */
export interface DeviceCapabilities {
  readonly isMobile: boolean;
  readonly hasTouch: boolean;
  readonly hasCoarsePointer: boolean;
  readonly viewportShortEdge: number;
}

/** 带有可选 User-Agent Client Hints 的导航器。 */
interface NavigatorWithUserAgentData extends Navigator {
  readonly userAgentData?: {
    readonly mobile?: boolean;
  };
}

/** 读取不会被软键盘瞬时高度干扰的浏览器短边尺寸。 */
function resolveViewportShortEdge(windowRef: Window): number {
  const screenWidth = windowRef.screen.width;
  const screenHeight = windowRef.screen.height;
  if (screenWidth > 0 && screenHeight > 0) {
    return Math.min(screenWidth, screenHeight);
  }
  return Math.min(windowRef.innerWidth, windowRef.innerHeight);
}

/**
 * 综合 UA、触控点、粗指针和物理短边识别移动环境，兼容桌面 UA 的 iPadOS。
 */
export function resolveDeviceCapabilities(
  documentRef: Document,
  config: MobileDetectionConfig,
): DeviceCapabilities {
  const windowRef = documentRef.defaultView;
  if (windowRef === null) {
    return {
      isMobile: false,
      hasTouch: false,
      hasCoarsePointer: false,
      viewportShortEdge: 0,
    };
  }
  const navigatorRef = windowRef.navigator as NavigatorWithUserAgentData;
  const hasTouch = navigatorRef.maxTouchPoints > 0;
  const hasCoarsePointer = windowRef.matchMedia("(pointer: coarse)").matches;
  const viewportShortEdge = resolveViewportShortEdge(windowRef);
  const mobileUserAgent =
    navigatorRef.userAgentData?.mobile === true ||
    /Mobile|Android|iPhone|iPad|iPod/i.test(navigatorRef.userAgent);
  const touchDeviceWithinLimit =
    hasTouch &&
    (hasCoarsePointer || navigatorRef.maxTouchPoints > 1) &&
    viewportShortEdge <= config.mobile_max_css_short_edge;
  return {
    isMobile: mobileUserAgent || touchDeviceWithinLimit,
    hasTouch,
    hasCoarsePointer,
    viewportShortEdge,
  };
}

/** 返回当前文档是否运行在移动设备能力集合中。 */
export function isMobileEnvironment(
  documentRef: Document,
  config: MobileDetectionConfig,
): boolean {
  return resolveDeviceCapabilities(documentRef, config).isMobile;
}
