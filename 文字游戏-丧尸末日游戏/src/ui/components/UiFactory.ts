import { resolveToneColor } from "../../styles/GameTheme";
import type {
  GameControlTokens,
  GameThemeTokens,
  GameTypographyTokens,
  NameInputHtmlTypeToken,
} from "../../styles/GameTheme";
import type { UiMeterView, UiTone } from "../ports/GameUiPort";
import type {
  LayaInputLike,
  LayaImageLike,
  LayaNodeLike,
  LayaRuntimeLike,
  LayaSpriteLike,
  LayaTextLike,
} from "../laya/LayaRuntime";

/**
 * 文本节点的构建参数。
 */
export interface TextSpec {
  readonly testId: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly color?: string;
  readonly bold?: boolean;
  readonly align?: "left" | "center" | "right";
  readonly valign?: "top" | "middle" | "bottom";
  readonly wordWrap?: boolean;
}

/**
 * 按钮节点的构建参数。
 */
export interface ButtonSpec {
  readonly testId: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tone?: UiTone;
  readonly icon?: string;
  readonly iconPlacement?: "inline" | "stacked";
  readonly disabled?: boolean;
  /** 使用禁用色和禁用皮肤，但保留指针与点击交互。 */
  readonly lockedAppearance?: boolean;
  readonly shape?: "rectangle" | "parallelogram";
  readonly skin?: ButtonSkinSpec;
  /** 无图片皮肤时，悬停与按压阶段使用主题强调色。 */
  readonly accentOnHover?: boolean;
  /** 无图片皮肤时，仅在指针按下期间使用主题强调色。 */
  readonly accentOnPress?: boolean;
  readonly fontSize?: number;
  readonly wordWrap?: boolean;
  readonly hoverableWhenDisabled?: boolean;
  readonly onHoverStart?: () => void;
  readonly onHoverMove?: () => void;
  readonly onHoverEnd?: () => void;
  readonly onClick: () => void;
}

/** 按钮各交互状态可选的美术皮肤。 */
export interface ButtonSkinSpec {
  readonly idle: string;
  readonly hover: string;
  readonly pressed: string;
  readonly disabled: string;
}

/**
 * 面板节点的构建参数。
 */
export interface PanelSpec {
  readonly testId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly elevated?: boolean;
  readonly translucent?: boolean;
  readonly active?: boolean;
  readonly skin?: string;
}

/**
 * 输入框节点的构建参数。
 */
export interface InputSpec {
  readonly testId: string;
  readonly prompt: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maxChars: number;
  readonly type: NameInputHtmlTypeToken;
}

/**
 * 统一创建 Laya 节点，保证视觉 token 和测试标识不会散落到页面中。
 */
export class UiFactory {
  private readonly runtime: LayaRuntimeLike;
  private readonly theme: GameThemeTokens;
  private readonly typography: GameTypographyTokens;
  private readonly controls: GameControlTokens;

  /**
   * 保存引擎和配置化设计 token。
   */
  public constructor(
    runtime: LayaRuntimeLike,
    theme: GameThemeTokens,
    typography: GameTypographyTokens,
    controls: GameControlTokens,
  ) {
    this.runtime = runtime;
    this.theme = theme;
    this.typography = typography;
    this.controls = controls;
  }

  /**
   * 创建带稳定 name 的普通容器。
   */
  public container(testId: string): LayaSpriteLike {
    const node = new this.runtime.Sprite();
    node.name = testId;
    return node;
  }

  /**
   * 创建配置化面板。
   */
  public panel(parent: LayaNodeLike, spec: PanelSpec): LayaSpriteLike {
    const node = this.container(spec.testId);
    node.pos(spec.x, spec.y);
    node.size(spec.width, spec.height);
    const fillColor = spec.translucent === true
      ? this.theme.panel_translucent
      : spec.elevated === true
        ? this.theme.panel_elevated
        : this.theme.panel;
    const borderColor = spec.active === true
      ? this.theme.border_active
      : this.theme.border;
    node.graphics.drawRect(
      0,
      0,
      spec.width,
      spec.height,
      fillColor,
      borderColor,
      this.controls.focus_border_width,
    );
    this.addSkinLayer(node, spec.skin);
    parent.addChild(node);
    return node;
  }

