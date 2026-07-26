import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import { PointerTooltip } from "../components/PointerTooltip";
import type { ButtonSkinSpec, UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import { resolveCoverMenuLayout } from "../models/CoverMenuModel";
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

/** ESC 菜单需要的页面级交互。 */
export interface EscMenuPageSpec {
  readonly prompt: UiPromptView;
  readonly onClose: () => void;
  readonly onSelect: (option: UiOptionView) => void;
}

/**
 * 复用封面菜单标尺计算 ESC 按钮，保证桌面斜向阶梯与手机居中长方形一致。
 */
export function resolveEscMenuGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
  contentWidth: number,
  itemCount: number,
): EscMenuGeometry {
  const menuLayout = resolveCoverMenuLayout(config, layout);
  const safeItemCount = Math.max(0, itemCount);
  const buttonWidth = Math.min(menuLayout.menu_width, contentWidth);
  const requestedStep = layout.kind === "mobile" ? 0 : menuLayout.menu_row_step_x;
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
  const rowHeight = config.controls.button_height + menuLayout.menu_row_gap;
  const buttons = Array.from({ length: safeItemCount }, (_value, index) => ({
    x: firstButtonX + rowStepX * index,
    y: startY + rowHeight * index,
    width: buttonWidth,
    height: config.controls.button_height,
    shape: layout.kind === "mobile"
      ? "rectangle" as const
      : "parallelogram" as const,
  }));
  const contentHeight = safeItemCount === 0
    ? startY
    : startY
      + safeItemCount * config.controls.button_height
      + Math.max(0, safeItemCount - 1) * menuLayout.menu_row_gap
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
  const skin = resolveEscMenuSkin(config, layout);
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
        shape: layout.kind === "mobile" ? "rectangle" : "parallelogram",
        skin,
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
      skin,
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

/** 所有电脑布局返回封面同款 2K PNG 四态皮肤，手机使用轻量长方形。 */
function resolveEscMenuSkin(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): ButtonSkinSpec | undefined {
  if (layout.kind === "mobile") return undefined;
  return {
    idle: config.assets.skins.cover_button_idle,
    hover: config.assets.skins.cover_button_hover,
    pressed: config.assets.skins.cover_button_pressed,
    disabled: config.assets.skins.cover_button_disabled,
  };
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
