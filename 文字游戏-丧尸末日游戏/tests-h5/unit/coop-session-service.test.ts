import { describe, expect, it } from "vitest";
import type {
  CoopEvent,
  CoopRoomConnection,
  CoopRoomGateway,
} from "../../src/domain/coop";
import { LocalAccountRepository, MemoryStorage } from "../../src/infrastructure";
import { CoopSessionService } from "../../src/services";

/** 在单元测试内模拟一个可连接多个避难所的房间总线。 */
class InMemoryCoopGateway implements CoopRoomGateway {
  private readonly rooms = new Map<string, Set<InMemoryConnection>>();

  /** 创建并登记一个房间连接。 */
  public connect(roomId: string): CoopRoomConnection {
    const room = this.rooms.get(roomId) ?? new Set<InMemoryConnection>();
    this.rooms.set(roomId, room);
    const connection = new InMemoryConnection(room, (): void => {
      room.delete(connection);
    });
    room.add(connection);
    return connection;
  }
}

/** 在一个内存房间中转发领域事件。 */
class InMemoryConnection implements CoopRoomConnection {
  private readonly room: Set<InMemoryConnection>;
  private readonly closeConnection: () => void;
  private readonly listeners = new Set<(event: CoopEvent) => void>();

  /** 保存房间集合和释放回调。 */
  public constructor(room: Set<InMemoryConnection>, closeConnection: () => void) {
    this.room = room;
    this.closeConnection = closeConnection;
  }

  /** 向房间内全部连接广播事件。 */
  public send(event: CoopEvent): void {
    for (const connection of this.room) connection.receive(event);
  }

  /** 订阅本连接收到的事件。 */
  public subscribe(listener: (event: CoopEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  /** 从房间移除本连接。 */
  public close(): void {
    this.listeners.clear();
    this.closeConnection();
  }

  /** 把房间事件分发给本连接订阅者。 */
  private receive(event: CoopEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** 创建带稳定 ID 和时间的测试会话。 */
function createSession(
  gateway: CoopRoomGateway,
  prefix: string,
): CoopSessionService {
  let sequence = 0;
  return new CoopSessionService(
    new LocalAccountRepository(new MemoryStorage(), `${prefix}-account`),
    gateway,
    {
      maximum_name_characters: 18,
      maximum_room_characters: 36,
      maximum_message_characters: 120,
      maximum_events: 20,
      trade_offer_ttl_ms: 600000,
    },
    (): string => `${prefix}-${String(sequence += 1)}`,
    (): string => "2166-01-01T00:00:00.000Z",
  );
}

describe("浏览器本地联机会话", () => {
  it("未登录时给出明确提示，登录后可由两个避难所通讯和提出交易", () => {
    const gateway = new InMemoryCoopGateway();
    const first = createSession(gateway, "first");
    const second = createSession(gateway, "second");
    expect(() => {
      first.joinRoom("B17", "北门避难所");
    }).toThrow("您还未登录账户");

    const firstAccount = first.login("林岚");
    const secondAccount = second.login("阳关");
    first.joinRoom("B17", "北门避难所");
    second.joinRoom("B17", "高架桥避难所");
    first.sendCommunication("第七码头已清理，可以交换物资。");
    second.sendTradeOffer(
      firstAccount.accountId,
      { food: 2, parts: 0, medicalSupplies: 0, coins: 0 },
      { food: 0, parts: 3, medicalSupplies: 0, coins: 0 },
    );

    expect(first.snapshot().events.some(
      (event) => event.type === "communication" && event.sender.accountId === firstAccount.accountId,
    )).toBe(true);
    expect(first.snapshot().events.some(
      (event) => event.type === "trade_offer" && event.sender.accountId === secondAccount.accountId,
    )).toBe(true);
    expect(second.snapshot().localPresence?.shelterName).toBe("高架桥避难所");
  });

  it("网关连接失败后不会留下半连接房间状态", () => {
    const gateway: CoopRoomGateway = {
      connect: (): CoopRoomConnection => {
        throw new Error("测试网关不可用。");
      },
    };
    const session = createSession(gateway, "failing");
    session.login("失败测试所长");

    expect(() => {
      session.joinRoom("BROKEN", "失败测试避难所");
    }).toThrow("测试网关不可用");
    expect(session.snapshot()).toMatchObject({
      roomId: null,
      localPresence: null,
      transport: { localAvailable: false, remoteRelay: "disabled" },
    });
  });

  it("离房广播失败时仍释放连接并清空房间状态", () => {
    let sendCount = 0;
    let closed = false;
    const gateway: CoopRoomGateway = {
      connect: (): CoopRoomConnection => ({
        send: (): void => {
          sendCount += 1;
          if (sendCount > 1) throw new Error("离房广播失败。");
        },
        subscribe: (): (() => void) => (): void => undefined,
        close: (): void => { closed = true; },
      }),
    };
    const session = createSession(gateway, "leave-failing");
    session.login("清理测试所长");
    session.joinRoom("CLEANUP", "清理测试避难所");

    expect(() => { session.leaveRoom(); }).toThrow("离房广播失败");
    expect(closed).toBe(true);
    expect(session.snapshot()).toMatchObject({
      roomId: null,
      localPresence: null,
      transport: { localAvailable: false, remoteRelay: "disabled" },
    });
  });
});
