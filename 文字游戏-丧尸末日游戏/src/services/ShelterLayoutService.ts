import type {
  ShelterAssignmentOption,
  ShelterAssignmentResolution,
  ShelterFloorView,
  ShelterHarmonyTierConfig,
  ShelterLayoutConfig,
  ShelterLayoutContext,
  ShelterLayoutView,
  ShelterRelationshipEffect,
  ShelterRequirementView,
  ShelterResidentProfile,
  ShelterRoomAssignments,
  ShelterRoomConfig,
  ShelterRoomRequirementConfig,
  ShelterRoomView,
} from "../domain/shelter-layout";
import { SaveDataError } from "../domain/errors";

/** 将避难所房间规划、需求判定和人际关系评估从 UI 中隔离。 */
export class ShelterLayoutService {
  private readonly config: ShelterLayoutConfig;

  /** 注入已校验的独立避难所布局配置。 */
  public constructor(config: ShelterLayoutConfig) {
    this.config = config;
  }

  /** 返回只读布局配置，供展示边界复用同一份文案与几何 token。 */
  public configuration(): ShelterLayoutConfig {
    return this.config;
  }

  /**
   * 从配置引用的资源和扩张设施组装实时布局上下文。
   */
  public createContext(
    residents: readonly ShelterResidentProfile[],
    facilityLevels: Readonly<Record<string, number>>,
    resources: Readonly<Record<string, number>>,
  ): ShelterLayoutContext {
    const expansionTargets = this.requirementTargetIds("shelter_expansion");
    const shelterExpansionLevel = expansionTargets.reduce(
      (maximum, targetId) => Math.max(maximum, facilityLevels[targetId] ?? 0),
      0,
    );
    return {
      residents: this.resolveResidents(residents),
      facilityLevels: { ...facilityLevels },
      shelterExpansionLevel,
      resources: { ...resources },
    };
  }

  /** 返回房间需求真正引用的资源 ID，避免组合根维护第二份白名单。 */
  public resourceRequirementIds(): readonly string[] {
    return this.requirementTargetIds("resource");
  }

  /**
   * 返回与实时姓名合并后的人员档案，伙伴喜恶关系由配置补全。
   */
  public resolveResidents(
    residents: readonly ShelterResidentProfile[],
  ): readonly ShelterResidentProfile[] {
    const configured = new Map(
      this.config.resident_preferences.map((preference) => [
        preference.resident_id,
        preference,
      ]),
    );
    return residents.map((resident) => {
      const preference = configured.get(resident.residentId);
      if (preference === undefined) return { ...resident };
      return {
        ...resident,
        name: resident.name.trim().length > 0 ? resident.name : preference.name,
        gender: resident.gender === "unspecified"
          ? preference.gender
          : resident.gender,
        likes: resident.likes.length > 0 ? [...resident.likes] : [...preference.likes],
        dislikes: resident.dislikes.length > 0
          ? [...resident.dislikes]
          : [...preference.dislikes],
        preferenceNote: resident.preferenceNote.trim().length > 0
          ? resident.preferenceNote
          : preference.preference_note,
      };
    });
  }

  /**
   * 从配置默认方案生成新存档的房间分配，过滤尚未加入的人员。
   */
  public createDefaultAssignments(
    residents: readonly ShelterResidentProfile[],
  ): Record<string, string[]> {
    const resolvedResidents = this.resolveResidents(residents);
    const residentById = new Map(
      resolvedResidents.map((resident) => [resident.residentId, resident]),
    );
    const assigned = new Set<string>();
    return Object.fromEntries(this.config.rooms.map((room) => {
      const defaults = this.config.default_assignments[room.room_id] ?? [];
      const roomResidents = defaults.filter((residentId) => {
        const resident = residentById.get(residentId);
        if (
          resident === undefined
          || !resident.active
          || assigned.has(residentId)
          || !room.allowed_genders.includes(resident.gender)
        ) {
          return false;
        }
        assigned.add(residentId);
        return true;
      }).slice(0, this.capacityAtLevel(room, room.base_level));
      return [room.room_id, roomResidents];
    }));
  }

