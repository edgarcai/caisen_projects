import type { NumericEffectConfig } from "./content";

/** 战场中的站位；前排存活时会保护后排免受单体攻击。 */
export type EncounterBattleRow = "front" | "back";

/** 遭遇战当前结局。 */
export type EncounterBattleOutcome = "ongoing" | "victory" | "defeat" | "retreated";

/** 技能或物品可选择的目标范围。 */
export type EncounterTargetScope =
  | "enemy_single"
  | "enemy_all"
  | "ally_single"
  | "self";

/** 技能与物品支持的基础效果类型。 */
export type EncounterAbilityKind = "damage" | "heal";

/** 敌人下一回合公开的行动类型。 */
export type EncounterEnemyIntentKind = "attack_single" | "attack_all" | "defend";

/** 遭遇战统一数值规则。 */
export interface EncounterBattleRulesConfig {
  readonly maximum_party_size: number;
  readonly minimum_damage: number;
  readonly maximum_log_entries: number;
  readonly basic_attack_power_percent: number;
  readonly critical_roll_range: readonly [number, number];
  readonly critical_chance_percent: number;
  readonly critical_damage_percent: number;
  readonly guard_damage_reduction_percent: number;
  readonly back_row_damage_received_percent: number;
  readonly retreat_roll_range: readonly [number, number];
  readonly retreat_base_chance_percent: number;
  readonly retreat_agility_bonus_percent_per_point: number;
  readonly retreat_maximum_chance_percent: number;
}

/** 战前可为一名单位选择的配置化职责。 */
export interface EncounterRoleConfig {
  readonly role_id: string;
  readonly label: string;
  readonly description: string;
  readonly row: EncounterBattleRow;
  readonly attack_percent: number;
  readonly defense_percent: number;
  readonly agility_percent: number;
}

/** 战前职责和医疗补给的统一规则。 */
export interface EncounterPreparationConfig {
  readonly minimum_attribute: number;
  readonly treatment_cost: number;
  readonly treatment_heal: number;
  readonly roles: readonly EncounterRoleConfig[];
}

/** 玩家可装备的一项遭遇战技能。 */
export interface EncounterSkillConfig {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: EncounterAbilityKind;
  readonly target_scope: EncounterTargetScope;
  readonly power_percent: number;
  readonly fixed_amount: number;
  readonly cooldown_rounds: number;
}

/** 一场遭遇战可携带并消耗的战斗物品。 */
export interface EncounterItemConfig {
  readonly item_id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: EncounterAbilityKind;
  readonly target_scope: EncounterTargetScope;
  readonly power_percent: number;
  readonly fixed_amount: number;
  /** 每场遭遇开始时提供的战术库存数量。 */
  readonly starting_quantity: number;
}

/** 敌人可抽取且提前公开的一种意图。 */
export interface EncounterEnemyIntentConfig {
  readonly intent_id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: EncounterEnemyIntentKind;
  readonly power_percent: number;
  readonly weight: number;
}

/** 一种敌人模板及其可公开意图。 */
export interface EncounterEnemyConfig {
  readonly enemy_id: string;
  readonly name: string;
  readonly row: EncounterBattleRow;
  readonly maximum_health: number;
  readonly attack: number;
  readonly defense: number;
  readonly agility: number;
  readonly intents: readonly EncounterEnemyIntentConfig[];
}

/** 可由探索流程触发的一场遭遇。 */
export interface EncounterDefinitionConfig {
  readonly encounter_id: string;
  readonly name: string;
  readonly description: string;
  readonly enemies: readonly EncounterEnemyConfig[];
}

/** 遭遇战需要的全部配置内容。 */
export interface EncounterBattleConfig {
  readonly rules: EncounterBattleRulesConfig;
  readonly preparation: EncounterPreparationConfig;
  readonly texts: Readonly<Record<string, string>>;
  readonly skills: readonly EncounterSkillConfig[];
  readonly items: readonly EncounterItemConfig[];
  readonly encounters: readonly EncounterDefinitionConfig[];
}

