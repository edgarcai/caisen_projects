import { describe, expect, it } from "vitest";
import gameDocument from "../../config/game_config.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import v6ToV7MigrationDocument from "../../config/save_migrations/v6_to_v7.json";
import v7ToV8MigrationDocument from "../../config/save_migrations/v7_to_v8.json";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type {
  GameConfigDocument,
  StoryConfigDocument,
  V6ToV7SaveMigrationConfig,
  V7ToV8SaveMigrationConfig,
} from "../../src/domain/content";
import type { GameState } from "../../src/domain/game-state";
import {
  SaveStateValidator,
  V6ToV7SaveMigrator,
  V7ToV8SaveMigrator,
} from "../../src/infrastructure";
import type { V6ToV7SaveMigrationContext } from "../../src/infrastructure";
import { buildH5Harness, requireState } from "../helpers/H5TestHarness";

const game = gameDocument as unknown as GameConfigDocument;
const story = storyDocument as unknown as StoryConfigDocument;
const migration: V6ToV7SaveMigrationConfig = v6ToV7MigrationDocument;
const currentMigration: V7ToV8SaveMigrationConfig = v7ToV8MigrationDocument;

/** 使用权威内容构造 v6→v7 迁移上下文。 */
function createMigrationContext(): V6ToV7SaveMigrationContext {
  return {
    facilities: story.facilities,
    facilityManagement: story.facility_management,
    allowedHomeCityIds: game.rules.world_map.home_city_ids,
  };
}

/** 使用权威地图与生存系统创建当前存档校验器。 */
function createValidator(): SaveStateValidator {
  return new SaveStateValidator(
    game.rules,
    story.facilities,
    story.facility_management,
    story.defaults.companions.map((companion) => companion.companion_id),
    validateSurvivalSystemsConfig(survivalSystemsDocument),
    game.campaign_profiles,
    game.cities,
  );
}

/** 创建一份包含可回档快照的完整 v7 状态。 */
function createV7StateWithCheckpoint(): GameState {
  const application = buildH5Harness().application;
  application.startNewGame(["迁移所长"], "single");
  const state = structuredClone(requireState(application));
  state.survival_days = game.rules.timeline.checkpoint_interval_days;
  state.turn_number = 4;
  const snapshot = structuredClone(state) as unknown as Record<string, unknown>;
  delete snapshot.checkpoint;
  state.checkpoint = {
    survival_day: state.survival_days,
    created_turn: state.turn_number,
    snapshot: snapshot as never,
  };
  return state;
}

/** 从可恢复状态移除 v7 及更高版本字段，构造真实 v6 结构。 */
function downgradeRestorableState(rawState: Record<string, unknown>): void {
  delete rawState.archive_collection_totals;
  delete rawState.management_cycle_usage;
  delete rawState.shelter_room_assignments;
  delete rawState.encounter_battle;
  delete rawState.pending_return_incident_id;
  const inventory = rawState.inventory as Record<string, unknown>;
  delete inventory.equipped_transport_ids;
}

/** 同时降级当前状态与检查点快照。 */
function createV6StateWithCheckpoint(): Record<string, unknown> {
  const rawState = structuredClone(
    createV7StateWithCheckpoint(),
  ) as unknown as Record<string, unknown>;
  downgradeRestorableState(rawState);
  const checkpoint = rawState.checkpoint as Record<string, unknown>;
  downgradeRestorableState(checkpoint.snapshot as Record<string, unknown>);
  return rawState;
}

/** 按旧版已存在设施的配置上限分配指定总等级。 */
function assignLegacyFacilityTotal(
  rawState: Record<string, unknown>,
  requestedTotal: number,
): void {
  const levels = rawState.facility_levels as Record<string, number>;
  for (const facilityId of Object.keys(levels)) levels[facilityId] = 0;
  const introducedFacilityIds = new Set(
    Object.keys(migration.state_defaults.facility_levels),
  );
  const legacyFacilities = story.facilities.filter((facility) =>
    facility.counts_toward_total_level_limit
      && !introducedFacilityIds.has(facility.facility_id),
  );
  let remaining = requestedTotal;
  for (const facility of legacyFacilities) {
    const assignedLevel = Math.min(facility.max_level, remaining);
    levels[facility.facility_id] = assignedLevel;
    remaining -= assignedLevel;
  }
  if (remaining > 0) {
    throw new Error(`旧版设施无法分配总等级 ${String(requestedTotal)}。`);
  }
  const storyState = rawState.story as Record<string, unknown>;
  const flags = storyState.flags as string[];
  if (!flags.includes("linlan_joined")) flags.push("linlan_joined");
}

