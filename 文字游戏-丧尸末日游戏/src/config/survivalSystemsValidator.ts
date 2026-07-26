import type {
  CraftingRecipeConfig,
  CraftedWarehouseItemConfig,
  ResearchProjectConfig,
  ResourceWarehouseItemConfig,
  SurvivalSystemsConfigDocument,
} from "../domain/survival-systems";

const SUPPORTED_SCHEMA_VERSION = 1;
const EQUIPMENT_CATEGORIES = new Set(["weapon", "armor"]);
const EQUIPMENT_ATTRIBUTES = new Set(["attack", "defense", "agility"]);
const WAREHOUSE_CATEGORIES = new Set([
  "consumable",
  "material",
  "archive",
  "key_item",
  "morale",
  "tool",
  "armor",
  "weapon",
]);

/** 在应用组合根校验仓库、研发、制作和远征配置的关键不变量。 */
export function validateSurvivalSystemsConfig(
  value: unknown,
): SurvivalSystemsConfigDocument {
  const document = requireRecord(value, "survival_systems");
  const schemaVersion = requireInteger(document.schema_version, "schema_version", 1);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`不支持的生存系统配置版本：${String(schemaVersion)}`);
  }
  validateTopLevelSections(document);
  const typed = value as SurvivalSystemsConfigDocument;
  validateWarehouse(typed);
  validateResearchAndCrafting(typed);
  validateExpedition(typed);
  return typed;
}

/** 在转换为领域配置前确认所有顶层区段与关键集合存在。 */
function validateTopLevelSections(document: Readonly<Record<string, unknown>>): void {
  const warehouse = requireRecord(document.warehouse, "warehouse");
  const research = requireRecord(document.research, "research");
  const crafting = requireRecord(document.crafting, "crafting");
  requireRecord(document.expedition, "expedition");
  requireRecord(document.display, "display");
  requireArray(warehouse.resource_items, "warehouse.resource_items");
  requireArray(warehouse.crafted_items, "warehouse.crafted_items");
  requireArray(research.projects, "research.projects");
  requireArray(crafting.recipes, "crafting.recipes");
}

/** 校验仓库 ID、装备分类和状态目标均可稳定引用。 */
function validateWarehouse(config: SurvivalSystemsConfigDocument): void {
  const resources: readonly ResourceWarehouseItemConfig[] = config.warehouse.resource_items;
  const crafted: readonly CraftedWarehouseItemConfig[] = config.warehouse.crafted_items;
  const allItems = [...resources, ...crafted];
  requireUniqueStrings(allItems.map((item) => item.item_id), "warehouse item_id");
  for (const item of allItems) {
    requireNonEmptyString(item.item_id, "warehouse.item_id");
    requireNonEmptyString(item.name, `warehouse.${item.item_id}.name`);
    requireNonEmptyString(item.description, `warehouse.${item.item_id}.description`);
    if (!WAREHOUSE_CATEGORIES.has(item.category)) {
      throw new Error(`仓库物品 ${item.item_id} 分类无效：${item.category}`);
    }
    if (EQUIPMENT_CATEGORIES.has(item.category) && item.carryable) {
      throw new Error(`装备 ${item.item_id} 不能同时声明为远征携带物。`);
    }
    validateEquipmentBonuses(item);
  }
  for (const item of resources) {
    requireNonEmptyString(item.state_target, `warehouse.${item.item_id}.state_target`);
    if (EQUIPMENT_CATEGORIES.has(item.category)) {
      throw new Error(`状态资源 ${item.item_id} 不能声明为可装备物。`);
    }
  }
  for (const category of WAREHOUSE_CATEGORIES) {
    requireNonEmptyString(
      config.warehouse.category_labels[category as keyof typeof config.warehouse.category_labels],
      `warehouse.category_labels.${category}`,
    );
  }
}

