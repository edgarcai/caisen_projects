import type {
  EndingConfig,
  RequirementConfig,
  StoryChoiceConfig,
  StorySceneConfig,
} from "../domain/content";
import { formatTemplate } from "../domain/content";
import { StateOperationError, StoryError } from "../domain/errors";
import {
  activePlayer,
  addKeyItem,
  addStoryFlag,
  isEnded,
  type CompanionState,
  type EndingState,
  type GameState,
  type StoryState,
} from "../domain/game-state";
import type {
  StoryChoice,
  StoryPrompt,
  StoryResolution,
  StoryStatus,
} from "../domain/reports";
import type { GameContent } from "./GameContent";
import type { StateOperations } from "./StateOperations";

/** 管理稳定场景图、递归条件、伙伴、发现物和多结局。 */
export class StoryService {
  private readonly content: GameContent;
  private readonly operations: StateOperations;
  private readonly chapterById: ReadonlyMap<string, GameContent["story"]["chapters"][number]>;
  private readonly endingById: ReadonlyMap<string, EndingConfig>;

  /** 注入统一内容与受白名单保护的状态操作器。 */
  public constructor(content: GameContent, operations: StateOperations) {
    this.content = content;
    this.operations = operations;
    this.chapterById = new Map(
      content.story.chapters.map((chapter) => [chapter.chapter_id, chapter]),
    );
    this.endingById = new Map(
      content.story.endings.map((ending) => [ending.ending_id, ending]),
    );
  }

  /** 从剧情默认配置创建互不共享容器的新状态。 */
  public createStoryState(): StoryState {
    return structuredClone(this.content.story.defaults.story_state);
  }

  /** 从默认配置创建全部伙伴状态。 */
  public createCompanions(): CompanionState[] {
    return structuredClone([...this.content.story.defaults.companions]);
  }

  /** 复制全部设施的初始等级。 */
  public createFacilityLevels(): Record<string, number> {
    return { ...this.content.story.defaults.facility_levels };
  }

  /** 把当前场景转换为包含锁定原因的展示提示。 */
  public currentPrompt(state: GameState): StoryPrompt | null {
    if (isEnded(state) || state.story.current_scene_id === "") {
      return null;
    }
    const scene = this.content.scene(state.story.current_scene_id);
    const entryRequirements = scene.entry_requirements ?? [];
    const entryAvailable = this.requirementsMet(entryRequirements, state);
    const entryReason = entryAvailable ? "" : this.lockedReason(entryRequirements, state);
    const selectedRoute = this.selectedBossChoice(state, scene.scene_id);
    const choices: StoryChoice[] = scene.choices.map((choice) => {
      let available = entryAvailable && this.requirementsMet(choice.requirements ?? [], state);
      let lockedReason = "";
      if (selectedRoute !== null && selectedRoute !== choice.choice_id) {
        available = false;
        lockedReason = this.displayTemplate("boss_route_selected");
      } else if (!available) {
        lockedReason = entryReason || this.lockedReason(choice.requirements ?? [], state);
      }
      return {
        choiceId: choice.choice_id,
        label: choice.label,
        available,
        lockedReason,
      };
    });
    const chapter = this.chapter(scene.chapter_id);
    return {
      sceneId: scene.scene_id,
      chapterTitle: this.content.text("story_chapter_title_format", {
        chapter_number: chapter.number,
        chapter_title: chapter.title,
      }),
      title: scene.title,
      body: scene.body,
      objective: scene.objective,
      choices,
      lockedReason: entryReason,
    };
  }

