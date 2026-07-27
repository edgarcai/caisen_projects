import type {
  BossConfig,
  BossPhaseConfig,
  CombatActionConfig,
  RequirementConfig,
} from "../domain/content";
import { formatTemplate } from "../domain/content";
import { CombatError } from "../domain/errors";
import {
  activePlayer,
  cloneGameState,
  isEnded,
  rotatePlayer,
  type BattleState,
  type GameState,
} from "../domain/game-state";
import type {
  PlayerAttributeProvider,
  RandomSource,
  RuleModifierProvider,
} from "../domain/ports";
import type { CombatAction, CombatReport } from "../domain/reports";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";

/** 执行可配置、可保存和可恢复的回合制首领战。 */
export class CombatService {
  private readonly content: GameContent;
  private readonly operations: StateOperations;
  private readonly random: RandomSource;
  private readonly modifiers: RuleModifierProvider;
  private readonly attributes: PlayerAttributeProvider;
  private readonly actionById: ReadonlyMap<string, CombatActionConfig>;

  /** 注入剧情战斗配置、随机源与被动修正提供者。 */
  public constructor(
    content: GameContent,
    operations: StateOperations,
    random: RandomSource,
    modifiers: RuleModifierProvider,
    attributes: PlayerAttributeProvider,
  ) {
    this.content = content;
    this.operations = operations;
    this.random = random;
    this.modifiers = modifiers;
    this.attributes = attributes;
    this.actionById = new Map(
      content.story.combat.actions.map((action) => [action.action_id, action]),
    );
  }

  /** 按剧情路线修正开始首领战，或继续已撤退战斗。 */
  public start(
    state: GameState,
    bossId: string,
    startingHealthPercent = 100,
  ): CombatReport {
    if (isEnded(state)) {
      throw new CombatError("已结束游戏不能开始首领战。");
    }
    if (state.pending_exploration !== null) {
      throw new CombatError("请先结算或取消待处理探索事件。");
    }
    if (!Number.isInteger(startingHealthPercent) || startingHealthPercent <= 0) {
      throw new CombatError("首领初始生命百分比必须是正整数。");
    }
    if (state.story.boss_outcomes[bossId] !== undefined) {
      throw new CombatError(`首领 ${bossId} 已经完成战斗结算。`);
    }
    const boss = this.content.boss(bossId);
    const working = cloneGameState(state);
    const configuredHealth = Math.max(
      1,
      Math.floor((boss.max_health * startingHealthPercent) / 100),
    );
    const existing = working.battle;
    if (existing !== null) {
      if (existing.boss_id !== bossId) {
        throw new CombatError("已存在另一场未收尾的首领战。");
      }
      if (!existing.retreated) {
        throw new CombatError("当前首领战已经开始。");
      }
      existing.finished = false;
      existing.victory = false;
      existing.retreated = false;
      existing.guarding = false;
      existing.max_health = Math.max(boss.max_health, configuredHealth);
      existing.health = Math.min(existing.health, configuredHealth);
    } else {
      working.battle = {
        boss_id: bossId,
        boss_name: boss.name,
        health: configuredHealth,
        max_health: Math.max(boss.max_health, configuredHealth),
        round_number: 1,
        guarding: false,
        focused: false,
        finished: false,
        victory: false,
        retreated: false,
      };
    }
    const battle = this.requireBattle(working);
    const messages = [
      this.text("battle_start", { boss_name: battle.boss_name }),
      this.roundMessage(working),
    ];
    this.commit(working, state);
    return {
      messages,
      finished: false,
      victory: false,
      retreated: false,
      stateChanged: true,
    };
  }

  /** 返回当前战斗的全部行动与实时可用状态。 */
  public availableActions(state: GameState): CombatAction[] {
    if (state.battle === null || state.battle.finished) {
      return [];
    }
    return [...this.actionById.values()].map((action) => {
      let available = this.requirementsMet(action.requirements ?? [], state);
      let reason = available ? "" : this.unavailableReason(action);
      if (
        action.action_id === "medicine"
        && activePlayer(state).health >= this.numericRule("player_max_health")
      ) {
        available = false;
        reason = this.text("medicine_not_needed");
      }
      return {
        actionId: action.action_id,
        label: action.label,
        description: action.description,
        available,
        unavailableReason: reason,
      };
    });
  }

