import { describe, expect, it } from "vitest";
import expeditionBranchingEventDocument from "../../config/expedition_branching_events.json";
import eventsDocument from "../../config/events.json";
import {
  expeditionBranchingEventConfig,
  parseExpeditionBranchingEventConfig,
  validateExpeditionBranchingEventReferences,
} from "../../src/config/expeditionBranchingEventConfig";
import type { EventsConfigDocument } from "../../src/domain/content";
import type {
  ExpeditionBranchingPromptProjection,
} from "../../src/domain/expedition-branching-event";
import { ExpeditionBranchingEventService } from "../../src/services/ExpeditionBranchingEventService";

interface MutableChoiceDocument {
  kind: string;
  id: string;
  label: string;
  description: string;
  next_node_id?: string;
  outcome_id?: string;
}

interface MutableNodeDocument {
  id: string;
  title: string;
  body: string;
  choices: MutableChoiceDocument[];
}

interface MutableProfileDocument {
  id: string;
  entry_node_id: string;
  nodes: MutableNodeDocument[];
}

interface MutableBindingDocument {
  event_id: string;
  profile_id: string;
  outcome_resolutions: Array<{
    outcome_id: string;
    resolution_choice_id: string | null;
    resolution_outcome_id: string | null;
  }>;
}

interface MutableCatalogDocument {
  profiles: MutableProfileDocument[];
  bindings: MutableBindingDocument[];
}

interface MutableLegacyOutcomeDocument {
  id?: string;
}

interface MutableLegacyChoiceDocument {
  id: string;
  outcomes?: MutableLegacyOutcomeDocument[];
}

interface MutableLegacyEventDocument {
  id: string;
  choices?: MutableLegacyChoiceDocument[];
  outcomes?: MutableLegacyOutcomeDocument[];
}

interface MutableEventsDocument {
  events: MutableLegacyEventDocument[];
}

const service = new ExpeditionBranchingEventService(
  expeditionBranchingEventConfig,
);

/** 创建一份可在负向校验中安全修改的配置副本。 */
function mutableDocument(): MutableCatalogDocument {
  return structuredClone(expeditionBranchingEventDocument);
}

/** 创建一份可用于跨配置引用负向测试的旧事件副本。 */
function mutableEventsDocument(): MutableEventsDocument {
  return structuredClone(eventsDocument);
}

/** 按稳定 ID 取得负向测试需要修改的 profile。 */
function requireMutableProfile(
  document: MutableCatalogDocument,
  profileId: string,
): MutableProfileDocument {
  const profile = document.profiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) throw new Error(`缺少测试 profile ${profileId}。`);
  return profile;
}

/** 按稳定 ID 取得负向测试需要修改的节点。 */
function requireMutableNode(
  profile: MutableProfileDocument,
  nodeId: string,
): MutableNodeDocument {
  const node = profile.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) throw new Error(`缺少测试节点 ${nodeId}。`);
  return node;
}

/** 按事件 ID 取得负向测试需要修改的结算绑定。 */
function requireMutableBinding(
  document: MutableCatalogDocument,
  eventId: string,
): MutableBindingDocument {
  const binding = document.bindings.find(
    (candidate) => candidate.event_id === eventId,
  );
  if (binding === undefined) throw new Error(`缺少测试绑定 ${eventId}。`);
  return binding;
}

/** 按事件 ID 取得负向测试需要修改的旧事件。 */
function requireMutableLegacyEvent(
  document: MutableEventsDocument,
  eventId: string,
): MutableLegacyEventDocument {
  const event = document.events.find((candidate) => candidate.id === eventId);
  if (event === undefined) throw new Error(`缺少测试旧事件 ${eventId}。`);
  return event;
}

