import type {
  CoverThemeTokens,
  GameUiConfig,
} from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import { PointerTooltip } from "../components/PointerTooltip";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
} from "../laya/LayaRuntime";
import type { UiBrandView } from "../ports/GameUiPort";
import {
  buildCoverMenuItems,
  resolveCoverBrandGeometry,
  resolveCoverAccountGeometry,
  resolveCoverChangelogGeometry,
  resolveCoverMenuItemGeometry,
  resolveCoverMenuLayout,
  resolveCoverSettingsGeometry,
  resolveCoverStoreGeometry,
  resolveCoverTextRecordsGeometry,
} from "../models/CoverMenuModel";
import {
  resolveCoverArtworkGeometry,
  resolveCoverThemeArtwork,
} from "../models/CoverThemeModel";
import type {
  CoverMenuItem,
  CoverPageActions,
} from "../models/CoverMenuModel";
import type { PageView } from "./PageView";

/** 展示双行标题、五个主入口和独立设置键的封面页面。 */
export class CoverPage implements PageView {
  public readonly root: LayaSpriteLike;
  private readonly tooltip: PointerTooltip | null;

  /** 创建带末日封面、响应式菜单和延迟简介的页面。 */
  public constructor(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    brand: UiBrandView,
    coverTheme: CoverThemeTokens,
    canLoadGame: boolean,
    actions: CoverPageActions,
  ) {
    this.root = factory.container("page-menu");
    this.root.size(layout.stageWidth, layout.stageHeight);
    this.root.graphics.drawRect(
      0,
      0,
      layout.stageWidth,
      layout.stageHeight,
      config.theme.background,
    );
    this.renderArtwork(runtime, factory, layout, coverTheme);
    this.renderScrim(factory, config, layout);
    if (coverTheme.brand_mode === "overlay") {
      this.renderBrand(factory, config, layout, brand);
    }
    this.renderUtilities(factory, config, layout, actions);
    const menuLayout = resolveCoverMenuLayout(config, layout);
    this.tooltip = menuLayout.pointer_tooltip_enabled
      ? this.createPointerTooltip(runtime, factory, config, layout)
      : null;
    this.renderMenu(
      factory,
      config,
      layout,
      buildCoverMenuItems(config, canLoadGame, actions),
    );
  }

  /** 在安全区绘制顶部账户和底部商店、更新日志、文本记录工具行。 */
  private renderUtilities(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    actions: CoverPageActions,
  ): void {
    factory.button(this.root, {
      testId: "menu-settings",
      label: config.texts.settings,
      ...resolveCoverSettingsGeometry(config, layout),
      tone: "default",
      onClick: actions.openSettings,
    });
    factory.button(this.root, {
      testId: "menu-account-login",
      label: config.texts.account_login,
      ...resolveCoverAccountGeometry(config, layout),
      tone: "default",
      fontSize: config.typography.caption_size,
      onClick: actions.showAccountLogin,
    });
    factory.button(this.root, {
      testId: "menu-store",
      label: config.texts.store,
      ...resolveCoverStoreGeometry(config, layout),
      tone: "default",
      fontSize: config.typography.caption_size,
      onClick: actions.showStore,
    });
    factory.button(this.root, {
      testId: "menu-update-log",
      label: config.texts.update_log,
      ...resolveCoverChangelogGeometry(config, layout),
      tone: "muted",
      fontSize: config.typography.caption_size,
      onClick: actions.showUpdateLog ?? (() => undefined),
    });
    factory.button(this.root, {
      testId: "menu-text-records",
      label: config.texts.text_records,
      ...resolveCoverTextRecordsGeometry(config, layout),
      tone: "muted",
      fontSize: config.typography.caption_size,
      onClick: actions.showTextRecords,
    });
  }

  /** 释放悬停计时器和封面显示树。 */
  public destroy(): void {
    this.tooltip?.destroy();
    this.root.offAll();
    this.root.destroy(true);
  }

  /** 页面被二级层覆盖时立即清理悬停简介与待触发计时器。 */
  public setActive(active: boolean): void {
    if (!active) {
      this.tooltip?.leave();
    }
  }

  /** 加载封面并按当前主题与断点声明的 fit 策略等比居中。 */
  private renderArtwork(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    layout: ResponsiveLayout,
    coverTheme: CoverThemeTokens,
  ): void {
    const themeArtwork = resolveCoverThemeArtwork(coverTheme, layout);
    const artworkViewport = factory.container("menu-cover-viewport");
    artworkViewport.size(layout.stageWidth, layout.stageHeight);
    artworkViewport.scrollRect = new runtime.Rectangle(
      0,
      0,
      layout.stageWidth,
      layout.stageHeight,
    );
    const artwork = new runtime.Image();
    artwork.name = "menu-cover-art";
    artwork.visible = false;
    artworkViewport.addChild(artwork);
    this.root.addChild(artworkViewport);

    /** 使用实际纹理尺寸与配置化 fit 计算封面几何。 */
    const layoutArtwork = (): void => {
      const sourceWidth =
        artwork.source?.sourceWidth ||
        artwork.source?.width ||
        themeArtwork.width ||
        0;
      const sourceHeight =
        artwork.source?.sourceHeight ||
        artwork.source?.height ||
        themeArtwork.height ||
        0;
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        return;
      }
      const geometry = resolveCoverArtworkGeometry(
        { width: sourceWidth, height: sourceHeight, fit: themeArtwork.fit },
        layout.stageWidth,
        layout.stageHeight,
      );
      artwork.size(geometry.width, geometry.height);
      artwork.pos(geometry.x, geometry.y);
      artwork.visible = true;
    };

