import { describe, expect, it } from "vitest";
import type { GameUiSnapshot, UiOptionView } from "../../src/ui/ports/GameUiPort";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
  ScriptedRandomSource,
} from "../helpers/H5TestHarness";

/** 从同步命令结果中读取快照。 */
function requireSnapshot(snapshot: GameUiSnapshot | undefined): GameUiSnapshot {
  if (snapshot === undefined) throw new Error("适配器命令没有返回快照。");
  return snapshot;
}

/** 在全部行动分组中读取指定按钮。 */
function requireAction(snapshot: GameUiSnapshot, actionId: string): UiOptionView {
  for (const group of snapshot.actionGroups) {
    const action = group.actions.find((candidate) => candidate.id === actionId);
    if (action !== undefined) return action;
  }
  throw new Error(`快照缺少行动 ${actionId}。`);
}

describe("H5 剧情、战斗与探索命令流", () => {
  it("剧情锁定选择不修改状态，合法选择推进任务且检查点前不自动存档", () => {
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "story", playerNames: ["白菜"] });
    const state = requireState(harness.application);
    requirePlayer(state).food = 0;
    const lockedPrompt = harness.adapter.getSnapshot().storyPrompt;
    const share = lockedPrompt?.options.find((option) => option.id === "share_rations");
    expect(share).toMatchObject({ disabled: true, disabledReason: "食物至少需要 6" });
    const before = JSON.stringify(state);

    const locked = harness.adapter.execute({ type: "story_choice", choiceId: "share_rations" });

    expect(locked.accepted).toBe(false);
    expect(locked.notice?.tone).toBe("warning");
    expect(JSON.stringify(state)).toBe(before);

    const resolved = harness.adapter.execute({
      type: "story_choice",
      choiceId: "give_up_share",
    });

    expect(resolved.accepted).toBe(true);
    expect(requireSnapshot(resolved.snapshot).storyPrompt?.id).toBe("money_and_secrets");
    expect(state.turn_number).toBe(1);
    expect(harness.adapter.canLoadGame()).toBe(false);
  });

  it("首领路线显示战斗快照，胜利后清空战斗并推进主线", () => {
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "story", playerNames: ["白菜"] });
    const state = requireState(harness.application);
    state.story.current_scene_id = "rail_butcher";
    state.story.chapter_id = "chapter_1_hunger_speaks";
    state.story.completed_scene_ids.push("doctor_in_the_rain");
    requirePlayer(state).parts = 20;

    const opened = harness.adapter.execute({
      type: "story_choice",
      choiceId: "overload_rail",
    });
    const battleSnapshot = requireSnapshot(opened.snapshot);

    expect(opened.accepted).toBe(true);
    expect(battleSnapshot.battle).toMatchObject({
      bossId: "rail_butcher",
      bossName: "铁轨屠夫·陆沉",
    });
    expect(battleSnapshot.battle?.actions.map((action) => action.id)).toEqual([
      "attack",
      "guard",
      "focus",
      "medicine",
      "retreat",
    ]);
    expect(requireAction(battleSnapshot, "shelter_management").disabled).toBe(true);

    if (state.battle === null) throw new Error("测试首领战未开始。");
    state.battle.health = 1;
    const victory = harness.adapter.execute({ type: "combat_action", actionId: "attack" });
    const victorySnapshot = requireSnapshot(victory.snapshot);

    expect(victory.accepted).toBe(true);
    expect(victorySnapshot.battle).toBeNull();
    expect(state.story.boss_outcomes.rail_butcher).toBe("spared");
    expect(victorySnapshot.storyPrompt?.id).toBe("yangguans_day_forty_seven");
  });

  it("成功撤退后的已结束战斗不阻塞经营视图", () => {
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "story", playerNames: ["白菜"] });
    const state = requireState(harness.application);
    state.story.current_scene_id = "rail_butcher";
    state.story.chapter_id = "chapter_1_hunger_speaks";
    state.story.completed_scene_ids.push("doctor_in_the_rain");
    requirePlayer(state).parts = 20;
    harness.adapter.execute({ type: "story_choice", choiceId: "overload_rail" });

    const retreat = harness.adapter.execute({ type: "combat_action", actionId: "retreat" });
    const snapshot = requireSnapshot(retreat.snapshot);

    expect(retreat.accepted).toBe(true);
    expect(state.battle).toMatchObject({ finished: true, retreated: true });
    expect(snapshot.battle).toBeNull();
    expect(requireAction(snapshot, "shelter_management").disabled).toBe(false);
    expect(snapshot.managementCategories).toHaveLength(3);
  });

  it("探索事件只抽取一次，并在显式存档恢复后继续同一事件", () => {
    const random = new ScriptedRandomSource([90, 50], [0, 4]);
    const writer = buildH5Harness({ random });
    writer.adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });

    const first = writer.adapter.execute({ type: "exploration_prepare", cityId: "city_a" });
    const firstSnapshot = requireSnapshot(first.snapshot);
    const originalCity = firstSnapshot.cities.find((city) => city.id === "city_a");
    const otherCity = firstSnapshot.cities.find((city) => city.id === "city_h");
    const pending = requireState(writer.application).pending_exploration;
    if (pending === null) throw new Error("探索事件没有持久化。");
    const defaultDistrict = writer.application.content.district(
      pending.city_id,
      pending.district_id,
    );

    expect(first.accepted).toBe(true);
    expect(defaultDistrict.event_ids).toContain(pending.event_id);
    expect(firstSnapshot.explorationPrompt?.id).toBe(pending.event_id);
    const firstOption = firstSnapshot.explorationPrompt?.options.find(
      (option) => !option.disabled,
    );
    if (firstOption === undefined) throw new Error("探索事件没有可执行选项。");
    expect(originalCity).toMatchObject({ disabled: false });
    expect(originalCity?.disabledReason).toBeUndefined();
    expect(otherCity).toMatchObject({ disabled: true });
    expect(random.weightedChoiceCalls).toBe(1);

    const forgedRepeat = writer.adapter.execute({
      type: "exploration_prepare",
      cityId: "city_h",
    });
    expect(requireSnapshot(forgedRepeat.snapshot).explorationPrompt?.id).toBe(
      pending.event_id,
    );
    expect(random.weightedChoiceCalls).toBe(1);
    writer.adapter.execute({ type: "save_game" });

    const readerRandom = new ScriptedRandomSource([], [7]);
    const reader = buildH5Harness({ storage: writer.storage, random: readerRandom });
    const loaded = reader.adapter.execute({ type: "load_game" });
    expect(requireSnapshot(loaded.snapshot).explorationPrompt?.id).toBe(pending.event_id);
    expect(readerRandom.weightedChoiceCalls).toBe(0);

    const resolved = reader.adapter.execute({
      type: "exploration_resolve",
      choiceId: firstOption.id,
    });
    expect(resolved.accepted).toBe(true);
    expect(requireSnapshot(resolved.snapshot).explorationPrompt).toBeNull();
    expect(requireState(reader.application).turn_number).toBe(1);
  });
});

