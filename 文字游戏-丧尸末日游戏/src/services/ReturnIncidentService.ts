import { formatTemplate } from "../domain/content";
import type {
  ReturnIncidentChoiceConfig,
  ReturnIncidentConfig,
  ReturnIncidentPrompt,
  ReturnIncidentRequirementConfig,
  ReturnIncidentResolution,
  ReturnIncidentSystemConfig,
} from "../domain/demo-systems";
import { DomainError } from "../domain/errors";
import { cloneGameState, type GameState } from "../domain/game-state";
import type { RandomSource } from "../domain/ports";
import type { StateOperations } from "./StateOperations";

/** 抽取并原子结算探索归来后的配置化避难所事项。 */
export class ReturnIncidentService {
  private readonly config: ReturnIncidentSystemConfig;
  private readonly operations: StateOperations;
  private readonly random: RandomSource;
  private readonly incidentById: ReadonlyMap<string, ReturnIncidentConfig>;

  /** 注入事项内容、安全状态操作器与可复现随机源。 */
  public constructor(
    config: ReturnIncidentSystemConfig,
    operations: StateOperations,
    random: RandomSource,
  ) {
    this.config = config;
    this.operations = operations;
    this.random = random;
    this.incidentById = new Map(
      config.incidents.map((incident) => [incident.incident_id, incident]),
    );
  }

  /** 按配置概率和权重尝试生成一项归来事项；未触发时返回 null。 */
  public tryDraw(
    state: GameState,
    excludedIds: readonly string[] = [],
  ): ReturnIncidentPrompt | null {
    const [minimum, maximum] = this.config.trigger_roll_range;
    const roll = this.random.randint(minimum, maximum);
    if (roll > this.config.trigger_chance_percent) return null;
    const excluded = new Set(excludedIds);
    const eligible = this.config.incidents.filter((incident) => (
      !excluded.has(incident.incident_id)
      && this.requirementsMet(incident.requirements, state)
    ));
    if (eligible.length === 0) return null;
    const incident = this.random.weightedChoice(
      eligible,
      eligible.map((candidate) => candidate.weight),
    );
    return this.buildPrompt(state, incident);
  }

  /** 根据待处理稳定 ID 重建事项页面及实时选择可用性。 */
  public prompt(state: GameState, incidentId: string): ReturnIncidentPrompt {
    return this.buildPrompt(state, this.requireIncident(incidentId));
  }

  /** 在状态副本上应用选择效果、边界和结算文案，成功后一次性提交。 */
  public resolve(
    state: GameState,
    incidentId: string,
    choiceId: string,
  ): ReturnIncidentResolution {
    const incident = this.requireIncident(incidentId);
    const choice = incident.choices.find((candidate) => candidate.choice_id === choiceId);
    if (choice === undefined) {
      throw new DomainError(this.text("unknown_choice", {
        incident_id: incidentId,
        choice_id: choiceId,
      }));
    }
    const unavailableReason = this.firstUnavailableReason(choice.requirements, state);
    if (unavailableReason !== "") throw new DomainError(unavailableReason);
    const working = cloneGameState(state);
    const tokens = this.operations.applyEffects(choice.effects, working);
    this.applyStateBounds(working);
    const result = formatTemplate(choice.result, tokens);
    const message = this.text("resolution_prefix", {
      incident_title: incident.title,
      result,
    });
    Object.assign(state, working);
    return {
      incidentId,
      choiceId,
      message,
      stateChanged: choice.effects.length > 0,
    };
  }

  /** 将领域事项转换为 UI 可直接展示的选择列表。 */
  private buildPrompt(
    state: GameState,
    incident: ReturnIncidentConfig,
  ): ReturnIncidentPrompt {
    return {
      incidentId: incident.incident_id,
      title: incident.title,
      description: incident.description,
      choices: incident.choices.map((choice) => this.choiceView(state, choice)),
    };
  }

  /** 计算一个选择当前是否满足全部资源与状态条件。 */
  private choiceView(
    state: GameState,
    choice: ReturnIncidentChoiceConfig,
  ): ReturnIncidentPrompt["choices"][number] {
    const unavailableReason = this.firstUnavailableReason(choice.requirements, state);
    return {
      choiceId: choice.choice_id,
      label: choice.label,
      description: choice.description,
      available: unavailableReason === "",
      unavailableReason,
    };
  }

  /** 返回全部条件是否满足。 */
  private requirementsMet(
    requirements: readonly ReturnIncidentRequirementConfig[],
    state: GameState,
  ): boolean {
    return requirements.every((requirement) => this.requirementMet(requirement, state));
  }

  /** 返回首个未满足条件的配置化说明。 */
  private firstUnavailableReason(
    requirements: readonly ReturnIncidentRequirementConfig[],
    state: GameState,
  ): string {
    return requirements.find((requirement) => !this.requirementMet(requirement, state))
      ?.unavailable_text ?? "";
  }

  /** 比较一个配置化状态目标与阈值。 */
  private requirementMet(
    requirement: ReturnIncidentRequirementConfig,
    state: GameState,
  ): boolean {
    const current = this.operations.read(requirement.target, state);
    if (requirement.operator === "gte") return current >= requirement.value;
    if (requirement.operator === "lte") return current <= requirement.value;
    if (requirement.operator === "gt") return current > requirement.value;
    if (requirement.operator === "lt") return current < requirement.value;
    return current === requirement.value;
  }

  /** 依次应用配置化状态上下界，避免随机效果造成非法负库存。 */
  private applyStateBounds(state: GameState): void {
    for (const bound of this.config.state_bounds) {
      const current = this.operations.read(bound.target, state);
      const maximum = bound.maximum ?? Number.MAX_SAFE_INTEGER;
      const clamped = Math.min(maximum, Math.max(bound.minimum, current));
      if (clamped !== current) this.operations.write(bound.target, clamped, state);
    }
  }

  /** 要求稳定 ID 对应一项归来事项。 */
  private requireIncident(incidentId: string): ReturnIncidentConfig {
    const incident = this.incidentById.get(incidentId);
    if (incident === undefined) {
      throw new DomainError(this.text("unknown_incident", { incident_id: incidentId }));
    }
    return incident;
  }

  /** 读取并格式化一条归来事项文案。 */
  private text(
    key: string,
    values: Readonly<Record<string, string | number>> = {},
  ): string {
    const template = this.config.texts[key];
    if (template === undefined) throw new DomainError(`缺少归来事项文案：${key}`);
    return formatTemplate(template, values);
  }
}
