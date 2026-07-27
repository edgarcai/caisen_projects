import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  buildCompanionArchivePrompt,
  buildCompanionDetailBody,
  buildCompanionEquipmentPrompt,
} from "../../src/ui/pages/CompanionsPage";
import {
  buildCommunicationLogDocument,
  recentCommunicationLogs,
} from "../../src/ui/pages/DashboardPage";
import {
  buildExpeditionCityListPrompt,
  buildExpeditionFailureBody,
  buildExpeditionStatusBody,
} from "../../src/ui/pages/ExpeditionPages";
import type {
  UiCityView,
  UiCompanionView,
  UiExpeditionFailureView,
  UiExpeditionStatusView,
} from "../../src/ui/ports/GameUiPort";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
} from "../helpers/H5TestHarness";

const webConfig = parseWebGameConfig(webConfigDocument);

/** 构建可切换入队状态的伙伴 UI 夹具。 */
function companionView(canManage: boolean): UiCompanionView {
  return {
    id: "linlan",
    name: "林岚",
    role: "医生与病毒学家",
    portraitKey: "companion_linlan",
    portraitAssetPath: "",
    statusLabel: canManage ? "在队" : "未加入",
    trustLabel: "信任：0",
    introduction: "来自白塔的医生。",
    biography: "来自白塔的医生。\n\n信任不足，隐藏档案尚未解锁。",
    secret: webConfig.texts.companion_secret_locked,
    secretUnlocked: false,
    canManage,
    interactionCooldownTurns: 0,
    interactionCount: 0,
    equippedWeapon: null,
    equippedArmor: null,
    weaponOptions: [
      {
        id: "pipe_rifle",
        name: "管式步枪",
        slot: "weapon",
        description: "远程武器",
        availableQuantity: 1,
        ownedQuantity: 1,
        equipped: false,
        disabled: false,
      },
      {
        id: "scrap_knife",
        name: "废铁短刀",
        slot: "weapon",
        description: "近战武器",
        availableQuantity: 0,
        ownedQuantity: 0,
        equipped: false,
        disabled: true,
        disabledReason: webConfig.texts.companion_equipment_unowned,
      },
    ],
    armorOptions: [],
    interactionOptions: [],
    tone: canManage ? "success" : "muted",
  };
}

/** 构建含默认区划后缀的城市夹具，验证列表不会泄漏该字段。 */
function cityView(): UiCityView {
  return {
    id: "city_c",
    label: "C市",
    description: "山地城市",
    disabled: false,
    districtLabel: "高新北区",
    terrainLabel: "陆地",
    relationLabel: "附近城市",
    travelStepCost: 2,
    defaultDistrictId: "city_c_a",
    districts: [],
    fields: [],
    requirements: [],
  };
}

/** 构建恰好只够最后一次行动的远征状态。 */
function finalStepExpedition(): UiExpeditionStatusView {
  return {
    cityId: "city_a",
    cityName: "A市",
    districtId: "city_a_a",
    districtName: "A区",
    travelStepCost: 1,
    remainingSteps: 2,
    maximumSteps: 10,
    eventsResolved: 2,
    companionIds: [],
    carriedItems: { food: 5 },
    loot: { parts: 3 },
    itemNames: { food: "密封食物", parts: "通用零件" },
    eventStepCost: 2,
  };
}

/** 构建同时包含携带物和战利品的强制返程结算。 */
function expeditionFailure(): UiExpeditionFailureView {
  return {
    reason: "行动步数耗尽",
    keptPercent: 20,
    healthBefore: 100,
    healthAfter: 17,
    totalBefore: 8,
    totalKept: 1,
    totalLost: 7,
    items: [
      {
        id: "carried:food",
        name: "密封食物",
        source: "carried",
        before: 5,
        kept: 1,
        lost: 4,
      },
      {
        id: "loot:parts",
        name: "通用零件",
        source: "loot",
        before: 3,
        kept: 0,
        lost: 3,
      },
    ],
  };
}

