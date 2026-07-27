import { describe, expect, it, vi } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import { resolveResponsiveLayoutFromMetrics } from "../../src/styles/ResponsiveLayout";
import { UiFactory } from "../../src/ui/components/UiFactory";
import type { LayaRuntimeLike } from "../../src/ui/laya/LayaRuntime";
import type {
  UiArchiveCollectionPageView,
  UiArchiveDocumentPageView,
  UiArchiveStoragePageView,
  UiEncounterBattlePageView,
  UiEncounterCatalogPageView,
  UiEncounterPreparationPageView,
  UiReturnIncidentPageView,
} from "../../src/ui/models/DemoSystemViewModels";
import {
  createArchiveCollectionPage,
  createArchiveDocumentPage,
  createArchiveStoragePage,
  createEncounterBattlePage,
  createEncounterCatalogPage,
  createEncounterPreparationPage,
  createReturnIncidentPage,
  resolveDemoButtonHeight,
} from "../../src/ui/pages/DemoSystemsPages";

/** 提供 UiFactory 所需的最小绘图契约。 */
class FakeGraphics {
  /** 清空测试绘图指令。 */
  public clear(): void {}

  /** 接收矩形绘制指令。 */
  public drawRect(): void {}

  /** 接收多边形绘制指令。 */
  public drawPoly(): void {}

  /** 接收线段绘制指令。 */
  public drawLine(): void {}
}

/** 支持显示树、事件和销毁的最小 Laya 节点。 */
class FakeNode {
  public name = "";
  public x = 0;
  public y = 0;
  public width = 0;
  public height = 0;
  public alpha = 1;
  public visible = true;
  public mouseEnabled = true;
  public zOrder = 0;
  public parent: FakeNode | null = null;
  public scrollRect: FakeRectangle | undefined;
  public readonly children: FakeNode[] = [];
  private readonly listeners = new Map<
    string,
    Array<{
      readonly caller: unknown;
      readonly listener: (...argumentsList: unknown[]) => void;
    }>
  >();

  /** 将子节点加入显示树并同步父链。 */
  public addChild<T extends FakeNode>(child: T): T {
    child.removeSelf();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /** 按名称查找直接子节点。 */
  public getChildByName(name: string): FakeNode | null {
    return this.children.find((child) => child.name === name) ?? null;
  }

  /** 删除指定范围的子节点。 */
  public removeChildren(beginIndex = 0, endIndex = this.children.length - 1): this {
    const removed = this.children.splice(
      beginIndex,
      Math.max(0, endIndex - beginIndex + 1),
    );
    removed.forEach((child) => {
      child.parent = null;
    });
    return this;
  }

  /** 从父节点移除当前节点。 */
  public removeSelf(): this {
    const index = this.parent?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parent?.children.splice(index, 1);
    }
    this.parent = null;
    return this;
  }

  /** 释放节点及可选的全部后代。 */
  public destroy(destroyChild = false): void {
    if (destroyChild) {
      [...this.children].forEach((child) => {
        child.destroy(true);
      });
    }
    this.removeChildren();
    this.offAll();
    this.removeSelf();
  }

  /** 设置节点位置。 */
  public pos(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /** 设置节点尺寸。 */
  public size(width: number, height: number): this {
    this.width = width;
    this.height = height;
    return this;
  }

  /** 注册一个测试事件监听器。 */
  public on(
    event: string,
    caller: unknown,
    listener: (...argumentsList: unknown[]) => void,
  ): this {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ caller, listener });
    this.listeners.set(event, entries);
    return this;
  }

  /** 精确移除一个测试事件监听器。 */
  public off(
    event: string,
    caller: unknown,
    listener: (...argumentsList: unknown[]) => void,
  ): this {
    const entries = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      entries.filter((entry) =>
        entry.caller !== caller || entry.listener !== listener
      ),
    );
    return this;
  }

  /** 移除当前节点的全部事件监听器。 */
  public offAll(): this {
    this.listeners.clear();
    return this;
  }

  /** 触发指定事件并透传参数。 */
  public emit(event: string, ...argumentsList: unknown[]): void {
    [...(this.listeners.get(event) ?? [])].forEach((entry) => {
      entry.listener(...argumentsList);
    });
  }
}

/** 带有最小绘图能力的精灵节点。 */
class FakeSprite extends FakeNode {
  public readonly graphics = new FakeGraphics();
}

/** 根据显式换行数返回稳定高度的文本节点。 */
class FakeText extends FakeSprite {
  public text = "";
  public color = "";
  public font = "";
  public fontSize = 0;
  public bold = false;
  public align = "";
  public valign = "";
  public wordWrap = true;
  public leading = 0;
  public overflow = "";

