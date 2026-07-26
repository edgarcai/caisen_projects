"""提供跨平台一致的末日主题 Tkinter 自绘组件。"""

from __future__ import annotations

import tkinter as tk
from typing import Any, Callable, Mapping, Optional


class GameButton(tk.Canvas):
    """使用 Canvas 绘制不受 macOS 原生按钮主题影响的交互按钮。"""

    def __init__(
        self,
        parent: tk.Misc,
        text: str,
        command: Callable[[], None],
        palette: Mapping[str, str],
        disabled_palette: Mapping[str, str],
        metrics: Mapping[str, Any],
        fonts: Mapping[str, Any],
        width: int,
        height: int,
        icon: str = "",
        subtitle: str = "",
        state: str = "normal",
        show_prompt: bool = True,
        shape: str = "rectangle",
    ) -> None:
        """创建指定尺寸、样式和状态的自绘按钮。"""

        self._validate_shape(shape, metrics, width)
        self._text = text
        self._subtitle = subtitle
        self._icon = icon
        self._command = command
        self._palette = dict(palette)
        self._disabled_palette = dict(disabled_palette)
        self._metrics = metrics
        self._fonts = fonts
        self._button_width = width
        self._button_height = height
        self._state = state
        self._hovered = False
        self._pressed = False
        self._focused = False
        self._show_prompt = show_prompt
        self._shape = shape
        self._parallelogram_slant = int(metrics.get("parallelogram_slant", 0))
        parent_background = str(parent.cget("bg"))
        super().__init__(
            parent,
            width=width,
            height=height,
            bg=parent_background,
            bd=0,
            highlightthickness=0,
            takefocus=1,
            cursor="hand2" if state == "normal" else "arrow",
        )
        self._background_item = self._create_background_item()
        self._accent_item = self._create_accent_item()
        icon_x = metrics["icon_center_x"]
        if icon:
            text_x = metrics["text_with_icon_x"]
        elif shape == "parallelogram":
            text_x = metrics["parallelogram_text_x"]
        else:
            text_x = metrics["text_without_icon_x"]
        self._icon_item = self.create_text(
            icon_x,
            height // 2,
            text=icon,
            anchor="center",
            font=(fonts["family"], fonts["button_size"], "bold"),
        )
        title_y = height // 2 - metrics["subtitle_offset"] if subtitle else height // 2
        self._text_item = self.create_text(
            text_x,
            title_y,
            text=text,
            anchor="w",
            font=(fonts["family"], fonts["button_size"], "bold"),
        )
        self._subtitle_item = self.create_text(
            text_x,
            height // 2 + metrics["subtitle_offset"],
            text=subtitle,
            anchor="w",
            font=(fonts["family"], fonts["small_size"]),
        )
        self._prompt_item = self.create_text(
            width - metrics["prompt_right_padding"],
            height // 2,
            text=metrics["prompt_symbol"] if show_prompt else "",
            anchor="e",
            font=(fonts["family"], fonts["button_size"], "bold"),
        )
        self._bind_interactions()
        self._redraw()

    def configure(self, cnf: Optional[Mapping[str, Any]] = None, **kwargs: Any):
        """兼容 Tk 组件接口，并单独处理自绘按钮的文字与禁用状态。"""

        options = dict(cnf or {})
        options.update(kwargs)
        if "state" in options:
            self._state = str(options.pop("state"))
            self._pressed = False
            self._hovered = False
        if "text" in options:
            self._text = str(options.pop("text"))
            self.itemconfigure(self._text_item, text=self._text)
        if options:
            super().configure(**options)
        self._redraw()
        return None

    config = configure

    def cget(self, key: str):
        """返回文字、状态和当前配色，供界面测试及辅助工具读取。"""

        if key == "text":
            return self._text
        if key == "state":
            return self._state
        if key == "shape":
            return self._shape
        if key == "subtitle":
            return self._subtitle
        if key in {"background", "bg"}:
            return self._current_palette()["background"]
        if key in {"foreground", "fg"}:
            return self._current_palette()["foreground"]
        return super().cget(key)

    def invoke(self) -> None:
        """在按钮可用时执行绑定命令。"""

        if self._state == "normal":
            self._command()

    def _bind_interactions(self) -> None:
        """绑定鼠标悬停、按压和键盘可访问交互。"""

        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<Return>", self._on_keyboard_activate)
        self.bind("<space>", self._on_keyboard_activate)
        self.bind("<FocusIn>", self._on_focus_in)
        self.bind("<FocusOut>", self._on_focus_out)

    @staticmethod
    def _validate_shape(
        shape: str,
        metrics: Mapping[str, Any],
        width: int,
    ) -> None:
        """校验按钮形状及平行四边形斜切值是否能够安全绘制。"""

        if shape not in {"rectangle", "parallelogram"}:
            raise ValueError("未知按钮形状：{}".format(shape))
        if shape == "rectangle":
            return
        slant = metrics.get("parallelogram_slant")
        if (
            isinstance(slant, bool)
            or not isinstance(slant, int)
            or slant <= 0
            or slant * 2 >= width
        ):
            raise ValueError("平行四边形按钮斜切值必须为小于按钮半宽的正整数")

    def _create_background_item(self) -> int:
        """依据配置形状创建矩形或平行四边形背景图元。"""

        if self._shape == "parallelogram":
            slant = self._parallelogram_slant
            return self.create_polygon(
                slant + 1,
                1,
                self._button_width - 1,
                1,
                self._button_width - slant - 1,
                self._button_height - 1,
                1,
                self._button_height - 1,
                width=self._metrics["border_width"],
            )
        return self.create_rectangle(
            1,
            1,
            self._button_width - 1,
            self._button_height - 1,
            width=self._metrics["border_width"],
        )

    def _create_accent_item(self) -> int:
        """创建贴合当前按钮左边缘的强调色图元。"""

        accent_width = self._metrics["accent_width"]
        if self._shape == "parallelogram":
            slant = self._parallelogram_slant
            return self.create_polygon(
                slant + 1,
                1,
                slant + accent_width + 1,
                1,
                accent_width + 1,
                self._button_height - 1,
                1,
                self._button_height - 1,
                width=0,
            )
        return self.create_rectangle(
            1,
            1,
            accent_width,
            self._button_height - 1,
            width=0,
        )

    def _on_enter(self, _event: tk.Event) -> None:
        """鼠标进入时切换悬停色。"""

        if self._state == "normal":
            self._hovered = True
            self._redraw()

    def _on_leave(self, _event: tk.Event) -> None:
        """鼠标离开时恢复默认色并取消按压。"""

        self._hovered = False
        self._pressed = False
        self._redraw()

    def _on_press(self, _event: tk.Event) -> None:
        """鼠标按下时显示按压反馈并取得键盘焦点。"""

        if self._state == "normal" and self._contains_point(_event.x, _event.y):
            self.focus_set()
            self._pressed = True
            self._redraw()

    def _on_release(self, event: tk.Event) -> None:
        """鼠标在按钮区域内释放时触发命令。"""

        should_invoke = (
            self._state == "normal"
            and self._pressed
            and self._contains_point(event.x, event.y)
        )
        self._pressed = False
        self._redraw()
        if should_invoke:
            self.invoke()

    def _on_keyboard_activate(self, _event: tk.Event) -> str:
        """允许回车键和空格键触发当前按钮。"""

        self.invoke()
        return "break"

    def _on_focus_in(self, _event: tk.Event) -> None:
        """取得焦点时强化边框，提示键盘当前位置。"""

        self._focused = True
        self._redraw()

    def _on_focus_out(self, _event: tk.Event) -> None:
        """失去焦点时恢复普通边框。"""

        self._focused = False
        self._redraw()

    def _contains_point(self, x_position: int, y_position: int) -> bool:
        """判断坐标是否位于当前矩形或平行四边形的有效点击区域。"""

        if not 0 <= y_position <= self._button_height:
            return False
        if self._shape == "rectangle":
            return 0 <= x_position <= self._button_width
        vertical_ratio = y_position / max(self._button_height, 1)
        left_edge = self._parallelogram_slant * (1 - vertical_ratio)
        right_edge = self._button_width - self._parallelogram_slant * vertical_ratio
        return left_edge <= x_position <= right_edge

    def _current_palette(self) -> Mapping[str, str]:
        """按照禁用、按压和悬停优先级返回当前调色板。"""

        if self._state != "normal":
            return self._disabled_palette
        palette = dict(self._palette)
        if self._pressed:
            palette["background"] = palette["pressed"]
        elif self._hovered:
            palette["background"] = palette["hover"]
        return palette

    def _redraw(self) -> None:
        """将当前交互状态映射到 Canvas 图元颜色和鼠标形态。"""

        palette = self._current_palette()
        border = palette["focus"] if self._focused else palette["border"]
        self.itemconfigure(
            self._background_item,
            fill=palette["background"],
            outline=border,
        )
        self.itemconfigure(self._accent_item, fill=palette["accent"])
        self.itemconfigure(self._icon_item, fill=palette["accent"])
        self.itemconfigure(self._text_item, fill=palette["foreground"])
        self.itemconfigure(self._subtitle_item, fill=palette["muted_foreground"])
        self.itemconfigure(self._prompt_item, fill=palette["accent"])
        super().configure(cursor="hand2" if self._state == "normal" else "arrow")


