import { GameApplicationError } from "../domain/errors";
import {
  activePlayer,
  cloneGameState,
  isEnded,
  type GameMode,
  type GameState,
  type PendingExplorationState,
  type PlayerState,
  type WeeklyArchiveState,
} from "../domain/game-state";
import type {
  PlayerAttributeProvider,
  RandomSource,
  SaveRepository,
} from "../domain/ports";
import type {
  CraftingRecipeView,
  EffectivePlayerAttributes,
  ExpeditionCarryItemView,
  ExpeditionCompanionView,
  ExpeditionStatusView,
  ResearchProjectView,
  WarehouseItemView,
} from "../domain/survival-systems";
import {
  actionReport,
  type ActionReport,
  type CombatAction,
  type EventPrompt,
  type ManagementCategory,
  type ManagementOption,
  type StoryPrompt,
  type StoryStatus,
} from "../domain/reports";
import type {
  ChronicleService,
  CombatService,
  ExpeditionService,
  ExplorationService,
  GameContent,
  GameRules,
  InventoryService,
  ResearchCraftingService,
  ShelterService,
  StoryService,
} from "../services";

interface CommitActionOptions {
  readonly consumesTurn: boolean;
  readonly rotatePlayer?: boolean;
  readonly turnsConsumed?: number;
  readonly actionType?: string;
}

/** 编排剧情、探索、战斗、经营、生存回合和存档事务。 */
export class GameApplication {
  public readonly content: GameContent;
  public state: GameState | null;

  private readonly exploration: ExplorationService;
  private readonly story: StoryService;
  private readonly combat: CombatService;
  private readonly shelter: ShelterService;
  private readonly chronicle: ChronicleService;
  private readonly inventory: InventoryService;
  private readonly equipment: PlayerAttributeProvider;
  private readonly researchCrafting: ResearchCraftingService;
  private readonly expedition: ExpeditionService;
  private readonly rules: GameRules;
  private readonly repository: SaveRepository;
  private readonly random: RandomSource;

  /** 通过构造器注入所有服务和端口，应用层只承担用例编排。 */
  public constructor(
    content: GameContent,
    exploration: ExplorationService,
    story: StoryService,
    combat: CombatService,
    shelter: ShelterService,
    chronicle: ChronicleService,
    inventory: InventoryService,
    equipment: PlayerAttributeProvider,
    researchCrafting: ResearchCraftingService,
    expedition: ExpeditionService,
    rules: GameRules,
    repository: SaveRepository,
    random: RandomSource,
  ) {
    this.content = content;
    this.exploration = exploration;
    this.story = story;
    this.combat = combat;
    this.shelter = shelter;
    this.chronicle = chronicle;
    this.inventory = inventory;
    this.equipment = equipment;
    this.researchCrafting = researchCrafting;
    this.expedition = expedition;
    this.rules = rules;
    this.repository = repository;
    this.random = random;
    this.state = null;
  }

