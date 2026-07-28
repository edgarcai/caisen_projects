import { describe, expect, it, vi } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import { resolveResponsiveLayoutFromMetrics } from "../../src/styles/ResponsiveLayout";
import { UiFactory } from "../../src/ui/components/UiFactory";
import type { LayaRuntimeLike } from "../../src/ui/laya/LayaRuntime";
import {
  createSaveSlotLabel,
  createSaveSlotsPage,
  isSaveSlotDisabled,
  resolveSaveSlotGridGeometry,
} from "../../src/ui/pages/SaveSlotsPage";
import type {
  SaveSlotsPageMode,
  UiSaveSlotView,
} from "../../src/ui/ports/GameUiPort";

/** 提供 UiFactory 所需的最小可观测绘图实现。 */
class FakeGraphics {
  public drawCount = 0;

  /** 模拟清空当前图形指令。 */
  public clear(): void {
    this.drawCount = 0;
  }

  /** 记录一次矩形绘制。 */
  public drawRect(): void {
    this.drawCount += 1;
  }

  /** 记录一次多边形绘制。 */
  public drawPoly(): void {
    this.drawCount += 1;
  }

  /** 记录一次线段绘制。 */
  public drawLine(): void {
    this.drawCount += 1;
  }
}

/** 支持显示树、事件和销毁语义的最小 Laya 测试节点。 */
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

  /** 添加子节点并同步父链。 */
  public addChild<T extends FakeNode>(child: T): T {
    child.removeSelf();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /** 按名称查询直接子节点。 */
  public getChildByName(name: string): FakeNode | null {
    return this.children.find((child) => child.name === name) ?? null;
  }

  /** 删除指定范围内的子节点。 */
  public removeChildren(beginIndex = 0, endIndex = this.children.length - 1): this {
    const removed = this.children.splice(
      beginIndex,
      Math.max(0, endIndex - beginIndex + 1),
    );
    removed.forEach((child) => { child.parent = null; });
    return this;
  }

  /** 从当前父节点移除自身。 */
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
      [...this.children].forEach((child) => { child.destroy(true); });
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

  /** 注册测试事件监听。 */
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

  /** 精确移除指定事件监听。 */
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

  /** 移除当前节点的全部事件监听。 */
  public offAll(): this {
    this.listeners.clear();
    return this;
  }

  /** 触发指定事件并透传测试参数。 */
  public emit(event: string, ...argumentsList: unknown[]): void {
    [...(this.listeners.get(event) ?? [])].forEach((entry) => {
      entry.listener(...argumentsList);
    });
  }

  /** 返回指定事件的当前监听数量。 */
  public listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

/** 带最小绘图能力的精灵节点。 */
class FakeSprite extends FakeNode {
  public readonly graphics = new FakeGraphics();
}

/** 能依据显式换行稳定计算高度的文本节点。 */
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

  /** 返回覆盖显式换行数量的确定性文本高度。 */
  public get textHeight(): number {
    const lines = Math.max(1, this.text.split(/\r?\n/u).length);
    return lines * Math.max(1, this.fontSize + this.leading);
  }
}

/** 补齐 UiFactory 输入框契约的测试节点。 */
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

/** 记录皮肤路径的测试图片节点。 */
class FakeImage extends FakeSprite {
  public skin: string;
  public readonly source = null;

  /** 保存可选初始皮肤。 */
  public constructor(skin = "") {
    super();
    this.skin = skin;
  }
}

/** 保存滚动裁剪范围的测试矩形。 */
class FakeRectangle {
  /** 保存裁剪几何。 */
  public constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
}

/** 提供滚动交互所需指针坐标的测试舞台。 */
class FakeStage extends FakeSprite {
  public mouseX = 0;
  public mouseY = 0;
  public bgColor = "";
}

