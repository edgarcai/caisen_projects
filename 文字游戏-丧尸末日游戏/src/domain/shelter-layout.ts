/** 避难所房间规划支持的人员性别。 */
export type ShelterResidentGender = "male" | "female" | "unspecified";

/** 房间解锁与扩建可读取的需求类型。 */
export type ShelterRoomRequirementKind =
  | "facility_level"
  | "shelter_expansion"
  | "resource";

/** 单项配置化房间需求。 */
export interface ShelterRoomRequirementConfig {
  readonly kind: ShelterRoomRequirementKind;
  readonly target_id: string;
  readonly label: string;
  readonly minimum: number;
}

/** 房间某一级的容量与升级前置。 */
export interface ShelterRoomLevelConfig {
  readonly level: number;
  readonly capacity: number;
  readonly requirements: readonly ShelterRoomRequirementConfig[];
}

/** 横切面中的一个房间配置。 */
export interface ShelterRoomConfig {
  readonly room_id: string;
  readonly name: string;
  readonly icon: string;
  readonly floor_id: string;
  readonly grid_column: number;
  readonly grid_span: number;
  readonly function: string;
  readonly allowed_genders: readonly ShelterResidentGender[];
  readonly linked_facility_id: string | null;
  readonly base_level: number;
  readonly unlock_requirements: readonly ShelterRoomRequirementConfig[];
  readonly levels: readonly ShelterRoomLevelConfig[];
}

/** 地下横切面的层级标识。 */
export interface ShelterFloorConfig {
  readonly floor_id: string;
  readonly label: string;
  readonly name: string;
  readonly sort_order: number;
}

/** 配置内置的伙伴喜恶关系。 */
export interface ShelterResidentPreferenceConfig {
  readonly resident_id: string;
  readonly name: string;
  readonly gender: ShelterResidentGender;
  readonly likes: readonly string[];
  readonly dislikes: readonly string[];
  readonly preference_note: string;
}

/** 和谐度文本档位。 */
export interface ShelterHarmonyTierConfig {
  readonly minimum: number;
  readonly label: string;
}

/** 和谐度计分规则。 */
export interface ShelterHarmonyConfig {
  readonly minimum: number;
  readonly maximum: number;
  readonly base_score: number;
  readonly like_bonus: number;
  readonly dislike_penalty: number;
  readonly unassigned_penalty: number;
  readonly tiers: readonly ShelterHarmonyTierConfig[];
}

/** 横切面页面的响应式几何 token。 */
export interface ShelterMapLayoutConfig {
  readonly desktop_grid_columns: number;
  readonly desktop_room_height: number;
  readonly mobile_room_height: number;
  readonly floor_label_height: number;
  readonly room_gap: number;
  readonly floor_gap: number;
  readonly floor_padding: number;
  readonly summary_min_height: number;
  readonly roster_min_height: number;
  readonly room_font_size: number;
}

/** 房间规划所有可见文案。 */
export interface ShelterLayoutCopyConfig {
  readonly back_label: string;
  readonly map_summary_format: string;
  readonly room_button_format: string;
  readonly room_detail_format: string;
  readonly room_planning_title_format: string;
  readonly room_planning_body: string;
  readonly resident_option_format: string;
  readonly resident_option_detail_format: string;
  readonly assign_action: string;
  readonly remove_action: string;
  readonly unassigned_label: string;
  readonly empty_residents: string;
  readonly empty_preferences: string;
  readonly locked_status: string;
  readonly running_status: string;
  readonly full_status: string;
  readonly level_label_format: string;
  readonly unlock_requirements_title: string;
  readonly expansion_requirements_title: string;
  readonly requirement_met_format: string;
  readonly requirement_unmet_format: string;
  readonly no_requirement: string;
  readonly maximum_level: string;
  readonly inactive_reason: string;
  readonly locked_room_reason: string;
  readonly room_full_reason: string;
  readonly gender_restricted_reason_format: string;
  readonly unknown_resident_reason: string;
  readonly unknown_room_reason: string;
  readonly already_unassigned_reason: string;
  readonly assignment_success_format: string;
  readonly removal_success_format: string;
  readonly conflict_advice_format: string;
  readonly affinity_advice_format: string;
  readonly unassigned_advice_format: string;
  readonly stable_advice: string;
  readonly list_separator: string;
  readonly advice_separator: string;
  readonly section_separator: string;
  readonly floor_label_format: string;
  readonly unassigned_roster_format: string;
  readonly gender_labels: Readonly<Record<ShelterResidentGender, string>>;
}

