import { formatTemplate } from "../domain/content";
import type {
  EncounterAvailableAction,
  EncounterBattleCommand,
  EncounterBattleConfig,
  EncounterBattleResolution,
  EncounterBattleState,
  EncounterDefinitionConfig,
  EncounterEnemyConfig,
  EncounterEnemyIntentConfig,
  EncounterEnemyIntentView,
  EncounterEnemyState,
  EncounterItemConfig,
  EncounterPartyMemberInput,
  EncounterPartyMemberState,
  EncounterSkillConfig,
  EncounterTargetScope,
} from "../domain/demo-systems";
import { DomainError } from "../domain/errors";
import type { RandomSource } from "../domain/ports";

type AbilityConfig = EncounterSkillConfig | EncounterItemConfig;

/** 执行小队逐人下令、敌人意图公开的手动回合制遭遇战。 */
export class EncounterBattleService {
  private readonly config: EncounterBattleConfig;
  private readonly random: RandomSource;
  private readonly encounters: ReadonlyMap<string, EncounterDefinitionConfig>;
  private readonly skills: ReadonlyMap<string, EncounterSkillConfig>;
  private readonly items: ReadonlyMap<string, EncounterItemConfig>;

  /** 注入只读战斗内容与可复现随机源。 */
  public constructor(config: EncounterBattleConfig, random: RandomSource) {
    this.config = config;
    this.random = random;
    this.encounters = new Map(
      config.encounters.map((encounter) => [encounter.encounter_id, encounter]),
    );
    this.skills = new Map(config.skills.map((skill) => [skill.skill_id, skill]));
    this.items = new Map(config.items.map((item) => [item.item_id, item]));
  }

  /** 从所长与伙伴投影创建一份可持久化的遭遇战快照。 */
  public start(
    encounterId: string,
    party: readonly EncounterPartyMemberInput[],
    supplies: Readonly<Record<string, number>> = {},
  ): EncounterBattleState {
    const encounter = this.encounters.get(encounterId);
    if (encounter === undefined) {
      throw new DomainError(this.text("unknown_encounter", { encounter_id: encounterId }));
    }
    this.validateParty(party);
    this.validateSupplies(supplies);
    const state: EncounterBattleState = {
      encounter_id: encounter.encounter_id,
      encounter_name: encounter.name,
      round_number: 1,
      outcome: "ongoing",
      party: party.map((member) => this.createPartyMember(member)),
      enemies: encounter.enemies.map((enemy) => this.createEnemy(enemy)),
      pending_party_member_ids: party.map((member) => member.member_id),
      supplies: { ...supplies },
      log: [],
    };
    this.appendLog(state, [
      this.text("battle_start", { encounter_name: encounter.name }),
      this.text("round_start", { round: state.round_number }),
    ]);
    return state;
  }

