import { formatTemplate } from "../../domain/content";
import type {
  EncounterAvailableAction,
  EncounterPreparationPlan,
} from "../../domain/demo-systems";
import type { GameTextTokens } from "../../styles/GameTheme";
import type {
  UiEncounterActionView,
  UiEncounterBattlePageView,
  UiEncounterBattleRuntimeView,
  UiEncounterCombatantView,
  UiEncounterPreparationPageView,
  UiEncounterPreparationRuntimeView,
  UiEncounterTargetView,
} from "./DemoSystemViewModels";

/** 战前职责与治疗均保留在 UI 边界，点击开战前不写入存档。 */
export interface EncounterPreparationSelection {
  readonly roleIdsByMember: Readonly<Record<string, string>>;
  readonly treatedMemberIds: readonly string[];
}

/** 创建尚未分配职责且没有安排治疗的空整备草稿。 */
export function emptyEncounterPreparationSelection(): EncounterPreparationSelection {
  return { roleIdsByMember: {}, treatedMemberIds: [] };
}

/** 结合领域整备快照与本地草稿构建可直接渲染的战前页面。 */
export function buildEncounterPreparationPageView(
  runtime: UiEncounterPreparationRuntimeView,
  texts: GameTextTokens,
  selection: EncounterPreparationSelection,
): UiEncounterPreparationPageView {
  const preparation = runtime.preparation;
  const treated = new Set(selection.treatedMemberIds);
  const plannedCost = treated.size * preparation.treatment_cost;
  const rolesById = new Map(preparation.roles.map((role) => [role.role_id, role]));
  const allAssigned = preparation.members.every((member) => (
    rolesById.has(selection.roleIdsByMember[member.member_id] ?? "")
  ));
  const enoughMedicalSupplies = plannedCost <= preparation.medical_supplies;
  return {
    title: formatTemplate(texts.encounter_preparation_title_format, {
      name: preparation.encounter_name,
    }),
    body: `${preparation.encounter_description}\n\n${texts.encounter_preparation_body}`,
    supplyText: formatTemplate(texts.encounter_preparation_supply_format, {
      available: preparation.medical_supplies,
      planned: plannedCost,
      cost: preparation.treatment_cost,
      heal: preparation.treatment_heal,
    }),
    rosterTitle: texts.encounter_preparation_roster_title,
    requirementText: !allAssigned
      ? texts.encounter_preparation_assignment_required
      : enoughMedicalSupplies
        ? texts.encounter_preparation_ready
        : texts.encounter_preparation_medical_shortage,
    members: preparation.members.map((member) => {
      const role = rolesById.get(selection.roleIdsByMember[member.member_id] ?? "");
      const treatmentSelected = treated.has(member.member_id);
      const projectedHealth = Math.min(
        member.maximum_health,
        member.health + preparation.treatment_heal,
      );
      const canAffordAnotherTreatment = plannedCost + preparation.treatment_cost
        <= preparation.medical_supplies;
      const treatmentAvailable = treatmentSelected
        || (member.health < member.maximum_health && canAffordAnotherTreatment);
      return {
        memberId: member.member_id,
        name: member.name,
        healthText: formatTemplate(texts.encounter_health_format, {
          health: member.health,
          maximum: member.maximum_health,
        }),
        attributeText: formatTemplate(texts.encounter_preparation_attribute_format, {
          attack: member.attack,
          defense: member.defense,
          agility: member.agility,
        }),
        assignedRoleText: role === undefined
          ? texts.encounter_preparation_role_unassigned
          : formatTemplate(texts.encounter_preparation_role_format, {
              role: role.label,
            }),
        assignedRoleDetailText: role === undefined
          ? ""
          : [
              role.description,
              formatTemplate(texts.encounter_preparation_role_effect_format, {
                row: role.row === "front"
                  ? texts.encounter_row_front
                  : texts.encounter_row_back,
                attack: role.attack_percent,
                defense: role.defense_percent,
                agility: role.agility_percent,
              }),
            ].join("\n"),
        roles: preparation.roles.map((candidate) => ({
          roleId: candidate.role_id,
          label: candidate.label,
          description: candidate.description,
          selected: candidate.role_id === role?.role_id,
          tone: candidate.role_id === role?.role_id ? "primary" : "default",
        })),
        treatmentLabel: treatmentSelected
          ? texts.encounter_preparation_treatment_cancel
          : texts.encounter_preparation_treatment,
        treatmentStatusText: treatmentSelected
          ? formatTemplate(texts.encounter_preparation_treatment_selected, {
              health: projectedHealth,
              maximum: member.maximum_health,
              cost: preparation.treatment_cost,
            })
          : member.health >= member.maximum_health
            ? texts.encounter_preparation_treatment_full
            : treatmentAvailable
              ? formatTemplate(texts.encounter_preparation_treatment_available, {
                  health: projectedHealth,
                  maximum: member.maximum_health,
                  cost: preparation.treatment_cost,
                  heal: preparation.treatment_heal,
                })
              : texts.encounter_preparation_treatment_unavailable,
        treatmentAvailable,
        treatmentSelected,
        treatmentTone: treatmentSelected ? "warning" : "default",
      };
    }),
    backLabel: texts.back,
    startLabel: texts.encounter_preparation_start,
    canStart: allAssigned && enoughMedicalSupplies,
  };
}

