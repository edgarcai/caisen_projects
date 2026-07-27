import type {
  ActionGroupConfig,
  AssetConfig,
  CoverThemeConfig,
  CoverThemesConfig,
  CoverMenuLayoutConfig,
  ControlConfig,
  EngineConfig,
  GuidedTutorialConfig,
  LayoutConfig,
  MotionConfig,
  NavigationConfig,
  NewGameSetupConfig,
  NewGameSetupCategoryId,
  PreGameNoticeConfig,
  PublisherSplashConfig,
  QualityViewport,
  ResponsiveConfig,
  SafeAreaInsets,
  StorageConfig,
  TextConfig,
  ThemeConfig,
  TypographyConfig,
  UpdateLogConfig,
  WebActionConfig,
  WebExitConfig,
  WebGameConfig,
} from "./types";
import { isSaveStorageNamespaceKey } from "../infrastructure/SaveStorageKeys";

type JsonObject = Readonly<Record<string, unknown>>;
type ConfigFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const CONFIG_META_NAME = "game-config";
const SUPPORTED_SCHEMA_VERSION = 1;
const SCALE_MODES = [
  "noscale",
  "showall",
  "noborder",
  "full",
  "fixedwidth",
  "fixedheight",
  "fixedauto",
] as const;
const SCREEN_MODES = ["none", "horizontal", "vertical"] as const;
const HORIZONTAL_ALIGNMENTS = ["left", "center", "right"] as const;
const VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"] as const;
const COVER_SETTINGS_BUTTON_ANCHORS = ["left", "right"] as const;
const HEADER_NAVIGATION_ANCHORS = ["left", "right"] as const;
const FRAME_MODES = ["fast", "slow", "mouse", "sleep"] as const;
const NAVIGATION_PLACEMENTS = [
  "mobile_bottom",
  "mobile_header",
  "desktop_header",
] as const;
const NAVIGATION_GAME_MODES = [
  "single",
  "multiplayer",
  "story",
  "endless",
] as const;
const WEB_EXIT_STRATEGIES = [
  "close_only",
  "history_back",
  "close_then_history_back",
] as const;
const COVER_BRAND_MODES = ["overlay", "embedded"] as const;
const COVER_ARTWORK_FITS = ["cover", "contain"] as const;
const NAME_INPUT_HTML_TYPES = ["text"] as const;
const NAME_INPUT_MODES = ["text"] as const;
const NAME_INPUT_ENTER_KEY_HINTS = ["done", "next"] as const;
const NAME_INPUT_AUTOCOMPLETE_VALUES = ["off", "name"] as const;
const NAME_INPUT_AUTOCAPITALIZE_VALUES = [
  "none",
  "sentences",
  "words",
  "characters",
] as const;
const NEW_GAME_SETUP_CATEGORIES = [
  "name",
  "mode",
  "difficulty",
  "origin",
  "trait",
  "city",
  "slot",
] as const satisfies readonly NewGameSetupCategoryId[];

const SKIN_KEYS = [
  "cover_button_idle",
  "cover_button_hover",
  "cover_button_pressed",
  "cover_button_disabled",
  "page_surface",
  "action_bar",
] as const;

