import { describe, expect, it } from "vitest";
import { createGameApplication, type GameApplication } from "../../src/application";
import type { EventsConfigDocument } from "../../src/domain/content";
import type { GameState } from "../../src/domain/game-state";
import type { RandomSource } from "../../src/domain/ports";
import { MemoryStorage } from "../../src/infrastructure";
import {
  GameContent,
  StateOperations,
  TradeAmbushService,
} from "../../src/services";
import { buildH5Harness, requirePlayer, requireState } from "../helpers/H5TestHarness";

/** 为经营测试提供可复现的整数与加权结果。 */
class ManagementRandomSource implements RandomSource {
  private readonly integers: number[];
  private readonly choiceIndexes: number[];

  /** 保存预设随机队列；耗尽后选择闭区间下界和第一项。 */
  public constructor(
    integers: readonly number[] = [],
    choiceIndexes: readonly number[] = [],
  ) {
    this.integers = [...integers];
    this.choiceIndexes = [...choiceIndexes];
  }

  /** 返回队首整数并校验测试数据没有越界。 */
  public randint(minimum: number, maximum: number): number {
    const value = this.integers.shift() ?? minimum;
    if (value < minimum || value > maximum) {
      throw new RangeError(`测试随机值 ${String(value)} 越界。`);
    }
    return value;
  }

  /** 按队首索引返回一个加权候选项。 */
  public weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError("测试加权候选项无效。");
    }
    const selected = items[this.choiceIndexes.shift() ?? 0];
    if (selected === undefined) throw new RangeError("测试加权索引越界。");
    return selected;
  }
}

/** 创建隔离存储的经营测试应用。 */
function buildApplication(random: RandomSource): GameApplication {
  return createGameApplication({
    randomSource: random,
    storage: new MemoryStorage(),
    storageKey: "shelter-management-v7-test",
    now: () => new Date("2166-01-01T00:00:00.000Z"),
  });
}

/** 返回一项稳定 ID 的领域经营选项。 */
function requireManagementOption(
  application: GameApplication,
  category: string,
  optionId: string,
) {
  const option = application.managementOptions().find(
    (candidate) => candidate.category === category && candidate.optionId === optionId,
  );
  if (option === undefined) throw new Error(`缺少经营选项：${category}/${optionId}`);
  return option;
}

describe("v7 避难所设施容量", () => {
  it("容量满时灰锁普通设施，扩建不占容量并能恢复升级资格", () => {
    const application = buildApplication(new ManagementRandomSource([90]));
    application.startNewGame(["容量测试员"], "single");
    const state = requireState(application);
    const player = requirePlayer(state);
    player.parts = 10_000;
    player.coins = 10_000;
    for (const facility of application.content.story.facilities) {
      state.facility_levels[facility.facility_id] = 0;
    }
    state.facility_levels.field_kitchen = 3;
    state.facility_levels.machine_workshop = 3;
    state.facility_levels.radio_room = 3;
    state.facility_levels.hydroponic_greenhouse = 1;

    const blocked = requireManagementOption(application, "facility", "outer_wall");
    expect(blocked.available).toBe(false);
    expect(blocked.requirements.find(
      (requirement) => requirement.id === "outer_wall-capacity",
    )?.met).toBe(false);
    const before = JSON.stringify(state);
    expect(application.performManagement("facility", "outer_wall").stateChanged).toBe(false);
    expect(JSON.stringify(state)).toBe(before);

    expect(application.performManagement("facility", "shelter_expansion").stateChanged)
      .toBe(true);
    expect(state.facility_levels.shelter_expansion).toBe(1);
    const unlocked = requireManagementOption(application, "facility", "outer_wall");
    expect(unlocked.available).toBe(true);
    expect(application.performManagement("facility", "outer_wall").stateChanged).toBe(true);
  });

  it("净水与能源设施分别由一级和二级扩建解锁", () => {
    const application = buildApplication(new ManagementRandomSource([90]));
    application.startNewGame(["工程所长"], "single");
    const state = requireState(application);
    requirePlayer(state).parts = 10_000;
    requirePlayer(state).coins = 10_000;

    expect(requireManagementOption(application, "facility", "water_purification").available)
      .toBe(false);
    expect(requireManagementOption(application, "facility", "energy_center").available)
      .toBe(false);
    application.performManagement("facility", "shelter_expansion");
    expect(requireManagementOption(application, "facility", "water_purification").available)
      .toBe(true);
    expect(requireManagementOption(application, "facility", "energy_center").available)
      .toBe(false);
    application.performManagement("facility", "shelter_expansion");
    expect(requireManagementOption(application, "facility", "energy_center").available)
      .toBe(true);
  });
});