    artwork.on(runtime.Event.LOADED, artwork, layoutArtwork);
    artwork.skin = themeArtwork.asset;
    layoutArtwork();
  }

  /** 绘制配置化双行品牌标题。 */
  private renderBrand(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    brand: UiBrandView,
  ): void {
    const geometry = resolveCoverBrandGeometry(config, layout);
    factory.text(this.root, {
      testId: "menu-title",
      text: brand.title,
      x: geometry.x,
      y: geometry.titleY,
      width: geometry.width,
      height: config.typography.cover_title_size + config.controls.button_gap,
      fontSize: config.typography.cover_title_size,
      color: config.theme.text,
      bold: true,
      wordWrap: false,
    });
    factory.text(this.root, {
      testId: "menu-subtitle",
      text: brand.subtitle,
      x: geometry.x,
      y: geometry.subtitleY,
      width: geometry.width,
      height: config.typography.cover_subtitle_size + config.controls.button_gap,
      fontSize: config.typography.cover_subtitle_size,
      color: config.theme.accent,
      bold: true,
      wordWrap: false,
    });
    const divider = factory.container("menu-brand-divider");
    divider.pos(geometry.x, geometry.dividerY);
    divider.size(geometry.dividerWidth, geometry.dividerHeight);
    divider.graphics.drawRect(
      0,
      0,
      geometry.dividerWidth,
      geometry.dividerHeight,
      config.theme.border,
    );
    divider.graphics.drawRect(
      0,
      0,
      geometry.dividerAccentWidth,
      geometry.dividerHeight,
      config.theme.accent,
    );
    this.root.addChild(divider);
  }

  /** 按响应式配置绘制五个入口，皮肤与形状由当前封面变体决定。 */
  private renderMenu(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    menuItems: readonly CoverMenuItem[],
  ): void {
    const desktopSkin = {
      idle: config.assets.skins.cover_button_idle,
      hover: config.assets.skins.cover_button_hover,
      pressed: config.assets.skins.cover_button_pressed,
      disabled: config.assets.skins.cover_button_disabled,
    };
    const menuLayout = resolveCoverMenuLayout(config, layout);
    menuItems.forEach((item, index) => {
      const geometry = resolveCoverMenuItemGeometry(
        config,
        layout,
        index,
        menuItems.length,
      );
      const button = factory.button(this.root, {
        testId: `menu-${item.id}`,
        label: item.label,
        ...geometry,
        tone: "primary",
        disabled: item.disabled,
        skin: menuLayout.use_button_skin ? desktopSkin : undefined,
        onClick: item.action,
      });
      if (this.tooltip !== null) {
        this.tooltip.bind(
          button,
          { title: item.label, description: item.description },
          item.disabled,
        );
      }
    });
  }

  /** 创建桌面端延迟 0.3 秒并跟随鼠标的简介浮层。 */
  private createPointerTooltip(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
  ): PointerTooltip {
    return new PointerTooltip(runtime, factory, this.root, {
      testId: "menu-description",
      delayMs: config.motion.cover_menu_description_delay_ms,
      width: config.controls.tooltip_width,
      padding: config.controls.tooltip_padding,
      offset: {
        x: config.controls.tooltip_offset_x,
        y: config.controls.tooltip_offset_y,
      },
      bounds: {
        left: layout.safeArea.left,
        top: layout.safeArea.top,
        right: layout.stageWidth - layout.safeArea.right,
        bottom: layout.stageHeight - layout.safeArea.bottom,
      },
      titleFontSize: config.typography.section_title_size,
      titleLineHeight: config.typography.body_line_height,
      descriptionFontSize: config.typography.body_size,
      descriptionLineHeight: config.typography.body_line_height,
      contentGap: config.controls.button_gap,
    });
  }

  /** 绘制左侧实色到透明的配置化渐隐层。 */
  private renderScrim(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
  ): void {
    const scrimWidth =
      layout.stageWidth * config.layout.cover.image_dark_edge_ratio;
    const solidWidth =
      scrimWidth * config.layout.cover.image_dark_solid_ratio;
    const fadeWidth = Math.max(0, scrimWidth - solidWidth);
    const fadeSteps = config.layout.cover.image_dark_fade_steps;
    const stripWidth = fadeWidth / fadeSteps;
    const scrim = factory.container("menu-cover-scrim");
    scrim.size(scrimWidth, layout.stageHeight);
    scrim.graphics.drawRect(
      0,
      0,
      solidWidth,
      layout.stageHeight,
      config.theme.overlay,
    );
    for (let index = 0; index < fadeSteps; index += 1) {
      const opacityRatio = 1 - (index + 1) / fadeSteps;
      scrim.graphics.drawRect(
        solidWidth + index * stripWidth,
        0,
        stripWidth,
        layout.stageHeight,
        scaleHexAlpha(config.theme.overlay, opacityRatio),
      );
    }
    this.root.addChild(scrim);
  }
}

/** 按比例缩放十六进制主题色的 Alpha 通道。 */
function scaleHexAlpha(color: string, ratio: number): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (match === null) {
    return color;
  }
  const rgb = match[1];
  if (rgb === undefined) {
    return color;
  }
  const alpha = Number.parseInt(match[2] ?? "ff", 16);
  const scaledAlpha = Math.round(alpha * Math.max(0, Math.min(1, ratio)));
  return `#${rgb}${scaledAlpha.toString(16).padStart(2, "0")}`;
}