  /**
   * 在持久化边界校验房间、住民、解锁、性别与容量规则。
   */
  public validatePersistentAssignments(
    assignments: ShelterRoomAssignments,
    context: ShelterLayoutContext,
  ): void {
    const resolvedContext = this.resolveContext(context);
    const roomById = new Map(
      this.config.rooms.map((room) => [room.room_id, room]),
    );
    const residentById = new Map(
      resolvedContext.residents.map((resident) => [resident.residentId, resident]),
    );
    for (const [roomId, residentIds] of Object.entries(assignments)) {
      const room = roomById.get(roomId);
      if (room === undefined) {
        throw new SaveDataError(formatTemplate(
          this.config.validation_copy.unknown_room_format,
          { room_id: roomId },
        ));
      }
      const residents = residentIds.map((residentId) => {
        const resident = residentById.get(residentId);
        if (resident === undefined) {
          throw new SaveDataError(formatTemplate(
            this.config.validation_copy.unknown_resident_format,
            { room: room.name, resident_id: residentId },
          ));
        }
        return resident;
      });
      if (residents.length === 0) continue;
      const level = this.roomLevel(room, resolvedContext);
      const locked = level <= 0 || this.requirementViews(
        room.unlock_requirements,
        resolvedContext,
      ).some((requirement) => !requirement.met);
      if (locked) {
        throw new SaveDataError(formatTemplate(
          this.config.validation_copy.locked_room_format,
          { room: room.name },
        ));
      }
      for (const resident of residents) {
        if (!room.allowed_genders.includes(resident.gender)) {
          throw new SaveDataError(formatTemplate(
            this.config.validation_copy.gender_restricted_format,
            { resident: resident.name, room: room.name },
          ));
        }
      }
      const activeCount = residents.filter((resident) => resident.active).length;
      const capacity = this.capacityAtLevel(room, level);
      if (activeCount > capacity) {
        throw new SaveDataError(formatTemplate(
          this.config.validation_copy.capacity_exceeded_format,
          {
            room: room.name,
            active_count: activeCount,
            capacity,
          },
        ));
      }
    }
  }

  /**
   * 把存档分配和实时设施数据投影为横切面页面模型。
   */
  public createView(
    assignments: ShelterRoomAssignments,
    context: ShelterLayoutContext,
  ): ShelterLayoutView {
    const resolvedContext = this.resolveContext(context);
    const normalized = this.normalizeAssignments(assignments, resolvedContext.residents);
    const activeResidents = resolvedContext.residents.filter(
      (resident) => resident.active,
    );
    const activeResidentById = new Map(
      activeResidents.map((resident) => [resident.residentId, resident]),
    );
    const effects = this.relationshipEffects(normalized, activeResidentById);
    const rooms = this.config.rooms.map((room) => this.createRoomView(
      room,
      normalized[room.room_id] ?? [],
      resolvedContext,
      effects.filter((effect) => effect.roomId === room.room_id),
    ));
    const assignedIds = new Set(
      rooms.flatMap((room) => room.residentIds),
    );
    const unassignedResidents = activeResidents.filter(
      (resident) => !assignedIds.has(resident.residentId),
    );
    const harmony = this.harmonyScore(
      effects.reduce((total, effect) => total + effect.scoreDelta, 0)
        - unassignedResidents.length * this.config.harmony.unassigned_penalty,
    );
    const advice = this.globalAdvice(effects, unassignedResidents);
    return {
      title: this.config.title,
      description: this.config.description,
      assignedCount: assignedIds.size,
      activeCount: activeResidents.length,
      unassignedResidents,
      harmony,
      harmonyLabel: this.harmonyLabel(harmony),
      advice,
      floors: this.createFloorViews(rooms),
      rooms,
      residents: resolvedContext.residents,
    };
  }

