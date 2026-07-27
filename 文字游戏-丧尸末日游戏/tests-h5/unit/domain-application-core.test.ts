import { describe, expect, it } from "vitest";
import { createGameApplication, type GameApplication } from "../../src/application";
import { GameApplicationError } from "../../src/domain/errors";
import type { GameState, PlayerState } from "../../src/domain/game-state";
import type { RandomSource } from "../../src/domain/ports";
import { MemoryStorage } from "../../src/infrastructure";
import { advanceClock, daysInMonth, isLeapYear } from "../../src/services";

/** 用显式队列提供可复现的整数与加权选择。 */
class QueueRandomSource implements RandomSource {
  private readonly integers: number[];
  private readonly choiceIndexes: number[];

  /** 保存测试预设值；队列耗尽时分别选择下界和第一项。 */
  public constructor(integers: readonly number[] = [], choiceIndexes: readonly number[] = []) {
    this.integers = [...integers];
    this.choiceIndexes = [...choiceIndexes];
  }

  /** 返回队首整数，并验证它位于请求闭区间。 */
  public randint(minimum: number, maximum: number): number {
    const value = this.integers.shift() ?? minimum;
    if (value < minimum || value > maximum) {
      throw new RangeError(
        `测试随机值 ${String(value)} 不在 ${String(minimum)}..${String(maximum)}。`,
      );
    }
    return value;
  }

  /** 按队首索引选择候选项，默认选择第一项。 */
  public weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError("测试候选项与权重无效。");
    }
    const index = this.choiceIndexes.shift() ?? 0;
    const selected = items[index];
    if (selected === undefined) {
      throw new RangeError(`测试选择索引 ${String(index)} 越界。`);
    }
    return selected;
  }
}

/** 创建使用隔离内存存储和固定时间的测试应用。 */
function buildApplication(random: RandomSource = new QueueRandomSource()): GameApplication {
  return createGameApplication({
    randomSource: random,
    storage: new MemoryStorage(),
    storageKey: "test-save-core",
    backupSlots: 2,
    now: () => new Date("2166-01-01T00:00:00.000Z"),
  });
}

/** 返回已开局状态，避免测试使用非空断言。 */
function requireState(application: GameApplication): GameState {
  const state = application.state;
  if (state === null) throw new Error("测试要求游戏已经开始。");
  return state;
}

/** 返回指定玩家，拒绝测试夹具索引越界。 */
function requirePlayer(state: GameState, index = 0): PlayerState {
  const player = state.players[index];
  if (player === undefined) {
    throw new Error(`测试玩家索引 ${String(index)} 越界。`);
  }
  return player;
}

describe("领域时钟与新游戏", () => {
  it("按公历闰年和可行动时段跨日、跨月", () => {
    expect(isLeapYear(2168)).toBe(true);
    expect(isLeapYear(2200)).toBe(false);
    expect(daysInMonth(2168, 2)).toBe(29);
    const clock = { year: 2168, month: 2, day: 28, hour: 17 };
    const time = buildApplication().content.game.rules.time;

    const report = advanceClock(clock, 1, time);

    expect(report).toEqual({ dayChanged: true, monthChanged: false, yearChanged: false });
    expect(clock).toEqual({ year: 2168, month: 2, day: 29, hour: 6 });
  });

  it("创建单人游戏并拒绝非法双人姓名", () => {
    const application = buildApplication();
    const report = application.startNewGame([" 白菜 "], "single");

    expect(report.stateChanged).toBe(true);
    expect(report.messages).not.toContain(application.content.text("story_started"));
    expect(requireState(application).players.map((player) => player.name)).toEqual(["白菜"]);
    expect(() => application.startNewGame(["同名", "同名"], "multiplayer"))
      .toThrow(GameApplicationError);
  });

  it("本地双人共享世界状态并在普通行动后轮换所长", () => {
    const application = buildApplication();
    application.startNewGame(["甲", "乙"], "multiplayer");
    const state = requireState(application);
    requirePlayer(state).hunger = 10;

    const report = application.performAction("use_food");

    expect(report.stateChanged).toBe(true);
    expect(state.active_player_index).toBe(1);
    expect(state.turn_number).toBe(1);
    expect(state.players.map((player) => player.hunger)).toEqual([0, 0]);
    expect(report.messages.at(-1)).toContain("乙");
  });

  it("统一生存结算按避难所耐久优先生成失败结局", () => {
    const application = buildApplication();
    application.startNewGame(["白菜"], "single");
    const state = requireState(application);
    state.shelter.health = 1;
    requirePlayer(state).hunger = 5;

    const report = application.performAction("use_food");

    expect(report.gameOver).toBe(true);
    expect(state.ending?.ending_id).toBe("shelter_breached");
    expect(state.battle).toBeNull();
    expect(state.pending_exploration).toBeNull();
  });
});