  /** 按显式换行估算测试文本高度。 */
  public get textHeight(): number {
    return Math.max(1, this.text.split(/\r?\n/u).length) *
      Math.max(1, this.fontSize + this.leading);
  }
}

/** 补齐 UiFactory 输入框契约的节点。 */
class FakeInput extends FakeText {
  public prompt = "";
  public promptColor = "";
  public bgColor = "";
  public borderColor = "";
  public type = "";
  public maxChars = 0;
  public multiline = false;
  public padding: readonly number[] = [];
  public focus = false;
}

/** 记录图片皮肤路径的节点。 */
class FakeImage extends FakeSprite {
  public readonly source = null;

  /** 保存可选初始皮肤。 */
  public constructor(public skin = "") {
    super();
  }
}

/** 保存滚动裁剪区几何的矩形。 */
class FakeRectangle {
  /** 保存裁剪区坐标与尺寸。 */
  public constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
}

/** 提供拖动所需指针坐标的测试舞台。 */
class FakeStage extends FakeSprite {
  public mouseX = 0;
  public mouseY = 0;
  public bgColor = "";
}

const webConfig = parseWebGameConfig(webConfigDocument);
const zeroSafeArea = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** 创建页面、工厂和滚动区共用的确定性运行时。 */
function createRuntime(): {
  readonly runtime: LayaRuntimeLike;
  readonly stage: FakeStage;
} {
  const stage = new FakeStage();
  const runtime = {
    Sprite: FakeSprite,
    Text: FakeText,
    Input: FakeInput,
    Image: FakeImage,
    Rectangle: FakeRectangle,
    Event: {
      CLICK: "click",
      MOUSE_DOWN: "mousedown",
      MOUSE_UP: "mouseup",
      MOUSE_MOVE: "mousemove",
      MOUSE_OUT: "mouseout",
      MOUSE_OVER: "mouseover",
      MOUSE_WHEEL: "mousewheel",
      RESIZE: "resize",
      KEY_DOWN: "keydown",
      LOADED: "loaded",
    },
    stage,
  } as unknown as LayaRuntimeLike;
  return { runtime, stage };
}

/** 使用真实主题 token 创建 UI 工厂。 */
function createFactory(runtime: LayaRuntimeLike): UiFactory {
  return new UiFactory(
    runtime,
    webConfig.theme,
    webConfig.typography,
    webConfig.controls,
  );
}

/** 使用真实配置创建手机或桌面布局。 */
function createLayout(isMobileDevice: boolean) {
  return resolveResponsiveLayoutFromMetrics(
    {
      stageWidth: isMobileDevice
        ? webConfig.engine.mobile_design_width
        : webConfig.engine.design_width,
      stageHeight: isMobileDevice
        ? webConfig.engine.mobile_design_height
        : webConfig.engine.design_height,
      isMobileDevice,
      safeArea: zeroSafeArea,
    },
    webConfig,
  );
}

/** 在显示树中递归查找稳定测试名称。 */
function requireNode(root: FakeNode, name: string): FakeNode {
  if (root.name === name) {
    return root;
  }
  for (const child of root.children) {
    const found = findNode(child, name);
    if (found !== null) {
      return found;
    }
  }
  throw new Error(`未找到测试节点：${name}`);
}

