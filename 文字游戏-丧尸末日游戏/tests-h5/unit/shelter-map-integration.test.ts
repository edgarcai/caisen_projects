import { describe, expect, it } from "vitest";
import type { GameUiSnapshot } from "../../src/ui/ports/GameUiPort";
import {
  buildH5Harness,
  requireState,
} from "../helpers/H5TestHarness";

/** 返回适配器命令产生的必选快照。 */
function requireSnapshot(snapshot: GameUiSnapshot | undefined): GameUiSnapshot {
  if (snapshot === undefined) throw new Error("房间命令未返回 UI 快照。");
  return snapshot;
}

describe("避难所横切面组合根与 UI 端口", () => {
  it("新游戏按配置初始化房间，并暴露完整横切面快照", () => {
    const { adapter, application } = buildH5Harness();

    const result = adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["白菜"],
    });
    const snapshot = requireSnapshot(result.snapshot);
    const state = requireState(application);

    expect(state.shelter_room_assignments.command_center).toEqual([
      "player:0",
      "companion:haocai",
    ]);
    expect(state.shelter_room_assignments.male_dormitory).toEqual([
      "companion:yangguan",
    ]);
    expect(snapshot.shelterLayout?.floors).toHaveLength(4);
    expect(snapshot.shelterLayout?.rooms.length).toBeGreaterThanOrEqual(6);
    expect(snapshot.shelterLayoutConfig.navigation_label).toBe("避难所地图");
    expect(snapshot.shelterRoomAssignmentOptions.command_center).toHaveLength(5);
  });

  it("通过端口命令调房并原位刷新人数，不消耗世界回合", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    const beforeTurn = requireState(application).turn_number;

    const result = adapter.execute({
      type: "shelter_room_assignment_change",
      residentId: "player:0",
      targetRoomId: "warehouse",
    });
    const snapshot = requireSnapshot(result.snapshot);
    const state = requireState(application);

    expect(result.accepted).toBe(true);
    expect(state.turn_number).toBe(beforeTurn);
    expect(state.shelter_room_assignments.command_center).not.toContain("player:0");
    expect(state.shelter_room_assignments.warehouse).toContain("player:0");
    expect(
      snapshot.shelterLayout?.rooms.find((room) => room.roomId === "warehouse")
        ?.residentNames,
    ).toContain("白菜");
    expect(
      snapshot.shelterRoomAssignmentOptions.warehouse?.find(
        (option) => option.residentId === "player:0",
      )?.assignedToTarget,
    ).toBe(true);
  });

  it("拒绝调入未解锁房间，并保留可阅读的配置化需求", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["白菜"] });
    const before = structuredClone(
      requireState(application).shelter_room_assignments,
    );

    const result = adapter.execute({
      type: "shelter_room_assignment_change",
      residentId: "player:0",
      targetRoomId: "generator_room",
    });
    const snapshot = requireSnapshot(result.snapshot);
    const generator = snapshot.shelterLayout?.rooms.find(
      (room) => room.roomId === "generator_room",
    );

    expect(result.accepted).toBe(false);
    expect(requireState(application).shelter_room_assignments).toEqual(before);
    expect(generator?.locked).toBe(true);
    expect(generator?.unlockRequirements.some((requirement) => !requirement.met))
      .toBe(true);
    expect(
      snapshot.shelterRoomAssignmentOptions.generator_room?.find(
        (option) => option.residentId === "player:0",
      ),
    ).toMatchObject({ available: false });
  });
});
