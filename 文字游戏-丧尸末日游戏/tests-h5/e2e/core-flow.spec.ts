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
  readonly storage: {
    readonly save_slot_count: number;
    readonly settings_key: string;
    readonly settings_schema_version: number;
    readonly achievement_key: string;
    readonly achievement_schema_version: number;
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

/** 从权威 H5 配置读取移动端测试阈值，避免测试复制产品参数。 */
function loadE2eWebConfig(): E2eWebConfig {
  const configPath = resolve(
    import.meta.dirname,
    "../../config/web_config.json",
  );
  return JSON.parse(readFileSync(configPath, "utf8")) as E2eWebConfig;
}

const webConfigDocument = loadE2eWebConfig();
const qualityConfig = webConfigDocument.quality_assurance;
const responsiveConfig = webConfigDocument.responsive;

interface DebugNodeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
}

type CssNodeBounds = Omit<DebugNodeBounds, "stageWidth" | "stageHeight">;

interface BrowserGameDebugHandle {
  getCurrentScreen(): string;
  getNodeBounds(nodeName: string): DebugNodeBounds | null;
  getSnapshot(): {
    readonly mode: "single" | "multiplayer" | "story" | null;
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
      readonly districts: readonly {
        readonly id: string;
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
  };
}

/** 浏览器快照中的单个开局档案选项。 */
interface DebugCampaignOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

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
): Promise<ReturnType<BrowserGameDebugHandle["getSnapshot"]>> {
  return page.evaluate(() => {
    const debug = window.__SHELTER_GAME__;
    if (debug === undefined) {
      throw new Error("游戏只读诊断接口尚未就绪。");
    }
    return debug.getSnapshot();
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

/** 判断普通目标是否完整可见，超高目标则判断可点击中心是否可见。 */
function isScrollableTargetReady(
  target: CssNodeBounds,
  viewport: CssNodeBounds,
): boolean {
  const viewportBottom = viewport.y + viewport.height;
  if (target.height > viewport.height) {
    const targetCenter = target.y + target.height / 2;
    return targetCenter >= viewport.y && targetCenter <= viewportBottom;
  }
  const targetBottom = target.y + target.height;
  return target.y >= viewport.y && targetBottom <= viewportBottom;
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
  await clickLayaNode(page, "page-update-log-close");
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

/** 按指定入口提交默认档案，并验证通讯过场后停留在指挥台。 */
async function startGame(
  page: Page,
  mode: TestGameMode,
  playerName: string,
): Promise<void> {
  await openNewGameSetup(page, mode);
  await fillCommanderName(page, playerName);
  await clickLayaNode(page, "player-name-submit");
  await waitForScreen(page, "connection");
  expect(await readLayaNodeBounds(page, "page-connection-title")).not.toBeNull();
  await waitForScreen(page, "dashboard");
}

/** 打开一局普通单人游戏。 */
async function startSingleGame(page: Page, playerName: string): Promise<void> {
  await startGame(page, "single", playerName);
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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await waitForScreen(page, "update_log");
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
  await clickLayaNode(page, "player-name-submit");
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
  expect(snapshot.campaignProfile?.homeCityLabel).toBe(expectedCity.label);
  expect(expectedCity.label).toContain(
    snapshot.campaignProfile?.districtLabel ?? "",
  );
  expect(await readLayaNodeBounds(page, "dashboard-campaign-profile")).not.toBeNull();
  expect(await readLayaNodeBounds(page, "dashboard-mission")).toBeNull();
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
  for (const utilityNode of ["menu-settings", "menu-update-log"]) {
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
  expect(await readLayaNodeBounds(page, "menu-title")).toBeNull();
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
  expect(await readLayaNodeBounds(page, "function-menu-continue")).not.toBeNull();
  await page.keyboard.press("Escape");
  await waitForScreen(page, "settings");
  await clickLayaNode(page, "page-settings-back");
  await waitForScreen(page, "dashboard");
});

test("远征从整备、事件到安全返程完成闭环", async ({ page }) => {
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
  expect(city?.districts.length).toBeGreaterThanOrEqual(6);
  const district = city?.districts[0];
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
  await clickLayaNode(page, "page-expedition-prepare-begin");
  await waitForScreen(page, "exploration_event");
  const expeditionSnapshot = await readDebugSnapshot(page);
  const event = expeditionSnapshot.explorationPrompt;
  if (event === null) {
    throw new Error("远征首个事件未进入调试快照。");
  }
  expect(district.eventLabels).toContain(event.title);
  expect(expeditionSnapshot.expeditionStatus).toMatchObject({
    cityId: "city_a",
    districtId: district.id,
  });
  const status = expeditionSnapshot.expeditionStatus;
  if (status === null) {
    throw new Error("远征状态未进入调试快照。");
  }
  expect(
    status.maximumSteps - status.travelStepCost - status.remainingSteps,
  ).toBe(district.eventStepCost);
  const option = event.options.find((candidate) => !candidate.disabled);
  if (option === undefined) {
    throw new Error("远征首个事件没有可执行选项。");
  }
  await clickScrollableLayaNode(
    page,
    `page-exploration-event-option-${option.id}`,
    "page-exploration-event-scroll",
  );
  await waitForScreen(page, "expedition_status");
  expect((await readDebugSnapshot(page)).expeditionStatus?.cityId).toBe("city_a");

  await clickLayaNode(page, "page-expedition-status-safe-return");
  await waitForScreen(page, "dashboard");
  expect((await readDebugSnapshot(page)).expeditionStatus).toBeNull();
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
