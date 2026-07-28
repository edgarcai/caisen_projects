import { spawn, type ChildProcess } from "node:child_process";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";
import coopDocument from "../../config/coop.json";

/** 向操作系统申请一个短暂占用的本地随机端口。 */
async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("无法获取测试端口。");
  }
  const port = address.port;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose();
      else rejectClose(error);
    });
  });
  return port;
}

/** 等待子进程输出启动标志，并在超时或提前退出时拒绝。 */
function waitForReady(child: ChildProcess, marker: string): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error("联机中继启动超时。"));
    }, 5000);
    const handleData = (chunk: Buffer): void => {
      if (!chunk.toString().includes(marker)) return;
      clearTimeout(timeout);
      child.stdout?.off("data", handleData);
      resolveReady();
    };
    child.stdout?.on("data", handleData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`联机中继提前退出：${String(code)}`));
    });
  });
}

/** 创建客户端并等待 WebSocket 握手完成。 */
function connectClient(url: string): Promise<WebSocket> {
  return new Promise((resolveClient, rejectClient) => {
    const socket = new WebSocket(url);
    socket.once("open", (): void => { resolveClient(socket); });
    socket.once("error", rejectClient);
  });
}

/** 等待中继主动关闭连接并返回协议关闭码。 */
function receiveCloseCode(socket: WebSocket): Promise<number> {
  return new Promise((resolveClose, rejectClose) => {
    const timeout = setTimeout(() => {
      socket.off("close", handleClose);
      rejectClose(new Error("等待中继关闭连接超时。"));
    }, 3000);
    const handleClose = (code: number): void => {
      clearTimeout(timeout);
      resolveClose(code);
    };
    socket.once("close", handleClose);
  });
}

/** 等待客户端收到一条匹配条件的 JSON 事件。 */
function receiveMatching(
  socket: WebSocket,
  predicate: (value: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolveMessage, rejectMessage) => {
    const timeout = setTimeout(() => {
      socket.off("message", handleMessage);
      rejectMessage(new Error("跨设备房间转发超时。"));
    }, 3000);
    const handleMessage = (data: RawData): void => {
      const value = JSON.parse(rawDataText(data)) as unknown;
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off("message", handleMessage);
      resolveMessage(value);
    };
    socket.on("message", handleMessage);
  });
}

/** 在短时间窗内确认客户端没有收到一条被服务器拒绝的事件。 */
function expectNoMatching(
  socket: WebSocket,
  predicate: (value: unknown) => boolean,
): Promise<void> {
  return new Promise((resolveAbsent, rejectUnexpected) => {
    const handleMessage = (data: RawData): void => {
      const value = JSON.parse(rawDataText(data)) as unknown;
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off("message", handleMessage);
      rejectUnexpected(new Error("收到了应被中继拒绝的事件。"));
    };
    const timeout = setTimeout(() => {
      socket.off("message", handleMessage);
      resolveAbsent();
    }, 180);
    socket.on("message", handleMessage);
  });
}

/** 将 ws 的 Buffer、ArrayBuffer 或 Buffer[] 统一解码为 UTF-8 文本。 */
function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return data.toString("utf8");
}

/** 按类型、事件 ID 或发送者账户判断未知房间事件。 */
function matchesEvent(
  value: unknown,
  expected: { readonly type?: string; readonly eventId?: string; readonly accountId?: string },
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const sender = event.sender;
  const senderAccountId = typeof sender === "object" && sender !== null && !Array.isArray(sender)
    ? (sender as Record<string, unknown>).accountId
    : undefined;
  return (expected.type === undefined || event.type === expected.type)
    && (expected.eventId === undefined || event.eventId === expected.eventId)
    && (expected.accountId === undefined || senderAccountId === expected.accountId);
}

/** 构造一条绑定套接字身份的 presence 事件。 */
function presenceEvent(
  eventId: string,
  accountId: string,
  displayName: string,
  shelterName: string,
  roomId = "MOBILE-QA",
): Record<string, unknown> {
  return {
    type: "presence",
    eventId,
    roomId,
    createdAt: "2166-01-01T00:00:00.000Z",
    sender: { accountId, displayName, shelterName },
  };
}

