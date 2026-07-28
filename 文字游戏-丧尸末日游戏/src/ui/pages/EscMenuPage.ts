import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type {
  EscMenuLayoutVariantTokens,
  GameUiConfig,
} from "../../styles/GameTheme";
import { PointerTooltip } from "../components/PointerTooltip";
import type { ButtonSkinSpec, UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiOptionView, UiPromptView } from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/** ESC 菜单中一个按钮的响应式纯几何。 */
export interface EscMenuButtonGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly shape: "rectangle" | "parallelogram";
}

/** ESC 菜单的全部按钮与滚动内容几何。 */
export interface EscMenuGeometry {
  readonly buttons: readonly EscMenuButtonGeometry[];
  readonly contentHeight: number;
}

/** ESC 菜单按钮统一使用的形状与可选皮肤。 */
export interface EscMenuButtonPresentation {
  readonly shape: "rectangle" | "parallelogram";
  readonly skin?: ButtonSkinSpec;
  readonly accentOnHover?: boolean;
}

/** ESC 菜单需要的页面级交互。 */
export interface EscMenuPageSpec {
  readonly prompt: UiPromptView;
  readonly onClose: () => void;
  readonly onSelect: (option: UiOptionView) => void;
}

/**
 * 根据设备等级和方向选择 ESC 菜单自己的响应式配置，避免与封面耦合。
 */
export function resolveEscMenuLayout(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): EscMenuLayoutVariantTokens {
  if (layout.kind === "mobile") {
    return layout.isLandscape
      ? config.layout.esc_menu.mobile_landscape
      : config.layout.esc_menu.mobile_portrait;
  }
  if (layout.kind === "compact") {
    return layout.isLandscape
      ? config.layout.esc_menu.compact_landscape
      : config.layout.esc_menu.compact_portrait;
  }
  return config.layout.esc_menu.desktop;
}

/**
 * 解析主选项和底部继续键共用的按钮外观，确保形状不会被 PNG 皮肤覆盖。
 */
export function resolveEscMenuButtonPresentation(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): EscMenuButtonPresentation {
  const menuLayout = resolveEscMenuLayout(config, layout);
  if (!menuLayout.use_cover_button_skin) {
    return {
      shape: menuLayout.button_shape,
      accentOnHover: menuLayout.accent_on_hover,
    };
  }
  return {
    shape: menuLayout.button_shape,
    accentOnHover: menuLayout.accent_on_hover,
    skin: {
      idle: config.assets.skins.cover_button_idle,
      hover: config.assets.skins.cover_button_hover,
      pressed: config.assets.skins.cover_button_pressed,
      disabled: config.assets.skins.cover_button_disabled,
    },
  };
}

/**
 * 使用 ESC 专属标尺计算按钮，保证窄竖屏直向排列且宽屏保持阶梯布局。
 */
export function resolveEscMenuGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
  contentWidth: number,
  itemCount: number,
): EscMenuGeometry {
  const menuLayout = resolveEscMenuLayout(config, layout);
  const safeItemCount = Math.max(0, itemCount);
  const buttonWidth = Math.min(menuLayout.button_width, contentWidth);
  const requestedStep = menuLayout.button_row_step_x;
  const availableDrift = Math.max(0, contentWidth - buttonWidth);
  const totalRequestedDrift = Math.abs(requestedStep) * Math.max(0, safeItemCount - 1);
  const driftScale = totalRequestedDrift > 0
    ? Math.min(1, availableDrift / totalRequestedDrift)
    : 0;
  const rowStepX = requestedStep * driftScale;
  const totalDrift = rowStepX * Math.max(0, safeItemCount - 1);
  const groupWidth = buttonWidth + Math.abs(totalDrift);
  const groupLeft = Math.max(0, (contentWidth - groupWidth) / 2);
  const firstButtonX = totalDrift < 0 ? groupLeft - totalDrift : groupLeft;
  const startY = config.layout.page.option_gap;
  const rowHeight = config.controls.button_height + menuLayout.button_row_gap;
  const buttons = Array.from({ length: safeItemCount }, (_value, index) => ({
    x: firstButtonX + rowStepX * index,
    y: startY + rowHeight * index,
    width: buttonWidth,
    height: config.controls.button_height,
    shape: menuLayout.button_shape,
  }));
  const contentHeight = safeItemCount === 0
    ? startY
    : startY
      + safeItemCount * config.controls.button_height
      + Math.max(0, safeItemCount - 1) * menuLayout.button_row_gap
      + config.layout.page.option_gap;
  return { buttons, contentHeight };
}

/** 创建可通过滚轮或触控拖动滚动的专用 ESC 覆盖页。 */
export function createEscMenuPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  spec: EscMenuPageSpec,
): PageScaffold {
  const presentation = resolveEscMenuButtonPresentation(config, layout);
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-function-menu",
    spec.prompt.title,
    spec.onClose,
    [
      {
        id: "continue",
        testId: "function-menu-continue",
        label: config.texts.continue,
        tone: "primary",
        ...presentation,
        onClick: spec.onClose,
      },
    ],
  );
  const tooltip = createEscMenuTooltip(runtime, factory, config, layout, page);
  const geometry = resolveEscMenuGeometry(
    config,
    layout,
    page.contentWidth,
    spec.prompt.options.length,
  );
  spec.prompt.options.forEach((option, index) => {
    const buttonGeometry = geometry.buttons[index];
    if (buttonGeometry === undefined) return;
    const button = factory.button(page.content, {
      testId: `page-function-menu-option-${option.id}`,
      label: option.label,
      ...buttonGeometry,
      tone: option.tone,
      disabled: option.disabled,
      hoverableWhenDisabled: true,
      ...presentation,
      onClick: (): void => { spec.onSelect(option); },
    });
    const description = option.disabledReason ?? option.description;
    if (tooltip !== null && description.length > 0) {
      tooltip.bind(
        button,
        { title: option.label, description },
        option.disabled,
      );
    }
  });
  page.scroll.setContentHeight(geometry.contentHeight);
  return page;
}

/** 为桌面 ESC 按钮创建延迟跟随简介，手机端不创建悬停层。 */
function createEscMenuTooltip(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
): PointerTooltip | null {
  if (layout.kind === "mobile") return null;
  const tooltip = new PointerTooltip(runtime, factory, page.root, {
    testId: "page-function-menu-tooltip",
    delayMs: config.motion.cover_menu_description_delay_ms,
    width: config.controls.tooltip_width,
    padding: config.controls.tooltip_padding,
    offset: {
      x: config.controls.tooltip_offset_x,
      y: config.controls.tooltip_offset_y,
    },
    bounds: {
      left: layout.safeArea.left,
      top: layout.safeArea.top,
      right: layout.stageWidth - layout.safeArea.right,
      bottom: layout.stageHeight - layout.safeArea.bottom,
    },
    titleFontSize: config.typography.section_title_size,
    titleLineHeight: config.typography.body_line_height,
    descriptionFontSize: config.typography.body_size,
    descriptionLineHeight: config.typography.body_line_height,
    contentGap: config.controls.button_gap,
  });
  page.addDisposable((): void => { tooltip.destroy(); });
  return tooltip;
}
