import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  UiArchiveCollectionPageView,
  UiArchiveDocumentListItemView,
  UiArchiveDocumentPageView,
  UiArchiveStoragePageView,
  UiEncounterActionView,
  UiEncounterBattlePageView,
  UiEncounterCatalogPageView,
  UiEncounterCombatantView,
  UiEncounterPreparationPageView,
  UiEncounterTargetView,
  UiReturnIncidentChoiceView,
  UiReturnIncidentPageView,
} from "../models/DemoSystemViewModels";
import type { UiTone } from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/** 文献存储总览页可发出的导航意图。 */
export interface ArchiveStoragePageActions {
  readonly back: () => void;
  readonly openCollection: (collectionId: string) => void;
}

/** 文献分类目录页可发出的导航意图。 */
export interface ArchiveCollectionPageActions {
  readonly back: () => void;
  readonly openDocument: (documentId: string, unlocked: boolean) => void;
}

/** 遭遇目录页可发出的开战意图。 */
export interface EncounterCatalogPageActions {
  readonly back: () => void;
  readonly prepareEncounter: (encounterId: string) => void;
}

/** 战前整备页可发出的职责、治疗和开战意图。 */
export interface EncounterPreparationPageActions {
  readonly back: () => void;
  readonly selectRole: (memberId: string, roleId: string) => void;
  readonly toggleTreatment: (memberId: string) => void;
  readonly startBattle: () => void;
}

/** 遭遇战页可发出的手动指令与导航意图。 */
export interface EncounterBattlePageActions {
  readonly back: () => void;
  readonly selectPartyMember: (memberId: string) => void;
  readonly selectEnemy: (enemyId: string) => void;
  readonly selectAction: (actionId: string) => void;
  readonly selectTarget: (targetId: string) => void;
  readonly execute: () => void;
}

/** 归来事项页可发出的决策与暂缓意图。 */
export interface ReturnIncidentPageActions {
  readonly defer: () => void;
  readonly choose: (choiceId: string) => void;
}

/** 页面内部的流式排版器，统一处理配置化字号与间距。 */
class PageFlow {
  private readonly factory: UiFactory;
  private readonly config: GameUiConfig;
  private readonly layout: ResponsiveLayout;
  private readonly page: PageScaffold;
  private currentY = 0;

  /** 保存只读 UI 依赖，排版器不持有任何领域状态。 */
  public constructor(
    factory: UiFactory,
    config: GameUiConfig,
    layout: ResponsiveLayout,
    page: PageScaffold,
  ) {
    this.factory = factory;
    this.config = config;
    this.layout = layout;
    this.page = page;
  }

  /** 追加一个使用主题强调色的分区标题。 */
  public section(testId: string, text: string): void {
    const title = this.factory.autoText(this.page.content, {
      testId,
      text,
      x: 0,
      y: this.currentY,
      width: this.page.contentWidth,
      fontSize: this.config.typography.section_title_size,
      color: this.config.theme.accent,
      bold: true,
    });
    this.currentY += title.height + this.layout.sectionGap;
  }

  /** 追加一段可自动换行的正文。 */
  public paragraph(
    testId: string,
    text: string,
    tone: "body" | "muted" | "warning" = "body",
  ): void {
    if (text.length === 0) {
      return;
    }
    const color = tone === "muted"
      ? this.config.theme.muted_text
      : tone === "warning"
        ? this.config.theme.warning
        : this.config.theme.text;
    const body = this.factory.autoText(this.page.content, {
      testId,
      text,
      x: 0,
      y: this.currentY,
      width: this.page.contentWidth,
      fontSize: this.config.typography.body_size,
      color,
    });
    this.currentY += body.height + this.layout.sectionGap;
  }

  /** 追加单个适合触摸的全宽按钮。 */
  public button(
    testId: string,
    label: string,
    options: {
      readonly tone: UiTone;
      readonly disabled?: boolean;
      readonly lockedAppearance?: boolean;
      readonly onClick: () => void;
    },
  ): void {
    this.factory.button(this.page.content, {
      testId,
      label,
      x: 0,
      y: this.currentY,
      width: this.page.contentWidth,
      height: resolveButtonHeight(this.config, [label]),
      tone: options.tone,
      disabled: options.disabled,
      lockedAppearance: options.lockedAppearance,
      fontSize: this.config.typography.caption_size,
      wordWrap: true,
      onClick: options.onClick,
    });
    this.currentY += resolveButtonHeight(this.config, [label]) +
      this.layout.sectionGap;
  }