  /** 返回指挥台需要的章节、任务和进度摘要。 */
  public status(state: GameState): StoryStatus {
    const completed = state.story.completed_scene_ids.length;
    const total = this.content.story.scenes.length;
    if (isEnded(state)) {
      const endingId = state.ending?.ending_id ?? "";
      return {
        chapterTitle: this.content.text("story_status_ending_chapter_title"),
        missionTitle: this.endingById.get(endingId)?.title ?? endingId,
        objective: this.content.text("story_status_ending_objective"),
        progressText: this.content.text("story_status_completion_format", { completed, total }),
      };
    }
    if (state.story.current_scene_id === "") {
      return {
        chapterTitle: this.content.text("story_status_epilogue_chapter_title"),
        missionTitle: this.content.text("story_status_epilogue_mission_title"),
        objective: this.content.text("story_status_epilogue_objective"),
        progressText: this.content.text("story_status_completion_format", { completed, total }),
      };
    }
    const scene = this.content.scene(state.story.current_scene_id);
    const chapter = this.chapter(scene.chapter_id);
    return {
      chapterTitle: this.content.text("story_chapter_title_format", {
        chapter_number: chapter.number,
        chapter_title: chapter.title,
      }),
      missionTitle: scene.title,
      objective: scene.objective,
      progressText: this.content.text("story_status_progress_format", {
        completed,
        total,
        evidence: state.story.evidence,
        humanity: state.story.humanity,
      }),
    };
  }

  /** 验证并结算剧情选择；首领场景只锁定路线。 */
  public resolveChoice(
    state: GameState,
    sceneId: string,
    choiceId: string,
  ): StoryResolution {
    if (isEnded(state)) {
      throw new StoryError(this.content.text("story_error_game_ended"));
    }
    if (state.battle !== null && !state.battle.retreated) {
      throw new StoryError(this.content.text("story_error_battle_unfinished"));
    }
    if (state.story.current_scene_id !== sceneId) {
      throw new StoryError(this.content.text("story_error_scene_mismatch", {
        current_scene_id: state.story.current_scene_id,
      }));
    }
    const scene = this.content.scene(sceneId);
    const choice = this.choice(scene, choiceId);
    if (!this.requirementsMet(scene.entry_requirements ?? [], state)) {
      return this.lockedResolution(scene.entry_requirements ?? [], state);
    }
    if (!this.requirementsMet(choice.requirements ?? [], state)) {
      return this.lockedResolution(choice.requirements ?? [], state);
    }
    const bossId = choice.boss_id ?? scene.boss_id ?? null;
    if (bossId !== null) {
      const selectedRoute = this.selectedBossChoice(state, sceneId);
      if (selectedRoute !== null && selectedRoute !== choiceId) {
        return {
          messages: [this.content.text("story_boss_route_already_selected")],
          applied: false,
          consumesTurn: false,
          bossId: null,
          bossOutcome: null,
        };
      }
      if (selectedRoute === null) {
        addStoryFlag(state, this.bossRouteFlag(sceneId, choiceId));
      }
      const boss = this.content.boss(bossId);
      return {
        messages: [this.content.text("story_boss_encounter_format", {
          choice_label: choice.label,
          boss_name: boss.name,
        })],
        applied: true,
        consumesTurn: false,
        bossId,
        bossOutcome: choice.boss_resolution ?? "resolved",
      };
    }
    return {
      messages: this.applyCompletedChoice(state, scene, choice),
      applied: true,
      consumesTurn: !isEnded(state),
      bossId: null,
      bossOutcome: null,
    };
  }

  /** 在首领战胜利后发放已锁定路线的效果并推进场景。 */
  public completeBoss(state: GameState, bossId: string): StoryResolution {
    const scene = this.content.scene(state.story.current_scene_id);
    if (scene.boss_id !== bossId) {
      throw new StoryError(this.content.text("story_error_boss_scene_mismatch", {
        boss_id: bossId,
      }));
    }
    const choiceId = this.selectedBossChoice(state, scene.scene_id);
    if (choiceId === null) {
      throw new StoryError(this.content.text("story_error_boss_route_missing"));
    }
    const choice = this.choice(scene, choiceId);
    const messages = this.applyCompletedChoice(state, scene, choice);
    const outcome = choice.boss_resolution ?? "resolved";
    state.story.boss_outcomes[bossId] = outcome;
    this.removeBossRoute(state, scene.scene_id);
    messages.unshift(this.content.text("story_boss_route_resolved_format", {
      boss_name: this.content.boss(bossId).name,
      choice_label: choice.label,
    }));
    return {
      messages,
      applied: true,
      consumesTurn: true,
      bossId,
      bossOutcome: outcome,
    };
  }