const THEME_KEYS = [
  "background",
  "background_soft",
  "panel",
  "panel_elevated",
  "panel_translucent",
  "primary",
  "primary_hover",
  "primary_pressed",
  "on_primary",
  "secondary",
  "secondary_hover",
  "danger",
  "text",
  "muted_text",
  "accent",
  "health",
  "hunger",
  "warning",
  "error",
  "border",
  "border_active",
  "overlay",
  "scrim",
] as const;
const TYPOGRAPHY_NUMBER_KEYS = [
  "cover_title_size",
  "cover_subtitle_size",
  "page_title_size",
  "section_title_size",
  "body_size",
  "body_line_height",
  "control_size",
  "caption_size",
  "stat_size",
] as const;
const CONTROL_KEYS = [
  "minimum_touch_size",
  "button_height",
  "compact_button_height",
  "button_slant",
  "button_gap",
  "button_horizontal_padding",
  "max_player_name_characters",
  "focus_border_width",
  "scroll_step",
  "drag_threshold",
  "tooltip_width",
  "tooltip_padding",
  "tooltip_offset_x",
  "tooltip_offset_y",
] as const;
const COVER_LAYOUT_KEYS = [
  "content_left",
  "content_top",
  "menu_top",
  "menu_bottom",
  "menu_width",
  "menu_columns",
  "menu_column_gap",
  "menu_row_gap",
  "menu_row_step_x",
  "settings_button_offset",
  "settings_button_top",
  "settings_button_width",
  "settings_button_height",
  "changelog_button_right",
  "changelog_button_bottom",
  "changelog_button_width",
  "changelog_button_height",
  "description_left",
  "description_top",
  "description_width",
  "description_height",
] as const;
const DESKTOP_LAYOUT_KEYS = [
  "outer_padding",
  "header_height",
  "header_navigation_width",
  "left_rail_width",
  "right_rail_width",
  "column_gap",
  "panel_padding",
  "section_gap",
  "bottom_bar_height",
  "mission_height",
  "log_min_height",
] as const;
const MOBILE_LAYOUT_KEYS = [
  "outer_padding",
  "header_height",
  "header_navigation_width",
  "bottom_navigation_height",
  "panel_padding",
  "section_gap",
  "mission_height",
  "resource_bar_height",
  "quick_action_columns",
  "sheet_top_margin",
  "log_preview_height",
  "log_preview_entries",
] as const;
const PAGE_LAYOUT_KEYS = [
  "max_content_width",
  "header_height",
  "footer_height",
  "footer_action_max_width",
  "body_padding",
  "option_gap",
  "desktop_option_columns",
  "mobile_option_columns",
] as const;
const TEXT_KEYS = [
  "loading",
  "load_failed",
  "connection_title",
  "start_single",
  "start_load",
  "start_multiplayer",
  "start_story",
  "credits",
  "exit",
  "start_single_description",
  "start_load_description",
  "start_multiplayer_description",
  "start_story_description",
  "credits_description",
  "exit_description",
  "name_submit",
  "back",
  "continue",
  "confirm",
  "cancel",
  "close",
  "save",
  "save_description",
  "no_save",
  "auto_saved",
  "storage_unavailable",
  "portrait_hint",
  "offline_ready",
  "function_menu_title",
  "function_menu_body",
  "settings",
  "settings_description",
  "rollback",
  "rollback_description",
  "settings_title",
  "settings_body",
  "settings_cover_theme",
  "settings_cover_theme_description",
  "cover_theme_title",
  "cover_theme_body",
  "cover_theme_selected_description",
  "cover_theme_description_separator",
  "settings_tutorial",
  "settings_tutorial_description",
  "settings_return_menu",
  "settings_return_menu_description",
  "reduced_motion_description",
  "reduced_motion_on",
  "reduced_motion_off",
  "rollback_title",
  "rollback_body",
  "exit_title",
  "exit_body",
  "exit_failed_title",
  "exit_failed_body",
  "warehouse_title",
  "warehouse_body",
  "warehouse_item_format",
  "warehouse_detail_format",
  "warehouse_equip",
  "warehouse_not_equippable",
  "research_title",
  "research_body",
  "research_item_format",
  "research_detail_format",
  "research_complete",
  "research_completed",
  "research_locked",
  "crafting_title",
  "crafting_body",
  "crafting_item_format",
  "crafting_detail_format",
  "crafting_action",
  "crafting_locked",
  "expedition_prepare_title",
  "expedition_prepare_body",
  "expedition_city_list_title",
  "expedition_city_list_body",
  "expedition_city_detail_confirm",
  "expedition_district_list_title",
  "expedition_district_list_body",
  "expedition_district_detail_confirm",
  "expedition_detail_fields_title",
  "expedition_detail_requirements_title",
  "expedition_detail_field_format",
  "expedition_detail_requirement_format",
  "expedition_requirement_met",
  "expedition_requirement_unmet",
  "expedition_requirement_informational",
  "expedition_field_neighbors",
  "expedition_field_relation",
  "expedition_field_terrain",
  "expedition_field_travel_steps",
  "expedition_field_intelligence",
  "expedition_field_path_items",
  "expedition_field_transport_items",
  "expedition_field_danger",
  "expedition_field_event_steps",
  "expedition_field_events",
  "expedition_access_requirement",
  "expedition_district_requirement",
  "expedition_empty_value",
  "expedition_city_title",
  "expedition_companion_title",
  "expedition_item_title",
  "expedition_city_format",
  "expedition_companion_format",
  "expedition_item_format",
  "expedition_selected",
  "expedition_unselected",
  "expedition_unknown_item",
  "expedition_begin",
  "expedition_status_title",
  "expedition_status_format",
  "exploration_location_format",
  "expedition_loot_format",
  "expedition_continue",
  "expedition_safe_return",
  "history_title",
  "history_empty",
  "history_week_format",
  "history_entry_format",
  "option_intelligence_title",
  "option_intelligence_format",
  "update_log",
  "update_log_title",
  "update_log_body",
  "profile_setup_title",
  "profile_setup_body",
  "profile_name_label",
  "profile_name_preset_format",
  "profile_mode_label",
  "profile_difficulty_label",
  "profile_origin_label",
  "profile_trait_label",
  "profile_city_label",
  "profile_slot_label",
  "profile_field_format",
  "profile_field_separator",
  "save_slots_title",
  "save_slots_load_body",
  "save_slots_save_body",
  "save_slot_title_format",
  "save_slot_details_format",
  "save_slot_empty_details",
  "save_slot_corrupted_details",
  "save_slot_unknown_value",
  "save_slot_status_empty",
  "save_slot_status_valid",
  "save_slot_status_recoverable",
  "save_slot_status_corrupted",
  "save_slot_name_separator",
  "companion_archive_title",
  "companion_archive_body",
  "companion_detail_title",
  "companion_management",
  "companion_management_title",
  "companion_management_body",
  "companion_equipment",
  "companion_equipment_title",
  "companion_weapon",
  "companion_armor",
  "companion_unequip",
  "companion_interaction",
  "companion_interaction_title",
  "companion_locked_management",
  "companion_secret_locked",
  "companion_portrait_unavailable",
  "companion_portrait_signal_format",
  "companion_status_format",
  "companion_equipment_format",
  "companion_interaction_cooldown_format",
  "management_detail_title",
  "management_detail_requirements_title",
  "management_detail_confirm",
  "communication_log_title",
  "communication_log_open",
  "communication_log_empty",
  "expedition_failure_title",
  "expedition_failure_reason_format",
  "expedition_failure_health_format",
  "expedition_failure_summary_format",
  "expedition_failure_carried_title",
  "expedition_failure_loot_title",
  "expedition_failure_item_format",
  "expedition_failure_continue",
  "expedition_step_warning",
  "expedition_failure_steps_reason",
] as const;

/** 表示 H5 配置无法加载或不符合契约。 */
export class WebConfigError extends Error {
  /** 创建带稳定名称的配置异常。 */
  public constructor(message: string) {
    super(message);
    this.name = "WebConfigError";
  }
}

/** 调用浏览器 Fetch API，并保持一个可注入的函数边界。 */
const defaultFetcher: ConfigFetcher = (input, init) => globalThis.fetch(input, init);

/** 确保指定配置值是 JSON 对象。 */
function expectObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WebConfigError(`${path} 必须是对象`);
  }
  return value as JsonObject;
}

/** 读取非空字符串配置项。 */
function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WebConfigError(`${path} 必须是非空字符串`);
  }
  return value;
}

/** 读取允许为空的可选资源路径，非字符串仍立即失败。 */
function expectOptionalString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new WebConfigError(`${path} 必须是字符串`);
  }
  return value.trim();
}

/** 读取允许为 null 的非空字符串配置。 */
function expectNullableString(value: unknown, path: string): string | null {
  return value === null ? null : expectString(value, path);
}

/** 读取允许由空白符组成、但原始长度必须大于零的字符串配置项。 */
function expectPresentString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WebConfigError(`${path} 必须是长度大于零的字符串`);
  }
  return value;
}

/** 读取有限且不小于下限的数值配置项。 */
function expectNumber(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new WebConfigError(
      `${path} 必须是不小于 ${String(minimum)} 的有限数值`,
    );
  }
  return value;
}

/** 读取不小于下限的整数配置项。 */
function expectInteger(value: unknown, path: string, minimum = 0): number {
  const numberValue = expectNumber(value, path, minimum);
  if (!Number.isInteger(numberValue)) {
    throw new WebConfigError(`${path} 必须是整数`);
  }
  return numberValue;
}

/** 读取位于零到一闭区间内的比例配置。 */
function expectRatio(value: unknown, path: string): number {
  const ratio = expectNumber(value, path);
  if (ratio > 1) {
    throw new WebConfigError(`${path} 必须位于 0 到 1 之间`);
  }
  return ratio;
}