/** 递归遍历指定事件的全部决策路径并收集终点深度。 */
function traverseAllPaths(
  eventId: string,
  projection: ExpeditionBranchingPromptProjection,
  terminalDepths: number[],
): void {
  expect(projection.choices.length).toBeGreaterThanOrEqual(
    expeditionBranchingEventConfig.policy.visible_choice_minimum,
  );
  expect(projection.choices.length).toBeLessThanOrEqual(
    expeditionBranchingEventConfig.policy.visible_choice_maximum,
  );
  for (const choice of projection.choices) {
    const transition = service.choose(eventId, projection.nodeId, choice.id);
    if (transition.kind === "resolved") {
      expect(transition.depth).toBe(projection.depth);
      expect(transition.resolutionChoiceId === null
        || typeof transition.resolutionChoiceId === "string").toBe(true);
      terminalDepths.push(transition.depth);
      continue;
    }
    expect(transition.depth).toBe(projection.depth + 1);
    traverseAllPaths(
      eventId,
      service.prompt(eventId, transition.nextNodeId),
      terminalDepths,
    );
  }
}

/** 返回旧事件定义允许的结算选项 ID 集合。 */
function legacyResolutionIds(eventId: string): ReadonlySet<string | null> {
  const event = eventsDocument.events.find((candidate) => candidate.id === eventId);
  if (event === undefined) throw new Error(`缺少旧事件 ${eventId}。`);
  const choiceIds = event.choices?.map((choice) => choice.id) ?? [];
  return choiceIds.length === 0
    ? new Set([null])
    : new Set(choiceIds);
}