  /** 返回指定队员本回合全部基础行动、技能与物品状态。 */
  public availableActions(
    state: EncounterBattleState,
    actorId: string,
  ): EncounterAvailableAction[] {
    const actor = state.party.find((member) => member.member_id === actorId);
    if (actor === undefined || actor.health <= 0) {
      throw new DomainError(this.text("unknown_actor", { actor_id: actorId }));
    }
    if (state.outcome !== "ongoing") return [];
    const actorPending = state.pending_party_member_ids.includes(actorId);
    const enemyTargets = this.reachableEnemyIds(state);
    const actions: EncounterAvailableAction[] = [
      this.actionView(
        "attack",
        null,
        this.text("basic_attack_label"),
        this.text("basic_attack_description"),
        actorPending && enemyTargets.length > 0,
        actorPending ? this.text("no_valid_target") : this.text("actor_not_pending"),
        enemyTargets,
      ),
      this.actionView(
        "guard",
        null,
        this.text("guard_label"),
        this.text("guard_description"),
        actorPending,
        this.text("actor_not_pending"),
        [],
      ),
    ];
    for (const skillId of actor.skill_ids) {
      const skill = this.requireSkill(skillId);
      const cooldown = actor.skill_cooldowns[skillId] ?? 0;
      const targets = this.targetIdsForScope(state, actor, skill.target_scope);
      const available = actorPending && cooldown === 0 && targets.length > 0;
      const reason = !actorPending
        ? this.text("actor_not_pending")
        : cooldown > 0
          ? this.text("cooldown_remaining", { rounds: cooldown })
          : this.text("no_valid_target");
      actions.push(this.actionView(
        "skill",
        skill.skill_id,
        skill.name,
        skill.description,
        available,
        reason,
        targets,
      ));
    }
    for (const item of this.config.items) {
      const quantity = state.supplies[item.item_id] ?? 0;
      const targets = this.targetIdsForScope(state, actor, item.target_scope);
      const available = actorPending && quantity > 0 && targets.length > 0;
      const reason = !actorPending
        ? this.text("actor_not_pending")
        : quantity <= 0
          ? this.text("item_unavailable")
          : this.text("no_valid_target");
      actions.push(this.actionView(
        "item",
        item.item_id,
        `${item.name} ×${String(quantity)}`,
        this.text("item_action_description", { description: item.description }),
        available,
        reason,
        targets,
      ));
    }
    actions.push(this.actionView(
      "retreat",
      null,
      this.text("retreat_label"),
      this.text("retreat_description"),
      actorPending,
      this.text("actor_not_pending"),
      [],
    ));
    return actions;
  }

  /** 返回每名存活敌人下一次行动的公开意图。 */
  public enemyIntents(state: EncounterBattleState): EncounterEnemyIntentView[] {
    return state.enemies
      .filter((enemy) => enemy.health > 0)
      .map((enemy) => {
        const intent = this.intentConfiguration(state.encounter_id, enemy);
        return {
          enemyId: enemy.enemy_id,
          enemyName: enemy.name,
          intentId: intent.intent_id,
          label: intent.label,
          description: intent.description,
        };
      });
  }

  /** 原子执行一次玩家选择，并在全员行动后自动结算敌方阶段。 */
  public performAction(
    state: EncounterBattleState,
    command: EncounterBattleCommand,
  ): EncounterBattleResolution {
    if (state.outcome !== "ongoing") {
      throw new DomainError(this.text("battle_finished"));
    }
    const working = structuredClone(state);
    const actor = this.requirePendingActor(working, command.actor_id);
    const messages = this.resolvePlayerCommand(working, actor, command);
    let roundAdvanced = false;
    if (working.outcome === "ongoing") {
      this.removePendingActor(working, actor.member_id);
      if (this.livingEnemies(working).length === 0) {
        working.outcome = "victory";
        messages.push(this.text("victory"));
      } else if (working.pending_party_member_ids.length === 0) {
        messages.push(...this.resolveEnemyPhase(working));
        if (this.livingParty(working).length > 0) {
          this.prepareNextRound(working, messages);
          roundAdvanced = true;
        }
      }
    }
    this.appendLog(working, messages);
    return { state: working, messages, roundAdvanced };
  }

  /** 将一种玩家指令分派给对应结算策略。 */
  private resolvePlayerCommand(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    command: EncounterBattleCommand,
  ): string[] {
    if (command.action === "attack") {
      return this.resolveAttack(state, actor, command.target_id);
    }
    if (command.action === "guard") {
      actor.guarding = true;
      return [this.text("guard", { actor_name: actor.name })];
    }
    if (command.action === "skill") {
      return this.resolveSkill(state, actor, command.ability_id, command.target_id);
    }
    if (command.action === "item") {
      return this.resolveItem(state, actor, command.ability_id, command.target_id);
    }
    return this.resolveRetreat(state, actor);
  }

