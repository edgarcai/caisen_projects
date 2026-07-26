/** 表示领域状态或命令违反游戏不变量。 */
export class DomainError extends Error {
  /** 创建一个可向应用层传递的领域错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/** 表示当前游戏状态无法执行请求的用例错误。 */
export class GameApplicationError extends Error {
  /** 创建一个可直接展示给玩家的应用错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "GameApplicationError";
  }
}

/** 表示配置化效果或条件不受支持。 */
export class StateOperationError extends Error {
  /** 创建状态操作错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "StateOperationError";
  }
}

/** 表示剧情场景、选择或结局无法解析。 */
export class StoryError extends Error {
  /** 创建剧情服务错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "StoryError";
  }
}

/** 表示探索事件或事件选择无法解析。 */
export class ExplorationError extends Error {
  /** 创建探索服务错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "ExplorationError";
  }
}

/** 表示首领战状态或战斗行动无效。 */
export class CombatError extends Error {
  /** 创建战斗服务错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "CombatError";
  }
}

/** 表示避难所经营命令无效。 */
export class ShelterManagementError extends Error {
  /** 创建经营服务错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "ShelterManagementError";
  }
}

/** 表示存档不可读、不可写或结构不兼容。 */
export class SaveDataError extends Error {
  /** 创建存档基础设施错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "SaveDataError";
  }
}
