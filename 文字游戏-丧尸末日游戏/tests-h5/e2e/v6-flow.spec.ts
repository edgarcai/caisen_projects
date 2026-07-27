import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import type {
  GameMode,
  GameUiSnapshot,
  UiCompanionView,
} from "../../src/ui/ports/GameUiPort";

interface ConfiguredMode {
  readonly id: GameMode;
  readonly label: string;
  readonly description: string;
}

interface V6WebConfig {
  readonly new_game_setup: {
    readonly mode_options: readonly ConfiguredMode[];
  };
  readonly storage: {
    readonly key: string;
    readonly schema_version: number;
  };
  readonly texts: {
    readonly profile_name_label: string;
  };
  readonly quality_assurance: {
    readonly scroll_drag_ratio: number;
    readonly scroll_drag_steps: number;
    readonly scroll_max_attempts: number;
    readonly scroll_settle_ms: number;
  };
}

interface CampaignOptionConfig {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

interface CampaignTraitConfig extends CampaignOptionConfig {
  readonly expedition_step_bonus: number;
}

interface V6GameConfig {
  readonly campaign_profiles: {
    readonly origins: readonly CampaignOptionConfig[];
    readonly traits: readonly CampaignTraitConfig[];
  };
  readonly rules: {
    readonly player_counts: Readonly<Record<GameMode, unknown>>;
  };
}

interface WarehouseItemConfig {
  readonly item_id: string;
  readonly category: string;
  readonly state_target?: string;
}

interface V6SurvivalConfig {
  readonly warehouse: {
    readonly resource_items: readonly WarehouseItemConfig[];
    readonly crafted_items: readonly WarehouseItemConfig[];
  };
  readonly expedition: {
    readonly base_steps: number;
    readonly maximum_carried_units: number;
    readonly forced_return_keep_percent: number;
    readonly forced_return_health_range: readonly [number, number];
  };
}

interface CompanionInteractionConfig {
  readonly interaction_id: string;
  readonly hope_gain: number;
  readonly costs: readonly unknown[];
}

interface V6StoryConfig {
  readonly companion_management: {
    readonly interactions: readonly CompanionInteractionConfig[];
  };
}

interface DebugNodeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
}

type CssNodeBounds = Omit<DebugNodeBounds, "stageWidth" | "stageHeight">;

const TARGET_PROJECTS = new Set(["desktop", "mobile"]);
const DESKTOP_PROJECT = "desktop";
const MOBILE_PROJECT = "mobile";
const REQUIRED_MODE_COUNT = 4;
const REQUIRED_ORIGIN_COUNT = 5;
const REQUIRED_BASE_STEPS = 10;
const REQUIRED_METICULOUS_STEPS = 9;

/** 读取一份仓库权威 JSON 配置，避免测试复制产品 ID 与数值。 */
function loadConfig(relativePath: string): unknown {
  const configPath = resolve(import.meta.dirname, "../../", relativePath);
  return JSON.parse(readFileSync(configPath, "utf8")) as unknown;
}

const webConfig = loadConfig("config/web_config.json") as V6WebConfig;
const gameConfig = loadConfig("config/game_config.json") as V6GameConfig;
const survivalConfig = loadConfig(
  "config/survival_systems.json",
) as V6SurvivalConfig;
const storyConfig = loadConfig("config/story.json") as V6StoryConfig;
const qualityConfig = webConfig.quality_assurance;

/**
 * 在携带上限内找到能按配置比例整数保留的最小数量，
 * 避免测试数据越过存档容量或因逐项取整产生假失败。
 */
function resolveSettlementQuantity(
  maximumQuantity: number,
  keepPercent: number,
): number {
  for (let quantity = 1; quantity <= maximumQuantity; quantity += 1) {
    if ((quantity * keepPercent) % 100 === 0) {
      return quantity;
    }
  }
  throw new Error("配置的携带上限无法构造整数保留的损失测试。");
}

const SETTLEMENT_ITEM_QUANTITY = resolveSettlementQuantity(
  survivalConfig.expedition.maximum_carried_units,
  survivalConfig.expedition.forced_return_keep_percent,
);

/** 等待 Laya 页面栈进入指定稳定页面。 */
async function waitForScreen(page: Page, screen: string): Promise<void> {
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameScreen ?? null,
  )).toBe(screen);
}

