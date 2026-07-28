import { afterEach, describe, expect, it, vi } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import { FailureReturnCoordinator } from "../../src/ui/interactions/FailureReturnCoordinator";

const failureDelayMs = parseWebGameConfig(webConfigDocument)
  .failure_flow.forced_return_delay_ms;

afterEach(() => {
  vi.useRealTimers();
});

describe("失败页强制返回协调器", () => {
  it("重复激活只结算一次且严格等待配置化时长", () => {
    vi.useFakeTimers();
    const onElapsed = vi.fn();
    const coordinator = new FailureReturnCoordinator(failureDelayMs, onElapsed);

    coordinator.activate();
    coordinator.activate();
    vi.advanceTimersByTime(failureDelayMs - 1);
    expect(onElapsed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(coordinator.isActive()).toBe(false);
  });

  it("离开失败页或销毁宿主会取消晚到回调", () => {
    vi.useFakeTimers();
    const onElapsed = vi.fn();
    const coordinator = new FailureReturnCoordinator(failureDelayMs, onElapsed);

    coordinator.activate();
    coordinator.deactivate();
    coordinator.activate();
    coordinator.destroy();
    vi.advanceTimersByTime(failureDelayMs);

    expect(onElapsed).not.toHaveBeenCalled();
    expect(coordinator.isActive()).toBe(false);
  });
});
