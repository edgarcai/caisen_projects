/** 当前浏览器保存的纯界面偏好。 */
export interface UiPreferences {
  readonly reducedMotion: boolean;
  readonly selectedCoverThemeId: string;
}

/**
 * UI 设置持久化端口，使页面层不直接依赖 localStorage。
 */
export interface UiSettingsPort {
  /** 读取设置；无有效数据时返回调用方提供的配置默认值。 */
  load(fallback: UiPreferences): UiPreferences;

  /** 保存完整设置快照。 */
  save(preferences: UiPreferences): void;
}
