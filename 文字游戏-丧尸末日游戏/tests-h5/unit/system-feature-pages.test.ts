import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  resolveExpeditionEntryScreen,
  resolveExpeditionProgressScreen,
} from "../../src/ui/navigation/ExpeditionNavigation";
import { buildExpeditionStatusBody } from "../../src/ui/pages/ExpeditionPages";
import {
  buildCraftingPrompt,
  buildHistoryDocument,
  buildResearchPrompt,
  buildWarehousePrompt,
} from "../../src/ui/pages/SystemFeaturePages";
import type {
  UiExpeditionStatusView,
  UiPromptView,
} from "../../src/ui/ports/GameUiPort";

const webConfig = parseWebGameConfig(webConfigDocument);

/** 创建一个仅供路由测试使用的待决探索事件。 */
function pendingExploration(): UiPromptView {
  return {
    id: "event",
    title: "待决事件",
    body: "需要处理",
    options: [],
  };
}

/** 创建一份最小远征状态夹具。 */
function activeExpedition(): UiExpeditionStatusView {
  return {
    cityId: "city_a",
    cityName: "a市",
    travelStepCost: 1,
    remainingSteps: 3,
    maximumSteps: 5,
    eventsResolved: 1,
    companionIds: ["yangguan"],
    carriedItems: { field_ration: 1 },
    loot: { food: 8 },
    itemNames: { field_ration: "行军口粮", food: "密封食物" },
  };
}

describe("远征页面导航闭环", () => {
  it("探索入口从整备开始，并优先恢复远征或待决事件", () => {
    expect(resolveExpeditionEntryScreen({
      explorationPrompt: null,
      expeditionStatus: null,
    })).toBe("expedition_prepare");
    expect(resolveExpeditionEntryScreen({
      explorationPrompt: null,
      expeditionStatus: activeExpedition(),
    })).toBe("expedition_status");
    expect(resolveExpeditionEntryScreen({
      explorationPrompt: pendingExploration(),
      expeditionStatus: activeExpedition(),
    })).toBe("exploration_event");
  });

  it("事件后仍有远征则回状态页，强制返程则回指挥台", () => {
    expect(resolveExpeditionProgressScreen({
      explorationPrompt: null,
      expeditionStatus: activeExpedition(),
    })).toBe("expedition_status");
    expect(resolveExpeditionProgressScreen({
      explorationPrompt: null,
      expeditionStatus: null,
    })).toBe("dashboard");
  });
});

describe("仓库、研发、制作与历史的真实展示模型", () => {
  it("仓库仅允许装备可装备项，资源仍保留数量和说明", () => {
    const prompt = buildWarehousePrompt(webConfig, [
      {
        id: "parts",
        name: "零件",
        category: "resource",
        categoryLabel: "资源",
        quantity: 12,
        carryable: false,
        equippable: false,
        equipped: false,
        description: "用于建造",
      },
      {
        id: "pipe_rifle",
        name: "钢管步枪",
        category: "weapon",
        categoryLabel: "武器",
        quantity: 1,
        carryable: false,
        equippable: true,
        equipped: false,
        description: "提升攻击",
      },
      {
        id: "dawn_ledger",
        name: "晨曦计划账本",
        category: "key_item",
        categoryLabel: "关键物品",
        quantity: 1,
        carryable: false,
        equippable: false,
        equipped: false,
        description: "记录了白塔的秘密转运费用",
      },
    ]);

    expect(prompt.options[0]).toMatchObject({ disabled: true });
    expect(prompt.options[0]?.label).toContain("零件 ×12");
    expect(prompt.options[1]).toMatchObject({ disabled: false, tone: "primary" });
    expect(prompt.options[2]).toMatchObject({
      disabled: true,
      disabledReason: webConfig.texts.warehouse_not_equippable,
    });
    expect(prompt.options[2]?.description).toContain("关键物品");
  });

  it("研发和制作按实时可用性启用命令选项", () => {
    const research = buildResearchPrompt(webConfig, [
      {
        id: "radio",
        name: "无线电增幅",
        description: "扩展信号",
        completed: false,
        available: true,
        costDescription: "零件×10",
        expeditionStepBonus: 2,
      },
    ]);
    const crafting = buildCraftingPrompt(webConfig, [
      {
        id: "ration",
        name: "野战口粮",
        description: "延长远征",
        available: false,
        unlocked: true,
        costDescription: "食物×5",
        outputItemId: "field_ration",
        outputQuantity: 1,
      },
    ]);

    expect(research.options[0]).toMatchObject({ disabled: false, tone: "primary" });
    expect(research.options[0]?.description).toContain("远征步数加成：2");
    expect(crafting.options[0]).toMatchObject({ disabled: true });
  });

  it("历史页在空档案和有周档案时都使用配置化文案", () => {
    expect(buildHistoryDocument(webConfig, []).body).toBe(
      webConfig.texts.history_empty,
    );
    const documentView = buildHistoryDocument(webConfig, [
      {
        weekNumber: 1,
        startDateLabel: "2166年1月1日",
        endDateLabel: "2166年1月7日",
        summary: "避难所守住了第一周。",
        entries: [
          {
            survivalDay: 2,
            turnNumber: 9,
            dateLabel: "2166年1月2日",
            timeLabel: "8:00",
            message: "北门传来敲击声。",
          },
        ],
      },
    ]);

    expect(documentView.body).toContain("第1周");
    expect(documentView.body).toContain("北门传来敲击声");
  });
});

describe("通讯过场与远征状态文案", () => {
  it("通讯文案和过场时长都由 web_config 提供", () => {
    expect(webConfig.texts.connection_title).toBe("通讯已连接");
    expect(webConfig.motion.connection_transition_ms).toBeGreaterThan(0);
  });

  it("远征状态使用玩家可读的伙伴与物品名称", () => {
    const body = buildExpeditionStatusBody(
      webConfig,
      activeExpedition(),
      [{ id: "yangguan", name: "阳关", traitName: "尸群盲区", trust: 3, stepBonus: 4 }],
      new Map([
        ["field_ration", "野战口粮"],
        ["food", "食物"],
      ]),
    );

    expect(body).toContain("阳关");
    expect(body).toContain("野战口粮 ×1");
    expect(body).toContain("食物 ×8");
    expect(body).not.toContain("field_ration");
  });
});
