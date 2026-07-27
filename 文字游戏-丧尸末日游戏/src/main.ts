import { createGameApplication } from "./application";
import {
  validateCoverThemeAchievementReferences,
  validateDashboardNavigationReferences,
  validateNamePresetCoverage,
} from "./config/configLoader";
import type { WebGameConfig } from "./config/types";
import { coopDemoConfig } from "./config/coopDemoConfig";
import type { StorageLike } from "./domain/ports";
import type { CoopRoomGateway } from "./domain/coop";
import type { LayaRuntimeGlobal } from "./engine/runtimeLoader";
import {
  BroadcastChannelCoopGateway,
  CompositeCoopRoomGateway,
  createBrowserUiSettingsRepository,
  LocalAccountRepository,
  MemoryStorage,
  WebSocketCoopGateway,
} from "./infrastructure";
import { CoopUiAdapter, GameUiAdapter } from "./presentation";
import { CoopSessionService } from "./services";
import { GameShell } from "./ui";
import { createBrowserNativeTextInputPolicy } from "./ui/interactions/NativeTextInputPolicy";
import { createDashboardNavigationPolicy } from "./ui/navigation/DashboardNavigationStrategy";

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

/** 组合根仅需读取的经营分类目录最小结构。 */
interface ManagementCategoryCatalogSource {
  readonly interface: {
    readonly pages: {
      readonly management_categories: readonly { readonly id: string }[];
    };
  };
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
  validateCoverThemeAchievementReferences(
    config,
    application.content.story.endings.map((ending) => ending.achievement_id),
  );
  validateNamePresetCoverage(
    config,
    application.content.game.rules.player_counts,
  );
  const managementCategoryCatalog = application.content.game as unknown as
    ManagementCategoryCatalogSource;
  validateDashboardNavigationReferences(
    config,
    managementCategoryCatalog.interface.pages.management_categories.map(
      (category) => category.id,
    ),
  );
  const adapter = new GameUiAdapter(application, config);
  const coopSession = new CoopSessionService(
    new LocalAccountRepository(
      resolveBrowserStorage(),
      coopDemoConfig.accountStorageKey,
    ),
    createCoopGateway(),
    coopDemoConfig.rules,
  );
  const coopAdapter = new CoopUiAdapter(
    coopSession,
    coopDemoConfig.defaults.tradeOffer,
  );
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
    createBrowserNativeTextInputPolicy(
      config.new_game_setup.name_input,
      document,
    ),
    createDashboardNavigationPolicy(
      config.dashboard_navigation.management_category_shortcuts,
    ),
    coopAdapter,
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
    coopSession.leaveRoom();
    if (window.__SHELTER_GAME__ === debug) {
      delete window.__SHELTER_GAME__;
    }
  };
  mountedGame = { debug, destroy };
  return mountedGame;
}

/** 组合零服务器本地通道与可配置跨设备 WebSocket 通道。 */
function createCoopGateway(): CompositeCoopRoomGateway {
  const gateways: CoopRoomGateway[] = [
    new BroadcastChannelCoopGateway(coopDemoConfig.channelPrefix),
  ];
  if (coopDemoConfig.transport.websocketEnabled) {
    gateways.push(new WebSocketCoopGateway(coopDemoConfig.transport));
  }
  return new CompositeCoopRoomGateway(gateways);
}

/** 优先使用浏览器本地存储，隐私模式拒绝访问时降级到内存。 */
function resolveBrowserStorage(): StorageLike {
  try {
    return globalThis.localStorage;
  } catch {
    return new MemoryStorage();
  }
}

/** 从显示栈顶向下查找第一个可见且带稳定 name 的 Laya 节点。 */
function findVisibleDisplayNode(
  runtime: LayaRuntimeGlobal,
  root: Laya.Node,
  nodeName: string,
  stage: Laya.Stage,
): Laya.Sprite | null {
  if (
    root.name === nodeName
    && root instanceof runtime.Sprite
    && isDisplayNodeHierarchyVisible(root, stage)
  ) {
    return root;
  }
  for (let index = root.numChildren - 1; index >= 0; index -= 1) {
    const matched = findVisibleDisplayNode(
      runtime,
      root.getChildAt(index),
      nodeName,
      stage,
    );
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
  const node = findVisibleDisplayNode(runtime, stage, nodeName, stage);
  if (node === null) return null;
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
