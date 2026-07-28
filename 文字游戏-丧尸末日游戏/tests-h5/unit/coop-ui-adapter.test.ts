import { describe, expect, it } from "vitest";
import type {
  CoopEvent,
  CoopRoomConnection,
  CoopRoomGateway,
  CoopTradeProposal,
} from "../../src/domain/coop";
import { LocalAccountRepository, MemoryStorage } from "../../src/infrastructure";
import { CoopUiAdapter } from "../../src/presentation/CoopUiAdapter";
import { CoopSessionService } from "../../src/services/CoopSessionService";

const TEST_TRADE_PROPOSAL: CoopTradeProposal = {
  offered: { food: 2, parts: 0, medicalSupplies: 0, coins: 0 },
  requested: { food: 0, parts: 3, medicalSupplies: 0, coins: 0 },
};

/** 测试用房间总线，将同房间事件同步转发给全部连接。 */
class TestRoomGateway implements CoopRoomGateway {
  private readonly rooms = new Map<string, Set<TestRoomConnection>>();

  /** 创建并登记一个测试连接。 */
  public connect(roomId: string): CoopRoomConnection {
    const room = this.rooms.get(roomId) ?? new Set<TestRoomConnection>();
    this.rooms.set(roomId, room);
    const connection = new TestRoomConnection(room, (): void => {
      room.delete(connection);
    });
    room.add(connection);
    return connection;
  }
}

/** 测试房间的单个连接。 */
class TestRoomConnection implements CoopRoomConnection {
  private readonly room: Set<TestRoomConnection>;
  private readonly onClose: () => void;
  private readonly listeners = new Set<(event: CoopEvent) => void>();

  /** 保存房间集合与关闭回调。 */
  public constructor(room: Set<TestRoomConnection>, onClose: () => void) {
    this.room = room;
    this.onClose = onClose;
  }

  /** 同步向房间全部连接发送事件。 */
  public send(event: CoopEvent): void {
    for (const connection of this.room) connection.receive(event);
  }

  /** 订阅本连接事件。 */
  public subscribe(listener: (event: CoopEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** 清理订阅并移出房间。 */
  public close(): void {
    this.listeners.clear();
    this.onClose();
  }

  /** 将一条房间事件分发给本连接。 */
  private receive(event: CoopEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** 创建带稳定 ID 的测试联机适配器。 */
function createAdapter(gateway: CoopRoomGateway, prefix: string): CoopUiAdapter {
  let sequence = 0;
  return new CoopUiAdapter(
    new CoopSessionService(
      new LocalAccountRepository(new MemoryStorage(), `${prefix}-account`),
      gateway,
      {
        maximum_name_characters: 18,
        maximum_room_characters: 36,
        maximum_message_characters: 120,
        maximum_events: 40,
        trade_offer_ttl_ms: 600000,
      },
      (): string => `${prefix}-${String(sequence += 1)}`,
      (): string => "2166-01-01T08:30:00.000Z",
    ),
    TEST_TRADE_PROPOSAL,
  );
}

describe("联机展示适配器", () => {
  it("投影多避难所在线信号、通讯和交易提案", () => {
    const gateway = new TestRoomGateway();
    const first = createAdapter(gateway, "first");
    const second = createAdapter(gateway, "second");
    first.login("林岚");
    second.login("阳关");
    second.joinRoom("PAST-1", "高架桥避难所");
    first.joinRoom("PAST-1", "北门避难所");
    first.sendCommunication("东侧路线已清理。");
    const firstAccountId = first.getSnapshot().account?.accountId;
    if (firstAccountId === undefined) throw new Error("测试要求首个账户已登录。");
    second.sendDemoTrade(firstAccountId);

    const incoming = first.getSnapshot().tradeOffers[0];
    if (incoming === undefined) throw new Error("测试要求收到交易提案。");
    expect(incoming).toMatchObject({
      incoming: true,
      resolved: false,
      offered: TEST_TRADE_PROPOSAL.offered,
      requested: TEST_TRADE_PROPOSAL.requested,
    });
    first.replyTradeOffer(incoming.eventId, true);

    const snapshot = second.getSnapshot();
    expect(snapshot.presences.some(
      (presence) => presence.shelterName === "北门避难所",
    )).toBe(true);
    expect(snapshot.communications[0]).toMatchObject({
      senderName: "林岚",
      message: "东侧路线已清理。",
    });
    expect(snapshot.tradeOffers[0]).toMatchObject({ resolved: true });
    expect(snapshot.tradeReplies[0]).toMatchObject({ accepted: true });
  });
});