/** 将完整且仍然有效的整备草稿解析为应用命令参数。 */
export function resolveEncounterPreparationPlan(
  runtime: UiEncounterPreparationRuntimeView,
  selection: EncounterPreparationSelection,
): EncounterPreparationPlan | null {
  const preparation = runtime.preparation;
  const roles = new Set(preparation.roles.map((role) => role.role_id));
  const members = new Map(preparation.members.map((member) => [member.member_id, member]));
  if (preparation.members.some((member) => (
    !roles.has(selection.roleIdsByMember[member.member_id] ?? "")
  ))) {
    return null;
  }
  if (Object.keys(selection.roleIdsByMember).some((memberId) => !members.has(memberId))) {
    return null;
  }
  const treated = new Set(selection.treatedMemberIds);
  if (treated.size !== selection.treatedMemberIds.length) return null;
  if ([...treated].some((memberId) => {
    const member = members.get(memberId);
    return member === undefined || member.health >= member.maximum_health;
  })) {
    return null;
  }
  if (treated.size * preparation.treatment_cost > preparation.medical_supplies) return null;
  return {
    role_ids_by_member: { ...selection.roleIdsByMember },
    treated_member_ids: [...selection.treatedMemberIds],
  };
}

/** 战斗页留在 UI 边界的选择草稿，不写入领域存档。 */
export interface EncounterBattleSelection {
  readonly actorId: string | null;
  readonly actionId: string | null;
  readonly targetId: string | null;
}

/** 可提交给 UI 端口的遭遇战指令草稿。 */
export interface EncounterExecutionDraft {
  readonly action: EncounterAvailableAction["action"];
  readonly actorId: string;
  readonly abilityId?: string;
  readonly targetId?: string;
}

/** 创建尚未选择队员、行动或目标的空战斗草稿。 */
export function emptyEncounterBattleSelection(): EncounterBattleSelection {
  return { actorId: null, actionId: null, targetId: null };
}