describe("WebSocket 联机中继服务", () => {
  it("在两个独立客户端之间转发同房间通讯", async () => {
    const port = await reservePort();
    const entry = resolve(process.cwd(), "scripts/coop-server.mjs");
    const child = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: { ...process.env, SHELTER_COOP_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let first: WebSocket | null = null;
    let second: WebSocket | null = null;
    let third: WebSocket | null = null;
    let duplicate: WebSocket | null = null;
    let replay: WebSocket | null = null;
    let isolated: WebSocket | null = null;
    try {
      await waitForReady(child, "联机中继已启动");
      const url = `ws://127.0.0.1:${String(port)}/coop?namespace=shelter-past-v1&room=MOBILE-QA`;
      [first, second] = await Promise.all([connectClient(url), connectClient(url)]);
      const firstPresence = presenceEvent("presence-first", "account-first", "电脑所长", "北门避难所");
      const secondPresence = presenceEvent("presence-second", "account-second", "手机所长", "移动避难所");
      const firstEcho = receiveMatching(first, (value) => matchesEvent(value, {
        eventId: "presence-first",
      }));
      first.send(JSON.stringify(firstPresence));
      await firstEcho;
      const secondEcho = receiveMatching(second, (value) => matchesEvent(value, {
        eventId: "presence-second",
      }));
      const secondSeenByFirst = receiveMatching(first, (value) => matchesEvent(value, {
        eventId: "presence-second",
      }));
      second.send(JSON.stringify(secondPresence));
      await Promise.all([secondEcho, secondSeenByFirst]);

      duplicate = await connectClient(url);
      const duplicateRejected = receiveCloseCode(duplicate);
      duplicate.send(JSON.stringify(presenceEvent(
        "presence-duplicate",
        "account-first",
        "冒名所长",
        "伪造避难所",
      )));
      await expect(duplicateRejected).resolves.toBe(4003);
      duplicate = null;

      replay = await connectClient(url);
      const replayPresence = presenceEvent(
        "presence-replay",
        "account-replay",
        "重连所长",
        "重连避难所",
      );
      const firstReplayEcho = receiveMatching(replay, (value) => matchesEvent(value, {
        eventId: "presence-replay",
      }));
      replay.send(JSON.stringify(replayPresence));
      await firstReplayEcho;
      const replayLeave = receiveMatching(first, (value) => matchesEvent(value, {
        type: "presence_leave",
        accountId: "account-replay",
      }));
      replay.close();
      await replayLeave;
      replay = await connectClient(url);
      const secondReplayEcho = receiveMatching(replay, (value) => matchesEvent(value, {
        eventId: "presence-replay",
      }));
      replay.send(JSON.stringify(replayPresence));
      await expect(secondReplayEcho).resolves.toEqual(replayPresence);
      replay.close();
      replay = null;

      const isolatedUrl = `ws://127.0.0.1:${String(port)}/coop?namespace=shelter-past-v1&room=ISOLATED-QA`;
      isolated = await connectClient(isolatedUrl);
      const isolatedPresence = presenceEvent(
        "presence-isolated",
        "account-isolated",
        "隔离所长",
        "隔离避难所",
        "ISOLATED-QA",
      );
      const isolatedEcho = receiveMatching(isolated, (value) => matchesEvent(value, {
        eventId: "presence-isolated",
      }));
      isolated.send(JSON.stringify(isolatedPresence));
      await isolatedEcho;

      const event = {
        type: "communication",
        eventId: "cross-device-test",
        roomId: "MOBILE-QA",
        createdAt: "2166-01-01T00:00:00.000Z",
        sender: {
          accountId: "account-first",
          displayName: "电脑所长",
          shelterName: "北门避难所",
        },
        message: "电脑端已收到手机通讯。",
      };
      const received = receiveMatching(second, (value) => matchesEvent(value, {
        eventId: "cross-device-test",
      }));
      const isolatedRoomRejected = expectNoMatching(isolated, (value) => matchesEvent(value, {
        eventId: "cross-device-test",
      }));
      first.send(JSON.stringify(event));
      await Promise.all([
        expect(received).resolves.toEqual(event),
        isolatedRoomRejected,
      ]);

      const spoof = {
        ...event,
        eventId: "spoofed-sender",
        sender: secondPresence.sender,
      };
      const spoofRejected = expectNoMatching(second, (value) => matchesEvent(value, {
        eventId: "spoofed-sender",
      }));
      first.send(JSON.stringify(spoof));
      await spoofRejected;

      third = await connectClient(url);
      const rosterFirst = receiveMatching(third, (value) => matchesEvent(value, {
        type: "presence",
        accountId: "account-first",
      }));
      const rosterSecond = receiveMatching(third, (value) => matchesEvent(value, {
        type: "presence",
        accountId: "account-second",
      }));
      const thirdPresence = presenceEvent("presence-third", "account-third", "外勤所长", "河岸避难所");
      third.send(JSON.stringify(thirdPresence));
      await Promise.all([rosterFirst, rosterSecond]);

      const offer = {
        type: "trade_offer",
        eventId: "offer-first-second",
        roomId: "MOBILE-QA",
        createdAt: "2166-01-01T00:01:00.000Z",
        sender: firstPresence.sender,
        targetAccountId: "account-second",
        offered: { food: 1, parts: 0, medicalSupplies: 0, coins: 0 },
        requested: { food: 0, parts: 1, medicalSupplies: 0, coins: 0 },
      };
      const offerReceived = receiveMatching(second, (value) => matchesEvent(value, {
        eventId: "offer-first-second",
      }));
      first.send(JSON.stringify(offer));
      await offerReceived;

      const invalidReply = {
        type: "trade_reply",
        eventId: "reply-wrong-target",
        roomId: "MOBILE-QA",
        createdAt: "2166-01-01T00:02:00.000Z",
        sender: thirdPresence.sender,
        offerEventId: "offer-first-second",
        accepted: true,
      };
      const wrongReplyRejected = expectNoMatching(first, (value) => matchesEvent(value, {
        eventId: "reply-wrong-target",
      }));
      third.send(JSON.stringify(invalidReply));
      await wrongReplyRejected;

      const acceptedReply = {
        ...invalidReply,
        eventId: "reply-correct-target",
        sender: secondPresence.sender,
      };
      const replyReceived = receiveMatching(first, (value) => matchesEvent(value, {
        eventId: "reply-correct-target",
      }));
      second.send(JSON.stringify(acceptedReply));
      await expect(replyReceived).resolves.toEqual(acceptedReply);

      const boundedOffers = Array.from(
        { length: coopDocument.rules.maximum_events + 1 },
        (_, index) => ({
          ...offer,
          eventId: `bounded-offer-${String(index)}`,
          createdAt: new Date(Date.UTC(2166, 0, 1, 0, 3, index)).toISOString(),
        }),
      );
      const latestBoundedOffer = boundedOffers.at(-1);
      if (latestBoundedOffer === undefined) throw new Error("测试要求生成有界提案。");
      const latestOfferReceived = receiveMatching(second, (value) => matchesEvent(value, {
        eventId: latestBoundedOffer.eventId,
      }));
      for (const boundedOffer of boundedOffers) first.send(JSON.stringify(boundedOffer));
      await latestOfferReceived;

      const evictedReply = {
        ...acceptedReply,
        eventId: "reply-evicted-offer",
        offerEventId: boundedOffers[0]?.eventId,
      };
      const evictedReplyRejected = expectNoMatching(first, (value) => matchesEvent(value, {
        eventId: "reply-evicted-offer",
      }));
      second.send(JSON.stringify(evictedReply));
      await evictedReplyRejected;

      const latestReply = {
        ...acceptedReply,
        eventId: "reply-latest-offer",
        offerEventId: latestBoundedOffer.eventId,
      };
      const latestReplyReceived = receiveMatching(first, (value) => matchesEvent(value, {
        eventId: "reply-latest-offer",
      }));
      second.send(JSON.stringify(latestReply));
      await expect(latestReplyReceived).resolves.toEqual(latestReply);

      const leaveReceived = receiveMatching(first, (value) => matchesEvent(value, {
        type: "presence_leave",
        accountId: "account-second",
      }));
      second.close();
      second = null;
      await leaveReceived;
    } finally {
      first?.close();
      second?.close();
      third?.close();
      duplicate?.close();
      replay?.close();
      isolated?.close();
      child.kill("SIGTERM");
      if (child.exitCode === null) await once(child, "exit");
    }
  }, 10000);
});