describe("角色档案与配装 UI 契约", () => {
  it("档案列表隐藏未拥有角色，详情页为空装备槽显示空位", () => {
    const locked = companionView(false);
    const active = companionView(true);
    const archive = buildCompanionArchivePrompt(webConfig, [locked, active]);

    expect(archive.options).toHaveLength(1);
    expect(archive.options[0]).toMatchObject({ id: active.id, disabled: false });
    expect(buildCompanionDetailBody(webConfig, active)).toContain("武器：空位");
    expect(buildCompanionDetailBody(webConfig, active)).toContain("防具：空位");
  });

  it("配装页展示完整栏位目录、拥有数量与未拥有灰态", () => {
    const prompt = buildCompanionEquipmentPrompt(
      webConfig,
      companionView(true),
      "weapon",
    );

    expect(prompt.options.map((option) => option.id)).toEqual([
      "__unequip__",
      "pipe_rifle",
      "scrap_knife",
    ]);
    expect(prompt.options[0]).toMatchObject({ disabled: true });
    expect(prompt.options[1]?.label).toBe("管式步枪 ×1");
    expect(prompt.options[1]?.description).toContain("远程武器");
    expect(prompt.options[2]).toMatchObject({
      label: "废铁短刀 ×0",
      disabled: true,
      disabledReason: webConfig.texts.companion_equipment_unowned,
    });
  });

  it("适配器把立绘键、仓库配装和互动真实接入领域", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["所长"] });
    const state = requireState(application);
    state.inventory.crafted_items.pipe_rifle = 1;
    const initial = adapter.getSnapshot();
    const haocai = initial.companions.find((companion) => companion.id === "haocai");
    const equipmentCatalog = application.warehouseItemCatalog();

    expect(haocai).toMatchObject({
      portraitKey: "companion_haocai",
      portraitAssetPath: "",
      canManage: true,
    });
    expect(initial.companions.map((companion) => companion.id)).toEqual([
      "haocai",
      "yangguan",
    ]);
    expect(haocai?.weaponOptions.some((item) => item.id === "pipe_rifle")).toBe(true);
    expect(haocai?.weaponOptions.map((item) => item.id)).toEqual(
      equipmentCatalog
        .filter((item) => item.category === "weapon")
        .map((item) => item.itemId),
    );
    expect(haocai?.armorOptions).toContainEqual(expect.objectContaining({
      id: "reinforced_coat",
      availableQuantity: 0,
      ownedQuantity: 0,
      disabled: true,
      disabledReason: webConfig.texts.companion_equipment_unowned,
    }));
    expect(initial.managementCategories.find(
      (category) => category.id === "activity",
    )?.options.map((option) => option.id)).toContain("activity::shared_supper");
    requirePlayer(state).food = 0;
    expect(adapter.getSnapshot().managementCategories
      .find((category) => category.id === "activity")
      ?.options.find((option) => option.id === "activity::shared_supper"))
      .toMatchObject({ disabled: false, lockedAppearance: true });

    const equipped = adapter.execute({
      type: "companion_equip",
      companionId: "haocai",
      slot: "weapon",
      itemId: "pipe_rifle",
    });
    expect(equipped.accepted).toBe(true);
    expect(equipped.snapshot?.companions.find(
      (companion) => companion.id === "haocai",
    )?.equippedWeapon?.id).toBe("pipe_rifle");

    const hopeBefore = state.shelter.hope;
    const interaction = adapter.execute({
      type: "companion_interact",
      companionId: "haocai",
      interactionId: "quiet_conversation",
    });
    expect(interaction.accepted).toBe(true);
    expect(state.shelter.hope).toBeGreaterThan(hopeBefore);
    const interactedCompanion = state.companions.find(
      (companion) => companion.companion_id === "haocai",
    );
    expect(interactedCompanion?.interaction_count).toBe(1);
    expect(interactedCompanion?.interaction_cooldown_turns).toBeGreaterThan(0);
  });

  it("档案与远征候选同时排除 locked 和 dead 角色", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["所长"] });
    const state = requireState(application);
    const yangguan = state.companions.find(
      (companion) => companion.companion_id === "yangguan",
    );
    if (yangguan === undefined) throw new Error("测试缺少阳关状态。");
    yangguan.status = "dead";

    expect(adapter.getSnapshot().companions.map((companion) => companion.id)).toEqual([
      "haocai",
    ]);
    expect(application.expeditionCompanions().map(
      (companion) => companion.companionId,
    )).toEqual(["haocai"]);
  });
});

describe("城市入口与强制返程 UI 契约", () => {
  it("城市列表只展示市名，默认区划只在详情链中出现", () => {
    const option = buildExpeditionCityListPrompt(webConfig, [cityView()]).options[0];

    expect(option?.label).toContain("C市");
    expect(option?.label).not.toContain("C市 · C区");
    expect(option?.label).not.toContain("高新北区");
  });

  it("剩余步数恰好等于事件消耗时提前显示强返警告", () => {
    const body = buildExpeditionStatusBody(
      webConfig,
      finalStepExpedition(),
      [],
      new Map([["food", "密封食物"], ["parts", "通用零件"]]),
    );

    expect(body).toContain(webConfig.texts.expedition_step_warning);
  });

  it("失败页分别标注携带物和战利品的原数、保留与损失", () => {
    const body = buildExpeditionFailureBody(webConfig, expeditionFailure());

    expect(body).toContain(webConfig.texts.expedition_failure_carried_title);
    expect(body).toContain(webConfig.texts.expedition_failure_loot_title);
    expect(body).toContain("密封食物：原有 5｜保留 1｜损失 4");
    expect(body).toContain("通用零件：原有 3｜保留 0｜损失 3");
    expect(body).toContain("生命：100 → 17");
  });
});

describe("手机通讯日志 UI 契约", () => {
  it("首屏只显示配置数量的最新记录，独立页保留全部内容", () => {
    const logs = ["第一条", "第二条", "第三条", "第四条"];
    const preview = recentCommunicationLogs(webConfig, logs);
    const documentView = buildCommunicationLogDocument(webConfig, logs);

    expect(preview).not.toContain("第一条");
    expect(preview).toContain("第四条");
    expect(documentView.body).toContain("第一条");
    expect(documentView.body).toContain("第四条");
  });
});
