import { describe, expect, it, vi } from "vitest";
import webConfigDocument from "../../config/web_config.json";
import { parseWebGameConfig } from "../../src/config/configLoader";
import {
  resolveResponsiveLayoutFromMetrics,
  type ResponsiveLayout,
} from "../../src/styles/ResponsiveLayout";
import { UiFactory } from "../../src/ui/components/UiFactory";
import type { LayaRuntimeLike } from "../../src/ui/laya/LayaRuntime";
import {
  createNewGameSetupPage,
  resolveEntryModeOptions,
  type NewGameSetupPageView,
} from "../../src/ui/pages/NewGameSetupPage";
import { createGuidedTutorialPage } from "../../src/ui/pages/GuidedTutorialPage";
import { createPreGameNoticePage } from "../../src/ui/pages/PreGameNoticePage";
import {
  createPublisherSplashPage,
  resolvePublisherLogoAlpha,
} from "../../src/ui/pages/PublisherSplashPage";
import type {
  GameMode,
  UiCampaignProfileOptionsView,
  UiSaveSlotView,
} from "../../src/ui/ports/GameUiPort";

/** 不记录绘制内容、仅满足 UiFactory 契约的测试绘图对象。 */
class FakeGraphics {
  /** 清空绘图记录；本测试不需要保存图元。 */
  public clear(): void {}

  /** 接收矩形绘制调用。 */
  public drawRect(): void {}

  /** 接收多边形绘制调用。 */
  public drawPoly(): void {}

  /** 接收线段绘制调用。 */
  public drawLine(): void {}
}

/** 提供显示树、事件和几何信息的最小 Laya 测试节点。 */
class FakeNode {
  public name = "";
  public x = 0;
  public y = 0;
  public width = 0;
  public height = 0;
  public alpha = 1;
  public visible = true;
  public mouseEnabled = true;
  public zOrder = 0;
  public parent: FakeNode | null = null;
  public scrollRect: FakeRectangle | undefined;
  public readonly children: FakeNode[] = [];
  private readonly listeners = new Map<
    string,
    Array<{
      readonly caller: unknown;
      readonly listener: (...argumentsList: unknown[]) => void;
    }>
  >();

  /** 添加子节点并维护父子引用。 */
  public addChild<TNode extends FakeNode>(child: TNode): TNode {
    child.removeSelf();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /** 按稳定名称查找一个直接子节点。 */
  public getChildByName(name: string): FakeNode | null {
    return this.children.find((child) => child.name === name) ?? null;
  }

  /** 删除指定范围内的子节点。 */
  public removeChildren(
    beginIndex = 0,
    endIndex = this.children.length - 1,
  ): this {
    const count = Math.max(0, endIndex - beginIndex + 1);
    this.children.splice(beginIndex, count).forEach((child) => {
      child.parent = null;
    });
    return this;
  }

  /** 从当前父节点移除自身。 */
  public removeSelf(): this {
    const childIndex = this.parent?.children.indexOf(this) ?? -1;
    if (childIndex >= 0) {
      this.parent?.children.splice(childIndex, 1);
    }
    this.parent = null;
    return this;
  }

  /** 销毁当前节点，并可选择递归销毁子节点。 */
  public destroy(destroyChildren = false): void {
    if (destroyChildren) {
      [...this.children].forEach((child) => {
        child.destroy(true);
      });
    }
    this.removeChildren();
    this.offAll();
    this.removeSelf();
  }

  /** 更新节点位置。 */
  public pos(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /** 更新节点尺寸。 */
  public size(width: number, height: number): this {
    this.width = width;
    this.height = height;
    return this;
  }

  /** 注册可由测试显式触发的事件监听。 */
  public on(
    event: string,
    caller: unknown,
    listener: (...argumentsList: unknown[]) => void,
  ): this {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ caller, listener });
    this.listeners.set(event, entries);
    return this;
  }

  /** 精确移除一个事件监听。 */
  public off(
    event: string,
    caller: unknown,
    listener: (...argumentsList: unknown[]) => void,
  ): this {
    const entries = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      entries.filter((entry) =>
        entry.caller !== caller || entry.listener !== listener
      ),
    );
    return this;
  }

  /** 移除当前节点上的全部事件监听。 */
  public offAll(): this {
    this.listeners.clear();
    return this;
  }

  /** 按注册顺序触发指定事件。 */
  public emit(event: string, ...argumentsList: unknown[]): void {
    [...(this.listeners.get(event) ?? [])].forEach((entry) => {
      entry.listener(...argumentsList);
    });
  }
}

