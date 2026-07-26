import { createGameApplication } from "./application";
import type { WebGameConfig } from "./config/types";
import type { LayaRuntimeGlobal } from "./engine/runtimeLoader";
import { createBrowserUiSettingsRepository } from "./infrastructure";
import { GameUiAdapter } from "./presentation";
import { GameShell } from "./ui";

/** 浏览器测试与问题诊断可读取的最小只读接口。 */
export interface ShelterGameDebugHandle {
  getCurrentScreen(): string;
  getSnapshot(): ReturnType<GameUiAdapter["getSnapshot"]>;
  getNodeBounds(nodeName: string): GameDebugNodeBounds | null;
}

/** 一个 Laya 节点在舞台坐标系中的只读点击边界。 */
export interface GameDebugNodeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
}

/** 已挂载游戏的生命周期句柄。 */
export interface MountedGame {
  readonly debug: ShelterGameDebugHandle;
  destroy(): void;
}

declare global {
  interface Window {
    __SHELTER_GAME__?: ShelterGameDebugHandle;
  }
}

let mountedGame: MountedGame | null = null;

/**
 * 装配完整应用、展示适配器和 LayaAir 页面树，并返回可释放句柄。
 */
export async function mountGame(
  config: WebGameConfig,
  runtime: LayaRuntimeGlobal,
  stage: Laya.Stage,
): Promise<MountedGame> {
  mountedGame?.destroy();
  const application = createGameApplication();
  const adapter = new GameUiAdapter(application, config);
  const settingsRepository = createBrowserUiSettingsRepository(
    config.storage.settings_key,
    config.storage.settings_schema_version,
  );
  const shell = new GameShell(
    runtime,
    stage,
    config,
    adapter,
    settingsRepository,
  );
  await shell.mount();

  const debug: ShelterGameDebugHandle = Object.freeze({
    getCurrentScreen: (): string => shell.getCurrentScreen(),
    getSnapshot: () => adapter.getSnapshot(),
    getNodeBounds: (nodeName: string): GameDebugNodeBounds | null =>
      resolveNodeBounds(runtime, stage, nodeName),
  });
  window.__SHELTER_GAME__ = debug;

  /** 在引擎完成首轮浏览器尺寸同步后主动刷新一次响应式布局。 */
  const refreshLayout = (): void => {
    stage.event(runtime.Event.RESIZE);
  };
  window.requestAnimationFrame(refreshLayout);

  /** 释放显示树和只读诊断接口，支持开发期热重载。 */
  const destroy = (): void => {
    shell.destroy();
    if (window.__SHELTER_GAME__ === debug) {
      delete window.__SHELTER_GAME__;
    }
  };
  mountedGame = { debug, destroy };
  return mountedGame;
}

/** 深度优先查找带稳定 name 的 Laya 显示节点。 */
function findDisplayNode(
  runtime: LayaRuntimeGlobal,
  root: Laya.Node,
  nodeName: string,
): Laya.Sprite | null {
  if (root.name === nodeName && root instanceof runtime.Sprite) {
    return root;
  }
  for (let index = 0; index < root.numChildren; index += 1) {
    const matched = findDisplayNode(runtime, root.getChildAt(index), nodeName);
    if (matched !== null) {
      return matched;
    }
  }
  return null;
}

/** 把测试节点转换为可映射到浏览器 Canvas 的舞台边界。 */
function resolveNodeBounds(
  runtime: LayaRuntimeGlobal,
  stage: Laya.Stage,
  nodeName: string,
): GameDebugNodeBounds | null {
  const node = findDisplayNode(runtime, stage, nodeName);
  if (node === null || !isDisplayNodeHierarchyVisible(node, stage)) {
    return null;
  }
  const origin = node.localToGlobal(new runtime.Point(0, 0), true, stage);
  return {
    x: origin.x,
    y: origin.y,
    width: node.width,
    height: node.height,
    stageWidth: stage.width,
    stageHeight: stage.height,
  };
}

/**
 * 检查显示节点到指定根节点的完整父链是否可见且仍然相连。
 */
export function isDisplayNodeHierarchyVisible(
  node: Laya.Sprite,
  root: Laya.Sprite,
): boolean {
  let current: Laya.Sprite | null = node;
  while (current !== null) {
    if (!current.visible) {
      return false;
    }
    if (current === root) {
      return true;
    }
    current = (
      current as unknown as { readonly parent: Laya.Sprite | null }
    ).parent;
  }
  return false;
}
