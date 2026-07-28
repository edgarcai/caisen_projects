import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

interface E2eWebConfig {
  readonly responsive: {
    readonly resize_debounce_ms: number;
    readonly keyboard_resize_settle_ms: number;
  };
  readonly motion: {
    readonly cover_menu_description_delay_ms: number;
  };
  readonly assets: {
    readonly cover_themes: {
      readonly default_id: string;
    };
  };
  readonly new_game_setup: {
    readonly name_input: {
      readonly html_type: string;
      readonly input_mode: string;
      readonly language: string;
      readonly enter_key_hint: string;
      readonly autocomplete: string;
      readonly autocapitalize: string;
      readonly spellcheck: boolean;
    };
  };
  readonly guided_tutorial: {
    readonly steps: readonly {
      readonly target_test_id: string;
    }[];
  };
  readonly storage: {
    readonly key: string;
    readonly backup_slots: number;
    readonly save_slot_count: number;
    readonly settings_key: string;
    readonly settings_schema_version: number;
    readonly achievement_key: string;
    readonly achievement_schema_version: number;
  };
  readonly failure_flow: {
    readonly forced_return_delay_ms: number;
  };
  readonly texts: {
    readonly profile_name_label: string;
  };
  readonly quality_assurance: {
    readonly minimum_touch_css_px: number;
    readonly keyboard_simulated_height_px: number;
    readonly keyboard_minimum_viewport_height_px: number;
    readonly scroll_drag_ratio: number;
    readonly scroll_drag_steps: number;
    readonly scroll_max_attempts: number;
    readonly scroll_settle_ms: number;
  };
}

interface E2eExpeditionBranchingEventsConfig {
  readonly policy: {
    readonly capacity_policy: readonly number[];
    readonly visible_choice_minimum: number;
    readonly visible_choice_maximum: number;
    readonly minimum_depth: number;
    readonly maximum_depth: number;
  };
}

interface E2eSurvivalSystemsConfig {
  readonly expedition: {
    readonly action_food_item_id: string;
    readonly food_units_per_action: number;
  };
}

interface E2eCoopConfig {
  readonly account_storage_key: string;
}

/** 从权威 H5 配置读取移动端测试阈值，避免测试复制产品参数。 */
function loadE2eWebConfig(): E2eWebConfig {
  const configPath = resolve(
    import.meta.dirname,
    "../../config/web_config.json",
  );
  return JSON.parse(readFileSync(configPath, "utf8")) as E2eWebConfig;
}

/** 读取远征语义分支的层级容量与可见选项策略。 */
function loadE2eExpeditionBranchingEventsConfig(): E2eExpeditionBranchingEventsConfig {
  const configPath = resolve(
    import.meta.dirname,
    "../../config/expedition_branching_events.json",
  );
  return JSON.parse(
    readFileSync(configPath, "utf8"),
  ) as E2eExpeditionBranchingEventsConfig;
}

/** 读取远征行动的食物物品与单次消耗换算。 */
function loadE2eSurvivalSystemsConfig(): E2eSurvivalSystemsConfig {
  const configPath = resolve(
    import.meta.dirname,
    "../../config/survival_systems.json",
  );
  return JSON.parse(readFileSync(configPath, "utf8")) as E2eSurvivalSystemsConfig;
}

/** 读取账户与联机持久化键，验证失败删档不会越界清理元数据。 */
function loadE2eCoopConfig(): E2eCoopConfig {
  const configPath = resolve(import.meta.dirname, "../../config/coop.json");
  return JSON.parse(readFileSync(configPath, "utf8")) as E2eCoopConfig;
}

const webConfigDocument = loadE2eWebConfig();
const expeditionBranchingConfigDocument =
  loadE2eExpeditionBranchingEventsConfig();
const survivalSystemsConfigDocument = loadE2eSurvivalSystemsConfig();
const coopConfigDocument = loadE2eCoopConfig();
const qualityConfig = webConfigDocument.quality_assurance;
const responsiveConfig = webConfigDocument.responsive;
const failureMetadataValues = {
  settings: JSON.stringify({
    schema_version: webConfigDocument.storage.settings_schema_version,
    reduced_motion: false,
    selected_cover_theme_id: webConfigDocument.assets.cover_themes.default_id,
  }),
  achievements: JSON.stringify({
    schema_version: webConfigDocument.storage.achievement_schema_version,
    unlocked_achievement_ids: [],
  }),
  account: JSON.stringify({
    accountId: "qa-failure-account",
    displayName: "删档隔离所长",
  }),
} as const;

interface DebugNodeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
}

type CssNodeBounds = Omit<DebugNodeBounds, "stageWidth" | "stageHeight">;

interface DebugEncounterPreparation {
  readonly encounter_id: string;
  readonly members: readonly { readonly member_id: string }[];
  readonly roles: readonly { readonly role_id: string }[];
}

interface DebugEncounterAvailableAction {
  readonly action: "attack" | "guard" | "skill" | "item" | "retreat";
  readonly abilityId: string | null;
  readonly available: boolean;
  readonly targetIds: readonly string[];
}

interface DebugEncounterBattleState {
  readonly round_number: number;
  readonly outcome: "ongoing" | "victory" | "defeat" | "retreated";
  readonly pending_party_member_ids: readonly string[];
  readonly party: readonly {
    readonly member_id: string;
    readonly row: "front" | "back";
    readonly health: number;
  }[];
  readonly enemies: readonly {
    readonly enemy_id: string;
    readonly row: "front" | "back";
    readonly health: number;
  }[];
  readonly log: readonly {
    readonly round_number: number;
    readonly message: string;
  }[];
}

interface BrowserGameDebugHandle {
  getCurrentScreen(): string;
  getRouteScreens(): readonly string[];
  getNodeBounds(nodeName: string): DebugNodeBounds | null;
  getSnapshot(): {
    readonly mode: "single" | "multiplayer" | "story" | "endless" | null;
    readonly activePlayer: { readonly name: string } | null;
    readonly clock: { readonly turnLabel: string } | null;
    readonly campaignProfileOptions: {
      readonly difficulties: readonly DebugCampaignOption[];
      readonly origins: readonly DebugCampaignOption[];
      readonly traits: readonly DebugCampaignOption[];
      readonly cities: readonly DebugCampaignOption[];
      readonly defaultSelection: {
        readonly difficultyId: string;
        readonly originId: string;
        readonly traitId: string;
        readonly homeCityId: string;
      };
    };
    readonly campaignProfile: {
      readonly difficultyLabel: string;
      readonly originLabel: string;
      readonly traitLabel: string;
      readonly homeCityLabel: string;
      readonly districtLabel: string;
    } | null;
    readonly saveSlots: readonly {
      readonly slotId: number;
      readonly status: "empty" | "valid" | "recoverable" | "corrupted";
      readonly loadable: boolean;
      readonly writable: boolean;
    }[];
    readonly cities: readonly {
      readonly id: string;
      readonly disabled: boolean;
      readonly description: string;
      readonly travelStepCost: number;
      readonly districts: readonly {
        readonly id: string;
        readonly code: string;
        readonly name: string;
        readonly description: string;
        readonly eventStepCost: number;
        readonly eventLabels: readonly string[];
      }[];
    }[];
    readonly storyPrompt: { readonly id: string } | null;
    readonly explorationPrompt: {
      readonly id: string;
      readonly title: string;
      readonly options: readonly { readonly id: string; readonly disabled: boolean }[];
    } | null;
    readonly expeditionStatus: {
      readonly cityId: string;
      readonly districtId: string;
      readonly travelStepCost: number;
      readonly remainingSteps: number;
      readonly maximumSteps: number;
    } | null;
    readonly returnIncident: {
      readonly incidentId: string;
      readonly choices: readonly {
        readonly choiceId: string;
        readonly available: boolean;
      }[];
    } | null;
    readonly encounterCatalog: {
      readonly encounters: readonly {
        readonly encounterId: string;
        readonly available: boolean;
      }[];
    } | null;
    readonly encounterPreparations: Readonly<Record<string, {
      readonly preparation: DebugEncounterPreparation;
    }>>;
    readonly encounterBattle: {
      readonly state: DebugEncounterBattleState;
      readonly actionsByActor: Readonly<
        Record<string, readonly DebugEncounterAvailableAction[]>
      >;
    } | null;
    readonly ending: {
      readonly title: string;
      readonly body: string;
    } | null;
    readonly endingOutcome: "victory" | "failure" | null;
  };
}

/** 浏览器快照中的单个开局档案选项。 */
interface DebugCampaignOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

type DebugGameSnapshot = ReturnType<BrowserGameDebugHandle["getSnapshot"]>;
type DebugExpeditionCity = DebugGameSnapshot["cities"][number];
type DebugExpeditionDistrict = DebugExpeditionCity["districts"][number];
type GameLayoutKind = "mobile" | "compact" | "desktop";
type TestGameMode = "single" | "story";

/** 等待 Laya 页面栈进入指定稳定页面。 */
async function waitForScreen(page: Page, screen: string): Promise<void> {
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameScreen ?? null,
  )).toBe(screen);
}

/** 读取并校验页面公布的三态响应式布局标识。 */
async function readGameLayout(page: Page): Promise<GameLayoutKind> {
  const layout = await page.evaluate(() => document.body.dataset.gameLayout ?? null);
  if (layout !== "mobile" && layout !== "compact" && layout !== "desktop") {
    throw new Error(`游戏布局标识无效：${String(layout)}`);
  }
  return layout;
}

/** 读取页面组合根暴露的只读诊断接口。 */
async function readDebugSnapshot(
  page: Page,
): Promise<DebugGameSnapshot> {
  return page.evaluate(() => {
    const debug = window.__SHELTER_GAME__;
    if (debug === undefined) {
      throw new Error("游戏只读诊断接口尚未就绪。");
    }
    return debug.getSnapshot();
  });
}

/** 读取页面组合根公布的只读路由栈快照。 */
async function readDebugRouteScreens(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debug = window.__SHELTER_GAME__;
    if (debug === undefined) {
      throw new Error("游戏只读诊断接口尚未就绪。");
    }
    return debug.getRouteScreens();
  });
}

