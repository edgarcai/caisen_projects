import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";

interface MutableNavigationEntry {
  id: string;
  placements: string[];
  modes: string[];
}

interface MutableWebConfigDocument {
  navigation: MutableNavigationEntry[];
  action_groups: Array<{ id: string; action_ids: string[] }>;
}

/** 克隆权威配置，允许单项破坏后验证解析器快速失败。 */
function cloneWebConfig(): MutableWebConfigDocument {
  return structuredClone(webConfigDocument);
}

describe("局内导航配置完整性", () => {
  it("普通行动分组不再暴露剧情任务入口", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    const actionIds = parsed.action_groups.flatMap((group) => group.action_ids);

    expect(actionIds).not.toContain("story");
    expect(parsed.navigation.find((item) => item.id === "story")).toMatchObject({
      placements: ["mobile_bottom", "desktop_header"],
      modes: ["story"],
    });
  });

  it("拒绝重复导航 ID，防止点击策略出现歧义", () => {
    const candidate = cloneWebConfig();
    const first = candidate.navigation[0];
    const second = candidate.navigation[1];
    if (first === undefined || second === undefined) {
      throw new Error("测试配置缺少两个导航入口。");
    }
    second.id = first.id;

    expect(() => parseWebGameConfig(candidate)).toThrow("重复 ID");
  });

  it("拒绝空位置、重复模式和未知枚举值", () => {
    const emptyPlacement = cloneWebConfig();
    const duplicateMode = cloneWebConfig();
    const unknownPlacement = cloneWebConfig();
    const first = emptyPlacement.navigation[0];
    const second = duplicateMode.navigation[0];
    const third = unknownPlacement.navigation[0];
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("测试配置缺少首个导航入口。");
    }
    first.placements = [];
    second.modes = ["single", "single"];
    third.placements = ["floating_corner"];

    expect(() => parseWebGameConfig(emptyPlacement)).toThrow("至少需要一个值");
    expect(() => parseWebGameConfig(duplicateMode)).toThrow("不能包含重复值");
    expect(() => parseWebGameConfig(unknownPlacement)).toThrow("desktop_header 之一");
  });
});
