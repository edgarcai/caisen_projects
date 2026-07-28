import { formatTemplate } from "../../domain/content";
import type { CoopDemoConfig } from "../../config/coopDemoConfig";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaInputLike, LayaRuntimeLike } from "../laya/LayaRuntime";
import type {
  CoopUiSnapshot,
  UiCoopTradeBundle,
  UiCoopTradeOffer,
} from "../ports/CoopUiPort";
import { PageScaffold, type PageView } from "./PageView";

/** 账户与本地联机页可发出的用例意图。 */
export interface CoopAccountPageActions {
  readonly back: () => void;
  readonly prepareTextInput: () => void;
  readonly textInputBlurred: () => void;
  readonly login: (displayName: string) => void;
  readonly logout: () => void;
  readonly joinRoom: (roomId: string, shelterName: string) => void;
  readonly leaveRoom: () => void;
  readonly sendCommunication: (message: string) => void;
  readonly sendDemoTrade: (targetAccountId: string) => void;
  readonly replyTradeOffer: (offerEventId: string, accepted: boolean) => void;
}

/** 创建账户登录、房间连接、通讯和交易提案合一页。 */
export function createCoopAccountPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  layout: ResponsiveLayout,
  snapshot: CoopUiSnapshot,
  actions: CoopAccountPageActions,
): PageView {
  const page = new PageScaffold(
    runtime,
    factory,
    uiConfig,
    layout,
    "page-account-login",
    coopConfig.texts.title,
    actions.back,
    [{
      id: "back",
      testId: "page-account-login-back",
      label: coopConfig.texts.backLabel,
      onClick: actions.back,
    }],
  );
  let cursorY = renderNotice(factory, uiConfig, coopConfig, page, snapshot);
  cursorY = snapshot.account === null
    ? renderLogin(factory, uiConfig, coopConfig, page, cursorY, actions)
    : renderAuthenticated(
        factory,
        uiConfig,
        coopConfig,
        page,
        cursorY,
        snapshot,
        actions,
      );
  page.scroll.setContentHeight(cursorY + layout.sectionGap);
  return page;
}

/** 在页首明确本地 Demo 与真实跨设备联机的能力边界。 */
function renderNotice(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  page: PageScaffold,
  snapshot: CoopUiSnapshot,
): number {
  const relayStatus = {
    disabled: coopConfig.texts.relayStatusDisabled,
    connecting: coopConfig.texts.relayStatusConnecting,
    connected: coopConfig.texts.relayStatusConnected,
    unavailable: coopConfig.texts.relayStatusUnavailable,
  }[snapshot.transport.remoteRelay];
  const notice = factory.autoText(page.content, {
    testId: "coop-local-demo-notice",
    text: formatTemplate(coopConfig.texts.localDemoNotice, {
      local_status: snapshot.transport.localAvailable
        ? coopConfig.texts.localStatusAvailable
        : coopConfig.texts.localStatusUnavailable,
      relay_status: relayStatus,
    }),
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: uiConfig.typography.caption_size,
    color: uiConfig.theme.warning,
  });
  return notice.y + notice.height + uiConfig.layout.page.option_gap;
}

/** 渲染未登录红色警告、账户输入与登录按钮。 */
function renderLogin(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  page: PageScaffold,
  top: number,
  actions: CoopAccountPageActions,
): number {
  const warning = factory.autoText(page.content, {
    testId: "coop-login-warning",
    text: coopConfig.texts.loggedOutWarning,
    x: 0,
    y: top,
    width: page.contentWidth,
    fontSize: uiConfig.typography.body_size,
    color: uiConfig.theme.error,
    align: "center",
  });
  const inputTop = warning.y + warning.height + uiConfig.layout.page.option_gap;
  const input = createTextInput(
    factory,
    uiConfig,
    page,
    "coop-account-name",
    coopConfig.texts.accountNameLabel,
    coopConfig.defaults.accountName,
    inputTop,
    coopConfig.rules.maximum_name_characters,
    actions,
  );
  const buttonTop = input.y + input.height + uiConfig.layout.page.option_gap;
  factory.button(page.content, {
    testId: "coop-login-submit",
    label: coopConfig.texts.loginLabel,
    x: 0,
    y: buttonTop,
    width: page.contentWidth,
    height: uiConfig.controls.button_height,
    tone: "primary",
    onClick: (): void => { actions.login(input.text); },
  });
  return buttonTop + uiConfig.controls.button_height;
}

