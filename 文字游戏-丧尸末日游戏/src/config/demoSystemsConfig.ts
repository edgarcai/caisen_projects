import demoSystemsDocument from "../../config/demo_systems.json";
import type { NumericEffectConfig } from "../domain/content";
import type {
  ArchiveCollectionConfig,
  ArchiveDocumentConfig,
  ArchiveStorageConfig,
  DemoSystemsContentRequirementsConfig,
  DemoSystemsConfig,
  EncounterBattleConfig,
  EncounterBattleRulesConfig,
  EncounterDefinitionConfig,
  EncounterEnemyConfig,
  EncounterEnemyIntentConfig,
  EncounterItemConfig,
  EncounterPreparationConfig,
  EncounterRoleConfig,
  EncounterSkillConfig,
  ReturnIncidentChoiceConfig,
  ReturnIncidentConfig,
  ReturnIncidentRequirementConfig,
  ReturnIncidentStateBoundConfig,
  ReturnIncidentSystemConfig,
} from "../domain/demo-systems";
import { DomainError } from "../domain/errors";

type JsonRecord = Readonly<Record<string, unknown>>;

const SUPPORTED_SCHEMA_VERSION = 1;
const BATTLE_ROWS = ["front", "back"] as const;
const ABILITY_KINDS = ["damage", "heal"] as const;
const TARGET_SCOPES = ["enemy_single", "enemy_all", "ally_single", "self"] as const;
const INTENT_KINDS = ["attack_single", "attack_all", "defend"] as const;
const REQUIREMENT_OPERATORS = ["gte", "lte", "gt", "lt", "eq"] as const;
const NUMERIC_OPERATIONS = ["add", "subtract", "set"] as const;

const REQUIRED_BATTLE_TEXT_KEYS = [
  "battle_start",
  "round_start",
  "basic_attack_label",
  "basic_attack_description",
  "guard_label",
  "guard_description",
  "retreat_label",
  "retreat_description",
  "item_action_description",
  "actor_not_pending",
  "cooldown_remaining",
  "item_unavailable",
  "no_valid_target",
  "attack",
  "critical_attack",
  "guard",
  "skill_damage",
  "skill_heal",
  "item_damage",
  "item_heal",
  "enemy_attack",
  "enemy_attack_all",
  "enemy_defend",
  "enemy_defeated",
  "member_defeated",
  "victory",
  "defeat",
  "retreat_success",
  "retreat_failed",
  "battle_finished",
  "battle_in_progress",
  "no_active_battle",
  "battle_closed",
  "unknown_encounter",
  "unknown_actor",
  "unknown_target",
  "unknown_ability",
  "invalid_party",
  "invalid_supply",
  "preparation_missing_role",
  "preparation_unknown_role",
  "preparation_unknown_member",
  "preparation_duplicate_treatment",
  "preparation_treatment_not_needed",
  "preparation_medical_shortage",
  "preparation_ready",
  "preparation_role_assignment",
  "preparation_treated",
] as const;

const REQUIRED_INCIDENT_TEXT_KEYS = [
  "no_eligible_incident",
  "unknown_incident",
  "unknown_choice",
  "choice_unavailable",
  "resolution_prefix",
  "invalid_configuration",
] as const;

const REQUIRED_ARCHIVE_TEXT_KEYS = [
  "locked_title",
  "locked_summary",
  "unknown_collection",
  "unknown_document",
  "document_locked",
] as const;

/** 校验并返回 Demo 三大领域系统的配置文档。 */
export function parseDemoSystemsConfig(source: unknown): DemoSystemsConfig {
  const root = recordValue(source, "demo_systems");
  const schemaVersion = integerValue(root.schema_version, "schema_version", 1);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw configurationError(`不支持 schema_version=${String(schemaVersion)}`);
  }
  const contentRequirements = parseContentRequirements(root.content_requirements);
  return {
    schema_version: schemaVersion,
    content_requirements: contentRequirements,
    encounter_battle: parseEncounterBattle(root.encounter_battle),
    return_incidents: parseReturnIncidents(
      root.return_incidents,
      contentRequirements,
    ),
    archive_storage: parseArchiveStorage(
      root.archive_storage,
      contentRequirements,
    ),
  };
}

