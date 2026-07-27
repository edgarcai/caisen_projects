import { describe, expect, it } from "vitest";
import { paginateTutorialInstruction } from "../../src/ui/models/GuidedTutorialPagination";

describe("教程通讯分页", () => {
  it("依测量高度分页并优先在中文标点后断开", () => {
    const pages = paginateTutorialInstruction(
      "第一段需要完整阅读。第二段继续说明，第三段收尾。",
      10,
      0.5,
      (text): number => text.length,
    );

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("")).toBe(
      "第一段需要完整阅读。第二段继续说明，第三段收尾。",
    );
    expect(pages.slice(0, -1).every((page) => page.length <= 10)).toBe(true);
  });

  it("空正文仍返回一页，无效布局参数会立即拒绝", () => {
    expect(paginateTutorialInstruction("  ", 10, 0.5, () => 1)).toEqual([""]);
    expect(() => paginateTutorialInstruction("测试", 0, 0.5, () => 1))
      .toThrow("必须大于 0");
    expect(() => paginateTutorialInstruction("测试", 10, 1, () => 1))
      .toThrow("介于 0 与 1");
  });
});