/** 读取页面组合根暴露的只读游戏快照。 */
async function readDebugSnapshot(page: Page): Promise<GameUiSnapshot> {
  return page.evaluate(() => {
    const debug = window.__SHELTER_GAME__;
    if (debug === undefined) {
      throw new Error("游戏只读诊断接口尚未就绪。");
    }
    return debug.getSnapshot();
  });
}

/** 读取指定 Laya 节点在舞台中的可见边界。 */
async function readLayaNodeBounds(
  page: Page,
  nodeName: string,
): Promise<DebugNodeBounds | null> {
  return page.evaluate((requestedName) =>
    window.__SHELTER_GAME__?.getNodeBounds(requestedName) ?? null,
  nodeName);
}

/** 把 Laya 舞台节点换算为浏览器 CSS 像素边界。 */
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

/** 把真实指针或触摸点提交到 Laya 节点中心。 */
async function clickLayaNode(page: Page, nodeName: string): Promise<void> {
  const position = await page.evaluate((requestedName) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#layaCanvas");
    const bounds = window.__SHELTER_GAME__?.getNodeBounds(requestedName) ?? null;
    if (canvas === null || bounds === null) {
      return null;
    }
    const rectangle = canvas.getBoundingClientRect();
    return {
      x: rectangle.left
        + ((bounds.x + bounds.width / 2) / bounds.stageWidth) * rectangle.width,
      y: rectangle.top
        + ((bounds.y + bounds.height / 2) / bounds.stageHeight) * rectangle.height,
      hasTouch: navigator.maxTouchPoints > 0,
    };
  }, nodeName);
  if (position === null) {
    throw new Error(`找不到可点击的 Laya 节点：${nodeName}`);
  }
  if (position.hasTouch) {
    await page.touchscreen.tap(position.x, position.y);
    return;
  }
  await page.mouse.click(position.x, position.y);
}

/** 根据节点高度判断目标本体或其可点击中心是否进入视口。 */
function isScrollableTargetReady(
  target: CssNodeBounds,
  viewport: CssNodeBounds,
): boolean {
  const viewportBottom = viewport.y + viewport.height;
  if (target.height > viewport.height) {
    const targetCenter = target.y + target.height / 2;
    return targetCenter >= viewport.y && targetCenter <= viewportBottom;
  }
  return target.y >= viewport.y
    && target.y + target.height <= viewportBottom;
}

/** 按当前设备能力在 Canvas 上执行一次鼠标或触控拖动。 */
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
      throw new Error("页面缺少 Laya Canvas，无法执行触控滚动。");
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

    /** 向真实 Canvas 派发一段可取消的单指事件。 */
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

/** 拖动指定 Laya 滚动区，直到目标进入可点击范围。 */
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
    if (isScrollableTargetReady(target, viewport)) {
      return;
    }
    if (attempt === qualityConfig.scroll_max_attempts) {
      break;
    }
    const dragDistance = viewport.height * qualityConfig.scroll_drag_ratio;
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    const targetBelow = target.y + target.height / 2 > centerY;
    const direction = targetBelow ? 1 : -1;
    await dragLayaCanvas(
      page,
      { x: centerX, y: centerY + (dragDistance * direction) / 2 },
      { x: centerX, y: centerY - (dragDistance * direction) / 2 },
    );
    await page.waitForTimeout(qualityConfig.scroll_settle_ms);
  }
  throw new Error(`目标节点在配置化滚动次数内仍不可见：${nodeName}`);
}

/** 先把节点滚入对应视口，再提交一次真实点击。 */
async function clickScrollableLayaNode(
  page: Page,
  nodeName: string,
  scrollViewportName: string,
): Promise<void> {
  await scrollLayaNodeIntoView(page, nodeName, scrollViewportName);
  await clickLayaNode(page, nodeName);
}

/** 清空本地状态并走到自动更新日志页。 */
async function bootFreshGame(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await waitForScreen(page, "publisher_splash");
  await clickLayaNode(page, "page-publisher-splash");
  await waitForScreen(page, "update_log");
}