/** 带绘图能力的测试精灵。 */
class FakeSprite extends FakeNode {
  public readonly graphics = new FakeGraphics();
}

/** 能根据字号和宽度估算换行高度的测试文本。 */
class FakeText extends FakeSprite {
  public text = "";
  public color = "";
  public font = "";
  public fontSize = 0;
  public bold = false;
  public align = "";
  public valign = "";
  public wordWrap = true;
  public leading = 0;
  public overflow = "";

  /** 返回供响应式页面测量使用的确定性文本高度。 */
  public get textHeight(): number {
    const characterWidth = Math.max(1, this.fontSize);
    const charactersPerLine = Math.max(
      1,
      Math.floor(this.width / characterWidth),
    );
    const lines = this.wordWrap
      ? Math.max(1, Math.ceil(this.text.length / charactersPerLine))
      : 1;
    return lines * (this.fontSize + this.leading);
  }
}

/** 支持输入值和焦点状态的测试输入框。 */
class FakeInput extends FakeText {
  public prompt = "";
  public promptColor = "";
  public bgColor = "";
  public borderColor = "";
  public type = "";
  public maxChars = 0;
  public multiline = false;
  public padding: readonly number[] = [];
  public focus = false;
}

/** 记录图片皮肤路径的测试图片节点。 */
class FakeImage extends FakeSprite {
  public skin: string;
  public readonly source = null;

  /** 保存可选初始皮肤路径。 */
  public constructor(skin = "") {
    super();
    this.skin = skin;
  }
}

/** 保存滚动裁剪范围的测试矩形。 */
class FakeRectangle {
  /** 保存矩形几何值。 */
  public constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
}

/** 提供全局鼠标位置的测试舞台。 */
class FakeStage extends FakeSprite {
  public mouseX = 0;
  public mouseY = 0;
  public bgColor = "";
}

const webConfig = parseWebGameConfig(webConfigDocument);
const zeroSafeArea = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** 构造可运行 UiFactory、PageScaffold 和滚动区的最小 Laya 环境。 */
function createFakeRuntime(): LayaRuntimeLike {
  return {
    Sprite: FakeSprite,
    Text: FakeText,
    Input: FakeInput,
    Image: FakeImage,
    Rectangle: FakeRectangle,
    Event: {
      CLICK: "click",
      MOUSE_DOWN: "mousedown",
      MOUSE_UP: "mouseup",
      MOUSE_MOVE: "mousemove",
      MOUSE_OUT: "mouseout",
      MOUSE_OVER: "mouseover",
      MOUSE_WHEEL: "mousewheel",
      RESIZE: "resize",
      KEY_DOWN: "keydown",
      LOADED: "loaded",
    },
    stage: new FakeStage(),
  } as unknown as LayaRuntimeLike;
}

/** 使用真实主题和控件 token 创建测试 UI 工厂。 */
function createFactory(runtime: LayaRuntimeLike): UiFactory {
  return new UiFactory(
    runtime,
    webConfig.theme,
    webConfig.typography,
    webConfig.controls,
  );
}

/** 创建手机或桌面的确定性响应式布局。 */
function createLayout(isMobileDevice: boolean): ResponsiveLayout {
  return resolveResponsiveLayoutFromMetrics(
    {
      stageWidth: isMobileDevice
        ? webConfig.engine.mobile_design_width
        : Math.max(
            webConfig.engine.design_width,
            webConfig.responsive.desktop_min_stage_width,
          ),
      stageHeight: isMobileDevice
        ? webConfig.engine.mobile_design_height
        : webConfig.engine.design_height,
      isMobileDevice,
      safeArea: zeroSafeArea,
    },
    webConfig,
  );
}

/** 从配置化 QA 视口构造保守的直接舞台布局。 */
function createQualityViewportLayout(viewportId: string): ResponsiveLayout {
  const viewport = webConfig.responsive.quality_viewports.find(
    (candidate) => candidate.id === viewportId,
  );
  if (viewport === undefined) {
    throw new Error(`测试视口不存在：${viewportId}`);
  }
  return resolveResponsiveLayoutFromMetrics(
    {
      stageWidth: viewport.width,
      stageHeight: viewport.height,
      isMobileDevice: viewport.mobile,
      safeArea: zeroSafeArea,
    },
    webConfig,
  );
}

