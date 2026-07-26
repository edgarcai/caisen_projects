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
    [
      {
        id: "close",
        testId: `${testId}-close`,
        label: closeLabel,
        tone: documentView.tone ?? "primary",
        onClick: onClose,
      },
    ],
  );
  const body = factory.autoText(page.content, {
    testId: `${testId}-content`,
    text: documentView.body,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  page.scroll.setContentHeight(body.height + layout.sectionGap);
  return page;
}