describe("远征分支事件目录", () => {
  it("保留 40/20/10/10/10 容量、2～4 个可见决策和 4～5 层约束", () => {
    expect(expeditionBranchingEventConfig.policy).toMatchObject({
      capacity_policy: [40, 20, 10, 10, 10],
      visible_choice_minimum: 2,
      visible_choice_maximum: 4,
      minimum_depth: 4,
      maximum_depth: 5,
      minimum_profile_count: 4,
    });
    expect(expeditionBranchingEventConfig.profiles).toHaveLength(4);
    expect(expeditionBranchingEventConfig.bindings).toHaveLength(9);
    expect(new Set(expeditionBranchingEventConfig.bindings.map(
      (binding) => binding.event_id,
    ))).toEqual(new Set(expeditionBranchingEventConfig.required_event_ids));
  });

  it("全部九个旧事件都能从入口走遍所有 4～5 层终点", () => {
    for (const eventId of expeditionBranchingEventConfig.required_event_ids) {
      const cursor = service.start(eventId);
      const root = service.prompt(eventId, null);
      expect(root.nodeId).toBe(cursor.currentNodeId);
      expect(root.depth).toBe(1);
      const terminalDepths: number[] = [];
      traverseAllPaths(eventId, root, terminalDepths);
      expect(terminalDepths.length).toBeGreaterThan(0);
      expect(Math.min(...terminalDepths)).toBeGreaterThanOrEqual(4);
      expect(Math.max(...terminalDepths)).toBeLessThanOrEqual(5);
    }
  });

  it("盗贼事件在追与不追之后都原位进入新情况", () => {
    const root = service.prompt("thief", null);
    expect(root.choices.map((choice) => choice.label)).toEqual([
      "追上去",
      "不追",
    ]);
    const chased = service.choose("thief", null, "chase");
    const ignored = service.choose("thief", null, "do_not_chase");
    expect(chased).toMatchObject({
      kind: "advanced",
      nextNodeId: "thief_rain_alley",
      depth: 2,
    });
    expect(ignored).toMatchObject({
      kind: "advanced",
      nextNodeId: "thief_withdraw_route",
      depth: 2,
    });
    if (chased.kind !== "advanced" || ignored.kind !== "advanced") return;
    expect(service.prompt("thief", chased.nextNodeId).title).toBe("雨巷追踪");
    expect(service.prompt("thief", ignored.nextNodeId).title).toBe("克制怒火");
  });

  it("搜刮事件实际呈现三选项入口与四选项后续情境", () => {
    const root = service.prompt("bank", null);
    expect(root.choices).toHaveLength(3);
    const entered = service.choose("bank", root.nodeId, "enter_front");
    expect(entered).toMatchObject({
      kind: "advanced",
      nextNodeId: "scavenge_front_hall",
      depth: 2,
    });
    if (entered.kind !== "advanced") return;
    const hall = service.prompt("bank", entered.nextNodeId);
    expect(hall.choices).toHaveLength(4);
    expect(hall.choices.map((choice) => choice.label)).toEqual([
      "检查柜台",
      "走上楼梯",
      "查看楼层图",
      "倾听地下动静",
    ]);
  });

  it("所有终点结算 ID 都与旧事件的选项定义一致", () => {
    expect(() => {
      validateExpeditionBranchingEventReferences(
        expeditionBranchingEventConfig,
        eventsDocument as unknown as EventsConfigDocument,
      );
    }).not.toThrow();
    for (const binding of expeditionBranchingEventConfig.bindings) {
      const allowed = legacyResolutionIds(binding.event_id);
      for (const resolution of binding.outcome_resolutions) {
        expect(allowed.has(resolution.resolution_choice_id)).toBe(true);
      }
    }
  });

  it("医疗仓的五种终点各自对应确定且不同的后果", () => {
    const binding = expeditionBranchingEventConfig.bindings.find(
      (candidate) => candidate.event_id === "medical_pod",
    );
    if (binding === undefined) throw new Error("缺少医疗仓分支绑定。");
    const outcomeIds = binding.outcome_resolutions.map(
      (resolution) => resolution.resolution_outcome_id,
    );
    expect(outcomeIds.every((outcomeId) => outcomeId !== null)).toBe(true);
    expect(new Set(outcomeIds).size).toBe(outcomeIds.length);
    expect(binding.outcome_resolutions.find(
      (resolution) => resolution.outcome_id === "withdraw",
    )?.resolution_outcome_id).toBe("safe_disconnect");
  });

  it("跨配置校验拒绝未知事件、选择、结果与不稳定结果 ID", () => {
    const missingEventDocument = mutableEventsDocument();
    missingEventDocument.events = missingEventDocument.events.filter(
      (event) => event.id !== "bank",
    );
    expect(() => {
      validateExpeditionBranchingEventReferences(
        expeditionBranchingEventConfig,
        missingEventDocument as unknown as EventsConfigDocument,
      );
    }).toThrow(/未知探索事件/u);

    const unknownChoiceCatalog = mutableDocument();
    const thiefResolution = requireMutableBinding(
      unknownChoiceCatalog,
      "thief",
    ).outcome_resolutions[0];
    if (thiefResolution === undefined) throw new Error("缺少盗贼结算测试数据。");
    thiefResolution.resolution_choice_id = "missing_choice";
    expect(() => {
      validateExpeditionBranchingEventReferences(
        parseExpeditionBranchingEventConfig(unknownChoiceCatalog),
        eventsDocument as unknown as EventsConfigDocument,
      );
    }).toThrow(/不存在结算选择/u);

    const unknownOutcomeCatalog = mutableDocument();
    const bankResolution = requireMutableBinding(
      unknownOutcomeCatalog,
      "bank",
    ).outcome_resolutions[0];
    if (bankResolution === undefined) throw new Error("缺少银行结算测试数据。");
    bankResolution.resolution_outcome_id = "missing_outcome";
    expect(() => {
      validateExpeditionBranchingEventReferences(
        parseExpeditionBranchingEventConfig(unknownOutcomeCatalog),
        eventsDocument as unknown as EventsConfigDocument,
      );
    }).toThrow(/引用未知随机结果/u);

    const unstableOutcomeDocument = mutableEventsDocument();
    const bankOutcomes = requireMutableLegacyEvent(
      unstableOutcomeDocument,
      "bank",
    ).outcomes;
    if (bankOutcomes === undefined || bankOutcomes[0] === undefined) {
      throw new Error("缺少银行随机结果测试数据。");
    }
    delete bankOutcomes[0].id;
    expect(() => {
      validateExpeditionBranchingEventReferences(
        expeditionBranchingEventConfig,
        unstableOutcomeDocument as unknown as EventsConfigDocument,
      );
    }).toThrow(/缺少有效稳定 id/u);
  });

  it("启动校验拒绝重复 ID、悬空引用、循环、不可达节点和过早终点", () => {
    const duplicate = mutableDocument();
    const duplicateProfile = requireMutableProfile(duplicate, "thief_pursuit");
    const duplicateNode = duplicateProfile.nodes[1];
    if (duplicateNode === undefined) throw new Error("缺少重复节点测试数据。");
    duplicateNode.id = duplicateProfile.entry_node_id;
    expect(() => parseExpeditionBranchingEventConfig(duplicate)).toThrow(/重复/u);

    const dangling = mutableDocument();
    const danglingRoot = requireMutableNode(
      requireMutableProfile(dangling, "thief_pursuit"),
      "thief_wallet_missing",
    );
    const danglingChoice = danglingRoot.choices[0];
    if (danglingChoice === undefined) throw new Error("缺少悬空选择测试数据。");
    danglingChoice.next_node_id = "missing_node";
    expect(() => parseExpeditionBranchingEventConfig(dangling)).toThrow(/未知节点/u);

    const cyclic = mutableDocument();
    const cyclicProfile = requireMutableProfile(cyclic, "thief_pursuit");
    const cyclicChoice = requireMutableNode(
      cyclicProfile,
      "thief_rain_alley",
    ).choices[0];
    if (cyclicChoice === undefined) throw new Error("缺少循环选择测试数据。");
    cyclicChoice.next_node_id = cyclicProfile.entry_node_id;
    expect(() => parseExpeditionBranchingEventConfig(cyclic)).toThrow(/循环/u);

    const unreachable = mutableDocument();
    requireMutableProfile(unreachable, "thief_pursuit").nodes.push({
      id: "thief_unreachable",
      title: "不可达节点",
      body: "该节点只用于验证启动校验。",
      choices: [
        {kind: "terminal", id: "one", label: "选项一", description: "测试。", outcome_id: "caught"},
        {kind: "terminal", id: "two", label: "选项二", description: "测试。", outcome_id: "deal"},
      ],
    });
    expect(() => parseExpeditionBranchingEventConfig(unreachable)).toThrow(/不可达/u);

    const earlyTerminal = mutableDocument();
    const earlyChoice = requireMutableNode(
      requireMutableProfile(earlyTerminal, "thief_pursuit"),
      "thief_wallet_missing",
    ).choices[0];
    if (earlyChoice === undefined) throw new Error("缺少过早终点测试数据。");
    earlyChoice.kind = "terminal";
    earlyChoice.outcome_id = "caught";
    delete earlyChoice.next_node_id;
    expect(() => parseExpeditionBranchingEventConfig(earlyTerminal)).toThrow(/终点.*第 4 到 5 层/u);
  });

  it("启动校验拒绝超出可见数量与缺失的终点映射", () => {
    const invalidChoices = mutableDocument();
    requireMutableNode(
      requireMutableProfile(invalidChoices, "thief_pursuit"),
      "thief_wallet_missing",
    ).choices.pop();
    expect(() => parseExpeditionBranchingEventConfig(invalidChoices)).toThrow(/可见选择数/u);

    const excessiveChoices = mutableDocument();
    const excessiveRoot = requireMutableNode(
      requireMutableProfile(excessiveChoices, "scavenging_site"),
      "scavenge_site_arrival",
    );
    const reusableChoice = excessiveRoot.choices[0];
    if (reusableChoice === undefined) throw new Error("缺少超量选择测试模板。");
    while (
      excessiveRoot.choices.length
      <= expeditionBranchingEventConfig.policy.visible_choice_maximum
    ) {
      const suffix = String(excessiveRoot.choices.length);
      excessiveRoot.choices.push({
        ...reusableChoice,
        id: `overflow_${suffix}`,
        label: `超量选择 ${suffix}`,
      });
    }
    expect(() => parseExpeditionBranchingEventConfig(excessiveChoices)).toThrow(
      /可见选择数/u,
    );

    const missingMapping = mutableDocument();
    const thiefBinding = missingMapping.bindings.find(
      (binding) => binding.event_id === "thief",
    );
    if (thiefBinding === undefined) throw new Error("缺少盗贼绑定测试数据。");
    thiefBinding.outcome_resolutions = thiefBinding.outcome_resolutions.filter(
      (resolution) => resolution.outcome_id !== "caught",
    );
    expect(() => parseExpeditionBranchingEventConfig(missingMapping)).toThrow(/缺少终点映射/u);
  });

  it("启动校验拒绝超过后台层级容量的情境数量", () => {
    const overCapacity = mutableDocument() as MutableCatalogDocument & {
      policy: { capacity_policy: number[] };
    };
    overCapacity.policy.capacity_policy[1] = 1;
    expect(() => parseExpeditionBranchingEventConfig(overCapacity)).toThrow(
      /第 2 层.*超过容量/u,
    );
  });
});
