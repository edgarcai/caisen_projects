import { describe, expect, it } from "vitest";
import gameConfigDocument from "../../config/game_config.json";
import webConfigDocument from "../../config/web_config.json";
import {
  parseWebGameConfig,
  validateCoverThemeAchievementReferences,
  validateDashboardNavigationReferences,
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
    entry_mode_ids: string[];
  };
  guided_tutorial: {
    header_step_width_ratio: number;
    dialog_target_gap: number;
    steps: Array<{ id: string; target_test_id: string }>;
  };
  publisher_splash: {
    background_opacity: number;
    title_font_size: number;
  };
  navigation: MutableNavigationEntry[];
  dashboard_navigation: {
    management_category_shortcuts: Array<{
      entry_id: string;
      category_id: string;
    }>;
  };
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
    schema_version: number;
  };
  texts: {
    return_menu_confirm_title: string;
    return_menu_confirm_body: string;
    companion_status_format: string;
    management_detail_title: string;
    management_detail_requirements_title: string;
    management_detail_confirm: string;
  };
}

/** 克隆权威配置，允许单项破坏后验证解析器快速失败。 */
function cloneWebConfig(): MutableWebConfigDocument {
  return structuredClone(webConfigDocument);
}

describe("局内导航配置完整性", () => {
  it("网页存档版本与领域存档版本始终一致", () => {
    expect(webConfigDocument.storage.schema_version).toBe(
      gameConfigDocument.save_schema_version,
    );
  });

  it("普通行动分组不再暴露剧情任务入口", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    const actionIds = parsed.action_groups.flatMap((group) => group.action_ids);

    expect(actionIds).not.toContain("story");
    expect(parsed.action_groups.find((group) => group.id === "core")?.label).toBe(
      "生存指令",
    );
    expect(parsed.navigation.find((item) => item.id === "story")).toMatchObject({
      placements: ["mobile_bottom", "desktop_header"],
      modes: ["story"],
    });
    expect(parsed.actions.find((action) => action.id === "shelter_map"))
      .toMatchObject({ label: "避难所地图" });
    expect(parsed.action_groups.find((group) => group.id === "core")?.action_ids)
      .toContain("shelter_map");
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

  it("严格校验设施管理快捷路由及跨配置分类引用", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    expect(parsed.dashboard_navigation.management_category_shortcuts).toEqual([
      { entry_id: "facility_management", category_id: "upgrade" },
    ]);
    expect(() => {
      validateDashboardNavigationReferences(parsed, [
        "operation",
        "activity",
        "upgrade",
      ]);
    }).not.toThrow();

    const duplicate = cloneWebConfig();
    duplicate.dashboard_navigation.management_category_shortcuts.push({
      entry_id: "facility_management",
      category_id: "activity",
    });
    const unknownEntry = cloneWebConfig();
    unknownEntry.dashboard_navigation.management_category_shortcuts[0] = {
      entry_id: "unpublished_action",
      category_id: "upgrade",
    };

    expect(() => parseWebGameConfig(duplicate)).toThrow("重复入口");
    expect(() => parseWebGameConfig(unknownEntry)).toThrow("引用未知入口");
    expect(() => {
      validateDashboardNavigationReferences(parsed, ["operation", "activity"]);
    }).toThrow("引用未知经营分类：upgrade");
  });

  it("系统确认与经营详情文案保持严格、完整且类别中性", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    expect(parsed.texts.return_menu_confirm_title).toBe("返回主菜单");
    expect(parsed.texts.return_menu_confirm_body).toContain("不会额外保存");
    expect(parsed.texts.management_detail_title).toBe("项目详情");
    expect(parsed.texts.management_detail_requirements_title).toBe("执行需求");
    expect(parsed.texts.management_detail_confirm).toBe("确认执行");

    const missingTitle = cloneWebConfig();
    Reflect.deleteProperty(missingTitle.texts, "return_menu_confirm_title");
    const emptyBody = cloneWebConfig();
    emptyBody.texts.return_menu_confirm_body = " ";

    expect(() => parseWebGameConfig(missingTitle)).toThrow(
      "texts.return_menu_confirm_title",
    );
    expect(() => parseWebGameConfig(emptyBody)).toThrow(
      "texts.return_menu_confirm_body",
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
  it("保留四种模式目录，但普通建档入口仅开放普通与无尽求生", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    expect(parsed.new_game_setup.mode_options.map((option) => option.id)).toEqual([
      "single",
      "multiplayer",
      "story",
      "endless",
    ]);
    expect(parsed.new_game_setup.entry_mode_ids).toEqual(["single", "endless"]);

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

  it("拒绝普通建档入口白名单中的未知、重复与缺失必选模式", () => {
    const unknown = cloneWebConfig();
    const duplicate = cloneWebConfig();
    const missingEndless = cloneWebConfig();
    unknown.new_game_setup.entry_mode_ids = ["single", "endless", "sandbox"];
    duplicate.new_game_setup.entry_mode_ids = ["single", "endless", "single"];
    missingEndless.new_game_setup.entry_mode_ids = ["single"];

    expect(() => parseWebGameConfig(unknown)).toThrow(
      "single / multiplayer / story / endless",
    );
    expect(() => parseWebGameConfig(duplicate)).toThrow("不能包含重复值");
    expect(() => parseWebGameConfig(missingEndless)).toThrow(
      "必须包含 single 和 endless",
    );
  });

  it("教程每个聚焦 ID 都对应指挥台实际稳定节点", () => {
    const parsed = parseWebGameConfig(webConfigDocument);
    const requiredDashboardTargetIds = new Set([
      "dashboard-active-player",
      "dashboard-resource-player-food",
      "dashboard-action-explore",
      "dashboard-action-shelter_management",
      "dashboard-action-companions",
      "dashboard-action-shelter_map",
      "dashboard-action-archive_storage",
      "dashboard-action-encounter_battle",
      "dashboard-log",
      "dashboard-settings",
    ]);
    const configuredTargetIds = new Set(
      parsed.guided_tutorial.steps.map((step) => step.target_test_id),
    );

    expect(parsed.guided_tutorial.steps.length).toBeGreaterThan(
      requiredDashboardTargetIds.size,
    );
    parsed.guided_tutorial.steps.forEach((step) => {
      expect(requiredDashboardTargetIds.has(step.target_test_id), step.id).toBe(true);
      expect(step.instruction.length, step.id).toBeGreaterThan(80);
    });
    requiredDashboardTargetIds.forEach((targetTestId) => {
      expect(configuredTargetIds.has(targetTestId), targetTestId).toBe(true);
    });
  });

  it("教程分栏和制作方背景透明度拒绝越界视觉比例", () => {
    const invalidTutorial = cloneWebConfig();
    const invalidTutorialTargetGap = cloneWebConfig();
    const invalidSplash = cloneWebConfig();
    const invalidSplashTitleSize = cloneWebConfig();
    invalidTutorial.guided_tutorial.header_step_width_ratio = 0;
    invalidTutorialTargetGap.guided_tutorial.dialog_target_gap = -1;
    invalidSplash.publisher_splash.background_opacity = 1.01;
    invalidSplashTitleSize.publisher_splash.title_font_size = 0;

    expect(() => parseWebGameConfig(invalidTutorial)).toThrow(
      "必须严格位于 0 到 1 之间",
    );
    expect(() => parseWebGameConfig(invalidTutorialTargetGap)).toThrow(
      "guided_tutorial.dialog_target_gap",
    );
    expect(() => parseWebGameConfig(invalidSplash)).toThrow(
      "必须位于 0 到 1 之间",
    );
    expect(() => parseWebGameConfig(invalidSplashTitleSize)).toThrow(
      "publisher_splash.title_font_size",
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
