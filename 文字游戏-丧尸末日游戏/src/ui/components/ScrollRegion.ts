import type {
  LayaNodeLike,
  LayaRuntimeLike,
  LayaSpriteLike,
} from "../laya/LayaRuntime";

/**
 * 在不依赖额外 Laya UI 包的情况下提供鼠标、触摸和滚轮滚动。
 */
export class ScrollRegion {
  public readonly viewport: LayaSpriteLike;
  public readonly content: LayaSpriteLike;
  private readonly runtime: LayaRuntimeLike;
  private readonly scrollStep: number;
  private readonly dragThreshold: number;
  private readonly viewportHeight: number;
  private contentHeight: number;
  private offsetY: number;
  private pointerStartY: number;
  private offsetStartY: number;
  private dragging: boolean;

  /**
   * 创建具有稳定测试名称的裁剪视口。
   */
  public constructor(
    runtime: LayaRuntimeLike,
    parent: LayaNodeLike,
    testId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    scrollStep: number,
    dragThreshold: number,
  ) {
    this.runtime = runtime;
    this.scrollStep = scrollStep;
    this.dragThreshold = dragThreshold;
    this.viewportHeight = height;
    this.contentHeight = height;
    this.offsetY = 0;
    this.pointerStartY = 0;
    this.offsetStartY = 0;
    this.dragging = false;
    this.viewport = new runtime.Sprite();
    this.viewport.name = testId;
    this.viewport.pos(x, y);
    this.viewport.size(width, height);
    this.viewport.scrollRect = new runtime.Rectangle(0, 0, width, height);
    this.content = new runtime.Sprite();
    this.content.name = `${testId}-content`;
    this.content.size(width, height);
    this.viewport.addChild(this.content);
    parent.addChild(this.viewport);
    this.bindEvents();
  }

  /**
   * 设置内容真实高度并重新约束当前位置。
   */
  public setContentHeight(height: number): void {
    this.contentHeight = Math.max(this.viewportHeight, height);
    this.content.height = this.contentHeight;
    this.setOffset(this.offsetY);
  }

  /**
   * 释放滚动视口的事件监听和显示节点。
   */
  public destroy(): void {
    this.viewport.offAll();
    this.runtime.stage.off(this.runtime.Event.MOUSE_MOVE, this, this.handleMove);
    this.runtime.stage.off(this.runtime.Event.MOUSE_UP, this, this.handleUp);
    this.runtime.stage.off(this.runtime.Event.MOUSE_OUT, this, this.handleUp);
    this.viewport.destroy(true);
  }

  /**
   * 注册滚动需要的鼠标和触摸事件。
   */
  private bindEvents(): void {
    this.viewport.on(this.runtime.Event.MOUSE_DOWN, this, this.handleDown);
    this.viewport.on(this.runtime.Event.MOUSE_WHEEL, this, this.handleWheel);
    this.runtime.stage.on(this.runtime.Event.MOUSE_MOVE, this, this.handleMove);
    this.runtime.stage.on(this.runtime.Event.MOUSE_UP, this, this.handleUp);
    this.runtime.stage.on(this.runtime.Event.MOUSE_OUT, this, this.handleUp);
  }

  /**
   * 记录拖动开始位置。
   */
  private readonly handleDown = (): void => {
    this.pointerStartY = this.runtime.stage.mouseY;
    this.offsetStartY = this.offsetY;
    this.dragging = true;
  };

  /**
   * 根据指针位移更新滚动位置。
   */
  private readonly handleMove = (): void => {
    if (!this.dragging) {
      return;
    }
    const distance = this.runtime.stage.mouseY - this.pointerStartY;
    if (Math.abs(distance) < this.dragThreshold) {
      return;
    }
    this.setOffset(this.offsetStartY - distance);
  };

  /**
   * 结束当前拖动。
   */
  private readonly handleUp = (): void => {
    this.dragging = false;
  };

  /**
   * 根据滚轮方向按配置步长滚动。
   */
  private readonly handleWheel = (event: unknown): void => {
    const delta = wheelDelta(event);
    if (delta === 0) {
      return;
    }
    this.setOffset(this.offsetY - Math.sign(delta) * this.scrollStep);
  };

  /**
   * 把滚动值约束到有效范围并同步内容位置。
   */
  private setOffset(value: number): void {
    const maximum = Math.max(0, this.contentHeight - this.viewportHeight);
    this.offsetY = Math.min(maximum, Math.max(0, value));
    this.content.y = -this.offsetY;
  }
}

/**
 * 同时读取 Laya 与浏览器原生滚轮增量，统一触控板和鼠标方向。
 */
function wheelDelta(event: unknown): number {
  if (typeof event !== "object" || event === null) {
    return 0;
  }
  const layaDelta = Reflect.get(event, "delta") as unknown;
  if (typeof layaDelta === "number" && Number.isFinite(layaDelta)) {
    return layaDelta;
  }
  const nativeEvent = Reflect.get(event, "nativeEvent") as unknown;
  if (typeof nativeEvent !== "object" || nativeEvent === null) {
    return 0;
  }
  const deltaY = Reflect.get(nativeEvent, "deltaY") as unknown;
  return typeof deltaY === "number" && Number.isFinite(deltaY) ? -deltaY : 0;
}
