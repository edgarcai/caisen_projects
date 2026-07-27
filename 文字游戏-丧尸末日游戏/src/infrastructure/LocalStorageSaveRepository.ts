import { SaveDataError } from "../domain/errors";
import type { GameState } from "../domain/game-state";
import type {
  SaveRepository,
  SaveSlotStatus,
  SaveSlotSummary,
  StorageLike,
} from "../domain/ports";
import type { SaveDocument, SaveMigrator } from "./SaveMigration";
import {
  buildSaveBackupStorageKey,
  buildSaveSlotStorageKey,
  FIRST_SAVE_SLOT_ID,
} from "./SaveStorageKeys";

/** 存档仓库实际依赖的最小状态校验能力。 */
export interface SaveStateValidationPort {
  /** 校验迁移前的 v1 状态。 */
  validateRawV1(rawState: unknown): unknown;

  /** 校验迁移前的 v2 状态。 */
  validateRawV2(rawState: unknown): unknown;

  /** 校验当前 v3 状态的精确结构。 */
  validateRawV3(rawState: unknown): unknown;

  /** 校验当前 v4 状态的精确结构。 */
  validateRawV4?(rawState: unknown): unknown;

  /** 校验当前 v5 状态的精确结构。 */
  validateRawV5?(rawState: unknown): unknown;

  /** 校验当前 v6 状态的精确结构。 */
  validateRawV6?(rawState: unknown): unknown;

  /** 校验当前 v7 状态的精确结构。 */
  validateRawV7?(rawState: unknown): unknown;

  /** 校验当前 v8 状态的精确结构。 */
  validateRawV8?(rawState: unknown): unknown;

  /** 校验已经构造完成的领域聚合。 */
  validate(state: GameState): void;

  /** 从未知 JSON 数据解析完整领域聚合。 */
  parse(rawState: unknown): GameState;
}

export interface LocalStorageSaveOptions {
  storage: StorageLike;
  storageKey: string;
  schemaVersion: number;
  slotCount: number;
  backupSlots: number;
  validator: SaveStateValidationPort;
  migrators?: readonly SaveMigrator[];
  now?: () => Date;
}

interface ParsedSaveCandidate {
  readonly state: GameState;
  readonly savedAt: string | null;
}

/** 用版本化 JSON、配置化手动槽位和逐槽滚动备份实现浏览器本地存档。 */
export class LocalStorageSaveRepository implements SaveRepository {
  private readonly storage: StorageLike;
  private readonly storageKey: string;
  private readonly schemaVersion: number;
  private readonly slotCount: number;
  private readonly backupSlots: number;
  private readonly validator: SaveStateValidationPort;
  private readonly migrators: ReadonlyMap<number, SaveMigrator>;
  private readonly now: () => Date;
  private activeSlotId: number;