/** 读取严格位于零到一之间的分栏比例，避免任一栏宽度归零。 */
function expectSplitRatio(value: unknown, path: string): number {
  const ratio = expectRatio(value, path);
  if (ratio <= 0 || ratio >= 1) {
    throw new WebConfigError(`${path} 必须严格位于 0 到 1 之间`);
  }
  return ratio;
}

/** 读取布尔配置项。 */
function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new WebConfigError(`${path} 必须是布尔值`);
  }
  return value;
}

/** 读取数组配置项。 */
function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new WebConfigError(`${path} 必须是数组`);
  }
  return value;
}

/** 读取受限枚举字符串。 */
function expectEnum<const TValues extends readonly string[]>(
  value: unknown,
  supportedValues: TValues,
  path: string,
): TValues[number] {
  const stringValue = expectString(value, path);
  if (!supportedValues.includes(stringValue)) {
    throw new WebConfigError(
      `${path} 必须是 ${supportedValues.join(" / ")} 之一`,
    );
  }
  return stringValue;
}

/** 按给定键集读取字符串映射。 */
function readStringFields<const TKeys extends readonly string[]>(
  source: JsonObject,
  keys: TKeys,
  path: string,
): Readonly<Record<TKeys[number], string>> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = expectString(source[key], `${path}.${key}`);
  }
  return result as Readonly<Record<TKeys[number], string>>;
}

/** 按给定键集读取允许为空的可选字符串映射。 */
function readOptionalStringFields<const TKeys extends readonly string[]>(
  source: JsonObject,
  keys: TKeys,
  path: string,
): Readonly<Record<TKeys[number], string>> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = expectOptionalString(source[key], `${path}.${key}`);
  }
  return result as Readonly<Record<TKeys[number], string>>;
}

/** 按给定键集读取非负数值映射。 */
function readNumberFields<const TKeys extends readonly string[]>(
  source: JsonObject,
  keys: TKeys,
  path: string,
): Readonly<Record<TKeys[number], number>> {
  const result: Record<string, number> = {};
  for (const key of keys) {
    result[key] = expectNumber(source[key], `${path}.${key}`);
  }
  return result as Readonly<Record<TKeys[number], number>>;
}

/** 把外部引擎配置解析为受限的内部契约。 */
function parseEngine(value: unknown): EngineConfig {
  const source = expectObject(value, "engine");
  return {
    name: expectString(source.name, "engine.name"),
    version: expectString(source.version, "engine.version"),
    design_width: expectInteger(source.design_width, "engine.design_width", 1),
    design_height: expectInteger(source.design_height, "engine.design_height", 1),
    mobile_design_width: expectInteger(
      source.mobile_design_width,
      "engine.mobile_design_width",
      1,
    ),
    mobile_design_height: expectInteger(
      source.mobile_design_height,
      "engine.mobile_design_height",
      1,
    ),
    scale_mode: expectEnum(
      source.scale_mode,
      SCALE_MODES,
      "engine.scale_mode",
    ),
    desktop_screen_mode: expectEnum(
      source.desktop_screen_mode,
      SCREEN_MODES,
      "engine.desktop_screen_mode",
    ),
    mobile_screen_mode: expectEnum(
      source.mobile_screen_mode,
      SCREEN_MODES,
      "engine.mobile_screen_mode",
    ),
    align_horizontal: expectEnum(
      source.align_horizontal,
      HORIZONTAL_ALIGNMENTS,
      "engine.align_horizontal",
    ),
    align_vertical: expectEnum(
      source.align_vertical,
      VERTICAL_ALIGNMENTS,
      "engine.align_vertical",
    ),
    retina_canvas: expectBoolean(source.retina_canvas, "engine.retina_canvas"),
    active_frame_mode: expectEnum(
      source.active_frame_mode,
      FRAME_MODES,
      "engine.active_frame_mode",
    ),
    mobile_active_frame_mode: expectEnum(
      source.mobile_active_frame_mode,
      FRAME_MODES,
      "engine.mobile_active_frame_mode",
    ),
    idle_frame_mode: expectEnum(
      source.idle_frame_mode,
      FRAME_MODES,
      "engine.idle_frame_mode",
    ),
  };
}

/** 解析安全区回退配置。 */
function parseSafeArea(value: unknown): SafeAreaInsets {
  const source = expectObject(value, "responsive.safe_area_fallback");
  return {
    top: expectNumber(source.top, "responsive.safe_area_fallback.top"),
    right: expectNumber(source.right, "responsive.safe_area_fallback.right"),
    bottom: expectNumber(source.bottom, "responsive.safe_area_fallback.bottom"),
    left: expectNumber(source.left, "responsive.safe_area_fallback.left"),
  };
}

/** 解析单个视觉回归视口。 */
function parseQualityViewport(value: unknown, index: number): QualityViewport {
  const path = `responsive.quality_viewports[${String(index)}]`;
  const source = expectObject(value, path);
  return {
    id: expectString(source.id, `${path}.id`),
    width: expectInteger(source.width, `${path}.width`, 1),
    height: expectInteger(source.height, `${path}.height`, 1),
    mobile: expectBoolean(source.mobile, `${path}.mobile`),
    touch: expectBoolean(source.touch, `${path}.touch`),
    device_scale_factor: expectNumber(
      source.device_scale_factor,
      `${path}.device_scale_factor`,
      1,
    ),
  };
}

/** 解析响应式断点与视口配置。 */
function parseResponsive(value: unknown): ResponsiveConfig {
  const source = expectObject(value, "responsive");
  const viewportValues = expectArray(
    source.quality_viewports,
    "responsive.quality_viewports",
  );
  return {
    desktop_min_stage_width: expectNumber(
      source.desktop_min_stage_width,
      "responsive.desktop_min_stage_width",
      1,
    ),
    mobile_max_css_short_edge: expectNumber(
      source.mobile_max_css_short_edge,
      "responsive.mobile_max_css_short_edge",
      1,
    ),
    resize_debounce_ms: expectNumber(
      source.resize_debounce_ms,
      "responsive.resize_debounce_ms",
    ),
    keyboard_resize_settle_ms: expectNumber(
      source.keyboard_resize_settle_ms,
      "responsive.keyboard_resize_settle_ms",
    ),
    safe_area_fallback: parseSafeArea(source.safe_area_fallback),
    quality_viewports: viewportValues.map(parseQualityViewport),
  };
}

