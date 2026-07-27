import type {
  ExpansionTraitConfig,
  TraitSelectionRulesConfig,
  TraitSelectionValidation,
} from "./types";

/** 校验特性选择数量、稳定 ID、唯一性与互斥关系。 */
export function validateTraitSelection(
  selectedTraitIds: readonly string[],
  traits: readonly ExpansionTraitConfig[],
  rules: TraitSelectionRulesConfig,
): TraitSelectionValidation {
  if (
    selectedTraitIds.length < rules.minimumSelections
    || selectedTraitIds.length > rules.maximumSelections
  ) {
    return {
      valid: false,
      error: `特性需选择 ${String(rules.minimumSelections)}~${String(rules.maximumSelections)} 个。`,
    };
  }
  const selectedIds = new Set(selectedTraitIds);
  if (rules.requireUnique && selectedIds.size !== selectedTraitIds.length) {
    return { valid: false, error: "不能重复选择同一特性。" };
  }
  const traitById = new Map(traits.map((trait) => [trait.traitId, trait]));
  for (const traitId of selectedTraitIds) {
    const trait = traitById.get(traitId);
    if (trait === undefined) {
      return { valid: false, error: `未知特性：${traitId}。` };
    }
    const conflictingId = trait.incompatibleTraitIds.find((candidate) =>
      selectedIds.has(candidate),
    );
    if (conflictingId !== undefined) {
      const conflicting = traitById.get(conflictingId);
      return {
        valid: false,
        error: `特性“${trait.displayName}”与“${conflicting?.displayName ?? conflictingId}”不能同时选择。`,
      };
    }
  }
  return { valid: true, error: null };
}