/** 在显示树中递归尝试查找节点。 */
function findNode(root: FakeNode, name: string): FakeNode | null {
  if (root.name === name) {
    return root;
  }
  for (const child of root.children) {
    const found = findNode(child, name);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** 构建覆盖已解锁与待解锁文献的存储页快照。 */
function archiveStorageView(): UiArchiveStoragePageView {
  return {
    title: "存储档案",
    body: "每收集一份报纸或书籍，都可能解锁新的正文。",
    emptyText: "暂无文献分类。",
    backLabel: "返回上一级",
    collections: [
      {
        collectionId: "newspapers",
        label: "报纸",
        description: "灾变前后的城市报道。",
        collectedCopiesText: "已收集 2 份",
        unlockedDocumentsText: "已解锁 2/6",
        actionLabel: "查看报纸目录",
        tone: "primary",
      },
    ],
  };
}

/** 构建包含可点击锁定项的文献分类快照。 */
function archiveCollectionView(): UiArchiveCollectionPageView {
  return {
    collectionId: "newspapers",
    title: "报纸库",
    body: "按收集份数逐篇解锁。",
    collectedCopiesText: "当前持有：2 份",
    emptyText: "目录为空。",
    backLabel: "返回上一级",
    documents: [
      {
        documentId: "paper-1",
        title: "最后一期晚报",
        summary: "封城命令发布前的头版。",
        requirementText: "已解锁",
        actionLabel: "阅读正文",
        unlocked: true,
        tone: "primary",
      },
      {
        documentId: "paper-3",
        title: "未解锁文献 #3",
        summary: "再收集文献即可阅读。",
        requirementText: "需要 3 份报纸",
        actionLabel: "查看解锁需求",
        unlocked: false,
        tone: "default",
      },
    ],
  };
}

/** 构建包含足够行数的长文档案，用于滚动验证。 */
function archiveDocumentView(): UiArchiveDocumentPageView {
  return {
    documentId: "paper-1",
    title: "最后一期晚报",
    metadataLines: ["来源：A 市晚报", "收集门槛：1 份"],
    body: Array.from({ length: 80 }, (_value, index) =>
      `档案正文第 ${String(index + 1)} 行。`).join("\n"),
    backLabel: "返回目录",
  };
}

/** 构建三场可选遭遇的目录快照。 */
function encounterCatalogView(): UiEncounterCatalogPageView {
  return {
    title: "遭遇战",
    body: "选择一处已确认威胁，组织小队开战。",
    emptyText: "暂无可用遭遇。",
    backLabel: "返回上一级",
    encounters: ["parking_horde", "metro_ambush", "warehouse_nest"].map(
      (encounterId, index) => ({
        encounterId,
        name: `遭遇 ${String(index + 1)}`,
        description: "配置化的尸群威胁。",
        enemyRosterText: "敌人：前排 1，后排 1",
        threatText: "威胁：中等",
        actionLabel: "组织小队开战",
        available: true,
        unavailableReason: "",
        tone: "primary" as const,
      }),
    ),
  };
}

/** 构建一名单位已分配职责且可接受治疗的战前整备快照。 */
function encounterPreparationView(): UiEncounterPreparationPageView {
  return {
    title: "停车楼围猎 · 战前整备",
    body: "分配职责并确认医疗补给。",
    supplyText: "医疗用品：9 份｜计划消耗：0 份",
    rosterTitle: "单位职责与生命补给",
    requirementText: "职责与医疗方案已完整，可以开始战斗。",
    members: [
      {
        memberId: "player:0",
        name: "所长",
        healthText: "生命 61/100",
        attributeText: "攻击 30｜防御 15｜敏捷 9",
        assignedRoleText: "当前职责：攻击",
        assignedRoleDetailText: "集中火力。\n前排｜攻击 ×140%",
        roles: [
          {
            roleId: "containment",
            label: "牵制",
            description: "吸引威胁。",
            selected: false,
            tone: "default",
          },
          {
            roleId: "assault",
            label: "攻击",
            description: "集中火力。",
            selected: true,
            tone: "primary",
          },
        ],
        treatmentLabel: "安排战前治疗",
        treatmentStatusText: "可恢复 30 点生命。",
        treatmentAvailable: true,
        treatmentSelected: false,
        treatmentTone: "default",
      },
    ],
    backLabel: "返回上一级",
    startLabel: "开始战斗",
    canStart: true,
  };
}

/** 构建覆盖前后排、五类行动与目标选择的战斗快照。 */
function encounterBattleView(): UiEncounterBattlePageView {
  return {
    title: "停车楼围猎",
    encounterDescription: "汽车警报在混凝土楼层间反复回响。",
    roundText: "第 2 回合",
    outcome: "ongoing",
    outcomeText: "战斗进行中",
    instruction: "依次选择待行动队员、指令和目标。",
    partyTitle: "我方阵线",
    enemyTitle: "敌方阵线",
    rowLabels: { front: "前排", back: "后排" },
    emptyPartyText: "没有可战斗队员。",
    emptyEnemyText: "敌方已经肦清。",
    party: [
      {
        combatantId: "player:0",
        name: "所长",
        row: "front",
        healthText: "生命 82/100",
        statusText: "待行动",
        selectable: true,
        selected: true,
        tone: "success",
      },
      {
        combatantId: "companion:haocai",
        name: "豪菜",
        row: "back",
        healthText: "生命 54/70",
        statusText: "待行动",
        selectable: true,
        selected: false,
        tone: "success",
      },
    ],
    enemies: [
      {
        combatantId: "parking_brute",
        name: "撞门者",
        row: "front",
        healthText: "生命 68/96",
        statusText: "可攻击",
        selectable: true,
        selected: false,
        tone: "danger",
      },
      {
        combatantId: "parking_howler",
        name: "回声嚎叫者",
        row: "back",
        healthText: "生命 47/47",
        statusText: "前排保护",
        selectable: false,
        selected: false,
        tone: "danger",
      },
    ],
    enemyIntentTitle: "敌人意图",
    emptyIntentText: "未侦测到意图。",
    enemyIntents: [
      {
        enemyId: "parking_brute",
        enemyName: "撞门者",
        label: "砸击",
        description: "将重击前排单个目标。",
      },
    ],
    pendingTitle: "待行动队员",
    pendingText: "所长、豪菜",
    actionTitle: "手动指令",
    emptyActionText: "当前无可用指令。",
    selectedActionDetailText: "破阵重击：优先击穿敌方前排。",
    actions: [
      battleAction("attack", "attack", "攻击", "普通攻击"),
      battleAction("guard", "guard", "防御", "压低重心"),
      battleAction("skill:crushing_blow", "skill", "技能", "破阵重击"),
      battleAction("item:trauma_kit", "item", "道具", "创伤急救包"),
      battleAction("retreat", "retreat", "撤退", "寻找缺口"),
    ],
    targetTitle: "选择目标",
    emptyTargetText: "该指令不需要指定目标。",
    targets: [
      {
        targetId: "parking_brute",
        label: "撞门者",
        description: "前排 · 生命 68/96",
        available: true,
        selected: true,
        tone: "danger",
      },
    ],
    logTitle: "战场通讯",
    emptyLogText: "暂无战斗记录。",
    logEntries: ["第 1 回合：撞门者受到 18 点伤害。"],
    backLabel: "返回指挥台",
    executeLabel: "执行指令",
    canExecute: true,
  };
}

/** 构建一项可用的战斗行动。 */
function battleAction(
  actionId: string,
  kind: "attack" | "guard" | "skill" | "item" | "retreat",
  categoryLabel: string,
  label: string,
) {
  return {
    actionId,
    kind,
    categoryLabel,
    label,
    description: label,
    availabilityText: "可执行",
    available: true,
    selected: actionId === "skill:crushing_blow",
    tone: "default" as const,
    targetIds: actionId === "guard" || actionId === "retreat"
      ? []
      : ["parking_brute"],
  };
}

/** 构建一个有可用与不可用选择的归来事项。 */
function returnIncidentView(): UiReturnIncidentPageView {
  return {
    incidentId: "burst_pipe",
    title: "生活区管线爆裂",
    body: "积水正向仓库渗去，维修组要求立即决定。",
    choiceTitle: "所长决策",
    emptyChoiceText: "暂无可用选择。",
    deferLabel: "必须立即处理",
    canDefer: false,
    choices: [
      {
        choiceId: "repair",
        label: "彻夜抢修",
        description: "投入零件彻底更换腐蚀管段。",
        requirementText: "需要 5 个零件",
        resultPreviewText: "可能增加避难所耐久。",
        available: true,
        tone: "primary",
      },
      {
        choiceId: "sealed",
        label: "封闭仓库",
        description: "需要更高的仓库等级。",
        requirementText: "仓库等级不足",
        resultPreviewText: "暂无法执行。",
        available: false,
        tone: "default",
      },
    ],
  };
}

describe("Demo 系统页面的配置化布局", () => {
  it("多行按钮高度完全由通用按钮和排版 token 推导", () => {
    const height = resolveDemoButtonHeight(webConfig, ["A\nB\nC", "D\nE"]);

    expect(height).toBe(
      webConfig.controls.button_height +
        webConfig.typography.body_line_height * 2,
    );
  });

  it("文献总览可进入分类，锁定文献保持灰态但可点查看需求", () => {
    const { runtime } = createRuntime();
    const openCollection = vi.fn();
    const storagePage = createArchiveStoragePage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(false),
      archiveStorageView(),
      { back: vi.fn(), openCollection },
    );
    requireNode(
      storagePage.root as unknown as FakeNode,
      "page-archive-storage-collection-newspapers-open",
    ).emit("click");

    expect(openCollection).toHaveBeenCalledWith("newspapers");

    const openDocument = vi.fn();
    const collectionPage = createArchiveCollectionPage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(false),
      archiveCollectionView(),
      { back: vi.fn(), openDocument },
    );
    const locked = requireNode(
      collectionPage.root as unknown as FakeNode,
      "page-archive-collection-document-paper-3-open",
    );
    expect(locked.mouseEnabled).toBe(true);
    locked.emit("click");

    expect(openDocument).toHaveBeenCalledWith("paper-3", false);
  });

  it("手机长文页同时支持滚轮和拖动阅读", () => {
    const { runtime, stage } = createRuntime();
    const page = createArchiveDocumentPage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(true),
      archiveDocumentView(),
      vi.fn(),
    );
    const viewport = page.scroll.viewport as unknown as FakeNode;
    const content = page.scroll.content as unknown as FakeNode;

    expect(content.height).toBeGreaterThan(viewport.height);
    viewport.emit("mousewheel", { delta: -1 });
    expect(content.y).toBeLessThan(0);
    const wheelY = content.y;

    stage.mouseY = 300;
    viewport.emit("mousedown");
    stage.mouseY = 100;
    stage.emit("mousemove");
    expect(content.y).toBeLessThan(wheelY);
  });
});

