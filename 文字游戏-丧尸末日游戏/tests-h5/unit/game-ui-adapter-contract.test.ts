import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../src/infrastructure";
import { ChronicleService } from "../../src/services";
import type { GameUiSnapshot } from "../../src/ui/ports/GameUiPort";
import {
  buildH5Harness,
  H5_TEST_STORAGE_KEY,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";

/** 只统计主存档写入次数，忽略仓库内部的滚动备份写入。 */
class CountingMemoryStorage extends MemoryStorage {
  public primaryWrites = 0;

  /** 记录主存档写入并保持内存存储原有行为。 */
  public override setItem(key: string, value: string): void {
    if (key === H5_TEST_STORAGE_KEY) this.primaryWrites += 1;
    super.setItem(key, value);
  }
}

/** 从同步命令结果中读取快照。 */
function requireSnapshot(snapshot: GameUiSnapshot | undefined): GameUiSnapshot {
  if (snapshot === undefined) throw new Error("适配器命令没有返回快照。");
  return snapshot;
}

/** 直接完成一个生存日，用于隔离验证检查点驱动的自动存档策略。 */
function completeCheckpointDay(
  chronicle: ChronicleService,
  state: ReturnType<typeof requireState>,
  day: number,
): void {
  state.clock = { year: 2166, month: 1, day, hour: 17 };
  chronicle.completeDay(state, structuredClone(state.clock), [`第${String(day)}日`]);
}

describe("GameUiAdapter 快照与订阅契约", () => {
  it("菜单态提供配置化品牌、人数、教程和空游戏视图", () => {
    const { adapter } = buildH5Harness();

    const snapshot = adapter.getSnapshot();

    expect(snapshot.revision).toBe(0);
    expect(snapshot.brand).toEqual({ title: "避难所", subtitle: "余烬纪元" });
    expect(snapshot.playerCounts).toEqual({
      single: 1,
      multiplayer: 2,
      story: 1,
      endless: 1,
    });
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

  it("单人开局生成完整指挥台快照但不在检查点前落盘", () => {
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
    expect(snapshot.storyAccess).toBe("hidden");
    expect(snapshot.storyPrompt).toBeNull();
    expect(snapshot.mission).toBeNull();
    expect(snapshot.activePlayer).toMatchObject({ id: "player-0", name: "白菜" });
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.clock).toEqual({
      dateLabel: "2166年1月1日",
      timeLabel: "6:00",
      turnLabel: "第 0 回合",
    });
    expect(snapshot.meters).toHaveLength(5);
    expect(snapshot.resources).toHaveLength(14);
    expect(snapshot.shelterStats).toHaveLength(9);
    expect(snapshot.actionGroups.map((group) => group.id)).toEqual([
      "core",
      "supplies",
      "development",
    ]);
    expect(snapshot.actionGroups.some((group) => group.id === "system")).toBe(false);
    expect(snapshot.cities).toHaveLength(8);
    expect(snapshot.managementCategories.map((category) => category.id)).toEqual([
      "support",
      "facility",
      "job",
      "activity",
      "trade",
      "recruit",
    ]);
    expect(snapshot.companions).toHaveLength(4);
    expect(adapter.canLoadGame()).toBe(false);
  });

  it("未持有的城市通行道具与载具仍显示配置名称而非内部 ID", () => {
    const { adapter, application } = buildH5Harness();
    const started = adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["路线测试员"],
    });
    const snapshot = requireSnapshot(started.snapshot);
    const cityAccess = application.expeditionCities().find(
      (access) => access.city.id === "city_b",
    );
    const cityView = snapshot.cities.find((city) => city.id === "city_b");
    const catalogNames = new Map(
      application.warehouseItemCatalog().map((item) => [item.itemId, item.name]),
    );
    const pathItems = cityView?.fields.find((field) => field.id === "path-items")?.value;
    const transportItems = cityView?.fields.find(
      (field) => field.id === "transport-items",
    )?.value;

    expect(application.warehouseItems().map((item) => item.itemId)).not.toContain(
      "route_map",
    );
    expect(cityAccess).toBeDefined();
    expect(cityView).toBeDefined();
    for (const itemId of cityAccess?.city.path_item_ids ?? []) {
      expect(pathItems).toContain(catalogNames.get(itemId));
      expect(pathItems).not.toContain(itemId);
    }
    for (const itemId of cityAccess?.city.transport_item_ids ?? []) {
      expect(transportItems).toContain(catalogNames.get(itemId));
      expect(transportItems).not.toContain(itemId);
    }
  });

  it("普通模式拒绝伪造剧情命令且不会修改领域状态", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["生存所长"],
    });
    const before = JSON.stringify(application.state);

    const result = adapter.execute({
      type: "story_choice",
      choiceId: "give_up_share",
    });

    expect(result.accepted).toBe(false);
    expect(result.notice).toMatchObject({ tone: "danger" });
    expect(result.notice?.message).toContain("仅能在剧情模式");
    expect(JSON.stringify(application.state)).toBe(before);
    expect(requireSnapshot(result.snapshot).storyPrompt).toBeNull();
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

  it("活动远征读档后由领域读模型恢复携带物与战利品名称", () => {
    const writer = buildH5Harness();
    writer.adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["远征所长"],
    });
    const writerState = requireState(writer.application);
    const city = writer.application.content.city("city_a");
    const district = writer.application.content.district(
      city.id,
      city.default_district_id,
    );
    writerState.inventory.crafted_items.field_ration = 1;
    writer.adapter.execute({
      type: "expedition_begin",
      cityId: city.id,
      districtId: district.id,
      companionIds: [],
      carriedItems: { field_ration: 1 },
    });
    if (writerState.expedition === null) {
      throw new Error("测试远征没有成功建立。");
    }
    writerState.expedition.loot.game_consoles = 1;
    writer.adapter.execute({ type: "save_game" });

    const reader = buildH5Harness({ storage: writer.storage });
    const loaded = reader.adapter.execute({ type: "load_game" });
    const snapshot = requireSnapshot(loaded.snapshot);

    expect(snapshot.expeditionStatus).toMatchObject({
      cityId: city.id,
      districtId: district.id,
    });
    expect(snapshot.expeditionStatus?.itemNames).toEqual({
      field_ration: "行军口粮",
      game_consoles: "游戏机",
    });
  });

  it("返回封面由页面导航处理，领域状态和存档保持可用", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    adapter.execute({ type: "save_game" });
    const state = requireState(application);

    const result = adapter.execute({ type: "return_to_menu" });
    const snapshot = requireSnapshot(result.snapshot);

    expect(result.accepted).toBe(true);
    expect(application.state).toBe(state);
    expect(snapshot.mode).toBe("single");
    expect(snapshot.activePlayer?.name).toBe("白菜");
    expect(adapter.canLoadGame()).toBe(true);
  });

  it("只在首次观察到每个十日检查点时自动写入主存档", () => {
    const storage = new CountingMemoryStorage();
    const { adapter, application } = buildH5Harness({ storage });
    adapter.execute({ type: "start_game", mode: "story", playerNames: ["白菜"] });
    const state = requireState(application);
    const chronicle = new ChronicleService(application.content);

    expect(storage.primaryWrites).toBe(0);
    expect(storage.getItem(H5_TEST_STORAGE_KEY)).toBeNull();
    expect(adapter.getSnapshot().canRollback).toBe(false);

    for (let day = 1; day <= 10; day += 1) {
      completeCheckpointDay(chronicle, state, day);
    }
    adapter.execute({ type: "story_choice", choiceId: "give_up_share" });

    expect(state.checkpoint?.survival_day).toBe(10);
    expect(adapter.getSnapshot().canRollback).toBe(true);
    expect(storage.primaryWrites).toBe(1);
    expect(storage.getItem(H5_TEST_STORAGE_KEY)).not.toBeNull();

    requirePlayer(state).hunger = 10;
    requirePlayer(state).food = 10;
    adapter.execute({ type: "supply_action", actionId: "use_food" });
    expect(storage.primaryWrites).toBe(1);

    for (let day = 12; day <= 20; day += 1) {
      completeCheckpointDay(chronicle, state, day);
    }
    expect(state.checkpoint?.survival_day).toBe(20);
    requirePlayer(state).hunger = 10;
    requirePlayer(state).food = 10;
    adapter.execute({ type: "supply_action", actionId: "use_food" });

    expect(storage.primaryWrites).toBe(2);
  });

  it("生存保障仅展示供餐和修复，并通过 management_action 路由两项行动", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    const state = requireState(application);
    const support = adapter.getSnapshot().managementCategories.find(
      (category) => category.id === "support",
    );

    expect(support?.options.map((option) => option.id)).toEqual([
      "support::feed_shelter",
      "support::repair_shelter",
    ]);

    requirePlayer(state).food = 100;
    state.shelter.group_hunger = 25;
    const fed = adapter.execute({
      type: "management_action",
      categoryId: "support",
      optionId: "support::feed_shelter",
    });
    expect(fed.accepted).toBe(true);
    expect(state.shelter.group_hunger).toBeLessThan(25);

    requirePlayer(state).parts = 100;
    state.shelter.health = 100;
    const repaired = adapter.execute({
      type: "management_action",
      categoryId: "support",
      optionId: "support::repair_shelter",
    });
    expect(repaired.accepted).toBe(true);
    expect(state.shelter.health).toBeGreaterThan(100);
  });

  it("剧情模式使用单所长输入，回档通过独立命令而非普通读档", () => {
    const { adapter } = buildH5Harness();

    const started = adapter.execute({
      type: "start_game",
      mode: "story",
      playerNames: ["小满"],
    });
    const rollback = adapter.execute({ type: "rollback_checkpoint" });

    expect(requireSnapshot(started.snapshot).mode).toBe("story");
    expect(rollback.accepted).toBe(false);
    expect(rollback.notice).toMatchObject({ tone: "warning" });
    expect(rollback.notice?.message).toContain("没有可用检查点");
  });
});
