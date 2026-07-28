import type { SettlementNetworkTextConfig } from "../config/types";

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
  readonly tooltip_width: number;
  readonly tooltip_padding: number;
  readonly tooltip_offset_x: number;
  readonly tooltip_offset_y: number;
}

/** UI 层允许的姓名输入 HTML 类型。 */
export type NameInputHtmlTypeToken = "text";

/** UI 层向手机软键盘声明的姓名输入模式。 */
export type NameInputModeToken = "text";

/** UI 层可用的姓名输入确认键语义。 */
export type NameInputEnterKeyHintToken = "done" | "next";

/** UI 层可用的姓名自动填充策略。 */
export type NameInputAutocompleteToken = "off" | "name";

/** UI 层可用的姓名自动大写策略。 */
export type NameInputAutocapitalizeToken =
  | "none"
  | "sentences"
  | "words"
  | "characters";

/** UI 层的浏览器原生姓名输入配置。 */
export interface NativeNameInputTokens {
  readonly html_type: NameInputHtmlTypeToken;
  readonly input_mode: NameInputModeToken;
  readonly language: string;
  readonly enter_key_hint: NameInputEnterKeyHintToken;
  readonly autocomplete: NameInputAutocompleteToken;
  readonly autocapitalize: NameInputAutocapitalizeToken;
  readonly spellcheck: boolean;
}

/** UI 层开局页允许的稳定分类。 */
export type NewGameSetupCategoryTokenId =
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

/** UI 层允许的稳定游戏模式标识。 */
export type GameModeTokenId = "single" | "multiplayer" | "story" | "endless";

/** UI 层的配置化模式选项。 */
export interface NewGameModeOptionTokens {
  readonly id: GameModeTokenId;
  readonly label: string;
  readonly description: string;
}

/** UI 层的开局分类导航项。 */
export interface NewGameSetupCategoryTokens {
  readonly id: NewGameSetupCategoryTokenId;
  readonly label: string;
  readonly description: string;
}

/** 类银河策略式桌面开局三栏布局标尺。 */
export interface NewGameSetupDesktopTokens {
  readonly navigation_width: number;
  readonly option_list_width: number;
  readonly content_height: number;
  readonly summary_height: number;
  readonly panel_gap: number;
  readonly row_height: number;
  readonly panel_padding: number;
}

/** 手机开局分步流布局标尺。 */
export interface NewGameSetupMobileTokens {
  readonly step_header_height: number;
  readonly option_area_height: number;
  readonly preview_height: number;
  readonly summary_height: number;
  readonly row_height: number;
  readonly panel_padding: number;
  readonly step_navigation_tone: "default" | "muted";
  readonly step_navigation_accent_on_press: boolean;
}