/** 开战时由所长与伙伴资料投影出的队员。 */
export interface EncounterPartyMemberInput {
  readonly member_id: string;
  readonly name: string;
  readonly row: EncounterBattleRow;
  readonly maximum_health: number;
  readonly health?: number;
  readonly attack: number;
  readonly defense: number;
  readonly agility: number;
  readonly skill_ids: readonly string[];
}

/** 战前整备页使用的单位快照，生命值已经归一为必填字段。 */
export interface EncounterPreparationMember
  extends Omit<EncounterPartyMemberInput, "health"> {
  readonly health: number;
}

/** 一场遭遇在开战前可读取的职责、单位与医疗库存。 */
export interface EncounterPreparationSnapshot {
  readonly encounter_id: string;
  readonly encounter_name: string;
  readonly encounter_description: string;
  readonly members: readonly EncounterPreparationMember[];
  readonly roles: readonly EncounterRoleConfig[];
  readonly medical_supplies: number;
  readonly treatment_cost: number;
  readonly treatment_heal: number;
}

/** UI 在点击开始战斗时一次性提交的完整整备方案。 */
export interface EncounterPreparationPlan {
  readonly role_ids_by_member: Readonly<Record<string, string>>;
  readonly treated_member_ids: readonly string[];
}

/** 战斗中的友方单位状态。 */
export interface EncounterPartyMemberState extends EncounterPartyMemberInput {
  health: number;
  guarding: boolean;
  skill_cooldowns: Record<string, number>;
}

/** 战斗中的敌方单位状态。 */
export interface EncounterEnemyState {
  readonly enemy_id: string;
  readonly name: string;
  readonly row: EncounterBattleRow;
  readonly maximum_health: number;
  health: number;
  readonly attack: number;
  readonly defense: number;
  readonly agility: number;
  guarding: boolean;
  intent_id: string;
}

/** 一条带回合标记的战斗通讯。 */
export interface EncounterBattleLogEntry {
  readonly round_number: number;
  readonly message: string;
}

/** 可以独立保存、恢复和交给任意 UI 展示的遭遇战快照。 */
export interface EncounterBattleState {
  readonly encounter_id: string;
  readonly encounter_name: string;
  round_number: number;
  outcome: EncounterBattleOutcome;
  party: EncounterPartyMemberState[];
  enemies: EncounterEnemyState[];
  pending_party_member_ids: string[];
  supplies: Record<string, number>;
  log: EncounterBattleLogEntry[];
}

/** 玩家一次手动选择的战斗指令。 */
export type EncounterBattleCommand =
  | { readonly action: "attack"; readonly actor_id: string; readonly target_id: string }
  | { readonly action: "guard"; readonly actor_id: string }
  | {
      readonly action: "skill";
      readonly actor_id: string;
      readonly ability_id: string;
      readonly target_id?: string;
    }
  | {
      readonly action: "item";
      readonly actor_id: string;
      readonly ability_id: string;
      readonly target_id?: string;
    }
  | { readonly action: "retreat"; readonly actor_id: string };

/** UI 可直接渲染的一项战斗行动状态。 */
export interface EncounterAvailableAction {
  readonly action: EncounterBattleCommand["action"];
  readonly abilityId: string | null;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly unavailableReason: string;
  readonly targetIds: readonly string[];
}

/** UI 可提前展示的一项敌方行动意图。 */
export interface EncounterEnemyIntentView {
  readonly enemyId: string;
  readonly enemyName: string;
  readonly intentId: string;
  readonly label: string;
  readonly description: string;
}

/** 一次玩家选择及可能发生的敌方阶段结算。 */
export interface EncounterBattleResolution {
  readonly state: EncounterBattleState;
  readonly messages: readonly string[];
  readonly roundAdvanced: boolean;
}

/** 归来事项选择的数值条件。 */
export interface ReturnIncidentRequirementConfig {
  readonly target: string;
  readonly operator: "gte" | "lte" | "gt" | "lt" | "eq";
  readonly value: number;
  readonly unavailable_text: string;
}

/** 归来事项中的一项玩家抉择。 */
export interface ReturnIncidentChoiceConfig {
  readonly choice_id: string;
  readonly label: string;
  readonly description: string;
  readonly requirements: readonly ReturnIncidentRequirementConfig[];
  readonly effects: readonly NumericEffectConfig[];
  readonly result: string;
}

