/** 可注入的延迟调度器，便于无浏览器单元测试。 */
export interface HoverDelayScheduler {
  schedule(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  cancel(handle: ReturnType<typeof setTimeout>): void;
}

/** 使用浏览器或 Node 全局计时器的默认调度器。 */
const defaultScheduler: HoverDelayScheduler = {
  /** 安排一次延迟回调。 */
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  /** 取消尚未触发的延迟回调。 */
  cancel: (handle) => { globalThis.clearTimeout(handle); },
};

/**
 * 把短暂掠过与有意悬停分开，只在配置延迟后发布简介。
 */
export class DelayedHoverIntent<TValue> {
  private readonly delayMs: number;
  private readonly listener: (value: TValue | null) => void;
  private readonly scheduler: HoverDelayScheduler;
  private pendingHandle: ReturnType<typeof setTimeout> | null;

  /** 保存配置化延迟、状态监听器和可测试调度器。 */
  public constructor(
    delayMs: number,
    listener: (value: TValue | null) => void,
    scheduler: HoverDelayScheduler = defaultScheduler,
  ) {
    this.delayMs = delayMs;
    this.listener = listener;
    this.scheduler = scheduler;
    this.pendingHandle = null;
  }

  /** 进入目标后重新开始延迟计时。 */
  public enter(value: TValue): void {
    this.cancelPending();
    this.pendingHandle = this.scheduler.schedule(() => {
      this.pendingHandle = null;
      this.listener(value);
    }, this.delayMs);
  }

  /** 离开目标时撤销待触发简介并清空当前展示。 */
  public leave(): void {
    this.cancelPending();
    this.listener(null);
  }

  /** 销毁控制器并保证不会在页面释放后回调。 */
  public destroy(): void {
    this.cancelPending();
  }

  /** 取消尚未触发的调度句柄。 */
  private cancelPending(): void {
    if (this.pendingHandle === null) {
      return;
    }
    this.scheduler.cancel(this.pendingHandle);
    this.pendingHandle = null;
  }
}
