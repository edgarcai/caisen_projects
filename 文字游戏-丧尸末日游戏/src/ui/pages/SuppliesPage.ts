import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiActionGroupView,
  UiOptionView,
  UiStatView,
} from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/**
 * 创建完整资源、避难所统计和保障行动页面。
 */
export function createSuppliesPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  title: string,
  resources: readonly UiStatView[],
  shelterStats: readonly UiStatView[],
  groups: readonly UiActionGroupView[],
  onBack: () => void,
  onAction: (action: UiOptionView) => void,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-supplies",
    title,
    onBack,
  );
  let cursorY = renderStats(
    factory,
    config,
    page,
    resources,
    0,
    "resource",
  );
  cursorY += layout.sectionGap;
  cursorY = renderStats(
    factory,
    config,
    page,
    shelterStats,
    cursorY,
    "shelter-stat",
  );
  cursorY += layout.sectionGap;
  const supplyGroups = groups.filter(
    (group) => group.id === "supplies" || group.id === "shelter_support",
  );
  supplyGroups.forEach((group) => {
    factory.text(page.content, {
      testId: `supplies-group-${group.id}`,
      text: group.label,
      x: 0,
      y: cursorY,
      width: page.contentWidth,
      height: config.typography.body_line_height,
      fontSize: config.typography.section_title_size,
      color: config.theme.accent,
      bold: true,
    });
    cursorY += config.typography.body_line_height + config.layout.page.option_gap;
    group.actions.forEach((action) => {
      factory.button(page.content, {
        testId: `supplies-action-${action.id}`,
        label: action.label,
        x: 0,
        y: cursorY,
        width: page.contentWidth,
        height: config.controls.button_height,
        tone: action.tone,
        disabled: action.disabled,
        onClick: (): void => { onAction(action); },
      });
      cursorY += config.controls.button_height + config.layout.page.option_gap;
    });
  });
  page.scroll.setContentHeight(cursorY);
  return page;
}

/**
 * 把资源列表渲染为紧凑的双端对齐行。
 */
function renderStats(
  factory: UiFactory,
  config: GameUiConfig,
  page: PageScaffold,
  stats: readonly UiStatView[],
  startY: number,
  testIdPrefix: string,
): number {
  let cursorY = startY;
  stats.forEach((stat) => {
    factory.text(page.content, {
      testId: `${testIdPrefix}-${stat.id}`,
      text: stat.label,
      x: 0,
      y: cursorY,
      width: page.contentWidth / 2,
      height: config.typography.body_line_height,
      fontSize: config.typography.body_size,
      color: stat.emphasized === true ? config.theme.accent : config.theme.text,
    });
    factory.text(page.content, {
      testId: `${testIdPrefix}-${stat.id}-value`,
      text: stat.value,
      x: page.contentWidth / 2,
      y: cursorY,
      width: page.contentWidth / 2,
      height: config.typography.body_line_height,
      fontSize: config.typography.body_size,
      align: "right",
    });
    cursorY += config.typography.body_line_height + config.controls.button_gap;
  });
  return cursorY;
}