describe("剧情、探索与首领战", () => {
  it("普通模式在应用层拒绝剧情命令且保持状态不变", () => {
    const application = buildApplication();
    application.startNewGame(["白菜"], "single");
    const before = JSON.stringify(requireState(application));

    expect(application.currentStoryPrompt()).toBeNull();
    expect(application.storyStatus()).toBeNull();
    expect(() => application.resolveStoryChoice(
      "last_pot_of_porridge",
      "give_up_share",
    )).toThrow(application.content.text("mode_capability_unavailable", {
      capability: "narrative",
    }));
    expect(JSON.stringify(requireState(application))).toBe(before);
  });

  it("结算首个剧情选择并推进场景与世界回合", () => {
    const application = buildApplication();
    application.startNewGame(["白菜"], "story");
    const prompt = application.currentStoryPrompt();
    if (prompt === null) throw new Error("首场剧情不存在。");

    const report = application.resolveStoryChoice(prompt.sceneId, "give_up_share");

    expect(report.stateChanged).toBe(true);
    expect(requireState(application).story.current_scene_id).toBe("money_and_secrets");
    expect(requireState(application).turn_number).toBe(1);
    expect(application.storyStatus()?.chapterTitle).toContain("饥饿会说话");
  });

  it("锁定首领路线、进入战斗并在胜利后发放路线成果", () => {
    const application = buildApplication(new QueueRandomSource([90, 100, 100, 4]));
    application.startNewGame(["白菜"], "story");
    const state = requireState(application);
    state.story.current_scene_id = "rail_butcher";
    state.story.completed_scene_ids.push("doctor_in_the_rain");
    requirePlayer(state).parts = 20;
    requirePlayer(state).attack = 1_000;

    const opening = application.resolveStoryChoice("rail_butcher", "overload_rail");

    expect(opening.stateChanged).toBe(true);
    expect(state.battle?.boss_id).toBe("rail_butcher");
    expect(state.battle?.health).toBe(126);

    const victory = application.performCombatAction("attack");

    expect(victory.gameOver).toBe(false);
    expect(state.battle).toBeNull();
    expect(state.story.boss_outcomes.rail_butcher).toBe("spared");
    expect(state.story.current_scene_id).toBe("yangguans_day_forty_seven");
    expect(state.story.key_items).toContain("grain_sample");
  });

  it("持久化首次抽取的探索事件，重复打开不会免费重抽", () => {
    const application = buildApplication(new QueueRandomSource([], [0, 0]));
    application.startNewGame(["白菜"], "single");
    const city = application.content.city("city_a");
    const district = application.content.district(
      city.id,
      city.default_district_id,
    );

    const first = application.prepareExploration("city_a");
    const repeated = application.prepareExploration("city_h");

    expect(district.event_ids).toContain(first.eventId);
    expect(repeated.eventId).toBe(first.eventId);
    expect(requireState(application).pending_exploration).toEqual({
      city_id: "city_a",
      district_id: district.id,
      event_id: first.eventId,
    });
    expect(requireState(application).turn_number).toBe(0);

    const event = application.content.event(first.eventId);
    const choiceId = event.choices?.find(
      (choice) => (choice.requirements ?? []).length === 0,
    )?.id ?? null;
    const report = application.resolveExploration(first.eventId, choiceId);

    expect(report.stateChanged).toBe(true);
    expect(requireState(application).pending_exploration).toBeNull();
    expect(requireState(application).turn_number).toBe(1);
    expect(application.expeditionStatus()?.eventsResolved).toBe(1);
  });

  it("取消探索仍应用开场代价且只消耗一个行动", () => {
    const application = buildApplication(new QueueRandomSource([90, 6]));
    application.startNewGame(["白菜"], "single");
    const state = requireState(application);
    const city = application.content.city("city_a");
    const district = city.districts.find((candidate) => (
      candidate.event_ids.includes("thief")
    ));
    if (district === undefined) {
      throw new Error("测试要求 A 市至少一个区划包含小偷事件。");
    }
    state.pending_exploration = {
      city_id: city.id,
      district_id: district.id,
      event_id: "thief",
    };

    const report = application.cancelExploration();

    expect(report.stateChanged).toBe(true);
    expect(state.players[0]?.coins).toBe(34);
    expect(state.pending_exploration).toBeNull();
    expect(state.turn_number).toBe(1);
  });
});

