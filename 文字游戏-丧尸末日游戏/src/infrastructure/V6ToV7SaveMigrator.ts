import type {
  FacilityConfig,
  FacilityManagementConfig,
  NumericEffectConfig,
  V6ToV7SaveMigrationConfig,
} from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

/** v6 历史状态迁移到当前设施与出生城市规则所需的权威配置。 */
export interface V6ToV7SaveMigrationContext {
  readonly facilities: readonly FacilityConfig[];
  readonly facilityManagement: FacilityManagementConfig;
  readonly allowedHomeCityIds: readonly string[];
}

/** 为 v6 状态补齐载具配装和配置化经营周期用量。 */
export class V6ToV7SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly defaults: V6ToV7SaveMigrationConfig["state_defaults"];
  private readonly homeCityReplacements: Readonly<Record<string, string>>;
  private readonly facilities: readonly FacilityConfig[];
  private readonly facilityManagement: FacilityManagementConfig;
  private readonly capacityFacility: FacilityConfig;

  /** 校验单步版本链、兼容映射与容量设施后保存不可变配置。 */
  public constructor(
    configuration: V6ToV7SaveMigrationConfig,
    context: V6ToV7SaveMigrationContext,
  ) {
    validateConfiguration(configuration);
    const capacityFacility = validateContext(configuration, context);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
    this.defaults = structuredClone(configuration.state_defaults);
    this.homeCityReplacements = structuredClone(
      configuration.compatibility.home_city_replacements,
    );
    this.facilities = context.facilities;
    this.facilityManagement = context.facilityManagement;
    this.capacityFacility = capacityFacility;
  }

  /** 同步迁移当前聚合与可回档检查点快照。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const rawState = requireObject(document.game_state, "v6 存档 game_state");
    const state = this.migrateRestorableState(rawState);
    if (state.checkpoint !== null) {
      const checkpoint = requireObject(state.checkpoint, "v6 存档 checkpoint");
      state.checkpoint = {
        ...checkpoint,
        snapshot: this.migrateRestorableState(
          requireObject(checkpoint.snapshot, "v6 存档 checkpoint.snapshot"),
        ),
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 为一份可恢复状态补齐 v7 根字段和载具装备列表。 */
  private migrateRestorableState(
    rawState: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const state: Record<string, unknown> = structuredClone(rawState);
    state.campaign = this.migrateCampaign(
      requireObject(state.campaign, "v6 存档 campaign"),
    );
    state.inventory = {
      ...requireObject(state.inventory, "v6 存档 inventory"),
      equipped_transport_ids: structuredClone(this.defaults.equipped_transport_ids),
    };
    state.facility_levels = this.migrateFacilityLevels(
      requireObject(state.facility_levels, "v6 存档 facility_levels"),
    );
    state.management_cycle_usage = structuredClone(
      this.defaults.management_cycle_usage,
    );
    return state;
  }

  /** 将旧版允许的隔离岛出生地按迁移配置重定向到当前合法城市。 */
  private migrateCampaign(
    campaign: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const homeCityId = requireNonEmptyString(
      campaign.home_city_id,
      "v6 存档 campaign.home_city_id",
    );
    const replacement = this.homeCityReplacements[homeCityId];
    return replacement === undefined
      ? structuredClone(campaign)
      : { ...structuredClone(campaign), home_city_id: replacement };
  }

  /** 补齐新设施并按旧档已建等级自动提升到最小可用扩建等级。 */
  private migrateFacilityLevels(
    rawLevels: Readonly<Record<string, unknown>>,
  ): Record<string, number> {
    const levels: Record<string, unknown> = {
      ...structuredClone(rawLevels),
      ...structuredClone(this.defaults.facility_levels),
    };
    const occupiedLevel = this.occupiedFacilityLevel(levels);
    const requiredCapacityLevel = this.requiredCapacityFacilityLevel(occupiedLevel);
    levels[this.capacityFacility.facility_id] = requiredCapacityLevel;
    return levels as Record<string, number>;
  }

  /** 统计配置明确声明占用建设容量的旧档设施等级。 */
  private occupiedFacilityLevel(levels: Readonly<Record<string, unknown>>): number {
    return this.facilities.reduce((total, facility) => {
      if (!facility.counts_toward_total_level_limit) return total;
      const level = requireNonNegativeInteger(
        levels[facility.facility_id] ?? 0,
        `v6 存档 facility_levels.${facility.facility_id}`,
      );
      return total + level;
    }, 0);
  }

  /** 查找能容纳旧档已建设施的最低扩建等级，超过封顶时明确拒绝。 */
  private requiredCapacityFacilityLevel(occupiedLevel: number): number {
    for (let level = 0; level <= this.capacityFacility.max_level; level += 1) {
      if (this.capacityAtLevel(level) >= occupiedLevel) return level;
    }
    const maximumCapacity = this.capacityAtLevel(this.capacityFacility.max_level);
    throw new SaveDataError(
      `v6 存档常规设施总等级 ${String(occupiedLevel)} 超过扩建最高容量 ${String(maximumCapacity)}。`,
    );
  }

  /** 使用与领域被动修正一致的运算语义计算指定扩建等级容量。 */
  private capacityAtLevel(level: number): number {
    let modifier = 0;
    for (const configuredLevel of this.capacityFacility.levels) {
      if (configuredLevel.level > level) continue;
      for (const effect of configuredLevel.effects ?? []) {
        if (effect.target !== this.facilityManagement.capacity_modifier_target) continue;
        modifier = applyNumericModifier(modifier, effect, this.capacityFacility.facility_id);
      }
    }
    return this.facilityManagement.initial_total_level_limit + modifier;
  }
}