describe("Demo 系统页面的手动交互", () => {
  it("无进行中战斗时展示三场遭遇并可选择开战", () => {
    const { runtime } = createRuntime();
    const prepareEncounter = vi.fn();
    const page = createEncounterCatalogPage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(false),
      encounterCatalogView(),
      { back: vi.fn(), prepareEncounter },
    );

    expect(encounterCatalogView().encounters).toHaveLength(3);
    requireNode(
      page.root as unknown as FakeNode,
      "page-encounter-catalog-metro_ambush-start",
    ).emit("click");
    expect(prepareEncounter).toHaveBeenCalledWith("metro_ambush");
  });

  it("战前整备可逐单位选择职责、安排治疗并显式开始战斗", () => {
    const { runtime } = createRuntime();
    const selectRole = vi.fn();
    const toggleTreatment = vi.fn();
    const startBattle = vi.fn();
    const page = createEncounterPreparationPage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(false),
      encounterPreparationView(),
      {
        back: vi.fn(),
        selectRole,
        toggleTreatment,
        startBattle,
      },
    );

    requireNode(
      page.root as unknown as FakeNode,
      "page-encounter-preparation-member-player:0-role-containment",
    ).emit("click");
    requireNode(
      page.root as unknown as FakeNode,
      "page-encounter-preparation-member-player:0-treatment",
    ).emit("click");
    requireNode(
      page.root as unknown as FakeNode,
      "page-encounter-preparation-start",
    ).emit("click");

    expect(selectRole).toHaveBeenCalledWith("player:0", "containment");
    expect(toggleTreatment).toHaveBeenCalledWith("player:0");
    expect(startBattle).toHaveBeenCalledTimes(1);
  });

  it("遭遇战展示前后排、意图和五类行动，选择链路可手动提交", () => {
    const { runtime } = createRuntime();
    const selectPartyMember = vi.fn();
    const selectEnemy = vi.fn();
    const selectAction = vi.fn();
    const selectTarget = vi.fn();
    const execute = vi.fn();
    const page = createEncounterBattlePage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(false),
      encounterBattleView(),
      {
        back: vi.fn(),
        selectPartyMember,
        selectEnemy,
        selectAction,
        selectTarget,
        execute,
      },
    );
    const root = page.root as unknown as FakeNode;

    expect(requireNode(root, "page-encounter-battle-party-front-label")).toBeTruthy();
    expect(requireNode(root, "page-encounter-battle-enemy-back-label")).toBeTruthy();
    expect(requireNode(root, "page-encounter-battle-intent-parking_brute")).toBeTruthy();
    ["attack", "guard", "skill:crushing_blow", "item:trauma_kit", "retreat"]
      .forEach((actionId) => {
        expect(requireNode(root, `page-encounter-battle-action-${actionId}`)).toBeTruthy();
      });

    requireNode(root, "page-encounter-battle-party-front-player:0").emit("click");
    requireNode(
      root,
      "page-encounter-battle-action-skill:crushing_blow",
    ).emit("click");
    requireNode(
      root,
      "page-encounter-battle-target-parking_brute",
    ).emit("click");
    requireNode(root, "page-encounter-battle-execute").emit("click");

    expect(selectPartyMember).toHaveBeenCalledWith("player:0");
    expect(selectAction).toHaveBeenCalledWith("skill:crushing_blow");
    expect(selectTarget).toHaveBeenCalledWith("parking_brute");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("归来事项不可暂缓，只有满足条件的决策会提交", () => {
    const { runtime } = createRuntime();
    const defer = vi.fn();
    const choose = vi.fn();
    const page = createReturnIncidentPage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(true),
      returnIncidentView(),
      { defer, choose },
    );
    const root = page.root as unknown as FakeNode;
    const deferButton = requireNode(root, "page-return-incident-defer");
    const available = requireNode(
      root,
      "page-return-incident-choice-repair-select",
    );
    const unavailable = requireNode(
      root,
      "page-return-incident-choice-sealed-select",
    );

    deferButton.emit("click");
    unavailable.emit("click");
    available.emit("click");

    expect(defer).not.toHaveBeenCalled();
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith("repair");
  });
});
