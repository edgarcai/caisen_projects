import { formatTemplate } from "../../domain/content";
import type {
  GameUiConfig,
  NewGameSetupCategoryTokenId,
} from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import { ScrollRegion } from "../components/ScrollRegion";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaInputLike,
  LayaNodeLike,
  LayaRuntimeLike,
  LayaSpriteLike,
  LayaTextLike,
} from "../laya/LayaRuntime";
import type {
  GameMode,
  UiCampaignOptionView,
  UiCampaignProfileOptionsView,
  UiCampaignProfileSelection,
  UiSaveSlotView,
} from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/** 开局选择模型允许使用的稳定标识。 */
type SelectionId = string | number;

/** 开局列表中统一的可选项。 */
interface SetupOption<TId extends SelectionId> {
  readonly id: TId;
  readonly label: string;
  readonly description: string;
}

/** 可被中央列表与底部摘要共享的选择状态。 */
interface SetupSelection<TId extends SelectionId> {
  current(): SetupOption<TId>;
  select(id: TId): SetupOption<TId>;
  advance(): SetupOption<TId>;
  options(): readonly SetupOption<TId>[];
}

/** 每个模式的玩家数可由上层领域快照注入。 */
export type NewGamePlayerCountSource =
  | number
  | Readonly<Record<string, number>>;

/** 开局页提交时保持旧参数顺序，并把真实选中模式作为第四参数交给上层。 */
export type NewGameSetupSubmitHandler = (
  names: readonly string[],
  profile: UiCampaignProfileSelection,
  slotId: number,
  mode: GameMode,
) => void;

/** 新游戏配置页以及读取当前完整协议的能力。 */
export interface NewGameSetupPageView {
  readonly page: PageScaffold;
  readNames(): readonly string[];
  readMode(): GameMode;
  readProfile(): UiCampaignProfileSelection;
  readSlotId(): number | null;
  selectCategory(categoryId: NewGameSetupCategoryTokenId): void;
}

/** 开局页内部用于刷新选中态的可视绑定。 */
interface SelectionVisualBinding<TId extends SelectionId> {
  readonly id: TId;
  readonly label: LayaTextLike;
  readonly mark: LayaTextLike;
}

/** 姓名输入区需要同时管理值、可见性和预设按钮。 */
interface NameFieldBinding {
  readonly root: LayaSpriteLike;
  readonly input: LayaInputLike;
}

/** 底部摘要中可快速循环的六个选择类别。 */
type SummarySelectionCategory = Exclude<NewGameSetupCategoryTokenId, "name">;

