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

/** 封面设置键相对安全区的水平锚点。 */
export type CoverSettingsButtonAnchor = "left" | "right";

/** 指挥台标题栏导航在安全区内的水平锚点。 */
export type HeaderNavigationAnchor = "left" | "right";

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

/** 封面主题决定作品标题由界面叠加，还是已经嵌入图片。 */
export type CoverBrandMode = "overlay" | "embedded";

/** 封面资源在舞台内保持完整显示或填满裁切的缩放策略。 */
export type CoverArtworkFit = "cover" | "contain";

/** 一套可由成就解锁的响应式主界面封面。 */
export interface CoverThemeConfig {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly desktop_asset: string;
  readonly desktop_width: number;
  readonly desktop_height: number;
  readonly desktop_fit: CoverArtworkFit;
  readonly mobile_portrait_asset: string;
  readonly mobile_portrait_width: number;
  readonly mobile_portrait_height: number;
  readonly mobile_portrait_fit: CoverArtworkFit;
  readonly mobile_landscape_asset: string;
  readonly mobile_landscape_width: number;
  readonly mobile_landscape_height: number;
  readonly mobile_landscape_fit: CoverArtworkFit;
  readonly brand_mode: CoverBrandMode;
  readonly required_achievement_id: string | null;
  readonly unlock_description: string;
}

/** 主界面可选封面集合及其默认项。 */
export interface CoverThemesConfig {
  readonly default_id: string;
  readonly items: readonly CoverThemeConfig[];
}

/** 引擎直接使用的公共资源路径。 */
export interface AssetConfig {
  readonly cover: string;
  readonly mobile_cover: string;
  readonly cover_width: number;
  readonly cover_height: number;
  readonly cover_themes: CoverThemesConfig;
  readonly skins: SkinConfig;
  readonly companion_portraits: CompanionPortraitCatalogConfig;
}

/** 伙伴立绘的推荐尺寸与可缺省资源映射。 */
export interface CompanionPortraitCatalogConfig {
  readonly recommended_width: number;
  readonly recommended_height: number;
  readonly items: Readonly<Record<string, string>>;
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
  readonly publisher_logo_fade_in_ms: number;
  readonly publisher_logo_hold_ms: number;
  readonly publisher_logo_fade_out_ms: number;
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
  readonly tooltip_width: number;
  readonly tooltip_padding: number;
  readonly tooltip_offset_x: number;
  readonly tooltip_offset_y: number;
}

/** 姓名输入允许使用的 HTML 控件类型。 */
export type NameInputHtmlType = "text";

/** 姓名输入向手机键盘声明的输入模式。 */
export type NameInputMode = "text";

/** 姓名输入的软键盘确认键语义。 */
export type NameInputEnterKeyHint = "done" | "next";

/** 姓名输入可使用的浏览器自动填充策略。 */
export type NameInputAutocomplete = "off" | "name";

/** 姓名输入可使用的移动端自动大写策略。 */
export type NameInputAutocapitalize =
  | "none"
  | "sentences"
  | "words"
  | "characters";

/** 浏览器原生姓名输入的配置化属性。 */
export interface NativeNameInputConfig {
  readonly html_type: NameInputHtmlType;
  readonly input_mode: NameInputMode;
  readonly language: string;
  readonly enter_key_hint: NameInputEnterKeyHint;
  readonly autocomplete: NameInputAutocomplete;
  readonly autocapitalize: NameInputAutocapitalize;
  readonly spellcheck: boolean;
}

/** 开局配置页允许导航的稳定分类。 */
export type NewGameSetupCategoryId =
  | "name"
  | "mode"
  | "difficulty"
  | "origin"
  | "trait"
  | "secondary_trait"
  | "city"
  | "district"
  | "shelter"
  | "slot";

/** 配置化的游戏模式选项。 */
export interface NewGameModeOptionConfig {
  readonly id: NavigationGameMode;
  readonly label: string;
  readonly description: string;
}

/** 开局页单个分类的显示元数据。 */
export interface NewGameSetupCategoryConfig {
  readonly id: NewGameSetupCategoryId;
  readonly label: string;
  readonly description: string;
}

