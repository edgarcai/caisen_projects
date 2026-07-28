import { describe, expect, it } from "vitest";
import { createGameApplication } from "../../src/application";
import type { GameState } from "../../src/domain/game-state";
import type { StorageLike } from "../../src/domain/ports";
import {
  LocalStorageAchievementRepository,
  MemoryStorage,
} from "../../src/infrastructure";

const ACHIEVEMENT_KEY = "test-achievement-progress";
const ACHIEVEMENT_SCHEMA_VERSION = 1;
const LONG_NIGHT_ACHIEVEMENT_ID = "ending_long_night_watch";

/** 记录成功写入次数，用于验证幂等解锁。 */
class CountingStorage extends MemoryStorage {
  public writes = 0;

  /** 记录写入后使用真实内存存储保留数据。 */
  public override setItem(key: string, value: string): void {
    this.writes += 1;
    super.setItem(key, value);
  }
}

/** 仅让下一次读取失败，用于模拟浏览器存储的瞬时故障。 */
class TransientReadFailureStorage extends MemoryStorage {
  private failNextRead = true;

  /** 首次读取抛错，后续读取恢复为正常内存存储。 */
  public override getItem(key: string): string | null {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error("浏览器暂时拒绝读取。");
    }
    return super.getItem(key);
  }
}

/** 按配置模拟浏览器读取或写入存储失败。 */
class FaultyStorage implements StorageLike {
  private readonly readFailure: boolean;
  private readonly writeFailure: boolean;
  private value: string | null = null;

  /** 保存本次测试需要激活的存储故障。 */
  public constructor(readFailure: boolean, writeFailure: boolean) {
    this.readFailure = readFailure;
    this.writeFailure = writeFailure;
  }

  /** 读取存储值，或按配置抛出浏览器异常。 */
  public getItem(key: string): string | null {
    void key;
    if (this.readFailure) {
      throw new Error("浏览器拒绝读取。");
    }
    return this.value;
  }

  /** 写入存储值，或按配置抛出容量异常。 */
  public setItem(key: string, value: string): void {
    void key;
    if (this.writeFailure) {
      throw new Error("浏览器拒绝写入。");
    }
    this.value = value;
  }

  /** 删除测试存储值。 */
  public removeItem(key: string): void {
    void key;
    this.value = null;
  }
}

/** 用独立存档键与可注入成就仓库创建测试应用。 */
function buildApplication(
  storage: StorageLike,
  achievementRepository = new LocalStorageAchievementRepository(
    storage,
    ACHIEVEMENT_KEY,
    ACHIEVEMENT_SCHEMA_VERSION,
  ),
) {
  return createGameApplication({
    storage,
    storageKey: "test-achievement-save",
    achievementRepository,
    now: () => new Date("2166-03-17T03:17:00.000Z"),
  });
}

/** 返回已开局状态，避免测试使用非空断言。 */
function requireState(state: GameState | null): GameState {
  if (state === null) {
    throw new Error("测试要求游戏已开始。");
  }
  return state;
}

/** 把剧情进度定位到可产生长夜守望结局的最后选择前。 */
function prepareLongNightEnding(state: GameState): void {
  state.story.current_scene_id = "the_last_broadcast";
  state.story.chapter_id = "chapter_4_after_embers";
  state.story.boss_outcomes.uncrowned_king = "guardian_preserved";
  state.story.flags.push("guardian_preserved");
  state.story.key_items.push("guardian_truth");
}

