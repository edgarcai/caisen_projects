"""基于 Tkinter 的中文桌面游戏界面。"""

from __future__ import annotations

import re
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, simpledialog
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from apocalypse_game.application import GameApplication, GameApplicationError
from apocalypse_game.combat import CombatError
from apocalypse_game.config import ConfigError, GameConfig
from apocalypse_game.domain import ActionReport, EventPrompt, StoryPrompt
from apocalypse_game.events import EventError
from apocalypse_game.ports import SaveDataError
from apocalypse_game.shelter import ShelterManagementError
from apocalypse_game.story import StoryError
from apocalypse_game.widgets import GameButton, GameButtonFactory, StatusMeter

try:
    from PIL import Image, ImageOps, ImageTk
except ImportError:  # pragma: no cover - 仅在未安装可选图像依赖时触发
    Image = None
    ImageOps = None
    ImageTk = None


class ChoiceDialog:
    """显示一个可配置按钮列表并返回用户选择的标识。"""

    def __init__(
        self,
        parent: tk.Misc,
        title: str,
        prompt: str,
        options: Sequence[Tuple[str, str]],
        config: GameConfig,
        columns: int = 1,
    ) -> None:
        """创建模态选择窗口，但把等待行为留给 ``show``。"""

        self._result: Optional[str] = None
        self._window = tk.Toplevel(parent)
        self._window.title(title)
        self._window.transient(parent)
        self._window.grab_set()
        self._window.resizable(False, False)
        theme = config.section("theme")
        fonts = config.section("fonts")
        button_factory = GameButtonFactory(
            config.section("button_styles"),
            fonts,
            config.section("interface")["buttons"],
        )
        self._window.configure(bg=theme["panel"])

        label = tk.Label(
            self._window,
            text=prompt,
            bg=theme["panel"],
            fg=theme["text"],
            font=(fonts["family"], fonts["body_size"]),
            justify="left",
            wraplength=460,
        )
        label.grid(row=0, column=0, columnspan=max(columns, 1), padx=24, pady=(22, 16))

        for index, (option_id, option_label) in enumerate(options):
            row = 1 + index // columns
            column = index % columns
            button = button_factory.create(
                parent=self._window,
                text=option_label,
                command=lambda selected=option_id: self._select(selected),
                style="secondary",
                size="choice",
                show_prompt=False,
            )
            button.grid(row=row, column=column, padx=8, pady=7, sticky="ew")

        self._window.protocol("WM_DELETE_WINDOW", self._cancel)
        self._window.update_idletasks()
        x_position = parent.winfo_rootx() + max(
            0,
            (parent.winfo_width() - self._window.winfo_width()) // 2,
        )
        y_position = parent.winfo_rooty() + max(
            0,
            (parent.winfo_height() - self._window.winfo_height()) // 2,
        )
        self._window.geometry("+{}+{}".format(x_position, y_position))

    def show(self) -> Optional[str]:
        """等待模态窗口关闭，并返回选中标识或 ``None``。"""

        self._window.wait_window()
        return self._result

    def _select(self, option_id: str) -> None:
        """记录选择结果并关闭窗口。"""

        self._result = option_id
        self._window.destroy()

    def _cancel(self) -> None:
        """在用户关闭窗口时返回取消结果。"""

        self._result = None
        self._window.destroy()