/** 创建类太空策略游戏的三栏建档页，手机端则切换为纵向分步流。 */
export function createNewGameSetupPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  initialMode: GameMode,
  playerCounts: NewGamePlayerCountSource,
  profileOptions: UiCampaignProfileOptionsView,
  saveSlots: readonly UiSaveSlotView[],
  onBack: () => void,
  onSubmit: NewGameSetupSubmitHandler,
  prepareNameInput: () => void,
  onTextEntryFocusOut: () => void,
): NewGameSetupPageView {
  const modeSelection = createModeSelection(config, initialMode);
  const difficulty = createCampaignSelection(
    profileOptions.difficulties,
    profileOptions.defaultSelection.difficultyId,
    config.texts.profile_difficulty_label,
  );
  const origin = createCampaignSelection(
    profileOptions.origins,
    profileOptions.defaultSelection.originId,
    config.texts.profile_origin_label,
  );
  const trait = createCampaignSelection(
    profileOptions.traits,
    profileOptions.defaultSelection.traitId,
    config.texts.profile_trait_label,
  );
  const city = createCampaignSelection(
    profileOptions.cities,
    profileOptions.defaultSelection.homeCityId,
    config.texts.profile_city_label,
  );
  const slot = createSlotSelection(saveSlots, config);
  const categoryOrder = config.new_game_setup.categories.map((item) => item.id);
  const initialCategory = categoryOrder[0];
  if (initialCategory === undefined) {
    throw new Error("开局页缺少分类导航配置。");
  }
  const resolvedPlayerCounts = resolvePlayerCounts(
    playerCounts,
    config.new_game_setup.mode_options.map((option) => option.id),
    initialMode,
  );
  const maximumPlayers = Math.max(...Object.values(resolvedPlayerCounts));
  let activeCategory = initialCategory;
  const nameFields: NameFieldBinding[] = [];
  const categoryGroups = new Map<NewGameSetupCategoryTokenId, LayaSpriteLike>();
  const navigationLabels = new Map<NewGameSetupCategoryTokenId, LayaTextLike>();
  const previewTitles = new Map<NewGameSetupCategoryTokenId, LayaTextLike>();
  const previewDescriptions = new Map<NewGameSetupCategoryTokenId, LayaTextLike>();
  const selectionBindings = new Map<
    SummarySelectionCategory,
    readonly SelectionVisualBinding<SelectionId>[]
  >();
  const summaryLabels = new Map<SummarySelectionCategory, LayaTextLike>();
  let summaryText: LayaTextLike | null = null;
  let mobileStepText: LayaTextLike | null = null;
  let optionScroll: ScrollRegion | null = null;

  /** 读取当前模式需要的所长姓名，并去掉首尾空白。 */
  const readNames = (): readonly string[] => {
    const count = resolveActivePlayerCount(resolvedPlayerCounts, modeSelection.current().id);
    return nameFields.slice(0, count).map((field) => field.input.text.trim());
  };

  /** 读取页面中真正选中的游戏模式。 */
  const readMode = (): GameMode => modeSelection.current().id;

  /** 读取当前领域开局档案。 */
  const readProfile = (): UiCampaignProfileSelection => ({
    difficultyId: difficulty.current().id,
    originId: origin.current().id,
    traitId: trait.current().id,
    homeCityId: city.current().id,
  });

  /** 读取可写存档栏位，当浏览器无栏位时返回空值。 */
  const readSlotId = (): number | null => slot?.current().id ?? null;

  /** 仅在有可写栏位时提交完整开局协议。 */
  const handleSubmit = (): void => {
    const slotId = readSlotId();
    if (slotId === null) {
      return;
    }
    onSubmit(readNames(), readProfile(), slotId, readMode());
  };

  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-new-game-setup",
    config.texts.profile_setup_title,
    onBack,
    [
      {
        id: "back",
        testId: "page-new-game-setup-back",
        label: config.texts.back,
        onClick: onBack,
      },
      {
        id: "submit",
        testId: "player-name-submit",
        label: config.texts.name_submit,
        tone: "primary",
        disabled: slot === null,
        onClick: handleSubmit,
      },
    ],
  );
  const introduction = factory.autoText(page.content, {
    testId: "page-new-game-setup-body",
    text: config.texts.profile_setup_body,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.caption_size,
    color: config.theme.muted_text,
  });

  /** 根据当前分类与全部选择结果刷新三栏和摘要。 */
  const refreshAll = (): void => {
    refreshCategoryVisibility(categoryGroups, activeCategory);
    refreshNavigationLabels(navigationLabels, activeCategory, config);
    refreshPreviewVisibility(previewTitles, previewDescriptions, activeCategory);
    refreshSelectionBindings("mode", modeSelection, selectionBindings, config);
    refreshSelectionBindings("difficulty", difficulty, selectionBindings, config);
    refreshSelectionBindings("origin", origin, selectionBindings, config);
    refreshSelectionBindings("trait", trait, selectionBindings, config);
    refreshSelectionBindings("city", city, selectionBindings, config);
    refreshSelectionBindings("slot", slot, selectionBindings, config);
    refreshPreviewText(
      config,
      activeCategory,
      readNames(),
      modeSelection,
      difficulty,
      origin,
      trait,
      city,
      slot,
      previewTitles,
      previewDescriptions,
    );
    refreshSummaryLabels(
      config,
      summaryLabels,
      modeSelection,
      difficulty,
      origin,
      trait,
      city,
      slot,
    );
    if (summaryText !== null) {
      summaryText.text = buildSetupSummary(
        config,
        readNames(),
        modeSelection.current(),
        difficulty.current(),
        origin.current(),
        trait.current(),
        city.current(),
        slot?.current() ?? null,
      );
    }
    refreshNameFieldVisibility(
      nameFields,
      resolveActivePlayerCount(resolvedPlayerCounts, modeSelection.current().id),
    );
    const categoryIndex = categoryOrder.indexOf(activeCategory);
    if (mobileStepText !== null) {
      mobileStepText.text = formatTemplate(config.new_game_setup.copy.step_format, {
        current: categoryIndex + 1,
        total: categoryOrder.length,
      });
    }
    optionScroll?.setContentHeight(resolveCategoryContentHeight(
      activeCategory,
      modeSelection,
      difficulty,
      origin,
      trait,
      city,
      slot,
      maximumPlayers,
      config,
      layout,
    ));
  };

  /** 切换到指定配置阶段，并保持所有选择不变。 */
  const selectCategory = (categoryId: NewGameSetupCategoryTokenId): void => {
    if (!categoryOrder.includes(categoryId)) {
      throw new Error(`开局页不存在分类：${categoryId}`);
    }
    activeCategory = categoryId;
    refreshAll();
  };

  /** 从当前阶段移动到相邻阶段，并限制在配置范围中。 */
  const moveCategory = (offset: number): void => {
    const currentIndex = categoryOrder.indexOf(activeCategory);
    const nextIndex = Math.min(
      categoryOrder.length - 1,
      Math.max(0, currentIndex + offset),
    );
    const nextCategory = categoryOrder[nextIndex];
    if (nextCategory !== undefined) {
      selectCategory(nextCategory);
    }
  };

  const startY = introduction.height + layout.sectionGap;
  const renderContext: SetupRenderContext = {
    runtime,
    factory,
    config,
    layout,
    page,
    modeSelection,
    difficulty,
    origin,
    trait,
    city,
    slot,
    maximumPlayers,
    resolvedPlayerCounts,
    nameFields,
    categoryGroups,
    navigationLabels,
    previewTitles,
    previewDescriptions,
    selectionBindings,
    summaryLabels,
    selectCategory,
    moveCategory,
    refreshAll,
    prepareNameInput,
    onTextEntryFocusOut,
  };
  const rendered = layout.usesCompactUi
    ? renderMobileSetup(renderContext, startY)
    : renderDesktopSetup(renderContext, startY);
  summaryText = rendered.summaryText;
  mobileStepText = rendered.mobileStepText;
  optionScroll = rendered.optionScroll;
  page.addDisposable((): void => { rendered.optionScroll.destroy(); });
  page.scroll.setContentHeight(rendered.contentBottom + layout.sectionGap);
  refreshAll();
  if (layout.usesCompactUi) {
    page.scroll.revealNode(
      "player-name-1",
      layout.sectionGap,
      layout.isLandscape ? "start" : "nearest",
    );
  }
  return { page, readNames, readMode, readProfile, readSlotId, selectCategory };
}

