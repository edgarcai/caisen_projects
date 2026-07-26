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
import { isMobileEnvironment } from "../services/DeviceCapabilityResolver";

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

/** 根据页面可见性切换活跃与后台限能模式。 */
function applyVisibilityFrameMode(
  runtime: LayaRuntimeGlobal,
  config: WebGameConfig,
  documentRef: Document,
  mobileEnvironment: boolean,
): void {
  const frameMode = documentRef.hidden
    ? config.engine.idle_frame_mode
    : mobileEnvironment
      ? config.engine.mobile_active_frame_mode
      : config.engine.active_frame_mode;
  runtime.Render.throttleMode = resolveThrottleMode(frameMode);
}

/** 按当前 CSS 视口宽高返回方向，不受 Laya 逻辑舞台尺寸影响。 */
export function resolveViewportOrientation(
  documentRef: Document,
): "landscape" | "portrait" {
  const windowRef = documentRef.defaultView;
  if (windowRef === null) {
    return "portrait";
  }
  return windowRef.innerWidth > windowRef.innerHeight
    ? "landscape"
    : "portrait";
}

/** 把当前设备类型与视口方向同步到页面诊断数据。 */
export function syncGameEnvironmentDataset(
  documentRef: Document,
  mobileEnvironment: boolean,
): void {
  documentRef.body.dataset.gameDevice = mobileEnvironment ? "mobile" : "desktop";
  documentRef.body.dataset.gameOrientation = resolveViewportOrientation(documentRef);
}

/** 按移动端方向返回配置化设计尺寸，横屏时交换宽高。 */
function resolveDesignSize(
  config: WebGameConfig,
  mobileEnvironment: boolean,
  landscape: boolean,
): { readonly width: number; readonly height: number } {
  if (!mobileEnvironment) {
    return {
      width: config.engine.design_width,
      height: config.engine.design_height,
    };
  }
  return landscape
    ? {
        width: config.engine.mobile_design_height,
        height: config.engine.mobile_design_width,
      }
    : {
        width: config.engine.mobile_design_width,
        height: config.engine.mobile_design_height,
      };
}

/** 加载官方运行库，并按已校验配置初始化二维 H5 舞台。 */
export async function bootLayaEngine(
  config: WebGameConfig,
  documentRef: Document = document,
): Promise<LayaEngineHandle> {
  const runtime = await loadLayaRuntime(config.engine, documentRef);
  runtime.Config.useRetinalCanvas = config.engine.retina_canvas;
  const mobileEnvironment = isMobileEnvironment(documentRef, config.responsive);
  let mobileLandscape = mobileEnvironment &&
    resolveViewportOrientation(documentRef) === "landscape";
  const screenMode = mobileEnvironment
    ? config.engine.mobile_screen_mode
    : config.engine.desktop_screen_mode;
  const designSize = resolveDesignSize(
    config,
    mobileEnvironment,
    mobileLandscape,
  );
  await runtime.init({
    designWidth: designSize.width,
    designHeight: designSize.height,
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
  syncGameEnvironmentDataset(documentRef, mobileEnvironment);

  const orientationQuery = documentRef.defaultView?.matchMedia(
    "(orientation: landscape)",
  ) ?? null;

  /** 旋转手机后交换设计宽高，使触控尺寸和字号不随方向缩小。 */
  const handleOrientationChange = (): void => {
    if (orientationQuery === null) {
      return;
    }
    syncGameEnvironmentDataset(documentRef, mobileEnvironment);
    if (!mobileEnvironment) {
      return;
    }
    const nextLandscape = orientationQuery.matches;
    if (nextLandscape === mobileLandscape) {
      return;
    }
    mobileLandscape = nextLandscape;
    const nextSize = resolveDesignSize(config, true, mobileLandscape);
    runtime.stage.size(nextSize.width, nextSize.height);
  };

  /** 在可见性变化时重新应用限能配置。 */
  const handleVisibilityChange = (): void => {
    applyVisibilityFrameMode(runtime, config, documentRef, mobileEnvironment);
  };
  applyVisibilityFrameMode(runtime, config, documentRef, mobileEnvironment);
  documentRef.addEventListener("visibilitychange", handleVisibilityChange);
  orientationQuery?.addEventListener("change", handleOrientationChange);

  /** 释放本层注册的浏览器生命周期监听。 */
  const dispose = (): void => {
    documentRef.removeEventListener("visibilitychange", handleVisibilityChange);
    orientationQuery?.removeEventListener("change", handleOrientationChange);
    delete documentRef.body.dataset.gameDevice;
    delete documentRef.body.dataset.gameOrientation;
  };

  return { config, runtime, stage: runtime.stage, dispose };
}