  /**
   * 创建可换行文本。
   */
  public text(parent: LayaNodeLike, spec: TextSpec): LayaTextLike {
    const node = new this.runtime.Text();
    node.name = spec.testId;
    node.text = spec.text;
    node.color = spec.color ?? this.theme.text;
    node.font = this.typography.font_family;
    node.fontSize = spec.fontSize;
    node.bold = spec.bold ?? false;
    node.align = spec.align ?? "left";
    node.valign = spec.valign ?? "top";
    node.wordWrap = spec.wordWrap ?? true;
    node.leading = Math.max(
      0,
      this.typography.body_line_height - this.typography.body_size,
    );
    node.overflow = "hidden";
    node.mouseEnabled = false;
    node.pos(spec.x, spec.y);
    node.size(spec.width, spec.height);
    parent.addChild(node);
    return node;
  }

  /**
   * 创建并按实际换行结果扩展高度的长文本。
   */
  public autoText(
    parent: LayaNodeLike,
    spec: Omit<TextSpec, "height">,
  ): LayaTextLike {
    const node = this.text(parent, {
      ...spec,
      height: this.typography.body_line_height,
    });
    node.height = Math.max(this.typography.body_line_height, node.textHeight);
    return node;
  }

  /**
   * 创建浏览器原生输入能力支持的 Laya 输入框。
   */
  public input(parent: LayaNodeLike, spec: InputSpec): LayaInputLike {
    const node = new this.runtime.Input();
    node.name = spec.testId;
    node.prompt = spec.prompt;
    node.promptColor = this.theme.muted_text;
    node.color = this.theme.text;
    node.font = this.typography.font_family;
    node.fontSize = this.typography.control_size;
    node.bgColor = this.theme.panel_elevated;
    node.borderColor = this.theme.border;
    node.type = spec.type;
    node.maxChars = spec.maxChars;
    node.multiline = false;
    node.mouseEnabled = true;
    node.padding = [
      0,
      this.controls.button_horizontal_padding,
      0,
      this.controls.button_horizontal_padding,
    ];
    node.pos(spec.x, spec.y);
    node.size(spec.width, spec.height);
    parent.addChild(node);
    return node;
  }