/** 开局页渲染函数共享的状态和交互出口。 */
interface SetupRenderContext {
  readonly runtime: LayaRuntimeLike;
  readonly factory: UiFactory;
  readonly config: GameUiConfig;
  readonly layout: ResponsiveLayout;
  readonly page: PageScaffold;
  readonly modeSelection: SetupSelection<GameMode>;
  readonly difficulty: SetupSelection<string>;
  readonly origin: SetupSelection<string>;
  readonly trait: SetupSelection<string>;
  readonly city: SetupSelection<string>;
  readonly slot: SetupSelection<number> | null;
  readonly maximumPlayers: number;
  readonly resolvedPlayerCounts: Readonly<Record<string, number>>;
  readonly nameFields: NameFieldBinding[];
  readonly categoryGroups: Map<NewGameSetupCategoryTokenId, LayaSpriteLike>;
  readonly navigationLabels: Map<NewGameSetupCategoryTokenId, LayaTextLike>;
  readonly previewTitles: Map<NewGameSetupCategoryTokenId, LayaTextLike>;
  readonly previewDescriptions: Map<NewGameSetupCategoryTokenId, LayaTextLike>;
  readonly selectionBindings: Map<
    SummarySelectionCategory,
    readonly SelectionVisualBinding<SelectionId>[]
  >;
  readonly summaryLabels: Map<SummarySelectionCategory, LayaTextLike>;
  readonly selectCategory: (categoryId: NewGameSetupCategoryTokenId) => void;
  readonly moveCategory: (offset: number) => void;
  readonly refreshAll: () => void;
  readonly prepareNameInput: () => void;
  readonly onTextEntryFocusOut: () => void;
}

/** 开局页渲染完成后需交回的动态节点。 */
interface SetupRenderResult {
  readonly summaryText: LayaTextLike;
  readonly mobileStepText: LayaTextLike | null;
  readonly optionScroll: ScrollRegion;
  readonly contentBottom: number;
}

/** 渲染桌面高信息密度的分类导航、选项列表、详情与协议摘要。 */
function renderDesktopSetup(
  context: SetupRenderContext,
  startY: number,
): SetupRenderResult {
  const { config, page } = context;
  const tokens = config.new_game_setup.desktop;
  const navigationWidth = Math.min(tokens.navigation_width, page.contentWidth * 0.24);
  const listWidth = Math.min(tokens.option_list_width, page.contentWidth * 0.36);
  const previewWidth = Math.max(
    config.controls.minimum_touch_size,
    page.contentWidth - navigationWidth - listWidth - tokens.panel_gap * 2,
  );
  const navigation = context.factory.panel(page.content, {
    testId: "profile-setup-navigation",
    x: 0,
    y: startY,
    width: navigationWidth,
    height: tokens.content_height,
    elevated: true,
  });
  renderCategoryNavigation(context, navigation, navigationWidth, tokens.content_height);
  const optionLeft = navigationWidth + tokens.panel_gap;
  const optionPanel = context.factory.panel(page.content, {
    testId: "profile-setup-options",
    x: optionLeft,
    y: startY,
    width: listWidth,
    height: tokens.content_height,
    elevated: true,
  });
  const optionScroll = renderOptionGroups(
    context,
    optionPanel,
    listWidth,
    tokens.content_height,
    tokens.panel_padding,
    tokens.row_height,
  );
  const previewLeft = optionLeft + listWidth + tokens.panel_gap;
  const previewPanel = context.factory.panel(page.content, {
    testId: "profile-setup-preview",
    x: previewLeft,
    y: startY,
    width: previewWidth,
    height: tokens.content_height,
    elevated: true,
  });
  renderPreviewGroups(context, previewPanel, previewWidth, tokens.content_height, tokens.panel_padding);
  const summaryTop = startY + tokens.content_height + tokens.panel_gap;
  const summaryText = renderSetupSummary(
    context,
    page.content,
    0,
    summaryTop,
    page.contentWidth,
    tokens.summary_height,
    tokens.panel_padding,
    false,
  );
  return {
    summaryText,
    mobileStepText: null,
    optionScroll,
    contentBottom: summaryTop + tokens.summary_height,
  };
}

