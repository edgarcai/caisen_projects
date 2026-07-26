import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type {
  LayaInputLike,
  LayaRuntimeLike,
} from "../laya/LayaRuntime";
import type { GameMode } from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/**
 * 姓名输入页面以及读取输入值的能力。
 */
export interface NameInputPageView {
  readonly page: PageScaffold;
  readNames(): readonly string[];
}

/**
 * 创建单人或本地双人姓名输入页面。
 */
export function createNameInputPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  mode: GameMode,
  playerCount: number,
  onBack: () => void,
  onSubmit: (names: readonly string[]) => void,
): NameInputPageView {
  if (!Number.isInteger(playerCount) || playerCount <= 0) {
    throw new Error("玩家输入框数量必须是正整数配置值。");
  }
  const title = mode === "single"
    ? config.texts.start_single
    : mode === "story"
      ? config.texts.start_story
      : config.texts.start_multiplayer;
  const inputs: LayaInputLike[] = [];

  /** 读取并清理全部姓名输入值。 */
  const readNames = (): readonly string[] =>
    inputs.map((input) => input.text.trim());

  /** 把输入值提交给 GameShell，校验由应用层完成。 */
  const handleSubmit = (): void => {
    onSubmit(readNames());
  };

  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-name-input",
    title,
    onBack,
    [
      {
        id: "back",
        testId: "page-name-input-back",
        label: config.texts.back,
        onClick: onBack,
      },
      {
        id: "submit",
        testId: "player-name-submit",
        label: config.texts.name_submit,
        tone: "primary",
        onClick: handleSubmit,
      },
    ],
  );
  const inputWidth = Math.min(page.contentWidth, config.layout.page.max_content_width);
  const inputHeight = config.controls.button_height;
  for (let index = 0; index < playerCount; index += 1) {
    const input = factory.input(page.content, {
      testId: `player-name-${String(index + 1)}`,
      prompt: `${title} ${String(index + 1)}`,
      x: 0,
      y: index * (inputHeight + config.layout.page.option_gap),
      width: inputWidth,
      height: inputHeight,
      maxChars: config.controls.max_player_name_characters,
    });
    inputs.push(input);
  }
  const contentHeight =
    playerCount * (inputHeight + config.layout.page.option_gap) +
    layout.sectionGap;
  page.scroll.setContentHeight(contentHeight);
  return { page, readNames };
}
