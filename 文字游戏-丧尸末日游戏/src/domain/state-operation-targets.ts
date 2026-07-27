/** 配置化效果可读写的所长整数字段。 */
const PLAYER_FIELDS = new Set([
  "age",
  "lifespan",
  "health",
  "attack",
  "defense",
  "agility",
  "medical_supplies",
  "food",
  "hunger",
  "intelligence",
  "coins",
  "parts",
  "negative_status",
  "antidotes",
]);

/** 配置化效果可读写的避难所整数字段。 */
const SHELTER_FIELDS = new Set([
  "population",
  "hope",
  "group_hunger",
  "health",
  "inner_wall_health",
  "outer_wall_health",
  "defense_damage",
  "activity",
  "newspapers",
  "books",
  "magazines",
  "toys",
  "game_consoles",
]);

/** 配置化效果可读写的剧情整数字段。 */
const STORY_FIELDS = new Set(["humanity", "evidence", "infection_pressure"]);

/** 判断根节点下的字段是否属于 StateOperations 的静态白名单。 */
export function isStateOperationFieldAllowed(root: string, field: string): boolean {
  if (root === "player") return PLAYER_FIELDS.has(field);
  if (root === "shelter") return SHELTER_FIELDS.has(field);
  if (root === "story") return STORY_FIELDS.has(field);
  return false;
}

/** 判断开局时尚未依赖动态设施或角色的目标是否可安全写入。 */
export function isStaticStateOperationTargetSupported(target: string): boolean {
  const parts = target.split(".");
  const root = parts[0];
  const field = parts[1];
  return parts.length === 2
    && root !== undefined
    && field !== undefined
    && isStateOperationFieldAllowed(root, field);
}