  /** 原子执行玩家行动、首领反击、回合上限和双人轮换。 */
  public performAction(state: GameState, actionId: string): CombatReport {
    const battle = state.battle;
    if (battle === null || battle.finished) {
      throw new CombatError(this.text("battle_not_active"));
    }
    const action = this.actionById.get(actionId);
    if (action === undefined) {
      throw new CombatError(this.text("invalid_action", { action_id: actionId }));
    }
    if (!this.requirementsMet(action.requirements ?? [], state)) {
      if (actionId === "medicine") {
        return {
          messages: [this.text("medicine_failed", { cost: this.medicineCost(action) })],
          finished: false,
          victory: false,
          retreated: false,
          stateChanged: false,
        };
      }
      throw new CombatError(this.text("invalid_action", { action_id: actionId }));
    }
    if (
      actionId === "medicine"
      && activePlayer(state).health >= this.numericRule("player_max_health")
    ) {
      return {
        messages: [this.text("medicine_not_needed")],
        finished: false,
        victory: false,
        retreated: false,
        stateChanged: false,
      };
    }
    const working = cloneGameState(state);
    const messages = this.performOnWorkingState(working, action);
    const current = this.requireBattle(working);
    const report: CombatReport = {
      messages,
      finished: current.finished,
      victory: current.victory,
      retreated: current.retreated,
      stateChanged: true,
    };
    this.commit(working, state);
    return report;
  }

  /** 在状态副本上结算玩家行动与本回合后续效果。 */
  private performOnWorkingState(state: GameState, action: CombatActionConfig): string[] {
    const battle = this.requireBattle(state);
    const boss = this.content.boss(battle.boss_id);
    this.applyResourceCosts(action, state);
    if (action.action_id === "retreat") {
      return this.resolveRetreat(state, action);
    }
    const messages: string[] = [];
    if (action.action_id === "guard") {
      battle.guarding = true;
      messages.push(this.text("guard"));
    } else if (action.action_id === "focus") {
      messages.push(this.text("focus"));
    } else if (action.action_id === "medicine") {
      messages.push(this.resolveMedicine(state, action));
    }

    if (action.damage_multiplier_percent > 0) {
      const [damage, critical] = this.playerDamage(state, action);
      battle.health = Math.max(0, battle.health - damage);
      messages.push(this.text(critical ? "critical_attack" : "attack", {
        boss_name: battle.boss_name,
        damage,
      }));
    }
    if (action.action_id === "focus" && action.focus_gain > 0) {
      battle.focused = true;
    }
    if (battle.health <= 0) {
      this.resolveVictory(state, boss, messages);
    } else {
      messages.push(...this.resolveBossResponse(state, action, boss));
    }
    if (action.ends_round) {
      this.finishRound(state, boss, messages);
    }
    return messages;
  }

  /** 按配置概率处理撤退，失败时执行一次追击。 */
  private resolveRetreat(state: GameState, action: CombatActionConfig): string[] {
    const battle = this.requireBattle(state);
    const boss = this.content.boss(battle.boss_id);
    const chance = Math.min(
      this.numericRule("retreat_max_chance_percent"),
      (action.success_chance_percent ?? this.numericRule("retreat_base_chance_percent"))
        + activePlayer(state).agility * this.numericRule("retreat_agility_bonus_percent_per_point"),
    );
    const range = action.success_random_roll ?? [1, 100];
    const messages: string[] = [];
    if (this.random.randint(range[0], range[1]) <= chance) {
      battle.finished = true;
      battle.retreated = true;
      battle.guarding = false;
      state.shelter.activity -= this.numericRule("retreat_activity_penalty");
      messages.push(this.text("retreat_success", { boss_name: battle.boss_name }));
    } else {
      messages.push(this.text("retreat_failed", { boss_name: battle.boss_name }));
      messages.push(...this.resolveBossResponse(
        state,
        action,
        boss,
        this.numericRule("retreat_failure_damage_multiplier_percent"),
      ));
    }
    if (action.ends_round) {
      this.finishRound(state, boss, messages);
    }
    return messages;
  }