describe("v7 每周交易与途中风险", () => {
  it("全体买卖共享每七天一次额度，并在下一周期自动恢复", () => {
    const application = buildApplication(
      new ManagementRandomSource([90, 100, 100]),
    );
    application.startNewGame(["交易所长"], "single");
    const state = requireState(application);
    requirePlayer(state).coins = 1_000;

    expect(application.performManagement("trade_buy", "caravan_food").stateChanged)
      .toBe(true);
    const afterFirst = JSON.stringify(state);
    expect(application.performManagement("trade_sell", "caravan_food").stateChanged)
      .toBe(false);
    expect(JSON.stringify(state)).toBe(afterFirst);

    state.survival_days = 7;
    expect(application.performManagement("trade_buy", "caravan_medicine").stateChanged)
      .toBe(true);
    expect(state.management_cycle_usage.weekly_trade).toEqual({
      cycle_index: 1,
      count: 1,
    });
  });

  it("配置中的七种伏击结果均可结算且产生互不相同的记录", () => {
    const application = buildApplication(new ManagementRandomSource([90]));
    application.startNewGame(["护送所长"], "single");
    const source = requireState(application);
    requirePlayer(source).coins = 100;
    requirePlayer(source).parts = 100;
    requirePlayer(source).food = 100;
    requirePlayer(source).medical_supplies = 100;
    const messages = new Set<string>();

    for (let outcomeIndex = 0; outcomeIndex < 7; outcomeIndex += 1) {
      const state: GameState = structuredClone(source);
      const random = new ManagementRandomSource([1], [outcomeIndex]);
      const service = new TradeAmbushService(
        application.content,
        new StateOperations(random),
        random,
      );
      const resolution = service.resolve(state, application.content.story.trade.ambush);
      expect(resolution.occurred).toBe(true);
      expect(resolution.message.length).toBeGreaterThan(0);
      messages.add(resolution.message);
    }
    expect(messages.size).toBe(7);
  });

  it("交易伏击将生命降至零时立即结束游戏并禁止治疗复活", () => {
    const application = buildApplication(
      new ManagementRandomSource([90, 1, 3], [2]),
    );
    application.startNewGame(["伤员所长"], "single");
    const state = requireState(application);
    const player = requirePlayer(state);
    player.coins = 100;
    player.health = 3;

    const report = application.performManagement("trade_buy", "caravan_food");

    expect(report).toMatchObject({ stateChanged: true, gameOver: true });
    expect(requirePlayer(state).health).toBe(0);
    expect(state.ending?.ending_id).toBe("last_commander_fallen");
    expect(report.messages).toContain(state.ending?.message);
    expect(state.communication_log.at(-1)?.message).toBe(state.ending?.message);
    expect(() => application.performAction("use_medicine")).toThrow("游戏已经结束");
    expect(requirePlayer(state).health).toBe(0);
  });

  it("交易伏击将希望降至零时即时失败，纯查询不会误触发结算", () => {
    const application = buildApplication(
      new ManagementRandomSource([90, 1, 3], [6]),
    );
    application.startNewGame(["守望所长"], "single");
    const state = requireState(application);
    const player = requirePlayer(state);
    player.coins = 100;
    state.shelter.hope = 0;

    expect(application.managementOptions().length).toBeGreaterThan(0);
    expect(state.ending).toBeNull();
    state.shelter.hope = 2;
    const report = application.performManagement("trade_buy", "caravan_food");

    expect(report).toMatchObject({ stateChanged: true, gameOver: true });
    expect(state.shelter.hope).toBe(0);
    expect(state.ending?.ending_id).toBe("last_hope_extinguished");
    expect(state.communication_log.at(-1)?.message).toBe(state.ending?.message);
  });

  it("伏击文案结算失败时保持原状态原子不变", () => {
    const application = buildApplication(new ManagementRandomSource([90]));
    application.startNewGame(["原子性所长"], "single");
    const state = requireState(application);
    const malformedEvents: EventsConfigDocument = structuredClone(
      application.content.events,
    );
    malformedEvents.events = [
      ...malformedEvents.events,
      {
        id: "malformed_trade_ambush",
        category: "ambush",
        weight: 1,
        title: "错误伏击",
        intro: "测试配置",
        choices: [{
          id: "resolve",
          label: "结算",
          outcomes: [{
            result: "获得{missing}枚金币",
            effects: [{ target: "player.coins", operation: "add", amount: 10 }],
          }],
        }],
      },
    ];
    const content = new GameContent(
      application.content.game,
      application.content.story,
      malformedEvents,
    );
    const random = new ManagementRandomSource([1]);
    const service = new TradeAmbushService(content, new StateOperations(random), random);
    const before = JSON.stringify(state);

    expect(() => service.resolve(state, {
      chance_percent: 100,
      event_id: "malformed_trade_ambush",
      choice_id: "resolve",
    })).toThrow("文案格式化失败");
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("v7 经营详情 UI", () => {
  it("三类页面使用配置映射并展示设施的真实字段与未满足需求", () => {
    const { adapter } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["界面所长"] });
    const snapshot = adapter.getSnapshot();
    const upgrade = snapshot.managementCategories.find(
      (category) => category.id === "upgrade",
    );
    const wall = upgrade?.options.find((option) => option.id === "facility::outer_wall");

    expect(snapshot.managementCategories.map((category) => category.id)).toEqual([
      "operation",
      "activity",
      "upgrade",
    ]);
    expect(wall?.fields.map((field) => field.id)).toContain("capacity");
    expect(wall?.requirements.some(
      (requirement) => requirement.id === "outer_wall-parts"
        && requirement.status === "unmet",
    )).toBe(true);
    expect(wall?.disabledReason).toContain("零件");
  });
});