  /**
   * 返回指定房间的全部人员候选项，包含容量、性别和解锁阻断原因。
   */
  public assignmentOptions(
    assignments: ShelterRoomAssignments,
    roomId: string,
    context: ShelterLayoutContext,
  ): readonly ShelterAssignmentOption[] {
    const resolvedContext = this.resolveContext(context);
    const normalized = this.normalizeAssignments(assignments, resolvedContext.residents);
    const view = this.createView(normalized, resolvedContext);
    const targetRoom = view.rooms.find((room) => room.roomId === roomId);
    const roomConfig = this.config.rooms.find((room) => room.room_id === roomId);
    if (targetRoom === undefined || roomConfig === undefined) return [];
    const roomNameById = new Map(view.rooms.map((room) => [room.roomId, room.name]));
    return resolvedContext.residents.map((resident) => {
      const currentRoomId = this.assignedRoomId(normalized, resident.residentId);
      const assignedToTarget = currentRoomId === roomId;
      const unavailableReason = assignedToTarget
        ? ""
        : this.assignmentUnavailableReason(
            resident,
            targetRoom,
            roomConfig,
          );
      return {
        residentId: resident.residentId,
        residentName: resident.name,
        gender: resident.gender,
        currentRoomId,
        currentRoomName: currentRoomId === null
          ? null
          : roomNameById.get(currentRoomId) ?? null,
        assignedToTarget,
        available: assignedToTarget || unavailableReason.length === 0,
        unavailableReason,
        likesNames: this.relationshipNames(resident.likes, resolvedContext.residents),
        dislikesNames: this.relationshipNames(
          resident.dislikes,
          resolvedContext.residents,
        ),
        preferenceNote: resident.preferenceNote,
      };
    });
  }

  /**
   * 计划调入或移出一名人员，不原地修改传入存档。
   */
  public planAssignment(
    assignments: ShelterRoomAssignments,
    residentId: string,
    targetRoomId: string | null,
    context: ShelterLayoutContext,
  ): ShelterAssignmentResolution {
    const resolvedContext = this.resolveContext(context);
    const normalized = this.normalizeAssignments(assignments, resolvedContext.residents);
    const resident = resolvedContext.residents.find(
      (candidate) => candidate.residentId === residentId,
    );
    if (resident === undefined) {
      return this.rejected(normalized, this.config.copy.unknown_resident_reason, resolvedContext);
    }
    if (targetRoomId === null) {
      if (this.assignedRoomId(normalized, residentId) === null) {
        return this.rejected(
          normalized,
          this.config.copy.already_unassigned_reason,
          resolvedContext,
        );
      }
      const next = this.removeResident(normalized, residentId);
      return {
        applied: true,
        assignments: next,
        message: formatTemplate(this.config.copy.removal_success_format, {
          name: resident.name,
        }),
        harmony: this.createView(next, resolvedContext).harmony,
      };
    }
    const targetRoom = this.config.rooms.find((room) => room.room_id === targetRoomId);
    if (targetRoom === undefined) {
      return this.rejected(normalized, this.config.copy.unknown_room_reason, resolvedContext);
    }
    const option = this.assignmentOptions(normalized, targetRoomId, resolvedContext).find(
      (candidate) => candidate.residentId === residentId,
    );
    if (option === undefined || !option.available || option.assignedToTarget) {
      return this.rejected(
        normalized,
        option?.unavailableReason || this.config.copy.unknown_resident_reason,
        resolvedContext,
      );
    }
    const next = this.removeResident(normalized, residentId);
    next[targetRoomId] = [...(next[targetRoomId] ?? []), residentId];
    const harmony = this.createView(next, resolvedContext).harmony;
    return {
      applied: true,
      assignments: next,
      message: formatTemplate(this.config.copy.assignment_success_format, {
        name: resident.name,
        room: targetRoom.name,
        harmony,
      }),
      harmony,
    };
  }

  /** 将传入上下文的伙伴档案与配置偏好合并。 */
  private resolveContext(context: ShelterLayoutContext): ShelterLayoutContext {
    return {
      ...context,
      residents: this.resolveResidents(context.residents),
    };
  }

