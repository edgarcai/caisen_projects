import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiDocumentView } from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/**
 * 创建教程、消息或结局长文本页面。
 */
export function createDocumentPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  testId: string,
  documentView: UiDocumentView,
  closeLabel: string,
  onClose: () => void,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    testId,
    documentView.title,
    onClose,
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
  const buttonWidth = Math.min(
    page.contentWidth,
    config.layout.cover.menu_width,
  );
  factory.button(page.content, {
    testId: `${testId}-close`,
    label: closeLabel,
    x: (page.contentWidth - buttonWidth) / 2,
    y: buttonY,
    width: buttonWidth,
    height: config.controls.button_height,
    tone: documentView.tone ?? "primary",
    onClick: onClose,
  });
  page.scroll.setContentHeight(buttonY + config.controls.button_height);
  return page;
}
