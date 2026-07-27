import type { ShelterState } from "./game-state";

/** 内外墙各自可使用的耐久上限。 */
export interface ShelterWallLimits {
  readonly innerWallMaximum: number;
  readonly outerWallMaximum: number;
}

/** 用于界面和日志的避难所墙体快照。 */
export interface ShelterWallSnapshot {
  readonly innerWallHealth: number;
  readonly innerWallMaximum: number;
  readonly outerWallHealth: number;
  readonly outerWallMaximum: number;
  readonly totalHealth: number;
  readonly totalMaximum: number;
}

/** 将内外墙限制在配置上限内，并刷新旧总耐久镜像。 */
export function normalizeShelterWalls(
  shelter: ShelterState,
  limits: ShelterWallLimits,
): void {
  shelter.inner_wall_health = clampWall(
    shelter.inner_wall_health,
    limits.innerWallMaximum,
  );
  shelter.outer_wall_health = clampWall(
    shelter.outer_wall_health,
    limits.outerWallMaximum,
  );
  synchronizeShelterHealth(shelter);
}

/** 从外墙开始承受攻击，余下伤害才会进入内墙。 */
export function damageShelterWalls(shelter: ShelterState, amount: number): number {
  const damage = requireNonNegativeInteger(amount, "墙体伤害");
  const before = shelter.inner_wall_health + shelter.outer_wall_health;
  const outerDamage = Math.min(shelter.outer_wall_health, damage);
  shelter.outer_wall_health -= outerDamage;
  const remaining = damage - outerDamage;
  shelter.inner_wall_health = Math.max(0, shelter.inner_wall_health - remaining);
  synchronizeShelterHealth(shelter);
  return before - shelter.health;
}

/** 仅维护内墙，返回实际恢复的耐久。 */
export function repairInnerWall(
  shelter: ShelterState,
  amount: number,
  maximum: number,
): number {
  return repairWall(shelter, "inner_wall_health", amount, maximum);
}

/** 仅修补外墙，返回实际恢复的耐久。 */
export function repairOuterWall(
  shelter: ShelterState,
  amount: number,
  maximum: number,
): number {
  return repairWall(shelter, "outer_wall_health", amount, maximum);
}

/** 按旧内容写入的总耐久调整墙体：伤害先落外墙，修复先落内墙。 */
export function setShelterTotalHealth(
  shelter: ShelterState,
  totalHealth: number,
  limits: ShelterWallLimits,
): void {
  const maximum = limits.innerWallMaximum + limits.outerWallMaximum;
  const target = Math.max(0, Math.min(requireInteger(totalHealth, "总耐久"), maximum));
  const current = shelter.inner_wall_health + shelter.outer_wall_health;
  if (target < current) {
    damageShelterWalls(shelter, current - target);
    return;
  }
  let remaining = target - current;
  const innerCapacity = Math.max(0, limits.innerWallMaximum - shelter.inner_wall_health);
  const innerRepair = Math.min(innerCapacity, remaining);
  shelter.inner_wall_health += innerRepair;
  remaining -= innerRepair;
  shelter.outer_wall_health = Math.min(
    limits.outerWallMaximum,
    shelter.outer_wall_health + remaining,
  );
  synchronizeShelterHealth(shelter);
}

/** 返回不暴露可变对象的内外墙实时摘要。 */
export function shelterWallSnapshot(
  shelter: ShelterState,
  limits: ShelterWallLimits,
): ShelterWallSnapshot {
  return {
    innerWallHealth: shelter.inner_wall_health,
    innerWallMaximum: limits.innerWallMaximum,
    outerWallHealth: shelter.outer_wall_health,
    outerWallMaximum: limits.outerWallMaximum,
    totalHealth: shelter.health,
    totalMaximum: limits.innerWallMaximum + limits.outerWallMaximum,
  };
}

/** 修复指定墙体并同步总耐久镜像。 */
function repairWall(
  shelter: ShelterState,
  field: "inner_wall_health" | "outer_wall_health",
  amount: number,
  maximum: number,
): number {
  const restore = requireNonNegativeInteger(amount, "墙体修复量");
  const limit = requireNonNegativeInteger(maximum, "墙体上限");
  const before = shelter[field];
  shelter[field] = Math.min(limit, before + restore);
  synchronizeShelterHealth(shelter);
  return shelter[field] - before;
}

/** 以墙体分项为权威值刷新兼容总耐久。 */
export function synchronizeShelterHealth(shelter: ShelterState): void {
  shelter.health = shelter.inner_wall_health + shelter.outer_wall_health;
}

/** 把墙体数值截断到零和配置上限之间。 */
function clampWall(value: number, maximum: number): number {
  return Math.max(
    0,
    Math.min(
      requireInteger(value, "墙体耐久"),
      requireNonNegativeInteger(maximum, "墙体上限"),
    ),
  );
}

/** 要求输入是整数。 */
function requireInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) throw new RangeError(`${label}必须是整数。`);
  return value;
}

/** 要求输入是非负整数。 */
function requireNonNegativeInteger(value: number, label: string): number {
  const integer = requireInteger(value, label);
  if (integer < 0) throw new RangeError(`${label}不能为负数。`);
  return integer;
}