  /** 绑定存储端口、配置化槽数、版本、备份数量、验证器和迁移链。 */
  public constructor(options: LocalStorageSaveOptions) {
    if (options.storageKey.trim() === "") {
      throw new SaveDataError("存档键名不能为空。");
    }
    if (!Number.isInteger(options.schemaVersion) || options.schemaVersion < 1) {
      throw new SaveDataError("存档版本必须是正整数。");
    }
    if (
      !Number.isInteger(options.slotCount) ||
      options.slotCount < FIRST_SAVE_SLOT_ID
    ) {
      throw new SaveDataError("手动存档槽数量必须是正整数。");
    }
    if (!Number.isInteger(options.backupSlots) || options.backupSlots < 0) {
      throw new SaveDataError("备份槽数量必须是非负整数。");
    }
    this.storage = options.storage;
    this.storageKey = options.storageKey;
    this.schemaVersion = options.schemaVersion;
    this.slotCount = options.slotCount;
    this.backupSlots = options.backupSlots;
    this.validator = options.validator;
    this.now = options.now ?? (() => new Date());
    this.activeSlotId = FIRST_SAVE_SLOT_ID;
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

  /** 返回全部配置化槽位的独立元数据摘要。 */
  public listSlots(): readonly SaveSlotSummary[] {
    try {
      const summaries: SaveSlotSummary[] = [];
      for (
        let slotId = FIRST_SAVE_SLOT_ID;
        slotId <= this.slotCount;
        slotId += 1
      ) {
        summaries.push(this.summarizeSlot(slotId));
      }
      return summaries;
    } catch (error: unknown) {
      throw this.wrapStorageError("无法列出本地存档", error);
    }
  }

  /** 返回指定槽或任一配置化槽是否含有可尝试读取的数据。 */
  public exists(slotId?: number): boolean {
    const slotIds = slotId === undefined
      ? this.allSlotIds()
      : [this.requireSlotId(slotId)];
    try {
      return slotIds.some((candidateSlotId) => this.candidateKeys(candidateSlotId)
        .some((key) => this.storage.getItem(key) !== null));
    } catch (error: unknown) {
      throw this.wrapStorageError("无法检查本地存档", error);
    }
  }

  /** 验证状态、滚动目标槽可信主档到其备份，并写入当前版本文档。 */
  public save(state: GameState, slotId?: number): void {
    const targetSlotId = this.resolveTargetSlot(slotId);
    try {
      this.validateCurrentRawState(state);
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
      const primaryKey = this.slotKey(targetSlotId);
      const current = this.storage.getItem(primaryKey);
      if (current !== null && this.isValidSerialized(current)) {
        this.rotateBackups(current, targetSlotId);
      }
      this.storage.setItem(primaryKey, serialized);
    } catch (error: unknown) {
      if (error instanceof SaveDataError && error.message.startsWith("无法写入存档")) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SaveDataError(
        `无法写入存档槽 ${String(targetSlotId)}：${message}`,
      );
    }
  }

  /** 从目标槽主档与新到旧的备份中返回第一个完整有效状态。 */
  public load(slotId?: number): GameState {
    const targetSlotId = this.resolveTargetSlot(slotId);
    const errors: string[] = [];
    let found = false;
    for (const key of this.candidateKeys(targetSlotId)) {
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
      throw new SaveDataError(`本地存档槽 ${String(targetSlotId)} 不存在。`);
    }
    throw new SaveDataError(
      `存档槽 ${String(targetSlotId)} 的主存档与备份均不可用（${errors.join("；")}）。`,
    );
  }

  /** 选择后续省略 slotId 的保存与读取所使用的活动槽。 */
  public selectSlot(slotId: number): void {
    this.activeSlotId = this.requireSlotId(slotId);
  }

  /** 返回当前活动槽 ID。 */
  public activeSlot(): number {
    return this.activeSlotId;
  }

  /** 返回指定手动槽的稳定主键；一号槽继续使用旧版主键。 */
  public slotKey(slotId: number): string {
    const validatedSlotId = this.requireSlotId(slotId);
    return buildSaveSlotStorageKey(this.storageKey, validatedSlotId);
  }

  /** 返回指定手动槽内一个滚动备份使用的稳定键。 */
  public backupKey(backupIndex: number, slotId: number = this.activeSlotId): string {
    const validatedSlotId = this.requireSlotId(slotId);
    if (
      !Number.isInteger(backupIndex)
      || backupIndex < FIRST_SAVE_SLOT_ID
      || backupIndex > this.backupSlots
    ) {
      throw new RangeError("备份槽索引越界。");
    }
    return buildSaveBackupStorageKey(
      this.storageKey,
      validatedSlotId,
      backupIndex,
    );
  }

  /** 将目标槽旧备份后移一格，并把可信主档保存为第一备份。 */
  private rotateBackups(current: string, slotId: number): void {
    if (this.backupSlots === 0) return;
    for (let backupIndex = this.backupSlots; backupIndex >= 2; backupIndex -= 1) {
      const previous = this.storage.getItem(this.backupKey(backupIndex - 1, slotId));
      if (previous === null) {
        this.storage.removeItem(this.backupKey(backupIndex, slotId));
      } else {
        this.storage.setItem(this.backupKey(backupIndex, slotId), previous);
      }
    }
    this.storage.setItem(this.backupKey(FIRST_SAVE_SLOT_ID, slotId), current);
  }

  /** 返回指定手动槽按恢复优先级排列的主档与备份键。 */
  private candidateKeys(slotId: number): string[] {
    const keys = [this.slotKey(slotId)];
    for (
      let backupIndex = FIRST_SAVE_SLOT_ID;
      backupIndex <= this.backupSlots;
      backupIndex += 1
    ) {
      keys.push(this.backupKey(backupIndex, slotId));
    }
    return keys;
  }

  /** 返回从一号槽到配置上限的稳定槽 ID。 */
  private allSlotIds(): number[] {
    return Array.from(
      { length: this.slotCount },
      (_value, index) => index + FIRST_SAVE_SLOT_ID,
    );
  }

  /** 校验并返回一个位于配置范围内的手动槽 ID。 */
  private requireSlotId(slotId: number): number {
    if (
      !Number.isInteger(slotId)
      || slotId < FIRST_SAVE_SLOT_ID
      || slotId > this.slotCount
    ) {
      throw new RangeError("手动存档槽索引越界。");
    }
    return slotId;
  }

  /** 解析可选显式槽位，并在显式选择时同步活动槽。 */
  private resolveTargetSlot(slotId: number | undefined): number {
    if (slotId === undefined) {
      return this.activeSlotId;
    }
    this.selectSlot(slotId);
    return this.activeSlotId;
  }

  /** 从目标槽首个有效候选创建摘要，损坏数据不会阻断其他槽。 */
  private summarizeSlot(slotId: number): SaveSlotSummary {
    let found = false;
    const keys = this.candidateKeys(slotId);
    for (const [index, key] of keys.entries()) {
      const serialized = this.storage.getItem(key);
      if (serialized === null) continue;
      found = true;
      try {
        const candidate = this.parseSerializedCandidate(serialized);
        return this.summaryFromCandidate(
          slotId,
          index === 0 ? "valid" : "recoverable",
          candidate,
        );
      } catch {
        // 摘要将继续尝试同槽备份；全部失败时统一标记为损坏。
      }
    }
    return this.emptySummary(slotId, found ? "corrupted" : "empty");
  }

  /** 从完整候选投影不依赖 UI 文案的稳定摘要字段。 */
  private summaryFromCandidate(
    slotId: number,
    status: SaveSlotStatus,
    candidate: ParsedSaveCandidate,
  ): SaveSlotSummary {
    const state = candidate.state;
    return {
      slotId,
      status,
      mode: state.mode,
      playerName: state.players[0]?.name ?? null,
      playerNames: state.players.map((player) => player.name),
      survivalDays: state.survival_days,
      clock: structuredClone(state.clock),
      difficultyId: state.campaign.difficulty_id,
      originId: state.campaign.origin_id,
      traitId: state.campaign.trait_id,
      homeCityId: state.campaign.home_city_id,
      savedAt: candidate.savedAt,
    };
  }

  /** 创建空槽或损坏槽的稳定空元数据投影。 */
  private emptySummary(slotId: number, status: "empty" | "corrupted"): SaveSlotSummary {
    return {
      slotId,
      status,
      mode: null,
      playerName: null,
      playerNames: [],
      survivalDays: null,
      clock: null,
      difficultyId: null,
      originId: null,
      traitId: null,
      homeCityId: null,
      savedAt: null,
    };
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
    return this.parseSerializedCandidate(serialized).state;
  }

  /** 解析一个候选文档，并同时保留槽位摘要需要的保存时间。 */
  private parseSerializedCandidate(serialized: string): ParsedSaveCandidate {
    let document: unknown;
    try {
      document = JSON.parse(serialized) as unknown;
    } catch (error: unknown) {
      throw new SaveDataError(`存档 JSON 已损坏：${this.errorMessage(error)}`);
    }
    const prepared = this.prepareDocument(document);
    return {
      state: this.validator.parse(prepared.game_state),
      savedAt: typeof prepared.saved_at === "string" ? prepared.saved_at : null,
    };
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
      } else if (version === 2) {
        this.validator.validateRawV2(prepared.game_state);
      } else if (version === 3) {
        this.validator.validateRawV3(prepared.game_state);
      } else if (version === 4) {
        if (this.validator.validateRawV4 === undefined) {
          throw new SaveDataError("缺少存档版本 4 的结构校验器。");
        }
        this.validator.validateRawV4(prepared.game_state);
      } else if (version === 5) {
        if (this.validator.validateRawV5 === undefined) {
          throw new SaveDataError("缺少存档版本 5 的结构校验器。");
        }
        this.validator.validateRawV5(prepared.game_state);
      } else if (version === 6) {
        if (this.validator.validateRawV6 === undefined) {
          throw new SaveDataError("缺少存档版本 6 的结构校验器。");
        }
        this.validator.validateRawV6(prepared.game_state);
      } else if (version === 7) {
        if (this.validator.validateRawV7 === undefined) {
          throw new SaveDataError("缺少存档版本 7 的结构校验器。");
        }
        this.validator.validateRawV7(prepared.game_state);
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
    this.validateCurrentRawState(prepared.game_state);
    return prepared;
  }

  /** 按仓库目标版本调用精确结构校验器，兼容旧版仓库专项测试。 */
  private validateCurrentRawState(rawState: unknown): void {
    if (this.schemaVersion === 3) {
      this.validator.validateRawV3(rawState);
      return;
    }
    if (this.schemaVersion === 4) {
      if (this.validator.validateRawV4 === undefined) {
        throw new SaveDataError("缺少当前存档版本 4 的结构校验器。");
      }
      this.validator.validateRawV4(rawState);
      return;
    }
    if (this.schemaVersion === 5) {
      if (this.validator.validateRawV5 === undefined) {
        throw new SaveDataError("缺少当前存档版本 5 的结构校验器。");
      }
      this.validator.validateRawV5(rawState);
      return;
    }
    if (this.schemaVersion === 6) {
      if (this.validator.validateRawV6 === undefined) {
        throw new SaveDataError("缺少当前存档版本 6 的结构校验器。");
      }
      this.validator.validateRawV6(rawState);
      return;
    }
    if (this.schemaVersion === 7) {
      if (this.validator.validateRawV7 === undefined) {
        throw new SaveDataError("缺少当前存档版本 7 的结构校验器。");
      }
      this.validator.validateRawV7(rawState);
      return;
    }
    if (this.schemaVersion === 8) {
      if (this.validator.validateRawV8 === undefined) {
        throw new SaveDataError("缺少当前存档版本 8 的结构校验器。");
      }
      this.validator.validateRawV8(rawState);
      return;
    }
    throw new SaveDataError(
      `缺少当前存档版本 ${String(this.schemaVersion)} 的结构校验器。`,
    );
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
