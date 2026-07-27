import { formatTemplate } from "../domain/content";
import type {
  ArchiveCollectionConfig,
  ArchiveCollectionOverview,
  ArchiveDocumentConfig,
  ArchiveDocumentListItem,
  ArchiveLibrarySnapshot,
  ArchiveStorageConfig,
} from "../domain/demo-systems";
import { DomainError } from "../domain/errors";
import type { GameState } from "../domain/game-state";
import type { StateMutationObserver } from "./StateOperations";

/** 按历史累计入库量维护并投影报纸、书籍等文献。 */
export class ArchiveStorageService implements StateMutationObserver {
  private readonly config: ArchiveStorageConfig;
  private readonly collectionById: ReadonlyMap<string, ArchiveCollectionConfig>;
  private readonly collectionByStateTarget: ReadonlyMap<string, ArchiveCollectionConfig>;

  /** 注入只读文献内容与配置化资源目标。 */
  public constructor(config: ArchiveStorageConfig) {
    this.config = config;
    this.collectionById = new Map(
      config.collections.map((collection) => [collection.collection_id, collection]),
    );
    this.collectionByStateTarget = new Map(
      config.collections.map((collection) => [collection.state_target, collection]),
    );
    if (this.collectionByStateTarget.size !== config.collections.length) {
      throw new DomainError("文献分类不能共用同一个库存状态目标。");
    }
  }

  /** 为新开局按当前初始库存建立完整累计馆藏映射。 */
  public initializeProgress(state: GameState): void {
    state.archive_collection_totals = Object.fromEntries(
      this.config.collections.map((collection) => [
        collection.collection_id,
        this.currentInventoryCopies(state, collection),
      ]),
    );
  }

  /** 记录配置化库存的正向变化，扣除与设置为更小值均不回退馆藏。 */
  public stateChanged(
    target: string,
    previousValue: number,
    currentValue: number,
    state: GameState,
  ): void {
    const collection = this.collectionByStateTarget.get(target);
    if (collection === undefined || currentValue <= previousValue) return;
    const storedCopies = state.archive_collection_totals[collection.collection_id];
    if (typeof storedCopies !== "number" || !Number.isInteger(storedCopies) || storedCopies < 0) {
      throw new DomainError(`文献馆藏进度缺失：${collection.collection_id}`);
    }
    state.archive_collection_totals[collection.collection_id] = storedCopies
      + currentValue
      - previousValue;
  }

  /** 校验存档中的分类集合、累计份数和当前库存关系。 */
  public validatePersistentState(state: GameState): void {
    const expectedIds = [...this.collectionById.keys()].sort();
    const actualIds = Object.keys(state.archive_collection_totals).sort();
    if (
      expectedIds.length !== actualIds.length
      || expectedIds.some((id, index) => id !== actualIds[index])
    ) {
      throw new DomainError("文献馆藏进度的分类集合与配置不匹配。");
    }
    for (const collection of this.config.collections) {
      const collectedCopies = state.archive_collection_totals[collection.collection_id];
      if (
        typeof collectedCopies !== "number"
        || !Number.isInteger(collectedCopies)
        || collectedCopies < 0
      ) {
        throw new DomainError(`文献馆藏份数无效：${collection.collection_id}`);
      }
      if (collectedCopies < this.currentInventoryCopies(state, collection)) {
        throw new DomainError(`文献馆藏份数低于当前库存：${collection.collection_id}`);
      }
    }
  }

  /** 返回所有文献分类的收集数量和解锁完成度。 */
  public overview(state: GameState): ArchiveCollectionOverview[] {
    return this.config.collections.map((collection) => {
      const collectedCopies = this.collectedCopies(state, collection);
      return {
        collectionId: collection.collection_id,
        label: collection.label,
        description: collection.description,
        collectedCopies,
        unlockedDocuments: collection.documents.filter(
          (document) => collectedCopies >= document.required_copies,
        ).length,
        totalDocuments: collection.documents.length,
      };
    });
  }

