import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiCompanionEquipmentOptionView,
  UiCompanionEquipmentSlot,
  UiCompanionView,
  UiOptionView,
  UiPromptView,
} from "../ports/GameUiPort";
import { createChoicePage } from "./ChoicePage";
import { PageScaffold, type PageView } from "./PageView";

/** 伙伴档案列表的纯导航意图。 */
export interface CompanionArchiveActions {
  readonly back: () => void;
  readonly openCompanion: (companionId: string) => void;
  readonly openManagement: () => void;
}

/** 伙伴详情页的纯导航意图。 */
export interface CompanionDetailActions {
  readonly back: () => void;
  readonly manage: (companionId: string) => void;
}

/** 伙伴管理列表的纯导航意图。 */
export interface CompanionManagementActions {
  readonly back: () => void;
  readonly openCompanion: (companionId: string) => void;
}

/** 单个伙伴管理页的纯导航意图。 */
export interface CompanionManagementDetailActions {
  readonly back: () => void;
  readonly openEquipment: (
    companionId: string,
    slot: UiCompanionEquipmentSlot,
  ) => void;
  readonly openInteraction: (companionId: string) => void;
}

/** 伙伴配装页可提交的领域意图。 */
export interface CompanionEquipmentActions {
  readonly back: () => void;
  readonly equip: (
    companionId: string,
    slot: UiCompanionEquipmentSlot,
    itemId: string | null,
  ) => void;
}

/** 伙伴互动页可提交的领域意图。 */
export interface CompanionInteractionActions {
  readonly back: () => void;
  readonly interact: (companionId: string, interactionId: string) => void;
}

/** 将伙伴档案投影为全部可点击的公开列表。 */
export function buildCompanionArchivePrompt(
  config: GameUiConfig,
  companions: readonly UiCompanionView[],
): UiPromptView {
  return {
    id: "companion-archive",
    title: config.texts.companion_archive_title,
    body: config.texts.companion_archive_body,
    options: companions.map((companion) => companionListOption(config, companion, false)),
  };
}

/** 将伙伴档案投影为只允许管理在队成员的列表。 */
export function buildCompanionManagementPrompt(
  config: GameUiConfig,
  companions: readonly UiCompanionView[],
): UiPromptView {
  return {
    id: "companion-management",
    title: config.texts.companion_management_title,
    body: config.texts.companion_management_body,
    options: companions.map((companion) => companionListOption(config, companion, true)),
  };
}

/** 构建单个伙伴的配装、卸下与互动入口。 */
export function buildCompanionManagementDetailPrompt(
  config: GameUiConfig,
  companion: UiCompanionView,
): UiPromptView {
  const equipmentName = (
    slot: UiCompanionEquipmentSlot,
  ): string => slot === "weapon"
    ? companion.equippedWeapon?.name ?? config.texts.companion_unequip
    : companion.equippedArmor?.name ?? config.texts.companion_unequip;
  const disabled = !companion.canManage;
  const disabledReason = disabled
    ? config.texts.companion_locked_management
    : undefined;
  return {
    id: `companion-management-${companion.id}`,
    title: `${companion.name} · ${config.texts.companion_management}`,
    body: formatUiTemplate(config.texts.companion_interaction_cooldown_format, {
      turns: companion.interactionCooldownTurns,
      count: companion.interactionCount,
    }),
    options: [
      {
        id: "weapon",
        label: config.texts.companion_weapon,
        description: formatUiTemplate(config.texts.companion_equipment_format, {
          slot: config.texts.companion_weapon,
          item: equipmentName("weapon"),
        }),
        disabled,
        disabledReason,
        tone: "primary",
      },
      {
        id: "armor",
        label: config.texts.companion_armor,
        description: formatUiTemplate(config.texts.companion_equipment_format, {
          slot: config.texts.companion_armor,
          item: equipmentName("armor"),
        }),
        disabled,
        disabledReason,
        tone: "primary",
      },
      {
        id: "interaction",
        label: config.texts.companion_interaction,
        description: formatUiTemplate(config.texts.companion_interaction_cooldown_format, {
          turns: companion.interactionCooldownTurns,
          count: companion.interactionCount,
        }),
        disabled,
        disabledReason,
        tone: "success",
      },
    ],
  };
}

/** 构建一个装备栏位的实时仓库候选列表。 */
export function buildCompanionEquipmentPrompt(
  config: GameUiConfig,
  companion: UiCompanionView,
  slot: UiCompanionEquipmentSlot,
): UiPromptView {
  const options = slot === "weapon"
    ? companion.weaponOptions
    : companion.armorOptions;
  const equipped = slot === "weapon"
    ? companion.equippedWeapon
    : companion.equippedArmor;
  const slotLabel = slot === "weapon"
    ? config.texts.companion_weapon
    : config.texts.companion_armor;
  return {
    id: `companion-equipment-${companion.id}-${slot}`,
    title: formatUiTemplate(config.texts.companion_equipment_title, {
      name: companion.name,
      slot: slotLabel,
    }),
    body: formatUiTemplate(config.texts.companion_equipment_format, {
      slot: slotLabel,
      item: equipped?.name ?? config.texts.companion_unequip,
    }),
    options: [unequipOption(config, equipped !== null), ...options.map(
      (option) => equipmentOption(config, option),
    )],
  };
}