/** 把 Laya 舞台节点中心映射到真实 Canvas，并提交一次用户点击。 */
async function clickLayaNode(page: Page, nodeName: string): Promise<void> {
  const position = await page.evaluate((requestedName) => {
    const debug = window.__SHELTER_GAME__;
    const canvas = document.querySelector<HTMLCanvasElement>("#layaCanvas");
    const bounds = debug?.getNodeBounds(requestedName) ?? null;
    if (canvas === null || bounds === null) {
      return null;
    }
    const rectangle = canvas.getBoundingClientRect();
    return {
      clientX: rectangle.left +
        ((bounds.x + bounds.width / 2) / bounds.stageWidth) * rectangle.width,
      clientY: rectangle.top +
        ((bounds.y + bounds.height / 2) / bounds.stageHeight) * rectangle.height,
      hasTouch: navigator.maxTouchPoints > 0,
    };
  }, nodeName);
  if (position === null) {
    throw new Error(`找不到可点击的 Laya 节点：${nodeName}`);
  }
  if (position.hasTouch) {
    await page.touchscreen.tap(position.clientX, position.clientY);
    return;
  }
  await page.mouse.click(position.clientX, position.clientY);
}

/** 读取指定 Laya 节点的舞台边界。 */
async function readLayaNodeBounds(
  page: Page,
  nodeName: string,
): Promise<DebugNodeBounds | null> {
  return page.evaluate((requestedName) =>
    window.__SHELTER_GAME__?.getNodeBounds(requestedName) ?? null,
  nodeName);
}

/** 断言携带物的减号、数量与加号按从左到右顺序分离显示。 */
async function expectExpeditionCarryControlGeometry(
  page: Page,
  itemId: string,
): Promise<void> {
  const prefix = `page-expedition-item-${itemId}`;
  const [row, decrease, label, increase] = await Promise.all([
    readLayaNodeBounds(page, prefix),
    readLayaNodeBounds(page, `${prefix}-decrease`),
    readLayaNodeBounds(page, `${prefix}-label`),
    readLayaNodeBounds(page, `${prefix}-increase`),
  ]);
  if (row === null || decrease === null || label === null || increase === null) {
    throw new Error(`携带物 ${itemId} 缺少三段式数量控件。`);
  }
  expect(decrease.width).toBeGreaterThan(0);
  expect(label.width).toBeGreaterThan(0);
  expect(increase.width).toBeGreaterThan(0);
  expect(decrease.x).toBeGreaterThanOrEqual(row.x);
  expect(decrease.x + decrease.width).toBeLessThanOrEqual(label.x);
  expect(label.x + label.width).toBeLessThanOrEqual(increase.x);
  expect(increase.x + increase.width).toBeLessThanOrEqual(row.x + row.width);
}

/** 验证 ESC 四项顺序、同尺寸，以及竖屏直列或宽屏阶梯的响应式契约。 */
async function expectFunctionMenuGeometry(page: Page): Promise<void> {
  const optionNames = [
    "page-function-menu-option-save",
    "page-function-menu-option-settings",
    "page-function-menu-option-rollback",
    "page-function-menu-option-exit",
  ] as const;
  const optionBounds = await Promise.all(
    optionNames.map(async (name) => readLayaNodeBounds(page, name)),
  );
  if (optionBounds.some((bounds) => bounds === null)) {
    throw new Error("ESC 功能菜单缺少主选项节点。");
  }
  const resolvedBounds = optionBounds as DebugNodeBounds[];
  const firstBounds = resolvedBounds[0];
  if (firstBounds === undefined) {
    throw new Error("ESC 功能菜单没有可比较的主选项。");
  }
  expect(resolvedBounds.every((bounds) => (
    bounds.width === firstBounds.width && bounds.height === firstBounds.height
  ))).toBe(true);
  for (let index = 1; index < resolvedBounds.length; index += 1) {
    const previous = resolvedBounds[index - 1];
    const current = resolvedBounds[index];
    if (previous === undefined || current === undefined) {
      throw new Error("ESC 功能菜单选项顺序不完整。");
    }
    expect(current.y).toBeGreaterThan(previous.y);
  }
  const usesStraightColumn = await page.evaluate(() => (
    document.body.dataset.gameLayout === "mobile"
      || (
        document.body.dataset.gameLayout === "compact"
        && window.innerHeight > window.innerWidth
      )
  ));
  if (usesStraightColumn) {
    expect(new Set(resolvedBounds.map((bounds) => bounds.x)).size).toBe(1);
  } else {
    for (let index = 1; index < resolvedBounds.length; index += 1) {
      const previous = resolvedBounds[index - 1];
      const current = resolvedBounds[index];
      if (previous === undefined || current === undefined) continue;
      expect(current.x).toBeGreaterThan(previous.x);
    }
  }
  expect(await readLayaNodeBounds(page, "function-menu-continue")).not.toBeNull();
}

/** 将 Laya 舞台边界换算为浏览器 CSS 像素边界。 */
async function readCssNodeBounds(
  page: Page,
  nodeName: string,
): Promise<CssNodeBounds | null> {
  return page.evaluate((requestedName) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#layaCanvas");
    const bounds = window.__SHELTER_GAME__?.getNodeBounds(requestedName) ?? null;
    if (canvas === null || bounds === null) {
      return null;
    }
    const rectangle = canvas.getBoundingClientRect();
    const scaleX = rectangle.width / bounds.stageWidth;
    const scaleY = rectangle.height / bounds.stageHeight;
    return {
      x: rectangle.left + bounds.x * scaleX,
      y: rectangle.top + bounds.y * scaleY,
      width: bounds.width * scaleX,
      height: bounds.height * scaleY,
    };
  }, nodeName);
}

/** 以真实点击中心是否进入滚动视口判断目标可操作性。 */
function isScrollableTargetReady(
  target: CssNodeBounds,
  viewport: CssNodeBounds,
): boolean {
  const viewportBottom = viewport.y + viewport.height;
  const targetCenter = target.y + target.height / 2;
  return targetCenter >= viewport.y && targetCenter <= viewportBottom;
}

/** 按设备能力在 Canvas 上执行鼠标或原生 TouchEvent 拖动。 */
async function dragLayaCanvas(
  page: Page,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): Promise<void> {
  const hasTouch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (!hasTouch) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, {
      steps: qualityConfig.scroll_drag_steps,
    });
    await page.mouse.up();
    return;
  }
  await page.evaluate(({ startPoint, endPoint, steps }) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#layaCanvas");
    if (canvas === null) {
      throw new Error("页面缺少 Laya Canvas，无法执行触控滚动");
    }

    /** 创建供 Laya 输入管理器消费的单指触点。 */
    const createTouch = (x: number, y: number): Touch => new Touch({
      identifier: 0,
      target: canvas,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
    });

    /** 向真实 Canvas 派发一段可取消的单指触摸事件。 */
    const dispatchTouch = (
      type: "touchstart" | "touchmove" | "touchend",
      x: number,
      y: number,
    ): void => {
      const touch = createTouch(x, y);
      const activeTouches = type === "touchend" ? [] : [touch];
      canvas.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: activeTouches,
        targetTouches: activeTouches,
        changedTouches: [touch],
      }));
    };

    dispatchTouch("touchstart", startPoint.x, startPoint.y);
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      dispatchTouch(
        "touchmove",
        startPoint.x + (endPoint.x - startPoint.x) * progress,
        startPoint.y + (endPoint.y - startPoint.y) * progress,
      );
    }
    dispatchTouch("touchend", endPoint.x, endPoint.y);
  }, {
    startPoint: start,
    endPoint: end,
    steps: qualityConfig.scroll_drag_steps,
  });
}

/** 在 Canvas 内拖动指定滚动视口，直到目标节点完整进入可视区域。 */
async function scrollLayaNodeIntoView(
  page: Page,
  nodeName: string,
  scrollViewportName: string,
): Promise<void> {
  for (
    let attempt = 0;
    attempt <= qualityConfig.scroll_max_attempts;
    attempt += 1
  ) {
    const target = await readCssNodeBounds(page, nodeName);
    const viewport = await readCssNodeBounds(page, scrollViewportName);
    if (target === null || viewport === null) {
      throw new Error(`找不到滚动目标或视口：${nodeName}`);
    }
    const targetBottom = target.y + target.height;
    const viewportBottom = viewport.y + viewport.height;
    if (isScrollableTargetReady(target, viewport)) {
      return;
    }
    if (attempt === qualityConfig.scroll_max_attempts) {
      break;
    }
    const dragDistance = viewport.height * qualityConfig.scroll_drag_ratio;
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    const targetBelow = target.height > viewport.height
      ? target.y + target.height / 2 > viewportBottom
      : targetBottom > viewportBottom;
    const startY = centerY + (targetBelow ? dragDistance : -dragDistance) / 2;
    const endY = centerY - (targetBelow ? dragDistance : -dragDistance) / 2;
    await dragLayaCanvas(
      page,
      { x: centerX, y: startY },
      { x: centerX, y: endY },
    );
    await page.waitForTimeout(qualityConfig.scroll_settle_ms);
  }
  throw new Error(`目标节点在配置化滚动次数内仍不可见：${nodeName}`);
}

/** 将目标滚入指定 Canvas 视口后提交一次真实点击或触摸。 */
async function clickScrollableLayaNode(
  page: Page,
  nodeName: string,
  scrollViewportName: string,
): Promise<void> {
  await scrollLayaNodeIntoView(page, nodeName, scrollViewportName);
  await clickLayaNode(page, nodeName);
}

/** 依次调整内外两层滚动视口，避免手机横屏底栏遮挡中央选项。 */
async function clickNestedScrollableLayaNode(
  page: Page,
  nodeName: string,
  innerScrollViewportName: string,
  outerScrollViewportName: string,
): Promise<void> {
  await scrollLayaNodeIntoView(page, nodeName, innerScrollViewportName);
  await scrollLayaNodeIntoView(page, nodeName, outerScrollViewportName);
  await clickLayaNode(page, nodeName);
}

/** 返回当前必须处理的语义远征节点。 */
function requireExplorationPrompt(
  snapshot: DebugGameSnapshot,
): NonNullable<DebugGameSnapshot["explorationPrompt"]> {
  const prompt = snapshot.explorationPrompt;
  if (prompt === null) {
    throw new Error("远征事件栏缺少当前语义节点。");
  }
  return prompt;
}