/** 关闭自动更新日志并返回封面主菜单。 */
async function closeAutomaticUpdateLog(page: Page): Promise<void> {
  await clickLayaNode(page, "page-update-log-close");
  await waitForScreen(page, "menu");
}

/** 在建档页中填写可包含中文的所长姓名并结束原生输入。 */
async function fillCommanderName(page: Page, playerName: string): Promise<void> {
  await clickLayaNode(page, "player-name-1");
  const input = page.getByPlaceholder(
    webConfig.texts.profile_name_label,
    { exact: true },
  );
  await expect(input).toBeVisible();
  await input.fill(playerName);
  await input.blur();
}

/** 打开普通入口的类太空策略建档页。 */
async function openNewGameSetup(page: Page, playerName: string): Promise<void> {
  await closeAutomaticUpdateLog(page);
  await clickLayaNode(page, "menu-new-game");
  await waitForScreen(page, "name_input");
  await fillCommanderName(page, playerName);
}

/** 在建档页选中一个由配置 ID 定位的真实选项。 */
async function selectSetupOption(
  page: Page,
  categoryId: "mode" | "origin" | "trait",
  optionId: string,
): Promise<void> {
  await clickLayaNode(page, `profile-category-${categoryId}`);
  await clickScrollableLayaNode(
    page,
    `profile-${categoryId}-option-${optionId}`,
    "profile-setup-options-scroll",
  );
}

/** 提交建档页，跳过教程后等待通讯过场结束。 */
async function submitNewGame(page: Page): Promise<void> {
  await clickLayaNode(page, "player-name-submit");
  await waitForScreen(page, "pre_game_notice");
  await clickLayaNode(page, "pre-game-notice-continue");
  await waitForScreen(page, "connection");
  await waitForScreen(page, "dashboard");
}

/** 用当前默认档案开始一局普通游戏。 */
async function startDefaultGame(page: Page, playerName: string): Promise<void> {
  await openNewGameSetup(page, playerName);
  await submitNewGame(page);
}

/** 通过 Escape 菜单把当前完整领域状态写入一号栏。 */
async function saveToFirstSlot(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  await clickScrollableLayaNode(
    page,
    "page-function-menu-option-save",
    "page-function-menu-scroll",
  );
  await waitForScreen(page, "save_slots");
  await clickScrollableLayaNode(
    page,
    "page-save-slots-slot-1",
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "message");
  await expect.poll(async () => page.evaluate((storageKey) =>
    localStorage.getItem(storageKey), webConfig.storage.key,
  )).not.toBeNull();
}

/** 刷新运行时后经封面真实读取一号栏存档。 */
async function reloadAndLoadFirstSlot(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await waitForScreen(page, "publisher_splash");
  await clickLayaNode(page, "page-publisher-splash");
  await waitForScreen(page, "update_log");
  await closeAutomaticUpdateLog(page);
  await clickLayaNode(page, "menu-load-game");
  await waitForScreen(page, "save_slots");
  await clickScrollableLayaNode(
    page,
    "page-save-slots-slot-1",
    "page-save-slots-scroll",
  );
  await waitForScreen(page, "connection");
  await waitForScreen(page, "dashboard");
}

/** 在一份合法 v6 存档中注入配置化装备，供真实配装 UI 消费。 */
async function seedCraftedEquipment(
  page: Page,
  itemId: string,
): Promise<void> {
  await page.evaluate(({ storageKey, schemaVersion, equipmentId }) => {
    const serialized = localStorage.getItem(storageKey);
    if (serialized === null) {
      throw new Error("一号栏存档不存在。");
    }
    const document = JSON.parse(serialized) as {
      schema_version: number;
      game_state: {
        inventory: { crafted_items: Record<string, number> };
      };
    };
    if (document.schema_version !== schemaVersion) {
      throw new Error("测试只允许修改当前 v6 存档。");
    }
    document.game_state.inventory.crafted_items[equipmentId] = 1;
    localStorage.setItem(storageKey, JSON.stringify(document));
  }, {
    storageKey: webConfig.storage.key,
    schemaVersion: webConfig.storage.schema_version,
    equipmentId: itemId,
  });
}

