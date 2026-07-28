import expeditionBranchingEventDocument from "../../config/expedition_branching_events.json";
import type {
  EventChoiceConfig,
  EventConfig,
  EventOutcomeConfig,
  EventsConfigDocument,
} from "../domain/content";
import type {
  ExpeditionBranchingAdvanceChoiceConfig,
  ExpeditionBranchingCapacityPolicyConfig,
  ExpeditionBranchingChoiceConfig,
  ExpeditionBranchingEventBindingConfig,
  ExpeditionBranchingEventConfig,
  ExpeditionBranchingNodeConfig,
  ExpeditionBranchingOutcomeResolutionConfig,
  ExpeditionBranchingProfileConfig,
  ExpeditionBranchingTerminalChoiceConfig,
} from "../domain/expedition-branching-event";
import { DomainError } from "../domain/errors";

type JsonRecord = Readonly<Record<string, unknown>>;

interface ProfileValidationResult {
  readonly outcomeIds: ReadonlySet<string>;
}

const SUPPORTED_SCHEMA_VERSION = 1;
const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

/** 解析并完整校验配置化远征分支目录。 */
export function parseExpeditionBranchingEventConfig(
  source: unknown,
): ExpeditionBranchingEventConfig {
  const root = recordValue(source, "expedition_branching_events");
  const schemaVersion = integerValue(root.schema_version, "schema_version", 1);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw configurationError(
      `不支持 schema_version=${String(schemaVersion)}`,
    );
  }
  const policy = parsePolicy(root.policy);
  const requiredEventIds = stableIdArray(
    root.required_event_ids,
    "required_event_ids",
  );
  const profiles = arrayValue(root.profiles, "profiles").map((entry, index) => (
    parseProfile(entry, `profiles[${String(index)}]`)
  ));
  const bindings = arrayValue(root.bindings, "bindings").map((entry, index) => (
    parseBinding(entry, `bindings[${String(index)}]`)
  ));
  const config: ExpeditionBranchingEventConfig = {
    schema_version: schemaVersion,
    policy,
    required_event_ids: requiredEventIds,
    profiles,
    bindings,
  };
  validateCatalog(config);
  return config;
}

/** 在组合根校验分支结算对旧事件、选项和确定结果的全部引用。 */
export function validateExpeditionBranchingEventReferences(
  config: ExpeditionBranchingEventConfig,
  events: EventsConfigDocument,
): void {
  const eventById = new Map(events.events.map((event) => [event.id, event]));
  for (const binding of config.bindings) {
    const event = eventById.get(binding.event_id);
    if (event === undefined) {
      throw configurationError(`绑定 ${binding.event_id} 引用未知探索事件`);
    }
    for (const resolution of binding.outcome_resolutions) {
      const payload = resolveLegacyPayload(
        event,
        resolution.resolution_choice_id,
      );
      validateLegacyOutcomeReference(
        binding.event_id,
        resolution.outcome_id,
        payload,
        resolution.resolution_outcome_id,
      );
    }
  }
}

/** 解析容量、可见选择数、深度与最小模板数规则。 */
function parsePolicy(source: unknown): ExpeditionBranchingCapacityPolicyConfig {
  const value = recordValue(source, "policy");
  const capacityPolicy = arrayValue(
    value.capacity_policy,
    "policy.capacity_policy",
  ).map((entry, index) => integerValue(
    entry,
    `policy.capacity_policy[${String(index)}]`,
    1,
  ));
  const policy = {
    capacity_policy: capacityPolicy,
    visible_choice_minimum: integerValue(
      value.visible_choice_minimum,
      "policy.visible_choice_minimum",
      1,
    ),
    visible_choice_maximum: integerValue(
      value.visible_choice_maximum,
      "policy.visible_choice_maximum",
      1,
    ),
    minimum_depth: integerValue(
      value.minimum_depth,
      "policy.minimum_depth",
      1,
    ),
    maximum_depth: integerValue(
      value.maximum_depth,
      "policy.maximum_depth",
      1,
    ),
    minimum_profile_count: integerValue(
      value.minimum_profile_count,
      "policy.minimum_profile_count",
      1,
    ),
  };
  if (policy.visible_choice_minimum > policy.visible_choice_maximum) {
    throw configurationError("可见选择数下限不能大于上限");
  }
  if (policy.minimum_depth > policy.maximum_depth) {
    throw configurationError("事件深度下限不能大于上限");
  }
  if (capacityPolicy.length !== policy.maximum_depth) {
    throw configurationError("容量规则项数必须等于最大事件深度");
  }
  return policy;
}

