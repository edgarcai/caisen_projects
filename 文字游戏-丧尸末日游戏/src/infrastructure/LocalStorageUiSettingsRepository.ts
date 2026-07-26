import type {
  UiPreferences,
  UiSettingsPort,
} from "../ui/ports/UiSettingsPort";

/** 设置存储中的版本化 JSON 结构。 */
interface StoredUiPreferences {
  readonly schema_version: number;
  readonly reduced_motion: boolean;
}

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

  /** 保存可注入的存储实现、配置化键名和版本。 */
  public constructor(
    storage: UiSettingsStorage | null,
    key: string,
    schemaVersion: number,
  ) {
    this.storage = storage;
    this.key = key;
    this.schemaVersion = schemaVersion;
  }

  /** 读取并校验设置，任何浏览器存储异常都返回配置默认值。 */
  public load(fallback: UiPreferences): UiPreferences {
    try {
      const serialized = this.storage?.getItem(this.key);
      if (serialized === null || serialized === undefined) {
        return fallback;
      }
      const parsed = JSON.parse(serialized) as Partial<StoredUiPreferences>;
      if (
        parsed.schema_version !== this.schemaVersion ||
        typeof parsed.reduced_motion !== "boolean"
      ) {
        return fallback;
      }
      return { reducedMotion: parsed.reduced_motion };
    } catch {
      return fallback;
    }
  }

  /** 保存版本化设置；浏览器拒绝存储时保持当前会话可用。 */
  public save(preferences: UiPreferences): void {
    try {
      const payload: StoredUiPreferences = {
        schema_version: this.schemaVersion,
        reduced_motion: preferences.reducedMotion,
      };
      this.storage?.setItem(this.key, JSON.stringify(payload));
    } catch {
      // 设置属于增强体验，存储受限时不阻断游戏主流程。
    }
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