/** 开局页桌面三栏与底部摘要布局标尺。 */
export interface NewGameSetupDesktopLayoutConfig {
  readonly navigation_width: number;
  readonly option_list_width: number;
  readonly content_height: number;
  readonly summary_height: number;
  readonly panel_gap: number;
  readonly row_height: number;
  readonly panel_padding: number;
}

/** 开局页手机分步布局标尺。 */
export interface NewGameSetupMobileLayoutConfig {
  readonly step_header_height: number;
  readonly option_area_height: number;
  readonly preview_height: number;
  readonly summary_height: number;
  readonly row_height: number;
  readonly panel_padding: number;
}

/** 开局页自身使用的配置化文案。 */
export interface NewGameSetupCopyConfig {
  readonly navigation_title: string;
  readonly option_list_title: string;
  readonly preview_title: string;
  readonly summary_title: string;
  readonly summary_format: string;
  readonly step_format: string;
  readonly previous_step: string;
  readonly next_step: string;
  readonly selected_mark: string;
  readonly incompatible_mark: string;
  readonly name_description: string;
  readonly unavailable_mode: string;
}

/** 新游戏建档页使用的姓名、模式和响应式布局配置。 */
export interface NewGameSetupConfig {
  readonly name_input: NativeNameInputConfig;
  readonly preset_names: readonly string[];
  readonly mode_options: readonly NewGameModeOptionConfig[];
  readonly entry_mode_ids: readonly NavigationGameMode[];
  readonly categories: readonly NewGameSetupCategoryConfig[];
  readonly desktop: NewGameSetupDesktopLayoutConfig;
  readonly mobile: NewGameSetupMobileLayoutConfig;
  readonly copy: NewGameSetupCopyConfig;
}

/** 单个战术引导步骤的配置。 */
export interface GuidedTutorialStepConfig {
  readonly id: string;
  readonly speaker: string;
  readonly title: string;
  readonly instruction: string;
  readonly target_test_id: string;
}

/** 通讯式分步引导页的文案与布局配置。 */
export interface GuidedTutorialConfig {
  readonly title: string;
  readonly step_format: string;
  readonly page_format: string;
  readonly page_separator: string;
  readonly previous_label: string;
  readonly previous_page_label: string;
  readonly next_label: string;
  readonly next_page_label: string;
  readonly complete_label: string;
  readonly skip_label: string;
  readonly missing_target_label: string;
  readonly header_step_width_ratio: number;
  readonly spotlight_padding: number;
  readonly spotlight_border_width: number;
  readonly dialog_panel_padding: number;
  readonly dialog_target_gap: number;
  readonly desktop_dialog_width: number;
  readonly desktop_dialog_height: number;
  readonly mobile_dialog_height: number;
  readonly minimum_page_fill_ratio: number;
  readonly fallback_target_width: number;
  readonly fallback_target_height: number;
  readonly steps: readonly GuidedTutorialStepConfig[];
}

/** 开局前的新手教程位置提示配置。 */
export interface PreGameNoticeConfig {
  readonly title: string;
  readonly body: string;
  readonly continue_label: string;
  readonly tutorial_label: string;
}