  /** 成功撤退后清除未结算路线，允许玩家重选战术。 */
  public abandonBossRoute(state: GameState, bossId: string): void {
    const scene = this.content.scene(state.story.current_scene_id);
    if (scene.boss_id === bossId) {
      this.removeBossRoute(state, scene.scene_id);
    }
  }

  /** 递归检查资源、标记、线索、设施和首领结果条件。 */
  public requirementsMet(
    requirements: readonly RequirementConfig[],
    state: GameState,
  ): boolean {
    for (const requirement of requirements) {
      if (requirement.type === "any_of") {
        const nested = requirement.requirements ?? [];
        if (!nested.some((item) => this.requirementsMet([item], state))) {
          return false;
        }
        continue;
      }
      if (requirement.type === "all_of") {
        if (!this.requirementsMet(requirement.requirements ?? [], state)) {
          return false;
        }
        continue;
      }
      if (!this.requirementMet(requirement, state)) {
        return false;
      }
    }
    return true;
  }

  /** 生成伙伴身份、状态、信任与秘密提示文本。 */
  public companionSummary(state: GameState): string {
    const statusLabels: Record<string, string> = {
      active: this.content.text("companion_status_active"),
      locked: this.content.text("companion_status_locked"),
      exiled: this.content.text("companion_status_exiled"),
      lost: this.content.text("companion_status_lost"),
      dead: this.content.text("companion_status_dead"),
    };
    const secretUnlockTrust = this.companionSecretUnlockTrust();
    return state.companions
      .map((companion) => {
        const profile = this.content.story.companions.find(
          (candidate) => candidate.companion_id === companion.companion_id,
        );
        if (profile === undefined) {
          throw new StoryError(this.content.text("story_error_unknown_companion_profile", {
            companion_id: companion.companion_id,
          }));
        }
        const secret = companion.trust >= secretUnlockTrust
          ? profile.secret
          : this.content.text("companion_secret_locked_format", {
            required_trust: secretUnlockTrust,
          });
        return this.content.text("companion_summary_format", {
          companion_name: profile.name,
          companion_role: profile.role,
          status_label: statusLabels[companion.status] ?? companion.status,
          trust: companion.trust,
          introduction: profile.introduction,
          secret,
        });
      })
      .join(this.content.text("companion_summary_separator"));
  }

  /** 读取当前首领路线的起始生命百分比修正。 */
  public bossStartingHealthPercent(state: GameState, bossId: string): number {
    const rules = this.content.story.combat.rules;
    const minimum = this.numericRule(rules, "minimum_starting_health_percent");
    const maximum = this.numericRule(rules, "maximum_starting_health_percent");
    const target = `battle.${bossId}.starting_health_percent`;
    let percent = 100;
    const prefix = `battle_modifier::${target}::`;
    for (const flag of state.story.flags) {
      if (!flag.startsWith(prefix)) {
        continue;
      }
      const suffix = flag.slice(prefix.length).split("::");
      const operation = suffix[0];
      const rawAmount = suffix[1];
      if (operation !== undefined && rawAmount !== undefined) {
        percent = this.applyPercent(percent, operation, Number(rawAmount));
      }
    }
    const scene = this.content.scene(state.story.current_scene_id);
    const choiceId = this.selectedBossChoice(state, scene.scene_id);
    if (choiceId !== null) {
      const choice = this.choice(scene, choiceId);
      for (const effect of choice.effects ?? []) {
        if (effect.target === target) {
          const amount = typeof effect.amount === "number" ? effect.amount : effect.amount[0];
          percent = this.applyPercent(percent, effect.operation, amount);
        }
      }
    }
    return Math.max(minimum, Math.min(percent, maximum));
  }

