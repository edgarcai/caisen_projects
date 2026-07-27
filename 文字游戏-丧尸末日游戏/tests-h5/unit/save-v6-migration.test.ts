import gameDocument from "../../config/game_config.json";
import storyDocument from "../../config/story.json";
import survivalSystemsDocument from "../../config/survival_systems.json";
import v5ToV6MigrationDocument from "../../config/save_migrations/v5_to_v6.json";
import v6ToV7MigrationDocument from "../../config/save_migrations/v6_to_v7.json";
import { describe, expect, it } from "vitest";
import { createGameApplication } from "../../src/application";
import { validateSurvivalSystemsConfig } from "../../src/config/survivalSystemsValidator";
import type {
  GameConfigDocument,
  StoryConfigDocument,
  V5ToV6SaveMigrationConfig,
  V6ToV7SaveMigrationConfig,
} from "../../src/domain/content";
import type { GameState } from "../../src/domain/game-state";
import type { SaveRepository, SaveSlotSummary } from "../../src/domain/ports";
import {
  SaveStateValidator,
  V5ToV6SaveMigrator,
  V6ToV7SaveMigrator,
} from "../../src/infrastructure";
import type { V6ToV7SaveMigrationContext } from "../../src/infrastructure";

const game = gameDocument as unknown as GameConfigDocument;
const story = storyDocument as unknown as StoryConfigDocument;
const migration: V5ToV6SaveMigrationConfig = v5ToV6MigrationDocument;
const currentMigration: V6ToV7SaveMigrationConfig = v6ToV7MigrationDocument;

/** 使用权威内容构造 v6→v7 迁移上下文。 */
function createV7MigrationContext(): V6ToV7SaveMigrationContext {
  return {
    facilities: story.facilities,
    facilityManagement: story.facility_management,
    allowedHomeCityIds: game.rules.world_map.home_city_ids,
  };
}

/** 为迁移测试创建无外部存储副作用的端口。 */
class FixtureRepository implements SaveRepository {
  /** 返回空栏位集合。 */
  public listSlots(): readonly SaveSlotSummary[] { return []; }
  /** 迁移夹具始终不声明已有存档。 */
  public exists(): boolean { return false; }
  /** 忽略迁移测试中的持久化请求。 */
  public save(): void { /* 迁移夹具不落盘。 */ }
  /** 拒绝夹具未实现的读档操作。 */
  public load(): GameState { throw new Error("迁移夹具不支持读档。"); }
  /** 忽略迁移测试中的栏位切换。 */
  public selectSlot(): void { /* 迁移夹具不记录栏位。 */ }
  /** 为应用层提供稳定的一号测试栏位。 */
  public activeSlot(): number { return 1; }
}

/** 使用权威配置创建 v6 存档校验器。 */
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

/** 创建一份完整 v6 新局状态。 */
function createV6State(): GameState {
  const application = createGameApplication({ repository: new FixtureRepository() });
  application.startNewGame(["迁移所长"], "single");
  if (application.state === null) throw new Error("迁移状态未创建。");
  return structuredClone(application.state);
}

/** 递归移除只属于 v6 的字段，构造真实 v5 结构。 */
function downgradeRestorableState(rawState: Record<string, unknown>): void {
  delete rawState.management_cycle_usage;
  delete (rawState.inventory as Record<string, unknown>).equipped_transport_ids;
  delete rawState.last_expedition_failure;
  const players = rawState.players as Record<string, unknown>[];
  for (const player of players) {
    delete player.age;
    delete player.lifespan;
  }
  delete (rawState.shelter as Record<string, unknown>).hope;
  const companions = rawState.companions as Record<string, unknown>[];
  for (const companion of companions) {
    delete companion.equipped_weapon_id;
    delete companion.equipped_armor_id;
    delete companion.interaction_cooldown_turns;
    delete companion.interaction_count;
  }
}

/** 从当前状态构造当前聚合和检查点都待迁移的 v5 状态。 */
function createV5StateWithCheckpoint(): Record<string, unknown> {
  const state = createV6State();
  state.survival_days = 10;
  state.turn_number = 4;
  const snapshot = structuredClone(state) as unknown as Record<string, unknown>;
  delete snapshot.checkpoint;
  state.checkpoint = {
    survival_day: 10,
    created_turn: 4,
    snapshot: snapshot as never,
  };
  const raw = structuredClone(state) as unknown as Record<string, unknown>;
  downgradeRestorableState(raw);
  const checkpoint = raw.checkpoint as Record<string, unknown>;
  downgradeRestorableState(checkpoint.snapshot as Record<string, unknown>);
  return raw;
}

describe("v5 到 v6 存档迁移", () => {
  it("同步补齐当前状态与检查点，并通过 v6 语义校验", () => {
    const validator = createValidator();
    const source = createV5StateWithCheckpoint();
    validator.validateRawV5(source);

    const document = new V5ToV6SaveMigrator(migration).migrate({
      schema_version: 5,
      game_state: source,
    });
    const state = document.game_state as Record<string, unknown>;
    const player = (state.players as Record<string, unknown>[])[0];
    const shelter = state.shelter as Record<string, unknown>;
    const companion = (state.companions as Record<string, unknown>[])[0];
    const checkpoint = state.checkpoint as Record<string, unknown>;
    const snapshot = checkpoint.snapshot as Record<string, unknown>;

    expect(document.schema_version).toBe(6);
    expect(player).toMatchObject({ age: 25, lifespan: 95 });
    expect(shelter.hope).toBe(60);
    expect(companion).toMatchObject({
      equipped_weapon_id: null,
      equipped_armor_id: null,
      interaction_cooldown_turns: 0,
      interaction_count: 0,
    });
    expect(snapshot).toHaveProperty("last_expedition_failure", null);
    const current = new V6ToV7SaveMigrator(
      currentMigration,
      createV7MigrationContext(),
    ).migrate(document);
    expect(() => validator.parse(current.game_state)).not.toThrow();
  });

  it("拒绝错误版本链与伪造的伙伴装备占用", () => {
    expect(() => new V5ToV6SaveMigrator({
      ...migration,
      to_version: 7,
    })).toThrow("版本链无效");

    const state = createV6State();
    state.inventory.crafted_items.pipe_rifle = 1;
    const firstCompanion = state.companions[0];
    const secondCompanion = state.companions[1];
    if (firstCompanion === undefined || secondCompanion === undefined) {
      throw new Error("测试要求至少两名伙伴。");
    }
    firstCompanion.equipped_weapon_id = "pipe_rifle";
    secondCompanion.equipped_weapon_id = "pipe_rifle";

    expect(() => {
      createValidator().validate(state);
    }).toThrow("占用数超过");
  });

  it("拒绝伪造为配置生命区间之外的强制返程摘要", () => {
    const state = createV6State();
    state.last_expedition_failure = {
      reason: "steps_exhausted",
      kept_percent: 20,
      health_before: 100,
      health_after: 46,
      total_original: 0,
      total_kept: 0,
      total_lost: 0,
      items: [],
    };

    expect(() => {
      createValidator().validate(state);
    }).toThrow("生命不在配置随机区间内");
  });
});
