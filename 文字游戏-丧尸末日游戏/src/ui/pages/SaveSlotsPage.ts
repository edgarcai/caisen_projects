import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  SaveSlotsPageMode,
  UiSaveSlotView,
} from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/** 单个存档槽位按钮在滚动内容区中的纯几何结果。 */
export interface SaveSlotItemGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 存档槽位网格的完整纯几何结果。 */
export interface SaveSlotGridGeometry {
  readonly columns: number;
  readonly rows: number;
  readonly items: readonly SaveSlotItemGeometry[];
  readonly contentBottom: number;
}

/**
 * 创建带模式说明、六栏摘要和固定底部返回键的存档槽位页。
 */
export function createSaveSlotsPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  slots: readonly UiSaveSlotView[],
  mode: SaveSlotsPageMode,
  onSelect: (slotId: number) => void,
  onBack: () => void,
): PageScaffold {
  const testId = "page-save-slots";
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    testId,
    config.texts.save_slots_title,
    onBack,
  );
  const body = factory.autoText(page.content, {
    testId: `${testId}-body-copy`,
    text: mode === "load"
      ? config.texts.save_slots_load_body
      : config.texts.save_slots_save_body,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  const labels = slots.map(createSaveSlotLabel);
  const geometry = resolveSaveSlotGridGeometry(
    config,
    layout,
    page.contentWidth,
    body.height + layout.sectionGap,
    labels,
  );
  slots.forEach((slot, index) => {
    const item = geometry.items[index];
    if (item === undefined) {
      return;
    }
    const disabled = isSaveSlotDisabled(mode, slot);
    factory.button(page.content, {
      testId: `${testId}-slot-${String(slot.slotId)}`,
      label: labels[index] ?? createSaveSlotLabel(slot),
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      tone: slot.status === "recoverable" ? "warning" : "default",
      disabled,
      hoverableWhenDisabled: disabled,
      fontSize: config.typography.caption_size,
      wordWrap: true,
      onClick: (): void => { onSelect(slot.slotId); },
    });
  });
  page.scroll.setContentHeight(geometry.contentBottom + layout.sectionGap);
  return page;
}

/**
 * 按当前页面语义判断槽位是否不可选择；保存模式允许覆盖任意槽位。
 */
export function isSaveSlotDisabled(
  mode: SaveSlotsPageMode,
  slot: UiSaveSlotView,
): boolean {
  return mode === "load" ? !slot.loadable : !slot.writable;
}

/**
 * 把槽位标题和完整摘要合成为按钮中的多行可读标签。
 */
export function createSaveSlotLabel(slot: UiSaveSlotView): string {
  return `${slot.title}\n${slot.details}`;
}

/**
 * 按配置列数、间距和文本行数计算全部槽位的位置与自适应高度。
 */
export function resolveSaveSlotGridGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
  contentWidth: number,
  startY: number,
  labels: readonly string[],
): SaveSlotGridGeometry {
  const columns = Math.max(1, layout.optionColumns);
  const rows = Math.ceil(labels.length / columns);
  const gap = config.layout.page.option_gap;
  const itemWidth = (contentWidth - gap * (columns - 1)) / columns;
  const items: SaveSlotItemGeometry[] = [];
  let currentY = startY;
  for (let row = 0; row < rows; row += 1) {
    const rowStart = row * columns;
    const rowLabels = labels.slice(rowStart, rowStart + columns);
    const maximumLines = Math.max(1, ...rowLabels.map(countTextLines));
    const itemHeight =
      config.controls.button_height +
      (maximumLines - 1) * config.typography.body_line_height;
    rowLabels.forEach((_label, column) => {
      items.push({
        x: column * (itemWidth + gap),
        y: currentY,
        width: itemWidth,
        height: itemHeight,
      });
    });
    currentY += itemHeight;
    if (row < rows - 1) {
      currentY += gap;
    }
  }
  return { columns, rows, items, contentBottom: currentY };
}

/** 统计显式换行后的最少文本行数。 */
function countTextLines(text: string): number {
  return Math.max(1, text.split(/\r?\n/u).length);
}