/** 沿当前首个可用语义选项推进，直到 4～5 层终点回到远征状态。 */
async function followFirstSemanticExplorationBranch(page: Page): Promise<number> {
  const policy = expeditionBranchingConfigDocument.policy;
  const expectedEventStack = [
    "dashboard",
    "expedition_status",
    "exploration_event",
  ];
  await waitForScreen(page, "exploration_event");
  for (let depth = 1; depth <= policy.maximum_depth; depth += 1) {
    expect(await readDebugRouteScreens(page)).toEqual(expectedEventStack);
    const prompt = requireExplorationPrompt(await readDebugSnapshot(page));
    expect(prompt.options.length).toBeGreaterThanOrEqual(
      policy.visible_choice_minimum,
    );
    expect(prompt.options.length).toBeLessThanOrEqual(
      policy.visible_choice_maximum,
    );
    const layerCapacity = policy.capacity_policy[depth - 1];
    if (layerCapacity === undefined) {
      throw new Error(`远征分支容量策略缺少第 ${String(depth)} 层。`);
    }
    expect(prompt.options.length).toBeLessThanOrEqual(layerCapacity);
    const option = prompt.options.find((candidate) => !candidate.disabled);
    if (option === undefined) {
      throw new Error(`远征事件 ${prompt.id} 没有可用的语义选项。`);
    }
    const previousIdentity = `${prompt.id}\n${prompt.title}`;
    await clickScrollableLayaNode(
      page,
      `page-exploration-event-option-${option.id}`,
      "page-exploration-event-scroll",
    );
    await expect.poll(async () => {
      const screen = await page.evaluate(() => (
        document.body.dataset.gameScreen ?? null
      ));
      const nextPrompt = (await readDebugSnapshot(page)).explorationPrompt;
      if (screen === "expedition_status" && nextPrompt === null) {
        return "resolved";
      }
      if (
        screen === "exploration_event"
        && nextPrompt !== null
        && `${nextPrompt.id}\n${nextPrompt.title}` !== previousIdentity
      ) {
        return "advanced";
      }
      return "pending";
    }).toMatch(/^(advanced|resolved)$/);
    const nextScreen = await page.evaluate(() => (
      document.body.dataset.gameScreen ?? null
    ));
    if (nextScreen === "expedition_status") {
      expect(depth).toBeGreaterThanOrEqual(policy.minimum_depth);
      expect(await readDebugRouteScreens(page)).toEqual([
        "dashboard",
        "expedition_status",
      ]);
      return depth;
    }
    expect(nextScreen).toBe("exploration_event");
    expect(await readDebugRouteScreens(page)).toEqual(expectedEventStack);
  }
  throw new Error("远征语义事件超过配置最大深度后仍未结算。");
}

/** 通过真实 Canvas 选项为远征携带指定数量的食物。 */
async function carryExpeditionFood(page: Page, quantity: number): Promise<void> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error(`远征携带食物数量无效：${String(quantity)}`);
  }
  for (let selected = 0; selected < quantity; selected += 1) {
    await clickScrollableLayaNode(
      page,
      `page-expedition-item-${
        survivalSystemsConfigDocument.expedition.action_food_item_id
      }-increase`,
      "page-expedition-prepare-scroll",
    );
  }
}

/** 从指挥台选择首个可用城市与区划，直到远征整备页。 */
async function openFirstAvailableExpeditionPrepare(
  page: Page,
): Promise<{
  readonly city: DebugExpeditionCity;
  readonly district: DebugExpeditionDistrict;
}> {
  await clickLayaNode(page, explorationEntryNode(await readGameLayout(page)));
  await waitForScreen(page, "expedition_city_list");
  const city = (await readDebugSnapshot(page)).cities.find(
    (candidate) => !candidate.disabled && candidate.districts.length > 0,
  );
  const district = city?.districts[0];
  if (city === undefined || district === undefined) {
    throw new Error("远征城市目录缺少可用区划。");
  }
  await clickScrollableLayaNode(
    page,
    `page-expedition-city-list-option-${city.id}`,
    "page-expedition-city-list-scroll",
  );
  await waitForScreen(page, "expedition_city_detail");
  await clickLayaNode(page, "page-expedition-city-detail-confirm");
  await waitForScreen(page, "expedition_district_list");
  await clickScrollableLayaNode(
    page,
    `page-expedition-district-list-option-${district.id}`,
    "page-expedition-district-list-scroll",
  );
  await waitForScreen(page, "expedition_district_detail");
  await clickLayaNode(page, "page-expedition-district-detail-confirm");
  await waitForScreen(page, "expedition_prepare");
  return { city, district };
}

/** 为领域行动生成与战斗页一致的稳定按钮 ID。 */
function encounterActionNodeId(action: DebugEncounterAvailableAction): string {
  return action.abilityId === null
    ? action.action
    : `${action.action}:${action.abilityId}`;
}

/** 统计当前存活敌人总生命，用于证明单位指令已真实结算。 */
function totalEncounterEnemyHealth(state: DebugEncounterBattleState): number {
  return state.enemies.reduce((total, enemy) => total + enemy.health, 0);
}

/** 把真实指针移动到 Laya 节点中心以验证桌面悬停意图。 */
async function hoverLayaNode(page: Page, nodeName: string): Promise<void> {
  const position = await page.evaluate((requestedName) => {
    const debug = window.__SHELTER_GAME__;
    const canvas = document.querySelector<HTMLCanvasElement>("#layaCanvas");
    const bounds = debug?.getNodeBounds(requestedName) ?? null;
    if (canvas === null || bounds === null) {
      return null;
    }
    const rectangle = canvas.getBoundingClientRect();
    return {
      x: rectangle.left +
        ((bounds.x + bounds.width / 2) / bounds.stageWidth) * rectangle.width,
      y: rectangle.top +
        ((bounds.y + bounds.height / 2) / bounds.stageHeight) * rectangle.height,
    };
  }, nodeName);
  if (position === null) {
    throw new Error(`找不到可悬停的 Laya 节点：${nodeName}`);
  }
  await page.mouse.move(position.x, position.y);
}

/** 验证自动更新日志位于封面之上，再关闭并返回封面。 */
async function closeAutomaticUpdateLog(page: Page): Promise<void> {
  await waitForScreen(page, "update_log");
  expect(await readLayaNodeBounds(page, "page-update-log")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "page-update-log-content")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "page-menu")).not.toBeNull();
  await expect.poll(async () =>
    readLayaNodeBounds(page, "page-update-log-close"),
  ).not.toBeNull();
  await page.waitForTimeout(qualityConfig.scroll_settle_ms);
  await clickLayaNode(page, "page-update-log-close");
  await page.waitForTimeout(qualityConfig.scroll_settle_ms);
  if (await page.evaluate(() => document.body.dataset.gameScreen) === "update_log") {
    await clickLayaNode(page, "page-update-log-close");
  }
  await waitForScreen(page, "menu");
}

/** 打开指定模式的完整开局档案页。 */
async function openNewGameSetup(
  page: Page,
  mode: TestGameMode,
): Promise<void> {
  const menuNode = mode === "story" ? "menu-story" : "menu-new-game";
  await clickLayaNode(page, menuNode);
  await waitForScreen(page, "name_input");
  expect(await readLayaNodeBounds(page, "page-new-game-setup")).not.toBeNull();
}

/** 填写独立所长姓名，并主动结束原生文本输入焦点。 */
async function fillCommanderName(page: Page, playerName: string): Promise<void> {
  await clickLayaNode(page, "player-name-1");
  const input = page.getByPlaceholder(
    webConfigDocument.texts.profile_name_label,
    { exact: true },
  );
  await expect(input).toBeVisible();
  await input.fill(playerName);
  await input.blur();
}

/** 验证开局教程提示后选择直接进入游戏。 */
async function continuePreGameNotice(page: Page): Promise<void> {
  await waitForScreen(page, "pre_game_notice");
  expect(await readLayaNodeBounds(page, "pre-game-notice-body")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "page-new-game-setup")).not.toBeNull();
  await clickLayaNode(page, "pre-game-notice-continue");
}

/** 按指定入口提交默认档案，并验证通讯过场后停留在指挥台。 */
async function startGame(
  page: Page,
  mode: TestGameMode,
  playerName: string,
): Promise<void> {
  await openNewGameSetup(page, mode);
  await fillCommanderName(page, playerName);
  await clickLayaNode(page, "player-name-submit");
  await continuePreGameNotice(page);
  await waitForScreen(page, "connection");
  expect(await readLayaNodeBounds(page, "page-connection-title")).not.toBeNull();
  await waitForScreen(page, "dashboard");
}

/** 打开一局普通单人游戏。 */
async function startSingleGame(page: Page, playerName: string): Promise<void> {
  await startGame(page, "single", playerName);
}