/** 严格校验 v6 到 v7 迁移配置与空白默认容器。 */
function validateConfiguration(configuration: V6ToV7SaveMigrationConfig): void {
  const root = requireObject(configuration, "v6 到 v7 存档迁移配置");
  requireExactKeys(
    root,
    ["schema_version", "from_version", "to_version", "compatibility", "state_defaults"],
    "v6 到 v7 存档迁移配置",
  );
  if (
    configuration.schema_version !== 1
    || configuration.from_version !== 6
    || configuration.to_version !== 7
  ) {
    throw new SaveDataError("v6 到 v7 迁移配置版本链无效。");
  }
  const compatibility = requireObject(
    configuration.compatibility,
    "v6 到 v7 兼容配置",
  );
  requireExactKeys(
    compatibility,
    ["home_city_replacements", "capacity_facility_id"],
    "v6 到 v7 兼容配置",
  );
  const replacements = requireObject(
    configuration.compatibility.home_city_replacements,
    "v6 出生城市替换表",
  );
  if (Object.keys(replacements).length === 0) {
    throw new SaveDataError("v6 出生城市替换表不得为空。");
  }
  for (const [sourceId, targetId] of Object.entries(replacements)) {
    requireNonEmptyString(sourceId, "v6 出生城市替换源");
    requireNonEmptyString(targetId, `v6 出生城市 ${sourceId} 替换目标`);
    if (sourceId === targetId) {
      throw new SaveDataError(`v6 出生城市 ${sourceId} 不得映射到自身。`);
    }
  }
  requireNonEmptyString(
    configuration.compatibility.capacity_facility_id,
    "v6 容量设施 ID",
  );
  const defaults = requireObject(configuration.state_defaults, "v7 迁移默认值");
  requireExactKeys(
    defaults,
    ["equipped_transport_ids", "facility_levels", "management_cycle_usage"],
    "v7 迁移默认值",
  );
  if (
    !Array.isArray(configuration.state_defaults.equipped_transport_ids)
    || configuration.state_defaults.equipped_transport_ids.length !== 0
  ) {
    throw new SaveDataError("v7 迁移默认载具配装必须为空列表。");
  }
  if (Object.keys(configuration.state_defaults.management_cycle_usage).length !== 0) {
    throw new SaveDataError("v7 迁移默认经营周期用量必须为空对象。");
  }
  const facilityLevels = requireObject(
    configuration.state_defaults.facility_levels,
    "v7 迁移新增设施等级",
  );
  if (Object.keys(facilityLevels).length === 0) {
    throw new SaveDataError("v7 迁移至少需要声明一项新增设施等级。");
  }
  for (const [facilityId, level] of Object.entries(facilityLevels)) {
    if (facilityId.trim() === "" || level !== 0) {
      throw new SaveDataError("v7 迁移新增设施必须使用非空 ID 与零级默认值。");
    }
  }
}

