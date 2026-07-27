import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import {
  cloneGameState,
  findCompanion,
  type ExpeditionLossItemState,
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
import type {
  CityAccessDecision,
  CityAccessService,
} from "./CityAccessService";
import { ExpeditionFoodActionPolicy } from "./ExpeditionFoodActionPolicy";
import type { InventoryService } from "./InventoryService";
import type { StateOperations } from "./StateOperations";

/** 角色在侦察、驻守等其他任务中的统一可用性端口。 */
export interface CharacterAvailabilityPolicy {
  /** 判断一名已拥有角色当前是否可加入远征。 */
  isAvailableForExpedition(state: GameState, companionId: string): boolean;
}

/** 未注入外部派遣系统时的默认可用性策略。 */
const DEFAULT_CHARACTER_AVAILABILITY_POLICY: CharacterAvailabilityPolicy = {
  isAvailableForExpedition: (): boolean => true,
};

/** 编排远征队伍、携带物、食物行动、战利品和强制返程惩罚。 */
export class ExpeditionService {
  private readonly config: SurvivalSystemsConfigDocument;
  private readonly content: GameContent;
  private readonly inventory: InventoryService;
  private readonly cityAccess: CityAccessService;
  private readonly actionPolicy: ExpeditionFoodActionPolicy;
  private readonly operations: StateOperations;
  private readonly random: RandomSource;
  private readonly availabilityPolicy: CharacterAvailabilityPolicy;

  /** 注入内容、库存、城市通行、状态读写与随机源。 */
  public constructor(
    config: SurvivalSystemsConfigDocument,
    content: GameContent,
    inventory: InventoryService,
    cityAccess: CityAccessService,
    operations: StateOperations,
    random: RandomSource,
    availabilityPolicy: CharacterAvailabilityPolicy = DEFAULT_CHARACTER_AVAILABILITY_POLICY,
  ) {
    this.config = config;
    this.content = content;
    this.inventory = inventory;
    this.cityAccess = cityAccess;
    this.actionPolicy = new ExpeditionFoodActionPolicy(config);
    this.operations = operations;
    this.random = random;
    this.availabilityPolicy = availabilityPolicy;
  }

  /** 返回全部城市当前的拓扑、情报、路径与载具通行判定。 */
  public cityOptions(state: GameState): readonly CityAccessDecision[] {
    return this.content.game.cities.map((city) =>
      this.cityAccess.evaluate(state, city.id),
    );
  }

  /** 仅返回已拥有、存活且可加入远征的角色及技能摘要。 */
  public companionOptions(state: GameState): readonly ExpeditionCompanionView[] {
    return this.config.expedition.companion_step_bonuses.flatMap((bonus) => {
      const companion = findCompanion(state, bonus.companion_id);
      if (
        companion === undefined
        || companion.status !== "active"
        || !this.availabilityPolicy.isAvailableForExpedition(
          state,
          bonus.companion_id,
        )
      ) {
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
      stepBonusPerUnit: this.actionPolicy.actionCapacity({ [item.itemId]: 1 }),
    }));
  }

  /** 为旧版直接探索入口选取可携带上限内的全部食物。 */
  public legacyAutomaticFoodCarry(
    state: GameState,
  ): Readonly<Record<string, number>> {
    const foodItemId = this.actionPolicy.actionFoodItemId();
    const availableFood = this.inventory.availableQuantity(
      state,
      foodItemId,
      state.active_player_index,
    );
    const quantity = Math.min(
      availableFood,
      this.config.expedition.maximum_carried_units,
    );
    return quantity > 0 ? { [foodItemId]: quantity } : {};
  }

  /** 返回一次所选区划事件需要消耗的配置化行动数。 */
  public eventStepCost(cityId: string, districtId: string): number {
    return this.config.expedition.event_step_cost
      + this.content.district(cityId, districtId).event_step_cost;
  }

  /** 校验远征准备并原子保存队伍、携带物与食物行动额度。 */
  public prepare(
    state: GameState,
    cityId: string,
    districtId: string,
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
    this.content.district(cityId, districtId);
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
    const maximumActions = this.actionPolicy.actionCapacity(carriedItems);
    if (maximumActions < access.travelStepCost) {
      return {
        applied: false,
        messages: [this.content.text("expedition_travel_steps_insufficient", {
          required: access.travelStepCost,
          available: maximumActions,
        })],
        turnsConsumed: 0,
      };
    }
    const working = cloneGameState(state);
    this.inventory.withdraw(working, carriedItems, leaderPlayerIndex);
    const expedition = {
      city_id: cityId,
      district_id: districtId,
      travel_step_cost: access.travelStepCost,
      leader_player_index: leaderPlayerIndex,
      companion_ids: [...companionIds],
      carried_items: { ...carriedItems },
      loot: {},
      remaining_steps: maximumActions,
      maximum_steps: maximumActions,
      events_resolved: 0,
    };
    if (!this.actionPolicy.spend(expedition, access.travelStepCost)) {
      throw new GameApplicationError(this.config.expedition.selection_invalid_text);
    }
    working.expedition = expedition;
    working.last_expedition_failure = null;
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.expedition.prepared_text, {
        maximum_actions: maximumActions,
        travel_actions: access.travelStepCost,
        remaining_actions: expedition.remaining_steps,
        companion_count: companionIds.length,
        carried_units: Object.values(carriedItems).reduce(
          (sum, quantity) => sum + quantity,
          0,
        ),
      })],
      turnsConsumed: 0,
    };
  }

  /** 在抽取下一事件前扣除区划行动及对应食物；不足时立即强制返程。 */
  public spendEventSteps(state: GameState): SurvivalSystemResolution {
    const current = this.requireExpedition(state);
    const spentSteps = this.eventStepCost(current.city_id, current.district_id);
    if (this.actionPolicy.remainingActions(current) < spentSteps) {
      return this.forceReturn(state);
    }
    const working = cloneGameState(state);
    const expedition = this.requireExpedition(working);
    if (!this.actionPolicy.spend(expedition, spentSteps)) {
      return this.forceReturn(state);
    }
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.expedition.action_text, {
        spent_actions: spentSteps,
        remaining_actions: expedition.remaining_steps,
      })],
      turnsConsumed: 0,
    };
  }

  /** 记录本次事件的正向物资增量并在携带食物用尽时强制返程。 */
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
    if (this.actionPolicy.remainingActions(expedition) <= 0) {
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

  /** 仅保留配置比例的远征物资，并持久化供失败页展示的损失明细。 */
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
    const keptCarriedItems = this.keepPercent(expedition.carried_items, keepPercent);
    const keptLootItems = this.keepPercent(expedition.loot, keepPercent);
    const keptSupplies = this.mergeQuantities(keptCarriedItems, keptLootItems);
    this.inventory.deposit(working, keptSupplies, leaderPlayerIndex);
    const leader = working.players[leaderPlayerIndex];
    if (leader === undefined) {
      throw new GameApplicationError(this.config.expedition.selection_invalid_text);
    }
    const healthBefore = leader.health;
    const health = Math.min(healthBefore, rolledHealth);
    leader.health = health;
    const itemIds = [
      ...Object.keys(expedition.carried_items),
      ...Object.keys(expedition.loot),
    ];
    const itemNames = this.inventory.itemNames(itemIds);
    const lossItems = [
      ...this.lossItems("carried", expedition.carried_items, keptCarriedItems, itemNames),
      ...this.lossItems("loot", expedition.loot, keptLootItems, itemNames),
    ];
    const totalOriginal = lossItems.reduce(
      (sum, item) => sum + item.original_quantity,
      0,
    );
    const totalKept = lossItems.reduce((sum, item) => sum + item.kept_quantity, 0);
    working.last_expedition_failure = {
      reason: "steps_exhausted",
      kept_percent: keepPercent,
      health_before: healthBefore,
      health_after: health,
      total_original: totalOriginal,
      total_kept: totalKept,
      total_lost: totalOriginal - totalKept,
      items: lossItems,
    };
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
      districtId: expedition.district_id,
      travelStepCost: expedition.travel_step_cost,
      leaderPlayerIndex: expedition.leader_player_index,
      remainingSteps: this.actionPolicy.remainingActions(expedition),
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

  /** 将携带物或战利品映射为不合并来源的损失行。 */
  private lossItems(
    source: ExpeditionLossItemState["source"],
    original: Readonly<Record<string, number>>,
    kept: Readonly<Record<string, number>>,
    itemNames: Readonly<Record<string, string>>,
  ): ExpeditionLossItemState[] {
    return Object.entries(original).map(([itemId, originalQuantity]) => {
      const keptQuantity = kept[itemId] ?? 0;
      return {
        source,
        item_id: itemId,
        item_name: itemNames[itemId] ?? itemId,
        original_quantity: originalQuantity,
        kept_quantity: keptQuantity,
        lost_quantity: originalQuantity - keptQuantity,
      };
    });
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

  /** 一次提交远征托管涉及的资源、探索状态与最近失败摘要。 */
  private commit(source: GameState, target: GameState): void {
    target.players = source.players;
    target.shelter = source.shelter;
    target.archive_collection_totals = source.archive_collection_totals;
    target.inventory = source.inventory;
    target.pending_exploration = source.pending_exploration;
    target.expedition = source.expedition;
    target.last_expedition_failure = source.last_expedition_failure;
  }
}
