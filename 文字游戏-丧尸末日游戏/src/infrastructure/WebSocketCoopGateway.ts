import type { CoopTransportConfig } from "../config/coopDemoConfig";
import {
  parseCoopEvent,
  type CoopEvent,
  type CoopRemoteRelayStatus,
  type CoopRoomConnection,
  type CoopRoomGateway,
  type CoopTransportStatus,
} from "../domain/coop";

const WEB_SOCKET_OPEN_STATE = 1;

/** WebSocket 连接所需的最小浏览器端口。 */
export interface CoopWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "open" | "close" | "error", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

/** 创建一个浏览器 WebSocket 连接。 */
export type CoopWebSocketFactory = (url: string) => CoopWebSocketLike;

/** 构建 WebSocket URL 所需的当前页面信息。 */
export interface CoopLocationLike {
  readonly href: string;
  readonly protocol: string;
}

/** 通过同源 WebSocket 中继实现跨电脑与手机的房间通讯。 */
export class WebSocketCoopGateway implements CoopRoomGateway {
  private readonly config: CoopTransportConfig;
  private readonly location: CoopLocationLike;
  private readonly factory: CoopWebSocketFactory;

  /** 注入版本化传输配置、页面位置与可测试连接工厂。 */
  public constructor(
    config: CoopTransportConfig,
    location: CoopLocationLike = globalThis.location,
    factory: CoopWebSocketFactory = browserWebSocketFactory,
  ) {
    this.config = structuredClone(config);
    this.location = location;
    this.factory = factory;
  }

  /** 为指定房间创建带队列和限次重连的长连接。 */
  public connect(roomId: string): CoopRoomConnection {
    const normalizedRoomId = roomId.trim();
    if (normalizedRoomId === "") throw new Error("联机房间号不能为空。");
    return new WebSocketCoopRoomConnection(
      createRoomUrl(this.config, this.location, normalizedRoomId),
      this.config,
      this.factory,
    );
  }
}

/** 管理单个远程房间的发送队列、消息校验与重连。 */
class WebSocketCoopRoomConnection implements CoopRoomConnection {
  private readonly url: string;
  private readonly config: CoopTransportConfig;
  private readonly factory: CoopWebSocketFactory;
  private readonly listeners = new Set<(event: CoopEvent) => void>();
  private queue: CoopEvent[] = [];
  private socket: CoopWebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  private remoteRelay: CoopRemoteRelayStatus = "connecting";
  private readonly statusListeners = new Set<(status: CoopTransportStatus) => void>();

  /** 保存稳定 URL 和策略后立即建立首次连接。 */
  public constructor(
    url: string,
    config: CoopTransportConfig,
    factory: CoopWebSocketFactory,
  ) {
    this.url = url;
    this.config = structuredClone(config);
    this.factory = factory;
    this.open();
  }

  /** 连接尚未打开时有界缓存，打开后立即发送。 */
  public send(event: CoopEvent): void {
    if (this.closed) throw new Error("联机连接已关闭。");
    if (this.socket?.readyState === WEB_SOCKET_OPEN_STATE) {
      if (this.remoteRelay !== "connected") this.rememberQueuedEvent(event);
      this.socket.send(JSON.stringify(event));
      return;
    }
    this.rememberQueuedEvent(event);
  }

  /** 订阅经过严格校验的远程房间事件。 */
  public subscribe(listener: (event: CoopEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  /** 返回当前远程中继状态，不将 WebSocket 排队误报为已连接。 */
  public transportStatus(): CoopTransportStatus {
    return { localAvailable: false, remoteRelay: this.remoteRelay };
  }

  /** 订阅远程中继变化并立即接收当前状态。 */
  public subscribeTransportStatus(
    listener: (status: CoopTransportStatus) => void,
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.transportStatus());
    return (): void => { this.statusListeners.delete(listener); };
  }

  /** 永久停止重连、释放套接字和全部订阅。 */
  public close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.detachSocket();
    this.socket?.close();
    this.socket = null;
    this.queue = [];
    this.listeners.clear();
    this.setRemoteRelay("unavailable");
    this.statusListeners.clear();
  }

