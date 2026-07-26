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
  readonly mobile_design_width: number;
  readonly mobile_design_height: number;
  readonly scale_mode: EngineScaleMode;
  readonly desktop_screen_mode: EngineScreenMode;
  readonly mobile_screen_mode: EngineScreenMode;
  readonly align_horizontal: EngineHorizontalAlignment;
  readonly align_vertical: EngineVerticalAlignment;
  readonly retina_canvas: boolean;
  readonly active_frame_mode: EngineFrameMode;
  readonly mobile_active_frame_mode: EngineFrameMode;
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
  readonly mobile: boolean;
  readonly touch: boolean;
  readonly device_scale_factor: number;
}

/** 响应式断点与质量视口配置。 */
export interface ResponsiveConfig {
  readonly desktop_min_stage_width: number;
  readonly mobile_max_css_short_edge: number;
  readonly resize_debounce_ms: number;
  readonly keyboard_resize_settle_ms: number;
  readonly safe_area_fallback: SafeAreaInsets;
  readonly quality_viewports: readonly QualityViewport[];
}

/** 可由美术轨道按需替换的界面皮肤路径。 */
export interface SkinConfig {
  readonly cover_button_idle: string;
  readonly cover_button_hover: string;
  readonly cover_button_pressed: string;
  readonly cover_button_disabled: string;
  readonly page_surface: string;
  readonly action_bar: string;
}

/** 引擎直接使用的公共资源路径。 */
export interface AssetConfig {
  readonly cover: string;
  readonly mobile_cover: string;
  readonly cover_width: number;
  readonly cover_height: number;
  readonly skins: SkinConfig;
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
  readonly connection_transition_ms: number;
  readonly button_press_ms: number;
  readonly cover_drift_ms: number;
  readonly cover_menu_description_delay_ms: number;
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

/** 单个响应式封面菜单结构。 */
export interface CoverMenuLayoutConfig {
  readonly horizontal_alignment: EngineHorizontalAlignment;
  readonly vertical_alignment: EngineVerticalAlignment;
  readonly content_left: number;
  readonly content_top: number;
  readonly menu_top: number;
  readonly menu_bottom: number;
  readonly menu_width: number;
  readonly menu_columns: number;
  readonly menu_column_gap: number;
  readonly menu_row_gap: number;
  readonly menu_row_step_x: number;
  readonly description_left: number;
  readonly description_top: number;
  readonly description_width: number;
  readonly description_height: number;
}

/** 封面桌面、手机与遮罩布局标尺。 */
export interface CoverLayoutConfig {
  readonly desktop: CoverMenuLayoutConfig;
  readonly mobile: CoverMenuLayoutConfig;
  readonly mobile_landscape: CoverMenuLayoutConfig;
  readonly image_dark_edge_ratio: number;
  readonly image_dark_solid_ratio: number;
  readonly image_dark_fade_steps: number;
}

/** 桌面指挥台布局标尺。 */
export interface DesktopLayoutConfig {
  readonly outer_padding: number;
  readonly header_height: number;
  readonly header_navigation_width: number;
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
  readonly header_navigation_width: number;
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
  readonly footer_action_max_width: number;
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
  readonly settings_schema_version: number;
  readonly schema_version: number;
  readonly auto_save: boolean;
  readonly backup_slots: number;
}

/** 浏览器关闭能力受限时采用的退出策略。 */
export type WebExitStrategy =
  | "close_only"
  | "history_back"
  | "close_then_history_back";

/** 配置化 Web 退出策略。 */
export interface WebExitConfig {
  readonly strategy: WebExitStrategy;
  readonly history_back_steps: number;
  readonly verification_delay_ms: number;
}

/** 局内导航允许出现的位置。 */
export type NavigationPlacement =
  | "mobile_bottom"
  | "mobile_header"
  | "desktop_header";

/** 局内导航允许出现的游戏模式。 */
export type NavigationGameMode = "single" | "multiplayer" | "story";

/** 一个稳定且带位置、模式白名单的局内导航入口。 */
export interface NavigationConfig {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly placements: readonly NavigationPlacement[];
  readonly modes: readonly NavigationGameMode[];
}

/** 指挥台的配置化行动分组。 */
export interface ActionGroupConfig {
  readonly id: string;
  readonly label: string;
  readonly action_ids: readonly string[];
}

/** 仅由 H5 指挥台使用的动作展示定义。 */
export interface WebActionConfig {
  readonly id: string;
  readonly label: string;
  readonly style: string;
  readonly icon: string;
}

/** H5 界面文案。 */
export interface TextConfig {
  readonly loading: string;
  readonly load_failed: string;
  readonly connection_title: string;
  readonly start_single: string;
  readonly start_load: string;
  readonly start_multiplayer: string;
  readonly start_story: string;
  readonly credits: string;
  readonly exit: string;
  readonly start_single_description: string;
  readonly start_load_description: string;
  readonly start_multiplayer_description: string;
  readonly start_story_description: string;
  readonly credits_description: string;
  readonly exit_description: string;
  readonly name_submit: string;
  readonly back: string;
  readonly continue: string;
  readonly confirm: string;
  readonly cancel: string;
  readonly close: string;
  readonly save: string;
  readonly save_description: string;
  readonly no_save: string;
  readonly auto_saved: string;
  readonly storage_unavailable: string;
  readonly portrait_hint: string;
  readonly offline_ready: string;
  readonly function_menu_title: string;
  readonly function_menu_body: string;
  readonly settings: string;
  readonly settings_description: string;
  readonly rollback: string;
  readonly rollback_description: string;
  readonly settings_title: string;
  readonly settings_body: string;
  readonly reduced_motion_description: string;
  readonly reduced_motion_on: string;
  readonly reduced_motion_off: string;
  readonly rollback_title: string;
  readonly rollback_body: string;
  readonly exit_title: string;
  readonly exit_body: string;
  readonly exit_failed_title: string;
  readonly exit_failed_body: string;
  readonly warehouse_title: string;
  readonly warehouse_body: string;
  readonly warehouse_item_format: string;
  readonly warehouse_detail_format: string;
  readonly warehouse_equip: string;
  readonly warehouse_not_equippable: string;
  readonly research_title: string;
  readonly research_body: string;
  readonly research_item_format: string;
  readonly research_detail_format: string;
  readonly research_complete: string;
  readonly research_completed: string;
  readonly research_locked: string;
  readonly crafting_title: string;
  readonly crafting_body: string;
  readonly crafting_item_format: string;
  readonly crafting_detail_format: string;
  readonly crafting_action: string;
  readonly crafting_locked: string;
  readonly expedition_prepare_title: string;
  readonly expedition_prepare_body: string;
  readonly expedition_city_title: string;
  readonly expedition_companion_title: string;
  readonly expedition_item_title: string;
  readonly expedition_city_format: string;
  readonly expedition_companion_format: string;
  readonly expedition_item_format: string;
  readonly expedition_selected: string;
  readonly expedition_unselected: string;
  readonly expedition_unknown_item: string;
  readonly expedition_begin: string;
  readonly expedition_status_title: string;
  readonly expedition_status_format: string;
  readonly expedition_loot_format: string;
  readonly expedition_continue: string;
  readonly expedition_safe_return: string;
  readonly history_title: string;
  readonly history_empty: string;
  readonly history_week_format: string;
  readonly history_entry_format: string;
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
  readonly web_exit: WebExitConfig;
  readonly navigation: readonly NavigationConfig[];
  readonly actions: readonly WebActionConfig[];
  readonly action_groups: readonly ActionGroupConfig[];
  readonly texts: TextConfig;
}
