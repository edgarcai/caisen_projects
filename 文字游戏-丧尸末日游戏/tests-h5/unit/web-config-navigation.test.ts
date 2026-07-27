import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import {
  parseWebGameConfig,
  validateCoverThemeAchievementReferences,
  validateNamePresetCoverage,
} from "../../src/config/configLoader";

interface MutableNavigationEntry {
  id: string;
  placements: string[];
  modes: string[];
}

interface MutableWebConfigDocument {
  controls: { max_player_name_characters: number };
  new_game_setup: {
    name_input: {
      html_type: string;
      input_mode: string;
    };
    preset_names: string[];
    mode_options: Array<{ id: string; label: string; description: string }>;
  };
  guided_tutorial: {
    header_step_width_ratio: number;
    steps: Array<{ id: string; target_test_id: string }>;
  };
  publisher_splash: {
    background_opacity: number;
  };
  navigation: MutableNavigationEntry[];
  action_groups: Array<{ id: string; action_ids: string[] }>;
  assets: {
    cover_themes: {
      default_id: string;
      items: Array<{
        id: string;
        desktop_fit?: string;
        mobile_portrait_fit?: string;
        mobile_landscape_fit?: string;
        required_achievement_id: string | null;
        unlock_description: string;
      }>;
    };
  };
  layout: {
    cover: {
      mobile: { settings_button_anchor: string };
    };
    desktop: { header_navigation_anchor: string };
    mobile: { header_navigation_anchor: string };
  };
  storage: {
    key: string;
    settings_key: string;
    achievement_key: string;
  };
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

  it("拒绝未知的封面设置键与标题导航锚点", () => {
    const invalidCoverAnchor = cloneWebConfig();
    const invalidHeaderAnchor = cloneWebConfig();
    invalidCoverAnchor.layout.cover.mobile.settings_button_anchor = "center";
    invalidHeaderAnchor.layout.mobile.header_navigation_anchor = "center";

    expect(() => parseWebGameConfig(invalidCoverAnchor)).toThrow(
      "layout.cover.mobile.settings_button_anchor",
    );
    expect(() => parseWebGameConfig(invalidHeaderAnchor)).toThrow(
      "layout.mobile.header_navigation_anchor",
    );
  });
});

describe("新游戏姓名配置完整性", () => {
  it("解析文本键盘属性和六个不重复中文预设名", () => {
    const parsed = parseWebGameConfig(webConfigDocument);

    expect(parsed.new_game_setup.name_input).toMatchObject({
      html_type: "text",
      input_mode: "text",
      language: "zh-CN",
      enter_key_hint: "done",
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: false,
    });
    expect(parsed.new_game_setup.preset_names).toHaveLength(6);
    expect(new Set(parsed.new_game_setup.preset_names).size).toBe(6);
  });

  it("拒绝空、重复与超过姓名上限的预设名", () => {
    const empty = cloneWebConfig();
    const duplicate = cloneWebConfig();
    const overlong = cloneWebConfig();
    empty.new_game_setup.preset_names = [];
    duplicate.new_game_setup.preset_names[1] =
      duplicate.new_game_setup.preset_names[0] ?? "";
    overlong.new_game_setup.preset_names[0] = "长".repeat(
      overlong.controls.max_player_name_characters + 1,
    );

    expect(() => parseWebGameConfig(empty)).toThrow("至少需要一个");
    expect(() => parseWebGameConfig(duplicate)).toThrow("不能包含重复姓名");
    expect(() => parseWebGameConfig(overlong)).toThrow("不能超过");
  });

  it("拒绝数字键盘配置与不足以覆盖最大玩家数的预设集", () => {
    const numericKeyboard = cloneWebConfig();
    numericKeyboard.new_game_setup.name_input.html_type = "number";
    numericKeyboard.new_game_setup.name_input.input_mode = "numeric";

    expect(() => parseWebGameConfig(numericKeyboard)).toThrow("html_type");

    const parsed = parseWebGameConfig(webConfigDocument);
    expect(() => {
      validateNamePresetCoverage(parsed, {
        single: { maximum: 1 },
        multiplayer: {
          maximum: parsed.new_game_setup.preset_names.length + 1,
        },
      });
    }).toThrow("覆盖最大玩家数");
    expect(() => {
      validateNamePresetCoverage(parsed, {
        single: { maximum: 1 },
        multiplayer: { maximum: 2 },
      });
    }).not.toThrow();
  });
});