  /** 应用非战斗效果、标记、发现物和场景跳转。 */
  private applyCompletedChoice(
    state: GameState,
    scene: StorySceneConfig,
    choice: StoryChoiceConfig,
  ): string[] {
    const effects = choice.effects ?? [];
    const regularEffects = effects.filter((effect) => {
      const root = effect.target.split(".")[0];
      return root !== "battle" && root !== "rules";
    });
    try {
      this.operations.applyEffects(regularEffects, state);
    } catch (error: unknown) {
      if (error instanceof StateOperationError) {
        throw new StoryError(this.content.text("story_error_effect_application_failed", {
          error: error.message,
        }));
      }
      throw error;
    }
    for (const effect of effects) {
      if (effect.target.startsWith("battle.") && typeof effect.amount === "number") {
        addStoryFlag(
          state,
          `battle_modifier::${effect.target}::${effect.operation}::${String(effect.amount)}`,
        );
      }
    }
    for (const flag of choice.add_flags ?? []) {
      addStoryFlag(state, flag);
    }
    for (const itemId of choice.add_key_items ?? []) {
      addKeyItem(state, itemId);
    }
    if (!state.story.completed_scene_ids.includes(scene.scene_id)) {
      state.story.completed_scene_ids.push(scene.scene_id);
    }
    this.syncCompanionStatuses(state);
    const messages = [choice.result_text, ...this.discoveryMessages(scene.scene_id, choice.choice_id, state)];
    const nextSceneId = choice.next_scene_id ?? scene.next_scene_id ?? null;
    if (nextSceneId !== null) {
      const nextScene = this.content.scene(nextSceneId);
      state.story.current_scene_id = nextSceneId;
      state.story.chapter_id = nextScene.chapter_id;
    } else {
      state.story.current_scene_id = "";
      state.ending = this.resolveEnding(state, choice.ending_id);
      messages.push(state.ending.message);
    }
    this.normalizeStoryValues(state);
    return messages;
  }

  /** 检查一个已经结构校验的叶子条件。 */
  private requirementMet(requirement: RequirementConfig, state: GameState): boolean {
    switch (requirement.type) {
      case "scene_completed":
        return state.story.completed_scene_ids.includes(this.requiredString(requirement.scene_id));
      case "flag":
        return state.story.flags.includes(this.requiredString(requirement.flag_id));
      case "flag_absent":
        return !state.story.flags.includes(this.requiredString(requirement.flag_id));
      case "key_item":
        return state.story.key_items.includes(this.requiredString(requirement.key_item_id));
      case "any_key_item":
        return (requirement.key_item_ids ?? []).some((id) => state.story.key_items.includes(id));
      case "boss_resolved":
        return state.story.boss_outcomes[this.requiredString(requirement.boss_id)] !== undefined;
      case "boss_outcome_any": {
        const outcome = state.story.boss_outcomes[this.requiredString(requirement.boss_id)];
        return outcome !== undefined && (requirement.outcomes ?? []).includes(outcome);
      }
      case "facility_level": {
        const current = state.facility_levels[this.requiredString(requirement.facility_id)] ?? 0;
        return this.compare(current, requirement.operator ?? "gte", this.requiredNumber(requirement.value));
      }
      case "attribute":
      case "computed_attribute":
        return this.compare(
          this.readRequirementTarget(this.requiredString(requirement.target), state),
          requirement.operator ?? "gte",
          this.requiredNumber(requirement.value),
        );
      default:
        throw new StoryError(this.content.text("story_error_unsupported_requirement_type", {
          requirement_type: requirement.type,
        }));
    }
  }

  /** 读取剧情条件允许的数值或战斗力派生值。 */
  private readRequirementTarget(target: string, state: GameState): number {
    if (target === "active_player.combat_power") {
      const player = activePlayer(state);
      return player.attack + player.defense + player.agility;
    }
    try {
      return this.operations.read(target, state);
    } catch (error: unknown) {
      if (error instanceof StateOperationError) {
        throw new StoryError(this.content.text("story_error_invalid_requirement_target", { target }));
      }
      throw error;
    }
  }