/** 渲染手机端的纵向分步流，每次聚焦一个建档阶段。 */
function renderMobileSetup(
  context: SetupRenderContext,
  startY: number,
): SetupRenderResult {
  const { config, page } = context;
  const tokens = config.new_game_setup.mobile;
  const stepPanel = context.factory.panel(page.content, {
    testId: "profile-setup-step-header",
    x: 0,
    y: startY,
    width: page.contentWidth,
    height: tokens.step_header_height,
    elevated: true,
  });
  const navigationButtonWidth = Math.max(
    config.controls.minimum_touch_size,
    (page.contentWidth - tokens.panel_padding * 2 - config.layout.page.option_gap) / 2,
  );
  const mobileStepText = context.factory.text(stepPanel, {
    testId: "profile-setup-step-counter",
    text: config.new_game_setup.copy.step_format,
    x: tokens.panel_padding,
    y: 0,
    width: page.contentWidth - tokens.panel_padding * 2,
    height: config.typography.body_line_height,
    fontSize: config.typography.caption_size,
    color: config.theme.accent,
    bold: true,
    align: "center",
    valign: "middle",
  });
  const stepButtonTop = config.typography.body_line_height;
  const stepButtonHeight = Math.max(
    config.controls.minimum_touch_size,
    tokens.step_header_height - stepButtonTop,
  );
  context.factory.button(stepPanel, {
    testId: "profile-setup-previous-step",
    label: config.new_game_setup.copy.previous_step,
    x: tokens.panel_padding,
    y: stepButtonTop,
    width: navigationButtonWidth,
    height: stepButtonHeight,
    tone: "muted",
    onClick: (): void => { context.moveCategory(-1); },
  });
  context.factory.button(stepPanel, {
    testId: "profile-setup-next-step",
    label: config.new_game_setup.copy.next_step,
    x: tokens.panel_padding + navigationButtonWidth + config.layout.page.option_gap,
    y: stepButtonTop,
    width: navigationButtonWidth,
    height: stepButtonHeight,
    tone: "primary",
    onClick: (): void => { context.moveCategory(1); },
  });
  const optionTop = startY + tokens.step_header_height + context.layout.sectionGap;
  const optionPanel = context.factory.panel(page.content, {
    testId: "profile-setup-options",
    x: 0,
    y: optionTop,
    width: page.contentWidth,
    height: tokens.option_area_height,
    elevated: true,
  });
  const optionScroll = renderOptionGroups(
    context,
    optionPanel,
    page.contentWidth,
    tokens.option_area_height,
    tokens.panel_padding,
    tokens.row_height,
  );
  const previewTop = optionTop + tokens.option_area_height + context.layout.sectionGap;
  const previewPanel = context.factory.panel(page.content, {
    testId: "profile-setup-preview",
    x: 0,
    y: previewTop,
    width: page.contentWidth,
    height: tokens.preview_height,
    elevated: true,
  });
  renderPreviewGroups(
    context,
    previewPanel,
    page.contentWidth,
    tokens.preview_height,
    tokens.panel_padding,
  );
  const summaryTop = previewTop + tokens.preview_height + context.layout.sectionGap;
  const summaryText = renderSetupSummary(
    context,
    page.content,
    0,
    summaryTop,
    page.contentWidth,
    tokens.summary_height,
    tokens.panel_padding,
    true,
  );
  return {
    summaryText,
    mobileStepText,
    optionScroll,
    contentBottom: summaryTop + tokens.summary_height,
  };
}

/** 渲染桌面左侧的全部分类导航。 */
function renderCategoryNavigation(
  context: SetupRenderContext,
  parent: LayaNodeLike,
  width: number,
  height: number,
): void {
  const { config, factory } = context;
  const padding = config.new_game_setup.desktop.panel_padding;
  factory.text(parent, {
    testId: "profile-setup-navigation-title",
    text: config.new_game_setup.copy.navigation_title,
    x: padding,
    y: padding,
    width: width - padding * 2,
    height: config.typography.body_line_height,
    fontSize: config.typography.caption_size,
    color: config.theme.muted_text,
    bold: true,
  });
  const buttonTop = padding + config.typography.body_line_height + config.layout.page.option_gap;
  const availableHeight = Math.max(0, height - buttonTop - padding);
  const rowHeight = availableHeight / config.new_game_setup.categories.length;
  config.new_game_setup.categories.forEach((category, index) => {
    const button = factory.button(parent, {
      testId: `profile-category-${category.id}`,
      label: category.label,
      x: padding,
      y: buttonTop + index * rowHeight,
      width: width - padding * 2,
      height: Math.max(1, rowHeight - config.controls.button_gap),
      tone: "muted",
      onClick: (): void => { context.selectCategory(category.id); },
    });
    context.navigationLabels.set(
      category.id,
      requireButtonLabel(button, `profile-category-${category.id}`),
    );
  });
}

/** 在中央列表面板中渲染所有分类组，切换时只改可见性。 */
function renderOptionGroups(
  context: SetupRenderContext,
  parent: LayaNodeLike,
  width: number,
  height: number,
  padding: number,
  rowHeight: number,
): ScrollRegion {
  const scroll = new ScrollRegion(
    context.runtime,
    parent,
    "profile-setup-options-scroll",
    padding,
    padding,
    width - padding * 2,
    height - padding * 2,
    context.config.controls.scroll_step,
    context.config.controls.drag_threshold,
  );
  const innerWidth = width - padding * 2;
  context.config.new_game_setup.categories.forEach((category) => {
    const group = context.factory.container(`profile-options-${category.id}`);
    group.size(innerWidth, height - padding * 2);
    scroll.content.addChild(group);
    context.categoryGroups.set(category.id, group);
    context.factory.text(group, {
      testId: `profile-options-${category.id}-title`,
      text: category.label,
      x: 0,
      y: 0,
      width: innerWidth,
      height: context.config.typography.body_line_height,
      fontSize: context.config.typography.section_title_size,
      color: context.config.theme.accent,
      bold: true,
    });
    if (category.id === "name") {
      renderNameFields(context, group, innerWidth, rowHeight);
    } else {
      renderSelectionGroup(context, group, category.id, innerWidth, rowHeight);
    }
  });
  return scroll;
}

