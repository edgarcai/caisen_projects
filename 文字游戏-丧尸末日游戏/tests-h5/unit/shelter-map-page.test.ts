import { describe, expect, it } from "vitest";
import shelterLayoutDocument from "../../config/shelter_layout.json";
import {
  parseShelterLayoutConfig,
  type ShelterLayoutContext,
  type ShelterResidentProfile,
} from "../../src/domain/shelter-layout";
import { ShelterLayoutService } from "../../src/services/ShelterLayoutService";
import {
  buildShelterMapSummary,
  buildShelterRoomDetail,
  buildShelterRoomPlanningPrompt,
  resolveShelterMapGeometry,
} from "../../src/ui/pages/ShelterMapPage";

const config = parseShelterLayoutConfig(shelterLayoutDocument);
const service = new ShelterLayoutService(config);

/** 创建已全员加入的页面展示上下文。 */
function pageContext(): ShelterLayoutContext {
  return {
    residents: [
      resident("player:0", "所长", "unspecified"),
      resident("companion:haocai", "豪菜", "unspecified"),
      resident("companion:yangguan", "阳关", "unspecified"),
      resident("companion:linlan", "林岚", "unspecified"),
      resident("companion:xiaoman", "小满", "unspecified"),
    ],
    facilityLevels: {},
    shelterExpansionLevel: 0,
    resources: { parts: 10, medical_supplies: 0 },
  };
}

/** 构建一名由配置补全喜恶的活跃人员。 */
function resident(
  residentId: string,
  name: string,
  gender: ShelterResidentProfile["gender"],
): ShelterResidentProfile {
  return {
    residentId,
    name,
    gender,
    active: true,
    likes: [],
    dislikes: [],
    preferenceNote: "",
  };
}

/** 返回使用真实配置生成的横切面快照。 */
function layoutView() {
  const context = pageContext();
  const assignments = service.createDefaultAssignments(context.residents);
  return {
    context,
    assignments,
    view: service.createView(assignments, context),
  };
}

describe("避难所横切面响应式几何", () => {
  it("桌面端按楼层网格横向展开房间", () => {
    const { view } = layoutView();
    const width = 960;
    const geometry = resolveShelterMapGeometry(config, view, width, false);
    const operations = geometry.floors.find(
      (floor) => floor.floorId === "operations",
    );

    expect(operations?.rooms).toHaveLength(3);
    expect(operations?.rooms.map((room) => room.x)).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(operations?.rooms[1]?.x).toBeGreaterThan(operations?.rooms[0]?.x ?? 0);
    expect(operations?.rooms[2]?.x).toBeGreaterThan(operations?.rooms[1]?.x ?? 0);
    for (const floor of geometry.floors) {
      for (const room of floor.rooms) {
        expect(room.x).toBeGreaterThanOrEqual(0);
        expect(room.x + room.width).toBeLessThanOrEqual(width);
      }
    }
  });

  it("手机端把每层房间改为单列并增加纵向滚动内容高度", () => {
    const { view } = layoutView();
    const desktop = resolveShelterMapGeometry(config, view, 960, false);
    const mobile = resolveShelterMapGeometry(config, view, 360, true);
    const operations = mobile.floors.find(
      (floor) => floor.floorId === "operations",
    );

    expect(mobile.height).toBeGreaterThan(desktop.height);
    expect(new Set(operations?.rooms.map((room) => room.x))).toEqual(
      new Set([config.layout.floor_padding]),
    );
    expect(operations?.rooms[1]?.y).toBeGreaterThan(operations?.rooms[0]?.y ?? 0);
    expect(operations?.rooms[0]?.width).toBe(
      360 - config.layout.floor_padding * 2,
    );
  });
});

describe("避难所横切面页面文本与调度意图", () => {
  it("首页概览包含入驻数、和谐度、玩法说明和文本建议", () => {
    const { view } = layoutView();
    const summary = buildShelterMapSummary(config, view);

    expect(summary).toContain(`入驻 ${String(view.assignedCount)}/${String(view.activeCount)} 人`);
    expect(summary).toContain(`全局和谐度 ${String(view.harmony)}/100`);
    expect(summary).toContain(config.description);
    expect(summary).toContain("未安排");
  });

  it("房间详情完整展示功能、人员、解锁需求和扩建需求", () => {
    const { view } = layoutView();
    const generator = view.rooms.find((room) => room.roomId === "generator_room");
    if (generator === undefined) throw new Error("测试缺少发电间。");
    const detail = buildShelterRoomDetail(config, generator);

    expect(detail).toContain(generator.function);
    expect(detail).toContain(config.copy.unlock_requirements_title);
    expect(detail).toContain("区域扩张等级：0/2");
    expect(detail).toContain(config.copy.expansion_requirements_title);
  });

  it("人员规划页将已入驻人员设为移出，并将性别冲突项灰显", () => {
    const { context, assignments, view } = layoutView();
    const room = view.rooms.find((candidate) => candidate.roomId === "male_dormitory");
    if (room === undefined) throw new Error("测试缺少男宿舍。");
    const options = service.assignmentOptions(assignments, room.roomId, context);
    const prompt = buildShelterRoomPlanningPrompt(config, room, options);
    const yangguan = prompt.options.find(
      (option) => option.id === "companion:yangguan",
    );
    const xiaoman = prompt.options.find(
      (option) => option.id === "companion:xiaoman",
    );

    expect(prompt.body).toContain(room.function);
    expect(yangguan).toMatchObject({ disabled: false, tone: "warning" });
    expect(yangguan?.label).toContain(config.copy.remove_action);
    expect(yangguan?.description).toContain("喜欢：林岚");
    expect(xiaoman).toMatchObject({ disabled: true });
    expect(xiaoman?.disabledReason).toContain("仅允许男性");
    expect(xiaoman?.description).toContain("讨厌：阳关");
  });
});
