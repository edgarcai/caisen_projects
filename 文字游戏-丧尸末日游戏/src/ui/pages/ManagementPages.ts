import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiManagementOptionView } from "../ports/GameUiPort";
import { createConfigDrivenDetailPage } from "./ConfigDrivenDetailPage";
import type { PageView } from "./PageView";

/** 经营项目详情页可发出的导航与执行意图。 */
export interface ManagementOptionDetailActions {
  readonly back: () => void;
  readonly confirm: () => void;
}

/** 创建先展示说明和需求、再明确执行的经营项目页。 */
export function createManagementOptionDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  option: UiManagementOptionView,
  actions: ManagementOptionDetailActions,
): PageView {
  const locked = option.disabled || option.lockedAppearance === true;
  return createConfigDrivenDetailPage(runtime, factory, config, layout, {
    testId: "page-management-option-detail",
    view: {
      title: option.label,
      description: option.description,
      fields: option.fields,
      requirements: option.requirements.length > 0
        ? option.requirements
        : [{
            id: "availability",
            label: config.texts.management_detail_requirements_title,
            description: option.disabledReason ?? option.description,
            status: locked ? "unmet" : "met",
          }],
    },
    requirementText: {
      fieldsTitle: config.texts.management_detail_title,
      requirementsTitle: config.texts.management_detail_requirements_title,
      fieldFormat: config.texts.expedition_detail_field_format,
      requirementFormat: config.texts.expedition_detail_requirement_format,
      metLabel: config.texts.expedition_requirement_met,
      unmetLabel: config.texts.expedition_requirement_unmet,
      informationalLabel: config.texts.expedition_requirement_informational,
    },
    backLabel: config.texts.back,
    confirmLabel: config.texts.management_detail_confirm,
    confirmDisabled: locked,
    onBack: actions.back,
    onConfirm: actions.confirm,
  });
}
