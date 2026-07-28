import type {
  EncounterAvailableAction,
  EncounterBattleState,
  EncounterBattleOutcome,
  EncounterBattleRow,
  EncounterBattleCommand,
  EncounterEnemyIntentView,
  EncounterPreparationSnapshot,
} from "../../domain/demo-systems";
import type { UiTone } from "../ports/GameUiPort";

const ARCHIVE_DOCUMENT_KEY_SEPARATOR = "::";

/** 为快照中的文献正文生成无冲突稳定键。 */
export function archiveDocumentViewKey(
  collectionId: string,
  documentId: string,
): string {
  return `${collectionId}${ARCHIVE_DOCUMENT_KEY_SEPARATOR}${documentId}`;
}

/** 文献存储首页中的一类可收集档案。 */
export interface UiArchiveCollectionOverviewView {
  readonly collectionId: string;
  readonly label: string;
  readonly description: string;
  readonly collectedCopiesText: string;
  readonly unlockedDocumentsText: string;
  readonly actionLabel: string;
  readonly tone: UiTone;
}

/** 文献存储分类总览页的完整展示快照。 */
export interface UiArchiveStoragePageView {
  readonly title: string;
  readonly body: string;
  readonly emptyText: string;
  readonly backLabel: string;
  readonly collections: readonly UiArchiveCollectionOverviewView[];
}

/** 分类目录中的一篇已解锁或待解锁文献。 */
export interface UiArchiveDocumentListItemView {
  readonly documentId: string;
  readonly title: string;
  readonly summary: string;
  readonly requirementText: string;
  readonly actionLabel: string;
  readonly unlocked: boolean;
  readonly tone: UiTone;
}

/** 单一文献分类的目录页快照。 */
export interface UiArchiveCollectionPageView {
  readonly collectionId: string;
  readonly title: string;
  readonly body: string;
  readonly collectedCopiesText: string;
  readonly emptyText: string;
  readonly backLabel: string;
  readonly documents: readonly UiArchiveDocumentListItemView[];
}

/** 一篇可滚动阅读的已解锁档案正文。 */
export interface UiArchiveDocumentPageView {
  readonly documentId: string;
  readonly title: string;
  readonly metadataLines: readonly string[];
  readonly body: string;
  readonly backLabel: string;
}

/** 遭遇目录中可手动开战的一场配置化战斗。 */
export interface UiEncounterCatalogItemView {
  readonly encounterId: string;
  readonly name: string;
  readonly description: string;
  readonly enemyRosterText: string;
  readonly threatText: string;
  readonly actionLabel: string;
  readonly available: boolean;
  readonly unavailableReason: string;
  readonly tone: UiTone;
}

/** 无进行中战斗时展示的遭遇目录快照。 */
export interface UiEncounterCatalogPageView {
  readonly title: string;
  readonly body: string;
  readonly emptyText: string;
  readonly backLabel: string;
  readonly encounters: readonly UiEncounterCatalogItemView[];
}

/** 应用快照向战前整备页提供的领域只读数据。 */
export interface UiEncounterPreparationRuntimeView {
  readonly preparation: EncounterPreparationSnapshot;
}

/** 战前整备页中一个可选择的单位职责。 */
export interface UiEncounterPreparationRoleView {
  readonly roleId: string;
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
  readonly tone: UiTone;
}

/** 战前整备页中的单个参战单位及其当前草稿。 */
export interface UiEncounterPreparationMemberView {
  readonly memberId: string;
  readonly name: string;
  readonly healthText: string;
  readonly attributeText: string;
  readonly assignedRoleText: string;
  readonly assignedRoleDetailText: string;
  readonly roles: readonly UiEncounterPreparationRoleView[];
  readonly treatmentLabel: string;
  readonly treatmentStatusText: string;
  readonly treatmentAvailable: boolean;
  readonly treatmentSelected: boolean;
  readonly treatmentTone: UiTone;
}

