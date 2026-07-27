import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import {
  createPageActionBar,
  type PageActionSpec,
} from "../components/PageActionBar";
import { ScrollRegion } from "../components/ScrollRegion";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
} from "../laya/LayaRuntime";

/**
 * 当前渲染页面必须提供的生命周期接口。
 */
export interface PageView {
  readonly root: LayaSpriteLike;
  /** 通知页面自己是否位于页面栈顶层，以清理瞬态交互。 */
  setActive?(active: boolean): void;
  destroy(): void;
}

/** 二级页面表面在舞台中的纯几何结果。 */
export interface PageScaffoldGeometry {
  readonly pageLeft: number;
  readonly pageTop: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
}

/**
 * 在安全区内容范围内计算二级页面表面位置和尺寸。
 */
export function resolvePageScaffoldGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): PageScaffoldGeometry {
  const pageWidth = Math.min(
    layout.contentWidth,
    config.layout.page.max_content_width,
  );
  const pageLeft =
    layout.contentLeft + (layout.contentWidth - pageWidth) / 2;
  const pageTop = layout.usesCompactUi
    ? layout.safeArea.top + (
        layout.isLandscape
          ? layout.outerPadding
          : config.layout.mobile.sheet_top_margin
      )
    : layout.safeArea.top + layout.outerPadding;
  const pageBottom =
    layout.stageHeight - layout.safeArea.bottom - layout.outerPadding;
  const minimumPageHeight =
    config.layout.page.header_height +
    config.layout.page.footer_height +
    config.controls.minimum_touch_size;
  const pageHeight = Math.max(minimumPageHeight, pageBottom - pageTop);
  return { pageLeft, pageTop, pageWidth, pageHeight };
}

/**
 * 二级页面共享的标题栏和可滚动内容区域。
 */
export class PageScaffold implements PageView {
  public readonly root: LayaSpriteLike;
  public readonly scroll: ScrollRegion;
  public readonly content: LayaSpriteLike;
  public readonly contentWidth: number;
  private readonly disposables: Array<() => void>;

  /**
   * 创建配置化二级页面骨架。
   */
  public constructor(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    testId: string,
    title: string,
    onBack: () => void,
    footerActions?: readonly PageActionSpec[],
  ) {
    this.root = factory.container(testId);
    this.disposables = [];
    this.root.size(layout.stageWidth, layout.stageHeight);
    this.root.mouseEnabled = true;
    this.root.graphics.drawRect(
      0,
      0,
      layout.stageWidth,
      layout.stageHeight,
      config.theme.scrim,
    );
    const { pageLeft, pageTop, pageWidth, pageHeight } =
      resolvePageScaffoldGeometry(config, layout);
    const surface = factory.panel(this.root, {
      testId: `${testId}-surface`,
      x: pageLeft,
      y: pageTop,
      width: pageWidth,
      height: pageHeight,
      translucent: true,
      skin: config.assets.skins.page_surface,
    });
    factory.text(surface, {
      testId: `${testId}-title`,
      text: title,
      x: config.layout.page.body_padding,
      y: 0,
      width: pageWidth - config.layout.page.body_padding * 2,
      height: config.layout.page.header_height,
      fontSize: config.typography.page_title_size,
      color: config.theme.accent,
      bold: true,
      valign: "middle",
    });
    const actions = footerActions ?? [
      {
        id: "back",
        testId: `${testId}-back`,
        label: config.texts.back,
        onClick: onBack,
      },
    ];
    createPageActionBar(
      factory,
      config,
      surface,
      `${testId}-actions`,
      pageWidth,
      pageHeight,
      actions,
    );
    const bodyTop = config.layout.page.header_height;
    const bodyBottom = pageHeight - config.layout.page.footer_height;
    const bodyHeight = Math.max(
      config.controls.minimum_touch_size,
      bodyBottom - bodyTop,
    );
    const bodyPanel = factory.panel(surface, {
      testId: `${testId}-body`,
      x: 0,
      y: bodyTop,
      width: pageWidth,
      height: bodyHeight,
      translucent: true,
    });
    const innerWidth = pageWidth - config.layout.page.body_padding * 2;
    const innerHeight = bodyHeight - config.layout.page.body_padding * 2;
    this.scroll = new ScrollRegion(
      runtime,
      bodyPanel,
      `${testId}-scroll`,
      config.layout.page.body_padding,
      config.layout.page.body_padding,
      innerWidth,
      innerHeight,
      config.controls.scroll_step,
      config.controls.drag_threshold,
    );
    this.content = this.scroll.content;
    this.contentWidth = innerWidth;
  }

  /** 注册随页面一起释放的悬停计时器或其他轻量资源。 */
  public addDisposable(dispose: () => void): void {
    this.disposables.push(dispose);
  }

  /**
   * 释放滚动事件和页面显示树。
   */
  public destroy(): void {
    for (const dispose of this.disposables.splice(0)) {
      dispose();
    }
    this.scroll.destroy();
    this.root.offAll();
    this.root.destroy(true);
  }
}
