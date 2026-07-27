import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { UiFactory } from "../components/UiFactory";
import { formatUiTemplate } from "../formatting/formatUiTemplate";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiCraftingRecipeView,
  UiDocumentView,
  UiHistoryEntryView,
  UiOptionView,
  UiPromptView,
  UiResearchProjectView,
  UiResearchWorkbenchView,
  UiTransportLoadoutOptionView,
  UiWarehouseItemView,
  UiWeeklyArchiveView,
} from "../ports/GameUiPort";
import { createChoicePage } from "./ChoicePage";
import { createDocumentPage } from "./DocumentPage";
import type { PageView } from "./PageView";

const RESEARCH_SLOT_OPTION_PREFIX = "research-slot::";
const RESEARCH_CLEAR_OPTION_ID = "research-slot-clear";

/** 研究台页面可以发出的三个领域意图。 */
export interface ResearchPageActions {
  readonly back: () => void;
  readonly slot: (itemId: string) => void;
  readonly clear: () => void;
  readonly complete: (projectId: string) => void;
}

/** 创建可装备仓库页，不可装备资源仍保留为只读库存。 */
export function createWarehousePage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  items: readonly UiWarehouseItemView[],
  onBack: () => void,
  onEquip: (itemId: string) => void,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-warehouse",
    title: config.texts.warehouse_title,
    prompt: buildWarehousePrompt(config, items),
    onBack,
    onSelect: (option): void => { onEquip(option.id); },
  });
}

/** 把实时仓库快照转换为通用选择页模型。 */
export function buildWarehousePrompt(
  config: GameUiConfig,
  items: readonly UiWarehouseItemView[],
): UiPromptView {
  return {
    id: "warehouse",
    title: config.texts.warehouse_title,
    body: config.texts.warehouse_body,
    options: items.map((item): UiOptionView => {
      const canEquip = item.equippable && !item.equipped && item.quantity > 0;
      return {
        id: item.id,
        label: formatUiTemplate(config.texts.warehouse_item_format, {
          name: item.name,
          quantity: item.quantity,
        }),
        description: formatUiTemplate(config.texts.warehouse_detail_format, {
          category: item.categoryLabel,
          description: item.description,
        }),
        disabled: !canEquip,
        disabledReason: canEquip
          ? undefined
          : config.texts.warehouse_not_equippable,
        tone: canEquip ? "primary" : "default",
      };
    }),
  };
}

/** 创建载具设置页并把装备或卸载动作提交给应用层。 */
export function createTransportManagementPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  items: readonly UiTransportLoadoutOptionView[],
  onBack: () => void,
  onToggle: (itemId: string) => void,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-transport-management",
    title: config.texts.transport_title,
    prompt: buildTransportManagementPrompt(config, items),
    onBack,
    onSelect: (option): void => { onToggle(option.id); },
  });
}

/** 把实时载具配装转换为包含驾驶状态与持有数量的选择页模型。 */
export function buildTransportManagementPrompt(
  config: GameUiConfig,
  items: readonly UiTransportLoadoutOptionView[],
): UiPromptView {
  return {
    id: "transport-management",
    title: config.texts.transport_title,
    body: config.texts.transport_body,
    options: items.map((item): UiOptionView => ({
      id: item.id,
      label: formatUiTemplate(config.texts.transport_item_format, {
        name: item.name,
        status: item.equipped
          ? config.texts.transport_equipped
          : config.texts.transport_available,
      }),
      description: formatUiTemplate(config.texts.transport_detail_format, {
        mode: item.modeLabel,
        quantity: item.ownedQuantity,
        description: item.description,
      }),
      disabled: item.disabled,
      disabledReason: item.disabledReason,
      tone: item.equipped ? "primary" : "default",
    })),
  };
}

/** 创建实时更新可用性的研发页。 */
export function createResearchPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  projects: readonly UiResearchProjectView[],
  workbench: UiResearchWorkbenchView,
  actions: ResearchPageActions,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-research",
    title: config.texts.research_title,
    prompt: buildResearchPrompt(config, projects, workbench),
    onBack: actions.back,
    onSelect: (option): void => {
      if (option.id === RESEARCH_CLEAR_OPTION_ID) {
        actions.clear();
        return;
      }
      const itemId = researchSlotItemId(option.id);
      if (itemId !== null) {
        actions.slot(itemId);
        return;
      }
      actions.complete(option.id);
    },
  });
}

