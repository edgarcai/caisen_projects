import type { RandomSource } from "../domain/ports";

export type UnitRandom = () => number;

/** 使用浏览器随机函数实现可替换的领域随机端口。 */
export class BrowserRandomSource implements RandomSource {
  private readonly random: UnitRandom;

  /** 注入返回左闭右开区间数值的随机函数，默认使用 Math.random。 */
  public constructor(random: UnitRandom = Math.random) {
    this.random = random;
  }

  /** 返回包含上下界的随机整数。 */
  public randint(minimum: number, maximum: number): number {
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
      throw new RangeError("随机整数边界必须是有效的升序整数区间。");
    }
    const sample = this.sample();
    return minimum + Math.floor(sample * (maximum - minimum + 1));
  }

  /** 按非负权重从非空候选集合中选择一项。 */
  public weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError("随机候选项与权重必须非空且长度一致。");
    }
    let total = 0;
    for (const weight of weights) {
      if (!Number.isFinite(weight) || weight < 0) {
        throw new RangeError("随机权重必须是非负有限数值。");
      }
      total += weight;
    }
    if (total <= 0) {
      throw new RangeError("随机权重总和必须大于零。");
    }
    const threshold = this.sample() * total;
    let cumulative = 0;
    for (let index = 0; index < items.length; index += 1) {
      cumulative += weights[index] ?? 0;
      if (threshold < cumulative) {
        const selected = items[index];
        if (selected !== undefined) return selected;
      }
    }
    const fallback = items[items.length - 1];
    if (fallback === undefined) {
      throw new RangeError("随机候选集合为空。");
    }
    return fallback;
  }

  /** 校验注入源满足 Math.random 的左闭右开契约。 */
  private sample(): number {
    const value = this.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("随机源必须返回 [0, 1) 区间内的有限数值。");
    }
    return value;
  }
}
