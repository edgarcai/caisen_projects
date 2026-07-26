import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { CoverThemeSelectionState } from "../models/CoverThemeModel";
import type { UiPreferences } from "../ports/UiSettingsPort";
import type {
  UiDocumentView,
  UiOptionView,
  UiPromptView,
} from "../ports/GameUiPort";
import { createChoicePage } from "./ChoicePage";
import { createConfirmPage } from "./ConfirmPage";
import { createDocumentPage } from "./DocumentPage";
import { createEscMenuPage } from "./EscMenuPage";
import type { PageView } from "./PageView";

/** 功能菜单可触发的页面级动作。 */
export interface FunctionMenuActions {
  readonly save: () => void;
  readonly openSettings: () => void;
  readonly openRollback: () => void;
  readonly openExit: () => void;
  readonly close: () => void;
}

/** 设置页把本地偏好与局内系统导航分离后的交互出口。 */
export interface SettingsPageActions {
  readonly openCoverThemes: () => void;
  readonly toggleReducedMotion: () => void;
  readonly openTutorial?: () => void;
  readonly openReturnMenu?: () => void;
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
  return createEscMenuPage(runtime, factory, config, layout, {
    prompt,
    onClose: actions.close,
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

/** 创建管理本地体验偏好，并在局内承载玩法与主菜单入口的设置页。 */
export function createSettingsPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  preferences: UiPreferences,
  actions: SettingsPageActions,
): PageView {
  const prompt = buildSettingsPrompt(
    config,
    preferences,
    actions.openTutorial !== undefined,
    actions.openReturnMenu !== undefined,
  );
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-settings",
    title: config.texts.settings_title,
    prompt,
    onBack: actions.close,
    onSelect: (option): void => {
      if (option.id === "cover-theme") {
        actions.openCoverThemes();
      } else if (option.id === "reduced-motion") {
        actions.toggleReducedMotion();
      } else if (option.id === "tutorial") {
        actions.openTutorial?.();
      } else if (option.id === "return-menu") {
        actions.openReturnMenu?.();
      }
    },
  });
}

/** 构建封面精简设置或局内完整系统设置的只读提示模型。 */
export function buildSettingsPrompt(
  config: GameUiConfig,
  preferences: UiPreferences,
  includeTutorial: boolean,
  includeReturnMenu: boolean,
): UiPromptView {
  const options: UiOptionView[] = [
    {
      id: "cover-theme",
      label: config.texts.settings_cover_theme,
      description: config.texts.settings_cover_theme_description,
      disabled: false,
      tone: "primary",
    },
    {
      id: "reduced-motion",
      label: preferences.reducedMotion
        ? config.texts.reduced_motion_on
        : config.texts.reduced_motion_off,
      description: config.texts.reduced_motion_description,
      disabled: false,
      tone: preferences.reducedMotion ? "success" : "default",
    },
  ];
  if (includeTutorial) {
    options.push({
      id: "tutorial",
      label: config.texts.settings_tutorial,
      description: config.texts.settings_tutorial_description,
      disabled: false,
      tone: "default",
    });
  }
  if (includeReturnMenu) {
    options.push({
      id: "return-menu",
      label: config.texts.settings_return_menu,
      description: config.texts.settings_return_menu_description,
      disabled: false,
      tone: "danger",
    });
  }
  return {
    id: "settings",
    title: config.texts.settings_title,
    body: config.texts.settings_body,
    options,
  };
}

/** 创建设置之上的封面主题选择页。 */
export function createCoverThemeSelectorPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  config: GameUiConfig,
  layout: ResponsiveLayout,
  themes: readonly CoverThemeSelectionState[],
  onSelect: (themeId: string) => void,
  onBack: () => void,
): PageView {
  return createChoicePage(runtime, factory, config, layout, {
    testId: "page-cover-theme-selector",
    title: config.texts.cover_theme_title,
    prompt: buildCoverThemePrompt(config, themes),
    onBack,
    onSelect: (option): void => {
      if (!option.disabled) {
        onSelect(option.id);
      }
    },
  });
}

/** 把主题解锁状态转换为通用二级页选项。 */
export function buildCoverThemePrompt(
  config: GameUiConfig,
  themes: readonly CoverThemeSelectionState[],
): UiPromptView {
  return {
    id: "cover-theme-selector",
    title: config.texts.cover_theme_title,
    body: config.texts.cover_theme_body,
    options: themes.map((entry) => ({
      id: entry.theme.id,
      label: entry.theme.label,
      description: [
        entry.theme.description,
        entry.locked
          ? entry.theme.unlock_description
          : entry.selected
            ? config.texts.cover_theme_selected_description
            : "",
      ].filter((part) => part !== "").join(
        config.texts.cover_theme_description_separator,
      ),
      disabled: entry.locked,
      disabledReason: entry.locked
        ? entry.theme.unlock_description
        : undefined,
      tone: entry.selected ? "success" : entry.locked ? "muted" : "default",
    })),
  };
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
