import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ACTION_IDS,
  DEFAULT_DASHBOARD_NAVIGATION_POLICY,
  IN_GAME_NAVIGATION_IDS,
  createDashboardNavigationPolicy,
  resolveDashboardNavigationIntent,
  type DashboardNavigationPolicy,
} from "../../src/ui/navigation/DashboardNavigationStrategy";

describe("局内仪表盘导航策略", () => {
  it("为手机与电脑共享六个稳定主导航入口", () => {
    expect(IN_GAME_NAVIGATION_IDS).toEqual([
      "dashboard",
      "story",
      "explore",
      "management",
      "supplies",
      "settings",
    ]);
    expect(
      IN_GAME_NAVIGATION_IDS.map((entryId) =>
        resolveDashboardNavigationIntent(entryId),
      ),
    ).toEqual([
      { type: "reset_dashboard" },
      { type: "open_story" },
      { type: "open_expedition" },
      { type: "push_screen", screen: "management_categories" },
      { type: "push_screen", screen: "supplies" },
      { type: "push_screen", screen: "settings" },
    ]);
  });

  it("使指挥台别名与主导航产生相同语义", () => {
    expect(resolveDashboardNavigationIntent("shelter_management")).toEqual(
      resolveDashboardNavigationIntent("management"),
    );
    expect(resolveDashboardNavigationIntent("expedition")).toEqual(
      resolveDashboardNavigationIntent("explore"),
    );
    expect(resolveDashboardNavigationIntent("story")).toEqual({ type: "open_story" });
  });

  it("覆盖所有现有指挥台行动 ID", () => {
    expect(DASHBOARD_ACTION_IDS).toEqual([
      "story",
      "explore",
      "shelter_management",
      "shelter_map",
      "archive_storage",
      "encounter_battle",
      "companions",
      "transport_management",
      "facility_management",
      "settlement_network",
      "use_food",
      "use_medicine",
      "feed_shelter",
      "repair_shelter",
      "tutorial",
      "save",
      "return_menu",
      "warehouse",
      "research",
      "crafting",
      "expedition",
      "history",
      "communication_log",
    ]);
    expect(
      DASHBOARD_ACTION_IDS.every(
        (actionId) => resolveDashboardNavigationIntent(actionId) !== null,
      ),
    ).toBe(true);
  });

  it("正确区分页面、存档与物资行动意图", () => {
    expect(resolveDashboardNavigationIntent("companions")).toEqual({
      type: "push_screen",
      screen: "companions",
    });
    expect(resolveDashboardNavigationIntent("companion_management")).toBeNull();
    expect(resolveDashboardNavigationIntent("shelter_map")).toEqual({
      type: "push_screen",
      screen: "shelter_map",
    });
    expect(resolveDashboardNavigationIntent("transport_management")).toEqual({
      type: "push_screen",
      screen: "transport_management",
    });
    expect(resolveDashboardNavigationIntent("facility_management")).toEqual({
      type: "push_screen",
      screen: "management_categories",
    });
    expect(resolveDashboardNavigationIntent("settlement_network")).toEqual({
      type: "push_screen",
      screen: "settlement_network",
    });
    expect(resolveDashboardNavigationIntent("return_menu")).toEqual({
      type: "push_screen",
      screen: "return_menu_confirm",
    });
    expect(resolveDashboardNavigationIntent("save")).toEqual({ type: "save_game" });
    expect(resolveDashboardNavigationIntent("use_food")).toEqual({
      type: "perform_supply_action",
      actionId: "use_food",
    });
    expect(resolveDashboardNavigationIntent("repair_shelter")).toEqual({
      type: "perform_supply_action",
      actionId: "repair_shelter",
    });
  });

  it("按注入配置打开设施管理分类，不在默认策略硬编码", () => {
    const policy = createDashboardNavigationPolicy([
      { entry_id: "facility_management", category_id: "upgrade" },
    ]);

    expect(resolveDashboardNavigationIntent("facility_management", policy)).toEqual({
      type: "open_management_category",
      categoryId: "upgrade",
    });
    expect(
      resolveDashboardNavigationIntent(
        "facility_management",
        DEFAULT_DASHBOARD_NAVIGATION_POLICY,
      ),
    ).toEqual({ type: "push_screen", screen: "management_categories" });
  });

  it("对未配置 ID 安全停留，不误当作物资命令", () => {
    expect(resolveDashboardNavigationIntent("unknown_action")).toBeNull();
    expect(resolveDashboardNavigationIntent("")).toBeNull();
  });

  it("支持注入独立策略且不污染默认配置", () => {
    const customPolicy: DashboardNavigationPolicy = {
      entries: {
        emergency_settings: { type: "push_screen", screen: "settings" },
      },
    };

    expect(
      resolveDashboardNavigationIntent("emergency_settings", customPolicy),
    ).toEqual({ type: "push_screen", screen: "settings" });
    expect(resolveDashboardNavigationIntent("dashboard", customPolicy)).toBeNull();
    expect(
      resolveDashboardNavigationIntent(
        "emergency_settings",
        DEFAULT_DASHBOARD_NAVIGATION_POLICY,
      ),
    ).toBeNull();
  });
});
