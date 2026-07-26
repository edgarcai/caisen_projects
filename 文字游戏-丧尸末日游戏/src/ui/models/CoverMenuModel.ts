import type {
  CoverMenuLayoutTokens,
  GameUiConfig,
} from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import {
  resolveCoverThemeArtwork,
  resolveDefaultCoverTheme,
} from "./CoverThemeModel";

/** 封面菜单悬停后对外发布的简介模型。 */
export interface CoverMenuDescription {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** 封面入口与独立设置键的回调集合。 */
export interface CoverPageActions {
  readonly startSingle: () => void;
  readonly loadGame: () => void;
  readonly startMultiplayer: () => void;
  readonly startStory: () => void;
  readonly showCredits: () => void;
  readonly showUpdateLog?: () => void;
  readonly openSettings: () => void;
  readonly exitGame: () => void;
  readonly onDescriptionChange?: (
    description: CoverMenuDescription | null,
  ) => void;
}

/** 封面单个菜单入口的不可变展示模型。 */
export interface CoverMenuItem extends CoverMenuDescription {
  readonly disabled: boolean;
  readonly action: () => void;
}

/** 封面单个菜单按钮的纯布局结果。 */
export interface CoverMenuItemGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly shape: "rectangle" | "parallelogram";
}

/** 封面独立设置键的纯布局结果。 */
export interface CoverSettingsGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 封面右上退出键与右下更新日志键的纯布局结果。 */
export type CoverUtilityGeometry = CoverSettingsGeometry;

/** 桌面封面悬停简介面板的纯几何结果。 */
export interface CoverDescriptionGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 根据当前响应式布局选择桌面 PNG 或轻量手机封面。 */
export function resolveCoverArtwork(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): string {
  return resolveCoverThemeArtwork(
    resolveDefaultCoverTheme(config.assets.cover_themes),
    layout,
  ).asset;
}

/** 按固定顺序构造五个主要游戏入口，系统操作由独立按钮承载。 */
export function buildCoverMenuItems(
  config: GameUiConfig,
  canLoadGame: boolean,
  actions: CoverPageActions,
): readonly CoverMenuItem[] {
  return [
    {
      id: "new-game",
      label: config.texts.start_single,
      description: config.texts.start_single_description,
      disabled: false,
      action: actions.startSingle,
    },
    {
      id: "load-game",
      label: config.texts.start_load,
      description: config.texts.start_load_description,
      disabled: !canLoadGame,
      action: actions.loadGame,
    },
    {
      id: "multiplayer",
      label: config.texts.start_multiplayer,
      description: config.texts.start_multiplayer_description,
      disabled: false,
      action: actions.startMultiplayer,
    },
    {
      id: "story",
      label: config.texts.start_story,
      description: config.texts.start_story_description,
      disabled: false,
      action: actions.startStory,
    },
    {
      id: "credits",
      label: config.texts.credits,
      description: config.texts.credits_description,
      disabled: false,
      action: actions.showCredits,
    },
  ];
}

/** 根据桌面或手机菜单 token 计算主入口坐标。 */
export function resolveCoverMenuItemGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
  index: number,
  itemCount: number,
): CoverMenuItemGeometry {
  const menuLayout = resolveCoverMenuLayout(config, layout);
  const columns = Math.max(1, Math.floor(menuLayout.menu_columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const gridWidth = menuLayout.menu_width * columns
    + menuLayout.menu_column_gap * (columns - 1);
  const alignedLeft = resolveCoverHorizontalPosition(
    menuLayout,
    layout,
    gridWidth,
  );
  const menuTop = resolveCoverMenuTop(
    menuLayout,
    layout,
    config.controls.button_height,
    Math.ceil(itemCount / columns),
  );
  return {
    x:
      alignedLeft +
      column * (menuLayout.menu_width + menuLayout.menu_column_gap) +
      row * menuLayout.menu_row_step_x,
    y: menuTop + row * (config.controls.button_height + menuLayout.menu_row_gap),
    width: menuLayout.menu_width,
    height: config.controls.button_height,
    shape: layout.kind === "mobile" ? "rectangle" : "parallelogram",
  };
}

/** 根据当前断点计算独立设置键，并将其钳制在安全区内。 */
export function resolveCoverSettingsGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): CoverSettingsGeometry {
  const menuLayout = resolveCoverMenuLayout(config, layout);
  const availableWidth = Math.max(
    config.controls.minimum_touch_size,
    layout.stageWidth - layout.safeArea.left - layout.safeArea.right,
  );
  const availableHeight = Math.max(
    config.controls.minimum_touch_size,
    layout.stageHeight - layout.safeArea.top - layout.safeArea.bottom,
  );
  const width = Math.min(menuLayout.settings_button_width, availableWidth);
  const height = Math.min(menuLayout.settings_button_height, availableHeight);
  const exitGeometry = resolveCoverExitGeometry(config, layout);
  const requestedX = menuLayout.settings_button_anchor === "left"
    ? layout.safeArea.left + menuLayout.settings_button_offset
    : exitGeometry.x - menuLayout.settings_button_offset - width;
  const maximumX = layout.stageWidth - layout.safeArea.right - width;
  return {
    x: Math.min(maximumX, Math.max(layout.safeArea.left, requestedX)),
    y: Math.min(
      layout.stageHeight - layout.safeArea.bottom - height,
      layout.safeArea.top + menuLayout.settings_button_top,
    ),
    width,
    height,
  };
}

/** 根据当前断点计算右上角退出键并钳制在安全区内。 */
export function resolveCoverExitGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): CoverUtilityGeometry {
  const menuLayout = resolveCoverMenuLayout(config, layout);
  const width = Math.min(
    menuLayout.exit_button_width,
    layout.stageWidth - layout.safeArea.left - layout.safeArea.right,
  );
  const height = Math.min(
    menuLayout.exit_button_height,
    layout.stageHeight - layout.safeArea.top - layout.safeArea.bottom,
  );
  return {
    x: Math.max(
      layout.safeArea.left,
      layout.stageWidth - layout.safeArea.right - menuLayout.exit_button_right - width,
    ),
    y: Math.min(
      layout.stageHeight - layout.safeArea.bottom - height,
      layout.safeArea.top + menuLayout.exit_button_top,
    ),
    width,
    height,
  };
}

