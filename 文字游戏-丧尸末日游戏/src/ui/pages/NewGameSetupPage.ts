import { formatTemplate } from "../../domain/content";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaInputLike,
  LayaNodeLike,
  LayaRuntimeLike,
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

/** 循环选择器支持的稳定标识类型。 */
type SelectionId = string | number;

/** 单按钮循环选择器使用的统一选项结构。 */
interface CyclingOption<TId extends SelectionId> {
  readonly id: TId;
  readonly label: string;
  readonly description: string;
}

/** 与渲染层解耦的循环选择状态。 */
interface CyclingSelection<TId extends SelectionId> {
  current(): CyclingOption<TId>;
  advance(): CyclingOption<TId>;
  options(): readonly CyclingOption<TId>[];
}

/** 可以参与响应式网格排版的开局字段。 */
interface SetupField {
  readonly height: number;
  render(x: number, y: number): void;
}

/** 新游戏配置页以及读取当前表单状态的能力。 */
export interface NewGameSetupPageView {
  readonly page: PageScaffold;
  readNames(): readonly string[];
  readProfile(): UiCampaignProfileSelection;
  readSlotId(): number | null;
}

/** 创建包含姓名、开局档案和存档栏位的响应式新游戏配置页。 */
export function createNewGameSetupPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  mode: GameMode,
  playerCount: number,
  profileOptions: UiCampaignProfileOptionsView,
  saveSlots: readonly UiSaveSlotView[],
  onBack: () => void,
  onSubmit: (
    names: readonly string[],
    profile: UiCampaignProfileSelection,
    slotId: number,
  ) => void,
  prepareNameInput: () => void,
  onTextEntryFocusOut: () => void,
): NewGameSetupPageView {
  validatePlayerCount(playerCount);
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
  const modeSelection = createCyclingSelection(
    [resolveModeOption(config, mode)],
    mode,
    config.texts.profile_mode_label,
  );
  const slotSelection = createSlotSelection(saveSlots, config);
  const inputs: LayaInputLike[] = [];

  /** 读取并去除全部所长姓名首尾空白。 */
  const readNames = (): readonly string[] =>
    inputs.map((input) => input.text.trim());

  /** 读取当前独立开局档案，不把姓名或模式混入领域选项。 */
  const readProfile = (): UiCampaignProfileSelection => ({
    difficultyId: difficulty.current().id,
    originId: origin.current().id,
    traitId: trait.current().id,
    homeCityId: city.current().id,
  });

  /** 读取当前可用存档栏位；无可用栏位时返回空值。 */
  const readSlotId = (): number | null => slotSelection?.current().id ?? null;

  /** 仅在存在可写栏位时把当前完整表单提交给上层。 */
  const handleSubmit = (): void => {
    const slotId = readSlotId();
    if (slotId === null) {
      return;
    }
    onSubmit(readNames(), readProfile(), slotId);
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
        disabled: slotSelection === null,
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
    fontSize: config.typography.body_size,
    color: config.theme.muted_text,
  });
  const columns = resolveSetupColumns(layout, page.contentWidth, config);
  const columnGap = config.layout.page.option_gap;
  const fieldWidth =
    (page.contentWidth - columnGap * (columns - 1)) / columns;
  const fields: SetupField[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    fields.push(createNameField(
      factory,
      config,
      page.content,
      fieldWidth,
      index,
      playerCount,
      inputs,
      prepareNameInput,
      onTextEntryFocusOut,
    ));
  }
  fields.push(
    createChoiceField(
      factory,
      config,
      page.content,
      fieldWidth,
      "profile-mode",
      config.texts.profile_mode_label,
      modeSelection,
      config.texts.no_save,
    ),
    createChoiceField(
      factory,
      config,
      page.content,
      fieldWidth,
      "profile-difficulty",
      config.texts.profile_difficulty_label,
      difficulty,
      config.texts.no_save,
    ),
    createChoiceField(
      factory,
      config,
      page.content,
      fieldWidth,
      "profile-origin",
      config.texts.profile_origin_label,
      origin,
      config.texts.no_save,
    ),
    createChoiceField(
      factory,
      config,
      page.content,
      fieldWidth,
      "profile-trait",
      config.texts.profile_trait_label,
      trait,
      config.texts.no_save,
    ),
    createChoiceField(
      factory,
      config,
      page.content,
      fieldWidth,
      "profile-city",
      config.texts.profile_city_label,
      city,
      config.texts.no_save,
    ),
    createChoiceField(
      factory,
      config,
      page.content,
      fieldWidth,
      "profile-slot",
      config.texts.profile_slot_label,
      slotSelection,
      config.texts.no_save,
    ),
  );
  const contentBottom = renderSetupGrid(
    fields,
    columns,
    fieldWidth,
    columnGap,
    introduction.height + layout.sectionGap,
    layout.sectionGap,
  );
  page.scroll.setContentHeight(contentBottom);
  return { page, readNames, readProfile, readSlotId };
}