  /** 追加一组按当前断点分列的等高按钮。 */
  public buttonGrid(
    testIdPrefix: string,
    items: readonly FlowButtonItem[],
  ): void {
    if (items.length === 0) {
      return;
    }
    const columns = Math.max(1, this.layout.optionColumns);
    const gap = this.config.layout.page.option_gap;
    const width =
      (this.page.contentWidth - gap * (columns - 1)) / columns;
    const rows = Math.ceil(items.length / columns);
    for (let row = 0; row < rows; row += 1) {
      const rowItems = items.slice(row * columns, (row + 1) * columns);
      const height = resolveButtonHeight(
        this.config,
        rowItems.map((item) => item.label),
      );
      rowItems.forEach((item, column) => {
        this.factory.button(this.page.content, {
          testId: `${testIdPrefix}-${item.id}`,
          label: item.label,
          x: column * (width + gap),
          y: this.currentY,
          width,
          height,
          tone: item.tone,
          disabled: item.disabled,
          lockedAppearance: item.lockedAppearance,
          fontSize: this.config.typography.caption_size,
          wordWrap: true,
          onClick: item.onClick,
        });
      });
      this.currentY += height + gap;
    }
    this.currentY += Math.max(0, this.layout.sectionGap - gap);
  }

  /** 把完成的流式内容高度提交给通用滚动区。 */
  public finish(): void {
    this.page.scroll.setContentHeight(
      Math.max(0, this.currentY - this.layout.sectionGap) +
        this.layout.sectionGap,
    );
  }
}

/** 流式网格中不携带领域语义的按钮。 */
interface FlowButtonItem {
  readonly id: string;
  readonly label: string;
  readonly tone: UiTone;
  readonly disabled?: boolean;
  readonly lockedAppearance?: boolean;
  readonly onClick: () => void;
}

/** 创建报纸、书籍等文献分类的收集总览页。 */
export function createArchiveStoragePage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  view: UiArchiveStoragePageView,
  actions: ArchiveStoragePageActions,
): PageScaffold {
  const page = createBackPage(
    runtime,
    factory,
    config,
    layout,
    "page-archive-storage",
    view.title,
    view.backLabel,
    actions.back,
  );
  const flow = new PageFlow(factory, config, layout, page);
  flow.paragraph("page-archive-storage-body", view.body);
  if (view.collections.length === 0) {
    flow.paragraph("page-archive-storage-empty", view.emptyText, "muted");
  }
  view.collections.forEach((collection) => {
    const prefix = `page-archive-storage-collection-${collection.collectionId}`;
    flow.section(`${prefix}-title`, collection.label);
    flow.paragraph(`${prefix}-description`, collection.description);
    flow.paragraph(
      `${prefix}-progress`,
      [collection.collectedCopiesText, collection.unlockedDocumentsText].join("\n"),
      "muted",
    );
    flow.button(`${prefix}-open`, collection.actionLabel, {
      tone: collection.tone,
      onClick: (): void => {
        actions.openCollection(collection.collectionId);
      },
    });
  });
  flow.finish();
  return page;
}

/** 创建单一文献分类目录，锁定项仍可进入需求说明。 */
export function createArchiveCollectionPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  view: UiArchiveCollectionPageView,
  actions: ArchiveCollectionPageActions,
): PageScaffold {
  const page = createBackPage(
    runtime,
    factory,
    config,
    layout,
    "page-archive-collection",
    view.title,
    view.backLabel,
    actions.back,
  );
  const flow = new PageFlow(factory, config, layout, page);
  flow.paragraph("page-archive-collection-body", view.body);
  flow.paragraph(
    "page-archive-collection-copies",
    view.collectedCopiesText,
    "muted",
  );
  if (view.documents.length === 0) {
    flow.paragraph("page-archive-collection-empty", view.emptyText, "muted");
  }
  view.documents.forEach((document) => {
    renderArchiveDocumentEntry(flow, document, actions);
  });
  flow.finish();
  return page;
}

/** 创建已解锁文献的长正文阅读页。 */
export function createArchiveDocumentPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  view: UiArchiveDocumentPageView,
  onBack: () => void,
): PageScaffold {
  const page = createBackPage(
    runtime,
    factory,
    config,
    layout,
    "page-archive-document",
    view.title,
    view.backLabel,
    onBack,
  );
  const flow = new PageFlow(factory, config, layout, page);
  flow.paragraph(
    "page-archive-document-metadata",
    view.metadataLines.join("\n"),
    "muted",
  );
  flow.paragraph("page-archive-document-body", view.body);
  flow.finish();
  return page;
}

