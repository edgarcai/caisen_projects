import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import {
  activePlayer,
  cloneGameState,
  findCompanion,
  type GameState,
} from "../domain/game-state";
import type {
  CityReconMissionView,
  OutpostOperationalState,
  OutpostView,
  SettlementNetworkConfig,
  SettlementNetworkResolution,
  ShelterArchetypeConfig,
} from "../domain/settlement-network";
import type { GameContent } from "./GameContent";

interface ParsedReconFlag {
  readonly cityId: string;
  readonly companionId: string;
  readonly startedDay: number;
  readonly completionDay: number;
}

interface ParsedOutpostFlag {
  readonly cityId: string;
  readonly districtId: string;
  readonly shelterTypeId: string;
}

interface ParsedAssignmentFlag {
  readonly companionId: string;
  readonly outpostId: string;
}

interface ParsedOutpostOperationsFlag {
  readonly outpostId: string;
  readonly operations: OutpostOperationalState;
}

/** 以剧情标记持久化跨城侦察、分避难所、派驻与周期补给。 */
export class SettlementNetworkService {
  private readonly config: SettlementNetworkConfig;
  private readonly content: GameContent;

  /** 注入城市内容和配置化网络规则，不依赖展示层。 */
  public constructor(config: SettlementNetworkConfig, content: GameContent) {
    this.config = structuredClone(config);
    this.content = content;
    this.validateConfig();
  }

  /** 返回全部可选择的分避难所类型副本。 */
  public shelterTypes(): readonly ShelterArchetypeConfig[] {
    return structuredClone(this.config.shelter_types);
  }

  /** 返回侦察、建设与周物流共用的不可变规则副本。 */
  public rules(): SettlementNetworkConfig["rules"] {
    return structuredClone(this.config.rules);
  }

  /** 返回当前全部跨城侦察任务及剩余天数。 */
  public reconMissions(state: GameState): readonly CityReconMissionView[] {
    return state.story.flags.flatMap((flag) => {
      const mission = this.parseReconFlag(flag);
      if (mission === null) return [];
      const city = this.content.city(mission.cityId);
      const companion = this.requireCompanionProfile(mission.companionId);
      const daysRemaining = Math.max(0, mission.completionDay - state.survival_days);
      return [{
        cityId: city.id,
        cityName: city.name,
        companionId: mission.companionId,
        companionName: companion.name,
        startedDay: mission.startedDay,
        completionDay: mission.completionDay,
        daysRemaining,
        ready: daysRemaining === 0,
      }];
    });
  }

  /** 判断城市是否已由一周侦察正式解锁。 */
  public cityUnlocked(state: GameState, cityId: string): boolean {
    this.content.city(cityId);
    return cityId === state.campaign.home_city_id
      || state.story.flags.includes(this.cityUnlockFlag(cityId));
  }

  /** 返回远城尚未完成一周侦察时的可展示原因。 */
  public cityAccessLockedReason(cityId: string): string {
    const city = this.content.city(cityId);
    return this.text("recon_city_access_locked", { city_name: city.name });
  }

  /** 校验情报、载具与角色状态后派出一周侦察。 */
  public startRecon(
    state: GameState,
    cityId: string,
    companionId: string,
  ): SettlementNetworkResolution {
    const city = this.content.city(cityId);
    if (this.cityUnlocked(state, cityId)) {
      return this.unavailable("recon_already_unlocked", { city_name: city.name });
    }
    if (this.reconMissions(state).some((mission) => mission.cityId === cityId)) {
      return this.unavailable("recon_already_active", { city_name: city.name });
    }
    const companion = findCompanion(state, companionId);
    if (
      companion === undefined
      || companion.status !== "active"
      || this.companionAssigned(state, companionId)
    ) {
      return this.unavailable("recon_companion_unavailable", {
        companion_name: this.requireCompanionProfile(companionId).name,
      });
    }
    if (state.shelter.newspapers < city.intelligence_newspapers_required) {
      return this.unavailable("recon_need_intelligence", {
        required: city.intelligence_newspapers_required,
      });
    }
    if (!this.transportRequirementSatisfied(state, city.transport_item_ids, city.transport_match)) {
      return this.unavailable("recon_need_transport", { city_name: city.name });
    }
    const completionDay = state.survival_days + this.config.rules.recon_duration_days;
    state.story.flags.push(this.reconFlag(
      cityId,
      companionId,
      state.survival_days,
      completionDay,
    ));
    return this.applied("recon_started", {
      city_name: city.name,
      companion_name: this.requireCompanionProfile(companionId).name,
      days: this.config.rules.recon_duration_days,
    });
  }

