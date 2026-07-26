import { SaveDataError } from "../domain/errors";
import type { GameState } from "../domain/game-state";
import type { SaveRepository, StorageLike } from "../domain/ports";
import type { SaveStateValidator } from "./SaveStateValidator";
import type { SaveDocument, SaveMigrator } from "./V1ToV2SaveMigrator";

export interface LocalStorageSaveOptions {
  storage: StorageLike;
  storageKey: string;
  schemaVersion: number;
  backupSlots: number;
  validator: SaveStateValidator;
  migrators?: readonly SaveMigrator[];
  now?: () => Date;
}

/** 用版本化 JSON、滚动备份和严格校验实现浏览器本地存档。 */
export class LocalStorageSaveRepository implements SaveRepository {
  private readonly storage: StorageLike;
  private readonly storageKey: string;
  private readonly schemaVersion: number;
  private readonly backupSlots: number;
  private readonly validator: SaveStateValidator;
  private readonly migrators: ReadonlyMap<number, SaveMigrator>;
  private readonly now: () => Date;

  /** 绑定存储端口、配置化键名、版本、备份数量、验证器和迁移链。 */
  public constructor(options: LocalStorageSaveOptions) {
    if (options.storageKey.trim() === "") {
      throw new SaveDataError("存档键名不能为空。");
    }
    if (!Number.isInteger(options.schemaVersion) || options.schemaVersion < 1) {
      throw new SaveDataError("存档版本必须是正整数。");
    }
    if (!Number.isInteger(options.backupSlots) || options.backupSlots < 0) {
      throw new SaveDataError("备份槽数量必须是非负整数。");
    }
    this.storage = options.storage;
    this.storageKey = options.storageKey;
    this.schemaVersion = options.schemaVersion;
    this.backupSlots = options.backupSlots;
    this.validator = options.validator;
    this.now = options.now ?? (() => new Date());
    const migrators = new Map<number, SaveMigrator>();
    for (const migrator of options.migrators ?? []) {
      if (migrator.toVersion !== migrator.fromVersion + 1) {
        throw new SaveDataError("存档迁移器必须每次只前进一个版本。");
      }
      if (migrators.has(migrator.fromVersion)) {
        throw new SaveDataError(
          `存档版本 ${String(migrator.fromVersion)} 存在重复迁移器。`,
        );
      }
      migrators.set(migrator.fromVersion, migrator);
    }
    this.migrators = migrators;
  }

  /** 返回主存档或任一备份槽是否含有可尝试读取的数据。 */
  public exists(): boolean {
    try {
      return this.candidateKeys().some((key) => this.storage.getItem(key) !== null);
    } catch (error: unknown) {
      throw this.wrapStorageError("无法检查本地存档", error);
    }
  }

  /** 验证状态、滚动可信主档到备份，并写入新的 v2 文档。 */
  public save(state: GameState): void {
    try {
      this.validator.validate(state);
      const savedAt = this.now();
      if (Number.isNaN(savedAt.getTime())) {
        throw new SaveDataError("存档时间无效。");
      }
      const document: SaveDocument = {
        schema_version: this.schemaVersion,
        saved_at: savedAt.toISOString(),
        game_state: structuredClone(state),
      };
      const serialized = JSON.stringify(document);
      const current = this.storage.getItem(this.storageKey);
      if (current !== null && this.isValidSerialized(current)) {
        this.rotateBackups(current);
      }
      this.storage.setItem(this.storageKey, serialized);
    } catch (error: unknown) {
      if (error instanceof SaveDataError && error.message.startsWith("无法写入存档")) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SaveDataError(`无法写入存档：${message}`);
    }
  }

  /** 依次尝试主档与新到旧的备份，并返回第一个完整有效状态。 */
  public load(): GameState {
    const errors: string[] = [];
    let found = false;
    for (const key of this.candidateKeys()) {
      let serialized: string | null;
      try {
        serialized = this.storage.getItem(key);
      } catch (error: unknown) {
        errors.push(`${key}：${this.errorMessage(error)}`);
        continue;
      }
      if (serialized === null) continue;
      found = true;
      try {
        return this.parseSerialized(serialized);
      } catch (error: unknown) {
        errors.push(`${key}：${this.errorMessage(error)}`);
      }
    }
    if (!found) {
      throw new SaveDataError("本地存档不存在。");
    }
    throw new SaveDataError(`主存档与备份均不可用（${errors.join("；")}）。`);
  }

