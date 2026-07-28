import type { NativeNameInputTokens } from "../../styles/GameTheme";

/** 姓名输入策略所需的最小原生 input 属性集合。 */
export interface NativeTextInputElementLike {
  type: string;
  inputMode: string;
  lang: string;
  enterKeyHint: string;
  autocomplete: string;
  autocapitalize: string;
  spellcheck: boolean;
}

/** 姓名页只依赖的原生输入准备端口。 */
export interface NativeTextInputPolicyPort {
  prepare(): void;
}

/** 返回 Laya 当前已挂载、即将获取焦点的原生 input。 */
type NativeInputFinder = () => NativeTextInputElementLike | null;

/** 把配置化移动键盘语义应用到 Laya 动态创建的原生 input。 */
export class NativeTextInputPolicy implements NativeTextInputPolicyPort {
  private readonly config: NativeNameInputTokens;
  private readonly findInput: NativeInputFinder;

  /** 保存不可变配置与可测试的 input 查找边界。 */
  public constructor(
    config: NativeNameInputTokens,
    findInput: NativeInputFinder,
  ) {
    this.config = config;
    this.findInput = findInput;
  }

  /** 在 Laya 调用原生 focus 前覆盖键盘与输入语义。 */
  public prepare(): void {
    const input = this.findInput();
    if (input === null) {
      return;
    }
    input.type = this.config.html_type;
    input.inputMode = this.config.input_mode;
    input.lang = this.config.language;
    input.enterKeyHint = this.config.enter_key_hint;
    input.autocomplete = this.config.autocomplete;
    input.autocapitalize = this.config.autocapitalize;
    input.spellcheck = this.config.spellcheck;
  }
}

/** 为浏览器环境创建不泄漏 DOM 细节的原生姓名输入策略。 */
export function createBrowserNativeTextInputPolicy(
  config: NativeNameInputTokens,
  documentRef: Document | null,
): NativeTextInputPolicyPort {
  return new NativeTextInputPolicy(
    config,
    (): NativeTextInputElementLike | null =>
      findLatestConnectedInput(documentRef),
  );
}

/** 从 Laya 容器动态插入的节点中取最后一个已连接 input。 */
function findLatestConnectedInput(
  documentRef: Document | null,
): HTMLInputElement | null {
  if (documentRef === null) {
    return null;
  }
  const inputs = documentRef.querySelectorAll<HTMLInputElement>("input");
  for (let index = inputs.length - 1; index >= 0; index -= 1) {
    const input = inputs.item(index);
    if (input.isConnected) {
      return input;
    }
  }
  return null;
}