/** 在当前姓名阶段中创建所有可能的玩家输入框。 */
function renderNameFields(
  context: SetupRenderContext,
  parent: LayaNodeLike,
  width: number,
  rowHeight: number,
): void {
  const { config, factory } = context;
  let cursorY = config.typography.body_line_height + config.layout.page.option_gap;
  for (let index = 0; index < context.maximumPlayers; index += 1) {
    const ordinal = index + 1;
    const fieldRoot = factory.container(`player-name-${String(ordinal)}-field`);
    fieldRoot.pos(0, cursorY);
    fieldRoot.size(width, resolveNameFieldHeight(config));
    parent.addChild(fieldRoot);
    const label = context.maximumPlayers === 1
      ? config.texts.profile_name_label
      : `${config.texts.profile_name_label} ${String(ordinal)}`;
    factory.text(fieldRoot, {
      testId: `player-name-${String(ordinal)}-heading`,
      text: label,
      x: 0,
      y: 0,
      width,
      height: config.typography.body_line_height,
      fontSize: config.typography.caption_size,
      color: config.theme.muted_text,
      valign: "middle",
    });
    const inputTop = config.typography.body_line_height + config.layout.page.option_gap;
    const input = factory.input(fieldRoot, {
      testId: `player-name-${String(ordinal)}`,
      prompt: config.texts.profile_name_label,
      x: 0,
      y: inputTop,
      width,
      height: config.controls.button_height,
      maxChars: config.controls.max_player_name_characters,
      type: config.new_game_setup.name_input.html_type,
    });
    input.text = resolvePresetName(config.new_game_setup.preset_names, index);
    input.on("focus", input, context.prepareNameInput);
    /** 姓名输入失焦时恢复画布并刷新摘要。 */
    const handleBlur = (): void => {
      context.onTextEntryFocusOut();
      context.refreshAll();
    };
    input.on("blur", input, handleBlur);
    let presetIndex = index % config.new_game_setup.preset_names.length;
    let presetLabel: LayaTextLike | null = null;
    /** 循环到下一个预设姓名，同时保留后续自由编辑能力。 */
    const handlePreset = (): void => {
      presetIndex = (presetIndex + 1) % config.new_game_setup.preset_names.length;
      input.text = resolvePresetName(config.new_game_setup.preset_names, presetIndex);
      if (presetLabel !== null) {
        presetLabel.text = formatTemplate(config.texts.profile_name_preset_format, {
          name: input.text,
        });
      }
      context.refreshAll();
    };
    const presetButton = factory.button(fieldRoot, {
      testId: `player-name-${String(ordinal)}-preset`,
      label: formatTemplate(config.texts.profile_name_preset_format, { name: input.text }),
      x: 0,
      y: inputTop + config.controls.button_height + config.layout.page.option_gap,
      width,
      height: config.controls.compact_button_height,
      tone: "muted",
      fontSize: config.typography.caption_size,
      wordWrap: false,
      onClick: handlePreset,
    });
    presetLabel = requireButtonLabel(presetButton, `player-name-${String(ordinal)}-preset`);
    context.nameFields.push({ root: fieldRoot, input });
    cursorY += Math.max(rowHeight, fieldRoot.height) + config.layout.page.option_gap;
  }
}

/** 根据分类读取选择模型，并渲染可直接点选的全量列表。 */
function renderSelectionGroup(
  context: SetupRenderContext,
  parent: LayaNodeLike,
  category: SummarySelectionCategory,
  width: number,
  rowHeight: number,
): void {
  const selection = resolveSelection(context, category);
  const options = selection?.options() ?? [];
  const bindings: SelectionVisualBinding<SelectionId>[] = [];
  const startY = context.config.typography.body_line_height + context.config.layout.page.option_gap;
  options.forEach((option, index) => {
    /** 选中中央列表项后保持当前分类，并同步详情和摘要。 */
    const handleSelect = (): void => {
      selection?.select(option.id);
      context.refreshAll();
    };
    const buttonHeight = Math.max(
      1,
      Math.min(context.config.controls.compact_button_height, rowHeight - context.config.controls.button_gap),
    );
    const button = context.factory.button(parent, {
      testId: `profile-${category}-option-${String(option.id)}`,
      label: option.label,
      x: 0,
      y: startY + index * rowHeight,
      width,
      height: buttonHeight,
      tone: "default",
      onClick: handleSelect,
    });
    const markWidth = Math.min(width * 0.3, context.config.controls.minimum_touch_size * 2);
    const mark = context.factory.text(button, {
      testId: `profile-${category}-option-${String(option.id)}-selected`,
      text: context.config.new_game_setup.copy.selected_mark,
      x: width - markWidth,
      y: 0,
      width: markWidth - context.config.controls.button_horizontal_padding,
      height: buttonHeight,
      fontSize: context.config.typography.caption_size,
      color: context.config.theme.accent,
      bold: true,
      align: "right",
      valign: "middle",
      wordWrap: false,
    });
    bindings.push({
      id: option.id,
      label: requireButtonLabel(button, `profile-${category}-option-${String(option.id)}`),
      mark,
    });
  });
  context.selectionBindings.set(category, bindings);
  if (selection === null) {
    context.factory.autoText(parent, {
      testId: `profile-${category}-unavailable`,
      text: category === "slot"
        ? context.config.texts.no_save
        : context.config.new_game_setup.copy.unavailable_mode,
      x: 0,
      y: startY,
      width,
      fontSize: context.config.typography.body_size,
      color: context.config.theme.muted_text,
    });
  }
}