/** 拒绝无法生成稳定输入框集合的玩家数量。 */
function validatePlayerCount(playerCount: number): void {
  if (!Number.isInteger(playerCount) || playerCount <= 0) {
    throw new Error("玩家输入框数量必须是正整数配置值。");
  }
}

/** 为每位玩家创建从不同起点循环的预设姓名选择器。 */
function createPresetNameSelection(
  presetNames: readonly string[],
  playerIndex: number,
): CyclingSelection<string> {
  if (presetNames.length === 0) {
    throw new Error("预设姓名配置不能为空。");
  }
  const options = presetNames.map((name) => ({
    id: name,
    label: name,
    description: name,
  }));
  const initial = options[playerIndex % options.length];
  if (initial === undefined) {
    throw new Error("预设姓名初始项不存在。");
  }
  return createCyclingSelection(options, initial.id, "预设姓名");
}

/** 将领域开局选项转换为以默认 ID 起步的循环选择器。 */
function createCampaignSelection(
  options: readonly UiCampaignOptionView[],
  defaultId: string,
  fieldLabel: string,
): CyclingSelection<string> {
  return createCyclingSelection(options, defaultId, fieldLabel);
}

/** 创建从首个可写栏位开始、自动跳过只读栏位的存档选择器。 */
function createSlotSelection(
  saveSlots: readonly UiSaveSlotView[],
  config: GameUiConfig,
): CyclingSelection<number> | null {
  const availableSlots = saveSlots
    .filter((slot) => slot.writable)
    .map((slot) => ({
      id: slot.slotId,
      label: slot.title,
      description: slot.details,
    }));
  const firstSlot = availableSlots[0];
  return firstSlot === undefined
    ? null
    : createCyclingSelection(
        availableSlots,
        firstSlot.id,
        config.texts.profile_slot_label,
      );
}

/** 按入口模式读取完全配置化的模式标签和简介。 */
function resolveModeOption(
  config: GameUiConfig,
  mode: GameMode,
): CyclingOption<GameMode> {
  switch (mode) {
    case "single":
      return {
        id: mode,
        label: config.texts.start_single,
        description: config.texts.start_single_description,
      };
    case "multiplayer":
      return {
        id: mode,
        label: config.texts.start_multiplayer,
        description: config.texts.start_multiplayer_description,
      };
    case "story":
      return {
        id: mode,
        label: config.texts.start_story,
        description: config.texts.start_story_description,
      };
  }
}

/** 创建严格校验默认值且每次前进一项的循环选择状态。 */
function createCyclingSelection<TId extends SelectionId>(
  options: readonly CyclingOption<TId>[],
  initialId: TId,
  fieldLabel: string,
): CyclingSelection<TId> {
  let currentIndex = options.findIndex((option) => option.id === initialId);
  if (currentIndex < 0) {
    throw new Error(`${fieldLabel}的默认选项不存在：${String(initialId)}`);
  }

  /** 从已校验的索引读取当前选项，并防御运行时数组变更。 */
  const current = (): CyclingOption<TId> => {
    const option = options[currentIndex];
    if (option === undefined) {
      throw new Error(`${fieldLabel}没有可用选项。`);
    }
    return option;
  };

  /** 前进到下一项，到达末尾后回到第一项。 */
  const advance = (): CyclingOption<TId> => {
    currentIndex = (currentIndex + 1) % options.length;
    return current();
  };

  /** 暴露只读选项集合，供布局测量而不改变当前选择。 */
  const readOptions = (): readonly CyclingOption<TId>[] => options;

  return { current, advance, options: readOptions };
}