/** 解析一个可复用事件图及其全部情境节点。 */
function parseProfile(
  source: unknown,
  path: string,
): ExpeditionBranchingProfileConfig {
  const value = recordValue(source, path);
  return {
    id: stableId(value.id, `${path}.id`),
    entry_node_id: stableId(value.entry_node_id, `${path}.entry_node_id`),
    nodes: arrayValue(value.nodes, `${path}.nodes`).map((entry, index) => (
      parseNode(entry, `${path}.nodes[${String(index)}]`)
    )),
  };
}

/** 解析一个事件情境以及其当前可见决策。 */
function parseNode(
  source: unknown,
  path: string,
): ExpeditionBranchingNodeConfig {
  const value = recordValue(source, path);
  return {
    id: stableId(value.id, `${path}.id`),
    title: nonEmptyString(value.title, `${path}.title`),
    body: nonEmptyString(value.body, `${path}.body`),
    choices: arrayValue(value.choices, `${path}.choices`).map((entry, index) => (
      parseChoice(entry, `${path}.choices[${String(index)}]`)
    )),
  };
}

/** 按 kind 解析继续决策或终点决策。 */
function parseChoice(
  source: unknown,
  path: string,
): ExpeditionBranchingChoiceConfig {
  const value = recordValue(source, path);
  const kind = nonEmptyString(value.kind, `${path}.kind`);
  const common = {
    id: stableId(value.id, `${path}.id`),
    label: nonEmptyString(value.label, `${path}.label`),
    description: nonEmptyString(value.description, `${path}.description`),
  };
  if (kind === "advance") {
    const choice: ExpeditionBranchingAdvanceChoiceConfig = {
      kind,
      ...common,
      next_node_id: stableId(value.next_node_id, `${path}.next_node_id`),
    };
    return choice;
  }
  if (kind === "terminal") {
    const choice: ExpeditionBranchingTerminalChoiceConfig = {
      kind,
      ...common,
      outcome_id: stableId(value.outcome_id, `${path}.outcome_id`),
    };
    return choice;
  }
  throw configurationError(`${path}.kind 只能是 advance 或 terminal`);
}

/** 解析旧探索事件与可复用分支图的绑定。 */
function parseBinding(
  source: unknown,
  path: string,
): ExpeditionBranchingEventBindingConfig {
  const value = recordValue(source, path);
  return {
    event_id: stableId(value.event_id, `${path}.event_id`),
    profile_id: stableId(value.profile_id, `${path}.profile_id`),
    outcome_resolutions: arrayValue(
      value.outcome_resolutions,
      `${path}.outcome_resolutions`,
    ).map((entry, index) => parseOutcomeResolution(
      entry,
      `${path}.outcome_resolutions[${String(index)}]`,
    )),
  };
}

/** 解析终点语义到旧事件选项 ID 的可空映射。 */
function parseOutcomeResolution(
  source: unknown,
  path: string,
): ExpeditionBranchingOutcomeResolutionConfig {
  const value = recordValue(source, path);
  const resolutionChoiceId = value.resolution_choice_id;
  const resolutionOutcomeId = value.resolution_outcome_id;
  if (resolutionChoiceId !== null && typeof resolutionChoiceId !== "string") {
    throw configurationError(`${path}.resolution_choice_id 必须是字符串或 null`);
  }
  if (resolutionOutcomeId !== null && typeof resolutionOutcomeId !== "string") {
    throw configurationError(`${path}.resolution_outcome_id 必须是字符串或 null`);
  }
  return {
    outcome_id: stableId(value.outcome_id, `${path}.outcome_id`),
    resolution_choice_id: resolutionChoiceId === null
      ? null
      : stableId(resolutionChoiceId, `${path}.resolution_choice_id`),
    resolution_outcome_id: resolutionOutcomeId === null
      ? null
      : stableId(resolutionOutcomeId, `${path}.resolution_outcome_id`),
  };
}

