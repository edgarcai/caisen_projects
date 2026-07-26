import type {
  CoverArtworkFitToken,
  CoverThemeTokens,
  CoverThemesTokens,
} from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";

/** 设置页展示的一项封面主题状态。 */
export interface CoverThemeSelectionState {
  readonly theme: CoverThemeTokens;
  readonly selected: boolean;
  readonly locked: boolean;
}

/** 当前断点应加载的封面资源与原始尺寸。 */
export interface CoverThemeArtwork {
  readonly asset: string;
  readonly width: number;
  readonly height: number;
  readonly fit: CoverArtworkFitToken;
}

/** 封面图片在舞台内等比缩放并居中后的纯几何结果。 */
export interface CoverArtworkGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 判断主题是否无需成就，或其前置成就已经解锁。 */
export function isCoverThemeUnlocked(
  theme: CoverThemeTokens,
  unlockedAchievementIds: readonly string[],
): boolean {
  return theme.required_achievement_id === null ||
    new Set(unlockedAchievementIds).has(theme.required_achievement_id);
}

/** 返回配置声明的默认主题；解析器已保证该 ID 存在。 */
export function resolveDefaultCoverTheme(
  themes: CoverThemesTokens,
): CoverThemeTokens {
  const theme = themes.items.find((item) => item.id === themes.default_id);
  if (theme === undefined) {
    throw new Error(`主界面默认封面不存在：${themes.default_id}`);
  }
  return theme;
}

/** 解析实际可用主题，未知或锁定的偏好都安全回退到默认封面。 */
export function resolveSelectedCoverTheme(
  themes: CoverThemesTokens,
  selectedThemeId: string,
  unlockedAchievementIds: readonly string[],
): CoverThemeTokens {
  const selected = themes.items.find((item) => item.id === selectedThemeId);
  if (
    selected !== undefined &&
    isCoverThemeUnlocked(selected, unlockedAchievementIds)
  ) {
    return selected;
  }
  return resolveDefaultCoverTheme(themes);
}

/** 构建设置页只读状态，不把解锁判断散落到渲染组件。 */
export function buildCoverThemeSelectionStates(
  themes: CoverThemesTokens,
  selectedThemeId: string,
  unlockedAchievementIds: readonly string[],
): readonly CoverThemeSelectionState[] {
  const activeTheme = resolveSelectedCoverTheme(
    themes,
    selectedThemeId,
    unlockedAchievementIds,
  );
  return themes.items.map((theme) => ({
    theme,
    selected: theme.id === activeTheme.id,
    locked: !isCoverThemeUnlocked(theme, unlockedAchievementIds),
  }));
}

/** 按桌面、手机横屏或手机竖屏选择匹配的主题资源。 */
export function resolveCoverThemeArtwork(
  theme: CoverThemeTokens,
  layout: ResponsiveLayout,
): CoverThemeArtwork {
  if (layout.kind !== "mobile") {
    return {
      asset: theme.desktop_asset,
      width: theme.desktop_width,
      height: theme.desktop_height,
      fit: theme.desktop_fit,
    };
  }
  if (layout.isLandscape) {
    return {
      asset: theme.mobile_landscape_asset,
      width: theme.mobile_landscape_width,
      height: theme.mobile_landscape_height,
      fit: theme.mobile_landscape_fit,
    };
  }
  return {
    asset: theme.mobile_portrait_asset,
    width: theme.mobile_portrait_width,
    height: theme.mobile_portrait_height,
    fit: theme.mobile_portrait_fit,
  };
}

/** 按资源声明的 cover 或 contain 计算无引擎副作用的居中缩放几何。 */
export function resolveCoverArtworkGeometry(
  artwork: Pick<CoverThemeArtwork, "width" | "height" | "fit">,
  viewportWidth: number,
  viewportHeight: number,
): CoverArtworkGeometry {
  if (
    artwork.width <= 0 ||
    artwork.height <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const widthScale = viewportWidth / artwork.width;
  const heightScale = viewportHeight / artwork.height;
  const scale = artwork.fit === "cover"
    ? Math.max(widthScale, heightScale)
    : Math.min(widthScale, heightScale);
  const width = artwork.width * scale;
  const height = artwork.height * scale;
  return {
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    width,
    height,
  };
}