/** 持久化边界的配置化错误文案。 */
export interface ShelterLayoutValidationCopyConfig {
  readonly unknown_room_format: string;
  readonly unknown_resident_format: string;
  readonly locked_room_format: string;
  readonly gender_restricted_format: string;
  readonly capacity_exceeded_format: string;
}

/** 避难所横切面的独立配置根。 */
export interface ShelterLayoutConfig {
  readonly schema_version: 1;
  readonly title: string;
  readonly navigation_label: string;
  readonly description: string;
  readonly copy: ShelterLayoutCopyConfig;
  readonly validation_copy: ShelterLayoutValidationCopyConfig;
  readonly layout: ShelterMapLayoutConfig;
  readonly harmony: ShelterHarmonyConfig;
  readonly default_assignments: Readonly<Record<string, readonly string[]>>;
  readonly resident_preferences: readonly ShelterResidentPreferenceConfig[];
  readonly floors: readonly ShelterFloorConfig[];
  readonly rooms: readonly ShelterRoomConfig[];
}

/** 存档可直接持久化的房间到人员 ID 映射。 */
export type ShelterRoomAssignments = Readonly<
  Record<string, readonly string[]>
>;

/** 组合根从玩家与伙伴快照投影出的人员档案。 */
export interface ShelterResidentProfile {
  readonly residentId: string;
  readonly name: string;
  readonly gender: ShelterResidentGender;
  readonly active: boolean;
  readonly likes: readonly string[];
  readonly dislikes: readonly string[];
  readonly preferenceNote: string;
}

/** 计算房间解锁、容量与调度所需的实时快照。 */
export interface ShelterLayoutContext {
  readonly residents: readonly ShelterResidentProfile[];
  readonly facilityLevels: Readonly<Record<string, number>>;
  readonly shelterExpansionLevel: number;
  readonly resources: Readonly<Record<string, number>>;
}

/** 单项需求的可见结果。 */
export interface ShelterRequirementView {
  readonly kind: ShelterRoomRequirementKind;
  readonly targetId: string;
  readonly label: string;
  readonly current: number;
  readonly minimum: number;
  readonly met: boolean;
  readonly text: string;
}

/** 房间内一对人员的关系影响。 */
export interface ShelterRelationshipEffect {
  readonly roomId: string;
  readonly residentAId: string;
  readonly residentBId: string;
  readonly scoreDelta: number;
  readonly conflict: boolean;
  readonly affinity: boolean;
  readonly advice: string;
}

/** 房间的实时可见投影。 */
export interface ShelterRoomView {
  readonly roomId: string;
  readonly name: string;
  readonly icon: string;
  readonly floorId: string;
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly function: string;
  readonly level: number;
  readonly levelLabel: string;
  readonly capacity: number;
  readonly residentIds: readonly string[];
  readonly residentNames: readonly string[];
  readonly locked: boolean;
  readonly full: boolean;
  readonly statusLabel: string;
  readonly unlockRequirements: readonly ShelterRequirementView[];
  readonly nextExpansionRequirements: readonly ShelterRequirementView[];
  readonly expansionLabel: string;
  readonly harmony: number;
  readonly harmonyLabel: string;
  readonly advice: readonly string[];
}

/** 带房间投影的单个横切面楼层。 */
export interface ShelterFloorView {
  readonly floorId: string;
  readonly label: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly rooms: readonly ShelterRoomView[];
}

/** 避难所横切面页面所需的完整投影。 */
export interface ShelterLayoutView {
  readonly title: string;
  readonly description: string;
  readonly assignedCount: number;
  readonly activeCount: number;
  readonly unassignedResidents: readonly ShelterResidentProfile[];
  readonly harmony: number;
  readonly harmonyLabel: string;
  readonly advice: readonly string[];
  readonly floors: readonly ShelterFloorView[];
  readonly rooms: readonly ShelterRoomView[];
  readonly residents: readonly ShelterResidentProfile[];
}

