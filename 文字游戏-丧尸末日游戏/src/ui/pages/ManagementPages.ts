import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiManagementOptionView } from "../ports/GameUiPort";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
import { createConfigDrivenDetailPage } from "./ConfigDrivenDetailPage";
import type { PageView } from "./PageView";

/** 经营项目详情页可发出的导航与执行意图。 */
export interface ManagementOptionDetailActions {
  readonly back: () => void;
  readonly cycleRepetitions: (repetitions: number) => void;
  readonly confirm: (repetitions: number) => void;
}

/** 创建先展示说明和需求、再明确执行的经营项目页。 */
export function createManagementOptionDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  option: UiManagementOptionView,
  requestedRepetitions: number | undefined,
  actions: ManagementOptionDetailActions,
): PageView {
  const locked = option.disabled || option.lockedAppearance === true;
  const selectedRepetitions = resolveManagementRepetitions(
    option.repetitionOptions,
    requestedRepetitions,
  );
  const canCycle = option.repetitionOptions.length > 1;
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
    onConfirm: (): void => { actions.confirm(selectedRepetitions); },
    footerActions: [
      {
        id: "back",
        testId: "page-management-option-detail-back",
        label: config.texts.back,
        onClick: actions.back,
      },
      ...(canCycle ? [{
        id: "repetitions",
        testId: "page-management-option-detail-repetitions",
        label: formatUiTemplate(config.texts.management_repetition_cycle_format, {
          count: selectedRepetitions,
        }),
        onClick: (): void => {
          actions.cycleRepetitions(nextManagementRepetition(
            option.repetitionOptions,
            selectedRepetitions,
          ));
        },
      }] : []),
      {
        id: "confirm",
        testId: "page-management-option-detail-confirm",
        label: canCycle
          ? formatUiTemplate(config.texts.management_repetition_confirm_format, {
              count: selectedRepetitions,
            })
          : config.texts.management_detail_confirm,
        tone: "primary",
        disabled: locked,
        onClick: (): void => { actions.confirm(selectedRepetitions); },
      },
    ],
  });
}

/** 从配置化循环次数中选出当前合法值，非法或缺失时回到第一项。 */
export function resolveManagementRepetitions(
  options: readonly number[],
  requested: number | undefined,
): number {
  if (requested !== undefined && options.includes(requested)) return requested;
  return options[0] ?? 1;
}

/** 按配置顺序循环工作次数，不在页面硬编码任何候选值。 */
export function nextManagementRepetition(
  options: readonly number[],
  current: number,
): number {
  if (options.length === 0) return 1;
  const currentIndex = options.indexOf(current);
  return options[(currentIndex + 1) % options.length] ?? options[0] ?? 1;
}