/** 创建三场配置化遭遇的选择目录。 */
export function createEncounterCatalogPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  view: UiEncounterCatalogPageView,
  actions: EncounterCatalogPageActions,
): PageScaffold {
  const page = createBackPage(
    runtime,
    factory,
    config,
    layout,
    "page-encounter-catalog",
    view.title,
    view.backLabel,
    actions.back,
  );
  const flow = new PageFlow(factory, config, layout, page);
  flow.paragraph("page-encounter-catalog-body", view.body);
  if (view.encounters.length === 0) {
    flow.paragraph("page-encounter-catalog-empty", view.emptyText, "muted");
  }
  view.encounters.forEach((encounter) => {
    const prefix = `page-encounter-catalog-${encounter.encounterId}`;
    flow.section(`${prefix}-title`, encounter.name);
    flow.paragraph(`${prefix}-description`, encounter.description);
    flow.paragraph(
      `${prefix}-intel`,
      [encounter.enemyRosterText, encounter.threatText].join("\n"),
      "muted",
    );
    flow.paragraph(
      `${prefix}-requirement`,
      encounter.available ? "" : encounter.unavailableReason,
      "warning",
    );
    flow.button(`${prefix}-start`, encounter.actionLabel, {
      tone: encounter.tone,
      disabled: !encounter.available,
      onClick: (): void => {
        actions.prepareEncounter(encounter.encounterId);
      },
    });
  });
  flow.finish();
  return page;
}

/** 创建职责分配、医疗补给和显式开战组成的战前整备页。 */
export function createEncounterPreparationPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  view: UiEncounterPreparationPageView,
  actions: EncounterPreparationPageActions,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-encounter-preparation",
    view.title,
    actions.back,
    [
      {
        id: "back",
        testId: "page-encounter-preparation-back",
        label: view.backLabel,
        onClick: actions.back,
      },
      {
        id: "start",
        testId: "page-encounter-preparation-start",
        label: view.startLabel,
        tone: "primary",
        disabled: !view.canStart,
        onClick: actions.startBattle,
      },
    ],
  );
  const flow = new PageFlow(factory, config, layout, page);
  flow.paragraph("page-encounter-preparation-body", view.body);
  flow.paragraph("page-encounter-preparation-supply", view.supplyText, "muted");
  flow.paragraph(
    "page-encounter-preparation-requirement",
    view.requirementText,
    view.canStart ? "body" : "warning",
  );
  flow.section("page-encounter-preparation-roster-title", view.rosterTitle);
  view.members.forEach((member) => {
    const prefix = `page-encounter-preparation-member-${member.memberId}`;
    flow.section(`${prefix}-title`, `${member.name} · ${member.healthText}`);
    flow.paragraph(`${prefix}-attributes`, member.attributeText, "muted");
    flow.paragraph(`${prefix}-assignment`, member.assignedRoleText);
    flow.buttonGrid(
      `${prefix}-role`,
      member.roles.map((role) => ({
        id: role.roleId,
        label: role.label,
        tone: role.tone,
        onClick: (): void => {
          actions.selectRole(member.memberId, role.roleId);
        },
      })),
    );
    flow.paragraph(`${prefix}-role-detail`, member.assignedRoleDetailText, "muted");
    flow.button(`${prefix}-treatment`, member.treatmentLabel, {
      tone: member.treatmentTone,
      disabled: !member.treatmentAvailable,
      onClick: (): void => {
        actions.toggleTreatment(member.memberId);
      },
    });
    flow.paragraph(
      `${prefix}-treatment-status`,
      member.treatmentStatusText,
      member.treatmentAvailable ? "muted" : "warning",
    );
  });
  flow.finish();
  return page;
}

