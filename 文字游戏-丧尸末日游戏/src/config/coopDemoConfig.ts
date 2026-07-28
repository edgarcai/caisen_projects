import coopDocument from "../../config/coop.json";
import type { CoopTradeBundle, CoopTradeProposal } from "../domain/coop";
import type { CoopSessionRules } from "../services/CoopSessionService";

/** 浏览器与中继服务共用的 WebSocket 配置。 */
export interface CoopTransportConfig {
  readonly websocketEnabled: boolean;
  readonly websocketPath: string;
  readonly namespace: string;
  readonly outboundQueueLimit: number;
  readonly reconnectDelayMs: number;
  readonly maximumReconnectAttempts: number;
  readonly relayUpstream: string;
  readonly relayHost: string;
  readonly relayPort: number;
  readonly relayMaximumPayloadBytes: number;
  readonly relayHeartbeatMs: number;
}

/** 联机页、传输层和本地账户的完整版本化配置。 */
export interface CoopDemoConfig {
  readonly channelPrefix: string;
  readonly accountStorageKey: string;
  readonly transport: CoopTransportConfig;
  readonly rules: CoopSessionRules;
  readonly defaults: {
    readonly roomId: string;
    readonly shelterName: string;
    readonly accountName: string;
    readonly communication: string;
    readonly tradeOffer: CoopTradeProposal;
  };
  readonly texts: {
    readonly title: string;
    readonly localDemoNotice: string;
    readonly localStatusAvailable: string;
    readonly localStatusUnavailable: string;
    readonly relayStatusDisabled: string;
    readonly relayStatusConnecting: string;
    readonly relayStatusConnected: string;
    readonly relayStatusUnavailable: string;
    readonly loggedOutWarning: string;
    readonly accountNameLabel: string;
    readonly loginLabel: string;
    readonly logoutLabel: string;
    readonly accountFormat: string;
    readonly roomLabel: string;
    readonly shelterNameLabel: string;
    readonly joinRoomLabel: string;
    readonly leaveRoomLabel: string;
    readonly roomFormat: string;
    readonly communicationLabel: string;
    readonly sendLabel: string;
    readonly communicationEmpty: string;
    readonly communicationFormat: string;
    readonly presenceTitle: string;
    readonly presenceEmpty: string;
    readonly presenceFormat: string;
    readonly tradeDemoLabel: string;
    readonly tradeDemoDescription: string;
    readonly tradeOfferTitle: string;
    readonly tradeOfferEmpty: string;
    readonly tradeOfferFormat: string;
    readonly tradeReplyFormat: string;
    readonly tradeAcceptLabel: string;
    readonly tradeRejectLabel: string;
    readonly tradeAccepted: string;
    readonly tradeRejected: string;
    readonly tradeBundleEmpty: string;
    readonly tradeBundleFood: string;
    readonly tradeBundleParts: string;
    readonly tradeBundleMedical: string;
    readonly tradeBundleCoins: string;
    readonly backLabel: string;
    readonly operationFailedTitle: string;
  };
}

type JsonObject = Record<string, unknown>;