  /** 按行动配置治疗当前所长。 */
  private resolveMedicine(state: GameState, action: CombatActionConfig): string {
    const range = action.healing_random_range;
    const rolled = this.random.randint(range[0], range[1]);
    const amount = Math.floor((rolled * action.healing_multiplier_percent) / 100);
    const player = activePlayer(state);
    const before = player.health;
    player.health = Math.min(this.numericRule("player_max_health"), player.health + amount);
    return this.text("medicine", {
      cost: this.medicineCost(action),
      healed: player.health - before,
    });
  }

  /** 根据玩家属性、基地防御、首领防御和专注计算伤害。 */
  private playerDamage(state: GameState, action: CombatActionConfig): [number, boolean] {
    const battle = this.requireBattle(state);
    const boss = this.content.boss(battle.boss_id);
    const attributes = this.attributes.effectiveAttributes(state);
    let damage = Math.max(
      this.numericRule("minimum_damage"),
      Math.floor((attributes.attack * this.numericRule("player_attack_weight_percent")) / 100)
        + Math.floor((attributes.defense * this.numericRule("player_defense_damage_weight_percent")) / 100)
        + Math.floor((state.shelter.defense_damage * this.numericRule("shelter_defense_damage_weight_percent")) / 100)
        - boss.defense,
    );
    const toolPercent = 100 + this.modifiers.passiveModifier(state, "rules.boss_tool_damage_percent");
    damage = Math.floor((damage * Math.max(0, toolPercent)) / 100);
    damage = Math.floor((damage * action.damage_multiplier_percent) / 100);
    const focused = battle.focused && action.action_id === "attack";
    let criticalChance = this.numericRule("base_critical_chance_percent");
    if (focused) {
      damage = Math.floor((damage * (100 + this.numericRule("focus_damage_bonus_percent"))) / 100);
      criticalChance += this.numericRule("focus_critical_bonus_percent");
      battle.focused = false;
    }
    const variance = action.damage_random_percent;
    damage = Math.floor((damage * this.random.randint(variance[0], variance[1])) / 100);
    const critical = action.action_id === "attack" && this.random.randint(1, 100) <= criticalChance;
    if (critical) {
      damage = Math.floor((damage * this.numericRule("critical_damage_multiplier_percent")) / 100);
    }
    return [Math.max(this.numericRule("minimum_damage"), damage), critical];
  }