/** 为每个开局分类创建独立的右侧详情预览。 */
function renderPreviewGroups(
  context: SetupRenderContext,
  parent: LayaNodeLike,
  width: number,
  height: number,
  padding: number,
): void {
  context.config.new_game_setup.categories.forEach((category) => {
    const group = context.factory.container(`profile-preview-${category.id}`);
    group.size(width, height);
    parent.addChild(group);
    const title = context.factory.text(group, {
      testId: `profile-${category.id}-preview-title`,
      text: category.label,
      x: padding,
      y: padding,
      width: width - padding * 2,
      height: context.config.typography.section_title_size + context.config.controls.button_gap,
      fontSize: context.config.typography.section_title_size,
      color: context.config.theme.accent,
      bold: true,
    });
    const descriptionTop = padding + title.height + context.config.layout.page.option_gap;
    const description = context.factory.text(group, {
      testId: `profile-${category.id}-description`,
      text: category.description,
      x: padding,
      y: descriptionTop,
      width: width - padding * 2,
      height: Math.max(context.config.typography.body_line_height, height - descriptionTop - padding),
      fontSize: context.config.typography.body_size,
      color: context.config.theme.muted_text,
    });
    context.previewTitles.set(category.id, title);
    context.previewDescriptions.set(category.id, description);
  });
}

/** 渲染底部确认摘要，快速选择按钮保持原有稳定测试 ID。 */
function renderSetupSummary(
  context: SetupRenderContext,
  parent: LayaNodeLike,
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number,
  mobile: boolean,
): LayaTextLike {
  const panel = context.factory.panel(parent, {
    testId: "profile-setup-summary",
    x,
    y,
    width,
    height,
    active: true,
  });
  context.factory.text(panel, {
    testId: "profile-setup-summary-title",
    text: context.config.new_game_setup.copy.summary_title,
    x: padding,
    y: padding,
    width: width - padding * 2,
    height: context.config.typography.body_line_height,
    fontSize: context.config.typography.caption_size,
    color: context.config.theme.accent,
    bold: true,
  });
  const bodyTop = padding + context.config.typography.body_line_height;
  const summaryWidth = mobile ? width - padding * 2 : width * 0.38;
  const summaryText = context.factory.text(panel, {
    testId: "profile-setup-summary-text",
    text: " ",
    x: padding,
    y: bodyTop,
    width: summaryWidth,
    height: Math.max(context.config.typography.body_line_height, height - bodyTop - padding),
    fontSize: context.config.typography.caption_size,
    color: context.config.theme.muted_text,
  });
  const gridTop = mobile
    ? bodyTop + Math.max(context.config.typography.body_line_height * 7, height * 0.36)
    : bodyTop;
  const gridLeft = mobile ? padding : padding + summaryWidth + context.config.layout.page.option_gap;
  const gridWidth = width - gridLeft - padding;
  const columns = mobile ? 2 : 3;
  const gap = context.config.layout.page.option_gap;
  const buttonWidth = Math.max(1, (gridWidth - gap * (columns - 1)) / columns);
  const categories: readonly SummarySelectionCategory[] = [
    "mode",
    "difficulty",
    "origin",
    "trait",
    "city",
    "slot",
  ];
  const availableGridHeight = Math.max(1, height - gridTop - padding);
  const rows = Math.ceil(categories.length / columns);
  const buttonHeight = Math.max(1, (availableGridHeight - gap * (rows - 1)) / rows);
  categories.forEach((category, index) => {
    const selection = resolveSelection(context, category);
    const column = index % columns;
    const row = Math.floor(index / columns);
    /** 底部摘要按钮循环选项，並同时聚焦对应分类。 */
    const handleAdvance = (): void => {
      if (selection === null) {
        return;
      }
      selection.advance();
      context.selectCategory(category);
    };
    const button = context.factory.button(panel, {
      testId: `profile-${category}`,
      label: selection?.current().label ?? context.config.texts.no_save,
      x: gridLeft + column * (buttonWidth + gap),
      y: gridTop + row * (buttonHeight + gap),
      width: buttonWidth,
      height: buttonHeight,
      tone: category === "mode" ? "primary" : "default",
      disabled: selection === null,
      fontSize: context.config.typography.caption_size,
      onClick: handleAdvance,
    });
    context.summaryLabels.set(category, requireButtonLabel(button, `profile-${category}`));
  });
  return summaryText;
}

/** 创建严格验证默认值的可直接选中与循环选择模型。 */
function createSelection<TId extends SelectionId>(
  options: readonly SetupOption<TId>[],
  initialId: TId,
  fieldLabel: string,
): SetupSelection<TId> {
  if (options.length === 0) {
    throw new Error(`${fieldLabel}没有可用选项。`);
  }
  let currentIndex = options.findIndex((option) => option.id === initialId);
  if (currentIndex < 0) {
    throw new Error(`${fieldLabel}的默认选项不存在：${String(initialId)}`);
  }
  /** 读取已校验索引指向的当前选项。 */
  const current = (): SetupOption<TId> => {
    const option = options[currentIndex];
    if (option === undefined) {
      throw new Error(`${fieldLabel}没有可用选项。`);
    }
    return option;
  };
  /** 根据稳定 ID 切换选项。 */
  const select = (id: TId): SetupOption<TId> => {
    const nextIndex = options.findIndex((option) => option.id === id);
    if (nextIndex < 0) {
      throw new Error(`${fieldLabel}选项不存在：${String(id)}`);
    }
    currentIndex = nextIndex;
    return current();
  };
  /** 前进一项，到达末尾后回到第一项。 */
  const advance = (): SetupOption<TId> => {
    currentIndex = (currentIndex + 1) % options.length;
    return current();
  };
  /** 返回只读选项集合供列表渲染。 */
  const readOptions = (): readonly SetupOption<TId>[] => options;
  return { current, select, advance, options: readOptions };
}