/** 从 JSON 文档严格解析联机配置，防止错误端口或文案延迟到运行时。 */
export function parseCoopConfig(value: unknown): CoopDemoConfig {
  const root = requireObject(value, "coop");
  requireExactKeys(root, [
    "schema_version",
    "channel_prefix",
    "account_storage_key",
    "transport",
    "rules",
    "defaults",
    "texts",
  ], "coop");
  if (requireInteger(root.schema_version, "coop.schema_version", 1) !== 1) {
    throw new Error("不支持的联机配置版本。");
  }
  const transport = requireObject(root.transport, "coop.transport");
  requireExactKeys(transport, [
    "websocket_enabled",
    "websocket_path",
    "namespace",
    "outbound_queue_limit",
    "reconnect_delay_ms",
    "maximum_reconnect_attempts",
    "relay_upstream",
    "relay_host",
    "relay_port",
    "relay_max_payload_bytes",
    "relay_heartbeat_ms",
  ], "coop.transport");
  const rules = requireObject(root.rules, "coop.rules");
  requireExactKeys(rules, [
    "maximum_name_characters",
    "maximum_room_characters",
    "maximum_message_characters",
    "maximum_events",
    "trade_offer_ttl_ms",
  ], "coop.rules");
  const defaults = requireObject(root.defaults, "coop.defaults");
  requireExactKeys(defaults, [
    "room_id",
    "shelter_name",
    "account_name",
    "communication",
    "trade_offer",
  ], "coop.defaults");
  const texts = requireObject(root.texts, "coop.texts");
  const parsedTexts = parseTexts(texts);
  const websocketPath = requireString(transport.websocket_path, "coop.transport.websocket_path");
  if (!websocketPath.startsWith("/")) {
    throw new Error("coop.transport.websocket_path 必须以 / 开头。");
  }
  return {
    channelPrefix: requireString(root.channel_prefix, "coop.channel_prefix"),
    accountStorageKey: requireString(root.account_storage_key, "coop.account_storage_key"),
    transport: {
      websocketEnabled: requireBoolean(
        transport.websocket_enabled,
        "coop.transport.websocket_enabled",
      ),
      websocketPath,
      namespace: requireString(transport.namespace, "coop.transport.namespace"),
      outboundQueueLimit: requireInteger(
        transport.outbound_queue_limit,
        "coop.transport.outbound_queue_limit",
        1,
      ),
      reconnectDelayMs: requireInteger(
        transport.reconnect_delay_ms,
        "coop.transport.reconnect_delay_ms",
        0,
      ),
      maximumReconnectAttempts: requireInteger(
        transport.maximum_reconnect_attempts,
        "coop.transport.maximum_reconnect_attempts",
        0,
      ),
      relayUpstream: requireString(transport.relay_upstream, "coop.transport.relay_upstream"),
      relayHost: requireString(transport.relay_host, "coop.transport.relay_host"),
      relayPort: requireInteger(transport.relay_port, "coop.transport.relay_port", 1),
      relayMaximumPayloadBytes: requireInteger(
        transport.relay_max_payload_bytes,
        "coop.transport.relay_max_payload_bytes",
        1024,
      ),
      relayHeartbeatMs: requireInteger(
        transport.relay_heartbeat_ms,
        "coop.transport.relay_heartbeat_ms",
        1000,
      ),
    },
    rules: {
      maximum_name_characters: requireInteger(
        rules.maximum_name_characters,
        "coop.rules.maximum_name_characters",
        1,
      ),
      maximum_room_characters: requireInteger(
        rules.maximum_room_characters,
        "coop.rules.maximum_room_characters",
        1,
      ),
      maximum_message_characters: requireInteger(
        rules.maximum_message_characters,
        "coop.rules.maximum_message_characters",
        1,
      ),
      maximum_events: requireInteger(rules.maximum_events, "coop.rules.maximum_events", 1),
      trade_offer_ttl_ms: requireInteger(
        rules.trade_offer_ttl_ms,
        "coop.rules.trade_offer_ttl_ms",
        1,
      ),
    },
    defaults: {
      roomId: requireString(defaults.room_id, "coop.defaults.room_id"),
      shelterName: requireString(defaults.shelter_name, "coop.defaults.shelter_name"),
      accountName: requireString(defaults.account_name, "coop.defaults.account_name"),
      communication: requireString(defaults.communication, "coop.defaults.communication"),
      tradeOffer: parseTradeProposal(defaults.trade_offer, "coop.defaults.trade_offer"),
    },
    texts: parsedTexts,
  };
}

/** 从 JSON 读取完整交易提案，并拒绝双方均为空的配置。 */
function parseTradeProposal(value: unknown, path: string): CoopTradeProposal {
  const source = requireObject(value, path);
  requireExactKeys(source, ["offered", "requested"], path);
  const offered = parseTradeBundle(source.offered, `${path}.offered`);
  const requested = parseTradeBundle(source.requested, `${path}.requested`);
  const total = tradeBundleTotal(offered) + tradeBundleTotal(requested);
  if (total === 0) throw new Error(`${path} 不能为空提案。`);
  return { offered, requested };
}

/** 以显式字段计算交易物资总量，保持配置解析类型安全。 */
function tradeBundleTotal(bundle: CoopTradeBundle): number {
  return bundle.food + bundle.parts + bundle.medicalSupplies + bundle.coins;
}

/** 从 JSON 读取字段完整的非负整数交易物资。 */
function parseTradeBundle(value: unknown, path: string): CoopTradeBundle {
  const source = requireObject(value, path);
  requireExactKeys(source, ["food", "parts", "medical_supplies", "coins"], path);
  return {
    food: requireInteger(source.food, `${path}.food`, 0),
    parts: requireInteger(source.parts, `${path}.parts`, 0),
    medicalSupplies: requireInteger(
      source.medical_supplies,
      `${path}.medical_supplies`,
      0,
    ),
    coins: requireInteger(source.coins, `${path}.coins`, 0),
  };
}

