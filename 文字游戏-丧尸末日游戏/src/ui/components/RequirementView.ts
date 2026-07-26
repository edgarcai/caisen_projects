import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { LayaSpriteLike } from "../laya/LayaRuntime";
import type {
  UiDetailFieldView,
  UiRequirementView,
} from "../ports/GameUiPort";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
import type { UiFactory } from "./UiFactory";

/** 通用详情与需求视图所需的配置化文案。 */
export interface RequirementViewText {
  readonly fieldsTitle: string;
  readonly requirementsTitle: string;
  readonly fieldFormat: string;
  readonly requirementFormat: string;
  readonly metLabel: string;
  readonly unmetLabel: string;
  readonly informationalLabel: string;
}

/** 通用详情与需求视图的只读输入。 */
export interface RequirementViewModel {
  readonly fields: readonly UiDetailFieldView[];
  readonly requirements: readonly UiRequirementView[];
}

/**
 * 在任意详情页内容容器中绘制字段和条件，并返回下一段内容起点。
 */
export function renderRequirementView(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  parent: LayaSpriteLike,
  contentWidth: number,
  testId: string,
  model: RequirementViewModel,
  text: RequirementViewText,
  startY: number,
): number {
  let currentY = startY;
  if (model.fields.length > 0) {
    currentY = renderSectionTitle(
      factory,
      config,
      parent,
      contentWidth,
      `${testId}-fields-title`,
      text.fieldsTitle,
      currentY,
    );
    currentY = renderFields(
      factory,
      config,
      layout,
      parent,
      contentWidth,
      testId,
      model.fields,
      text.fieldFormat,
      currentY,
    );
  }
  if (model.requirements.length > 0) {
    currentY = renderSectionTitle(
      factory,
      config,
      parent,
      contentWidth,
      `${testId}-requirements-title`,
      text.requirementsTitle,
      currentY,
    );
    currentY = renderRequirements(
      factory,
      config,
      layout,
      parent,
      contentWidth,
      testId,
      model.requirements,
      text,
      currentY,
    );
  }
  return currentY;
}

/** 绘制通用详情分区标题并返回正文起点。 */
function renderSectionTitle(
  factory: UiFactory,
  config: GameUiConfig,
  parent: LayaSpriteLike,
  contentWidth: number,
  testId: string,
  title: string,
  startY: number,
): number {
  const heading = factory.autoText(parent, {
    testId,
    text: title,
    x: 0,
    y: startY,
    width: contentWidth,
    fontSize: config.typography.section_title_size,
    color: config.theme.accent,
    bold: true,
  });
  return startY + heading.height + config.layout.page.option_gap;
}

/** 把详情字段转换为配置化文本块。 */
function renderFields(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  parent: LayaSpriteLike,
  contentWidth: number,
  testId: string,
  fields: readonly UiDetailFieldView[],
  fieldFormat: string,
  startY: number,
): number {
  const body = factory.autoText(parent, {
    testId: `${testId}-fields`,
    text: fields.map((field) => formatUiTemplate(fieldFormat, {
      label: field.label,
      value: field.value,
    })).join("\n"),
    x: 0,
    y: startY,
    width: contentWidth,
    fontSize: config.typography.body_size,
  });
  return startY + body.height + layout.sectionGap;
}

/** 把条件状态转换为配置化文本块，并以语义色区分未满足项。 */
function renderRequirements(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  parent: LayaSpriteLike,
  contentWidth: number,
  testId: string,
  requirements: readonly UiRequirementView[],
  text: RequirementViewText,
  startY: number,
): number {
  let currentY = startY;
  requirements.forEach((requirement) => {
    const body = factory.autoText(parent, {
      testId: `${testId}-requirement-${requirement.id}`,
      text: formatUiTemplate(text.requirementFormat, {
        status: requirementStatusLabel(requirement, text),
        label: requirement.label,
        description: requirement.description,
      }),
      x: 0,
      y: currentY,
      width: contentWidth,
      fontSize: config.typography.body_size,
      color: requirement.status === "unmet"
        ? config.theme.warning
        : config.theme.text,
    });
    currentY += body.height + config.layout.page.option_gap;
  });
  return currentY + layout.sectionGap;
}

/** 返回一项条件对应的配置化状态标签。 */
function requirementStatusLabel(
  requirement: UiRequirementView,
  text: RequirementViewText,
): string {
  if (requirement.status === "met") return text.metLabel;
  if (requirement.status === "unmet") return text.unmetLabel;
  return text.informationalLabel;
}
