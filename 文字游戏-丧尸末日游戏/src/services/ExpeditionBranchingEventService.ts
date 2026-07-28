import type {
  ExpeditionBranchingEventBindingConfig,
  ExpeditionBranchingEventConfig,
  ExpeditionBranchingEventCursor,
  ExpeditionBranchingNodeConfig,
  ExpeditionBranchingProfileConfig,
  ExpeditionBranchingPromptProjection,
  ExpeditionBranchingTransition,
} from "../domain/expedition-branching-event";
import { DomainError } from "../domain/errors";

/** 服务内部使用的已索引可复用事件图。 */
interface IndexedBranchingProfile {
  readonly profile: ExpeditionBranchingProfileConfig;
  readonly nodeById: ReadonlyMap<string, ExpeditionBranchingNodeConfig>;
  readonly depthByNodeId: ReadonlyMap<string, number>;
}

/** 服务内部使用的事件绑定与已索引 profile 组合。 */
interface ResolvedEventBinding {
  readonly binding: ExpeditionBranchingEventBindingConfig;
  readonly indexedProfile: IndexedBranchingProfile;
}

/**
 * 负责把已校验的远征分支目录投影为同页可连续消费的决策流。
 */
export class ExpeditionBranchingEventService {
  private readonly bindingByEventId: ReadonlyMap<string, ResolvedEventBinding>;

  /** 建立事件、profile、节点和深度索引，不持有任何游戏状态。 */
  public constructor(config: ExpeditionBranchingEventConfig) {
    const indexedProfiles = new Map(
      config.profiles.map((profile) => [
        profile.id,
        indexProfile(profile),
      ]),
    );
    this.bindingByEventId = new Map(config.bindings.map((binding) => {
      const indexedProfile = indexedProfiles.get(binding.profile_id);
      if (indexedProfile === undefined) {
        throw new DomainError(
          `远征分支绑定 ${binding.event_id} 引用未知 profile ${binding.profile_id}。`,
        );
      }
      return [binding.event_id, { binding, indexedProfile }];
    }));
  }

  /** 从绑定 profile 的稳定入口节点开始一次分支事件。 */
  public start(eventId: string): ExpeditionBranchingEventCursor {
    const resolved = this.requireEventBinding(eventId);
    const nodeId = resolved.indexedProfile.profile.entry_node_id;
    return {
      eventId,
      profileId: resolved.indexedProfile.profile.id,
      currentNodeId: nodeId,
      depth: this.requireDepth(resolved.indexedProfile, nodeId),
    };
  }

