"""基于 Tkinter 的中文桌面游戏界面。"""

from __future__ import annotations

import re
import tkinter as tk
from functools import partial
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from apocalypse_game.application import GameApplication, GameApplicationError
from apocalypse_game.combat import CombatError
from apocalypse_game.config import ConfigError
from apocalypse_game.cover_renderer import CoverRenderer
from apocalypse_game.domain import ActionReport, EventPrompt, StoryPrompt
from apocalypse_game.events import EventError
from apocalypse_game.ports import SaveDataError
from apocalypse_game.shelter import ShelterManagementError
from apocalypse_game.story import StoryError
from apocalypse_game.ui_navigation import PageStack
from apocalypse_game.ui_pages import (
    BasePage,
    BattlePage,
    ConfirmPage,
    EndingPage,
    InputPage,
    MessagePage,
    PageOption,
    SelectionPage,
)
from apocalypse_game.widgets import GameButton, GameButtonFactory, StatusMeter


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
        self._page_stack = PageStack(root)
        self._cover_renderer: Optional[CoverRenderer] = None
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
        self._battle_page: Optional[BattlePage] = None
        self._log_history: List[str] = []
        self._configure_root()
        self.show_main_menu()

    @property
    def page_stack(self) -> PageStack:
        """返回主窗口页面栈，供集成测试和外层宿主读取导航状态。"""

        return self._page_stack

    def _clear_dashboard_widget_references(self) -> None:
        """清理仪表盘和战斗页的 Tk 引用，避免访问已销毁组件。"""

        self._log_widget = None
        self._time_label = None
        self._mode_label = None
        self._active_player_label = None
        self._campaign_label = None
        self._story_status_label = None
        self._player_values = {}
        self._shelter_values = {}
        self._player_meters = {}
        self._shelter_meters = {}
        self._action_buttons = {}
        self._battle_page = None

    def _configure_root(self) -> None:
        """根据配置设置窗口标题、尺寸、最小尺寸与背景色。"""

        window = self._config.section("window")
        game = self._config.section("game")
        self._root.title(game["title"])
        self._root.geometry("{}x{}".format(window["width"], window["height"]))
        self._root.minsize(window["minimum_width"], window["minimum_height"])
        self._root.configure(bg=self._theme["background"])

    def show_main_menu(self) -> None:
        """展示全屏封面以及左侧向右下错位的三个主菜单入口。"""

        self._clear_dashboard_widget_references()
        self._log_history = []
        cover = self._interface["cover"]
        window = self._config.section("window")
        page = tk.Frame(self._root, bg=cover["fallback_background"])
        canvas = tk.Canvas(
            page,
            width=window["width"],
            height=window["height"],
            bg=cover["fallback_background"],
            highlightthickness=0,
        )
        canvas.pack(fill="both", expand=True)
        renderer = CoverRenderer(
            canvas=canvas,
            image_path=self._config.resolve_path("cover_art"),
            cover_config=cover,
            font_family=self._fonts["family"],
            fallback_message=self._config.text("concept_fallback"),
        )
        renderer.render(window["width"], window["height"])
        self._cover_renderer = renderer
        page.bind(
            "<Destroy>",
            partial(self._on_menu_page_destroyed, renderer),
            add="+",
        )

        menu = self._config.section("menu")
        canvas.create_text(
            cover["title_x"],
            cover["title_y"],
            anchor=cover["title_anchor"],
            text=cover["title"],
            fill=cover["title_color"],
            font=(self._fonts["family"], cover["title_size"], "bold"),
        )
        canvas.create_text(
            cover["subtitle_x"],
            cover["subtitle_y"],
            anchor=cover["subtitle_anchor"],
            text=cover["subtitle"],
            fill=cover["subtitle_color"],
            font=(self._fonts["family"], cover["subtitle_size"], "bold"),
        )

        options = (
            ("new_game", menu["new_game"], self._start_single_game),
            ("load_game", menu["load_game"], self._load_game),
            ("multiplayer", menu["multiplayer"], self._start_multiplayer_game),
        )
        self._menu_buttons: Dict[str, GameButton] = {}
        self._menu_button_positions: Dict[str, tuple[int, int]] = {}
        for index, (option_id, label, command) in enumerate(options):
            button = self._make_button(
                parent=canvas,
                text=label,
                command=command,
                style="primary" if index == 0 else "secondary",
                size="menu",
                show_prompt=False,
                shape=cover["menu_button_shape"],
            )
            button_x = cover["menu_start_x"] + index * cover["menu_step_x"]
            button_y = cover["menu_start_y"] + index * cover["menu_step_y"]
            canvas.create_window(
                button_x,
                button_y,
                anchor=cover["menu_anchor"],
                window=button,
            )
            self._menu_buttons[option_id] = button
            self._menu_button_positions[option_id] = (button_x, button_y)
        self._page_stack.reset("menu", page)

    def _on_menu_page_destroyed(
        self,
        renderer: CoverRenderer,
        _event: tk.Event,
    ) -> None:
        """封面页销毁时取消其重绘任务，并释放窗口级渲染器引用。"""

        renderer.dispose()
        if self._cover_renderer is renderer:
            self._cover_renderer = None

    def _start_single_game(self) -> None:
        """在主窗口输入页收集姓名，并创建单人新游戏。"""

        dialogs = self._config.section("dialogs")
        page: InputPage

        def submit_player_name(name: str) -> None:
            """提交单人姓名；领域校验失败时保留输入内容。"""

            try:
                report = self._application.start_new_game([name], "single")
            except GameApplicationError as error:
                page.show_error(str(error))
                return
            self._open_game_screen(report)
            self._show_message(
                dialogs["info_title"],
                self._config.section("game")["story"],
            )

        page = InputPage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=dialogs["new_game_title"],
            prompt=dialogs["player_name_prompt"],
            initial_value=dialogs["default_player_name"],
            on_submit=submit_player_name,
            on_back=self._page_stack.pop,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "single_player_input",
            page,
            back_handler=page.back_handler,
        )

    def _start_multiplayer_game(self) -> None:
        """在主窗口输入页收集两名所长姓名并创建合作游戏。"""

        dialogs = self._config.section("dialogs")
        page: InputPage

        def submit_player_names(raw_names: str) -> None:
            """拆分双人姓名，并把校验问题显示在当前输入页。"""

            names = [
                name.strip() for name in re.split("[,，]", raw_names) if name.strip()
            ]
            try:
                report = self._application.start_new_game(names, "multiplayer")
            except GameApplicationError as error:
                page.show_error(str(error))
                return
            self._open_game_screen(report)
            self._show_message(
                dialogs["info_title"],
                self._config.section("game")["tutorial"],
            )

        page = InputPage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=dialogs["multiplayer_title"],
            prompt=dialogs["multiplayer_prompt"],
            initial_value=dialogs["default_multiplayer_names"],
            on_submit=submit_player_names,
            on_back=self._page_stack.pop,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "multiplayer_input",
            page,
            back_handler=page.back_handler,
        )

    def _load_game(self) -> None:
        """读取本地存档，并在主窗口消息页反馈缺失或损坏。"""

        dialogs = self._config.section("dialogs")
        if not self._application.has_save():
            self._show_message(
                dialogs["load_title"],
                self._config.text("no_save"),
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

        self._clear_dashboard_widget_references()
        self._log_history = []

        layout = self._interface["layout"]
        container = tk.Frame(self._root, bg=self._theme["background"])
        container.grid_columnconfigure(0, weight=0, minsize=layout["stats_width"])
        container.grid_columnconfigure(1, weight=1)
        container.grid_columnconfigure(2, weight=0, minsize=layout["action_width"])
        container.grid_rowconfigure(1, weight=1)

        self._build_header(container)
        self._build_stats_column(container)
        self._build_log_panel(container)
        self._build_action_column(container)
        self._page_stack.reset("dashboard", container)
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
                    show_prompt=False,
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
                self._show_message(
                    self._config.section("dialogs")["info_title"],
                    self._config.section("game")["tutorial"],
                )
                return
            if action_id == "save":
                report = self._application.save_game()
                self._consume_report(report)
                self._show_message(
                    self._config.section("dialogs")["save_title"],
                    "\n".join(report.messages),
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
        """打开当前主线页面；进行中的首领战会优先恢复战斗页。"""

        state = self._application.state
        if state is not None and state.battle is not None and not state.battle.finished:
            self._run_battle()
            return
        prompt = self._application.current_story_prompt()
        if prompt is None:
            self._show_message(
                self._config.section("dialogs")["story_title"],
                self._config.text("story_complete"),
            )
            return
        self._ask_story_choice(prompt)

    def _ask_story_choice(self, prompt: StoryPrompt) -> None:
        """在独立剧情页展示正文、目标、路线和锁定原因。"""

        body = self._config.text(
            "story_page_body",
            chapter_title=prompt.chapter_title,
            title=prompt.title,
            body=prompt.body,
            objective=prompt.objective,
        )
        options = [
            PageOption(
                option_id=choice.choice_id,
                label=choice.label,
                description=(
                    ""
                    if choice.available
                    else self._config.text(
                        "page_choice_locked",
                        reason=choice.locked_reason,
                    )
                ),
                enabled=choice.available,
                style="primary" if choice.available else "secondary",
            )
            for choice in prompt.choices
        ]
        page = SelectionPage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=self._config.section("dialogs")["story_choice_title"],
            body=body,
            options=options,
            on_submit=lambda choice_id: self._resolve_story_choice(
                prompt,
                choice_id,
            ),
            on_back=self._page_stack.pop,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "story_choice",
            page,
            back_handler=page.back_handler,
        )

    def _resolve_story_choice(self, prompt: StoryPrompt, choice_id: str) -> None:
        """结算一条剧情路线，并转入战斗、结局或指挥台。"""

        try:
            report = self._application.resolve_story_choice(
                prompt.scene_id,
                choice_id,
            )
        except (GameApplicationError, StoryError, CombatError, ConfigError) as error:
            self._show_error(str(error))
            return
        self._consume_report(report)
        state = self._application.state
        if state is None or state.ended:
            return
        if state.battle is not None and not state.battle.finished:
            self._run_battle()
            return
        self._page_stack.pop_to("dashboard")

    def _run_battle(self) -> None:
        """展示非阻塞战斗页，每次按钮点击只结算一个战斗回合。"""

        state = self._application.state
        if (
            state is None
            or state.ended
            or state.battle is None
            or state.battle.finished
        ):
            self._battle_page = None
            self._page_stack.pop_to("dashboard")
            return
        battle = state.battle
        actions = [
            PageOption(
                option_id=action.action_id,
                label=action.label,
                description=(
                    action.description
                    if action.available
                    else action.unavailable_reason
                ),
                enabled=action.available,
                style="primary" if action.available else "secondary",
            )
            for action in self._application.combat_actions()
        ]
        actions.append(
            PageOption(
                option_id="save_battle",
                label=self._config.text("battle_save_label"),
                description=self._config.text("battle_save_description"),
                style="secondary",
            )
        )
        body = self._config.text(
            "battle_page_body",
            boss_name=battle.boss_name,
            round_number=battle.round_number,
            boss_health=battle.health,
            boss_max_health=battle.max_health,
            player_name=state.active_player.name,
            player_health=state.active_player.health,
        )
        page = BattlePage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=self._config.section("dialogs")["battle_title"],
            body=body,
            actions=actions,
            on_submit=self._handle_battle_action,
            on_back=self._leave_battle_page,
            page_config=self._interface["pages"],
        )
        self._battle_page = page
        if self._page_stack.current_page_id == "battle":
            self._page_stack.replace(
                "battle",
                page,
                back_handler=page.back_handler,
            )
            return
        self._page_stack.pop_to("dashboard")
        self._page_stack.push(
            "battle",
            page,
            back_handler=page.back_handler,
        )

    def _leave_battle_page(self) -> None:
        """退出当前战斗视图并清理页面引用，领域战斗仍可稍后恢复。"""

        self._battle_page = None
        self._page_stack.pop()

    def _handle_battle_action(self, action_id: str) -> None:
        """执行保存或单个战斗行动，并刷新当前战况页面。"""

        try:
            if action_id == "save_battle":
                report = self._application.save_game()
                self._consume_report(report)
                if (
                    self._battle_page is not None
                    and self._battle_page.winfo_exists()
                    and self._page_stack.current_frame is self._battle_page
                ):
                    self._battle_page.show_notice("\n".join(report.messages))
                return
            report = self._application.perform_combat_action(action_id)
        except (GameApplicationError, StoryError, CombatError, SaveDataError) as error:
            self._show_error(str(error))
            return
        self._consume_report(report)
        state = self._application.state
        if state is None or state.ended:
            self._battle_page = None
            return
        if state.battle is not None and not state.battle.finished:
            self._run_battle()
            return
        self._battle_page = None
        self._page_stack.pop_to("dashboard")

    def _show_shelter_management(self) -> None:
        """打开经营类别页，项目页返回时仍保留类别选择页。"""

        categories = self._interface["pages"]["management_categories"]
        options = [
            PageOption(option_id=category["id"], label=category["label"])
            for category in categories
        ]
        page = SelectionPage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=self._config.section("dialogs")["shelter_management_title"],
            body=self._config.text("management_category_prompt"),
            options=options,
            on_submit=self._show_management_options,
            on_back=self._page_stack.pop,
            columns=2,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "management_categories",
            page,
            back_handler=page.back_handler,
        )

    def _show_management_options(self, category_id: str) -> None:
        """按经营类别打开对应设施、工作、交易或招募项目页。"""

        options = self._application.management_options()
        selected_options = [
            option
            for option in options
            if option.category == category_id
            or (category_id == "trade" and option.category.startswith("trade_"))
        ]
        page_options = [
            PageOption(
                option_id="{}|{}".format(option.category, option.option_id),
                label=option.label,
                description=(
                    option.description
                    if option.available
                    else self._config.text(
                        "page_choice_locked",
                        reason=option.description,
                    )
                ),
                enabled=option.available,
                style="primary" if option.available else "secondary",
            )
            for option in selected_options
        ]
        page = SelectionPage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=self._config.section("dialogs")["shelter_management_title"],
            body=self._application.shelter_overview(),
            options=page_options,
            on_submit=self._perform_management_choice,
            on_back=self._page_stack.pop,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "management_options",
            page,
            back_handler=page.back_handler,
        )

    def _perform_management_choice(self, selected: str) -> None:
        """执行选中的经营项目，并在结算后回到指挥台。"""

        try:
            category, option_id = selected.split("|", 1)
            report = self._application.perform_management(category, option_id)
        except (
            ValueError,
            GameApplicationError,
            ShelterManagementError,
            ConfigError,
        ) as error:
            self._show_error(str(error))
            return
        self._consume_report(report)
        state = self._application.state
        if state is not None and not state.ended:
            self._page_stack.pop_to("dashboard")

    def _show_companions(self) -> None:
        """在主窗口独立档案页展示伙伴状态、信任和秘密。"""

        self._show_message(
            self._config.section("dialogs")["companion_title"],
            self._application.companion_summary(),
        )

    def _explore(self) -> None:
        """打开城市选择页，或直接恢复存档中的待结算探索事件。"""

        dialogs = self._config.section("dialogs")
        state = self._application.state
        if state is not None and state.pending_exploration is not None:
            prompt = self._application.prepare_exploration(
                state.pending_exploration.city_id
            )
            self._ask_event_choice(prompt, replace_current=False)
            return
        city_options = [
            PageOption(option_id=city["id"], label=city["name"])
            for city in self._config.cities()
        ]
        page = SelectionPage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=dialogs["city_title"],
            body=dialogs["city_prompt"],
            options=city_options,
            on_submit=self._prepare_exploration,
            on_back=self._page_stack.pop,
            columns=2,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "exploration_city",
            page,
            back_handler=page.back_handler,
        )

    def _prepare_exploration(self, city_id: str) -> None:
        """抽取并锁定城市事件，再以替换方式进入事件页面。"""

        try:
            prompt = self._application.prepare_exploration(city_id)
        except (GameApplicationError, EventError, ConfigError) as error:
            self._show_error(str(error))
            return
        self._ask_event_choice(prompt, replace_current=True)

    def _ask_event_choice(
        self,
        prompt: EventPrompt,
        replace_current: bool,
    ) -> None:
        """在事件页展示介绍；有分支时选择，无分支时确认继续。"""

        body = self._config.text(
            "event_page_body",
            title=prompt.title,
            intro=prompt.intro,
        )

        def cancel() -> None:
            """从事件页返回时执行一次有代价的谨慎撤离。"""

            self._cancel_exploration(prompt)

        if prompt.choices:
            page = SelectionPage(
                parent=self._root,
                button_factory=self._button_factory,
                theme=self._theme,
                fonts=self._fonts,
                title=self._config.section("dialogs")["event_choice_title"],
                body=body,
                options=[
                    PageOption(
                        option_id=choice.choice_id,
                        label=choice.label,
                    )
                    for choice in prompt.choices
                ],
                on_submit=lambda choice_id: self._resolve_exploration(
                    prompt,
                    choice_id,
                ),
                on_back=cancel,
                columns=1,
                page_config=self._interface["pages"],
            )
        else:
            page = MessagePage(
                parent=self._root,
                button_factory=self._button_factory,
                theme=self._theme,
                fonts=self._fonts,
                title=prompt.title,
                body=body,
                on_submit=lambda: self._resolve_exploration(prompt, None),
                on_back=cancel,
                page_config=self._interface["pages"],
            )
        if replace_current:
            self._page_stack.replace(
                "exploration_event",
                page,
                back_handler=page.back_handler,
            )
            return
        self._page_stack.push(
            "exploration_event",
            page,
            back_handler=page.back_handler,
        )

    def _resolve_exploration(
        self,
        prompt: EventPrompt,
        choice_id: Optional[str],
    ) -> None:
        """结算已锁定探索事件，并在完成后回到指挥台。"""

        try:
            report = self._application.resolve_exploration(
                prompt.event_id,
                choice_id,
            )
        except (GameApplicationError, EventError, ConfigError) as error:
            self._show_error(str(error))
            return
        if not report.state_changed:
            current_page = self._page_stack.current_frame
            message = "\n".join(report.messages)
            if isinstance(current_page, BasePage):
                current_page.show_error(message)
            else:
                self._show_error(message)
            return
        self._append_log(prompt.title)
        self._append_log(prompt.intro)
        self._consume_report(report)
        state = self._application.state
        if state is not None and not state.ended:
            self._page_stack.pop_to("dashboard")

    def _cancel_exploration(self, prompt: EventPrompt) -> None:
        """撤离已抽取事件，清理待结算状态并只消耗一次行动。"""

        try:
            report = self._application.cancel_exploration()
        except (GameApplicationError, EventError, ConfigError) as error:
            self._show_error(str(error))
            return
        self._append_log(prompt.title)
        self._append_log(prompt.intro)
        self._consume_report(report)
        state = self._application.state
        if state is not None and not state.ended:
            self._page_stack.pop_to("dashboard")

    def _consume_report(self, report: ActionReport) -> None:
        """把报告写入日志、刷新面板，并统一切换到结局页面。"""

        for message in report.messages:
            self._append_log(message)
        self._refresh_dashboard()
        if report.game_over:
            self._battle_page = None
            state = self._application.state
            if state is not None:
                title_key = (
                    "victory_page_title" if state.victory else "failure_page_title"
                )
                page = EndingPage(
                    parent=self._root,
                    button_factory=self._button_factory,
                    theme=self._theme,
                    fonts=self._fonts,
                    ending_title=self._config.text(title_key),
                    body=state.ending_message,
                    on_submit=self._close_ending,
                    submit_label=self._interface["pages"]["close_label"],
                    page_config=self._interface["pages"],
                )
                if self._page_stack.current_page_id == "ending":
                    self._page_stack.replace(
                        "ending",
                        page,
                        back_handler=self._close_ending,
                    )
                else:
                    self._page_stack.push(
                        "ending",
                        page,
                        back_handler=self._close_ending,
                    )

    def _close_ending(self) -> None:
        """从结局页返回已禁用生存行动的指挥台。"""

        self._battle_page = None
        self._page_stack.pop_to("dashboard")

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
        """在主窗口确认页二次确认是否放弃未保存进度。"""

        dialogs = self._config.section("dialogs")
        page = ConfirmPage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=dialogs["confirm_return_title"],
            body=dialogs["confirm_return_message"],
            on_submit=self.show_main_menu,
            on_back=self._page_stack.pop,
            danger=True,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "return_menu_confirm",
            page,
            back_handler=page.back_handler,
        )

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
        shape: str = "rectangle",
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
            shape=shape,
        )

    def _show_message(self, title: str, body: str) -> None:
        """把普通信息、教程或档案作为主窗口内子页面展示。"""

        page = MessagePage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=title,
            body=body,
            on_back=self._page_stack.pop,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "message",
            page,
            back_handler=page.back_handler,
        )

    def _show_error(self, message: str) -> None:
        """把可恢复错误作为主窗口内消息页叠加到来源页面。"""

        page = MessagePage(
            parent=self._root,
            button_factory=self._button_factory,
            theme=self._theme,
            fonts=self._fonts,
            title=self._config.section("dialogs")["error_title"],
            body=message,
            on_back=self._page_stack.pop,
            page_config=self._interface["pages"],
        )
        self._page_stack.push(
            "error",
            page,
            back_handler=page.back_handler,
        )
