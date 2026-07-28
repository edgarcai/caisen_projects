import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import { cloneGameState, type GameState } from "../domain/game-state";
import { isWarehouseItemCost } from "../domain/survival-systems";
import type {
  CraftingRecipeConfig,
  CraftingRecipeView,
  CraftedWarehouseItemConfig,
  DiscoverySourceLocationConfig,
  ResearchProjectConfig,
  ResearchProjectView,
  ResearchWorkbenchView,
  ResourceCostConfig,
  ResourceWarehouseItemConfig,
  SurvivalSystemResolution,
  SurvivalSystemsConfigDocument,
} from "../domain/survival-systems";
import type { CampaignDifficultyRules } from "./CampaignDifficultyRules";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";

type WarehouseItemConfig = ResourceWarehouseItemConfig | CraftedWarehouseItemConfig;
type AggregatedCost = readonly [item: WarehouseItemConfig, amount: number];

/** 原子处理配置化研发前置、材料扣除与道具制作。 */
export class ResearchCraftingService {
  private readonly config: SurvivalSystemsConfigDocument;
  private readonly operations: StateOperations;
  private readonly content: GameContent;
  private readonly difficultyRules: CampaignDifficultyRules;

  /** 注入版本化系统配置、状态操作器、城市目录与难度成本投影器。 */
  public constructor(
    config: SurvivalSystemsConfigDocument,
    operations: StateOperations,
    content: GameContent,
    difficultyRules: CampaignDifficultyRules,
  ) {
    this.config = config;
    this.operations = operations;
    this.content = content;
    this.difficultyRules = difficultyRules;
  }

  /** 返回全部研发项目的实时完成、前置和资源状态。 */
  public researchProjects(state: GameState): readonly ResearchProjectView[] {
    return this.config.research.projects.map((project) => ({
      projectId: project.project_id,
      name: project.name,
      description: project.description,
      completed: state.research.completed_project_ids.includes(project.project_id),
      available: this.researchAvailable(project, state),
      costDescription: this.aggregatedCostDescription(
        this.researchCosts(project, state),
      ),
      expeditionStepBonus: project.expedition_step_bonus,
      requiredItemId: project.research_input_item_id,
      requiredItemName: this.requireWarehouseItem(project.research_input_item_id).name,
      sourceDescription: this.sourceDescription(project.source_locations),
      slotted: state.research.slotted_item_id === project.research_input_item_id,
    }));
  }

  /** 返回研究台唯一方格、已放入物与可研究仓库物品。 */
  public workbench(state: GameState): ResearchWorkbenchView {
    const slotted = state.research.slotted_item_id === null
      ? null
      : this.requireWarehouseItem(state.research.slotted_item_id);
    return {
      slotCount: this.config.research.slot_count,
      slottedItemId: slotted?.item_id ?? null,
      slottedItemName: slotted?.name ?? null,
      candidates: this.config.research.projects.map((project) => {
        const item = this.requireWarehouseItem(project.research_input_item_id);
        const quantity = this.itemQuantity(item, state);
        const completed = state.research.completed_project_ids.includes(project.project_id);
        return {
          itemId: item.item_id,
          itemName: item.name,
          ownedQuantity: quantity,
          sourceDescription: this.sourceDescription(project.source_locations),
          projectId: project.project_id,
          projectName: project.name,
          researchCompleted: completed,
          available: !completed && quantity >= this.config.research.input_quantity,
        };
      }),
    };
  }

  /** 将一件已拥有的可研究物放入唯一方格，暂不消耗数量。 */
  public slotResearchItem(
    state: GameState,
    itemId: string,
  ): SurvivalSystemResolution {
    const item = this.requireWarehouseItem(itemId);
    const researchable = this.config.research.projects.some(
      (project) => project.research_input_item_id === itemId
        && !state.research.completed_project_ids.includes(project.project_id),
    );
    if (!researchable) {
      return {
        applied: false,
        messages: [formatTemplate(this.config.research.item_not_researchable_text, {
          item_name: item.name,
        })],
        turnsConsumed: 0,
      };
    }
    if (this.itemQuantity(item, state) < this.config.research.input_quantity) {
      return {
        applied: false,
        messages: [formatTemplate(this.config.research.item_unavailable_text, {
          item_name: item.name,
        })],
        turnsConsumed: 0,
      };
    }
    state.research.slotted_item_id = itemId;
    return {
      applied: true,
      messages: [formatTemplate(this.config.research.slotted_text, {
        item_name: item.name,
      })],
      turnsConsumed: 0,
    };
  }