/** 解析一套响应式封面主题资源。 */
function parseCoverTheme(value: unknown, index: number): CoverThemeConfig {
  const path = `assets.cover_themes.items[${String(index)}]`;
  const source = expectObject(value, path);
  return {
    id: expectString(source.id, `${path}.id`),
    label: expectString(source.label, `${path}.label`),
    description: expectString(source.description, `${path}.description`),
    desktop_asset: expectString(source.desktop_asset, `${path}.desktop_asset`),
    desktop_width: expectInteger(source.desktop_width, `${path}.desktop_width`, 1),
    desktop_height: expectInteger(source.desktop_height, `${path}.desktop_height`, 1),
    desktop_fit: expectEnum(
      source.desktop_fit,
      COVER_ARTWORK_FITS,
      `${path}.desktop_fit`,
    ),
    mobile_portrait_asset: expectString(
      source.mobile_portrait_asset,
      `${path}.mobile_portrait_asset`,
    ),
    mobile_portrait_width: expectInteger(
      source.mobile_portrait_width,
      `${path}.mobile_portrait_width`,
      1,
    ),
    mobile_portrait_height: expectInteger(
      source.mobile_portrait_height,
      `${path}.mobile_portrait_height`,
      1,
    ),
    mobile_portrait_fit: expectEnum(
      source.mobile_portrait_fit,
      COVER_ARTWORK_FITS,
      `${path}.mobile_portrait_fit`,
    ),
    mobile_landscape_asset: expectString(
      source.mobile_landscape_asset,
      `${path}.mobile_landscape_asset`,
    ),
    mobile_landscape_width: expectInteger(
      source.mobile_landscape_width,
      `${path}.mobile_landscape_width`,
      1,
    ),
    mobile_landscape_height: expectInteger(
      source.mobile_landscape_height,
      `${path}.mobile_landscape_height`,
      1,
    ),
    mobile_landscape_fit: expectEnum(
      source.mobile_landscape_fit,
      COVER_ARTWORK_FITS,
      `${path}.mobile_landscape_fit`,
    ),
    brand_mode: expectEnum(
      source.brand_mode,
      COVER_BRAND_MODES,
      `${path}.brand_mode`,
    ),
    required_achievement_id: expectNullableString(
      source.required_achievement_id,
      `${path}.required_achievement_id`,
    ),
    unlock_description: expectOptionalString(
      source.unlock_description,
      `${path}.unlock_description`,
    ),
  };
}

/** 解析封面主题集合并拒绝重复、缺失或被锁定的默认项。 */
function parseCoverThemes(value: unknown): CoverThemesConfig {
  const source = expectObject(value, "assets.cover_themes");
  const defaultId = expectString(
    source.default_id,
    "assets.cover_themes.default_id",
  );
  const items = expectArray(
    source.items,
    "assets.cover_themes.items",
  ).map(parseCoverTheme);
  if (items.length === 0) {
    throw new WebConfigError("assets.cover_themes.items 至少需要一个封面主题");
  }
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new WebConfigError("assets.cover_themes.items 不能包含重复 ID");
  }
  const defaultTheme = items.find((item) => item.id === defaultId);
  if (defaultTheme === undefined) {
    throw new WebConfigError(`assets.cover_themes.default_id 不存在：${defaultId}`);
  }
  if (defaultTheme.required_achievement_id !== null) {
    throw new WebConfigError("assets.cover_themes 默认主题不能要求成就");
  }
  for (const item of items) {
    if (
      item.required_achievement_id !== null &&
      item.unlock_description.trim() === ""
    ) {
      throw new WebConfigError(
        `assets.cover_themes 受锁主题缺少解锁说明：${item.id}`,
      );
    }
  }
  return { default_id: defaultId, items };
}

/** 解析公共资源路径。 */
function parseAssets(value: unknown): AssetConfig {
  const source = expectObject(value, "assets");
  return {
    cover: expectString(source.cover, "assets.cover"),
    mobile_cover: expectString(source.mobile_cover, "assets.mobile_cover"),
    cover_width: expectInteger(source.cover_width, "assets.cover_width", 1),
    cover_height: expectInteger(source.cover_height, "assets.cover_height", 1),
    cover_themes: parseCoverThemes(source.cover_themes),
    skins: readOptionalStringFields(
      expectObject(source.skins, "assets.skins"),
      SKIN_KEYS,
      "assets.skins",
    ),
    companion_portraits: parseCompanionPortraits(source.companion_portraits),
  };
}

/** 解析允许缺省空路径的伙伴立绘映射。 */
function parseCompanionPortraits(
  value: unknown,
): AssetConfig["companion_portraits"] {
  const source = expectObject(value, "assets.companion_portraits");
  const itemSource = expectObject(source.items, "assets.companion_portraits.items");
  const items: Record<string, string> = {};
  for (const [portraitKey, assetPath] of Object.entries(itemSource)) {
    const stableKey = expectString(portraitKey, "assets.companion_portraits.items key");
    items[stableKey] = expectOptionalString(
      assetPath,
      `assets.companion_portraits.items.${stableKey}`,
    );
  }
  if (Object.keys(items).length === 0) {
    throw new WebConfigError("assets.companion_portraits.items 至少需要一个立绘键");
  }
  return {
    recommended_width: expectInteger(
      source.recommended_width,
      "assets.companion_portraits.recommended_width",
      1,
    ),
    recommended_height: expectInteger(
      source.recommended_height,
      "assets.companion_portraits.recommended_height",
      1,
    ),
    items,
  };
}

/** 解析全局主题色板。 */
function parseTheme(value: unknown): ThemeConfig {
  return readStringFields(expectObject(value, "theme"), THEME_KEYS, "theme");
}

/** 解析字体与字号标尺。 */
function parseTypography(value: unknown): TypographyConfig {
  const source = expectObject(value, "typography");
  return {
    font_family: expectString(source.font_family, "typography.font_family"),
    ...readNumberFields(source, TYPOGRAPHY_NUMBER_KEYS, "typography"),
  };
}

/** 解析动效时长和可访问性开关。 */
function parseMotion(value: unknown): MotionConfig {
  const source = expectObject(value, "motion");
  return {
    page_transition_ms: expectNumber(
      source.page_transition_ms,
      "motion.page_transition_ms",
    ),
    connection_transition_ms: expectNumber(
      source.connection_transition_ms,
      "motion.connection_transition_ms",
    ),
    button_press_ms: expectNumber(
      source.button_press_ms,
      "motion.button_press_ms",
    ),
    cover_drift_ms: expectNumber(
      source.cover_drift_ms,
      "motion.cover_drift_ms",
    ),
    cover_menu_description_delay_ms: expectNumber(
      source.cover_menu_description_delay_ms,
      "motion.cover_menu_description_delay_ms",
    ),
    toast_duration_ms: expectNumber(
      source.toast_duration_ms,
      "motion.toast_duration_ms",
    ),
    publisher_logo_fade_in_ms: expectNumber(
      source.publisher_logo_fade_in_ms,
      "motion.publisher_logo_fade_in_ms",
    ),
    publisher_logo_hold_ms: expectNumber(
      source.publisher_logo_hold_ms,
      "motion.publisher_logo_hold_ms",
    ),
    publisher_logo_fade_out_ms: expectNumber(
      source.publisher_logo_fade_out_ms,
      "motion.publisher_logo_fade_out_ms",
    ),
    reduced_motion: expectBoolean(source.reduced_motion, "motion.reduced_motion"),
  };
}