  /** 在侦察满一周后解锁城市，并生成角色归来对话。 */
  public completeRecon(
    state: GameState,
    cityId: string,
  ): SettlementNetworkResolution {
    const mission = this.reconMissions(state).find((candidate) => candidate.cityId === cityId);
    if (mission === undefined) {
      return this.unavailable("recon_not_found", { city_id: cityId });
    }
    if (!mission.ready) {
      return this.unavailable("recon_not_ready", { days: mission.daysRemaining });
    }
    const working = cloneGameState(state);
    working.story.flags = working.story.flags.filter((flag) => {
      const parsed = this.parseReconFlag(flag);
      return parsed?.cityId !== cityId;
    });
    if (!working.story.flags.includes(this.cityUnlockFlag(cityId))) {
      working.story.flags.push(this.cityUnlockFlag(cityId));
    }
    state.story = working.story;
    return this.applied("recon_completed", {
      city_name: mission.cityName,
      companion_name: mission.companionName,
    });
  }

  /** 在已解锁区划支付金币和零件建立一个分避难所。 */
  public establishOutpost(
    state: GameState,
    cityId: string,
    districtId: string,
    shelterTypeId: string,
  ): SettlementNetworkResolution {
    const city = this.content.city(cityId);
    const district = this.content.district(cityId, districtId);
    const shelterType = this.requireShelterType(shelterTypeId);
    if (!this.cityUnlocked(state, cityId)) {
      return this.unavailable("outpost_city_locked", { city_name: city.name });
    }
    if (this.outposts(state).length >= this.config.rules.maximum_outposts) {
      return this.unavailable("outpost_limit", {
        maximum: this.config.rules.maximum_outposts,
      });
    }
    if (this.outposts(state).some(
      (outpost) => outpost.cityId === cityId && outpost.districtId === districtId,
    )) {
      return this.unavailable("outpost_exists", { district_name: district.name });
    }
    const player = activePlayer(state);
    if (
      player.coins < this.config.rules.outpost_coin_cost
      || player.parts < this.config.rules.outpost_part_cost
    ) {
      return this.unavailable("outpost_resource_shortage", {
        coins: this.config.rules.outpost_coin_cost,
        parts: this.config.rules.outpost_part_cost,
      });
    }
    player.coins -= this.config.rules.outpost_coin_cost;
    player.parts -= this.config.rules.outpost_part_cost;
    state.story.flags.push(this.outpostFlag(cityId, districtId, shelterTypeId));
    state.story.flags.push(this.supplyFlag(
      this.outpostId(cityId, districtId),
      state.survival_days,
    ));
    state.story.flags.push(this.operationsFlag(
      this.outpostId(cityId, districtId),
      this.defaultOutpostOperations(),
    ));
    return this.applied("outpost_established", {
      city_name: city.name,
      district_name: district.name,
      shelter_type: shelterType.label,
    });
  }

