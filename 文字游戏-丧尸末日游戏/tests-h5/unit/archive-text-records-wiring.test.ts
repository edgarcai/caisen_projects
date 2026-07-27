import { describe, expect, it } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import { archiveDocumentViewKey } from "../../src/ui/models/DemoSystemViewModels";
import {
  buildH5Harness,
  requireState,
} from "../helpers/H5TestHarness";

const webConfig = parseWebGameConfig(webConfigDocument);

/** 同步增加当前库存与只增不减的馆藏计数。 */
function collectArchiveCopies(
  state: ReturnType<typeof requireState>,
  collectionId: "newspapers" | "books",
  copies: number,
): void {
  state.shelter[collectionId] = copies;
  state.archive_collection_totals[collectionId] = copies;
}

describe("封面文本记录与文献馆藏接线", () => {
  it("未开局且无存档时保留配置化的明确空状态", () => {
    const { adapter } = buildH5Harness();

    const snapshot = adapter.getSnapshot();

    expect(snapshot.archiveStorage).toBeNull();
    expect(snapshot.archiveCollections).toEqual({});
    expect(snapshot.archiveDocuments).toEqual({});
    expect(webConfig.texts.text_records_empty_body).toContain("开始新游戏");
    expect(webConfig.texts.text_records_empty_body).toContain("有效存档");
  });

  it("当前局实时投影报纸和书籍目录及已解锁正文", () => {
    const { adapter, application } = buildH5Harness();
    adapter.execute({ type: "start_game", mode: "single", playerNames: ["馆员"] });
    const state = requireState(application);
    collectArchiveCopies(state, "newspapers", 1);
    collectArchiveCopies(state, "books", 1);

    const snapshot = adapter.getSnapshot();
    const newspaper = snapshot.archiveCollections.newspapers?.documents[0];
    const book = snapshot.archiveCollections.books?.documents[0];

    expect(snapshot.archiveStorage?.collections).toHaveLength(2);
    expect(newspaper).toMatchObject({ documentId: "newspaper_01", unlocked: true });
    expect(book).toMatchObject({ documentId: "book_01", unlocked: true });
    expect(snapshot.archiveDocuments[
      archiveDocumentViewKey("newspapers", "newspaper_01")
    ]?.body.length).toBeGreaterThan(80);
    expect(snapshot.archiveDocuments[
      archiveDocumentViewKey("books", "book_01")
    ]?.body.length).toBeGreaterThan(80);
  });

  it("菜单态只读预览有效存档，不会暗中进入游戏", () => {
    const writer = buildH5Harness();
    writer.adapter.execute({
      type: "start_game",
      mode: "single",
      playerNames: ["存档馆员"],
    });
    const writerState = requireState(writer.application);
    collectArchiveCopies(writerState, "newspapers", 2);
    collectArchiveCopies(writerState, "books", 1);
    expect(writer.adapter.execute({ type: "save_game", slotId: 1 }).accepted).toBe(true);

    const reader = buildH5Harness({ storage: writer.storage });
    const snapshot = reader.adapter.getSnapshot();

    expect(reader.application.state).toBeNull();
    expect(reader.adapter.canLoadGame()).toBe(true);
    expect(snapshot.mode).toBeNull();
    expect(snapshot.archiveStorage).not.toBeNull();
    expect(snapshot.archiveCollections.newspapers?.documents
      .filter((document) => document.unlocked)).toHaveLength(2);
    expect(snapshot.archiveCollections.books?.documents[0]).toMatchObject({
      documentId: "book_01",
      unlocked: true,
    });
    expect(snapshot.archiveDocuments[
      archiveDocumentViewKey("newspapers", "newspaper_02")
    ]?.body).toContain("三号线");
    expect(reader.application.state).toBeNull();
  });
});