/** 创建含主档与滚动备份的合法失败存档夹具，并保留一个无关存储键供隔离性断言。 */
async function createFailedSaveFixture(
  page: Page,
  targetSlotId: number,
  playerName: string,
): Promise<void> {
  await startSingleGame(page, playerName);
  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  await clickScrollableLayaNode(
    page,
    "page-function-menu-option-save",
    "page-function-menu-scroll",
  );
  await waitForScreen(page, "save_slots");
  const saveCount = webConfigDocument.storage.backup_slots + 1;
  for (let saveIndex = 0; saveIndex < saveCount; saveIndex += 1) {
    await clickScrollableLayaNode(
      page,
      `page-save-slots-slot-${String(targetSlotId)}`,
      "page-save-slots-scroll",
    );
    await waitForScreen(page, "message");
    if (saveIndex < saveCount - 1) {
      await clickLayaNode(page, "page-message-close");
      await waitForScreen(page, "function_menu");
      await clickScrollableLayaNode(
        page,
        "page-function-menu-option-save",
        "page-function-menu-scroll",
      );
      await waitForScreen(page, "save_slots");
    }
  }
  await page.evaluate(({ storageKey, slotId, preservedMetadata }) => {
    const slotKey = `${storageKey}:slot:${String(slotId)}`;
    const serialized = localStorage.getItem(slotKey);
    if (serialized === null) throw new Error("失败流程测试没有生成目标主存档。");
    const document = JSON.parse(serialized) as {
      game_state: {
        shelter: { hope: number };
        ending: unknown;
      };
    };
    document.game_state.shelter.hope = 0;
    document.game_state.ending = {
      ending_id: "hope_extinguished",
      outcome: "failure",
      message: [
        "失败原因：希望归零，幸存者不再相信明天值得等待。",
        "对应失败结局：无人守望",
        "门被从内部打开。人们各自走入雨里。",
      ].join("\n\n"),
    };
    localStorage.setItem(slotKey, JSON.stringify(document));
    localStorage.setItem("qa-unrelated-meta", "preserved");
    for (const entry of preservedMetadata) {
      localStorage.setItem(entry.key, entry.value);
    }
  }, {
    storageKey: webConfigDocument.storage.key,
    slotId: targetSlotId,
    preservedMetadata: [
      {
        key: webConfigDocument.storage.settings_key,
        value: failureMetadataValues.settings,
      },
      {
        key: webConfigDocument.storage.achievement_key,
        value: failureMetadataValues.achievements,
      },
      {
        key: coopConfigDocument.account_storage_key,
        value: failureMetadataValues.account,
      },
    ],
  });
  const backupsBeforeFailure = await page.evaluate(({ storageKey, slotId, backups }) => {
    const slotKey = `${storageKey}:slot:${String(slotId)}`;
    return Array.from(
      { length: backups },
      (_value, index) => localStorage.getItem(`${slotKey}:backup:${String(index + 1)}`),
    );
  }, {
    storageKey: webConfigDocument.storage.key,
    slotId: targetSlotId,
    backups: webConfigDocument.storage.backup_slots,
  });
  expect(backupsBeforeFailure.every((value) => value !== null)).toBe(true);
}

/** 等待一次完整重载稳定下来，并兼容闪屏、自动更新日志或已在封面的启动状态。 */
async function reloadToMainMenu(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#boot-status")).toBeHidden();
  await expect.poll(async () => page.evaluate(() => (
    document.body.dataset.gameScreen ?? null
  ))).toMatch(/^(publisher_splash|update_log|menu)$/);
  let screen = await page.evaluate(() => document.body.dataset.gameScreen ?? null);
  if (screen === "publisher_splash") {
    await advancePublisherSplash(page);
    screen = await page.evaluate(() => document.body.dataset.gameScreen ?? null);
  }
  if (screen === "update_log") {
    await closeAutomaticUpdateLog(page);
  }
  await waitForScreen(page, "menu");
}

/** 打开目标失败槽，并停在尚未选择槽位的读档页面。 */
async function openFailedSaveSlots(page: Page): Promise<void> {
  await reloadToMainMenu(page);
  await clickLayaNode(page, "menu-load-game");
  await waitForScreen(page, "save_slots");
}

/** 在目标槽点击前冻结浏览器时间，返回配置化失败倒计时时长。 */
async function pauseBeforeFailureCountdown(page: Page): Promise<number> {
  const failureDelayMs = webConfigDocument.failure_flow.forced_return_delay_ms;
  const failureClockAnchor = Date.now();
  await page.clock.install({ time: failureClockAnchor });
  await page.clock.pauseAt(failureClockAnchor + failureDelayMs);
  return failureDelayMs;
}

/** 打开一局剧情模式游戏。 */
async function startStoryGame(page: Page, playerName: string): Promise<void> {
  await startGame(page, "story", playerName);
}

/** 根据三态布局返回当前剧情入口的稳定节点名。 */
function storyEntryNode(layout: GameLayoutKind): string {
  return layout === "desktop" ? "dashboard-story" : "bottom-nav-story";
}

/** 根据三态布局返回当前探索入口的稳定节点名。 */
function explorationEntryNode(layout: GameLayoutKind): string {
  return layout === "desktop" ? "dashboard-action-explore" : "bottom-nav-explore";
}

/** 根据三态布局返回避难所管理入口的稳定节点名。 */
function managementEntryNode(layout: GameLayoutKind): string {
  return layout === "desktop"
    ? "dashboard-action-shelter_management"
    : "bottom-nav-management";
}

/** 读取当前默认项之后的循环选项，供 UI 点击结果断言复用。 */
function nextCampaignOption(
  options: readonly DebugCampaignOption[],
  selectedId: string,
): DebugCampaignOption {
  const selectedIndex = options.findIndex((option) => option.id === selectedId);
  if (selectedIndex < 0 || options.length === 0) {
    throw new Error(`开局档案默认项不存在：${selectedId}`);
  }
  const next = options[(selectedIndex + 1) % options.length];
  if (next === undefined) {
    throw new Error(`开局档案选项无法循环：${selectedId}`);
  }
  return next;
}

/** 验证城市与区划分别保存，且区划属于配置快照中的所选城市。 */
function expectSeparatedCampaignLocation(
  snapshot: DebugGameSnapshot,
  expectedCity: DebugCampaignOption,
): void {
  const profile = snapshot.campaignProfile;
  if (profile === null) {
    throw new Error("开局后缺少所长档案位置。");
  }
  const city = snapshot.cities.find((candidate) => candidate.id === expectedCity.id);
  if (city === undefined) {
    throw new Error(`城市目录缺少已选择城市：${expectedCity.id}`);
  }
  const districtLabels = city.districts.map((district) => district.code);
  expect(profile.homeCityLabel).toBe(expectedCity.label);
  expect(profile.districtLabel.length).toBeGreaterThan(0);
  expect(districtLabels).toContain(profile.districtLabel);
  expect(profile.homeCityLabel).not.toContain(profile.districtLabel);
}

/** 验证配置化数量的全部存档槽都已渲染。 */
async function expectAllSaveSlots(page: Page): Promise<void> {
  for (
    let slotId = 1;
    slotId <= webConfigDocument.storage.save_slot_count;
    slotId += 1
  ) {
    expect(
      await readLayaNodeBounds(page, `page-save-slots-slot-${String(slotId)}`),
    ).not.toBeNull();
  }
}

/** 按手机分步建档的真实顺序前进，并在指定阶段选择配置化选项。 */
async function selectMobileCampaignProfile(
  page: Page,
  selections: Readonly<Record<"difficulty" | "origin" | "trait" | "city", string>>,
): Promise<void> {
  const orderedStages = [
    "mode",
    "difficulty",
    "origin",
    "trait",
    "secondary_trait",
    "city",
    "district",
    "shelter",
    "slot",
  ] as const;
  for (const stage of orderedStages) {
    await clickScrollableLayaNode(
      page,
      "profile-setup-next-step",
      "page-new-game-setup-scroll",
    );
    await expect.poll(async () =>
      readLayaNodeBounds(page, `profile-${stage}-preview-title`),
    ).not.toBeNull();
    if (stage in selections) {
      const optionId = selections[stage as keyof typeof selections];
      await clickNestedScrollableLayaNode(
        page,
        `profile-${stage}-option-${optionId}`,
        "profile-setup-options-scroll",
        "page-new-game-setup-scroll",
      );
    }
  }
}

/** 允许发布者闪屏被点击或按配置自动结束，并稳定停在更新日志页。 */
async function advancePublisherSplash(page: Page): Promise<void> {
  await expect.poll(async () => {
    const screen = await page.evaluate(() => (
      document.body.dataset.gameScreen ?? null
    ));
    if (screen === "update_log") return screen;
    if (screen !== "publisher_splash") return "pending";
    const title = await readLayaNodeBounds(page, "publisher-splash-title");
    const splash = await readLayaNodeBounds(page, "page-publisher-splash");
    return title !== null && splash !== null ? screen : "pending";
  }).toMatch(/^(publisher_splash|update_log)$/);

  const screen = await page.evaluate(() => (
    document.body.dataset.gameScreen ?? null
  ));
  if (screen === "publisher_splash") {
    try {
      await clickLayaNode(page, "page-publisher-splash");
    } catch (error) {
      const currentScreen = await page.evaluate(() => (
        document.body.dataset.gameScreen ?? null
      ));
      if (currentScreen !== "update_log") throw error;
    }
  }
  await waitForScreen(page, "update_log");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await advancePublisherSplash(page);
});

test("完整新游戏档案页循环配置后进入普通模式", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  if (await readGameLayout(page) === "desktop") {
    await hoverLayaNode(page, "menu-new-game");
    await expect.poll(async () =>
      readLayaNodeBounds(page, "menu-description"),
    ).not.toBeNull();
  }
  await openNewGameSetup(page, "single");
  expect(await readLayaNodeBounds(page, "menu-description")).toBeNull();
  const setupNodes = [
    "player-name-1",
    "profile-mode",
    "profile-difficulty",
    "profile-origin",
    "profile-trait",
    "profile-city",
    "profile-slot",
    "page-new-game-setup-back",
    "player-name-submit",
  ];
  for (const nodeName of setupNodes) {
    expect(await readLayaNodeBounds(page, nodeName)).not.toBeNull();
  }

  const options = (await readDebugSnapshot(page)).campaignProfileOptions;
  const expectedDifficulty = nextCampaignOption(
    options.difficulties,
    options.defaultSelection.difficultyId,
  );
  const expectedOrigin = nextCampaignOption(
    options.origins,
    options.defaultSelection.originId,
  );
  const expectedTrait = nextCampaignOption(
    options.traits,
    options.defaultSelection.traitId,
  );
  const expectedCity = nextCampaignOption(
    options.cities,
    options.defaultSelection.homeCityId,
  );
  await fillCommanderName(page, "档案所长");
  if (await readGameLayout(page) === "mobile") {
    await selectMobileCampaignProfile(page, {
      difficulty: expectedDifficulty.id,
      origin: expectedOrigin.id,
      trait: expectedTrait.id,
      city: expectedCity.id,
    });
  } else {
    for (const nodeName of [
      "profile-difficulty",
      "profile-origin",
      "profile-trait",
      "profile-city",
      "profile-slot",
    ]) {
      await clickScrollableLayaNode(
        page,
        nodeName,
        "page-new-game-setup-scroll",
      );
    }
  }
  await clickLayaNode(page, "player-name-submit");
  await continuePreGameNotice(page);
  await waitForScreen(page, "connection");
  await waitForScreen(page, "dashboard");

  const snapshot = await readDebugSnapshot(page);
  expect(snapshot.mode).toBe("single");
  expect(snapshot.activePlayer?.name).toBe("档案所长");
  expect(snapshot.campaignProfile).toMatchObject({
    difficultyLabel: expectedDifficulty.label,
    originLabel: expectedOrigin.label,
    traitLabel: expectedTrait.label,
  });
  expectSeparatedCampaignLocation(snapshot, expectedCity);
  expect(await readLayaNodeBounds(page, "dashboard-campaign-profile")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "dashboard-mission")).toBeNull();
});

