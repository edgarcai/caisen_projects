import type {
  ArchiveCollectionOverview,
  ArchiveDocumentConfig,
  ArchiveDocumentListItem,
  DemoSystemsConfig,
  EncounterAvailableAction,
  EncounterBattleCommand,
  EncounterBattleResolution,
  EncounterDefinitionConfig,
  EncounterEnemyIntentView,
  EncounterPreparationMember,
  EncounterPreparationPlan,
  EncounterPreparationSnapshot,
  EncounterPartyMemberInput,
  EncounterRoleConfig,
  ReturnIncidentPrompt,
  ReturnIncidentResolution,
} from "../domain/demo-systems";
import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import type { GameState } from "../domain/game-state";
import type { EncounterPartyAttributeProvider } from "../domain/ports";
import type { ArchiveStorageService } from "./ArchiveStorageService";
import type { EncounterBattleService } from "./EncounterBattleService";
import type { GameContent } from "./GameContent";
import type { ReturnIncidentService } from "./ReturnIncidentService";

/** 聚合 Demo 的战斗、归来事项和文献查询，避免应用层直接依赖三套领域细节。 */
export class DemoSystemsCoordinator {
  private readonly config: DemoSystemsConfig;
  private readonly encounterBattle: EncounterBattleService;
  private readonly returnIncidents: ReturnIncidentService;
  private readonly archiveStorage: ArchiveStorageService;
  private readonly equipment: EncounterPartyAttributeProvider;
  private readonly content: GameContent;

  /** 注入只读配置与三个单一职责领域服务。 */
  public constructor(
    config: DemoSystemsConfig,
    encounterBattle: EncounterBattleService,
    returnIncidents: ReturnIncidentService,
    archiveStorage: ArchiveStorageService,
    equipment: EncounterPartyAttributeProvider,
    content: GameContent,
  ) {
    this.config = config;
    this.encounterBattle = encounterBattle;
    this.returnIncidents = returnIncidents;
    this.archiveStorage = archiveStorage;
    this.equipment = equipment;
    this.content = content;
  }

  /** 返回可选择的全部遭遇战内容副本。 */
  public encounterCatalog(): readonly EncounterDefinitionConfig[] {
    return structuredClone(this.config.encounter_battle.encounters);
  }

  /** 使用权威内容配置校验存档中的遭遇和归来事项稳定 ID。 */
  public validatePersistentState(state: GameState): void {
    const battle = state.encounter_battle;
    if (battle !== null) {
      const encounter = this.config.encounter_battle.encounters.find(
        (candidate) => candidate.encounter_id === battle.encounter_id,
      );
      if (encounter === undefined) {
        throw new GameApplicationError(
          formatTemplate(
            this.config.encounter_battle.texts.unknown_encounter ?? battle.encounter_id,
            { encounter_id: battle.encounter_id },
          ),
        );
      }
      const enemyById = new Map(
        encounter.enemies.map((enemy) => [enemy.enemy_id, enemy]),
      );
      const skillIds = new Set(
        this.config.encounter_battle.skills.map((skill) => skill.skill_id),
      );
      const itemIds = new Set(
        this.config.encounter_battle.items.map((item) => item.item_id),
      );
      if (battle.party.some((member) => (
        member.skill_ids.some((skillId) => !skillIds.has(skillId))
      ))) {
        throw new GameApplicationError(
          this.config.encounter_battle.texts.invalid_party ?? "",
        );
      }
      if (battle.enemies.some((enemy) => {
        const configured = enemyById.get(enemy.enemy_id);
        return configured === undefined
          || !configured.intents.some((intent) => intent.intent_id === enemy.intent_id);
      })) {
        throw new GameApplicationError(
          this.config.encounter_battle.texts.invalid_party ?? "",
        );
      }
      if (Object.keys(battle.supplies).some((itemId) => !itemIds.has(itemId))) {
        throw new GameApplicationError(
          this.config.encounter_battle.texts.invalid_supply ?? "",
        );
      }
    }
    if (state.pending_return_incident_id !== null) {
      this.returnIncidents.prompt(state, state.pending_return_incident_id);
    }
  }

