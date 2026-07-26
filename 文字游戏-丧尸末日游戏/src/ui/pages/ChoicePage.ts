import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiOptionView, UiPromptView } from "../ports/GameUiPort";
import type { UiFactory } from "../components/UiFactory";
import { PointerTooltip } from "../components/PointerTooltip";
import type { PageActionSpec } from "../components/PageActionBar";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import { PageScaffold } from "./PageView";

/**
 * 剧情、探索事件和通用选择页面的构建参数。
 */
export interface ChoicePageSpec {
  readonly testId: string;
  readonly title: string;
  readonly prompt: UiPromptView;
  readonly onBack: () => void;
  readonly footerActions?: readonly PageActionSpec[];
  readonly onSelect: (option: UiOptionView) => void;
}

/**
 * 创建正文可滚动、选项不被裁切的通用选择页面。
 */
export function createChoicePage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  spec: ChoicePageSpec,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    spec.testId,
    spec.title,
    spec.onBack,
    spec.footerActions,
  );
  const heading = factory.autoText(page.content, {
    testId: `${spec.testId}-prompt-title`,
    text: spec.prompt.title,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.section_title_size,
    color: config.theme.accent,
    bold: true,
  });
  const bodyY = heading.height + layout.sectionGap;
  const body = factory.autoText(page.content, {
    testId: `${spec.testId}-prompt-body`,
    text: buildChoiceBody(config, spec.prompt, layout.usesCompactUi),
    x: 0,
    y: bodyY,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  const optionsY = bodyY + body.height + layout.sectionGap;
  const tooltip = layout.usesCompactUi
    ? null
    : new PointerTooltip(runtime, factory, page.root, {
        testId: `${spec.testId}-tooltip`,
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
  if (tooltip !== null) {
    page.addDisposable((): void => { tooltip.destroy(); });
  }
  const contentHeight = renderOptions(
    factory,
    config,
    layout,
    page,
    spec,
    optionsY,
    tooltip,
  );
  page.scroll.setContentHeight(contentHeight);
  return page;
}

/**
 * 按当前断点把选项排为一列或两列。
 */
function renderOptions(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  spec: ChoicePageSpec,
  startY: number,
  tooltip: PointerTooltip | null,
): number {
  const columns = Math.max(1, layout.optionColumns);
  const gap = config.layout.page.option_gap;
  const buttonWidth =
    (page.contentWidth - gap * (columns - 1)) / columns;
  const buttonHeight = config.controls.button_height;
  spec.prompt.options.forEach((option, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const button = factory.button(page.content, {
      testId: `${spec.testId}-option-${option.id}`,
      label: option.label,
      x: column * (buttonWidth + gap),
      y: startY + row * (buttonHeight + gap),
      width: buttonWidth,
      height: buttonHeight,
      tone: option.tone,
      disabled: option.disabled,
      onClick: (): void => { spec.onSelect(option); },
    });
    const details = option.disabledReason ?? option.description;
    if (tooltip !== null && details.length > 0) {
      tooltip.bind(
        button,
        { title: option.label, description: details },
        option.disabled,
      );
    }
  });
  const rows = Math.ceil(spec.prompt.options.length / columns);
  return startY + rows * (buttonHeight + gap);
}

/**
 * 把成本、效果和锁定原因放入可滚动正文，按钮仅保留主标签。
 */
function buildChoiceBody(
  config: GameUiConfig,
  prompt: UiPromptView,
  includeOptionIntelligence: boolean,
): string {
  if (!includeOptionIntelligence) {
    return prompt.body;
  }
  const intelligence = prompt.options
    .map((option) => ({
      label: option.label,
      details: option.disabledReason ?? option.description,
    }))
    .filter((item) => item.details.length > 0)
    .map((item) => config.texts.option_intelligence_format
      .replace("{label}", item.label)
      .replace("{details}", item.details));
  if (intelligence.length === 0) {
    return prompt.body;
  }
  return [
    prompt.body,
    config.texts.option_intelligence_title,
    intelligence.join(config.texts.option_intelligence_separator),
  ].join("\n\n");
}
