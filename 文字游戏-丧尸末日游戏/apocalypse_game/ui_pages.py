"""提供主窗口内可压栈复用的非模态游戏页面。"""

from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from functools import partial
from typing import Callable, Dict, Mapping, Optional, Sequence, Set

from apocalypse_game.widgets import GameButton, GameButtonFactory


SubmitHandler = Callable[[], None]
ValueSubmitHandler = Callable[[str], None]
InputValidator = Callable[[str], Optional[str]]


_FALLBACK_PAGE_LAYOUT = {
    "content_width": 920,
    "content_height": 620,
    "horizontal_padding": 24,
    "vertical_padding": 24,
    "header_height": 72,
    "title_x": 126,
    "title_y": 36,
    "body_padding": 20,
    "section_gap": 12,
    "option_gap": 10,
    "option_columns": 2,
    "option_max_visible_rows": 3,
    "input_width": 36,
    "notice_accent_width": 4,
}

_FALLBACK_PAGE_TEXT = {
    "back_label": "返回",
    "continue_label": "继续",
    "cancel_label": "取消",
    "confirm_label": "确定",
    "option_details_block_format": "{body}\n\n【选项情报】\n{details}",
    "option_detail_format": "• {label}：{description}",
}

_PAGE_COLOR_THEME_KEYS = {
    "background": "background",
    "panel": "panel",
    "body_background": "panel_alt",
    "title_color": "text",
    "text_color": "text",
    "muted_text_color": "muted_text",
    "border_color": "border",
    "error_color": "danger",
    "success_color": "health",
}


@dataclass(frozen=True)
class PageOption:
    """描述选择页或战斗页中的一个稳定选项。"""

    option_id: str
    label: str
    description: str = ""
    enabled: bool = True
    style: str = "secondary"
    icon: str = ""


class _PageSettings:
    """集中读取页面布局、文案和主题颜色配置。"""

    def __init__(
        self,
        theme: Mapping[str, object],
        page_config: Optional[Mapping[str, object]],
    ) -> None:
        """保存主题和页面配置，并允许旧配置使用集中回退值。"""

        self._theme = theme
        self._page_config = page_config or {}

    def integer(self, name: str) -> int:
        """返回非负整数布局项，配置非法时给出明确错误。"""

        value = self._page_config.get(name)
        if value is None:
            value = self._derived_layout_value(name)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("页面布局配置 {} 必须是非负整数".format(name))
        return value

    def _derived_layout_value(self, name: str) -> Optional[int]:
        """为旧配置推导位置项，其余布局项从集中回退配置读取。"""

        if name == "back_x":
            return self.integer("content_width") - self.integer("horizontal_padding")
        if name == "back_y":
            return self.integer("header_height") // 2
        return _FALLBACK_PAGE_LAYOUT.get(name)

    def positive_integer(self, name: str) -> int:
        """返回正整数布局项，避免列数和尺寸出现零值。"""

        value = self.integer(name)
        if value < 1:
            raise ValueError("页面布局配置 {} 必须是正整数".format(name))
        return value

    def text(self, name: str) -> str:
        """返回页面文案，并拒绝非字符串配置。"""

        value = self._page_config.get(name, _FALLBACK_PAGE_TEXT.get(name))
        if not isinstance(value, str):
            raise ValueError("页面文案配置 {} 必须是字符串".format(name))
        return value

    def formatted_text(self, name: str, **values: str) -> str:
        """格式化配置化页面文案，并将占位符错误转为明确异常。"""

        try:
            return self.text(name).format(**values)
        except (KeyError, ValueError, IndexError) as error:
            raise ValueError("页面文案 {} 占位符无效".format(name)) from error

    def color(self, name: str) -> str:
        """优先读取页面颜色，否则复用全局主题中的语义色。"""

        value = self._page_config.get(name)
        if value is None:
            theme_key = _PAGE_COLOR_THEME_KEYS[name]
            value = self._theme.get(theme_key)
        if not isinstance(value, str) or not value:
            raise ValueError("页面颜色配置 {} 必须是非空字符串".format(name))
        return value


