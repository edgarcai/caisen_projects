import { afterEach, describe, expect, it, vi } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  PointerTooltip,
  resolvePointerTooltipGeometry,
  type PointerTooltipOptions,
} from "../../src/ui/components/PointerTooltip";
import { UiFactory } from "../../src/ui/components/UiFactory";
import type {
  LayaNodeLike,
  LayaRuntimeLike,
} from "../../src/ui/laya/LayaRuntime";

/** 测试绘图调用中需要观察的矩形颜色。 */
interface DrawRectCall {
  readonly fillColor: string;
  readonly lineColor: string | undefined;
}

/** 记录自绘按钮最后一次矩形或多边形颜色。 */
class FakeGraphics {
  public readonly fills: DrawRectCall[] = [];

  /** 清空当前绘制记录，模拟 Laya 重绘语义。 */
  public clear(): void {
    this.fills.length = 0;
  }

  /** 记录矩形填充和描边颜色。 */
  public drawRect(
    _x: number,
    _y: number,
    _width: number,
    _height: number,
    fillColor: string,
    lineColor?: string,
  ): void {
    this.fills.push({ fillColor, lineColor });
  }

  /** 记录多边形填充和描边颜色。 */
  public drawPoly(
    _x: number,
    _y: number,
    _points: readonly number[],
    fillColor: string,
    lineColor?: string,
  ): void {
    this.fills.push({ fillColor, lineColor });
  }

  /** 线段不参与本组测试，仅保留运行时兼容入口。 */
  public drawLine(): void {}
}

/** 提供子节点、事件和销毁语义的最小 Laya 测试节点。 */
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
    Array<{ readonly caller: unknown; readonly listener: () => void }>
  >();

  /** 添加子节点并维护可供断言的父链。 */
  public addChild<T extends FakeNode>(child: T): T {
    child.removeSelf();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /** 按稳定名称返回直接子节点。 */
  public getChildByName(name: string): FakeNode | null {
    return this.children.find((child) => child.name === name) ?? null;
  }

  /** 删除指定范围内的子节点并清理父引用。 */
  public removeChildren(beginIndex = 0, endIndex = this.children.length - 1): this {
    const count = Math.max(0, endIndex - beginIndex + 1);
    const removed = this.children.splice(beginIndex, count);
    removed.forEach((child) => { child.parent = null; });
    return this;
  }

  /** 从父节点移除自身。 */
  public removeSelf(): this {
    const index = this.parent?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parent?.children.splice(index, 1);
    }
    this.parent = null;
    return this;
  }

  /** 释放自身，并按参数选择是否递归释放子节点。 */
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

  /** 注册一个可由测试显式触发的事件监听。 */
  public on(event: string, caller: unknown, listener: () => void): this {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ caller, listener });
    this.listeners.set(event, entries);
    return this;
  }

  /** 精确移除指定事件、调用者和监听函数。 */
  public off(event: string, caller: unknown, listener: () => void): this {
    const entries = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      entries.filter((entry) =>
        entry.caller !== caller || entry.listener !== listener
      ),
    );
    return this;
  }

  /** 移除节点上的全部事件监听。 */
  public offAll(): this {
    this.listeners.clear();
    return this;
  }

  /** 按注册顺序触发指定测试事件。 */
  public emit(event: string): void {
    [...(this.listeners.get(event) ?? [])].forEach((entry) => {
      entry.listener();
    });
  }
}

/** 带绘图记录的最小精灵。 */
class FakeSprite extends FakeNode {
  public readonly graphics = new FakeGraphics();
}

/** 能依据宽度给出确定性换行高度的最小文本节点。 */
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

  /** 根据字符数、字号和宽度估算稳定的测试文本高度。 */
  public get textHeight(): number {
    const characterWidth = Math.max(1, this.fontSize);
    const charactersPerLine = Math.max(1, Math.floor(this.width / characterWidth));
    const lines = this.wordWrap
      ? Math.max(1, Math.ceil(this.text.length / charactersPerLine))
      : 1;
    return lines * (this.fontSize + this.leading);
  }
}

/** 输入节点不参与交互，仅补齐 UiFactory 构造器契约。 */
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

/** 图片节点记录当前皮肤且不提供真实纹理。 */
class FakeImage extends FakeSprite {
  public skin = "";
  public readonly source = null;

  /** 接受可选初始皮肤以匹配 Laya 图片构造器。 */
  public constructor(skin = "") {
    super();
    this.skin = skin;
  }
}

/** 测试裁剪矩形。 */
class FakeRectangle {
  /** 保存裁剪范围。 */
  public constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
}

/** 带鼠标坐标的最小舞台节点。 */
class FakeStage extends FakeSprite {
  public mouseX = 0;
  public mouseY = 0;
  public bgColor = "";
}

/** 构造可由 UiFactory 和 PointerTooltip 共用的确定性运行时。 */
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

const webConfig = parseWebGameConfig(webConfigDocument);

/** 使用真实主题 token 创建被测 UI 工厂。 */
function createFactory(runtime: LayaRuntimeLike): UiFactory {
  return new UiFactory(
    runtime,
    webConfig.theme,
    webConfig.typography,
    webConfig.controls,
  );
}