const webConfig = parseWebGameConfig(webConfigDocument);
const zeroSafeArea = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** 构造页面和工厂共用的确定性最小 Laya 运行时。 */
function createFakeRuntime(): {
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

/** 使用真实配置创建手机或桌面响应式布局。 */
function createLayout(isMobileDevice: boolean) {
  return resolveResponsiveLayoutFromMetrics(
    {
      stageWidth: isMobileDevice
        ? webConfig.engine.mobile_design_width
        : Math.max(
            webConfig.engine.design_width,
            webConfig.responsive.desktop_min_stage_width,
          ),
      stageHeight: isMobileDevice
        ? webConfig.engine.mobile_design_height
        : webConfig.engine.design_height,
      isMobileDevice,
      safeArea: zeroSafeArea,
    },
    webConfig,
  );
}

/** 使用真实主题 token 创建被测 UI 工厂。 */
function createFactory(runtime: LayaRuntimeLike): UiFactory {
  return new UiFactory(
    runtime,
    webConfig.theme,
    webConfig.typography,
    webConfig.controls,
  );
}

/** 构造覆盖四种存档状态的六槽页面夹具。 */
function createSlots(): readonly UiSaveSlotView[] {
  return [
    {
      slotId: 1,
      status: "empty",
      title: "栏位 1 · 空",
      details: "空栏位",
      loadable: false,
      writable: true,
    },
    {
      slotId: 2,
      status: "valid",
      title: "栏位 2 · 可读取",
      details: "模式：剧情\n所长：白菜\n难度：标准\n生存：第 18 天\n市区：A 市",
      loadable: true,
      writable: true,
    },
    {
      slotId: 3,
      status: "recoverable",
      title: "栏位 3 · 备份可恢复",
      details: "模式：单人\n所长：豪菜\n难度：艰难",
      loadable: true,
      writable: true,
    },
    {
      slotId: 4,
      status: "corrupted",
      title: "栏位 4 · 已损坏",
      details: "主档与备份均无法恢复",
      loadable: false,
      writable: true,
    },
    {
      slotId: 5,
      status: "valid",
      title: "栏位 5 · 可读取",
      details: "模式：多人\n所长：甲、乙\n难度：标准",
      loadable: true,
      writable: true,
    },
    {
      slotId: 6,
      status: "empty",
      title: "栏位 6 · 空",
      details: "空栏位",
      loadable: false,
      writable: true,
    },
  ];
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

/** 创建指定模式的真实存档页及其可观测回调。 */
function renderPage(mode: SaveSlotsPageMode, isMobileDevice = true) {
  const { runtime } = createFakeRuntime();
  const onSelect = vi.fn();
  const onBack = vi.fn();
  const page = createSaveSlotsPage(
    runtime,
    createFactory(runtime),
    webConfig,
    createLayout(isMobileDevice),
    createSlots(),
    mode,
    onSelect,
    onBack,
  );
  return {
    page,
    root: page.root as unknown as FakeNode,
    onSelect,
    onBack,
  };
}

describe("存档槽位页纯语义与响应式几何", () => {
  it("读取模式禁用空槽和损坏槽，保存模式允许覆盖所有槽", () => {
    const slots = createSlots();

    expect(slots.map((slot) => isSaveSlotDisabled("load", slot))).toEqual([
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(slots.every((slot) => !isSaveSlotDisabled("save", slot))).toBe(true);
  });

  it("手机使用配置化单列，桌面使用配置化多列且同一行等高", () => {
    const labels = createSlots().map(createSaveSlotLabel);
    const mobileLayout = createLayout(true);
    const desktopLayout = createLayout(false);
    const mobile = resolveSaveSlotGridGeometry(
      webConfig,
      mobileLayout,
      mobileLayout.contentWidth,
      mobileLayout.sectionGap,
      labels,
    );
    const desktop = resolveSaveSlotGridGeometry(
      webConfig,
      desktopLayout,
      desktopLayout.contentWidth,
      desktopLayout.sectionGap,
      labels,
    );

    expect(mobile.columns).toBe(webConfig.layout.page.mobile_option_columns);
    expect(mobile.rows).toBe(labels.length);
    expect(mobile.items[1]?.y).toBeGreaterThan(mobile.items[0]?.y ?? 0);
    expect(desktop.columns).toBe(webConfig.layout.page.desktop_option_columns);
    expect(desktop.rows).toBe(
      Math.ceil(labels.length / webConfig.layout.page.desktop_option_columns),
    );
    expect(desktop.items[1]?.y).toBe(desktop.items[0]?.y);
    expect(desktop.items[1]?.height).toBe(desktop.items[0]?.height);
    expect((desktop.items[0]?.width ?? 0) * desktop.columns +
      webConfig.layout.page.option_gap * (desktop.columns - 1)).toBe(
      desktopLayout.contentWidth,
    );
  });
});

describe("存档槽位页真实节点交互", () => {
  it("六个槽位同时显示标题和详情，手机内容可滚动", () => {
    const { page, root } = renderPage("load");
    for (const slot of createSlots()) {
      const label = requireNode(
        root,
        `page-save-slots-slot-${String(slot.slotId)}-label`,
      ) as FakeText;
      expect(label.text).toBe(`${slot.title}\n${slot.details}`);
    }
    const viewport = requireNode(root, "page-save-slots-scroll");
    const content = requireNode(root, "page-save-slots-scroll-content");
    expect(content.height).toBeGreaterThan(viewport.height);
    page.destroy();
  });

  it("读取模式的禁用槽仍接收悬停，但不会提交选择", () => {
    const { page, root, onSelect } = renderPage("load");
    const empty = requireNode(root, "page-save-slots-slot-1");
    const corrupted = requireNode(root, "page-save-slots-slot-4");
    const valid = requireNode(root, "page-save-slots-slot-2");

    expect(empty.mouseEnabled).toBe(true);
    expect(empty.listenerCount("mouseover")).toBeGreaterThan(0);
    expect(empty.listenerCount("click")).toBe(0);
    expect(corrupted.mouseEnabled).toBe(true);
    expect(corrupted.listenerCount("click")).toBe(0);
    empty.emit("click");
    corrupted.emit("click");
    expect(onSelect).not.toHaveBeenCalled();

    valid.emit("click");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
    page.destroy();
  });

  it("保存模式的空槽可选择，底部只保留返回动作", () => {
    const { page, root, onSelect, onBack } = renderPage("save", false);
    const empty = requireNode(root, "page-save-slots-slot-1");
    const actions = requireNode(root, "page-save-slots-actions");
    const actionButtons = actions.children.filter(
      (child) => child.name !== "page-save-slots-actions-skin",
    );

    expect(empty.listenerCount("click")).toBeGreaterThan(0);
    empty.emit("click");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
    expect(actionButtons.map((child) => child.name)).toEqual([
      "page-save-slots-back",
    ]);
    requireNode(root, "page-save-slots-back").emit("click");
    expect(onBack).toHaveBeenCalledOnce();
    page.destroy();
  });
});
