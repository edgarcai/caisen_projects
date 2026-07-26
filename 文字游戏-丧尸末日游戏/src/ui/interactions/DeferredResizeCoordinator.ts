/** 延迟合并尺寸变化所需的配置。 */
export interface DeferredResizeConfig {
  readonly debounceMs: number;
  readonly keyboardSettleMs: number;
}

/**
 * 合并连续 resize，并在原生文本输入期间延迟重排，避免软键盘销毁输入节点。
 */
export class DeferredResizeCoordinator {
  private readonly config: DeferredResizeConfig;
  private readonly hasActiveTextEntry: () => boolean;
  private readonly commit: () => void;
  private timer: ReturnType<typeof setTimeout> | null;
  private pendingWhileTyping: boolean;
  private destroyed: boolean;

  /** 保存可注入策略，不在构造阶段注册浏览器监听。 */
  public constructor(
    config: DeferredResizeConfig,
    hasActiveTextEntry: () => boolean,
    commit: () => void,
  ) {
    this.config = config;
    this.hasActiveTextEntry = hasActiveTextEntry;
    this.commit = commit;
    this.timer = null;
    this.pendingWhileTyping = false;
    this.destroyed = false;
  }

  /** 接收一次尺寸变化，并把连续事件合并为一次稳定刷新。 */
  public request(): void {
    this.schedule(this.config.debounceMs);
  }

  /** 文本输入结束后提交先前因软键盘而延迟的刷新。 */
  public settleAfterTextEntry(): void {
    if (!this.pendingWhileTyping) {
      return;
    }
    this.schedule(this.config.keyboardSettleMs);
  }

  /** 清理尚未执行的计时器，后续请求不再产生刷新。 */
  public destroy(): void {
    this.destroyed = true;
    this.pendingWhileTyping = false;
    this.clearTimer();
  }

  /** 按指定配置化延迟替换当前等待任务。 */
  private schedule(delayMs: number): void {
    if (this.destroyed) {
      return;
    }
    this.clearTimer();
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      if (this.hasActiveTextEntry()) {
        this.pendingWhileTyping = true;
        return;
      }
      this.pendingWhileTyping = false;
      this.commit();
    }, delayMs);
  }

  /** 取消当前等待任务并清空引用。 */
  private clearTimer(): void {
    if (this.timer === null) {
      return;
    }
    globalThis.clearTimeout(this.timer);
    this.timer = null;
  }
}
