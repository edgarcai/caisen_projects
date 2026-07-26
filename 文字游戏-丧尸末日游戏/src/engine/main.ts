import {
  loadWebConfig,
  resolveWebConfigUrl,
} from "../config/configLoader";
import type { WebGameConfig } from "../config/types";
import { bootLayaEngine, type LayaEngineHandle } from "./layaBootstrap";

export const LAYA_ENGINE_READY_EVENT = "shelter:laya-engine-ready";
const BOOT_STATUS_ID = "boot-status";
const BOOT_LABEL_NAME = "engine-boot-status";

/** 读取 HTML 中的无引擎启动状态节点。 */
function getBootStatus(documentRef: Document): HTMLElement {
  const statusElement = documentRef.getElementById(BOOT_STATUS_ID);
  if (statusElement === null) {
    throw new Error(`页面缺少 #${BOOT_STATUS_ID} 启动状态节点`);
  }
  return statusElement;
}

/** 在 LayaAir 创建 Canvas 前应用配置化页面底色与文字色。 */
function applyDocumentTheme(config: WebGameConfig, documentRef: Document): void {
  documentRef.documentElement.style.backgroundColor = config.theme.background;
  documentRef.body.style.backgroundColor = config.theme.background;
  documentRef.body.style.color = config.theme.text;
}

/** 根据当前舞台尺寸居中引擎就绪文字。 */
function positionBootLabel(
  runtime: LayaEngineHandle["runtime"],
  label: Laya.Text,
  config: WebGameConfig,
): void {
  const horizontalPadding = config.layout.page.body_padding * 2;
  label.width = Math.max(
    runtime.stage.width - horizontalPadding,
    config.controls.minimum_touch_size,
  );
  label.height = config.typography.body_line_height;
  label.x = (runtime.stage.width - label.width) / 2;
  label.y = (runtime.stage.height - label.height) / 2;
}

/** 创建一个可被后续 UI 层按名称替换的 LayaAir 就绪文字。 */
function createBootLabel(
  runtime: LayaEngineHandle["runtime"],
  config: WebGameConfig,
): Laya.Text {
  const label = new runtime.Text();
  label.name = BOOT_LABEL_NAME;
  label.text = config.texts.offline_ready;
  label.color = config.theme.muted_text;
  label.font = config.typography.font_family;
  label.fontSize = config.typography.body_size;
  label.align = "center";
  label.valign = "middle";
  positionBootLabel(runtime, label, config);
  runtime.stage.addChild(label);
  return label;
}

/** 向应用层通知 LayaAir 舞台和配置已就绪。 */
function dispatchEngineReady(
  handle: LayaEngineHandle,
  documentRef: Document,
): void {
  documentRef.defaultView?.dispatchEvent(
    new CustomEvent(LAYA_ENGINE_READY_EVENT, {
      detail: { config: handle.config, engine: handle },
    }),
  );
}

/** 执行 H5 配置加载、引擎加载与舞台初始化链路。 */
async function main(documentRef: Document = document): Promise<void> {
  const statusElement = getBootStatus(documentRef);
  try {
    const configUrl = resolveWebConfigUrl(documentRef);
    const config = await loadWebConfig(configUrl);
    applyDocumentTheme(config, documentRef);
    statusElement.textContent = config.texts.loading;
    const engineHandle = await bootLayaEngine(config, documentRef);
    createBootLabel(engineHandle.runtime, config);
    const { mountGame } = await import("../main");
    await mountGame(config, engineHandle.runtime, engineHandle.stage);
    statusElement.hidden = true;
    dispatchEngineReady(engineHandle, documentRef);
  } catch (error: unknown) {
    statusElement.textContent =
      error instanceof Error ? error.message : String(error);
    statusElement.dataset.state = "error";
    console.error(error);
  }
}

void main();