/** 解析事项与文献目录的最低内容数量要求。 */
function parseContentRequirements(
  source: unknown,
): DemoSystemsContentRequirementsConfig {
  const value = recordValue(source, "content_requirements");
  return {
    minimum_return_incidents: integerValue(
      value.minimum_return_incidents,
      "content_requirements.minimum_return_incidents",
      1,
    ),
    minimum_incident_choices: integerValue(
      value.minimum_incident_choices,
      "content_requirements.minimum_incident_choices",
      1,
    ),
    minimum_archive_collections: integerValue(
      value.minimum_archive_collections,
      "content_requirements.minimum_archive_collections",
      1,
    ),
    minimum_documents_per_collection: integerValue(
      value.minimum_documents_per_collection,
      "content_requirements.minimum_documents_per_collection",
      1,
    ),
  };
}

/** 解析遭遇战配置并校验所有稳定 ID 与引用。 */
function parseEncounterBattle(source: unknown): EncounterBattleConfig {
  const value = recordValue(source, "encounter_battle");
  const skills = arrayValue(value.skills, "encounter_battle.skills").map(
    (entry, index) => parseSkill(entry, `encounter_battle.skills[${String(index)}]`),
  );
  const items = arrayValue(value.items, "encounter_battle.items").map(
    (entry, index) => parseItem(entry, `encounter_battle.items[${String(index)}]`),
  );
  const encounters = arrayValue(value.encounters, "encounter_battle.encounters").map(
    (entry, index) => parseEncounter(entry, `encounter_battle.encounters[${String(index)}]`),
  );
  requireMinimumLength(skills, 1, "encounter_battle.skills");
  requireMinimumLength(items, 1, "encounter_battle.items");
  requireMinimumLength(encounters, 1, "encounter_battle.encounters");
  requireUnique(skills.map((skill) => skill.skill_id), "skill_id");
  requireUnique(items.map((item) => item.item_id), "item_id");
  requireUnique(encounters.map((encounter) => encounter.encounter_id), "encounter_id");
  requireUnique(
    encounters.flatMap((encounter) => encounter.enemies.map((enemy) => enemy.enemy_id)),
    "enemy_id",
  );
  return {
    rules: parseBattleRules(value.rules),
    preparation: parseEncounterPreparation(value.preparation),
    texts: parseTexts(value.texts, REQUIRED_BATTLE_TEXT_KEYS, "encounter_battle.texts"),
    skills,
    items,
    encounters,
  };
}

/** 解析战前职责与医疗补给规则，并拒绝重复职责 ID。 */
function parseEncounterPreparation(source: unknown): EncounterPreparationConfig {
  const value = recordValue(source, "encounter_battle.preparation");
  const roles = arrayValue(value.roles, "encounter_battle.preparation.roles").map(
    (entry, index) => parseEncounterRole(
      entry,
      `encounter_battle.preparation.roles[${String(index)}]`,
    ),
  );
  requireMinimumLength(roles, 1, "encounter_battle.preparation.roles");
  requireUnique(roles.map((role) => role.role_id), "role_id");
  return {
    minimum_attribute: integerValue(
      value.minimum_attribute,
      "encounter_battle.preparation.minimum_attribute",
      0,
    ),
    treatment_cost: integerValue(
      value.treatment_cost,
      "encounter_battle.preparation.treatment_cost",
      1,
    ),
    treatment_heal: integerValue(
      value.treatment_heal,
      "encounter_battle.preparation.treatment_heal",
      1,
    ),
    roles,
  };
}

/** 解析一个职责对站位和三项战斗属性的配置化修正。 */
function parseEncounterRole(source: unknown, path: string): EncounterRoleConfig {
  const value = recordValue(source, path);
  return {
    role_id: nonEmptyString(value.role_id, `${path}.role_id`),
    label: nonEmptyString(value.label, `${path}.label`),
    description: nonEmptyString(value.description, `${path}.description`),
    row: enumValue(value.row, BATTLE_ROWS, `${path}.row`),
    attack_percent: integerValue(value.attack_percent, `${path}.attack_percent`, 0),
    defense_percent: integerValue(value.defense_percent, `${path}.defense_percent`, 0),
    agility_percent: integerValue(value.agility_percent, `${path}.agility_percent`, 0),
  };
}