  /** 结算普通攻击并记录敌人倒下信息。 */
  private resolveAttack(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    targetId: string,
  ): string[] {
    const target = this.requireReachableEnemy(state, targetId);
    const { damage, critical } = this.playerDamage(
      actor.attack,
      this.config.rules.basic_attack_power_percent,
      0,
      target,
    );
    const defeated = this.damageEnemy(target, damage);
    return [
      this.text(critical ? "critical_attack" : "attack", {
        actor_name: actor.name,
        target_name: target.name,
        damage,
      }),
      ...(defeated ? [this.text("enemy_defeated", { enemy_name: target.name })] : []),
    ];
  }

  /** 结算技能并写入配置化冷却回合。 */
  private resolveSkill(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    skillId: string,
    targetId: string | undefined,
  ): string[] {
    if (!actor.skill_ids.includes(skillId)) {
      throw new DomainError(this.text("unknown_ability", { ability_id: skillId }));
    }
    const skill = this.requireSkill(skillId);
    const cooldown = actor.skill_cooldowns[skillId] ?? 0;
    if (cooldown > 0) {
      throw new DomainError(this.text("cooldown_remaining", { rounds: cooldown }));
    }
    const messages = this.resolveAbility(state, actor, skill, targetId, "skill");
    actor.skill_cooldowns[skillId] = skill.cooldown_rounds + 1;
    return messages;
  }

