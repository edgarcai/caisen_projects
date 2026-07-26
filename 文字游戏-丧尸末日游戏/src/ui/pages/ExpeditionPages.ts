import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import { PointerTooltip } from "../components/PointerTooltip";
import type { UiFactory } from "../components/UiFactory";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiCityView,
  UiExpeditionCarryItemView,
  UiExpeditionCompanionView,
  UiExpeditionStatusView,
} from "../ports/GameUiPort";
import { PageScaffold, type PageView } from "./PageView";

/** 远征整备页中由 UI 管理、但尚未提交领域的选择。 */
export interface ExpeditionDraft {
  readonly cityId: string | null;
  readonly companionIds: ReadonlySet<string>;
  readonly carriedItems: Readonly<Record<string, number>>;
}

/** 远征整备页可发出的无领域副作用 UI 意图。 */
export interface ExpeditionPrepareActions {
  readonly back: () => void;
  readonly selectCity: (cityId: string) => void;
  readonly toggleCompanion: (companionId: string) => void;
  readonly cycleItem: (itemId: string) => void;
  readonly begin: () => void;
}

/** 远征状态页上的三个稳定导航命令。 */
export interface ExpeditionStatusActions {
  readonly back: () => void;
  readonly continueExpedition: () => void;
  readonly safeReturn: () => void;
}

/**
 * 创建城市、伙伴和携带物都可真实选择的远征整备页。
 */
export function createExpeditionPreparePage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  cities: readonly UiCityView[],
  companions: readonly UiExpeditionCompanionView[],
  carryItems: readonly UiExpeditionCarryItemView[],
  draft: ExpeditionDraft,
  actions: ExpeditionPrepareActions,
): PageView {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-expedition-prepare",
    config.texts.expedition_prepare_title,
    actions.back,
    [
      {
        id: "back",
        testId: "page-expedition-prepare-back",
        label: config.texts.back,
        onClick: actions.back,
      },
      {
        id: "begin",
        testId: "page-expedition-prepare-begin",
        label: config.texts.expedition_begin,
        tone: "primary",
        disabled: draft.cityId === null,
        onClick: actions.begin,
      },
    ],
  );
  const tooltip = createExpeditionTooltip(
    runtime,
    factory,
    config,
    layout,
    page,
  );
  let currentY = renderIntro(factory, config, layout, page);
  currentY = renderCitySection(
    factory,
    config,
    layout,
    page,
    cities,
    draft,
    actions,
    tooltip,
    currentY,
  );
  currentY = renderCompanionSection(
    factory,
    config,
    layout,
    page,
    companions,
    draft,
    actions,
    currentY,
  );
  currentY = renderCarryItemSection(
    factory,
    config,
    layout,
    page,
    carryItems,
    draft,
    actions,
    currentY,
  );
  page.scroll.setContentHeight(currentY + layout.sectionGap);
  return page;
}