/** 解析遭遇战的全部数值规则。 */
function parseBattleRules(source: unknown): EncounterBattleRulesConfig {
  const value = recordValue(source, "encounter_battle.rules");
  return {
    maximum_party_size: integerValue(value.maximum_party_size, "maximum_party_size", 1),
    minimum_damage: integerValue(value.minimum_damage, "minimum_damage", 0),
    maximum_log_entries: integerValue(value.maximum_log_entries, "maximum_log_entries", 1),
    basic_attack_power_percent: integerValue(
      value.basic_attack_power_percent,
      "basic_attack_power_percent",
      0,
    ),
    critical_roll_range: integerPair(value.critical_roll_range, "critical_roll_range"),
    critical_chance_percent: percentage(value.critical_chance_percent, "critical_chance_percent"),
    critical_damage_percent: integerValue(value.critical_damage_percent, "critical_damage_percent", 0),
    guard_damage_reduction_percent: percentage(
      value.guard_damage_reduction_percent,
      "guard_damage_reduction_percent",
    ),
    back_row_damage_received_percent: percentage(
      value.back_row_damage_received_percent,
      "back_row_damage_received_percent",
    ),
    retreat_roll_range: integerPair(value.retreat_roll_range, "retreat_roll_range"),
    retreat_base_chance_percent: percentage(
      value.retreat_base_chance_percent,
      "retreat_base_chance_percent",
    ),
    retreat_agility_bonus_percent_per_point: integerValue(
      value.retreat_agility_bonus_percent_per_point,
      "retreat_agility_bonus_percent_per_point",
      0,
    ),
    retreat_maximum_chance_percent: percentage(
      value.retreat_maximum_chance_percent,
      "retreat_maximum_chance_percent",
    ),
  };
}

/** 解析一项玩家技能。 */
function parseSkill(source: unknown, path: string): EncounterSkillConfig {
  const value = recordValue(source, path);
  return {
    skill_id: nonEmptyString(value.skill_id, `${path}.skill_id`),
    name: nonEmptyString(value.name, `${path}.name`),
    description: nonEmptyString(value.description, `${path}.description`),
    kind: enumValue(value.kind, ABILITY_KINDS, `${path}.kind`),
    target_scope: enumValue(
      value.target_scope,
      TARGET_SCOPES,
      `${path}.target_scope`,
    ),
    power_percent: integerValue(value.power_percent, `${path}.power_percent`, 0),
    fixed_amount: integerValue(value.fixed_amount, `${path}.fixed_amount`, 0),
    cooldown_rounds: integerValue(value.cooldown_rounds, `${path}.cooldown_rounds`, 0),
  };
}

/** 解析一项战斗消耗品。 */
function parseItem(source: unknown, path: string): EncounterItemConfig {
  const value = recordValue(source, path);
  return {
    item_id: nonEmptyString(value.item_id, `${path}.item_id`),
    name: nonEmptyString(value.name, `${path}.name`),
    description: nonEmptyString(value.description, `${path}.description`),
    kind: enumValue(value.kind, ABILITY_KINDS, `${path}.kind`),
    target_scope: enumValue(
      value.target_scope,
      TARGET_SCOPES,
      `${path}.target_scope`,
    ),
    power_percent: integerValue(value.power_percent, `${path}.power_percent`, 0),
    fixed_amount: integerValue(value.fixed_amount, `${path}.fixed_amount`, 0),
    starting_quantity: integerValue(
      value.starting_quantity,
      `${path}.starting_quantity`,
      0,
    ),
  };
}

/** 解析一场遭遇及其敌人模板。 */
function parseEncounter(source: unknown, path: string): EncounterDefinitionConfig {
  const value = recordValue(source, path);
  const enemies = arrayValue(value.enemies, `${path}.enemies`).map(
    (entry, index) => parseEnemy(entry, `${path}.enemies[${String(index)}]`),
  );
  requireMinimumLength(enemies, 1, `${path}.enemies`);
  requireUnique(enemies.map((enemy) => enemy.enemy_id), `${path}.enemy_id`);
  return {
    encounter_id: nonEmptyString(value.encounter_id, `${path}.encounter_id`),
    name: nonEmptyString(value.name, `${path}.name`),
    description: nonEmptyString(value.description, `${path}.description`),
    enemies,
  };
}