  /** 使用配置声明的整数比较运算检查条件。 */
  private compare(current: number, operator: string, expected: number): boolean {
    switch (operator) {
      case "gte": return current >= expected;
      case "lte": return current <= expected;
      case "gt": return current > expected;
      case "lt": return current < expected;
      case "eq": return current === expected;
      case "neq": return current !== expected;
      default: throw new StoryError(this.content.text(
        "story_error_unsupported_requirement_operator",
        { operator },
      ));
    }
  }

  /** 按优先级选择唯一结局，并使用选择建议值兜底。 */
  private resolveEnding(state: GameState, suggestedEndingId?: string): EndingState {
    const selected = [...this.content.story.endings]
      .sort((left, right) => right.priority - left.priority)
      .find((ending) => this.requirementsMet(ending.requirements ?? [], state))
      ?? (suggestedEndingId === undefined ? undefined : this.endingById.get(suggestedEndingId))
      ?? this.endingById.get(this.content.story.ending_resolution.fallback_ending_id);
    if (selected === undefined) {
      throw new StoryError(this.content.text("story_error_missing_fallback_ending"));
    }
    return {
      ending_id: selected.ending_id,
      outcome: "victory",
      message: this.content.text("story_ending_message_format", {
        ending_title: selected.title,
        ending_body: selected.body,
        epilogue_title: selected.epilogue_title,
      }),
    };
  }

  /** 依据剧情标记同步伙伴的加入、离队、失联或牺牲状态。 */
  private syncCompanionStatuses(state: GameState): void {
    for (const companion of state.companions) {
      const id = companion.companion_id;
      if (state.story.flags.includes(`${id}_dead`)) {
        companion.status = "dead";
      } else if (state.story.flags.includes(`${id}_lost`)) {
        companion.status = "lost";
      } else if (state.story.flags.includes(`${id}_exiled`)) {
        companion.status = "exiled";
      } else if (state.story.flags.includes(`${id}_joined`)) {
        companion.status = "active";
      }
    }
  }

  /** 按剧情配置钳制人性、证据、感染压力和伙伴信任。 */
  private normalizeStoryValues(state: GameState): void {
    const limits = this.content.story.defaults.limits;
    state.story.humanity = this.clamp(
      state.story.humanity,
      this.limit(limits, "humanity_min"),
      this.limit(limits, "humanity_max"),
    );
    state.story.evidence = this.clamp(
      state.story.evidence,
      this.limit(limits, "evidence_min"),
      this.limit(limits, "evidence_max"),
    );
    state.story.infection_pressure = this.clamp(
      state.story.infection_pressure,
      this.limit(limits, "infection_pressure_min"),
      this.limit(limits, "infection_pressure_max"),
    );
    for (const companion of state.companions) {
      companion.trust = this.clamp(
        companion.trust,
        this.limit(limits, "trust_min"),
        this.limit(limits, "trust_max"),
      );
    }
  }

  /** 为本次选择新获得的发现物生成揭示文案。 */
  private discoveryMessages(sceneId: string, choiceId: string, state: GameState): string[] {
    return this.content.story.discoveries
      .filter((discovery) =>
        discovery.source_scene_id === sceneId
        && discovery.source_choice_ids.includes(choiceId)
        && state.story.key_items.includes(discovery.discovery_id))
      .map((discovery) => this.content.text("story_discovery_message_format", {
        discovery_name: discovery.name,
        discovery_description: discovery.description,
      }));
  }

  /** 创建一个不修改状态也不消耗回合的锁定结果。 */
  private lockedResolution(
    requirements: readonly RequirementConfig[],
    state: GameState,
  ): StoryResolution {
    return {
      messages: [this.displayTemplate("locked_message", { reason: this.lockedReason(requirements, state) })],
      applied: false,
      consumesTurn: false,
      bossId: null,
      bossOutcome: null,
    };
  }

