/** LayaAir 舞台缩放策略标识。 */
export type EngineScaleMode =
  | "noscale"
  | "showall"
  | "noborder"
  | "full"
  | "fixedwidth"
  | "fixedheight"
  | "fixedauto";

/** LayaAir 屏幕方向标识。 */
export type EngineScreenMode = "none" | "horizontal" | "vertical";

/** LayaAir 水平对齐标识。 */
export type EngineHorizontalAlignment = "left" | "center" | "right";

/** LayaAir 垂直对齐标识。 */
export type EngineVerticalAlignment = "top" | "middle" | "bottom";

/** LayaAir 渲染限能模式标识。 */
export type EngineFrameMode = "fast" | "slow" | "mouse" | "sleep";

/** H5 引擎初始化配置。 */
export interface EngineConfig {
  readonly name: string;
  readonly version: string;
  readonly design_width: number;
  readonly design_height: number;
  readonly scale_mode: EngineScaleMode;
  readonly desktop_screen_mode: EngineScreenMode;
  readonly mobile_screen_mode: EngineScreenMode;
  readonly align_horizontal: EngineHorizontalAlignment;
  readonly align_vertical: EngineVerticalAlignment;
  readonly retina_canvas: boolean;
  readonly active_frame_mode: EngineFrameMode;
  readonly idle_frame_mode: EngineFrameMode;
}

/** 安全区回退边距。 */
export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** 需要通过视觉回归的代表性视口。 */
export interface QualityViewport {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** 响应式断点与质量视口配置。 */
export interface ResponsiveConfig {
  readonly mobile_max_stage_width: number;
  readonly compact_max_stage_height: number;
  readonly safe_area_fallback: SafeAreaInsets;
  readonly quality_viewports: readonly QualityViewport[];
}

/** 引擎直接使用的公共资源路径。 */
export interface AssetConfig {
  readonly cover: string;
  readonly cover_width: number;
  readonly cover_height: number;
}

/** 视觉主题色板。 */
export interface ThemeConfig {
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

/** 文字字体与字号标尺。 */
export interface TypographyConfig {
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

/** 页面动效时长与减少动效开关。 */
export interface MotionConfig {
  readonly page_transition_ms: number;
  readonly button_press_ms: number;
  readonly cover_drift_ms: number;
  readonly toast_duration_ms: number;
  readonly reduced_motion: boolean;
}

/** 交互控件的统一尺寸与阈值。 */
export interface ControlConfig {
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

/** 封面布局标尺。 */
export interface CoverLayoutConfig {
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

/** 桌面指挥台布局标尺。 */
export interface DesktopLayoutConfig {
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

/** 移动指挥台布局标尺。 */
export interface MobileLayoutConfig {
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

/** 沉浸式二级页布局标尺。 */
export interface PageLayoutConfig {
  readonly max_content_width: number;
  readonly header_height: number;
  readonly footer_height: number;
  readonly body_padding: number;
  readonly option_gap: number;
  readonly desktop_option_columns: number;
  readonly mobile_option_columns: number;
}

/** H5 全局布局配置。 */
export interface LayoutConfig {
  readonly cover: CoverLayoutConfig;
  readonly desktop: DesktopLayoutConfig;
  readonly mobile: MobileLayoutConfig;
  readonly page: PageLayoutConfig;
}

/** 浏览器本地存档策略。 */
export interface StorageConfig {
  readonly key: string;
  readonly settings_key: string;
  readonly schema_version: number;
  readonly auto_save: boolean;
  readonly backup_slots: number;
}

/** 一个稳定的底部导航入口。 */
export interface NavigationConfig {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

/** 指挥台的配置化行动分组。 */
export interface ActionGroupConfig {
  readonly id: string;
  readonly label: string;
  readonly action_ids: readonly string[];
}

/** H5 界面文案。 */
export interface TextConfig {
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

/** 经验证后供 H5 各层共享的根配置。 */
export interface WebGameConfig {
  readonly schema_version: number;
  readonly engine: EngineConfig;
  readonly responsive: ResponsiveConfig;
  readonly assets: AssetConfig;
  readonly theme: ThemeConfig;
  readonly typography: TypographyConfig;
  readonly motion: MotionConfig;
  readonly controls: ControlConfig;
  readonly layout: LayoutConfig;
  readonly storage: StorageConfig;
  readonly navigation: readonly NavigationConfig[];
  readonly action_groups: readonly ActionGroupConfig[];
  readonly texts: TextConfig;
}