  /**
   * 创建带悬停、按压和禁用反馈的自绘按钮。
   */
  public button(parent: LayaNodeLike, spec: ButtonSpec): LayaSpriteLike {
    const node = this.container(spec.testId);
    node.pos(spec.x, spec.y);
    node.size(spec.width, spec.height);
    const disabled = spec.disabled === true;
    const usesLockedAppearance = disabled || spec.lockedAppearance === true;
    const acceptsDisabledHover = disabled && spec.hoverableWhenDisabled === true;
    node.mouseEnabled = !disabled || acceptsDisabledHover;
    const skinLayer = this.createButtonSkinLayer(node, spec);
    const label = this.createButtonLabel(node, spec);
    let state: "idle" | "hover" | "pressed" = "idle";
    let pointerStartY = 0;
    let dragged = false;

    /**
     * 根据当前交互状态重绘按钮。
     */
    const renderButton = (): void => {
      const colors = this.resolveButtonColors(
        spec.tone ?? "default",
        state,
        spec.accentOnHover === true,
        spec.accentOnPress === true,
      );
      const fillColor = usesLockedAppearance
        ? this.theme.background_soft
        : colors.fill;
      const textColor = usesLockedAppearance
        ? this.theme.muted_text
        : colors.text;
      const borderColor = usesLockedAppearance
        ? this.theme.border
        : colors.border;
      node.graphics.clear();
      const skin = this.resolveButtonSkin(spec, state);
      if (skinLayer !== null && skin.length > 0) {
        skinLayer.skin = skin;
        skinLayer.visible = true;
      } else if (spec.shape === "parallelogram") {
        if (skinLayer !== null) skinLayer.visible = false;
        const slant = Math.min(this.controls.button_slant, spec.width);
        node.graphics.drawPoly(
          0,
          0,
          [slant, 0, spec.width, 0, spec.width - slant, spec.height, 0, spec.height],
          fillColor,
          borderColor,
          this.controls.focus_border_width,
        );
      } else {
        if (skinLayer !== null) skinLayer.visible = false;
        node.graphics.drawRect(
          0,
          0,
          spec.width,
          spec.height,
          fillColor,
          borderColor,
          this.controls.focus_border_width,
        );
      }
      label.color = textColor;
    };

    /**
     * 进入按钮时显示悬停状态。
     */
    const handleOver = (): void => {
      if (!disabled) {
        state = "hover";
        renderButton();
      }
      spec.onHoverStart?.();
    };

    /**
     * 指针在按钮范围内移动时转发位置更新意图。
     */
    const handleMove = (): void => {
      spec.onHoverMove?.();
    };

    /**
     * 离开按钮时恢复默认状态。
     */
    const handleOut = (): void => {
      if (!disabled) {
        state = "idle";
        renderButton();
      }
      spec.onHoverEnd?.();
    };

    /**
     * 按下按钮时显示按压状态。
     */
    const handleDown = (): void => {
      state = "pressed";
      pointerStartY = this.runtime.stage.mouseY;
      dragged = false;
      renderButton();
    };

    /**
     * 松开按钮时恢复悬停状态。
     */
    const handleUp = (): void => {
      state = "hover";
      dragged =
        Math.abs(this.runtime.stage.mouseY - pointerStartY) >=
        this.controls.drag_threshold;
      renderButton();
    };

    /**
     * 仅在未发生滚动拖动时提交点击，避免手机列表误触。
     */
    const handleClick = (): void => {
      if (!disabled && !dragged) {
        spec.onClick();
      }
      dragged = false;
    };

    renderButton();
    if (!disabled || acceptsDisabledHover) {
      node.on(this.runtime.Event.MOUSE_OVER, node, handleOver);
      node.on(this.runtime.Event.MOUSE_OUT, node, handleOut);
      if (spec.onHoverMove !== undefined) {
        node.on(this.runtime.Event.MOUSE_MOVE, node, handleMove);
      }
    }
    if (!disabled) {
      node.on(this.runtime.Event.MOUSE_DOWN, node, handleDown);
      node.on(this.runtime.Event.MOUSE_UP, node, handleUp);
      node.on(this.runtime.Event.CLICK, node, handleClick);
    }
    parent.addChild(node);
    return node;
  }

  /**
   * 创建风险数值条。
   */
  public meter(
    parent: LayaNodeLike,
    testId: string,
    meter: UiMeterView,
    x: number,
    y: number,
    width: number,
    height: number,
  ): LayaSpriteLike {
    const root = this.container(testId);
    root.pos(x, y);
    root.size(width, height);
    const labelHeight = this.typography.stat_size + this.controls.button_gap;
    const barHeight = Math.max(
      this.controls.focus_border_width,
      height - labelHeight,
    );
    const ratio = meter.maximum > 0
      ? Math.min(1, Math.max(0, meter.value / meter.maximum))
      : 0;
    const riskColor = meter.risk === "danger"
      ? this.theme.error
      : meter.risk === "warning"
        ? this.theme.warning
        : this.theme.health;
    const valueWidth = Math.min(
      width / 2,
      this.controls.minimum_touch_size * 2,
    );
    const labelWidth = width - valueWidth;
    this.text(root, {
      testId: `${testId}-label`,
      text: meter.label,
      x: 0,
      y: 0,
      width: labelWidth,
      height: labelHeight,
      fontSize: this.typography.stat_size,
      color: this.theme.muted_text,
    });
    this.text(root, {
      testId: `${testId}-value`,
      text: `${String(meter.value)}/${String(meter.maximum)}`,
      x: labelWidth,
      y: 0,
      width: valueWidth,
      height: labelHeight,
      fontSize: this.typography.stat_size,
      align: "right",
    });
    root.graphics.drawRect(
      0,
      labelHeight,
      width,
      barHeight,
      this.theme.background_soft,
    );
    root.graphics.drawRect(0, labelHeight, width * ratio, barHeight, riskColor);
    parent.addChild(root);
    return root;
  }