class BasePage(tk.Frame):
    """为主窗口内的游戏页面提供统一标题、正文、提示和页脚。"""

    def __init__(
        self,
        parent: tk.Misc,
        button_factory: GameButtonFactory,
        theme: Mapping[str, object],
        fonts: Mapping[str, object],
        title: str,
        on_back: Optional[SubmitHandler] = None,
        page_config: Optional[Mapping[str, object]] = None,
    ) -> None:
        """创建一个不产生额外窗口的可复用基础页面。"""

        self._button_factory = button_factory
        self._theme = theme
        self._fonts = fonts
        self._settings = _PageSettings(theme, page_config)
        self._on_back = on_back
        self._idle_callback_ids: Set[str] = set()
        self._notice_variable = tk.StringVar(master=parent, value="")
        super().__init__(
            parent,
            bg=self._settings.color("background"),
            takefocus=True,
        )
        self._build_shell()
        self._build_header(title)
        self._build_content()

    @property
    def main_frame(self) -> tk.Frame:
        """返回供具体页面布置主要内容的容器。"""

        return self._main_frame

    @property
    def footer_frame(self) -> tk.Frame:
        """返回供具体页面添加操作按钮的页脚容器。"""

        return self._footer_frame

    @property
    def error_message(self) -> str:
        """返回当前页内错误或提示文字。"""

        return self._notice_variable.get()

    @property
    def back_handler(self) -> Optional[SubmitHandler]:
        """返回与页面按钮共用语义的导航返回回调。"""

        if self._on_back is None:
            return None
        return self._dispatch_back

    def _build_shell(self) -> None:
        """创建居中的固定内容画布，并由外层页面负责铺满窗口。"""

        self._shell = tk.Frame(
            self,
            width=self._settings.positive_integer("content_width"),
            height=self._settings.positive_integer("content_height"),
            bg=self._settings.color("panel"),
            highlightbackground=self._settings.color("border_color"),
            highlightthickness=1,
        )
        self._shell.place(relx=0.5, rely=0.5, anchor=tk.CENTER)
        self._shell.grid_propagate(False)
        self._shell.grid_columnconfigure(0, weight=1)
        self._shell.grid_rowconfigure(1, weight=1)

    def _build_header(self, title: str) -> None:
        """创建配置驱动的标题栏和可选返回按钮。"""

        self._header_frame = tk.Frame(
            self._shell,
            height=self._settings.positive_integer("header_height"),
            bg=self._settings.color("panel"),
        )
        self._header_frame.grid(row=0, column=0, sticky="ew")
        self._header_frame.grid_propagate(False)
        title_label = tk.Label(
            self._header_frame,
            text=title,
            bg=self._settings.color("panel"),
            fg=self._settings.color("title_color"),
            font=self._font("section_size", "bold"),
            anchor="w",
        )
        title_label.place(
            x=self._settings.integer("title_x"),
            y=self._settings.integer("title_y"),
            anchor=tk.W,
        )
        self._back_button: Optional[GameButton] = None
        if self._on_back is not None:
            self._back_button = self._create_button(
                self._header_frame,
                self._settings.text("back_label"),
                self.request_back,
                style="secondary",
                size="system",
                show_prompt=False,
            )
            self._back_button.place(
                x=self._settings.integer("back_x"),
                y=self._settings.integer("back_y"),
                anchor=tk.E,
            )

    def _build_content(self) -> None:
        """创建主要内容、常驻页内提示和页脚三个区域。"""

        body_padding = self._settings.integer("body_padding")
        section_gap = self._settings.integer("section_gap")
        self._content_frame = tk.Frame(
            self._shell,
            bg=self._settings.color("body_background"),
        )
        self._content_frame.grid(
            row=1,
            column=0,
            sticky="nsew",
            padx=self._settings.integer("horizontal_padding"),
            pady=self._settings.integer("vertical_padding"),
        )
        self._content_frame.grid_columnconfigure(0, weight=1)
        self._content_frame.grid_rowconfigure(0, weight=1)

        self._main_frame = tk.Frame(
            self._content_frame,
            bg=self._settings.color("body_background"),
            padx=body_padding,
            pady=body_padding,
        )
        self._main_frame.grid(row=0, column=0, sticky="nsew")

        self._notice_frame = tk.Frame(
            self._content_frame,
            bg=self._settings.color("body_background"),
        )
        self._notice_frame.grid(
            row=1,
            column=0,
            sticky="ew",
            pady=(section_gap, 0),
        )
        self._notice_accent = tk.Frame(
            self._notice_frame,
            width=self._settings.integer("notice_accent_width"),
            bg=self._settings.color("body_background"),
        )
        self._notice_accent.pack(side=tk.LEFT, fill=tk.Y)
        self._notice_label = tk.Label(
            self._notice_frame,
            textvariable=self._notice_variable,
            bg=self._settings.color("body_background"),
            fg=self._settings.color("error_color"),
            font=self._font("small_size"),
            anchor="w",
            justify=tk.LEFT,
            wraplength=self._body_wrap_length(),
        )
        self._notice_label.pack(
            side=tk.LEFT,
            fill=tk.X,
            expand=True,
            padx=(section_gap, 0),
        )

        self._footer_frame = tk.Frame(
            self._content_frame,
            bg=self._settings.color("body_background"),
        )
        self._footer_frame.grid(
            row=2,
            column=0,
            sticky="ew",
            pady=(section_gap, 0),
        )

    def _font(self, size_name: str, weight: str = "normal") -> tuple:
        """根据字体配置返回 Tk 可直接使用的字体元组。"""

        family = self._fonts.get("family")
        size = self._fonts.get(size_name)
        if not isinstance(family, str) or not family:
            raise ValueError("fonts.family 必须是非空字符串")
        if isinstance(size, bool) or not isinstance(size, int) or size < 1:
            raise ValueError("fonts.{} 必须是正整数".format(size_name))
        return family, size, weight

    def _body_wrap_length(self) -> int:
        """根据内容宽度和内外边距计算正文可用像素宽度。"""

        available_width = (
            self._settings.positive_integer("content_width")
            - self._settings.integer("horizontal_padding") * 2
            - self._settings.integer("body_padding") * 2
        )
        return max(available_width, 1)

    def _schedule_idle(self, callback: SubmitHandler) -> str:
        """登记页面级空闲回调，便于销毁前统一取消。"""

        callback_id = self.after_idle(callback)
        self._idle_callback_ids.add(callback_id)
        return callback_id

    def destroy(self) -> None:
        """取消未执行的页面空闲回调，再销毁 Tk 组件树。"""

        for callback_id in tuple(self._idle_callback_ids):
            try:
                self.after_cancel(callback_id)
            except tk.TclError:
                pass
        self._idle_callback_ids.clear()
        super().destroy()

    def _create_scrollable_text(
        self,
        parent: tk.Misc,
        text: str,
    ) -> tuple[tk.Frame, tk.Text]:
        """创建带滚动条且保持可选择复制的只读长文本区域。"""

        container = tk.Frame(
            parent,
            bg=self._settings.color("body_background"),
            highlightbackground=self._settings.color("border_color"),
            highlightthickness=1,
        )
        container.grid_columnconfigure(0, weight=1)
        container.grid_rowconfigure(0, weight=1)
        scrollbar = tk.Scrollbar(container, orient=tk.VERTICAL)
        scrollbar.grid(row=0, column=1, sticky="ns")
        text_widget = tk.Text(
            container,
            wrap=tk.WORD,
            height=1,
            bg=self._settings.color("body_background"),
            fg=self._settings.color("text_color"),
            insertbackground=self._settings.color("text_color"),
            selectbackground=self._settings.color("panel"),
            relief=tk.FLAT,
            bd=0,
            highlightthickness=0,
            padx=self._settings.integer("body_padding"),
            pady=self._settings.integer("body_padding"),
            font=self._font("body_size"),
            yscrollcommand=scrollbar.set,
        )
        text_widget.grid(row=0, column=0, sticky="nsew")
        text_widget.insert("1.0", text)
        text_widget.configure(state=tk.DISABLED)
        scrollbar.configure(command=text_widget.yview)
        text_widget.bind(
            "<Configure>",
            partial(self._update_scrollbar_visibility, text_widget, scrollbar),
            add="+",
        )
        self._schedule_idle(
            partial(self._update_scrollbar_visibility, text_widget, scrollbar)
        )
        return container, text_widget

    def _update_scrollbar_visibility(
        self,
        scrollable: tk.Misc,
        scrollbar: tk.Scrollbar,
        _event: Optional[tk.Event] = None,
    ) -> None:
        """仅在正文真实溢出可见区域时显示纵向滚动条。"""

        first, last = scrollable.yview()
        if first <= 0.0 and last >= 1.0:
            scrollbar.grid_remove()
            return
        scrollbar.grid()

    def _create_button(
        self,
        parent: tk.Misc,
        text: str,
        command: SubmitHandler,
        style: str = "secondary",
        size: str = "dialog",
        icon: str = "",
        subtitle: str = "",
        state: str = "normal",
        show_prompt: bool = True,
    ) -> GameButton:
        """仅通过传入工厂创建统一外观的游戏按钮。"""

        return self._button_factory.create(
            parent=parent,
            text=text,
            command=command,
            style=style,
            size=size,
            icon=icon,
            subtitle=subtitle,
            state=state,
            show_prompt=show_prompt,
        )

    def _add_footer_button(
        self,
        text: str,
        command: SubmitHandler,
        style: str = "secondary",
        state: str = "normal",
    ) -> GameButton:
        """向页脚右侧添加一个配置化对话按钮。"""

        button = self._create_button(
            self._footer_frame,
            text,
            command,
            style=style,
            size="dialog",
            state=state,
            show_prompt=False,
        )
        button.pack(
            side=tk.RIGHT,
            padx=(self._settings.integer("option_gap"), 0),
        )
        return button

    def show_error(self, message: str) -> None:
        """在当前页面内展示错误，不清空任何用户输入。"""

        self._notice_variable.set(message)
        error_color = self._settings.color("error_color")
        self._notice_label.configure(fg=error_color)
        self._notice_accent.configure(bg=error_color)

    def show_notice(self, message: str) -> None:
        """在当前页面内展示成功或普通状态提示。"""

        self._notice_variable.set(message)
        success_color = self._settings.color("success_color")
        self._notice_label.configure(fg=success_color)
        self._notice_accent.configure(bg=success_color)

    def clear_error(self) -> None:
        """清空当前页内提示，同时保留布局高度避免页面跳动。"""

        self._notice_variable.set("")
        body_background = self._settings.color("body_background")
        self._notice_label.configure(fg=self._settings.color("error_color"))
        self._notice_accent.configure(bg=body_background)

    def request_back(self) -> bool:
        """执行页面级返回回调；无返回能力时仅提示用户。"""

        if self._on_back is None:
            self.bell()
            return False
        self._on_back()
        return True

    def _dispatch_back(self) -> None:
        """为页面栈转发与返回按钮完全相同的处理路径。"""

        self.request_back()