/** 使用稳定映射将 JSON snake_case 文案转为展示层 camelCase 字段。 */
function parseTexts(source: JsonObject): CoopDemoConfig["texts"] {
  const keys = [
    "title", "connection_notice", "local_status_available", "local_status_unavailable",
    "relay_status_disabled", "relay_status_connecting", "relay_status_connected",
    "relay_status_unavailable", "logged_out_warning", "account_name_label",
    "login_label", "logout_label", "account_format", "room_label",
    "shelter_name_label", "join_room_label", "leave_room_label", "room_format",
    "communication_label", "send_label", "communication_empty", "communication_format",
    "presence_title", "presence_empty", "presence_format", "trade_demo_label",
    "trade_demo_description", "trade_offer_title", "trade_offer_empty", "trade_offer_format",
    "trade_reply_format", "trade_accept_label", "trade_reject_label", "trade_accepted",
    "trade_rejected", "trade_bundle_empty", "trade_bundle_food", "trade_bundle_parts",
    "trade_bundle_medical", "trade_bundle_coins", "back_label", "operation_failed_title",
  ] as const;
  requireExactKeys(source, keys, "coop.texts");
  const text = (key: typeof keys[number]): string =>
    requireString(source[key], `coop.texts.${key}`);
  return {
    title: text("title"),
    localDemoNotice: text("connection_notice"),
    localStatusAvailable: text("local_status_available"),
    localStatusUnavailable: text("local_status_unavailable"),
    relayStatusDisabled: text("relay_status_disabled"),
    relayStatusConnecting: text("relay_status_connecting"),
    relayStatusConnected: text("relay_status_connected"),
    relayStatusUnavailable: text("relay_status_unavailable"),
    loggedOutWarning: text("logged_out_warning"),
    accountNameLabel: text("account_name_label"),
    loginLabel: text("login_label"),
    logoutLabel: text("logout_label"),
    accountFormat: text("account_format"),
    roomLabel: text("room_label"),
    shelterNameLabel: text("shelter_name_label"),
    joinRoomLabel: text("join_room_label"),
    leaveRoomLabel: text("leave_room_label"),
    roomFormat: text("room_format"),
    communicationLabel: text("communication_label"),
    sendLabel: text("send_label"),
    communicationEmpty: text("communication_empty"),
    communicationFormat: text("communication_format"),
    presenceTitle: text("presence_title"),
    presenceEmpty: text("presence_empty"),
    presenceFormat: text("presence_format"),
    tradeDemoLabel: text("trade_demo_label"),
    tradeDemoDescription: text("trade_demo_description"),
    tradeOfferTitle: text("trade_offer_title"),
    tradeOfferEmpty: text("trade_offer_empty"),
    tradeOfferFormat: text("trade_offer_format"),
    tradeReplyFormat: text("trade_reply_format"),
    tradeAcceptLabel: text("trade_accept_label"),
    tradeRejectLabel: text("trade_reject_label"),
    tradeAccepted: text("trade_accepted"),
    tradeRejected: text("trade_rejected"),
    tradeBundleEmpty: text("trade_bundle_empty"),
    tradeBundleFood: text("trade_bundle_food"),
    tradeBundleParts: text("trade_bundle_parts"),
    tradeBundleMedical: text("trade_bundle_medical"),
    tradeBundleCoins: text("trade_bundle_coins"),
    backLabel: text("back_label"),
    operationFailedTitle: text("operation_failed_title"),
  };
}

/** 要求未知值为非数组 JSON 对象。 */
function requireObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象。`);
  }
  return value as JsonObject;
}

/** 要求对象字段与期望集合完全一致。 */
function requireExactKeys(source: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(source).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${path} 字段集合不匹配。`);
  }
}

/** 要求未知值为非空字符串。 */
function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} 必须是非空字符串。`);
  }
  return value;
}

/** 要求未知值为不小于下限的整数。 */
function requireInteger(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${path} 必须是不小于 ${String(minimum)} 的整数。`);
  }
  return value;
}

/** 要求未知值为布尔值。 */
function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} 必须是布尔值。`);
  return value;
}

/** 应用启动时使用的已验证联机配置。 */
export const coopDemoConfig: CoopDemoConfig = parseCoopConfig(coopDocument);