  /** 按已持久节点 ID 投影当前事件栏，null 代表 profile 入口。 */
  public prompt(
    eventId: string,
    currentNodeId: string | null,
  ): ExpeditionBranchingPromptProjection {
    const resolved = this.requireEventBinding(eventId);
    const node = this.resolveNode(resolved.indexedProfile, currentNodeId);
    return {
      eventId,
      profileId: resolved.indexedProfile.profile.id,
      nodeId: node.id,
      depth: this.requireDepth(resolved.indexedProfile, node.id),
      title: node.title,
      body: node.body,
      choices: node.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        description: choice.description,
        terminal: choice.kind === "terminal",
      })),
    };
  }

  /** 在当前节点执行一项决策，返回后续节点或旧事件结算选项。 */
  public choose(
    eventId: string,
    currentNodeId: string | null,
    choiceId: string,
  ): ExpeditionBranchingTransition {
    const resolved = this.requireEventBinding(eventId);
    const node = this.resolveNode(resolved.indexedProfile, currentNodeId);
    const choice = node.choices.find((candidate) => candidate.id === choiceId);
    if (choice === undefined) {
      throw new DomainError(
        `远征分支节点 ${node.id} 不存在选项 ${choiceId}。`,
      );
    }
    if (choice.kind === "advance") {
      return {
        kind: "advanced",
        eventId,
        profileId: resolved.indexedProfile.profile.id,
        previousNodeId: node.id,
        nextNodeId: choice.next_node_id,
        depth: this.requireDepth(
          resolved.indexedProfile,
          choice.next_node_id,
        ),
      };
    }
    const mapping = resolved.binding.outcome_resolutions.find(
      (candidate) => candidate.outcome_id === choice.outcome_id,
    );
    if (mapping === undefined) {
      throw new DomainError(
        `远征分支绑定 ${eventId} 缺少终点映射 ${choice.outcome_id}。`,
      );
    }
    return {
      kind: "resolved",
      eventId,
      profileId: resolved.indexedProfile.profile.id,
      terminalNodeId: node.id,
      resolutionChoiceId: mapping.resolution_choice_id,
      resolutionOutcomeId: mapping.resolution_outcome_id,
      depth: this.requireDepth(resolved.indexedProfile, node.id),
    };
  }

  /** 重放持久化选择路径并确认它唯一到达当前节点。 */
  public validateCursor(
    eventId: string,
    currentNodeId: string | null,
    branchPath: readonly string[],
  ): void {
    const resolved = this.requireEventBinding(eventId);
    let replayedNodeId = resolved.indexedProfile.profile.entry_node_id;
    for (const choiceId of branchPath) {
      const node = this.resolveNode(resolved.indexedProfile, replayedNodeId);
      const choice = node.choices.find((candidate) => candidate.id === choiceId);
      if (choice === undefined || choice.kind !== "advance") {
        throw new DomainError(
          `远征分支路径无法从节点 ${node.id} 继续选择 ${choiceId}。`,
        );
      }
      replayedNodeId = choice.next_node_id;
    }
    if (currentNodeId === null) {
      if (branchPath.length === 0) return;
      throw new DomainError("空分支节点不能带有已推进路径。");
    }
    if (currentNodeId !== replayedNodeId) {
      throw new DomainError(
        `远征分支路径实际到达 ${replayedNodeId}，与存档节点 ${currentNodeId} 不一致。`,
      );
    }
  }

  /** 返回指定旧事件的绑定与 profile，未绑定时显式拒绝。 */
  private requireEventBinding(eventId: string): ResolvedEventBinding {
    const resolved = this.bindingByEventId.get(eventId);
    if (resolved === undefined) {
      throw new DomainError(`探索事件 ${eventId} 尚未绑定远征分支 profile。`);
    }
    return resolved;
  }

  /** 使用当前节点 ID 或 profile 入口解析稳定情境节点。 */
  private resolveNode(
    indexedProfile: IndexedBranchingProfile,
    currentNodeId: string | null,
  ): ExpeditionBranchingNodeConfig {
    const nodeId = currentNodeId ?? indexedProfile.profile.entry_node_id;
    const node = indexedProfile.nodeById.get(nodeId);
    if (node === undefined) {
      throw new DomainError(
        `远征分支 profile ${indexedProfile.profile.id} 不存在节点 ${nodeId}。`,
      );
    }
    return node;
  }

  /** 返回已校验节点的唯一深度，索引不完整时拒绝静默降级。 */
  private requireDepth(
    indexedProfile: IndexedBranchingProfile,
    nodeId: string,
  ): number {
    const depth = indexedProfile.depthByNodeId.get(nodeId);
    if (depth === undefined) {
      throw new DomainError(
        `远征分支 profile ${indexedProfile.profile.id} 缺少节点 ${nodeId} 的深度索引。`,
      );
    }
    return depth;
  }
}

/** 为单个已校验 profile 建立节点与唯一深度索引。 */
function indexProfile(
  profile: ExpeditionBranchingProfileConfig,
): IndexedBranchingProfile {
  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
  const depthByNodeId = new Map<string, number>();
  indexNodeDepth(profile.entry_node_id, 1, nodeById, depthByNodeId);
  return { profile, nodeById, depthByNodeId };
}

/** 沿继续决策递归建立节点深度，已索引节点不重复展开。 */
function indexNodeDepth(
  nodeId: string,
  depth: number,
  nodeById: ReadonlyMap<string, ExpeditionBranchingNodeConfig>,
  depthByNodeId: Map<string, number>,
): void {
  if (depthByNodeId.has(nodeId)) return;
  const node = nodeById.get(nodeId);
  if (node === undefined) {
    throw new DomainError(`远征分支深度索引引用未知节点 ${nodeId}。`);
  }
  depthByNodeId.set(nodeId, depth);
  for (const choice of node.choices) {
    if (choice.kind === "advance") {
      indexNodeDepth(choice.next_node_id, depth + 1, nodeById, depthByNodeId);
    }
  }
}