class RichChoiceDialog:
    """用滚动正文和带说明的按钮列表展示长剧情或经营选项。"""

    def __init__(
        self,
        parent: tk.Misc,
        title: str,
        body: str,
        options: Sequence[Tuple[str, str, str, bool]],
        config: GameConfig,
        allow_cancel: bool = True,
    ) -> None:
        """创建可缩放的富文本模态窗口，并按可用状态绘制选择按钮。"""

        self._result: Optional[str] = None
        self._allow_cancel = allow_cancel
        self._window = tk.Toplevel(parent)
        self._window.title(title)
        self._window.transient(parent)
        self._window.grab_set()
        theme = config.section("theme")
        fonts = config.section("fonts")
        window = config.section("window")
        button_factory = GameButtonFactory(
            config.section("button_styles"),
            fonts,
            config.section("interface")["buttons"],
        )
        self._window.configure(bg=theme["panel"])
        self._window.geometry(
            "{}x{}".format(window["dialog_width"], window["dialog_height"])
        )
        self._window.minsize(
            window["dialog_width"] // 2,
            window["dialog_height"] // 2,
        )
        self._window.grid_columnconfigure(0, weight=1)
        self._window.grid_rowconfigure(0, weight=1)

        container = tk.Frame(self._window, bg=theme["panel"], padx=22, pady=18)
        container.grid(row=0, column=0, sticky="nsew")
        container.grid_columnconfigure(0, weight=1)
        container.grid_rowconfigure(0, weight=2)
        container.grid_rowconfigure(1, weight=3)

        body_frame = tk.Frame(container, bg=theme["panel_alt"])
        body_frame.grid(row=0, column=0, sticky="nsew", pady=(0, 14))
        body_frame.grid_columnconfigure(0, weight=1)
        body_frame.grid_rowconfigure(0, weight=1)
        body_widget = tk.Text(
            body_frame,
            bg=theme["panel_alt"],
            fg=theme["text"],
            relief="flat",
            wrap="word",
            padx=16,
            pady=14,
            font=(fonts["family"], fonts["body_size"]),
        )
        body_scrollbar = tk.Scrollbar(body_frame, command=body_widget.yview)
        body_widget.configure(yscrollcommand=body_scrollbar.set)
        body_widget.grid(row=0, column=0, sticky="nsew")
        body_scrollbar.grid(row=0, column=1, sticky="ns")
        body_widget.insert("1.0", body)
        body_widget.configure(state="disabled")

        option_canvas = tk.Canvas(
            container,
            bg=theme["panel"],
            highlightthickness=0,
        )
        option_scrollbar = tk.Scrollbar(
            container,
            command=option_canvas.yview,
        )
        option_canvas.configure(yscrollcommand=option_scrollbar.set)
        option_canvas.grid(row=1, column=0, sticky="nsew")
        option_scrollbar.grid(row=1, column=1, sticky="ns")
        option_frame = tk.Frame(option_canvas, bg=theme["panel"])
        option_window = option_canvas.create_window(
            (0, 0), anchor="nw", window=option_frame
        )
        option_frame.bind(
            "<Configure>",
            lambda event: option_canvas.configure(
                scrollregion=option_canvas.bbox("all")
            ),
        )
        option_canvas.bind(
            "<Configure>",
            lambda event: option_canvas.itemconfigure(option_window, width=event.width),
        )
        option_frame.grid_columnconfigure(0, weight=1)
        for row, (option_id, label, description, available) in enumerate(options):
            card = tk.Frame(
                option_frame,
                bg=theme["panel_alt"],
                highlightbackground=theme["border"],
                highlightthickness=1,
                padx=10,
                pady=8,
            )
            card.grid(row=row, column=0, sticky="ew", pady=5, padx=(0, 8))
            card.grid_columnconfigure(1, weight=1)
            button = button_factory.create(
                parent=card,
                text=label,
                command=lambda selected=option_id: self._select(selected),
                state="normal" if available else "disabled",
                style="secondary",
                size="dialog",
                show_prompt=available,
            )
            button.grid(row=0, column=0, sticky="w", padx=(0, 12))
            description_label = tk.Label(
                card,
                text=description,
                bg=theme["panel_alt"],
                fg=theme["muted_text"],
                justify="left",
                anchor="w",
                wraplength=window["dialog_wrap_length"] // 2,
                font=(fonts["family"], fonts["small_size"]),
            )
            description_label.grid(row=0, column=1, sticky="ew")

        self._window.protocol("WM_DELETE_WINDOW", self._cancel)
        self._window.bind("<Escape>", lambda event: self._cancel())

    def show(self) -> Optional[str]:
        """等待窗口关闭并返回用户选择的稳定英文 ID。"""

        self._window.wait_window()
        return self._result

    def _select(self, option_id: str) -> None:
        """记录选项并关闭模态窗口。"""

        self._result = option_id
        self._window.destroy()

    def _cancel(self) -> None:
        """按调用方策略允许关闭窗口，或用响铃提示必须作出选择。"""

        if not self._allow_cancel:
            self._window.bell()
            return
        self._result = None
        self._window.destroy()