  /** 消耗一份库存并结算物品效果。 */
  private resolveItem(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    itemId: string,
    targetId: string | undefined,
  ): string[] {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new DomainError(this.text("unknown_ability", { ability_id: itemId }));
    }
    const quantity = state.supplies[itemId] ?? 0;
    if (quantity <= 0) throw new DomainError(this.text("item_unavailable"));
    const messages = this.resolveAbility(state, actor, item, targetId, "item");
    state.supplies[itemId] = quantity - 1;
    return messages;
  }

  /** 根据配置范围结算伤害或治疗能力。 */
  private resolveAbility(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    ability: AbilityConfig,
    targetId: string | undefined,
    source: "skill" | "item",
  ): string[] {
    if (ability.kind === "damage") {
      return this.resolveDamageAbility(state, actor, ability, targetId, source);
    }
    return this.resolveHealingAbility(state, actor, ability, targetId, source);
  }

  /** 结算单体或全体伤害能力。 */
  private resolveDamageAbility(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    ability: AbilityConfig,
    targetId: string | undefined,
    source: "skill" | "item",
  ): string[] {
    const targets = ability.target_scope === "enemy_all"
      ? this.livingEnemies(state)
      : [this.requireReachableEnemy(state, targetId ?? "")];
    if (targets.length === 0) throw new DomainError(this.text("no_valid_target"));
    const messages: string[] = [];
    for (const target of targets) {
      const result = source === "item"
        ? {
            damage: this.damageAfterDefense(
              ability.fixed_amount + Math.floor((actor.attack * ability.power_percent) / 100),
              target,
            ),
            critical: false,
          }
        : this.playerDamage(
            actor.attack,
            ability.power_percent,
            ability.fixed_amount,
            target,
          );
      const defeated = this.damageEnemy(target, result.damage);
      messages.push(this.text(source === "skill" ? "skill_damage" : "item_damage", {
        actor_name: actor.name,
        ability_name: ability.name,
        target_name: target.name,
        damage: result.damage,
      }));
      if (defeated) {
        messages.push(this.text("enemy_defeated", { enemy_name: target.name }));
      }
    }
    return messages;
  }

  /** 结算单体或自身治疗，并阻止生命超过最大值。 */
  private resolveHealingAbility(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    ability: AbilityConfig,
    targetId: string | undefined,
    source: "skill" | "item",
  ): string[] {
    const target = ability.target_scope === "self"
      ? actor
      : this.requireLivingPartyMember(state, targetId ?? "");
    const requested = ability.fixed_amount
      + Math.floor((target.maximum_health * ability.power_percent) / 100);
    const before = target.health;
    target.health = Math.min(target.maximum_health, target.health + requested);
    const amount = target.health - before;
    return [this.text(source === "skill" ? "skill_heal" : "item_heal", {
      actor_name: actor.name,
      ability_name: ability.name,
      target_name: target.name,
      amount,
    })];
  }

  /** 按敏捷与配置概率尝试全队撤退。 */
  private resolveRetreat(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
  ): string[] {
    const rules = this.config.rules;
    const chance = Math.min(
      rules.retreat_maximum_chance_percent,
      rules.retreat_base_chance_percent
        + actor.agility * rules.retreat_agility_bonus_percent_per_point,
    );
    const roll = this.random.randint(
      rules.retreat_roll_range[0],
      rules.retreat_roll_range[1],
    );
    if (roll <= chance) {
      state.outcome = "retreated";
      state.pending_party_member_ids = [];
      return [this.text("retreat_success", { actor_name: actor.name })];
    }
    return [this.text("retreat_failed", { actor_name: actor.name })];
  }

  /** 依照已公开意图结算全部存活敌人的行动。 */
  private resolveEnemyPhase(state: EncounterBattleState): string[] {
    const messages: string[] = [];
    const enemies = [...this.livingEnemies(state)].sort(
      (left, right) => right.agility - left.agility,
    );
    for (const enemy of enemies) {
      if (this.livingParty(state).length === 0) break;
      enemy.guarding = false;
      const intent = this.intentConfiguration(state.encounter_id, enemy);
      if (intent.kind === "defend") {
        enemy.guarding = true;
        messages.push(this.text("enemy_defend", {
          enemy_name: enemy.name,
          intent_name: intent.label,
        }));
      } else if (intent.kind === "attack_all") {
        messages.push(this.resolveEnemyGroupAttack(state, enemy, intent));
      } else {
        messages.push(...this.resolveEnemySingleAttack(state, enemy, intent));
      }
    }
    for (const member of state.party) member.guarding = false;
    if (this.livingParty(state).length === 0) {
      state.outcome = "defeat";
      state.pending_party_member_ids = [];
      messages.push(this.text("defeat"));
    }
    return messages;
  }

  /** 对一个符合前后排规则的友方目标结算敌人单体攻击。 */
  private resolveEnemySingleAttack(
    state: EncounterBattleState,
    enemy: EncounterEnemyState,
    intent: EncounterEnemyIntentConfig,
  ): string[] {
    const targets = this.reachablePartyMembers(state);
    const target = targets[this.random.randint(0, targets.length - 1)];
    if (target === undefined) return [];
    const damage = this.enemyDamage(enemy.attack, intent.power_percent, target);
    const defeated = this.damagePartyMember(target, damage);
    return [
      this.text("enemy_attack", {
        enemy_name: enemy.name,
        intent_name: intent.label,
        target_name: target.name,
        damage,
      }),
      ...(defeated ? [this.text("member_defeated", { member_name: target.name })] : []),
    ];
  }

  /** 对全部存活队员结算敌人群体攻击并返回合计伤害。 */
  private resolveEnemyGroupAttack(
    state: EncounterBattleState,
    enemy: EncounterEnemyState,
    intent: EncounterEnemyIntentConfig,
  ): string {
    let totalDamage = 0;
    const defeatedNames: string[] = [];
    for (const target of this.livingParty(state)) {
      const damage = this.enemyDamage(enemy.attack, intent.power_percent, target);
      totalDamage += damage;
      if (this.damagePartyMember(target, damage)) defeatedNames.push(target.name);
    }
    const message = this.text("enemy_attack_all", {
      enemy_name: enemy.name,
      intent_name: intent.label,
      damage: totalDamage,
    });
    return defeatedNames.reduce(
      (combined, name) => `${combined} ${this.text("member_defeated", { member_name: name })}`,
      message,
    );
  }

  /** 推进冷却、重置行动队列并为敌人抽取下一轮意图。 */
  private prepareNextRound(state: EncounterBattleState, messages: string[]): void {
    state.round_number += 1;
    for (const member of this.livingParty(state)) {
      for (const skillId of member.skill_ids) {
        member.skill_cooldowns[skillId] = Math.max(
          0,
          (member.skill_cooldowns[skillId] ?? 0) - 1,
        );
      }
    }
    state.pending_party_member_ids = this.livingParty(state).map(
      (member) => member.member_id,
    );
    const encounter = this.requireEncounter(state.encounter_id);
    for (const enemy of this.livingEnemies(state)) {
      const configuration = this.enemyConfiguration(encounter, enemy.enemy_id);
      enemy.intent_id = this.selectIntent(configuration).intent_id;
    }
    messages.push(this.text("round_start", { round: state.round_number }));
  }

  /** 按攻击、防御、站位、防御姿态与暴击规则计算玩家伤害。 */
  private playerDamage(
    attack: number,
    powerPercent: number,
    fixedAmount: number,
    target: EncounterEnemyState,
  ): { readonly damage: number; readonly critical: boolean } {
    const rules = this.config.rules;
    const critical = this.random.randint(
      rules.critical_roll_range[0],
      rules.critical_roll_range[1],
    ) <= rules.critical_chance_percent;
    const raw = fixedAmount + Math.floor((attack * powerPercent) / 100);
    const criticalRaw = critical
      ? Math.floor((raw * rules.critical_damage_percent) / 100)
      : raw;
    return { damage: this.damageAfterDefense(criticalRaw, target), critical };
  }

  /** 按攻击倍率计算敌人对一个队员造成的最终伤害。 */
  private enemyDamage(
    attack: number,
    powerPercent: number,
    target: EncounterPartyMemberState,
  ): number {
    const raw = Math.floor((attack * powerPercent) / 100);
    return this.damageAfterDefense(raw, target);
  }

  /** 应用护甲、站位和防御姿态的统一减伤。 */
  private damageAfterDefense(
    rawDamage: number,
    target: Pick<EncounterEnemyState, "defense" | "row" | "guarding">,
  ): number {
    const rules = this.config.rules;
    let damage = Math.max(rules.minimum_damage, rawDamage - target.defense);
    if (target.row === "back") {
      damage = Math.max(
        rules.minimum_damage,
        Math.floor((damage * rules.back_row_damage_received_percent) / 100),
      );
    }
    if (target.guarding) {
      damage = Math.max(
        rules.minimum_damage,
        Math.floor((damage * (100 - rules.guard_damage_reduction_percent)) / 100),
      );
    }
    return damage;
  }

  /** 扣减敌人生命并仅在本次攻击首次击倒时返回 true。 */
  private damageEnemy(target: EncounterEnemyState, damage: number): boolean {
    const wasAlive = target.health > 0;
    target.health = Math.max(0, target.health - damage);
    return wasAlive && target.health === 0;
  }

  /** 扣减队员生命并仅在本次攻击首次击倒时返回 true。 */
  private damagePartyMember(target: EncounterPartyMemberState, damage: number): boolean {
    const wasAlive = target.health > 0;
    target.health = Math.max(0, target.health - damage);
    return wasAlive && target.health === 0;
  }

  /** 创建完整技能冷却表的友方状态。 */
  private createPartyMember(input: EncounterPartyMemberInput): EncounterPartyMemberState {
    return {
      ...input,
      health: input.health ?? input.maximum_health,
      guarding: false,
      skill_cooldowns: Object.fromEntries(input.skill_ids.map((skillId) => [skillId, 0])),
    };
  }

  /** 根据敌人模板创建状态并抽取首轮公开意图。 */
  private createEnemy(input: EncounterEnemyConfig): EncounterEnemyState {
    return {
      enemy_id: input.enemy_id,
      name: input.name,
      row: input.row,
      maximum_health: input.maximum_health,
      health: input.maximum_health,
      attack: input.attack,
      defense: input.defense,
      agility: input.agility,
      guarding: false,
      intent_id: this.selectIntent(input).intent_id,
    };
  }

  /** 按配置权重抽取并返回一个敌方意图。 */
  private selectIntent(enemy: EncounterEnemyConfig): EncounterEnemyIntentConfig {
    return this.random.weightedChoice(
      enemy.intents,
      enemy.intents.map((intent) => intent.weight),
    );
  }

  /** 返回当前可被单体玩家攻击触及的敌人 ID。 */
  private reachableEnemyIds(state: EncounterBattleState): string[] {
    const living = this.livingEnemies(state);
    const front = living.filter((enemy) => enemy.row === "front");
    return (front.length > 0 ? front : living).map((enemy) => enemy.enemy_id);
  }

  /** 返回当前敌人单体攻击可触及的队员。 */
  private reachablePartyMembers(state: EncounterBattleState): EncounterPartyMemberState[] {
    const living = this.livingParty(state);
    const front = living.filter((member) => member.row === "front");
    return front.length > 0 ? front : living;
  }

  /** 根据能力目标范围生成 UI 可选目标 ID。 */
  private targetIdsForScope(
    state: EncounterBattleState,
    actor: EncounterPartyMemberState,
    scope: EncounterTargetScope,
  ): string[] {
    if (scope === "enemy_single") return this.reachableEnemyIds(state);
    if (scope === "enemy_all") return this.livingEnemies(state).map((enemy) => enemy.enemy_id);
    if (scope === "self") return actor.health > 0 ? [actor.member_id] : [];
    return this.livingParty(state).map((member) => member.member_id);
  }

  /** 返回仍有生命的全部友方队员。 */
  private livingParty(state: EncounterBattleState): EncounterPartyMemberState[] {
    return state.party.filter((member) => member.health > 0);
  }

  /** 返回仍有生命的全部敌人。 */
  private livingEnemies(state: EncounterBattleState): EncounterEnemyState[] {
    return state.enemies.filter((enemy) => enemy.health > 0);
  }

  /** 要求目标是当前可触及的存活敌人。 */
  private requireReachableEnemy(
    state: EncounterBattleState,
    targetId: string,
  ): EncounterEnemyState {
    if (!this.reachableEnemyIds(state).includes(targetId)) {
      throw new DomainError(this.text("unknown_target", { target_id: targetId }));
    }
    const target = state.enemies.find((enemy) => enemy.enemy_id === targetId);
    if (target === undefined || target.health <= 0) {
      throw new DomainError(this.text("unknown_target", { target_id: targetId }));
    }
    return target;
  }

  /** 要求目标是仍有生命的友方队员。 */
  private requireLivingPartyMember(
    state: EncounterBattleState,
    targetId: string,
  ): EncounterPartyMemberState {
    const target = state.party.find(
      (member) => member.member_id === targetId && member.health > 0,
    );
    if (target === undefined) {
      throw new DomainError(this.text("unknown_target", { target_id: targetId }));
    }
    return target;
  }

  /** 要求行动者存活且尚在本轮待行动队列。 */
  private requirePendingActor(
    state: EncounterBattleState,
    actorId: string,
  ): EncounterPartyMemberState {
    const actor = state.party.find(
      (member) => member.member_id === actorId && member.health > 0,
    );
    if (actor === undefined) {
      throw new DomainError(this.text("unknown_actor", { actor_id: actorId }));
    }
    if (!state.pending_party_member_ids.includes(actorId)) {
      throw new DomainError(this.text("actor_not_pending"));
    }
    return actor;
  }

  /** 从本轮待行动队列移除一个已完成指令的队员。 */
  private removePendingActor(state: EncounterBattleState, actorId: string): void {
    state.pending_party_member_ids = state.pending_party_member_ids.filter(
      (candidate) => candidate !== actorId,
    );
  }

  /** 要求稳定 ID 对应一项技能。 */
  private requireSkill(skillId: string): EncounterSkillConfig {
    const skill = this.skills.get(skillId);
    if (skill === undefined) {
      throw new DomainError(this.text("unknown_ability", { ability_id: skillId }));
    }
    return skill;
  }

  /** 要求稳定 ID 对应一场遭遇。 */
  private requireEncounter(encounterId: string): EncounterDefinitionConfig {
    const encounter = this.encounters.get(encounterId);
    if (encounter === undefined) {
      throw new DomainError(this.text("unknown_encounter", { encounter_id: encounterId }));
    }
    return encounter;
  }

  /** 在一场遭遇中查找敌人配置。 */
  private enemyConfiguration(
    encounter: EncounterDefinitionConfig,
    enemyId: string,
  ): EncounterEnemyConfig {
    const enemy = encounter.enemies.find((candidate) => candidate.enemy_id === enemyId);
    if (enemy === undefined) {
      throw new DomainError(this.text("unknown_target", { target_id: enemyId }));
    }
    return enemy;
  }

  /** 返回一个敌人状态当前意图所对应的配置。 */
  private intentConfiguration(
    encounterId: string,
    enemy: EncounterEnemyState,
  ): EncounterEnemyIntentConfig {
    const configuration = this.enemyConfiguration(
      this.requireEncounter(encounterId),
      enemy.enemy_id,
    );
    const intent = configuration.intents.find(
      (candidate) => candidate.intent_id === enemy.intent_id,
    );
    if (intent === undefined) {
      throw new DomainError(this.text("unknown_ability", { ability_id: enemy.intent_id }));
    }
    return intent;
  }

  /** 验证开战小队规模、属性、技能引用和稳定 ID。 */
  private validateParty(party: readonly EncounterPartyMemberInput[]): void {
    const invalidSize = party.length === 0
      || party.length > this.config.rules.maximum_party_size;
    const invalidId = new Set(party.map((member) => member.member_id)).size !== party.length;
    const invalidMember = party.some((member) => {
      const health = member.health ?? member.maximum_health;
      return member.member_id.trim() === ""
        || member.name.trim() === ""
        || !Number.isInteger(member.maximum_health)
        || member.maximum_health <= 0
        || !Number.isInteger(health)
        || health <= 0
        || health > member.maximum_health
        || ![member.attack, member.defense, member.agility].every(
          (value) => Number.isInteger(value) && value >= 0,
        )
        || new Set(member.skill_ids).size !== member.skill_ids.length
        || member.skill_ids.some((skillId) => !this.skills.has(skillId));
    });
    if (invalidSize || invalidId || invalidMember) {
      throw new DomainError(this.text("invalid_party"));
    }
  }

  /** 验证战斗库存只含已配置物品与非负整数数量。 */
  private validateSupplies(supplies: Readonly<Record<string, number>>): void {
    const invalid = Object.entries(supplies).some(([itemId, quantity]) => (
      !this.items.has(itemId) || !Number.isInteger(quantity) || quantity < 0
    ));
    if (invalid) throw new DomainError(this.text("invalid_supply"));
  }

  /** 创建一项 UI 行动投影，统一不可用原因规则。 */
  private actionView(
    action: EncounterAvailableAction["action"],
    abilityId: string | null,
    label: string,
    description: string,
    available: boolean,
    unavailableReason: string,
    targetIds: readonly string[],
  ): EncounterAvailableAction {
    return {
      action,
      abilityId,
      label,
      description,
      available,
      unavailableReason: available ? "" : unavailableReason,
      targetIds,
    };
  }

  /** 追加战斗日志并按配置截断最旧条目。 */
  private appendLog(state: EncounterBattleState, messages: readonly string[]): void {
    state.log.push(...messages.map((message) => ({
      round_number: state.round_number,
      message,
    })));
    const maximum = this.config.rules.maximum_log_entries;
    if (state.log.length > maximum) state.log = state.log.slice(-maximum);
  }

  /** 读取并格式化一条战斗文案。 */
  private text(
    key: string,
    values: Readonly<Record<string, string | number>> = {},
  ): string {
    const template = this.config.texts[key];
    if (template === undefined) throw new DomainError(`缺少遭遇战文案：${key}`);
    return formatTemplate(template, values);
  }
}