/** 构建带冷却条件的伙伴互动列表。 */
export function buildCompanionInteractionPrompt(
  config: GameUiConfig,
  companion: UiCompanionView,
): UiPromptView {
  return {
    id: `companion-interaction-${companion.id}`,
    title: formatUiTemplate(config.texts.companion_interaction_title, {
      name: companion.name,
    }),
    body: formatUiTemplate(config.texts.companion_interaction_cooldown_format, {
      turns: companion.interactionCooldownTurns,
      count: companion.interactionCount,
    }),
    options: companion.interactionOptions.map((option) => ({ ...option })),
  };
}

/** 创建可点击进入单人档案、并可转入管理的伙伴列表页。 */
export function createCompanionsPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  companions: readonly UiCompanionView[],
  actions: CompanionArchiveActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-companions",
    title: config.texts.companion_archive_title,
    prompt: buildCompanionArchivePrompt(config, companions),
    onBack: actions.back,
    footerActions: [
      {
        id: "back",
        testId: "page-companions-back",
        label: config.texts.back,
        onClick: actions.back,
      },
      {
        id: "management",
        testId: "page-companions-management",
        label: config.texts.companion_management,
        tone: "primary",
        onClick: actions.openManagement,
      },
    ],
    onSelect: (option): void => { actions.openCompanion(option.id); },
  });
}

/** 创建同时展示立绘信号、身份、状态、信任与完整档案的详情页。 */
export function createCompanionDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  companion: UiCompanionView,
  actions: CompanionDetailActions,
): PageView {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-companion-detail",
    formatUiTemplate(config.texts.companion_detail_title, { name: companion.name }),
    actions.back,
    [
      {
        id: "back",
        testId: "page-companion-detail-back",
        label: config.texts.back,
        onClick: actions.back,
      },
      {
        id: "manage",
        testId: "page-companion-detail-manage",
        label: config.texts.companion_management,
        tone: "primary",
        disabled: !companion.canManage,
        onClick: (): void => { actions.manage(companion.id); },
      },
    ],
  );
  const portraitBottom = renderPortrait(runtime, factory, config, layout, page, companion);
  const body = factory.autoText(page.content, {
    testId: `companion-${companion.id}-archive`,
    text: buildCompanionDetailBody(config, companion),
    x: 0,
    y: portraitBottom + layout.sectionGap,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
  });
  page.scroll.setContentHeight(body.y + body.height + layout.sectionGap);
  return page;
}

/** 创建伙伴管理的首层成员选择页。 */
export function createCompanionManagementPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  companions: readonly UiCompanionView[],
  actions: CompanionManagementActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-companion-management",
    title: config.texts.companion_management_title,
    prompt: buildCompanionManagementPrompt(config, companions),
    onBack: actions.back,
    onSelect: (option): void => { actions.openCompanion(option.id); },
  });
}

/** 创建单个伙伴的配装与互动分流页。 */
export function createCompanionManagementDetailPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  companion: UiCompanionView,
  actions: CompanionManagementDetailActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-companion-management-detail",
    title: config.texts.companion_management_title,
    prompt: buildCompanionManagementDetailPrompt(config, companion),
    onBack: actions.back,
    onSelect: (option): void => {
      if (option.id === "interaction") {
        actions.openInteraction(companion.id);
      } else {
        actions.openEquipment(companion.id, option.id as UiCompanionEquipmentSlot);
      }
    },
  });
}

/** 创建使用现有仓库目录的伙伴配装页。 */
export function createCompanionEquipmentPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  companion: UiCompanionView,
  slot: UiCompanionEquipmentSlot,
  actions: CompanionEquipmentActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-companion-equipment",
    title: config.texts.companion_equipment,
    prompt: buildCompanionEquipmentPrompt(config, companion, slot),
    onBack: actions.back,
    onSelect: (option): void => {
      actions.equip(companion.id, slot, option.id === "__unequip__" ? null : option.id);
    },
  });
}

/** 创建带需求和冷却灰态的伙伴互动页。 */
export function createCompanionInteractionPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  companion: UiCompanionView,
  actions: CompanionInteractionActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-companion-interaction",
    title: config.texts.companion_interaction,
    prompt: buildCompanionInteractionPrompt(config, companion),
    onBack: actions.back,
    onSelect: (option): void => { actions.interact(companion.id, option.id); },
  });
}

