import type {
  CoverMenuLayoutTokens,
  GameUiConfig,
} from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import { DelayedHoverIntent } from "../interactions/DelayedHoverIntent";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
  LayaTextLike,
} from "../laya/LayaRuntime";
import type { UiBrandView } from "../ports/GameUiPort";
import type { PageView } from "./PageView";

/** 封面菜单悬停后对外发布的简介模型。 */
export interface CoverMenuDescription {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** 封面六入口的回调集合。 */
export interface CoverPageActions {
  readonly startSingle: () => void;
  readonly loadGame: () => void;
  readonly startMultiplayer: () => void;
  readonly startStory: () => void;
  readonly showCredits: () => void;
  readonly exitGame: () => void;
  readonly onDescriptionChange?: (
    description: CoverMenuDescription | null,
  ) => void;
}

/** 封面菜单渲染所需的不可变项目。 */
export interface CoverMenuItem extends CoverMenuDescription {
  readonly disabled: boolean;
  readonly action: () => void;
}

/** 封面单个菜单按钮的纯布局结果。 */
export interface CoverMenuItemGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly shape: "rectangle" | "parallelogram";
}

/** 根据当前响应式布局选择桌面 PNG 或轻量手机封面。 */
export function resolveCoverArtwork(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): string {
  return layout.isMobile ? config.assets.mobile_cover : config.assets.cover;
}

/**
 * 按固定顺序构造六个封面入口，确保退出永远位于最低优先级位置。
 */
export function buildCoverMenuItems(
  config: GameUiConfig,
  canLoadGame: boolean,
  actions: CoverPageActions,
): readonly CoverMenuItem[] {
  return [
    {
      id: "new-game",
      label: config.texts.start_single,
      description: config.texts.start_single_description,
      disabled: false,
      action: actions.startSingle,
    },
    {
      id: "load-game",
      label: config.texts.start_load,
      description: config.texts.start_load_description,
      disabled: !canLoadGame,
      action: actions.loadGame,
    },
    {
      id: "multiplayer",
      label: config.texts.start_multiplayer,
      description: config.texts.start_multiplayer_description,
      disabled: false,
      action: actions.startMultiplayer,
    },
    {
      id: "story",
      label: config.texts.start_story,
      description: config.texts.start_story_description,
      disabled: false,
      action: actions.startStory,
    },
    {
      id: "credits",
      label: config.texts.credits,
      description: config.texts.credits_description,
      disabled: false,
      action: actions.showCredits,
    },
    {
      id: "exit",
      label: config.texts.exit,
      description: config.texts.exit_description,
      disabled: false,
      action: actions.exitGame,
    },
  ];
}

/**
 * 根据桌面或手机菜单 token 计算按钮坐标，避免页面散落断点常量。
 */
