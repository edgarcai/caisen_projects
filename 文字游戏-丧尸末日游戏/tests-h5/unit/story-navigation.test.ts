import { describe, expect, it } from "vitest";
import { resolveStoryProgressScreen } from "../../src/ui/navigation/StoryNavigation";

describe("剧情连续导航", () => {
  it("剧情选择后存在下一任务时继续停留在剧情页", () => {
    expect(resolveStoryProgressScreen({
      battle: null,
      ending: null,
      ended: false,
      storyAccess: "mode",
      storyPrompt: {
        id: "next-scene",
        title: "下一项任务",
        body: "继续推进",
        options: [],
      },
    })).toBe("story");
  });

  it("战斗、结局与无任务状态保持各自优先级", () => {
    expect(resolveStoryProgressScreen({
      battle: {
        bossId: "boss",
        bossName: "首领",
        health: 10,
        maximumHealth: 10,
        phaseLabel: "第一阶段",
        body: "",
        actions: [],
      },
      ending: null,
      ended: false,
      storyAccess: "mode",
      storyPrompt: null,
    })).toBe("battle");
    expect(resolveStoryProgressScreen({
      battle: null,
      ending: { title: "终局", body: "", tone: "danger" },
      ended: true,
      storyAccess: "mode",
      storyPrompt: null,
    })).toBe("ending");
    expect(resolveStoryProgressScreen({
      battle: null,
      ending: null,
      ended: false,
      storyAccess: "mode",
      storyPrompt: null,
    })).toBe("dashboard");
  });
});