/** 解析一种敌人与它可抽取的公开意图。 */
function parseEnemy(source: unknown, path: string): EncounterEnemyConfig {
  const value = recordValue(source, path);
  const intents = arrayValue(value.intents, `${path}.intents`).map(
    (entry, index) => parseEnemyIntent(entry, `${path}.intents[${String(index)}]`),
  );
  requireMinimumLength(intents, 1, `${path}.intents`);
  requireUnique(intents.map((intent) => intent.intent_id), `${path}.intent_id`);
  return {
    enemy_id: nonEmptyString(value.enemy_id, `${path}.enemy_id`),
    name: nonEmptyString(value.name, `${path}.name`),
    row: enumValue(value.row, BATTLE_ROWS, `${path}.row`),
    maximum_health: integerValue(value.maximum_health, `${path}.maximum_health`, 1),
    attack: integerValue(value.attack, `${path}.attack`, 0),
    defense: integerValue(value.defense, `${path}.defense`, 0),
    agility: integerValue(value.agility, `${path}.agility`, 0),
    intents,
  };
}

/** 解析一种敌方行动意图。 */
function parseEnemyIntent(source: unknown, path: string): EncounterEnemyIntentConfig {
  const value = recordValue(source, path);
  return {
    intent_id: nonEmptyString(value.intent_id, `${path}.intent_id`),
    label: nonEmptyString(value.label, `${path}.label`),
    description: nonEmptyString(value.description, `${path}.description`),
    kind: enumValue(
      value.kind,
      INTENT_KINDS,
      `${path}.kind`,
    ),
    power_percent: integerValue(value.power_percent, `${path}.power_percent`, 0),
    weight: integerValue(value.weight, `${path}.weight`, 1),
  };
}

/** 解析探索归来事项并应用配置化内容数量要求。 */
function parseReturnIncidents(
  source: unknown,
  requirements: DemoSystemsContentRequirementsConfig,
): ReturnIncidentSystemConfig {
  const value = recordValue(source, "return_incidents");
  const incidents = arrayValue(value.incidents, "return_incidents.incidents").map(
    (entry, index) => parseIncident(
      entry,
      `return_incidents.incidents[${String(index)}]`,
      requirements.minimum_incident_choices,
    ),
  );
  const bounds = arrayValue(value.state_bounds, "return_incidents.state_bounds").map(
    (entry, index) => parseStateBound(entry, `return_incidents.state_bounds[${String(index)}]`),
  );
  requireMinimumLength(
    incidents,
    requirements.minimum_return_incidents,
    "return_incidents.incidents",
  );
  requireUnique(incidents.map((incident) => incident.incident_id), "incident_id");
  requireUnique(bounds.map((bound) => bound.target), "state_bounds.target");
  return {
    trigger_roll_range: integerPair(value.trigger_roll_range, "trigger_roll_range"),
    trigger_chance_percent: percentage(
      value.trigger_chance_percent,
      "trigger_chance_percent",
    ),
    state_bounds: bounds,
    texts: parseTexts(value.texts, REQUIRED_INCIDENT_TEXT_KEYS, "return_incidents.texts"),
    incidents,
  };
}

/** 解析一个事项、前置条件和全部选择。 */
function parseIncident(
  source: unknown,
  path: string,
  minimumChoices: number,
): ReturnIncidentConfig {
  const value = recordValue(source, path);
  const choices = arrayValue(value.choices, `${path}.choices`).map(
    (entry, index) => parseIncidentChoice(entry, `${path}.choices[${String(index)}]`),
  );
  requireMinimumLength(choices, minimumChoices, `${path}.choices`);
  requireUnique(choices.map((choice) => choice.choice_id), `${path}.choice_id`);
  return {
    incident_id: nonEmptyString(value.incident_id, `${path}.incident_id`),
    title: nonEmptyString(value.title, `${path}.title`),
    description: nonEmptyString(value.description, `${path}.description`),
    weight: integerValue(value.weight, `${path}.weight`, 1),
    requirements: parseRequirements(value.requirements, `${path}.requirements`),
    choices,
  };
}

/** 解析一个事项选择及其原子数值效果。 */
function parseIncidentChoice(source: unknown, path: string): ReturnIncidentChoiceConfig {
  const value = recordValue(source, path);
  return {
    choice_id: nonEmptyString(value.choice_id, `${path}.choice_id`),
    label: nonEmptyString(value.label, `${path}.label`),
    description: nonEmptyString(value.description, `${path}.description`),
    requirements: parseRequirements(value.requirements, `${path}.requirements`),
    effects: arrayValue(value.effects, `${path}.effects`).map(
      (entry, index) => parseNumericEffect(entry, `${path}.effects[${String(index)}]`),
    ),
    result: nonEmptyString(value.result, `${path}.result`),
  };
}