/** 校验整份目录的唯一性、图不变量和绑定完整性。 */
function validateCatalog(config: ExpeditionBranchingEventConfig): void {
  requireUnique(config.required_event_ids, "required_event_ids");
  if (config.profiles.length < config.policy.minimum_profile_count) {
    throw configurationError(
      `profiles 至少需要 ${String(config.policy.minimum_profile_count)} 项`,
    );
  }
  requireUnique(config.profiles.map((profile) => profile.id), "profiles.id");
  requireUnique(config.bindings.map((binding) => binding.event_id), "bindings.event_id");
  const validationByProfile = new Map<string, ProfileValidationResult>();
  for (const profile of config.profiles) {
    validationByProfile.set(
      profile.id,
      validateProfile(profile, config.policy),
    );
  }
  const requiredEventIds = new Set(config.required_event_ids);
  const bindingByEventId = new Map(
    config.bindings.map((binding) => [binding.event_id, binding]),
  );
  for (const requiredEventId of requiredEventIds) {
    if (!bindingByEventId.has(requiredEventId)) {
      throw configurationError(`缺少必需事件绑定 ${requiredEventId}`);
    }
  }
  for (const binding of config.bindings) {
    if (!requiredEventIds.has(binding.event_id)) {
      throw configurationError(`绑定 ${binding.event_id} 未在 required_event_ids 登记`);
    }
    const validation = validationByProfile.get(binding.profile_id);
    if (validation === undefined) {
      throw configurationError(
        `绑定 ${binding.event_id} 引用未知 profile ${binding.profile_id}`,
      );
    }
    validateBindingOutcomes(binding, validation.outcomeIds);
  }
}

/** 校验单个 profile 的节点、选择、可达性、无环性和终点深度。 */
function validateProfile(
  profile: ExpeditionBranchingProfileConfig,
  policy: ExpeditionBranchingCapacityPolicyConfig,
): ProfileValidationResult {
  if (profile.nodes.length === 0) {
    throw configurationError(`profile ${profile.id} 不能没有节点`);
  }
  requireUnique(
    profile.nodes.map((node) => node.id),
    `profile ${profile.id} nodes.id`,
  );
  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(profile.entry_node_id)) {
    throw configurationError(
      `profile ${profile.id} 入口节点 ${profile.entry_node_id} 不存在`,
    );
  }
  for (const node of profile.nodes) {
    validateNodeChoices(profile.id, node, nodeById, policy);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const depthByNode = new Map<string, number>();
  const outcomeIds = new Set<string>();
  visitProfileNode(
    profile,
    profile.entry_node_id,
    1,
    nodeById,
    policy,
    visited,
    visiting,
    depthByNode,
    outcomeIds,
  );
  if (visited.size !== profile.nodes.length) {
    const unreachable = profile.nodes
      .filter((node) => !visited.has(node.id))
      .map((node) => node.id)
      .join(", ");
    throw configurationError(`profile ${profile.id} 存在不可达节点：${unreachable}`);
  }
  validateLayerCapacities(profile.id, depthByNode, policy.capacity_policy);
  return { outcomeIds };
}

/** 按深度统计后台情境节点，拒绝内容超过配置容量。 */
function validateLayerCapacities(
  profileId: string,
  depthByNode: ReadonlyMap<string, number>,
  capacities: readonly number[],
): void {
  const counts = new Map<number, number>();
  for (const depth of depthByNode.values()) {
    counts.set(depth, (counts.get(depth) ?? 0) + 1);
  }
  for (const [depth, count] of counts) {
    const capacity = capacities[depth - 1];
    if (capacity === undefined || count > capacity) {
      throw configurationError(
        `profile ${profileId} 第 ${String(depth)} 层包含 ${String(count)} 个情境，超过容量 ${String(capacity ?? 0)}`,
      );
    }
  }
}

/** 校验节点的可见选择数、选择 ID 和后续节点引用。 */
function validateNodeChoices(
  profileId: string,
  node: ExpeditionBranchingNodeConfig,
  nodeById: ReadonlyMap<string, ExpeditionBranchingNodeConfig>,
  policy: ExpeditionBranchingCapacityPolicyConfig,
): void {
  if (
    node.choices.length < policy.visible_choice_minimum
    || node.choices.length > policy.visible_choice_maximum
  ) {
    throw configurationError(
      `profile ${profileId} 节点 ${node.id} 的可见选择数必须介于 ${String(policy.visible_choice_minimum)} 到 ${String(policy.visible_choice_maximum)}`,
    );
  }
  requireUnique(
    node.choices.map((choice) => choice.id),
    `profile ${profileId} 节点 ${node.id} choices.id`,
  );
  for (const choice of node.choices) {
    if (choice.kind === "advance" && !nodeById.has(choice.next_node_id)) {
      throw configurationError(
        `profile ${profileId} 节点 ${node.id} 引用未知节点 ${choice.next_node_id}`,
      );
    }
  }
}

