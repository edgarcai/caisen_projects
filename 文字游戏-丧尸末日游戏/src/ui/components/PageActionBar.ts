import type { GameUiConfig } from "../../styles/GameTheme";
import type { LayaNodeLike, LayaSpriteLike } from "../laya/LayaRuntime";
import type { UiTone } from "../ports/GameUiPort";
import type {
  ButtonSkinSpec,
  ButtonSpec,
  UiFactory,
} from "./UiFactory";

/** 底部操作区中的单个命令。 */
export interface PageActionSpec {
  readonly id: string;
  readonly testId?: string;
  readonly label: string;
  readonly tone?: UiTone;
  readonly disabled?: boolean;
  readonly shape?: ButtonSpec["shape"];
  readonly skin?: ButtonSkinSpec;
  readonly onClick: () => void;
}

/** 底部操作区的纯布局结果。 */
export interface PageActionBarGeometry {
  readonly barTop: number;
  readonly barHeight: number;
  readonly contentLeft: number;
  readonly contentWidth: number;
  readonly buttonTop: number;
  readonly buttonWidth: number;
  readonly buttonHeight: number;
  readonly gap: number;
}

/**
 * 根据页面宽高和动作数量计算固定底部操作区，供页面与测试共用。
 */
export function resolvePageActionBarGeometry(
  config: GameUiConfig,
  surfaceWidth: number,
  surfaceHeight: number,
  actionCount: number,
): PageActionBarGeometry {
  const safeActionCount = Math.max(1, actionCount);
  const barHeight = Math.min(config.layout.page.footer_height, surfaceHeight);
  const gap = config.layout.page.option_gap;
  const availableWidth = Math.max(
    config.controls.minimum_touch_size,
    surfaceWidth - config.layout.page.body_padding * 2,
  );
  const desiredWidth =
    config.layout.page.footer_action_max_width * safeActionCount +
    gap * (safeActionCount - 1);
  const contentWidth = Math.min(availableWidth, desiredWidth);
  const buttonWidth =
    (contentWidth - gap * (safeActionCount - 1)) / safeActionCount;
  const buttonHeight = Math.min(
    config.controls.compact_button_height,
    barHeight,
  );
  return {
    barTop: surfaceHeight - barHeight,
    barHeight,
    contentLeft: (surfaceWidth - contentWidth) / 2,
    contentWidth,
    buttonTop: (barHeight - buttonHeight) / 2,
    buttonWidth,
    buttonHeight,
    gap,
  };
}

/**
 * 在所有覆盖页底部绘制统一命令区，页面只提供语义动作。
 */
export function createPageActionBar(
  factory: UiFactory,
  config: GameUiConfig,
  parent: LayaNodeLike,
  testId: string,
  surfaceWidth: number,
  surfaceHeight: number,
  actions: readonly PageActionSpec[],
): LayaSpriteLike {
  if (actions.length === 0) {
    throw new Error("页面底部操作区至少需要一个动作。");
  }
  const geometry = resolvePageActionBarGeometry(
    config,
    surfaceWidth,
    surfaceHeight,
    actions.length,
  );
  const root = factory.panel(parent, {
    testId,
    x: 0,
    y: geometry.barTop,
    width: surfaceWidth,
    height: geometry.barHeight,
    elevated: true,
    skin: config.assets.skins.action_bar,
  });
  actions.forEach((action, index) => {
    factory.button(root, {
      testId: action.testId ?? `${testId}-${action.id}`,
      label: action.label,
      x: geometry.contentLeft + index * (geometry.buttonWidth + geometry.gap),
      y: geometry.buttonTop,
      width: geometry.buttonWidth,
      height: geometry.buttonHeight,
      tone: action.tone,
      disabled: action.disabled,
      shape: action.shape,
      skin: action.skin,
      onClick: action.onClick,
    });
  });
  return root;
}
