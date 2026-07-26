import { describe, expect, it } from "vitest";
import type { GameUiSnapshot } from "../../src/ui/ports/GameUiPort";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";

/** 从同步命令结果中读取快照。 */
function requireSnapshot(snapshot: GameUiSnapshot | undefined): GameUiSnapshot {
  if (snapshot === undefined) throw new Error("适配器命令没有返回快照。");
  return snapshot;
}

describe("GameUiAdapter 快照与订阅契约", () => {
  it("菜单态提供配置化品牌、人数、教程和空游戏视图", () => {
    const { adapter } = buildH5Harness();

    const snapshot = adapter.getSnapshot();

    expect(snapshot.revision).toBe(0);
    expect(snapshot.brand).toEqual({ title: "避难所", subtitle: "余烬纪元" });
    expect(snapshot.playerCounts).toEqual({ single: 1, multiplayer: 2 });
    expect(snapshot.mode).toBeNull();
    expect(snapshot.activePlayer).toBeNull();
    expect(snapshot.players).toEqual([]);
    expect(snapshot.clock).toBeNull();
    expect(snapshot.actionGroups).toEqual([]);
    expect(snapshot.storyPrompt).toBeNull();
    expect(snapshot.tutorial?.body).toContain("B-17避难所");
    expect(snapshot.ending).toBeNull();
    expect(adapter.canLoadGame()).toBe(false);
  });

  it("每条命令只推送一次递增快照，取消订阅后不再收到事件", () => {
    const { adapter } = buildH5Harness();
    const revisions: number[] = [];
    const unsubscribe = adapter.subscribe((snapshot) => {
      revisions.push(snapshot.revision);
    });

    const first = adapter.execute({ type: "load_game" });

    expect(first.accepted).toBe(false);
    expect(first.notice).toMatchObject({ tone: "danger", title: "无法继续" });
    expect(requireSnapshot(first.snapshot).revision).toBe(1);
    expect(revisions).toEqual([1]);

    unsubscribe();
    unsubscribe();
    adapter.execute({ type: "load_game" });
    expect(revisions).toEqual([1]);
  });

  it("单人开局生成完整指挥台快照并自动建立存档", () => {
    const { adapter } = buildH5Harness();

    const result = adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: [" 白菜 "],
    });
    const snapshot = requireSnapshot(result.snapshot);

    expect(result.accepted).toBe(true);
    expect(result.notice?.tone).toBe("success");
    expect(snapshot.mode).toBe("single");
    expect(snapshot.activePlayer).toMatchObject({ id: "player-0", name: "白菜" });
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.clock).toEqual({
      dateLabel: "2166年1月1日",
      timeLabel: "6:00",
      turnLabel: "第 0 回合",
    });
    expect(snapshot.meters).toHaveLength(4);
    expect(snapshot.resources).toHaveLength(12);
    expect(snapshot.shelterStats).toHaveLength(8);
    expect(snapshot.actionGroups).toHaveLength(3);
    expect(snapshot.storyPrompt?.id).toBe("last_pot_of_porridge");
    expect(snapshot.cities).toHaveLength(8);
    expect(snapshot.managementCategories.map((category) => category.id)).toEqual([
      "facility",
      "job",
      "trade",
      "recruit",
    ]);
    expect(snapshot.companions).toHaveLength(4);
    expect(adapter.canLoadGame()).toBe(true);
  });

  it("双人行动轮换后可显式保存，并由新适配器恢复同一快照", () => {
    const writer = buildH5Harness();
    writer.adapter.execute({
      type: "start_game",
      mode: "multiplayer",
      playerNames: ["甲", "乙"],
    });
    const state = requireState(writer.application);
    requirePlayer(state).hunger = 10;

    const action = writer.adapter.execute({ type: "supply_action", actionId: "use_food" });
    const saved = writer.adapter.execute({ type: "save_game" });

    expect(action.accepted).toBe(true);
    expect(requireSnapshot(action.snapshot).activePlayer?.name).toBe("乙");
    expect(saved.notice?.title).toBe("保存游戏");

    const reader = buildH5Harness({ storage: writer.storage });
    const loaded = reader.adapter.execute({ type: "load_game" });
    const snapshot = requireSnapshot(loaded.snapshot);

    expect(loaded.accepted).toBe(true);
    expect(loaded.notice?.title).toBe("读取存档");
    expect(snapshot.mode).toBe("multiplayer");
    expect(snapshot.players.map((player) => player.name)).toEqual(["甲", "乙"]);
    expect(snapshot.activePlayer?.name).toBe("乙");
    expect(snapshot.clock?.turnLabel).toBe("第 1 回合");
  });

  it("返回封面由页面导航处理，领域状态和存档保持可用", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    const state = requireState(application);

    const result = adapter.execute({ type: "return_to_menu" });
    const snapshot = requireSnapshot(result.snapshot);

    expect(result.accepted).toBe(true);
    expect(application.state).toBe(state);
    expect(snapshot.mode).toBe("single");
    expect(snapshot.activePlayer?.name).toBe("白菜");
    expect(adapter.canLoadGame()).toBe(true);
  });
});
