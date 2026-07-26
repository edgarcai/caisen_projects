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
const zeroSafeArea = { top: 0, right: 0, bottom: 0, left: 0 } as const;

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

  it("旧普通存档存在结局时保留剧情恢复入口", () => {
    const snapshot: GameUiSnapshot = {
      ...createSnapshot("single"),
      ended: true,
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

  it("标题栏入口位于安全区内且每项不小于触控下限", () => {
    const layout = resolveResponsiveLayoutFromMetrics(
      {
        stageWidth: webConfig.engine.design_width,
        stageHeight: webConfig.engine.design_height,
        isMobileDevice: false,
        safeArea: zeroSafeArea,
      },
      webConfig,
    );
    const geometry = resolveDashboardHeaderNavigationGeometry(
      webConfig,
      layout,
      2,
    );

    expect(geometry).not.toBeNull();
    expect(geometry?.itemWidth).toBeGreaterThanOrEqual(
      webConfig.controls.minimum_touch_size,
    );
    expect(geometry?.left).toBeGreaterThanOrEqual(layout.safeArea.left);
    expect((geometry?.left ?? 0) + (geometry?.width ?? 0)).toBeLessThanOrEqual(
      layout.stageWidth - layout.safeArea.right,
    );
  });
});
