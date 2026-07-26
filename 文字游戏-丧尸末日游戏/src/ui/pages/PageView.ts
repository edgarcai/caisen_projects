import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
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
  destroy(): void;
}

/**
 * 二级页面共享的标题栏和可滚动内容区域。
 */
export class PageScaffold implements PageView {
  public readonly root: LayaSpriteLike;
  public readonly scroll: ScrollRegion;
  public readonly content: LayaSpriteLike;
  public readonly contentWidth: number;

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
  ) {
    this.root = factory.container(testId);
    this.root.size(layout.stageWidth, layout.stageHeight);
    this.root.graphics.drawRect(
      0,
      0,
      layout.stageWidth,
      layout.stageHeight,
      config.theme.background,
    );
    const pageWidth = Math.min(
      layout.contentWidth,
      config.layout.page.max_content_width,
    );
    const pageLeft = (layout.stageWidth - pageWidth) / 2;
    const headerTop = layout.safeArea.top + layout.outerPadding;
    const backWidth = Math.max(
      config.controls.minimum_touch_size,
      config.controls.compact_button_height * 2,
    );
    factory.text(this.root, {
      testId: `${testId}-title`,
      text: title,
      x: pageLeft,
      y: headerTop,
      width: pageWidth - backWidth - layout.sectionGap,
      height: config.layout.page.header_height,
      fontSize: config.typography.page_title_size,
      color: config.theme.accent,
      bold: true,
      valign: "middle",
    });
    factory.button(this.root, {
      testId: `${testId}-back`,
      label: config.texts.back,
      x: pageLeft + pageWidth - backWidth,
      y: headerTop +
        (config.layout.page.header_height - config.controls.compact_button_height) / 2,
      width: backWidth,
      height: config.controls.compact_button_height,
      onClick: onBack,
    });
    const bodyTop = headerTop + config.layout.page.header_height;
    const bodyBottom =
      layout.stageHeight - layout.safeArea.bottom - layout.outerPadding;
    const bodyHeight = Math.max(
      config.controls.minimum_touch_size,
      bodyBottom - bodyTop,
    );
    const bodyPanel = factory.panel(this.root, {
      testId: `${testId}-body`,
      x: pageLeft,
      y: bodyTop,
      width: pageWidth,
      height: bodyHeight,
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

  /**
   * 释放滚动事件和页面显示树。
   */
  public destroy(): void {
    this.scroll.destroy();
    this.root.offAll();
    this.root.destroy(true);
  }
}
