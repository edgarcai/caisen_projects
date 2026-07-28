import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaRuntimeLike,
  LayaSpriteLike,
} from "../laya/LayaRuntime";
import type { PageView } from "./PageView";

/** 制作方 LOGO 动画使用的可取消帧调度器。 */
interface PublisherFrameScheduler {
  readonly request: (callback: FrameRequestCallback) => number;
  readonly cancel: (handle: number) => void;
}

/** 制作方 LOGO 页可显式跳过或等待动画结束。 */
export interface PublisherSplashPageView extends PageView {
  finish(): void;
}

/** 创建“白菜出品”代码原生文字 LOGO 开场页。 */
export function createPublisherSplashPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  onComplete: () => void,
  reducedMotion = config.motion.reduced_motion,
): PublisherSplashPageView {
  const root = factory.container("page-publisher-splash");
  root.size(layout.stageWidth, layout.stageHeight);
  root.mouseEnabled = true;
  root.graphics.drawRect(
    0,
    0,
    layout.stageWidth,
    layout.stageHeight,
    config.theme.background,
  );
  renderOptionalSplashBackground(runtime, config, root, layout);
  const brandLayer = renderPublisherBrand(factory, config, root, layout);
  const scheduler = browserFrameScheduler();
  const totalDuration = reducedMotion
    ? 0
    : config.motion.publisher_logo_fade_in_ms
      + config.motion.publisher_logo_hold_ms
      + config.motion.publisher_logo_fade_out_ms;
  const startedAt = globalThis.performance.now();
  let animationHandle: number | null = null;
  let finished = false;

  /** 取消当前帧并仅一次通知上层开场完成。 */
  const finish = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    if (animationHandle !== null && scheduler !== null) {
      scheduler.cancel(animationHandle);
    }
    animationHandle = null;
    brandLayer.alpha = 1;
    onComplete();
  };

  /** 按淡入、停留和淡出 token 刷新 LOGO 透明度。 */
  const animate = (): void => {
    if (finished) {
      return;
    }
    const elapsed = Math.max(0, globalThis.performance.now() - startedAt);
    brandLayer.alpha = resolvePublisherLogoAlpha(config, elapsed, reducedMotion);
    if (elapsed >= totalDuration || reducedMotion) {
      finish();
      return;
    }
    if (scheduler !== null) {
      animationHandle = scheduler.request(animate);
    }
  };

  root.on(runtime.Event.CLICK, root, finish);
  brandLayer.alpha = reducedMotion ? 1 : 0;
  if (scheduler !== null) {
    animationHandle = scheduler.request(animate);
  }
  return {
    root,
    finish,
    /** 取消开场动画并释放显示树。 */
    destroy: (): void => {
      if (animationHandle !== null && scheduler !== null) {
        scheduler.cancel(animationHandle);
      }
      animationHandle = null;
      root.offAll();
      root.destroy(true);
    },
  };
}

/** 如果配置了背景资源，则在底色之上铺满舞台。 */
function renderOptionalSplashBackground(
  runtime: LayaRuntimeLike,
  config: GameUiConfig,
  parent: LayaSpriteLike,
  layout: ResponsiveLayout,
): void {
  if (config.publisher_splash.background_asset.length === 0) {
    return;
  }
  const background = new runtime.Image(config.publisher_splash.background_asset);
  background.name = "publisher-splash-background";
  background.size(layout.stageWidth, layout.stageHeight);
  background.alpha = config.publisher_splash.background_opacity;
  background.mouseEnabled = false;
  parent.addChild(background);
}

/** 渲染保持为实时文字且不依赖封面字号的制作方名称。 */
function renderPublisherBrand(
  factory: UiFactory,
  config: GameUiConfig,
  parent: LayaSpriteLike,
  layout: ResponsiveLayout,
): LayaSpriteLike {
  const requestedWidth = config.publisher_splash.content_width;
  const width = Math.min(
    requestedWidth,
    layout.stageWidth - layout.safeArea.left - layout.safeArea.right - layout.outerPadding * 2,
  );
  const totalHeight = config.publisher_splash.title_height;
  const root = factory.container("publisher-splash-brand");
  root.pos((layout.stageWidth - width) / 2, (layout.stageHeight - totalHeight) / 2);
  root.size(width, totalHeight);
  root.mouseEnabled = false;
  factory.text(root, {
    testId: "publisher-splash-title",
    text: config.publisher_splash.title,
    x: 0,
    y: 0,
    width,
    height: config.publisher_splash.title_height,
    fontSize: config.publisher_splash.title_font_size,
    color: config.theme.text,
    bold: true,
    align: "center",
    valign: "middle",
    wordWrap: false,
  });
  parent.addChild(root);
  return root;
}

/** 根据配置的三段时长计算 LOGO 透明度。 */
export function resolvePublisherLogoAlpha(
  config: GameUiConfig,
  elapsedMilliseconds: number,
  reducedMotion = config.motion.reduced_motion,
): number {
  if (reducedMotion) {
    return 1;
  }
  const elapsed = Math.max(0, elapsedMilliseconds);
  const fadeIn = config.motion.publisher_logo_fade_in_ms;
  const holdEnd = fadeIn + config.motion.publisher_logo_hold_ms;
  const fadeOut = config.motion.publisher_logo_fade_out_ms;
  if (elapsed < fadeIn) {
    return fadeIn <= 0 ? 1 : elapsed / fadeIn;
  }
  if (elapsed <= holdEnd) {
    return 1;
  }
  if (fadeOut <= 0) {
    return 0;
  }
  return Math.max(0, 1 - (elapsed - holdEnd) / fadeOut);
}

/** 仅在浏览器支持帧调度时返回可取消调度器。 */
function browserFrameScheduler(): PublisherFrameScheduler | null {
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