/** 读取未知状态中的设施等级容器。 */
function facilityLevelsOf(rawState: Record<string, unknown>): Record<string, number> {
  return rawState.facility_levels as Record<string, number>;
}

/** 将 v7 迁移结果提升到当前 v8 后执行完整领域校验。 */
function validateV7AsCurrent(rawState: Record<string, unknown>): void {
  const current = new V7ToV8SaveMigrator(currentMigration).migrate({
    schema_version: 7,
    game_state: rawState,
  });
  createValidator().parse(current.game_state);
}

describe("v6 到 v7 存档迁移", () => {
  it("同步补齐当前状态与检查点中的载具和经营周期容器", () => {
    const validator = createValidator();
    const source = createV6StateWithCheckpoint();
    validator.validateRawV6(source);

    const document = new V6ToV7SaveMigrator(migration, createMigrationContext()).migrate({
      schema_version: 6,
      game_state: source,
    });
    const state = document.game_state as Record<string, unknown>;
    const inventory = state.inventory as Record<string, unknown>;
    const checkpoint = state.checkpoint as Record<string, unknown>;
    const snapshot = checkpoint.snapshot as Record<string, unknown>;
    const snapshotInventory = snapshot.inventory as Record<string, unknown>;

    expect(document.schema_version).toBe(7);
    expect(inventory.equipped_transport_ids).toEqual([]);
    expect(state.management_cycle_usage).toEqual({});
    expect(snapshotInventory.equipped_transport_ids).toEqual([]);
    expect(snapshot.management_cycle_usage).toEqual({});
    expect(() => {
      validateV7AsCurrent(state);
    }).not.toThrow();
  });

  it("拒绝错误版本链和未持有的伪造载具配装", () => {
    expect(() => new V6ToV7SaveMigrator(
      {
        ...migration,
        to_version: 8,
      },
      createMigrationContext(),
    )).toThrow("版本链无效");

    const state = createV7StateWithCheckpoint();
    state.inventory.equipped_transport_ids = ["motorboat"];
    expect(() => {
      createValidator().validate(state);
    }).toThrow("不在制作物库存");
  });

  it("拒绝超过配置容量的载具和负数周期计数", () => {
    const state = createV7StateWithCheckpoint();
    for (const itemId of ["armored_car", "motorboat", "helicopter"]) {
      state.inventory.crafted_items[itemId] = 1;
    }
    state.inventory.equipped_transport_ids = [
      "armored_car",
      "motorboat",
      "helicopter",
    ];
    expect(() => {
      createValidator().validate(state);
    }).toThrow("超过配置上限");

    state.inventory.equipped_transport_ids = [];
    state.management_cycle_usage.trade = { cycle_index: 0, count: -1 };
    expect(() => {
      createValidator().validate(state);
    }).toThrow("count");
  });

  it("拒绝超过单项上限、越级解锁与超出扩建容量的设施等级", () => {
    const overLevel = createV7StateWithCheckpoint();
    overLevel.facility_levels.water_purification = 4;
    expect(() => createValidator().parse(overLevel)).toThrow("超过配置上限");

    const locked = createV7StateWithCheckpoint();
    locked.facility_levels.water_purification = 1;
    expect(() => createValidator().parse(locked)).toThrow("不满足设施解锁前置");

    const overCapacity = createV7StateWithCheckpoint();
    overCapacity.facility_levels.field_kitchen = 3;
    overCapacity.facility_levels.machine_workshop = 3;
    overCapacity.facility_levels.radio_room = 3;
    overCapacity.facility_levels.outer_wall = 2;
    expect(() => createValidator().parse(overCapacity)).toThrow("超过当前容量");

    const expanded = createV7StateWithCheckpoint();
    expanded.facility_levels.field_kitchen = 3;
    expanded.facility_levels.machine_workshop = 3;
    expanded.facility_levels.radio_room = 3;
    expanded.facility_levels.outer_wall = 3;
    expanded.facility_levels.hydroponic_greenhouse = 3;
    expanded.facility_levels.shelter_expansion = 1;
    expect(() => createValidator().parse(expanded)).not.toThrow();
  });

  it("检查点快照同样拒绝未扩建却伪造的高阶设施", () => {
    const state = createV7StateWithCheckpoint();
    const checkpoint = state.checkpoint;
    if (checkpoint === null) throw new Error("测试状态缺少检查点。");
    checkpoint.snapshot.facility_levels.water_purification = 1;
    checkpoint.snapshot.facility_levels.shelter_expansion = 0;

    expect(() => createValidator().parse(state)).toThrow("不满足设施解锁前置");
  });

  it("拒绝把存档出生地篡改为白名单外的岛屿城市", () => {
    const state = createV7StateWithCheckpoint();
    state.campaign.home_city_id = "city_h";

    expect(() => createValidator().parse(state)).toThrow("不可选的出生城市");
  });

  it("将旧档当前状态与检查点的 H 市出生地同步迁移到配置城市", () => {
    const source = createV6StateWithCheckpoint();
    const campaign = source.campaign as Record<string, unknown>;
    campaign.home_city_id = "city_h";
    const checkpoint = source.checkpoint as Record<string, unknown>;
    const snapshot = checkpoint.snapshot as Record<string, unknown>;
    const snapshotCampaign = snapshot.campaign as Record<string, unknown>;
    snapshotCampaign.home_city_id = "city_h";

    const document = new V6ToV7SaveMigrator(
      migration,
      createMigrationContext(),
    ).migrate({ schema_version: 6, game_state: source });
    const state = document.game_state as Record<string, unknown>;
    const migratedCampaign = state.campaign as Record<string, unknown>;
    const migratedCheckpoint = state.checkpoint as Record<string, unknown>;
    const migratedSnapshot = migratedCheckpoint.snapshot as Record<string, unknown>;
    const migratedSnapshotCampaign = migratedSnapshot.campaign as Record<string, unknown>;
    const expectedCityId = migration.compatibility.home_city_replacements.city_h;

    expect(migratedCampaign.home_city_id).toBe(expectedCityId);
    expect(migratedSnapshotCampaign.home_city_id).toBe(expectedCityId);
    expect(() => {
      validateV7AsCurrent(state);
    }).not.toThrow();
  });

  it.each([
    [11, 1],
    [15, 1],
    [16, 2],
    [18, 2],
  ])("旧档常规设施总等级 %i 自动迁移为扩建 %i 级", (
    occupiedLevel,
    expectedExpansionLevel,
  ) => {
    const source = createV6StateWithCheckpoint();
    assignLegacyFacilityTotal(source, occupiedLevel);

    const document = new V6ToV7SaveMigrator(
      migration,
      createMigrationContext(),
    ).migrate({ schema_version: 6, game_state: source });
    const state = document.game_state as Record<string, unknown>;

    expect(facilityLevelsOf(state).shelter_expansion).toBe(expectedExpansionLevel);
    expect(() => {
      validateV7AsCurrent(state);
    }).not.toThrow();
  });

  it("为当前状态与检查点分别推导最小扩建等级", () => {
    const source = createV6StateWithCheckpoint();
    assignLegacyFacilityTotal(source, 11);
    const checkpoint = source.checkpoint as Record<string, unknown>;
    const snapshot = checkpoint.snapshot as Record<string, unknown>;
    assignLegacyFacilityTotal(snapshot, 18);

    const document = new V6ToV7SaveMigrator(
      migration,
      createMigrationContext(),
    ).migrate({ schema_version: 6, game_state: source });
    const state = document.game_state as Record<string, unknown>;
    const migratedCheckpoint = state.checkpoint as Record<string, unknown>;
    const migratedSnapshot = migratedCheckpoint.snapshot as Record<string, unknown>;

    expect(facilityLevelsOf(state).shelter_expansion).toBe(1);
    expect(facilityLevelsOf(migratedSnapshot).shelter_expansion).toBe(2);
    expect(() => {
      validateV7AsCurrent(state);
    }).not.toThrow();
  });

  it("明确拒绝常规设施总等级超过最高扩建容量的旧档", () => {
    const source = createV6StateWithCheckpoint();
    assignLegacyFacilityTotal(source, 16);
    const context = createMigrationContext();
    const capacityFacilityId = migration.compatibility.capacity_facility_id;
    const facilities = context.facilities.map((facility) =>
      facility.facility_id === capacityFacilityId
        ? { ...facility, max_level: 1, levels: facility.levels.slice(0, 1) }
        : facility,
    );

    expect(() => new V6ToV7SaveMigrator(
      migration,
      { ...context, facilities },
    ).migrate({ schema_version: 6, game_state: source })).toThrow("超过扩建最高容量");
  });

  it("在迁移构造阶段拒绝未知默认设施与重复设施 ID", () => {
    expect(() => new V6ToV7SaveMigrator({
      ...migration,
      state_defaults: {
        ...migration.state_defaults,
        facility_levels: {
          ...migration.state_defaults.facility_levels,
          unknown_facility: 0,
        },
      },
    }, createMigrationContext())).toThrow("未在当前设施配置中声明");

    const context = createMigrationContext();
    const firstFacility = context.facilities[0];
    if (firstFacility === undefined) throw new Error("测试缺少设施配置。");
    expect(() => new V6ToV7SaveMigrator(migration, {
      ...context,
      facilities: [...context.facilities, firstFacility],
    })).toThrow("设施 ID");
  });
});
