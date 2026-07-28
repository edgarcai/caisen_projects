import { DelayedHoverIntent } from "../interactions/DelayedHoverIntent";
import type { UiFactory } from "./UiFactory";
import type {
  LayaNodeLike,
  LayaRuntimeLike,
  LayaSpriteLike,
} from "../laya/LayaRuntime";

/** 指针提示框展示的标题与简介。 */
export interface PointerTooltipContent {
  readonly title: string;
  readonly description: string;
}

/** 指针提示框允许占用的舞台边界。 */
export interface PointerTooltipBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 指针提示框相对鼠标位置的偏移量。 */
export interface PointerTooltipOffset {
  readonly x: number;
  readonly y: number;
}

/** 指针提示框全部可配置的布局与排版参数。 */
export interface PointerTooltipOptions {
  readonly testId: string;
  readonly delayMs: number;
  readonly width: number;
  readonly padding: number;
  readonly offset: PointerTooltipOffset;
  readonly bounds: PointerTooltipBounds;
  readonly titleFontSize: number;
  readonly titleLineHeight: number;
  readonly descriptionFontSize: number;
  readonly descriptionLineHeight: number;
  readonly contentGap: number;
}

/** 指针提示框钳制后的舞台几何。 */
export interface PointerTooltipGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 纯几何计算所需的鼠标、尺寸、偏移和边界。 */
export interface PointerTooltipGeometryInput {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly width: number;
  readonly height: number;
  readonly offset: PointerTooltipOffset;
  readonly bounds: PointerTooltipBounds;
}

/** 已绑定节点及其可精确解绑的悬停监听。 */
interface PointerTooltipBinding {
  readonly node: LayaNodeLike;
  readonly originalMouseEnabled: boolean;
  readonly enabledDisabledHover: boolean;
  readonly handleEnter: () => void;
  readonly handleMove: () => void;
  readonly handleLeave: () => void;
}

/** 把数值限制在闭区间内；无可用区间时回落到下界。 */
function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * 根据指针位置计算提示框几何，并把尺寸与坐标钳制到舞台边界内。
 */
export function resolvePointerTooltipGeometry(
  input: PointerTooltipGeometryInput,
): PointerTooltipGeometry {
  const availableWidth = Math.max(
    0,
    input.bounds.right - input.bounds.left,
  );
  const availableHeight = Math.max(
    0,
    input.bounds.bottom - input.bounds.top,
  );
  const width = Math.min(Math.max(0, input.width), availableWidth);
  const height = Math.min(Math.max(0, input.height), availableHeight);
  return {
    x: clamp(
      input.pointerX + input.offset.x,
      input.bounds.left,
      input.bounds.right - width,
    ),
    y: clamp(
      input.pointerY + input.offset.y,
      input.bounds.top,
      input.bounds.bottom - height,
    ),
    width,
    height,
  };
}

/**
 * 在配置化延迟后于鼠标下方展示标题和简介，并自动钳制到舞台边界。
 */
export class PointerTooltip {
  private readonly runtime: LayaRuntimeLike;
  private readonly factory: UiFactory;
  private readonly parent: LayaNodeLike;
  private readonly options: PointerTooltipOptions;
  private readonly hoverIntent: DelayedHoverIntent<PointerTooltipContent>;
  private readonly bindings: PointerTooltipBinding[];
  private tooltipRoot: LayaSpriteLike | null;

  /** 保存渲染依赖并创建唯一的延迟悬停控制器。 */
  public constructor(
    runtime: LayaRuntimeLike,
    factory: UiFactory,
    parent: LayaNodeLike,
    options: PointerTooltipOptions,
  ) {
    this.runtime = runtime;
    this.factory = factory;
    this.parent = parent;
    this.options = options;
    this.bindings = [];
    this.tooltipRoot = null;
    this.hoverIntent = new DelayedHoverIntent(
      options.delayMs,
      this.handleIntentChange,
    );
  }

  /** 进入目标时从头开始配置化延迟，不立即创建显示节点。 */
  public enter(content: PointerTooltipContent): void {
    this.hoverIntent.enter(content);
  }

  /** 指针移动时仅更新已经展示的提示框位置。 */
  public move(): void {
    this.positionTooltip();
  }

  /** 离开目标时取消待显示任务并移除当前提示框。 */
  public leave(): void {
    this.hoverIntent.leave();
  }

  /**
   * 把目标节点绑定到提示内容；允许时可单独恢复禁用节点的悬停命中。
   */
  public bind(
    node: LayaNodeLike,
    content: PointerTooltipContent,
    hoverableWhenDisabled = false,
  ): () => void {
    const binding: PointerTooltipBinding = {
      node,
      originalMouseEnabled: node.mouseEnabled,
      enabledDisabledHover: !node.mouseEnabled && hoverableWhenDisabled,
      handleEnter: (): void => { this.enter(content); },
      handleMove: (): void => { this.move(); },
      handleLeave: (): void => { this.leave(); },
    };
    if (binding.enabledDisabledHover) {
      node.mouseEnabled = true;
    }
    node.on(this.runtime.Event.MOUSE_OVER, node, binding.handleEnter);
    node.on(this.runtime.Event.MOUSE_MOVE, node, binding.handleMove);
    node.on(this.runtime.Event.MOUSE_OUT, node, binding.handleLeave);
    this.bindings.push(binding);
    return (): void => { this.unbind(binding); };
  }

