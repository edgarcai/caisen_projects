import type { AccountProfile, AccountRepository } from "../domain/coop";
import type { StorageLike } from "../domain/ports";

/** 使用浏览器键值存储保存非敏感的本地游戏身份。 */
export class LocalAccountRepository implements AccountRepository {
  private readonly storage: StorageLike;
  private readonly storageKey: string;

  /** 注入存储端口和配置化键名。 */
  public constructor(storage: StorageLike, storageKey: string) {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  /** 读取并防御性校验本地账户文档。 */
  public load(): AccountProfile | null {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isAccountProfile(parsed)) {
        this.storage.removeItem(this.storageKey);
        return null;
      }
      return { ...parsed };
    } catch {
      this.storage.removeItem(this.storageKey);
      return null;
    }
  }

  /** 保存已由用例层校验的本地账户。 */
  public save(profile: AccountProfile): void {
    this.storage.setItem(this.storageKey, JSON.stringify(profile));
  }

  /** 登出并清除本地账户。 */
  public clear(): void {
    this.storage.removeItem(this.storageKey);
  }
}

/** 判断未知 JSON 是否为最小账户文档。 */
function isAccountProfile(value: unknown): value is AccountProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.accountId === "string"
    && profile.accountId.trim() !== ""
    && typeof profile.displayName === "string"
    && profile.displayName.trim() !== "";
}