  /** 创建套接字并安装一组稳定监听器。 */
  private open(): void {
    if (this.closed) return;
    try {
      this.socket = this.factory(this.url);
      this.socket.addEventListener("open", this.handleOpen);
      this.socket.addEventListener("message", this.handleMessage);
      this.socket.addEventListener("close", this.handleClose);
      this.socket.addEventListener("error", this.handleError);
    } catch {
      this.setRemoteRelay(this.scheduleReconnect() ? "connecting" : "unavailable");
    }
  }

  /** 套接字打开后重发积压事件，并保留到中继回声确认真正入房。 */
  private readonly handleOpen = (): void => {
    for (const event of this.queue) this.socket?.send(JSON.stringify(event));
  };

  /** 仅分发能通过完整领域结构校验的文本事件。 */
  private readonly handleMessage = (message: MessageEvent<unknown>): void => {
    if (typeof message.data !== "string") return;
    let raw: unknown;
    try {
      raw = JSON.parse(message.data) as unknown;
    } catch {
      return;
    }
    const parsed = parseCoopEvent(raw);
    if (!parsed.valid) return;
    this.queue = [];
    this.reconnectAttempts = 0;
    this.setRemoteRelay("connected");
    for (const listener of this.listeners) listener(parsed.event);
  };

  /** 在配置上限内按事件 ID 保存等待首次中继确认的出站事件。 */
  private rememberQueuedEvent(event: CoopEvent): void {
    this.queue = [
      ...this.queue.filter((candidate) => candidate.eventId !== event.eventId),
      structuredClone(event),
    ].slice(-this.config.outboundQueueLimit);
  }

  /** 非主动关闭时按配置尝试重连。 */
  private readonly handleClose = (): void => {
    this.detachSocket();
    this.socket = null;
    this.setRemoteRelay(this.scheduleReconnect() ? "connecting" : "unavailable");
  };

  /** 错误事件由随后的 close 统一驱动重连，避免重复计数。 */
  private readonly handleError = (): void => undefined;

  /** 达到配置上限前安排一次延时重连。 */
  private scheduleReconnect(): boolean {
    if (
      this.closed
      || this.reconnectTimer !== null
      || this.reconnectAttempts >= this.config.maximumReconnectAttempts
    ) return false;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout((): void => {
      this.reconnectTimer = null;
      this.open();
    }, this.config.reconnectDelayMs);
    return true;
  }

  /** 从当前套接字移除所有内部监听器。 */
  private detachSocket(): void {
    this.socket?.removeEventListener("open", this.handleOpen);
    this.socket?.removeEventListener("message", this.handleMessage);
    this.socket?.removeEventListener("close", this.handleClose);
    this.socket?.removeEventListener("error", this.handleError);
  }

  /** 仅在状态真实变化时向订阅者发布新快照。 */
  private setRemoteRelay(status: CoopRemoteRelayStatus): void {
    if (status === this.remoteRelay) return;
    this.remoteRelay = status;
    const snapshot = this.transportStatus();
    for (const listener of this.statusListeners) listener(snapshot);
  }
}

/** 把当前页面协议转为 ws/wss，并添加配置化房间和命名空间。 */
export function createRoomUrl(
  config: CoopTransportConfig,
  location: CoopLocationLike,
  roomId: string,
): string {
  const url = new URL(config.websocketPath, location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("namespace", config.namespace);
  url.searchParams.set("room", roomId);
  return url.toString();
}

/** 使用当前浏览器原生 WebSocket 实现传输端口。 */
function browserWebSocketFactory(url: string): CoopWebSocketLike {
  if (typeof WebSocket === "undefined") throw new Error("当前浏览器不支持 WebSocket。");
  return new WebSocket(url);
}