/** 根据配置列数和最小触控宽度解析当前页面实际列数。 */
function resolveSetupColumns(
  layout: ResponsiveLayout,
  contentWidth: number,
  config: GameUiConfig,
): number {
  const requestedColumns = Math.max(1, Math.floor(layout.optionColumns));
  const gap = config.layout.page.option_gap;
  const supportedColumns = Math.max(
    1,
    Math.floor(
      (contentWidth + gap) / (config.controls.minimum_touch_size + gap),
    ),
  );
  return Math.min(requestedColumns, supportedColumns);
}

/** 创建一个带独立标签和失焦通知的所长姓名字段。 */
function createNameField(
  factory: UiFactory,
  config: GameUiConfig,
  parent: LayaNodeLike,
  fieldWidth: number,
  index: number,
  playerCount: number,
  inputs: LayaInputLike[],
  prepareNameInput: () => void,
  onTextEntryFocusOut: () => void,
): SetupField {
  const labelHeight = config.typography.body_line_height;
  const gap = config.layout.page.option_gap;
  const inputHeight = config.controls.button_height;
  const presetButtonHeight = config.controls.compact_button_height;
  const ordinal = index + 1;
  const label = playerCount === 1
    ? config.texts.profile_name_label
    : `${config.texts.profile_name_label} ${String(ordinal)}`;
  const presetSelection = createPresetNameSelection(
    config.new_game_setup.preset_names,
    index,
  );

  /** 在响应式网格指定位置绘制姓名标签和输入框。 */
  const render = (x: number, y: number): void => {
    factory.text(parent, {
      testId: `player-name-${String(ordinal)}-heading`,
      text: label,
      x,
      y,
      width: fieldWidth,
      height: labelHeight,
      fontSize: config.typography.caption_size,
      color: config.theme.muted_text,
      valign: "middle",
    });
    const input = factory.input(parent, {
      testId: `player-name-${String(ordinal)}`,
      prompt: label,
      x,
      y: y + labelHeight + gap,
      width: fieldWidth,
      height: inputHeight,
      maxChars: config.controls.max_player_name_characters,
      type: config.new_game_setup.name_input.html_type,
    });
    input.text = presetSelection.current().label;
    input.on("focus", input, prepareNameInput);
    input.on("blur", input, onTextEntryFocusOut);
    inputs.push(input);

    let presetButtonLabel: LayaTextLike | null = null;

    /** 切换至下一个预设姓名，并与可继续编辑的输入框同步。 */
    const handlePresetCycle = (): void => {
      const selected = presetSelection.advance();
      input.text = selected.label;
      if (presetButtonLabel !== null) {
        presetButtonLabel.text = formatTemplate(
          config.texts.profile_name_preset_format,
          { name: selected.label },
        );
      }
    };

    const presetButton = factory.button(parent, {
      testId: `player-name-${String(ordinal)}-preset`,
      label: formatTemplate(config.texts.profile_name_preset_format, {
        name: presetSelection.current().label,
      }),
      x,
      y: y + labelHeight + gap + inputHeight + gap,
      width: fieldWidth,
      height: presetButtonHeight,
      tone: "muted",
      fontSize: config.typography.caption_size,
      wordWrap: false,
      onClick: handlePresetCycle,
    });
    presetButtonLabel = requireButtonLabel(
      presetButton,
      `player-name-${String(ordinal)}-preset`,
    );
  };

  return {
    height: labelHeight + gap + inputHeight + gap + presetButtonHeight,
    render,
  };
}