/** 校验只有武器与防具可声明非负整数战斗属性加成。 */
function validateEquipmentBonuses(
  item: ResourceWarehouseItemConfig | CraftedWarehouseItemConfig,
): void {
  const rawBonuses = (item as CraftedWarehouseItemConfig).equipment_bonuses;
  const isEquipment = EQUIPMENT_CATEGORIES.has(item.category);
  if (!isEquipment && rawBonuses !== undefined) {
    throw new Error(`非装备 ${item.item_id} 不能声明 equipment_bonuses。`);
  }
  if (!isEquipment) return;
  const bonuses = requireRecord(rawBonuses, `warehouse.${item.item_id}.equipment_bonuses`);
  if (Object.keys(bonuses).length === 0) {
    throw new Error(`装备 ${item.item_id} 至少需要一项属性加成。`);
  }
  let hasPositiveBonus = false;
  for (const [attribute, amount] of Object.entries(bonuses)) {
    if (!EQUIPMENT_ATTRIBUTES.has(attribute)) {
      throw new Error(`装备 ${item.item_id} 引用了未知属性：${attribute}`);
    }
    const bonus = requireInteger(
      amount,
      `warehouse.${item.item_id}.equipment_bonuses.${attribute}`,
      0,
    );
    hasPositiveBonus ||= bonus > 0;
  }
  if (!hasPositiveBonus) {
    throw new Error(`装备 ${item.item_id} 至少需要一项正数属性加成。`);
  }
}

/** 校验研发前置、配方解锁和制作产物之间的引用完整性。 */
function validateResearchAndCrafting(config: SurvivalSystemsConfigDocument): void {
  const projects: readonly ResearchProjectConfig[] = config.research.projects;
  const recipes: readonly CraftingRecipeConfig[] = config.crafting.recipes;
  const projectIds = projects.map((project) => project.project_id);
  const recipeIds = recipes.map((recipe) => recipe.recipe_id);
  const craftedIds = new Set(config.warehouse.crafted_items.map((item) => item.item_id));
  requireUniqueStrings(projectIds, "research project_id");
  requireUniqueStrings(recipeIds, "crafting recipe_id");
  const projectIdSet = new Set(projectIds);
  const recipeIdSet = new Set(recipeIds);
  for (const project of projects) {
    requireInteger(project.expedition_step_bonus, `${project.project_id}.step_bonus`, 0);
    requireInteger(project.turns_consumed, `${project.project_id}.turns_consumed`, 1);
    for (const requirementId of project.required_project_ids) {
      requireReference(requirementId, projectIdSet, `${project.project_id}.required_project_ids`);
    }
    for (const recipeId of project.unlock_recipe_ids) {
      requireReference(recipeId, recipeIdSet, `${project.project_id}.unlock_recipe_ids`);
    }
  }
  for (const recipe of recipes) {
    requireReference(
      recipe.required_project_id,
      projectIdSet,
      `${recipe.recipe_id}.required_project_id`,
    );
    requireReference(recipe.output_item_id, craftedIds, `${recipe.recipe_id}.output_item_id`);
    requireInteger(recipe.output_quantity, `${recipe.recipe_id}.output_quantity`, 1);
    requireInteger(recipe.turns_consumed, `${recipe.recipe_id}.turns_consumed`, 1);
  }
}

