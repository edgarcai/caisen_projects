/** 浏览器本地保存的轻量账户身份。 */
export interface AccountProfile {
  readonly accountId: string;
  readonly displayName: string;
}

/** 联机房间中的避难所公开身份。 */
export interface CoopPresence {
  readonly accountId: string;
  readonly displayName: string;
  readonly shelterName: string;
}

/** 玩家间可以交换的一种资源数量。 */
export interface CoopTradeBundle {
  readonly food: number;
  readonly parts: number;
  readonly medicalSupplies: number;
  readonly coins: number;
}

/** 一份由配置注入的交易交付与请求组合。 */
export interface CoopTradeProposal {
  readonly offered: CoopTradeBundle;
  readonly requested: CoopTradeBundle;
}

/** 联机演示通道中可广播的事件。 */
export type CoopEvent =
  | {
      readonly type: "presence";
      readonly eventId: string;
      readonly roomId: string;
      readonly createdAt: string;
      readonly sender: CoopPresence;
    }
  | {
      readonly type: "presence_leave";
      readonly eventId: string;
      readonly roomId: string;
      readonly createdAt: string;
      readonly sender: CoopPresence;
    }
  | {
      readonly type: "communication";
      readonly eventId: string;
      readonly roomId: string;
      readonly createdAt: string;
      readonly sender: CoopPresence;
      readonly message: string;
    }
  | {
      readonly type: "trade_offer";
      readonly eventId: string;
      readonly roomId: string;
      readonly createdAt: string;
      readonly sender: CoopPresence;
      readonly targetAccountId: string;
      readonly offered: CoopTradeBundle;
      readonly requested: CoopTradeBundle;
    }
  | {
      readonly type: "trade_reply";
      readonly eventId: string;
      readonly roomId: string;
      readonly createdAt: string;
      readonly sender: CoopPresence;
      readonly offerEventId: string;
      readonly accepted: boolean;
    };

/** 账户身份持久化端口。 */
export interface AccountRepository {
  /** 读取当前本地账户；尚未登录时返回空。 */
  load(): AccountProfile | null;

  /** 保存一份已校验账户身份。 */
  save(profile: AccountProfile): void;

  /** 清除当前本地账户。 */
  clear(): void;
}

/** 一个已连接联机房间的最小消息端口。 */
export interface CoopRoomConnection {
  /** 广播一条领域事件。 */
  send(event: CoopEvent): void;

  /** 订阅同房间事件并返回取消订阅函数。 */
  subscribe(listener: (event: CoopEvent) => void): () => void;

  /** 返回本地降级与远程中继的实时连接状态。 */
  transportStatus?(): CoopTransportStatus;

  /** 订阅远程中继连接变化。 */
  subscribeTransportStatus?(listener: (status: CoopTransportStatus) => void): () => void;

  /** 关闭当前房间连接。 */
  close(): void;
}

/** 远程 WebSocket 中继的细分状态。 */
export type CoopRemoteRelayStatus = "disabled" | "connecting" | "connected" | "unavailable";

/** 联机房间本地与跨设备传输的独立状态。 */
export interface CoopTransportStatus {
  readonly localAvailable: boolean;
  readonly remoteRelay: CoopRemoteRelayStatus;
}

/** 为指定房间创建通信连接的抽象工厂。 */
export interface CoopRoomGateway {
  /** 连接配置化命名空间下的房间。 */
  connect(roomId: string): CoopRoomConnection;
}

/** 联机会话对 UI 暴露的只读快照。 */
export interface CoopSessionSnapshot {
  readonly account: AccountProfile | null;
  readonly roomId: string | null;
  readonly localPresence: CoopPresence | null;
  readonly events: readonly CoopEvent[];
  readonly transport: CoopTransportStatus;
}

/** 联机网关接收的单条事件验证结果。 */
export type CoopEventParseResult =
  | { readonly valid: true; readonly event: CoopEvent }
  | { readonly valid: false; readonly reason: string };