test("开局提示可进入无滚动分页战术引导并聚焦真实目标", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await openNewGameSetup(page, "single");
  await fillCommanderName(page, "引导所长");
  await clickLayaNode(page, "player-name-submit");
  await waitForScreen(page, "pre_game_notice");
  await clickLayaNode(page, "pre-game-notice-tutorial");
  await waitForScreen(page, "connection");
  await waitForScreen(page, "tutorial");
  expect(await readLayaNodeBounds(page, "page-dashboard")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "page-guided-tutorial")).not.toBeNull();

  let navigationCount = 0;
  while (await page.evaluate(() => document.body.dataset.gameScreen) === "tutorial") {
    expect(
      await readLayaNodeBounds(page, "guided-tutorial-target-state"),
    ).toBeNull();
    const focus = await readLayaNodeBounds(page, "guided-tutorial-focus-border");
    expect(focus).not.toBeNull();
    if (focus !== null) {
      expect(focus.x).toBeGreaterThanOrEqual(0);
      expect(focus.y).toBeGreaterThanOrEqual(0);
      expect(focus.x + focus.width).toBeLessThanOrEqual(focus.stageWidth);
      expect(focus.y + focus.height).toBeLessThanOrEqual(focus.stageHeight);
    }
    await clickLayaNode(page, "guided-tutorial-next");
    navigationCount += 1;
    if (navigationCount > webConfigDocument.guided_tutorial.steps.length * 8) {
      throw new Error("教程分页导航未在配置上限内完成。");
    }
  }
  expect(navigationCount).toBeGreaterThanOrEqual(
    webConfigDocument.guided_tutorial.steps.length,
  );
  await waitForScreen(page, "dashboard");
});

test("剧情模式从封面到首个剧情结果使用真实 Canvas 完成闭环", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message);
  });

  await closeAutomaticUpdateLog(page);
  await startStoryGame(page, "测试所长");
  const startedSnapshot = await readDebugSnapshot(page);
  expect(startedSnapshot.activePlayer?.name).toBe("测试所长");
  expect(startedSnapshot.mode).toBe("story");

  const layout = await readGameLayout(page);
  const storyNode = storyEntryNode(layout);
  expect(await readLayaNodeBounds(page, storyNode)).not.toBeNull();
  expect(await readLayaNodeBounds(page, "dashboard-mission")).not.toBeNull();
  await clickLayaNode(page, storyNode);
  await waitForScreen(page, "story");
  await clickScrollableLayaNode(
    page,
    "page-story-option-give_up_share",
    "page-story-scroll",
  );
  await waitForScreen(page, "message");

  const snapshot = await readDebugSnapshot(page);
  expect(snapshot.storyPrompt?.id).toBe("money_and_secrets");
  expect(snapshot.clock?.turnLabel).toBe("第 1 回合");
  expect(runtimeErrors).toEqual([]);
});

test("普通模式隐藏剧情任务并可从标题栏设置返回指挥台", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "生存所长");

  const snapshot = await readDebugSnapshot(page);
  expect(snapshot.mode).toBe("single");
  expect(await readLayaNodeBounds(page, "dashboard-story")).toBeNull();
  expect(await readLayaNodeBounds(page, "bottom-nav-story")).toBeNull();
  expect(await readLayaNodeBounds(page, "dashboard-mission")).toBeNull();

  const settingsBounds = await readLayaNodeBounds(page, "dashboard-settings");
  expect(settingsBounds).not.toBeNull();
  expect(settingsBounds?.x).toBeGreaterThanOrEqual(0);
  expect(settingsBounds?.y).toBeGreaterThanOrEqual(0);
  expect((settingsBounds?.x ?? 0) + (settingsBounds?.width ?? 0)).toBeLessThanOrEqual(
    settingsBounds?.stageWidth ?? 0,
  );
  expect((settingsBounds?.y ?? 0) + (settingsBounds?.height ?? 0)).toBeLessThanOrEqual(
    settingsBounds?.stageHeight ?? 0,
  );

  await clickLayaNode(page, "dashboard-settings");
  await waitForScreen(page, "settings");
  expect(await readLayaNodeBounds(page, "page-settings")).not.toBeNull();
  await clickLayaNode(page, "page-settings-back");
  await waitForScreen(page, "dashboard");
  expect(await readLayaNodeBounds(page, "dashboard-settings")).not.toBeNull();
});

test("ESC 六栏存档可写入指定栏位并刷新后按槽读档", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "守夜人");
  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  await clickScrollableLayaNode(
    page,
    "page-function-menu-option-save",
    "page-function-menu-scroll",
  );
  await waitForScreen(page, "save_slots");
  await expectAllSaveSlots(page);
  const targetSlotId = webConfigDocument.storage.save_slot_count;
  await clickScrollableLayaNode(
    page,
    `page-save-slots-slot-${String(targetSlotId)}`,
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "message");
  const savedSlot = (await readDebugSnapshot(page)).saveSlots.find(
    (slot) => slot.slotId === targetSlotId,
  );
  expect(savedSlot).toMatchObject({
    status: "valid",
    loadable: true,
    writable: true,
  });

  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await closeAutomaticUpdateLog(page);
  await clickLayaNode(page, "menu-load-game");
  await waitForScreen(page, "save_slots");
  await expectAllSaveSlots(page);
  const emptySlot = (await readDebugSnapshot(page)).saveSlots.find(
    (slot) => slot.status === "empty",
  );
  if (emptySlot === undefined) {
    throw new Error("六栏存档测试缺少空槽。");
  }
  await clickScrollableLayaNode(
    page,
    `page-save-slots-slot-${String(emptySlot.slotId)}`,
    "page-save-slots-scroll",
  );
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameScreen ?? null,
  )).toBe("save_slots");
  await clickScrollableLayaNode(
    page,
    `page-save-slots-slot-${String(targetSlotId)}`,
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "connection");
  await waitForScreen(page, "dashboard");

  expect((await readDebugSnapshot(page)).activePlayer?.name).toBe("守夜人");
});

test("失败结局锁定返回并在配置化三秒后删除本局存档", async ({ page }) => {
  test.slow();
  await closeAutomaticUpdateLog(page);
  const targetSlotId = 2;
  await createFailedSaveFixture(page, targetSlotId, "终局所长");
  await openFailedSaveSlots(page);
  const failureDelayMs = await pauseBeforeFailureCountdown(page);
  await clickScrollableLayaNode(
    page,
    `page-save-slots-slot-${String(targetSlotId)}`,
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "ending");

  const lockedEnding = await page.evaluate(() => {
    const debug = window.__SHELTER_GAME__;
    if (debug === undefined) throw new Error("失败页缺少只读诊断接口。");
    return {
      screen: debug.getCurrentScreen(),
      routes: debug.getRouteScreens(),
      snapshot: debug.getSnapshot(),
      content: debug.getNodeBounds("page-ending-content"),
      close: debug.getNodeBounds("page-ending-close"),
      back: debug.getNodeBounds("page-ending-back"),
    };
  });
  expect(lockedEnding.screen).toBe("ending");
  expect(lockedEnding.routes.at(-1)).toBe("ending");
  expect(lockedEnding.snapshot.endingOutcome).toBe("failure");
  expect(lockedEnding.snapshot.ending?.body).toContain("失败原因：");
  expect(lockedEnding.snapshot.ending?.body).toContain("对应失败结局：无人守望");
  expect(lockedEnding.content).not.toBeNull();
  expect(lockedEnding.close).toBeNull();
  expect(lockedEnding.back).toBeNull();

  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.body.dataset.gameScreen)).toBe("ending");
  await page.evaluate(() => {
    history.pushState({ failureBackProbe: "forward-target" }, document.title);
    history.back();
  });
  await expect.poll(async () => page.evaluate(() => ({
    screen: document.body.dataset.gameScreen ?? null,
    probe: (history.state as { failureBackProbe?: unknown } | null)
      ?.failureBackProbe ?? null,
  }))).toEqual({ screen: "ending", probe: null });
  await page.evaluate(() => { history.forward(); });
  await page.waitForTimeout(qualityConfig.scroll_settle_ms * 2);
  expect(await page.evaluate(() => ({
    screen: document.body.dataset.gameScreen ?? null,
    probe: (history.state as { failureBackProbe?: unknown } | null)
      ?.failureBackProbe ?? null,
  }))).toEqual({ screen: "ending", probe: null });

  await page.clock.fastForward(failureDelayMs - 1);
  expect(await page.evaluate(() => document.body.dataset.gameScreen ?? null)).toBe("ending");
  expect(await page.evaluate(({ storageKey, slotId }) =>
    localStorage.getItem(`${storageKey}:slot:${String(slotId)}`),
  { storageKey: webConfigDocument.storage.key, slotId: targetSlotId })).not.toBeNull();
  await page.clock.fastForward(1);
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameScreen ?? null,
  ), {
    timeout: failureDelayMs + 3000,
  }).toBe("menu");
  const storageAfterFailure = await page.evaluate(({
    storageKey,
    slotId,
    backups,
    metadataKeys,
  }) => {
    const slotKey = `${storageKey}:slot:${String(slotId)}`;
    return {
      primary: localStorage.getItem(slotKey),
      backupValues: Array.from(
        { length: backups },
        (_value, index) => localStorage.getItem(`${slotKey}:backup:${String(index + 1)}`),
      ),
      unrelated: localStorage.getItem("qa-unrelated-meta"),
      metadata: {
        settings: localStorage.getItem(metadataKeys.settings),
        achievements: localStorage.getItem(metadataKeys.achievements),
        account: localStorage.getItem(metadataKeys.account),
      },
      slotStatus: window.__SHELTER_GAME__?.getSnapshot().saveSlots.find(
        (slot) => slot.slotId === slotId,
      )?.status,
    };
  }, {
    storageKey: webConfigDocument.storage.key,
    slotId: targetSlotId,
    backups: webConfigDocument.storage.backup_slots,
    metadataKeys: {
      settings: webConfigDocument.storage.settings_key,
      achievements: webConfigDocument.storage.achievement_key,
      account: coopConfigDocument.account_storage_key,
    },
  });
  expect(storageAfterFailure.primary).toBeNull();
  expect(storageAfterFailure.backupValues).toEqual(
    Array.from({ length: webConfigDocument.storage.backup_slots }, () => null),
  );
  expect(storageAfterFailure.unrelated).toBe("preserved");
  expect(storageAfterFailure.metadata).toEqual(failureMetadataValues);
  expect(storageAfterFailure.slotStatus).toBe("empty");
});

