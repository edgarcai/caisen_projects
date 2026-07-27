import { GameApplicationError } from "../domain/errors";
import { formatTemplate } from "../domain/content";
import { cloneGameState, type GameState } from "../domain/game-state";
import type {
  CraftedWarehouseItemConfig,
  KeyItemWarehouseConfig,
  ResourceWarehouseItemConfig,
  SurvivalSystemResolution,
  SurvivalSystemsConfigDocument,
  WarehouseItemCatalogEntry,
  WarehouseItemView,
} from "../domain/survival-systems";
import type { StateOperations } from "./StateOperations";

/** 汇总既有资源与制作物，并维护装备不占仓库可用数量的不变量。 */
export class InventoryService {
  private readonly config: SurvivalSystemsConfigDocument;
  private readonly operations: StateOperations;
  private readonly keyItems: readonly KeyItemWarehouseConfig[];
  private readonly itemCatalog: readonly WarehouseItemCatalogEntry[];
  private readonly itemCatalogById: ReadonlyMap<string, WarehouseItemCatalogEntry>;

  /** 注入生存系统配置、状态读写器与剧情关键物品档案。 */
  public constructor(
    config: SurvivalSystemsConfigDocument,
    operations: StateOperations,
    keyItems: readonly KeyItemWarehouseConfig[],
  ) {
    this.config = config;
    this.operations = operations;
    this.keyItems = keyItems;
    this.itemCatalog = this.buildItemCatalog();
    this.itemCatalogById = new Map(
      this.itemCatalog.map((item) => [item.itemId, item]),
    );
  }

  /** 返回不受当前库存和剧情解锁状态影响的完整只读物品目录。 */
  public catalog(): readonly WarehouseItemCatalogEntry[] {
    return this.itemCatalog;
  }

  /** 返回所有实际拥有且尚未装备的仓库物品。 */
  public items(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): readonly WarehouseItemView[] {
    const resourceViews = this.config.warehouse.resource_items.map((item) => ({
      itemId: item.item_id,
      name: item.name,
      category: item.category,
      categoryLabel: this.config.warehouse.category_labels[item.category],
      quantity: this.operations.read(item.state_target, state, playerIndex),
      carryable: item.carryable,
      description: item.description,
    }));
    const craftedViews = this.config.warehouse.crafted_items.map((item) => ({
      itemId: item.item_id,
      name: item.name,
      category: item.category,
      categoryLabel: this.config.warehouse.category_labels[item.category],
      quantity: this.availableCraftedQuantity(state, item),
      carryable: item.carryable,
      description: item.description,
    }));
    const keyItemViews = this.keyItems
      .filter((item) => state.story.key_items.includes(item.item_id))
      .map((item) => ({
        itemId: item.item_id,
        name: item.name,
        category: "key_item" as const,
        categoryLabel: this.config.warehouse.category_labels.key_item,
        quantity: 1,
        carryable: false,
        description: item.description,
      }));
    return [...resourceViews, ...craftedViews, ...keyItemViews]
      .filter((item) => item.quantity > 0);
  }

  /** 返回可在出发前选择携带的非装备物品。 */
  public carryableItems(
    state: GameState,
    playerIndex: number = state.active_player_index,
  ): readonly WarehouseItemView[] {
    return this.items(state, playerIndex).filter((item) => item.carryable);
  }

  /** 返回指定物品当前可从仓库调拨的数量。 */
  public availableQuantity(
    state: GameState,
    itemId: string,
    playerIndex: number = state.active_player_index,
  ): number {
    const resource = this.config.warehouse.resource_items.find(
      (item) => item.item_id === itemId,
    );
    if (resource !== undefined) {
      return this.operations.read(resource.state_target, state, playerIndex);
    }
    const crafted = this.requireCraftedItem(itemId);
    return this.availableCraftedQuantity(state, crafted);
  }

  /** 返回指定物品的总拥有数量，已装备数量也计入其中。 */
  public ownedQuantity(
    state: GameState,
    itemId: string,
    playerIndex: number = state.active_player_index,
  ): number {
    const resource = this.config.warehouse.resource_items.find(
      (item) => item.item_id === itemId,
    );
    if (resource !== undefined) {
      return this.operations.read(resource.state_target, state, playerIndex);
    }
    const crafted = this.requireCraftedItem(itemId);
    return state.inventory.crafted_items[crafted.item_id] ?? 0;
  }

  /** 按稳定物品 ID 返回配置中的持久名称映射，供跨读档读模型使用。 */
  public itemNames(itemIds: readonly string[]): Readonly<Record<string, string>> {
    return Object.fromEntries([...new Set(itemIds)].map((itemId) => {
      const item = this.requireCatalogItem(itemId);
      return [itemId, item.name];
    }));
  }

  /** 从资源、制作物和剧情关键物配置构建一次性目录快照。 */
  private buildItemCatalog(): readonly WarehouseItemCatalogEntry[] {
    const resources = this.config.warehouse.resource_items.map(
      (item): WarehouseItemCatalogEntry => ({
        itemId: item.item_id,
        name: item.name,
        category: item.category,
        categoryLabel: this.config.warehouse.category_labels[item.category],
        carryable: item.carryable,
        description: item.description,
      }),
    );
    const crafted = this.config.warehouse.crafted_items.map(
      (item): WarehouseItemCatalogEntry => ({
        itemId: item.item_id,
        name: item.name,
        category: item.category,
        categoryLabel: this.config.warehouse.category_labels[item.category],
        carryable: item.carryable,
        description: item.description,
      }),
    );
    const keyItems = this.keyItems.map(
      (item): WarehouseItemCatalogEntry => ({
        itemId: item.item_id,
        name: item.name,
        category: "key_item",
        categoryLabel: this.config.warehouse.category_labels.key_item,
        carryable: false,
        description: item.description,
      }),
    );
    return [...resources, ...crafted, ...keyItems];
  }