/** 房间人员规划列表的一个候选项。 */
export interface ShelterAssignmentOption {
  readonly residentId: string;
  readonly residentName: string;
  readonly gender: ShelterResidentGender;
  readonly currentRoomId: string | null;
  readonly currentRoomName: string | null;
  readonly assignedToTarget: boolean;
  readonly available: boolean;
  readonly unavailableReason: string;
  readonly likesNames: readonly string[];
  readonly dislikesNames: readonly string[];
  readonly preferenceNote: string;
}

/** 一次人员调动的不可变结算。 */
export interface ShelterAssignmentResolution {
  readonly applied: boolean;
  readonly assignments: Record<string, string[]>;
  readonly message: string;
  readonly harmony: number;
}

/** 生成所长在避难所房间系统中的稳定人员 ID。 */
export function shelterPlayerResidentId(playerIndex: number): string {
  return `player:${String(playerIndex)}`;
}

/** 生成伙伴在避难所房间系统中的稳定人员 ID。 */
export function shelterCompanionResidentId(companionId: string): string {
  return `companion:${companionId}`;
}

/**
 * 将未知 JSON 校验为避难所布局配置。
 */
export function parseShelterLayoutConfig(
  document: unknown,
): ShelterLayoutConfig {
  assertRecord(document, "避难所布局配置根");
  if (document.schema_version !== 1) {
    throw new Error("避难所布局配置版本不受支持。");
  }
  assertNonEmptyString(document.title, "title");
  assertNonEmptyString(document.navigation_label, "navigation_label");
  assertNonEmptyString(document.description, "description");
  assertRecord(document.copy, "copy");
  assertRecord(document.validation_copy, "validation_copy");
  assertRecord(document.layout, "layout");
  assertRecord(document.harmony, "harmony");
  assertRecord(document.default_assignments, "default_assignments");
  assertArray(document.resident_preferences, "resident_preferences");
  assertArray(document.floors, "floors");
  assertArray(document.rooms, "rooms");
  validateCopy(document.copy);
  validateValidationCopy(document.validation_copy);
  validateLayout(document.layout);
  validateHarmony(document.harmony);
  validateDefaultAssignments(document.default_assignments);
  validatePreferences(document.resident_preferences);
  validateFloors(document.floors);
  validateRooms(document.rooms, document.floors);
  return document as unknown as ShelterLayoutConfig;
}

/** 校验存档房间规则的文案模板完整性。 */
function validateValidationCopy(
  copy: Readonly<Record<string, unknown>>,
): void {
  const keys: readonly (keyof ShelterLayoutValidationCopyConfig)[] = [
    "unknown_room_format",
    "unknown_resident_format",
    "locked_room_format",
    "gender_restricted_format",
    "capacity_exceeded_format",
  ];
  for (const key of keys) {
    assertNonEmptyString(copy[key], `validation_copy.${key}`);
  }
}

/** 校验页面可见文案完整性。 */
function validateCopy(copy: Readonly<Record<string, unknown>>): void {
  const stringKeys: readonly (keyof Omit<
    ShelterLayoutCopyConfig,
    "gender_labels"
  >)[] = [
    "back_label",
    "map_summary_format",
    "room_button_format",
    "room_detail_format",
    "room_planning_title_format",
    "room_planning_body",
    "resident_option_format",
    "resident_option_detail_format",
    "assign_action",
    "remove_action",
    "unassigned_label",
    "empty_residents",
    "empty_preferences",
    "locked_status",
    "running_status",
    "full_status",
    "level_label_format",
    "unlock_requirements_title",
    "expansion_requirements_title",
    "requirement_met_format",
    "requirement_unmet_format",
    "no_requirement",
    "maximum_level",
    "inactive_reason",
    "locked_room_reason",
    "room_full_reason",
    "gender_restricted_reason_format",
    "unknown_resident_reason",
    "unknown_room_reason",
    "already_unassigned_reason",
    "assignment_success_format",
    "removal_success_format",
    "conflict_advice_format",
    "affinity_advice_format",
    "unassigned_advice_format",
    "stable_advice",
    "list_separator",
    "floor_label_format",
    "unassigned_roster_format",
  ];
  for (const key of stringKeys) {
    assertNonEmptyString(copy[key], `copy.${key}`);
  }
  assertStringWithLength(copy.advice_separator, "copy.advice_separator");
  assertStringWithLength(copy.section_separator, "copy.section_separator");
  assertRecord(copy.gender_labels, "copy.gender_labels");
  for (const gender of RESIDENT_GENDERS) {
    assertNonEmptyString(copy.gender_labels[gender], `copy.gender_labels.${gender}`);
  }
}