test("失败页倒计时内重载仍清除旧档且目标槽不可恢复", async ({ page }) => {
  test.slow();
  await closeAutomaticUpdateLog(page);
  const targetSlotId = 2;
  await createFailedSaveFixture(page, targetSlotId, "重载测试所长");
  await openFailedSaveSlots(page);
  await pauseBeforeFailureCountdown(page);
  await clickScrollableLayaNode(
    page,
    `page-save-slots-slot-${String(targetSlotId)}`,
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "ending");
  expect((await readDebugSnapshot(page)).endingOutcome).toBe("failure");

  await page.clock.resume();
  await reloadToMainMenu(page);
  const reloadedSlot = (await readDebugSnapshot(page)).saveSlots.find(
    (slot) => slot.slotId === targetSlotId,
  );
  expect(reloadedSlot).toMatchObject({
    status: "empty",
    loadable: false,
    writable: true,
  });

  const storageAfterReload = await page.evaluate(({
    storageKey,
    slotId,
    backups,
    metadataKeys,
  }) => {
    const slotKey = `${storageKey}:slot:${String(slotId)}`;
    return {
      primary: localStorage.getItem(slotKey),
      backupValues: Array.from(
        { length: backups },
        (_value, index) => localStorage.getItem(`${slotKey}:backup:${String(index + 1)}`),
      ),
      unrelated: localStorage.getItem("qa-unrelated-meta"),
      metadata: {
        settings: localStorage.getItem(metadataKeys.settings),
        achievements: localStorage.getItem(metadataKeys.achievements),
        account: localStorage.getItem(metadataKeys.account),
      },
    };
  }, {
    storageKey: webConfigDocument.storage.key,
    slotId: targetSlotId,
    backups: webConfigDocument.storage.backup_slots,
    metadataKeys: {
      settings: webConfigDocument.storage.settings_key,
      achievements: webConfigDocument.storage.achievement_key,
      account: coopConfigDocument.account_storage_key,
    },
  });
  expect(storageAfterReload.primary).toBeNull();
  expect(storageAfterReload.backupValues).toEqual(
    Array.from({ length: webConfigDocument.storage.backup_slots }, () => null),
  );
  expect(storageAfterReload.unrelated).toBe("preserved");
  expect(storageAfterReload.metadata).toEqual(failureMetadataValues);
});

test("启动更新日志关闭后展示五个主入口且不再提供封面退出", async ({
  page,
}) => {
  await closeAutomaticUpdateLog(page);
  const menuNodes = [
    "menu-new-game",
    "menu-load-game",
    "menu-multiplayer",
    "menu-story",
    "menu-credits",
  ];
  for (const nodeName of menuNodes) {
    expect(await readLayaNodeBounds(page, nodeName)).not.toBeNull();
  }
  for (const utilityNode of [
    "menu-settings",
    "menu-account-login",
    "menu-store",
    "menu-update-log",
    "menu-text-records",
  ]) {
    expect(await readLayaNodeBounds(page, utilityNode)).not.toBeNull();
  }
  expect(await readLayaNodeBounds(page, "menu-exit")).toBeNull();

  if (await readGameLayout(page) === "desktop") {
    expect(await readLayaNodeBounds(page, "menu-description")).toBeNull();
    await hoverLayaNode(page, "menu-story");
    await expect.poll(async () =>
      readLayaNodeBounds(page, "menu-description"),
    ).not.toBeNull();
  } else {
    expect(await readLayaNodeBounds(page, "menu-description")).toBeNull();
  }

  await clickLayaNode(page, "menu-load-game");
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameScreen ?? null,
  )).toBe("menu");
  await clickLayaNode(page, "menu-update-log");
  await waitForScreen(page, "update_log");
  await clickLayaNode(page, "page-update-log-close");
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-account-login");
  await waitForScreen(page, "account_login");
  for (const accountNode of [
    "page-account-login",
    "coop-local-demo-notice",
    "coop-login-warning",
    "coop-login-submit",
  ]) {
    await expect.poll(async () =>
      readLayaNodeBounds(page, accountNode),
    ).not.toBeNull();
  }
  await clickLayaNode(page, "page-account-login-back");
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-store");
  await waitForScreen(page, "store");
  expect(await readLayaNodeBounds(page, "page-store-content")).not.toBeNull();
  await clickLayaNode(page, "page-store-close");
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-text-records");
  await waitForScreen(page, "text_records");
  expect(await readLayaNodeBounds(page, "page-text-records-content")).not.toBeNull();
  await clickLayaNode(page, "page-text-records-close");
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-credits");
  await waitForScreen(page, "credits");
  await clickLayaNode(page, "page-credits-close");
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-multiplayer");
  await waitForScreen(page, "name_input");
  expect(await readLayaNodeBounds(page, "player-name-1")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "player-name-2")).not.toBeNull();
  await clickLayaNode(page, "page-new-game-setup-back");
  await waitForScreen(page, "menu");
});

test("长夜守望成就解锁封面并在刷新后保持选择", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await clickLayaNode(page, "menu-settings");
  await waitForScreen(page, "settings");
  await clickScrollableLayaNode(
    page,
    "page-settings-option-cover-theme",
    "page-settings-scroll",
  );
  await waitForScreen(page, "cover_theme_selector");
  expect(await page.evaluate(() => document.body.dataset.gameCoverTheme))
    .toBe("classic_embers");
  await clickScrollableLayaNode(
    page,
    "page-cover-theme-selector-option-bunker_gate",
    "page-cover-theme-selector-scroll",
  );
  await waitForScreen(page, "cover_theme_selector");
  expect(await page.evaluate(() => document.body.dataset.gameCoverTheme))
    .toBe("classic_embers");

  await page.evaluate(({ key, schemaVersion }) => {
    localStorage.setItem(key, JSON.stringify({
      schema_version: schemaVersion,
      unlocked_achievement_ids: ["ending_long_night_watch"],
    }));
  }, {
    key: webConfigDocument.storage.achievement_key,
    schemaVersion: webConfigDocument.storage.achievement_schema_version,
  });
  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await closeAutomaticUpdateLog(page);
  await clickLayaNode(page, "menu-settings");
  await waitForScreen(page, "settings");
  await clickScrollableLayaNode(
    page,
    "page-settings-option-cover-theme",
    "page-settings-scroll",
  );
  await waitForScreen(page, "cover_theme_selector");
  await clickScrollableLayaNode(
    page,
    "page-cover-theme-selector-option-bunker_gate",
    "page-cover-theme-selector-scroll",
  );
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameCoverTheme,
  )).toBe("bunker_gate");
  await clickLayaNode(page, "page-cover-theme-selector-back");
  await clickLayaNode(page, "page-settings-back");
  await waitForScreen(page, "menu");
  expect(await readLayaNodeBounds(page, "menu-title")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "menu-subtitle")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "menu-cover-art")).not.toBeNull();

  const expectedAsset = await page.evaluate(() => {
    const mobile = document.body.dataset.gameLayout === "mobile";
    return mobile && window.innerHeight > window.innerWidth
      ? "assets/covers/cover_theme_bunker_gate_mobile_2k.webp"
      : "assets/covers/cover_theme_bunker_gate_2k.webp";
  });
  expect(await page.evaluate(() => document.body.dataset.gameCoverAsset))
    .toBe(expectedAsset);

  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await closeAutomaticUpdateLog(page);
  expect(await page.evaluate(() => document.body.dataset.gameCoverTheme))
    .toBe("bunker_gate");
  expect(await page.evaluate(({ key }) => {
    const value = localStorage.getItem(key);
    if (value === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    return typeof candidate.selected_cover_theme_id === "string"
      ? candidate.selected_cover_theme_id
      : null;
  }, { key: webConfigDocument.storage.settings_key })).toBe("bunker_gate");
});

test("Escape 功能菜单叠加在二级页上并逐层返回", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "值夜所长");
  await clickLayaNode(page, "dashboard-settings");
  await waitForScreen(page, "settings");
  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  expect(await readLayaNodeBounds(page, "page-settings")).not.toBeNull();
  await expectFunctionMenuGeometry(page);
  await page.keyboard.press("Escape");
  await waitForScreen(page, "settings");
  await clickLayaNode(page, "page-settings-back");
  await waitForScreen(page, "dashboard");
});