/** 可滚动选择职责、战前治疗并显式开战的完整页面快照。 */
export interface UiEncounterPreparationPageView {
  readonly title: string;
  readonly body: string;
  readonly supplyText: string;
  readonly rosterTitle: string;
  readonly requirementText: string;
  readonly members: readonly UiEncounterPreparationMemberView[];
  readonly backLabel: string;
  readonly startLabel: string;
  readonly canStart: boolean;
}

/** 应用快照向战斗页提供的领域只读数据，具体选中态留在页面栈。 */
export interface UiEncounterBattleRuntimeView {
  readonly state: EncounterBattleState;
  readonly encounterDescription: string;
  readonly actionsByActor: Readonly<
    Record<string, readonly EncounterAvailableAction[]>
  >;
  readonly enemyIntents: readonly EncounterEnemyIntentView[];
}

/** 遭遇战中的一名我方或敌方战斗单位。 */
export interface UiEncounterCombatantView {
  readonly combatantId: string;
  readonly name: string;
  readonly row: EncounterBattleRow;
  readonly healthText: string;
  readonly statusText: string;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly tone: UiTone;
}

/** 敌人在下一回合会执行的公开意图。 */
export interface UiEncounterEnemyIntentView {
  readonly enemyId: string;
  readonly enemyName: string;
  readonly label: string;
  readonly description: string;
}

/** 当前待行动队员可以选择的一项手动指令。 */
export interface UiEncounterActionView {
  readonly actionId: string;
  readonly kind: EncounterBattleCommand["action"];
  readonly categoryLabel: string;
  readonly label: string;
  readonly description: string;
  readonly availabilityText: string;
  readonly available: boolean;
  readonly selected: boolean;
  readonly tone: UiTone;
  readonly targetIds: readonly string[];
}

/** 选中战斗指令后可以指定的一个目标。 */
export interface UiEncounterTargetView {
  readonly targetId: string;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly selected: boolean;
  readonly tone: UiTone;
}

/** 可交互的手动回合制遭遇战页快照。 */
export interface UiEncounterBattlePageView {
  readonly title: string;
  readonly encounterDescription: string;
  readonly roundText: string;
  readonly outcome: EncounterBattleOutcome;
  readonly outcomeText: string;
  readonly instruction: string;
  readonly partyTitle: string;
  readonly enemyTitle: string;
  readonly rowLabels: Readonly<Record<EncounterBattleRow, string>>;
  readonly emptyPartyText: string;
  readonly emptyEnemyText: string;
  readonly party: readonly UiEncounterCombatantView[];
  readonly enemies: readonly UiEncounterCombatantView[];
  readonly enemyIntentTitle: string;
  readonly emptyIntentText: string;
  readonly enemyIntents: readonly UiEncounterEnemyIntentView[];
  readonly pendingTitle: string;
  readonly pendingText: string;
  readonly actionTitle: string;
  readonly emptyActionText: string;
  readonly selectedActionDetailText: string;
  readonly actions: readonly UiEncounterActionView[];
  readonly targetTitle: string;
  readonly emptyTargetText: string;
  readonly targets: readonly UiEncounterTargetView[];
  readonly logTitle: string;
  readonly emptyLogText: string;
  readonly logEntries: readonly string[];
  readonly backLabel: string;
  readonly executeLabel: string;
  readonly canExecute: boolean;
}

/** 探索归来后一项可用或条件不足的决策。 */
export interface UiReturnIncidentChoiceView {
  readonly choiceId: string;
  readonly label: string;
  readonly description: string;
  readonly requirementText: string;
  readonly resultPreviewText: string;
  readonly available: boolean;
  readonly tone: UiTone;
}

/** 探索归来事项的决策页快照。 */
export interface UiReturnIncidentPageView {
  readonly incidentId: string;
  readonly title: string;
  readonly body: string;
  readonly choiceTitle: string;
  readonly emptyChoiceText: string;
  readonly deferLabel: string;
  readonly canDefer: boolean;
  readonly choices: readonly UiReturnIncidentChoiceView[];
}
