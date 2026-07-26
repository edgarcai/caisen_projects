import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import {
  renderRequirementView,
  type RequirementViewText,
} from "../components/RequirementView";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiDetailFieldView,
  UiRequirementView,
} from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/** 可供城市、区划、研发或管理页面复用的详情模型。 */
export interface ConfigDrivenDetailView {
  readonly title: string;
  readonly description: string;
  readonly fields: readonly UiDetailFieldView[];
  readonly requirements: readonly UiRequirementView[];
}

/** 通用详情页的导航和配置化展示参数。 */
export interface ConfigDrivenDetailPageSpec {
  readonly testId: string;
  readonly view: ConfigDrivenDetailView;
  readonly requirementText: RequirementViewText;
  readonly backLabel: string;
  readonly confirmLabel: string;
  readonly confirmDisabled: boolean;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}

/**
 * 创建正文可滚动、操作固定在底部的配置驱动详情页。
 */
export function createConfigDrivenDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  spec: ConfigDrivenDetailPageSpec,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    spec.testId,
    spec.view.title,
    spec.onBack,
    [
      {
        id: "back",
        testId: `${spec.testId}-back`,
        label: spec.backLabel,
        onClick: spec.onBack,
      },
      {
        id: "confirm",
        testId: `${spec.testId}-confirm`,
        label: spec.confirmLabel,
        tone: "primary",
        disabled: spec.confirmDisabled,
        onClick: spec.onConfirm,
      },
    ],
  );
  const description = factory.autoText(page.content, {
    testId: `${spec.testId}-description`,
    text: spec.view.description,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  const contentHeight = renderRequirementView(
    factory,
    config,
    layout,
    page.content,
    page.contentWidth,
    spec.testId,
    {
      fields: spec.view.fields,
      requirements: spec.view.requirements,
    },
    spec.requirementText,
    description.height + layout.sectionGap,
  );
  page.scroll.setContentHeight(contentHeight);
  return page;
}