  /** 按当前生命阶段处理首领普通攻击或周期特殊招式。 */
  private resolveBossResponse(
    state: GameState,
    action: CombatActionConfig,
    boss: BossConfig,
    damageMultiplier = 100,
  ): string[] {
    const battle = this.requireBattle(state);
    const player = activePlayer(state);
    const defense = this.attributes.effectiveAttribute(state, "defense");
    const phase = this.currentPhase(boss, battle);
    const specialPhase = phase !== null
      && battle.round_number % phase.special_every_rounds === 0
      ? phase
      : null;
    let bossPower = Math.floor((boss.attack * this.numericRule("boss_attack_weight_percent")) / 100);
    if (specialPhase !== null) {
      bossPower += specialPhase.special_damage;
    }
    const bossPercent = 100 + this.modifiers.passiveModifier(state, "rules.boss_damage_percent");
    bossPower = Math.floor((bossPower * Math.max(0, bossPercent)) / 100);
    const mitigation = Math.floor(
      (defense
        * this.numericRule("player_defense_mitigation_percent")
        * action.defense_multiplier_percent) /
        10_000,
    );
    const minimum = this.numericRule("minimum_damage");
    let rawDamage = Math.max(minimum, bossPower - mitigation);
    const variance = this.rangeRule("damage_variance_percent");
    rawDamage = Math.max(
      minimum,
      Math.floor((rawDamage * this.random.randint(variance[0], variance[1])) / 100),
    );
    rawDamage = Math.max(minimum, Math.floor((rawDamage * damageMultiplier) / 100));
    let damage = rawDamage;
    const messages: string[] = [];
    if (battle.guarding) {
      damage = Math.max(
        minimum,
        Math.floor((rawDamage * (100 - this.numericRule("guard_damage_reduction_percent"))) / 100),
      );
      messages.push(this.text("guard_reduced", { raw_damage: rawDamage, damage }));
      battle.guarding = false;
    }
    player.health = Math.max(0, player.health - damage);
    if (specialPhase !== null) {
      messages.push(this.text("boss_special", {
        special_text: specialPhase.special_text,
        damage,
      }));
    } else {
      messages.push(this.text("boss_attack", { boss_name: battle.boss_name, damage }));
    }
    if (player.health <= 0) {
      battle.finished = true;
      state.shelter.activity -= this.numericRule("defeat_activity_penalty");
      messages.push(this.text("defeat", { boss_name: battle.boss_name }));
    }
    return messages;
  }

  /** 在有效战斗行动后处理回合上限、双人轮换和下回合提示。 */
  private finishRound(state: GameState, boss: BossConfig, messages: string[]): void {
    const battle = this.requireBattle(state);
    if (!battle.finished && battle.round_number >= boss.round_limit) {
      activePlayer(state).health = Math.min(
        activePlayer(state).health,
        this.numericRule("round_limit_failure_health"),
      );
      battle.finished = true;
      state.shelter.activity -= this.numericRule("defeat_activity_penalty");
      messages.push(this.text("round_limit"));
    }
    rotatePlayer(state);
    if (!battle.finished) {
      battle.round_number += 1;
      messages.push(this.roundMessage(state));
    }
  }

  /** 标记战斗胜利、发放基础奖励并写入临时首领成果。 */
  private resolveVictory(state: GameState, boss: BossConfig, messages: string[]): void {
    const battle = this.requireBattle(state);
    battle.health = 0;
    battle.finished = true;
    battle.victory = true;
    battle.retreated = false;
    state.story.boss_outcomes[battle.boss_id] = this.stringRule("victory_outcome");
    for (const [target, amount] of Object.entries(boss.base_rewards ?? {})) {
      const current = this.operations.read(target, state);
      this.operations.write(target, current + amount, state);
    }
    state.shelter.activity += this.numericRule("victory_activity_reward");
    messages.push(this.text("victory", { boss_name: battle.boss_name }));
    messages.push(this.text("victory_rewards"));
  }

  /** 检查战斗行动声明的数值前置条件。 */
  private requirementsMet(
    requirements: readonly RequirementConfig[],
    state: GameState,
  ): boolean {
    for (const requirement of requirements) {
      if (requirement.target === undefined || requirement.value === undefined) {
        throw new CombatError("战斗条件缺少目标或阈值。");
      }
      const current = this.operations.read(requirement.target, state);
      const operator = requirement.operator ?? "gte";
      if (operator === "gte" && current < requirement.value) return false;
      if (operator === "lte" && current > requirement.value) return false;
      if (operator === "eq" && current !== requirement.value) return false;
      if (operator !== "gte" && operator !== "lte" && operator !== "eq") {
        throw new CombatError(`战斗条件运算符无效：${operator}`);
      }
    }
    return true;
  }

  /** 在工作副本上应用行动声明的资源消耗。 */
  private applyResourceCosts(action: CombatActionConfig, state: GameState): void {
    for (const cost of action.resource_costs ?? []) {
      if (typeof cost.amount !== "number") {
        throw new CombatError("战斗资源消耗必须是固定整数。");
      }
      const current = this.operations.read(cost.target, state);
      if (cost.operation === "subtract") {
        this.operations.write(cost.target, current - cost.amount, state);
      } else if (cost.operation === "add") {
        this.operations.write(cost.target, current + cost.amount, state);
      } else {
        throw new CombatError(`不支持的战斗资源操作：${cost.operation}`);
      }
    }
  }

