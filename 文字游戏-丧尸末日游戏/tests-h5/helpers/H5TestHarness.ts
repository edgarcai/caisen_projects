import webConfigDocument from "../../config/web_config.json";
import { createGameApplication, type GameApplication } from "../../src/application";
import { parseWebGameConfig } from "../../src/config/configLoader";
import type { GameState, PlayerState } from "../../src/domain/game-state";
import type { RandomSource } from "../../src/domain/ports";
import type { ActionReport } from "../../src/domain/reports";
import { MemoryStorage } from "../../src/infrastructure";
import { GameUiAdapter } from "../../src/presentation";

export const H5_TEST_STORAGE_KEY = "h5-test-save";

export interface H5TestHarness {
  readonly application: GameApplication;
  readonly adapter: GameUiAdapter;
  readonly storage: MemoryStorage;
  readonly random: ScriptedRandomSource;
}

/** 用显式队列提供可观测、可复现的 H5 测试随机源。 */
export class ScriptedRandomSource implements RandomSource {
  public integerCalls = 0;
  public weightedChoiceCalls = 0;
  private readonly integers: number[];
  private readonly choiceIndexes: number[];

  /** 保存随机队列；耗尽后使用整数下界或第一候选项。 */
  public constructor(
    integers: readonly number[] = [],
    choiceIndexes: readonly number[] = [],
  ) {
    this.integers = [...integers];
    this.choiceIndexes = [...choiceIndexes];
  }

  /** 返回队首整数并记录调用次数。 */
  public randint(minimum: number, maximum: number): number {
    this.integerCalls += 1;
    const value = this.integers.shift() ?? minimum;
    if (value < minimum || value > maximum) {
      throw new RangeError(
        `测试随机值 ${String(value)} 不在 ${String(minimum)}..${String(maximum)}。`,
      );
    }
    return value;
  }

  /** 返回队首索引指向的候选项并记录实际抽取次数。 */
  public weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    this.weightedChoiceCalls += 1;
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

/** 使用真实 H5 配置、隔离存储和可注入随机源装配适配器。 */
export function buildH5Harness(options: {
  readonly storage?: MemoryStorage;
  readonly random?: ScriptedRandomSource;
  readonly storageKey?: string;
} = {}): H5TestHarness {
  const storage = options.storage ?? new MemoryStorage();
  const random = options.random ?? new ScriptedRandomSource();
  const application = createGameApplication({
    randomSource: random,
    storage,
    storageKey: options.storageKey ?? H5_TEST_STORAGE_KEY,
    backupSlots: 2,
    now: () => new Date("2166-03-17T03:17:00.000Z"),
  });
  const webConfig = parseWebGameConfig(webConfigDocument);
  return {
    application,
    adapter: new GameUiAdapter(application, webConfig),
    storage,
    random,
  };
}

/** 返回已开局状态，拒绝测试在菜单态读取领域数据。 */
export function requireState(application: GameApplication): GameState {
  const state = application.state;
  if (state === null) throw new Error("测试要求游戏已经开始。");
  return state;
}

/** 返回指定玩家，拒绝测试夹具索引越界。 */
export function requirePlayer(state: GameState, index = 0): PlayerState {
  const player = state.players[index];
  if (player === undefined) {
    throw new Error(`测试玩家索引 ${String(index)} 越界。`);
  }
  return player;
}

/** 沿当前可用语义选择推进，直到待决远征事件完成结算。 */
export function resolvePendingExplorationBranch(
  application: GameApplication,
): ActionReport {
  if (requireState(application).pending_exploration === null) {
    throw new Error("测试要求存在待决远征分支。");
  }
  const visitedNodeIds = new Set<string>();
  let latestReport: ActionReport | null = null;
  while (requireState(application).pending_exploration !== null) {
    const prompt = application.explorationBranchPrompt();
    if (prompt === null) throw new Error("远征测试分支缺少当前情境。");
    if (visitedNodeIds.has(prompt.nodeId)) {
      throw new Error(`远征测试分支出现循环：${prompt.nodeId}`);
    }
    visitedNodeIds.add(prompt.nodeId);
    const choice = prompt.choices.find(
      (candidate) => application.explorationBranchChoiceAvailable(candidate.id),
    );
    if (choice === undefined) {
      throw new Error(`远征测试分支没有可用选择：${prompt.nodeId}`);
    }
    latestReport = application.resolveExplorationBranch(choice.id);
  }
  if (latestReport === null) throw new Error("远征测试分支未产生结算报告。");
  return latestReport;
}