/** 创建覆盖默认项和循环项的开局档案夹具。 */
function createProfileOptions(): UiCampaignProfileOptionsView {
  return {
    difficulties: [
      { id: "survivor", label: "幸存者", description: "资源压力适中。" },
      { id: "nightmare", label: "噩梦", description: "尸群会更频繁地出现。" },
    ],
    origins: [
      { id: "medic", label: "医护人员", description: "更擅长处理创伤。" },
      { id: "engineer", label: "工程师", description: "更擅长修复设施。" },
    ],
    traits: [
      { id: "calm", label: "冷静", description: "危机中保持判断力。" },
      { id: "runner", label: "疾行", description: "远征时行动更快。" },
    ],
    cities: [
      { id: "city_a", label: "A市 · 北区", description: "医院与旧商业街相邻。" },
      { id: "city_b", label: "B市 · 河岸", description: "水路发达但桥梁失守。" },
    ],
    defaultSelection: {
      difficultyId: "survivor",
      originId: "medic",
      traitId: "calm",
      homeCityId: "city_a",
    },
  };
}

/** 创建包含只读栏位、可写空槽和可覆盖旧档的存档夹具。 */
function createSaveSlots(): readonly UiSaveSlotView[] {
  return [
    {
      slotId: 1,
      status: "corrupted",
      title: "栏位 1 · 损坏",
      details: "数据不可写入",
      loadable: false,
      writable: false,
    },
    {
      slotId: 2,
      status: "empty",
      title: "栏位 2 · 空",
      details: "建立新档案",
      loadable: false,
      writable: true,
    },
    {
      slotId: 3,
      status: "valid",
      title: "栏位 3 · 第 2 天",
      details: "覆盖旧进度",
      loadable: true,
      writable: true,
    },
  ];
}

/** 在整棵测试显示树中按稳定名称查找节点。 */
function requireNode(root: FakeNode, name: string): FakeNode {
  if (root.name === name) {
    return root;
  }
  for (const child of root.children) {
    try {
      return requireNode(child, name);
    } catch {
      // 当前分支没有目标节点，继续查找相邻分支。
    }
  }
  throw new Error(`测试节点不存在：${name}`);
}

/** 查找并校验文本节点。 */
function requireText(root: FakeNode, name: string): FakeText {
  const node = requireNode(root, name);
  if (!(node instanceof FakeText)) {
    throw new Error(`测试节点不是文本：${name}`);
  }
  return node;
}

/** 查找并校验输入节点。 */
function requireInput(root: FakeNode, name: string): FakeInput {
  const node = requireNode(root, name);
  if (!(node instanceof FakeInput)) {
    throw new Error(`测试节点不是输入框：${name}`);
  }
  return node;
}

/** 累加父级平移并返回节点在页面根中的纵坐标。 */
function resolveGlobalY(node: FakeNode): number {
  let current: FakeNode | null = node;
  let globalY = 0;
  while (current !== null) {
    globalY += current.y;
    current = current.parent;
  }
  return globalY;
}

/** 使用指定模式和布局创建一页可交互的测试视图。 */
function createTestView(
  layout: ResponsiveLayout,
  saveSlots: readonly UiSaveSlotView[],
  mode: GameMode,
  playerCount: number,
  onBack: () => void,
  onSubmit: Parameters<typeof createNewGameSetupPage>[9],
  onTextEntryFocusOut: () => void,
  prepareNameInput: () => void = vi.fn(),
): NewGameSetupPageView {
  const runtime = createFakeRuntime();
  return createNewGameSetupPage(
    runtime,
    createFactory(runtime),
    webConfig,
    layout,
    mode,
    playerCount,
    createProfileOptions(),
    saveSlots,
    onBack,
    onSubmit,
    prepareNameInput,
    onTextEntryFocusOut,
  );
}

