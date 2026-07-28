import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  resolveViewportOrientation,
  syncGameEnvironmentDataset,
} from "../../src/engine/layaBootstrap";
import { isDisplayNodeHierarchyVisible } from "../../src/main";
import {
  resolveResponsiveLayout,
  resolveResponsiveLayoutFromMetrics,
} from "../../src/styles/ResponsiveLayout";
import { resolveCoverArtwork } from "../../src/ui/models/CoverMenuModel";

const webConfig = parseWebGameConfig(webConfigDocument);
const zeroSafeArea = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** 创建只包含可见性与父链的最小 Laya 显示节点夹具。 */
function createDisplayNode(
  visible: boolean,
  parent: Laya.Sprite | null,
): Laya.Sprite {
  return { visible, parent } as unknown as Laya.Sprite;
}

/** 创建可调整宽高的最小浏览器文档夹具。 */
function createViewportDocument(width: number, height: number): Document {
  return {
    body: { dataset: {} },
    defaultView: { innerWidth: width, innerHeight: height },
  } as unknown as Document;
}

describe("引擎运行时回归", () => {
  it("隐藏祖先时不向 E2E 暴露子节点边界", () => {
    const stage = createDisplayNode(true, null);
    const hiddenPage = createDisplayNode(false, stage);
    const visibleButton = createDisplayNode(true, hiddenPage);

    expect(isDisplayNodeHierarchyVisible(visibleButton, stage)).toBe(false);
    hiddenPage.visible = true;
    expect(isDisplayNodeHierarchyVisible(visibleButton, stage)).toBe(true);
  });

  it("不把隐藏节点或已脱离根显示树的节点判为可见", () => {
    const stage = createDisplayNode(true, null);
    const hiddenNode = createDisplayNode(false, stage);
    const detachedRoot = createDisplayNode(true, null);
    const detachedNode = createDisplayNode(true, detachedRoot);

    expect(isDisplayNodeHierarchyVisible(hiddenNode, stage)).toBe(false);
    expect(isDisplayNodeHierarchyVisible(detachedNode, stage)).toBe(false);
  });

  it("桌面环境按当前视口宽高记录横竖屏", () => {
    const landscapeDocument = createViewportDocument(1440, 900);
    const portraitDocument = createViewportDocument(900, 1440);

    syncGameEnvironmentDataset(landscapeDocument, false);
    syncGameEnvironmentDataset(portraitDocument, false);

    expect(resolveViewportOrientation(landscapeDocument)).toBe("landscape");
    expect(landscapeDocument.body.dataset).toMatchObject({
      gameDevice: "desktop",
      gameOrientation: "landscape",
    });
    expect(resolveViewportOrientation(portraitDocument)).toBe("portrait");
    expect(portraitDocument.body.dataset).toMatchObject({
      gameDevice: "desktop",
      gameOrientation: "portrait",
    });
  });

  it("封面资源按设备类别选择，紧凑桌面仍保留桌面 PNG", () => {
    const compactDesktop = resolveResponsiveLayout(
      webConfig.responsive.desktop_min_stage_width - 1,
      webConfig.engine.design_height,
      webConfig,
      zeroSafeArea,
    );
    const desktop = resolveResponsiveLayout(
      webConfig.responsive.desktop_min_stage_width,
      webConfig.engine.design_height,
      webConfig,
      zeroSafeArea,
    );
    const mobile = resolveResponsiveLayoutFromMetrics({
      stageWidth: webConfig.engine.mobile_design_width,
      stageHeight: webConfig.engine.mobile_design_height,
      isMobileDevice: true,
      safeArea: zeroSafeArea,
    }, webConfig);

    expect(compactDesktop.usesCompactUi).toBe(true);
    expect(resolveCoverArtwork(webConfig, compactDesktop)).toBe(
      webConfig.assets.cover,
    );
    expect(desktop.usesCompactUi).toBe(false);
    expect(resolveCoverArtwork(webConfig, desktop)).toBe(webConfig.assets.cover);
    expect(mobile.kind).toBe("mobile");
    expect(resolveCoverArtwork(webConfig, mobile)).toBe(
      webConfig.assets.mobile_cover,
    );
  });
});