describe("独立成就元进度仓库", () => {
  it("首次解锁落盘，重复解锁不重复写入", () => {
    const storage = new CountingStorage();
    const repository = new LocalStorageAchievementRepository(
      storage,
      ACHIEVEMENT_KEY,
      ACHIEVEMENT_SCHEMA_VERSION,
    );

    expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(true);
    expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(false);
    expect(repository.unlockedAchievementIds()).toEqual([LONG_NIGHT_ACHIEVEMENT_ID]);
    expect(storage.writes).toBe(1);

    const restored = new LocalStorageAchievementRepository(
      storage,
      ACHIEVEMENT_KEY,
      ACHIEVEMENT_SCHEMA_VERSION,
    );
    expect(restored.unlockedAchievementIds()).toEqual([LONG_NIGHT_ACHIEVEMENT_ID]);
  });

  it("损坏文档安全降级，下次解锁会修复为当前版本", () => {
    const storage = new MemoryStorage({ [ACHIEVEMENT_KEY]: "{broken" });
    const repository = new LocalStorageAchievementRepository(
      storage,
      ACHIEVEMENT_KEY,
      ACHIEVEMENT_SCHEMA_VERSION,
    );

    expect(repository.unlockedAchievementIds()).toEqual([]);
    expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(true);
    expect(JSON.parse(storage.getItem(ACHIEVEMENT_KEY) ?? "null")).toEqual({
      schema_version: ACHIEVEMENT_SCHEMA_VERSION,
      unlocked_achievement_ids: [LONG_NIGHT_ACHIEVEMENT_ID],
    });
  });

  it("未来版本不被旧代码覆盖，但当前会话仍可解锁", () => {
    const futureDocument = JSON.stringify({
      schema_version: ACHIEVEMENT_SCHEMA_VERSION + 1,
      unlocked_achievement_ids: ["future_achievement"],
    });
    const storage = new MemoryStorage({ [ACHIEVEMENT_KEY]: futureDocument });
    const repository = new LocalStorageAchievementRepository(
      storage,
      ACHIEVEMENT_KEY,
      ACHIEVEMENT_SCHEMA_VERSION,
    );

    expect(repository.unlockedAchievementIds()).toEqual([]);
    expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(true);
    expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(false);
    expect(repository.unlockedAchievementIds()).toEqual([LONG_NIGHT_ACHIEVEMENT_ID]);
    expect(storage.getItem(ACHIEVEMENT_KEY)).toBe(futureDocument);
  });

  it("存储读写异常不中断结算，并在会话内保持幂等", () => {
    for (const storage of [
      new FaultyStorage(true, false),
      new FaultyStorage(false, true),
    ]) {
      const repository = new LocalStorageAchievementRepository(
        storage,
        ACHIEVEMENT_KEY,
        ACHIEVEMENT_SCHEMA_VERSION,
      );
      expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(true);
      expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(false);
      expect(repository.unlockedAchievementIds()).toEqual([LONG_NIGHT_ACHIEVEMENT_ID]);
    }
  });

  it("瞬时读取失败时不以当前会话成就覆盖既有永久进度", () => {
    const existingAchievementId = "existing_achievement";
    const storedDocument = JSON.stringify({
      schema_version: ACHIEVEMENT_SCHEMA_VERSION,
      unlocked_achievement_ids: [existingAchievementId],
    });
    const storage = new TransientReadFailureStorage({
      [ACHIEVEMENT_KEY]: storedDocument,
    });
    const repository = new LocalStorageAchievementRepository(
      storage,
      ACHIEVEMENT_KEY,
      ACHIEVEMENT_SCHEMA_VERSION,
    );

    expect(repository.unlock(LONG_NIGHT_ACHIEVEMENT_ID)).toBe(true);
    expect(storage.getItem(ACHIEVEMENT_KEY)).toBe(storedDocument);
    expect(repository.unlockedAchievementIds()).toEqual([
      existingAchievementId,
      LONG_NIGHT_ACHIEVEMENT_ID,
    ]);
  });
});

describe("应用层成就触发与补发", () => {
  it("结局提交解锁长夜守望，回档、覆盖存档与新游戏都不回锁", () => {
    const storage = new MemoryStorage();
    const application = buildApplication(storage);
    application.startNewGame(["守望所长"], "story");
    const state = requireState(application.state);
    prepareLongNightEnding(state);
    state.survival_days = 10;
    const checkpointClone = structuredClone(state);
    const { checkpoint: _discarded, ...snapshot } = checkpointClone;
    void _discarded;
    state.checkpoint = {
      survival_day: state.survival_days,
      created_turn: state.turn_number,
      snapshot,
    };

    const ending = application.resolveStoryChoice(
      "the_last_broadcast",
      "continue_shepherd_protocol",
    );

    expect(ending.gameOver).toBe(true);
    expect(requireState(application.state).ending?.ending_id).toBe("long_night_watch");
    expect(application.unlockedAchievementIds()).toEqual([
      LONG_NIGHT_ACHIEVEMENT_ID,
    ]);

    expect(application.rollbackToCheckpoint().stateChanged).toBe(true);
    application.saveGame();
    application.startNewGame(["新任所长"], "single");
    expect(application.unlockedAchievementIds()).toEqual([
      LONG_NIGHT_ACHIEVEMENT_ID,
    ]);
  });

  it("读取旧的已通关存档时补发结局成就", () => {
    const storage = new MemoryStorage();
    const sourceApplication = buildApplication(storage);
    sourceApplication.startNewGame(["旧档所长"], "story");
    const oldState = requireState(sourceApplication.state);
    oldState.ending = {
      ending_id: "long_night_watch",
      outcome: "victory",
      message: "长夜守望旧结局",
    };
    sourceApplication.saveGame();
    expect(sourceApplication.unlockedAchievementIds()).toEqual([]);

    const restoredApplication = buildApplication(
      storage,
      new LocalStorageAchievementRepository(
        storage,
        ACHIEVEMENT_KEY,
        ACHIEVEMENT_SCHEMA_VERSION,
      ),
    );
    const report = restoredApplication.loadGame();

    expect(report.gameOver).toBe(true);
    expect(restoredApplication.unlockedAchievementIds()).toEqual([
      LONG_NIGHT_ACHIEVEMENT_ID,
    ]);
  });
});
