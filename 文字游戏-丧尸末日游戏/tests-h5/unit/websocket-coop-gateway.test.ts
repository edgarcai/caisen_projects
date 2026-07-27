import { describe, expect, it } from "vitest";
import type { CoopTransportConfig } from "../../src/config/coopDemoConfig";
import type { CoopEvent, CoopRoomConnection, CoopRoomGateway } from "../../src/domain/coop";
import {
  CompositeCoopRoomGateway,
  createRoomUrl,
  LocalAccountRepository,
  MemoryStorage,
  WebSocketCoopGateway,
  type CoopWebSocketLike,
} from "../../src/infrastructure";
import { CoopSessionService } from "../../src/services";

const TRANSPORT_CONFIG: CoopTransportConfig = {
  websocketEnabled: true,
  websocketPath: "/coop",
  namespace: "shelter-test",
  outboundQueueLimit: 8,
  reconnectDelayMs: 10,
  maximumReconnectAttempts: 0,
  relayUpstream: "ws://127.0.0.1:4191",
  relayHost: "0.0.0.0",
  relayPort: 4191,
  relayMaximumPayloadBytes: 32768,
  relayHeartbeatMs: 30000,
};

const EVENT: CoopEvent = {
  type: "communication",
  eventId: "event-1",
  roomId: "ROOM-A",
  createdAt: "2166-01-01T00:00:00.000Z",
  sender: {
    accountId: "account-a",
    displayName: "林岚",
    shelterName: "北门避难所",
  },
  message: "跨设备通讯已连接。",
};

/** 测试用 WebSocket，支持手动触发连接与消息事件。 */
class FakeWebSocket implements CoopWebSocketLike {
  public readyState = 0;
  public readonly sent: string[] = [];
  private readonly lifecycle = new Map<string, Set<() => void>>();
  private readonly messages = new Set<(event: MessageEvent<unknown>) => void>();

  /** 记录已序列化的出站事件。 */
  public send(data: string): void { this.sent.push(data); }

  /** 关闭测试连接。 */
  public close(): void { this.readyState = 3; }

  /** 注册生命周期或消息监听器。 */
  public addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (() => void) | ((event: MessageEvent<unknown>) => void),
  ): void {
    if (type === "message") {
      this.messages.add(listener);
      return;
    }
    const listeners = this.lifecycle.get(type) ?? new Set<() => void>();
    listeners.add(listener as () => void);
    this.lifecycle.set(type, listeners);
  }

  /** 移除生命周期或消息监听器。 */
  public removeEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (() => void) | ((event: MessageEvent<unknown>) => void),
  ): void {
    if (type === "message") {
      this.messages.delete(listener);
      return;
    }
    this.lifecycle.get(type)?.delete(listener as () => void);
  }

  /** 触发连接成功并刷新 readyState。 */
  public open(): void {
    this.readyState = 1;
    for (const listener of this.lifecycle.get("open") ?? []) listener();
  }

  /** 模拟非主动断线并触发网关重连。 */
  public disconnect(): void {
    this.readyState = 3;
    for (const listener of this.lifecycle.get("close") ?? []) listener();
  }

  /** 向网关注入一条服务器文本消息。 */
  public receive(value: unknown): void {
    const event = { data: JSON.stringify(value) } as MessageEvent<unknown>;
    for (const listener of this.messages) listener(event);
  }
}

/** 使用手动分发器构造一个同步测试连接。 */
function createManualConnection(): {
  readonly connection: CoopRoomConnection;
  readonly emit: (event: CoopEvent) => void;
  readonly sent: CoopEvent[];
} {
  const listeners = new Set<(event: CoopEvent) => void>();
  const sent: CoopEvent[] = [];
  return {
    sent,
    emit: (event): void => { for (const listener of listeners) listener(event); },
    connection: {
      send: (event): void => { sent.push(event); },
      subscribe: (listener): (() => void) => {
        listeners.add(listener);
        return (): void => { listeners.delete(listener); };
      },
      close: (): void => { listeners.clear(); },
    },
  };
}

