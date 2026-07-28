import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import { resolveDeviceCapabilities } from "../../src/services/DeviceCapabilityResolver";

const webConfig = parseWebGameConfig(webConfigDocument);

/** 构建设备能力探测所需的最小浏览器文档夹具。 */
function createDeviceDocument(options: {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  readonly coarsePointer: boolean;
  readonly screenWidth: number;
  readonly screenHeight: number;
}): Document {
  return {
    defaultView: {
      navigator: {
        userAgent: options.userAgent,
        maxTouchPoints: options.maxTouchPoints,
      },
      screen: {
        width: options.screenWidth,
        height: options.screenHeight,
      },
      innerWidth: options.screenWidth,
      innerHeight: options.screenHeight,
      matchMedia: () => ({ matches: options.coarsePointer }),
    },
  } as unknown as Document;
}

describe("移动设备能力识别", () => {
  it("真实移动 UA 被识别为触控移动设备", () => {
    const documentRef = createDeviceDocument({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
      maxTouchPoints: 5,
      coarsePointer: true,
      screenWidth: 412,
      screenHeight: 915,
    });

    const capabilities = resolveDeviceCapabilities(
      documentRef,
      webConfig.responsive,
    );

    expect(capabilities).toEqual({
      isMobile: true,
      hasTouch: true,
      hasCoarsePointer: true,
      viewportShortEdge: 412,
    });
  });

  it("iPadOS 桌面 UA 通过多点触控与配置化短边识别为移动设备", () => {
    const documentRef = createDeviceDocument({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
      maxTouchPoints: 5,
      coarsePointer: true,
      screenWidth: webConfig.responsive.mobile_max_css_short_edge,
      screenHeight: 1366,
    });

    const capabilities = resolveDeviceCapabilities(
      documentRef,
      webConfig.responsive,
    );

    expect(capabilities.isMobile).toBe(true);
    expect(capabilities.hasTouch).toBe(true);
    expect(capabilities.hasCoarsePointer).toBe(true);
    expect(capabilities.viewportShortEdge).toBe(
      webConfig.responsive.mobile_max_css_short_edge,
    );
  });

  it("普通桌面 UA 且无触控能力时保持桌面模式", () => {
    const documentRef = createDeviceDocument({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
      coarsePointer: false,
      screenWidth: 1440,
      screenHeight: 900,
    });

    const capabilities = resolveDeviceCapabilities(
      documentRef,
      webConfig.responsive,
    );

    expect(capabilities).toEqual({
      isMobile: false,
      hasTouch: false,
      hasCoarsePointer: false,
      viewportShortEdge: 900,
    });
  });
});
