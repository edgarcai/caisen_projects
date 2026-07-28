import { describe, expect, it } from "vitest";
import shelterLayoutDocument from "../../config/shelter_layout.json";
import {
  parseShelterLayoutConfig,
  type ShelterLayoutContext,
  type ShelterResidentProfile,
  type ShelterRoomAssignments,
} from "../../src/domain/shelter-layout";
import { ShelterLayoutService } from "../../src/services/ShelterLayoutService";

const config = parseShelterLayoutConfig(shelterLayoutDocument);
const service = new ShelterLayoutService(config);

/** 构建同时覆盖玩家、已入队伙伴与未入队伙伴的人员档案。 */
function residents(allCompanionsActive = false): readonly ShelterResidentProfile[] {
  return [
    profile("player:0", "所长", "male", true),
    profile("player:1", "副所长", "male", true),
    profile("companion:haocai", "豪菜", "unspecified", true),
    profile("companion:yangguan", "阳关", "unspecified", true),
    profile("companion:linlan", "林岚", "unspecified", allCompanionsActive),
    profile("companion:xiaoman", "小满", "unspecified", allCompanionsActive),
  ];
}

/** 构建由配置补全偏好的最小人员档案。 */
function profile(
  residentId: string,
  name: string,
  gender: ShelterResidentProfile["gender"],
  active: boolean,
): ShelterResidentProfile {
  return {
    residentId,
    name,
    gender,
    active,
    likes: [],
    dislikes: [],
    preferenceNote: "",
  };
}

/** 创建可按需覆盖设施等级的实时布局上下文。 */
function context(options: {
  readonly allCompanionsActive?: boolean;
  readonly facilityLevels?: Readonly<Record<string, number>>;
  readonly shelterExpansionLevel?: number;
} = {}): ShelterLayoutContext {
  return {
    residents: residents(options.allCompanionsActive ?? false),
    facilityLevels: options.facilityLevels ?? {},
    shelterExpansionLevel: options.shelterExpansionLevel ?? 0,
    resources: { parts: 120, medical_supplies: 30 },
  };
}

describe("避难所横切面配置", () => {
  it("覆盖核心工作间、生活间和性别宿舍", () => {
    const names = new Set(config.rooms.map((room) => room.name));

    expect(names).toEqual(expect.objectContaining(new Set([
      "指挥室",
      "医疗站",
      "工坊",
      "仓库",
      "食堂",
      "男宿舍",
      "女宿舍",
      "发电间",
      "净水间",
    ])));
    expect(config.rooms).toHaveLength(11);
    expect(config.rooms.find((room) => room.room_id === "male_dormitory")
      ?.allowed_genders).toEqual(["male"]);
    expect(config.rooms.find((room) => room.room_id === "female_dormitory")
      ?.allowed_genders).toEqual(["female"]);
  });

  it("在配置结构损坏时立即拒绝启动", () => {
    expect(() => parseShelterLayoutConfig({
      ...shelterLayoutDocument,
      rooms: [{ ...shelterLayoutDocument.rooms[0], floor_id: "missing" }],
    })).toThrow("未知楼层");
  });
});

