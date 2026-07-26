import { afterEach, describe, expect, it, vi } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  LocalStorageUiSettingsRepository,
  MemoryStorage,
} from "../../src/infrastructure";
import {
  resolveResponsiveLayoutFromMetrics,
  resolveResponsiveLayoutKind,
  type ResponsiveLayout,
  type ResponsiveLayoutMetrics,
} from "../../src/styles/ResponsiveLayout";
import { resolvePageActionBarGeometry } from "../../src/ui/components/PageActionBar";
import { DelayedHoverIntent } from "../../src/ui/interactions/DelayedHoverIntent";
import { PageStack } from "../../src/ui/navigation/PageStack";
import {
  buildCoverMenuItems,
  resolveCoverArtwork,
  resolveCoverDescriptionGeometry,
  resolveCoverMenuItemGeometry,
} from "../../src/ui/pages/CoverPage";
import { resolvePageScaffoldGeometry } from "../../src/ui/pages/PageView";
import {
  buildFunctionMenuPrompt,
  createCreditsDocument,
} from "../../src/ui/pages/SystemMenuPages";

const webConfig = parseWebGameConfig(webConfigDocument);
const zeroSafeArea = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** 使用显式设备能力和安全区构造确定性的响应式测试布局。 */
function resolveTestLayout(
  stageWidth: number,
  stageHeight: number,
  isMobileDevice: boolean,
  safeArea: ResponsiveLayoutMetrics["safeArea"] = zeroSafeArea,
): ResponsiveLayout {
  return resolveResponsiveLayoutFromMetrics(
    { stageWidth, stageHeight, isMobileDevice, safeArea },
    webConfig,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("覆盖式 PageStack 路由语义", () => {
  it("压栈保留根路由引用，返回仅移除顶层", () => {
    const root = { screen: "dashboard" } as const;
    const story = { screen: "story" } as const;
    const settings = { screen: "settings" } as const;
    const stack = new PageStack(root);

    stack.push(story);
    stack.push(settings);

    expect(stack.depth()).toBe(3);
    expect(stack.entries()).toEqual([root, story, settings]);
    expect(stack.entries()[0]).toBe(root);

    stack.pop();

    expect(stack.entries()).toEqual([root, story]);
    expect(stack.current()).toBe(story);
    expect(stack.entries()[0]).toBe(root);
  });

  it("替换只更新顶层，重置才销毁整条路由链", () => {
    const root = { screen: "dashboard" } as const;
    const stack = new PageStack(root);
    stack.push({ screen: "management_categories" });
    const replacement = {
      screen: "management_options",
      context: { categoryId: "facility" },
    } as const;

    stack.replace(replacement);

    expect(stack.entries()[0]).toBe(root);
    expect(stack.current()).toBe(replacement);
    stack.reset({ screen: "menu" });
    expect(stack.depth()).toBe(1);
    expect(stack.current().screen).toBe("menu");
  });
});

describe("手机、紧凑与桌面响应式基础", () => {
  it("按设备能力和配置化可用宽度稳定解析三种布局", () => {
    const desktopMinimum = webConfig.responsive.desktop_min_stage_width;

    expect(
      resolveResponsiveLayoutKind(desktopMinimum, true, desktopMinimum),
    ).toBe("mobile");
    expect(
      resolveResponsiveLayoutKind(desktopMinimum - 1, false, desktopMinimum),
    ).toBe("compact");
    expect(
      resolveResponsiveLayoutKind(desktopMinimum, false, desktopMinimum),
    ).toBe("desktop");

    const mobile = resolveTestLayout(
      webConfig.engine.mobile_design_width,
      webConfig.engine.mobile_design_height,
      true,
    );
    const compact = resolveTestLayout(
      desktopMinimum - 1,
      webConfig.engine.design_height,
      false,
    );
    const desktop = resolveTestLayout(
      desktopMinimum,
      webConfig.engine.design_height,
      false,
    );

    expect(mobile.kind).toBe("mobile");
    expect(compact.kind).toBe("compact");
    expect(desktop.kind).toBe("desktop");
    expect(mobile.usesCompactUi).toBe(true);
    expect(compact.usesCompactUi).toBe(true);
    expect(desktop.usesCompactUi).toBe(false);
  });

  it("左右安全区会参与桌面断点而不是仅扣减内容宽度", () => {
    const safeArea = {
      top: 0,
      right: webConfig.layout.desktop.outer_padding,
      bottom: 0,
      left: webConfig.layout.desktop.outer_padding,
    } as const;
    const availableWidth = webConfig.responsive.desktop_min_stage_width;
    const desktop = resolveTestLayout(
      availableWidth + safeArea.left + safeArea.right,
      webConfig.engine.design_height,
      false,
      safeArea,
    );
    const compact = resolveTestLayout(
      availableWidth + safeArea.left + safeArea.right - 1,
      webConfig.engine.design_height,
      false,
      safeArea,
    );

    expect(desktop.kind).toBe("desktop");
    expect(compact.kind).toBe("compact");
  });

  it("非对称安全区中的二级页面按可用内容范围居中", () => {
    const safeArea = {
      top: 0,
      right: webConfig.layout.desktop.outer_padding,
      bottom: webConfig.layout.mobile.outer_padding,
      left: webConfig.controls.minimum_touch_size,
    } as const;
    const layout = resolveTestLayout(
      webConfig.responsive.desktop_min_stage_width +
        safeArea.left +
        safeArea.right,
      webConfig.engine.design_height,
      false,
      safeArea,
    );
    const geometry = resolvePageScaffoldGeometry(webConfig, layout);
    const expectedLeft =
      layout.contentLeft + (layout.contentWidth - geometry.pageWidth) / 2;

    expect(layout.kind).toBe("desktop");
    expect(geometry.pageLeft).toBe(expectedLeft);
    expect(geometry.pageLeft).toBeGreaterThanOrEqual(layout.contentLeft);
    expect(geometry.pageLeft + geometry.pageWidth).toBeLessThanOrEqual(
      layout.contentLeft + layout.contentWidth,
    );
  });

  it("桌面封面简介在配置化最小宽度和安全区内保持完整", () => {
    const safeArea = {
      top: webConfig.layout.desktop.outer_padding,
      right: webConfig.layout.desktop.outer_padding,
      bottom: 0,
      left: webConfig.controls.minimum_touch_size,
    } as const;
    const stageWidth =
      webConfig.responsive.desktop_min_stage_width +
      safeArea.left +
      safeArea.right;
    const layout = resolveTestLayout(
      stageWidth,
      webConfig.engine.design_height,
      false,
      safeArea,
    );
    const geometry = resolveCoverDescriptionGeometry(webConfig, layout);

    expect(layout.kind).toBe("desktop");
    expect(geometry.x).toBe(
      safeArea.left + webConfig.layout.cover.desktop.description_left,
    );
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(
      stageWidth - safeArea.right,
    );
  });
});

describe("六入口响应式封面契约", () => {
  /** 创建不产生副作用的封面回调夹具。 */
  function createActions() {
    return {
      startSingle: vi.fn(),
      loadGame: vi.fn(),
      startMultiplayer: vi.fn(),
      startStory: vi.fn(),
      showCredits: vi.fn(),
      exitGame: vi.fn(),
    };
  }

  it("包含六项精确顺序且退出永远最低", () => {
    const items = buildCoverMenuItems(webConfig, false, createActions());

    expect(items.map((item) => item.label)).toEqual([
      "新的游戏",
      "游玩存档",
      "多人游戏",
      "剧情模式",
      "鸣谢",
      "退出",
    ]);
    expect(items.at(-1)?.id).toBe("exit");
    expect(items.find((item) => item.id === "load-game")?.disabled).toBe(true);
    expect(items.every((item) => item.description.length > 0)).toBe(true);
  });

  it("桌面使用 PNG 平行四边形网格，手机使用主题色矩形单列", () => {
    const desktop = resolveTestLayout(
      webConfig.responsive.desktop_min_stage_width,
      webConfig.engine.design_height,
      false,
    );
    const mobile = resolveTestLayout(
      webConfig.engine.mobile_design_width,
      webConfig.engine.mobile_design_height,
      true,
    );
    const itemCount = buildCoverMenuItems(webConfig, false, createActions()).length;
    const desktopFirst = resolveCoverMenuItemGeometry(webConfig, desktop, 0, itemCount);
    const desktopSecondRow = resolveCoverMenuItemGeometry(webConfig, desktop, 2, itemCount);
    const desktopExit = resolveCoverMenuItemGeometry(webConfig, desktop, 5, itemCount);
    const mobileFirst = resolveCoverMenuItemGeometry(webConfig, mobile, 0, itemCount);
    const mobileSecond = resolveCoverMenuItemGeometry(webConfig, mobile, 1, itemCount);
    const mobileExit = resolveCoverMenuItemGeometry(webConfig, mobile, 5, itemCount);

    expect(webConfig.assets.skins.cover_button_idle).toContain(
      "menu_button_idle.png",
    );
    expect(desktopFirst.shape).toBe("parallelogram");
    expect(desktopSecondRow.y).toBeGreaterThan(desktopFirst.y);
    expect(desktopSecondRow.x).toBeGreaterThan(desktopFirst.x);
    expect(desktopExit.y).toBeGreaterThan(desktopSecondRow.y);
    expect(webConfig.layout.cover.desktop.description_height).toBeGreaterThanOrEqual(
      webConfig.layout.desktop.panel_padding * 2
        + webConfig.typography.body_line_height * 4,
    );
    expect(mobileFirst.shape).toBe("rectangle");
    expect(mobileFirst.x).toBe((mobile.stageWidth - mobileFirst.width) / 2);
    expect(mobileSecond.x).toBe(mobileFirst.x);
    expect(mobileSecond.y).toBeGreaterThan(mobileFirst.y);
    expect(mobileExit.y).toBeGreaterThan(mobileSecond.y);
    expect(resolveCoverArtwork(webConfig, desktop)).toBe(webConfig.assets.cover);
    expect(resolveCoverArtwork(webConfig, mobile)).toBe(
      webConfig.assets.mobile_cover,
    );
  });

  it("手机横屏使用两列矩形菜单且完整落在安全区域内", () => {
    const landscape = resolveTestLayout(
      webConfig.engine.mobile_design_height,
      webConfig.engine.mobile_design_width,
      true,
    );
    const itemCount = buildCoverMenuItems(webConfig, false, createActions()).length;
    const first = resolveCoverMenuItemGeometry(webConfig, landscape, 0, itemCount);
    const second = resolveCoverMenuItemGeometry(webConfig, landscape, 1, itemCount);
    const exit = resolveCoverMenuItemGeometry(webConfig, landscape, 5, itemCount);

    expect(landscape.kind).toBe("mobile");
    expect(landscape.isLandscape).toBe(true);
    expect(first.shape).toBe("rectangle");
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
    expect(exit.y + exit.height).toBeLessThanOrEqual(landscape.stageHeight);
  });

  it("悬停满配置化 800ms 才发布简介，离开立即清空", () => {
    vi.useFakeTimers();
    const listener = vi.fn<(value: string | null) => void>();
    const intent = new DelayedHoverIntent(
      webConfig.motion.cover_menu_description_delay_ms,
      listener,
    );

    intent.enter("剧情模式简介");
    vi.advanceTimersByTime(
      webConfig.motion.cover_menu_description_delay_ms - 1,
    );
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenLastCalledWith("剧情模式简介");

    intent.leave();
    expect(listener).toHaveBeenLastCalledWith(null);
    intent.destroy();
  });

  it("鸣谢文档正文严格为空", () => {
    expect(createCreditsDocument(webConfig)).toEqual({
      title: "鸣谢",
      body: "",
    });
  });
});

describe("通用底部操作区与本地设置", () => {
  it("ESC 菜单严格包含存档、设置、回档、退出", () => {
    const unavailable = buildFunctionMenuPrompt(webConfig, false);
    const available = buildFunctionMenuPrompt(webConfig, true);

    expect(unavailable.options.map((option) => option.id)).toEqual([
      "save",
      "settings",
      "rollback",
      "exit",
    ]);
    expect(unavailable.options.find((option) => option.id === "rollback")?.disabled)
      .toBe(true);
    expect(available.options.find((option) => option.id === "rollback")?.disabled)
      .toBe(false);
  });

  it("双动作在固定页脚中等宽排列且不超过配置最大宽度", () => {
    const geometry = resolvePageActionBarGeometry(webConfig, 1180, 700, 2);

    expect(geometry.barHeight).toBe(webConfig.layout.page.footer_height);
    expect(geometry.barTop + geometry.barHeight).toBe(700);
    expect(geometry.buttonWidth).toBeLessThanOrEqual(
      webConfig.layout.page.footer_action_max_width,
    );
    expect(geometry.contentLeft).toBeGreaterThanOrEqual(0);
  });

  it("设置按配置化键名和版本持久化，损坏数据安全回退", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageUiSettingsRepository(
      storage,
      webConfig.storage.settings_key,
      webConfig.storage.settings_schema_version,
    );

    expect(repository.load({ reducedMotion: false })).toEqual({
      reducedMotion: false,
    });
    repository.save({ reducedMotion: true });
    expect(repository.load({ reducedMotion: false })).toEqual({
      reducedMotion: true,
    });

    storage.setItem(webConfig.storage.settings_key, "{broken");
    expect(repository.load({ reducedMotion: false })).toEqual({
      reducedMotion: false,
    });
  });
});