/** 结合领域运行时和本地选中态构建完整战斗页面模型。 */
export function buildEncounterBattlePageView(
  runtime: UiEncounterBattleRuntimeView,
  texts: GameTextTokens,
  selection: EncounterBattleSelection,
  separator: string,
): UiEncounterBattlePageView {
  const state = runtime.state;
  const actorId = selectedActorId(runtime, selection.actorId);
  const domainActions = actorId === null ? [] : runtime.actionsByActor[actorId] ?? [];
  const selectedAction = domainActions.find(
    (action) => encounterActionViewId(action) === selection.actionId,
  );
  const targetId = selectedAction?.targetIds.includes(selection.targetId ?? "") === true
    ? selection.targetId
    : null;
  return {
    title: state.encounter_name,
    encounterDescription: runtime.encounterDescription,
    roundText: formatTemplate(texts.encounter_round_format, {
      round: state.round_number,
    }),
    outcome: state.outcome,
    outcomeText: encounterOutcomeText(state.outcome, texts),
    instruction: state.outcome === "ongoing" ? texts.encounter_instruction : "",
    partyTitle: texts.encounter_party_title,
    enemyTitle: texts.encounter_enemy_title,
    rowLabels: {
      front: texts.encounter_row_front,
      back: texts.encounter_row_back,
    },
    emptyPartyText: texts.encounter_empty_party,
    emptyEnemyText: texts.encounter_empty_enemy,
    party: state.party.map((member) => combatantView(
      member.member_id,
      member.name,
      member.row,
      member.health,
      member.maximum_health,
      member.guarding,
      state.pending_party_member_ids.includes(member.member_id),
      actorId === member.member_id,
      state.outcome === "ongoing",
      texts,
      "party",
    )),
    enemies: state.enemies.map((enemy) => combatantView(
      enemy.enemy_id,
      enemy.name,
      enemy.row,
      enemy.health,
      enemy.maximum_health,
      enemy.guarding,
      false,
      targetId === enemy.enemy_id,
      selectedAction?.targetIds.includes(enemy.enemy_id) === true,
      texts,
      "enemy",
    )),
    enemyIntentTitle: texts.encounter_intent_title,
    emptyIntentText: texts.encounter_empty_intent,
    enemyIntents: runtime.enemyIntents.map((intent) => ({
      enemyId: intent.enemyId,
      enemyName: intent.enemyName,
      label: intent.label,
      description: intent.description,
    })),
    pendingTitle: texts.encounter_pending_title,
    pendingText: formatTemplate(texts.encounter_pending_format, {
      members: state.pending_party_member_ids
        .map((memberId) => state.party.find((member) => member.member_id === memberId)?.name)
        .filter((name): name is string => name !== undefined)
        .join(separator),
    }),
    actionTitle: texts.encounter_action_title,
    emptyActionText: texts.encounter_empty_action,
    selectedActionDetailText: selectedAction === undefined
      ? ""
      : formatTemplate(texts.encounter_action_detail_format, {
          description: selectedAction.description,
        }),
    actions: domainActions.map((action) => actionView(action, selection.actionId, texts)),
    targetTitle: texts.encounter_target_title,
    emptyTargetText: texts.encounter_empty_target,
    targets: selectedAction === undefined
      ? []
      : targetViews(runtime, selectedAction, targetId, texts),
    logTitle: texts.encounter_log_title,
    emptyLogText: texts.encounter_empty_log,
    logEntries: state.log.map((entry) => entry.message),
    backLabel: texts.back,
    executeLabel: state.outcome === "ongoing"
      ? texts.encounter_execute
      : texts.encounter_finish,
    canExecute: state.outcome !== "ongoing"
      || (selectedAction?.available === true
        && (selectedAction.targetIds.length === 0 || targetId !== null)),
  };
}

/** 将当前战斗页草稿解析为可提交命令；信息不完整时返回 null。 */
export function resolveEncounterExecutionDraft(
  runtime: UiEncounterBattleRuntimeView,
  selection: EncounterBattleSelection,
): EncounterExecutionDraft | null {
  const actorId = selectedActorId(runtime, selection.actorId);
  if (actorId === null) return null;
  const action = (runtime.actionsByActor[actorId] ?? []).find(
    (candidate) => encounterActionViewId(candidate) === selection.actionId,
  );
  if (action === undefined || !action.available) return null;
  const targetId = action.targetIds.includes(selection.targetId ?? "")
    ? selection.targetId
    : null;
  if (action.targetIds.length > 0 && targetId === null) return null;
  return {
    action: action.action,
    actorId,
    ...(action.abilityId === null ? {} : { abilityId: action.abilityId }),
    ...(targetId === null ? {} : { targetId }),
  };
}

/** 为领域行动生成页面内唯一 ID。 */
export function encounterActionViewId(action: EncounterAvailableAction): string {
  return action.abilityId === null
    ? action.action
    : `${action.action}:${action.abilityId}`;
}

