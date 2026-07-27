import { describe, expect, it } from "vitest";
import eventsDocument from "../../config/events.json";
import type {
  EventsConfigDocument,
  NumericEffectConfig,
} from "../../src/domain/content";

interface WeightedEffectSource {
  readonly sourceId: string;
  readonly weight: number;
  readonly effect: NumericEffectConfig;
}

interface TargetBalanceSummary {
  readonly maximumAmount: number;
  readonly sourceCount: number;
  readonly weightedSourceCount: number;
}

interface ScarceResourceGate {
  readonly maximumAmount: number;
  readonly maximumSources: number;
  readonly maximumWeightedSources: number;
}

interface ArchiveResourceGate {
  readonly maximumAmount: number;
  readonly minimumSources: number;
  readonly minimumWeightedSources: number;
}

const events = eventsDocument as unknown as EventsConfigDocument;

const SCARCE_RESOURCE_GATES: Readonly<Record<string, ScarceResourceGate>> = {
  "player.coins": {
    maximumAmount: 24,
    maximumSources: 6,
    maximumWeightedSources: 7,
  },
  "player.parts": {
    maximumAmount: 10,
    maximumSources: 7,
    maximumWeightedSources: 12,
  },
  "player.medical_supplies": {
    maximumAmount: 10,
    maximumSources: 6,
    maximumWeightedSources: 6,
  },
  "player.food": {
    maximumAmount: 10,
    maximumSources: 3,
    maximumWeightedSources: 5,
  },
};

const ARCHIVE_RESOURCE_GATES: Readonly<Record<string, ArchiveResourceGate>> = {
  "shelter.newspapers": {
    maximumAmount: 10,
    minimumSources: 6,
    minimumWeightedSources: 22,
  },
  "shelter.books": {
    maximumAmount: 10,
    minimumSources: 2,
    minimumWeightedSources: 10,
  },
  "shelter.magazines": {
    maximumAmount: 8,
    minimumSources: 4,
    minimumWeightedSources: 15,
  },
};

/** 把一组配置效果追加为带稳定来源与权重的静态样本。 */
function appendEffects(
  target: WeightedEffectSource[],
  sourceId: string,
  weight: number,
  effects: readonly NumericEffectConfig[] | undefined,
): void {
  for (const effect of effects ?? []) {
    target.push({ sourceId, weight, effect });
  }
}

/** 展开事件、选择与随机结果中的全部数值效果来源。 */
function collectEffectSources(
  document: EventsConfigDocument,
): readonly WeightedEffectSource[] {
  const sources: WeightedEffectSource[] = [];
  for (const event of document.events) {
    appendEffects(sources, `${event.id}:pre`, 1, event.pre_effects);
    appendEffects(sources, `${event.id}:root`, 1, event.effects);
    event.outcomes?.forEach((outcome, outcomeIndex) => {
      appendEffects(
        sources,
        `${event.id}:outcome:${String(outcomeIndex)}`,
        outcome.weight ?? 1,
        outcome.effects,
      );
    });
    event.choices?.forEach((choice) => {
      appendEffects(sources, `${event.id}:${choice.id}`, 1, choice.effects);
      choice.outcomes?.forEach((outcome, outcomeIndex) => {
        appendEffects(
          sources,
          `${event.id}:${choice.id}:outcome:${String(outcomeIndex)}`,
          outcome.weight ?? 1,
          outcome.effects,
        );
      });
    });
  }
  return sources;
}

/** 返回固定值或闭区间效果的最大可能值。 */
function maximumAmount(effect: NumericEffectConfig): number {
  return typeof effect.amount === "number"
    ? effect.amount
    : effect.amount[1];
}

/** 汇总指定正向目标的最大值、独立来源数与权重来源数。 */
function summarizePositiveTarget(
  sources: readonly WeightedEffectSource[],
  stateTarget: string,
): TargetBalanceSummary {
  const matching = sources.filter((source) =>
    source.effect.operation === "add" && source.effect.target === stateTarget,
  );
  const weightBySource = new Map<string, number>();
  for (const source of matching) {
    weightBySource.set(
      source.sourceId,
      Math.max(weightBySource.get(source.sourceId) ?? 0, source.weight),
    );
  }
  return {
    maximumAmount: Math.max(...matching.map((source) => maximumAmount(source.effect))),
    sourceCount: weightBySource.size,
    weightedSourceCount: [...weightBySource.values()].reduce(
      (sum, weight) => sum + weight,
      0,
    ),
  };
}

/** 把损失效果转换为可在回归门禁中比较的稳定签名。 */
function lossSignature(source: WeightedEffectSource): string {
  return [
    source.sourceId,
    source.effect.target,
    JSON.stringify(source.effect.amount),
  ].join("|");
}

describe("探索掉落平衡静态门禁", () => {
  const sources = collectEffectSources(events);

  it("限制金币、零件、药品与食物的单次上限和来源数", () => {
    for (const [stateTarget, gate] of Object.entries(SCARCE_RESOURCE_GATES)) {
      const summary = summarizePositiveTarget(sources, stateTarget);
      expect(summary.maximumAmount, `${stateTarget} 单次上限`)
        .toBeLessThanOrEqual(gate.maximumAmount);
      expect(summary.sourceCount, `${stateTarget} 正向来源数`)
        .toBeLessThanOrEqual(gate.maximumSources);
      expect(summary.weightedSourceCount, `${stateTarget} 权重来源数`)
        .toBeLessThanOrEqual(gate.maximumWeightedSources);
    }
  });

  it("保证报纸、书籍和杂志拥有足够来源权重与合理数量", () => {
    for (const [stateTarget, gate] of Object.entries(ARCHIVE_RESOURCE_GATES)) {
      const summary = summarizePositiveTarget(sources, stateTarget);
      expect(summary.maximumAmount, `${stateTarget} 单次上限`)
        .toBeLessThanOrEqual(gate.maximumAmount);
      expect(summary.sourceCount, `${stateTarget} 独立来源数`)
        .toBeGreaterThanOrEqual(gate.minimumSources);
      expect(summary.weightedSourceCount, `${stateTarget} 权重来源数`)
        .toBeGreaterThanOrEqual(gate.minimumWeightedSources);
    }
  });

  it("保留原有主要损失事件的目标与数值区间", () => {
    const lossSignatures = sources
      .filter((source) => source.effect.operation === "subtract")
      .map(lossSignature);
    expect(lossSignatures).toHaveLength(23);
    expect(lossSignatures).toEqual(expect.arrayContaining([
      "bank:outcome:3|player.coins|[5,25]",
      "thief:pre|player.coins|[1,36]",
      "hospital:outcome:2|player.health|[6,20]",
      "commercial_street:enter:outcome:6|player.health|[5,18]",
      "skyscraper:enter:outcome:0|player.health|[8,35]",
      "quiet_street:outcome:3|player.health|[7,22]",
    ]));
  });
});
