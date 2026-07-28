/** 浏览器失败倒计时使用的稳定计时器句柄。 */
export type FailureReturnHandle = ReturnType<typeof globalThis.setTimeout>;

/** 失败页倒计时依赖的最小调度端口，便于测试替换真实时间。 */
export interface FailureReturnScheduler {
  /** 在指定毫秒后执行一次任务，并返回可取消句柄。 */
  schedule(task: () => void, delayMs: number): FailureReturnHandle;

  /** 取消尚未执行的调度任务。 */
  cancel(handle: FailureReturnHandle): void;
}

/** 浏览器环境使用的默认单次任务调度器。 */
export const browserFailureReturnScheduler: FailureReturnScheduler = {
  /** 使用全局计时器安排失败结算。 */
  schedule(task: () => void, delayMs: number): FailureReturnHandle {
    return globalThis.setTimeout(task, delayMs);
  },

  /** 取消由全局计时器创建的失败结算任务。 */
  cancel(handle: FailureReturnHandle): void {
    globalThis.clearTimeout(handle);
  },
};

/** 管理失败页唯一倒计时，避免重复渲染触发多次删除或晚到回调。 */
export class FailureReturnCoordinator {
  private readonly delayMs: number;
  private readonly onElapsed: () => void;
  private readonly scheduler: FailureReturnScheduler;
  private pendingHandle: FailureReturnHandle | null;

  /** 保存配置化时长、结算回调与可替换调度端口。 */
  public constructor(
    delayMs: number,
    onElapsed: () => void,
    scheduler: FailureReturnScheduler = browserFailureReturnScheduler,
  ) {
    this.delayMs = delayMs;
    this.onElapsed = onElapsed;
    this.scheduler = scheduler;
    this.pendingHandle = null;
  }

  /** 在尚未计时时启动唯一任务；重复激活不会重置倒计时。 */
  public activate(): void {
    if (this.pendingHandle !== null) return;
    this.pendingHandle = this.scheduler.schedule(() => {
      this.pendingHandle = null;
      this.onElapsed();
    }, this.delayMs);
  }

  /** 取消当前倒计时；没有任务时保持幂等。 */
  public deactivate(): void {
    if (this.pendingHandle === null) return;
    this.scheduler.cancel(this.pendingHandle);
    this.pendingHandle = null;
  }

  /** 销毁协调器并阻止已离开页面的晚到结算。 */
  public destroy(): void {
    this.deactivate();
  }

  /** 返回当前是否已经安排强制结算，供测试和宿主诊断。 */
  public isActive(): boolean {
    return this.pendingHandle !== null;
  }
}