  /** 递归生成当前未满足条件的可执行中文说明。 */
  private lockedReason(requirements: readonly RequirementConfig[], state: GameState): string {
    const unmet = requirements.filter((requirement) => !this.requirementsMet([requirement], state));
    if (unmet.length === 0) {
      return this.displayTemplate("empty");
    }
    const descriptions = unmet.map((requirement) => this.describeRequirement(requirement, state));
    return descriptions.length === 1
      ? descriptions[0] ?? this.displayTemplate("empty")
      : this.displayTemplate("all_of", {
        requirements: descriptions.join(this.content.story.requirement_display.separators.all_of),
      });
  }

  /** 把一个数值或结构化条件转换为中文说明。 */
  private describeRequirement(requirement: RequirementConfig, state: GameState): string {
    const display = this.content.story.requirement_display;
    if (requirement.type === "all_of" || requirement.type === "any_of") {
      const nested = requirement.type === "all_of"
        ? (requirement.requirements ?? []).filter((item) => !this.requirementsMet([item], state))
        : requirement.requirements ?? [];
      return this.displayTemplate(requirement.type, {
        requirements: nested
          .map((item) => this.describeRequirement(item, state))
          .join(
            display.separators[requirement.type]
            ?? this.content.text("story_requirement_fallback_separator"),
          ),
      });
    }
    if (requirement.type === "attribute" || requirement.type === "computed_attribute") {
      const target = this.requiredString(requirement.target);
      return this.numericRequirement(
        requirement.type,
        display.target_names[target] ?? target,
        requirement,
      );
    }
    if (requirement.type === "facility_level") {
      const facilityId = this.requiredString(requirement.facility_id);
      const facilityName = this.content.story.facilities.find(
        (facility) => facility.facility_id === facilityId,
      )?.name ?? facilityId;
      return this.numericRequirement("facility_level", facilityName, requirement);
    }
    if (requirement.type === "scene_completed") {
      return this.displayTemplate("scene_completed", {
        scene_name: this.content.scene(this.requiredString(requirement.scene_id)).title,
      });
    }
    if (requirement.type === "flag" || requirement.type === "flag_absent") {
      const id = this.requiredString(requirement.flag_id);
      return this.displayTemplate(requirement.type, { flag_name: display.flag_names[id] ?? id });
    }
    if (requirement.type === "key_item") {
      const id = this.requiredString(requirement.key_item_id);
      return this.displayTemplate("key_item", { key_item_name: display.key_item_names[id] ?? id });
    }
    if (requirement.type === "any_key_item") {
      const names = (requirement.key_item_ids ?? []).map((id) => display.key_item_names[id] ?? id);
      return this.displayTemplate("any_key_item", { key_item_names: names.join(display.separators.items) });
    }
    if (requirement.type === "boss_resolved") {
      return this.displayTemplate("boss_resolved", {
        boss_name: this.content.boss(this.requiredString(requirement.boss_id)).name,
      });
    }
    if (requirement.type === "boss_outcome_any") {
      const names = (requirement.outcomes ?? []).map((id) => display.boss_outcome_names[id] ?? id);
      return this.displayTemplate("boss_outcome_any", {
        boss_name: this.content.boss(this.requiredString(requirement.boss_id)).name,
        outcome_names: names.join(display.separators.items),
      });
    }
    throw new StoryError(this.content.text(
      "story_error_unsupported_requirement_description",
      { requirement_type: requirement.type },
    ));
  }

  /** 使用目标名、运算符和阈值格式化数值条件。 */
  private numericRequirement(
    template: string,
    targetName: string,
    requirement: RequirementConfig,
  ): string {
    const operator = requirement.operator ?? "gte";
    return this.displayTemplate(template, {
      target_name: targetName,
      facility_name: targetName,
      operator_name: this.content.story.requirement_display.operators[operator] ?? operator,
      value: this.requiredNumber(requirement.value),
    });
  }

