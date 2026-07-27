import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  resolveResponsiveLayoutFromMetrics,
  type ResponsiveLayout,
} from "../../src/styles/ResponsiveLayout";
import { resolvePageActionBarGeometry } from "../../src/ui/components/PageActionBar";
import { ScrollRegion } from "../../src/ui/components/ScrollRegion";
import { resolveVisibleDisplayNodeBounds } from "../../src/ui/laya/DisplayNodeLocator";
import type {
  LayaNodeLike,
  LayaRuntimeLike,
} from "../../src/ui/laya/LayaRuntime";
import {
  resolveEscMenuGeometry,
} from "../../src/ui/pages/EscMenuPage";
import { resolvePageScaffoldGeometry } from "../../src/ui/pages/PageView";
import { buildFunctionMenuPrompt } from "../../src/ui/pages/SystemMenuPages";
import { describe, expect, it } from "vitest";

const config = parseWebGameConfig(webConfigDocument);
const zeroSafeArea = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** 按显式设备类型创建可复现的响应式布局。 */
function createLayout(
  stageWidth: number,
  stageHeight: number,
  isMobileDevice: boolean,
): ResponsiveLayout {
  return resolveResponsiveLayoutFromMetrics({
    stageWidth,
    stageHeight,
    isMobileDevice,
    safeArea: zeroSafeArea,
  }, config);
}

/** 按配置 ID 读取必须存在的质量视口，避免测试复制产品分辨率。 */
function requireQualityViewport(id: string) {
  const viewport = config.responsive.quality_viewports.find(
    (candidate) => candidate.id === id,
  );
  if (viewport === undefined) {
    throw new Error(`缺少质量视口：${id}`);
  }
  return viewport;
}

/** 只实现滚动单测所需的 Laya 显示节点和事件边界。 */
class FakeNode {
  public name = "";
  public x = 0;
  public y = 0;
  public width = 0;
  public height = 0;
  public visible = true;
  public mouseY = 0;
  public parent: FakeNode | null = null;
  public scrollRect: FakeRectangle | undefined;
  public readonly children: FakeNode[] = [];
  private readonly listeners = new Map<
    string,
    Array<(payload?: unknown) => void>
  >();

