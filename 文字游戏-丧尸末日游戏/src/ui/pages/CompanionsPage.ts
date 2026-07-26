import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiCompanionView } from "../ports/GameUiPort";
import { PageScaffold } from "./PageView";

/**
 * 创建包含状态、信任和人物小传的伙伴档案页。
 */
export function createCompanionsPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  title: string,
  companions: readonly UiCompanionView[],
  onBack: () => void,
): PageScaffold {
  const page = new PageScaffold(
    runtime,
    factory,
    config,
    layout,
    "page-companions",
    title,
    onBack,
  );
  let cursorY = 0;
  companions.forEach((companion) => {
    const panelHeight = config.layout.mobile.mission_height;
    const panel = factory.panel(page.content, {
      testId: `companion-${companion.id}`,
      x: 0,
      y: cursorY,
      width: page.contentWidth,
      height: panelHeight,
      elevated: true,
      active: companion.tone === "primary" || companion.tone === "success",
    });
    const innerWidth = page.contentWidth - layout.panelPadding * 2;
    factory.text(panel, {
      testId: `companion-${companion.id}-name`,
      text: `${companion.name} · ${companion.role}`,
      x: layout.panelPadding,
      y: layout.panelPadding,
      width: innerWidth,
      height: config.typography.body_line_height,
      fontSize: config.typography.section_title_size,
      color: config.theme.accent,
      bold: true,
    });
    factory.text(panel, {
      testId: `companion-${companion.id}-status`,
      text: `${companion.statusLabel}  ${companion.trustLabel}`,
      x: layout.panelPadding,
      y: layout.panelPadding + config.typography.body_line_height,
      width: innerWidth,
      height: config.typography.body_line_height,
      fontSize: config.typography.caption_size,
      color: config.theme.muted_text,
    });
    factory.text(panel, {
      testId: `companion-${companion.id}-biography`,
      text: companion.biography,
      x: layout.panelPadding,
      y: layout.panelPadding + config.typography.body_line_height * 2,
      width: innerWidth,
      height:
        panelHeight -
        layout.panelPadding * 2 -
        config.typography.body_line_height * 2,
      fontSize: config.typography.body_size,
    });
    cursorY += panelHeight + layout.sectionGap;
  });
  page.scroll.setContentHeight(cursorY);
  return page;
}