test("远征事件栏返回始终确认撤离且不回退决策", async ({ page }) => {
  test.slow();
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "撤离测试员");
  const { city, district } = await openFirstAvailableExpeditionPrepare(page);
  const requiredFood = (
    city.travelStepCost + district.eventStepCost + 1
  ) * survivalSystemsConfigDocument.expedition.food_units_per_action;
  await carryExpeditionFood(page, requiredFood);
  await clickLayaNode(page, "page-expedition-prepare-begin");
  await waitForScreen(page, "exploration_event");
  const expectedEventStack = [
    "dashboard",
    "expedition_status",
    "exploration_event",
  ];
  expect(await readDebugRouteScreens(page)).toEqual(expectedEventStack);
  const rootPrompt = requireExplorationPrompt(await readDebugSnapshot(page));
  const firstOption = rootPrompt.options.find((option) => !option.disabled);
  if (firstOption === undefined) {
    throw new Error("远征开场事件没有可用的语义选项。");
  }
  await clickScrollableLayaNode(
    page,
    `page-exploration-event-option-${firstOption.id}`,
    "page-exploration-event-scroll",
  );
  await expect.poll(async () => {
    const current = requireExplorationPrompt(await readDebugSnapshot(page));
    return `${current.id}\n${current.title}`;
  }).not.toBe(`${rootPrompt.id}\n${rootPrompt.title}`);
  const currentPrompt = requireExplorationPrompt(await readDebugSnapshot(page));
  expect(await readDebugRouteScreens(page)).toEqual(expectedEventStack);

  await clickLayaNode(page, "page-exploration-event-back");
  await waitForScreen(page, "expedition_retreat_confirm");
  await clickLayaNode(page, "page-expedition-retreat-confirm-cancel");
  await waitForScreen(page, "exploration_event");
  expect(requireExplorationPrompt(await readDebugSnapshot(page)).id)
    .toBe(currentPrompt.id);
  expect(await readDebugRouteScreens(page)).toEqual(expectedEventStack);

  await page.evaluate(() => { window.history.back(); });
  await waitForScreen(page, "expedition_retreat_confirm");
  await clickLayaNode(page, "page-expedition-retreat-confirm-cancel");
  await waitForScreen(page, "exploration_event");
  expect(requireExplorationPrompt(await readDebugSnapshot(page)).id)
    .toBe(currentPrompt.id);
  expect(await readDebugRouteScreens(page)).toEqual(expectedEventStack);

  await clickLayaNode(page, "page-exploration-event-back");
  await waitForScreen(page, "expedition_retreat_confirm");
  await clickLayaNode(page, "page-expedition-retreat-confirm-confirm");
  await expect.poll(async () => (
    page.evaluate(() => document.body.dataset.gameScreen ?? null)
  )).toMatch(/^(dashboard|return_incident)$/);
  const retreatedSnapshot = await readDebugSnapshot(page);
  expect(retreatedSnapshot.explorationPrompt).toBeNull();
  expect(retreatedSnapshot.expeditionStatus).toBeNull();
});

test("远征分支中途存档读档后恢复当前事件与三层页面栈", async ({ page }) => {
  test.slow();
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "续接测试员");
  const { city, district } = await openFirstAvailableExpeditionPrepare(page);
  const requiredFood = (
    city.travelStepCost + district.eventStepCost + 1
  ) * survivalSystemsConfigDocument.expedition.food_units_per_action;
  await carryExpeditionFood(page, requiredFood);
  await clickLayaNode(page, "page-expedition-prepare-begin");
  await waitForScreen(page, "exploration_event");
  const entry = requireExplorationPrompt(await readDebugSnapshot(page));
  const firstChoice = entry.options.find((option) => !option.disabled);
  if (firstChoice === undefined) throw new Error("远征入口没有可执行选项。");
  await clickScrollableLayaNode(
    page,
    `page-exploration-event-option-${firstChoice.id}`,
    "page-exploration-event-scroll",
  );
  await expect.poll(async () => (
    requireExplorationPrompt(await readDebugSnapshot(page)).id
  )).not.toBe(entry.id);
  const savedPrompt = requireExplorationPrompt(await readDebugSnapshot(page));

  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  await clickScrollableLayaNode(
    page,
    "page-function-menu-option-save",
    "page-function-menu-scroll",
  );
  await waitForScreen(page, "save_slots");
  const targetSlotId = 1;
  await clickScrollableLayaNode(
    page,
    `page-save-slots-slot-${String(targetSlotId)}`,
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "message");

  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await closeAutomaticUpdateLog(page);
  await clickLayaNode(page, "menu-load-game");
  await waitForScreen(page, "save_slots");
  await clickScrollableLayaNode(
    page,
    `page-save-slots-slot-${String(targetSlotId)}`,
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "connection");
  await waitForScreen(page, "exploration_event");

  expect(requireExplorationPrompt(await readDebugSnapshot(page)).id).toBe(savedPrompt.id);
  expect(await readDebugRouteScreens(page)).toEqual([
    "dashboard",
    "expedition_status",
    "exploration_event",
  ]);
});

test("远征从整备、事件、安全返程到归来事项完成闭环", async ({ page }) => {
  test.slow();
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "远征所长");
  const exploreNode = explorationEntryNode(await readGameLayout(page));
  await clickLayaNode(page, exploreNode);
  await waitForScreen(page, "expedition_city_list");

  await clickScrollableLayaNode(
    page,
    "page-expedition-city-list-option-city_a",
    "page-expedition-city-list-scroll",
  );
  await waitForScreen(page, "expedition_city_detail");
  expect(
    await readLayaNodeBounds(page, "page-expedition-city-detail-description"),
  ).not.toBeNull();
  await clickLayaNode(page, "page-expedition-city-detail-confirm");
  await waitForScreen(page, "expedition_district_list");

  const city = (await readDebugSnapshot(page)).cities.find(
    (candidate) => candidate.id === "city_a",
  );
  if (city === undefined) {
    throw new Error("远征城市目录缺少 A 市。");
  }
  expect(city.districts.length).toBeGreaterThanOrEqual(6);
  const district = city.districts[0];
  if (district === undefined) {
    throw new Error("A 市缺少可用的默认区划。");
  }
  const districtNode = `page-expedition-district-list-option-${district.id}`;
  await clickScrollableLayaNode(
    page,
    districtNode,
    "page-expedition-district-list-scroll",
  );
  await waitForScreen(page, "expedition_district_detail");
  expect(
    await readLayaNodeBounds(page, "page-expedition-district-detail-description"),
  ).not.toBeNull();
  await clickLayaNode(page, "page-expedition-district-detail-back");
  await waitForScreen(page, "expedition_district_list");
  await clickScrollableLayaNode(
    page,
    districtNode,
    "page-expedition-district-list-scroll",
  );
  await waitForScreen(page, "expedition_district_detail");
  await clickLayaNode(page, "page-expedition-district-detail-confirm");
  await waitForScreen(page, "expedition_prepare");
  await carryExpeditionFood(page, 1);
  await clickLayaNode(page, "page-expedition-prepare-back");
  await waitForScreen(page, "expedition_district_detail");
  await clickLayaNode(page, "page-expedition-district-detail-confirm");
  await waitForScreen(page, "expedition_prepare");
  const requiredFood = (
    city.travelStepCost + district.eventStepCost + 1
  ) * survivalSystemsConfigDocument.expedition.food_units_per_action;
  await carryExpeditionFood(page, requiredFood);
  const foodItemId = survivalSystemsConfigDocument.expedition.action_food_item_id;
  await expectExpeditionCarryControlGeometry(page, foodItemId);
  await clickScrollableLayaNode(
    page,
    `page-expedition-item-${foodItemId}-increase`,
    "page-expedition-prepare-scroll",
  );
  await clickScrollableLayaNode(
    page,
    `page-expedition-item-${foodItemId}-decrease`,
    "page-expedition-prepare-scroll",
  );
  await clickLayaNode(page, "page-expedition-prepare-begin");
  await waitForScreen(page, "exploration_event");
  const expeditionSnapshot = await readDebugSnapshot(page);
  const event = expeditionSnapshot.explorationPrompt;
  if (event === null) {
    throw new Error("远征首个事件未进入调试快照。");
  }
  expect(event.options.length).toBeGreaterThanOrEqual(
    expeditionBranchingConfigDocument.policy.visible_choice_minimum,
  );
  expect(event.options.length).toBeLessThanOrEqual(
    expeditionBranchingConfigDocument.policy.visible_choice_maximum,
  );
  expect(expeditionSnapshot.expeditionStatus).toMatchObject({
    cityId: "city_a",
    districtId: district.id,
  });
  const status = expeditionSnapshot.expeditionStatus;
  if (status === null) {
    throw new Error("远征状态未进入调试快照。");
  }
  expect(status.maximumSteps).toBe(
    requiredFood / survivalSystemsConfigDocument.expedition.food_units_per_action,
  );
  expect(
    status.maximumSteps - status.travelStepCost - status.remainingSteps,
  ).toBe(district.eventStepCost);
  const resolvedDepth = await followFirstSemanticExplorationBranch(page);
  expect(resolvedDepth).toBeGreaterThanOrEqual(
    expeditionBranchingConfigDocument.policy.minimum_depth,
  );
  const eventAfterResolution = await readDebugSnapshot(page);
  expect(eventAfterResolution.explorationPrompt).toBeNull();
  expect(eventAfterResolution.expeditionStatus?.remainingSteps)
    .toBe(status.remainingSteps);
  expect((await readDebugSnapshot(page)).expeditionStatus?.cityId).toBe("city_a");

  await clickLayaNode(page, "page-expedition-status-safe-return");
  const returnIncident = (await readDebugSnapshot(page)).returnIncident;
  if (returnIncident !== null) {
    await waitForScreen(page, "return_incident");
    const availableChoice = returnIncident.choices.find((choice) => choice.available);
    if (availableChoice === undefined) {
      throw new Error("归来事项没有可执行的裁决。");
    }
    await clickScrollableLayaNode(
      page,
      `page-return-incident-choice-${availableChoice.choiceId}-select`,
      "page-return-incident-scroll",
    );
    await waitForScreen(page, "message");
    await clickLayaNode(page, "page-message-close");
  }
  await waitForScreen(page, "dashboard");
  expect((await readDebugSnapshot(page)).expeditionStatus).toBeNull();
  expect((await readDebugSnapshot(page)).returnIncident).toBeNull();
});