class GameWindow:
    """负责主菜单、游戏面板与用户交互，不直接修改领域状态。"""

    def __init__(self, root: tk.Tk, application: GameApplication) -> None:
        """绑定根窗口与应用服务，并展示三个选项的主菜单。"""

        self._root = root
        self._application = application
        self._config = application.config
        self._theme = self._config.section("theme")
        self._fonts = self._config.section("fonts")
        self._interface = self._config.section("interface")
        self._button_factory = GameButtonFactory(
            self._config.section("button_styles"),
            self._fonts,
            self._interface["buttons"],
        )
        self._concept_image = None
        self._log_widget: Optional[tk.Text] = None
        self._time_label: Optional[tk.Label] = None
        self._mode_label: Optional[tk.Label] = None
        self._active_player_label: Optional[tk.Label] = None
        self._campaign_label: Optional[tk.Label] = None
        self._story_status_label: Optional[tk.Label] = None
        self._player_values: Dict[str, tk.Label] = {}
        self._shelter_values: Dict[str, tk.Label] = {}
        self._player_meters: Dict[str, StatusMeter] = {}
        self._shelter_meters: Dict[str, StatusMeter] = {}
        self._action_buttons: Dict[str, GameButton] = {}
        self._log_history: List[str] = []
        self._configure_root()
        self.show_main_menu()

    def _configure_root(self) -> None:
        """根据配置设置窗口标题、尺寸、最小尺寸与背景色。"""

        window = self._config.section("window")
        game = self._config.section("game")
        self._root.title(game["title"])
        self._root.geometry("{}x{}".format(window["width"], window["height"]))
        self._root.minsize(window["minimum_width"], window["minimum_height"])
        self._root.configure(bg=self._theme["background"])

    def show_main_menu(self) -> None:
        """清空当前页面并绘制包含三个指定选项的主菜单。"""

        self._clear_root()
        self._log_history = []
        canvas = tk.Canvas(
            self._root,
            bg=self._theme["background"],
            highlightthickness=0,
        )
        canvas.pack(fill="both", expand=True)
        self._root.update_idletasks()
        width = max(self._root.winfo_width(), self._config.section("window")["width"])
        height = max(
            self._root.winfo_height(), self._config.section("window")["height"]
        )
        self._draw_menu_background(canvas, width, height)

        game = self._config.section("game")
        menu = self._config.section("menu")
        canvas.create_text(
            70,
            96,
            anchor="w",
            text=game["title"],
            fill=self._theme["text"],
            font=(self._fonts["family"], self._fonts["title_size"], "bold"),
        )
        canvas.create_text(
            72,
            145,
            anchor="w",
            text=game["subtitle"],
            fill=self._theme["accent"],
            font=(self._fonts["family"], self._fonts["subtitle_size"]),
        )

        panel_width = 360
        panel_x = width - panel_width - 64
        panel_y = 155
        canvas.create_rectangle(
            panel_x,
            panel_y,
            panel_x + panel_width,
            panel_y + 430,
            fill=self._theme["overlay"],
            outline=self._theme["border"],
            width=1,
        )
        canvas.create_text(
            panel_x + 34,
            panel_y + 48,
            anchor="w",
            text=menu["hint"],
            fill=self._theme["muted_text"],
            font=(self._fonts["family"], self._fonts["body_size"]),
        )

        options = (
            ("new_game", menu["new_game"], self._start_single_game),
            ("load_game", menu["load_game"], self._load_game),
            ("multiplayer", menu["multiplayer"], self._start_multiplayer_game),
        )
        for index, (option_id, label, command) in enumerate(options):
            presentation = menu["presentations"][option_id]
            button = self._make_button(
                parent=canvas,
                text=label,
                command=command,
                style="primary" if index == 0 else "secondary",
                size="menu",
                icon=presentation["icon"],
                subtitle=presentation["subtitle"],
            )
            canvas.create_window(
                panel_x + panel_width // 2,
                panel_y + 118 + index * 82,
                window=button,
            )

        story = tk.Message(
            canvas,
            text=game["story"],
            width=560,
            bg=self._theme["overlay"],
            fg=self._theme["muted_text"],
            font=(self._fonts["family"], self._fonts["body_size"]),
            justify="left",
            padx=20,
            pady=16,
        )
        canvas.create_window(70, height - 165, anchor="w", window=story)
        canvas.create_text(
            width - 64,
            height - 32,
            anchor="e",
            text=menu["footer"],
            fill=self._theme["muted_text"],
            font=(self._fonts["family"], self._fonts["small_size"]),
        )

    def _draw_menu_background(self, canvas: tk.Canvas, width: int, height: int) -> None:
        """加载项目概念图，读取失败时绘制不阻塞启动的低资源背景。"""

        image_path = self._config.resolve_path("concept_art")
        try:
            self._concept_image = self._load_image(image_path, width, height)
            canvas.create_image(0, 0, anchor="nw", image=self._concept_image)
            canvas.create_rectangle(
                0,
                0,
                width,
                height,
                fill=self._theme["background"],
                stipple="gray50",
                outline="",
            )
        except (OSError, tk.TclError, ValueError):
            self._concept_image = None
            canvas.create_rectangle(
                0,
                0,
                width,
                height,
                fill=self._theme["background"],
                outline="",
            )
            canvas.create_oval(
                60,
                70,
                380,
                390,
                fill="#5b3028",
                outline="",
            )
            canvas.create_rectangle(
                0,
                height * 0.58,
                width,
                height,
                fill="#11191c",
                outline="",
            )

    @staticmethod
    def _load_image(image_path: Path, width: int, height: int):
        """优先借助 Pillow 等比裁切概念图，否则使用 Tk 原生加载。"""

        if Image is not None and ImageOps is not None and ImageTk is not None:
            with Image.open(str(image_path)) as source:
                resampling = getattr(Image, "Resampling", Image).LANCZOS
                fitted = ImageOps.fit(
                    source.convert("RGB"), (width, height), method=resampling
                )
                return ImageTk.PhotoImage(fitted)
        return tk.PhotoImage(file=str(image_path))

    def _start_single_game(self) -> None:
        """询问所长姓名并创建单人新游戏。"""

        dialogs = self._config.section("dialogs")
        name = simpledialog.askstring(
            dialogs["new_game_title"],
            dialogs["player_name_prompt"],
            initialvalue=dialogs["default_player_name"],
            parent=self._root,
        )
        if name is None:
            return
        try:
            report = self._application.start_new_game([name], "single")
        except GameApplicationError as error:
            self._show_error(str(error))
            return
        self._open_game_screen(report)
        messagebox.showinfo(
            dialogs["info_title"],
            self._config.section("game")["story"],
            parent=self._root,
        )

    def _start_multiplayer_game(self) -> None:
        """收集两名所长姓名并创建本地轮流合作游戏。"""

        dialogs = self._config.section("dialogs")
        raw_names = simpledialog.askstring(
            dialogs["multiplayer_title"],
            dialogs["multiplayer_prompt"],
            initialvalue=dialogs["default_multiplayer_names"],
            parent=self._root,
        )
        if raw_names is None:
            return
        names = [name.strip() for name in re.split("[,，]", raw_names) if name.strip()]
        try:
            report = self._application.start_new_game(names, "multiplayer")
        except GameApplicationError as error:
            self._show_error(str(error))
            return
        self._open_game_screen(report)
        messagebox.showinfo(
            dialogs["info_title"],
            self._config.section("game")["tutorial"],
            parent=self._root,
        )

    def _load_game(self) -> None:
        """读取现有本地存档，并在缺失或损坏时给出明确反馈。"""

        dialogs = self._config.section("dialogs")
        if not self._application.has_save():
            messagebox.showinfo(
                dialogs["load_title"],
                self._config.text("no_save"),
                parent=self._root,
            )
            return
        try:
            report = self._application.load_game()
        except (SaveDataError, GameApplicationError, ConfigError) as error:
            self._show_error(self._config.text("load_error", error=error))
            return
        self._open_game_screen(report)

    def _open_game_screen(self, initial_report: ActionReport) -> None:
        """构建状态面板、行动按钮和日志，并展示初始报告。"""

        self._clear_root()
        self._player_values = {}
        self._shelter_values = {}
        self._player_meters = {}
        self._shelter_meters = {}
        self._action_buttons = {}
        self._log_history = []

        layout = self._interface["layout"]
        container = tk.Frame(self._root, bg=self._theme["background"])
        container.pack(fill="both", expand=True)
        container.grid_columnconfigure(0, weight=0, minsize=layout["stats_width"])
        container.grid_columnconfigure(1, weight=1)
        container.grid_columnconfigure(2, weight=0, minsize=layout["action_width"])
        container.grid_rowconfigure(1, weight=1)

        self._build_header(container)
        self._build_stats_column(container)
        self._build_log_panel(container)
        self._build_action_column(container)
        self._consume_report(initial_report)

    def _build_header(self, parent: tk.Widget) -> None:
        """创建显示游戏标题、日期、模式与当前玩家的顶部栏。"""

        game = self._config.section("game")
        layout = self._interface["layout"]
        dashboard = self._interface["dashboard"]
        header = tk.Frame(
            parent,
            bg=self._theme["panel"],
            padx=layout["header_horizontal_padding"],
            pady=layout["header_vertical_padding"],
        )
        header.grid(row=0, column=0, columnspan=3, sticky="ew")
        header.grid_columnconfigure(1, weight=1)
        title_stack = tk.Frame(header, bg=self._theme["panel"])
        title_stack.grid(row=0, column=0, rowspan=3, sticky="w")
        command_status = tk.Label(
            title_stack,
            text=dashboard["command_status"],
            bg=self._theme["panel"],
            fg=self._theme["primary"],
            font=(self._fonts["family"], self._fonts["small_size"], "bold"),
        )
        command_status.pack(anchor="w")
        title = tk.Label(
            title_stack,
            text=game["title"],
            bg=self._theme["panel"],
            fg=self._theme["text"],
            font=(self._fonts["family"], self._fonts["section_size"], "bold"),
        )
        title.pack(anchor="w", pady=(2, 0))
        self._time_label = tk.Label(
            header,
            bg=self._theme["panel"],
            fg=self._theme["accent"],
            font=(self._fonts["family"], self._fonts["body_size"], "bold"),
        )
        self._time_label.grid(row=0, column=1, sticky="e")
        meta_frame = tk.Frame(header, bg=self._theme["panel"])
        meta_frame.grid(row=1, column=1, sticky="e")
        self._mode_label = tk.Label(
            meta_frame,
            bg=self._theme["panel"],
            fg=self._theme["muted_text"],
            font=(self._fonts["family"], self._fonts["small_size"]),
        )
        self._mode_label.pack(side="left", padx=(0, 16))
        self._active_player_label = tk.Label(
            meta_frame,
            bg=self._theme["panel"],
            fg=self._theme["muted_text"],
            font=(self._fonts["family"], self._fonts["small_size"]),
        )
        self._active_player_label.pack(side="left")
        self._campaign_label = tk.Label(
            header,
            bg=self._theme["panel"],
            fg=self._theme["primary"],
            font=(self._fonts["family"], self._fonts["small_size"], "bold"),
        )
        self._campaign_label.grid(row=2, column=1, sticky="e", pady=(3, 0))

    def _build_stats_column(self, parent: tk.Widget) -> None:
        """创建玩家和避难所两个只读数据卡片。"""

        labels = self._config.section("labels")
        layout = self._interface["layout"]
        column = tk.Frame(
            parent,
            bg=self._theme["background"],
            padx=layout["content_padding"],
            pady=layout["content_padding"],
        )
        column.grid(row=1, column=0, sticky="nsw")
        self._player_values, self._player_meters = self._build_stat_card(
            column,
            labels["player_panel"],
            labels["player_stats"],
            "player",
        )
        self._shelter_values, self._shelter_meters = self._build_stat_card(
            column,
            labels["shelter_panel"],
            labels["shelter_stats"],
            "shelter",
        )

    def _build_stat_card(
        self,
        parent: tk.Widget,
        title: str,
        stats: Sequence[Sequence[str]],
        scope: str,
    ) -> Tuple[Dict[str, tk.Label], Dict[str, StatusMeter]]:
        """创建含资源状态条的状态卡片，并返回两类数值组件索引。"""

        layout = self._interface["layout"]
        dashboard = self._interface["dashboard"]
        card = tk.Frame(
            parent,
            bg=self._theme["panel"],
            highlightbackground=self._theme["border"],
            highlightthickness=1,
            padx=layout["panel_inner_padding"],
            pady=layout["panel_inner_padding"],
        )
        card.pack(fill="x", pady=(0, layout["section_gap"]))
        card.grid_columnconfigure(0, weight=1)
        title_label = tk.Label(
            card,
            text=title,
            bg=self._theme["panel"],
            fg=self._theme["accent"],
            font=(self._fonts["family"], self._fonts["body_size"], "bold"),
        )
        title_label.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 8))
        value_labels: Dict[str, tk.Label] = {}
        meter_widgets: Dict[str, StatusMeter] = {}
        meter_specs = {
            meter["field"]: meter
            for meter in dashboard["meters"]
            if meter["scope"] == scope
        }
        row = 1
        for field_name, display_name in stats:
            if field_name in meter_specs:
                meter_config = meter_specs[field_name]
                meter = StatusMeter(
                    card,
                    label=meter_config["label"],
                    maximum=int(self._config.value(meter_config["maximum_path"])),
                    direction=meter_config["direction"],
                    thresholds=meter_config["thresholds"],
                    palette=dashboard["meter_palette"],
                    fonts=self._fonts,
                    metrics=dashboard,
                )
                meter.grid(
                    row=row,
                    column=0,
                    columnspan=2,
                    sticky="ew",
                    pady=(0, layout["meter_gap"]),
                )
                meter_widgets[field_name] = meter
                row += 1
                continue
            key_label = tk.Label(
                card,
                text=display_name,
                bg=self._theme["panel"],
                fg=self._theme["muted_text"],
                font=(self._fonts["family"], self._fonts["small_size"]),
            )
            key_label.grid(
                row=row,
                column=0,
                sticky="w",
                padx=(0, layout["panel_inner_padding"]),
                pady=layout["stat_row_gap"],
            )
            value_label = tk.Label(
                card,
                text="0",
                bg=self._theme["panel"],
                fg=self._theme["text"],
                font=(self._fonts["family"], self._fonts["small_size"], "bold"),
            )
            value_label.grid(
                row=row,
                column=1,
                sticky="e",
                pady=layout["stat_row_gap"],
            )
            value_labels[field_name] = value_label
            row += 1
        return value_labels, meter_widgets

    def _build_log_panel(self, parent: tk.Widget) -> None:
        """创建可滚动的行动叙事日志区域。"""

        labels = self._config.section("labels")
        layout = self._interface["layout"]
        dashboard = self._interface["dashboard"]
        panel = tk.Frame(
            parent,
            bg=self._theme["background"],
            pady=layout["content_padding"],
        )
        panel.grid(row=1, column=1, sticky="nsew")
        panel.grid_columnconfigure(0, weight=1)
        panel.grid_rowconfigure(2, weight=1)
        title_bar = tk.Frame(panel, bg=self._theme["background"])
        title_bar.grid(row=0, column=0, sticky="ew", pady=(0, layout["section_gap"]))
        title_bar.grid_columnconfigure(1, weight=1)
        title = tk.Label(
            title_bar,
            text=labels["log_panel"],
            bg=self._theme["background"],
            fg=self._theme["text"],
            font=(self._fonts["family"], self._fonts["section_size"], "bold"),
        )
        title.grid(row=0, column=0, sticky="w")
        online = tk.Label(
            title_bar,
            text=dashboard["online_status"],
            bg=self._theme["background"],
            fg=self._theme["health"],
            font=(self._fonts["family"], self._fonts["small_size"], "bold"),
        )
        online.grid(row=0, column=1, sticky="e")
        mission_card = tk.Frame(
            panel,
            bg=self._theme["panel"],
            highlightbackground=self._theme["border"],
            highlightthickness=1,
        )
        mission_card.grid(row=1, column=0, sticky="ew", pady=(0, layout["section_gap"]))
        mission_card.grid_columnconfigure(1, weight=1)
        mission_accent = tk.Frame(
            mission_card,
            bg=self._theme["primary"],
            width=layout["mission_accent_width"],
        )
        mission_accent.grid(row=0, column=0, sticky="ns")
        self._story_status_label = tk.Label(
            mission_card,
            bg=self._theme["panel"],
            fg=self._theme["accent"],
            justify="left",
            anchor="w",
            wraplength=self._config.section("window")["dialog_wrap_length"],
            padx=layout["mission_horizontal_padding"],
            pady=layout["mission_vertical_padding"],
            font=(self._fonts["family"], self._fonts["small_size"]),
        )
        self._story_status_label.grid(row=0, column=1, sticky="ew")
        log_frame = tk.Frame(
            panel,
            bg=self._theme["panel_alt"],
            highlightbackground=self._theme["border"],
            highlightthickness=1,
        )
        log_frame.grid(row=2, column=0, sticky="nsew")
        log_frame.grid_columnconfigure(0, weight=1)
        log_frame.grid_rowconfigure(0, weight=1)
        self._log_widget = tk.Text(
            log_frame,
            bg=self._theme["panel_alt"],
            fg=self._theme["text"],
            insertbackground=self._theme["text"],
            selectbackground=self._theme["secondary"],
            relief="flat",
            padx=layout["log_horizontal_padding"],
            pady=layout["log_vertical_padding"],
            wrap="word",
            state="disabled",
            font=(self._fonts["family"], self._fonts["body_size"]),
        )
        log_scrollbar = tk.Scrollbar(log_frame, command=self._log_widget.yview)
        self._log_widget.configure(yscrollcommand=log_scrollbar.set)
        self._log_widget.grid(row=0, column=0, sticky="nsew")
        log_scrollbar.grid(row=0, column=1, sticky="ns")
        self._log_widget.tag_configure("marker", foreground=self._theme["primary"])
        self._log_widget.tag_configure("entry", spacing3=layout["section_gap"])
        log_hint = tk.Label(
            panel,
            text=dashboard["log_hint"],
            bg=self._theme["background"],
            fg=self._theme["muted_text"],
            font=(self._fonts["family"], self._fonts["small_size"]),
        )
        log_hint.grid(row=3, column=0, sticky="w", pady=(layout["section_gap"], 0))

    def _build_action_column(self, parent: tk.Widget) -> None:
        """根据配置创建游戏行动按钮，并建立行为分发。"""

        labels = self._config.section("labels")
        layout = self._interface["layout"]
        dashboard = self._interface["dashboard"]
        column = tk.Frame(
            parent,
            bg=self._theme["panel"],
            highlightbackground=self._theme["border"],
            highlightthickness=1,
            padx=layout["panel_inner_padding"],
            pady=layout["panel_inner_padding"],
        )
        column.grid(
            row=1,
            column=2,
            sticky="nse",
            padx=layout["content_padding"],
            pady=layout["content_padding"],
        )
        title = tk.Label(
            column,
            text=labels["action_panel"],
            bg=self._theme["panel"],
            fg=self._theme["text"],
            font=(self._fonts["family"], self._fonts["section_size"], "bold"),
        )
        title.pack(anchor="w")
        hint = tk.Label(
            column,
            text=dashboard["action_hint"],
            bg=self._theme["panel"],
            fg=self._theme["muted_text"],
            font=(self._fonts["family"], self._fonts["small_size"]),
        )
        hint.pack(anchor="w", pady=(2, layout["section_gap"]))
        actions = {action["id"]: action for action in self._config.data["actions"]}
        for group_index, group in enumerate(self._interface["action_groups"]):
            group_label = tk.Label(
                column,
                text=group["label"],
                bg=self._theme["panel"],
                fg=self._theme["accent"],
                font=(self._fonts["family"], self._fonts["small_size"], "bold"),
            )
            group_label.pack(
                anchor="w",
                pady=(layout["group_gap"] if group_index else 0, 4),
            )
            group_frame = tk.Frame(column, bg=self._theme["panel"])
            group_frame.pack(fill="x")
            for column_index in range(group["columns"]):
                group_frame.grid_columnconfigure(column_index, weight=1)
            for index, action_id in enumerate(group["action_ids"]):
                action = actions[action_id]
                button = self._make_button(
                    parent=group_frame,
                    text=action["label"],
                    command=lambda selected=action_id: self._handle_action(selected),
                    style=action["style"],
                    size=group["button_size"],
                    icon=action["icon"],
                    subtitle=action["subtitle"],
                    show_prompt=bool(action["subtitle"]),
                )
                button.grid(
                    row=index // group["columns"],
                    column=index % group["columns"],
                    padx=(0, layout["button_gap"]),
                    pady=(0, layout["button_gap"]),
                    sticky="w",
                )
                self._action_buttons[action_id] = button

    def _handle_action(self, action_id: str) -> None:
        """把配置中的行动标识路由到应用用例或界面查询。"""

        try:
            if action_id == "story":
                self._show_story_task()
                return
            if action_id == "explore":
                self._explore()
                return
            if action_id == "shelter_management":
                self._show_shelter_management()
                return
            if action_id == "companions":
                self._show_companions()
                return
            if action_id == "tutorial":
                messagebox.showinfo(
                    self._config.section("dialogs")["info_title"],
                    self._config.section("game")["tutorial"],
                    parent=self._root,
                )
                return
            if action_id == "save":
                report = self._application.save_game()
                self._consume_report(report)
                messagebox.showinfo(
                    self._config.section("dialogs")["save_title"],
                    report.messages[0],
                    parent=self._root,
                )
                return
            if action_id == "return_menu":
                self._confirm_return_to_menu()
                return
            self._consume_report(self._application.perform_action(action_id))
        except (
            GameApplicationError,
            StoryError,
            CombatError,
            ShelterManagementError,
            EventError,
            SaveDataError,
            ConfigError,
        ) as error:
            self._show_error(str(error))

    def _show_story_task(self) -> None:
        """展示当前长篇主线；若战斗进行中则直接进入战斗面板。"""

        state = self._application.state
        if state is not None and state.battle is not None and not state.battle.finished:
            self._run_battle()
            return
        prompt = self._application.current_story_prompt()
        if prompt is None:
            messagebox.showinfo(
                self._config.section("dialogs")["story_title"],
                self._config.text("story_complete"),
                parent=self._root,
            )
            return
        choice_id = self._ask_story_choice(prompt)
        if choice_id is None:
            return
        report = self._application.resolve_story_choice(
            prompt.scene_id,
            choice_id,
        )
        self._consume_report(report)
        state = self._application.state
        if (
            state is not None
            and state.battle is not None
            and not state.battle.finished
            and not state.ended
        ):
            self._run_battle()

    def _ask_story_choice(self, prompt: StoryPrompt) -> Optional[str]:
        """用滚动剧情窗口展示正文、目标、可选路线和锁定原因。"""

        body = "{}\n\n【{}】\n{}\n\n当前目标：{}".format(
            prompt.chapter_title,
            prompt.title,
            prompt.body,
            prompt.objective,
        )
        options = [
            (
                choice.choice_id,
                choice.label,
                "可执行"
                if choice.available
                else "锁定：{}".format(choice.locked_reason),
                choice.available,
            )
            for choice in prompt.choices
        ]
        return RichChoiceDialog(
            self._root,
            self._config.section("dialogs")["story_choice_title"],
            body,
            options,
            self._config,
        ).show()

    def _run_battle(self) -> None:
        """循环展示可中断、可保存、可读档恢复的 Boss 战斗面板。"""

        dialogs = self._config.section("dialogs")
        while True:
            state = self._application.state
            if (
                state is None
                or state.ended
                or state.battle is None
                or state.battle.finished
            ):
                return
            battle = state.battle
            actions = self._application.combat_actions()
            options = [
                (
                    action.action_id,
                    action.label,
                    (
                        action.description
                        if action.available
                        else action.unavailable_reason
                    ),
                    action.available,
                )
                for action in actions
            ]
            options.append(
                (
                    "save_battle",
                    "保存战斗进度",
                    "当前首领生命、回合、玩家与战术状态都会写入存档。",
                    True,
                )
            )
            body = (
                "【{}】\n\n回合：{}\n首领生命：{}/{}\n行动所长：{}\n"
                "所长生命：{}\n\n关闭窗口可以暂停战斗，之后点击“剧情任务”继续。"
            ).format(
                battle.boss_name,
                battle.round_number,
                battle.health,
                battle.max_health,
                state.active_player.name,
                state.active_player.health,
            )
            action_id = RichChoiceDialog(
                self._root,
                dialogs["battle_title"],
                body,
                options,
                self._config,
            ).show()
            if action_id is None:
                return
            if action_id == "save_battle":
                save_report = self._application.save_game()
                self._consume_report(save_report)
                continue
            self._consume_report(self._application.perform_combat_action(action_id))

    def _show_shelter_management(self) -> None:
        """分两步展示经营类别和对应的设施、工作、交易或招募计划。"""

        dialogs = self._config.section("dialogs")
        category_id = ChoiceDialog(
            self._root,
            dialogs["shelter_management_title"],
            "想处理哪一类避难所事务？",
            (
                ("facility", "设施升级"),
                ("job", "安排工作"),
                ("trade", "幸存者交易"),
                ("recruit", "人员招募"),
            ),
            self._config,
            columns=2,
        ).show()
        if category_id is None:
            return
        options = self._application.management_options()
        selected_options = [
            option
            for option in options
            if option.category == category_id
            or (category_id == "trade" and option.category.startswith("trade_"))
        ]
        rich_options = [
            (
                "{}|{}".format(option.category, option.option_id),
                option.label,
                option.description
                if option.available
                else "锁定：{}".format(option.description),
                option.available,
            )
            for option in selected_options
        ]
        selected = RichChoiceDialog(
            self._root,
            dialogs["shelter_management_title"],
            self._application.shelter_overview(),
            rich_options,
            self._config,
        ).show()
        if selected is None:
            return
        category, option_id = selected.split("|", 1)
        self._consume_report(self._application.perform_management(category, option_id))

    def _show_companions(self) -> None:
        """在滚动档案窗口展示伙伴状态、信任和逐步解锁的秘密。"""

        RichChoiceDialog(
            self._root,
            self._config.section("dialogs")["companion_title"],
            self._application.companion_summary(),
            (("close", "关闭档案", "返回避难所行动面板。", True),),
            self._config,
        ).show()

    def _explore(self) -> None:
        """依次完成城市选择、事件展示、分支选择与行动结算。"""

        dialogs = self._config.section("dialogs")
        city_options = [(city["id"], city["name"]) for city in self._config.cities()]
        city_id = ChoiceDialog(
            self._root,
            dialogs["city_title"],
            dialogs["city_prompt"],
            city_options,
            self._config,
            columns=2,
        ).show()
        if city_id is None:
            return
        prompt = self._application.prepare_exploration(city_id)
        choice_id = self._ask_event_choice(prompt)
        if prompt.choices and choice_id is None:
            self._append_log(prompt.title)
            self._append_log(prompt.intro)
            self._consume_report(self._application.cancel_exploration())
            return
        report = self._application.resolve_exploration(prompt.event_id, choice_id)
        self._append_log(prompt.title)
        self._append_log(prompt.intro)
        self._consume_report(report)

    def _ask_event_choice(self, prompt: EventPrompt) -> Optional[str]:
        """展示探索事件介绍，并在需要时返回玩家选择。"""

        if not prompt.choices:
            messagebox.showinfo(prompt.title, prompt.intro, parent=self._root)
            return None
        options = [(choice.choice_id, choice.label) for choice in prompt.choices]
        return ChoiceDialog(
            self._root,
            self._config.section("dialogs")["event_choice_title"],
            "{}\n\n{}".format(prompt.title, prompt.intro),
            options,
            self._config,
            columns=1,
        ).show()

    def _consume_report(self, report: ActionReport) -> None:
        """把应用报告写入日志、刷新面板，并处理游戏结束。"""

        for message in report.messages:
            self._append_log(message)
        self._refresh_dashboard()
        if report.game_over:
            state = self._application.state
            if state is not None:
                if state.victory:
                    RichChoiceDialog(
                        self._root,
                        self._config.section("dialogs")["info_title"],
                        state.ending_message,
                        (("close", "回望余烬", "结局已写入当前游戏状态。", True),),
                        self._config,
                    ).show()
                else:
                    messagebox.showerror(
                        self._config.section("dialogs")["info_title"],
                        state.ending_message,
                        parent=self._root,
                    )

    def _append_log(self, message: str) -> None:
        """向只读日志追加一条带回合标记的中文消息。"""

        self._log_history.append(message)
        if self._log_widget is None:
            return
        self._log_widget.configure(state="normal")
        self._log_widget.insert("end", "◆ ", "marker")
        self._log_widget.insert("end", "{}\n".format(message), "entry")
        self._log_widget.configure(state="disabled")
        self._log_widget.see("end")

    def _refresh_dashboard(self) -> None:
        """从当前领域状态重新渲染日期、模式和全部数值。"""

        state = self._application.state
        if state is None:
            return
        clock = state.clock
        if self._time_label is not None:
            self._time_label.configure(
                text=self._config.text(
                    "dashboard_time",
                    year=clock.year,
                    month=clock.month,
                    day=clock.day,
                    hour=clock.hour,
                )
            )
        if self._mode_label is not None:
            mode_label = self._config.section("mode_labels")[state.mode]
            self._mode_label.configure(
                text=self._config.text("dashboard_mode", mode=mode_label)
            )
        if self._active_player_label is not None:
            self._active_player_label.configure(
                text=self._config.text(
                    "dashboard_active_player",
                    player_name=state.active_player.name,
                )
            )
        if self._campaign_label is not None:
            self._campaign_label.configure(
                text=self._interface["dashboard"]["campaign_status_format"].format(
                    turn=state.turn_number,
                    evidence=state.story.evidence,
                    humanity=state.story.humanity,
                    infection_pressure=state.story.infection_pressure,
                )
            )
        for field_name, value_label in self._player_values.items():
            value_label.configure(text=str(getattr(state.active_player, field_name)))
        for field_name, value_label in self._shelter_values.items():
            value_label.configure(text=str(getattr(state.shelter, field_name)))
        for field_name, meter in self._player_meters.items():
            meter.update_value(getattr(state.active_player, field_name))
        for field_name, meter in self._shelter_meters.items():
            meter.update_value(getattr(state.shelter, field_name))
        if self._story_status_label is not None:
            story_status = self._application.story_status()
            self._story_status_label.configure(
                text="{}｜{}\n{}\n{}".format(
                    story_status.chapter_title,
                    story_status.mission_title,
                    story_status.objective,
                    story_status.progress_text,
                )
            )
        self._refresh_action_availability(state)

    def _set_play_actions_enabled(self, enabled: bool) -> None:
        """游戏结束时禁用生存行动，同时保留保存与返回按钮。"""

        excluded_actions = {"save", "return_menu", "tutorial"}
        for action_id, button in self._action_buttons.items():
            if action_id not in excluded_actions:
                button.configure(state="normal" if enabled else "disabled")

    def _refresh_action_availability(self, state) -> None:
        """按终局、战斗和待探索状态刷新主面板各行动按钮。"""

        always_available = {"save", "return_menu", "tutorial", "companions"}
        battle_available = always_available | {"story"}
        pending_available = always_available | {"explore"}
        if state.ended:
            available_actions = always_available
        elif state.battle is not None and not state.battle.finished:
            available_actions = battle_available
        elif state.pending_exploration is not None:
            available_actions = pending_available
        else:
            available_actions = set(self._action_buttons)
        for action_id, button in self._action_buttons.items():
            button.configure(
                state="normal" if action_id in available_actions else "disabled"
            )

    def _confirm_return_to_menu(self) -> None:
        """二次确认后返回三个选项的主菜单。"""

        dialogs = self._config.section("dialogs")
        confirmed = messagebox.askyesno(
            dialogs["confirm_return_title"],
            dialogs["confirm_return_message"],
            parent=self._root,
        )
        if confirmed:
            self.show_main_menu()

    def _make_button(
        self,
        parent: tk.Misc,
        text: str,
        command: Callable[[], None],
        style: str,
        size: str,
        icon: str = "",
        subtitle: str = "",
        show_prompt: bool = True,
    ) -> GameButton:
        """通过统一工厂创建跨平台配色一致的自绘游戏按钮。"""

        return self._button_factory.create(
            parent=parent,
            text=text,
            command=command,
            style=style,
            size=size,
            icon=icon,
            subtitle=subtitle,
            show_prompt=show_prompt,
        )

    def _show_error(self, message: str) -> None:
        """使用配置标题展示可恢复错误。"""

        messagebox.showerror(
            self._config.section("dialogs")["error_title"],
            message,
            parent=self._root,
        )

    def _clear_root(self) -> None:
        """销毁根窗口内现有页面组件，准备界面切换。"""

        for child in self._root.winfo_children():
            child.destroy()