  /** 按稳定 ID 返回目录项，未知 ID 沿用配置化仓库错误文案。 */
  private requireCatalogItem(itemId: string): WarehouseItemCatalogEntry {
    const item = this.itemCatalogById.get(itemId);
    if (item === undefined) {
      throw new GameApplicationError(formatTemplate(
        this.config.warehouse.unknown_item_text,
        { item_id: itemId },
      ));
    }
    return item;
  }

  /** 原子把一组物资从指定所长的可用仓库转入远征托管区。 */
  public withdraw(
    state: GameState,
    quantities: Readonly<Record<string, number>>,
    playerIndex: number,
  ): void {
    const working = cloneGameState(state);
    for (const [itemId, quantity] of Object.entries(quantities)) {
      this.requireTransferQuantity(itemId, quantity);
      if (this.availableQuantity(working, itemId, playerIndex) < quantity) {
        throw new GameApplicationError(formatTemplate(
          this.config.warehouse.unknown_item_text,
          { item_id: itemId },
        ));
      }
      this.adjustQuantity(working, itemId, -quantity, playerIndex);
    }
    this.commit(working, state);
  }

  /** 原子把远征携带物或托管战利品归还到指定所长的仓库。 */
  public deposit(
    state: GameState,
    quantities: Readonly<Record<string, number>>,
    playerIndex: number,
  ): void {
    const working = cloneGameState(state);
    for (const [itemId, quantity] of Object.entries(quantities)) {
      if (quantity === 0) continue;
      this.requireTransferQuantity(itemId, quantity);
      this.adjustQuantity(working, itemId, quantity, playerIndex);
    }
    this.commit(working, state);
  }

  /** 装备一件武器或防具，并自动把同槽位旧装备放回仓库。 */
  public equip(state: GameState, itemId: string): SurvivalSystemResolution {
    const item = this.requireCraftedItem(itemId);
    if (item.category !== "weapon" && item.category !== "armor") {
      throw new GameApplicationError(formatTemplate(
        this.config.warehouse.invalid_equipment_text,
        { item_name: item.name },
      ));
    }
    if (this.availableCraftedQuantity(state, item) < 1) {
      throw new GameApplicationError(formatTemplate(
        this.config.warehouse.equipment_unavailable_text,
        { item_name: item.name },
      ));
    }
    const working = cloneGameState(state);
    if (item.category === "weapon") {
      working.inventory.equipped_weapon_id = item.item_id;
    } else {
      working.inventory.equipped_armor_id = item.item_id;
    }
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.warehouse.equipped_text, {
        item_name: item.name,
      })],
      turnsConsumed: 0,
    };
  }

  /** 查询制作物总量并扣除所长、伙伴和载具设置占用的同 ID 物品。 */
  private availableCraftedQuantity(
    state: GameState,
    item: CraftedWarehouseItemConfig,
  ): number {
    const total = state.inventory.crafted_items[item.item_id] ?? 0;
    const playerEquipped = [
      state.inventory.equipped_weapon_id,
      state.inventory.equipped_armor_id,
    ].filter((itemId) => itemId === item.item_id).length;
    const companionEquipped = state.companions.reduce((count, companion) =>
      count + [companion.equipped_weapon_id, companion.equipped_armor_id]
        .filter((itemId) => itemId === item.item_id).length, 0);
    const transportEquipped = state.inventory.equipped_transport_ids
      .filter((itemId) => itemId === item.item_id).length;
    return Math.max(
      0,
      total - playerEquipped - companionEquipped - transportEquipped,
    );
  }

  /** 按稳定 ID 返回制作物配置。 */
  private requireCraftedItem(itemId: string): CraftedWarehouseItemConfig {
    const item = this.config.warehouse.crafted_items.find(
      (candidate) => candidate.item_id === itemId,
    );
    if (item === undefined) {
      throw new GameApplicationError(formatTemplate(
        this.config.warehouse.unknown_item_text,
        { item_id: itemId },
      ));
    }
    return item;
  }

  /** 按稳定 ID 返回资源型物品配置，找不到时返回 undefined。 */
  private resourceItem(itemId: string): ResourceWarehouseItemConfig | undefined {
    return this.config.warehouse.resource_items.find(
      (candidate) => candidate.item_id === itemId,
    );
  }

  /** 在工作副本中调整资源型或制作型物品数量。 */
  private adjustQuantity(
    state: GameState,
    itemId: string,
    delta: number,
    playerIndex: number,
  ): void {
    const resource = this.resourceItem(itemId);
    if (resource !== undefined) {
      const current = this.operations.read(resource.state_target, state, playerIndex);
      this.operations.write(resource.state_target, current + delta, state, playerIndex);
      return;
    }
    const crafted = this.requireCraftedItem(itemId);
    const current = state.inventory.crafted_items[crafted.item_id] ?? 0;
    state.inventory.crafted_items[crafted.item_id] = current + delta;
  }

  /** 要求跨仓库转移数量是正整数。 */
  private requireTransferQuantity(itemId: string, quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new GameApplicationError(formatTemplate(
        this.config.warehouse.invalid_transfer_quantity_text,
        { item_id: itemId },
      ));
    }
  }

  /** 原子提交仓库涉及的玩家、共享资源与装备状态。 */
  private commit(source: GameState, target: GameState): void {
    target.players = source.players;
    target.shelter = source.shelter;
    target.archive_collection_totals = source.archive_collection_totals;
    target.inventory = source.inventory;
  }
}