test("遭遇战职责完整后可执行一次真实单位指令", async ({ page }) => {
  test.slow();
  test.skip(
    await readGameLayout(page) !== "desktop",
    "仅在桌面主操作区验证完整遭遇战 Canvas 链路",
  );
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "战备所长");
  await clickLayaNode(page, "dashboard-action-encounter_battle");
  await waitForScreen(page, "encounter_catalog");

  const catalog = (await readDebugSnapshot(page)).encounterCatalog;
  const encounter = catalog?.encounters.find((candidate) => candidate.available);
  if (encounter === undefined) {
    throw new Error("遭遇目录没有可用战斗。");
  }
  await clickScrollableLayaNode(
    page,
    `page-encounter-catalog-${encounter.encounterId}-start`,
    "page-encounter-catalog-scroll",
  );
  await waitForScreen(page, "encounter_preparation");

  const preparation = (await readDebugSnapshot(page))
    .encounterPreparations[encounter.encounterId]?.preparation;
  if (preparation === undefined || preparation.members.length === 0) {
    throw new Error("遭遇战整备页缺少参战单位。");
  }
  const role = preparation.roles[0];
  if (role === undefined) {
    throw new Error("遭遇战整备页缺少可分配职责。");
  }

  await clickLayaNode(page, "page-encounter-preparation-start");
  expect(await page.evaluate(() => document.body.dataset.gameScreen ?? null))
    .toBe("encounter_preparation");
  expect((await readDebugSnapshot(page)).encounterBattle).toBeNull();

  for (const member of preparation.members) {
    await clickScrollableLayaNode(
      page,
      `page-encounter-preparation-member-${member.member_id}-role-${role.role_id}`,
      "page-encounter-preparation-scroll",
    );
  }
  await clickLayaNode(page, "page-encounter-preparation-start");
  await waitForScreen(page, "encounter_battle");

  const battle = (await readDebugSnapshot(page)).encounterBattle;
  if (battle === null) {
    throw new Error("职责分配完整后未创建遭遇战状态。");
  }
  const actorId = battle.state.pending_party_member_ids[0];
  const actor = battle.state.party.find((member) => member.member_id === actorId);
  if (actorId === undefined || actor === undefined) {
    throw new Error("遭遇战缺少待行动单位。");
  }
  const actorActions = battle.actionsByActor[actorId] ?? [];
  const action = actorActions.find((candidate) => (
    candidate.action === "attack"
    && candidate.available
    && candidate.targetIds.length > 0
  )) ?? actorActions.find((candidate) => (
    candidate.available && candidate.targetIds.length > 0
  ));
  if (action === undefined) {
    throw new Error("待行动单位没有可选择目标的指令。");
  }
  const targetId = action.targetIds[0];
  if (targetId === undefined) {
    throw new Error("可用遭遇战指令缺少目标。");
  }

  await clickScrollableLayaNode(
    page,
    `page-encounter-battle-party-${actor.row}-${actorId}`,
    "page-encounter-battle-scroll",
  );
  await clickScrollableLayaNode(
    page,
    `page-encounter-battle-action-${encounterActionNodeId(action)}`,
    "page-encounter-battle-scroll",
  );
  await clickScrollableLayaNode(
    page,
    `page-encounter-battle-target-${targetId}`,
    "page-encounter-battle-scroll",
  );
  const previousLogLength = battle.state.log.length;
  const previousEnemyHealth = totalEncounterEnemyHealth(battle.state);
  await clickLayaNode(page, "page-encounter-battle-execute");
  await expect.poll(async () => (
    (await readDebugSnapshot(page)).encounterBattle?.state.log.length ?? 0
  )).toBeGreaterThan(previousLogLength);

  const resolvedBattle = (await readDebugSnapshot(page)).encounterBattle;
  if (resolvedBattle === null) {
    throw new Error("单位指令结算后遭遇战状态意外丢失。");
  }
  expect(totalEncounterEnemyHealth(resolvedBattle.state)).toBeLessThan(
    previousEnemyHealth,
  );
  expect(resolvedBattle.state.log.length).toBeGreaterThan(previousLogLength);
});

test("避难所活动先显示需求且确认一次只结算一次", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "活动所长");
  await clickLayaNode(page, managementEntryNode(await readGameLayout(page)));
  await waitForScreen(page, "management_categories");
  await clickScrollableLayaNode(
    page,
    "page-management-categories-option-activity",
    "page-management-categories-scroll",
  );
  await waitForScreen(page, "management_options");
  await clickScrollableLayaNode(
    page,
    "page-management-options-option-activity::shared_supper",
    "page-management-options-scroll",
  );
  await waitForScreen(page, "management_option_detail");
  expect(
    await readLayaNodeBounds(page, "page-management-option-detail-requirement-shared_supper-unlock"),
  ).not.toBeNull();
  await clickLayaNode(page, "page-management-option-detail-confirm");
  await waitForScreen(page, "message");

  expect((await readDebugSnapshot(page)).clock?.turnLabel).toBe("第 2 回合");
});

test("工作详情按配置循环次数并一次提交三轮工作", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "轮班所长");
  await clickLayaNode(page, managementEntryNode(await readGameLayout(page)));
  await waitForScreen(page, "management_categories");
  await clickScrollableLayaNode(
    page,
    "page-management-categories-option-work",
    "page-management-categories-scroll",
  );
  await waitForScreen(page, "management_options");
  await clickScrollableLayaNode(
    page,
    "page-management-options-option-job::sort_salvage",
    "page-management-options-scroll",
  );
  await waitForScreen(page, "management_option_detail");
  expect(
    await readLayaNodeBounds(page, "page-management-option-detail-repetitions"),
  ).not.toBeNull();

  await clickLayaNode(page, "page-management-option-detail-repetitions");
  await clickLayaNode(page, "page-management-option-detail-repetitions");
  await clickLayaNode(page, "page-management-option-detail-confirm");
  await waitForScreen(page, "message");

  expect((await readDebugSnapshot(page)).clock?.turnLabel).toBe("第 6 回合");
});

test("锁定城市可进入详情查看需求但不能继续", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  await startSingleGame(page, "情报所长");
  await clickLayaNode(page, explorationEntryNode(await readGameLayout(page)));
  await waitForScreen(page, "expedition_city_list");
  const disabledCity = (await readDebugSnapshot(page)).cities.find(
    (city) => city.disabled,
  );
  if (disabledCity === undefined) {
    throw new Error("当前城市拓扑缺少禁用城市。");
  }
  const cityNode = `page-expedition-city-list-option-${disabledCity.id}`;
  await clickScrollableLayaNode(
    page,
    cityNode,
    "page-expedition-city-list-scroll",
  );
  await waitForScreen(page, "expedition_city_detail");
  expect(
    await readLayaNodeBounds(
      page,
      "page-expedition-city-detail-requirement-city-access",
    ),
  ).not.toBeNull();
  expect(
    await readLayaNodeBounds(page, "page-expedition-city-detail-confirm"),
  ).not.toBeNull();
  await clickLayaNode(page, "page-expedition-city-detail-confirm");
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameScreen ?? null,
  )).toBe("expedition_city_detail");
  expect((await readDebugSnapshot(page)).expeditionStatus).toBeNull();
  await clickLayaNode(page, "page-expedition-city-detail-back");
  await waitForScreen(page, "expedition_city_list");
});

test("真实手机能力使用移动布局且关键入口满足触控尺寸", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  const device = await page.evaluate(() => document.body.dataset.gameDevice);
  test.skip(device !== "mobile", "仅在配置化移动设备项目中验证物理触控尺寸");

  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameLayout,
  )).toBe("mobile");
  const firstButton = await readCssNodeBounds(page, "menu-new-game");
  const coverSettingsButton = await readCssNodeBounds(page, "menu-settings");
  expect(firstButton).not.toBeNull();
  expect(coverSettingsButton).not.toBeNull();
  expect(firstButton?.height).toBeGreaterThanOrEqual(
    qualityConfig.minimum_touch_css_px,
  );
  expect(coverSettingsButton?.height).toBeGreaterThanOrEqual(
    qualityConfig.minimum_touch_css_px,
  );
  expect(coverSettingsButton?.y).toBeLessThan(firstButton?.y ?? 0);

  await startSingleGame(page, "触控所长");
  const settingsButton = await readCssNodeBounds(page, "dashboard-settings");
  expect(settingsButton).not.toBeNull();
  expect(settingsButton?.width).toBeGreaterThanOrEqual(
    qualityConfig.minimum_touch_css_px,
  );
  expect(settingsButton?.height).toBeGreaterThanOrEqual(
    qualityConfig.minimum_touch_css_px,
  );
});

test("700x900 桌面视口使用 compact 指挥台与底部导航", async ({
  page,
}, testInfo) => {
  await closeAutomaticUpdateLog(page);
  test.skip(testInfo.project.name !== "desktop_compact", "仅验证配置化 700x900 紧凑桌面");

  expect(await page.evaluate(() => document.body.dataset.gameDevice)).toBe("desktop");
  expect(await readGameLayout(page)).toBe("compact");
  await startSingleGame(page, "紧凑所长");

  expect(await readGameLayout(page)).toBe("compact");
  expect(await readLayaNodeBounds(page, "dashboard-mobile-scroll")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "mobile-bottom-navigation")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "bottom-nav-explore")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "dashboard-settings")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "dashboard-right-rail")).toBeNull();
});

test("手机软键盘尺寸变化不会清空姓名或夺走输入焦点", async ({ page }) => {
  await closeAutomaticUpdateLog(page);
  const device = await page.evaluate(() => document.body.dataset.gameDevice);
  test.skip(device !== "mobile", "仅在配置化移动设备项目中验证软键盘链路");

  await clickLayaNode(page, "menu-new-game");
  await waitForScreen(page, "name_input");
  await clickLayaNode(page, "player-name-1");
  const input = page.getByPlaceholder(
    webConfigDocument.texts.profile_name_label,
    { exact: true },
  );
  const inputConfig = webConfigDocument.new_game_setup.name_input;
  await expect(input).toHaveAttribute("type", inputConfig.html_type);
  await expect(input).toHaveAttribute("inputmode", inputConfig.input_mode);
  await expect(input).toHaveAttribute("lang", inputConfig.language);
  await expect(input).toHaveAttribute(
    "enterkeyhint",
    inputConfig.enter_key_hint,
  );
  await expect(input).toHaveAttribute("autocomplete", inputConfig.autocomplete);
  await expect(input).toHaveAttribute(
    "autocapitalize",
    inputConfig.autocapitalize,
  );
  await expect(input).toHaveAttribute(
    "spellcheck",
    String(inputConfig.spellcheck),
  );
  await input.fill("手机守夜人");
  await input.focus();
  const initialViewport = page.viewportSize();
  if (initialViewport === null) {
    throw new Error("手机测试视口不存在。");
  }
  await page.setViewportSize({
    width: initialViewport.width,
    height: Math.max(
      qualityConfig.keyboard_minimum_viewport_height_px,
      initialViewport.height - qualityConfig.keyboard_simulated_height_px,
    ),
  });
  await page.waitForTimeout(
    responsiveConfig.resize_debounce_ms +
      responsiveConfig.keyboard_resize_settle_ms,
  );

  await expect(input).toHaveValue("手机守夜人");
  await expect(input).toBeFocused();
  await waitForScreen(page, "name_input");

  await page.setViewportSize(initialViewport);
  await input.blur();
});
