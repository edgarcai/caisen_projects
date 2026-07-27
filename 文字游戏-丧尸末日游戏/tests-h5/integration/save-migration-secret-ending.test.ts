import { describe, expect, it } from "vitest";
import type { GameUiSnapshot } from "../../src/ui/ports/GameUiPort";
import {
  buildH5Harness,
  H5_TEST_STORAGE_KEY,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";
import { MemoryStorage } from "../../src/infrastructure";

/** 从同步命令结果中读取快照。 */
function requireSnapshot(snapshot: GameUiSnapshot | undefined): GameUiSnapshot {
  if (snapshot === undefined) throw new Error("适配器命令没有返回快照。");
  return snapshot;
}

/** 从当前玩家状态移除 v6 新字段，构造真实的 v1 迁移输入。 */
function createV1Players(
  players: readonly unknown[],
): readonly Record<string, unknown>[] {
  return players.map((player) => {
    const legacy = structuredClone(player) as Record<string, unknown>;
    Reflect.deleteProperty(legacy, "age");
    Reflect.deleteProperty(legacy, "lifespan");
    return legacy;
  });
}

/** 从当前避难所状态移除 v6 希望值，避免用未来字段污染 v1 夹具。 */
function createV1Shelter(shelter: unknown): Record<string, unknown> {
  const legacy = structuredClone(shelter) as Record<string, unknown>;
  Reflect.deleteProperty(legacy, "hope");
  return legacy;
}

/** 将测试状态放到满足秘密结局入口和群巢记忆支线的最终场景。 */
function prepareLinkedHiveSecretEnding(): ReturnType<typeof buildH5Harness> {
  const harness = buildH5Harness();
  harness.adapter.execute({ type: "start_game", mode: "story", playerNames: ["白菜"] });
  const state = requireState(harness.application);
  state.story.current_scene_id = "the_last_broadcast";
  state.story.chapter_id = "chapter_4_after_embers";
  state.story.completed_scene_ids = harness.application.content.story.scenes
    .map((scene) => scene.scene_id)
    .filter((sceneId) => sceneId !== "the_last_broadcast");
  state.story.evidence = 6;
  state.story.humanity = 6;
  state.story.infection_pressure = 4;
  state.story.flags = [];
  state.story.key_items = ["maintenance_key", "hive_memory"];
  state.story.boss_outcomes = {
    rail_butcher: "awakened",
    chorus_matriarch: "linked",
    uncrowned_king: "guardian_preserved",
  };
  requirePlayer(state).antidotes = 1;
  for (const companionId of ["yangguan", "haocai", "linlan"]) {
    const companion = state.companions.find(
      (candidate) => candidate.companion_id === companionId,
    );
    if (companion === undefined) {
      throw new Error(`测试缺少伙伴 ${companionId}。`);
    }
    companion.trust = 2;
  }
  return harness;
}

describe("H5 v1 存档迁移", () => {
  it("通过适配器读取 v1 双人存档并经显式保存安全写回 v8", () => {
    const source = buildH5Harness();
    source.application.startNewGame(["旧所长甲", "旧所长乙"], "multiplayer");
    const sourceState = requireState(source.application);
    const legacyState = {
      mode: sourceState.mode,
      players: createV1Players(sourceState.players),
      active_player_index: 1,
      shelter: createV1Shelter(sourceState.shelter),
      clock: structuredClone(sourceState.clock),
      turn_number: 9,
      ended: false,
      ending_message: "",
    };
    const storage = new MemoryStorage({
      [H5_TEST_STORAGE_KEY]: JSON.stringify({
        schema_version: 1,
        saved_at: "2023-08-20T12:34:56.000Z",
        game_state: legacyState,
      }),
    });
    const reader = buildH5Harness({ storage });

    const loaded = reader.adapter.execute({ type: "load_game" });
    const snapshot = requireSnapshot(loaded.snapshot);

    expect(loaded.accepted).toBe(true);
    expect(snapshot.mode).toBe("multiplayer");
    expect(snapshot.activePlayer?.name).toBe("旧所长乙");
    expect(snapshot.clock?.turnLabel).toBe("第 9 回合");
    expect(requireState(reader.application).story.flags).toContain("legacy_save");
    expect(snapshot.storyAccess).toBe("hidden");
    expect(snapshot.storyPrompt).toBeNull();

    const legacySerialized = storage.getItem(H5_TEST_STORAGE_KEY);
    if (legacySerialized === null) throw new Error("迁移前主槽不存在。");
    expect((JSON.parse(legacySerialized) as { schema_version: number }).schema_version).toBe(1);
    reader.adapter.execute({ type: "save_game" });

    const serialized = storage.getItem(H5_TEST_STORAGE_KEY);
    if (serialized === null) throw new Error("迁移存档没有写回主槽。");
    const envelope = JSON.parse(serialized) as {
      schema_version: number;
      game_state: Record<string, unknown>;
    };
    expect(envelope.schema_version).toBe(8);
    expect(envelope.game_state).toHaveProperty("story");
    expect(envelope.game_state).toHaveProperty("campaign");
    expect(envelope.game_state).not.toHaveProperty("ended");
    expect(envelope.game_state).not.toHaveProperty("ending_message");
  });
});

describe("H5 秘密结局", () => {
  it("群巢记忆与 linked 首领结果可替代互斥频率进入再燃黎明", () => {
    const harness = prepareLinkedHiveSecretEnding();
    const state = requireState(harness.application);
    expect(state.story.key_items).not.toContain("counter_frequency");
    const prompt = harness.adapter.getSnapshot().storyPrompt;
    const reversal = prompt?.options.find((option) => option.id === "broadcast_reversal");
    expect(reversal).toMatchObject({ disabled: false });

    const result = harness.adapter.execute({
      type: "story_choice",
      choiceId: "broadcast_reversal",
    });
    const snapshot = requireSnapshot(result.snapshot);

    expect(result.accepted).toBe(true);
    expect(result.notice?.tone).toBe("success");
    expect(snapshot.ended).toBe(true);
    expect(snapshot.ending).toMatchObject({ title: "再燃黎明", tone: "success" });
    expect(state.ending?.ending_id).toBe("rekindled_dawn");
    expect(state.story.flags).toEqual(expect.arrayContaining(["final_reversal", "city_awakening"]));
    expect(state.story.infection_pressure).toBe(0);
    expect(requirePlayer(state).antidotes).toBe(0);
  });

  it("公开十三幕路线经三场首领战可从新游戏抵达秘密结局", () => {
    const route = [
      ["last_pot_of_porridge", "share_rations"],
      ["money_and_secrets", "decrypt_ledger"],
      ["doctor_in_the_rain", "medical_rescue"],
      ["rail_butcher", "call_his_name"],
      ["yangguans_day_forty_seven", "study_yangguan"],
      ["patient_zero_archive", "restore_power_grid"],
      ["the_city_starts_singing", "follow_hive_song"],
      ["chorus_matriarch", "retune_frequency"],
      ["three_dishes_and_soup", "investigate_banquet"],
      ["haocais_old_key", "forgive_haocai"],
      ["seventeen_minutes", "defend_shelter"],
      ["the_uncrowned_king", "break_the_crown"],
      ["the_last_broadcast", "broadcast_reversal"],
    ] as const;
    const harness = buildH5Harness();
    harness.adapter.execute({ type: "start_game", mode: "story", playerNames: ["路线所长"] });
    const state = requireState(harness.application);
    requirePlayer(state).attack = 1_000;
    let victories = 0;

    for (const [sceneId, choiceId] of route) {
      const prompt = harness.adapter.getSnapshot().storyPrompt;
      expect(prompt?.id).toBe(sceneId);
      const choice = prompt?.options.find((option) => option.id === choiceId);
      expect(choice?.disabled, `${sceneId}/${choiceId} 不应锁定`).toBe(false);

      const storyResult = harness.adapter.execute({ type: "story_choice", choiceId });
      expect(storyResult.accepted, `${sceneId}/${choiceId} 应成功`).toBe(true);
      if (state.battle !== null) {
        state.battle.health = 1;
        const combatResult = harness.adapter.execute({
          type: "combat_action",
          actionId: "attack",
        });
        expect(combatResult.accepted, `${sceneId} 首领战应胜利`).toBe(true);
        victories += 1;
      }
    }

    expect(victories).toBe(3);
    expect(state.ending?.ending_id).toBe("rekindled_dawn");
    expect(harness.adapter.getSnapshot().ending?.title).toBe("再燃黎明");
  });
});