class InputPage(BasePage):
    """收集单行文本，并把校验错误留在当前页面内展示。"""

    def __init__(
        self,
        parent: tk.Misc,
        button_factory: GameButtonFactory,
        theme: Mapping[str, object],
        fonts: Mapping[str, object],
        title: str,
        prompt: str,
        on_submit: ValueSubmitHandler,
        on_back: Optional[SubmitHandler] = None,
        initial_value: str = "",
        validator: Optional[InputValidator] = None,
        submit_label: Optional[str] = None,
        password: bool = False,
        page_config: Optional[Mapping[str, object]] = None,
    ) -> None:
        """创建输入页并绑定回车提交、页内校验和返回操作。"""

        self._on_submit = on_submit
        self._validator = validator
        self._initial_value = initial_value
        self._prompt = prompt
        self._password = password
        self._submit_label = submit_label
        super().__init__(
            parent,
            button_factory,
            theme,
            fonts,
            title,
            on_back=on_back,
            page_config=page_config,
        )
        self._build_form()

    @property
    def value(self) -> str:
        """返回输入框中的原始文本。"""

        return self._value_variable.get()

    def set_value(self, value: str) -> None:
        """更新输入框内容，便于调用方恢复草稿。"""

        self._value_variable.set(value)

    def _build_form(self) -> None:
        """创建提示、输入框以及提交和返回按钮。"""

        input_width = self._settings.positive_integer("input_width")
        section_gap = self._settings.integer("section_gap")
        self._main_frame.grid_columnconfigure(0, weight=1)
        self.prompt_label = tk.Label(
            self._main_frame,
            text=self._prompt,
            bg=self._settings.color("body_background"),
            fg=self._settings.color("text_color"),
            font=self._font("body_size"),
            justify=tk.LEFT,
            anchor="w",
            wraplength=self._body_wrap_length(),
        )
        self.prompt_label.grid(row=0, column=0, sticky="ew")

        self._value_variable = tk.StringVar(
            master=self,
            value=self._initial_value,
        )
        self.entry = tk.Entry(
            self._main_frame,
            textvariable=self._value_variable,
            width=input_width,
            show="•" if self._password else "",
            bg=self._settings.color("panel"),
            fg=self._settings.color("text_color"),
            insertbackground=self._settings.color("text_color"),
            selectbackground=self._settings.color("body_background"),
            relief=tk.FLAT,
            bd=0,
            highlightbackground=self._settings.color("border_color"),
            highlightcolor=self._settings.color("success_color"),
            highlightthickness=1,
            font=self._font("body_size"),
        )
        self.entry.grid(row=1, column=0, sticky="w", pady=(section_gap, 0))
        self.entry.bind("<Return>", self._on_return)

        submit_text = self._submit_label or self._settings.text("confirm_label")
        self.submit_button = self._add_footer_button(
            submit_text,
            self._submit,
            style="primary",
        )
        self.cancel_button = None
        self._schedule_idle(self._focus_entry)

    def _focus_entry(self) -> None:
        """页面完成布局后把键盘焦点交给输入框。"""

        if self.entry.winfo_exists():
            self.entry.focus_set()
            self.entry.icursor(tk.END)

    def _on_return(self, _event: tk.Event) -> str:
        """让回车键与提交按钮执行同一条校验路径。"""

        self._submit()
        return "break"

    def _submit(self) -> None:
        """校验当前输入，失败时保留文本并显示页内错误。"""

        value = self._value_variable.get()
        try:
            validation_message = self._validator(value) if self._validator else None
        except ValueError as error:
            self.show_error(str(error))
            return
        if validation_message:
            self.show_error(validation_message)
            return
        self.clear_error()
        try:
            self._on_submit(value)
        except ValueError as error:
            self.show_error(str(error))