  /** 返回指定备份槽使用的稳定存储键。 */
  public backupKey(slot: number): string {
    if (!Number.isInteger(slot) || slot < 1 || slot > this.backupSlots) {
      throw new RangeError("备份槽索引越界。");
    }
    return `${this.storageKey}:backup:${String(slot)}`;
  }

  /** 将旧备份后移一槽，并把可信主档保存为第一备份。 */
  private rotateBackups(current: string): void {
    if (this.backupSlots === 0) return;
    for (let slot = this.backupSlots; slot >= 2; slot -= 1) {
      const previous = this.storage.getItem(this.backupKey(slot - 1));
      if (previous === null) {
        this.storage.removeItem(this.backupKey(slot));
      } else {
        this.storage.setItem(this.backupKey(slot), previous);
      }
    }
    this.storage.setItem(this.backupKey(1), current);
  }

  /** 返回按恢复优先级排列的主档与备份键。 */
  private candidateKeys(): string[] {
    const keys = [this.storageKey];
    for (let slot = 1; slot <= this.backupSlots; slot += 1) {
      keys.push(this.backupKey(slot));
    }
    return keys;
  }

  /** 判断序列化文档能否通过当前迁移链和全部状态校验。 */
  private isValidSerialized(serialized: string): boolean {
    try {
      this.parseSerialized(serialized);
      return true;
    } catch {
      return false;
    }
  }

  /** 解析 JSON、迁移到当前版本并恢复经校验的领域状态。 */
  private parseSerialized(serialized: string): GameState {
    let document: unknown;
    try {
      document = JSON.parse(serialized) as unknown;
    } catch (error: unknown) {
      throw new SaveDataError(`存档 JSON 已损坏：${this.errorMessage(error)}`);
    }
    const prepared = this.prepareDocument(document);
    return this.validator.parse(prepared.game_state);
  }

  /** 严格检查顶层信封，并逐版本执行单步迁移。 */
  private prepareDocument(rawDocument: unknown): SaveDocument {
    let prepared = this.validateEnvelope(rawDocument);
    const rawVersion = prepared.schema_version;
    if (typeof rawVersion !== "number") {
      throw new SaveDataError("schema_version 必须是整数。");
    }
    let version: number = rawVersion;
    if (version > this.schemaVersion) {
      throw new SaveDataError(`不支持的未来存档版本：${String(version)}。`);
    }
    while (version < this.schemaVersion) {
      if (version === 1) {
        this.validator.validateRawV1(prepared.game_state);
      } else {
        throw new SaveDataError(`缺少存档版本 ${String(version)} 的结构校验器。`);
      }
      const migrator = this.migrators.get(version);
      if (migrator === undefined) {
        throw new SaveDataError(
          `缺少存档版本 ${String(version)} 到 ${String(version + 1)} 的迁移器。`,
        );
      }
      prepared = this.validateEnvelope(migrator.migrate(prepared));
      const migratedVersion = prepared.schema_version;
      if (migratedVersion !== migrator.toVersion) {
        throw new SaveDataError("存档迁移器返回了错误的目标版本。");
      }
      version = migrator.toVersion;
    }
    this.validator.validateRawV2(prepared.game_state);
    return prepared;
  }

  /** 严格校验信封字段、版本、时间戳与 game_state 容器。 */
  private validateEnvelope(value: unknown): SaveDocument {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new SaveDataError("存档顶层必须是对象。");
    }
    const document = value as SaveDocument;
    const keys = Object.keys(document);
    const allowed = new Set(["schema_version", "saved_at", "game_state"]);
    if (
      !keys.includes("schema_version")
      || !keys.includes("game_state")
      || keys.some((key) => !allowed.has(key))
    ) {
      throw new SaveDataError("存档顶层字段集合不匹配。");
    }
    if (typeof document.schema_version !== "number" || !Number.isInteger(document.schema_version)) {
      throw new SaveDataError("schema_version 必须是整数。");
    }
    if (document.schema_version < 1) {
      throw new SaveDataError("存档版本必须为正整数。");
    }
    if (document.saved_at !== undefined && typeof document.saved_at !== "string") {
      throw new SaveDataError("saved_at 必须是字符串。");
    }
    if (
      typeof document.game_state !== "object"
      || document.game_state === null
      || Array.isArray(document.game_state)
    ) {
      throw new SaveDataError("存档缺少 game_state。");
    }
    return structuredClone(document);
  }

  /** 把存储实现抛出的未知异常转换成稳定存档错误。 */
  private wrapStorageError(prefix: string, error: unknown): SaveDataError {
    return new SaveDataError(`${prefix}：${this.errorMessage(error)}`);
  }

  /** 提取未知异常的可读信息。 */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