/** 校验横切面几何 token。 */
function validateLayout(layout: Readonly<Record<string, unknown>>): void {
  const keys: readonly (keyof ShelterMapLayoutConfig)[] = [
    "desktop_grid_columns",
    "desktop_room_height",
    "mobile_room_height",
    "floor_label_height",
    "room_gap",
    "floor_gap",
    "floor_padding",
    "summary_min_height",
    "roster_min_height",
    "room_font_size",
  ];
  for (const key of keys) {
    assertNonNegativeInteger(layout[key], `layout.${key}`, key !== "room_gap");
  }
}

/** 校验和谐度计分范围与文本档位。 */
function validateHarmony(harmony: Readonly<Record<string, unknown>>): void {
  for (const key of [
    "minimum",
    "maximum",
    "base_score",
    "like_bonus",
    "dislike_penalty",
    "unassigned_penalty",
  ] as const) {
    assertFiniteNumber(harmony[key], `harmony.${key}`);
  }
  assertArray(harmony.tiers, "harmony.tiers");
  if (harmony.tiers.length === 0) {
    throw new Error("harmony.tiers 至少需要一个档位。");
  }
  for (const [index, tier] of harmony.tiers.entries()) {
    assertRecord(tier, `harmony.tiers[${String(index)}]`);
    assertFiniteNumber(tier.minimum, `harmony.tiers[${String(index)}].minimum`);
    assertNonEmptyString(tier.label, `harmony.tiers[${String(index)}].label`);
  }
}

/** 校验默认房间人员映射。 */
function validateDefaultAssignments(
  assignments: Readonly<Record<string, unknown>>,
): void {
  for (const [roomId, residents] of Object.entries(assignments)) {
    assertNonEmptyString(roomId, "default_assignments room id");
    assertStringArray(residents, `default_assignments.${roomId}`);
  }
}

/** 校验内置伙伴偏好档案。 */
function validatePreferences(preferences: readonly unknown[]): void {
  const ids = new Set<string>();
  for (const [index, preference] of preferences.entries()) {
    const path = `resident_preferences[${String(index)}]`;
    assertRecord(preference, path);
    assertNonEmptyString(preference.resident_id, `${path}.resident_id`);
    assertUnique(ids, preference.resident_id, `${path}.resident_id`);
    assertNonEmptyString(preference.name, `${path}.name`);
    assertGender(preference.gender, `${path}.gender`);
    assertStringArray(preference.likes, `${path}.likes`);
    assertStringArray(preference.dislikes, `${path}.dislikes`);
    assertNonEmptyString(preference.preference_note, `${path}.preference_note`);
  }
}

/** 校验楼层目录和稳定 ID。 */
function validateFloors(floors: readonly unknown[]): void {
  if (floors.length === 0) throw new Error("floors 不能为空。");
  const ids = new Set<string>();
  for (const [index, floor] of floors.entries()) {
    const path = `floors[${String(index)}]`;
    assertRecord(floor, path);
    assertNonEmptyString(floor.floor_id, `${path}.floor_id`);
    assertUnique(ids, floor.floor_id, `${path}.floor_id`);
    assertNonEmptyString(floor.label, `${path}.label`);
    assertNonEmptyString(floor.name, `${path}.name`);
    assertNonNegativeInteger(floor.sort_order, `${path}.sort_order`);
  }
}