describe("新游戏配置页", () => {
  it("普通入口保持配置顺序，独立入口只追加自身模式", () => {
    expect(resolveEntryModeOptions(webConfig, "single").map((option) => option.id)).toEqual([
      "single",
      "endless",
    ]);
    expect(resolveEntryModeOptions(webConfig, "story").map((option) => option.id)).toEqual([
      "single",
      "endless",
      "story",
    ]);
    expect(resolveEntryModeOptions(webConfig, "multiplayer").map((option) => option.id)).toEqual([
      "single",
      "endless",
      "multiplayer",
    ]);
  });

  it("从配置默认值起步，循环选项并提交去空格后的完整档案", () => {
    const onBack = vi.fn();
    const onSubmit = vi.fn();
    const onTextEntryFocusOut = vi.fn();
    const view = createTestView(
      createLayout(false),
      createSaveSlots(),
      "single",
      1,
      onBack,
      onSubmit,
      onTextEntryFocusOut,
    );
    const root = view.page.root as unknown as FakeNode;
    const nameInput = requireInput(root, "player-name-1");
    const difficultyButton = requireNode(root, "profile-difficulty");
    const slotButton = requireNode(root, "profile-slot");

    expect(view.readProfile()).toEqual(createProfileOptions().defaultSelection);
    expect(view.readMode()).toBe("single");
    expect(view.readSlotId()).toBe(2);
    expect(nameInput.type).toBe("text");
    expect(nameInput.text).toBe(webConfig.new_game_setup.preset_names[0]);
    expect(requireText(root, "profile-mode-label").text).toBe(
      webConfig.new_game_setup.mode_options[0]?.label,
    );
    expect(requireText(root, "profile-slot-label").text).toContain("栏位 2");
    expect(requireNode(root, "profile-setup-navigation")).toBeTruthy();
    expect(requireNode(root, "profile-setup-options")).toBeTruthy();
    expect(requireNode(root, "profile-setup-preview")).toBeTruthy();
    expect(requireNode(root, "profile-setup-summary")).toBeTruthy();
    expect(requireNode(root, "profile-mode-option-single")).toBeTruthy();
    expect(requireNode(root, "profile-mode-option-endless")).toBeTruthy();
    expect(() => requireNode(root, "profile-mode-option-multiplayer")).toThrow();
    expect(() => requireNode(root, "profile-mode-option-story")).toThrow();

    nameInput.text = "  林岚  ";
    nameInput.emit("blur");
    difficultyButton.emit("click");
    slotButton.emit("click");

    expect(onTextEntryFocusOut).toHaveBeenCalledOnce();
    expect(requireText(root, "profile-difficulty-label").text).toBe("噩梦");
    expect(requireText(root, "profile-difficulty-description").text).toContain(
      "尸群",
    );
    expect(view.readProfile().difficultyId).toBe("nightmare");
    expect(view.readSlotId()).toBe(3);
    expect(requireText(root, "profile-slot-label").text).toContain("栏位 3");

    const submit = requireNode(root, "player-name-submit");
    const back = requireNode(root, "page-new-game-setup-back");
    expect(submit.parent?.name).toBe("page-new-game-setup-actions");
    expect(back.parent).toBe(submit.parent);
    submit.emit("click");
    back.emit("click");

    expect(onSubmit).toHaveBeenCalledWith(
      ["林岚"],
      {
        difficultyId: "nightmare",
        originId: "medic",
        traitId: "calm",
        homeCityId: "city_a",
      },
      3,
      "single",
    );
    expect(onBack).toHaveBeenCalledOnce();
    view.page.destroy();
  });

  it("手机按单列纵向排列，桌面按配置双列排列", () => {
    const mobileView = createTestView(
      createLayout(true),
      createSaveSlots(),
      "story",
      1,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    const mobileRoot = mobileView.page.root as unknown as FakeNode;
    const mobileName = requireInput(mobileRoot, "player-name-1");
    const mobileMode = requireNode(mobileRoot, "profile-mode");
    const mobileDifficulty = requireNode(mobileRoot, "profile-difficulty");
    expect(requireNode(mobileRoot, "profile-setup-step-header")).toBeTruthy();
    expect(requireNode(mobileRoot, "profile-setup-previous-step")).toBeTruthy();
    expect(requireNode(mobileRoot, "profile-setup-next-step")).toBeTruthy();
    expect(mobileMode.y).toBeGreaterThan(mobileName.y);
    expect(mobileDifficulty.y).toBeGreaterThanOrEqual(mobileMode.y);
    expect(requireText(mobileRoot, "profile-mode-label").text).toBe(
      webConfig.new_game_setup.mode_options.find((option) => option.id === "story")?.label,
    );
    expect(requireNode(mobileRoot, "profile-mode-option-story")).toBeTruthy();
    expect(() => requireNode(mobileRoot, "profile-mode-option-multiplayer")).toThrow();

    const desktopView = createTestView(
      createLayout(false),
      createSaveSlots(),
      "multiplayer",
      2,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    const desktopRoot = desktopView.page.root as unknown as FakeNode;
    const firstName = requireInput(desktopRoot, "player-name-1");
    const secondName = requireInput(desktopRoot, "player-name-2");
    const desktopMode = requireNode(desktopRoot, "profile-mode");
    const desktopDifficulty = requireNode(desktopRoot, "profile-difficulty");
    expect(secondName.x).toBe(firstName.x);
    expect(secondName.parent?.y).toBeGreaterThan(firstName.parent?.y ?? 0);
    expect(desktopDifficulty.x).toBeGreaterThan(desktopMode.x);
    expect(desktopDifficulty.y).toBe(desktopMode.y);
    expect(requireNode(desktopRoot, "profile-mode-option-multiplayer")).toBeTruthy();
    expect(() => requireNode(desktopRoot, "profile-mode-option-story")).toThrow();

    mobileView.page.destroy();
    desktopView.page.destroy();
  });

  it("手机横屏建档初始将姓名框完整滚入正文并避开底栏", () => {
    const layout = createQualityViewportLayout("mobile_landscape");
    const view = createTestView(
      layout,
      createSaveSlots(),
      "single",
      1,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    const root = view.page.root as unknown as FakeNode;
    const nameInput = requireInput(root, "player-name-1");
    const scrollViewport = requireNode(root, "page-new-game-setup-scroll");
    const footerBack = requireNode(root, "page-new-game-setup-back");
    const inputTop = resolveGlobalY(nameInput);
    const inputBottom = inputTop + nameInput.height;
    const viewportTop = resolveGlobalY(scrollViewport);
    const viewportBottom = viewportTop + scrollViewport.height;
    const expectedTopPadding = Math.min(
      layout.sectionGap,
      Math.max(0, (scrollViewport.height - nameInput.height) / 2),
    );

    expect(scrollViewport.height).toBeGreaterThanOrEqual(nameInput.height);
    expect(inputTop).toBe(viewportTop + expectedTopPadding);
    expect(inputBottom).toBeLessThanOrEqual(viewportBottom);
    expect(inputBottom).toBeLessThan(resolveGlobalY(footerBack));
    view.page.destroy();
  });

  it("多人预设姓名错位起步，并保留中英数自由输入与循环切换", () => {
    const onSubmit = vi.fn();
    const prepareNameInput = vi.fn();
    const view = createTestView(
      createLayout(true),
      createSaveSlots(),
      "multiplayer",
      2,
      vi.fn(),
      onSubmit,
      vi.fn(),
      prepareNameInput,
    );
    const root = view.page.root as unknown as FakeNode;
    const firstName = requireInput(root, "player-name-1");
    const secondName = requireInput(root, "player-name-2");
    const firstPreset = requireNode(root, "player-name-1-preset");

    expect(firstName.text).toBe(webConfig.new_game_setup.preset_names[0]);
    expect(secondName.text).toBe(webConfig.new_game_setup.preset_names[1]);
    expect(firstName.text).not.toBe(secondName.text);

    firstName.emit("focus");
    expect(prepareNameInput).toHaveBeenCalledOnce();

    firstPreset.emit("click");
    expect(firstName.text).toBe(webConfig.new_game_setup.preset_names[1]);
    expect(requireText(root, "player-name-1-preset-label").text).toContain(
      webConfig.new_game_setup.preset_names[1],
    );

    firstName.text = "林Alpha7";
    secondName.text = "周Beta8";
    requireNode(root, "player-name-submit").emit("click");
    expect(onSubmit).toHaveBeenCalledWith(
      ["林Alpha7", "周Beta8"],
      createProfileOptions().defaultSelection,
      2,
      "multiplayer",
    );
    view.page.destroy();
  });

  it("没有可写存档时显示配置文案、返回空栏位并禁用确定", () => {
    const onSubmit = vi.fn();
    const view = createTestView(
      createLayout(true),
      createSaveSlots().filter((slot) => !slot.writable),
      "single",
      1,
      vi.fn(),
      onSubmit,
      vi.fn(),
    );
    const root = view.page.root as unknown as FakeNode;
    const slotButton = requireNode(root, "profile-slot");
    const submit = requireNode(root, "player-name-submit");

    expect(view.readSlotId()).toBeNull();
    expect(slotButton.mouseEnabled).toBe(false);
    expect(requireText(root, "profile-slot-label").text).toBe(
      webConfig.texts.no_save,
    );
    expect(submit.mouseEnabled).toBe(false);
    submit.emit("click");
    expect(onSubmit).not.toHaveBeenCalled();
    view.page.destroy();
  });

  it("中央模式列表可以真正选择无尽模式并随提交返回", () => {
    const onSubmit = vi.fn();
    const view = createTestView(
      createLayout(false),
      createSaveSlots(),
      "single",
      1,
      vi.fn(),
      onSubmit,
      vi.fn(),
    );
    const root = view.page.root as unknown as FakeNode;
    view.selectCategory("mode");
    requireNode(root, "profile-mode-option-endless").emit("click");

    expect(view.readMode()).toBe("endless");
    expect(requireText(root, "profile-mode-label").text).toBe("无尽求生");
    requireNode(root, "player-name-submit").emit("click");
    expect(onSubmit).toHaveBeenCalledWith(
      [webConfig.new_game_setup.preset_names[0]],
      createProfileOptions().defaultSelection,
      2,
      "endless",
    );
    view.page.destroy();
  });

  it("拒绝无效玩家数量和不存在的默认档案 ID", () => {
    const runtime = createFakeRuntime();
    const factory = createFactory(runtime);
    const commonArguments = [
      runtime,
      factory,
      webConfig,
      createLayout(false),
      "single",
    ] as const;

    expect(() => {
      createNewGameSetupPage(
        ...commonArguments,
        0,
        createProfileOptions(),
        createSaveSlots(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
    }).toThrow("正整数");

    const invalidProfileOptions: UiCampaignProfileOptionsView = {
      ...createProfileOptions(),
      defaultSelection: {
        ...createProfileOptions().defaultSelection,
        difficultyId: "missing",
      },
    };
    expect(() => {
      createNewGameSetupPage(
        ...commonArguments,
        1,
        invalidProfileOptions,
        createSaveSlots(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
    }).toThrow("默认选项不存在");
  });
});

describe("开局引导与制作方页", () => {
  it("分步教程显示通讯框、聚焦目标并支持前后导航", () => {
    const runtime = createFakeRuntime();
    const onComplete = vi.fn();
    const onSkip = vi.fn();
    const view = createGuidedTutorialPage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(false),
      (): { x: number; y: number; width: number; height: number } => ({
        x: 80,
        y: 100,
        width: 240,
        height: 120,
      }),
      { onComplete, onSkip },
    );
    const root = view.root as unknown as FakeNode;

    expect(view.currentStepIndex()).toBe(0);
    expect(requireText(root, "guided-tutorial-speaker").text).toContain("豪菜");
    expect(requireText(root, "guided-tutorial-step").text).toContain("1");
    const dialog = requireNode(root, "guided-tutorial-dialog");
    const dialogInnerWidth = dialog.width
      - webConfig.guided_tutorial.dialog_panel_padding * 2;
    expect(requireText(root, "guided-tutorial-step").width).toBeCloseTo(
      dialogInnerWidth * webConfig.guided_tutorial.header_step_width_ratio,
    );
    expect(requireNode(root, "guided-tutorial-focus-border").x).toBe(
      80 - webConfig.guided_tutorial.spotlight_padding,
    );

    requireNode(root, "guided-tutorial-next").emit("click");
    expect(view.currentStepIndex()).toBe(1);
    expect(requireText(root, "guided-tutorial-title").text).toBe(
      webConfig.guided_tutorial.steps[1]?.title,
    );
    requireNode(root, "guided-tutorial-previous").emit("click");
    expect(view.currentStepIndex()).toBe(0);
    requireNode(root, "guided-tutorial-skip").emit("click");
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    view.destroy();
  });

  it("三个质量视口的长教程正文可滚至末尾且按钮固定在底部", () => {
    for (const viewportId of ["desktop", "mobile", "mobile_landscape"]) {
      const runtime = createFakeRuntime();
      const layout = createQualityViewportLayout(viewportId);
      const view = createGuidedTutorialPage(
        runtime,
        createFactory(runtime),
        webConfig,
        layout,
        (): { x: number; y: number; width: number; height: number } => ({
          x: layout.outerPadding,
          y: layout.outerPadding,
          width: webConfig.guided_tutorial.fallback_target_width,
          height: webConfig.guided_tutorial.fallback_target_height,
        }),
        { onComplete: vi.fn(), onSkip: vi.fn() },
      );
      const root = view.root as unknown as FakeNode;
      const viewport = requireNode(root, "guided-tutorial-instruction-scroll");
      const content = requireNode(
        root,
        "guided-tutorial-instruction-scroll-content",
      );
      const nextButton = requireNode(root, "guided-tutorial-next");

      expect(resolveGlobalY(viewport) + viewport.height).toBeLessThanOrEqual(
        resolveGlobalY(nextButton),
      );
      webConfig.guided_tutorial.steps.forEach((step, stepIndex) => {
        const instruction = requireText(root, "guided-tutorial-instruction");
        expect(instruction.text).toBe(step.instruction);
        expect(instruction.height).toBeGreaterThanOrEqual(instruction.textHeight);
        expect(Math.abs(content.y)).toBe(0);

        if (instruction.height > viewport.height) {
          if (layout.usesCompactUi) {
            const stage = runtime.stage as unknown as FakeStage;
            stage.mouseY = viewport.height;
            viewport.emit("mousedown");
            stage.mouseY = -instruction.height;
            stage.emit("mousemove");
            stage.emit("mouseup");
          } else {
            const attempts = Math.ceil(
              instruction.height / webConfig.controls.scroll_step,
            ) + 1;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
              viewport.emit("mousewheel", { delta: -1 });
            }
          }
          expect(content.y).toBeLessThan(0);
          expect(instruction.y + instruction.height + content.y)
            .toBeLessThanOrEqual(viewport.height);
          expect(instruction.y + instruction.height + content.y)
            .toBeGreaterThan(0);
        }

        if (stepIndex < webConfig.guided_tutorial.steps.length - 1) {
          view.next();
        }
      });
      view.destroy();
    }
  });

  it("开局提示的返回、查看教程和继续行为彼此独立", () => {
    const runtime = createFakeRuntime();
    const back = vi.fn();
    const openTutorial = vi.fn();
    const continueGame = vi.fn();
    const page = createPreGameNoticePage(
      runtime,
      createFactory(runtime),
      webConfig,
      createLayout(true),
      { back, openTutorial, continueGame },
    );
    const root = page.root as unknown as FakeNode;

    expect(requireText(root, "pre-game-notice-body").text).toContain("设置");
    requireNode(root, "pre-game-notice-back").emit("click");
    requireNode(root, "pre-game-notice-tutorial").emit("click");
    requireNode(root, "pre-game-notice-continue").emit("click");
    expect(back).toHaveBeenCalledOnce();
    expect(openTutorial).toHaveBeenCalledOnce();
    expect(continueGame).toHaveBeenCalledOnce();
    page.destroy();
  });

  it("制作方 LOGO 文字保持代码原生，三段透明度与动画 token 一致", () => {
    const runtime = createFakeRuntime();
    const onComplete = vi.fn();
    const splashConfig = {
      ...webConfig,
      publisher_splash: {
        ...webConfig.publisher_splash,
        background_asset: "assets/test-publisher-background.webp",
      },
    };
    const view = createPublisherSplashPage(
      runtime,
      createFactory(runtime),
      splashConfig,
      createLayout(false),
      onComplete,
    );
    const root = view.root as unknown as FakeNode;
    const fadeIn = webConfig.motion.publisher_logo_fade_in_ms;
    const hold = webConfig.motion.publisher_logo_hold_ms;
    const fadeOut = webConfig.motion.publisher_logo_fade_out_ms;

    const publisherTitle = requireText(root, "publisher-splash-title");
    expect(publisherTitle.text).toBe("白菜出品");
    expect(publisherTitle.fontSize).toBe(
      splashConfig.publisher_splash.title_font_size,
    );
    expect(() => requireNode(root, "publisher-splash-subtitle")).toThrow();
    expect(requireNode(root, "publisher-splash-background").alpha).toBe(
      splashConfig.publisher_splash.background_opacity,
    );
    expect(resolvePublisherLogoAlpha(webConfig, fadeIn / 2)).toBeCloseTo(0.5);
    expect(resolvePublisherLogoAlpha(webConfig, fadeIn + hold / 2)).toBe(1);
    expect(resolvePublisherLogoAlpha(webConfig, fadeIn + hold + fadeOut / 2)).toBeCloseTo(0.5);
    view.finish();
    view.finish();
    expect(onComplete).toHaveBeenCalledOnce();
    view.destroy();
  });
});