/** 解析一组数值条件。 */
function parseRequirements(
  source: unknown,
  path: string,
): ReturnIncidentRequirementConfig[] {
  return arrayValue(source, path).map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const value = recordValue(entry, itemPath);
    return {
      target: nonEmptyString(value.target, `${itemPath}.target`),
      operator: enumValue(
        value.operator,
        REQUIREMENT_OPERATORS,
        `${itemPath}.operator`,
      ),
      value: integerValue(value.value, `${itemPath}.value`),
      unavailable_text: nonEmptyString(
        value.unavailable_text,
        `${itemPath}.unavailable_text`,
      ),
    };
  });
}

/** 解析状态效果并保留可选结算变量。 */
function parseNumericEffect(source: unknown, path: string): NumericEffectConfig {
  const value = recordValue(source, path);
  const amountValue = value.amount;
  const amount = Array.isArray(amountValue)
    ? integerPair(amountValue, `${path}.amount`)
    : integerValue(amountValue, `${path}.amount`, 0);
  const token = optionalString(value.token, `${path}.token`);
  const limitToAvailable = optionalBoolean(
    value.limit_to_available,
    `${path}.limit_to_available`,
  );
  return {
    target: nonEmptyString(value.target, `${path}.target`),
    operation: enumValue(
      value.operation,
      NUMERIC_OPERATIONS,
      `${path}.operation`,
    ),
    amount,
    ...(token === undefined ? {} : { token }),
    ...(limitToAvailable === undefined
      ? {}
      : { limit_to_available: limitToAvailable }),
  };
}

/** 解析一项状态安全边界。 */
function parseStateBound(source: unknown, path: string): ReturnIncidentStateBoundConfig {
  const value = recordValue(source, path);
  const minimum = integerValue(value.minimum, `${path}.minimum`);
  const maximum = value.maximum === null
    ? null
    : integerValue(value.maximum, `${path}.maximum`, minimum);
  return {
    target: nonEmptyString(value.target, `${path}.target`),
    minimum,
    maximum,
  };
}

/** 解析文献目录并应用配置化分类与正文数量要求。 */
function parseArchiveStorage(
  source: unknown,
  requirements: DemoSystemsContentRequirementsConfig,
): ArchiveStorageConfig {
  const value = recordValue(source, "archive_storage");
  const collections = arrayValue(value.collections, "archive_storage.collections").map(
    (entry, index) => parseArchiveCollection(
      entry,
      `archive_storage.collections[${String(index)}]`,
      requirements.minimum_documents_per_collection,
    ),
  );
  requireMinimumLength(
    collections,
    requirements.minimum_archive_collections,
    "archive_storage.collections",
  );
  requireUnique(collections.map((collection) => collection.collection_id), "collection_id");
  return {
    texts: parseTexts(value.texts, REQUIRED_ARCHIVE_TEXT_KEYS, "archive_storage.texts"),
    collections,
  };
}

/** 解析一类文献并校验解锁份数严格递增。 */
function parseArchiveCollection(
  source: unknown,
  path: string,
  minimumDocuments: number,
): ArchiveCollectionConfig {
  const value = recordValue(source, path);
  const documents = arrayValue(value.documents, `${path}.documents`).map(
    (entry, index) => parseArchiveDocument(entry, `${path}.documents[${String(index)}]`),
  );
  requireMinimumLength(documents, minimumDocuments, `${path}.documents`);
  requireUnique(documents.map((document) => document.document_id), `${path}.document_id`);
  requireUnique(
    documents.map((document) => String(document.required_copies)),
    `${path}.required_copies`,
  );
  const ordered = [...documents].sort((left, right) => (
    left.required_copies - right.required_copies
  ));
  if (documents.some((document, index) => document !== ordered[index])) {
    throw configurationError(`${path}.documents 必须按 required_copies 升序排列`);
  }
  return {
    collection_id: nonEmptyString(value.collection_id, `${path}.collection_id`),
    label: nonEmptyString(value.label, `${path}.label`),
    description: nonEmptyString(value.description, `${path}.description`),
    state_target: nonEmptyString(value.state_target, `${path}.state_target`),
    documents,
  };
}