  /** 根据配置创建单人或本地双人的全新完整游戏。 */
  public startNewGame(playerNames: readonly string[], mode: GameMode): ActionReport {
    const cleanNames = playerNames.map((name) => name.trim()).filter((name) => name !== "");
    if (cleanNames.length === 0) {
      throw new GameApplicationError(this.content.text("invalid_player_name"));
    }
    const modeLimits = this.content.game.rules.player_counts[mode];
    if (modeLimits === undefined) {
      throw new GameApplicationError(this.content.text("unknown_mode", { mode }));
    }
    if (
      cleanNames.length < modeLimits.minimum
      || cleanNames.length > modeLimits.maximum
      || new Set(cleanNames).size !== cleanNames.length
    ) {
      throw new GameApplicationError(this.content.text("invalid_names"));
    }
    const defaults = this.content.game.defaults;
    const players: PlayerState[] = cleanNames.map((name) => ({
      name,
      ...structuredClone(defaults.player),
    }));
    const time = this.content.game.rules.time;
    this.state = {
      mode,
      players,
      active_player_index: 0,
      shelter: structuredClone(defaults.shelter),
      clock: {
        year: time.start_year,
        month: time.start_month,
        day: time.start_day,
        hour: time.start_hour,
      },
      story: this.story.createStoryState(),
      companions: this.story.createCompanions(),
      facility_levels: this.story.createFacilityLevels(),
      battle: null,
      pending_exploration: null,
      ending: null,
      turn_number: 0,
      survival_days: defaults.survival_days,
      communication_log: structuredClone(defaults.communication_log),
      weekly_archives: structuredClone(defaults.weekly_archives),
      checkpoint: structuredClone(defaults.checkpoint),
      inventory: structuredClone(defaults.inventory),
      research: structuredClone(defaults.research),
      expedition: structuredClone(defaults.expedition),
    };
    const opening = mode === "multiplayer"
      ? this.content.text("multiplayer_started", { player_names: cleanNames.join("、") })
      : mode === "story"
        ? this.content.text("story_mode_started", { player_name: cleanNames[0] ?? "" })
        : this.content.text("new_game_started", { player_name: cleanNames[0] ?? "" });
    const messages = [opening, this.content.text("story_started")];
    this.chronicle.record(this.state, messages);
    return actionReport(
      messages,
      true,
    );
  }

  /** 查询主档或任一备份是否存在可尝试读取的数据。 */
  public hasSave(): boolean {
    return this.repository.exists();
  }

  /** 保存包含剧情、战斗和待探索事件的完整状态。 */
  public saveGame(): ActionReport {
    const state = this.requireState();
    this.repository.save(state);
    const key = this.hasActiveBattle(state) ? "battle_saved" : "save_success";
    return actionReport([this.content.text(key)], false);
  }

  /** 读取并校验候选存档，全部成功后才替换当前状态。 */
  public loadGame(): ActionReport {
    const candidate = this.repository.load();
    this.rules.normalize(candidate);
    this.story.status(candidate);
    if (candidate.pending_exploration !== null) {
      this.content.city(candidate.pending_exploration.city_id);
      this.exploration.prompt(candidate.pending_exploration.event_id);
    }
    if (candidate.battle !== null) {
      this.content.boss(candidate.battle.boss_id);
      if (!candidate.battle.finished) this.combat.availableActions(candidate);
    }
    this.state = candidate;
    return actionReport(
      [this.content.text("load_success")],
      true,
      isEnded(candidate),
    );
  }

  /** 返回当前章节、任务目标和主线进度。 */
  public storyStatus(): StoryStatus {
    return this.story.status(this.requireState());
  }

  /** 返回当前剧情场景；游戏结束或主线完成时返回 null。 */
  public currentStoryPrompt(): StoryPrompt | null {
    return this.story.currentPrompt(this.requireState());
  }

  /** 原子结算一个剧情选择，并按需启动配置化首领战。 */
  public resolveStoryChoice(sceneId: string, choiceId: string): ActionReport {
    const current = this.requireFreePlayableState();
    const working = cloneGameState(current);
    const resolution = this.story.resolveChoice(working, sceneId, choiceId);
    if (!resolution.applied) {
      return actionReport(resolution.messages, false);
    }
    const messages = [...resolution.messages];
    if (resolution.bossId !== null) {
      const startingHealth = this.story.bossStartingHealthPercent(
        working,
        resolution.bossId,
      );
      const combatReport = this.combat.start(working, resolution.bossId, startingHealth);
      messages.push(...combatReport.messages);
      this.chronicle.record(working, messages);
      this.storeState(working);
      return actionReport(messages, true);
    }
    return this.commitAction(working, messages, {
      consumesTurn: resolution.consumesTurn,
      actionType: "story",
    });
  }

  /** 返回当前首领战所有行动的实时可用状态。 */
  public combatActions(): readonly CombatAction[] {
    return this.combat.availableActions(this.requireState());
  }