/** 从 H5 配置构建真正可选的游戏模式，包括无尽模式。 */
function createModeSelection(
  config: GameUiConfig,
  initialMode: GameMode,
): SetupSelection<GameMode> {
  const options = config.new_game_setup.mode_options.map((option) => ({
    id: option.id as GameMode,
    label: option.label,
    description: option.description,
  }));
  return createSelection(options, initialMode, config.texts.profile_mode_label);
}

/** 将领域开局选项转换为页面选择模型。 */
function createCampaignSelection(
  options: readonly UiCampaignOptionView[],
  defaultId: string,
  fieldLabel: string,
): SetupSelection<string> {
  return createSelection(options, defaultId, fieldLabel);
}

/** 从六个栏位中构建仅包含可写项的选择模型。 */
function createSlotSelection(
  saveSlots: readonly UiSaveSlotView[],
  config: GameUiConfig,
): SetupSelection<number> | null {
  const available = saveSlots
    .filter((slot) => slot.writable)
    .map((slot) => ({
      id: slot.slotId,
      label: slot.title,
      description: slot.details,
    }));
  const first = available[0];
  return first === undefined
    ? null
    : createSelection(available, first.id, config.texts.profile_slot_label);
}

/** 将旧的固定玩家数或新的模式映射统一为已校验字典。 */
function resolvePlayerCounts(
  source: NewGamePlayerCountSource,
  modeIds: readonly string[],
  initialMode: GameMode,
): Readonly<Record<string, number>> {
  const resolved: Record<string, number> = {};
  if (typeof source === "number") {
    validatePlayerCount(source, initialMode);
    modeIds.forEach((modeId) => { resolved[modeId] = source; });
    return resolved;
  }
  modeIds.forEach((modeId) => {
    const count = source[modeId] ?? 0;
    if (count > 0) {
      validatePlayerCount(count, modeId);
      resolved[modeId] = count;
    }
  });
  if ((resolved[initialMode] ?? 0) <= 0) {
    throw new Error(`初始模式 ${initialMode} 没有正整数玩家配置。`);
  }
  return resolved;
}

/** 拒绝无法生成稳定姓名输入框的玩家数。 */
function validatePlayerCount(count: number, modeId: string): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`${modeId}的玩家输入框数量必须是正整数。`);
  }
}

/** 读取当前模式玩家数，缺失时保留单人降级路径。 */
function resolveActivePlayerCount(
  counts: Readonly<Record<string, number>>,
  mode: GameMode,
): number {
  return counts[mode] ?? 1;
}

/** 从非空预设名列表中按玩家序号循环取值。 */
function resolvePresetName(presetNames: readonly string[], index: number): string {
  if (presetNames.length === 0) {
    throw new Error("预设姓名配置不能为空。");
  }
  const value = presetNames[index % presetNames.length];
  if (value === undefined) {
    throw new Error("预设姓名索引越界。");
  }
  return value;
}

/** 计算单个姓名字段的配置化总高度。 */
function resolveNameFieldHeight(config: GameUiConfig): number {
  return config.typography.body_line_height
    + config.layout.page.option_gap * 2
    + config.controls.button_height
    + config.controls.compact_button_height;
}

/** 根据分类返回对应选择模型。 */
function resolveSelection(
  context: SetupRenderContext,
  category: SummarySelectionCategory,
): SetupSelection<SelectionId> | null {
  switch (category) {
    case "mode":
      return context.modeSelection;
    case "difficulty":
      return context.difficulty;
    case "origin":
      return context.origin;
    case "trait":
      return context.trait;
    case "city":
      return context.city;
    case "slot":
      return context.slot;
  }
}

/** 根据选项数量或玩家数返回当前分类的滚动内容高度。 */
function resolveCategoryContentHeight(
  category: NewGameSetupCategoryTokenId,
  mode: SetupSelection<GameMode>,
  difficulty: SetupSelection<string>,
  origin: SetupSelection<string>,
  trait: SetupSelection<string>,
  city: SetupSelection<string>,
  slot: SetupSelection<number> | null,
  maximumPlayers: number,
  config: GameUiConfig,
  layout: ResponsiveLayout,
): number {
  const headingHeight = config.typography.body_line_height + config.layout.page.option_gap;
  if (category === "name") {
    return headingHeight
      + maximumPlayers * (resolveNameFieldHeight(config) + config.layout.page.option_gap);
  }
  const selection = category === "mode"
    ? mode
    : category === "difficulty"
      ? difficulty
      : category === "origin"
        ? origin
        : category === "trait"
          ? trait
          : category === "city"
            ? city
            : slot;
  const rowHeight = layout.usesCompactUi
    ? config.new_game_setup.mobile.row_height
    : config.new_game_setup.desktop.row_height;
  return headingHeight + Math.max(1, selection?.options().length ?? 1) * rowHeight;
}

/** 只显示当前分类的中央选项组。 */
function refreshCategoryVisibility(
  groups: ReadonlyMap<NewGameSetupCategoryTokenId, LayaSpriteLike>,
  activeCategory: NewGameSetupCategoryTokenId,
): void {
  groups.forEach((group, category) => { group.visible = category === activeCategory; });
}

