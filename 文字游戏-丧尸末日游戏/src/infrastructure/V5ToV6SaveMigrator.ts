import type { V5ToV6SaveMigrationConfig } from "../domain/content";
import { SaveDataError } from "../domain/errors";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";

/** 为 v5 状态补齐希望、寿命、伙伴管理和远征失败字段。 */
export class V5ToV6SaveMigrator implements SaveMigrator {
  public readonly fromVersion: number;
  public readonly toVersion: number;
  private readonly defaults: V5ToV6SaveMigrationConfig["state_defaults"];

  /** 校验单步版本链并保存只读默认值。 */
  public constructor(configuration: V5ToV6SaveMigrationConfig) {
    validateConfiguration(configuration);
    this.fromVersion = configuration.from_version;
    this.toVersion = configuration.to_version;
    this.defaults = structuredClone(configuration.state_defaults);
  }

  /** 同步迁移当前聚合与可回档快照。 */
  public migrate(document: Readonly<SaveDocument>): SaveDocument {
    const rawState = requireObject(document.game_state, "v5 存档 game_state");
    const state = this.migrateRestorableState(rawState);
    if (state.checkpoint !== null) {
      const checkpoint = requireObject(state.checkpoint, "v5 存档 checkpoint");
      state.checkpoint = {
        ...checkpoint,
        snapshot: this.migrateRestorableState(
          requireObject(checkpoint.snapshot, "v5 存档 checkpoint.snapshot"),
        ),
      };
    }
    return {
      ...structuredClone(document),
      schema_version: this.toVersion,
      game_state: state,
    };
  }

  /** 为一份可恢复状态的嵌套容器补齐 v6 字段。 */
  private migrateRestorableState(
    rawState: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const state: Record<string, unknown> = structuredClone(rawState);
    const players = requireArray(state.players, "v5 存档 players");
    state.players = players.map((rawPlayer, index) => ({
      ...requireObject(rawPlayer, `v5 存档 players[${String(index)}]`),
      age: this.defaults.player_age,
      lifespan: this.defaults.player_lifespan,
    }));
    state.shelter = {
      ...requireObject(state.shelter, "v5 存档 shelter"),
      hope: this.defaults.shelter_hope,
    };
    const companions = requireArray(state.companions, "v5 存档 companions");
    state.companions = companions.map((rawCompanion, index) => ({
      ...requireObject(rawCompanion, `v5 存档 companions[${String(index)}]`),
      equipped_weapon_id: this.defaults.companion_equipped_weapon_id,
      equipped_armor_id: this.defaults.companion_equipped_armor_id,
      interaction_cooldown_turns:
        this.defaults.companion_interaction_cooldown_turns,
      interaction_count: this.defaults.companion_interaction_count,
    }));
    state.last_expedition_failure = this.defaults.last_expedition_failure;
    return state;
  }
}

/** 严格校验 v5 到 v6 迁移配置与默认值。 */
function validateConfiguration(configuration: V5ToV6SaveMigrationConfig): void {
  const root = requireObject(configuration, "v5 到 v6 存档迁移配置");
  requireExactKeys(
    root,
    ["schema_version", "from_version", "to_version", "state_defaults"],
    "v5 到 v6 存档迁移配置",
  );
  if (
    configuration.schema_version !== 1
    || configuration.from_version !== 5
    || configuration.to_version !== 6
  ) {
    throw new SaveDataError("v5 到 v6 迁移配置版本链无效。");
  }
  const defaults = requireObject(configuration.state_defaults, "v6 迁移默认值");
  requireExactKeys(defaults, [
    "player_age",
    "player_lifespan",
    "shelter_hope",
    "companion_equipped_weapon_id",
    "companion_equipped_armor_id",
    "companion_interaction_cooldown_turns",
    "companion_interaction_count",
    "last_expedition_failure",
  ], "v6 迁移默认值");
  requireInteger(configuration.state_defaults.player_age, "player_age", 0);
  requireInteger(configuration.state_defaults.player_lifespan, "player_lifespan", 1);
  requireInteger(configuration.state_defaults.shelter_hope, "shelter_hope", 1);
  requireInteger(
    configuration.state_defaults.companion_interaction_cooldown_turns,
    "companion_interaction_cooldown_turns",
    0,
  );
  requireInteger(
    configuration.state_defaults.companion_interaction_count,
    "companion_interaction_count",
    0,
  );
  if (
    defaults.companion_equipped_weapon_id !== null
    || defaults.companion_equipped_armor_id !== null
    || defaults.last_expedition_failure !== null
  ) {
    throw new SaveDataError("v6 迁移可空默认字段必须为 null。");
  }
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

/** 要求未知值是 JSON 对象。 */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveDataError(`${path}必须是对象。`);
  }
  return value as Record<string, unknown>;
}

/** 要求未知值是 JSON 列表。 */
function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SaveDataError(`${path}必须是列表。`);
  }
  return value;
}

/** 要求未知值是不小于下限的整数。 */
function requireInteger(value: unknown, path: string, minimum: number): void {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new SaveDataError(`${path}必须是不小于${String(minimum)}的整数。`);
  }
}
