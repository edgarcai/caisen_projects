import { formatTemplate } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import { cloneGameState, type GameState } from "../domain/game-state";
import type {
  CraftingRecipeConfig,
  CraftingRecipeView,
  CraftedWarehouseItemConfig,
  ResearchProjectConfig,
  ResearchProjectView,
  ResourceCostConfig,
  SurvivalSystemResolution,
  SurvivalSystemsConfigDocument,
} from "../domain/survival-systems";
import type { StateOperations } from "./StateOperations";

/** 原子处理配置化研发前置、材料扣除与道具制作。 */
export class ResearchCraftingService {
  private readonly config: SurvivalSystemsConfigDocument;
  private readonly operations: StateOperations;

  /** 注入版本化系统配置和白名单状态操作器。 */
  public constructor(
    config: SurvivalSystemsConfigDocument,
    operations: StateOperations,
  ) {
    this.config = config;
    this.operations = operations;
  }

  /** 返回全部研发项目的实时完成、前置和资源状态。 */
  public researchProjects(state: GameState): readonly ResearchProjectView[] {
    return this.config.research.projects.map((project) => ({
      projectId: project.project_id,
      name: project.name,
      description: project.description,
      completed: state.research.completed_project_ids.includes(project.project_id),
      available: this.researchAvailable(project, state),
      costDescription: this.costDescription(project.costs),
      expeditionStepBonus: project.expedition_step_bonus,
    }));
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
    if (!this.canAfford(project.costs, state)) {
      return {
        applied: false,
        messages: [this.config.research.insufficient_text],
        turnsConsumed: 0,
      };
    }
    const working = cloneGameState(state);
    this.applyCosts(project.costs, working);
    working.research.completed_project_ids.push(projectId);
    this.commit(working, state);
    return {
      applied: true,
      messages: [formatTemplate(this.config.research.completed_text, {
        project_name: project.name,
      })],
      turnsConsumed: project.turns_consumed,
    };
  }

  /** 返回全部制作配方的实时解锁和材料状态。 */
  public craftingRecipes(state: GameState): readonly CraftingRecipeView[] {
    return this.config.crafting.recipes.map((recipe) => {
      const unlocked = state.research.completed_project_ids.includes(
        recipe.required_project_id,
      );
      return {
        recipeId: recipe.recipe_id,
        name: recipe.name,
        description: recipe.description,
        available: unlocked && this.canAfford(recipe.costs, state),
        unlocked,
        costDescription: this.costDescription(recipe.costs),
        outputItemId: recipe.output_item_id,
        outputQuantity: recipe.output_quantity,
      };
    });
  }

  /** 制作一份配方产物；扣料与增加库存作为一次事务提交。 */
  public craft(state: GameState, recipeId: string): SurvivalSystemResolution {
    const recipe = this.requireRecipe(recipeId);
    const item = this.requireCraftedOutput(recipe.output_item_id);
    if (!state.research.completed_project_ids.includes(recipe.required_project_id)) {
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
    return !state.research.completed_project_ids.includes(project.project_id)
      && this.prerequisitesMet(project, state)
      && this.canAfford(project.costs, state);
  }

  /** 判断研发声明的全部前置项目已完成。 */
  private prerequisitesMet(project: ResearchProjectConfig, state: GameState): boolean {
    return project.required_project_ids.every((requiredId) =>
      state.research.completed_project_ids.includes(requiredId),
    );
  }

  /** 在不修改状态的前提下检查全部固定成本。 */
  private canAfford(costs: readonly ResourceCostConfig[], state: GameState): boolean {
    return this.aggregateCosts(costs).every(([target, amount]) =>
      this.operations.read(target, state) >= amount,
    );
  }

  /** 使用仓库名称格式化一组配置化成本。 */
  private costDescription(costs: readonly ResourceCostConfig[]): string {
    return this.aggregateCosts(costs).map(([target, amount]) => {
      const item = this.config.warehouse.resource_items.find(
        (candidate) => candidate.state_target === target,
      );
      if (item === undefined) {
        throw new Error(`生存系统成本引用了未注册的仓库资源：${target}`);
      }
      return formatTemplate(this.config.display.cost_item_format, {
        item_name: item.name,
        quantity: amount,
      });
    }).join(this.config.display.cost_separator);
  }

  /** 在工作副本中按目标聚合后一次性扣除全部正整数成本。 */
  private applyCosts(costs: readonly ResourceCostConfig[], state: GameState): void {
    for (const [target, amount] of this.aggregateCosts(costs)) {
      const current = this.operations.read(target, state);
      if (current < amount) {
        throw new Error(`生存系统成本在提交前发生变化：${target}`);
      }
      this.operations.write(target, current - amount, state);
    }
  }

  /** 防御性校验并合并同一资源目标，避免重复成本分别验资后扣成负数。 */
  private aggregateCosts(
    costs: readonly ResourceCostConfig[],
  ): readonly (readonly [string, number])[] {
    const totals = new Map<string, number>();
    for (const cost of costs) {
      const runtimeOperation: unknown = cost.operation;
      if (
        runtimeOperation !== "subtract"
        || !Number.isInteger(cost.amount)
        || cost.amount <= 0
      ) {
        throw new Error(`生存系统成本必须是固定正整数扣减：${cost.target}`);
      }
      totals.set(cost.target, (totals.get(cost.target) ?? 0) + cost.amount);
    }
    return [...totals.entries()];
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
    target.research = source.research;
    target.inventory = source.inventory;
  }
}
