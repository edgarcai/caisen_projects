import type {
  GameMode,
  GameScreenId,
  SaveSlotsPageMode,
  UiCompanionEquipmentSlot,
  UiDocumentView,
} from "../ports/GameUiPort";

/**
 * 页面实例可携带的纯展示上下文。
 */
export interface GameRouteContext {
  readonly mode?: GameMode;
  readonly saveSlotsMode?: SaveSlotsPageMode;
  readonly categoryId?: string;
  readonly optionId?: string;
  readonly companionId?: string;
  readonly equipmentSlot?: UiCompanionEquipmentSlot;
  readonly roomId?: string;
  readonly collectionId?: string;
  readonly documentId?: string;
  readonly encounterId?: string;
  readonly cityId?: string;
  readonly districtId?: string;
  readonly districtExplorationPath?: readonly number[];
  readonly document?: UiDocumentView;
}

/**
 * 页面栈中的不可变路由条目。
 */
export interface GameRoute {
  readonly screen: GameScreenId;
  readonly context?: GameRouteContext;
}

/**
 * 维护页面压栈、替换和根页面重置语义，不接触领域状态。
 */
export class PageStack {
  private routes: GameRoute[];

  /**
   * 使用给定根页面初始化页面栈。
   */
  public constructor(root: GameRoute) {
    this.routes = [root];
  }

  /**
   * 返回当前页面。
   */
  public current(): GameRoute {
    const route = this.routes[this.routes.length - 1];
    if (route === undefined) {
      throw new Error("页面栈不能处于空状态。");
    }
    return route;
  }

  /**
   * 返回从根页面到顶层页面的只读快照，供覆盖式渲染器对齐显示树。
   */
  public entries(): readonly GameRoute[] {
    return [...this.routes];
  }

  /**
   * 返回当前页面层级数量。
   */
  public depth(): number {
    return this.routes.length;
  }

  /**
   * 压入一个二级页面。
   */
  public push(route: GameRoute): void {
    this.routes.push(route);
  }

  /**
   * 替换当前页面，防止探索事件返回后重新抽取。
   */
  public replace(route: GameRoute): void {
    this.routes.splice(this.routes.length - 1, 1, route);
  }

  /**
   * 返回上一页，根页面保持不变。
   */
  public pop(): GameRoute {
    if (this.routes.length > 1) {
      this.routes.pop();
    }
    return this.current();
  }

  /**
   * 把页面栈重置为新的根页面。
   */
  public reset(route: GameRoute): void {
    this.routes = [route];
  }

  /**
   * 查询当前页面是否有可返回的父页面。
   */
  public canPop(): boolean {
    return this.routes.length > 1;
  }
}