describe("避难所经营与基础物品", () => {
  it("设施按配置小时换算多个世界回合", () => {
    const application = buildApplication();
    application.startNewGame(["白菜"], "single");
    const state = requireState(application);
    requirePlayer(state).parts = 100;
    requirePlayer(state).coins = 100;

    const report = application.performManagement("facility", "outer_wall");

    expect(report.stateChanged).toBe(true);
    expect(state.facility_levels.outer_wall).toBe(1);
    expect(state.turn_number).toBe(7);
    expect(state.shelter.health).toBe(333);
  });

  it("工作结算随机产出与风险，交易不推进世界时间", () => {
    const application = buildApplication(new QueueRandomSource([90, 7, 100]));
    application.startNewGame(["白菜"], "single");
    const state = requireState(application);

    const job = application.performManagement("job", "sort_salvage");
    expect(job.stateChanged).toBe(true);
    expect(state.players[0]?.parts).toBe(19);
    expect(state.turn_number).toBe(2);

    const beforeTradeTurn = state.turn_number;
    const trade = application.performManagement("trade_buy", "caravan_food");
    expect(trade.stateChanged).toBe(true);
    expect(state.players[0]?.food).toBe(22);
    expect(state.turn_number).toBe(beforeTradeTurn);
  });

  it("招募只执行一次，并由配置效果增加人口", () => {
    const application = buildApplication();
    application.startNewGame(["白菜"], "single");
    const state = requireState(application);
    state.facility_levels.hydroponic_greenhouse = 1;
    state.story.humanity = 1;

    const first = application.performManagement("recruit", "su_yao");
    const second = application.performManagement("recruit", "su_yao");

    expect(first.stateChanged).toBe(true);
    expect(second.stateChanged).toBe(false);
    expect(state.story.flags).toContain("su_yao_recruited");
    expect(state.shelter.population).toBe(4);
    expect(state.turn_number).toBe(1);
  });

  it("资源不足或无需使用时保持整个状态原子不变", () => {
    const application = buildApplication();
    application.startNewGame(["白菜"], "single");
    const state = requireState(application);
    requirePlayer(state).parts = 0;
    const beforeRepair = JSON.stringify(state);

    const repair = application.performAction("repair_shelter");
    expect(repair.stateChanged).toBe(false);
    expect(JSON.stringify(state)).toBe(beforeRepair);

    const beforeMedicine = JSON.stringify(state);
    const medicine = application.performAction("use_medicine");
    expect(medicine.stateChanged).toBe(false);
    expect(JSON.stringify(state)).toBe(beforeMedicine);
  });
});
