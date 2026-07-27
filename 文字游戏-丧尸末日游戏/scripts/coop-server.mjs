import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { clearInterval, setInterval } from "node:timers";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const configPath = resolve(import.meta.dirname, "../config/coop.json");
const document = JSON.parse(await readFile(configPath, "utf8"));
const config = document.transport;
const rules = document.rules;
const roomMaximumCharacters = rules.maximum_room_characters;
const rooms = new Map();
const sessions = new WeakMap();
const aliveSockets = new WeakMap();

const server = new WebSocketServer({
  host: process.env.SHELTER_COOP_HOST ?? config.relay_host,
  port: integerEnvironment("SHELTER_COOP_PORT", config.relay_port),
  path: config.websocket_path,
  maxPayload: config.relay_max_payload_bytes,
});

/** 读取可选环境整数，无效值在启动时立即拒绝。 */
function integerEnvironment(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数。`);
  }
  return parsed;
}

/** 解析并校验连接 URL 中的命名空间与房间号。 */
function parseRoom(request) {
  const url = new URL(request.url ?? "", "http://relay.local");
  const namespace = url.searchParams.get("namespace")?.trim() ?? "";
  const roomId = url.searchParams.get("room")?.trim() ?? "";
  if (
    namespace !== config.namespace
    || roomId === ""
    || Array.from(roomId).length > roomMaximumCharacters
  ) {
    return null;
  }
  return { roomKey: `${namespace}:${roomId}`, roomId };
}

/** 获取或创建一个拥有成员、提案和去重集合的房间。 */
function requireRoom(roomKey) {
  const existing = rooms.get(roomKey);
  if (existing !== undefined) return existing;
  const created = {
    clients: new Set(),
    presences: new Map(),
    offers: new Map(),
    eventIds: new Set(),
  };
  rooms.set(roomKey, created);
  return created;
}

/** 在配置上限内保留最新事件 ID，避免长时间房间无界增长。 */
function rememberEventId(room, eventId) {
  room.eventIds.add(eventId);
  while (room.eventIds.size > rules.maximum_events) {
    const oldest = room.eventIds.values().next().value;
    if (oldest === undefined) break;
    room.eventIds.delete(oldest);
  }
}

/** 删除已超过配置生存期的未处理交易提案。 */
function pruneExpiredOffers(room, now = Date.now()) {
  for (const [eventId, offer] of room.offers) {
    if (offer.expiresAt <= now) room.offers.delete(eventId);
  }
}

/** 保存带服务端到期时间的提案，并限制单房间提案数量。 */
function rememberOffer(room, event) {
  room.offers.set(event.eventId, {
    event: globalThis.structuredClone(event),
    expiresAt: Date.now() + rules.trade_offer_ttl_ms,
  });
  while (room.offers.size > rules.maximum_events) {
    const oldest = room.offers.keys().next().value;
    if (oldest === undefined) break;
    room.offers.delete(oldest);
  }
}

/** 要求未知值为非数组对象。 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断未知值是否为非空字符串。 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** 判断未知值是否为非负整数。 */
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** 校验跨设备事件的发送者身份。 */
function validSender(value) {
  return isRecord(value)
    && isNonEmptyString(value.accountId)
    && isNonEmptyString(value.displayName)
    && isNonEmptyString(value.shelterName)
    && Array.from(value.displayName).length <= rules.maximum_name_characters
    && Array.from(value.shelterName).length <= rules.maximum_name_characters;
}

/** 比较事件发送者是否与连接首个 presence 绑定身份完全一致。 */
function samePresence(left, right) {
  return left.accountId === right.accountId
    && left.displayName === right.displayName
    && left.shelterName === right.shelterName;
}

/** 校验一份交易物资的完整字段集合与数量。 */
function validBundle(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = ["coins", "food", "medicalSupplies", "parts"];
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index])
    && expected.every((key) => isNonNegativeInteger(value[key]));
}

/** 计算交易物资总数，用于拒绝空提案。 */
function bundleTotal(value) {
  return value.food + value.parts + value.medicalSupplies + value.coins;
}

/** 完整校验一条客户端事件，并绑定当前连接的房间。 */
function validEvent(value, roomId) {
  if (
    !isRecord(value)
    || !["presence", "presence_leave", "communication", "trade_offer", "trade_reply"]
      .includes(value.type)
    || !isNonEmptyString(value.eventId)
    || value.roomId !== roomId
    || !isNonEmptyString(value.createdAt)
    || Number.isNaN(Date.parse(value.createdAt))
    || !validSender(value.sender)
  ) return false;
  if (value.type === "communication") {
    return isNonEmptyString(value.message)
      && Array.from(value.message).length <= rules.maximum_message_characters;
  }
  if (value.type === "trade_offer") {
    return isNonEmptyString(value.targetAccountId)
      && validBundle(value.offered)
      && validBundle(value.requested)
      && bundleTotal(value.offered) + bundleTotal(value.requested) > 0;
  }
  if (value.type === "trade_reply") {
    return isNonEmptyString(value.offerEventId) && typeof value.accepted === "boolean";
  }
  return true;
}

/** 将已校验事件转发给房间内所有活跃连接。 */
function broadcast(room, serialized) {
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(serialized);
  }
}

/** 使用新事件 ID 向刚完成身份绑定的客户端回放当前成员。 */
function sendRoster(socket, room, ownAccountId, roomId) {
  for (const entry of room.presences.values()) {
    if (entry.presence.accountId === ownAccountId) continue;
    socket.send(JSON.stringify({
      type: "presence",
      eventId: `relay-roster-${randomUUID()}`,
      roomId,
      createdAt: new Date().toISOString(),
      sender: entry.presence,
    }));
  }
}

/** 将首个 presence 绑定为套接字唯一身份，并同步房间成员。 */
function bindPresence(socket, session, room, event) {
  const existing = room.presences.get(event.sender.accountId);
  if (existing !== undefined && existing.socket !== socket) {
    socket.close(4003, "account already active");
    return;
  }
  room.presences.set(event.sender.accountId, {
    socket,
    presence: globalThis.structuredClone(event.sender),
  });
  session.presence = globalThis.structuredClone(event.sender);
  rememberEventId(room, event.eventId);
  sendRoster(socket, room, event.sender.accountId, session.roomId);
  broadcast(room, JSON.stringify(event));
}

/** 验证身份、成员和提案引用后处理一条房间事件。 */
function handleRoomEvent(socket, session, room, event) {
  pruneExpiredOffers(room);
  if (session.presence === null) {
    if (event.type === "presence") bindPresence(socket, session, room, event);
    return;
  }
  if (room.eventIds.has(event.eventId)) return;
  if (!samePresence(event.sender, session.presence)) return;
  if (room.presences.get(session.presence.accountId)?.socket !== socket) {
    socket.close(4003, "account no longer active");
    return;
  }
  if (event.type === "presence") {
    rememberEventId(room, event.eventId);
    room.presences.set(session.presence.accountId, {
      socket,
      presence: globalThis.structuredClone(session.presence),
    });
    broadcast(room, JSON.stringify(event));
    return;
  }
  if (event.type === "presence_leave") {
    rememberEventId(room, event.eventId);
    room.presences.delete(session.presence.accountId);
    session.presence = null;
    broadcast(room, JSON.stringify(event));
    return;
  }
  if (event.type === "trade_offer") {
    if (
      event.targetAccountId === session.presence.accountId
      || !room.presences.has(event.targetAccountId)
    ) return;
    rememberOffer(room, event);
  }
  if (event.type === "trade_reply") {
    const offer = room.offers.get(event.offerEventId);
    if (
      offer === undefined
      || offer.event.targetAccountId !== session.presence.accountId
    ) return;
    room.offers.delete(event.offerEventId);
  }
  rememberEventId(room, event.eventId);
  broadcast(room, JSON.stringify(event));
}

/** 在套接字断开时清理成员，并向房间发布服务端离线事件。 */
function removeConnection(socket) {
  const session = sessions.get(socket);
  if (session === undefined) return;
  const room = rooms.get(session.roomKey);
  if (room === undefined) return;
  room.clients.delete(socket);
  const presence = session.presence;
  const current = presence === null ? undefined : room.presences.get(presence.accountId);
  if (presence !== null && current?.socket === socket) {
    room.presences.delete(presence.accountId);
    broadcast(room, JSON.stringify({
      type: "presence_leave",
      eventId: `relay-leave-${randomUUID()}`,
      roomId: session.roomId,
      createdAt: new Date().toISOString(),
      sender: presence,
    }));
  }
  if (room.clients.size === 0) rooms.delete(session.roomKey);
}

server.on("connection", (socket, request) => {
  const parsedRoom = parseRoom(request);
  if (parsedRoom === null) {
    socket.close(1008, "invalid room");
    return;
  }
  const room = requireRoom(parsedRoom.roomKey);
  room.clients.add(socket);
  sessions.set(socket, { ...parsedRoom, presence: null });
  aliveSockets.set(socket, true);
  socket.on("pong", () => { aliveSockets.set(socket, true); });
  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    const session = sessions.get(socket);
    if (session === undefined || !validEvent(event, session.roomId)) return;
    handleRoomEvent(socket, session, room, event);
  });
  socket.on("close", () => { removeConnection(socket); });
});

const heartbeat = setInterval(() => {
  for (const room of rooms.values()) {
    pruneExpiredOffers(room);
    for (const socket of room.clients) {
      if (aliveSockets.get(socket) === false) {
        socket.terminate();
        continue;
      }
      aliveSockets.set(socket, false);
      socket.ping();
    }
  }
}, config.relay_heartbeat_ms);

/** 停止心跳并优雅关闭中继服务。 */
function shutdown() {
  clearInterval(heartbeat);
  for (const room of rooms.values()) {
    for (const socket of room.clients) socket.close(1001, "server shutdown");
  }
  server.close(() => { process.exit(0); });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.once("listening", () => {
  const address = server.address();
  const display = typeof address === "string"
    ? address
    : `${address?.address ?? config.relay_host}:${String(address?.port ?? config.relay_port)}`;
  process.stdout.write(`《避难所·往昔》联机中继已启动：${display}${config.websocket_path}\n`);
});