/** 制作方开场 LOGO 的文案、资源与几何配置。 */
export interface PublisherSplashConfig {
  readonly title: string;
  readonly background_asset: string;
  readonly background_opacity: number;
  readonly content_width: number;
  readonly title_height: number;
  readonly title_font_size: number;
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
  readonly settings_button_anchor: CoverSettingsButtonAnchor;
  readonly settings_button_offset: number;
  readonly settings_button_top: number;
  readonly settings_button_width: number;
  readonly settings_button_height: number;
  readonly changelog_button_right: number;
  readonly changelog_button_bottom: number;
  readonly changelog_button_width: number;
  readonly changelog_button_height: number;
  readonly utility_button_gap: number;
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
  readonly header_navigation_anchor: HeaderNavigationAnchor;
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
  readonly header_navigation_anchor: HeaderNavigationAnchor;
  readonly bottom_navigation_height: number;
  readonly panel_padding: number;
  readonly section_gap: number;
  readonly mission_height: number;
  readonly resource_bar_height: number;
  readonly quick_action_columns: number;
  readonly sheet_top_margin: number;
  readonly log_preview_height: number;
  readonly log_preview_entries: number;
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

/** ESC 功能菜单单个响应式变体的按钮布局与外观策略。 */
export interface EscMenuLayoutVariantConfig {
  readonly button_width: number;
  readonly button_row_gap: number;
  readonly button_row_step_x: number;
  readonly button_shape: "rectangle" | "parallelogram";
  readonly use_cover_button_skin: boolean;
  readonly accent_on_hover: boolean;
}

/** ESC 功能菜单在各响应式场景下的独立布局配置。 */
export interface EscMenuLayoutConfig {
  readonly desktop: EscMenuLayoutVariantConfig;
  readonly compact_portrait: EscMenuLayoutVariantConfig;
  readonly compact_landscape: EscMenuLayoutVariantConfig;
  readonly mobile_portrait: EscMenuLayoutVariantConfig;
  readonly mobile_landscape: EscMenuLayoutVariantConfig;
}

/** H5 全局布局配置。 */
export interface LayoutConfig {
  readonly cover: CoverLayoutConfig;
  readonly desktop: DesktopLayoutConfig;
  readonly mobile: MobileLayoutConfig;
  readonly page: PageLayoutConfig;
  readonly esc_menu: EscMenuLayoutConfig;
}

/** 浏览器本地存档策略。 */
export interface StorageConfig {
  readonly key: string;
  readonly settings_key: string;
  readonly settings_schema_version: number;
  readonly achievement_key: string;
  readonly achievement_schema_version: number;
  readonly schema_version: number;
  readonly auto_save: boolean;
  readonly backup_slots: number;
  readonly save_slot_count: number;
}

/** 更新日志的自动展示策略。 */
export interface UpdateLogConfig {
  readonly auto_open: boolean;
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
export type NavigationGameMode = "single" | "multiplayer" | "story" | "endless";

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

/** 指挥台行动到经营分类的配置化快捷路由。 */
export interface ManagementCategoryShortcutConfig {
  readonly entry_id: string;
  readonly category_id: string;
}

/** 指挥台导航的可扩展配置。 */
export interface DashboardNavigationConfig {
  readonly management_category_shortcuts: readonly ManagementCategoryShortcutConfig[];
}

/** 城市侦察与分避难所页面的完整配置化文案。 */
export interface SettlementNetworkTextConfig {
  readonly settlement_network_title: string;
  readonly settlement_network_body: string;
  readonly settlement_network_no_missions: string;
  readonly settlement_network_mission_count: string;
  readonly settlement_network_no_outposts: string;
  readonly settlement_network_outpost_count: string;
  readonly settlement_network_start_recon: string;
  readonly settlement_network_start_recon_description: string;
  readonly settlement_network_build_outpost: string;
  readonly settlement_network_build_outpost_description: string;
  readonly settlement_network_outpost_limit: string;
  readonly settlement_network_mission_format: string;
  readonly settlement_network_mission_ready: string;
  readonly settlement_network_mission_progress: string;
  readonly settlement_network_outpost_format: string;
  readonly settlement_network_outpost_summary: string;
  readonly settlement_recon_city_title: string;
  readonly settlement_recon_city_body: string;
  readonly settlement_recon_city_format: string;
  readonly settlement_recon_city_detail: string;
  readonly settlement_recon_companion_title: string;
  readonly settlement_recon_companion_body: string;
  readonly settlement_recon_companion_format: string;
  readonly settlement_recon_no_companion: string;
  readonly settlement_city_status_unlocked: string;
  readonly settlement_city_status_active: string;
  readonly settlement_city_status_available: string;
  readonly settlement_city_status_locked: string;
  readonly settlement_recon_transport_ready: string;
  readonly settlement_recon_transport_locked: string;
  readonly settlement_recon_already_unlocked: string;
  readonly settlement_recon_already_active: string;
  readonly settlement_recon_need_intelligence: string;
  readonly settlement_recon_need_transport: string;
  readonly settlement_recon_need_companion: string;
  readonly outpost_build_city_title: string;
  readonly outpost_build_city_body: string;
  readonly outpost_build_city_format: string;
  readonly outpost_build_city_locked: string;
  readonly outpost_build_city_full: string;
  readonly outpost_build_district_title: string;
  readonly outpost_build_district_body: string;
  readonly outpost_build_district_occupied: string;
  readonly outpost_build_type_title: string;
  readonly outpost_build_location_format: string;
  readonly outpost_build_type_body: string;
  readonly outpost_build_type_format: string;
  readonly outpost_detail_title: string;
  readonly outpost_detail_title_format: string;
  readonly outpost_detail_body: string;
  readonly outpost_detail_no_companion: string;
  readonly outpost_assign_companion: string;
  readonly outpost_assign_companion_description: string;
  readonly outpost_recall_companion_format: string;
  readonly outpost_recall_companion_description: string;
  readonly outpost_supply: string;
  readonly outpost_supply_ready: string;
  readonly outpost_supply_waiting: string;
  readonly outpost_assign_title: string;
  readonly outpost_assign_location_format: string;
  readonly outpost_assign_body: string;
  readonly outpost_assign_no_companion: string;
  readonly outpost_assign_companion_format: string;
}

/** H5 界面文案。 */
export interface TextConfig extends SettlementNetworkTextConfig {
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
  readonly credits_body: string;
  readonly account_login: string;
  readonly account_unavailable_title: string;
  readonly account_unavailable_body: string;
  readonly store: string;
  readonly store_title: string;
  readonly store_empty_body: string;
  readonly text_records: string;
  readonly text_records_title: string;
  readonly text_records_empty_body: string;
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
  readonly settings_cover_theme: string;
  readonly settings_cover_theme_description: string;
  readonly cover_theme_title: string;
  readonly cover_theme_body: string;
  readonly cover_theme_selected_description: string;
  readonly cover_theme_description_separator: string;
  readonly settings_tutorial: string;
  readonly settings_tutorial_description: string;
  readonly settings_return_menu: string;
  readonly settings_return_menu_description: string;
  readonly return_menu_confirm_title: string;
  readonly return_menu_confirm_body: string;
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
  readonly transport_title: string;
  readonly transport_body: string;
  readonly transport_item_format: string;
  readonly transport_detail_format: string;
  readonly transport_equipped: string;
  readonly transport_available: string;
  readonly transport_unavailable: string;
  readonly research_title: string;
  readonly research_body: string;
  readonly research_slot_empty: string;
  readonly research_slot_filled_format: string;
  readonly research_slot_candidate_format: string;
  readonly research_slot_candidate_detail_format: string;
  readonly research_slot_clear: string;
  readonly research_sample_format: string;
  readonly research_source_format: string;
  readonly research_sample_slotted: string;
  readonly research_sample_not_slotted: string;
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
  readonly expedition_city_list_title: string;
  readonly expedition_city_list_body: string;
  readonly expedition_city_detail_confirm: string;
  readonly expedition_district_list_title: string;
  readonly expedition_district_list_body: string;
  readonly expedition_district_detail_confirm: string;
  readonly expedition_detail_fields_title: string;
  readonly expedition_detail_requirements_title: string;
  readonly expedition_detail_field_format: string;
  readonly expedition_detail_requirement_format: string;
  readonly expedition_requirement_met: string;
  readonly expedition_requirement_unmet: string;
  readonly expedition_requirement_informational: string;
  readonly expedition_field_neighbors: string;
  readonly expedition_field_relation: string;
  readonly expedition_field_terrain: string;
  readonly expedition_field_travel_steps: string;
  readonly expedition_field_intelligence: string;
  readonly expedition_field_path_items: string;
  readonly expedition_field_transport_items: string;
  readonly expedition_field_danger: string;
  readonly expedition_field_event_steps: string;
  readonly expedition_field_events: string;
  readonly expedition_access_requirement: string;
  readonly expedition_district_requirement: string;
  readonly expedition_empty_value: string;
  readonly expedition_city_title: string;
  readonly expedition_companion_title: string;
  readonly expedition_item_title: string;
  readonly expedition_city_format: string;
  readonly expedition_companion_format: string;
  readonly expedition_item_format: string;
  readonly expedition_item_increase: string;
  readonly expedition_item_decrease: string;
  readonly expedition_selected: string;
  readonly expedition_unselected: string;
  readonly expedition_unknown_item: string;
  readonly expedition_begin: string;
  readonly expedition_status_title: string;
  readonly expedition_status_format: string;
  readonly exploration_location_format: string;
  readonly expedition_loot_format: string;
  readonly expedition_continue: string;
  readonly expedition_safe_return: string;
  readonly history_title: string;
  readonly history_empty: string;
  readonly history_week_format: string;
  readonly history_entry_format: string;
  readonly archive_storage_title: string;
  readonly archive_storage_body: string;
  readonly archive_storage_empty: string;
  readonly archive_collected_format: string;
  readonly archive_unlocked_format: string;
  readonly archive_open_collection: string;
  readonly archive_open_document: string;
  readonly archive_locked_document: string;
  readonly archive_requirement_format: string;
  readonly archive_document_metadata_format: string;
  readonly encounter_catalog_title: string;
  readonly encounter_catalog_body: string;
  readonly encounter_catalog_empty: string;
  readonly encounter_roster_format: string;
  readonly encounter_threat_format: string;
  readonly encounter_start: string;
  readonly encounter_unavailable: string;
  readonly encounter_preparation_title_format: string;
  readonly encounter_preparation_body: string;
  readonly encounter_preparation_supply_format: string;
  readonly encounter_preparation_roster_title: string;
  readonly encounter_preparation_assignment_required: string;
  readonly encounter_preparation_ready: string;
  readonly encounter_preparation_medical_shortage: string;
  readonly encounter_preparation_attribute_format: string;
  readonly encounter_preparation_role_unassigned: string;
  readonly encounter_preparation_role_format: string;
  readonly encounter_preparation_role_effect_format: string;
  readonly encounter_preparation_treatment: string;
  readonly encounter_preparation_treatment_cancel: string;
  readonly encounter_preparation_treatment_selected: string;
  readonly encounter_preparation_treatment_full: string;
  readonly encounter_preparation_treatment_available: string;
  readonly encounter_preparation_treatment_unavailable: string;
  readonly encounter_preparation_start: string;
  readonly encounter_round_format: string;
  readonly encounter_outcome_ongoing: string;
  readonly encounter_outcome_victory: string;
  readonly encounter_outcome_defeat: string;
  readonly encounter_outcome_retreated: string;
  readonly encounter_instruction: string;
  readonly encounter_party_title: string;
  readonly encounter_enemy_title: string;
  readonly encounter_row_front: string;
  readonly encounter_row_back: string;
  readonly encounter_empty_party: string;
  readonly encounter_empty_enemy: string;
  readonly encounter_intent_title: string;
  readonly encounter_empty_intent: string;
  readonly encounter_pending_title: string;
  readonly encounter_pending_format: string;
  readonly encounter_action_title: string;
  readonly encounter_empty_action: string;
  readonly encounter_action_detail_format: string;
  readonly encounter_target_title: string;
  readonly encounter_empty_target: string;
  readonly encounter_target_format: string;
  readonly encounter_log_title: string;
  readonly encounter_empty_log: string;
  readonly encounter_execute: string;
  readonly encounter_finish: string;
  readonly encounter_health_format: string;
  readonly encounter_status_pending: string;
  readonly encounter_status_acted: string;
  readonly encounter_status_guarding: string;
  readonly encounter_status_down: string;
  readonly encounter_action_available: string;
  readonly encounter_action_unavailable: string;
  readonly encounter_action_attack: string;
  readonly encounter_action_guard: string;
  readonly encounter_action_skill: string;
  readonly encounter_action_item: string;
  readonly encounter_action_retreat: string;
  readonly return_incident_choice_title: string;
  readonly return_incident_empty: string;
  readonly return_incident_defer: string;
  readonly return_incident_requirement_met: string;
  readonly return_incident_result_preview: string;
  readonly option_intelligence_title: string;
  readonly option_intelligence_format: string;
  readonly option_intelligence_separator: string;
  readonly update_log: string;
  readonly update_log_title: string;
  readonly update_log_body: string;
  readonly profile_setup_title: string;
  readonly profile_setup_body: string;
  readonly profile_name_label: string;
  readonly profile_name_preset_format: string;
  readonly profile_mode_label: string;
  readonly profile_difficulty_label: string;
  readonly profile_origin_label: string;
  readonly profile_trait_label: string;
  readonly profile_secondary_trait_label: string;
  readonly profile_city_label: string;
  readonly profile_district_label: string;
  readonly profile_shelter_type_label: string;
  readonly profile_shelter_detail_format: string;
  readonly profile_shelter_bonus_separator: string;
  readonly profile_slot_label: string;
  readonly profile_field_format: string;
  readonly profile_field_separator: string;
  readonly save_slots_title: string;
  readonly save_slots_load_body: string;
  readonly save_slots_save_body: string;
  readonly save_slot_title_format: string;
  readonly save_slot_details_format: string;
  readonly save_slot_empty_details: string;
  readonly save_slot_corrupted_details: string;
  readonly save_slot_unknown_value: string;
  readonly save_slot_status_empty: string;
  readonly save_slot_status_valid: string;
  readonly save_slot_status_recoverable: string;
  readonly save_slot_status_corrupted: string;
  readonly save_slot_name_separator: string;
  readonly companion_archive_title: string;
  readonly companion_archive_body: string;
  readonly companion_detail_title: string;
  readonly companion_equipment: string;
  readonly companion_equipment_title: string;
  readonly companion_weapon: string;
  readonly companion_armor: string;
  readonly companion_empty_slot: string;
  readonly companion_unequip: string;
  readonly companion_equipment_quantity_format: string;
  readonly companion_equipment_unowned: string;
  readonly companion_interaction: string;
  readonly companion_interaction_title: string;
  readonly companion_secret_locked: string;
  readonly companion_portrait_unavailable: string;
  readonly companion_portrait_signal_format: string;
  readonly companion_status_format: string;
  readonly companion_equipment_format: string;
  readonly companion_interaction_cooldown_format: string;
  readonly management_detail_title: string;
  readonly management_detail_requirements_title: string;
  readonly management_detail_confirm: string;
  readonly management_repetition_cycle_format: string;
  readonly management_repetition_confirm_format: string;
  readonly shelter_wall_summary_format: string;
  readonly communication_log_title: string;
  readonly communication_log_open: string;
  readonly communication_log_empty: string;
  readonly expedition_failure_title: string;
  readonly expedition_failure_reason_format: string;
  readonly expedition_failure_health_format: string;
  readonly expedition_failure_summary_format: string;
  readonly expedition_failure_carried_title: string;
  readonly expedition_failure_loot_title: string;
  readonly expedition_failure_item_format: string;
  readonly expedition_failure_continue: string;
  readonly expedition_step_warning: string;
  readonly expedition_failure_steps_reason: string;
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
  readonly new_game_setup: NewGameSetupConfig;
  readonly guided_tutorial: GuidedTutorialConfig;
  readonly pre_game_notice: PreGameNoticeConfig;
  readonly publisher_splash: PublisherSplashConfig;
  readonly layout: LayoutConfig;
  readonly storage: StorageConfig;
  readonly update_log: UpdateLogConfig;
  readonly web_exit: WebExitConfig;
  readonly navigation: readonly NavigationConfig[];
  readonly actions: readonly WebActionConfig[];
  readonly action_groups: readonly ActionGroupConfig[];
  readonly dashboard_navigation: DashboardNavigationConfig;
  readonly texts: TextConfig;
}