/** 绘制远征整备页的配置化引导文案。 */
function renderIntro(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
): number {
  const body = factory.autoText(page.content, {
    testId: "page-expedition-prepare-body",
    text: config.texts.expedition_prepare_body,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  return body.height + layout.sectionGap;
}

/** 绘制单选城市区域并返回下一区域起点。 */
function renderCitySection(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  cities: readonly UiCityView[],
  draft: ExpeditionDraft,
  actions: ExpeditionPrepareActions,
  tooltip: PointerTooltip | null,
  startY: number,
): number {
  const titleBottom = renderSectionTitle(
    factory,
    config,
    page,
    "page-expedition-city-title",
    config.texts.expedition_city_title,
    startY,
  );
  const labels = cities.map((city) => ({
    id: city.id,
    label: formatUiTemplate(config.texts.expedition_city_format, {
      name: city.label,
      district: city.districtLabel,
      relation: city.relationLabel,
      terrain: city.terrainLabel,
      steps: city.travelStepCost,
      status: draft.cityId === city.id
        ? config.texts.expedition_selected
        : config.texts.expedition_unselected,
    }),
    description: city.description,
    selected: draft.cityId === city.id,
    disabled: city.disabled,
    onClick: (): void => { actions.selectCity(city.id); },
  }));
  const gridBottom = renderSelectionGrid(
    factory,
    config,
    layout,
    page,
    "page-expedition-city",
    labels,
    titleBottom + layout.sectionGap,
    tooltip,
  );
  return layout.kind === "mobile"
    ? renderMobileCityIntelligence(
        factory,
        config,
        layout,
        page,
        cities,
        gridBottom,
      )
    : gridBottom;
}

/** 绘制可复选的同行伙伴区域。 */
function renderCompanionSection(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  companions: readonly UiExpeditionCompanionView[],
  draft: ExpeditionDraft,
  actions: ExpeditionPrepareActions,
  startY: number,
): number {
  const titleBottom = renderSectionTitle(
    factory,
    config,
    page,
    "page-expedition-companion-title",
    config.texts.expedition_companion_title,
    startY,
  );
  const labels = companions.map((companion) => {
    const selected = draft.companionIds.has(companion.id);
    return {
      id: companion.id,
      label: formatUiTemplate(config.texts.expedition_companion_format, {
        name: companion.name,
        trait: companion.traitName,
        trust: companion.trust,
        bonus: companion.stepBonus,
        status: selected
          ? config.texts.expedition_selected
          : config.texts.expedition_unselected,
      }),
      selected,
      disabled: false,
      onClick: (): void => { actions.toggleCompanion(companion.id); },
    };
  });
  return renderSelectionGrid(
    factory,
    config,
    layout,
    page,
    "page-expedition-companion",
    labels,
    titleBottom + layout.sectionGap,
  );
}

/** 绘制点击循环数量的携带物区域。 */
function renderCarryItemSection(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  items: readonly UiExpeditionCarryItemView[],
  draft: ExpeditionDraft,
  actions: ExpeditionPrepareActions,
  startY: number,
): number {
  const titleBottom = renderSectionTitle(
    factory,
    config,
    page,
    "page-expedition-item-title",
    config.texts.expedition_item_title,
    startY,
  );
  const labels = items.map((item) => {
    const quantity = draft.carriedItems[item.id] ?? 0;
    return {
      id: item.id,
      label: formatUiTemplate(config.texts.expedition_item_format, {
        name: item.name,
        quantity,
        available: item.availableQuantity,
        bonus: item.stepBonusPerUnit,
      }),
      selected: quantity > 0,
      disabled: item.availableQuantity <= 0,
      onClick: (): void => { actions.cycleItem(item.id); },
    };
  });
  return renderSelectionGrid(
    factory,
    config,
    layout,
    page,
    "page-expedition-item",
    labels,
    titleBottom + layout.sectionGap,
  );
}

/** 绘制一个配置字号的整备分区标题。 */
function renderSectionTitle(
  factory: UiFactory,
  config: GameUiConfig,
  page: PageScaffold,
  testId: string,
  text: string,
  y: number,
): number {
  const title = factory.autoText(page.content, {
    testId,
    text,
    x: 0,
    y,
    width: page.contentWidth,
    fontSize: config.typography.section_title_size,
    color: config.theme.accent,
    bold: true,
  });
  return y + title.height;
}

/** 一个不含领域语义的整备选项。 */
interface SelectionGridItem {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly description?: string;
  readonly onClick: () => void;
}

/** 按当前断点绘制适合手机触控的整备选项网格。 */
function renderSelectionGrid(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  testIdPrefix: string,
  items: readonly SelectionGridItem[],
  startY: number,
  tooltip: PointerTooltip | null = null,
): number {
  const columns = Math.max(1, layout.optionColumns);
  const gap = config.layout.page.option_gap;
  const width = (page.contentWidth - gap * (columns - 1)) / columns;
  const height = config.controls.button_height;
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const button = factory.button(page.content, {
      testId: `${testIdPrefix}-${item.id}`,
      label: item.label,
      x: column * (width + gap),
      y: startY + row * (height + gap),
      width,
      height,
      tone: item.selected ? "primary" : "default",
      disabled: item.disabled,
      hoverableWhenDisabled: tooltip !== null && item.disabled,
      fontSize: config.typography.caption_size,
      wordWrap: true,
      onClick: item.onClick,
    });
    if (tooltip !== null && item.description !== undefined) {
      tooltip.bind(
        button,
        { title: item.label, description: item.description },
        item.disabled,
      );
    }
  });
  const rows = Math.ceil(items.length / columns);
  return startY + rows * (height + gap) + layout.sectionGap;
}