  /**
   * 为按钮创建并居中标签文本。
   */
  private createButtonLabel(
    parent: LayaNodeLike,
    spec: ButtonSpec,
  ): LayaTextLike {
    const iconSeparator = spec.iconPlacement === "stacked" ? "\n" : "  ";
    const iconPrefix = spec.icon === undefined
      ? ""
      : `${spec.icon}${iconSeparator}`;
    return this.text(parent, {
      testId: `${spec.testId}-label`,
      text: `${iconPrefix}${spec.label}`,
      x: spec.shape === "parallelogram" ? this.controls.button_slant : 0,
      y: 0,
      width:
        spec.shape === "parallelogram"
          ? spec.width - this.controls.button_slant * 2
          : spec.width,
      height: spec.height,
      fontSize: spec.fontSize ?? this.typography.control_size,
      bold: true,
      align: "center",
      valign: "middle",
      wordWrap: spec.wordWrap ?? spec.iconPlacement === "stacked",
    });
  }

  /** 为面板添加可选的拉伸皮肤层；空路径继续使用 token 绘制。 */
  private addSkinLayer(parent: LayaNodeLike, skin?: string): void {
    if (skin === undefined || skin.length === 0) {
      return;
    }
    const image = new this.runtime.Image();
    image.name = `${parent.name}-skin`;
    image.skin = skin;
    image.mouseEnabled = false;
    image.size(parent.width, parent.height);
    parent.addChild(image);
  }

  /** 仅在至少配置一个状态皮肤时创建按钮图片层。 */
  private createButtonSkinLayer(
    parent: LayaNodeLike,
    spec: ButtonSpec,
  ): LayaImageLike | null {
    const skin = spec.skin;
    if (
      skin === undefined ||
      [skin.idle, skin.hover, skin.pressed, skin.disabled].every(
        (path) => path.length === 0,
      )
    ) {
      return null;
    }
    const image = new this.runtime.Image();
    image.name = `${spec.testId}-skin`;
    image.mouseEnabled = false;
    image.size(spec.width, spec.height);
    parent.addChild(image);
    return image;
  }

  /** 按禁用和交互状态选择配置化按钮皮肤。 */
  private resolveButtonSkin(
    spec: ButtonSpec,
    state: "idle" | "hover" | "pressed",
  ): string {
    if (spec.skin === undefined) {
      return "";
    }
    if (spec.disabled === true || spec.lockedAppearance === true) {
      return spec.skin.disabled;
    }
    if (state === "hover") {
      return spec.skin.hover;
    }
    if (state === "pressed") {
      return spec.skin.pressed;
    }
    return spec.skin.idle;
  }

  /**
   * 按语义和交互状态计算按钮色值。
   */
  private resolveButtonColors(
    tone: UiTone,
    state: "idle" | "hover" | "pressed",
    accentOnHover: boolean,
    accentOnPress: boolean,
  ): { readonly fill: string; readonly text: string; readonly border: string } {
    const usesAccentFeedback =
      (accentOnHover && state !== "idle") ||
      (accentOnPress && state === "pressed");
    if (usesAccentFeedback) {
      return {
        fill: state === "pressed"
          ? this.theme.primary_pressed
          : this.theme.primary_hover,
        text: this.theme.on_primary,
        border: this.theme.border_active,
      };
    }
    if (tone === "primary") {
      const fill = state === "pressed"
        ? this.theme.primary_pressed
        : state === "hover"
          ? this.theme.primary_hover
          : this.theme.primary;
      return { fill, text: this.theme.on_primary, border: this.theme.primary_hover };
    }
    if (tone === "default") {
      const fill = state === "hover" ? this.theme.secondary_hover : this.theme.secondary;
      return { fill, text: this.theme.text, border: this.theme.border };
    }
    if (tone === "muted") {
      const fill = state === "hover"
        ? this.theme.panel_elevated
        : this.theme.background_soft;
      return { fill, text: this.theme.muted_text, border: this.theme.border };
    }
    const fill = resolveToneColor(this.theme, tone);
    return { fill, text: this.theme.text, border: this.theme.border_active };
  }
}
