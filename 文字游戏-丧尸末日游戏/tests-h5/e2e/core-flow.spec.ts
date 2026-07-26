import { expect, test, type Page } from "@playwright/test";

interface DebugNodeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
}

interface BrowserGameDebugHandle {
  getCurrentScreen(): string;
  getNodeBounds(nodeName: string): DebugNodeBounds | null;
  getSnapshot(): {
    readonly activePlayer: { readonly name: string } | null;
    readonly clock: { readonly turnLabel: string } | null;
    readonly storyPrompt: { readonly id: string } | null;
    readonly explorationPrompt: {
      readonly id: string;
      readonly options: readonly { readonly id: string; readonly disabled: boolean }[];
    } | null;
    readonly expeditionStatus: {
      readonly cityId: string;
      readonly remainingSteps: number;
    } | null;
  };
}

/** 等待 Laya 页面栈进入指定稳定页面。 */
async function waitForScreen(page: Page, screen: string): Promise<void> {
  await expect.poll(async () => page.evaluate(() =>
    document.body.dataset.gameScreen ?? null,
  )).toBe(screen);
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
      x: ((bounds.x + bounds.width / 2) / bounds.stageWidth) * rectangle.width,
      y: ((bounds.y + bounds.height / 2) / bounds.stageHeight) * rectangle.height,
    };
  }, nodeName);
  if (position === null) {
    throw new Error(`找不到可点击的 Laya 节点：${nodeName}`);
  }
  await page.locator("#layaCanvas").click({ position });
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

/** 打开一局全新的单人游戏，验证通讯过场后停留在指挥台。 */
async function startSingleGame(page: Page, playerName: string): Promise<void> {
  await clickLayaNode(page, "menu-new-game");
  await waitForScreen(page, "name_input");
  await clickLayaNode(page, "player-name-1");
  const input = page.getByPlaceholder("新的游戏 1", { exact: true });
  await expect(input).toBeVisible();
  await input.fill(playerName);
  await input.press("Enter");
  await clickLayaNode(page, "player-name-submit");
  await waitForScreen(page, "connection");
  expect(await readLayaNodeBounds(page, "page-connection-title")).not.toBeNull();
  await waitForScreen(page, "dashboard");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await waitForScreen(page, "menu");
});

test("封面到首个剧情结果使用真实 Canvas 完成闭环", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message);
  });

  await startSingleGame(page, "测试所长");
  expect((await readDebugSnapshot(page)).activePlayer?.name).toBe("测试所长");

  await clickLayaNode(page, "dashboard-action-story");
  await waitForScreen(page, "story");
  await clickLayaNode(page, "page-story-option-give_up_share");
  await waitForScreen(page, "message");

  const snapshot = await readDebugSnapshot(page);
  expect(snapshot.storyPrompt?.id).toBe("money_and_secrets");
  expect(snapshot.clock?.turnLabel).toBe("第 1 回合");
  expect(runtimeErrors).toEqual([]);
});

test("ESC 显式存档可在刷新后从封面恢复", async ({ page }) => {
  await startSingleGame(page, "守夜人");
  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  await clickLayaNode(page, "page-function-menu-option-save");
  await waitForScreen(page, "message");

  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-load-game");
  await waitForScreen(page, "connection");
  await waitForScreen(page, "dashboard");

  expect((await readDebugSnapshot(page)).activePlayer?.name).toBe("守夜人");
});

test("六项封面入口、鸣谢空页与剧情模式姓名页可达", async ({
  page,
}, testInfo) => {
  const menuNodes = [
    "menu-new-game",
    "menu-load-game",
    "menu-multiplayer",
    "menu-story",
    "menu-credits",
    "menu-exit",
  ];
  for (const nodeName of menuNodes) {
    expect(await readLayaNodeBounds(page, nodeName)).not.toBeNull();
  }

  if (testInfo.project.name === "desktop") {
    expect(await readLayaNodeBounds(page, "menu-description")).toBeNull();
    await hoverLayaNode(page, "menu-story");
    await expect.poll(async () =>
      readLayaNodeBounds(page, "menu-description"),
    ).not.toBeNull();
  } else {
    expect(await readLayaNodeBounds(page, "menu-description")).toBeNull();
  }

  await clickLayaNode(page, "menu-credits");
  await waitForScreen(page, "credits");
  await clickLayaNode(page, "page-credits-close");
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-story");
  await waitForScreen(page, "name_input");
  await clickLayaNode(page, "player-name-1");
  await expect(page.getByPlaceholder("剧情模式 1", { exact: true })).toBeVisible();
  await clickLayaNode(page, "page-name-input-back");
  await waitForScreen(page, "menu");
});

test("Escape 功能菜单逐层覆盖并保留指挥台显示树", async ({ page }) => {
  await startSingleGame(page, "值夜所长");

  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  expect(await readLayaNodeBounds(page, "dashboard-action-story")).not.toBeNull();

  await clickLayaNode(page, "page-function-menu-option-settings");
  await waitForScreen(page, "settings");
  await clickLayaNode(page, "page-settings-option-reduced-motion");
  await waitForScreen(page, "settings");
  await page.keyboard.press("Escape");
  await waitForScreen(page, "function_menu");
  await page.keyboard.press("Escape");
  await waitForScreen(page, "dashboard");
});

test("远征从整备、事件到安全返程完成闭环", async ({
  page,
}, testInfo) => {
  await startSingleGame(page, "远征所长");
  const exploreNode = testInfo.project.name === "mobile"
    ? "bottom-nav-explore"
    : "dashboard-action-explore";
  await clickLayaNode(page, exploreNode);
  await waitForScreen(page, "expedition_prepare");

  await clickLayaNode(page, "page-expedition-city-city_a");
  await clickLayaNode(page, "page-expedition-prepare-begin");
  await waitForScreen(page, "exploration_event");
  const event = (await readDebugSnapshot(page)).explorationPrompt;
  const option = event?.options.find((candidate) => !candidate.disabled);
  if (option === undefined) {
    throw new Error("远征首个事件没有可执行选项。");
  }
  await clickLayaNode(page, `page-exploration-event-option-${option.id}`);
  await waitForScreen(page, "expedition_status");
  expect((await readDebugSnapshot(page)).expeditionStatus?.cityId).toBe("city_a");

  await clickLayaNode(page, "page-expedition-status-safe-return");
  await waitForScreen(page, "dashboard");
  expect((await readDebugSnapshot(page)).expeditionStatus).toBeNull();
});
