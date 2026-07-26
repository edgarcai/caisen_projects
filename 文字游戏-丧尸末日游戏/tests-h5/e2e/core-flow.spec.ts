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

/** 打开一局全新的单人游戏并停留在开场消息页。 */
async function startSingleGame(page: Page, playerName: string): Promise<void> {
  await clickLayaNode(page, "menu-new-game");
  await waitForScreen(page, "name_input");
  await clickLayaNode(page, "player-name-1");
  const input = page.getByPlaceholder("新的游戏 1", { exact: true });
  await expect(input).toBeVisible();
  await input.fill(playerName);
  await input.press("Enter");
  await clickLayaNode(page, "player-name-submit");
  await waitForScreen(page, "message");
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

  await clickLayaNode(page, "page-message-close");
  await waitForScreen(page, "dashboard");
  await clickLayaNode(page, "dashboard-action-story");
  await waitForScreen(page, "story");
  await clickLayaNode(page, "page-story-option-give_up_share");
  await waitForScreen(page, "message");

  const snapshot = await readDebugSnapshot(page);
  expect(snapshot.storyPrompt?.id).toBe("money_and_secrets");
  expect(snapshot.clock?.turnLabel).toBe("第 1 回合");
  expect(runtimeErrors).toEqual([]);
});

test("自动存档可在刷新后从封面恢复到指挥台", async ({ page }) => {
  await startSingleGame(page, "守夜人");
  await clickLayaNode(page, "page-message-close");
  await waitForScreen(page, "dashboard");

  await page.reload();
  await expect(page.locator("#boot-status")).toBeHidden();
  await waitForScreen(page, "menu");
  await clickLayaNode(page, "menu-load-game");
  await waitForScreen(page, "dashboard");

  expect((await readDebugSnapshot(page)).activePlayer?.name).toBe("守夜人");
});