  /** 结算一个战斗回合，并处理胜利推进、撤退或战败终局。 */
  public performCombatAction(actionId: string): ActionReport {
    const current = this.requirePlayableState();
    if (!this.hasActiveBattle(current) || current.battle === null) {
      throw new GameApplicationError(this.content.text("battle_not_active"));
    }
    const working = cloneGameState(current);
    const bossId = working.battle?.boss_id;
    if (bossId === undefined) {
      throw new GameApplicationError(this.content.text("battle_state_incomplete"));
    }
    const report = this.combat.performAction(working, actionId);
    const messages = [...report.messages];
    if (!report.stateChanged) {
      return actionReport(messages, false);
    }
    if (!report.finished) {
      this.rules.normalize(working);
      this.chronicle.record(working, messages);
      this.storeState(working);
      return actionReport(messages, true);
    }
    if (report.victory) {
      const storyReport = this.story.completeBoss(working, bossId);
      messages.push(...storyReport.messages);
      working.battle = null;
      return this.commitAction(
        working,
        messages,
        {
          consumesTurn: storyReport.consumesTurn,
          rotatePlayer: false,
          actionType: "combat",
        },
      );
    }
    if (report.retreated) {
      this.story.abandonBossRoute(working, bossId);
      return this.commitAction(working, messages, {
        consumesTurn: true,
        rotatePlayer: false,
        actionType: "combat",
      });
    }
    working.battle = null;
    working.pending_exploration = null;
    const fallenPlayer = working.players.reduce((fallen, player) => (
      player.health < fallen.health ? player : fallen
    ));
    working.ending = this.rules.combatFailure(fallenPlayer.name, working.mode);
    if (messages[messages.length - 1] !== working.ending.message) {
      messages.push(working.ending.message);
    }
    this.chronicle.record(working, messages);
    this.storeState(working);
    return actionReport(messages, true, true);
  }

  /** 返回汇总既有资源、制作物并排除已装备物的仓库清单。 */
  public warehouseItems(): readonly WarehouseItemView[] {
    return this.inventory.items(this.requireState());
  }

  /** 返回指定所长计入当前武器与防具后的有效战斗属性。 */
  public effectivePlayerAttributes(
    playerIndex: number = this.requireState().active_player_index,
  ): EffectivePlayerAttributes {
    return this.equipment.effectiveAttributes(this.requireState(), playerIndex);
  }

  /** 返回全部研发项目及其实时解锁、材料状态。 */
  public researchProjects(): readonly ResearchProjectView[] {
    return this.researchCrafting.researchProjects(this.requireState());
  }

  /** 返回全部制作配方及其实时解锁、材料状态。 */
  public craftingRecipes(): readonly CraftingRecipeView[] {
    return this.researchCrafting.craftingRecipes(this.requireState());
  }

  /** 返回当前可加入远征的伙伴及其词条步数。 */
  public expeditionCompanions(): readonly ExpeditionCompanionView[] {
    return this.expedition.companionOptions(this.requireState());
  }

  /** 返回出发前可选择携带的仓库物资。 */
  public expeditionCarryItems(): readonly ExpeditionCarryItemView[] {
    return this.expedition.carryItemOptions(this.requireState());
  }

  /** 返回当前远征步数、队伍、携带物和战利品摘要。 */
  public expeditionStatus(): ExpeditionStatusView | null {
    return this.expedition.status(this.requireState());
  }

  /** 返回按周持久化的历史通讯记录。 */
  public weeklyArchives(): readonly WeeklyArchiveState[] {
    return structuredClone(this.requireState().weekly_archives);
  }