  /** 把分配约束为已知房间、已知人员且每人最多一个房间。 */
  private normalizeAssignments(
    assignments: ShelterRoomAssignments,
    residents: readonly ShelterResidentProfile[],
  ): Record<string, string[]> {
    const knownResidents = new Set(residents.map((resident) => resident.residentId));
    const seenResidents = new Set<string>();
    return Object.fromEntries(this.config.rooms.map((room) => [
      room.room_id,
      (assignments[room.room_id] ?? []).filter((residentId) => {
        if (!knownResidents.has(residentId) || seenResidents.has(residentId)) {
          return false;
        }
        seenResidents.add(residentId);
        return true;
      }),
    ]));
  }

  /** 把房间配置与实时状态转换为可见模型。 */
  private createRoomView(
    room: ShelterRoomConfig,
    assignedResidentIds: readonly string[],
    context: ShelterLayoutContext,
    effects: readonly ShelterRelationshipEffect[],
  ): ShelterRoomView {
    const residentById = new Map(
      context.residents.map((resident) => [resident.residentId, resident]),
    );
    const level = this.roomLevel(room, context);
    const capacity = this.capacityAtLevel(room, level);
    const unlockRequirements = this.requirementViews(room.unlock_requirements, context);
    const locked = level <= 0 || unlockRequirements.some((requirement) => !requirement.met);
    const residentIds = assignedResidentIds.filter(
      (residentId) => residentById.get(residentId)?.active === true,
    );
    const residentNames = residentIds.map(
      (residentId) => residentById.get(residentId)?.name ?? residentId,
    );
    const full = !locked && residentIds.length >= capacity;
    const nextLevel = [...room.levels]
      .sort((left, right) => left.level - right.level)
      .find((candidate) => candidate.level > level);
    const nextExpansionRequirements = nextLevel === undefined
      ? []
      : this.requirementViews(nextLevel.requirements, context);
    const roomHarmony = this.harmonyScore(
      effects.reduce((total, effect) => total + effect.scoreDelta, 0),
    );
    return {
      roomId: room.room_id,
      name: room.name,
      icon: room.icon,
      floorId: room.floor_id,
      gridColumn: room.grid_column,
      gridSpan: room.grid_span,
      function: room.function,
      level,
      levelLabel: formatTemplate(this.config.copy.level_label_format, { level }),
      capacity,
      residentIds,
      residentNames,
      locked,
      full,
      statusLabel: locked
        ? this.config.copy.locked_status
        : full
          ? this.config.copy.full_status
          : this.config.copy.running_status,
      unlockRequirements,
      nextExpansionRequirements,
      expansionLabel: nextLevel === undefined
        ? this.config.copy.maximum_level
        : this.requirementsText(nextExpansionRequirements),
      harmony: roomHarmony,
      harmonyLabel: this.harmonyLabel(roomHarmony),
      advice: effects.length === 0
        ? [this.config.copy.stable_advice]
        : effects.map((effect) => effect.advice),
    };
  }

  /** 按楼层配置顺序组装房间列表。 */
  private createFloorViews(
    rooms: readonly ShelterRoomView[],
  ): readonly ShelterFloorView[] {
    return [...this.config.floors]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((floor) => ({
        floorId: floor.floor_id,
        label: floor.label,
        name: floor.name,
        sortOrder: floor.sort_order,
        rooms: rooms.filter((room) => room.floorId === floor.floor_id),
      }));
  }

  /** 计算指定房间内所有无序人员对的双向关系影响。 */
  private relationshipEffects(
    assignments: ShelterRoomAssignments,
    residents: ReadonlyMap<string, ShelterResidentProfile>,
  ): readonly ShelterRelationshipEffect[] {
    return this.config.rooms.flatMap((room) => {
      const roomResidents = (assignments[room.room_id] ?? [])
        .map((residentId) => residents.get(residentId))
        .filter((resident): resident is ShelterResidentProfile => resident !== undefined);
      const effects: ShelterRelationshipEffect[] = [];
      roomResidents.forEach((residentA, index) => {
        for (let otherIndex = index + 1; otherIndex < roomResidents.length; otherIndex += 1) {
          const residentB = roomResidents[otherIndex];
          if (residentB === undefined) continue;
          effects.push(this.relationshipEffect(room.room_id, residentA, residentB));
        }
      });
      return effects;
    });
  }

