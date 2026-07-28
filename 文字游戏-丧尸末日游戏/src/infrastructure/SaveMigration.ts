export type SaveDocument = Record<string, unknown>;

export interface SaveMigrator {
  readonly fromVersion: number;
  readonly toVersion: number;

  /** 把一个已校验源版本文档迁移到下一版本。 */
  migrate(document: Readonly<SaveDocument>): SaveDocument;
}
