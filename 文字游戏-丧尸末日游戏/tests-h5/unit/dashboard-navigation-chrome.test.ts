import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import { resolveResponsiveLayoutFromMetrics } from "../../src/styles/ResponsiveLayout";
import {
  hasRestorableStoryState,
  resolveDashboardHeaderNavigationGeometry,
  resolveVisibleDashboardNavigation,
  shouldRenderDashboardMission,
} from "../../src/ui/components/DashboardNavigationChrome";
import type { GameUiSnapshot } from "../../src/ui/ports/GameUiPort";
import { buildH5Harness } from "../helpers/H5TestHarness";

const webConfig = parseWebGameConfig(webConfigDocument);

/** 以真实适配器创建指定模式的指挥台快照。 */
function createSnapshot(mode: "single" | "multiplayer" | "story"): GameUiSnapshot {
  const harness = buildH5Harness();
  const playerNames = mode === "multiplayer" ? ["甲", "乙"] : ["所长"];
  const result = harness.adapter.execute({
    type: "start_game",
    mode,
    playerNames,
  });
  if (result.snapshot === undefined) {
    throw new Error("测试开局没有返回指挥台快照。");
  }
  return result.snapshot;
}

describe("指挥台模式化导航组件", () => {
  it("普通模式隐藏剧情入口和任务卡，仅保留生存导航", () => {
    const snapshot = createSnapshot("single");

    expect(
      resolveVisibleDashboardNavigation(
        webConfig.navigation,
        "mobile_bottom",
        snapshot,
      ).map((item) => item.id),
    ).toEqual(["dashboard", "explore", "management", "supplies"]);
    expect(
      resolveVisibleDashboardNavigation(
        webConfig.navigation,
        "desktop_header",
        snapshot,
      ).map((item) => item.id),
    ).toEqual(["settings"]);
    expect(snapshot.storyAccess).toBe("hidden");
    expect(snapshot.storyPrompt).toBeNull();
    expect(snapshot.mission).toBeNull();
    expect(shouldRenderDashboardMission(snapshot)).toBe(false);
  });

  it("剧情模式在紧凑底栏和电脑标题栏展示剧情入口与任务卡", () => {
    const snapshot = createSnapshot("story");

    expect(
      resolveVisibleDashboardNavigation(
        webConfig.navigation,
        "mobile_bottom",
        snapshot,
      ).map((item) => item.id),
    ).toEqual(["dashboard", "story", "explore", "management", "supplies"]);
    expect(
      resolveVisibleDashboardNavigation(
        webConfig.navigation,
        "desktop_header",
        snapshot,
      ).map((item) => item.id),
    ).toEqual(["story", "settings"]);
    expect(shouldRenderDashboardMission(snapshot)).toBe(true);
  });

  it("旧普通存档存在剧情结局时保留剧情恢复入口", () => {
    const snapshot: GameUiSnapshot = {
      ...createSnapshot("single"),
      ended: true,
      storyAccess: "legacy_resume",
      mission: {
        chapterLabel: "旧存档",
        title: "旧存档结局",
        objective: "继续查看结局。",
        progressLabel: "已完成",
      },
      ending: {
        title: "旧存档结局",
        body: "继续查看结局。",
      },
    };

    expect(hasRestorableStoryState(snapshot)).toBe(true);
    expect(
      resolveVisibleDashboardNavigation(
        webConfig.navigation,
        "desktop_header",
        snapshot,
      ).map((item) => item.id),
    ).toEqual(["story", "settings"]);
    expect(shouldRenderDashboardMission(snapshot)).toBe(true);
  });

  it("普通生存失败不会重新暴露剧情入口", () => {
    const snapshot: GameUiSnapshot = {
      ...createSnapshot("single"),
      ended: true,
      ending: {
        title: "避难所失守",
        body: "本局已经结束。",
      },
    };

    expect(hasRestorableStoryState(snapshot)).toBe(false);
    expect(resolveVisibleDashboardNavigation(
      webConfig.navigation,
      "desktop_header",
      snapshot,
    ).map((item) => item.id)).toEqual(["settings"]);
    expect(shouldRenderDashboardMission(snapshot)).toBe(false);
  });

  it("手机标题栏锚定左侧，普通与紧凑电脑仍锚定右侧", () => {
    const safeArea = { top: 12, right: 18, bottom: 10, left: 24 } as const;
    const mobile = resolveResponsiveLayoutFromMetrics(
      {
        stageWidth: webConfig.engine.mobile_design_width,
        stageHeight: webConfig.engine.mobile_design_height,
        isMobileDevice: true,
        safeArea,
      },
      webConfig,
    );
    const compactDesktop = resolveResponsiveLayoutFromMetrics(
      {
        stageWidth: webConfig.responsive.desktop_min_stage_width - 1,
        stageHeight: 900,
        isMobileDevice: false,
        safeArea,
      },
      webConfig,
    );
    const desktop = resolveResponsiveLayoutFromMetrics(
      {
        stageWidth: 1440,
        stageHeight: 900,
        isMobileDevice: false,
        safeArea,
      },
      webConfig,
    );
    const mobileGeometry = resolveDashboardHeaderNavigationGeometry(
      webConfig,
      mobile,
      1,
    );
    const compactGeometry = resolveDashboardHeaderNavigationGeometry(
      webConfig,
      compactDesktop,
      1,
    );
    const desktopGeometry = resolveDashboardHeaderNavigationGeometry(
      webConfig,
      desktop,
      2,
    );

    expect(mobile.kind).toBe("mobile");
    expect(compactDesktop.kind).toBe("compact");
    expect(desktop.kind).toBe("desktop");
    expect(mobileGeometry?.left).toBe(safeArea.left + mobile.outerPadding);
    for (const [layout, geometry] of [
      [compactDesktop, compactGeometry],
      [desktop, desktopGeometry],
    ] as const) {
      expect(geometry?.itemWidth).toBeGreaterThanOrEqual(
        webConfig.controls.minimum_touch_size,
      );
      expect((geometry?.left ?? 0) + (geometry?.width ?? 0)).toBe(
        layout.stageWidth - layout.safeArea.right - layout.outerPadding,
      );
    }
  });
});