  /** 一次性生成馆藏概览、目录和已解锁正文，避免 UI 重复查询领域服务。 */
  public librarySnapshot(state: GameState): ArchiveLibrarySnapshot {
    return {
      collections: this.overview(state).map((overview) => {
        const documents = this.list(state, overview.collectionId);
        return {
          overview,
          documents,
          unlockedDocuments: documents
            .filter((document) => document.unlocked)
            .map((document) => this.detail(
              state,
              overview.collectionId,
              document.documentId,
            )),
        };
      }),
    };
  }

  /** 返回指定分类的目录；未解锁条目只暴露配置化锁定文案。 */
  public list(
    state: GameState,
    collectionId: string,
  ): ArchiveDocumentListItem[] {
    const collection = this.requireCollection(collectionId);
    const copies = this.collectedCopies(state, collection);
    return collection.documents.map((document) => {
      const unlocked = copies >= document.required_copies;
      return {
        documentId: document.document_id,
        requiredCopies: document.required_copies,
        title: unlocked
          ? document.title
          : this.text("locked_title", { required_copies: document.required_copies }),
        summary: unlocked ? document.summary : this.text("locked_summary"),
        unlocked,
      };
    });
  }

  /** 返回一篇已解锁文献的完整正文；未收集到门槛时拒绝提前读取。 */
  public detail(
    state: GameState,
    collectionId: string,
    documentId: string,
  ): ArchiveDocumentConfig {
    const collection = this.requireCollection(collectionId);
    const document = collection.documents.find(
      (candidate) => candidate.document_id === documentId,
    );
    if (document === undefined) {
      throw new DomainError(this.text("unknown_document", {
        collection_id: collectionId,
        document_id: documentId,
      }));
    }
    if (this.collectedCopies(state, collection) < document.required_copies) {
      throw new DomainError(this.text("document_locked", {
        required_copies: document.required_copies,
        collection_label: collection.label,
      }));
    }
    return structuredClone(document);
  }

  /** 返回一次收集数量变化中新解锁的全部文献，供通讯栏生成提示。 */
  public newlyUnlocked(
    collectionId: string,
    previousCopies: number,
    currentCopies: number,
  ): ArchiveDocumentConfig[] {
    const collection = this.requireCollection(collectionId);
    if (
      !Number.isInteger(previousCopies)
      || !Number.isInteger(currentCopies)
      || previousCopies < 0
      || currentCopies < previousCopies
    ) {
      throw new DomainError("文献收集数量变化必须是递增的非负整数。");
    }
    return collection.documents
      .filter((document) => (
        document.required_copies > previousCopies
        && document.required_copies <= currentCopies
      ))
      .map((document) => structuredClone(document));
  }

  /** 从持久化馆藏进度读取只增不减的累计收集数量。 */
  private collectedCopies(state: GameState, collection: ArchiveCollectionConfig): number {
    const copies = state.archive_collection_totals[collection.collection_id];
    if (typeof copies !== "number" || !Number.isInteger(copies) || copies < 0) {
      throw new DomainError(`文献馆藏进度缺失：${collection.collection_id}`);
    }
    return copies;
  }

  /** 按配置化点路径读取初始库存，不在服务内写入游戏资源。 */
  private currentInventoryCopies(
    state: GameState,
    collection: ArchiveCollectionConfig,
  ): number {
    let value: unknown = state;
    for (const segment of collection.state_target.split(".")) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new DomainError(`文献库存目标无效：${collection.state_target}`);
      }
      value = Reflect.get(value, segment) as unknown;
    }
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new DomainError(`文献库存必须是非负整数：${collection.state_target}`);
    }
    return value as number;
  }

  /** 要求稳定 ID 对应一个文献分类。 */
  private requireCollection(collectionId: string): ArchiveCollectionConfig {
    const collection = this.collectionById.get(collectionId);
    if (collection === undefined) {
      throw new DomainError(this.text("unknown_collection", {
        collection_id: collectionId,
      }));
    }
    return collection;
  }

  /** 读取并格式化一条文献存储文案。 */
  private text(
    key: string,
    values: Readonly<Record<string, string | number>> = {},
  ): string {
    const template = this.config.texts[key];
    if (template === undefined) throw new DomainError(`缺少文献存储文案：${key}`);
    return formatTemplate(template, values);
  }
}
