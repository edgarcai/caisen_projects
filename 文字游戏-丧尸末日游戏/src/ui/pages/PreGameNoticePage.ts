import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import { PageScaffold } from "./PageView";

/** 开局前教程通知的两个明确行为。 */
export interface PreGameNoticeActions {
  readonly continueGame: () => void;
  readonly openTutorial: () => void;
  readonly back: () => void;
}

/** 创建开局前通知页，明确教程位于设置并允许立即查看。 */
export function createPreGameNoticePage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  actions: PreGameNoticeActions,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-pre-game-notice",
    config.pre_game_notice.title,
    actions.back,
    [
      {
        id: "back",
        testId: "pre-game-notice-back",
        label: config.texts.back,
        onClick: actions.back,
      },
      {
        id: "tutorial",
        testId: "pre-game-notice-tutorial",
        label: config.pre_game_notice.tutorial_label,
        onClick: actions.openTutorial,
      },
      {
        id: "continue",
        testId: "pre-game-notice-continue",
        label: config.pre_game_notice.continue_label,
        tone: "primary",
        onClick: actions.continueGame,
      },
    ],
  );
  const body = factory.autoText(page.content, {
    testId: "pre-game-notice-body",
    text: config.pre_game_notice.body,
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: config.typography.body_size,
    color: config.theme.text,
  });
  page.scroll.setContentHeight(body.height + layout.sectionGap);
  return page;
}