export function resolveCoverMenuItemGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
  index: number,
  itemCount: number,
): CoverMenuItemGeometry {
  const menuLayout = resolveCoverMenuLayout(config, layout);
  const columns = Math.max(1, Math.floor(menuLayout.menu_columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const gridWidth = menuLayout.menu_width * columns
    + menuLayout.menu_column_gap * (columns - 1);
  const alignedLeft = resolveCoverHorizontalPosition(
    menuLayout,
    layout,
    gridWidth,
  );
  const menuTop = resolveCoverMenuTop(
    menuLayout,
    layout,
    config.controls.button_height,
    Math.ceil(itemCount / columns),
  );
  return {
    x:
      alignedLeft +
      column * (menuLayout.menu_width + menuLayout.menu_column_gap) +
      row * menuLayout.menu_row_step_x,
    y: menuTop + row * (config.controls.button_height + menuLayout.menu_row_gap),
    width: menuLayout.menu_width,
    height: config.controls.button_height,
    shape: layout.isMobile ? "rectangle" : "parallelogram",
  };
}

/** 只展示双行标题和六个配置化入口的封面页面。 */
export class CoverPage implements PageView {
  public readonly root: LayaSpriteLike;
  private readonly hoverIntent: DelayedHoverIntent<CoverMenuDescription> | null;

  /** 创建带末日封面、响应式菜单和延迟简介的页面。 */
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
    this.renderArtwork(runtime, factory, config, layout);
    this.renderScrim(factory, config, layout);
    this.renderBrand(factory, config, layout, brand);
    this.hoverIntent = layout.isMobile
      ? null
      : this.createDescriptionIntent(factory, config, layout, actions);
    this.renderMenu(
      runtime,
      factory,
      config,
      layout,
      buildCoverMenuItems(config, canLoadGame, actions),
    );
  }

  /** 释放悬停计时器和封面显示树。 */
  public destroy(): void {
    this.hoverIntent?.destroy();
    this.root.offAll();
    this.root.destroy(true);
  }

  /** 加载并按原始比例居中裁切正式封面。 */
  private renderArtwork(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
  ): void {
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

    /** 按原图比例填充舞台，避免手机纵屏拉伸。 */
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
    artwork.skin = resolveCoverArtwork(config, layout);
    layoutArtwork();
  }

  /** 绘制配置化双行品牌标题。 */
  private renderBrand(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    brand: UiBrandView,
  ): void {
    const menuLayout = resolveCoverMenuLayout(config, layout);
    const columns = Math.max(1, Math.floor(menuLayout.menu_columns));
    const titleWidth =
      menuLayout.menu_width * columns +
      menuLayout.menu_column_gap * (columns - 1);
    const coverLeft = resolveCoverHorizontalPosition(menuLayout, layout, titleWidth);
    const coverTop = layout.safeArea.top + menuLayout.content_top;
    factory.text(this.root, {
      testId: "menu-title",
      text: brand.title,
      x: coverLeft,
      y: coverTop,
      width: titleWidth,
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
      width: titleWidth,
      height: config.typography.cover_subtitle_size + config.controls.button_gap,
      fontSize: config.typography.cover_subtitle_size,
      color: config.theme.accent,
      bold: true,
      wordWrap: false,
    });
  }

  /** 按响应式网格绘制六个入口，桌面使用 PNG 平行四边形皮肤。 */
  private renderMenu(
    runtime: LayaRuntimeLike,
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
        skin: layout.isMobile ? undefined : desktopSkin,
        onClick: item.action,
      });
      if (this.hoverIntent !== null) {
        button.mouseEnabled = true;
        button.on(runtime.Event.MOUSE_OVER, button, (): void => {
          this.hoverIntent?.enter(item);
        });
        button.on(runtime.Event.MOUSE_OUT, button, (): void => {
          this.hoverIntent?.leave();
        });
      }
    });
  }

  /** 创建桌面端延迟简介面板和状态发布接口。 */
  private createDescriptionIntent(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    actions: CoverPageActions,
  ): DelayedHoverIntent<CoverMenuDescription> {
    const menuLayout = resolveCoverMenuLayout(config, layout);
    const panel = factory.panel(this.root, {
      testId: "menu-description",
      x: layout.safeArea.left + menuLayout.description_left,
      y: layout.safeArea.top + menuLayout.description_top,
      width: menuLayout.description_width,
      height: menuLayout.description_height,
      translucent: true,
    });
    panel.visible = false;
    const title = factory.text(panel, {
      testId: "menu-description-title",
      text: "",
      x: layout.panelPadding,
      y: layout.panelPadding,
      width: menuLayout.description_width - layout.panelPadding * 2,
      height: config.typography.body_line_height,
      fontSize: config.typography.section_title_size,
      color: config.theme.accent,
      bold: true,
    });
    const body = factory.text(panel, {
      testId: "menu-description-body",
      text: "",
      x: layout.panelPadding,
      y: layout.panelPadding + config.typography.body_line_height,
      width: menuLayout.description_width - layout.panelPadding * 2,
      height:
        menuLayout.description_height -
        layout.panelPadding * 2 -
        config.typography.body_line_height,
      fontSize: config.typography.body_size,
    });

    /** 同步简介文字、可见状态和可选外部监听器。 */
    const updateDescription = (
      description: CoverMenuDescription | null,
    ): void => {
      this.updateDescriptionPanel(panel, title, body, description);
      actions.onDescriptionChange?.(description);
    };

    return new DelayedHoverIntent(
      config.motion.cover_menu_description_delay_ms,
      updateDescription,
    );
  }

  /** 更新简介面板而不重新创建 Laya 节点。 */
  private updateDescriptionPanel(
    panel: LayaSpriteLike,
    title: LayaTextLike,
    body: LayaTextLike,
    description: CoverMenuDescription | null,
  ): void {
    panel.visible = description !== null;
    title.text = description?.label ?? "";
    body.text = description?.description ?? "";
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

/** 返回当前断点对应的封面菜单 token。 */
function resolveCoverMenuLayout(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): CoverMenuLayoutTokens {
  if (layout.isMobile && layout.isLandscape) {
    return config.layout.cover.mobile_landscape;
  }
  return layout.isMobile
    ? config.layout.cover.mobile
    : config.layout.cover.desktop;
}

/** 按配置将封面标题与菜单锚定到安全区内的左侧、中央或右侧。 */
function resolveCoverHorizontalPosition(
  menuLayout: CoverMenuLayoutTokens,
  layout: ResponsiveLayout,
  contentWidth: number,
): number {
  const safeWidth = layout.stageWidth - layout.safeArea.left - layout.safeArea.right;
  if (menuLayout.horizontal_alignment === "center") {
    return layout.safeArea.left + (safeWidth - contentWidth) / 2;
  }
  if (menuLayout.horizontal_alignment === "right") {
    return layout.stageWidth - layout.safeArea.right - menuLayout.content_left - contentWidth;
  }
  return layout.safeArea.left + menuLayout.content_left;
}

/** 按配置把菜单整体锚定到舞台顶部、中部或底部。 */
function resolveCoverMenuTop(
  menuLayout: CoverMenuLayoutTokens,
  layout: ResponsiveLayout,
  itemHeight: number,
  rowCount: number,
): number {
  const menuHeight = rowCount * itemHeight
    + Math.max(0, rowCount - 1) * menuLayout.menu_row_gap;
  const safeHeight = layout.stageHeight - layout.safeArea.top - layout.safeArea.bottom;
  if (menuLayout.vertical_alignment === "bottom") {
    return layout.stageHeight - layout.safeArea.bottom - menuLayout.menu_bottom - menuHeight;
  }
  if (menuLayout.vertical_alignment === "middle") {
    return layout.safeArea.top + (safeHeight - menuHeight) / 2;
  }
  return layout.safeArea.top + menuLayout.menu_top;
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
