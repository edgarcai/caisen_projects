import { formatTemplate, type NumericEffectConfig } from "../domain/content";
import { GameApplicationError } from "../domain/errors";
import {
  cloneGameState,
  findCompanion,
  type CompanionState,
  type GameState,
} from "../domain/game-state";
import type { ManagementResolution } from "../domain/reports";
import type {
  CompanionEquipmentOptionView,
  CompanionEquipmentSlot,
  CompanionInteractionOptionView,
  CompanionManagementView,
} from "../domain/survival-systems";
import type { GameContent } from "./GameContent";
import type { InventoryService } from "./InventoryService";
import type { StateOperations } from "./StateOperations";
import type { StoryService } from "./StoryService";

/** 将角色档案、配装与互动从剧情和仓库用例中独立出来。 */
export class CompanionManagementService {
  private readonly content: GameContent;
  private readonly inventory: InventoryService;
  private readonly operations: StateOperations;
  private readonly story: StoryService;

  /** 注入内容、仓库、状态操作器与需求判定服务。 */
  public constructor(
    content: GameContent,
    inventory: InventoryService,
    operations: StateOperations,
    story: StoryService,
  ) {
    this.content = content;
    this.inventory = inventory;
    this.operations = operations;
    this.story = story;
  }

  /** 仅返回已拥有且可行动角色的立绘、档案与配装状态。 */
  public views(state: GameState): readonly CompanionManagementView[] {
    const secretTrust = this.content.game.rules.companion_secret_unlock_trust;
    const catalog = new Map(this.inventory.catalog().map((item) => [item.itemId, item]));
    return state.companions
      .filter((companion) => companion.status === "active")
      .map((companion) => {
        const profile = this.requireProfile(companion.companion_id);
        const secretUnlocked = companion.trust >= secretTrust;
        return {
          companionId: companion.companion_id,
          name: profile.name,
          role: profile.role,
          portraitKey: profile.portrait_key,
          introduction: profile.introduction,
          secret: secretUnlocked ? profile.secret : "",
          secretUnlocked,
          status: companion.status,
          trust: companion.trust,
          equippedWeaponId: companion.equipped_weapon_id,
          equippedArmorId: companion.equipped_armor_id,
          equippedWeaponName: companion.equipped_weapon_id === null
            ? null
            : catalog.get(companion.equipped_weapon_id)?.name ?? null,
          equippedArmorName: companion.equipped_armor_id === null
            ? null
            : catalog.get(companion.equipped_armor_id)?.name ?? null,
          interactionCooldownTurns: companion.interaction_cooldown_turns,
          interactionCount: companion.interaction_count,
        };
      });
  }

  /** 返回指定伙伴与槽位的可用装备目录。 */
  public equipmentOptions(
    state: GameState,
    companionId: string,
    slot: CompanionEquipmentSlot,
  ): readonly CompanionEquipmentOptionView[] {
    const companion = this.requireActiveCompanion(state, companionId);
    const equippedId = this.equippedId(companion, slot);
    return this.inventory.catalog()
      .filter((item) => item.category === slot)
      .map((item) => {
        const availableQuantity = this.inventory.availableQuantity(
          state,
          item.itemId,
          state.active_player_index,
        );
        const equipped = equippedId === item.itemId;
        return {
          itemId: item.itemId,
          name: item.name,
          slot,
          description: item.description,
          availableQuantity,
          ownedQuantity: this.inventory.ownedQuantity(state, item.itemId),
          equipped,
          available: equipped || availableQuantity > 0,
        };
      });
  }

  /** 为伙伴装备、替换或卸下指定槽位，不推进时间。 */
  public equip(
    state: GameState,
    companionId: string,
    slot: CompanionEquipmentSlot,
    itemId: string | null,
  ): ManagementResolution {
    const companion = this.requireActiveCompanion(state, companionId);
    const profile = this.requireProfile(companionId);
    const currentId = this.equippedId(companion, slot);
    if (currentId === itemId) {
      return this.unavailable(formatTemplate(
        this.content.story.companion_management.texts.already_equipped,
        { companion_name: profile.name },
      ));
    }
    if (itemId === null) {
      this.writeEquippedId(companion, slot, null);
      return {
        applied: true,
        consumesTurn: false,
        turnsConsumed: 0,
        messages: [formatTemplate(
          this.content.story.companion_management.texts.unequipped,
          {
            companion_name: profile.name,
            slot_name: this.content.story.companion_management.slot_labels[slot],
          },
        )],
      };
    }
    const option = this.equipmentOptions(state, companionId, slot).find(
      (candidate) => candidate.itemId === itemId,
    );
    if (option === undefined) {
      throw new GameApplicationError(
        this.content.story.companion_management.texts.invalid_slot,
      );
    }
    if (!option.available) {
      return this.unavailable(formatTemplate(
        this.content.story.companion_management.texts.equipment_unavailable,
        { item_name: option.name },
      ));
    }
    this.writeEquippedId(companion, slot, itemId);
    return {
      applied: true,
      consumesTurn: false,
      turnsConsumed: 0,
      messages: [formatTemplate(
        this.content.story.companion_management.texts.equipped,
        { companion_name: profile.name, item_name: option.name },
      )],
    };
  }

