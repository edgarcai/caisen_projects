import { describe, expect, it } from "vitest";
import eventsDocument from "../../config/events.json";
import type {
  EventChoiceConfig,
  EventConfig,
  EventsConfigDocument,
} from "../../src/domain/content";

const events = eventsDocument as unknown as EventsConfigDocument;

/** 按稳定 ID 取得探索事件。 */
function requireEvent(eventId: string): EventConfig {
  const event = events.events.find((candidate) => candidate.id === eventId);
  if (event === undefined) {
    throw new Error(`测试配置缺少探索事件 ${eventId}。`);
  }
  return event;
}

/** 按稳定 ID 取得事件中的玩家选择。 */
function requireChoice(event: EventConfig, choiceId: string): EventChoiceConfig {
  const choice = event.choices?.find((candidate) => candidate.id === choiceId);
  if (choice === undefined) {
    throw new Error(`探索事件 ${event.id} 缺少选择 ${choiceId}。`);
  }
  return choice;
}

describe("旧版探索内容扩充回归", () => {
  it("保留小偷七种追踪结局并扩充主要地点结果池", () => {
    expect(requireChoice(requireEvent("thief"), "track").outcomes).toHaveLength(7);
    expect(requireEvent("bank").outcomes?.length).toBeGreaterThanOrEqual(4);
    expect(requireEvent("hospital").outcomes?.length).toBeGreaterThanOrEqual(4);
    expect(
      requireChoice(requireEvent("commercial_street"), "enter").outcomes?.length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      requireChoice(requireEvent("skyscraper"), "enter").outcomes?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(requireEvent("quiet_street").outcomes?.length).toBeGreaterThanOrEqual(5);
  });

  it("扩充结果继续使用配置化权重、文案和数值效果", () => {
    const outcomePools = [
      requireEvent("bank").outcomes ?? [],
      requireEvent("hospital").outcomes ?? [],
      requireChoice(requireEvent("commercial_street"), "enter").outcomes ?? [],
      requireChoice(requireEvent("skyscraper"), "enter").outcomes ?? [],
      requireEvent("quiet_street").outcomes ?? [],
    ];
    for (const outcomes of outcomePools) {
      for (const outcome of outcomes) {
        expect(outcome.weight ?? 1).toBeGreaterThan(0);
        expect(outcome.result.trim()).not.toBe("");
        for (const effect of outcome.effects ?? []) {
          expect(effect.target.trim()).not.toBe("");
        }
      }
    }
  });
});
