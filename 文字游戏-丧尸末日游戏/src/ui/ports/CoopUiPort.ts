/** 联机页展示的一个避难所身份。 */
export interface UiCoopPresence {
  readonly accountId: string;
  readonly accountName: string;
  readonly shelterName: string;
}

/** 联机页展示的一条通讯。 */
export interface UiCoopCommunication {
  readonly eventId: string;
  readonly senderName: string;
  readonly shelterName: string;
  readonly createdAt: string;
  readonly message: string;
}

/** 联机页可展示并处理的交易提案。 */
export interface UiCoopTradeOffer {
  readonly eventId: string;
  readonly senderAccountId: string;
  readonly senderName: string;
  readonly shelterName: string;
  readonly targetAccountId: string;
  readonly offered: UiCoopTradeBundle;
  readonly requested: UiCoopTradeBundle;
  readonly incoming: boolean;
  readonly resolved: boolean;
}

/** 展示层的一份交易物资数量。 */
export interface UiCoopTradeBundle {
  readonly food: number;
  readonly parts: number;
  readonly medicalSupplies: number;
  readonly coins: number;
}

/** 联机页中对交易提案的接受或拒绝回复。 */
export interface UiCoopTradeReply {
  readonly eventId: string;
  readonly offerEventId: string;
  readonly senderName: string;
  readonly accepted: boolean;
}

/** 账户、房间、在线避难所与通讯的只读快照。 */
export interface CoopUiSnapshot {
  readonly account: { readonly accountId: string; readonly displayName: string } | null;
  readonly roomId: string | null;
  readonly localShelterName: string | null;
  readonly presences: readonly UiCoopPresence[];
  readonly communications: readonly UiCoopCommunication[];
  readonly tradeOffers: readonly UiCoopTradeOffer[];
  readonly tradeReplies: readonly UiCoopTradeReply[];
  readonly transport: {
    readonly localAvailable: boolean;
    readonly remoteRelay: "disabled" | "connecting" | "connected" | "unavailable";
  };
}

/** 展示层访问本地联机用例的倒置端口。 */
export interface CoopUiPort {
  /** 返回当前不可变联机快照。 */
  getSnapshot(): CoopUiSnapshot;

  /** 订阅账户或通讯变化。 */
  subscribe(listener: (snapshot: CoopUiSnapshot) => void): () => void;

  /** 创建或更新本地账户。 */
  login(displayName: string): void;

  /** 退出账户并断开房间。 */
  logout(): void;

  /** 以本地避难所身份连接房间。 */
  joinRoom(roomId: string, shelterName: string): void;

  /** 断开当前联机房间。 */
  leaveRoom(): void;

  /** 向房间发送一条文本通讯。 */
  sendCommunication(message: string): void;

  /** 向指定远端避难所提出配置化演示交易。 */
  sendDemoTrade(targetAccountId: string): void;

  /** 接受或拒绝一份发给当前账户的交易提案。 */
  replyTradeOffer(offerEventId: string, accepted: boolean): void;
}
