import { describe, expect, it } from "vitest";
import { contentExpansionCatalog } from "../../src/config/contentExpansion";
import type { GameState } from "../../src/domain/game-state";
import type { RuleModifierProvider } from "../../src/domain/ports";
import {
  CampaignDifficultyRules,
  ChronicleService,
  GameRules,
} from "../../src/services";
import {
  buildH5Harness,
  requirePlayer,
  requireState,
  ScriptedRandomSource,
} from "../helpers/H5TestHarness";

interface FailureFixture {
  readonly rules: GameRules;
  readonly state: GameState;
}

interface FailureScenario {
  readonly label: string;
  readonly expectedEndingId: string;
  readonly arrange: (fixture: FailureFixture) => void;
}

const NO_RULE_MODIFIERS: RuleModifierProvider = {
  /** 失败条件测试不需要任何设施被动修正。 */
  passiveModifier: () => 0,
};

const FAILURE_SCENARIOS: readonly FailureScenario[] = [
  {
    label: "感染压力到达上限",
    expectedEndingId: "infection_bloom",
    arrange: ({ rules, state }) => {
      state.story.infection_pressure = rules.limits.infection_pressure_game_over;
    },
  },
  {
    label: "所长倒下",
    expectedEndingId: "commander_fallen",
    arrange: ({ state }) => {
      requirePlayer(state).health = 0;
    },
  },
  {
    label: "内墙崩塌",
    expectedEndingId: "inner_wall_collapse",
    arrange: ({ state }) => {
      state.shelter.inner_wall_health = 0;
      state.shelter.health = state.shelter.outer_wall_health;
    },
  },
  {
    label: "活跃度过高",
    expectedEndingId: "lost_exodus",
    arrange: ({ rules, state }) => {
      state.shelter.activity = rules.limits.activity_max_game_over;
    },
  },
  {
    label: "外墙失守",
    expectedEndingId: "outer_wall_overrun",
    arrange: ({ state }) => {
      state.shelter.outer_wall_health = 0;
      state.shelter.health = state.shelter.inner_wall_health;
    },
  },
  {
    label: "群体饥荒",
    expectedEndingId: "famine_riot",
    arrange: ({ rules, state }) => {
      state.shelter.group_hunger = rules.limits.group_hunger_game_over;
    },
  },
  {
    label: "希望归零",
    expectedEndingId: "hope_extinguished",
    arrange: ({ rules, state }) => {
      state.shelter.hope = rules.limits.hope_min_game_over;
    },
  },
  {
    label: "活跃度过低",
    expectedEndingId: "settlement_schism",
    arrange: ({ rules, state }) => {
      state.shelter.activity = rules.limits.activity_min_game_over;
    },
  },
];

/** 使用真实运行时内容和隔离状态组装失败规则。 */
function buildFailureFixture(): FailureFixture {
  const harness = buildH5Harness({
    random: new ScriptedRandomSource([90]),
  });
  harness.application.startNewGame(["失败结算员"], "single");
  const content = harness.application.content;
  return {
    state: requireState(harness.application),
    rules: new GameRules(
      content,
      NO_RULE_MODIFIERS,
      new ChronicleService(content),
      new CampaignDifficultyRules(content, { common: [], text: [] }),
    ),
  };
}

/** 按结局 ID 读取已通过启动校验的扩展目录项。 */
function requireCatalogEnding(endingId: string) {
  const ending = contentExpansionCatalog.failureEndings.find(
    (candidate) => candidate.endingId === endingId,
  );
  if (ending === undefined) throw new Error(`失败结局目录缺少 ${endingId}。`);
  return ending;
}

describe("八个真实失败结局", () => {
  it.each(FAILURE_SCENARIOS)("$label 生成唯一尾声", (scenario) => {
    const fixture = buildFailureFixture();
    scenario.arrange(fixture);

    const ending = fixture.rules.checkFailure(fixture.state);
    const catalogEnding = requireCatalogEnding(scenario.expectedEndingId);

    expect(ending?.ending_id).toBe(scenario.expectedEndingId);
    expect(ending?.message).toContain(catalogEnding.displayName);
    expect(ending?.message).toContain(catalogEnding.summary);
    expect(ending?.message).toContain(catalogEnding.epilogue);
  });

  it("八个条件对应八个不重复的结局 ID", () => {
    expect(new Set(FAILURE_SCENARIOS.map((scenario) => scenario.expectedEndingId)).size)
      .toBe(8);
  });

  it("多个条件同时命中时使用目录优先级", () => {
    const fixture = buildFailureFixture();
    const { rules, state } = fixture;
    state.story.infection_pressure = rules.limits.infection_pressure_game_over;
    requirePlayer(state).health = 0;
    state.shelter.inner_wall_health = 0;
    state.shelter.outer_wall_health = 0;
    state.shelter.health = 0;
    state.shelter.group_hunger = rules.limits.group_hunger_game_over;
    state.shelter.hope = rules.limits.hope_min_game_over;

    expect(rules.checkFailure(state)?.ending_id).toBe("infection_bloom");
  });

  it("内外墙同时归零时由优先级更高的内墙结局胜出", () => {
    const fixture = buildFailureFixture();
    fixture.state.shelter.inner_wall_health = 0;
    fixture.state.shelter.outer_wall_health = 0;
    fixture.state.shelter.health = 0;

    expect(fixture.rules.checkFailure(fixture.state)?.ending_id)
      .toBe("inner_wall_collapse");
  });

  it("感染压力严格使用配置阈值", () => {
    const fixture = buildFailureFixture();
    const threshold = fixture.rules.limits.infection_pressure_game_over;
    fixture.state.story.infection_pressure = threshold - 1;
    expect(fixture.rules.checkFailure(fixture.state)).toBeNull();

    fixture.state.story.infection_pressure = threshold;
    expect(fixture.rules.checkFailure(fixture.state)?.ending_id)
      .toBe("infection_bloom");
  });

  it("已结算的结局不会被后续失败状态覆盖", () => {
    const fixture = buildFailureFixture();
    const existing = {
      ending_id: "existing_ending",
      outcome: "failure" as const,
      message: "已经结算。",
    };
    fixture.state.ending = existing;
    fixture.state.story.infection_pressure = fixture.rules.limits
      .infection_pressure_game_over;

    expect(fixture.rules.settleFailure(fixture.state)).toBe(existing);
    expect(fixture.state.ending).toBe(existing);
  });

  it("战斗倒下与生存状态共用所长失败尾声", () => {
    const fixture = buildFailureFixture();
    const ending = fixture.rules.combatFailure("战地所长", "story");

    expect(ending.ending_id).toBe("commander_fallen");
    expect(ending.message).toContain(requireCatalogEnding("commander_fallen").epilogue);
  });
});