/** 校验迁移映射与当前城市白名单、设施容量配置一致。 */
function validateContext(
  configuration: V6ToV7SaveMigrationConfig,
  context: V6ToV7SaveMigrationContext,
): FacilityConfig {
  const facilityIds = new Set<string>();
  for (const facility of context.facilities) {
    requireNonEmptyString(facility.facility_id, "v7 设施 ID");
    if (facilityIds.has(facility.facility_id)) {
      throw new SaveDataError(`v7 设施 ID ${facility.facility_id} 重复。`);
    }
    facilityIds.add(facility.facility_id);
  }
  for (const facilityId of Object.keys(configuration.state_defaults.facility_levels)) {
    if (!facilityIds.has(facilityId)) {
      throw new SaveDataError(`v7 迁移默认设施 ${facilityId} 未在当前设施配置中声明。`);
    }
  }
  const allowedHomeCityIds = new Set(context.allowedHomeCityIds);
  if (allowedHomeCityIds.size === 0) {
    throw new SaveDataError("v7 合法出生城市集合不得为空。");
  }
  for (const [sourceId, targetId] of Object.entries(
    configuration.compatibility.home_city_replacements,
  )) {
    if (allowedHomeCityIds.has(sourceId)) {
      throw new SaveDataError(`v6 替换源 ${sourceId} 仍是当前合法出生城市。`);
    }
    if (!allowedHomeCityIds.has(targetId)) {
      throw new SaveDataError(`v6 替换目标 ${targetId} 不是当前合法出生城市。`);
    }
  }
  const capacityFacility = context.facilities.find(
    (facility) => facility.facility_id
      === configuration.compatibility.capacity_facility_id,
  );
  if (capacityFacility === undefined) {
    throw new SaveDataError("v6 容量设施未在当前设施配置中声明。");
  }
  if (capacityFacility.counts_toward_total_level_limit) {
    throw new SaveDataError("v6 容量设施不得占用自身提供的建设容量。");
  }
  if (capacityFacility.max_level !== capacityFacility.levels.length) {
    throw new SaveDataError("v6 容量设施最高等级必须与等级配置数量一致。");
  }
  if (configuration.state_defaults.facility_levels[capacityFacility.facility_id] !== 0) {
    throw new SaveDataError("v6 容量设施必须以零级默认值进入迁移。");
  }
  validateCapacityProgression(capacityFacility, context.facilityManagement);
  return capacityFacility;
}

/** 确保扩建各级连续、容量不回退且最终确实提高上限。 */
function validateCapacityProgression(
  capacityFacility: FacilityConfig,
  management: FacilityManagementConfig,
): void {
  if (
    !Number.isSafeInteger(management.initial_total_level_limit)
    || management.initial_total_level_limit < 0
  ) {
    throw new SaveDataError("v6 初始建设容量必须是非负安全整数。");
  }
  requireNonEmptyString(management.capacity_modifier_target, "v6 建设容量效果目标");
  let modifier = 0;
  let previousCapacity = management.initial_total_level_limit;
  let foundCapacityEffect = false;
  for (const [index, level] of capacityFacility.levels.entries()) {
    if (level.level !== index + 1) {
      throw new SaveDataError("v6 容量设施等级必须从 1 开始连续声明。");
    }
    for (const effect of level.effects ?? []) {
      if (effect.target !== management.capacity_modifier_target) continue;
      foundCapacityEffect = true;
      modifier = applyNumericModifier(modifier, effect, capacityFacility.facility_id);
    }
    const capacity = management.initial_total_level_limit + modifier;
    if (capacity < previousCapacity) {
      throw new SaveDataError("v6 容量设施升级后不得降低建设容量。");
    }
    previousCapacity = capacity;
  }
  if (!foundCapacityEffect || previousCapacity <= management.initial_total_level_limit) {
    throw new SaveDataError("v6 容量设施必须提供有效的建设容量增益。");
  }
}

/** 依照配置的 add、subtract 或 set 语义累积一项数值修正。 */
function applyNumericModifier(
  current: number,
  effect: NumericEffectConfig,
  facilityId: string,
): number {
  if (typeof effect.amount !== "number" || !Number.isSafeInteger(effect.amount)) {
    throw new SaveDataError(`容量设施 ${facilityId} 必须使用固定安全整数容量效果。`);
  }
  const operation: string = effect.operation;
  if (operation === "add") return current + effect.amount;
  if (operation === "subtract") return current - effect.amount;
  if (operation === "set") return effect.amount;
  throw new SaveDataError(`容量设施 ${facilityId} 使用了未知数值运算。`);
}

/** 要求对象字段集合与配置契约完全一致。 */
function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  if (
    actual.length !== normalizedExpected.length
    || actual.some((key, index) => key !== normalizedExpected[index])
  ) {
    throw new SaveDataError(`${path}字段集合不匹配。`);
  }
}

/** 要求未知值是普通 JSON 对象。 */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path}必须是对象。`);
  }
  return value as Record<string, unknown>;
}

/** 要求未知值是去除首尾空白后仍非空的字符串。 */
function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SaveDataError(`${path}必须是非空字符串。`);
  }
  return value;
}

/** 要求未知值是可用于设施等级计算的非负整数。 */
function requireNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SaveDataError(`${path}必须是非负整数。`);
  }
  return value;
}