/** 按是否连接房间渲染连接表单或实时通讯区。 */
function renderAuthenticated(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  page: PageScaffold,
  top: number,
  snapshot: CoopUiSnapshot,
  actions: CoopAccountPageActions,
): number {
  const accountName = snapshot.account?.displayName ?? "";
  const account = factory.autoText(page.content, {
    testId: "coop-account-current",
    text: formatTemplate(coopConfig.texts.accountFormat, { name: accountName }),
    x: 0,
    y: top,
    width: page.contentWidth,
    fontSize: uiConfig.typography.body_size,
    color: uiConfig.theme.accent,
  });
  const contentTop = account.y + account.height + uiConfig.layout.page.option_gap;
  return snapshot.roomId === null
    ? renderRoomJoin(factory, uiConfig, coopConfig, page, contentTop, actions)
    : renderConnectedRoom(
        factory,
        uiConfig,
        coopConfig,
        page,
        contentTop,
        snapshot,
        actions,
      );
}

/** 渲染房间号、避难所名称与连接操作。 */
function renderRoomJoin(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  page: PageScaffold,
  top: number,
  actions: CoopAccountPageActions,
): number {
  const roomInput = createTextInput(
    factory,
    uiConfig,
    page,
    "coop-room-id",
    coopConfig.texts.roomLabel,
    coopConfig.defaults.roomId,
    top,
    coopConfig.rules.maximum_room_characters,
    actions,
  );
  const shelterInput = createTextInput(
    factory,
    uiConfig,
    page,
    "coop-shelter-name",
    coopConfig.texts.shelterNameLabel,
    coopConfig.defaults.shelterName,
    roomInput.y + roomInput.height + uiConfig.layout.page.option_gap,
    coopConfig.rules.maximum_name_characters,
    actions,
  );
  const joinTop = shelterInput.y + shelterInput.height + uiConfig.layout.page.option_gap;
  factory.button(page.content, {
    testId: "coop-room-join",
    label: coopConfig.texts.joinRoomLabel,
    x: 0,
    y: joinTop,
    width: page.contentWidth,
    height: uiConfig.controls.button_height,
    tone: "primary",
    onClick: (): void => { actions.joinRoom(roomInput.text, shelterInput.text); },
  });
  const logoutTop = joinTop + uiConfig.controls.button_height + uiConfig.layout.page.option_gap;
  factory.button(page.content, {
    testId: "coop-logout",
    label: coopConfig.texts.logoutLabel,
    x: 0,
    y: logoutTop,
    width: page.contentWidth,
    height: uiConfig.controls.compact_button_height,
    tone: "danger",
    onClick: actions.logout,
  });
  return logoutTop + uiConfig.controls.compact_button_height;
}

