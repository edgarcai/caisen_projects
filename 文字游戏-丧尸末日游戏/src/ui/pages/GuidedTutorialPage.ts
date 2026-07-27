import { formatTemplate } from "../../domain/content";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaNodeLike,
  LayaRuntimeLike,
  LayaSpriteLike,
  LayaTextLike,
} from "../laya/LayaRuntime";
import type { PageView } from "./PageView";

/** 教程聚焦区域在舞台坐标系中的矩形。 */
export interface GuidedTutorialTargetBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 上层按稳定测试 ID 向教程提供当前真实界面坐标。 */
export type GuidedTutorialTargetResolver = (
  targetTestId: string,
) => GuidedTutorialTargetBounds | null;

/** 分步教程的完成、跳过与步骤变更出口。 */
export interface GuidedTutorialActions {
  readonly onComplete: () => void;
  readonly onSkip: () => void;
  readonly onStepChange?: (stepId: string, stepIndex: number) => void;
}

/** 渲染后可由上层控制的通讯式分步教程。 */
export interface GuidedTutorialPageView extends PageView {
  currentStepIndex(): number;
  next(): void;
  previous(): void;
  refreshTarget(): void;
}

/** 通讯对话框中需要原位刷新的节点集合。 */
interface TutorialDialogBindings {
  readonly step: LayaTextLike;
  readonly speaker: LayaTextLike;
  readonly title: LayaTextLike;
  readonly instruction: LayaTextLike;
  readonly targetState: LayaTextLike;
  readonly nextLabel: LayaTextLike;
  readonly previousLabel: LayaTextLike;
}

/** 对话框在当前断点的几何结果。 */
interface TutorialDialogGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 创建带聚焦暗化、角色通讯框和双向步骤导航的新手教程。 */
export function createGuidedTutorialPage(
  _runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  resolveTarget: GuidedTutorialTargetResolver,
  actions: GuidedTutorialActions,
): GuidedTutorialPageView {
  if (config.guided_tutorial.steps.length === 0) {
    throw new Error("战术引导至少需要一个配置步骤。");
  }
  const root = factory.container("page-guided-tutorial");
  root.size(layout.stageWidth, layout.stageHeight);
  root.mouseEnabled = true;
  const spotlight = factory.container("guided-tutorial-spotlight");
  spotlight.size(layout.stageWidth, layout.stageHeight);
  spotlight.mouseEnabled = false;
  root.addChild(spotlight);
  const focusBorder = factory.container("guided-tutorial-focus-border");
  focusBorder.mouseEnabled = false;
  root.addChild(focusBorder);
  factory.text(root, {
    testId: "guided-tutorial-heading",
    text: config.guided_tutorial.title,
    x: layout.safeArea.left + layout.outerPadding,
    y: layout.safeArea.top + layout.outerPadding,
    width: Math.max(
      config.controls.minimum_touch_size,
      layout.stageWidth - layout.safeArea.left - layout.safeArea.right - layout.outerPadding * 2,
    ),
    height: config.typography.body_line_height,
    fontSize: config.typography.caption_size,
    color: config.theme.accent,
    bold: true,
  });
  const dialogGeometry = resolveTutorialDialogGeometry(config, layout);
  const dialog = factory.panel(root, {
    testId: "guided-tutorial-dialog",
    ...dialogGeometry,
    elevated: true,
    active: true,
  });
  /** 在对话按钮创建前提供可替换的“下一步”动作。 */
  let nextAction = (): void => undefined;
  /** 在对话按钮创建前提供可替换的“上一步”动作。 */
  let previousAction = (): void => undefined;
  const bindings = renderTutorialDialog(
    factory,
    config,
    dialog,
    dialogGeometry,
    actions.onSkip,
    (): void => { nextAction(); },
    (): void => { previousAction(); },
  );
  let stepIndex = 0;
  let completed = false;

  /** 刷新当前步骤的文案、按钮和聚焦区域。 */
  const refresh = (): void => {
    const step = requireTutorialStep(config, stepIndex);
    const total = config.guided_tutorial.steps.length;
    bindings.step.text = formatTemplate(config.guided_tutorial.step_format, {
      current: stepIndex + 1,
      total,
    });
    bindings.speaker.text = step.speaker;
    bindings.title.text = step.title;
    bindings.instruction.text = step.instruction;
    bindings.nextLabel.text = stepIndex === total - 1
      ? config.guided_tutorial.complete_label
      : config.guided_tutorial.next_label;
    bindings.previousLabel.color = stepIndex === 0
      ? config.theme.muted_text
      : config.theme.text;
    const target = resolveTarget(step.target_test_id);
    bindings.targetState.visible = target === null;
    drawTutorialSpotlight(
      spotlight,
      focusBorder,
      config,
      layout,
      target ?? resolveFallbackTarget(config, layout, dialogGeometry),
    );
    actions.onStepChange?.(step.id, stepIndex);
  };

  /** 进入下一步，最后一步则仅完成一次教程。 */
  const next = (): void => {
    if (completed) {
      return;
    }
    if (stepIndex >= config.guided_tutorial.steps.length - 1) {
      completed = true;
      actions.onComplete();
      return;
    }
    stepIndex += 1;
    refresh();
  };

  /** 返回上一步，第一步时保持原位。 */
  const previous = (): void => {
    if (stepIndex === 0 || completed) {
      return;
    }
    stepIndex -= 1;
    refresh();
  };

  nextAction = next;
  previousAction = previous;
  refresh();
  return {
    root,
    /** 读取当前零起点步骤序号。 */
    currentStepIndex: (): number => stepIndex,
    next,
    previous,
    refreshTarget: refresh,
    /** 释放教程覆盖层的所有指针事件与显示节点。 */
    destroy: (): void => {
      root.offAll();
      root.destroy(true);
    },
  };
}

