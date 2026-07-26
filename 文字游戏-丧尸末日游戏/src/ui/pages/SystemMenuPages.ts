import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiPreferences } from "../ports/UiSettingsPort";
import type { UiDocumentView, UiPromptView } from "../ports/GameUiPort";
import { createChoicePage } from "./ChoicePage";
import { createConfirmPage } from "./ConfirmPage";
import { createDocumentPage } from "./DocumentPage";
import type { PageView } from "./PageView";

/** 功能菜单可触发的页面级动作。 */
export interface FunctionMenuActions {
  readonly save: () => void;
  readonly openSettings: () => void;
  readonly openRollback: () => void;
  readonly openExit: () => void;
  readonly close: () => void;
}

/** 创建覆盖在当前游戏页面之上的 ESC 功能菜单。 */
export function createFunctionMenuPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  canRollback: boolean,
  actions: FunctionMenuActions,
): PageView {
  const prompt = buildFunctionMenuPrompt(config, canRollback);
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-function-menu",
    title: config.texts.function_menu_title,
    prompt,
    onBack: actions.close,
    footerActions: [
      {
        id: "continue",
        testId: "function-menu-continue",
        label: config.texts.continue,
        tone: "primary",
        onClick: actions.close,
      },
    ],
    onSelect: (option): void => {
      if (option.id === "save") {
        actions.save();
      } else if (option.id === "settings") {
        actions.openSettings();
      } else if (option.id === "rollback") {
        actions.openRollback();
      } else if (option.id === "exit") {
        actions.openExit();
      }
    },
  });
}

/** 构建严格按存档、设置、回档、退出排列的功能菜单。 */
export function buildFunctionMenuPrompt(
  config: GameUiConfig,
  canRollback: boolean,
): UiPromptView {
  return {
    id: "function-menu",
    title: config.texts.function_menu_title,
    body: config.texts.function_menu_body,
    options: [
      {
        id: "save",
        label: config.texts.save,
        description: config.texts.save_description,
        disabled: false,
        tone: "success",
      },
      {
        id: "settings",
        label: config.texts.settings,
        description: config.texts.settings_description,
        disabled: false,
      },
      {
        id: "rollback",
        label: config.texts.rollback,
        description: config.texts.rollback_description,
        disabled: !canRollback,
        disabledReason: canRollback ? undefined : config.texts.no_save,
        tone: "warning",
      },
      {
        id: "exit",
        label: config.texts.exit,
        description: config.texts.exit_description,
        disabled: false,
        tone: "danger",
      },
    ],
  };
}

/** 创建只管理本地体验偏好的设置覆盖页。 */
export function createSettingsPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  preferences: UiPreferences,
  onToggleReducedMotion: () => void,
  onBack: () => void,
): PageView {
  const prompt: UiPromptView = {
    id: "settings",
    title: config.texts.settings_title,
    body: config.texts.settings_body,
    options: [
      {
        id: "reduced-motion",
        label: preferences.reducedMotion
          ? config.texts.reduced_motion_on
          : config.texts.reduced_motion_off,
        description: config.texts.reduced_motion_description,
        disabled: false,
        tone: preferences.reducedMotion ? "success" : "default",
      },
    ],
  };
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-settings",
    title: config.texts.settings_title,
    prompt,
    onBack,
    onSelect: onToggleReducedMotion,
  });
}

/** 创建回到最近检查点的二次确认页。 */
export function createRollbackConfirmPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  onConfirm: () => void,
  onCancel: () => void,
): PageView {
  return createConfirmPage(
    runtime,
    factory,
    config,
    layout,
    "page-rollback-confirm",
    {
      title: config.texts.rollback_title,
      body: config.texts.rollback_body,
      tone: "warning",
    },
    onConfirm,
    onCancel,
  );
}

/** 创建统一服务于封面和游戏内功能菜单的退出确认页。 */
export function createExitConfirmPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  onConfirm: () => void,
  onCancel: () => void,
): PageView {
  return createConfirmPage(
    runtime,
    factory,
    config,
    layout,
    "page-exit-confirm",
    {
      title: config.texts.exit_title,
      body: config.texts.exit_body,
      tone: "danger",
    },
    onConfirm,
    onCancel,
  );
}

/** 创建正文严格为空的鸣谢覆盖页，后续内容由主线素材承载。 */
export function createCreditsPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  onClose: () => void,
): PageView {
  return createDocumentPage(
    runtime,
    factory,
    config,
    layout,
    "page-credits",
    createCreditsDocument(config),
    config.texts.close,
    onClose,
  );
}

/** 返回正文严格为空的鸣谢文档契约。 */
export function createCreditsDocument(config: GameUiConfig): UiDocumentView {
  return { title: config.texts.credits, body: "" };
}