/** 渲染已连接房间的在线信号、通讯、交易和断开操作。 */
function renderConnectedRoom(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  page: PageScaffold,
  top: number,
  snapshot: CoopUiSnapshot,
  actions: CoopAccountPageActions,
): number {
  const room = factory.autoText(page.content, {
    testId: "coop-room-current",
    text: formatTemplate(coopConfig.texts.roomFormat, {
      room: snapshot.roomId ?? "",
      shelter: snapshot.localShelterName ?? "",
    }),
    x: 0,
    y: top,
    width: page.contentWidth,
    fontSize: uiConfig.typography.caption_size,
  });
  const presenceTop = room.y + room.height + uiConfig.layout.page.option_gap;
  const presences = factory.autoText(page.content, {
    testId: "coop-presences",
    text: [
      coopConfig.texts.presenceTitle,
      snapshot.presences.length === 0
        ? coopConfig.texts.presenceEmpty
        : snapshot.presences.map((presence) => formatTemplate(
            coopConfig.texts.presenceFormat,
            { account: presence.accountName, shelter: presence.shelterName },
          )).join("\n"),
    ].join("\n"),
    x: 0,
    y: presenceTop,
    width: page.contentWidth,
    fontSize: uiConfig.typography.caption_size,
    color: uiConfig.theme.muted_text,
  });
  const communicationTop = presences.y + presences.height + uiConfig.layout.page.option_gap;
  const communications = factory.autoText(page.content, {
    testId: "coop-communications",
    text: snapshot.communications.length === 0
      ? coopConfig.texts.communicationEmpty
      : snapshot.communications.map((entry) => formatTemplate(
          coopConfig.texts.communicationFormat,
          {
            time: formatCommunicationTime(entry.createdAt),
            sender: entry.senderName,
            shelter: entry.shelterName,
            message: entry.message,
          },
        )).join("\n"),
    x: 0,
    y: communicationTop,
    width: page.contentWidth,
    fontSize: uiConfig.typography.caption_size,
  });
  const messageInput = createTextInput(
    factory,
    uiConfig,
    page,
    "coop-message",
    coopConfig.texts.communicationLabel,
    coopConfig.defaults.communication,
    communications.y + communications.height + uiConfig.layout.page.option_gap,
    coopConfig.rules.maximum_message_characters,
    actions,
  );
  const sendTop = messageInput.y + messageInput.height + uiConfig.layout.page.option_gap;
  factory.button(page.content, {
    testId: "coop-message-send",
    label: coopConfig.texts.sendLabel,
    x: 0,
    y: sendTop,
    width: page.contentWidth,
    height: uiConfig.controls.button_height,
    tone: "primary",
    onClick: (): void => { actions.sendCommunication(messageInput.text); },
  });
  const remote = snapshot.presences.find(
    (presence) => presence.accountId !== snapshot.account?.accountId,
  );
  const tradeTop = sendTop + uiConfig.controls.button_height + uiConfig.layout.page.option_gap;
  factory.button(page.content, {
    testId: "coop-trade-demo",
    label: coopConfig.texts.tradeDemoLabel,
    x: 0,
    y: tradeTop,
    width: page.contentWidth,
    height: uiConfig.controls.button_height,
    tone: "success",
    disabled: remote === undefined,
    onClick: (): void => {
      if (remote !== undefined) actions.sendDemoTrade(remote.accountId);
    },
  });
  const tradeDescription = factory.autoText(page.content, {
    testId: "coop-trade-demo-description",
    text: coopConfig.texts.tradeDemoDescription,
    x: 0,
    y: tradeTop + uiConfig.controls.button_height + uiConfig.layout.page.option_gap,
    width: page.contentWidth,
    fontSize: uiConfig.typography.caption_size,
    color: uiConfig.theme.muted_text,
  });
  const offersTop = tradeDescription.y
    + tradeDescription.height
    + uiConfig.layout.page.option_gap;
  const leaveTop = renderTradeOffers(
    factory,
    uiConfig,
    coopConfig,
    page,
    snapshot,
    actions,
    offersTop,
  );
  factory.button(page.content, {
    testId: "coop-room-leave",
    label: coopConfig.texts.leaveRoomLabel,
    x: 0,
    y: leaveTop,
    width: page.contentWidth,
    height: uiConfig.controls.compact_button_height,
    tone: "danger",
    onClick: actions.leaveRoom,
  });
  return leaveTop + uiConfig.controls.compact_button_height;
}

/** 渲染交易提案、接受/拒绝操作与已回复结果。 */
function renderTradeOffers(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  page: PageScaffold,
  snapshot: CoopUiSnapshot,
  actions: CoopAccountPageActions,
  top: number,
): number {
  const heading = factory.autoText(page.content, {
    testId: "coop-trade-offer-title",
    text: coopConfig.texts.tradeOfferTitle,
    x: 0,
    y: top,
    width: page.contentWidth,
    fontSize: uiConfig.typography.body_size,
    color: uiConfig.theme.accent,
  });
  const relevant = snapshot.tradeOffers.filter((offer) =>
    offer.incoming || offer.senderAccountId === snapshot.account?.accountId,
  );
  let cursorY = heading.y + heading.height + uiConfig.layout.page.option_gap;
  if (relevant.length === 0) {
    const empty = factory.autoText(page.content, {
      testId: "coop-trade-offer-empty",
      text: coopConfig.texts.tradeOfferEmpty,
      x: 0,
      y: cursorY,
      width: page.contentWidth,
      fontSize: uiConfig.typography.caption_size,
      color: uiConfig.theme.muted_text,
    });
    return empty.y + empty.height + uiConfig.layout.page.option_gap;
  }
  for (const offer of relevant) {
    cursorY = renderTradeOffer(
      factory,
      uiConfig,
      coopConfig,
      page,
      snapshot,
      actions,
      offer,
      cursorY,
    );
  }
  return cursorY;
}