/** 在对话框中渲染角色通讯文案与三个底部动作。 */
function renderTutorialDialog(
  factory: UiFactory,
  config: GameUiConfig,
  parent: LayaNodeLike,
  geometry: TutorialDialogGeometry,
  onSkip: () => void,
  onNext: () => void,
  onPrevious: () => void,
): TutorialDialogBindings {
  const padding = config.guided_tutorial.dialog_panel_padding;
  const innerWidth = geometry.width - padding * 2;
  const stepWidth = innerWidth * config.guided_tutorial.header_step_width_ratio;
  const step = factory.text(parent, {
    testId: "guided-tutorial-step",
    text: " ",
    x: padding,
    y: padding,
    width: stepWidth,
    height: config.typography.body_line_height,
    fontSize: config.typography.caption_size,
    color: config.theme.muted_text,
    bold: true,
  });
  const speaker = factory.text(parent, {
    testId: "guided-tutorial-speaker",
    text: " ",
    x: padding + stepWidth,
    y: padding,
    width: innerWidth - stepWidth,
    height: config.typography.body_line_height,
    fontSize: config.typography.caption_size,
    color: config.theme.accent,
    bold: true,
    align: "right",
  });
  const titleTop = padding + config.typography.body_line_height + config.layout.page.option_gap;
  const title = factory.text(parent, {
    testId: "guided-tutorial-title",
    text: " ",
    x: padding,
    y: titleTop,
    width: innerWidth,
    height: config.typography.section_title_size + config.controls.button_gap,
    fontSize: config.typography.section_title_size,
    color: config.theme.text,
    bold: true,
  });
  const actionHeight = config.controls.compact_button_height;
  const actionTop = geometry.height - padding - actionHeight;
  const targetStateHeight = config.typography.body_line_height;
  const targetState = factory.text(parent, {
    testId: "guided-tutorial-target-state",
    text: config.guided_tutorial.missing_target_label,
    x: padding,
    y: actionTop - targetStateHeight,
    width: innerWidth,
    height: targetStateHeight,
    fontSize: config.typography.caption_size,
    color: config.theme.warning,
  });
  const instructionTop = titleTop + title.height + config.layout.page.option_gap;
  const instruction = factory.text(parent, {
    testId: "guided-tutorial-instruction",
    text: " ",
    x: padding,
    y: instructionTop,
    width: innerWidth,
    height: Math.max(
      config.typography.body_line_height,
      actionTop - targetStateHeight - instructionTop - config.layout.page.option_gap,
    ),
    fontSize: config.typography.body_size,
    color: config.theme.text,
  });
  const gap = config.layout.page.option_gap;
  const buttonWidth = (innerWidth - gap * 2) / 3;
  factory.button(parent, {
    testId: "guided-tutorial-skip",
    label: config.guided_tutorial.skip_label,
    x: padding,
    y: actionTop,
    width: buttonWidth,
    height: actionHeight,
    tone: "muted",
    onClick: onSkip,
  });
  const previousButton = factory.button(parent, {
    testId: "guided-tutorial-previous",
    label: config.guided_tutorial.previous_label,
    x: padding + buttonWidth + gap,
    y: actionTop,
    width: buttonWidth,
    height: actionHeight,
    tone: "default",
    onClick: onPrevious,
  });
  const nextButton = factory.button(parent, {
    testId: "guided-tutorial-next",
    label: config.guided_tutorial.next_label,
    x: padding + (buttonWidth + gap) * 2,
    y: actionTop,
    width: buttonWidth,
    height: actionHeight,
    tone: "primary",
    onClick: onNext,
  });
  return {
    step,
    speaker,
    title,
    instruction,
    targetState,
    nextLabel: requireButtonLabel(nextButton, "guided-tutorial-next"),
    previousLabel: requireButtonLabel(previousButton, "guided-tutorial-previous"),
  };
}