/** 选择仍可行动的队员；原选择无效时自动落到行动队列首位。 */
function selectedActorId(
  runtime: UiEncounterBattleRuntimeView,
  requestedActorId: string | null,
): string | null {
  if (
    requestedActorId !== null
    && runtime.state.pending_party_member_ids.includes(requestedActorId)
  ) {
    return requestedActorId;
  }
  return runtime.state.pending_party_member_ids[0] ?? null;
}

/** 将战斗单位转换为生命、状态和选择语义完整的按钮模型。 */
function combatantView(
  combatantId: string,
  name: string,
  row: "front" | "back",
  health: number,
  maximumHealth: number,
  guarding: boolean,
  pending: boolean,
  selected: boolean,
  selectable: boolean,
  texts: GameTextTokens,
  side: "party" | "enemy",
): UiEncounterCombatantView {
  return {
    combatantId,
    name,
    row,
    healthText: formatTemplate(texts.encounter_health_format, {
      health,
      maximum: maximumHealth,
    }),
    statusText: health <= 0
      ? texts.encounter_status_down
      : guarding
        ? texts.encounter_status_guarding
        : pending
          ? texts.encounter_status_pending
          : side === "party"
            ? texts.encounter_status_acted
            : "",
    selectable: selectable && health > 0,
    selected,
    tone: health <= 0 ? "danger" : side === "enemy" ? "warning" : "success",
  };
}

/** 将一项领域行动转换为含可用原因与分类标签的页面模型。 */
function actionView(
  action: EncounterAvailableAction,
  selectedActionId: string | null,
  texts: GameTextTokens,
): UiEncounterActionView {
  const actionId = encounterActionViewId(action);
  return {
    actionId,
    kind: action.action,
    categoryLabel: encounterActionCategory(action.action, texts),
    label: action.label,
    description: action.description,
    availabilityText: action.available
      ? texts.encounter_action_available
      : formatTemplate(texts.encounter_action_unavailable, {
          reason: action.unavailableReason,
        }),
    available: action.available,
    selected: actionId === selectedActionId,
    tone: action.available ? "default" : "muted",
    targetIds: action.targetIds,
  };
}

/** 为当前行动生成可选择的友方或敌方目标。 */
function targetViews(
  runtime: UiEncounterBattleRuntimeView,
  action: EncounterAvailableAction,
  selectedTargetId: string | null,
  texts: GameTextTokens,
): UiEncounterTargetView[] {
  const combatants = [
    ...runtime.state.party.map((member) => ({
      id: member.member_id,
      name: member.name,
      health: member.health,
      maximumHealth: member.maximum_health,
    })),
    ...runtime.state.enemies.map((enemy) => ({
      id: enemy.enemy_id,
      name: enemy.name,
      health: enemy.health,
      maximumHealth: enemy.maximum_health,
    })),
  ];
  return action.targetIds.flatMap((targetId) => {
    const target = combatants.find((candidate) => candidate.id === targetId);
    if (target === undefined) return [];
    return [{
      targetId,
      label: target.name,
      description: formatTemplate(texts.encounter_target_format, {
        name: target.name,
        health: formatTemplate(texts.encounter_health_format, {
          health: target.health,
          maximum: target.maximumHealth,
        }),
      }),
      available: target.health > 0,
      selected: selectedTargetId === targetId,
      tone: selectedTargetId === targetId ? "primary" : "default",
    }];
  });
}

/** 返回领域行动对应的配置化分类标签。 */
function encounterActionCategory(
  action: EncounterAvailableAction["action"],
  texts: GameTextTokens,
): string {
  if (action === "attack") return texts.encounter_action_attack;
  if (action === "guard") return texts.encounter_action_guard;
  if (action === "skill") return texts.encounter_action_skill;
  if (action === "item") return texts.encounter_action_item;
  return texts.encounter_action_retreat;
}

/** 返回战斗结局对应的配置化状态文字。 */
function encounterOutcomeText(
  outcome: UiEncounterBattlePageView["outcome"],
  texts: GameTextTokens,
): string {
  if (outcome === "victory") return texts.encounter_outcome_victory;
  if (outcome === "defeat") return texts.encounter_outcome_defeat;
  if (outcome === "retreated") return texts.encounter_outcome_retreated;
  return texts.encounter_outcome_ongoing;
}