/** 根据当前断点计算右下角更新日志入口并钳制在安全区内。 */
export function resolveCoverChangelogGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): CoverUtilityGeometry {
  const menuLayout = resolveCoverMenuLayout(config, layout);
  const width = Math.min(
    menuLayout.changelog_button_width,
    layout.stageWidth - layout.safeArea.left - layout.safeArea.right,
  );
  const height = Math.min(
    menuLayout.changelog_button_height,
    layout.stageHeight - layout.safeArea.top - layout.safeArea.bottom,
  );
  return {
    x: Math.max(
      layout.safeArea.left,
      layout.stageWidth
        - layout.safeArea.right
        - menuLayout.changelog_button_right
        - width,
    ),
    y: Math.max(
      layout.safeArea.top,
      layout.stageHeight
        - layout.safeArea.bottom
        - menuLayout.changelog_button_bottom
        - height,
    ),
    width,
    height,
  };
}

/** 根据配置化桌面标尺计算悬停简介面板几何。 */
export function resolveCoverDescriptionGeometry(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): CoverDescriptionGeometry {
  const menuLayout = resolveCoverMenuLayout(config, layout);
  return {
    x: layout.safeArea.left + menuLayout.description_left,
    y: layout.safeArea.top + menuLayout.description_top,
    width: menuLayout.description_width,
    height: menuLayout.description_height,
  };
}

/** 返回当前断点对应的封面菜单 token。 */
export function resolveCoverMenuLayout(
  config: GameUiConfig,
  layout: ResponsiveLayout,
): CoverMenuLayoutTokens {
  if (layout.kind === "mobile" && layout.isLandscape) {
    return config.layout.cover.mobile_landscape;
  }
  return layout.kind === "mobile"
    ? config.layout.cover.mobile
    : config.layout.cover.desktop;
}

/** 按配置将封面内容锚定到安全区内的左侧、中央或右侧。 */
export function resolveCoverHorizontalPosition(
  menuLayout: CoverMenuLayoutTokens,
  layout: ResponsiveLayout,
  contentWidth: number,
): number {
  const safeWidth = layout.stageWidth - layout.safeArea.left - layout.safeArea.right;
  if (menuLayout.horizontal_alignment === "center") {
    return layout.safeArea.left + (safeWidth - contentWidth) / 2;
  }
  if (menuLayout.horizontal_alignment === "right") {
    return layout.stageWidth -
      layout.safeArea.right -
      menuLayout.content_left -
      contentWidth;
  }
  return layout.safeArea.left + menuLayout.content_left;
}

/** 按配置把封面菜单整体锚定到舞台顶部、中部或底部。 */
export function resolveCoverMenuTop(
  menuLayout: CoverMenuLayoutTokens,
  layout: ResponsiveLayout,
  itemHeight: number,
  rowCount: number,
): number {
  const menuHeight = rowCount * itemHeight
    + Math.max(0, rowCount - 1) * menuLayout.menu_row_gap;
  const safeHeight = layout.stageHeight - layout.safeArea.top - layout.safeArea.bottom;
  if (menuLayout.vertical_alignment === "bottom") {
    return layout.stageHeight -
      layout.safeArea.bottom -
      menuLayout.menu_bottom -
      menuHeight;
  }
  if (menuLayout.vertical_alignment === "middle") {
    return layout.safeArea.top + (safeHeight - menuHeight) / 2;
  }
  return layout.safeArea.top + menuLayout.menu_top;
}