describe("H5 经营、物品与失败命令流", () => {
  it("经营项目使用无冲突复合 ID，锁定失败原子且解锁后执行", () => {
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    const state = requireState(harness.application);
    const facilityCategory = harness.adapter.getSnapshot().managementCategories.find(
      (category) => category.id === "upgrade",
    );
    const wall = facilityCategory?.options.find(
      (option) => option.id === "facility::outer_wall",
    );
    expect(wall).toMatchObject({ disabled: false, lockedAppearance: true });
    const before = JSON.stringify(state);

    const locked = harness.adapter.execute({
      type: "management_action",
      categoryId: "upgrade",
      optionId: "facility::outer_wall",
    });
    expect(locked.accepted).toBe(false);
    expect(JSON.stringify(state)).toBe(before);

    requirePlayer(state).parts = 100;
    requirePlayer(state).coins = 100;
    const upgraded = harness.adapter.execute({
      type: "management_action",
      categoryId: "upgrade",
      optionId: "facility::outer_wall",
    });

    expect(upgraded.accepted).toBe(true);
    expect(state.facility_levels.outer_wall).toBe(1);
    expect(state.turn_number).toBe(7);
  });

  it("无需治疗时返回警告，受伤后物品行动通过同一端口结算", () => {
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    const state = requireState(harness.application);
    const before = JSON.stringify(state);

    const unnecessary = harness.adapter.execute({
      type: "supply_action",
      actionId: "use_medicine",
    });
    expect(unnecessary.accepted).toBe(false);
    expect(unnecessary.notice?.tone).toBe("warning");
    expect(JSON.stringify(state)).toBe(before);

    const player = requirePlayer(state);
    player.health = 50;
    const supplies = player.medical_supplies;
    const healed = harness.adapter.execute({
      type: "supply_action",
      actionId: "use_medicine",
    });

    expect(healed.accepted).toBe(true);
    expect(requirePlayer(state).medical_supplies).toBe(supplies - 5);
    expect(requirePlayer(state).health).toBeGreaterThan(50);
    expect(state.turn_number).toBe(1);
  });

  it("失败结局生成危险提示、结局文档并锁定继续游玩行动", () => {
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    const state = requireState(harness.application);
    state.shelter.health = 1;
    requirePlayer(state).hunger = 10;

    const result = harness.adapter.execute({ type: "supply_action", actionId: "use_food" });
    const snapshot = requireSnapshot(result.snapshot);

    expect(result.accepted).toBe(true);
    expect(result.notice?.tone).toBe("danger");
    expect(snapshot.ended).toBe(true);
    expect(snapshot.ending).toMatchObject({ title: "长夜终局", tone: "danger" });
    expect(requireAction(snapshot, "explore").disabled).toBe(true);
    expect(snapshot.actionGroups.some((group) => group.id === "system")).toBe(false);
    expect(harness.adapter.execute({ type: "save_game" }).accepted).toBe(true);
    expect(state.battle).toBeNull();
    expect(state.pending_exploration).toBeNull();
  });
});
