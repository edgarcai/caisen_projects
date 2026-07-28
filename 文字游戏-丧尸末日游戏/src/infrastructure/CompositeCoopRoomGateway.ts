import type {
  CoopEvent,
  CoopRoomConnection,
  CoopRoomGateway,
  CoopTransportStatus,
} from "../domain/coop";

/** 将本地广播和远程 WebSocket 组合成一个具有离线降级的房间网关。 */
export class CompositeCoopRoomGateway implements CoopRoomGateway {
  private readonly gateways: readonly CoopRoomGateway[];

  /** 注入至少一个可独立连接的房间网关。 */
  public constructor(gateways: readonly CoopRoomGateway[]) {
    if (gateways.length === 0) throw new Error("联机组合网关不能为空。");
    this.gateways = [...gateways];
  }

  /** 连接全部可用传输，个别传输创建失败时保留其余降级连接。 */
  public connect(roomId: string): CoopRoomConnection {
    const connections = this.gateways.flatMap((gateway) => {
      try {
        return [gateway.connect(roomId)];
      } catch {
        return [];
      }
    });
    if (connections.length === 0) throw new Error("当前浏览器无可用联机通道。");
    return new CompositeCoopRoomConnection(connections);
  }
}

/** 向多个传输同时发送，并按 eventId 对接收事件去重。 */
class CompositeCoopRoomConnection implements CoopRoomConnection {
  private readonly connections: readonly CoopRoomConnection[];
  private readonly listeners = new Set<(event: CoopEvent) => void>();
  private readonly seenEventIds = new Set<string>();
  private readonly unsubscribe: readonly (() => void)[];
  private readonly transportByConnection = new Map<CoopRoomConnection, CoopTransportStatus>();
  private readonly statusListeners = new Set<(status: CoopTransportStatus) => void>();
  private readonly unsubscribeStatuses: readonly (() => void)[];

  /** 注册所有子连接的单一去重分发器。 */
  public constructor(connections: readonly CoopRoomConnection[]) {
    this.connections = [...connections];
    this.unsubscribe = this.connections.map((connection) => connection.subscribe(
      (event): void => { this.receive(event); },
    ));
    this.unsubscribeStatuses = this.connections.map((connection) => {
      const initial = connection.transportStatus?.() ?? {
        localAvailable: true,
        remoteRelay: "disabled" as const,
      };
      this.transportByConnection.set(connection, initial);
      return connection.subscribeTransportStatus?.((status) => {
        this.transportByConnection.set(connection, status);
        this.emitTransportStatus();
      }) ?? ((): void => undefined);
    });
  }

  /** 同时发送到本地和远程通道，任一通道成功即视为可降级。 */
  public send(event: CoopEvent): void {
    let delivered = false;
    let lastError: unknown = null;
    for (const connection of this.connections) {
      try {
        connection.send(event);
        delivered = true;
      } catch (error: unknown) {
        lastError = error;
      }
    }
    if (!delivered) {
      throw lastError instanceof Error ? lastError : new Error("联机事件发送失败。");
    }
  }

  /** 订阅组合后的去重房间事件。 */
  public subscribe(listener: (event: CoopEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  /** 合并各子通道状态，远程仅在 WebSocket 实际打开时标记已连接。 */
  public transportStatus(): CoopTransportStatus {
    const statuses = [...this.transportByConnection.values()];
    const remoteRelay = statuses.some((status) => status.remoteRelay === "connected")
      ? "connected"
      : statuses.some((status) => status.remoteRelay === "connecting")
        ? "connecting"
        : statuses.some((status) => status.remoteRelay === "unavailable")
          ? "unavailable"
          : "disabled";
    return {
      localAvailable: statuses.some((status) => status.localAvailable),
      remoteRelay,
    };
  }

  /** 订阅组合传输状态并立即返回当前快照。 */
  public subscribeTransportStatus(
    listener: (status: CoopTransportStatus) => void,
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.transportStatus());
    return (): void => { this.statusListeners.delete(listener); };
  }

  /** 释放所有子连接、内部订阅和去重状态。 */
  public close(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    for (const unsubscribe of this.unsubscribeStatuses) unsubscribe();
    for (const connection of this.connections) connection.close();
    this.listeners.clear();
    this.seenEventIds.clear();
    this.statusListeners.clear();
    this.transportByConnection.clear();
  }

  /** 一个事件通过任一传输首次抵达时向上层分发。 */
  private receive(event: CoopEvent): void {
    if (this.seenEventIds.has(event.eventId)) return;
    this.seenEventIds.add(event.eventId);
    for (const listener of this.listeners) listener(event);
  }

  /** 将最新组合状态发送给会话服务。 */
  private emitTransportStatus(): void {
    const status = this.transportStatus();
    for (const listener of this.statusListeners) listener(status);
  }
}