class SelectionPage(BasePage):
    """显示长文本和一组选项，并保持锁定选项可见但不可操作。"""

    def __init__(
        self,
        parent: tk.Misc,
        button_factory: GameButtonFactory,
        theme: Mapping[str, object],
        fonts: Mapping[str, object],
        title: str,
        body: str,
        options: Sequence[PageOption],
        on_submit: ValueSubmitHandler,
        on_back: Optional[SubmitHandler] = None,
        columns: Optional[int] = None,
        submit_on_select: bool = True,
        submit_label: Optional[str] = None,
        page_config: Optional[Mapping[str, object]] = None,
    ) -> None:
        """创建支持即时提交或先选择再确认的选项页面。"""

        self._body = body
        self._page_options = tuple(options)
        self._on_submit = on_submit
        self._columns = columns
        self._submit_on_select = submit_on_select
        self._submit_label = submit_label
        self._selected_option_id: Optional[str] = None
        self.option_buttons: Dict[str, GameButton] = {}
        super().__init__(
            parent,
            button_factory,
            theme,
            fonts,
            title,
            on_back=on_back,
            page_config=page_config,
        )
        self._build_selection()

    @property
    def selected_option_id(self) -> Optional[str]:
        """返回确认前最近选择的可用选项标识。"""

        return self._selected_option_id

    def _build_selection(self) -> None:
        """创建滚动正文、选项网格和可选确认按钮。"""

        columns = self._columns or self._settings.positive_integer("option_columns")
        if columns < 1:
            raise ValueError("选择页列数必须是正整数")
        option_ids = [option.option_id for option in self._page_options]
        if len(option_ids) != len(set(option_ids)):
            raise ValueError("选择页选项标识不能重复")

        self._main_frame.grid_columnconfigure(0, weight=1)
        self._main_frame.grid_rowconfigure(0, weight=1)
        text_container, self.body_text = self._create_scrollable_text(
            self._main_frame,
            self._selection_body(),
        )
        text_container.grid(row=0, column=0, sticky="nsew")

        options_container = tk.Frame(
            self._main_frame,
            bg=self._settings.color("body_background"),
        )
        options_container.grid(
            row=1,
            column=0,
            sticky="ew",
            pady=(self._settings.integer("section_gap"), 0),
        )
        options_container.grid_columnconfigure(0, weight=1)
        self._option_canvas = tk.Canvas(
            options_container,
            height=1,
            bg=self._settings.color("body_background"),
            bd=0,
            highlightthickness=0,
            yscrollincrement=self._settings.positive_integer("option_gap"),
        )
        self._option_canvas.grid(row=0, column=0, sticky="ew")
        self._option_scrollbar = tk.Scrollbar(
            options_container,
            orient=tk.VERTICAL,
            command=self._option_canvas.yview,
        )
        self._option_scrollbar.grid(row=0, column=1, sticky="ns")
        self._option_canvas.configure(yscrollcommand=self._option_scrollbar.set)
        self._options_frame = tk.Frame(
            self._option_canvas,
            bg=self._settings.color("body_background"),
        )
        self._option_window = self._option_canvas.create_window(
            0,
            0,
            anchor=tk.NW,
            window=self._options_frame,
        )
        self._option_canvas.bind("<Configure>", self._on_option_canvas_configure)
        self._options_frame.bind(
            "<Configure>",
            self._on_options_frame_configure,
        )
        for column in range(columns):
            self._options_frame.grid_columnconfigure(column, weight=1)
        for index, option in enumerate(self._page_options):
            state = "normal" if option.enabled else "disabled"
            button = self._create_button(
                self._options_frame,
                option.label,
                partial(self._select_option, option.option_id),
                style=option.style,
                size="choice",
                icon=option.icon,
                state=state,
            )
            row, column = divmod(index, columns)
            button.grid(
                row=row,
                column=column,
                padx=self._settings.integer("option_gap"),
                pady=self._settings.integer("option_gap"),
            )
            self.option_buttons[option.option_id] = button
        self._set_option_canvas_height(columns)
        self._schedule_idle(self._refresh_option_scroll_region)

        self.submit_button: Optional[GameButton] = None
        if not self._submit_on_select:
            submit_text = self._submit_label or self._settings.text("confirm_label")
            self.submit_button = self._add_footer_button(
                submit_text,
                self._submit_selected,
                style="primary",
                state="disabled",
            )
        self.cancel_button = None

    def _selection_body(self) -> str:
        """把选项说明放入正文情报区，避免以按钮小字裁切关键信息。"""

        details = [
            self._settings.formatted_text(
                "option_detail_format",
                label=option.label,
                description=option.description,
            )
            for option in self._page_options
            if option.description
        ]
        if not details:
            return self._body
        return self._settings.formatted_text(
            "option_details_block_format",
            body=self._body,
            details="\n".join(details),
        )

    def _set_option_canvas_height(self, columns: int) -> None:
        """按选项行数设置可见高度，并为超出部分保留滚动空间。"""

        option_gap = self._settings.integer("option_gap")
        row_count = (len(self._page_options) + columns - 1) // columns
        button_height = max(
            (button.winfo_reqheight() for button in self.option_buttons.values()),
            default=0,
        )
        visible_rows = min(
            row_count,
            self._settings.positive_integer("option_max_visible_rows"),
        )
        visible_height = visible_rows * (button_height + option_gap * 2)
        self._option_canvas.configure(
            height=max(visible_height, 1),
        )

    def _on_option_canvas_configure(self, event: tk.Event) -> None:
        """让选项内部容器始终匹配可见画布宽度。"""

        self._option_canvas.itemconfigure(
            self._option_window,
            width=max(event.width, 1),
        )

    def _on_options_frame_configure(self, _event: tk.Event) -> None:
        """选项布局变化时刷新画布的滚动边界。"""

        self._refresh_option_scroll_region()

    def _refresh_option_scroll_region(self) -> None:
        """根据全部选项的实际边界更新纵向滚动范围。"""

        bounds = self._option_canvas.bbox("all")
        if bounds is not None:
            self._option_canvas.configure(scrollregion=bounds)
            if bounds[3] <= self._option_canvas.winfo_height():
                self._option_scrollbar.grid_remove()
            else:
                self._option_scrollbar.grid()

    def _select_option(self, option_id: str) -> None:
        """选择可用选项，并根据页面模式立即提交或等待确认。"""

        option = next(
            (item for item in self._page_options if item.option_id == option_id),
            None,
        )
        if option is None or not option.enabled:
            return
        self._selected_option_id = option_id
        self.clear_error()
        if self._submit_on_select:
            self._on_submit(option_id)
            return
        if self.submit_button is not None:
            self.submit_button.configure(state="normal")

    def _submit_selected(self) -> None:
        """提交已选择选项；无选择时不执行领域回调。"""

        if self._selected_option_id is None:
            self.bell()
            return
        self._on_submit(self._selected_option_id)


