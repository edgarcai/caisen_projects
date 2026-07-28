/** 远征分支目录的容量规则，数组下标对应事件深度。 */
export interface ExpeditionBranchingCapacityPolicyConfig {
  readonly capacity_policy: readonly number[];
  readonly visible_choice_minimum: number;
  readonly visible_choice_maximum: number;
  readonly minimum_depth: number;
  readonly maximum_depth: number;
  readonly minimum_profile_count: number;
}

/** 一项从当前情境前往后续情境的玩家决策。 */
export interface ExpeditionBranchingAdvanceChoiceConfig {
  readonly kind: "advance";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly next_node_id: string;
}

/** 一项结束当前事件链并映射回旧探索结算的玩家决策。 */
export interface ExpeditionBranchingTerminalChoiceConfig {
  readonly kind: "terminal";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly outcome_id: string;
}

/** 远征分支节点支持的判别联合决策。 */
export type ExpeditionBranchingChoiceConfig =
  | ExpeditionBranchingAdvanceChoiceConfig
  | ExpeditionBranchingTerminalChoiceConfig;

/** 同一事件栏中可原位更新的一个情境节点。 */
export interface ExpeditionBranchingNodeConfig {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly choices: readonly ExpeditionBranchingChoiceConfig[];
}

/** 可被多个旧探索事件复用的分支事件图。 */
export interface ExpeditionBranchingProfileConfig {
  readonly id: string;
  readonly entry_node_id: string;
  readonly nodes: readonly ExpeditionBranchingNodeConfig[];
}

/** 绑定中的终点语义到旧事件选项 ID 的映射。 */
export interface ExpeditionBranchingOutcomeResolutionConfig {
  readonly outcome_id: string;
  readonly resolution_choice_id: string | null;
  readonly resolution_outcome_id: string | null;
}

/** 一个旧探索事件与可复用分支图之间的绑定。 */
export interface ExpeditionBranchingEventBindingConfig {
  readonly event_id: string;
  readonly profile_id: string;
  readonly outcome_resolutions: readonly ExpeditionBranchingOutcomeResolutionConfig[];
}

/** 配置化远征分支事件目录的完整文档。 */
export interface ExpeditionBranchingEventConfig {
  readonly schema_version: number;
  readonly policy: ExpeditionBranchingCapacityPolicyConfig;
  readonly required_event_ids: readonly string[];
  readonly profiles: readonly ExpeditionBranchingProfileConfig[];
  readonly bindings: readonly ExpeditionBranchingEventBindingConfig[];
}

/** 服务开始事件时返回的稳定游标。 */
export interface ExpeditionBranchingEventCursor {
  readonly eventId: string;
  readonly profileId: string;
  readonly currentNodeId: string;
  readonly depth: number;
}

/** 页面可直接消费的当前决策投影。 */
export interface ExpeditionBranchingChoiceProjection {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly terminal: boolean;
}

/** 页面可在同一事件栏中原位替换的情境投影。 */
export interface ExpeditionBranchingPromptProjection {
  readonly eventId: string;
  readonly profileId: string;
  readonly nodeId: string;
  readonly depth: number;
  readonly title: string;
  readonly body: string;
  readonly choices: readonly ExpeditionBranchingChoiceProjection[];
}

/** 一项尚未结算、需在同一事件栏继续展示的转移。 */
export interface ExpeditionBranchingAdvancedTransition {
  readonly kind: "advanced";
  readonly eventId: string;
  readonly profileId: string;
  readonly previousNodeId: string;
  readonly nextNodeId: string;
  readonly depth: number;
}

/** 一项已到达终点、可交给旧事件结算的转移。 */
export interface ExpeditionBranchingResolvedTransition {
  readonly kind: "resolved";
  readonly eventId: string;
  readonly profileId: string;
  readonly terminalNodeId: string;
  readonly resolutionChoiceId: string | null;
  readonly resolutionOutcomeId: string | null;
  readonly depth: number;
}

/** 选择分支后的穷尽转移结果。 */
export type ExpeditionBranchingTransition =
  | ExpeditionBranchingAdvancedTransition
  | ExpeditionBranchingResolvedTransition;
