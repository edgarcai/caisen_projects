import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import {
  cloneGameState,
  findCompanion,
  type GameState,
} from "../domain/game-state";
import type { RandomSource } from "../domain/ports";
import type {
  ExpeditionCarryItemView,
  ExpeditionCompanionView,
  ExpeditionStatusView,
  SurvivalSystemResolution,
  SurvivalSystemsConfigDocument,
} from "../domain/survival-systems";
import type { GameContent } from "./GameContent";
import type { CampaignProfileService } from "./CampaignProfileService";
import type {
  CityAccessDecision,
  CityAccessService,
} from "./CityAccessService";
import type { InventoryService } from "./InventoryService";
import type { ResearchCraftingService } from "./ResearchCraftingService";
import type { StateOperations } from "./StateOperations";

/** 编排远征队伍、携带物、步数、战利品和强制返程惩罚。 */
export class ExpeditionService {
  private readonly config: SurvivalSystemsConfigDocument;
  private readonly content: GameContent;
  private readonly inventory: InventoryService;
  private readonly research: ResearchCraftingService;
  private readonly cityAccess: CityAccessService;
  private readonly campaignProfiles: CampaignProfileService;
  private readonly operations: StateOperations;
  private readonly random: RandomSource;

  /** 注入内容、库存、研发、城市通行、开局档案、状态读写与随机源。 */
  public constructor(
    config: SurvivalSystemsConfigDocument,
    content: GameContent,
    inventory: InventoryService,
    research: ResearchCraftingService,
    cityAccess: CityAccessService,
    campaignProfiles: CampaignProfileService,
    operations: StateOperations,
    random: RandomSource,
  ) {
    this.config = config;
    this.content = content;
    this.inventory = inventory;
    this.research = research;
    this.cityAccess = cityAccess;
    this.campaignProfiles = campaignProfiles;
    this.operations = operations;
    this.random = random;
  }

  /** 返回全部城市当前的拓扑、情报、路径与载具通行判定。 */
  public cityOptions(state: GameState): readonly CityAccessDecision[] {
    return this.content.game.cities.map((city) =>
      this.cityAccess.evaluate(state, city.id),
    );
  }

  /** 返回当前可加入远征的伙伴及其技能步数加成。 */
  public companionOptions(state: GameState): readonly ExpeditionCompanionView[] {
    return this.config.expedition.companion_step_bonuses.flatMap((bonus) => {
      const companion = findCompanion(state, bonus.companion_id);
      if (companion === undefined || companion.status !== "active") {
        return [];
      }
      const profile = this.content.story.companions.find(
        (candidate) => candidate.companion_id === bonus.companion_id,
      );
      if (profile === undefined) {
        return [];
      }
      return [{
        companionId: companion.companion_id,
        name: profile.name,
        traitName: bonus.trait_name,
        trust: companion.trust,
        stepBonus: this.companionStepBonus(companion.trust, bonus.companion_id),
      }];
    });
  }

  /** 返回当前仓库中可在出发前选择携带的物品。 */
  public carryItemOptions(state: GameState): readonly ExpeditionCarryItemView[] {
    return this.inventory.carryableItems(state, state.active_player_index).map((item) => ({
      itemId: item.itemId,
      name: item.name,
      availableQuantity: item.quantity,
      stepBonusPerUnit:
        this.config.expedition.carried_item_step_bonuses[item.itemId] ?? 0,
    }));
  }