/** 返回一个可配装且拥有指定装备候选的已入队伙伴。 */
function requireManageableCompanion(
  snapshot: GameUiSnapshot,
  equipmentId: string,
): UiCompanionView {
  const companion = snapshot.companions.find((candidate) =>
    candidate.canManage
    && candidate.weaponOptions.some((option) => option.id === equipmentId),
  );
  if (companion === undefined) {
    throw new Error(`没有伙伴可配置装备 ${equipmentId}。`);
  }
  return companion;
}

/** 把格式化的避难所统计转换为可断言数字。 */
function requireShelterStat(
  snapshot: GameUiSnapshot,
  statId: string,
): number {
  const stat = snapshot.shelterStats.find((candidate) => candidate.id === statId);
  const value = Number(stat?.value);
  if (!Number.isFinite(value)) {
    throw new Error(`避难所统计缺失或无效：${statId}`);
  }
  return value;
}

/** 从伙伴互动页按页面栈逐级返回指挥台。 */
async function returnFromCompanionInteraction(page: Page): Promise<void> {
  await clickLayaNode(page, "page-companion-interaction-back");
  await waitForScreen(page, "companion_management_detail");
  await clickLayaNode(page, "page-companion-management-detail-back");
  await waitForScreen(page, "companion_detail");
  await clickLayaNode(page, "page-companion-detail-back");
  await waitForScreen(page, "companions");
  await clickLayaNode(page, "page-companions-back");
  await waitForScreen(page, "dashboard");
}

/** 在桌面或紧凑指挥台中打开真实伙伴入口。 */
async function openCompanionArchive(page: Page): Promise<void> {
  const layout = await page.evaluate(() => document.body.dataset.gameLayout);
  if (layout === "desktop") {
    await clickLayaNode(page, "dashboard-action-companions");
  } else {
    await clickScrollableLayaNode(
      page,
      "dashboard-action-companions",
      "dashboard-mobile-scroll",
    );
  }
  await waitForScreen(page, "companions");
}

/** 完整执行伙伴档案、配装和互动并返回互动后快照。 */
async function exerciseCompanionManagement(
  page: Page,
  equipmentId: string,
  interactionId: string,
): Promise<{
  readonly snapshot: GameUiSnapshot;
  readonly hopeBefore: number;
  readonly companionId: string;
  readonly interactionCountBefore: number;
}> {
  const initialSnapshot = await readDebugSnapshot(page);
  const companion = requireManageableCompanion(initialSnapshot, equipmentId);
  await openCompanionArchive(page);
  await clickScrollableLayaNode(
    page,
    `page-companions-option-${companion.id}`,
    "page-companions-scroll",
  );
  await waitForScreen(page, "companion_detail");
  expect(
    await readLayaNodeBounds(page, `companion-${companion.id}-portrait-frame`),
  ).not.toBeNull();
  expect(
    await readLayaNodeBounds(page, `companion-${companion.id}-archive`),
  ).not.toBeNull();

  await clickLayaNode(page, "page-companion-detail-manage");
  await waitForScreen(page, "companion_management_detail");
  await clickScrollableLayaNode(
    page,
    "page-companion-management-detail-option-weapon",
    "page-companion-management-detail-scroll",
  );
  await waitForScreen(page, "companion_equipment");
  await clickScrollableLayaNode(
    page,
    `page-companion-equipment-option-${equipmentId}`,
    "page-companion-equipment-scroll",
  );
  await waitForScreen(page, "message");
  expect(
    (await readDebugSnapshot(page)).companions.find(
      (candidate) => candidate.id === companion.id,
    )?.equippedWeapon?.id,
  ).toBe(equipmentId);
  await clickLayaNode(page, "page-message-close");
  await waitForScreen(page, "companion_equipment");
  await clickLayaNode(page, "page-companion-equipment-back");
  await waitForScreen(page, "companion_management_detail");

  const beforeInteraction = await readDebugSnapshot(page);
  const hopeBefore = requireShelterStat(beforeInteraction, "shelter-hope");
  const interactionCountBefore = beforeInteraction.companions.find(
    (candidate) => candidate.id === companion.id,
  )?.interactionCount ?? -1;
  await clickScrollableLayaNode(
    page,
    "page-companion-management-detail-option-interaction",
    "page-companion-management-detail-scroll",
  );
  await waitForScreen(page, "companion_interaction");
  await clickScrollableLayaNode(
    page,
    `page-companion-interaction-option-${interactionId}`,
    "page-companion-interaction-scroll",
  );
  await waitForScreen(page, "message");
  return {
    snapshot: await readDebugSnapshot(page),
    hopeBefore,
    companionId: companion.id,
    interactionCountBefore,
  };
}

