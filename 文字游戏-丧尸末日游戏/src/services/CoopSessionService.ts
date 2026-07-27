import type {
  AccountProfile,
  AccountRepository,
  CoopEvent,
  CoopPresence,
  CoopRoomConnection,
  CoopRoomGateway,
  CoopSessionSnapshot,
  CoopTradeBundle,
} from "../domain/coop";

/** 联机会话的配置化输入限制与文案无关规则。 */
export interface CoopSessionRules {
  readonly maximum_name_characters: number;
  readonly maximum_room_characters: number;
  readonly maximum_message_characters: number;
  readonly maximum_events: number;
  readonly trade_offer_ttl_ms: number;
}

/** 生成稳定事件 ID 的可注入端口。 */
export type CoopIdFactory = () => string;

/** 生成 ISO 时间的可注入端口。 */
export type CoopClock = () => string;

/** 管理本地账户、房间连接、通讯和交易事件。 */
export class CoopSessionService {
  private readonly accounts: AccountRepository;
  private readonly gateway: CoopRoomGateway;
  private readonly rules: CoopSessionRules;
  private readonly createId: CoopIdFactory;
  private readonly now: CoopClock;
  private account: AccountProfile | null;
  private roomId: string | null = null;
  private localPresence: CoopPresence | null = null;
  private events: CoopEvent[] = [];
  private connection: CoopRoomConnection | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeTransport: (() => void) | null = null;
  private transport: CoopSessionSnapshot["transport"] = {
    localAvailable: false,
    remoteRelay: "disabled",
  };
  private readonly listeners = new Set<(snapshot: CoopSessionSnapshot) => void>();

  /** 注入持久化、通信、限制、ID 与时钟端口。 */
  public constructor(
    accounts: AccountRepository,
    gateway: CoopRoomGateway,
    rules: CoopSessionRules,
    createId: CoopIdFactory = defaultIdFactory,
    now: CoopClock = defaultClock,
  ) {
    this.accounts = accounts;
    this.gateway = gateway;
    this.rules = rules;
    this.createId = createId;
    this.now = now;
    this.account = accounts.load();
  }

  /** 返回不会暴露内部数组引用的会话快照。 */
  public snapshot(): CoopSessionSnapshot {
    return {
      account: this.account === null ? null : { ...this.account },
      roomId: this.roomId,
      localPresence: this.localPresence === null ? null : { ...this.localPresence },
      events: structuredClone(this.events),
      transport: { ...this.transport },
    };
  }