  /** 按首领当前生命百分比选择已触发的最深阶段。 */
  private currentPhase(boss: BossConfig, battle: BattleState): BossPhaseConfig | null {
    const percent = (battle.health * 100) / battle.max_health;
    let selected: BossPhaseConfig | null = null;
    const phases = [...boss.phases].sort(
      (left, right) => right.health_threshold_percent - left.health_threshold_percent,
    );
    for (const phase of phases) {
      if (percent <= phase.health_threshold_percent) {
        selected = phase;
      }
    }
    return selected;
  }

  /** 根据当前行动者和战斗状态生成回合提示。 */
  private roundMessage(state: GameState): string {
    const battle = this.requireBattle(state);
    return this.text("round_start", {
      round_number: battle.round_number,
      player_health: activePlayer(state).health,
      boss_name: battle.boss_name,
      boss_health: battle.health,
      boss_max_health: battle.max_health,
    });
  }

  /** 从药品行动的资源消耗中读取用量。 */
  private medicineCost(action: CombatActionConfig): number {
    const cost = (action.resource_costs ?? []).find(
      (candidate) => candidate.target === "player.medical_supplies",
    );
    return cost !== undefined && typeof cost.amount === "number"
      ? cost.amount
      : this.numericRule("medicine_cost");
  }

  /** 为条件不足的战斗行动生成简短原因。 */
  private unavailableReason(action: CombatActionConfig): string {
    return action.action_id === "medicine"
      ? this.text("medicine_failed", { cost: this.medicineCost(action) })
      : this.text("invalid_action", { action_id: action.action_id });
  }

  /** 读取战斗文案并格式化参数。 */
  private text(
    key: string,
    values: Readonly<Record<string, string | number>> = {},
  ): string {
    const template = this.content.story.combat.texts[key];
    if (template === undefined) {
      throw new CombatError(`战斗配置缺少文案：${key}`);
    }
    return formatTemplate(template, values);
  }

  /** 读取战斗配置中的整数规则。 */
  private numericRule(key: string): number {
    const value = this.content.story.combat.rules[key];
    if (typeof value !== "number") {
      throw new CombatError(`战斗规则不是整数：${key}`);
    }
    return value;
  }

  /** 读取战斗配置中的字符串规则。 */
  private stringRule(key: string): string {
    const value = this.content.story.combat.rules[key];
    if (typeof value !== "string") {
      throw new CombatError(`战斗规则不是字符串：${key}`);
    }
    return value;
  }

  /** 读取战斗配置中的闭区间规则。 */
  private rangeRule(key: string): readonly [number, number] {
    const value: unknown = this.content.story.combat.rules[key];
    if (!Array.isArray(value) || value.length !== 2) {
      throw new CombatError(`战斗规则不是数值区间：${key}`);
    }
    const minimum: unknown = value[0];
    const maximum: unknown = value[1];
    if (typeof minimum !== "number" || typeof maximum !== "number") {
      throw new CombatError(`战斗规则区间无效：${key}`);
    }
    return [minimum, maximum];
  }

  /** 要求当前聚合存在一场战斗。 */
  private requireBattle(state: GameState): BattleState {
    if (state.battle === null) {
      throw new CombatError(this.text("battle_not_active"));
    }
    return state.battle;
  }

  /** 在战斗完整结算成功后一次性提交可变状态。 */
  private commit(source: GameState, target: GameState): void {
    target.players = source.players;
    target.active_player_index = source.active_player_index;
    target.shelter = source.shelter;
    target.archive_collection_totals = source.archive_collection_totals;
    target.story = source.story;
    target.companions = source.companions;
    target.facility_levels = source.facility_levels;
    target.battle = source.battle;
  }
}