/** 深度优先遍历事件图，同时拒绝环、多深度汇合和非法终点。 */
function visitProfileNode(
  profile: ExpeditionBranchingProfileConfig,
  nodeId: string,
  depth: number,
  nodeById: ReadonlyMap<string, ExpeditionBranchingNodeConfig>,
  policy: ExpeditionBranchingCapacityPolicyConfig,
  visited: Set<string>,
  visiting: Set<string>,
  depthByNode: Map<string, number>,
  outcomeIds: Set<string>,
): void {
  if (visiting.has(nodeId)) {
    throw configurationError(`profile ${profile.id} 存在循环，涉及节点 ${nodeId}`);
  }
  const knownDepth = depthByNode.get(nodeId);
  if (knownDepth !== undefined && knownDepth !== depth) {
    throw configurationError(
      `profile ${profile.id} 节点 ${nodeId} 同时出现在第 ${String(knownDepth)} 层与第 ${String(depth)} 层`,
    );
  }
  if (depth > policy.maximum_depth) {
    throw configurationError(
      `profile ${profile.id} 节点 ${nodeId} 超过最大深度`,
    );
  }
  if (visited.has(nodeId)) return;
  const node = nodeById.get(nodeId);
  if (node === undefined) {
    throw configurationError(`profile ${profile.id} 节点 ${nodeId} 不存在`);
  }
  depthByNode.set(nodeId, depth);
  visiting.add(nodeId);
  for (const choice of node.choices) {
    if (choice.kind === "terminal") {
      if (depth < policy.minimum_depth || depth > policy.maximum_depth) {
        throw configurationError(
          `profile ${profile.id} 终点 ${nodeId}.${choice.id} 必须位于第 ${String(policy.minimum_depth)} 到 ${String(policy.maximum_depth)} 层`,
        );
      }
      outcomeIds.add(choice.outcome_id);
      continue;
    }
    if (depth >= policy.maximum_depth) {
      throw configurationError(
        `profile ${profile.id} 最大深度节点 ${nodeId} 不能继续分支`,
      );
    }
    visitProfileNode(
      profile,
      choice.next_node_id,
      depth + 1,
      nodeById,
      policy,
      visited,
      visiting,
      depthByNode,
      outcomeIds,
    );
  }
  visiting.delete(nodeId);
  visited.add(nodeId);
}

/** 校验绑定为 profile 的每个终点提供且仅提供一项结算映射。 */
function validateBindingOutcomes(
  binding: ExpeditionBranchingEventBindingConfig,
  profileOutcomeIds: ReadonlySet<string>,
): void {
  const mappedOutcomeIds = binding.outcome_resolutions.map(
    (resolution) => resolution.outcome_id,
  );
  requireUnique(
    mappedOutcomeIds,
    `binding ${binding.event_id} outcome_resolutions.outcome_id`,
  );
  const mapped = new Set(mappedOutcomeIds);
  for (const outcomeId of profileOutcomeIds) {
    if (!mapped.has(outcomeId)) {
      throw configurationError(
        `binding ${binding.event_id} 缺少终点映射 ${outcomeId}`,
      );
    }
  }
  for (const outcomeId of mapped) {
    if (!profileOutcomeIds.has(outcomeId)) {
      throw configurationError(
        `binding ${binding.event_id} 包含未知终点映射 ${outcomeId}`,
      );
    }
  }
}