  /** 订阅账户或房间状态变化。 */
  public subscribe(listener: (snapshot: CoopSessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  /** 创建或切换一个仅保存于当前浏览器的游戏账户。 */
  public login(displayName: string): AccountProfile {
    const normalized = displayName.trim();
    if (
      normalized === ""
      || visibleCharacterLength(normalized) > this.rules.maximum_name_characters
    ) {
      throw new Error("账户名称长度无效。");
    }
    const profile = {
      accountId: this.account?.accountId ?? this.createId(),
      displayName: normalized,
    };
    this.account = profile;
    this.accounts.save(profile);
    this.emit();
    return { ...profile };
  }

  /** 离开房间并清除本地账户。 */
  public logout(): void {
    try {
      this.leaveRoom();
    } finally {
      this.account = null;
      this.accounts.clear();
      this.emit();
    }
  }

  /** 以当前账户和避难所名称加入一个本地协作房间。 */
  public joinRoom(roomId: string, shelterName: string): void {
    const account = this.requireAccount();
    const normalizedRoomId = roomId.trim();
    const normalizedShelterName = shelterName.trim();
    if (
      normalizedRoomId === ""
      || visibleCharacterLength(normalizedRoomId) > this.rules.maximum_room_characters
    ) {
      throw new Error("联机房间号长度无效。");
    }
    if (
      normalizedShelterName === ""
      || visibleCharacterLength(normalizedShelterName) > this.rules.maximum_name_characters
    ) {
      throw new Error("避难所名称长度无效。");
    }
    this.leaveRoom();
    const connection = this.gateway.connect(normalizedRoomId);
    this.roomId = normalizedRoomId;
    this.localPresence = {
      accountId: account.accountId,
      displayName: account.displayName,
      shelterName: normalizedShelterName,
    };
    this.connection = connection;
    try {
      this.unsubscribe = connection.subscribe((event) => {
        if (event.roomId !== this.roomId) return;
        this.record(event);
      });
      this.transport = connection.transportStatus?.() ?? {
        localAvailable: true,
        remoteRelay: "disabled",
      };
      this.unsubscribeTransport = connection.subscribeTransportStatus?.((status) => {
        const shouldQueueReconnectPresence = this.transport.remoteRelay === "connected"
          && status.remoteRelay === "connecting";
        this.transport = { ...status };
        if (
          shouldQueueReconnectPresence
          && this.connection !== null
          && this.localPresence !== null
        ) {
          this.sendPresence();
          return;
        }
        this.emit();
      }) ?? null;
      this.sendPresence();
    } catch (error: unknown) {
      try {
        this.releaseRoomConnection(connection);
      } catch {
        // 保留导致加入失败的原始错误。
      }
      throw error;
    }
  }

  /** 主动离开当前房间并释放广播资源。 */
  public leaveRoom(): void {
    const connection = this.connection;
    try {
      if (connection !== null && this.roomId !== null && this.localPresence !== null) {
        this.send({
          type: "presence_leave",
          eventId: this.createId(),
          roomId: this.roomId,
          createdAt: this.now(),
          sender: this.localPresence,
        });
      }
    } finally {
      this.releaseRoomConnection(connection);
    }
  }

  /** 向同房间避难所发送一条文本通讯。 */
  public sendCommunication(message: string): void {
    const normalized = message.trim();
    if (
      normalized === ""
      || visibleCharacterLength(normalized) > this.rules.maximum_message_characters
    ) {
      throw new Error("通讯内容长度无效。");
    }
    this.send({
      type: "communication",
      eventId: this.createId(),
      roomId: this.requireRoomId(),
      createdAt: this.now(),
      sender: this.requirePresence(),
      message: normalized,
    });
  }

  /** 向指定账户发出一份物资交易提案。 */
  public sendTradeOffer(
    targetAccountId: string,
    offered: CoopTradeBundle,
    requested: CoopTradeBundle,
  ): void {
    this.validateTradeBundle(offered);
    this.validateTradeBundle(requested);
    const target = targetAccountId.trim();
    if (target === "" || target === this.requirePresence().accountId) {
      throw new Error("交易目标账户无效。");
    }
    if (tradeBundleTotal(offered) + tradeBundleTotal(requested) === 0) {
      throw new Error("交易提案不能为空。");
    }
    this.send({
      type: "trade_offer",
      eventId: this.createId(),
      roomId: this.requireRoomId(),
      createdAt: this.now(),
      sender: this.requirePresence(),
      targetAccountId: target,
      offered: { ...offered },
      requested: { ...requested },
    });
  }

  /** 接受或拒绝一份发给当前账户的交易提案。 */
  public replyTradeOffer(offerEventId: string, accepted: boolean): void {
    const presence = this.requirePresence();
    const offer = this.events.find(
      (event): event is Extract<CoopEvent, { readonly type: "trade_offer" }> =>
        event.type === "trade_offer" && event.eventId === offerEventId,
    );
    if (offer === undefined || offer.targetAccountId !== presence.accountId) {
      throw new Error("没有找到发给当前账户的交易提案。");
    }
    if (this.events.some(
      (event) => event.type === "trade_reply" && event.offerEventId === offerEventId,
    )) {
      throw new Error("该交易提案已经处理。");
    }
    this.send({
      type: "trade_reply",
      eventId: this.createId(),
      roomId: this.requireRoomId(),
      createdAt: this.now(),
      sender: presence,
      offerEventId,
      accepted,
    });
  }

  /** 校验交易数量均为非负整数且至少一方含有物资。 */
  private validateTradeBundle(bundle: CoopTradeBundle): void {
    const amounts = [bundle.food, bundle.parts, bundle.medicalSupplies, bundle.coins];
    if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
      throw new Error("交易物资数量必须是非负整数。");
    }
  }

  /** 广播事件并同步记录本端事件，避免原生通道不回显。 */
  private send(event: CoopEvent): void {
    const connection = this.connection;
    if (connection === null) throw new Error("尚未加入联机房间。");
    connection.send(event);
    this.record(event);
  }

  /** 使用新事件 ID 发送当前避难所身份，用于首次连接与断线重连。 */
  private sendPresence(): void {
    this.send({
      type: "presence",
      eventId: this.createId(),
      roomId: this.requireRoomId(),
      createdAt: this.now(),
      sender: this.requirePresence(),
    });
  }

  /** 释放订阅和连接，即使 close 失败也恢复为完整的未入房状态。 */
  private releaseRoomConnection(connection: CoopRoomConnection | null): void {
    try {
      this.unsubscribeTransport?.();
    } finally {
      this.unsubscribeTransport = null;
      try {
        this.unsubscribe?.();
      } finally {
        this.unsubscribe = null;
        try {
          connection?.close();
        } finally {
          this.connection = null;
          this.roomId = null;
          this.localPresence = null;
          this.events = [];
          this.transport = { localAvailable: false, remoteRelay: "disabled" };
          this.emit();
        }
      }
    }
  }

  /** 以固定上限保存最新事件并通知订阅者。 */
  private record(event: CoopEvent): void {
    if (this.events.some((candidate) => candidate.eventId === event.eventId)) return;
    this.events.push(structuredClone(event));
    this.events = this.events.slice(-this.rules.maximum_events);
    this.emit();
  }

  /** 返回当前账户或抛出可直接展示的错误。 */
  private requireAccount(): AccountProfile {
    if (this.account === null) throw new Error("您还未登录账户。");
    return this.account;
  }

  /** 返回当前房间号或拒绝房间外操作。 */
  private requireRoomId(): string {
    if (this.roomId === null) throw new Error("尚未加入联机房间。");
    return this.roomId;
  }

  /** 返回本地避难所身份或拒绝房间外操作。 */
  private requirePresence(): CoopPresence {
    if (this.localPresence === null) throw new Error("尚未加入联机房间。");
    return this.localPresence;
  }

  /** 向全部订阅者发送新的不可变快照。 */
  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** 计算一份交易物资的总数量。 */
function tradeBundleTotal(bundle: CoopTradeBundle): number {
  return bundle.food + bundle.parts + bundle.medicalSupplies + bundle.coins;
}

/** 使用浏览器安全随机源生成本地身份和事件 ID。 */
function defaultIdFactory(): string {
  const cryptoProvider = Reflect.get(globalThis, "crypto") as Crypto | undefined;
  if (cryptoProvider !== undefined && typeof cryptoProvider.randomUUID === "function") {
    return cryptoProvider.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** 返回当前 ISO 时间。 */
function defaultClock(): string {
  return new Date().toISOString();
}

/** 按 Unicode 码点计算用户可见文字长度，避免代理对被重复计数。 */
function visibleCharacterLength(value: string): number {
  return Array.from(value).length;
}
