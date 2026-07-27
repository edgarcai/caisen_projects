import type {
  CoopEvent,
  CoopSessionSnapshot,
  CoopTradeProposal,
} from "../domain/coop";
import type { CoopSessionService } from "../services/CoopSessionService";
import type {
  CoopUiPort,
  CoopUiSnapshot,
  UiCoopCommunication,
  UiCoopPresence,
  UiCoopTradeOffer,
  UiCoopTradeReply,
} from "../ui/ports/CoopUiPort";

/** 把联机会话事件投影为 Laya 页面只读模型。 */
export class CoopUiAdapter implements CoopUiPort {
  private readonly session: CoopSessionService;
  private readonly tradeOffer: CoopTradeProposal;

  /** 注入不依赖展示层的联机会话用例与配置化默认交易提案。 */
  public constructor(session: CoopSessionService, tradeOffer: CoopTradeProposal) {
    this.session = session;
    this.tradeOffer = {
      offered: { ...tradeOffer.offered },
      requested: { ...tradeOffer.requested },
    };
  }

  /** 从领域事件去重生成在线身份和通讯快照。 */
  public getSnapshot(): CoopUiSnapshot {
    return projectSnapshot(this.session.snapshot());
  }

  /** 订阅会话并仅向页面发送投影后的快照。 */
  public subscribe(listener: (snapshot: CoopUiSnapshot) => void): () => void {
    return this.session.subscribe((snapshot): void => {
      listener(projectSnapshot(snapshot));
    });
  }

  /** 创建或更新本地账户。 */
  public login(displayName: string): void {
    this.session.login(displayName);
  }

  /** 退出账户与当前房间。 */
  public logout(): void {
    this.session.logout();
  }

  /** 以指定避难所名称连接本地房间。 */
  public joinRoom(roomId: string, shelterName: string): void {
    this.session.joinRoom(roomId, shelterName);
  }

  /** 断开当前本地房间。 */
  public leaveRoom(): void {
    this.session.leaveRoom();
  }

  /** 发送一条房间通讯。 */
  public sendCommunication(message: string): void {
    this.session.sendCommunication(message);
  }

  /** 发送由联机配置声明的可观测交易提案。 */
  public sendDemoTrade(targetAccountId: string): void {
    this.session.sendTradeOffer(
      targetAccountId,
      { ...this.tradeOffer.offered },
      { ...this.tradeOffer.requested },
    );
  }

  /** 回复一份发给当前账户的交易提案。 */
  public replyTradeOffer(offerEventId: string, accepted: boolean): void {
    this.session.replyTradeOffer(offerEventId, accepted);
  }
}

/** 将领域快照投影为页面所需的最小数据。 */
function projectSnapshot(snapshot: CoopSessionSnapshot): CoopUiSnapshot {
  const tradeReplies = projectTradeReplies(snapshot.events);
  return {
    account: snapshot.account === null ? null : { ...snapshot.account },
    roomId: snapshot.roomId,
    localShelterName: snapshot.localPresence?.shelterName ?? null,
    presences: projectPresences(snapshot.events),
    communications: snapshot.events.flatMap((event) =>
      event.type === "communication" ? [projectCommunication(event)] : [],
    ),
    tradeOffers: projectTradeOffers(snapshot, tradeReplies),
    tradeReplies,
    transport: { ...snapshot.transport },
  };
}

/** 按账户去重并保留最新避难所在线信号。 */
function projectPresences(events: readonly CoopEvent[]): readonly UiCoopPresence[] {
  const presences = new Map<string, UiCoopPresence>();
  for (const event of events) {
    if (event.type === "presence_leave") {
      presences.delete(event.sender.accountId);
      continue;
    }
    if (event.type !== "presence") continue;
    presences.set(event.sender.accountId, {
      accountId: event.sender.accountId,
      accountName: event.sender.displayName,
      shelterName: event.sender.shelterName,
    });
  }
  return [...presences.values()];
}

/** 将全部交易回复投影为页面可读记录。 */
function projectTradeReplies(events: readonly CoopEvent[]): readonly UiCoopTradeReply[] {
  return events.flatMap((event) => event.type === "trade_reply" ? [{
    eventId: event.eventId,
    offerEventId: event.offerEventId,
    senderName: event.sender.displayName,
    accepted: event.accepted,
  }] : []);
}

/** 为当前账户标注交易方向与是否已处理。 */
function projectTradeOffers(
  snapshot: CoopSessionSnapshot,
  replies: readonly UiCoopTradeReply[],
): readonly UiCoopTradeOffer[] {
  const accountId = snapshot.account?.accountId ?? null;
  const resolvedIds = new Set(replies.map((reply) => reply.offerEventId));
  return snapshot.events.flatMap((event) => event.type === "trade_offer" ? [{
    eventId: event.eventId,
    senderAccountId: event.sender.accountId,
    senderName: event.sender.displayName,
    shelterName: event.sender.shelterName,
    targetAccountId: event.targetAccountId,
    offered: { ...event.offered },
    requested: { ...event.requested },
    incoming: accountId !== null && event.targetAccountId === accountId,
    resolved: resolvedIds.has(event.eventId),
  }] : []);
}

/** 将通讯事件转换为稳定页面记录。 */
function projectCommunication(
  event: Extract<CoopEvent, { readonly type: "communication" }>,
): UiCoopCommunication {
  return {
    eventId: event.eventId,
    senderName: event.sender.displayName,
    shelterName: event.sender.shelterName,
    createdAt: event.createdAt,
    message: event.message,
  };
}