  /** 记录节点位置。 */
  public pos(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /** 记录节点尺寸。 */
  public size(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** 保存最小显示树，供程序化滚入视口与教程定位测试。 */
  public addChild(child: FakeNode): void {
    child.parent = this;
    this.children.push(child);
  }

  /** 登记一个事件回调。 */
  public on(
    event: string,
    caller: unknown,
    listener: (payload?: unknown) => void,
  ): void {
    void caller;
    const entries = this.listeners.get(event) ?? [];
    entries.push(listener);
    this.listeners.set(event, entries);
  }

  /** 移除一个已登记事件回调。 */
  public off(
    event: string,
    caller: unknown,
    listener: (payload?: unknown) => void,
  ): void {
    void caller;
    const entries = this.listeners.get(event) ?? [];
    this.listeners.set(event, entries.filter((entry) => entry !== listener));
  }

  /** 清空节点全部事件。 */
  public offAll(): void {
    this.listeners.clear();
  }

  /** 触发指定事件并传入原始参数。 */
  public emit(event: string, payload?: unknown): void {
    const entries = this.listeners.get(event) ?? [];
    entries.forEach((listener) => { listener(payload); });
  }

  /** 测试替身无需释放渲染资源。 */
  public destroy(destroyChildren?: boolean): void {
    void destroyChildren;
    this.offAll();
  }
}

/** 记录滚动裁剪矩形。 */
class FakeRectangle {
  /** 保存滚动视口的纯几何。 */
  public constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly width: number,
    public readonly height: number,
  ) {}
}

/** 创建支持滚轮和统一指针拖动事件的最小 Laya 运行时。 */
function createScrollRuntime(): {
  readonly runtime: LayaRuntimeLike;
  readonly stage: FakeNode;
} {
  const stage = new FakeNode();
  const runtime = {
    Sprite: FakeNode,
    Rectangle: FakeRectangle,
    stage,
    Event: {
      MOUSE_DOWN: "mousedown",
      MOUSE_MOVE: "mousemove",
      MOUSE_UP: "mouseup",
      MOUSE_OUT: "mouseout",
      MOUSE_WHEEL: "mousewheel",
    },
  } as unknown as LayaRuntimeLike;
  return { runtime, stage };
}

describe("ESC 菜单响应式几何", () => {
  it("桌面使用封面同款 2K PNG 并向右下阶梯排列，退出始终最后", () => {
    const layout = createLayout(1440, 900, false);
    const prompt = buildFunctionMenuPrompt(config, true);
    const geometry = resolveEscMenuGeometry(
      config,
      layout,
      config.layout.page.max_content_width - config.layout.page.body_padding * 2,
      prompt.options.length,
    );

    expect(config.assets.skins.cover_button_idle).toContain("_2k.png");
    expect(config.assets.skins.cover_button_disabled).toContain("_2k.png");
    expect(geometry.buttons.every((button) => button.shape === "parallelogram"))
      .toBe(true);
    expect(geometry.buttons.map((button) => button.x)).toEqual(
      [...geometry.buttons.map((button) => button.x)].sort((left, right) => left - right),
    );
    expect(prompt.options.at(-1)?.id).toBe("exit");
    expect(geometry.buttons.at(-1)?.y).toBe(Math.max(
      ...geometry.buttons.map((button) => button.y),
    ));
  });

  it("手机竖屏使用居中长方形，所有按钮满足触控高度", () => {
    const viewport = requireQualityViewport("mobile");
    const layout = createLayout(viewport.width, viewport.height, true);
    const geometry = resolveEscMenuGeometry(config, layout, layout.contentWidth, 4);
    const scaffold = resolvePageScaffoldGeometry(config, layout);
    const actionBar = resolvePageActionBarGeometry(
      config,
      scaffold.pageWidth,
      scaffold.pageHeight,
      2,
    );

    expect(geometry.buttons.every((button) => button.shape === "rectangle")).toBe(true);
    expect(new Set(geometry.buttons.map((button) => button.x)).size).toBe(1);
    expect(geometry.buttons.every((button) => (
      button.height >= config.controls.minimum_touch_size
    ))).toBe(true);
    expect(geometry.buttons.every((button) => (
      button.x >= 0 && button.x + button.width <= layout.contentWidth
    ))).toBe(true);
    expect(scaffold.pageTop).toBe(config.layout.mobile.sheet_top_margin);
    expect(scaffold.pageTop + scaffold.pageHeight).toBeLessThanOrEqual(
      layout.stageHeight - layout.outerPadding,
    );
    expect(actionBar.buttonHeight).toBeGreaterThanOrEqual(
      config.controls.minimum_touch_size,
    );
  });

  it("手机横屏保留最小触控滚动区，不压缩菜单按钮", () => {
    const viewport = requireQualityViewport("mobile_landscape");
    const layout = createLayout(
      viewport.width,
      viewport.height,
      true,
    );
    const scaffold = resolvePageScaffoldGeometry(config, layout);
    const innerHeight = scaffold.pageHeight
      - config.layout.page.header_height
      - config.layout.page.footer_height
      - config.layout.page.body_padding * 2;
    const geometry = resolveEscMenuGeometry(config, layout, layout.contentWidth, 4);

    expect(layout.isLandscape).toBe(true);
    expect(innerHeight).toBeGreaterThanOrEqual(config.controls.minimum_touch_size);
    expect(geometry.contentHeight).toBeGreaterThan(innerHeight);
    expect(geometry.buttons.every((button) => (
      button.height === config.controls.button_height
    ))).toBe(true);
  });
});

describe("ESC 菜单滚轮与触控拖动", () => {
  it("鼠标滚轮按配置步长下移内容", () => {
    const { runtime } = createScrollRuntime();
    const parent = new FakeNode();
    const region = new ScrollRegion(
      runtime,
      parent as unknown as LayaNodeLike,
      "esc-scroll",
      0,
      0,
      320,
      200,
      config.controls.scroll_step,
      config.controls.drag_threshold,
    );
    region.setContentHeight(500);

    (region.viewport as unknown as FakeNode).emit("mousewheel", { delta: -1 });

    expect(region.content.y).toBe(-config.controls.scroll_step);
    region.destroy();
  });

  it("手机统一指针拖动会滚动并在内容底部正确钳制", () => {
    const { runtime, stage } = createScrollRuntime();
    const parent = new FakeNode();
    const region = new ScrollRegion(
      runtime,
      parent as unknown as LayaNodeLike,
      "esc-touch-scroll",
      0,
      0,
      320,
      200,
      config.controls.scroll_step,
      config.controls.drag_threshold,
    );
    region.setContentHeight(500);
    stage.mouseY = 180;
    (region.viewport as unknown as FakeNode).emit("mousedown");
    stage.mouseY = -400;
    stage.emit("mousemove");
    stage.emit("mouseup");

    expect(region.content.y).toBe(-300);
    region.destroy();
  });

  it("教程目标位于滚动区外时会自动滚入当前视口", () => {
    const { runtime } = createScrollRuntime();
    const parent = new FakeNode();
    const region = new ScrollRegion(
      runtime,
      parent as unknown as LayaNodeLike,
      "tutorial-scroll",
      0,
      0,
      320,
      200,
      config.controls.scroll_step,
      config.controls.drag_threshold,
    );
    const target = new FakeNode();
    target.name = "dashboard-action-companions";
    target.pos(0, 420);
    target.size(240, 60);
    (region.content as unknown as FakeNode).addChild(target);
    region.setContentHeight(600);

    expect(region.revealNode(target.name, 10)).toBe(true);
    expect(region.content.y).toBe(-290);
    region.destroy();
  });
});

describe("教程显示节点定位", () => {
  it("累加可见父链平移并拒绝隐藏目标", () => {
    const root = new FakeNode();
    root.pos(10, 20);
    const panel = new FakeNode();
    panel.pos(30, 40);
    const target = new FakeNode();
    target.name = "dashboard-log";
    target.pos(5, 6);
    target.size(120, 80);
    root.addChild(panel);
    panel.addChild(target);

    expect(resolveVisibleDisplayNodeBounds(
      root as unknown as LayaNodeLike,
      target.name,
    )).toEqual({ x: 45, y: 66, width: 120, height: 80 });
    panel.visible = false;
    expect(resolveVisibleDisplayNodeBounds(
      root as unknown as LayaNodeLike,
      target.name,
    )).toBeNull();
  });
});