/** 用真实 UI 从本城首个区划开始一次无同行、无携带远征。 */
async function beginUnassistedHomeExpedition(
  page: Page,
): Promise<NonNullable<GameUiSnapshot["expeditionStatus"]>> {
  await clickLayaNode(page, "dashboard-action-explore");
  await waitForScreen(page, "expedition_city_list");
  const snapshot = await readDebugSnapshot(page);
  const homeCityId = snapshot.campaignProfileOptions.defaultSelection.homeCityId;
  const homeCity = snapshot.cities.find((city) => city.id === homeCityId);
  const district = homeCity?.districts[0];
  if (homeCity === undefined || district === undefined || homeCity.disabled) {
    throw new Error("默认本城或其首个区划不可用。");
  }
  await clickScrollableLayaNode(
    page,
    `page-expedition-city-list-option-${homeCity.id}`,
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
  await clickLayaNode(page, "page-expedition-prepare-begin");
  await waitForScreen(page, "exploration_event");
  const status = (await readDebugSnapshot(page)).expeditionStatus;
  if (status === null) {
    throw new Error("远征开始后未生成步数状态。");
  }
  return status;
}

/** 将真实远征存档调整为零步数可审计失败场景。 */
async function seedExhaustedExpedition(
  page: Page,
  carriedItemId: string,
  lootItemId: string,
): Promise<void> {
  await page.evaluate(({
    storageKey,
    schemaVersion,
    carriedId,
    carriedQuantity,
    lootId,
    lootQuantity,
  }) => {
    const serialized = localStorage.getItem(storageKey);
    if (serialized === null) {
      throw new Error("一号栏存档不存在。");
    }
    const document = JSON.parse(serialized) as {
      schema_version: number;
      game_state: {
        active_player_index: number;
        players: { food: number }[];
        pending_exploration: unknown;
        last_expedition_failure: unknown;
        expedition: {
          leader_player_index: number;
          carried_items: Record<string, number>;
          loot: Record<string, number>;
          remaining_steps: number;
        } | null;
      };
    };
    if (document.schema_version !== schemaVersion) {
      throw new Error("测试只允许修改当前 v6 存档。");
    }
    const state = document.game_state;
    const expedition = state.expedition;
    const player = state.players[state.active_player_index];
    if (expedition === null || player === undefined) {
      throw new Error("存档缺少正在进行的远征或领队所长。");
    }
    if (player.food < carriedQuantity) {
      throw new Error("存档食物不足以构造物资守恒的携带场景。");
    }
    player.food -= carriedQuantity;
    expedition.leader_player_index = state.active_player_index;
    expedition.carried_items = { [carriedId]: carriedQuantity };
    expedition.loot = { [lootId]: lootQuantity };
    expedition.remaining_steps = 0;
    state.pending_exploration = null;
    state.last_expedition_failure = null;
    localStorage.setItem(storageKey, JSON.stringify(document));
  }, {
    storageKey: webConfig.storage.key,
    schemaVersion: webConfig.storage.schema_version,
    carriedId: carriedItemId,
    carriedQuantity: SETTLEMENT_ITEM_QUANTITY,
    lootId: lootItemId,
    lootQuantity: SETTLEMENT_ITEM_QUANTITY,
  });
}

test("五个起源与四个模式均由建档 UI 暴露并可真实进入无尽求生", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, "仅在桌面基准项目验证全量建档列表");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => { runtimeErrors.push(error.message); });
  await bootFreshGame(page);
  await openNewGameSetup(page, "无尽守夜人");

  const configuredModeIds = webConfig.new_game_setup.mode_options.map(
    (mode) => mode.id,
  );
  const domainModeIds = Object.keys(gameConfig.rules.player_counts).sort();
  expect(configuredModeIds).toHaveLength(REQUIRED_MODE_COUNT);
  expect([...configuredModeIds].sort()).toEqual(domainModeIds);
  expect((await readDebugSnapshot(page)).campaignProfileOptions.origins)
    .toHaveLength(REQUIRED_ORIGIN_COUNT);
  expect(gameConfig.campaign_profiles.origins).toHaveLength(REQUIRED_ORIGIN_COUNT);

  await clickLayaNode(page, "profile-category-mode");
  for (const mode of webConfig.new_game_setup.mode_options) {
    expect(
      await readLayaNodeBounds(page, `profile-mode-option-${mode.id}`),
    ).not.toBeNull();
  }
  const endlessMode = webConfig.new_game_setup.mode_options.find(
    (mode) => mode.id === "endless",
  );
  if (endlessMode === undefined) {
    throw new Error("配置缺少无尽求生模式。");
  }
  await selectSetupOption(page, "mode", endlessMode.id);

  await clickLayaNode(page, "profile-category-origin");
  for (const origin of gameConfig.campaign_profiles.origins) {
    expect(
      await readLayaNodeBounds(page, `profile-origin-option-${origin.id}`),
    ).not.toBeNull();
  }
  const selectedOrigin = gameConfig.campaign_profiles.origins.at(-1);
  if (selectedOrigin === undefined) {
    throw new Error("配置缺少可选起源。");
  }
  await selectSetupOption(page, "origin", selectedOrigin.id);
  await submitNewGame(page);

  const snapshot = await readDebugSnapshot(page);
  expect(snapshot.mode).toBe(endlessMode.id);
  expect(snapshot.campaignProfile?.modeLabel).toBe(endlessMode.label);
  expect(snapshot.campaignProfile?.originLabel).toBe(selectedOrigin.label);
  expect(runtimeErrors).toEqual([]);
});