class GameButtonFactory:
    """根据配置集中创建尺寸与色彩一致的游戏按钮。"""

    def __init__(
        self,
        styles: Mapping[str, Any],
        fonts: Mapping[str, Any],
        metrics: Mapping[str, Any],
    ) -> None:
        """保存按钮样式、字体与尺寸配置。"""

        self._styles = styles
        self._fonts = fonts
        self._metrics = metrics

    def create(
        self,
        parent: tk.Misc,
        text: str,
        command: Callable[[], None],
        style: str,
        size: str,
        icon: str = "",
        subtitle: str = "",
        state: str = "normal",
        show_prompt: bool = True,
        shape: str = "rectangle",
    ) -> GameButton:
        """按照稳定样式名和尺寸名创建一个自绘按钮。"""

        size_config = self._metrics["sizes"][size]
        button_fonts = dict(self._fonts)
        if "font_size" in size_config:
            button_fonts["button_size"] = size_config["font_size"]
        return GameButton(
            parent=parent,
            text=text,
            command=command,
            palette=self._styles[style],
            disabled_palette=self._styles["disabled"],
            metrics=self._metrics,
            fonts=button_fonts,
            width=size_config["width"],
            height=size_config["height"],
            icon=icon,
            subtitle=subtitle,
            state=state,
            show_prompt=show_prompt,
            shape=shape,
        )