/** 使当前分类导航文字使用强调色。 */
function refreshNavigationLabels(
  labels: ReadonlyMap<NewGameSetupCategoryTokenId, LayaTextLike>,
  activeCategory: NewGameSetupCategoryTokenId,
  config: GameUiConfig,
): void {
  labels.forEach((label, category) => {
    label.color = category === activeCategory ? config.theme.accent : config.theme.muted_text;
  });
}

/** 只显示当前分类的详情预览。 */
function refreshPreviewVisibility(
  titles: ReadonlyMap<NewGameSetupCategoryTokenId, LayaTextLike>,
  descriptions: ReadonlyMap<NewGameSetupCategoryTokenId, LayaTextLike>,
  activeCategory: NewGameSetupCategoryTokenId,
): void {
  titles.forEach((title, category) => {
    if (title.parent !== null) {
      title.parent.visible = category === activeCategory;
    }
  });
  descriptions.forEach((description, category) => {
    if (description.parent !== null) {
      description.parent.visible = category === activeCategory;
    }
  });
}

/** 根据当前选项同步列表文字和“已选”标记。 */
function refreshSelectionBindings<TId extends SelectionId>(
  category: SummarySelectionCategory,
  selection: SetupSelection<TId> | null,
  bindings: ReadonlyMap<
    SummarySelectionCategory,
    readonly SelectionVisualBinding<SelectionId>[]
  >,
  config: GameUiConfig,
): void {
  const selectedId = selection?.current().id;
  bindings.get(category)?.forEach((binding) => {
    const selected = binding.id === selectedId;
    binding.mark.visible = selected;
    binding.label.color = selected ? config.theme.accent : config.theme.text;
  });
}

/** 用当前选项文案刷新右侧详情。 */
function refreshPreviewText(
  config: GameUiConfig,
  category: NewGameSetupCategoryTokenId,
  names: readonly string[],
  mode: SetupSelection<GameMode>,
  difficulty: SetupSelection<string>,
  origin: SetupSelection<string>,
  trait: SetupSelection<string>,
  city: SetupSelection<string>,
  slot: SetupSelection<number> | null,
  titles: ReadonlyMap<NewGameSetupCategoryTokenId, LayaTextLike>,
  descriptions: ReadonlyMap<NewGameSetupCategoryTokenId, LayaTextLike>,
): void {
  const title = titles.get(category);
  const description = descriptions.get(category);
  if (title === undefined || description === undefined) {
    return;
  }
  if (category === "name") {
    title.text = names.filter((name) => name.length > 0).join(config.texts.save_slot_name_separator)
      || config.texts.profile_name_label;
    description.text = config.new_game_setup.copy.name_description;
    return;
  }
  const selection = category === "mode"
    ? mode
    : category === "difficulty"
      ? difficulty
      : category === "origin"
        ? origin
        : category === "trait"
          ? trait
          : category === "city"
            ? city
            : slot;
  const selected = selection?.current();
  title.text = selected?.label ?? config.texts.no_save;
  description.text = selected?.description ?? config.texts.no_save;
}

/** 同步底部六个快速选择按钮的标签。 */
function refreshSummaryLabels(
  config: GameUiConfig,
  labels: ReadonlyMap<SummarySelectionCategory, LayaTextLike>,
  mode: SetupSelection<GameMode>,
  difficulty: SetupSelection<string>,
  origin: SetupSelection<string>,
  trait: SetupSelection<string>,
  city: SetupSelection<string>,
  slot: SetupSelection<number> | null,
): void {
  const values: Readonly<Record<SummarySelectionCategory, string>> = {
    mode: mode.current().label,
    difficulty: difficulty.current().label,
    origin: origin.current().label,
    trait: trait.current().label,
    city: city.current().label,
    slot: slot?.current().label ?? config.texts.no_save,
  };
  labels.forEach((label, category) => { label.text = values[category]; });
}

/** 让姓名字段数量跟随当前模式，多余输入不会被提交。 */
function refreshNameFieldVisibility(
  fields: readonly NameFieldBinding[],
  activeCount: number,
): void {
  fields.forEach((field, index) => { field.root.visible = index < activeCount; });
}

/** 将当前所有开局选择格式化为底部确认摘要。 */
export function buildSetupSummary(
  config: GameUiConfig,
  names: readonly string[],
  mode: SetupOption<SelectionId>,
  difficulty: SetupOption<SelectionId>,
  origin: SetupOption<SelectionId>,
  trait: SetupOption<SelectionId>,
  city: SetupOption<SelectionId>,
  slot: SetupOption<SelectionId> | null,
): string {
  return formatTemplate(config.new_game_setup.copy.summary_format, {
    names: names.filter((name) => name.length > 0).join(config.texts.save_slot_name_separator),
    mode: mode.label,
    difficulty: difficulty.label,
    origin: origin.label,
    trait: trait.label,
    city: city.label,
    slot: slot?.label ?? config.texts.no_save,
  });
}

/** 从 UiFactory 按钮中取得稳定命名的文本节点。 */
function requireButtonLabel(button: LayaNodeLike, testId: string): LayaTextLike {
  const label = button.getChildByName?.(`${testId}-label`);
  if (label === null || label === undefined) {
    throw new Error(`按钮 ${testId} 缺少标签节点。`);
  }
  return label as LayaTextLike;
}