  /** 返回全部分避难所、派驻人员与下一次补给日期。 */
  public outposts(state: GameState): readonly OutpostView[] {
    const assignments = state.story.flags.flatMap((flag) => {
      const assignment = this.parseAssignmentFlag(flag);
      return assignment === null ? [] : [assignment];
    });
    return state.story.flags.flatMap((flag) => {
      const parsed = this.parseOutpostFlag(flag);
      if (parsed === null) return [];
      const city = this.content.city(parsed.cityId);
      const district = this.content.district(parsed.cityId, parsed.districtId);
      const shelterType = this.requireShelterType(parsed.shelterTypeId);
      const outpostId = this.outpostId(parsed.cityId, parsed.districtId);
      const assignedCompanionIds = assignments
        .filter((assignment) => assignment.outpostId === outpostId)
        .map((assignment) => assignment.companionId);
      const lastSuppliedDay = this.lastSuppliedDay(state, outpostId);
      const nextSupplyDay = lastSuppliedDay + this.config.rules.supply_interval_days;
      const operations = this.outpostOperations(state, outpostId);
      return [{
        outpostId,
        cityId: city.id,
        cityName: city.name,
        districtId: district.id,
        districtName: district.name,
        shelterTypeId: shelterType.id,
        shelterTypeLabel: shelterType.label,
        capacity: shelterType.starting_capacity,
        assignedCompanionIds,
        assignedCompanionNames: assignedCompanionIds.map(
          (companionId) => this.requireCompanionProfile(companionId).name,
        ),
        lastSuppliedDay,
        nextSupplyDay,
        supplyReady: state.survival_days >= nextSupplyDay,
        operations,
      }];
    });
  }

  /** 将一名已拥有角色派驻到指定分避难所。 */
  public assignCompanion(
    state: GameState,
    outpostId: string,
    companionId: string,
  ): SettlementNetworkResolution {
    const outpost = this.outposts(state).find((candidate) => candidate.outpostId === outpostId);
    if (outpost === undefined) {
      return this.unavailable("outpost_unknown", { outpost_id: outpostId });
    }
    const companion = findCompanion(state, companionId);
    if (
      companion === undefined
      || companion.status !== "active"
      || this.companionAssigned(state, companionId)
    ) {
      return this.unavailable("outpost_companion_unavailable", {
        companion_name: this.requireCompanionProfile(companionId).name,
      });
    }
    state.story.flags.push(this.assignmentFlag(companionId, outpostId));
    return this.applied("outpost_companion_assigned", {
      companion_name: this.requireCompanionProfile(companionId).name,
      city_name: outpost.cityName,
    });
  }

  /** 召回分避难所角色并生成返程对话。 */
  public recallCompanion(
    state: GameState,
    companionId: string,
  ): SettlementNetworkResolution {
    const assignment = state.story.flags.map((flag) => this.parseAssignmentFlag(flag))
      .find((candidate) => candidate?.companionId === companionId);
    if (assignment === undefined || assignment === null) {
      return this.unavailable("outpost_companion_not_assigned", {
        companion_name: this.requireCompanionProfile(companionId).name,
      });
    }
    const outpost = this.outposts(state).find(
      (candidate) => candidate.outpostId === assignment.outpostId,
    );
    state.story.flags = state.story.flags.filter(
      (flag) => this.parseAssignmentFlag(flag)?.companionId !== companionId,
    );
    return this.applied("outpost_companion_recalled", {
      companion_name: this.requireCompanionProfile(companionId).name,
      city_name: outpost?.cityName ?? assignment.outpostId,
    });
  }

