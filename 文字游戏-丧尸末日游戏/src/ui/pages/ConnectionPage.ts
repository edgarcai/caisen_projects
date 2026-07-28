import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike, LayaSpriteLike } from "../laya/LayaRuntime";
import type { PageView } from "./PageView";

/** 浏览器帧调度器的最小可注入契约。 */
interface FrameScheduler {
  readonly request: (callback: FrameRequestCallback) => number;
  readonly cancel: (handle: number) => void;
}

/**
 * 展示新游戏或读档成功后的通讯接入动画，时长和文案均来自 H5 配置。
 */
export class ConnectionPage implements PageView {
  public readonly root: LayaSpriteLike;
  private readonly progress: LayaSpriteLike;
  private readonly durationMs: number;
  private readonly scheduler: FrameScheduler | null;
  private animationHandle: number | null;
  private startedAt: number;

  /** 创建全屏连接页并立即启动进度动画。 */
  public constructor(
    _runtime: LayaRuntimeLike,
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    durationMs: number,
  ) {
    this.root = factory.container("page-connection");
    this.root.size(layout.stageWidth, layout.stageHeight);
    this.root.mouseEnabled = true;
    this.root.graphics.drawRect(
      0,
      0,
      layout.stageWidth,
      layout.stageHeight,
      config.theme.background,
    );
    const contentWidth = Math.min(
      layout.contentWidth,
      config.layout.page.max_content_width,
    );
    const contentLeft = (layout.stageWidth - contentWidth) / 2;
    const lineTop = layout.stageHeight / 2 + config.layout.page.option_gap;
    factory.text(this.root, {
      testId: "page-connection-title",
      text: config.texts.connection_title,
      x: contentLeft,
      y: layout.stageHeight / 2 - config.layout.page.header_height,
      width: contentWidth,
      height: config.layout.page.header_height,
      fontSize: config.typography.page_title_size,
      color: config.theme.accent,
      bold: true,
      align: "center",
      valign: "middle",
      wordWrap: false,
    });
    const track = factory.container("page-connection-track");
    track.pos(contentLeft, lineTop);
    track.size(contentWidth, config.controls.focus_border_width);
    track.graphics.drawRect(
      0,
      0,
      contentWidth,
      config.controls.focus_border_width,
      config.theme.border,
    );
    this.root.addChild(track);
    this.progress = factory.container("page-connection-progress");
    this.progress.pos(contentLeft, lineTop);
    this.progress.size(0, config.controls.focus_border_width);
    this.root.addChild(this.progress);
    this.durationMs = durationMs;
    this.scheduler = browserFrameScheduler();
    this.animationHandle = null;
    this.startedAt = nowMilliseconds();
    this.drawProgress(config, contentWidth, 0);
    this.scheduleAnimation(config, contentWidth);
  }

  /** 取消未完成的浏览器帧并释放页面。 */
  public destroy(): void {
    if (this.animationHandle !== null && this.scheduler !== null) {
      this.scheduler.cancel(this.animationHandle);
    }
    this.animationHandle = null;
    this.root.offAll();
    this.root.destroy(true);
  }

  /** 在浏览器支持时逐帧更新连接进度。 */
  private scheduleAnimation(config: GameUiConfig, width: number): void {
    if (this.scheduler === null || this.durationMs <= 0) {
      this.drawProgress(config, width, 1);
      return;
    }
    this.animationHandle = this.scheduler.request((): void => {
      const elapsed = Math.max(0, nowMilliseconds() - this.startedAt);
      const ratio = Math.min(1, elapsed / this.durationMs);
      this.drawProgress(config, width, ratio);
      if (ratio < 1) {
        this.scheduleAnimation(config, width);
      } else {
        this.animationHandle = null;
      }
    });
  }

  /** 按当前完成比例绘制通讯进度线。 */
  private drawProgress(config: GameUiConfig, width: number, ratio: number): void {
    const progressWidth = width * Math.min(1, Math.max(0, ratio));
    this.progress.size(progressWidth, config.controls.focus_border_width);
    this.progress.graphics.clear();
    this.progress.graphics.drawRect(
      0,
      0,
      progressWidth,
      config.controls.focus_border_width,
      config.theme.primary,
    );
  }
}

/** 读取浏览器与 Node 测试环境均支持的单调毫秒时钟。 */
function nowMilliseconds(): number {
  return globalThis.performance.now();
}

/** 仅在浏览器实现帧调度 API 时返回调度器。 */
function browserFrameScheduler(): FrameScheduler | null {
  if (
    typeof globalThis.requestAnimationFrame !== "function"
    || typeof globalThis.cancelAnimationFrame !== "function"
  ) {
    return null;
  }
  return {
    request: (callback): number => globalThis.requestAnimationFrame(callback),
    cancel: (handle): void => { globalThis.cancelAnimationFrame(handle); },
  };
}
