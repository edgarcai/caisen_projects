import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

interface QualityViewport {
  id: string;
  width: number;
  height: number;
  mobile: boolean;
  touch: boolean;
  device_scale_factor: number;
}

interface QualityConfig {
  base_url: string;
  web_server_command: string;
  server_timeout_ms: number;
  worker_count: number;
  action_timeout_ms: number;
  navigation_timeout_ms: number;
  screenshot_directory: string;
  trace_mode: "off" | "on" | "retain-on-failure" | "on-first-retry";
  mobile_user_agent: string;
  minimum_touch_css_px: number;
  keyboard_simulated_height_px: number;
  keyboard_minimum_viewport_height_px: number;
  scroll_drag_ratio: number;
  scroll_drag_steps: number;
  scroll_max_attempts: number;
  scroll_settle_ms: number;
}

interface WebTestConfig {
  responsive: {
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

/** 将每个配置化 QA 视口转换为明确的桌面或真实移动能力项目。 */
function buildViewportProject(viewport: QualityViewport) {
  return {
    name: viewport.id,
    use: {
      viewport: { width: viewport.width, height: viewport.height },
      screen: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.device_scale_factor,
      hasTouch: viewport.touch,
      isMobile: viewport.mobile,
      ...(viewport.mobile ? { userAgent: quality.mobile_user_agent } : {}),
    },
  };
}

export default defineConfig({
  testDir: "tests-h5/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: quality.worker_count,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: quality.navigation_timeout_ms,
  expect: {
    timeout: quality.action_timeout_ms,
  },
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