describe("避难所房间规划服务", () => {
  it("为新档生成可持久化的默认分配并忽略未入队人员", () => {
    const assignments = service.createDefaultAssignments(residents());

    expect(assignments.command_center).toEqual([
      "player:0",
      "companion:haocai",
    ]);
    expect(assignments.male_dormitory).toEqual(["companion:yangguan"]);
    expect(Object.values(assignments).flat()).not.toContain("companion:linlan");
    expect(Object.keys(assignments)).toHaveLength(config.rooms.length);
  });

  it("用旧设施等级实时判定房间解锁、容量和扩建需求", () => {
    const assignments = service.createDefaultAssignments(residents());
    const lockedView = service.createView(assignments, context());
    const lockedGenerator = lockedView.rooms.find(
      (room) => room.roomId === "generator_room",
    );

    expect(lockedGenerator).toMatchObject({
      locked: true,
      level: 0,
      capacity: 0,
      statusLabel: config.copy.locked_status,
    });
    expect(lockedGenerator?.unlockRequirements.every(
      (requirement) => !requirement.met,
    )).toBe(true);

    const unlockedView = service.createView(assignments, context({
      facilityLevels: { energy_center: 2 },
      shelterExpansionLevel: 2,
    }));
    const unlockedGenerator = unlockedView.rooms.find(
      (room) => room.roomId === "generator_room",
    );
    expect(unlockedGenerator).toMatchObject({
      locked: false,
      level: 2,
      capacity: 3,
      expansionLabel: config.copy.maximum_level,
    });
  });

  it("拒绝性别错误、房间满员与尚未入队的调度", () => {
    const initial = service.createDefaultAssignments(residents(true));
    const activeContext = context({ allCompanionsActive: true });
    const wrongDorm = service.planAssignment(
      initial,
      "companion:xiaoman",
      "male_dormitory",
      activeContext,
    );
    expect(wrongDorm).toMatchObject({ applied: false });
    expect(wrongDorm.message).toContain("仅允许男性");

    const fullAssignments: ShelterRoomAssignments = {
      ...initial,
      command_center: [],
      male_dormitory: [
        "companion:yangguan",
        "companion:haocai",
        "player:1",
      ],
    };
    const fullRoom = service.planAssignment(
      fullAssignments,
      "player:0",
      "male_dormitory",
      activeContext,
    );
    expect(fullRoom).toMatchObject({ applied: false });
    expect(fullRoom.message).toBe(config.copy.room_full_reason);

    const inactiveContext = context({ allCompanionsActive: false });
    const inactive = service.planAssignment(
      initial,
      "companion:linlan",
      "female_dormitory",
      inactiveContext,
    );
    expect(inactive).toMatchObject({
      applied: false,
      message: config.copy.inactive_reason,
    });
  });

  it("对同室喜恶关系计分并生成文本化冲突建议", () => {
    const activeContext = context({ allCompanionsActive: true });
    const initial = service.createDefaultAssignments(residents(true));
    const moved = service.planAssignment(
      initial,
      "companion:haocai",
      "male_dormitory",
      activeContext,
    );

    expect(moved.applied).toBe(true);
    expect(moved.assignments.male_dormitory).toEqual([
      "companion:yangguan",
      "companion:haocai",
    ]);
    const view = service.createView(moved.assignments, activeContext);
    const dormitory = view.rooms.find((room) => room.roomId === "male_dormitory");
    expect(dormitory?.harmony).toBeLessThan(config.harmony.base_score);
    expect(dormitory?.advice.join("\n")).toContain("冲突预警");
    expect(view.advice.join("\n")).toContain("阳关");
    expect(view.advice.join("\n")).toContain("豪菜");
  });

  it("人员移动不修改传入映射，并能随后从房间移出", () => {
    const activeContext = context({ allCompanionsActive: true });
    const initial = service.createDefaultAssignments(residents(true));
    const before = structuredClone(initial);
    const assigned = service.planAssignment(
      initial,
      "companion:xiaoman",
      "female_dormitory",
      activeContext,
    );

    expect(initial).toEqual(before);
    expect(assigned.applied).toBe(true);
    expect(assigned.assignments.female_dormitory).toEqual(["companion:xiaoman"]);
    const removed = service.planAssignment(
      assigned.assignments,
      "companion:xiaoman",
      null,
      activeContext,
    );
    expect(removed).toMatchObject({ applied: true });
    expect(removed.assignments.female_dormitory).toEqual([]);
  });

  it("调度候选项显示当前房间、喜恶名称和灰态原因", () => {
    const activeContext = context({ allCompanionsActive: true });
    const initial = service.createDefaultAssignments(residents(true));
    const options = service.assignmentOptions(
      initial,
      "male_dormitory",
      activeContext,
    );
    const yangguan = options.find((option) => option.residentId === "companion:yangguan");
    const xiaoman = options.find((option) => option.residentId === "companion:xiaoman");

    expect(yangguan).toMatchObject({
      assignedToTarget: true,
      available: true,
      currentRoomName: "男宿舍",
    });
    expect(yangguan?.likesNames).toContain("林岚");
    expect(xiaoman).toMatchObject({ available: false });
    expect(xiaoman?.unavailableReason).toContain("仅允许男性");
    expect(xiaoman?.likesNames).toContain("豪菜");
  });
});