/** 校验房间目录、容量级别与楼层引用。 */
function validateRooms(rooms: readonly unknown[], floors: readonly unknown[]): void {
  if (rooms.length === 0) throw new Error("rooms 不能为空。");
  const floorIds = new Set(floors.map((floor) => {
    assertRecord(floor, "floor");
    return String(floor.floor_id);
  }));
  const roomIds = new Set<string>();
  for (const [index, room] of rooms.entries()) {
    const path = `rooms[${String(index)}]`;
    assertRecord(room, path);
    assertNonEmptyString(room.room_id, `${path}.room_id`);
    assertUnique(roomIds, room.room_id, `${path}.room_id`);
    for (const key of ["name", "icon", "function"] as const) {
      assertNonEmptyString(room[key], `${path}.${key}`);
    }
    assertNonEmptyString(room.floor_id, `${path}.floor_id`);
    if (!floorIds.has(room.floor_id)) {
      throw new Error(`${path}.floor_id 引用了未知楼层。`);
    }
    assertNonNegativeInteger(room.grid_column, `${path}.grid_column`, true);
    assertNonNegativeInteger(room.grid_span, `${path}.grid_span`, true);
    assertNonNegativeInteger(room.base_level, `${path}.base_level`);
    if (room.linked_facility_id !== null) {
      assertNonEmptyString(room.linked_facility_id, `${path}.linked_facility_id`);
    }
    assertArray(room.allowed_genders, `${path}.allowed_genders`);
    if (room.allowed_genders.length === 0) {
      throw new Error(`${path}.allowed_genders 不能为空。`);
    }
    room.allowed_genders.forEach((gender, genderIndex) => {
      assertGender(gender, `${path}.allowed_genders[${String(genderIndex)}]`);
    });
    assertArray(room.unlock_requirements, `${path}.unlock_requirements`);
    validateRequirements(room.unlock_requirements, `${path}.unlock_requirements`);
    assertArray(room.levels, `${path}.levels`);
    if (room.levels.length === 0) throw new Error(`${path}.levels 不能为空。`);
    for (const [levelIndex, level] of room.levels.entries()) {
      const levelPath = `${path}.levels[${String(levelIndex)}]`;
      assertRecord(level, levelPath);
      assertNonNegativeInteger(level.level, `${levelPath}.level`, true);
      assertNonNegativeInteger(level.capacity, `${levelPath}.capacity`, true);
      assertArray(level.requirements, `${levelPath}.requirements`);
      validateRequirements(level.requirements, `${levelPath}.requirements`);
    }
  }
}

/** 校验一组需求的可读字段。 */
function validateRequirements(requirements: readonly unknown[], path: string): void {
  requirements.forEach((requirement, index) => {
    const requirementPath = `${path}[${String(index)}]`;
    assertRecord(requirement, requirementPath);
    if (!REQUIREMENT_KINDS.includes(requirement.kind as ShelterRoomRequirementKind)) {
      throw new Error(`${requirementPath}.kind 无效。`);
    }
    assertNonEmptyString(requirement.target_id, `${requirementPath}.target_id`);
    assertNonEmptyString(requirement.label, `${requirementPath}.label`);
    assertNonNegativeInteger(requirement.minimum, `${requirementPath}.minimum`);
  });
}

/** 要求未知值为普通对象。 */
function assertRecord(
  value: unknown,
  path: string,
): asserts value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象。`);
  }
}

/** 要求未知值为数组。 */
function assertArray(value: unknown, path: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组。`);
}

/** 要求值为非空字符串。 */
function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} 必须是非空字符串。`);
  }
}

/** 要求分隔符为至少含一个字符的字符串，保留换行符。 */
function assertStringWithLength(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} 必须是非空字符串。`);
  }
}

/** 要求值为有限数字。 */
function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} 必须是有限数字。`);
  }
}

/** 要求值为非负整数，可选拒绝零。 */
function assertNonNegativeInteger(
  value: unknown,
  path: string,
  positive = false,
): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || (positive && value === 0)
  ) {
    throw new Error(`${path} 必须是${positive ? "正" : "非负"}整数。`);
  }
}

/** 要求值为字符串数组。 */
function assertStringArray(value: unknown, path: string): asserts value is readonly string[] {
  assertArray(value, path);
  value.forEach((entry, index) => {
    assertNonEmptyString(entry, `${path}[${String(index)}]`);
  });
}

/** 要求性别值属于可配置的联合类型。 */
function assertGender(
  value: unknown,
  path: string,
): asserts value is ShelterResidentGender {
  if (!RESIDENT_GENDERS.includes(value as ShelterResidentGender)) {
    throw new Error(`${path} 不是受支持的性别值。`);
  }
}

/** 要求配置 ID 在当前集合中唯一。 */
function assertUnique(ids: Set<string>, value: string, path: string): void {
  if (ids.has(value)) throw new Error(`${path} 重复：${value}。`);
  ids.add(value);
}

const RESIDENT_GENDERS = ["male", "female", "unspecified"] as const;
const REQUIREMENT_KINDS = [
  "facility_level",
  "shelter_expansion",
  "resource",
] as const;