/** 创建一个通过单按钮循环选项并同步展示当前简介的字段。 */
function createChoiceField<TId extends SelectionId>(
  factory: UiFactory,
  config: GameUiConfig,
  parent: LayaNodeLike,
  fieldWidth: number,
  testId: string,
  heading: string,
  selection: CyclingSelection<TId> | null,
  emptyText: string,
): SetupField {
  const labelHeight = config.typography.body_line_height;
  const buttonHeight = config.controls.button_height;
  const gap = config.layout.page.option_gap;
  const descriptions = selection === null
    ? [emptyText]
    : collectSelectionDescriptions(selection);
  const descriptionHeight = measureMaximumTextHeight(
    factory,
    config,
    parent,
    `${testId}-measure`,
    descriptions,
    fieldWidth,
  );

  /** 在响应式网格指定位置绘制选择按钮和固定高度简介。 */
  const render = (x: number, y: number): void => {
    const selected = selection?.current();
    factory.text(parent, {
      testId: `${testId}-heading`,
      text: heading,
      x,
      y,
      width: fieldWidth,
      height: labelHeight,
      fontSize: config.typography.caption_size,
      color: config.theme.muted_text,
      valign: "middle",
    });
    const description = factory.text(parent, {
      testId: `${testId}-description`,
      text: selected?.description ?? emptyText,
      x,
      y: y + labelHeight + gap + buttonHeight + gap,
      width: fieldWidth,
      height: descriptionHeight,
      fontSize: config.typography.body_size,
      color: config.theme.muted_text,
    });
    let buttonLabel: LayaTextLike | null = null;

    /** 前进一个选项并原位更新按钮标签与简介。 */
    const handleCycle = (): void => {
      if (selection === null || buttonLabel === null) {
        return;
      }
      const next = selection.advance();
      buttonLabel.text = next.label;
      description.text = next.description;
    };

    const button = factory.button(parent, {
      testId,
      label: selected?.label ?? emptyText,
      x,
      y: y + labelHeight + gap,
      width: fieldWidth,
      height: buttonHeight,
      disabled: selection === null,
      onClick: handleCycle,
    });
    buttonLabel = requireButtonLabel(button, testId);
  };

  return {
    height: labelHeight + gap + buttonHeight + gap + descriptionHeight,
    render,
  };
}

/** 读取循环选择器中的全部简介，同时保持选择器当前值不变。 */
function collectSelectionDescriptions<TId extends SelectionId>(
  selection: CyclingSelection<TId>,
): readonly string[] {
  return selection.options().map((option) => option.description);
}

/** 使用真实字体和宽度测量一组简介所需的最大高度。 */
function measureMaximumTextHeight(
  factory: UiFactory,
  config: GameUiConfig,
  parent: LayaNodeLike,
  testId: string,
  texts: readonly string[],
  width: number,
): number {
  let maximumHeight = config.typography.body_line_height;
  texts.forEach((text, index) => {
    const probe = factory.text(parent, {
      testId: `${testId}-${String(index)}`,
      text,
      x: 0,
      y: 0,
      width,
      height: config.typography.body_line_height,
      fontSize: config.typography.body_size,
    });
    probe.visible = false;
    maximumHeight = Math.max(maximumHeight, probe.textHeight);
    probe.destroy();
  });
  return maximumHeight;
}

/** 从 UiFactory 创建的按钮中取得稳定命名的文本节点。 */
function requireButtonLabel(
  button: LayaNodeLike,
  testId: string,
): LayaTextLike {
  const label = button.getChildByName?.(`${testId}-label`);
  if (label === null || label === undefined) {
    throw new Error(`按钮 ${testId} 缺少标签节点。`);
  }
  return label as LayaTextLike;
}

/** 按配置列数逐行绘制字段，并以每行最高字段推进纵向位置。 */
function renderSetupGrid(
  fields: readonly SetupField[],
  columns: number,
  fieldWidth: number,
  columnGap: number,
  startY: number,
  rowGap: number,
): number {
  let currentY = startY;
  for (let rowStart = 0; rowStart < fields.length; rowStart += columns) {
    const rowFields = fields.slice(rowStart, rowStart + columns);
    const rowHeight = Math.max(...rowFields.map((field) => field.height));
    rowFields.forEach((field, columnIndex) => {
      field.render(
        columnIndex * (fieldWidth + columnGap),
        currentY,
      );
    });
    currentY += rowHeight + rowGap;
  }
  return currentY;
}