  /** 按配置周期向分避难所运送食物和零件。 */
  public supplyOutpost(
    state: GameState,
    outpostId: string,
  ): SettlementNetworkResolution {
    const outpost = this.outposts(state).find((candidate) => candidate.outpostId === outpostId);
    if (outpost === undefined) {
      return this.unavailable("outpost_unknown", { outpost_id: outpostId });
    }
    if (!outpost.supplyReady) {
      return this.unavailable("outpost_supply_not_ready", {
        day: outpost.nextSupplyDay,
      });
    }
    const player = activePlayer(state);
    if (
      player.food < this.config.rules.supply_food_cost
      || player.parts < this.config.rules.supply_part_cost
      || player.coins < this.config.rules.supply_coin_cost
      || player.medical_supplies < this.config.rules.supply_medical_supply_cost
    ) {
      return this.unavailable("outpost_supply_shortage", {
        food: this.config.rules.supply_food_cost,
        parts: this.config.rules.supply_part_cost,
        coins: this.config.rules.supply_coin_cost,
        medical: this.config.rules.supply_medical_supply_cost,
      });
    }
    player.food -= this.config.rules.supply_food_cost;
    player.parts -= this.config.rules.supply_part_cost;
    player.coins -= this.config.rules.supply_coin_cost;
    player.medical_supplies -= this.config.rules.supply_medical_supply_cost;
    const operations = this.outpostOperations(state, outpostId);
    this.replaceOutpostOperations(state, outpostId, {
      ...operations,
      food: operations.food + this.config.rules.supply_food_cost,
      parts: operations.parts + this.config.rules.supply_part_cost,
      coins: operations.coins + this.config.rules.supply_coin_cost,
      medicalSupplies: operations.medicalSupplies
        + this.config.rules.supply_medical_supply_cost,
    });
    state.story.flags = state.story.flags.filter(
      (flag) => this.parseSupplyFlag(flag)?.outpostId !== outpostId,
    );
    state.story.flags.push(this.supplyFlag(outpostId, state.survival_days));
    return this.applied("outpost_supplied", {
      city_name: outpost.cityName,
      food: this.config.rules.supply_food_cost,
      parts: this.config.rules.supply_part_cost,
      coins: this.config.rules.supply_coin_cost,
      medical: this.config.rules.supply_medical_supply_cost,
    });
  }

  /** 判断角色是否正在侦察或已被派驻。 */
  public companionAssigned(state: GameState, companionId: string): boolean {
    return this.reconMissions(state).some((mission) => mission.companionId === companionId)
      || state.story.flags.some(
        (flag) => this.parseAssignmentFlag(flag)?.companionId === companionId,
      );
  }

  /** 校验类型唯一性、时间和经济参数，阻止错误配置进入运行时。 */
  private validateConfig(): void {
    const typeIds = this.config.shelter_types.map((item) => item.id);
    if (
      typeIds.length === 0
      || new Set(typeIds).size !== typeIds.length
      || this.config.rules.recon_duration_days <= 0
      || this.config.rules.maximum_outposts <= 0
      || this.config.rules.supply_interval_days <= 0
      || Object.values(this.config.rules.outpost_operations).some(
        (value) => !Number.isInteger(value) || value < 0,
      )
      || this.config.rules.outpost_operations.maximum_wall_health <= 0
      || this.config.rules.outpost_operations.maximum_hope <= 0
      || this.config.rules.outpost_operations.maximum_activity <= 0
      || this.config.rules.outpost_operations.maximum_facility_level <= 0
      || this.config.rules.flag_namespace.trim() === ""
    ) {
      throw new Error("分避难所配置无效。");
    }
  }

  /** 判断当前装备载具是否满足城市的任意或全部要求。 */
  private transportRequirementSatisfied(
    state: GameState,
    requiredIds: readonly string[],
    match: "any" | "all",
  ): boolean {
    const equipped = new Set(state.inventory.equipped_transport_ids);
    if (match === "all") {
      return requiredIds.length > 0 && requiredIds.every((itemId) => equipped.has(itemId));
    }
    return requiredIds.some((itemId) => equipped.has(itemId));
  }

  /** 按稳定 ID 返回避难所类型。 */
  private requireShelterType(shelterTypeId: string): ShelterArchetypeConfig {
    const shelterType = this.config.shelter_types.find(
      (candidate) => candidate.id === shelterTypeId,
    );
    if (shelterType === undefined) {
      throw new GameApplicationError(this.text("shelter_type_unknown", {
        shelter_type_id: shelterTypeId,
      }));
    }
    return shelterType;
  }