describe("开局模式与教程目标完整性", () => {
  it("解析四种真实模式，并拒绝未知或缺失模式", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    expect(parsed.new_game_setup.mode_options.map((option) => option.id)).toEqual([
      "single",
      "multiplayer",
      "story",
      "endless",
    ]);

    const unknown = cloneWebConfig();
    const missing = cloneWebConfig();
    const first = unknown.new_game_setup.mode_options[0];
    if (first === undefined) {
      throw new Error("测试配置缺少游戏模式。");
    }
    first.id = "sandbox";
    missing.new_game_setup.mode_options = missing.new_game_setup.mode_options.filter(
      (option) => option.id !== "endless",
    );

    expect(() => parseWebGameConfig(unknown)).toThrow("single / multiplayer / story / endless");
    expect(() => parseWebGameConfig(missing)).toThrow("必须覆盖");
  });

  it("教程每个聚焦 ID 都对应指挥台实际稳定节点", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    const dashboardTargetIds = new Set([
      "dashboard-active-player",
      "dashboard-resource-player-food",
      "dashboard-action-explore",
      "dashboard-action-shelter_management",
      "dashboard-action-companions",
      "dashboard-log",
      "dashboard-settings",
    ]);

    expect(parsed.guided_tutorial.steps).toHaveLength(dashboardTargetIds.size);
    parsed.guided_tutorial.steps.forEach((step) => {
      expect(dashboardTargetIds.has(step.target_test_id), step.id).toBe(true);
    });
  });

  it("教程分栏和制作方背景透明度拒绝越界视觉比例", () => {
    const invalidTutorial = cloneWebConfig();
    const invalidSplash = cloneWebConfig();
    invalidTutorial.guided_tutorial.header_step_width_ratio = 0;
    invalidSplash.publisher_splash.background_opacity = 1.01;

    expect(() => parseWebGameConfig(invalidTutorial)).toThrow(
      "必须严格位于 0 到 1 之间",
    );
    expect(() => parseWebGameConfig(invalidSplash)).toThrow(
      "必须位于 0 到 1 之间",
    );
  });
});

describe("本地存储命名空间完整性", () => {
  it("拒绝设置或成就键占用存档主键及派生槽位命名空间", () => {
    const directConflict = cloneWebConfig();
    const slotConflict = cloneWebConfig();
    const backupConflict = cloneWebConfig();
    directConflict.storage.settings_key = directConflict.storage.key;
    slotConflict.storage.achievement_key =
      `${slotConflict.storage.key}:slot:2`;
    backupConflict.storage.settings_key =
      `${backupConflict.storage.key}:backup:1`;

    for (const candidate of [directConflict, slotConflict, backupConflict]) {
      expect(() => parseWebGameConfig(candidate)).toThrow("存档命名空间冲突");
    }
  });

  it("拒绝设置与成就共用同一个独立存储键", () => {
    const candidate = cloneWebConfig();
    candidate.storage.achievement_key = candidate.storage.settings_key;

    expect(() => parseWebGameConfig(candidate)).toThrow("设置与成就存储键冲突");
  });
});

describe("成就封面配置完整性", () => {
  it("拒绝封面断点缺失 fit 或声明未知缩放策略", () => {
    const missingFit = cloneWebConfig();
    const unknownFit = cloneWebConfig();
    const missingTheme = missingFit.assets.cover_themes.items[0];
    const unknownTheme = unknownFit.assets.cover_themes.items[1];
    if (missingTheme === undefined || unknownTheme === undefined) {
      throw new Error("测试配置缺少封面主题。");
    }
    delete missingTheme.desktop_fit;
    unknownTheme.mobile_portrait_fit = "stretch";

    expect(() => parseWebGameConfig(missingFit)).toThrow("desktop_fit");
    expect(() => parseWebGameConfig(unknownFit)).toThrow(
      "mobile_portrait_fit 必须是 cover / contain 之一",
    );
  });

  it("拒绝重复主题 ID、缺失默认主题与受锁默认项", () => {
    const duplicate = cloneWebConfig();
    const missingDefault = cloneWebConfig();
    const lockedDefault = cloneWebConfig();
    const first = duplicate.assets.cover_themes.items[0];
    const second = duplicate.assets.cover_themes.items[1];
    const locked = lockedDefault.assets.cover_themes.items[0];
    if (first === undefined || second === undefined || locked === undefined) {
      throw new Error("测试配置缺少封面主题。");
    }
    second.id = first.id;
    missingDefault.assets.cover_themes.default_id = "missing-theme";
    locked.required_achievement_id = "ending_long_night_watch";
    locked.unlock_description = "完成结局后解锁";

    expect(() => parseWebGameConfig(duplicate)).toThrow("重复 ID");
    expect(() => parseWebGameConfig(missingDefault)).toThrow("default_id 不存在");
    expect(() => parseWebGameConfig(lockedDefault)).toThrow("默认主题不能要求成就");
  });

  it("拒绝引用剧情配置未声明的成就", () => {
    const parsed = parseWebGameConfig(webConfigDocument);

    expect(() => {
      validateCoverThemeAchievementReferences(
        parsed,
        ["ending_long_night_watch"],
      );
    }).not.toThrow();
    expect(() => {
      validateCoverThemeAchievementReferences(parsed, []);
    })
      .toThrow("未知成就");
  });
});