class MessagePage(BasePage):
    """以可滚动正文展示剧情、教程、通讯或普通结果。"""

    def __init__(
        self,
        parent: tk.Misc,
        button_factory: GameButtonFactory,
        theme: Mapping[str, object],
        fonts: Mapping[str, object],
        title: str,
        body: str,
        on_submit: Optional[SubmitHandler] = None,
        on_back: Optional[SubmitHandler] = None,
        submit_label: Optional[str] = None,
        page_config: Optional[Mapping[str, object]] = None,
    ) -> None:
        """创建消息页，并按需提供继续和返回操作。"""

        self._body = body
        self._on_submit = on_submit
        self._submit_label = submit_label
        super().__init__(
            parent,
            button_factory,
            theme,
            fonts,
            title,
            on_back=on_back,
            page_config=page_config,
        )
        self._build_message()

    def _build_message(self) -> None:
        """创建滚动正文和消息页操作按钮。"""

        self._main_frame.grid_columnconfigure(0, weight=1)
        self._main_frame.grid_rowconfigure(0, weight=1)
        text_container, self.body_text = self._create_scrollable_text(
            self._main_frame,
            self._body,
        )
        text_container.grid(row=0, column=0, sticky="nsew")
        self.submit_button: Optional[GameButton] = None
        if self._on_submit is not None:
            submit_text = self._submit_label or self._settings.text("continue_label")
            self.submit_button = self._add_footer_button(
                submit_text,
                self._on_submit,
                style="primary",
            )
        self.cancel_button = None


