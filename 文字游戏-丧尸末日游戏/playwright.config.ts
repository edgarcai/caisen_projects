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
  responsive: {
    mobile_max_stage_width: number;
    quality_viewports: QualityViewport[];
  };
  quality_assurance: QualityConfig;
}

/** 读取与正式界面共享的测试视口和运行参数，避免测试侧复制尺寸。 */
function loadWebTestConfig(): WebTestConfig {
  const path = resolve(import.meta.dirname, "config/web_config.json");
  return JSON.parse(readFileSync(path, "utf8")) as WebTestConfig;
}

const webConfig = loadWebTestConfig();
const quality = webConfig.quality_assurance;
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;

/** 将每个配置化 QA 视口转换为桌面或触控测试项目。 */
function buildViewportProject(viewport: QualityViewport) {
  const isMobile = viewport.width <= webConfig.responsive.mobile_max_stage_width;
  return {
    name: viewport.id,
    use: {
      viewport: { width: viewport.width, height: viewport.height },
      ...(isMobile ? { hasTouch: true, isMobile: true } : {}),
    },
  };
}

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
  projects: webConfig.responsive.quality_viewports.map(buildViewportProject),
  webServer: {
    command: quality.web_server_command,
    url: quality.base_url,
    reuseExistingServer: true,
    timeout: quality.server_timeout_ms,
  },
});