  /** 解绑所有目标、取消延迟任务并释放显示节点。 */
  public destroy(): void {
    for (const binding of [...this.bindings]) {
      this.unbind(binding);
    }
    this.hoverIntent.destroy();
    this.removeTooltip();
  }

  /** 把延迟悬停结果转换为显示或隐藏操作。 */
  private readonly handleIntentChange = (
    content: PointerTooltipContent | null,
  ): void => {
    if (content === null) {
      this.removeTooltip();
      return;
    }
    this.renderTooltip(content);
  };

  /** 根据实际换行高度创建一个新的提示框显示树。 */
  private renderTooltip(content: PointerTooltipContent): void {
    this.removeTooltip();
    const availableWidth = Math.max(
      0,
      this.options.bounds.right - this.options.bounds.left,
    );
    const width = Math.min(this.options.width, availableWidth);
    const contentWidth = width - this.options.padding * 2;
    if (contentWidth <= 0) {
      return;
    }
    const descriptionHeight = this.measureDescriptionHeight(
      content.description,
      contentWidth,
    );
    const requestedHeight =
      this.options.padding * 2 +
      this.options.titleLineHeight +
      this.options.contentGap +
      descriptionHeight;
    const geometry = resolvePointerTooltipGeometry({
      pointerX: this.runtime.stage.mouseX,
      pointerY: this.runtime.stage.mouseY,
      width,
      height: requestedHeight,
      offset: this.options.offset,
      bounds: this.options.bounds,
    });
    if (geometry.width <= 0 || geometry.height <= 0) {
      return;
    }
    const root = this.factory.panel(this.parent, {
      testId: this.options.testId,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      elevated: true,
      translucent: true,
      active: true,
    });
    root.mouseEnabled = false;
    root.scrollRect = new this.runtime.Rectangle(
      0,
      0,
      geometry.width,
      geometry.height,
    );
    this.factory.text(root, {
      testId: `${this.options.testId}-title`,
      text: content.title,
      x: this.options.padding,
      y: this.options.padding,
      width: contentWidth,
      height: this.options.titleLineHeight,
      fontSize: this.options.titleFontSize,
      bold: true,
      wordWrap: false,
    });
    this.factory.text(root, {
      testId: `${this.options.testId}-description`,
      text: content.description,
      x: this.options.padding,
      y:
        this.options.padding +
        this.options.titleLineHeight +
        this.options.contentGap,
      width: contentWidth,
      height: descriptionHeight,
      fontSize: this.options.descriptionFontSize,
      wordWrap: true,
    });
    this.tooltipRoot = root;
  }

  /** 使用与正式文本相同的工厂参数测量简介实际换行高度。 */
  private measureDescriptionHeight(description: string, width: number): number {
    const measurementRoot = this.factory.container(
      `${this.options.testId}-measurement`,
    );
    const descriptionNode = this.factory.text(measurementRoot, {
      testId: `${this.options.testId}-measurement-description`,
      text: description,
      x: 0,
      y: 0,
      width,
      height: this.options.descriptionLineHeight,
      fontSize: this.options.descriptionFontSize,
      wordWrap: true,
    });
    const height = Math.max(
      this.options.descriptionLineHeight,
      descriptionNode.textHeight,
    );
    measurementRoot.destroy(true);
    return height;
  }

  /** 按当前舞台鼠标坐标重新钳制已展示提示框。 */
  private positionTooltip(): void {
    const root = this.tooltipRoot;
    if (root === null) {
      return;
    }
    const geometry = resolvePointerTooltipGeometry({
      pointerX: this.runtime.stage.mouseX,
      pointerY: this.runtime.stage.mouseY,
      width: root.width,
      height: root.height,
      offset: this.options.offset,
      bounds: this.options.bounds,
    });
    root.pos(geometry.x, geometry.y);
  }

  /** 移除已显示提示框，保持重复调用幂等。 */
  private removeTooltip(): void {
    this.tooltipRoot?.removeSelf();
    this.tooltipRoot?.destroy(true);
    this.tooltipRoot = null;
  }

  /** 解绑单个节点并恢复由本组件临时开启的鼠标命中状态。 */
  private unbind(binding: PointerTooltipBinding): void {
    const index = this.bindings.indexOf(binding);
    if (index < 0) {
      return;
    }
    binding.node.off(
      this.runtime.Event.MOUSE_OVER,
      binding.node,
      binding.handleEnter,
    );
    binding.node.off(
      this.runtime.Event.MOUSE_MOVE,
      binding.node,
      binding.handleMove,
    );
    binding.node.off(
      this.runtime.Event.MOUSE_OUT,
      binding.node,
      binding.handleLeave,
    );
    if (binding.enabledDisabledHover) {
      binding.node.mouseEnabled = binding.originalMouseEnabled;
    }
    this.bindings.splice(index, 1);
    this.leave();
  }
}
