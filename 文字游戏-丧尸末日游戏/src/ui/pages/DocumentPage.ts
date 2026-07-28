import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiDocumentView } from "../ports/GameUiPort";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
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
  populateDocumentBody(factory, config, layout, page, testId, documentView.body);
  return page;
}

/** 创建没有关闭、返回或底部操作的失败结局页。 */
export function createForcedEndingPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  testId: string,
  documentView: UiDocumentView,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    testId,
    documentView.title,
    (): void => undefined,
    [],
  );
  const seconds = Math.ceil(config.failure_flow.forced_return_delay_ms / 1000);
  const returnNotice = formatUiTemplate(
    config.failure_flow.return_notice_format,
    { seconds },
  );
  populateDocumentBody(
    factory,
    config,
    layout,
    page,
    testId,
    `${documentView.body}\n\n${returnNotice}`,
  );
  return page;
}

/** 向文档骨架写入自适应正文，并同步可滚动内容高度。 */
function populateDocumentBody(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  testId: string,
  bodyText: string,
): void {
  const body = factory.autoText(page.content, {
    testId: `${testId}-content`,
    text: bodyText,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  page.scroll.setContentHeight(body.height + layout.sectionGap);
}