/** 渲染一份交易提案及其当前可用操作。 */
function renderTradeOffer(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  coopConfig: CoopDemoConfig,
  page: PageScaffold,
  snapshot: CoopUiSnapshot,
  actions: CoopAccountPageActions,
  offer: UiCoopTradeOffer,
  top: number,
): number {
  const description = factory.autoText(page.content, {
    testId: `coop-trade-offer-${offer.eventId}`,
    text: formatTemplate(coopConfig.texts.tradeOfferFormat, {
      sender: offer.senderName,
      shelter: offer.shelterName,
      offered: formatTradeBundle(coopConfig, offer.offered),
      requested: formatTradeBundle(coopConfig, offer.requested),
    }),
    x: 0,
    y: top,
    width: page.contentWidth,
    fontSize: uiConfig.typography.caption_size,
  });
  let cursorY = description.y + description.height + uiConfig.layout.page.option_gap;
  if (offer.incoming && !offer.resolved) {
    const gap = uiConfig.layout.page.option_gap;
    const buttonWidth = (page.contentWidth - gap) / 2;
    factory.button(page.content, {
      testId: `coop-trade-accept-${offer.eventId}`,
      label: coopConfig.texts.tradeAcceptLabel,
      x: 0,
      y: cursorY,
      width: buttonWidth,
      height: uiConfig.controls.compact_button_height,
      tone: "success",
      onClick: (): void => { actions.replyTradeOffer(offer.eventId, true); },
    });
    factory.button(page.content, {
      testId: `coop-trade-reject-${offer.eventId}`,
      label: coopConfig.texts.tradeRejectLabel,
      x: buttonWidth + gap,
      y: cursorY,
      width: buttonWidth,
      height: uiConfig.controls.compact_button_height,
      tone: "danger",
      onClick: (): void => { actions.replyTradeOffer(offer.eventId, false); },
    });
    cursorY += uiConfig.controls.compact_button_height + gap;
  }
  const reply = snapshot.tradeReplies.find(
    (candidate) => candidate.offerEventId === offer.eventId,
  );
  if (reply !== undefined) {
    const result = factory.autoText(page.content, {
      testId: `coop-trade-reply-${offer.eventId}`,
      text: formatTemplate(coopConfig.texts.tradeReplyFormat, {
        sender: reply.senderName,
        decision: reply.accepted
          ? coopConfig.texts.tradeAccepted
          : coopConfig.texts.tradeRejected,
        offer_id: offer.eventId,
      }),
      x: 0,
      y: cursorY,
      width: page.contentWidth,
      fontSize: uiConfig.typography.caption_size,
      color: reply.accepted ? uiConfig.theme.health : uiConfig.theme.warning,
    });
    cursorY = result.y + result.height + uiConfig.layout.page.option_gap;
  }
  return cursorY;
}

/** 将非零交易物资格式化为紧凑的中文列表。 */
function formatTradeBundle(
  coopConfig: CoopDemoConfig,
  bundle: UiCoopTradeBundle,
): string {
  const entries = [
    [bundle.food, coopConfig.texts.tradeBundleFood],
    [bundle.parts, coopConfig.texts.tradeBundleParts],
    [bundle.medicalSupplies, coopConfig.texts.tradeBundleMedical],
    [bundle.coins, coopConfig.texts.tradeBundleCoins],
  ] as const;
  const visible = entries.flatMap(([quantity, template]) => quantity > 0
    ? [formatTemplate(template, { quantity })]
    : []);
  return visible.length === 0
    ? coopConfig.texts.tradeBundleEmpty
    : visible.join("、");
}

/** 创建统一的单行文本输入并安装手机键盘策略钩子。 */
function createTextInput(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  page: PageScaffold,
  testId: string,
  prompt: string,
  value: string,
  top: number,
  maximumCharacters: number,
  actions: CoopAccountPageActions,
): LayaInputLike {
  const input = factory.input(page.content, {
    testId,
    prompt,
    x: 0,
    y: top,
    width: page.contentWidth,
    height: uiConfig.controls.button_height,
    maxChars: maximumCharacters,
    type: uiConfig.new_game_setup.name_input.html_type,
  });
  input.text = value;
  input.on("focus", input, actions.prepareTextInput);
  input.on("blur", input, actions.textInputBlurred);
  return input;
}

/** 将 ISO 时间转换为本地小时与分钟。 */
function formatCommunicationTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