  /** 格式化经配置校验的条件展示模板。 */
  private displayTemplate(
    name: string,
    values: Readonly<Record<string, string | number>> = {},
  ): string {
    const template = this.content.story.requirement_display.templates[name];
    if (template === undefined) {
      throw new StoryError(this.content.text("story_error_missing_requirement_display_template", {
        template_name: name,
      }));
    }
    return formatTemplate(template, values);
  }

  /** 返回稳定章节 ID 对应的章节配置。 */
  private chapter(chapterId: string): GameContent["story"]["chapters"][number] {
    const chapter = this.chapterById.get(chapterId);
    if (chapter === undefined) {
      throw new StoryError(this.content.text("story_error_unknown_chapter", {
        chapter_id: chapterId,
      }));
    }
    return chapter;
  }

  /** 在指定场景中查找选择并拒绝伪造 ID。 */
  private choice(scene: StorySceneConfig, choiceId: string): StoryChoiceConfig {
    const choice = scene.choices.find((candidate) => candidate.choice_id === choiceId);
    if (choice === undefined) {
      throw new StoryError(this.content.text("story_error_choice_not_found", {
        scene_id: scene.scene_id,
        choice_id: choiceId,
      }));
    }
    return choice;
  }

  /** 生成不会与普通剧情标记冲突的首领路线标记。 */
  private bossRouteFlag(sceneId: string, choiceId: string): string {
    return `boss_route::${sceneId}::${choiceId}`;
  }

  /** 从持久化标记中恢复已锁定的首领路线。 */
  private selectedBossChoice(state: GameState, sceneId: string): string | null {
    const prefix = `boss_route::${sceneId}::`;
    const flag = state.story.flags.find((candidate) => candidate.startsWith(prefix));
    return flag === undefined ? null : flag.slice(prefix.length);
  }

  /** 删除指定场景的未结算首领路线标记。 */
  private removeBossRoute(state: GameState, sceneId: string): void {
    const prefix = `boss_route::${sceneId}::`;
    state.story.flags = state.story.flags.filter((flag) => !flag.startsWith(prefix));
  }

  /** 对首领生命百分比应用加、减或设置操作。 */
  private applyPercent(current: number, operation: string, amount: number): number {
    if (operation === "add") return current + amount;
    if (operation === "subtract") return current - amount;
    if (operation === "set") return amount;
    throw new StoryError(this.content.text(
      "story_error_unsupported_battle_percent_operation",
      { operation },
    ));
  }

  /** 读取战斗配置中的整数规则。 */
  private numericRule(
    rules: GameContent["story"]["combat"]["rules"],
    key: string,
  ): number {
    const value = rules[key];
    if (typeof value !== "number") {
      throw new StoryError(this.content.text("story_error_combat_rule_not_integer", {
        rule_key: key,
      }));
    }
    return value;
  }

  /** 要求可选配置值是非空字符串。 */
  private requiredString(value: string | undefined): string {
    if (value === undefined || value === "") {
      throw new StoryError(this.content.text("story_error_missing_requirement_string"));
    }
    return value;
  }

  /** 要求可选配置值是有限数字。 */
  private requiredNumber(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
      throw new StoryError(this.content.text("story_error_missing_requirement_number"));
    }
    return value;
  }

  /** 从限制配置中读取必需整数。 */
  private limit(limits: Record<string, number>, key: string): number {
    const value = limits[key];
    if (value === undefined) {
      throw new StoryError(this.content.text("story_error_missing_story_limit", {
        limit_key: key,
      }));
    }
    return value;
  }

  /** 从主配置中读取并校验伙伴秘密解锁的信任阈值。 */
  private companionSecretUnlockTrust(): number {
    const threshold = this.content.game.rules.companion_secret_unlock_trust;
    if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 0) {
      throw new StoryError(this.content.text(
        "story_error_invalid_companion_secret_unlock_trust",
      ));
    }
    return threshold;
  }

  /** 把数值钳制在配置上下限之间。 */
  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(value, maximum));
  }
}