/** 解析交互控件尺寸与阈值。 */
function parseControls(value: unknown): ControlConfig {
  return readNumberFields(
    expectObject(value, "controls"),
    CONTROL_KEYS,
    "controls",
  );
}

/** 返回字符串的 Unicode 码点数，避免把一个代理对拆成两个名字字符。 */
function countUnicodeCharacters(value: string): number {
  return Array.from(value).length;
}

/** 解析原生姓名输入属性和不重复的预设名称集合。 */
function parseNewGameSetup(
  value: unknown,
  maximumNameCharacters: number,
): NewGameSetupConfig {
  const source = expectObject(value, "new_game_setup");
  const inputSource = expectObject(
    source.name_input,
    "new_game_setup.name_input",
  );
  const presetNames = expectArray(
    source.preset_names,
    "new_game_setup.preset_names",
  ).map((entry, index) =>
    expectString(
      entry,
      `new_game_setup.preset_names[${String(index)}]`,
    ).trim(),
  );
  if (presetNames.length === 0) {
    throw new WebConfigError("new_game_setup.preset_names 至少需要一个预设姓名");
  }
  if (new Set(presetNames).size !== presetNames.length) {
    throw new WebConfigError("new_game_setup.preset_names 不能包含重复姓名");
  }
  presetNames.forEach((name, index) => {
    if (countUnicodeCharacters(name) > maximumNameCharacters) {
      throw new WebConfigError(
        `new_game_setup.preset_names[${String(index)}] 不能超过 ${String(maximumNameCharacters)} 个字符`,
      );
    }
  });
  const modeOptions = parseUniqueIdObjects(
    source.mode_options,
    "new_game_setup.mode_options",
    (entry, path) => ({
      id: expectEnum(entry.id, NAVIGATION_GAME_MODES, `${path}.id`),
      label: expectString(entry.label, `${path}.label`),
      description: expectString(entry.description, `${path}.description`),
    }),
  );
  const configuredModeIds = new Set(modeOptions.map((option) => option.id));
  if (NAVIGATION_GAME_MODES.some((modeId) => !configuredModeIds.has(modeId))) {
    throw new WebConfigError(
      "new_game_setup.mode_options 必须覆盖 single / multiplayer / story / endless",
    );
  }
  const categories = parseUniqueIdObjects(
    source.categories,
    "new_game_setup.categories",
    (entry, path) => ({
      id: expectEnum(entry.id, NEW_GAME_SETUP_CATEGORIES, `${path}.id`),
      label: expectString(entry.label, `${path}.label`),
      description: expectString(entry.description, `${path}.description`),
    }),
  );
  const configuredCategoryIds = new Set(categories.map((entry) => entry.id));
  if (
    NEW_GAME_SETUP_CATEGORIES.some(
      (categoryId) => !configuredCategoryIds.has(categoryId),
    )
  ) {
    throw new WebConfigError(
      "new_game_setup.categories 必须覆盖全部开局分类",
    );
  }
  return {
    name_input: {
      html_type: expectEnum(
        inputSource.html_type,
        NAME_INPUT_HTML_TYPES,
        "new_game_setup.name_input.html_type",
      ),
      input_mode: expectEnum(
        inputSource.input_mode,
        NAME_INPUT_MODES,
        "new_game_setup.name_input.input_mode",
      ),
      language: expectString(
        inputSource.language,
        "new_game_setup.name_input.language",
      ),
      enter_key_hint: expectEnum(
        inputSource.enter_key_hint,
        NAME_INPUT_ENTER_KEY_HINTS,
        "new_game_setup.name_input.enter_key_hint",
      ),
      autocomplete: expectEnum(
        inputSource.autocomplete,
        NAME_INPUT_AUTOCOMPLETE_VALUES,
        "new_game_setup.name_input.autocomplete",
      ),
      autocapitalize: expectEnum(
        inputSource.autocapitalize,
        NAME_INPUT_AUTOCAPITALIZE_VALUES,
        "new_game_setup.name_input.autocapitalize",
      ),
      spellcheck: expectBoolean(
        inputSource.spellcheck,
        "new_game_setup.name_input.spellcheck",
      ),
    },
    preset_names: presetNames,
    mode_options: modeOptions,
    categories,
    desktop: parseNewGameSetupDesktop(source.desktop),
    mobile: parseNewGameSetupMobile(source.mobile),
    copy: parseNewGameSetupCopy(source.copy),
  };
}

/** 解析拥有稳定且不重复 ID 的配置对象数组。 */
function parseUniqueIdObjects<TEntry extends { readonly id: string }>(
  value: unknown,
  path: string,
  parseEntry: (source: JsonObject, entryPath: string) => TEntry,
): readonly TEntry[] {
  const entries = expectArray(value, path).map((valueEntry, index) =>
    parseEntry(expectObject(valueEntry, `${path}[${String(index)}]`), `${path}[${String(index)}]`)
  );
  if (entries.length === 0) {
    throw new WebConfigError(`${path} 至少需要一个选项`);
  }
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new WebConfigError(`${path} 不能包含重复 ID`);
  }
  return entries;
}

/** 解析开局页桌面三栏布局标尺。 */
function parseNewGameSetupDesktop(value: unknown): NewGameSetupConfig["desktop"] {
  const source = expectObject(value, "new_game_setup.desktop");
  return {
    navigation_width: expectNumber(source.navigation_width, "new_game_setup.desktop.navigation_width", 1),
    option_list_width: expectNumber(source.option_list_width, "new_game_setup.desktop.option_list_width", 1),
    content_height: expectNumber(source.content_height, "new_game_setup.desktop.content_height", 1),
    summary_height: expectNumber(source.summary_height, "new_game_setup.desktop.summary_height", 1),
    panel_gap: expectNumber(source.panel_gap, "new_game_setup.desktop.panel_gap"),
    row_height: expectNumber(source.row_height, "new_game_setup.desktop.row_height", 1),
    panel_padding: expectNumber(source.panel_padding, "new_game_setup.desktop.panel_padding"),
  };
}