  /** 按稳定 ID 返回角色公开档案。 */
  private requireCompanionProfile(companionId: string) {
    const profile = this.content.story.companions.find(
      (candidate) => candidate.companion_id === companionId,
    );
    if (profile === undefined) {
      throw new GameApplicationError(this.text("companion_unknown", {
        companion_id: companionId,
      }));
    }
    return profile;
  }

  /** 读取指定分避难所最近一次补给日。 */
  private lastSuppliedDay(state: GameState, outpostId: string): number {
    return state.story.flags.map((flag) => this.parseSupplyFlag(flag))
      .find((candidate) => candidate?.outpostId === outpostId)?.day ?? 0;
  }

  /** 解析一条侦察标记，非本系统标记返回空。 */
  private parseReconFlag(flag: string): ParsedReconFlag | null {
    const parts = this.parseFlag(flag, "recon", 4);
    if (parts === null) return null;
    const startedDay = Number(parts[2]);
    const completionDay = Number(parts[3]);
    if (!Number.isInteger(startedDay) || !Number.isInteger(completionDay)) return null;
    return {
      cityId: parts[0] ?? "",
      companionId: parts[1] ?? "",
      startedDay,
      completionDay,
    };
  }

  /** 解析一条分避难所标记，非本系统标记返回空。 */
  private parseOutpostFlag(flag: string): ParsedOutpostFlag | null {
    const parts = this.parseFlag(flag, "outpost", 3);
    if (parts === null) return null;
    return {
      cityId: parts[0] ?? "",
      districtId: parts[1] ?? "",
      shelterTypeId: parts[2] ?? "",
    };
  }

  /** 解析一条人员派驻标记，非本系统标记返回空。 */
  private parseAssignmentFlag(flag: string): ParsedAssignmentFlag | null {
    const parts = this.parseFlag(flag, "assignment", 2);
    if (parts === null) return null;
    return { companionId: parts[0] ?? "", outpostId: parts[1] ?? "" };
  }

  /** 解析一条物流标记，非本系统标记返回空。 */
  private parseSupplyFlag(flag: string): { readonly outpostId: string; readonly day: number } | null {
    const parts = this.parseFlag(flag, "supply", 2);
    if (parts === null) return null;
    const day = Number(parts[1]);
    return Number.isInteger(day) ? { outpostId: parts[0] ?? "", day } : null;
  }

  /** 解析分避难所独立经营状态，非本系统或损坏标记返回空。 */
  private parseOperationsFlag(flag: string): ParsedOutpostOperationsFlag | null {
    const parts = this.parseFlag(flag, "operations", 11);
    if (parts === null) return null;
    const values = parts.slice(1).map(Number);
    if (values.some((value) => !Number.isInteger(value) || value < 0)) return null;
    return {
      outpostId: parts[0] ?? "",
      operations: {
        population: values[0] ?? 0,
        hope: values[1] ?? 0,
        activity: values[2] ?? 0,
        innerWallHealth: values[3] ?? 0,
        outerWallHealth: values[4] ?? 0,
        food: values[5] ?? 0,
        parts: values[6] ?? 0,
        medicalSupplies: values[7] ?? 0,
        coins: values[8] ?? 0,
        facilityLevel: values[9] ?? 0,
      },
    };
  }

  /** 按命名空间、类型和段数解析系统标记。 */
  private parseFlag(flag: string, type: string, segmentCount: number): string[] | null {
    const prefix = `${this.config.rules.flag_namespace}.${type}|`;
    if (!flag.startsWith(prefix)) return null;
    const parts = flag.slice(prefix.length).split("|");
    return parts.length === segmentCount ? parts : null;
  }

  /** 构造侦察任务持久化标记。 */
  private reconFlag(
    cityId: string,
    companionId: string,
    startedDay: number,
    completionDay: number,
  ): string {
    return this.flag("recon", cityId, companionId, startedDay, completionDay);
  }

