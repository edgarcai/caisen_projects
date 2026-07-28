import type {
  CoopEvent,
  CoopRoomConnection,
  CoopRoomGateway,
  CoopTransportStatus,
} from "../domain/coop";
import { parseCoopEvent } from "../domain/coop";

/** 浏览器 BroadcastChannel 的可替换最小接口。 */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

/** 创建一个具名广播通道。 */
export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

/** 使用同浏览器多标签通信实现零服务器联机演示通道。 */
export class BroadcastChannelCoopGateway implements CoopRoomGateway {
  private readonly channelPrefix: string;
  private readonly factory: BroadcastChannelFactory;

  /** 注入配置化频道前缀与浏览器通道工厂。 */
  public constructor(
    channelPrefix: string,
    factory: BroadcastChannelFactory = browserBroadcastChannelFactory,
  ) {
    this.channelPrefix = channelPrefix;
    this.factory = factory;
  }

  /** 创建隔离到指定房间的广播连接。 */
  public connect(roomId: string): CoopRoomConnection {
    const normalizedRoomId = roomId.trim();
    if (normalizedRoomId === "") throw new Error("联机房间号不能为空。");
    return new BrowserCoopRoomConnection(
      this.factory(`${this.channelPrefix}:${normalizedRoomId}`),
    );
  }
}

/** 把原生 BroadcastChannel 包装为领域端口。 */
class BrowserCoopRoomConnection implements CoopRoomConnection {
  private readonly channel: BroadcastChannelLike;
  private readonly listeners = new Set<(event: CoopEvent) => void>();
  private readonly messageListener: (event: MessageEvent<unknown>) => void;

  /** 保存原生通道并安装单一消息分发器。 */
  public constructor(channel: BroadcastChannelLike) {
    this.channel = channel;
    this.messageListener = (event): void => {
      const parsed = parseCoopEvent(event.data);
      if (!parsed.valid) return;
      for (const listener of this.listeners) listener(parsed.event);
    };
    this.channel.addEventListener("message", this.messageListener);
  }

  /** 广播一条已由会话服务构造的事件。 */
  public send(event: CoopEvent): void {
    this.channel.postMessage(structuredClone(event));
  }

  /** 订阅房间事件并返回幂等取消函数。 */
  public subscribe(listener: (event: CoopEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  /** 本地广播只能保证同浏览器通信，不声称远程中继已连接。 */
  public transportStatus(): CoopTransportStatus {
    return { localAvailable: true, remoteRelay: "disabled" };
  }

  /** 移除监听并关闭原生通道。 */
  public close(): void {
    this.channel.removeEventListener("message", this.messageListener);
    this.listeners.clear();
    this.channel.close();
  }
}

/** 使用当前浏览器创建原生广播通道。 */
function browserBroadcastChannelFactory(name: string): BroadcastChannelLike {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("当前浏览器不支持本地联机通道。");
  }
  return new BroadcastChannel(name);
}
