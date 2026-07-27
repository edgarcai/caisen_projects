import { validateContentExpansionCatalog } from "./contentExpansionValidator";
import {
  createManufacturingCatalog,
  selectVisibleManufacturingRecipes,
} from "./manufacturingCatalogGenerator";
import { MANUFACTURING_GENERATION_CONFIG } from "./manufacturingSource";
import {
  CONTENT_EXPANSION_THRESHOLDS,
  DIFFICULTY_OPTIONS,
  FAILURE_ENDINGS,
  ORIGIN_OPTIONS,
  SHELTER_TYPES,
  TRAIT_OPTIONS,
  TRAIT_SELECTION_RULES,
} from "./profileAndWorldSource";

/** 模块加载时生成 200 基础与 200 高级制造项的完整运行时目录。 */
export const manufacturingCatalog = createManufacturingCatalog(
  MANUFACTURING_GENERATION_CONFIG,
);

/** 可直接注入页面或领域服务的经启动校验内容聚合。 */
export const contentExpansionCatalog = validateContentExpansionCatalog({
  manufacturing: manufacturingCatalog,
  difficulties: DIFFICULTY_OPTIONS,
  origins: ORIGIN_OPTIONS,
  traits: TRAIT_OPTIONS,
  traitSelectionRules: TRAIT_SELECTION_RULES,
  shelterTypes: SHELTER_TYPES,
  failureEndings: FAILURE_ENDINGS,
  thresholds: CONTENT_EXPANSION_THRESHOLDS,
});

/** 与页面命名一致的难度选项，同时保留完整数值。 */
export const difficultyOptions = DIFFICULTY_OPTIONS.map((option) => ({
  ...option,
  id: option.difficultyId,
  label: option.displayName,
}));

/** 与页面命名一致的起源选项，同时保留完整数值。 */
export const originOptions = ORIGIN_OPTIONS.map((option) => ({
  ...option,
  id: option.originId,
  label: option.displayName,
}));

/** 与页面命名一致的特性选项，同时保留互斥关系。 */
export const traitOptions = TRAIT_OPTIONS.map((option) => ({
  ...option,
  id: option.traitId,
  label: option.displayName,
}));

/** 十种可用避难所类型，提供聚落网络服务需要的通用字段。 */
export const shelterTypes = SHELTER_TYPES;

/** 八个失败结局，额外提供页面通用 ID 与标签。 */
export const failureEndings = FAILURE_ENDINGS.map((ending) => ({
  ...ending,
  id: ending.endingId,
  label: ending.displayName,
}));

/** 完整导出已展开的基础制造配方。 */
export const basicManufacturingRecipes = manufacturingCatalog.basicRecipes;

/** 完整导出已展开的高级制造配方。 */
export const advancedManufacturingRecipes = manufacturingCatalog.advancedRecipes;

/** 完整导出与高级配方一对一的蓝图。 */
export const manufacturingBlueprints = manufacturingCatalog.blueprints;

/** 完整导出丰富食品、工具、装备与载具产物。 */
export const expansionItems = manufacturingCatalog.items;

export {
  CONTENT_EXPANSION_THRESHOLDS,
  MANUFACTURING_GENERATION_CONFIG,
  TRAIT_SELECTION_RULES,
  selectVisibleManufacturingRecipes,
};
export { validateContentExpansionCatalog } from "./contentExpansionValidator";
export { createManufacturingCatalog } from "./manufacturingCatalogGenerator";
export {
  DEFAULT_SURVIVAL_SYSTEMS_EXPANSION_ADAPTER_CONFIG,
  mergeManufacturingCatalogIntoSurvivalSystems,
} from "./survivalSystemsExpansionAdapter";
export type { SurvivalSystemsExpansionAdapterConfig } from "./survivalSystemsExpansionAdapter";
export { validateTraitSelection } from "./traitSelectionPolicy";
export type * from "./types";