/** 把研究槽、样本出处、研发成本和完成状态组装为选项情报。 */
export function buildResearchPrompt(
  config: GameUiConfig,
  projects: readonly UiResearchProjectView[],
  workbench: UiResearchWorkbenchView,
): UiPromptView {
  const slotDescription = workbench.slottedItemName === null
    ? config.texts.research_slot_empty
    : formatUiTemplate(config.texts.research_slot_filled_format, {
        name: workbench.slottedItemName,
      });
  const sampleOptions = workbench.candidates.map((candidate): UiOptionView => {
    const alreadySlotted = candidate.id === workbench.slottedItemId;
    const disabledReason = candidate.researchCompleted
      ? config.texts.research_completed
      : alreadySlotted
        ? config.texts.research_sample_slotted
        : candidate.available
          ? undefined
          : config.texts.research_locked;
    return {
      id: researchSlotOptionId(candidate.id),
      label: formatUiTemplate(config.texts.research_slot_candidate_format, {
        name: candidate.name,
        quantity: candidate.ownedQuantity,
      }),
      description: formatUiTemplate(
        config.texts.research_slot_candidate_detail_format,
        {
          project: candidate.projectName,
          source: candidate.sourceDescription,
        },
      ),
      disabled: alreadySlotted || !candidate.available,
      disabledReason,
      tone: candidate.available && !alreadySlotted ? "primary" : "default",
    };
  });
  const clearOption: UiOptionView[] = workbench.slottedItemId === null
    ? []
    : [{
        id: RESEARCH_CLEAR_OPTION_ID,
        label: config.texts.research_slot_clear,
        description: slotDescription,
        disabled: false,
      }];
  return {
    id: "research",
    title: config.texts.research_title,
    body: [config.texts.research_body, slotDescription].join("\n\n"),
    options: [...sampleOptions, ...clearOption, ...projects.map((project): UiOptionView => {
      const status = project.completed
        ? config.texts.research_completed
        : project.available
          ? config.texts.research_complete
          : config.texts.research_locked;
      return {
        id: project.id,
        label: formatUiTemplate(config.texts.research_item_format, {
          name: project.name,
          status,
        }),
        description: formatUiTemplate(config.texts.research_detail_format, {
          description: project.description,
          sample: formatUiTemplate(config.texts.research_sample_format, {
            sample: project.requiredItemName,
            status: project.slotted
              ? config.texts.research_sample_slotted
              : config.texts.research_sample_not_slotted,
          }),
          source: formatUiTemplate(config.texts.research_source_format, {
            source: project.sourceDescription,
          }),
          cost: project.costDescription,
          bonus: project.expeditionStepBonus,
        }),
        disabled: project.completed || !project.available,
        disabledReason: project.completed || !project.available ? status : undefined,
        tone: project.available && !project.completed ? "primary" : "default",
      };
    })],
  };
}

/** 为研究样本按钮生成不会与项目 ID 冲突的页面内 ID。 */
export function researchSlotOptionId(itemId: string): string {
  return `${RESEARCH_SLOT_OPTION_PREFIX}${itemId}`;
}

/** 从研究样本按钮 ID 中还原仓库物品 ID，普通项目返回空值。 */
export function researchSlotItemId(optionId: string): string | null {
  return optionId.startsWith(RESEARCH_SLOT_OPTION_PREFIX)
    ? optionId.slice(RESEARCH_SLOT_OPTION_PREFIX.length)
    : null;
}

/** 创建制作工坊页并将可用配方接入真实制作命令。 */
export function createCraftingPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  recipes: readonly UiCraftingRecipeView[],
  onBack: () => void,
  onCraft: (recipeId: string) => void,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-crafting",
    title: config.texts.crafting_title,
    prompt: buildCraftingPrompt(config, recipes),
    onBack,
    onSelect: (option): void => { onCraft(option.id); },
  });
}

/** 把配方解锁、材料和产物信息转换为选择页模型。 */
export function buildCraftingPrompt(
  config: GameUiConfig,
  recipes: readonly UiCraftingRecipeView[],
): UiPromptView {
  return {
    id: "crafting",
    title: config.texts.crafting_title,
    body: config.texts.crafting_body,
    options: recipes.map((recipe): UiOptionView => ({
      id: recipe.id,
      label: formatUiTemplate(config.texts.crafting_item_format, {
        name: recipe.name,
        quantity: recipe.outputQuantity,
      }),
      description: formatUiTemplate(config.texts.crafting_detail_format, {
        description: recipe.description,
        blueprint_source: recipe.blueprintSourceDescription,
        cost: recipe.costDescription,
        output: formatUiTemplate(config.texts.warehouse_item_format, {
          name: recipe.name,
          quantity: recipe.outputQuantity,
        }),
      }),
      disabled: !recipe.available,
      disabledReason: recipe.available
        ? undefined
        : config.texts.crafting_locked,
      tone: recipe.available ? "primary" : "default",
    })),
  };
}

/** 创建按周展示不可变通讯档案的历史页。 */
export function createHistoryPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  archives: readonly UiWeeklyArchiveView[],
  onBack: () => void,
): PageView {
  return createDocumentPage(
    runtime,
    factory,
    config,
    layout,
    "page-history",
    buildHistoryDocument(config, archives),
    config.texts.back,
    onBack,
  );
}

/** 将周档案和其中的通讯顺序格式化为可滚动文档。 */
export function buildHistoryDocument(
  config: GameUiConfig,
  archives: readonly UiWeeklyArchiveView[],
): UiDocumentView {
  if (archives.length === 0) {
    return {
      title: config.texts.history_title,
      body: config.texts.history_empty,
    };
  }
  const separator = config.texts.option_intelligence_separator;
  const body = archives.map((archive) => {
    const heading = formatUiTemplate(config.texts.history_week_format, {
      week: archive.weekNumber,
      start: archive.startDateLabel,
      end: archive.endDateLabel,
      summary: archive.summary,
    });
    const entries = archive.entries.map((entry) => formatHistoryEntry(config, entry));
    return [heading, ...entries].join(separator + separator);
  }).join(separator + separator);
  return { title: config.texts.history_title, body };
}

/** 格式化一条保留生存日、回合和时间的历史通讯。 */
function formatHistoryEntry(
  config: GameUiConfig,
  entry: UiHistoryEntryView,
): string {
  return formatUiTemplate(config.texts.history_entry_format, {
    day: entry.survivalDay,
    turn: entry.turnNumber,
    date: entry.dateLabel,
    time: entry.timeLabel,
    message: entry.message,
  });
}
