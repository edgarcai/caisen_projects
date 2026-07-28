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
  readonly incompatibleIds?: readonly string[];
  readonly parentId?: string;
}

/** 可被中央列表与底部摘要共享的选择状态。 */
interface SetupSelection<TId extends SelectionId> {
  current(): SetupOption<TId>;
  select(id: TId): SetupOption<TId>;
  advance(): SetupOption<TId>;
  options(): readonly SetupOption<TId>[];
  canSelect(id: TId): boolean;
  hideUnavailable(): boolean;
  visibleOptionCount(): number;
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
  readonly button: LayaSpriteLike;
  readonly label: LayaTextLike;
  readonly mark: LayaTextLike;
  readonly startY: number;
  readonly rowHeight: number;
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
  const traits = createCompatibleTraitSelections(
    profileOptions.traits,
    profileOptions.defaultSelection.traitId,
    profileOptions.defaultSelection.secondaryTraitId,
    config.texts.profile_trait_label,
    config.texts.profile_secondary_trait_label,
  );
  const trait = traits.primary;
  const secondaryTrait = traits.secondary;
  const city = createCampaignSelection(
    profileOptions.cities,
    profileOptions.defaultSelection.homeCityId,
    config.texts.profile_city_label,
  );
  const district = createDistrictSelection(
    profileOptions.districts,
    profileOptions.defaultSelection.homeDistrictId,
    (): string => city.current().id,
    config.texts.profile_district_label,
  );
  const shelter = createCampaignSelection(
    profileOptions.shelterTypes,
    profileOptions.defaultSelection.shelterTypeId,
    config.texts.profile_shelter_type_label,
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
    secondaryTraitId: secondaryTrait.current().id,
    homeCityId: city.current().id,
    homeDistrictId: district.current().id,
    shelterTypeId: shelter.current().id,
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
    refreshSelectionBindings("secondary_trait", secondaryTrait, selectionBindings, config);
    refreshSelectionBindings("city", city, selectionBindings, config);
    refreshSelectionBindings("district", district, selectionBindings, config);
    refreshSelectionBindings("shelter", shelter, selectionBindings, config);
    refreshSelectionBindings("slot", slot, selectionBindings, config);
    refreshPreviewText(
      config,
      activeCategory,
      readNames(),
      modeSelection,
      difficulty,
      origin,
      trait,
      secondaryTrait,
      city,
      district,
      shelter,
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
      secondaryTrait,
      city,
      district,
      shelter,
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
        secondaryTrait.current(),
        city.current(),
        district.current(),
        shelter.current(),
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
      secondaryTrait,
      city,
      district,
      shelter,
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
    secondaryTrait,
    city,
    district,
    shelter,
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
  readonly secondaryTrait: SetupSelection<string>;
  readonly city: SetupSelection<string>;
  readonly district: SetupSelection<string>;
  readonly shelter: SetupSelection<string>;
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
    tone: tokens.step_navigation_tone,
    accentOnPress: tokens.step_navigation_accent_on_press,
    onClick: (): void => { context.moveCategory(-1); },
  });
  context.factory.button(stepPanel, {
    testId: "profile-setup-next-step",
    label: config.new_game_setup.copy.next_step,
    x: tokens.panel_padding + navigationButtonWidth + config.layout.page.option_gap,
    y: stepButtonTop,
    width: navigationButtonWidth,
    height: stepButtonHeight,
    tone: tokens.step_navigation_tone,
    accentOnPress: tokens.step_navigation_accent_on_press,
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
      if (selection?.canSelect(option.id) !== true) return;
      selection.select(option.id);
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
      button,
      label: requireButtonLabel(button, `profile-${category}-option-${String(option.id)}`),
      mark,
      startY,
      rowHeight,
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
    ? bodyTop + Math.max(context.config.typography.body_line_height * 9, height * 0.4)
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
    "secondary_trait",
    "city",
    "district",
    "shelter",
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
  /** 普通单选列表中的所有已配置项均可选。 */
  const canSelect = (id: TId): boolean => options.some((option) => option.id === id);
  /** 普通单选项不隐藏任何已配置项。 */
  const hideUnavailable = (): boolean => false;
  /** 普通单选列表的可见数量等于完整选项数。 */
  const visibleOptionCount = (): number => options.length;
  return {
    current,
    select,
    advance,
    options: readOptions,
    canSelect,
    hideUnavailable,
    visibleOptionCount,
  };
}

/** 为特性一和特性二创建共享互斥约束的两个单选模型。 */
function createCompatibleTraitSelections(
  options: readonly UiCampaignOptionView[],
  primaryId: string,
  secondaryId: string,
  primaryLabel: string,
  secondaryLabel: string,
): {
  readonly primary: SetupSelection<string>;
  readonly secondary: SetupSelection<string>;
} {
  if (options.length < 2) throw new Error("双特性至少需要两个可用选项。");
  let primaryIndex = requireSelectionIndex(options, primaryId, primaryLabel);
  let secondaryIndex = requireSelectionIndex(options, secondaryId, secondaryLabel);

  /** 读取经过边界校验的指定特性。 */
  const optionAt = (index: number, fieldLabel: string): SetupOption<string> => {
    const option = options[index];
    if (option === undefined) throw new Error(`${fieldLabel}没有可用选项。`);
    return option;
  };
  /** 判断候选特性与另一特性是否不重复且双向兼容。 */
  const compatibleWith = (candidateId: string, otherId: string): boolean => {
    const candidate = options.find((option) => option.id === candidateId);
    const other = options.find((option) => option.id === otherId);
    return candidate !== undefined
      && other !== undefined
      && candidate.id !== other.id
      && !(candidate.incompatibleIds ?? []).includes(other.id)
      && !(other.incompatibleIds ?? []).includes(candidate.id);
  };
  if (!compatibleWith(primaryId, secondaryId)) {
    throw new Error("默认特性一与特性二重复或互斥。");
  }

  /** 构建一个可感知另一槽位当前值的特性选择器。 */
  const createSlot = (
    fieldLabel: string,
    currentIndex: () => number,
    updateIndex: (index: number) => void,
    otherIndex: () => number,
  ): SetupSelection<string> => {
    /** 读取当前特性。 */
    const current = (): SetupOption<string> => optionAt(currentIndex(), fieldLabel);
    /** 判断稳定 ID 是否能放入当前特性槽位。 */
    const canSelect = (id: string): boolean => compatibleWith(
      id,
      optionAt(otherIndex(), fieldLabel).id,
    );
    /** 选择一个与另一槽位兼容的特性。 */
    const select = (id: string): SetupOption<string> => {
      const nextIndex = options.findIndex((option) => option.id === id);
      if (nextIndex < 0) throw new Error(`${fieldLabel}选项不存在：${id}`);
      if (!canSelect(id)) throw new Error(`${fieldLabel}与另一特性重复或互斥。`);
      updateIndex(nextIndex);
      return current();
    };
    /** 循环到下一个与另一槽位兼容的特性。 */
    const advance = (): SetupOption<string> => {
      for (let offset = 1; offset <= options.length; offset += 1) {
        const index = (currentIndex() + offset) % options.length;
        const candidate = optionAt(index, fieldLabel);
        if (canSelect(candidate.id)) {
          updateIndex(index);
          return current();
        }
      }
      throw new Error(`${fieldLabel}没有可与另一特性搭配的选项。`);
    };
    /** 特性页保留互斥项作为灰色说明，不从列表隐藏。 */
    const hideUnavailable = (): boolean => false;
    /** 特性页始终展示完整目录。 */
    const visibleOptionCount = (): number => options.length;
    /** 返回完整特性目录供页面绘制。 */
    const readOptions = (): readonly SetupOption<string>[] => options;
    return {
      current,
      select,
      advance,
      options: readOptions,
      canSelect,
      hideUnavailable,
      visibleOptionCount,
    };
  };

  return {
    primary: createSlot(
      primaryLabel,
      (): number => primaryIndex,
      (index): void => { primaryIndex = index; },
      (): number => secondaryIndex,
    ),
    secondary: createSlot(
      secondaryLabel,
      (): number => secondaryIndex,
      (index): void => { secondaryIndex = index; },
      (): number => primaryIndex,
    ),
  };
}

/** 为城市联动区划创建选择器，只展示当前城市下的区划。 */
function createDistrictSelection(
  options: UiCampaignProfileOptionsView["districts"],
  initialId: string,
  currentCityId: () => string,
  fieldLabel: string,
): SetupSelection<string> {
  let selectedId = initialId;
  if (!options.some((option) => option.id === initialId)) {
    throw new Error(`${fieldLabel}的默认选项不存在：${initialId}`);
  }
  /** 读取当前城市的全部区划。 */
  const cityOptions = (): readonly SetupOption<string>[] => options
    .filter((option) => option.cityId === currentCityId())
    .map((option) => ({ ...option, parentId: option.cityId }));
  /** 城市变更后将失效区划自动对齐为该市第一个配置项。 */
  const current = (): SetupOption<string> => {
    const candidates = cityOptions();
    const selected = candidates.find((option) => option.id === selectedId);
    const resolved = selected ?? candidates[0];
    if (resolved === undefined) throw new Error(`${fieldLabel}在当前城市下没有可用选项。`);
    selectedId = resolved.id;
    return resolved;
  };
  /** 判断区划是否属于当前城市。 */
  const canSelect = (id: string): boolean => cityOptions().some((option) => option.id === id);
  /** 选择当前城市下的一个区划。 */
  const select = (id: string): SetupOption<string> => {
    if (!canSelect(id)) throw new Error(`${fieldLabel}不属于当前城市：${id}`);
    selectedId = id;
    return current();
  };
  /** 在当前城市的区划中循环到下一项。 */
  const advance = (): SetupOption<string> => {
    const candidates = cityOptions();
    const currentIndex = candidates.findIndex((option) => option.id === current().id);
    const next = candidates[(currentIndex + 1) % candidates.length];
    if (next === undefined) throw new Error(`${fieldLabel}在当前城市下没有可用选项。`);
    selectedId = next.id;
    return next;
  };
  /** 返回全部区划供一次性建立显示节点。 */
  const readOptions = (): readonly SetupOption<string>[] => options.map((option) => ({
    ...option,
    parentId: option.cityId,
  }));
  /** 非当前城市区划应从列表隐藏，而非显示为互斥项。 */
  const hideUnavailable = (): boolean => true;
  /** 可见数量始终与当前城市区划数一致。 */
  const visibleOptionCount = (): number => cityOptions().length;
  return {
    current,
    select,
    advance,
    options: readOptions,
    canSelect,
    hideUnavailable,
    visibleOptionCount,
  };
}

/** 读取默认选项索引，并在配置引用未知 ID 时立即失败。 */
function requireSelectionIndex(
  options: readonly SetupOption<string>[],
  id: string,
  fieldLabel: string,
): number {
  const index = options.findIndex((option) => option.id === id);
  if (index < 0) throw new Error(`${fieldLabel}的默认选项不存在：${id}`);
  return index;
}

/** 按入口白名单排序模式，并为独立剧情或多人入口补入当前模式。 */
export function resolveEntryModeOptions(
  config: GameUiConfig,
  initialMode: GameMode,
): readonly SetupOption<GameMode>[] {
  const orderedModeIds: GameMode[] = [...config.new_game_setup.entry_mode_ids];
  if (!orderedModeIds.includes(initialMode)) {
    orderedModeIds.push(initialMode);
  }
  const optionById = new Map<GameMode, SetupOption<GameMode>>(
    config.new_game_setup.mode_options.map((option) => [
      option.id,
      {
        id: option.id,
        label: option.label,
        description: option.description,
      },
    ]),
  );
  return orderedModeIds.map((modeId) => {
    const option = optionById.get(modeId);
    if (option === undefined) {
      throw new Error(`开局模式入口缺少配置：${modeId}`);
    }
    return option;
  });
}

/** 从 H5 配置构建当前入口真正可选的游戏模式。 */
function createModeSelection(
  config: GameUiConfig,
  initialMode: GameMode,
): SetupSelection<GameMode> {
  const options = resolveEntryModeOptions(config, initialMode);
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
    case "secondary_trait":
      return context.secondaryTrait;
    case "city":
      return context.city;
    case "district":
      return context.district;
    case "shelter":
      return context.shelter;
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
  secondaryTrait: SetupSelection<string>,
  city: SetupSelection<string>,
  district: SetupSelection<string>,
  shelter: SetupSelection<string>,
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
          : category === "secondary_trait"
            ? secondaryTrait
            : category === "city"
              ? city
              : category === "district"
                ? district
                : category === "shelter"
                  ? shelter
                  : slot;
  const rowHeight = layout.usesCompactUi
    ? config.new_game_setup.mobile.row_height
    : config.new_game_setup.desktop.row_height;
  return headingHeight + Math.max(1, selection?.visibleOptionCount() ?? 1) * rowHeight;
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
  let visibleIndex = 0;
  bindings.get(category)?.forEach((binding) => {
    const selected = binding.id === selectedId;
    const available = selection?.canSelect(binding.id as TId) ?? false;
    const hidden = selection?.hideUnavailable() === true && !available;
    binding.button.visible = !hidden;
    binding.button.mouseEnabled = available;
    if (!hidden) {
      binding.button.y = binding.startY + visibleIndex * binding.rowHeight;
      visibleIndex += 1;
    }
    binding.mark.visible = selected || (!available && !hidden);
    binding.mark.text = selected
      ? config.new_game_setup.copy.selected_mark
      : config.new_game_setup.copy.incompatible_mark;
    binding.label.color = selected
      ? config.theme.accent
      : available ? config.theme.text : config.theme.muted_text;
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
  secondaryTrait: SetupSelection<string>,
  city: SetupSelection<string>,
  district: SetupSelection<string>,
  shelter: SetupSelection<string>,
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
          : category === "secondary_trait"
            ? secondaryTrait
            : category === "city"
              ? city
              : category === "district"
                ? district
                : category === "shelter"
                  ? shelter
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
  secondaryTrait: SetupSelection<string>,
  city: SetupSelection<string>,
  district: SetupSelection<string>,
  shelter: SetupSelection<string>,
  slot: SetupSelection<number> | null,
): void {
  const values: Readonly<Record<SummarySelectionCategory, string>> = {
    mode: mode.current().label,
    difficulty: difficulty.current().label,
    origin: origin.current().label,
    trait: trait.current().label,
    secondary_trait: secondaryTrait.current().label,
    city: city.current().label,
    district: district.current().label,
    shelter: shelter.current().label,
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
  secondaryTrait: SetupOption<SelectionId>,
  city: SetupOption<SelectionId>,
  district: SetupOption<SelectionId>,
  shelter: SetupOption<SelectionId>,
  slot: SetupOption<SelectionId> | null,
): string {
  return formatTemplate(config.new_game_setup.copy.summary_format, {
    names: names.filter((name) => name.length > 0).join(config.texts.save_slot_name_separator),
    mode: mode.label,
    difficulty: difficulty.label,
    origin: origin.label,
    trait: trait.label,
    secondary_trait: secondaryTrait.label,
    city: city.label,
    district: district.label,
    shelter: shelter.label,
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