/** 校验远征限制、城市成本、伙伴加成和惩罚范围。 */
function validateExpedition(config: SurvivalSystemsConfigDocument): void {
  const expeditionRecord = requireRecord(config.expedition, "expedition");
  const expedition = config.expedition;
  requireInteger(expedition.base_steps, "expedition.base_steps", 1);
  requireInteger(expedition.maximum_companions, "expedition.maximum_companions", 0);
  requireInteger(
    expedition.maximum_carried_item_types,
    "expedition.maximum_carried_item_types",
    0,
  );
  requireInteger(expedition.maximum_carried_units, "expedition.maximum_carried_units", 0);
  requireInteger(expedition.event_step_cost, "expedition.event_step_cost", 1);
  const keepPercent = requireFiniteNumber(
    expedition.forced_return_keep_percent,
    "expedition.forced_return_keep_percent",
  );
  if (keepPercent < 0 || keepPercent > 100) {
    throw new Error("expedition.forced_return_keep_percent 必须位于 0 到 100。 ");
  }
  const healthRange = requireArray(
    expeditionRecord.forced_return_health_range,
    "expedition.forced_return_health_range",
  );
  if (healthRange.length !== 2) {
    throw new Error("expedition.forced_return_health_range 必须是双元素数组。");
  }
  const minimumHealth = requireInteger(healthRange[0], "forced_return_health_range[0]", 1);
  const maximumHealth = requireInteger(healthRange[1], "forced_return_health_range[1]", 1);
  if (minimumHealth > maximumHealth) {
    throw new Error("强制返程生命下限不能大于上限。");
  }
  for (const [cityId, cost] of Object.entries(expedition.city_step_costs)) {
    requireNonEmptyString(cityId, "expedition.city_step_costs 的键");
    requireInteger(cost, `expedition.city_step_costs.${cityId}`, 0);
  }
  requireUniqueStrings(
    expedition.companion_step_bonuses.map((bonus) => bonus.companion_id),
    "expedition companion_id",
  );
  requireUniqueStrings(
    expedition.loot_targets.map((target) => target.item_id),
    "expedition loot item_id",
  );
  const allItems = [
    ...config.warehouse.resource_items,
    ...config.warehouse.crafted_items,
  ];
  const itemIds = new Set(allItems.map((item) => item.item_id));
  const carryableIds = new Set(
    allItems.filter((item) => item.carryable).map((item) => item.item_id),
  );
  for (const itemId of Object.keys(expedition.carried_item_step_bonuses)) {
    requireReference(itemId, carryableIds, "expedition.carried_item_step_bonuses");
  }
  const resourceById = new Map(
    config.warehouse.resource_items.map((item) => [item.item_id, item]),
  );
  for (const target of expedition.loot_targets) {
    requireReference(target.item_id, itemIds, "expedition.loot_targets");
    const resource = resourceById.get(target.item_id);
    if (resource === undefined || resource.state_target !== target.state_target) {
      throw new Error(`远征战利品 ${target.item_id} 未绑定对应仓库资源目标。`);
    }
  }
}

/** 要求未知值是普通对象。 */
function requireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象。`);
  }
  return value as Readonly<Record<string, unknown>>;
}

/** 要求未知值是数组。 */
function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} 必须是数组。`);
  }
  return value;
}

/** 要求未知值是非空字符串。 */
function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} 必须是非空字符串。`);
  }
  return value;
}

/** 要求未知值是有限数值。 */
function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} 必须是有限数值。`);
  }
  return value;
}

/** 要求未知值是不小于下限的整数。 */
function requireInteger(value: unknown, path: string, minimum: number): number {
  const numberValue = requireFiniteNumber(value, path);
  if (!Number.isInteger(numberValue) || numberValue < minimum) {
    throw new Error(`${path} 必须是不小于 ${String(minimum)} 的整数。`);
  }
  return numberValue;
}

/** 要求一组稳定 ID 不重复且均为非空字符串。 */
function requireUniqueStrings(values: readonly string[], path: string): void {
  const unique = new Set<string>();
  for (const value of values) {
    requireNonEmptyString(value, path);
    if (unique.has(value)) {
      throw new Error(`${path} 出现重复值：${value}`);
    }
    unique.add(value);
  }
}

/** 要求配置 ID 引用已存在目标。 */
function requireReference(value: string, allowed: ReadonlySet<string>, path: string): void {
  requireNonEmptyString(value, path);
  if (!allowed.has(value)) {
    throw new Error(`${path} 引用了未知 ID：${value}`);
  }
}