describe("WebSocket 跨设备联机网关", () => {
  it("从当前页面生成同源 ws/wss 房间地址", () => {
    expect(createRoomUrl(
      TRANSPORT_CONFIG,
      { href: "http://192.168.1.18:4190/game", protocol: "http:" },
      "ROOM A",
    )).toBe("ws://192.168.1.18:4190/coop?namespace=shelter-test&room=ROOM+A");
    expect(createRoomUrl(
      TRANSPORT_CONFIG,
      { href: "https://game.example/", protocol: "https:" },
      "B",
    )).toContain("wss://game.example/coop");
  });

  it("连接前缓存出站事件，连接后发送并拒绝伪造嵌套结构", () => {
    const socket = new FakeWebSocket();
    const gateway = new WebSocketCoopGateway(
      TRANSPORT_CONFIG,
      { href: "http://localhost:4190/", protocol: "http:" },
      (): CoopWebSocketLike => socket,
    );
    const connection = gateway.connect("ROOM-A");
    const received: CoopEvent[] = [];
    connection.subscribe((event): void => { received.push(event); });
    connection.send(EVENT);
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({ eventId: "event-1" });
    expect(connection.transportStatus?.().remoteRelay).toBe("connecting");
    socket.receive(EVENT);
    expect(connection.transportStatus?.().remoteRelay).toBe("connected");
    socket.receive({ ...EVENT, sender: { accountId: "missing-fields" } });
    expect(received).toEqual([EVENT]);
    connection.close();
  });

  it("组合本地与远程通道后双发单收，避免重复通讯", () => {
    const first = createManualConnection();
    const second = createManualConnection();
    const gateways: CoopRoomGateway[] = [first, second].map(({ connection }) => ({
      connect: (): CoopRoomConnection => connection,
    }));
    const connection = new CompositeCoopRoomGateway(gateways).connect("ROOM-A");
    const received: CoopEvent[] = [];
    connection.subscribe((event): void => { received.push(event); });
    connection.send(EVENT);
    first.emit(EVENT);
    second.emit(EVENT);
    expect(first.sent).toEqual([EVENT]);
    expect(second.sent).toEqual([EVENT]);
    expect(received).toEqual([EVENT]);
  });

  it("断线重连成功后会话使用新 ID 重发本地 presence", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = new WebSocketCoopGateway(
      { ...TRANSPORT_CONFIG, reconnectDelayMs: 0, maximumReconnectAttempts: 1 },
      { href: "http://localhost:4190/", protocol: "http:" },
      (): CoopWebSocketLike => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    );
    let sequence = 0;
    const session = new CoopSessionService(
      new LocalAccountRepository(new MemoryStorage(), "reconnect-account"),
      gateway,
      {
        maximum_name_characters: 18,
        maximum_room_characters: 36,
        maximum_message_characters: 120,
        maximum_events: 20,
        trade_offer_ttl_ms: 600000,
      },
      (): string => `event-${String(sequence += 1)}`,
      (): string => "2166-01-01T00:00:00.000Z",
    );
    session.login("重连所长");
    session.joinRoom("ROOM-A", "重连避难所");
    const first = sockets[0];
    if (first === undefined) throw new Error("测试要求创建首个套接字。");
    first.open();
    const firstPresenceIds = first.sent.map((serialized) =>
      (JSON.parse(serialized) as { readonly eventId: string }).eventId,
    );
    first.receive(JSON.parse(first.sent[0] ?? "{}") as unknown);
    expect(session.snapshot().transport.remoteRelay).toBe("connected");
    first.disconnect();
    await new Promise<void>((resolveDelay) => { setTimeout(resolveDelay, 5); });
    const second = sockets[1];
    if (second === undefined) throw new Error("测试要求创建重连套接字。");
    second.open();
    const reconnectedIds = second.sent.map((serialized) =>
      (JSON.parse(serialized) as { readonly eventId: string }).eventId,
    );
    second.receive(JSON.parse(second.sent[0] ?? "{}") as unknown);
    expect(session.snapshot().transport.remoteRelay).toBe("connected");
    expect(reconnectedIds.length).toBeGreaterThan(0);
    expect(reconnectedIds.some((id) => !firstPresenceIds.includes(id))).toBe(true);
    session.leaveRoom();
  });

  it("套接字打开但未收到中继确认时仍受重连上限约束", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = new WebSocketCoopGateway(
      { ...TRANSPORT_CONFIG, reconnectDelayMs: 0, maximumReconnectAttempts: 1 },
      { href: "http://localhost:4190/", protocol: "http:" },
      (): CoopWebSocketLike => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    );
    const connection = gateway.connect("ROOM-A");
    connection.send(EVENT);
    const first = sockets[0];
    if (first === undefined) throw new Error("测试要求创建首个套接字。");
    first.open();
    first.disconnect();
    await new Promise<void>((resolveDelay) => { setTimeout(resolveDelay, 5); });
    const second = sockets[1];
    if (second === undefined) throw new Error("测试要求创建重连套接字。");
    second.open();
    expect(second.sent.map(
      (serialized): unknown => JSON.parse(serialized) as unknown,
    )).toContainEqual(EVENT);
    second.disconnect();
    await new Promise<void>((resolveDelay) => { setTimeout(resolveDelay, 5); });

    expect(sockets).toHaveLength(2);
    expect(connection.transportStatus?.().remoteRelay).toBe("unavailable");
    connection.close();
  });
});