/** 解析开局页手机分步布局标尺。 */
function parseNewGameSetupMobile(value: unknown): NewGameSetupConfig["mobile"] {
  const source = expectObject(value, "new_game_setup.mobile");
  return {
    step_header_height: expectNumber(source.step_header_height, "new_game_setup.mobile.step_header_height", 1),
    option_area_height: expectNumber(source.option_area_height, "new_game_setup.mobile.option_area_height", 1),
    preview_height: expectNumber(source.preview_height, "new_game_setup.mobile.preview_height", 1),
    summary_height: expectNumber(source.summary_height, "new_game_setup.mobile.summary_height", 1),
    row_height: expectNumber(source.row_height, "new_game_setup.mobile.row_height", 1),
    panel_padding: expectNumber(source.panel_padding, "new_game_setup.mobile.panel_padding"),
  };
}

/** 解析开局页布局中不依赖领域的文案。 */
function parseNewGameSetupCopy(value: unknown): NewGameSetupConfig["copy"] {
  const source = expectObject(value, "new_game_setup.copy");
  return {
    navigation_title: expectString(source.navigation_title, "new_game_setup.copy.navigation_title"),
    option_list_title: expectString(source.option_list_title, "new_game_setup.copy.option_list_title"),
    preview_title: expectString(source.preview_title, "new_game_setup.copy.preview_title"),
    summary_title: expectString(source.summary_title, "new_game_setup.copy.summary_title"),
    summary_format: expectString(source.summary_format, "new_game_setup.copy.summary_format"),
    step_format: expectString(source.step_format, "new_game_setup.copy.step_format"),
    previous_step: expectString(source.previous_step, "new_game_setup.copy.previous_step"),
    next_step: expectString(source.next_step, "new_game_setup.copy.next_step"),
    selected_mark: expectString(source.selected_mark, "new_game_setup.copy.selected_mark"),
    name_description: expectString(source.name_description, "new_game_setup.copy.name_description"),
    unavailable_mode: expectString(source.unavailable_mode, "new_game_setup.copy.unavailable_mode"),
  };
}

/** 解析通讯式分步教程及其聚焦目标。 */
function parseGuidedTutorial(value: unknown): GuidedTutorialConfig {
  const source = expectObject(value, "guided_tutorial");
  const steps = parseUniqueIdObjects(
    source.steps,
    "guided_tutorial.steps",
    (entry, path) => ({
      id: expectString(entry.id, `${path}.id`),
      speaker: expectString(entry.speaker, `${path}.speaker`),
      title: expectString(entry.title, `${path}.title`),
      instruction: expectString(entry.instruction, `${path}.instruction`),
      target_test_id: expectString(entry.target_test_id, `${path}.target_test_id`),
    }),
  );
  return {
    title: expectString(source.title, "guided_tutorial.title"),
    step_format: expectString(source.step_format, "guided_tutorial.step_format"),
    previous_label: expectString(source.previous_label, "guided_tutorial.previous_label"),
    next_label: expectString(source.next_label, "guided_tutorial.next_label"),
    complete_label: expectString(source.complete_label, "guided_tutorial.complete_label"),
    skip_label: expectString(source.skip_label, "guided_tutorial.skip_label"),
    missing_target_label: expectString(source.missing_target_label, "guided_tutorial.missing_target_label"),
    header_step_width_ratio: expectSplitRatio(
      source.header_step_width_ratio,
      "guided_tutorial.header_step_width_ratio",
    ),
    spotlight_padding: expectNumber(source.spotlight_padding, "guided_tutorial.spotlight_padding"),
    spotlight_border_width: expectNumber(source.spotlight_border_width, "guided_tutorial.spotlight_border_width", 1),
    dialog_panel_padding: expectNumber(source.dialog_panel_padding, "guided_tutorial.dialog_panel_padding"),
    desktop_dialog_width: expectNumber(source.desktop_dialog_width, "guided_tutorial.desktop_dialog_width", 1),
    desktop_dialog_height: expectNumber(source.desktop_dialog_height, "guided_tutorial.desktop_dialog_height", 1),
    mobile_dialog_height: expectNumber(source.mobile_dialog_height, "guided_tutorial.mobile_dialog_height", 1),
    fallback_target_width: expectNumber(source.fallback_target_width, "guided_tutorial.fallback_target_width", 1),
    fallback_target_height: expectNumber(source.fallback_target_height, "guided_tutorial.fallback_target_height", 1),
    steps,
  };
}

/** 解析开局前的教程位置通知。 */
function parsePreGameNotice(value: unknown): PreGameNoticeConfig {
  const source = expectObject(value, "pre_game_notice");
  return {
    title: expectString(source.title, "pre_game_notice.title"),
    body: expectString(source.body, "pre_game_notice.body"),
    continue_label: expectString(source.continue_label, "pre_game_notice.continue_label"),
    tutorial_label: expectString(source.tutorial_label, "pre_game_notice.tutorial_label"),
  };
}

/** 解析制作方开场 LOGO 的代码文字与几何配置。 */
function parsePublisherSplash(value: unknown): PublisherSplashConfig {
  const source = expectObject(value, "publisher_splash");
  return {
    title: expectString(source.title, "publisher_splash.title"),
    subtitle: expectString(source.subtitle, "publisher_splash.subtitle"),
    background_asset: expectOptionalString(source.background_asset, "publisher_splash.background_asset"),
    background_opacity: expectRatio(
      source.background_opacity,
      "publisher_splash.background_opacity",
    ),
    content_width: expectNumber(source.content_width, "publisher_splash.content_width", 1),
    title_height: expectNumber(source.title_height, "publisher_splash.title_height", 1),
    subtitle_height: expectNumber(source.subtitle_height, "publisher_splash.subtitle_height", 1),
    decoration_width: expectNumber(source.decoration_width, "publisher_splash.decoration_width", 1),
    decoration_gap: expectNumber(source.decoration_gap, "publisher_splash.decoration_gap"),
  };
}