  /** 计算一对同室人员的喜恶分值和建议。 */
  private relationshipEffect(
    roomId: string,
    residentA: ShelterResidentProfile,
    residentB: ShelterResidentProfile,
  ): ShelterRelationshipEffect {
    const aLikesB = residentA.likes.includes(residentB.residentId);
    const bLikesA = residentB.likes.includes(residentA.residentId);
    const aDislikesB = residentA.dislikes.includes(residentB.residentId);
    const bDislikesA = residentB.dislikes.includes(residentA.residentId);
    const affinityDirections = Number(aLikesB) + Number(bLikesA);
    const conflictDirections = Number(aDislikesB) + Number(bDislikesA);
    const conflict = conflictDirections > 0;
    const affinity = affinityDirections > 0 && !conflict;
    return {
      roomId,
      residentAId: residentA.residentId,
      residentBId: residentB.residentId,
      scoreDelta:
        affinityDirections * this.config.harmony.like_bonus
        - conflictDirections * this.config.harmony.dislike_penalty,
      conflict,
      affinity,
      advice: formatTemplate(
        conflict
          ? this.config.copy.conflict_advice_format
          : affinity
            ? this.config.copy.affinity_advice_format
            : this.config.copy.stable_advice,
        { name_a: residentA.name, name_b: residentB.name },
      ),
    };
  }

  /** 把冲突、配合与未分配人员整理成去重的全局建议。 */
  private globalAdvice(
    effects: readonly ShelterRelationshipEffect[],
    unassignedResidents: readonly ShelterResidentProfile[],
  ): readonly string[] {
    const advice = effects
      .filter((effect) => effect.conflict || effect.affinity)
      .map((effect) => effect.advice);
    if (unassignedResidents.length > 0) {
      advice.push(formatTemplate(this.config.copy.unassigned_advice_format, {
        names: unassignedResidents
          .map((resident) => resident.name)
          .join(this.config.copy.list_separator),
      }));
    }
    const uniqueAdvice = [...new Set(advice)];
    return uniqueAdvice.length > 0 ? uniqueAdvice : [this.config.copy.stable_advice];
  }

  /** 按当前设施等级与房间基础级别取实际等级。 */
  private roomLevel(room: ShelterRoomConfig, context: ShelterLayoutContext): number {
    const linkedLevel = room.linked_facility_id === null
      ? 0
      : context.facilityLevels[room.linked_facility_id] ?? 0;
    return Math.max(room.base_level, linkedLevel);
  }

  /** 返回不超过当前等级的最高配置容量。 */
  private capacityAtLevel(room: ShelterRoomConfig, level: number): number {
    return [...room.levels]
      .sort((left, right) => right.level - left.level)
      .find((candidate) => candidate.level <= level)?.capacity ?? 0;
  }

  /** 把配置需求转换为含当前数值的可见结果。 */
  private requirementViews(
    requirements: readonly ShelterRoomRequirementConfig[],
    context: ShelterLayoutContext,
  ): readonly ShelterRequirementView[] {
    return requirements.map((requirement) => {
      const current = this.requirementCurrent(requirement, context);
      const met = current >= requirement.minimum;
      return {
        kind: requirement.kind,
        targetId: requirement.target_id,
        label: requirement.label,
        current,
        minimum: requirement.minimum,
        met,
        text: formatTemplate(
          met
            ? this.config.copy.requirement_met_format
            : this.config.copy.requirement_unmet_format,
          { label: requirement.label, current, minimum: requirement.minimum },
        ),
      };
    });
  }

  /** 按需求类型从实时上下文读取数值。 */
  private requirementCurrent(
    requirement: ShelterRoomRequirementConfig,
    context: ShelterLayoutContext,
  ): number {
    if (requirement.kind === "facility_level") {
      return context.facilityLevels[requirement.target_id] ?? 0;
    }
    if (requirement.kind === "shelter_expansion") {
      return context.shelterExpansionLevel;
    }
    return context.resources[requirement.target_id] ?? 0;
  }