/** 开局页不依赖领域数据的配置化文案。 */
export interface NewGameSetupCopyTokens {
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

/** UI 层的新游戏建档配置。 */
export interface GameNewGameSetupTokens {
  readonly name_input: NativeNameInputTokens;
  readonly preset_names: readonly string[];
  readonly mode_options: readonly NewGameModeOptionTokens[];
  readonly entry_mode_ids: readonly GameModeTokenId[];
  readonly categories: readonly NewGameSetupCategoryTokens[];
  readonly desktop: NewGameSetupDesktopTokens;
  readonly mobile: NewGameSetupMobileTokens;
  readonly copy: NewGameSetupCopyTokens;
}

/** UI 层的单个战术引导步骤。 */
export interface GuidedTutorialStepTokens {
  readonly id: string;
  readonly speaker: string;
  readonly title: string;
  readonly instruction: string;
  readonly target_test_id: string;
}

/** UI 层的分步战术引导配置。 */
export interface GuidedTutorialTokens {
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
  readonly steps: readonly GuidedTutorialStepTokens[];
}

/** UI 层的开局前教程位置提示。 */
export interface PreGameNoticeTokens {
  readonly title: string;
  readonly body: string;
  readonly continue_label: string;
  readonly tutorial_label: string;
}

/** UI 层的制作方开场 LOGO 配置。 */
export interface PublisherSplashTokens {
  readonly title: string;
  readonly background_asset: string;
  readonly background_opacity: number;
  readonly content_width: number;
  readonly title_height: number;
  readonly title_font_size: number;
}

/** 单个响应式封面菜单布局配置。 */
export interface CoverMenuLayoutTokens {
  readonly horizontal_alignment: "left" | "center" | "right";
  readonly vertical_alignment: "top" | "middle" | "bottom";
  readonly content_left: number;
  readonly content_top: number;
  readonly menu_top: number;
  readonly menu_bottom: number;
  readonly menu_width: number;
  readonly menu_columns: number;
  readonly menu_column_gap: number;
  readonly menu_row_gap: number;
  readonly menu_row_step_x: number;
  readonly button_shape: "rectangle" | "parallelogram";
  readonly use_button_skin: boolean;
  readonly pointer_tooltip_enabled: boolean;
  readonly settings_button_anchor: "left" | "right";
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

/** 封面桌面、手机与遮罩布局配置。 */
export interface CoverLayoutTokens {
  readonly desktop: CoverMenuLayoutTokens;
  readonly mobile: CoverMenuLayoutTokens;
  readonly mobile_landscape: CoverMenuLayoutTokens;
  readonly brand_divider_width: number;
  readonly brand_divider_accent_width: number;
  readonly brand_divider_height: number;
  readonly brand_divider_gap: number;
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
  readonly header_navigation_width: number;
  readonly header_navigation_anchor: "left" | "right";
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
  readonly header_navigation_width: number;
  readonly header_navigation_anchor: "left" | "right";
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

/**
 * 通用二级页面布局配置。
 */
export interface PageLayoutTokens {
  readonly max_content_width: number;
  readonly header_height: number;
  readonly footer_height: number;
  readonly footer_action_max_width: number;
  readonly body_padding: number;
  readonly option_gap: number;
  readonly desktop_option_columns: number;
  readonly mobile_option_columns: number;
}

/** ESC 功能菜单单个响应式变体的按钮布局与外观 token。 */
export interface EscMenuLayoutVariantTokens {
  readonly button_width: number;
  readonly button_row_gap: number;
  readonly button_row_step_x: number;
  readonly button_shape: "rectangle" | "parallelogram";
  readonly use_cover_button_skin: boolean;
  readonly accent_on_hover: boolean;
}

/** ESC 功能菜单各设备方向的独立响应式 token。 */
export interface EscMenuLayoutTokens {
  readonly desktop: EscMenuLayoutVariantTokens;
  readonly compact_portrait: EscMenuLayoutVariantTokens;
  readonly compact_landscape: EscMenuLayoutVariantTokens;
  readonly mobile_portrait: EscMenuLayoutVariantTokens;
  readonly mobile_landscape: EscMenuLayoutVariantTokens;
}

/**
 * UI 使用的完整布局配置。
 */
export interface GameLayoutTokens {
  readonly cover: CoverLayoutTokens;
  readonly desktop: DesktopLayoutTokens;
  readonly mobile: MobileLayoutTokens;
  readonly page: PageLayoutTokens;
  readonly esc_menu: EscMenuLayoutTokens;
}

/**
 * UI 使用的动效配置。
 */
export interface GameMotionTokens {
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
  readonly desktop_min_stage_width: number;
  readonly mobile_max_css_short_edge: number;
  readonly resize_debounce_ms: number;
  readonly keyboard_resize_settle_ms: number;
  readonly safe_area_fallback: SafeAreaInsets;
}

/**
 * UI 使用的配置化资源路径。
 */
export interface GameAssetTokens {
  readonly cover: string;
  readonly mobile_cover: string;
  readonly cover_width?: number;
  readonly cover_height?: number;
  readonly cover_themes: CoverThemesTokens;
  readonly skins: GameSkinTokens;
  readonly companion_portraits: CompanionPortraitCatalogTokens;
}

/** 伙伴立绘的推荐尺寸与可缺省资源映射。 */
export interface CompanionPortraitCatalogTokens {
  readonly recommended_width: number;
  readonly recommended_height: number;
  readonly items: Readonly<Record<string, string>>;
}

/** 封面主题决定作品标题是否由界面层绘制。 */
export type CoverBrandModeToken = "overlay" | "embedded";

/** 封面图片在当前断点采用填满裁切或完整包含。 */
export type CoverArtworkFitToken = "cover" | "contain";

/** 设置页与封面渲染器共享的一套主题资源。 */
export interface CoverThemeTokens {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly desktop_asset: string;
  readonly desktop_width: number;
  readonly desktop_height: number;
  readonly desktop_fit: CoverArtworkFitToken;
  readonly mobile_portrait_asset: string;
  readonly mobile_portrait_width: number;
  readonly mobile_portrait_height: number;
  readonly mobile_portrait_fit: CoverArtworkFitToken;
  readonly mobile_landscape_asset: string;
  readonly mobile_landscape_width: number;
  readonly mobile_landscape_height: number;
  readonly mobile_landscape_fit: CoverArtworkFitToken;
  readonly brand_mode: CoverBrandModeToken;
  readonly required_achievement_id: string | null;
  readonly unlock_description: string;
}

/** 可选择的主界面主题集合。 */
export interface CoverThemesTokens {
  readonly default_id: string;
  readonly items: readonly CoverThemeTokens[];
}

/** 可由美术轨道替换的可选皮肤路径。 */
export interface GameSkinTokens {
  readonly cover_button_idle: string;
  readonly cover_button_hover: string;
  readonly cover_button_pressed: string;
  readonly cover_button_disabled: string;
  readonly page_surface: string;
  readonly action_bar: string;
}

/** 浏览器关闭能力受限时采用的配置化策略。 */
export interface GameWebExitTokens {
  readonly strategy: "close_only" | "history_back" | "close_then_history_back";
  readonly history_back_steps: number;
  readonly verification_delay_ms: number;
}

/** 更新日志页面在网页启动时的展示策略。 */
export interface GameUpdateLogTokens {
  readonly auto_open: boolean;
}

/** 失败页强制结算倒计时与提示文案。 */
export interface GameFailureFlowTokens {
  readonly forced_return_delay_ms: number;
  readonly return_notice_format: string;
}

/** 局内导航允许出现的位置。 */
export type NavigationPlacementToken =
  | "mobile_bottom"
  | "mobile_header"
  | "desktop_header";

/** 局内导航允许出现的游戏模式。 */
export type NavigationModeToken = "single" | "multiplayer" | "story" | "endless";

/** 带位置和模式白名单的局内导航项。 */
export interface NavigationToken {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly placements: readonly NavigationPlacementToken[];
  readonly modes: readonly NavigationModeToken[];
}

/**
 * UI 使用的配置化文本。
 */
export interface GameTextTokens extends SettlementNetworkTextConfig {
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
  readonly expedition_retreat_confirm_title: string;
  readonly expedition_retreat_confirm_body: string;
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
  readonly exploration_branch_title_format: string;
  readonly exploration_branch_intro_format: string;
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
  readonly new_game_setup: GameNewGameSetupTokens;
  readonly guided_tutorial: GuidedTutorialTokens;
  readonly pre_game_notice: PreGameNoticeTokens;
  readonly publisher_splash: PublisherSplashTokens;
  readonly layout: GameLayoutTokens;
  readonly web_exit: GameWebExitTokens;
  readonly failure_flow: GameFailureFlowTokens;
  readonly update_log: GameUpdateLogTokens;
  readonly navigation: readonly NavigationToken[];
  readonly texts: GameTextTokens;
}

/**
 * 按语义返回按钮颜色，避免页面直接读取具体色值。
 */
export function resolveToneColor(
  theme: GameThemeTokens,
  tone: "default" | "muted" | "primary" | "success" | "warning" | "danger",
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
    case "muted":
      return theme.background_soft;
    default:
      return theme.secondary;
  }
}