/** 解析一个响应式封面菜单，并要求列数为正整数。 */
function parseCoverMenuLayout(
  value: unknown,
  path: string,
): CoverMenuLayoutConfig {
  const source = expectObject(value, path);
  return {
    horizontal_alignment: expectEnum(
      source.horizontal_alignment,
      HORIZONTAL_ALIGNMENTS,
      `${path}.horizontal_alignment`,
    ),
    vertical_alignment: expectEnum(
      source.vertical_alignment,
      VERTICAL_ALIGNMENTS,
      `${path}.vertical_alignment`,
    ),
    settings_button_anchor: expectEnum(
      source.settings_button_anchor,
      COVER_SETTINGS_BUTTON_ANCHORS,
      `${path}.settings_button_anchor`,
    ),
    ...readNumberFields(source, COVER_LAYOUT_KEYS, path),
    menu_columns: expectInteger(source.menu_columns, `${path}.menu_columns`, 1),
  };
}

/** 解析封面、桌面、移动与二级页布局标尺。 */
function parseLayout(value: unknown): LayoutConfig {
  const source = expectObject(value, "layout");
  const coverSource = expectObject(source.cover, "layout.cover");
  const desktopSource = expectObject(source.desktop, "layout.desktop");
  const mobileSource = expectObject(source.mobile, "layout.mobile");
  return {
    cover: {
      desktop: parseCoverMenuLayout(
        coverSource.desktop,
        "layout.cover.desktop",
      ),
      mobile: parseCoverMenuLayout(
        coverSource.mobile,
        "layout.cover.mobile",
      ),
      mobile_landscape: parseCoverMenuLayout(
        coverSource.mobile_landscape,
        "layout.cover.mobile_landscape",
      ),
      image_dark_edge_ratio: expectRatio(
        coverSource.image_dark_edge_ratio,
        "layout.cover.image_dark_edge_ratio",
      ),
      image_dark_solid_ratio: expectRatio(
        coverSource.image_dark_solid_ratio,
        "layout.cover.image_dark_solid_ratio",
      ),
      image_dark_fade_steps: expectInteger(
        coverSource.image_dark_fade_steps,
        "layout.cover.image_dark_fade_steps",
        1,
      ),
    },
    desktop: {
      header_navigation_anchor: expectEnum(
        desktopSource.header_navigation_anchor,
        HEADER_NAVIGATION_ANCHORS,
        "layout.desktop.header_navigation_anchor",
      ),
      ...readNumberFields(desktopSource, DESKTOP_LAYOUT_KEYS, "layout.desktop"),
    },
    mobile: {
      header_navigation_anchor: expectEnum(
        mobileSource.header_navigation_anchor,
        HEADER_NAVIGATION_ANCHORS,
        "layout.mobile.header_navigation_anchor",
      ),
      ...readNumberFields(mobileSource, MOBILE_LAYOUT_KEYS, "layout.mobile"),
    },
    page: readNumberFields(
      expectObject(source.page, "layout.page"),
      PAGE_LAYOUT_KEYS,
      "layout.page",
    ),
  };
}

/** 解析浏览器关闭失败时的可回退退出策略。 */
function parseWebExit(value: unknown): WebExitConfig {
  const source = expectObject(value, "web_exit");
  return {
    strategy: expectEnum(
      source.strategy,
      WEB_EXIT_STRATEGIES,
      "web_exit.strategy",
    ),
    history_back_steps: expectInteger(
      source.history_back_steps,
      "web_exit.history_back_steps",
      1,
    ),
    verification_delay_ms: expectNumber(
      source.verification_delay_ms,
      "web_exit.verification_delay_ms",
    ),
  };
}

/** 拒绝设置或成就键占用存档主键及其派生槽位命名空间。 */
function validateStorageKeyNamespaces(config: StorageConfig): void {
  const auxiliaryKeys = [
    { path: "storage.settings_key", value: config.settings_key },
    { path: "storage.achievement_key", value: config.achievement_key },
  ] as const;
  for (const entry of auxiliaryKeys) {
    if (isSaveStorageNamespaceKey(config.key, entry.value)) {
      throw new WebConfigError(
        `${entry.path} 与 storage.key 的存档命名空间冲突`,
      );
    }
  }
  if (config.settings_key === config.achievement_key) {
    throw new WebConfigError("设置与成就存储键冲突");
  }
}

/** 解析本地存档策略，并验证三类文档使用互斥命名空间。 */
function parseStorage(value: unknown): StorageConfig {
  const source = expectObject(value, "storage");
  const config: StorageConfig = {
    key: expectString(source.key, "storage.key"),
    settings_key: expectString(source.settings_key, "storage.settings_key"),
    settings_schema_version: expectInteger(
      source.settings_schema_version,
      "storage.settings_schema_version",
      1,
    ),
    achievement_key: expectString(
      source.achievement_key,
      "storage.achievement_key",
    ),
    achievement_schema_version: expectInteger(
      source.achievement_schema_version,
      "storage.achievement_schema_version",
      1,
    ),
    schema_version: expectInteger(
      source.schema_version,
      "storage.schema_version",
      1,
    ),
    auto_save: expectBoolean(source.auto_save, "storage.auto_save"),
    backup_slots: expectInteger(source.backup_slots, "storage.backup_slots"),
    save_slot_count: expectInteger(
      source.save_slot_count,
      "storage.save_slot_count",
      1,
    ),
  };
  validateStorageKeyNamespaces(config);
  return config;
}

/** 解析更新日志首次挂载时的自动展示策略。 */
function parseUpdateLog(value: unknown): UpdateLogConfig {
  const source = expectObject(value, "update_log");
  return {
    auto_open: expectBoolean(source.auto_open, "update_log.auto_open"),
  };
}

/** 解析单个导航入口。 */
function parseNavigation(value: unknown, index: number): NavigationConfig {
  const path = `navigation[${String(index)}]`;
  const source = expectObject(value, path);
  return {
    id: expectString(source.id, `${path}.id`),
    label: expectString(source.label, `${path}.label`),
    icon: expectString(source.icon, `${path}.icon`),
    placements: parseNavigationEnumArray(
      source.placements,
      NAVIGATION_PLACEMENTS,
      `${path}.placements`,
    ),
    modes: parseNavigationEnumArray(
      source.modes,
      NAVIGATION_GAME_MODES,
      `${path}.modes`,
    ),
  };
}

/** 解析非空、无重复的局内导航枚举数组。 */
function parseNavigationEnumArray<const TValues extends readonly string[]>(
  value: unknown,
  supportedValues: TValues,
  path: string,
): readonly TValues[number][] {
  const entries = expectArray(value, path).map((entry, index) =>
    expectEnum(entry, supportedValues, `${path}[${String(index)}]`),
  );
  if (entries.length === 0) {
    throw new WebConfigError(`${path} 至少需要一个值`);
  }
  if (new Set(entries).size !== entries.length) {
    throw new WebConfigError(`${path} 不能包含重复值`);
  }
  return entries;
}

