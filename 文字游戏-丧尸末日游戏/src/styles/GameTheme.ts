/**
 * H5 配置中 UI 会使用的主题字段。
 */
export interface GameThemeTokens {
  readonly background: string;
  readonly background_soft: string;
  readonly panel: string;
  readonly panel_elevated: string;
  readonly panel_translucent: string;
  readonly primary: string;
  readonly primary_hover: string;
  readonly primary_pressed: string;
  readonly on_primary: string;
  readonly secondary: string;
  readonly secondary_hover: string;
  readonly danger: string;
  readonly text: string;
  readonly muted_text: string;
  readonly accent: string;
  readonly health: string;
  readonly hunger: string;
  readonly warning: string;
  readonly error: string;
  readonly border: string;
  readonly border_active: string;
  readonly overlay: string;
  readonly scrim: string;
}

/**
 * H5 配置中 UI 会使用的字号字段。
 */
export interface GameTypographyTokens {
  readonly font_family: string;
  readonly cover_title_size: number;
  readonly cover_subtitle_size: number;
  readonly page_title_size: number;
  readonly section_title_size: number;
  readonly body_size: number;
  readonly body_line_height: number;
  readonly control_size: number;
  readonly caption_size: number;
  readonly stat_size: number;
}

/**
 * H5 配置中 UI 会使用的交互尺寸字段。
 */
export interface GameControlTokens {
  readonly minimum_touch_size: number;
  readonly button_height: number;
  readonly compact_button_height: number;
  readonly button_slant: number;
  readonly button_gap: number;
  readonly button_horizontal_padding: number;
  readonly max_player_name_characters: number;
  readonly focus_border_width: number;
  readonly scroll_step: number;
  readonly drag_threshold: number;
}

/**
 * 封面布局配置。
 */
export interface CoverLayoutTokens {
  readonly content_left: number;
  readonly content_top: number;
  readonly menu_top: number;
  readonly menu_width: number;
  readonly menu_step_x: number;
  readonly menu_gap: number;
  readonly image_dark_edge_ratio: number;
  readonly image_dark_solid_ratio: number;
  readonly image_dark_fade_steps: number;
}

/**
 * 桌面指挥台布局配置。
 */
export interface DesktopLayoutTokens {
  readonly outer_padding: number;
  readonly header_height: number;
  readonly left_rail_width: number;
  readonly right_rail_width: number;
  readonly column_gap: number;
  readonly panel_padding: number;
  readonly section_gap: number;
  readonly bottom_bar_height: number;
  readonly mission_height: number;
  readonly log_min_height: number;
}

/**
 * 手机指挥台布局配置。
 */
export interface MobileLayoutTokens {
  readonly outer_padding: number;
  readonly header_height: number;
  readonly bottom_navigation_height: number;
  readonly panel_padding: number;
  readonly section_gap: number;
  readonly mission_height: number;
  readonly resource_bar_height: number;
  readonly quick_action_columns: number;
  readonly sheet_top_margin: number;
}

/**
 * 通用二级页面布局配置。
 */
export interface PageLayoutTokens {
  readonly max_content_width: number;
  readonly header_height: number;
  readonly footer_height: number;
  readonly body_padding: number;
  readonly option_gap: number;
  readonly desktop_option_columns: number;
  readonly mobile_option_columns: number;
}

/**
 * UI 使用的完整布局配置。
 */
export interface GameLayoutTokens {
  readonly cover: CoverLayoutTokens;
  readonly desktop: DesktopLayoutTokens;
  readonly mobile: MobileLayoutTokens;
  readonly page: PageLayoutTokens;
}

/**
 * UI 使用的动效配置。
 */
export interface GameMotionTokens {
  readonly page_transition_ms: number;
  readonly button_press_ms: number;
  readonly cover_drift_ms: number;
  readonly toast_duration_ms: number;
  readonly reduced_motion: boolean;
}

/**
 * 配置化的安全区回退值。
 */
export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * UI 使用的响应式配置。
 */
export interface ResponsiveTokens {
  readonly mobile_max_stage_width: number;
  readonly compact_max_stage_height: number;
  readonly safe_area_fallback: SafeAreaInsets;
}

/**
 * UI 使用的配置化资源路径。
 */
export interface GameAssetTokens {
  readonly cover: string;
  readonly cover_width?: number;
  readonly cover_height?: number;
}

/**
 * 底部导航项配置。
 */
export interface NavigationToken {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

/**
 * UI 使用的配置化文本。
 */
export interface GameTextTokens {
  readonly loading: string;
  readonly load_failed: string;
  readonly start_single: string;
  readonly start_load: string;
  readonly start_multiplayer: string;
  readonly name_submit: string;
  readonly back: string;
  readonly continue: string;
  readonly confirm: string;
  readonly cancel: string;
  readonly close: string;
  readonly save: string;
  readonly no_save: string;
  readonly auto_saved: string;
  readonly storage_unavailable: string;
  readonly portrait_hint: string;
  readonly offline_ready: string;
  readonly option_intelligence_title: string;
  readonly option_intelligence_format: string;
  readonly option_intelligence_separator: string;
}

/**
 * GameShell 构造时需要的 Web 配置契约。
 */
export interface GameUiConfig {
  readonly responsive: ResponsiveTokens;
  readonly assets: GameAssetTokens;
  readonly theme: GameThemeTokens;
  readonly typography: GameTypographyTokens;
  readonly motion: GameMotionTokens;
  readonly controls: GameControlTokens;
  readonly layout: GameLayoutTokens;
  readonly navigation: readonly NavigationToken[];
  readonly texts: GameTextTokens;
}

/**
 * 按语义返回按钮颜色，避免页面直接读取具体色值。
 */
export function resolveToneColor(
  theme: GameThemeTokens,
  tone: "default" | "primary" | "success" | "warning" | "danger",
): string {
  switch (tone) {
    case "primary":
      return theme.primary;
    case "success":
      return theme.health;
    case "warning":
      return theme.warning;
    case "danger":
      return theme.danger;
    default:
      return theme.secondary;
  }
}