test("伙伴档案可查看立绘、完成配装与互动，手机可打开完整通讯", async ({
  page,
}, testInfo) => {
  test.skip(!TARGET_PROJECTS.has(testInfo.project.name), "仅在桌面与标准手机项目验证伙伴闭环");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => { runtimeErrors.push(error.message); });
  const weapon = survivalConfig.warehouse.crafted_items.find(
    (item) => item.category === "weapon",
  );
  const interaction = storyConfig.companion_management.interactions.find(
    (item) => item.costs.length === 0 && item.hope_gain > 0,
  );
  if (weapon === undefined || interaction === undefined) {
    throw new Error("配置缺少无额外成本的希望互动或伙伴武器。");
  }

  await bootFreshGame(page);
  await startDefaultGame(page, "伙伴守望者");
  await saveToFirstSlot(page);
  await seedCraftedEquipment(page, weapon.item_id);
  await reloadAndLoadFirstSlot(page);

  const result = await exerciseCompanionManagement(
    page,
    weapon.item_id,
    interaction.interaction_id,
  );
  const hopeAfter = requireShelterStat(result.snapshot, "shelter-hope");
  const companionAfter = result.snapshot.companions.find(
    (candidate) => candidate.id === result.companionId,
  );
  expect(hopeAfter).toBeGreaterThan(result.hopeBefore);
  expect(hopeAfter).toBeLessThanOrEqual(
    result.hopeBefore + interaction.hope_gain,
  );
  expect(companionAfter?.interactionCount)
    .toBe(result.interactionCountBefore + 1);
  expect(companionAfter?.equippedWeapon?.id).toBe(weapon.item_id);
  expect(await readLayaNodeBounds(page, "page-message-content")).not.toBeNull();

  await clickLayaNode(page, "page-message-close");
  await waitForScreen(page, "companion_interaction");
  await returnFromCompanionInteraction(page);
  if (testInfo.project.name === MOBILE_PROJECT) {
    expect(await readLayaNodeBounds(page, "dashboard-mobile-log-panel"))
      .not.toBeNull();
    await clickScrollableLayaNode(
      page,
      "dashboard-mobile-log-open",
      "dashboard-mobile-scroll",
    );
    await waitForScreen(page, "communication_log");
    expect(await readLayaNodeBounds(page, "page-communication-log"))
      .not.toBeNull();
    expect(await readLayaNodeBounds(page, "page-communication-log-content"))
      .not.toBeNull();
  }
  expect(runtimeErrors).toEqual([]);
});