/** 把公开档案、已解锁秘密与锁定说明组成详情正文。 */
export function buildCompanionDetailBody(
  config: GameUiConfig,
  companion: UiCompanionView,
): string {
  return [
    companion.role,
    formatUiTemplate(config.texts.companion_status_format, {
      name: companion.name,
      role: companion.role,
      status: companion.statusLabel,
      trust: companion.trustLabel,
    }),
    companion.biography,
  ].filter((text) => text.trim().length > 0).join(
    config.texts.option_intelligence_separator + config.texts.option_intelligence_separator,
  );
}

/** 在立绘资源未到位时绘制稳定的终端信号降级层。 */
function renderPortrait(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  page: PageScaffold,
  companion: UiCompanionView,
): number {
  const portraitHeight = layout.usesCompactUi
    ? config.layout.mobile.mission_height
    : config.layout.desktop.mission_height;
  const ratio = config.assets.companion_portraits.recommended_width
    / config.assets.companion_portraits.recommended_height;
  const portraitWidth = Math.min(page.contentWidth, portraitHeight * ratio);
  const portraitLeft = (page.contentWidth - portraitWidth) / 2;
  const frame = factory.panel(page.content, {
    testId: `companion-${companion.id}-portrait-frame`,
    x: portraitLeft,
    y: 0,
    width: portraitWidth,
    height: portraitHeight,
    elevated: true,
    active: companion.canManage,
  });
  renderMissingPortraitSignal(factory, config, frame, companion, portraitWidth, portraitHeight);
  if (companion.portraitAssetPath.length > 0) {
    const image = new runtime.Image();
    image.name = `companion-${companion.id}-portrait`;
    image.skin = companion.portraitAssetPath;
    image.mouseEnabled = false;
    image.size(portraitWidth, portraitHeight);
    frame.addChild(image);
  }
  return portraitHeight;
}

/** 绘制没有粗糙占位画的档案信号降级信息。 */
function renderMissingPortraitSignal(
  factory: UiFactory,
  config: GameUiConfig,
  frame: ReturnType<UiFactory["container"]>,
  companion: UiCompanionView,
  width: number,
  height: number,
): void {
  frame.graphics.drawLine(0, height / 2, width, height / 2, config.theme.border);
  frame.graphics.drawLine(width / 2, 0, width / 2, height, config.theme.border);
  factory.text(frame, {
    testId: `companion-${companion.id}-portrait-monogram`,
    text: companion.name.slice(0, 1),
    x: 0,
    y: height * 0.2,
    width,
    height: config.typography.page_title_size * 2,
    fontSize: config.typography.page_title_size * 2,
    color: config.theme.accent,
    bold: true,
    align: "center",
  });
  factory.text(frame, {
    testId: `companion-${companion.id}-portrait-unavailable`,
    text: formatUiTemplate(config.texts.companion_portrait_signal_format, {
      status: config.texts.companion_portrait_unavailable,
      key: companion.portraitKey,
    }),
    x: config.layout.page.body_padding,
    y: height - config.typography.body_line_height * 3,
    width: width - config.layout.page.body_padding * 2,
    height: config.typography.body_line_height * 2,
    fontSize: config.typography.caption_size,
    color: config.theme.muted_text,
    align: "center",
  });
}

/** 把一名伙伴转换为档案或管理列表项。 */
function companionListOption(
  config: GameUiConfig,
  companion: UiCompanionView,
  managementOnly: boolean,
): UiOptionView {
  const disabled = managementOnly && !companion.canManage;
  return {
    id: companion.id,
    label: formatUiTemplate(config.texts.companion_status_format, {
      name: companion.name,
      role: companion.role,
      status: companion.statusLabel,
      trust: companion.trustLabel,
    }),
    description: companion.introduction,
    disabled: false,
    disabledReason: disabled ? config.texts.companion_locked_management : undefined,
    lockedAppearance: disabled,
    tone: companion.tone,
  };
}

/** 构建卸下当前栏位的特殊选项。 */
function unequipOption(
  config: GameUiConfig,
  hasEquipment: boolean,
): UiOptionView {
  return {
    id: "__unequip__",
    label: config.texts.companion_unequip,
    description: config.texts.companion_unequip,
    disabled: !hasEquipment,
    tone: "muted",
  };
}

/** 把仓库装备候选项转为通用页面选项。 */
function equipmentOption(
  config: GameUiConfig,
  option: UiCompanionEquipmentOptionView,
): UiOptionView {
  return {
    id: option.id,
    label: option.name,
    description: formatUiTemplate(config.texts.warehouse_detail_format, {
      category: option.slot === "weapon"
        ? config.texts.companion_weapon
        : config.texts.companion_armor,
      description: option.description,
    }),
    disabled: option.disabled,
    disabledReason: option.disabledReason,
    tone: option.equipped ? "success" : "primary",
  };
}