  /** 返回指定伙伴的配置化互动与实时可用原因。 */
  public interactionOptions(
    state: GameState,
    companionId: string,
  ): readonly CompanionInteractionOptionView[] {
    const companion = this.requireCompanion(state, companionId);
    return this.content.story.companion_management.interactions.map((interaction) => {
      const unavailableReason = this.interactionUnavailableReason(
        state,
        companion,
        interaction.requirements ?? [],
        interaction.costs ?? [],
      );
      return {
        interactionId: interaction.interaction_id,
        label: interaction.label,
        description: interaction.description,
        available: unavailableReason === "",
        unavailableReason,
        trustGain: interaction.trust_gain,
        hopeGain: interaction.hope_gain,
        cooldownTurns: interaction.cooldown_turns,
        turnsConsumed: interaction.turns_consumed,
      };
    });
  }

  /** 原子结算一次伙伴互动，提升信任与避难所希望。 */
  public interact(
    state: GameState,
    companionId: string,
    interactionId: string,
  ): ManagementResolution {
    const interaction = this.content.story.companion_management.interactions.find(
      (candidate) => candidate.interaction_id === interactionId,
    );
    if (interaction === undefined) {
      throw new GameApplicationError(
        this.content.story.companion_management.texts.requirement_locked,
      );
    }
    const option = this.interactionOptions(state, companionId).find(
      (candidate) => candidate.interactionId === interactionId,
    );
    if (option === undefined || !option.available) {
      return this.unavailable(
        option?.unavailableReason
          ?? this.content.story.companion_management.texts.requirement_locked,
      );
    }
    const working = cloneGameState(state);
    const companion = this.requireActiveCompanion(working, companionId);
    const profile = this.requireProfile(companionId);
    this.operations.applyEffects(interaction.costs ?? [], working);
    const limits = this.content.story.defaults.limits;
    const trustMinimum = limits.trust_min;
    const trustMaximum = limits.trust_max;
    if (trustMinimum === undefined || trustMaximum === undefined) {
      throw new GameApplicationError(
        this.content.story.companion_management.texts.requirement_locked,
      );
    }
    companion.trust = Math.min(
      trustMaximum,
      Math.max(trustMinimum, companion.trust + interaction.trust_gain),
    );
    working.shelter.hope += interaction.hope_gain;
    companion.interaction_cooldown_turns = interaction.cooldown_turns;
    companion.interaction_count += 1;
    state.players = working.players;
    state.shelter = working.shelter;
    state.archive_collection_totals = working.archive_collection_totals;
    state.companions = working.companions;
    return {
      applied: true,
      consumesTurn: interaction.turns_consumed > 0,
      turnsConsumed: interaction.turns_consumed,
      messages: [formatTemplate(interaction.result_text, {
        companion_name: profile.name,
        trust_gain: interaction.trust_gain,
        hope_gain: interaction.hope_gain,
      })],
    };
  }

  /** 解析互动状态、冷却、需求和成本的第一个阻断原因。 */
  private interactionUnavailableReason(
    state: GameState,
    companion: CompanionState,
    requirements: Parameters<StoryService["requirementsMet"]>[0],
    costs: readonly NumericEffectConfig[],
  ): string {
    const texts = this.content.story.companion_management.texts;
    if (companion.status !== "active") return texts.unavailable_status;
    if (companion.interaction_cooldown_turns > 0) {
      return formatTemplate(texts.cooldown, {
        turns: companion.interaction_cooldown_turns,
      });
    }
    if (!this.story.requirementsMet(requirements, state)) {
      return texts.requirement_locked;
    }
    if (!this.canPay(state, costs)) return texts.insufficient_resources;
    return "";
  }

  /** 仅当所有固定扣除项均可支付时返回真。 */
  private canPay(state: GameState, costs: readonly NumericEffectConfig[]): boolean {
    return costs.every((cost) =>
      cost.operation === "subtract"
      && typeof cost.amount === "number"
      && Number.isInteger(cost.amount)
      && cost.amount >= 0
      && this.operations.read(cost.target, state) >= cost.amount,
    );
  }

  /** 返回指定槽位当前装备 ID。 */
  private equippedId(
    companion: CompanionState,
    slot: CompanionEquipmentSlot,
  ): string | null {
    return slot === "weapon"
      ? companion.equipped_weapon_id
      : companion.equipped_armor_id;
  }

  /** 更新指定槽位，槽位联合类型阻止写入其他字段。 */
  private writeEquippedId(
    companion: CompanionState,
    slot: CompanionEquipmentSlot,
    itemId: string | null,
  ): void {
    if (slot === "weapon") {
      companion.equipped_weapon_id = itemId;
    } else {
      companion.equipped_armor_id = itemId;
    }
  }

  /** 要求伙伴状态存在。 */
  private requireCompanion(state: GameState, companionId: string): CompanionState {
    const companion = findCompanion(state, companionId);
    if (companion === undefined) {
      throw new GameApplicationError(
        this.content.story.companion_management.texts.unavailable_status,
      );
    }
    return companion;
  }

  /** 要求伙伴已加入且可正常行动。 */
  private requireActiveCompanion(state: GameState, companionId: string): CompanionState {
    const companion = this.requireCompanion(state, companionId);
    if (companion.status !== "active") {
      throw new GameApplicationError(
        this.content.story.companion_management.texts.unavailable_status,
      );
    }
    return companion;
  }

  /** 按稳定 ID 返回伙伴档案。 */
  private requireProfile(companionId: string) {
    const profile = this.content.story.companions.find(
      (candidate) => candidate.companion_id === companionId,
    );
    if (profile === undefined) {
      throw new GameApplicationError(
        this.content.story.companion_management.texts.unavailable_status,
      );
    }
    return profile;
  }

  /** 构造不改变状态且不消耗时间的拒绝结果。 */
  private unavailable(message: string): ManagementResolution {
    return {
      messages: [message],
      applied: false,
      consumesTurn: false,
      turnsConsumed: 0,
    };
  }
}
