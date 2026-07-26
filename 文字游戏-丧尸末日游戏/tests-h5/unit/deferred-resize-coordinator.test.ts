import { afterEach, describe, expect, it, vi } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import { DeferredResizeCoordinator } from "../../src/ui/interactions/DeferredResizeCoordinator";

const webConfig = parseWebGameConfig(webConfigDocument);
const resizeConfig = {
  debounceMs: webConfig.responsive.resize_debounce_ms,
  keyboardSettleMs: webConfig.responsive.keyboard_resize_settle_ms,
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("延迟尺寸重排协调器", () => {
  it("连续 resize 仅在最后一次配置化去抖结束后提交一次", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const coordinator = new DeferredResizeCoordinator(
      resizeConfig,
      () => false,
      commit,
    );

    coordinator.request();
    vi.advanceTimersByTime(resizeConfig.debounceMs - 1);
    coordinator.request();
    vi.advanceTimersByTime(resizeConfig.debounceMs - 1);

    expect(commit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("文本输入聚焦时延迟提交并在 focusout 稳定期后刷新", () => {
    vi.useFakeTimers();
    let textEntryActive = true;
    const commit = vi.fn();
    const coordinator = new DeferredResizeCoordinator(
      resizeConfig,
      () => textEntryActive,
      commit,
    );

    coordinator.request();
    vi.advanceTimersByTime(resizeConfig.debounceMs);

    expect(commit).not.toHaveBeenCalled();

    textEntryActive = false;
    coordinator.settleAfterTextEntry();
    vi.advanceTimersByTime(resizeConfig.keyboardSettleMs - 1);

    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("destroy 清理等待任务并永久忽略后续重排请求", () => {
    vi.useFakeTimers();
    let textEntryActive = true;
    const commit = vi.fn();
    const coordinator = new DeferredResizeCoordinator(
      resizeConfig,
      () => textEntryActive,
      commit,
    );

    coordinator.request();
    vi.advanceTimersByTime(resizeConfig.debounceMs);
    coordinator.destroy();
    textEntryActive = false;
    coordinator.settleAfterTextEntry();
    coordinator.request();

    expect(vi.getTimerCount()).toBe(0);

    vi.runAllTimers();

    expect(commit).not.toHaveBeenCalled();
  });
});