  /** 原子完成一项研发，并按配置消耗对应世界回合。 */
  public completeResearch(projectId: string): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const resolution = this.researchCrafting.completeResearch(working, projectId);
    if (!resolution.applied) {
      return actionReport(resolution.messages, false);
    }
    return this.commitAction(working, [...resolution.messages], {
      consumesTurn: resolution.turnsConsumed > 0,
      turnsConsumed: resolution.turnsConsumed,
      actionType: "research",
    });
  }

  /** 原子制作一份配置化道具，并按配方消耗世界回合。 */
  public craftItem(recipeId: string): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const resolution = this.researchCrafting.craft(working, recipeId);
    if (!resolution.applied) {
      return actionReport(resolution.messages, false);
    }
    return this.commitAction(working, [...resolution.messages], {
      consumesTurn: resolution.turnsConsumed > 0,
      turnsConsumed: resolution.turnsConsumed,
      actionType: "crafting",
    });
  }

  /** 装备一件制作武器或防具，不额外推进世界时间。 */
  public equipItem(itemId: string): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const resolution = this.inventory.equip(working, itemId);
    return this.commitAction(working, [...resolution.messages], {
      consumesTurn: false,
      actionType: "equipment",
    });
  }

  /** 保存出发队伍与携带物，并立即锁定本次远征的首个事件。 */
  public prepareExpedition(
    cityId: string,
    companionIds: readonly string[],
    carriedItems: Readonly<Record<string, number>>,
  ): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const preparation = this.expedition.prepare(
      working,
      cityId,
      companionIds,
      carriedItems,
    );
    if (!preparation.applied) {
      return actionReport(preparation.messages, false);
    }
    const event = this.prepareNextExpeditionEvent(working);
    return this.commitAction(
      working,
      [...preparation.messages, ...event.messages],
      { consumesTurn: false, actionType: "exploration" },
    );
  }

  /** 在剩余步数允许时继续探索，不足时由远征服务强制返程。 */
  public continueExpedition(): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const event = this.prepareNextExpeditionEvent(working);
    return this.commitAction(working, [...event.messages], {
      consumesTurn: false,
      actionType: "exploration",
    });
  }

  /** 在尚有步数时沿标记路线安全返回避难所。 */
  public returnExpeditionSafely(): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const resolution = this.expedition.safeReturn(working);
    return this.commitAction(working, [...resolution.messages], {
      consumesTurn: false,
      actionType: "exploration",
    });
  }

  /** 抽取并持久化城市事件；已有待处理事件时绝不重新抽取。 */
  public prepareExploration(cityId: string): EventPrompt {
    const state = this.requirePlayableState();
    if (this.hasActiveBattle(state)) {
      throw new GameApplicationError(this.content.text("battle_in_progress"));
    }
    const existingPending = state.pending_exploration;
    if (existingPending !== null) {
      return this.exploration.prompt(existingPending.event_id);
    }
    if (state.expedition === null) {
      const preparation = this.expedition.prepare(state, cityId, [], {});
      this.chronicle.record(state, preparation.messages);
    }
    const event = this.prepareNextExpeditionEvent(state);
    this.chronicle.record(state, event.messages);
    const pending = this.requirePendingExploration(state);
    return this.exploration.prompt(pending.event_id);
  }

  /** 结算已经锁定的探索事件并推进一个有效世界回合。 */
  public resolveExploration(
    eventId: string,
    choiceId: string | null = null,
  ): ActionReport {
    const current = this.requirePlayableState();
    const pending = current.pending_exploration;
    if (pending === null) {
      throw new GameApplicationError(this.content.text("no_pending_event"));
    }
    if (pending.event_id !== eventId) {
      throw new GameApplicationError(this.content.text("pending_event_mismatch", {
        expected: pending.event_id,
        actual: eventId,
      }));
    }
    const working = cloneGameState(current);
    this.activateExpeditionLeader(working);
    const beforeEvent = cloneGameState(working);
    const resolution = this.exploration.resolve(eventId, choiceId, working);
    if (!resolution.applied) {
      return actionReport([resolution.message], false);
    }
    working.pending_exploration = null;
    const expeditionResolution = working.expedition === null
      ? { messages: [] as readonly string[] }
      : this.expedition.completeEvent(beforeEvent, working);
    return this.commitAction(working, [
      resolution.message,
      ...expeditionResolution.messages,
    ], {
      consumesTurn: true,
      actionType: "exploration",
    });
  }

  /** 应用探索开场代价、清除待处理事件并消耗一次行动。 */
  public cancelExploration(): ActionReport {
    const current = this.requirePlayableState();
    const pending = current.pending_exploration;
    if (pending === null) {
      throw new GameApplicationError(this.content.text("no_pending_event"));
    }
    const working = cloneGameState(current);
    this.activateExpeditionLeader(working);
    const messages: string[] = [];
    const prelude = this.exploration.applyPrelude(pending.event_id, working);
    if (prelude !== null) messages.push(prelude);
    messages.push(this.content.text("exploration_abandoned"));
    working.pending_exploration = null;
    if (working.expedition !== null) {
      messages.push(...this.expedition.safeReturn(working).messages);
    }
    return this.commitAction(working, messages, {
      consumesTurn: true,
      actionType: "exploration",
    });
  }

  /** 返回设施、工作、交易和招募项目的实时可用状态。 */
  public managementOptions(): readonly ManagementOption[] {
    return this.shelter.options(this.requireFreePlayableState());
  }

  /** 返回人口、设施等级与当前可执行计划总览。 */
  public shelterOverview(): string {
    return this.shelter.overview(this.requireState());
  }

  /** 返回所有伙伴的身份、状态、信任与秘密提示。 */
  public companionSummary(): string {
    return this.story.companionSummary(this.requireState());
  }

  /** 原子执行设施、工作、交易或招募命令。 */
  public performManagement(
    category: ManagementCategory,
    optionId: string,
  ): ActionReport {
    const current = this.requireFreePlayableState();
    const working = cloneGameState(current);
    const resolution = this.shelter.perform(working, category, optionId);
    if (!resolution.applied) {
      return actionReport(resolution.messages, false);
    }
    return this.commitAction(
      working,
      [...resolution.messages],
      {
        consumesTurn: resolution.consumesTurn,
        rotatePlayer: true,
        turnsConsumed: resolution.turnsConsumed,
        actionType: category,
      },
    );
  }

  /** 执行进食、治疗、群体供餐或修复四类基础行动。 */
  public performAction(actionId: string): ActionReport {
    switch (actionId) {
      case "use_food": return this.useFood();
      case "use_medicine": return this.useMedicine();
      case "feed_shelter": return this.feedShelter();
      case "repair_shelter": return this.repairShelter();
      default:
        throw new GameApplicationError(this.content.text("unknown_action", { action_id: actionId }));
    }
  }

  /** 恢复最新十日检查点；尚未建立时保持状态不变。 */
  public rollbackToCheckpoint(): ActionReport {
    const current = this.requireState();
    const resolution = this.chronicle.rollback(current);
    if (resolution === null) {
      return actionReport([this.content.text("checkpoint_rollback_unavailable", {
        required_days: this.content.game.rules.timeline.checkpoint_interval_days,
      })], false, isEnded(current));
    }
    this.storeState(resolution.state);
    return actionReport([resolution.message], true, isEnded(resolution.state));
  }

  /** 返回已持久的当前通讯文本，菜单态返回空列表。 */
  public communicationMessages(): readonly string[] {
    return this.state === null ? [] : this.chronicle.messages(this.state);
  }

  /** 配置化消耗个人食物并降低当前所长饥饿值。 */
  private useFood(): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const item = this.content.game.rules.items.player_food;
    const player = activePlayer(working);
    const cost = this.adjustedFoodCost(item.cost, working);
    if (player.hunger <= 0) {
      return actionReport([
        this.content.text("food_not_needed", { player_name: player.name }),
      ], false);
    }
    if (player.food < cost) {
      return actionReport([this.content.text("food_failed", { cost })], false);
    }
    player.food -= cost;
    const before = player.hunger;
    const reduction = item.hunger_reduction
      + this.shelter.passiveModifier(working, "rules.player_food_hunger_reduction");
    player.hunger = Math.max(0, player.hunger - reduction);
    return this.commitAction(working, [this.content.text("food_success", {
      cost,
      reduced: before - player.hunger,
    })], { consumesTurn: true, actionType: "use_food" });
  }

  /** 配置化消耗医疗用品并随机治疗当前所长。 */
  private useMedicine(): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const item = this.content.game.rules.items.medical_supplies;
    const player = activePlayer(working);
    if (player.health >= this.rules.limits.player_max_health) {
      return actionReport([
        this.content.text("medicine_not_needed", { player_name: player.name }),
      ], false);
    }
    if (player.medical_supplies < item.cost) {
      return actionReport([
        this.content.text("medicine_failed", { cost: item.cost }),
      ], false);
    }
    player.medical_supplies -= item.cost;
    const before = player.health;
    const rolled = this.random.randint(item.heal_min, item.heal_max);
    const healPercent = 100
      + this.shelter.passiveModifier(working, "rules.medicine_heal_percent");
    player.health = Math.min(
      this.rules.limits.player_max_health,
      player.health + Math.floor((rolled * healPercent) / 100),
    );
    return this.commitAction(working, [this.content.text("medicine_success", {
      cost: item.cost,
      healed: player.health - before,
    })], { consumesTurn: true, actionType: "use_medicine" });
  }

  /** 消耗当前所长食物并降低共享群体饥饿值。 */
  private feedShelter(): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const item = this.content.game.rules.items.shelter_food;
    const player = activePlayer(working);
    const cost = this.adjustedFoodCost(item.cost, working);
    if (working.shelter.group_hunger <= 0) {
      return actionReport([this.content.text("shelter_food_not_needed")], false);
    }
    if (player.food < cost) {
      return actionReport([
        this.content.text("shelter_food_failed", { cost }),
      ], false);
    }
    player.food -= cost;
    const before = working.shelter.group_hunger;
    const reduction = item.group_hunger_reduction
      + this.shelter.passiveModifier(working, "rules.shelter_food_hunger_reduction");
    working.shelter.group_hunger = Math.max(0, before - reduction);
    return this.commitAction(working, [this.content.text("shelter_food_success", {
      cost,
      reduced: before - working.shelter.group_hunger,
    })], { consumesTurn: true, actionType: "feed_shelter" });
  }

  /** 消耗零件并按被动加成修复共享避难所耐久。 */
  private repairShelter(): ActionReport {
    const working = cloneGameState(this.requireFreePlayableState());
    const item = this.content.game.rules.items.shelter_repair;
    const player = activePlayer(working);
    if (working.shelter.health >= this.rules.limits.shelter_max_health) {
      return actionReport([this.content.text("repair_not_needed")], false);
    }
    if (player.parts < item.parts_cost) {
      return actionReport([
        this.content.text("repair_failed", { cost: item.parts_cost }),
      ], false);
    }
    player.parts -= item.parts_cost;
    const before = working.shelter.health;
    const restore = item.health_restore
      + this.shelter.passiveModifier(working, "rules.repair_health_restore");
    working.shelter.health = Math.min(
      this.rules.limits.shelter_max_health,
      working.shelter.health + restore,
    );
    return this.commitAction(working, [this.content.text("repair_success", {
      cost: item.parts_cost,
      restored: working.shelter.health - before,
    })], { consumesTurn: true, actionType: "repair_shelter" });
  }

  /** 扣除远征步数并锁定下一事件；步数不足时只返回强制返程报告。 */
  private prepareNextExpeditionEvent(
    state: GameState,
  ): { readonly messages: readonly string[] } {
    const stepResolution = this.expedition.spendEventSteps(state);
    const status = this.expedition.status(state);
    if (status === null) {
      return { messages: stepResolution.messages };
    }
    const prompt = this.exploration.prepare(status.cityId, {
      discovery: this.shelter.passiveModifier(
        state,
        "rules.discovery_weight_percent",
      ),
      ambush: this.shelter.passiveModifier(state, "rules.ambush_weight_percent"),
    });
    state.pending_exploration = {
      city_id: status.cityId,
      event_id: prompt.eventId,
    };
    return {
      messages: [
        ...stepResolution.messages,
        this.content.text("exploration_prepared_log", {
          title: prompt.title,
          intro: prompt.intro,
        }),
      ],
    };
  }

  /** 完成钳制、生存回合、失败清理和一次性状态提交。 */
  private commitAction(
    working: GameState,
    messages: string[],
    options: CommitActionOptions,
  ): ActionReport {
    this.rules.normalize(working);
    this.chronicle.record(working, messages);
    if (options.consumesTurn && !isEnded(working)) {
      messages.push(...this.rules.advanceTurn(
        working,
        options.rotatePlayer ?? true,
        options.turnsConsumed ?? 1,
        options.actionType,
      ));
    }
    if (isEnded(working)) {
      working.pending_exploration = null;
      working.battle = null;
    }
    this.storeState(working);
    return actionReport(messages, true, isEnded(working));
  }

  /** 按配置化被动百分比调整食物成本，且至少消耗一份。 */
  private adjustedFoodCost(baseCost: number, state: GameState): number {
    const modifier = this.shelter.passiveModifier(state, "rules.food_cost_percent");
    return Math.max(1, Math.floor((baseCost * (100 + modifier)) / 100));
  }

  /** 一次替换全部聚合字段，同时保留外部持有的状态对象引用。 */
  private storeState(source: GameState): void {
    if (this.state === null) {
      this.state = source;
      return;
    }
    this.state.mode = source.mode;
    this.state.players = source.players;
    this.state.active_player_index = source.active_player_index;
    this.state.shelter = source.shelter;
    this.state.clock = source.clock;
    this.state.story = source.story;
    this.state.companions = source.companions;
    this.state.facility_levels = source.facility_levels;
    this.state.battle = source.battle;
    this.state.pending_exploration = source.pending_exploration;
    this.state.ending = source.ending;
    this.state.turn_number = source.turn_number;
    this.state.survival_days = source.survival_days;
    this.state.communication_log = source.communication_log;
    this.state.weekly_archives = source.weekly_archives;
    this.state.checkpoint = source.checkpoint;
    this.state.inventory = source.inventory;
    this.state.research = source.research;
    this.state.expedition = source.expedition;
  }

  /** 返回当前状态；尚未开局时抛出可展示错误。 */
  private requireState(): GameState {
    if (this.state === null) {
      throw new GameApplicationError(this.content.text("game_not_started"));
    }
    return this.state;
  }

  /** 返回已经持久化的待探索事件，缺失时抛出统一的可展示错误。 */
  private requirePendingExploration(state: GameState): PendingExplorationState {
    const pending = state.pending_exploration;
    if (pending === null) {
      throw new GameApplicationError(this.content.text("no_pending_event"));
    }
    return pending;
  }

  /** 远征事件始终由出发时锁定的所长结算，避免多人轮换错领奖励。 */
  private activateExpeditionLeader(state: GameState): void {
    const leaderPlayerIndex = state.expedition?.leader_player_index;
    if (leaderPlayerIndex === undefined) {
      return;
    }
    if (!Number.isInteger(leaderPlayerIndex) || state.players[leaderPlayerIndex] === undefined) {
      throw new GameApplicationError(this.content.text("expedition_leader_invalid"));
    }
    state.active_player_index = leaderPlayerIndex;
  }

  /** 返回未结束状态，结局后拒绝继续修改玩法数据。 */
  private requirePlayableState(): GameState {
    const state = this.requireState();
    if (isEnded(state)) {
      throw new GameApplicationError(this.content.text("game_already_over"));
    }
    return state;
  }

  /** 要求没有战斗或待探索事件阻塞的自由行动状态。 */
  private requireFreePlayableState(): GameState {
    const state = this.requirePlayableState();
    if (this.hasActiveBattle(state)) {
      throw new GameApplicationError(this.content.text("battle_in_progress"));
    }
    if (state.pending_exploration !== null) {
      throw new GameApplicationError(this.content.text("pending_event_must_resolve"));
    }
    return state;
  }

  /** 判断状态中是否存在尚未结束的首领战。 */
  private hasActiveBattle(state: GameState): boolean {
    return state.battle !== null && !state.battle.finished;
  }
}