  /** 返回指定遭遇的职责、队员生命与可用医疗物资快照。 */
  public encounterPreparation(
    state: GameState,
    encounterId: string,
  ): EncounterPreparationSnapshot {
    if (state.encounter_battle !== null) {
      throw new GameApplicationError(
        this.config.encounter_battle.texts.battle_in_progress ?? encounterId,
      );
    }
    const encounter = this.requireEncounterDefinition(encounterId);
    const members = this.partyInputs(state).map<EncounterPreparationMember>((member) => ({
      ...member,
      health: member.health ?? member.maximum_health,
    }));
    return {
      encounter_id: encounter.encounter_id,
      encounter_name: encounter.name,
      encounter_description: encounter.description,
      members,
      roles: structuredClone(this.config.encounter_battle.preparation.roles),
      medical_supplies: state.players[state.active_player_index]?.medical_supplies ?? 0,
      treatment_cost: this.config.encounter_battle.preparation.treatment_cost,
      treatment_heal: this.config.encounter_battle.preparation.treatment_heal,
    };
  }

  /** 原子校验职责与治疗草稿，再创建一场可持久化的手动遭遇战。 */
  public startEncounter(
    state: GameState,
    encounterId: string,
    plan: EncounterPreparationPlan,
  ): readonly string[] {
    const preparation = this.encounterPreparation(state, encounterId);
    const roles = new Map(
      preparation.roles.map((role) => [role.role_id, role]),
    );
    const members = new Map(
      preparation.members.map((member) => [member.member_id, member]),
    );
    const assignments = Object.entries(plan.role_ids_by_member);
    for (const [memberId, roleId] of assignments) {
      if (!members.has(memberId)) {
        throw new GameApplicationError(this.battleText(
          "preparation_unknown_member",
          { member_id: memberId },
        ));
      }
      if (!roles.has(roleId)) {
        throw new GameApplicationError(this.battleText(
          "preparation_unknown_role",
          { role_id: roleId },
        ));
      }
    }
    if (
      assignments.length !== preparation.members.length
      || preparation.members.some((member) => (
        plan.role_ids_by_member[member.member_id] === undefined
      ))
    ) {
      throw new GameApplicationError(this.battleText("preparation_missing_role"));
    }

    const treatedMemberIds = new Set(plan.treated_member_ids);
    if (treatedMemberIds.size !== plan.treated_member_ids.length) {
      const duplicateId = plan.treated_member_ids.find(
        (memberId, index) => plan.treated_member_ids.indexOf(memberId) !== index,
      ) ?? "";
      throw new GameApplicationError(this.battleText(
        "preparation_duplicate_treatment",
        { member_id: duplicateId },
      ));
    }
    for (const memberId of treatedMemberIds) {
      const member = members.get(memberId);
      if (member === undefined) {
        throw new GameApplicationError(this.battleText(
          "preparation_unknown_member",
          { member_id: memberId },
        ));
      }
      if (member.health >= member.maximum_health) {
        throw new GameApplicationError(this.battleText(
          "preparation_treatment_not_needed",
          { member_name: member.name },
        ));
      }
    }
    const requiredMedicalSupplies = treatedMemberIds.size * preparation.treatment_cost;
    if (requiredMedicalSupplies > preparation.medical_supplies) {
      throw new GameApplicationError(this.battleText(
        "preparation_medical_shortage",
        {
          required: requiredMedicalSupplies,
          available: preparation.medical_supplies,
        },
      ));
    }

    const treatmentMessages: string[] = [];
    const preparedParty = preparation.members.map<EncounterPartyMemberInput>((member) => {
      const roleId = plan.role_ids_by_member[member.member_id] ?? "";
      const role = roles.get(roleId);
      if (role === undefined) {
        throw new GameApplicationError(this.battleText(
          "preparation_unknown_role",
          { role_id: roleId },
        ));
      }
      const health = treatedMemberIds.has(member.member_id)
        ? Math.min(member.maximum_health, member.health + preparation.treatment_heal)
        : member.health;
      if (treatedMemberIds.has(member.member_id)) {
        treatmentMessages.push(this.battleText("preparation_treated", {
          member_name: member.name,
          cost: preparation.treatment_cost,
          amount: health - member.health,
        }));
      }
      return this.applyEncounterRole(member, role, health);
    });
    const battle = this.encounterBattle.start(
      encounterId,
      preparedParty,
      this.startingSupplies(),
    );
    const activePlayer = state.players[state.active_player_index];
    if (activePlayer !== undefined) {
      activePlayer.medical_supplies -= requiredMedicalSupplies;
    }
    this.synchronizePreparedPlayerHealth(state, preparedParty);
    state.encounter_battle = battle;
    return [
      this.battleText("preparation_ready"),
      ...preparedParty.map((member) => this.battleText(
        "preparation_role_assignment",
        {
          member_name: member.name,
          role_name: roles.get(plan.role_ids_by_member[member.member_id] ?? "")?.label ?? "",
        },
      )),
      ...treatmentMessages,
      ...battle.log.map((entry) => entry.message),
    ];
  }