test("基础十步与谨慎周密九步生效，零步数强制返程结算 80% 损失", async ({
  page,
}, testInfo) => {
  test.slow();
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, "仅在桌面基准项目验证可控远征失败链路");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => { runtimeErrors.push(error.message); });
  const cautiousTrait = gameConfig.campaign_profiles.traits.find(
    (trait) => trait.expedition_step_bonus < 0,
  );
  const carriedItem = survivalConfig.warehouse.resource_items.find(
    (item) => item.state_target === "player.food",
  );
  const lootItem = survivalConfig.warehouse.resource_items.find(
    (item) => item.state_target === "player.medical_supplies",
  );
  if (cautiousTrait === undefined || carriedItem === undefined || lootItem === undefined) {
    throw new Error("配置缺少谨慎特性或远征结算物资。");
  }
  expect(survivalConfig.expedition.base_steps).toBe(REQUIRED_BASE_STEPS);
  expect(
    survivalConfig.expedition.base_steps + cautiousTrait.expedition_step_bonus,
  ).toBe(REQUIRED_METICULOUS_STEPS);

  await bootFreshGame(page);
  await openNewGameSetup(page, "周密行动者");
  await selectSetupOption(page, "trait", cautiousTrait.id);
  await submitNewGame(page);
  const expeditionStatus = await beginUnassistedHomeExpedition(page);
  expect(expeditionStatus.maximumSteps).toBe(REQUIRED_METICULOUS_STEPS);
  expect(expeditionStatus.companionIds).toEqual([]);
  expect(expeditionStatus.carriedItems).toEqual({});

  await saveToFirstSlot(page);
  await seedExhaustedExpedition(
    page,
    carriedItem.item_id,
    lootItem.item_id,
  );
  await reloadAndLoadFirstSlot(page);
  await clickLayaNode(page, "dashboard-action-explore");
  await waitForScreen(page, "expedition_status");
  const exhaustedStatus = (await readDebugSnapshot(page)).expeditionStatus;
  expect(exhaustedStatus?.remainingSteps).toBe(0);
  expect(exhaustedStatus?.maximumSteps).toBe(REQUIRED_METICULOUS_STEPS);
  await clickLayaNode(page, "page-expedition-status-continue");
  await waitForScreen(page, "expedition_failure");

  const failure = (await readDebugSnapshot(page)).expeditionFailure;
  if (failure === null) {
    throw new Error("强制返程后未生成结构化失败摘要。");
  }
  const keepPercent = survivalConfig.expedition.forced_return_keep_percent;
  const expectedKept = Math.floor(
    SETTLEMENT_ITEM_QUANTITY * keepPercent / 100,
  ) * 2;
  const expectedTotal = SETTLEMENT_ITEM_QUANTITY * 2;
  const expectedLost = expectedTotal - expectedKept;
  expect(failure.keptPercent).toBe(keepPercent);
  expect(failure.totalBefore).toBe(expectedTotal);
  expect(failure.totalKept).toBe(expectedKept);
  expect(failure.totalLost).toBe(expectedLost);
  expect((failure.totalLost / failure.totalBefore) * 100).toBe(
    100 - keepPercent,
  );
  expect(keepPercent).toBe(20);
  expect(100 - keepPercent).toBe(80);
  expect(failure.healthAfter).toBeGreaterThanOrEqual(
    survivalConfig.expedition.forced_return_health_range[0],
  );
  expect(failure.healthAfter).toBeLessThanOrEqual(
    survivalConfig.expedition.forced_return_health_range[1],
  );
  expect(failure.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source: "carried",
      id: `carried:${carriedItem.item_id}`,
      before: SETTLEMENT_ITEM_QUANTITY,
      kept: Math.floor(SETTLEMENT_ITEM_QUANTITY * keepPercent / 100),
    }),
    expect.objectContaining({
      source: "loot",
      id: `loot:${lootItem.item_id}`,
      before: SETTLEMENT_ITEM_QUANTITY,
      kept: Math.floor(SETTLEMENT_ITEM_QUANTITY * keepPercent / 100),
    }),
  ]));
  expect(await readLayaNodeBounds(page, "page-expedition-failure-body"))
    .not.toBeNull();
  expect(await readLayaNodeBounds(page, "page-expedition-failure-return"))
    .not.toBeNull();
  expect(runtimeErrors).toEqual([]);
});
