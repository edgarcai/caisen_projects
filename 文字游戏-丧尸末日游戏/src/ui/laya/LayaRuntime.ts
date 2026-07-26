/**
 * Laya 图形对象提供的最小绘图能力。
 */
export interface LayaGraphicsLike {
  clear(): void;
  drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    fillColor: string,
    lineColor?: string,
    lineWidth?: number,
  ): void;
  drawPoly(
    x: number,
    y: number,
    points: readonly number[],
    fillColor: string,
    lineColor?: string,
    lineWidth?: number,
  ): void;
  drawLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
    lineWidth?: number,
  ): void;
}

/**
 * UI 使用的 Laya 显示节点最小契约。
 */
export interface LayaNodeLike {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
  visible: boolean;
  mouseEnabled: boolean;
  zOrder: number;
  parent: LayaNodeLike | null;
  scrollRect?: LayaRectangleLike;
  addChild<T extends LayaNodeLike>(child: T): T;
  getChildByName?(name: string): LayaNodeLike | null;
  removeChildren(beginIndex?: number, endIndex?: number): LayaNodeLike;
  removeSelf(): LayaNodeLike;
  destroy(destroyChild?: boolean): void;
  pos(x: number, y: number): LayaNodeLike;
  size(width: number, height: number): LayaNodeLike;
  on(
    event: string,
    caller: unknown,
    listener: (...argumentsList: unknown[]) => void,
  ): LayaNodeLike;
  off(
    event: string,
    caller: unknown,
    listener: (...argumentsList: unknown[]) => void,
  ): LayaNodeLike;
  offAll(): LayaNodeLike;
}

/**
 * 可绘制的 Laya 精灵节点。
 */
export interface LayaSpriteLike extends LayaNodeLike {
  readonly graphics: LayaGraphicsLike;
}

/**
 * Laya 文本节点的最小属性集合。
 */
export interface LayaTextLike extends LayaSpriteLike {
  text: string;
  color: string;
  font: string;
  fontSize: number;
  bold: boolean;
  align: string;
  valign: string;
  wordWrap: boolean;
  leading: number;
  overflow: string;
  readonly textHeight: number;
}

/**
 * Laya 输入框节点的最小属性集合。
 */
export interface LayaInputLike extends LayaTextLike {
  prompt: string;
  promptColor: string;
  bgColor: string;
  borderColor: string;
  type: string;
  maxChars: number;
  multiline: boolean;
  padding: readonly number[];
  focus: boolean;
}

/**
 * Laya 图片节点的最小属性集合。
 */
export interface LayaImageLike extends LayaSpriteLike {
  skin: string;
  readonly source: LayaTextureLike | null;
}

/**
 * 图片加载后用于读取原始宽高的纹理契约。
 */
export interface LayaTextureLike {
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

/**
 * Laya 裁剪矩形的最小契约。
 */
export interface LayaRectangleLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * GameShell 所需的 Laya 舞台能力。
 */
export interface LayaStageLike extends LayaSpriteLike {
  mouseX: number;
  mouseY: number;
  bgColor: string;
}

/**
 * GameShell 所需的 Laya 构造器与事件常量。
 */
export interface LayaRuntimeLike {
  readonly Sprite: new () => LayaSpriteLike;
  readonly Text: new () => LayaTextLike;
  readonly Input: new () => LayaInputLike;
  readonly Image: new (skin?: string) => LayaImageLike;
  readonly Rectangle: new (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => LayaRectangleLike;
  readonly Event: {
    readonly CLICK: string;
    readonly MOUSE_DOWN: string;
    readonly MOUSE_UP: string;
    readonly MOUSE_MOVE: string;
    readonly MOUSE_OUT: string;
    readonly MOUSE_OVER: string;
    readonly MOUSE_WHEEL: string;
    readonly RESIZE: string;
    readonly KEY_DOWN: string;
    readonly LOADED: string;
  };
  readonly stage: LayaStageLike;
}