class ConfirmPage(BasePage):
    """在主窗口内展示明确的确认和取消选择。"""

    def __init__(
        self,
        parent: tk.Misc,
        button_factory: GameButtonFactory,
        theme: Mapping[str, object],
        fonts: Mapping[str, object],
        title: str,
        body: str,
        on_submit: SubmitHandler,
        on_back: Optional[SubmitHandler],
        confirm_label: Optional[str] = None,
        cancel_label: Optional[str] = None,
        danger: bool = False,
        page_config: Optional[Mapping[str, object]] = None,
    ) -> None:
        """创建可用于危险操作或普通确认的页面。"""

        self._body = body
        self._on_submit = on_submit
        self._confirm_label = confirm_label
        self._cancel_label = cancel_label
        self._danger = danger
        cancel_handler = on_back
        super().__init__(
            parent,
            button_factory,
            theme,
            fonts,
            title,
            on_back=None,
            page_config=page_config,
        )
        self._on_back = cancel_handler
        self._build_confirmation()

    def _build_confirmation(self) -> None:
        """创建滚动说明、确认按钮和可用时的取消按钮。"""

        self._main_frame.grid_columnconfigure(0, weight=1)
        self._main_frame.grid_rowconfigure(0, weight=1)
        text_container, self.body_text = self._create_scrollable_text(
            self._main_frame,
            self._body,
        )
        text_container.grid(row=0, column=0, sticky="nsew")
        confirm_text = self._confirm_label or self._settings.text("confirm_label")
        self.confirm_button = self._add_footer_button(
            confirm_text,
            self._on_submit,
            style="danger" if self._danger else "primary",
        )
        if self._on_back is not None:
            cancel_text = self._cancel_label or self._settings.text("cancel_label")
            self.cancel_button = self._add_footer_button(
                cancel_text,
                self.request_back,
            )
        else:
            self.cancel_button = None


