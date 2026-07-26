import type {
  UiPreferences,
  UiSettingsPort,
} from "../ui/ports/UiSettingsPort";

/** 当前设置存储中的版本化 JSON 结构。 */
interface StoredUiPreferences {
  readonly schema_version: number;
  readonly reduced_motion: boolean;
  readonly selected_cover_theme_id: string;
}

const LEGACY_SETTINGS_SCHEMA_VERSION = 1;
const COVER_THEME_SETTINGS_SCHEMA_VERSION = 2;

/** UI 设置仓库实际需要的最小键值存储能力。 */
export interface UiSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 使用浏览器 Storage 保存界面偏好；读取损坏数据时安全降级。
 */
export class LocalStorageUiSettingsRepository implements UiSettingsPort {
  private readonly storage: UiSettingsStorage | null;
  private readonly key: string;
  private readonly schemaVersion: number;
  private writeBlockedByFutureSchema: boolean;

  /** 保存可注入的存储实现、配置化键名和版本。 */
  public constructor(
    storage: UiSettingsStorage | null,
    key: string,
    schemaVersion: number,
  ) {
    this.storage = storage;
    this.key = key;
    this.schemaVersion = schemaVersion;
    this.writeBlockedByFutureSchema = false;
  }

  /** 读取并校验设置，任何浏览器存储异常都返回配置默认值。 */
  public load(fallback: UiPreferences): UiPreferences {
    try {
      const serialized = this.storage?.getItem(this.key);
      if (serialized === null || serialized === undefined) {
        return fallback;
      }
      const parsed = JSON.parse(serialized) as unknown;
      if (!this.isRecord(parsed)) {
        return fallback;
      }
      if (this.isFutureStoredDocument(parsed)) {
        this.writeBlockedByFutureSchema = true;
        return fallback;
      }
      if (typeof parsed.reduced_motion !== "boolean") {
        return fallback;
      }
      if (
        parsed.schema_version === LEGACY_SETTINGS_SCHEMA_VERSION &&
        this.schemaVersion >= COVER_THEME_SETTINGS_SCHEMA_VERSION
      ) {
        return {
          ...fallback,
          reducedMotion: parsed.reduced_motion,
        };
      }
      if (
        parsed.schema_version !== this.schemaVersion ||
        typeof parsed.selected_cover_theme_id !== "string" ||
        parsed.selected_cover_theme_id.trim() === ""
      ) {
        return fallback;
      }
      return {
        reducedMotion: parsed.reduced_motion,
        selectedCoverThemeId: parsed.selected_cover_theme_id,
      };
    } catch {
      return fallback;
    }
  }

  /** 保存版本化设置；未来版本文档在当前仓库生命周期内保持只读。 */
  public save(preferences: UiPreferences): void {
    if (!this.canWriteStoredDocument()) {
      return;
    }
    try {
      const payload: StoredUiPreferences = {
        schema_version: this.schemaVersion,
        reduced_motion: preferences.reducedMotion,
        selected_cover_theme_id: preferences.selectedCoverThemeId,
      };
      this.storage?.setItem(this.key, JSON.stringify(payload));
    } catch {
      // 设置属于增强体验，存储受限时不阻断游戏主流程。
    }
  }

  /** 保存前重新检查存储，防止其他页面升级文档后被旧实例覆盖。 */
  private canWriteStoredDocument(): boolean {
    if (this.writeBlockedByFutureSchema) {
      return false;
    }
    let serialized: string | null | undefined;
    try {
      serialized = this.storage?.getItem(this.key);
    } catch {
      return false;
    }
    if (serialized === null || serialized === undefined) {
      return true;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      return true;
    }
    if (!this.isFutureStoredDocument(parsed)) {
      return true;
    }
    this.writeBlockedByFutureSchema = true;
    return false;
  }

  /** 判断未信任文档是否声明了当前代码无法理解的未来版本。 */
  private isFutureStoredDocument(value: unknown): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    const version = value.schema_version;
    return typeof version === "number" &&
      Number.isInteger(version) &&
      version > this.schemaVersion;
  }

  /** 检查未信任的 JSON 值是否为可读取对象。 */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

/** 在 localStorage 不可访问时创建无存储能力的安全仓库。 */
export function createBrowserUiSettingsRepository(
  key: string,
  schemaVersion: number,
): LocalStorageUiSettingsRepository {
  let storage: UiSettingsStorage | null;
  try {
    const browserWindow = (globalThis as { window?: Window }).window;
    storage = browserWindow?.localStorage ?? null;
  } catch {
    storage = null;
  }
  return new LocalStorageUiSettingsRepository(storage, key, schemaVersion);
}
