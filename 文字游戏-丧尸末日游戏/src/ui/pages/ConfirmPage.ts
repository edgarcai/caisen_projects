import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiDocumentView } from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/**
 * 创建不依赖浏览器弹窗的二次确认页面。
 */
export function createConfirmPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  testId: string,
  documentView: UiDocumentView,
  onConfirm: () => void,
  onCancel: () => void,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    testId,
    documentView.title,
    onCancel,
  );
  const body = factory.autoText(page.content, {
    testId: `${testId}-content`,
    text: documentView.body,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  const buttonY = body.height + layout.sectionGap;
  const gap = config.layout.page.option_gap;
  const buttonWidth = (page.contentWidth - gap) / 2;
  factory.button(page.content, {
    testId: `${testId}-cancel`,
    label: config.texts.cancel,
    x: 0,
    y: buttonY,
    width: buttonWidth,
    height: config.controls.button_height,
    onClick: onCancel,
  });
  factory.button(page.content, {
    testId: `${testId}-confirm`,
    label: config.texts.confirm,
    x: buttonWidth + gap,
    y: buttonY,
    width: buttonWidth,
    height: config.controls.button_height,
    tone: "danger",
    onClick: onConfirm,
  });
  page.scroll.setContentHeight(buttonY + config.controls.button_height);
  return page;
}