class BattlePage(SelectionPage):
    """以选择页形式展示战况和配置化战斗行动。"""

    def __init__(
        self,
        parent: tk.Misc,
        button_factory: GameButtonFactory,
        theme: Mapping[str, object],
        fonts: Mapping[str, object],
        title: str,
        body: str,
        actions: Sequence[PageOption],
        on_submit: ValueSubmitHandler,
        on_back: Optional[SubmitHandler] = None,
        columns: Optional[int] = None,
        page_config: Optional[Mapping[str, object]] = None,
    ) -> None:
        """创建不持有领域状态、只负责转发行动标识的战斗页。"""

        super().__init__(
            parent=parent,
            button_factory=button_factory,
            theme=theme,
            fonts=fonts,
            title=title,
            body=body,
            options=actions,
            on_submit=on_submit,
            on_back=on_back,
            columns=columns,
            submit_on_select=True,
            page_config=page_config,
        )


class EndingPage(MessagePage):
    """展示完整结局正文并把玩家带回调用方指定位置。"""

    def __init__(
        self,
        parent: tk.Misc,
        button_factory: GameButtonFactory,
        theme: Mapping[str, object],
        fonts: Mapping[str, object],
        ending_title: str,
        body: str,
        on_submit: SubmitHandler,
        submit_label: Optional[str] = None,
        page_config: Optional[Mapping[str, object]] = None,
    ) -> None:
        """创建带单一收束操作的结局页面。"""

        super().__init__(
            parent=parent,
            button_factory=button_factory,
            theme=theme,
            fonts=fonts,
            title=ending_title,
            body=body,
            on_submit=on_submit,
            on_back=None,
            submit_label=submit_label,
            page_config=page_config,
        )


__all__ = [
    "BasePage",
    "BattlePage",
    "ConfirmPage",
    "EndingPage",
    "InputPage",
    "MessagePage",
    "PageOption",
    "SelectionPage",
]