/** 对跨标签页或跨设备输入执行完整结构与值域校验。 */
export function parseCoopEvent(value: unknown): CoopEventParseResult {
  if (!isRecord(value)) return invalid("事件必须是对象。");
  const type = value.type;
  if (
    type !== "presence"
    && type !== "presence_leave"
    && type !== "communication"
    && type !== "trade_offer"
    && type !== "trade_reply"
  ) {
    return invalid("未知的联机事件类型。");
  }
  const common = parseCommonEvent(value);
  if (!common.valid) return common;
  if (type === "presence" || type === "presence_leave") {
    return { valid: true, event: { type, ...common.value } };
  }
  if (type === "communication") {
    if (!isNonEmptyString(value.message)) return invalid("通讯内容无效。");
    return { valid: true, event: { type, ...common.value, message: value.message } };
  }
  if (type === "trade_offer") {
    if (!isNonEmptyString(value.targetAccountId)) return invalid("交易目标账户无效。");
    const offered = parseTradeBundle(value.offered);
    const requested = parseTradeBundle(value.requested);
    if (offered === null || requested === null) return invalid("交易物资结构无效。");
    if (bundleTotal(offered) + bundleTotal(requested) === 0) {
      return invalid("交易提案不能为空。");
    }
    return {
      valid: true,
      event: {
        type,
        ...common.value,
        targetAccountId: value.targetAccountId,
        offered,
        requested,
      },
    };
  }
  if (!isNonEmptyString(value.offerEventId) || typeof value.accepted !== "boolean") {
    return invalid("交易回复结构无效。");
  }
  return {
    valid: true,
    event: {
      type,
      ...common.value,
      offerEventId: value.offerEventId,
      accepted: value.accepted,
    },
  };
}

/** 解析事件 ID、房间、时间和发送者等公共字段。 */
function parseCommonEvent(value: Record<string, unknown>):
  | { readonly valid: true; readonly value: {
      readonly eventId: string;
      readonly roomId: string;
      readonly createdAt: string;
      readonly sender: CoopPresence;
    } }
  | { readonly valid: false; readonly reason: string } {
  if (
    !isNonEmptyString(value.eventId)
    || !isNonEmptyString(value.roomId)
    || !isNonEmptyString(value.createdAt)
  ) {
    return invalid("联机事件公共字段无效。");
  }
  const sender = parsePresence(value.sender);
  if (sender === null) return invalid("联机发送者结构无效。");
  return {
    valid: true,
    value: {
      eventId: value.eventId,
      roomId: value.roomId,
      createdAt: value.createdAt,
      sender,
    },
  };
}

/** 从未知输入中读取一个完整避难所身份。 */
function parsePresence(value: unknown): CoopPresence | null {
  if (
    !isRecord(value)
    || !isNonEmptyString(value.accountId)
    || !isNonEmptyString(value.displayName)
    || !isNonEmptyString(value.shelterName)
  ) {
    return null;
  }
  return {
    accountId: value.accountId,
    displayName: value.displayName,
    shelterName: value.shelterName,
  };
}

/** 从未知输入中读取非负整数交易物资。 */
function parseTradeBundle(value: unknown): CoopTradeBundle | null {
  if (!isRecord(value)) return null;
  const amounts = [value.food, value.parts, value.medicalSupplies, value.coins];
  if (amounts.some((amount) => !isNonNegativeInteger(amount))) return null;
  return {
    food: value.food as number,
    parts: value.parts as number,
    medicalSupplies: value.medicalSupplies as number,
    coins: value.coins as number,
  };
}

/** 计算一份交易物资的总数量。 */
function bundleTotal(bundle: CoopTradeBundle): number {
  return bundle.food + bundle.parts + bundle.medicalSupplies + bundle.coins;
}

/** 构造一个类型稳定的无效解析结果。 */
function invalid(reason: string): { readonly valid: false; readonly reason: string } {
  return { valid: false, reason };
}

/** 判断未知值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断未知值是否为非空字符串。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** 判断未知值是否为非负整数。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