/** 为手机端绘制与桌面悬停层等价的完整城市情报。 */
function renderMobileCityIntelligence(
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  cities: readonly UiCityView[],
  startY: number,
): number {
  const intelligence = cities.map((city) =>
    config.texts.option_intelligence_format
      .replace("{label}", city.label)
      .replace("{details}", city.description))
    .join(config.texts.option_intelligence_separator);
  const body = factory.autoText(page.content, {
    testId: "page-expedition-city-intelligence",
    text: `${config.texts.option_intelligence_title}\n${intelligence}`,
    x: 0,
    y: startY,
    width: page.contentWidth,
    fontSize: config.typography.caption_size,
    color: config.theme.muted_text,
  });
  return startY + body.height + layout.sectionGap;
}

/** 为电脑远征选项创建配置化延迟、跟随指针的简介层。 */
function createExpeditionTooltip(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
): PointerTooltip | null {
  if (layout.kind === "mobile") return null;
  const tooltip = new PointerTooltip(runtime, factory, page.root, {
    testId: "page-expedition-tooltip",
    delayMs: config.motion.cover_menu_description_delay_ms,
    width: config.controls.tooltip_width,
    padding: config.controls.tooltip_padding,
    offset: {
      x: config.controls.tooltip_offset_x,
      y: config.controls.tooltip_offset_y,
    },
    bounds: {
      left: layout.safeArea.left,
      top: layout.safeArea.top,
      right: layout.stageWidth - layout.safeArea.right,
      bottom: layout.stageHeight - layout.safeArea.bottom,
    },
    titleFontSize: config.typography.section_title_size,
    titleLineHeight: config.typography.body_line_height,
    descriptionFontSize: config.typography.body_size,
    descriptionLineHeight: config.typography.body_line_height,
    contentGap: config.controls.button_gap,
  });
  page.addDisposable((): void => { tooltip.destroy(); });
  return tooltip;
}

/** 创建能继续深入、安全返程或暂时返回指挥台的远征状态页。 */
export function createExpeditionStatusPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  status: UiExpeditionStatusView,
  companions: readonly UiExpeditionCompanionView[],
  itemNames: ReadonlyMap<string, string>,
  actions: ExpeditionStatusActions,
): PageView {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-expedition-status",
    config.texts.expedition_status_title,
    actions.back,
    [
      {
        id: "back",
        testId: "page-expedition-status-back",
        label: config.texts.back,
        onClick: actions.back,
      },
      {
        id: "continue",
        testId: "page-expedition-status-continue",
        label: config.texts.expedition_continue,
        tone: "primary",
        onClick: actions.continueExpedition,
      },
      {
        id: "safe-return",
        testId: "page-expedition-status-safe-return",
        label: config.texts.expedition_safe_return,
        tone: "success",
        onClick: actions.safeReturn,
      },
    ],
  );
  const body = factory.autoText(page.content, {
    testId: "page-expedition-status-body",
    text: buildExpeditionStatusBody(config, status, companions, itemNames),
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  page.scroll.setContentHeight(body.height + layout.sectionGap);
  return page;
}

/** 把远征 ID 映射为玩家可读名称并格式化状态正文。 */
export function buildExpeditionStatusBody(
  config: GameUiConfig,
  status: UiExpeditionStatusView,
  companions: readonly UiExpeditionCompanionView[],
  itemNames: ReadonlyMap<string, string>,
): string {
  const companionNames = status.companionIds.map((companionId) =>
    companions.find((companion) => companion.id === companionId)?.name ?? companionId);
  const separator = config.texts.option_intelligence_separator;
  const carriedItems = formatQuantities(
    config,
    status.carriedItems,
    itemNames,
    separator,
  );
  const loot = formatQuantities(config, status.loot, itemNames, separator);
  const statusText = formatUiTemplate(config.texts.expedition_status_format, {
    city: status.cityName,
    remaining: status.remainingSteps,
    maximum: status.maximumSteps,
    events: status.eventsResolved,
    companions: companionNames.length > 0
      ? companionNames.join(separator)
      : config.texts.expedition_unselected,
    items: carriedItems,
  });
  return [
    statusText,
    formatUiTemplate(config.texts.expedition_loot_format, { loot }),
  ].join(separator + separator);
}

/** 将物品数量表转换为配置化可读列表。 */
function formatQuantities(
  config: GameUiConfig,
  quantities: Readonly<Record<string, number>>,
  itemNames: ReadonlyMap<string, string>,
  separator: string,
): string {
  const entries = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
  if (entries.length === 0) {
    return config.texts.expedition_unselected;
  }
  return entries.map(([itemId, quantity]) => formatUiTemplate(
    config.texts.warehouse_item_format,
    {
      name: itemNames.get(itemId) ?? config.texts.expedition_unknown_item,
      quantity,
    },
  )).join(separator);
}
