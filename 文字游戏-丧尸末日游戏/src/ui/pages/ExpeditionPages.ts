import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { UiFactory } from "../components/UiFactory";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiCityDistrictView,
  UiCityView,
  UiExpeditionCarryItemView,
  UiExpeditionCompanionView,
  UiExpeditionStatusView,
} from "../ports/GameUiPort";
import { createChoicePage } from "./ChoicePage";
import { createConfigDrivenDetailPage } from "./ConfigDrivenDetailPage";
import { PageScaffold, type PageView } from "./PageView";

/** 远征整备页中由 UI 管理、但尚未提交领域的选择。 */
export interface ExpeditionDraft {
  readonly cityId: string | null;
  readonly districtId: string | null;
  readonly companionIds: ReadonlySet<string>;
  readonly carriedItems: Readonly<Record<string, number>>;
}

/** 远征整备页可发出的无领域副作用 UI 意图。 */
export interface ExpeditionPrepareActions {
  readonly back: () => void;
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

/** 城市列表页发出的纯导航意图。 */
export interface ExpeditionCityListActions {
  readonly back: () => void;
  readonly openCity: (cityId: string) => void;
}

/** 城市详情页发出的纯导航意图。 */
export interface ExpeditionCityDetailActions {
  readonly back: () => void;
  readonly continueToDistricts: () => void;
}

/** 区划列表页发出的纯导航意图。 */
export interface ExpeditionDistrictListActions {
  readonly back: () => void;
  readonly openDistrict: (districtId: string) => void;
}

/** 区划详情页发出的纯导航意图。 */
export interface ExpeditionDistrictDetailActions {
  readonly back: () => void;
  readonly continueToPrepare: () => void;
}

/** 创建所有城市始终可进入详情的远征城市列表页。 */
export function createExpeditionCityListPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  cities: readonly UiCityView[],
  actions: ExpeditionCityListActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-expedition-city-list",
    title: config.texts.expedition_city_list_title,
    prompt: {
      id: "expedition-city-list",
      title: config.texts.expedition_city_title,
      body: config.texts.expedition_city_list_body,
      options: cities.map((city) => ({
        id: city.id,
        label: formatUiTemplate(config.texts.expedition_city_format, {
          name: city.label,
          district: city.districtLabel,
          relation: city.relationLabel,
          terrain: city.terrainLabel,
          steps: city.travelStepCost,
          status: city.disabled
            ? config.texts.expedition_requirement_unmet
            : config.texts.expedition_requirement_met,
        }),
        description: city.disabledReason ?? city.description,
        disabled: false,
        lockedAppearance: city.disabled,
        tone: city.disabled ? "default" : "primary",
      })),
    },
    onBack: actions.back,
    includeOptionIntelligence: false,
    onSelect: (option): void => { actions.openCity(option.id); },
  });
}

/** 创建城市情报与通行需求详情页，锁定状态只禁用继续按钮。 */
export function createExpeditionCityDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  city: UiCityView,
  actions: ExpeditionCityDetailActions,
): PageView {
  return createConfigDrivenDetailPage(runtime, factory, config, layout, {
    testId: "page-expedition-city-detail",
    view: {
      title: city.label,
      description: city.description,
      fields: city.fields,
      requirements: city.requirements,
    },
    requirementText: expeditionRequirementText(config),
    backLabel: config.texts.back,
    confirmLabel: config.texts.expedition_city_detail_confirm,
    confirmDisabled: city.disabled || city.districts.length === 0,
    onBack: actions.back,
    onConfirm: actions.continueToDistricts,
  });
}

/** 创建完全由所选城市配置生成的区划列表页。 */
export function createExpeditionDistrictListPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  city: UiCityView,
  actions: ExpeditionDistrictListActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-expedition-district-list",
    title: config.texts.expedition_district_list_title,
    prompt: {
      id: `expedition-district-list-${city.id}`,
      title: city.label,
      body: config.texts.expedition_district_list_body,
      options: city.districts.map((district) => ({
        id: district.id,
        label: district.label,
        description: district.description,
        disabled: false,
        tone: "primary",
      })),
    },
    onBack: actions.back,
    includeOptionIntelligence: false,
    onSelect: (option): void => { actions.openDistrict(option.id); },
  });
}

/** 创建区划危险、步数和事件倾向详情页。 */
export function createExpeditionDistrictDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  district: UiCityDistrictView,
  actions: ExpeditionDistrictDetailActions,
): PageView {
  return createConfigDrivenDetailPage(runtime, factory, config, layout, {
    testId: "page-expedition-district-detail",
    view: {
      title: district.label,
      description: district.description,
      fields: district.fields,
      requirements: district.requirements,
    },
    requirementText: expeditionRequirementText(config),
    backLabel: config.texts.back,
    confirmLabel: config.texts.expedition_district_detail_confirm,
    confirmDisabled: false,
    onBack: actions.back,
    onConfirm: actions.continueToPrepare,
  });
}

/** 缺少或失效的区划草稿优先回退城市默认区划，再回退首个配置项。 */
export function resolveExpeditionDistrict(
  city: UiCityView,
  districtId: string | null,
): UiCityDistrictView | null {
  return city.districts.find((district) => district.id === districtId)
    ?? city.districts.find((district) => district.id === city.defaultDistrictId)
    ?? city.districts[0]
    ?? null;
}

/** 将远征详情页文案集中映射到通用需求视图。 */
function expeditionRequirementText(config: GameUiConfig) {
  return {
    fieldsTitle: config.texts.expedition_detail_fields_title,
    requirementsTitle: config.texts.expedition_detail_requirements_title,
    fieldFormat: config.texts.expedition_detail_field_format,
    requirementFormat: config.texts.expedition_detail_requirement_format,
    metLabel: config.texts.expedition_requirement_met,
    unmetLabel: config.texts.expedition_requirement_unmet,
    informationalLabel: config.texts.expedition_requirement_informational,
  };
}

/**
 * 创建伙伴和携带物都可真实选择的远征整备页。
 */
export function createExpeditionPreparePage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
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
        disabled: draft.cityId === null || draft.districtId === null,
        onClick: actions.begin,
      },
    ],
  );
  let currentY = renderIntro(factory, config, layout, page);
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
): number {
  const columns = Math.max(1, layout.optionColumns);
  const gap = config.layout.page.option_gap;
  const width = (page.contentWidth - gap * (columns - 1)) / columns;
  const height = config.controls.button_height;
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    factory.button(page.content, {
      testId: `${testIdPrefix}-${item.id}`,
      label: item.label,
      x: column * (width + gap),
      y: startY + row * (height + gap),
      width,
      height,
      tone: item.selected ? "primary" : "default",
      disabled: item.disabled,
      fontSize: config.typography.caption_size,
      wordWrap: true,
      onClick: item.onClick,
    });
  });
  const rows = Math.ceil(items.length / columns);
  return startY + rows * (height + gap) + layout.sectionGap;
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
    district: status.districtName,
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