class StatusMeter(tk.Frame):
    """显示数值、上限和风险色彩的紧凑资源状态条。"""

    def __init__(
        self,
        parent: tk.Misc,
        label: str,
        maximum: int,
        direction: str,
        thresholds: Mapping[str, float],
        palette: Mapping[str, str],
        fonts: Mapping[str, Any],
        metrics: Mapping[str, Any],
    ) -> None:
        """创建状态条，并保存数值方向和风险阈值配置。"""

        super().__init__(parent, bg=palette["surface"])
        self._maximum = maximum
        self._direction = direction
        self._thresholds = thresholds
        self._palette = palette
        self._metrics = metrics
        self._value = 0
        self._label = tk.Label(
            self,
            text=label,
            bg=palette["surface"],
            fg=palette["label"],
            font=(fonts["family"], fonts["small_size"]),
        )
        self._label.grid(row=0, column=0, sticky="w")
        self._value_label = tk.Label(
            self,
            bg=palette["surface"],
            fg=palette["value"],
            font=(fonts["family"], fonts["small_size"], "bold"),
        )
        self._value_label.grid(row=0, column=1, sticky="e")
        self.grid_columnconfigure(0, weight=1)
        self._bar = tk.Canvas(
            self,
            height=metrics["meter_height"],
            bg=palette["track"],
            bd=0,
            highlightthickness=0,
        )
        self._bar.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(3, 0))
        self._fill_item = self._bar.create_rectangle(0, 0, 0, 0, width=0)
        self._bar.bind("<Configure>", self._on_resize)
        self.update_value(0)

    def update_value(self, value: int) -> None:
        """刷新显示值、填充宽度与风险颜色。"""

        self._value = value
        self._value_label.configure(
            text=self._metrics["meter_value_format"].format(
                value=value,
                maximum=self._maximum,
            )
        )
        self._redraw_bar()

    def _on_resize(self, _event: tk.Event) -> None:
        """组件宽度变化后重新计算填充区域。"""

        self._redraw_bar()

    def _redraw_bar(self) -> None:
        """根据数值比例重新绘制状态条。"""

        ratio = 0.0 if self._maximum <= 0 else self._value / self._maximum
        ratio = max(0.0, min(ratio, 1.0))
        width = max(self._bar.winfo_width(), 1)
        height = self._metrics["meter_height"]
        self._bar.coords(self._fill_item, 0, 0, int(width * ratio), height)
        self._bar.itemconfigure(self._fill_item, fill=self._risk_color(ratio))

    def _risk_color(self, ratio: float) -> str:
        """按照高值危险或低值危险方向选择状态条颜色。"""

        warning = self._thresholds["warning"]
        danger = self._thresholds["danger"]
        if self._direction == "higher_is_worse":
            if ratio >= danger:
                return self._palette["danger"]
            if ratio >= warning:
                return self._palette["warning"]
            return self._palette["normal"]
        if ratio <= danger:
            return self._palette["danger"]
        if ratio <= warning:
            return self._palette["warning"]
        return self._palette["normal"]