  /** 清空研究台方格，因为物品尚未消耗所以无需回写仓库。 */
  public clearResearchSlot(state: GameState): SurvivalSystemResolution {
    if (state.research.slotted_item_id === null) {
      return {
        applied: false,
        messages: [this.config.research.empty_slot_text],
        turnsConsumed: 0,
      };
    }
    state.research.slotted_item_id = null;
    return {
      applied: true,
      messages: [this.config.research.slot_cleared_text],
      turnsConsumed: 0,
    };
  }

  /** 完成一项研发；任一前置或材料不足时不改变聚合状态。 */
  public completeResearch(
    state: GameState,
    projectId: string,
  ): SurvivalSystemResolution {
    const project = this.requireProject(projectId);
    if (state.research.completed_project_ids.includes(projectId)) {
      return {
        applied: false,
        messages: [formatTemplate(this.config.research.already_completed_text, {
          project_name: project.name,
        })],
        turnsConsumed: 0,
      };
    }
    if (!this.prerequisitesMet(project, state)) {
      return {
        applied: false,
        messages: [this.config.research.locked_text],
        turnsConsumed: 0,
      };
    }
    if (state.research.slotted_item_id === null) {
      return {
        applied: false,
        messages: [this.config.research.empty_slot_text],
        turnsConsumed: 0,
      };
    }
    if (state.research.slotted_item_id !== project.research_input_item_id) {
      return {
        applied: false,
        messages: [this.config.research.slot_mismatch_text],
        turnsConsumed: 0,
      };
    }
    const researchItem = this.requireWarehouseItem(project.research_input_item_id);
    if (this.itemQuantity(researchItem, state) < this.config.research.input_quantity) {
      return {
        applied: false,
        messages: [formatTemplate(this.config.research.item_unavailable_text, {
          item_name: researchItem.name,
        })],
        turnsConsumed: 0,
      };
    }
    const reservedResearchItem = new Map([
      [researchItem.item_id, this.config.research.input_quantity],
    ]);
    const costs = this.researchCosts(project, state);
    if (!this.canAffordAggregated(costs, state, reservedResearchItem)) {
      return {
        applied: false,
        messages: [this.config.research.insufficient_text],
        turnsConsumed: 0,
      };
    }
    const working = cloneGameState(state);
    this.applyAggregatedCosts(costs, working);
    this.consumeItem(researchItem, this.config.research.input_quantity, working);
    working.research.completed_project_ids.push(projectId);
    working.research.slotted_item_id = null;
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.research.completed_text, {
        project_name: project.name,
      })],
      turnsConsumed: project.turns_consumed,
    };
  }

  /** 返回全部基础配方与已完成对应研究的高级配方。 */
  public craftingRecipes(state: GameState): readonly CraftingRecipeView[] {
    return this.config.crafting.recipes.flatMap((recipe) => {
      const unlocked = recipe.required_project_id === null
        || state.research.completed_project_ids.includes(recipe.required_project_id);
      if (!unlocked) return [];
      return {
        recipeId: recipe.recipe_id,
        name: recipe.name,
        description: recipe.description,
        available: this.canAfford(recipe.costs, state),
        unlocked,
        costDescription: this.costDescription(recipe.costs),
        outputItemId: recipe.output_item_id,
        outputQuantity: recipe.output_quantity,
        blueprintSourceDescription: this.sourceDescription(
          recipe.blueprint_source_locations,
        ),
      };
    });
  }

  /** 制作一份配方产物；扣料与增加库存作为一次事务提交。 */
  public craft(state: GameState, recipeId: string): SurvivalSystemResolution {
    const recipe = this.requireRecipe(recipeId);
    const item = this.requireCraftedOutput(recipe.output_item_id);
    if (
      recipe.required_project_id !== null
      && !state.research.completed_project_ids.includes(recipe.required_project_id)
    ) {
      return {
        applied: false,
        messages: [this.config.crafting.locked_text],
        turnsConsumed: 0,
      };
    }
    if (!this.canAfford(recipe.costs, state)) {
      return {
        applied: false,
        messages: [this.config.crafting.insufficient_text],
        turnsConsumed: 0,
      };
    }
    const working = cloneGameState(state);
    this.applyCosts(recipe.costs, working);
    const current = working.inventory.crafted_items[recipe.output_item_id] ?? 0;
    working.inventory.crafted_items[recipe.output_item_id] =
      current + recipe.output_quantity;
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.crafting.crafted_text, {
        item_name: item.name,
        quantity: recipe.output_quantity,
      })],
      turnsConsumed: recipe.turns_consumed,
    };
  }

  /** 汇总所有已完成研发提供的远征步数加成。 */
  public expeditionStepBonus(state: GameState): number {
    return this.config.research.projects
      .filter((project) => state.research.completed_project_ids.includes(project.project_id))
      .reduce((sum, project) => sum + project.expedition_step_bonus, 0);
  }

  /** 判断研发前置和材料是否同时满足。 */
  private researchAvailable(project: ResearchProjectConfig, state: GameState): boolean {
    const researchItem = this.requireWarehouseItem(project.research_input_item_id);
    return !state.research.completed_project_ids.includes(project.project_id)
      && this.prerequisitesMet(project, state)
      && state.research.slotted_item_id === project.research_input_item_id
      && this.itemQuantity(researchItem, state)
        >= this.config.research.input_quantity
      && this.canAffordAggregated(
        this.researchCosts(project, state),
        state,
        new Map([[researchItem.item_id, this.config.research.input_quantity]]),
      );
  }

  /** 按稳定 ID 返回状态资源或制作物的仓库配置。 */
  private requireWarehouseItem(itemId: string): WarehouseItemConfig {
    const item = [
      ...this.config.warehouse.resource_items,
      ...this.config.warehouse.crafted_items,
    ].find((candidate) => candidate.item_id === itemId);
    if (item === undefined) {
      throw new GameApplicationError(formatTemplate(
        this.config.warehouse.unknown_item_text,
        { item_id: itemId },
      ));
    }
    return item;
  }

  /** 读取研究物在状态资源或制作物库存中的可用数量。 */
  private itemQuantity(
    item: WarehouseItemConfig,
    state: GameState,
  ): number {
    return "state_target" in item
      ? this.operations.read(item.state_target, state)
      : state.inventory.crafted_items[item.item_id] ?? 0;
  }

  /** 从状态资源或制作物库存原子消耗指定物品。 */
  private consumeItem(
    item: WarehouseItemConfig,
    quantity: number,
    state: GameState,
  ): void {
    const current = this.itemQuantity(item, state);
    if (current < quantity) throw new Error(`仓库物品 ${item.item_id} 在提交前发生变化。`);
    if ("state_target" in item) {
      this.operations.write(item.state_target, current - quantity, state);
      return;
    }
    const remaining = current - quantity;
    if (remaining === 0) Reflect.deleteProperty(
      state.inventory.crafted_items,
      item.item_id,
    );
    else state.inventory.crafted_items[item.item_id] = remaining;
  }

  /** 把城市与区划 ID 格式化为“A市·C区”形式的可读出处。 */
  private sourceDescription(locations: readonly DiscoverySourceLocationConfig[]): string {
    return locations.map((location) => {
      const city = this.content.city(location.city_id);
      const district = this.content.district(location.city_id, location.district_id);
      return formatTemplate(this.config.display.source_location_format, {
        city_name: city.name,
        district_code: district.code,
      });
    }).join(this.config.display.source_separator);
  }

  /** 判断研发声明的全部前置项目已完成。 */
  private prerequisitesMet(project: ResearchProjectConfig, state: GameState): boolean {
    return project.required_project_ids.every((requiredId) =>
      state.research.completed_project_ids.includes(requiredId),
    );
  }

  /** 在不修改状态的前提下检查成本与预留物品的合计数量。 */
  private canAfford(
    costs: readonly ResourceCostConfig[],
    state: GameState,
    reservedItems: ReadonlyMap<string, number> = new Map(),
  ): boolean {
    return this.canAffordAggregated(
      this.aggregateCosts(costs),
      state,
      reservedItems,
    );
  }

  /** 在不修改状态的前提下检查已聚合成本与预留物品。 */
  private canAffordAggregated(
    costs: readonly AggregatedCost[],
    state: GameState,
    reservedItems: ReadonlyMap<string, number> = new Map(),
  ): boolean {
    return costs.every(([item, amount]) =>
      this.itemQuantity(item, state) >= amount + (reservedItems.get(item.item_id) ?? 0),
    );
  }

  /** 使用仓库名称格式化一组配置化成本。 */
  private costDescription(costs: readonly ResourceCostConfig[]): string {
    return this.aggregatedCostDescription(this.aggregateCosts(costs));
  }

  /** 使用仓库名称格式化已聚合的成本。 */
  private aggregatedCostDescription(costs: readonly AggregatedCost[]): string {
    return costs.map(([item, amount]) =>
      formatTemplate(this.config.display.cost_item_format, {
        item_name: item.name,
        quantity: amount,
      }),
    ).join(this.config.display.cost_separator);
  }

  /** 在工作副本中按仓库物品聚合后一次性扣除全部成本。 */
  private applyCosts(costs: readonly ResourceCostConfig[], state: GameState): void {
    this.applyAggregatedCosts(this.aggregateCosts(costs), state);
  }

  /** 在工作副本中一次性扣除已聚合成本。 */
  private applyAggregatedCosts(
    costs: readonly AggregatedCost[],
    state: GameState,
  ): void {
    for (const [item, amount] of costs) {
      this.consumeItem(item, amount, state);
    }
  }

  /** 先按物品聚合研究成本，再统一应用当前难度，避免分项取整多扣。 */
  private researchCosts(
    project: ResearchProjectConfig,
    state: GameState,
  ): readonly AggregatedCost[] {
    return this.aggregateCosts(project.costs).map(([item, amount]) => [
      item,
      this.difficultyRules.researchCost(amount, state),
    ] as const);
  }

  /** 将状态目标与以物易物条目归一为仓库 ID，避免重复验资。 */
  private aggregateCosts(
    costs: readonly ResourceCostConfig[],
  ): readonly AggregatedCost[] {
    const totals = new Map<string, AggregatedCost>();
    for (const cost of costs) {
      const item = this.costItem(cost);
      if (!Number.isInteger(cost.amount) || cost.amount <= 0) {
        throw new Error(`生存系统成本必须是固定正整数扣减：${item.item_id}`);
      }
      if (!isWarehouseItemCost(cost)) {
        const operation: unknown = cost.operation;
        if (operation !== "subtract") {
          throw new Error(`生存系统成本只支持扣减：${item.item_id}`);
        }
      }
      const accumulated = totals.get(item.item_id)?.[1] ?? 0;
      totals.set(item.item_id, [item, accumulated + cost.amount]);
    }
    return [...totals.values()];
  }

  /** 把一项状态或仓库成本解析为统一仓库物品。 */
  private costItem(cost: ResourceCostConfig): WarehouseItemConfig {
    if (isWarehouseItemCost(cost)) return this.requireWarehouseItem(cost.item_id);
    const item = this.config.warehouse.resource_items.find(
      (candidate) => candidate.state_target === cost.target,
    );
    if (item === undefined) {
      throw new Error(`生存系统成本引用了未注册的仓库资源：${cost.target}`);
    }
    return item;
  }

  /** 按稳定 ID 返回研发项目。 */
  private requireProject(projectId: string): ResearchProjectConfig {
    const project = this.config.research.projects.find(
      (candidate) => candidate.project_id === projectId,
    );
    if (project === undefined) {
      throw new GameApplicationError(formatTemplate(
        this.config.research.unknown_text,
        { project_id: projectId },
      ));
    }
    return project;
  }

  /** 按稳定 ID 返回制作配方。 */
  private requireRecipe(recipeId: string): CraftingRecipeConfig {
    const recipe = this.config.crafting.recipes.find(
      (candidate) => candidate.recipe_id === recipeId,
    );
    if (recipe === undefined) {
      throw new GameApplicationError(formatTemplate(
        this.config.crafting.unknown_text,
        { recipe_id: recipeId },
      ));
    }
    return recipe;
  }

  /** 在任何扣料前解析制作产物，防止配置异常造成提交后抛错。 */
  private requireCraftedOutput(itemId: string): CraftedWarehouseItemConfig {
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

  /** 原子提交研发、库存和被扣减资源。 */
  private commit(source: GameState, target: GameState): void {
    target.players = source.players;
    target.shelter = source.shelter;
    target.archive_collection_totals = source.archive_collection_totals;
    target.research = source.research;
    target.inventory = source.inventory;
  }
}