/** 创建不包含任何隐藏几何常量的提示框测试配置。 */
function createTooltipOptions(): PointerTooltipOptions {
  return {
    testId: "test-pointer-tooltip",
    delayMs: 300,
    width: 140,
    padding: 10,
    offset: { x: 12, y: 16 },
    bounds: { left: 20, top: 30, right: 220, bottom: 180 },
    titleFontSize: 18,
    titleLineHeight: 24,
    descriptionFontSize: 14,
    descriptionLineHeight: 20,
    contentGap: 8,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("指针提示框基础件", () => {
  it("纯几何在右下角溢出时同时钳制位置和尺寸", () => {
    expect(resolvePointerTooltipGeometry({
      pointerX: 195,
      pointerY: 145,
      width: 260,
      height: 190,
      offset: { x: 12, y: 16 },
      bounds: { left: 20, top: 30, right: 220, bottom: 180 },
    })).toEqual({
      x: 20,
      y: 30,
      width: 200,
      height: 150,
    });
  });

  it("延迟结束后才显示，移动时跟随鼠标并始终留在边界内", () => {
    vi.useFakeTimers();
    const { runtime, stage } = createFakeRuntime();
    const factory = createFactory(runtime);
    const tooltip = new PointerTooltip(
      runtime,
      factory,
      stage as unknown as LayaNodeLike,
      createTooltipOptions(),
    );
    stage.mouseX = 40;
    stage.mouseY = 50;

    tooltip.enter({ title: "剧情锁定", description: "需要更多线索。" });
    vi.advanceTimersByTime(299);
    expect(stage.getChildByName("test-pointer-tooltip")).toBeNull();

    vi.advanceTimersByTime(1);
    const root = stage.getChildByName("test-pointer-tooltip");
    expect(root).not.toBeNull();
    expect(root?.x).toBe(52);
    expect(root?.y).toBe(66);

    stage.mouseX = 215;
    stage.mouseY = 175;
    tooltip.move();
    expect((root?.x ?? 0) + (root?.width ?? 0)).toBeLessThanOrEqual(220);
    expect((root?.y ?? 0) + (root?.height ?? 0)).toBeLessThanOrEqual(180);

    tooltip.leave();
    expect(stage.getChildByName("test-pointer-tooltip")).toBeNull();
    tooltip.destroy();
  });

  it("bind 可为禁用节点恢复悬停命中，并在解绑时恢复原状态", () => {
    vi.useFakeTimers();
    const { runtime, stage } = createFakeRuntime();
    const target = new FakeSprite();
    target.mouseEnabled = false;
    stage.addChild(target);
    const tooltip = new PointerTooltip(
      runtime,
      createFactory(runtime),
      stage as unknown as LayaNodeLike,
      createTooltipOptions(),
    );
    const unbind = tooltip.bind(
      target as unknown as LayaNodeLike,
      { title: "不可执行", description: "缺少必要物资。" },
      true,
    );

    expect(target.mouseEnabled).toBe(true);
    target.emit("mouseover");
    vi.advanceTimersByTime(300);
    expect(stage.getChildByName("test-pointer-tooltip")).not.toBeNull();

    unbind();
    expect(target.mouseEnabled).toBe(false);
    expect(stage.getChildByName("test-pointer-tooltip")).toBeNull();
    tooltip.destroy();
  });
});

describe("按钮禁用悬停契约", () => {
  it("禁用按钮可发布悬停回调，但始终保持灰态且绝不点击", () => {
    const { runtime, stage } = createFakeRuntime();
    const factory = createFactory(runtime);
    const onHoverStart = vi.fn();
    const onHoverMove = vi.fn();
    const onHoverEnd = vi.fn();
    const onClick = vi.fn();
    const button = factory.button(stage as unknown as LayaNodeLike, {
      testId: "disabled-primary",
      label: "锁定路线",
      x: 0,
      y: 0,
      width: 180,
      height: 64,
      tone: "primary",
      disabled: true,
      hoverableWhenDisabled: true,
      onHoverStart,
      onHoverMove,
      onHoverEnd,
      onClick,
    }) as unknown as FakeSprite;
    const label = button.getChildByName("disabled-primary-label") as FakeText;

    expect(button.mouseEnabled).toBe(true);
    expect(button.graphics.fills.at(-1)).toEqual({
      fillColor: webConfig.theme.background_soft,
      lineColor: webConfig.theme.border,
    });
    expect(label.color).toBe(webConfig.theme.muted_text);

    button.emit("mouseover");
    button.emit("mousemove");
    button.emit("click");
    button.emit("mouseout");

    expect(onHoverStart).toHaveBeenCalledOnce();
    expect(onHoverMove).toHaveBeenCalledOnce();
    expect(onHoverEnd).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    expect(button.graphics.fills.at(-1)).toEqual({
      fillColor: webConfig.theme.background_soft,
      lineColor: webConfig.theme.border,
    });
    expect(label.color).toBe(webConfig.theme.muted_text);
  });

  it("正常按钮继续使用橙色悬停态并保持原有点击行为", () => {
    const { runtime, stage } = createFakeRuntime();
    const onClick = vi.fn();
    const button = createFactory(runtime).button(
      stage as unknown as LayaNodeLike,
      {
        testId: "enabled-primary",
        label: "可执行路线",
        x: 0,
        y: 0,
        width: 180,
        height: 64,
        tone: "primary",
        onClick,
      },
    ) as unknown as FakeSprite;

    button.emit("mouseover");
    expect(button.graphics.fills.at(-1)?.fillColor).toBe(
      webConfig.theme.primary_hover,
    );
    button.emit("click");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
