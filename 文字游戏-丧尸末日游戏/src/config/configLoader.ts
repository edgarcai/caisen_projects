import type {
  ActionGroupConfig,
  AssetConfig,
  CoverMenuLayoutConfig,
  ControlConfig,
  EngineConfig,
  LayoutConfig,
  MotionConfig,
  NavigationConfig,
  QualityViewport,
  ResponsiveConfig,
  SafeAreaInsets,
  StorageConfig,
  TextConfig,
  ThemeConfig,
  TypographyConfig,
  WebActionConfig,
  WebExitConfig,
  WebGameConfig,
} from "./types";

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
const FRAME_MODES = ["fast", "slow", "mouse", "sleep"] as const;
const WEB_EXIT_STRATEGIES = [
  "close_only",
  "history_back",
  "close_then_history_back",
] as const;

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
  "description_left",
  "description_top",
  "description_width",
  "description_height",
] as const;
const DESKTOP_LAYOUT_KEYS = [
  "outer_padding",
  "header_height",
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
  "bottom_navigation_height",
  "panel_padding",
  "section_gap",
  "mission_height",
  "resource_bar_height",
  "quick_action_columns",
  "sheet_top_margin",
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
  "expedition_loot_format",
  "expedition_continue",
  "expedition_safe_return",
  "history_title",
  "history_empty",
  "history_week_format",
  "history_entry_format",
  "option_intelligence_title",
  "option_intelligence_format",
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
    mobile_max_stage_width: expectNumber(
      source.mobile_max_stage_width,
      "responsive.mobile_max_stage_width",
      1,
    ),
    compact_max_stage_height: expectNumber(
      source.compact_max_stage_height,
      "responsive.compact_max_stage_height",
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

/** 解析公共资源路径。 */
function parseAssets(value: unknown): AssetConfig {
  const source = expectObject(value, "assets");
  return {
    cover: expectString(source.cover, "assets.cover"),
    mobile_cover: expectString(source.mobile_cover, "assets.mobile_cover"),
    cover_width: expectInteger(source.cover_width, "assets.cover_width", 1),
    cover_height: expectInteger(source.cover_height, "assets.cover_height", 1),
    skins: readOptionalStringFields(
      expectObject(source.skins, "assets.skins"),
      SKIN_KEYS,
      "assets.skins",
    ),
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
    ...readNumberFields(source, COVER_LAYOUT_KEYS, path),
    menu_columns: expectInteger(source.menu_columns, `${path}.menu_columns`, 1),
  };
}

/** 解析封面、桌面、移动与二级页布局标尺。 */
function parseLayout(value: unknown): LayoutConfig {
  const source = expectObject(value, "layout");
  const coverSource = expectObject(source.cover, "layout.cover");
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
    desktop: readNumberFields(
      expectObject(source.desktop, "layout.desktop"),
      DESKTOP_LAYOUT_KEYS,
      "layout.desktop",
    ),
    mobile: readNumberFields(
      expectObject(source.mobile, "layout.mobile"),
      MOBILE_LAYOUT_KEYS,
      "layout.mobile",
    ),
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

/** 解析本地存档策略。 */
function parseStorage(value: unknown): StorageConfig {
  const source = expectObject(value, "storage");
  return {
    key: expectString(source.key, "storage.key"),
    settings_key: expectString(source.settings_key, "storage.settings_key"),
    settings_schema_version: expectInteger(
      source.settings_schema_version,
      "storage.settings_schema_version",
      1,
    ),
    schema_version: expectInteger(
      source.schema_version,
      "storage.schema_version",
      1,
    ),
    auto_save: expectBoolean(source.auto_save, "storage.auto_save"),
    backup_slots: expectInteger(source.backup_slots, "storage.backup_slots"),
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
  };
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
  return {
    schema_version: schemaVersion,
    engine: parseEngine(source.engine),
    responsive: parseResponsive(source.responsive),
    assets: parseAssets(source.assets),
    theme: parseTheme(source.theme),
    typography: parseTypography(source.typography),
    motion: parseMotion(source.motion),
    controls: parseControls(source.controls),
    layout: parseLayout(source.layout),
    storage: parseStorage(source.storage),
    web_exit: parseWebExit(source.web_exit),
    navigation: expectArray(source.navigation, "navigation").map(parseNavigation),
    actions: parseWebActions(source.actions),
    action_groups: expectArray(source.action_groups, "action_groups").map(
      parseActionGroup,
    ),
    texts: parseTexts(source.texts),
  };
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