/** 按旧结算选择 ID 返回事件本体或其确定选择。 */
function resolveLegacyPayload(
  event: EventConfig,
  choiceId: string | null,
): EventConfig | EventChoiceConfig {
  const choices = event.choices ?? [];
  if (choices.length === 0) {
    if (choiceId !== null) {
      throw configurationError(
        `事件 ${event.id} 不接受结算选择 ${choiceId}`,
      );
    }
    return event;
  }
  if (choiceId === null) {
    throw configurationError(`事件 ${event.id} 必须指定结算选择`);
  }
  const choice = choices.find((candidate) => candidate.id === choiceId);
  if (choice === undefined) {
    throw configurationError(`事件 ${event.id} 不存在结算选择 ${choiceId}`);
  }
  return choice;
}

/** 校验语义终点映射到唯一旧随机结果，禁止重新进入随机池。 */
function validateLegacyOutcomeReference(
  eventId: string,
  semanticOutcomeId: string,
  payload: EventConfig | EventChoiceConfig,
  outcomeId: string | null,
): void {
  const outcomes = payload.outcomes ?? [];
  if (outcomes.length === 0) {
    if (outcomeId !== null) {
      throw configurationError(
        `事件 ${eventId} 终点 ${semanticOutcomeId} 引用了不存在的随机结果 ${outcomeId}`,
      );
    }
    if (payload.result === undefined) {
      throw configurationError(
        `事件 ${eventId} 终点 ${semanticOutcomeId} 缺少可结算结果`,
      );
    }
    return;
  }
  if (outcomeId === null) {
    throw configurationError(
      `事件 ${eventId} 终点 ${semanticOutcomeId} 必须指定确定随机结果`,
    );
  }
  const ids = outcomes.map((outcome, index) => requireLegacyOutcomeId(
    eventId,
    outcome,
    index,
  ));
  requireUnique(ids, `事件 ${eventId} 随机结果 id`);
  if (!ids.includes(outcomeId)) {
    throw configurationError(
      `事件 ${eventId} 终点 ${semanticOutcomeId} 引用未知随机结果 ${outcomeId}`,
    );
  }
}

/** 返回一个供分支稳定引用的旧随机结果 ID。 */
function requireLegacyOutcomeId(
  eventId: string,
  outcome: EventOutcomeConfig,
  index: number,
): string {
  if (outcome.id === undefined || !STABLE_ID_PATTERN.test(outcome.id)) {
    throw configurationError(
      `事件 ${eventId} 随机结果 ${String(index)} 缺少有效稳定 id`,
    );
  }
  return outcome.id;
}

/** 校验字符串列表中不存在重复值。 */
function requireUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw configurationError(`${path} 不得包含重复值`);
  }
}

/** 把未知输入收窄为普通 JSON 对象。 */
function recordValue(source: unknown, path: string): JsonRecord {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw configurationError(`${path} 必须是对象`);
  }
  return source as JsonRecord;
}

/** 把未知输入收窄为 JSON 数组。 */
function arrayValue(source: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(source)) {
    throw configurationError(`${path} 必须是数组`);
  }
  return source;
}

/** 解析一组不可重排语义的稳定字符串 ID。 */
function stableIdArray(source: unknown, path: string): readonly string[] {
  return arrayValue(source, path).map((entry, index) => (
    stableId(entry, `${path}[${String(index)}]`)
  ));
}

/** 解析只由小写字母、数字、下划线和连字符组成的稳定 ID。 */
function stableId(source: unknown, path: string): string {
  const value = nonEmptyString(source, path);
  if (!STABLE_ID_PATTERN.test(value)) {
    throw configurationError(`${path} 不是有效的稳定 ID`);
  }
  return value;
}

/** 返回去除首尾空白后的非空字符串。 */
function nonEmptyString(source: unknown, path: string): string {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw configurationError(`${path} 必须是非空字符串`);
  }
  return source.trim();
}

/** 返回满足最小值约束的安全整数。 */
function integerValue(
  source: unknown,
  path: string,
  minimum: number,
): number {
  if (
    typeof source !== "number"
    || !Number.isSafeInteger(source)
    || source < minimum
  ) {
    throw configurationError(
      `${path} 必须是不小于 ${String(minimum)} 的安全整数`,
    );
  }
  return source;
}

/** 统一生成可在启动阶段阻断加载的目录配置错误。 */
function configurationError(message: string): DomainError {
  return new DomainError(`远征分支事件配置错误：${message}。`);
}

/** 模块加载时即完成全量校验的默认分支目录。 */
export const expeditionBranchingEventConfig =
  parseExpeditionBranchingEventConfig(expeditionBranchingEventDocument);
