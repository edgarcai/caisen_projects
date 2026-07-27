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
  resolveCoverChangelogGeometry,
  resolveCoverDescriptionGeometry,
  resolveCoverMenuLayout,
  resolveCoverMenuItemGeometry,
  resolveCoverSettingsGeometry,
} from "../../src/ui/models/CoverMenuModel";
import { resolvePageScaffoldGeometry } from "../../src/ui/pages/PageView";
import {
  buildFunctionMenuPrompt,
  buildReturnMenuConfirmDocument,
  buildCoverThemePrompt,
  buildSettingsPrompt,
  createCreditsDocument,
} from "../../src/ui/pages/SystemMenuPages";
import {
  buildCoverThemeSelectionStates,
  resolveCoverArtworkGeometry,
  resolveCoverThemeArtwork,
  resolveSelectedCoverTheme,
} from "../../src/ui/models/CoverThemeModel";

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

describe("五入口响应式封面与系统键契约", () => {
  /** 创建不产生副作用的封面回调夹具。 */
  function createActions() {
    return {
      startSingle: vi.fn(),
      loadGame: vi.fn(),
      startMultiplayer: vi.fn(),
      startStory: vi.fn(),
      showCredits: vi.fn(),
      openSettings: vi.fn(),
    };
  }

  it("主菜单包含五项精确顺序，且封面不承载退出", () => {
    const items = buildCoverMenuItems(webConfig, false, createActions());

    expect(items.map((item) => item.label)).toEqual([
      "新的游戏",
      "游玩存档",
      "多人游戏",
      "剧情模式",
      "鸣谢",
    ]);
    expect(items.some((item) => item.id === "exit")).toBe(false);
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
    const desktopLast = resolveCoverMenuItemGeometry(webConfig, desktop, 4, itemCount);
    const mobileFirst = resolveCoverMenuItemGeometry(webConfig, mobile, 0, itemCount);
    const mobileSecond = resolveCoverMenuItemGeometry(webConfig, mobile, 1, itemCount);
    const mobileLast = resolveCoverMenuItemGeometry(webConfig, mobile, 4, itemCount);

    expect(webConfig.assets.skins.cover_button_idle)
      .toMatch(/menu_button_idle(?:_2k)?\.png$/u);
    expect(desktopFirst.shape).toBe("parallelogram");
    expect(desktopSecondRow.y).toBeGreaterThan(desktopFirst.y);
    expect(desktopSecondRow.x).toBeGreaterThan(desktopFirst.x);
    expect(desktopLast.y).toBeGreaterThan(desktopSecondRow.y);
    expect(webConfig.layout.cover.desktop.description_height).toBeGreaterThanOrEqual(
      webConfig.layout.desktop.panel_padding * 2
        + webConfig.typography.body_line_height * 4,
    );
    expect(mobileFirst.shape).toBe("rectangle");
    expect(mobileFirst.x).toBe((mobile.stageWidth - mobileFirst.width) / 2);
    expect(mobileSecond.x).toBe(mobileFirst.x);
    expect(mobileSecond.y).toBeGreaterThan(mobileFirst.y);
    expect(mobileLast.y).toBeGreaterThan(mobileSecond.y);
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
    const last = resolveCoverMenuItemGeometry(webConfig, landscape, 4, itemCount);

    expect(landscape.kind).toBe("mobile");
    expect(landscape.isLandscape).toBe(true);
    expect(first.shape).toBe("rectangle");
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
    expect(last.y + last.height).toBeLessThanOrEqual(landscape.stageHeight);
  });

  it("手机竖屏与横屏的鸣谢均不与更新日志重叠", () => {
    const layouts = [
      resolveTestLayout(
        webConfig.engine.mobile_design_width,
        webConfig.engine.mobile_design_height,
        true,
      ),
      resolveTestLayout(
        webConfig.engine.mobile_design_height,
        webConfig.engine.mobile_design_width,
        true,
      ),
    ];
    const itemCount = buildCoverMenuItems(webConfig, false, createActions()).length;

    for (const layout of layouts) {
      const credits = resolveCoverMenuItemGeometry(
        webConfig,
        layout,
        itemCount - 1,
        itemCount,
      );
      const changelog = resolveCoverChangelogGeometry(webConfig, layout);
      const separated =
        credits.x + credits.width <= changelog.x ||
        changelog.x + changelog.width <= credits.x ||
        credits.y + credits.height <= changelog.y ||
        changelog.y + changelog.height <= credits.y;

      expect(separated).toBe(true);
    }
  });

  it("手机封面设置键锚定左安全区，电脑锚定右安全区", () => {
    const desktop = resolveTestLayout(1440, 900, false, {
      top: 12,
      right: 18,
      bottom: 0,
      left: 8,
    });
    const mobilePortrait = resolveTestLayout(600, 1067, true, {
      top: 36,
      right: 20,
      bottom: 24,
      left: 16,
    });
    const mobileLandscape = resolveTestLayout(1067, 600, true, {
      top: 18,
      right: 24,
      bottom: 12,
      left: 30,
    });
    const layouts = [desktop, mobilePortrait, mobileLandscape];

    for (const layout of layouts) {
      const geometry = resolveCoverSettingsGeometry(webConfig, layout);
      const tokens = resolveCoverMenuLayout(webConfig, layout);
      expect(geometry.width).toBeGreaterThanOrEqual(
        webConfig.controls.minimum_touch_size,
      );
      expect(geometry.height).toBeGreaterThanOrEqual(
        webConfig.controls.minimum_touch_size,
      );
      expect(geometry.x).toBeGreaterThanOrEqual(layout.safeArea.left);
      expect(geometry.y).toBeGreaterThanOrEqual(layout.safeArea.top);
      expect(geometry.x + geometry.width).toBeLessThanOrEqual(
        layout.stageWidth - layout.safeArea.right,
      );
      expect(geometry.y + geometry.height).toBeLessThanOrEqual(
        layout.stageHeight - layout.safeArea.bottom,
      );
      if (layout.kind === "mobile") {
        expect(tokens.settings_button_anchor).toBe("left");
        expect(geometry.x).toBe(
          layout.safeArea.left + tokens.settings_button_offset,
        );
      } else {
        expect(tokens.settings_button_anchor).toBe("right");
        expect(geometry.x + geometry.width).toBe(
          layout.stageWidth -
            layout.safeArea.right -
            tokens.settings_button_offset,
        );
      }
    }
  });

  it("紧凑桌面封面继续使用电脑设置键锚点", () => {
    const compactDesktop = resolveTestLayout(
      webConfig.responsive.desktop_min_stage_width - 1,
      900,
      false,
      {
        top: 12,
        right: 18,
        bottom: 0,
        left: 8,
      },
    );
    const settings = resolveCoverSettingsGeometry(webConfig, compactDesktop);
    const tokens = resolveCoverMenuLayout(webConfig, compactDesktop);

    expect(compactDesktop.kind).toBe("compact");
    expect(tokens.settings_button_anchor).toBe("right");
    expect(settings.x + settings.width).toBe(
      compactDesktop.stageWidth -
        compactDesktop.safeArea.right -
        tokens.settings_button_offset,
    );
  });

  it("悬停满配置化延迟才发布简介，离开立即清空", () => {
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

  it("封面设置仅含体验偏好，局内设置承载玩法与返回主菜单", () => {
    const cover = buildSettingsPrompt(
      webConfig,
      {
        reducedMotion: false,
        selectedCoverThemeId: webConfig.assets.cover_themes.default_id,
      },
      false,
      false,
    );
    const inGame = buildSettingsPrompt(
      webConfig,
      {
        reducedMotion: true,
        selectedCoverThemeId: webConfig.assets.cover_themes.default_id,
      },
      true,
      true,
    );

    expect(cover.options.map((option) => option.id)).toEqual([
      "cover-theme",
      "reduced-motion",
    ]);
    expect(inGame.options.map((option) => option.id)).toEqual([
      "cover-theme",
      "reduced-motion",
      "tutorial",
      "return-menu",
    ]);
    expect(inGame.options.at(-1)?.tone).toBe("danger");
  });

  it("返回主菜单确认文档只读取严格 Web 专用文案", () => {
    expect(buildReturnMenuConfirmDocument(webConfig)).toEqual({
      title: webConfig.texts.return_menu_confirm_title,
      body: webConfig.texts.return_menu_confirm_body,
      tone: "danger",
    });
    expect(webConfig.texts.return_menu_confirm_title).not.toBe("");
    expect(webConfig.texts.return_menu_confirm_body).not.toBe("");
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

    const fallback = {
      reducedMotion: false,
      selectedCoverThemeId: webConfig.assets.cover_themes.default_id,
    };
    expect(repository.load(fallback)).toEqual(fallback);
    repository.save({
      reducedMotion: true,
      selectedCoverThemeId: "bunker_gate",
    });
    expect(repository.load(fallback)).toEqual({
      reducedMotion: true,
      selectedCoverThemeId: "bunker_gate",
    });

    storage.setItem(webConfig.storage.settings_key, "{broken");
    expect(repository.load(fallback)).toEqual(fallback);
  });

  it("旧版设置迁移时保留减少动效，并使用配置默认封面", () => {
    const storage = new MemoryStorage();
    storage.setItem(webConfig.storage.settings_key, JSON.stringify({
      schema_version: 1,
      reduced_motion: true,
    }));
    const repository = new LocalStorageUiSettingsRepository(
      storage,
      webConfig.storage.settings_key,
      webConfig.storage.settings_schema_version,
    );

    expect(repository.load({
      reducedMotion: false,
      selectedCoverThemeId: webConfig.assets.cover_themes.default_id,
    })).toEqual({
      reducedMotion: true,
      selectedCoverThemeId: webConfig.assets.cover_themes.default_id,
    });
  });

  it("未来版本设置只读降级，旧代码切换偏好也不会覆盖原文档", () => {
    const futureDocument = JSON.stringify({
      schema_version: webConfig.storage.settings_schema_version + 1,
      future_motion_profile: "cinematic",
    });
    const storage = new MemoryStorage({
      [webConfig.storage.settings_key]: futureDocument,
    });
    const repository = new LocalStorageUiSettingsRepository(
      storage,
      webConfig.storage.settings_key,
      webConfig.storage.settings_schema_version,
    );
    const fallback = {
      reducedMotion: false,
      selectedCoverThemeId: webConfig.assets.cover_themes.default_id,
    };

    expect(repository.load(fallback)).toEqual(fallback);
    repository.save({
      reducedMotion: true,
      selectedCoverThemeId: "bunker_gate",
    });
    expect(storage.getItem(webConfig.storage.settings_key)).toBe(futureDocument);
  });

  it("其他页面升级设置文档后，当前旧实例在保存前重新阻止覆盖", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageUiSettingsRepository(
      storage,
      webConfig.storage.settings_key,
      webConfig.storage.settings_schema_version,
    );
    const fallback = {
      reducedMotion: false,
      selectedCoverThemeId: webConfig.assets.cover_themes.default_id,
    };
    const futureDocument = JSON.stringify({
      schema_version: webConfig.storage.settings_schema_version + 1,
      future_motion_profile: "responsive",
    });
    expect(repository.load(fallback)).toEqual(fallback);
    storage.setItem(webConfig.storage.settings_key, futureDocument);

    repository.save({
      reducedMotion: true,
      selectedCoverThemeId: "bunker_gate",
    });

    expect(storage.getItem(webConfig.storage.settings_key)).toBe(futureDocument);
  });

  it("成就封面锁定时不可选，解锁后使用独立手机竖版资源", () => {
    const lockedStates = buildCoverThemeSelectionStates(
      webConfig.assets.cover_themes,
      "bunker_gate",
      [],
    );
    const lockedPrompt = buildCoverThemePrompt(webConfig, lockedStates);
    const lockedTheme = lockedPrompt.options.find(
      (option) => option.id === "bunker_gate",
    );
    expect(lockedTheme).toMatchObject({
      disabled: true,
      tone: "muted",
    });
    expect(resolveSelectedCoverTheme(
      webConfig.assets.cover_themes,
      "bunker_gate",
      [],
    ).id).toBe(webConfig.assets.cover_themes.default_id);

    const unlockedIds = ["ending_long_night_watch"];
    const selected = resolveSelectedCoverTheme(
      webConfig.assets.cover_themes,
      "bunker_gate",
      unlockedIds,
    );
    const mobile = resolveTestLayout(600, 1067, true);
    expect(selected.id).toBe("bunker_gate");
    expect(resolveCoverThemeArtwork(selected, mobile)).toMatchObject({
      asset: "assets/covers/cover_theme_bunker_gate_mobile_2k.webp",
      width: 1152,
      height: 2048,
      fit: "contain",
    });
  });

  it("封面主题按断点选择 fit，并以纯几何保持包含或填满语义", () => {
    const unlockedIds = ["ending_long_night_watch"];
    const bunkerTheme = resolveSelectedCoverTheme(
      webConfig.assets.cover_themes,
      "bunker_gate",
      unlockedIds,
    );
    const classicTheme = resolveSelectedCoverTheme(
      webConfig.assets.cover_themes,
      webConfig.assets.cover_themes.default_id,
      unlockedIds,
    );
    const portrait = resolveTestLayout(390, 844, true);
    const landscape = resolveTestLayout(844, 390, true);
    const desktop = resolveTestLayout(1440, 900, false);

    const bunkerPortrait = resolveCoverThemeArtwork(bunkerTheme, portrait);
    const bunkerLandscape = resolveCoverThemeArtwork(bunkerTheme, landscape);
    const bunkerDesktop = resolveCoverThemeArtwork(bunkerTheme, desktop);
    const classicPortrait = resolveCoverThemeArtwork(classicTheme, portrait);
    expect(bunkerPortrait.fit).toBe("contain");
    expect(bunkerLandscape.fit).toBe("cover");
    expect(bunkerDesktop.fit).toBe("cover");
    expect(classicPortrait.fit).toBe("cover");

    const contained = resolveCoverArtworkGeometry(
      bunkerPortrait,
      portrait.stageWidth,
      portrait.stageHeight,
    );
    expect(contained.x).toBeCloseTo(0);
    expect(contained.y).toBeGreaterThan(0);
    expect(contained.width).toBeCloseTo(portrait.stageWidth);
    expect(contained.height).toBeLessThan(portrait.stageHeight);

    const covered = resolveCoverArtworkGeometry(
      classicPortrait,
      portrait.stageWidth,
      portrait.stageHeight,
    );
    expect(covered.x).toBeLessThan(0);
    expect(covered.y).toBeCloseTo(0);
    expect(covered.width).toBeGreaterThan(portrait.stageWidth);
    expect(covered.height).toBeCloseTo(portrait.stageHeight);
  });
});
