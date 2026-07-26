import type {
  EngineFrameMode,
  EngineHorizontalAlignment,
  EngineScaleMode,
  EngineScreenMode,
  EngineVerticalAlignment,
  WebGameConfig,
} from "../config/types";
import {
  loadLayaRuntime,
  type LayaRuntimeGlobal,
} from "./runtimeLoader";

/** 已初始化的 LayaAir 引擎句柄。 */
export interface LayaEngineHandle {
  readonly config: WebGameConfig;
  readonly runtime: LayaRuntimeGlobal;
  readonly stage: Laya.Stage;
  dispose(): void;
}

/** 把配置化缩放标识映射为 LayaAir 常量。 */
function resolveScaleMode(
  runtime: LayaRuntimeGlobal,
  mode: EngineScaleMode,
): string {
  const modes: Readonly<Record<EngineScaleMode, string>> = {
    noscale: runtime.Stage.SCALE_NOSCALE,
    showall: runtime.Stage.SCALE_SHOWALL,
    noborder: runtime.Stage.SCALE_NOBORDER,
    full: runtime.Stage.SCALE_FULL,
    fixedwidth: runtime.Stage.SCALE_FIXED_WIDTH,
    fixedheight: runtime.Stage.SCALE_FIXED_HEIGHT,
    fixedauto: runtime.Stage.SCALE_FIXED_AUTO,
  };
  return modes[mode];
}

/** 把配置化屏幕方向映射为 LayaAir 常量。 */
function resolveScreenMode(
  runtime: LayaRuntimeGlobal,
  mode: EngineScreenMode,
): string {
  const modes: Readonly<Record<EngineScreenMode, string>> = {
    none: runtime.Stage.SCREEN_NONE,
    horizontal: runtime.Stage.SCREEN_HORIZONTAL,
    vertical: runtime.Stage.SCREEN_VERTICAL,
  };
  return modes[mode];
}

/** 把配置化水平对齐映射为 LayaAir 常量。 */
function resolveHorizontalAlignment(
  runtime: LayaRuntimeGlobal,
  alignment: EngineHorizontalAlignment,
): string {
  const alignments: Readonly<Record<EngineHorizontalAlignment, string>> = {
    left: runtime.Stage.ALIGN_LEFT,
    center: runtime.Stage.ALIGN_CENTER,
    right: runtime.Stage.ALIGN_RIGHT,
  };
  return alignments[alignment];
}

/** 把配置化垂直对齐映射为 LayaAir 常量。 */
function resolveVerticalAlignment(
  runtime: LayaRuntimeGlobal,
  alignment: EngineVerticalAlignment,
): string {
  const alignments: Readonly<Record<EngineVerticalAlignment, string>> = {
    top: runtime.Stage.ALIGN_TOP,
    middle: runtime.Stage.ALIGN_MIDDLE,
    bottom: runtime.Stage.ALIGN_BOTTOM,
  };
  return alignments[alignment];
}

/** 把配置化帧率模式映射为 LayaAir 3.4 限能等级。 */
function resolveThrottleMode(mode: EngineFrameMode): 0 | 1 | 2 | 3 {
  const modes: Readonly<Record<EngineFrameMode, 0 | 1 | 2 | 3>> = {
    fast: 0,
    slow: 1,
    mouse: 2,
    sleep: 3,
  };
  return modes[mode];
}

/** 在引擎初始化前判断当前宿主是否为移动浏览器。 */
function isMobileEnvironment(documentRef: Document): boolean {
  const userAgent = documentRef.defaultView?.navigator.userAgent ?? "";
  return /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
}

/** 根据页面可见性切换活跃与后台限能模式。 */
function applyVisibilityFrameMode(
  runtime: LayaRuntimeGlobal,
  config: WebGameConfig,
  documentRef: Document,
): void {
  const frameMode = documentRef.hidden
    ? config.engine.idle_frame_mode
    : config.engine.active_frame_mode;
  runtime.Render.throttleMode = resolveThrottleMode(frameMode);
}

/** 加载官方运行库，并按已校验配置初始化二维 H5 舞台。 */
export async function bootLayaEngine(
  config: WebGameConfig,
  documentRef: Document = document,
): Promise<LayaEngineHandle> {
  const runtime = await loadLayaRuntime(config.engine, documentRef);
  runtime.Config.useRetinalCanvas = config.engine.retina_canvas;
  const screenMode = isMobileEnvironment(documentRef)
    ? config.engine.mobile_screen_mode
    : config.engine.desktop_screen_mode;
  await runtime.init({
    designWidth: config.engine.design_width,
    designHeight: config.engine.design_height,
    scaleMode: resolveScaleMode(runtime, config.engine.scale_mode),
    screenMode: resolveScreenMode(runtime, screenMode),
    alignH: resolveHorizontalAlignment(
      runtime,
      config.engine.align_horizontal,
    ),
    alignV: resolveVerticalAlignment(runtime, config.engine.align_vertical),
    backgroundColor: config.theme.background,
  });
  runtime.stage.bgColor = config.theme.background;

  /** 在可见性变化时重新应用限能配置。 */
  const handleVisibilityChange = (): void => {
    applyVisibilityFrameMode(runtime, config, documentRef);
  };
  applyVisibilityFrameMode(runtime, config, documentRef);
  documentRef.addEventListener("visibilitychange", handleVisibilityChange);

  /** 释放本层注册的浏览器生命周期监听。 */
  const dispose = (): void => {
    documentRef.removeEventListener("visibilitychange", handleVisibilityChange);
  };

  return { config, runtime, stage: runtime.stage, dispose };
}
