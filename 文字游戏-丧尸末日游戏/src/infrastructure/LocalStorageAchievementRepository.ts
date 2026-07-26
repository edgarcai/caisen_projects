import type {
  AchievementProgressPort,
  StorageLike,
} from "../domain/ports";

/** 成就元进度的版本化本地文档。 */
interface StoredAchievementProgress {
  readonly schema_version: number;
  readonly unlocked_achievement_ids: readonly string[];
}

/** 本地文档的安全读取结果。 */
interface AchievementReadResult {
  readonly ids: readonly string[];
  readonly allowWrite: boolean;
}

/**
 * 使用独立版本化 localStorage 文档保存跨存档成就。
 */
export class LocalStorageAchievementRepository implements AchievementProgressPort {
  private readonly storage: StorageLike;
  private readonly key: string;
  private readonly schemaVersion: number;
  private readonly sessionIds = new Set<string>();

  /** 绑定可注入存储、配置化键名与文档版本。 */
  public constructor(
    storage: StorageLike,
    key: string,
    schemaVersion: number,
  ) {
    if (key.trim() === "") {
      throw new RangeError("成就存储键名不能为空。");
    }
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new RangeError("成就存储版本必须是正整数。");
    }
    this.storage = storage;
    this.key = key;
    this.schemaVersion = schemaVersion;
  }

  /** 合并已持久与当前会话进度，并返回隔离副本。 */
  public unlockedAchievementIds(): readonly string[] {
    const stored = this.readStoredProgress();
    return this.mergeIds(stored.ids, this.sessionIds);
  }

  /** 只在首次解锁时写入合并后的完整快照。 */
  public unlock(achievementId: string): boolean {
    const normalizedId = this.requireAchievementId(achievementId);
    const stored = this.readStoredProgress();
    const current = this.mergeIds(stored.ids, this.sessionIds);
    if (current.includes(normalizedId)) {
      return false;
    }
    const next = [...current, normalizedId];
    this.sessionIds.add(normalizedId);
    if (stored.allowWrite) {
      this.tryWrite(next);
    }
    return true;
  }

  /** 读取并严格校验本地文档；损坏或存储受限时安全降级。 */
  private readStoredProgress(): AchievementReadResult {
    let serialized: string | null;
    try {
      serialized = this.storage.getItem(this.key);
    } catch {
      return { ids: [], allowWrite: false };
    }
    if (serialized === null) {
      return { ids: [], allowWrite: true };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      return { ids: [], allowWrite: true };
    }
    if (!this.isRecord(parsed)) {
      return { ids: [], allowWrite: true };
    }
    const version = parsed.schema_version;
    if (typeof version !== "number" || !Number.isInteger(version)) {
      return { ids: [], allowWrite: true };
    }
    if (version > this.schemaVersion) {
      return { ids: [], allowWrite: false };
    }
    const ids = parsed.unlocked_achievement_ids;
    if (!this.isValidIdList(ids)) {
      return { ids: [], allowWrite: true };
    }
    return { ids: [...ids], allowWrite: true };
  }

  /** 写入当前版本快照；浏览器拒绝时保留会话内解锁。 */
  private tryWrite(ids: readonly string[]): void {
    const document: StoredAchievementProgress = {
      schema_version: this.schemaVersion,
      unlocked_achievement_ids: [...ids],
    };
    try {
      this.storage.setItem(this.key, JSON.stringify(document));
    } catch {
      // 成就会在当前会话保持解锁，不让存储限制中断游戏结算。
    }
  }

  /** 保留首次解锁顺序并合并不重复 ID。 */
  private mergeIds(
    storedIds: readonly string[],
    sessionIds: ReadonlySet<string>,
  ): string[] {
    return [...new Set([...storedIds, ...sessionIds])];
  }

  /** 校验外部提交的成就 ID 并返回去除首尾空白的值。 */
  private requireAchievementId(achievementId: string): string {
    const normalized = achievementId.trim();
    if (normalized === "") {
      throw new RangeError("成就 ID 不能为空。");
    }
    return normalized;
  }

  /** 检查未信任 JSON 值是否为非空、无重复的成就 ID 列表。 */
  private isValidIdList(value: unknown): value is string[] {
    if (!Array.isArray(value)) {
      return false;
    }
    const ids = value.filter((entry): entry is string => (
      typeof entry === "string"
      && entry !== ""
      && entry === entry.trim()
    ));
    return ids.length === value.length && new Set(ids).size === ids.length;
  }

  /** 检查未信任 JSON 值是否为普通对象。 */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