  /** 从解锁与扩建需求中收集去重后的配置目标 ID。 */
  private requirementTargetIds(
    kind: ShelterRoomRequirementConfig["kind"],
  ): readonly string[] {
    const requirements = this.config.rooms.flatMap((room) => [
      ...room.unlock_requirements,
      ...room.levels.flatMap((level) => level.requirements),
    ]);
    return [...new Set(
      requirements
        .filter((requirement) => requirement.kind === kind)
        .map((requirement) => requirement.target_id),
    )];
  }

  /** 把一组需求转换为页面可阅读正文。 */
  private requirementsText(requirements: readonly ShelterRequirementView[]): string {
    return requirements.length === 0
      ? this.config.copy.no_requirement
      : requirements
          .map((requirement) => requirement.text)
          .join(this.config.copy.advice_separator);
  }

  /** 返回某人员当前所在房间。 */
  private assignedRoomId(
    assignments: ShelterRoomAssignments,
    residentId: string,
  ): string | null {
    return this.config.rooms.find(
      (room) => (assignments[room.room_id] ?? []).includes(residentId),
    )?.room_id ?? null;
  }

  /** 返回人员调入房间的第一个阻断原因。 */
  private assignmentUnavailableReason(
    resident: ShelterResidentProfile,
    room: ShelterRoomView,
    roomConfig: ShelterRoomConfig,
  ): string {
    if (!resident.active) return this.config.copy.inactive_reason;
    if (room.locked) return this.config.copy.locked_room_reason;
    if (!roomConfig.allowed_genders.includes(resident.gender)) {
      return formatTemplate(this.config.copy.gender_restricted_reason_format, {
        room: room.name,
        allowed: roomConfig.allowed_genders
          .map((gender) => this.config.copy.gender_labels[gender])
          .join(this.config.copy.list_separator),
      });
    }
    if (room.full) return this.config.copy.room_full_reason;
    return "";
  }

  /** 从所有房间移除一名人员并返回新映射。 */
  private removeResident(
    assignments: ShelterRoomAssignments,
    residentId: string,
  ): Record<string, string[]> {
    return Object.fromEntries(this.config.rooms.map((room) => [
      room.room_id,
      (assignments[room.room_id] ?? []).filter((candidate) => candidate !== residentId),
    ]));
  }

  /** 把关系 ID 转换为当前存档中的人物名称。 */
  private relationshipNames(
    residentIds: readonly string[],
    residents: readonly ShelterResidentProfile[],
  ): readonly string[] {
    const names = new Map(residents.map((resident) => [resident.residentId, resident.name]));
    return residentIds.map((residentId) => names.get(residentId) ?? residentId);
  }

  /** 把原始关系增量投影到配置化全局分数范围。 */
  private harmonyScore(delta: number): number {
    return Math.min(
      this.config.harmony.maximum,
      Math.max(this.config.harmony.minimum, this.config.harmony.base_score + delta),
    );
  }

  /** 根据分数选择最高的已达成文本档位。 */
  private harmonyLabel(score: number): string {
    const tier = [...this.config.harmony.tiers]
      .sort((left, right) => right.minimum - left.minimum)
      .find((candidate) => score >= candidate.minimum);
    return tier?.label ?? this.lowestHarmonyTier().label;
  }

  /** 返回最低和谐度档位作为安全回退。 */
  private lowestHarmonyTier(): ShelterHarmonyTierConfig {
    return [...this.config.harmony.tiers]
      .sort((left, right) => left.minimum - right.minimum)[0]
      ?? { minimum: this.config.harmony.minimum, label: "" };
  }

  /** 保留当前分配并生成拒绝结算。 */
  private rejected(
    assignments: ShelterRoomAssignments,
    message: string,
    context: ShelterLayoutContext,
  ): ShelterAssignmentResolution {
    const copied = Object.fromEntries(
      Object.entries(assignments).map(([roomId, residents]) => [roomId, [...residents]]),
    );
    return {
      applied: false,
      assignments: copied,
      message,
      harmony: this.createView(copied, context).harmony,
    };
  }
}

/** 用稳定占位符替换组装配置文案。 */
function formatTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