/** 解析局内导航并拒绝重复稳定 ID。 */
function parseNavigationList(value: unknown): readonly NavigationConfig[] {
  const navigation = expectArray(value, "navigation").map(parseNavigation);
  const ids = new Set<string>();
  for (const item of navigation) {
    if (ids.has(item.id)) {
      throw new WebConfigError(`navigation 出现重复 ID：${item.id}`);
    }
    ids.add(item.id);
  }
  return navigation;
}

/** 读取非空字符串数组。 */
function parseStringArray(value: unknown, path: string): readonly string[] {
  return expectArray(value, path).map((entry, index) =>
    expectString(entry, `${path}[${String(index)}]`),
  );
}

/** 解析单个指挥台行动分组。 */
function parseActionGroup(value: unknown, index: number): ActionGroupConfig {
  const path = `action_groups[${String(index)}]`;
  const source = expectObject(value, path);
  return {
    id: expectString(source.id, `${path}.id`),
    label: expectString(source.label, `${path}.label`),
    action_ids: parseStringArray(source.action_ids, `${path}.action_ids`),
  };
}

/** 解析一个 H5 专属动作展示定义。 */
function parseWebAction(value: unknown, index: number): WebActionConfig {
  const path = `actions[${String(index)}]`;
  const source = expectObject(value, path);
  return {
    id: expectString(source.id, `${path}.id`),
    label: expectString(source.label, `${path}.label`),
    style: expectString(source.style, `${path}.style`),
    icon: expectString(source.icon, `${path}.icon`),
  };
}

/** 拒绝 H5 动作定义中的重复稳定 ID。 */
function parseWebActions(value: unknown): readonly WebActionConfig[] {
  const actions = expectArray(value, "actions").map(parseWebAction);
  const ids = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) {
      throw new WebConfigError(`actions 出现重复 ID：${action.id}`);
    }
    ids.add(action.id);
  }
  return actions;
}

/** 解析 H5 界面文案。 */
function parseTexts(value: unknown): TextConfig {
  const source = expectObject(value, "texts");
  return {
    ...readStringFields(source, TEXT_KEYS, "texts"),
    option_intelligence_separator: expectPresentString(
      source.option_intelligence_separator,
      "texts.option_intelligence_separator",
    ),
  };
}

/** 校验未信任 JSON，并返回完整 H5 配置。 */
export function parseWebGameConfig(value: unknown): WebGameConfig {
  const source = expectObject(value, "web_config");
  const schemaVersion = expectInteger(
    source.schema_version,
    "schema_version",
    1,
  );
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new WebConfigError(
      `不支持的 H5 配置版本 ${String(schemaVersion)}，当前仅支持 ${String(SUPPORTED_SCHEMA_VERSION)}`,
    );
  }
  const controls = parseControls(source.controls);
  return {
    schema_version: schemaVersion,
    engine: parseEngine(source.engine),
    responsive: parseResponsive(source.responsive),
    assets: parseAssets(source.assets),
    theme: parseTheme(source.theme),
    typography: parseTypography(source.typography),
    motion: parseMotion(source.motion),
    controls,
    new_game_setup: parseNewGameSetup(
      source.new_game_setup,
      controls.max_player_name_characters,
    ),
    guided_tutorial: parseGuidedTutorial(source.guided_tutorial),
    pre_game_notice: parsePreGameNotice(source.pre_game_notice),
    publisher_splash: parsePublisherSplash(source.publisher_splash),
    layout: parseLayout(source.layout),
    storage: parseStorage(source.storage),
    update_log: parseUpdateLog(source.update_log),
    web_exit: parseWebExit(source.web_exit),
    navigation: parseNavigationList(source.navigation),
    actions: parseWebActions(source.actions),
    action_groups: expectArray(source.action_groups, "action_groups").map(
      parseActionGroup,
    ),
    texts: parseTexts(source.texts),
  };
}

/** 跨配置校验预设姓名数量能覆盖所有模式的最大玩家数。 */
export function validateNamePresetCoverage(
  config: WebGameConfig,
  playerCounts: Readonly<Record<string, { readonly maximum: number }>>,
): void {
  const maximumCounts = Object.values(playerCounts).map((entry) => entry.maximum);
  if (
    maximumCounts.length === 0 ||
    maximumCounts.some((count) => !Number.isInteger(count) || count <= 0)
  ) {
    throw new WebConfigError("玩家数配置必须包含正整数 maximum");
  }
  const maximumPlayerCount = Math.max(...maximumCounts);
  if (config.new_game_setup.preset_names.length < maximumPlayerCount) {
    throw new WebConfigError(
      `new_game_setup.preset_names 至少需要 ${String(maximumPlayerCount)} 个姓名才能覆盖最大玩家数`,
    );
  }
}

/** 跨配置校验封面主题引用的成就必须由剧情结局声明。 */
export function validateCoverThemeAchievementReferences(
  config: WebGameConfig,
  knownAchievementIds: readonly string[],
): void {
  const knownIds = new Set(knownAchievementIds);
  for (const theme of config.assets.cover_themes.items) {
    const requiredId = theme.required_achievement_id;
    if (requiredId !== null && !knownIds.has(requiredId)) {
      throw new WebConfigError(
        `封面主题 ${theme.id} 引用了未知成就：${requiredId}`,
      );
    }
  }
}

/** 从 HTML meta 元素解析 H5 配置 URL。 */
export function resolveWebConfigUrl(documentRef: Document = document): string {
  const metaElement = documentRef.querySelector<HTMLMetaElement>(
    `meta[name="${CONFIG_META_NAME}"]`,
  );
  if (metaElement === null) {
    throw new WebConfigError(`页面缺少 ${CONFIG_META_NAME} meta 配置`);
  }
  const configPath = expectString(metaElement.content, CONFIG_META_NAME);
  return new URL(configPath, documentRef.baseURI).toString();
}

/** 从指定 URL 获取并校验 H5 根配置。 */
export async function loadWebConfig(
  configUrl: string,
  fetcher: ConfigFetcher = defaultFetcher,
): Promise<WebGameConfig> {
  let response: Response;
  try {
    response = await fetcher(configUrl, { cache: "no-cache" });
  } catch (error: unknown) {
    throw new WebConfigError(`无法请求 H5 配置 ${configUrl}: ${String(error)}`);
  }
  if (!response.ok) {
    throw new WebConfigError(
      `H5 配置请求失败 ${String(response.status)} ${response.statusText}`,
    );
  }
  const configDocument: unknown = await response.json();
  return parseWebGameConfig(configDocument);
}