/** 探索归来后可能抽取的一项避难所事件。 */
export interface ReturnIncidentConfig {
  readonly incident_id: string;
  readonly title: string;
  readonly description: string;
  readonly weight: number;
  readonly requirements: readonly ReturnIncidentRequirementConfig[];
  readonly choices: readonly ReturnIncidentChoiceConfig[];
}

/** 配置化状态上下界，用于阻止事项效果破坏领域状态。 */
export interface ReturnIncidentStateBoundConfig {
  readonly target: string;
  readonly minimum: number;
  readonly maximum: number | null;
}

/** 探索归来随机事项的全部配置。 */
export interface ReturnIncidentSystemConfig {
  readonly trigger_roll_range: readonly [number, number];
  readonly trigger_chance_percent: number;
  readonly state_bounds: readonly ReturnIncidentStateBoundConfig[];
  readonly texts: Readonly<Record<string, string>>;
  readonly incidents: readonly ReturnIncidentConfig[];
}

/** UI 展示的一项可用或灰显事项选择。 */
export interface ReturnIncidentChoiceView {
  readonly choiceId: string;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
  readonly unavailableReason: string;
}

/** 一次尚未结算的探索归来事项。 */
export interface ReturnIncidentPrompt {
  readonly incidentId: string;
  readonly title: string;
  readonly description: string;
  readonly choices: readonly ReturnIncidentChoiceView[];
}

/** 归来事项应用到主状态后的结算摘要。 */
export interface ReturnIncidentResolution {
  readonly incidentId: string;
  readonly choiceId: string;
  readonly message: string;
  readonly stateChanged: boolean;
}

/** 文献收藏中的一篇可解锁正文。 */
export interface ArchiveDocumentConfig {
  readonly document_id: string;
  readonly required_copies: number;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}

/** 一类文献及其对应的主状态计数来源。 */
export interface ArchiveCollectionConfig {
  readonly collection_id: string;
  readonly label: string;
  readonly description: string;
  readonly state_target: string;
  readonly documents: readonly ArchiveDocumentConfig[];
}

/** 文献存储系统的全部配置。 */
export interface ArchiveStorageConfig {
  readonly texts: Readonly<Record<string, string>>;
  readonly collections: readonly ArchiveCollectionConfig[];
}

/** Demo 内容目录的可配置最低完整度要求。 */
export interface DemoSystemsContentRequirementsConfig {
  readonly minimum_return_incidents: number;
  readonly minimum_incident_choices: number;
  readonly minimum_archive_collections: number;
  readonly minimum_documents_per_collection: number;
}

/** 存储页面中的一条文献目录记录。 */
export interface ArchiveDocumentListItem {
  readonly documentId: string;
  readonly requiredCopies: number;
  readonly title: string;
  readonly summary: string;
  readonly unlocked: boolean;
}

/** 存储页面中的一种文献完成度。 */
export interface ArchiveCollectionOverview {
  readonly collectionId: string;
  readonly label: string;
  readonly description: string;
  readonly collectedCopies: number;
  readonly unlockedDocuments: number;
  readonly totalDocuments: number;
}

/** 一类文献的收集概览、完整目录与已解锁正文快照。 */
export interface ArchiveLibraryCollectionSnapshot {
  readonly overview: ArchiveCollectionOverview;
  readonly documents: readonly ArchiveDocumentListItem[];
  readonly unlockedDocuments: readonly ArchiveDocumentConfig[];
}

/** 供封面和局内页面共用的只读文献馆藏快照。 */
export interface ArchiveLibrarySnapshot {
  readonly collections: readonly ArchiveLibraryCollectionSnapshot[];
}

/** 三个 Demo 领域能力共用的顶层配置文档。 */
export interface DemoSystemsConfig {
  readonly schema_version: number;
  readonly content_requirements: DemoSystemsContentRequirementsConfig;
  readonly encounter_battle: EncounterBattleConfig;
  readonly return_incidents: ReturnIncidentSystemConfig;
  readonly archive_storage: ArchiveStorageConfig;
}