  /** 校验远征准备并原子保存队伍、携带物与最大步数。 */
  public prepare(
    state: GameState,
    cityId: string,
    companionIds: readonly string[],
    carriedItems: Readonly<Record<string, number>>,
  ): SurvivalSystemResolution {
    const access = this.cityAccess.evaluate(state, cityId);
    if (!access.accessible) {
      return {
        applied: false,
        messages: [access.reason],
        turnsConsumed: 0,
      };
    }
    if (state.expedition !== null) {
      return {
        applied: false,
        messages: [this.config.expedition.selection_invalid_text],
        turnsConsumed: 0,
      };
    }
    const leaderPlayerIndex = state.active_player_index;
    if (!this.selectionValid(state, companionIds, carriedItems, leaderPlayerIndex)) {
      return {
        applied: false,
        messages: [this.config.expedition.selection_invalid_text],
        turnsConsumed: 0,
      };
    }
    const maximumSteps = this.maximumSteps(state, companionIds, carriedItems);
    if (maximumSteps < access.travelStepCost) {
      return {
        applied: false,
        messages: [this.content.text("expedition_travel_steps_insufficient", {
          required: access.travelStepCost,
          maximum: maximumSteps,
        })],
        turnsConsumed: 0,
      };
    }
    const working = cloneGameState(state);
    this.inventory.withdraw(working, carriedItems, leaderPlayerIndex);
    working.expedition = {
      city_id: cityId,
      travel_step_cost: access.travelStepCost,
      leader_player_index: leaderPlayerIndex,
      companion_ids: [...companionIds],
      carried_items: { ...carriedItems },
      loot: {},
      remaining_steps: maximumSteps - access.travelStepCost,
      maximum_steps: maximumSteps,
      events_resolved: 0,
    };
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.expedition.prepared_text, {
        maximum_steps: maximumSteps,
        travel_steps: access.travelStepCost,
        remaining_steps: maximumSteps - access.travelStepCost,
        companion_count: companionIds.length,
        carried_units: Object.values(carriedItems).reduce(
          (sum, quantity) => sum + quantity,
          0,
        ),
      })],
      turnsConsumed: 0,
    };
  }

  /** 在抽取下一事件前扣除城市步数；不足时立即执行强制返程。 */
  public spendEventSteps(state: GameState): SurvivalSystemResolution {
    const current = this.requireExpedition(state);
    const cityCost = this.config.expedition.city_step_costs[current.city_id];
    if (cityCost === undefined) {
      throw new GameApplicationError(this.config.expedition.selection_invalid_text);
    }
    const spentSteps = this.config.expedition.event_step_cost + cityCost;
    if (current.remaining_steps < spentSteps) {
      return this.forceReturn(state);
    }
    const working = cloneGameState(state);
    const expedition = this.requireExpedition(working);
    expedition.remaining_steps -= spentSteps;
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.expedition.step_text, {
        spent_steps: spentSteps,
        remaining_steps: expedition.remaining_steps,
        maximum_steps: expedition.maximum_steps,
      })],
      turnsConsumed: 0,
    };
  }

  /** 记录本次事件的正向物资增量并在步数归零时强制返程。 */
  public completeEvent(before: GameState, state: GameState): SurvivalSystemResolution {
    const working = cloneGameState(state);
    const expedition = this.requireExpedition(working);
    const leaderPlayerIndex = this.leaderPlayerIndex(working, expedition.leader_player_index);
    for (const target of this.config.expedition.loot_targets) {
      const current = this.operations.read(
        target.state_target,
        working,
        leaderPlayerIndex,
      );
      const gained = Math.max(
        0,
        current - this.operations.read(
          target.state_target,
          before,
          leaderPlayerIndex,
        ),
      );
      if (gained > 0) {
        this.operations.write(
          target.state_target,
          current - gained,
          working,
          leaderPlayerIndex,
        );
        expedition.loot[target.item_id] =
          (expedition.loot[target.item_id] ?? 0) + gained;
      }
    }
    expedition.events_resolved += 1;
    if (expedition.remaining_steps <= 0) {
      const resolution = this.forceReturn(working);
      this.commit(working, state);
      return resolution;
    }
    this.commit(working, state);
    return { applied: true, messages: [], turnsConsumed: 0 };
  }

  /** 沿已标记路线安全返回并清除本次远征上下文。 */
  public safeReturn(state: GameState): SurvivalSystemResolution {
    const current = this.requireExpedition(state);
    if (state.pending_exploration !== null) {
      throw new GameApplicationError(this.config.expedition.selection_invalid_text);
    }
    const working = cloneGameState(state);
    const expedition = this.requireExpedition(working);
    const leaderPlayerIndex = this.leaderPlayerIndex(
      working,
      current.leader_player_index,
    );
    this.inventory.deposit(working, expedition.carried_items, leaderPlayerIndex);
    this.inventory.deposit(working, expedition.loot, leaderPlayerIndex);
    working.expedition = null;
    this.commit(working, state);
    return {
      applied: true,
      messages: [this.config.expedition.safe_return_text],
      turnsConsumed: 0,
    };
  }

  /** 仅保留配置比例的全部远征物资，并把所长生命设置到配置区间。 */
  public forceReturn(state: GameState): SurvivalSystemResolution {
    const current = this.requireExpedition(state);
    const [minimumHealth, maximumHealth] =
      this.config.expedition.forced_return_health_range;
    const rolledHealth = this.random.randint(minimumHealth, maximumHealth);
    const working = cloneGameState(state);
    const expedition = this.requireExpedition(working);
    const leaderPlayerIndex = this.leaderPlayerIndex(
      working,
      current.leader_player_index,
    );
    const keepPercent = this.config.expedition.forced_return_keep_percent;
    const expeditionSupplies = this.mergeQuantities(
      expedition.carried_items,
      expedition.loot,
    );
    const keptSupplies = this.keepPercent(expeditionSupplies, keepPercent);
    this.inventory.deposit(working, keptSupplies, leaderPlayerIndex);
    const leader = working.players[leaderPlayerIndex];
    if (leader === undefined) {
      throw new GameApplicationError(this.config.expedition.selection_invalid_text);
    }
    const health = rolledHealth;
    leader.health = health;
    working.pending_exploration = null;
    working.expedition = null;
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.expedition.forced_return_text, {
        kept_percent: keepPercent,
        health,
      })],
      turnsConsumed: 0,
    };
  }

  /** 返回当前远征的只读摘要。 */
  public status(state: GameState): ExpeditionStatusView | null {
    const expedition = state.expedition;
    if (expedition === null) {
      return null;
    }
    const itemIds = [
      ...Object.keys(expedition.carried_items),
      ...Object.keys(expedition.loot),
    ];
    return {
      cityId: expedition.city_id,
      travelStepCost: expedition.travel_step_cost,
      leaderPlayerIndex: expedition.leader_player_index,
      remainingSteps: expedition.remaining_steps,
      maximumSteps: expedition.maximum_steps,
      eventsResolved: expedition.events_resolved,
      companionIds: [...expedition.companion_ids],
      carriedItems: { ...expedition.carried_items },
      loot: { ...expedition.loot },
      itemNames: this.inventory.itemNames(itemIds),
    };
  }

  /** 合并多个物资池中相同物品的数量，确保返程比例按总量结算。 */
  private mergeQuantities(
    ...quantityPools: readonly Readonly<Record<string, number>>[]
  ): Readonly<Record<string, number>> {
    const merged: Record<string, number> = {};
    for (const pool of quantityPools) {
      for (const [itemId, quantity] of Object.entries(pool)) {
        merged[itemId] = (merged[itemId] ?? 0) + quantity;
      }
    }
    return merged;
  }

  /** 按配置百分比向下取整得到强制返程后实际保住的物资。 */
  private keepPercent(
    quantities: Readonly<Record<string, number>>,
    percent: number,
  ): Readonly<Record<string, number>> {
    return Object.fromEntries(Object.entries(quantities).map(
      ([itemId, quantity]) => [itemId, Math.floor((quantity * percent) / 100)],
    ));
  }

  /** 计算基础、研发、伙伴词条和携带物共同提供的最大步数。 */
  private maximumSteps(
    state: GameState,
    companionIds: readonly string[],
    carriedItems: Readonly<Record<string, number>>,
  ): number {
    const companionSteps = companionIds.reduce((sum, companionId) => {
      const companion = findCompanion(state, companionId);
      return sum + this.companionStepBonus(companion?.trust ?? 0, companionId);
    }, 0);
    const carriedSteps = Object.entries(carriedItems).reduce(
      (sum, [itemId, quantity]) => sum
        + (this.config.expedition.carried_item_step_bonuses[itemId] ?? 0) * quantity,
      0,
    );
    return this.config.expedition.base_steps
      + this.research.expeditionStepBonus(state)
      + this.campaignProfiles.expeditionStepBonus(state)
      + companionSteps
      + carriedSteps;
  }

  /** 按伙伴基础词条和已达到的信任阈值计算步数。 */
  private companionStepBonus(trust: number, companionId: string): number {
    const config = this.config.expedition.companion_step_bonuses.find(
      (candidate) => candidate.companion_id === companionId,
    );
    if (config === undefined) {
      return 0;
    }
    return config.base_steps + config.trust_thresholds
      .filter((threshold) => trust >= threshold.trust)
      .reduce((sum, threshold) => sum + threshold.steps, 0);
  }

  /** 验证伙伴唯一性、同行上限、可用库存和携带容量。 */
  private selectionValid(
    state: GameState,
    companionIds: readonly string[],
    carriedItems: Readonly<Record<string, number>>,
    playerIndex: number,
  ): boolean {
    if (
      new Set(companionIds).size !== companionIds.length
      || companionIds.length > this.config.expedition.maximum_companions
    ) {
      return false;
    }
    const companionOptions = new Set(
      this.companionOptions(state).map((option) => option.companionId),
    );
    if (companionIds.some((companionId) => !companionOptions.has(companionId))) {
      return false;
    }
    const carriedEntries = Object.entries(carriedItems);
    if (carriedEntries.length > this.config.expedition.maximum_carried_item_types) {
      return false;
    }
    const carryableIds = new Set(
      this.inventory.carryableItems(state, playerIndex).map((item) => item.itemId),
    );
    let carriedUnits = 0;
    for (const [itemId, quantity] of carriedEntries) {
      if (
        !Number.isInteger(quantity)
        || quantity <= 0
        || !carryableIds.has(itemId)
        || quantity > this.inventory.availableQuantity(state, itemId, playerIndex)
      ) {
        return false;
      }
      carriedUnits += quantity;
    }
    return carriedUnits <= this.config.expedition.maximum_carried_units;
  }

  /** 要求当前存在远征上下文。 */
  private requireExpedition(state: GameState): NonNullable<GameState["expedition"]> {
    if (state.expedition === null) {
      throw new GameApplicationError(this.config.expedition.no_active_text);
    }
    return state.expedition;
  }

  /** 校验远征绑定所长索引，防止多人轮换后结算到错误角色。 */
  private leaderPlayerIndex(state: GameState, playerIndex: number): number {
    if (!Number.isInteger(playerIndex) || state.players[playerIndex] === undefined) {
      throw new GameApplicationError(this.config.expedition.selection_invalid_text);
    }
    return playerIndex;
  }

  /** 一次提交远征托管涉及的玩家、共享资源、库存与探索状态。 */
  private commit(source: GameState, target: GameState): void {
    target.players = source.players;
    target.shelter = source.shelter;
    target.inventory = source.inventory;
    target.pending_exploration = source.pending_exploration;
    target.expedition = source.expedition;
  }
}