  /** 返回指定队员本回合的实时行动可用性。 */
  public availableEncounterActions(
    state: GameState,
    actorId: string,
  ): readonly EncounterAvailableAction[] {
    return this.encounterBattle.availableActions(
      this.requireEncounterBattle(state),
      actorId,
    );
  }

  /** 返回当前全部存活敌人的下一回合公开意图。 */
  public encounterEnemyIntents(state: GameState): readonly EncounterEnemyIntentView[] {
    return this.encounterBattle.enemyIntents(this.requireEncounterBattle(state));
  }

  /** 执行一次手动指令并把新战斗快照与所长生命同步回主状态。 */
  public performEncounterAction(
    state: GameState,
    command: EncounterBattleCommand,
  ): EncounterBattleResolution {
    const resolution = this.encounterBattle.performAction(
      this.requireEncounterBattle(state),
      command,
    );
    state.encounter_battle = resolution.state;
    this.synchronizePlayerHealth(state);
    return resolution;
  }

  /** 在玩家查看完已结束战斗后清理战斗快照。 */
  public finishEncounter(state: GameState): string {
    const battle = this.requireEncounterBattle(state);
    if (battle.outcome === "ongoing") {
      throw new GameApplicationError(
        this.config.encounter_battle.texts.battle_in_progress ?? "",
      );
    }
    state.encounter_battle = null;
    return this.config.encounter_battle.texts.battle_closed ?? "";
  }

  /** 返回所有文献分类的收集进度。 */
  public archiveOverview(state: GameState): readonly ArchiveCollectionOverview[] {
    return this.archiveStorage.overview(state);
  }

  /** 为新开局按初始库存建立持久化文献馆藏进度。 */
  public initializeArchiveProgress(state: GameState): void {
    this.archiveStorage.initializeProgress(state);
  }

  /** 返回指定文献分类的锁定或已解锁目录。 */
  public archiveList(
    state: GameState,
    collectionId: string,
  ): readonly ArchiveDocumentListItem[] {
    return this.archiveStorage.list(state, collectionId);
  }

  /** 返回一篇已经满足收集数量要求的完整正文。 */
  public archiveDetail(
    state: GameState,
    collectionId: string,
    documentId: string,
  ): ArchiveDocumentConfig {
    return this.archiveStorage.detail(state, collectionId, documentId);
  }

  /** 在返程后按配置概率抽取事项，并仅持久化稳定事项 ID。 */
  public tryQueueReturnIncident(state: GameState): ReturnIncidentPrompt | null {
    if (state.pending_return_incident_id !== null) {
      return this.returnIncidents.prompt(state, state.pending_return_incident_id);
    }
    const prompt = this.returnIncidents.tryDraw(state);
    if (prompt !== null) state.pending_return_incident_id = prompt.incidentId;
    return prompt;
  }

  /** 根据存档中的稳定 ID 重建当前归来事项。 */
  public returnIncidentPrompt(state: GameState): ReturnIncidentPrompt | null {
    const incidentId = state.pending_return_incident_id;
    return incidentId === null ? null : this.returnIncidents.prompt(state, incidentId);
  }

  /** 结算当前归来事项并清除待处理 ID。 */
  public resolveReturnIncident(
    state: GameState,
    choiceId: string,
  ): ReturnIncidentResolution {
    const incidentId = state.pending_return_incident_id;
    if (incidentId === null) {
      throw new GameApplicationError(this.config.return_incidents.texts.no_eligible_incident ?? "");
    }
    const resolution = this.returnIncidents.resolve(state, incidentId, choiceId);
    state.pending_return_incident_id = null;
    return resolution;
  }

