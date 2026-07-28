import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  NativeTextInputPolicy,
  type NativeTextInputElementLike,
} from "../../src/ui/interactions/NativeTextInputPolicy";

const webConfig = parseWebGameConfig(webConfigDocument);

/** 构造一个模拟手机 WebView 遗留数字键盘属性的 input。 */
function createNumericInput(): NativeTextInputElementLike {
  return {
    type: "number",
    inputMode: "numeric",
    lang: "",
    enterKeyHint: "enter",
    autocomplete: "on",
    autocapitalize: "sentences",
    spellcheck: true,
  };
}

describe("原生姓名输入策略", () => {
  it("在获取焦点前将数字键盘完整覆盖为配置化文本输入", () => {
    const input = createNumericInput();
    const policy = new NativeTextInputPolicy(
      webConfig.new_game_setup.name_input,
      () => input,
    );

    policy.prepare();

    expect(input).toEqual({
      type: "text",
      inputMode: "text",
      lang: "zh-CN",
      enterKeyHint: "done",
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: false,
    });
  });

  it("无 DOM 或 Laya 尚未创建 input 时安全返回", () => {
    const policy = new NativeTextInputPolicy(
      webConfig.new_game_setup.name_input,
      () => null,
    );

    expect(() => {
      policy.prepare();
    }).not.toThrow();
  });
});
