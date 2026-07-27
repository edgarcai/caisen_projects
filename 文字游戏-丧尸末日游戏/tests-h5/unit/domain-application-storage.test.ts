import { describe, expect, it } from "vitest";
import { createGameApplication, type GameApplication } from "../../src/application";
import { SaveDataError } from "../../src/domain/errors";
import type { GameState } from "../../src/domain/game-state";
import type { RandomSource } from "../../src/domain/ports";
import { MemoryStorage } from "../../src/infrastructure";

const STORAGE_KEY = "test-save-storage";

/** 为存档测试提供稳定且总是选择下界/第一项的随机源。 */
class FixedRandomSource implements RandomSource {
  /** 返回闭区间下界。 */
  public randint(minimum: number, maximum: number): number {
    if (minimum > maximum) throw new RangeError("测试随机区间无效。");
    return minimum;
  }

  /** 返回首个候选项。 */
  public weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError("测试候选项与权重无效。");
    }
    const selected = items[0];
    if (selected === undefined) throw new RangeError("测试候选集合为空。");
    return selected;
  }
}

/** 使用共享内存存储装配一套可相互读写的应用。 */
function buildApplication(storage: MemoryStorage): GameApplication {
  return createGameApplication({
    randomSource: new FixedRandomSource(),
    storage,
    storageKey: STORAGE_KEY,
    backupSlots: 2,
    now: () => new Date("2166-02-03T04:05:06.000Z"),
  });
}

/** 返回已开局状态，避免测试使用非空断言。 */
function requireState(application: GameApplication): GameState {
  const state = application.state;
  if (state === null) throw new Error("测试要求游戏已经开始。");
  return state;
}

/** 从当前玩家状态删除 v6 才引入的年龄与寿命字段。 */
function legacyPlayers(state: GameState): Record<string, unknown>[] {
  return state.players.map((player) => {
    const legacy = structuredClone(player) as unknown as Record<string, unknown>;
    delete legacy.age;
    delete legacy.lifespan;
    return legacy;
  });
}

/** 从当前避难所状态删除 v6 与 v9 才引入的字段。 */
function legacyShelter(state: GameState): Record<string, unknown> {
  const legacy = structuredClone(state.shelter) as unknown as Record<string, unknown>;
  delete legacy.hope;
  delete legacy.inner_wall_health;
  delete legacy.outer_wall_health;
  return legacy;
}

describe("浏览器 v9 存档", () => {
  it("以 snake_case 信封往返完整待探索状态", () => {
    const storage = new MemoryStorage();
    const writer = buildApplication(storage);
    writer.startNewGame(["白菜"], "single");
    writer.prepareExploration("city_a");

    writer.saveGame();
    const serialized = storage.getItem(STORAGE_KEY);
    if (serialized === null) throw new Error("测试存档未写入。");
    const envelope = JSON.parse(serialized) as {
      schema_version: number;
      saved_at: string;
      game_state: Record<string, unknown>;
    };
    expect(envelope.schema_version).toBe(9);
    expect(envelope.saved_at).toBe("2166-02-03T04:05:06.000Z");
    expect(envelope.game_state).toHaveProperty("active_player_index");
    expect(envelope.game_state).toHaveProperty("pending_exploration");
    expect(envelope.game_state).not.toHaveProperty("activePlayerIndex");

    const reader = buildApplication(storage);
    const report = reader.loadGame();

    expect(report.stateChanged).toBe(true);
    expect(reader.state).toEqual(writer.state);
  });

  it("主档损坏时按新到旧顺序恢复可信备份", () => {
    const storage = new MemoryStorage();
    const writer = buildApplication(storage);
    writer.startNewGame(["第一版"], "single");
    writer.saveGame();
    const writerPlayer = requireState(writer).players[0];
    if (writerPlayer === undefined) throw new Error("测试玩家不存在。");
    writerPlayer.hunger = 10;
    writer.saveGame();
    storage.setItem(STORAGE_KEY, "{broken");

    const reader = buildApplication(storage);
    reader.loadGame();

    expect(requireState(reader).players[0]?.name).toBe("第一版");
    expect(requireState(reader).players[0]?.hunger).toBe(0);
  });

  it("读取 v1 后连续迁移并可再次保存为 v9", () => {
    const storage = new MemoryStorage();
    const source = buildApplication(new MemoryStorage());
    source.startNewGame(["旧所长甲", "旧所长乙"], "multiplayer");
    const sourceState = requireState(source);
    const legacyState = {
      mode: sourceState.mode,
      players: legacyPlayers(sourceState),
      active_player_index: sourceState.active_player_index,
      shelter: legacyShelter(sourceState),
      clock: structuredClone(sourceState.clock),
      turn_number: 9,
      ended: false,
      ending_message: "",
    };
    storage.setItem(STORAGE_KEY, JSON.stringify({
      schema_version: 1,
      saved_at: "2023-08-20T12:34:56.000Z",
      game_state: legacyState,
    }));
    const application = buildApplication(storage);

    application.loadGame();

    const migrated = requireState(application);
    expect(migrated.mode).toBe("multiplayer");
    expect(migrated.turn_number).toBe(9);
    expect(migrated.story.flags).toContain("legacy_save");
    expect(migrated.battle).toBeNull();
    expect(migrated.pending_exploration).toBeNull();
    expect(migrated.ending).toBeNull();

    application.saveGame();
    const saved = storage.getItem(STORAGE_KEY);
    if (saved === null) throw new Error("迁移后存档未写入。");
    const envelope = JSON.parse(saved) as {
      schema_version: number;
      game_state: Record<string, unknown>;
    };
    expect(envelope.schema_version).toBe(9);
    expect(envelope.game_state).toHaveProperty("campaign");
    expect(envelope.game_state).not.toHaveProperty("ended");
    expect(envelope.game_state).not.toHaveProperty("ending_message");
  });

  it("坏档抛出稳定错误且不替换当前运行状态", () => {
    const storage = new MemoryStorage();
    const application = buildApplication(storage);
    application.startNewGame(["当前所长"], "single");
    const current = requireState(application);
    storage.setItem(STORAGE_KEY, "{broken");

    expect(() => application.loadGame()).toThrow(SaveDataError);
    expect(application.state).toBe(current);
    expect(requireState(application).players[0]?.name).toBe("当前所长");
  });

  it("拒绝未知场景引用且仍保留当前运行状态", () => {
    const storage = new MemoryStorage();
    const writer = buildApplication(storage);
    writer.startNewGame(["坏场景"], "story");
    writer.saveGame();
    const serialized = storage.getItem(STORAGE_KEY);
    if (serialized === null) throw new Error("测试存档未写入。");
    const envelope = JSON.parse(serialized) as {
      game_state: { story: { current_scene_id: string } };
    };
    envelope.game_state.story.current_scene_id = "missing_scene";
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    const reader = buildApplication(storage);
    reader.startNewGame(["安全状态"], "single");
    const current = requireState(reader);

    expect(() => reader.loadGame()).toThrow("未知剧情场景");
    expect(reader.state).toBe(current);
    expect(requireState(reader).players[0]?.name).toBe("安全状态");
  });
});