  /** 从配置化技能集合、所长属性和伙伴档案投影遭遇小队。 */
  private partyInputs(state: GameState): EncounterPartyMemberInput[] {
    const maximumPartySize = this.config.encounter_battle.rules.maximum_party_size;
    const skillIds = this.config.encounter_battle.skills.map((skill) => skill.skill_id);
    const party: EncounterPartyMemberInput[] = state.players.map<EncounterPartyMemberInput>(
      (player, index) => {
      const attributes = this.equipment.effectiveAttributes(state, index);
      return {
        member_id: `player:${String(index)}`,
        name: player.name,
        row: index % 2 === 0 ? "front" : "back",
        maximum_health: this.content.game.rules.limits.player_max_health,
        health: player.health,
        attack: attributes.attack,
        defense: attributes.defense,
        agility: attributes.agility,
        skill_ids: skillIds,
      };
    },
    ).slice(0, maximumPartySize);
    const referencePlayer = state.players[state.active_player_index];
    if (referencePlayer === undefined) return party;
    const companionBaseline = {
      attack: referencePlayer.attack,
      defense: referencePlayer.defense,
      agility: referencePlayer.agility,
    };
    const selectedCompanionIds = state.expedition?.companion_ids;
    const activeCompanions = state.companions.filter((companion) => (
      companion.status === "active"
      && (selectedCompanionIds === undefined
        || selectedCompanionIds.includes(companion.companion_id))
    ));
    for (const companion of activeCompanions) {
      if (party.length >= maximumPartySize) break;
      const profile = this.content.story.companions.find(
        (candidate) => candidate.companion_id === companion.companion_id,
      );
      if (profile === undefined) continue;
      const attributes = this.equipment.effectiveCompanionAttributes(
        state,
        companion.companion_id,
        companionBaseline,
      );
      party.push({
        member_id: `companion:${companion.companion_id}`,
        name: profile.name,
        row: party.length % 2 === 0 ? "front" : "back",
        maximum_health: this.content.game.rules.limits.player_max_health,
        attack: attributes.attack,
        defense: attributes.defense,
        agility: attributes.agility,
        skill_ids: skillIds,
      });
    }
    return party;
  }

  /** 按每项物品配置生成本场独立战术库存。 */
  private startingSupplies(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.config.encounter_battle.items.map(
      (item) => [item.item_id, item.starting_quantity],
    ));
  }

  /** 按职责倍率生成新的参战投影，不修改开战前的玩家或伙伴基础属性。 */
  private applyEncounterRole(
    member: EncounterPreparationMember,
    role: EncounterRoleConfig,
    health: number,
  ): EncounterPartyMemberInput {
    return {
      ...member,
      row: role.row,
      health,
      attack: this.scaleEncounterAttribute(member.attack, role.attack_percent),
      defense: this.scaleEncounterAttribute(member.defense, role.defense_percent),
      agility: this.scaleEncounterAttribute(member.agility, role.agility_percent),
    };
  }

  /** 按配置百分比缩放战斗属性，并遵守整备系统的最小属性下限。 */
  private scaleEncounterAttribute(value: number, percent: number): number {
    return Math.max(
      this.config.encounter_battle.preparation.minimum_attribute,
      Math.floor((value * percent) / 100),
    );
  }

  /** 返回稳定 ID 对应的遭遇定义，未知 ID 使用配置化错误文案。 */
  private requireEncounterDefinition(encounterId: string): EncounterDefinitionConfig {
    const encounter = this.config.encounter_battle.encounters.find(
      (candidate) => candidate.encounter_id === encounterId,
    );
    if (encounter === undefined) {
      throw new GameApplicationError(this.battleText(
        "unknown_encounter",
        { encounter_id: encounterId },
      ));
    }
    return encounter;
  }

  /** 格式化遭遇系统配置文案，避免领域服务散落字符串拼接。 */
  private battleText(
    key: string,
    values: Readonly<Record<string, string | number>> = {},
  ): string {
    return formatTemplate(this.config.encounter_battle.texts[key] ?? key, values);
  }

  /** 把参战所长的战斗生命同步到主聚合，伙伴仍由伙伴状态机管理。 */
  private synchronizePlayerHealth(state: GameState): void {
    const battle = this.requireEncounterBattle(state);
    for (const member of battle.party) {
      if (!member.member_id.startsWith("player:")) continue;
      const index = Number.parseInt(member.member_id.slice("player:".length), 10);
      const player = state.players[index];
      if (player !== undefined) player.health = member.health;
    }
  }

  /** 把战前治疗后的所长生命同步回主聚合，保证存档与战斗快照一致。 */
  private synchronizePreparedPlayerHealth(
    state: GameState,
    party: readonly EncounterPartyMemberInput[],
  ): void {
    for (const member of party) {
      if (!member.member_id.startsWith("player:")) continue;
      const index = Number.parseInt(member.member_id.slice("player:".length), 10);
      const player = state.players[index];
      if (player !== undefined && member.health !== undefined) {
        player.health = member.health;
      }
    }
  }

  /** 要求当前存在一场可读取的遭遇战。 */
  private requireEncounterBattle(state: GameState): NonNullable<GameState["encounter_battle"]> {
    if (state.encounter_battle === null) {
      throw new GameApplicationError(
        this.config.encounter_battle.texts.no_active_battle ?? "",
      );
    }
    return state.encounter_battle;
  }
}
