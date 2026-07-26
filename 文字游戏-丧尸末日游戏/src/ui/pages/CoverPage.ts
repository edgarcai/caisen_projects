import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
} from "../laya/LayaRuntime";
import type { UiBrandView } from "../ports/GameUiPort";
import type { PageView } from "./PageView";

/**
 * 封面三入口的回调集合。
 */
export interface CoverPageActions {
  readonly startSingle: () => void;
  readonly loadGame: () => void;
  readonly startMultiplayer: () => void;
}

/**
 * 只展示双行标题和三个锁定入口的封面页面。
 */
export class CoverPage implements PageView {
  public readonly root: LayaSpriteLike;

  /**
   * 创建带末日封面和左侧阶梯平行四边形菜单的页面。
   */
  public constructor(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    brand: UiBrandView,
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

    /**
     * 按原图比例居中裁切填充舞台，避免手机纵屏拉伸。
     */
    const layoutArtwork = (): void => {
      const sourceWidth =
        artwork.source?.sourceWidth ||
        artwork.source?.width ||
        config.assets.cover_width ||
        0;
      const sourceHeight =
        artwork.source?.sourceHeight ||
        artwork.source?.height ||
        config.assets.cover_height ||
        0;
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        return;
      }
      const scale = Math.max(
        layout.stageWidth / sourceWidth,
        layout.stageHeight / sourceHeight,
      );
      const renderedWidth = sourceWidth * scale;
      const renderedHeight = sourceHeight * scale;
      artwork.size(renderedWidth, renderedHeight);
      artwork.pos(
        (layout.stageWidth - renderedWidth) / 2,
        (layout.stageHeight - renderedHeight) / 2,
      );
      artwork.visible = true;
    };

    artwork.on(runtime.Event.LOADED, artwork, layoutArtwork);
    artwork.skin = config.assets.cover;
    layoutArtwork();
    this.renderScrim(factory, config, layout);
    const coverLeft = layout.safeArea.left + config.layout.cover.content_left;
    const coverTop = layout.safeArea.top + config.layout.cover.content_top;
    factory.text(this.root, {
      testId: "menu-title",
      text: brand.title,
      x: coverLeft,
      y: coverTop,
      width: config.layout.cover.menu_width,
      height: config.typography.cover_title_size + config.controls.button_gap,
      fontSize: config.typography.cover_title_size,
      color: config.theme.text,
      bold: true,
      wordWrap: false,
    });
    factory.text(this.root, {
      testId: "menu-subtitle",
      text: brand.subtitle,
      x: coverLeft,
      y: coverTop + config.typography.cover_title_size + config.controls.button_gap,
      width: config.layout.cover.menu_width,
      height: config.typography.cover_subtitle_size + config.controls.button_gap,
      fontSize: config.typography.cover_subtitle_size,
      color: config.theme.accent,
      bold: true,
      wordWrap: false,
    });
    this.renderMenu(config, layout, factory, canLoadGame, actions);
  }

  /**
   * 释放封面显示树。
   */
  public destroy(): void {
    this.root.offAll();
    this.root.destroy(true);
  }

  /**
   * 按配置偏移量绘制三个阶梯入口。
   */
  private renderMenu(
    config: GameUiConfig,
    layout: ResponsiveLayout,
    factory: UiFactory,
    canLoadGame: boolean,
    actions: CoverPageActions,
  ): void {
    const menuItems = [
      {
        id: "new-game",
        label: config.texts.start_single,
        disabled: false,
        action: actions.startSingle,
      },
      {
        id: "load-game",
        label: config.texts.start_load,
        disabled: !canLoadGame,
        action: actions.loadGame,
      },
      {
        id: "multiplayer",
        label: config.texts.start_multiplayer,
        disabled: false,
        action: actions.startMultiplayer,
      },
    ] as const;
    const menuTop = layout.safeArea.top + config.layout.cover.menu_top;
    const menuLeft = layout.safeArea.left + config.layout.cover.content_left;
    menuItems.forEach((item, index) => {
      factory.button(this.root, {
        testId: `menu-${item.id}`,
        label: item.label,
        x: menuLeft + index * config.layout.cover.menu_step_x,
        y:
          menuTop +
          index * (config.controls.button_height + config.layout.cover.menu_gap),
        width: config.layout.cover.menu_width,
        height: config.controls.button_height,
        tone: "primary",
        disabled: item.disabled,
        shape: "parallelogram",
        onClick: item.action,
      });
    });
  }

  /** 绘制左侧实色到透明的配置化渐隐层，避免封面出现硬切线。 */
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
