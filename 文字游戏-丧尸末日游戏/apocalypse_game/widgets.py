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
    ) -> None:
        """创建指定尺寸、样式和状态的自绘按钮。"""

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
        self._background_item = self.create_rectangle(
            1,
            1,
            width - 1,
            height - 1,
            width=metrics["border_width"],
        )
        self._accent_item = self.create_rectangle(
            1,
            1,
            metrics["accent_width"],
            height - 1,
            width=0,
        )
        icon_x = metrics["icon_center_x"]
        text_x = metrics["text_with_icon_x"] if icon else metrics["text_without_icon_x"]
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

        if self._state == "normal":
            self.focus_set()
            self._pressed = True
            self._redraw()

    def _on_release(self, event: tk.Event) -> None:
        """鼠标在按钮区域内释放时触发命令。"""

        should_invoke = (
            self._state == "normal"
            and self._pressed
            and 0 <= event.x <= self._button_width
            and 0 <= event.y <= self._button_height
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
    ) -> GameButton:
        """按照稳定样式名和尺寸名创建一个自绘按钮。"""

        size_config = self._metrics["sizes"][size]
        return GameButton(
            parent=parent,
            text=text,
            command=command,
            palette=self._styles[style],
            disabled_palette=self._styles["disabled"],
            metrics=self._metrics,
            fonts=self._fonts,
            width=size_config["width"],
            height=size_config["height"],
            icon=icon,
            subtitle=subtitle,
            state=state,
            show_prompt=show_prompt,
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