  /** 构造城市解锁持久化标记。 */
  private cityUnlockFlag(cityId: string): string {
    return this.flag("city", cityId);
  }

  /** 构造分避难所持久化标记。 */
  private outpostFlag(cityId: string, districtId: string, shelterTypeId: string): string {
    return this.flag("outpost", cityId, districtId, shelterTypeId);
  }

  /** 构造人员派驻持久化标记。 */
  private assignmentFlag(companionId: string, outpostId: string): string {
    return this.flag("assignment", companionId, outpostId);
  }

  /** 构造最近补给日持久化标记。 */
  private supplyFlag(outpostId: string, day: number): string {
    return this.flag("supply", outpostId, day);
  }

  /** 把分避难所独立经营状态序列化为旧存档可兼容的命名空间标记。 */
  private operationsFlag(outpostId: string, operations: OutpostOperationalState): string {
    return this.flag(
      "operations",
      outpostId,
      operations.population,
      operations.hope,
      operations.activity,
      operations.innerWallHealth,
      operations.outerWallHealth,
      operations.food,
      operations.parts,
      operations.medicalSupplies,
      operations.coins,
      operations.facilityLevel,
    );
  }

  /** 从版本化规则创建分避难所的初始经营状态。 */
  private defaultOutpostOperations(): OutpostOperationalState {
    const rules = this.config.rules.outpost_operations;
    return {
      population: rules.starting_population,
      hope: rules.starting_hope,
      activity: rules.starting_activity,
      innerWallHealth: rules.starting_inner_wall_health,
      outerWallHealth: rules.starting_outer_wall_health,
      food: rules.starting_food,
      parts: rules.starting_parts,
      medicalSupplies: rules.starting_medical_supplies,
      coins: rules.starting_coins,
      facilityLevel: 1,
    };
  }

  /** 读取分避难所独立状态；旧标记存档按配置默认值即时升级。 */
  private outpostOperations(state: GameState, outpostId: string): OutpostOperationalState {
    return state.story.flags.map((flag) => this.parseOperationsFlag(flag))
      .find((candidate) => candidate?.outpostId === outpostId)?.operations
      ?? this.defaultOutpostOperations();
  }

  /** 原子替换指定分避难所的唯一经营状态标记。 */
  private replaceOutpostOperations(
    state: GameState,
    outpostId: string,
    operations: OutpostOperationalState,
  ): void {
    state.story.flags = state.story.flags.filter(
      (flag) => this.parseOperationsFlag(flag)?.outpostId !== outpostId,
    );
    state.story.flags.push(this.operationsFlag(outpostId, operations));
  }

  /** 将城市与区划合成为稳定分避难所 ID。 */
  private outpostId(cityId: string, districtId: string): string {
    return `${cityId}~${districtId}`;
  }

  /** 按配置命名空间构造不含用户输入的稳定标记。 */
  private flag(type: string, ...segments: readonly (string | number)[]): string {
    return `${this.config.rules.flag_namespace}.${type}|${segments.join("|")}`;
  }

  /** 返回配置化失败结果。 */
  private unavailable(
    textKey: string,
    values: Readonly<Record<string, string | number>>,
  ): SettlementNetworkResolution {
    return { applied: false, messages: [this.text(textKey, values)], turnsConsumed: 0 };
  }

  /** 返回配置化成功结果。 */
  private applied(
    textKey: string,
    values: Readonly<Record<string, string | number>>,
  ): SettlementNetworkResolution {
    return { applied: true, messages: [this.text(textKey, values)], turnsConsumed: 0 };
  }

  /** 读取并格式化系统文案。 */
  private text(
    textKey: string,
    values: Readonly<Record<string, string | number>>,
  ): string {
    const template = this.config.texts[textKey];
    if (template === undefined) {
      throw new Error(`分避难所文案缺失：${textKey}`);
    }
    return formatTemplate(template, values);
  }
}