/** 创建前后排可视、逐人手动下令的回合制遭遇战页。 */
export function createEncounterBattlePage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  view: UiEncounterBattlePageView,
  actions: EncounterBattlePageActions,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-encounter-battle",
    view.title,
    actions.back,
    [
      {
        id: "back",
        testId: "page-encounter-battle-back",
        label: view.backLabel,
        onClick: actions.back,
      },
      {
        id: "execute",
        testId: "page-encounter-battle-execute",
        label: view.executeLabel,
        tone: "primary",
        disabled: !view.canExecute,
        onClick: actions.execute,
      },
    ],
  );
  const flow = new PageFlow(factory, config, layout, page);
  flow.paragraph(
    "page-encounter-battle-summary",
    [
      view.encounterDescription,
      view.roundText,
      view.outcomeText,
      view.instruction,
    ].filter((text) => text.length > 0).join("\n\n"),
  );
  renderCombatantSide(
    flow,
    "party",
    view.partyTitle,
    view.party,
    view.rowLabels,
    view.emptyPartyText,
    actions.selectPartyMember,
  );
  renderCombatantSide(
    flow,
    "enemy",
    view.enemyTitle,
    view.enemies,
    view.rowLabels,
    view.emptyEnemyText,
    actions.selectEnemy,
  );
  flow.section("page-encounter-battle-intents-title", view.enemyIntentTitle);
  if (view.enemyIntents.length === 0) {
    flow.paragraph(
      "page-encounter-battle-intents-empty",
      view.emptyIntentText,
      "muted",
    );
  } else {
    view.enemyIntents.forEach((intent) => {
      flow.paragraph(
        `page-encounter-battle-intent-${intent.enemyId}`,
        `${intent.enemyName}\n${intent.label}\n${intent.description}`,
        "warning",
      );
    });
  }
  flow.section("page-encounter-battle-pending-title", view.pendingTitle);
  flow.paragraph("page-encounter-battle-pending", view.pendingText, "muted");
  flow.section("page-encounter-battle-actions-title", view.actionTitle);
  if (view.actions.length === 0) {
    flow.paragraph(
      "page-encounter-battle-actions-empty",
      view.emptyActionText,
      "muted",
    );
  } else {
    flow.buttonGrid(
      "page-encounter-battle-action",
      view.actions.map((action) => battleActionButton(action, actions)),
    );
    flow.paragraph(
      "page-encounter-battle-action-detail",
      view.selectedActionDetailText,
      "muted",
    );
  }
  flow.section("page-encounter-battle-targets-title", view.targetTitle);
  if (view.targets.length === 0) {
    flow.paragraph(
      "page-encounter-battle-targets-empty",
      view.emptyTargetText,
      "muted",
    );
  } else {
    flow.buttonGrid(
      "page-encounter-battle-target",
      view.targets.map((target) => battleTargetButton(target, actions)),
    );
  }
  flow.section("page-encounter-battle-log-title", view.logTitle);
  flow.paragraph(
    "page-encounter-battle-log",
    view.logEntries.length === 0
      ? view.emptyLogText
      : view.logEntries.join("\n"),
    view.logEntries.length === 0 ? "muted" : "body",
  );
  flow.finish();
  return page;
}

/** 创建探索归来后不可略过或可暂缓的事项决策页。 */
export function createReturnIncidentPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  view: UiReturnIncidentPageView,
  actions: ReturnIncidentPageActions,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-return-incident",
    view.title,
    actions.defer,
    [
      {
        id: "defer",
        testId: "page-return-incident-defer",
        label: view.deferLabel,
        disabled: !view.canDefer,
        onClick: actions.defer,
      },
    ],
  );
  const flow = new PageFlow(factory, config, layout, page);
  flow.paragraph("page-return-incident-body", view.body);
  flow.section("page-return-incident-choice-title", view.choiceTitle);
  if (view.choices.length === 0) {
    flow.paragraph(
      "page-return-incident-choice-empty",
      view.emptyChoiceText,
      "muted",
    );
  }
  view.choices.forEach((choice) => {
    renderIncidentChoice(flow, choice, actions);
  });
  flow.finish();
  return page;
}

/** 创建仅含一个配置化返回动作的通用页骨架。 */
function createBackPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  testId: string,
  title: string,
  backLabel: string,
  onBack: () => void,
): PageScaffold {
  return new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    testId,
    title,
    onBack,
    [
      {
        id: "back",
        testId: `${testId}-back`,
        label: backLabel,
        onClick: onBack,
      },
    ],
  );
}

/** 绘制一篇文献的标题、概要、需求和查看动作。 */
function renderArchiveDocumentEntry(
  flow: PageFlow,
  document: UiArchiveDocumentListItemView,
  actions: ArchiveCollectionPageActions,
): void {
  const prefix = `page-archive-collection-document-${document.documentId}`;
  flow.section(`${prefix}-title`, document.title);
  flow.paragraph(`${prefix}-summary`, document.summary);
  flow.paragraph(
    `${prefix}-requirement`,
    document.requirementText,
    document.unlocked ? "muted" : "warning",
  );
  flow.button(`${prefix}-open`, document.actionLabel, {
    tone: document.tone,
    lockedAppearance: !document.unlocked,
    onClick: (): void => {
      actions.openDocument(document.documentId, document.unlocked);
    },
  });
}

