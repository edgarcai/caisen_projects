import { describe, expect, it } from "vitest";
import storyDocument from "../../config/story.json";
import type {
  ModeRestrictedContentConfig,
  StoryConfigDocument,
} from "../../src/domain/content";
import type { ManagementCategory } from "../../src/domain/reports";
import { buildH5Harness } from "../helpers/H5TestHarness";

const story = storyDocument as unknown as StoryConfigDocument;

interface TaggedManagementEntry extends ModeRestrictedContentConfig {
  readonly id: string;
  readonly category: ManagementCategory;
}

/** 从权威剧情配置汇总全部需要主线能力的经营项。 */
function taggedManagementEntries(): readonly TaggedManagementEntry[] {
  return [
    ...story.facilities.map((entry) => ({
      ...entry,
      id: entry.facility_id,
      category: "facility" as const,
    })),
    ...story.facility_actions.map((entry) => ({
      ...entry,
      id: entry.action_id,
      category: "facility_use" as const,
    })),
    ...story.jobs.map((entry) => ({
      ...entry,
      id: entry.job_id,
      category: "job" as const,
    })),
    ...story.activities.map((entry) => ({
      ...entry,
      id: entry.activity_id,
      category: "activity" as const,
    })),
    ...story.trades.map((entry) => ({
      ...entry,
      id: entry.trade_id,
      category: "trade_buy" as const,
    })),
    ...story.recruits.map((entry) => ({
      ...entry,
      id: entry.recruit_id,
      category: "recruit" as const,
    })),
  ].filter((entry) => entry.required_mode_capability !== undefined);
}

/** 按指定模式启动一局真实应用测试。 */
function startedApplication(mode: "single" | "story") {
  const harness = buildH5Harness();
  harness.application.startNewGame(["隔离测试所长"], mode);
  return harness.application;
}

describe("普通模式经营内容隔离", () => {
  it("目录与命令边界同时隐藏剧情经营项", () => {
    const tagged = taggedManagementEntries();
    expect(tagged.length).toBeGreaterThan(0);
    const single = startedApplication("single");
    const visibleIds = new Set(single.managementOptions().map((option) => option.optionId));

    expect(tagged.every((entry) => !visibleIds.has(entry.id))).toBe(true);
    expect(single.managementOptions()).toContainEqual(expect.objectContaining({
      optionId: "infirmary",
      category: "facility",
    }));
    const forged = tagged.find((entry) => entry.category === "job");
    if (forged === undefined) throw new Error("测试缺少剧情工作项。");
    expect(() => single.performManagement(forged.category, forged.id)).toThrow(
      /未开放能力/u,
    );
  });

  it("剧情模式保留配置声明的全部经营项", () => {
    const storyApplication = startedApplication("story");
    const visibleIds = new Set(
      storyApplication.managementOptions().map((option) => option.optionId),
    );

    expect(taggedManagementEntries().every((entry) => visibleIds.has(entry.id))).toBe(true);
  });
});
