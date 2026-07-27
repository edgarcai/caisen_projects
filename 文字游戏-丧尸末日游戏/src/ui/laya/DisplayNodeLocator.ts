import type { LayaNodeLike } from "./LayaRuntime";

/** 教程聚焦层使用的舞台坐标边界。 */
export interface DisplayNodeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 在显示树中深度优先查找稳定 name；数组回退仅服务于轻量测试替身。
 */
export function findDisplayNodeByName(
  root: LayaNodeLike,
  nodeName: string,
): LayaNodeLike | null {
  if (root.name === nodeName) {
    return root;
  }
  for (const child of displayNodeChildren(root)) {
    const matched = findDisplayNodeByName(child, nodeName);
    if (matched !== null) {
      return matched;
    }
  }
  return null;
}

/**
 * 把纯平移 Laya UI 树中的可见节点换算为舞台坐标，供引导遮罩聚焦。
 */
export function resolveVisibleDisplayNodeBounds(
  root: LayaNodeLike,
  nodeName: string,
): DisplayNodeBounds | null {
  const node = findDisplayNodeByName(root, nodeName);
  if (node === null || node.width <= 0 || node.height <= 0) {
    return null;
  }
  let current: LayaNodeLike | null = node;
  let x = 0;
  let y = 0;
  while (current !== null) {
    if (!current.visible) {
      return null;
    }
    x += current.x;
    y += current.y;
    if (current === root) {
      return { x, y, width: node.width, height: node.height };
    }
    current = current.parent;
  }
  return null;
}

/** 读取真实 Laya 子节点或测试替身公开的 children 数组。 */
function displayNodeChildren(node: LayaNodeLike): readonly LayaNodeLike[] {
  if (
    typeof node.numChildren === "number"
    && typeof node.getChildAt === "function"
  ) {
    const children: LayaNodeLike[] = [];
    for (let index = 0; index < node.numChildren; index += 1) {
      children.push(node.getChildAt(index));
    }
    return children;
  }
  const fallback = Reflect.get(node, "children") as unknown;
  return Array.isArray(fallback)
    ? fallback.filter(isLayaNodeLike)
    : [];
}

/** 保护测试回退分支，只让最小节点契约进入递归。 */
function isLayaNodeLike(value: unknown): value is LayaNodeLike {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "name") === "string";
}