/** 按前排、后排分组绘制一侧战斗单位。 */
function renderCombatantSide(
  flow: PageFlow,
  sideId: "party" | "enemy",
  title: string,
  combatants: readonly UiEncounterCombatantView[],
  rowLabels: UiEncounterBattlePageView["rowLabels"],
  emptyText: string,
  onSelect: (combatantId: string) => void,
): void {
  flow.section(`page-encounter-battle-${sideId}-title`, title);
  if (combatants.length === 0) {
    flow.paragraph(
      `page-encounter-battle-${sideId}-empty`,
      emptyText,
      "muted",
    );
    return;
  }
  (["front", "back"] as const).forEach((row) => {
    const rowCombatants = combatants.filter((combatant) => combatant.row === row);
    if (rowCombatants.length === 0) {
      return;
    }
    flow.paragraph(
      `page-encounter-battle-${sideId}-${row}-label`,
      rowLabels[row],
      "muted",
    );
    flow.buttonGrid(
      `page-encounter-battle-${sideId}-${row}`,
      rowCombatants.map((combatant) => combatantButton(combatant, onSelect)),
    );
  });
}

/** 把一名战斗单位转换为网格按钮。 */
function combatantButton(
  combatant: UiEncounterCombatantView,
  onSelect: (combatantId: string) => void,
): FlowButtonItem {
  return {
    id: combatant.combatantId,
    label: [combatant.name, combatant.healthText, combatant.statusText].join("\n"),
    tone: combatant.selected ? "primary" : combatant.tone,
    disabled: !combatant.selectable,
    onClick: (): void => {
      onSelect(combatant.combatantId);
    },
  };
}

/** 把一项攻击、防御、技能、道具或撤退指令转换为按钮。 */
function battleActionButton(
  action: UiEncounterActionView,
  actions: EncounterBattlePageActions,
): FlowButtonItem {
  return {
    id: action.actionId,
    label: [action.categoryLabel, action.label, action.availabilityText].join("\n"),
    tone: action.selected ? "primary" : action.tone,
    disabled: !action.available,
    onClick: (): void => {
      actions.selectAction(action.actionId);
    },
  };
}

/** 把一个友方或敌方目标转换为选择按钮。 */
function battleTargetButton(
  target: UiEncounterTargetView,
  actions: EncounterBattlePageActions,
): FlowButtonItem {
  return {
    id: target.targetId,
    label: [target.label, target.description].join("\n"),
    tone: target.selected ? "primary" : target.tone,
    disabled: !target.available,
    onClick: (): void => {
      actions.selectTarget(target.targetId);
    },
  };
}

/** 绘制一项归来事项选择的后果情报与决策按钮。 */
function renderIncidentChoice(
  flow: PageFlow,
  choice: UiReturnIncidentChoiceView,
  actions: ReturnIncidentPageActions,
): void {
  const prefix = `page-return-incident-choice-${choice.choiceId}`;
  flow.section(`${prefix}-title`, choice.label);
  flow.paragraph(`${prefix}-description`, choice.description);
  flow.paragraph(
    `${prefix}-requirement`,
    choice.requirementText,
    choice.available ? "muted" : "warning",
  );
  flow.paragraph(`${prefix}-preview`, choice.resultPreviewText, "muted");
  flow.button(`${prefix}-select`, choice.label, {
    tone: choice.tone,
    disabled: !choice.available,
    onClick: (): void => {
      actions.choose(choice.choiceId);
    },
  });
}

/** 按配置字号与显式换行数计算网格行的最小按钮高度。 */
export function resolveDemoButtonHeight(
  config: GameUiConfig,
  labels: readonly string[],
): number {
  return resolveButtonHeight(config, labels);
}

/** 计算等高按钮所需的配置化高度。 */
function resolveButtonHeight(
  config: GameUiConfig,
  labels: readonly string[],
): number {
  const maximumLines = Math.max(
    1,
    ...labels.map((label) => Math.max(1, label.split(/\r?\n/u).length)),
  );
  return config.controls.button_height +
    (maximumLines - 1) * config.typography.body_line_height;
}