/** 按当前断点计算右下或底部全宽通讯框。 */
export function resolveTutorialDialogGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): TutorialDialogGeometry {
  const availableWidth = layout.stageWidth
    - layout.safeArea.left
    - layout.safeArea.right
    - layout.outerPadding * 2;
  const width = layout.usesCompactUi
    ? availableWidth
    : Math.min(availableWidth, config.guided_tutorial.desktop_dialog_width);
  const requestedHeight = layout.usesCompactUi
    ? config.guided_tutorial.mobile_dialog_height
    : config.guided_tutorial.desktop_dialog_height;
  const availableHeight = layout.stageHeight
    - layout.safeArea.top
    - layout.safeArea.bottom
    - layout.outerPadding * 2;
  const height = Math.min(availableHeight, requestedHeight);
  return {
    x: layout.stageWidth - layout.safeArea.right - layout.outerPadding - width,
    y: layout.stageHeight - layout.safeArea.bottom - layout.outerPadding - height,
    width,
    height,
  };
}

/** 使用四块遮罩绕开聚焦区，保持目标本身清晰可见。 */
function drawTutorialSpotlight(
  spotlight: LayaSpriteLike,
  focusBorder: LayaSpriteLike,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  target: GuidedTutorialTargetBounds,
): void {
  const padding = config.guided_tutorial.spotlight_padding;
  const left = Math.max(0, target.x - padding);
  const top = Math.max(0, target.y - padding);
  const right = Math.min(layout.stageWidth, target.x + target.width + padding);
  const bottom = Math.min(layout.stageHeight, target.y + target.height + padding);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  spotlight.graphics.clear();
  spotlight.graphics.drawRect(0, 0, layout.stageWidth, top, config.theme.scrim);
  spotlight.graphics.drawRect(0, top, left, height, config.theme.scrim);
  spotlight.graphics.drawRect(right, top, layout.stageWidth - right, height, config.theme.scrim);
  spotlight.graphics.drawRect(0, bottom, layout.stageWidth, layout.stageHeight - bottom, config.theme.scrim);
  focusBorder.pos(left, top);
  focusBorder.size(width, height);
  focusBorder.graphics.clear();
  const lineWidth = config.guided_tutorial.spotlight_border_width;
  focusBorder.graphics.drawLine(0, 0, width, 0, config.theme.accent, lineWidth);
  focusBorder.graphics.drawLine(width, 0, width, height, config.theme.accent, lineWidth);
  focusBorder.graphics.drawLine(width, height, 0, height, config.theme.accent, lineWidth);
  focusBorder.graphics.drawLine(0, height, 0, 0, config.theme.accent, lineWidth);
}

/** 目标页面未渲染时在对话框上方提供一个可预期的聚焦位。 */
function resolveFallbackTarget(
  config: GameUiConfig,
  layout: ResponsiveLayout,
  dialog: TutorialDialogGeometry,
): GuidedTutorialTargetBounds {
  const width = Math.min(layout.stageWidth, config.guided_tutorial.fallback_target_width);
  const height = Math.min(dialog.y, config.guided_tutorial.fallback_target_height);
  return {
    x: (layout.stageWidth - width) / 2,
    y: Math.max(layout.safeArea.top + layout.outerPadding, (dialog.y - height) / 2),
    width,
    height,
  };
}

/** 读取已校验的当前教程步骤。 */
function requireTutorialStep(config: GameUiConfig, index: number) {
  const step = config.guided_tutorial.steps[index];
  if (step === undefined) {
    throw new Error(`战术引导步骤越界：${String(index)}`);
  }
  return step;
}

/** 从 UiFactory 按钮中读取可动态更新的文字节点。 */
function requireButtonLabel(button: LayaNodeLike, testId: string): LayaTextLike {
  const label = button.getChildByName?.(`${testId}-label`);
  if (label === null || label === undefined) {
    throw new Error(`按钮 ${testId} 缺少标签节点。`);
  }
  return label as LayaTextLike;
}
