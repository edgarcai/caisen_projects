import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

interface QualityViewport {
  id: string;
  width: number;
  height: number;
}

interface QualityConfig {
  base_url: string;
  web_server_command: string;
  server_timeout_ms: number;
  action_timeout_ms: number;
  navigation_timeout_ms: number;
  screenshot_directory: string;
  trace_mode: "off" | "on" | "retain-on-failure" | "on-first-retry";
}

interface WebTestConfig {
  responsive: { quality_viewports: QualityViewport[] };
  quality_assurance: QualityConfig;
}

/** 读取与正式界面共享的测试视口和运行参数，避免测试侧复制尺寸。 */
function loadWebTestConfig(): WebTestConfig {
  const path = resolve(import.meta.dirname, "config/web_config.json");
  return JSON.parse(readFileSync(path, "utf8")) as WebTestConfig;
}

/** 按配置 ID 查找一个必须存在的验收视口。 */
function requireViewport(config: WebTestConfig, id: string): QualityViewport {
  const viewport = config.responsive.quality_viewports.find((item) => item.id === id);
  if (viewport === undefined) {
    throw new Error(`缺少验收视口配置：${id}`);
  }
  return viewport;
}

const webConfig = loadWebTestConfig();
const quality = webConfig.quality_assurance;
const desktop = requireViewport(webConfig, "desktop");
const mobile = requireViewport(webConfig, "mobile");
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "tests-h5/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: quality.navigation_timeout_ms,
  use: {
    baseURL: quality.base_url,
    actionTimeout: quality.action_timeout_ms,
    navigationTimeout: quality.navigation_timeout_ms,
    screenshot: "only-on-failure",
    trace: quality.trace_mode,
    ...(browserChannel === undefined ? {} : { channel: browserChannel }),
  },
  projects: [
    {
      name: desktop.id,
      use: { viewport: { width: desktop.width, height: desktop.height } },
    },
    {
      name: mobile.id,
      use: {
        viewport: { width: mobile.width, height: mobile.height },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: quality.web_server_command,
    url: quality.base_url,
    reuseExistingServer: true,
    timeout: quality.server_timeout_ms,
  },
});