/** 解析一篇可解锁文献的标题、摘要与正文。 */
function parseArchiveDocument(source: unknown, path: string): ArchiveDocumentConfig {
  const value = recordValue(source, path);
  return {
    document_id: nonEmptyString(value.document_id, `${path}.document_id`),
    required_copies: integerValue(value.required_copies, `${path}.required_copies`, 1),
    title: nonEmptyString(value.title, `${path}.title`),
    summary: nonEmptyString(value.summary, `${path}.summary`),
    body: nonEmptyString(value.body, `${path}.body`),
  };
}

/** 解析字符串文案字典并确保服务依赖的键全部存在。 */
function parseTexts(
  source: unknown,
  requiredKeys: readonly string[],
  path: string,
): Readonly<Record<string, string>> {
  const value = recordValue(source, path);
  const entries = Object.entries(value).map(([key, item]) => [
    key,
    nonEmptyString(item, `${path}.${key}`),
  ] as const);
  const texts = Object.fromEntries(entries) as Readonly<Record<string, string>>;
  for (const key of requiredKeys) {
    if (texts[key] === undefined) {
      throw configurationError(`${path} 缺少文案 ${key}`);
    }
  }
  return texts;
}

/** 将未知值收窄为 JSON 对象。 */
function recordValue(source: unknown, path: string): JsonRecord {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw configurationError(`${path} 必须是对象`);
  }
  return source as JsonRecord;
}

/** 将未知值收窄为数组。 */
function arrayValue(source: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(source)) {
    throw configurationError(`${path} 必须是数组`);
  }
  return source;
}

/** 返回非空字符串。 */
function nonEmptyString(source: unknown, path: string): string {
  if (typeof source !== "string" || source.trim() === "") {
    throw configurationError(`${path} 必须是非空字符串`);
  }
  return source;
}

/** 返回未提供或非空字符串。 */
function optionalString(source: unknown, path: string): string | undefined {
  if (source === undefined) return undefined;
  return nonEmptyString(source, path);
}

/** 返回未提供或布尔值。 */
function optionalBoolean(source: unknown, path: string): boolean | undefined {
  if (source === undefined) return undefined;
  if (typeof source !== "boolean") {
    throw configurationError(`${path} 必须是布尔值`);
  }
  return source;
}

/** 返回满足上下界约束的整数。 */
function integerValue(
  source: unknown,
  path: string,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof source !== "number"
    || !Number.isSafeInteger(source)
    || source < minimum
    || source > maximum
  ) {
    throw configurationError(
      `${path} 必须是 ${String(minimum)}..${String(maximum)} 的安全整数`,
    );
  }
  return source;
}

/** 返回 0 到 100 的整数百分比。 */
function percentage(source: unknown, path: string): number {
  return integerValue(source, path, 0, 100);
}

/** 返回最小值不大于最大值的整数闭区间。 */
function integerPair(source: unknown, path: string): readonly [number, number] {
  const values = arrayValue(source, path);
  if (values.length !== 2) {
    throw configurationError(`${path} 必须恰好包含两个整数`);
  }
  const minimum = integerValue(values[0], `${path}[0]`);
  const maximum = integerValue(values[1], `${path}[1]`, minimum);
  return [minimum, maximum];
}

/** 返回允许枚举中的一个字符串值。 */
function enumValue<const T extends readonly string[]>(
  source: unknown,
  allowed: T,
  path: string,
): T[number] {
  const value = nonEmptyString(source, path);
  if (!allowed.some((candidate) => candidate === value)) {
    throw configurationError(`${path} 不支持值 ${value}`);
  }
  return value;
}

/** 要求数组达到配置内容的最低数量。 */
function requireMinimumLength(
  values: readonly unknown[],
  minimum: number,
  path: string,
): void {
  if (values.length < minimum) {
    throw configurationError(`${path} 至少需要 ${String(minimum)} 项`);
  }
}

/** 要求一组稳定 ID 不为空且不重复。 */
function requireUnique(ids: readonly string[], path: string): void {
  if (new Set(ids).size !== ids.length) {
    throw configurationError(`${path} 存在重复稳定 ID`);
  }
}

/** 统一生成可以在启动期阻断加载的配置错误。 */
function configurationError(message: string): DomainError {
  return new DomainError(`Demo 系统配置错误：${message}。`);
}

/** 已在模块加载时完成结构校验的默认 Demo 配置。 */
export const demoSystemsConfig = parseDemoSystemsConfig(demoSystemsDocument);
