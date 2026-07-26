"""在显式启用时验证真实 Tk 封面、页面导航和自绘组件。"""

import os
import unittest


class TkInterfaceSmokeTests(unittest.TestCase):
    """把需要可用桌面会话的 Tk 验证与无头单元测试分开。"""

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_cover_menu_uses_staggered_parallelogram_buttons(self) -> None:
        """封面只保留双行标题，三个按钮以平行四边形向右下错位。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.widgets import GameButton

        root = tk.Tk()
        root.withdraw()
        try:
            window = GameWindow(root, build_application())
            root.update_idletasks()
            menu_buttons = list(window._menu_buttons.values())
            self.assertEqual(
                ["新的游戏", "游玩存档", "多人游戏"],
                [button.cget("text") for button in menu_buttons],
            )
            self.assertTrue(
                all(button.cget("shape") == "parallelogram" for button in menu_buttons)
            )
            positions = list(window._menu_button_positions.values())
            self.assertEqual(positions, sorted(positions))
            self.assertTrue(
                all(
                    later[0] > earlier[0] and later[1] > earlier[1]
                    for earlier, later in zip(positions, positions[1:])
                )
            )
            cover_canvas = self._cover_canvas(root, GameButton)
            self.assertEqual(
                {"避难所", "余烬纪元"},
                set(self._canvas_texts(cover_canvas)),
            )
            self.assertEqual([], self._widgets_of_type(root, tk.Toplevel))
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_cover_resizes_to_fill_larger_window(self) -> None:
        """封面放大后应同步重建背景图，并继续覆盖整个 Canvas。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.widgets import GameButton

        initial_width = 1280
        initial_height = 760
        target_width = 1600
        target_height = 1000
        root = tk.Tk()
        root.geometry("{}x{}+0+0".format(initial_width, initial_height))
        try:
            application = build_application()
            window = GameWindow(root, application)
            root.update()
            cover_canvas = self._cover_canvas(root, GameButton)
            renderer = window._cover_renderer
            self.assertIsNotNone(renderer)

            root.geometry("{}x{}+0+0".format(target_width, target_height))
            root.update()
            resize_completed = tk.BooleanVar(master=root, value=False)
            root.after(
                application.config.value("interface.cover.resize_debounce_ms") + 20,
                resize_completed.set,
                True,
            )
            root.wait_variable(resize_completed)
            root.update()

            self.assertEqual(target_width, cover_canvas.winfo_width())
            self.assertEqual(target_height, cover_canvas.winfo_height())
            self.assertEqual((target_width, target_height), renderer.render_size)
            self.assertEqual((target_width, target_height), renderer.image_size)
            self.assertIsNone(renderer.last_error)
            image_items = [
                item_id
                for item_id in cover_canvas.find_all()
                if cover_canvas.type(item_id) == "image"
            ]
            self.assertEqual(1, len(image_items))
            self.assertEqual(
                (0, 0, target_width, target_height),
                cover_canvas.bbox(image_items[0]),
            )
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_cover_failure_shows_configured_diagnostic_fallback(self) -> None:
        """封面文件无法读取时应记录异常，并显示配置化降级提示。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.cover_renderer import CoverRenderer

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        config = application.config
        cover_config = config.value("interface.cover")
        canvas = tk.Canvas(root, bg=cover_config["fallback_background"])
        missing_image_path = config.project_root / "assets" / "missing-cover.png"
        try:
            renderer = CoverRenderer(
                canvas=canvas,
                image_path=missing_image_path,
                cover_config=cover_config,
                font_family=config.value("fonts.family"),
                fallback_message=config.text("concept_fallback"),
            )
            with self.assertLogs(
                "apocalypse_game.cover_renderer",
                level="ERROR",
            ):
                renderer.render(
                    config.value("window.width"),
                    config.value("window.height"),
                )

            self.assertIsNotNone(renderer.last_error)
            self.assertIsNone(renderer.image_size)
            self.assertIn(config.text("concept_fallback"), self._canvas_texts(canvas))
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_cover_resizes_without_optional_pillow_dependency(self) -> None:
        """缺少 Pillow 时仍应通过 Tk 原生路径生成目标尺寸封面。"""

        import tkinter as tk
        from unittest.mock import patch

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.cover_renderer import CoverRenderer

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        config = application.config
        cover_config = config.value("interface.cover")
        canvas = tk.Canvas(root, bg=cover_config["fallback_background"])
        target_width = config.value("window.width") + 1
        target_height = config.value("window.height") + 1
        try:
            renderer = CoverRenderer(
                canvas=canvas,
                image_path=config.resolve_path("cover_art"),
                cover_config=cover_config,
                font_family=config.value("fonts.family"),
                fallback_message=config.text("concept_fallback"),
            )
            with patch("apocalypse_game.cover_renderer.Image", None), patch(
                "apocalypse_game.cover_renderer.ImageOps",
                None,
            ), patch("apocalypse_game.cover_renderer.ImageTk", None):
                renderer.render(target_width, target_height)

            self.assertEqual((target_width, target_height), renderer.render_size)
            self.assertEqual((target_width, target_height), renderer.image_size)
            self.assertIsNone(renderer.last_error)
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_menu_and_message_page_use_configured_backgrounds(self) -> None:
        """主菜单与消息页应使用配置主题，而不是系统默认灰底。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.ui_pages import MessagePage
        from apocalypse_game.widgets import GameButton

        root = tk.Tk()
        root.geometry("1280x760+0+0")
        default_frame = tk.Frame(root)
        application = build_application()
        interface = application.config.section("interface")
        cover_config = interface["cover"]
        page_config = interface["pages"]
        try:
            window = GameWindow(root, application)
            root.update()
            menu_page = window.page_stack.current_frame
            cover_canvas = self._cover_canvas(root, GameButton)

            self.assertEqual(cover_config["fallback_background"], menu_page.cget("bg"))
            self.assertEqual(
                cover_config["fallback_background"],
                cover_canvas.cget("bg"),
            )
            self.assertNotEqual(default_frame.cget("bg"), menu_page.cget("bg"))

            window._show_message("背景回归测试", "这是一段不会溢出的短正文。")
            root.update()
            message_page = window.page_stack.current_frame

            self.assertIsInstance(message_page, MessagePage)
            self.assertEqual(page_config["background"], message_page.cget("bg"))
            self.assertEqual(page_config["panel"], message_page._shell.cget("bg"))
            self.assertEqual(
                page_config["body_background"],
                message_page._content_frame.cget("bg"),
            )
            self.assertEqual(
                page_config["body_background"],
                message_page.body_text.cget("bg"),
            )
            self.assertNotEqual(default_frame.cget("bg"), message_page.cget("bg"))
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_short_message_hides_native_scrollbar(self) -> None:
        """消息页短正文未溢出时应隐藏原生纵向滚动条。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.ui_pages import MessagePage

        root = tk.Tk()
        root.geometry("1280x760+0+0")
        try:
            window = GameWindow(root, build_application())
            window._show_message("短正文", "避难所今夜很安静。")
            root.update()
            root.update_idletasks()
            message_page = window.page_stack.current_frame

            self.assertIsInstance(message_page, MessagePage)
            scrollbars = self._widgets_of_type(message_page, tk.Scrollbar)
            self.assertEqual(1, len(scrollbars))
            first_fraction, last_fraction = message_page.body_text.yview()
            self.assertAlmostEqual(0.0, first_fraction)
            self.assertAlmostEqual(1.0, last_fraction)
            self.assertFalse(scrollbars[0].winfo_ismapped())
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_input_story_and_dashboard_stay_inside_main_window(self) -> None:
        """输入错误保留在原页，成功后剧情与指挥台均不产生二级窗口。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.ui_pages import InputPage, SelectionPage

        root = tk.Tk()
        root.withdraw()
        try:
            window = GameWindow(root, build_application())
            window._menu_buttons["new_game"].invoke()
            root.update_idletasks()
            self.assertEqual("single_player_input", window.page_stack.current_page_id)
            input_page = self._widgets_of_type(root, InputPage)[0]
            input_page.set_value("")
            input_page.submit_button.invoke()
            root.update_idletasks()
            self.assertEqual("single_player_input", window.page_stack.current_page_id)
            self.assertEqual("", input_page.value)
            self.assertTrue(input_page.error_message)

            input_page.set_value("界面冒烟")
            input_page.submit_button.invoke()
            root.update_idletasks()
            self.assertEqual("message", window.page_stack.current_page_id)
            window.page_stack.request_back()
            self.assertEqual("dashboard", window.page_stack.current_page_id)

            window._handle_action("story")
            root.update_idletasks()
            self.assertEqual("story_choice", window.page_stack.current_page_id)
            story_page = self._widgets_of_type(root, SelectionPage)[0]
            self.assertGreaterEqual(len(story_page.option_buttons), 2)
            self.assertEqual([], self._widgets_of_type(root, tk.Toplevel))
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_selection_page_and_button_states_use_custom_rendering(self) -> None:
        """选择按钮仅显示主标签，并用自绘状态区分可用与锁定路线。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui_pages import PageOption, SelectionPage
        from apocalypse_game.widgets import GameButtonFactory

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        config = application.config
        try:
            factory = GameButtonFactory(
                config.section("button_styles"),
                config.section("fonts"),
                config.section("interface")["buttons"],
            )
            page = SelectionPage(
                parent=root,
                button_factory=factory,
                theme=config.section("theme"),
                fonts=config.section("fonts"),
                title="命运岔路",
                body="可用和锁定路线需要有明确不同的视觉状态。",
                options=(
                    PageOption(
                        "available",
                        "修复生命维持系统，对抗自动防御协议",
                        description="这段行动情报应以正文字号展示。",
                        enabled=True,
                    ),
                    PageOption(
                        "locked",
                        "修复配电，同时启动档案库和应急舱",
                        description="锁定原因应在正文情报区完整可见。",
                        enabled=False,
                    ),
                ),
                on_submit=lambda _option_id: None,
                page_config=config.section("interface")["pages"],
            )
            page.place(x=0, y=0, relwidth=1, relheight=1)
            root.update_idletasks()
            buttons = list(page.option_buttons.values())
            self.assertEqual(
                ["normal", "disabled"],
                [button.cget("state") for button in buttons],
            )
            self.assertEqual(
                ["", ""],
                [button.cget("subtitle") for button in buttons],
            )
            body = page.body_text.get("1.0", "end-1c")
            self.assertIn("这段行动情报应以正文字号展示。", body)
            self.assertIn("锁定原因应在正文情报区完整可见。", body)
            for button in buttons:
                text_bounds = button.bbox(button._text_item)
                prompt_bounds = button.bbox(button._prompt_item)
                self.assertIsNotNone(text_bounds)
                self.assertIsNotNone(prompt_bounds)
                self.assertLess(text_bounds[2] + 4, prompt_bounds[0])
            default_background = buttons[0].cget("background")
            buttons[0].event_generate("<Enter>")
            root.update_idletasks()
            self.assertNotEqual(default_background, buttons[0].cget("background"))
            self.assertEqual([], self._widgets_of_type(root, tk.Toplevel))
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_default_page_layout_wraps_prompt_and_validation_notice(self) -> None:
        """无页面配置时返回按钮仍可见，长提示与错误应按像素宽度换行。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui_pages import InputPage
        from apocalypse_game.widgets import GameButtonFactory

        root = tk.Tk()
        root.geometry("1280x760+0+0")
        application = build_application()
        config = application.config
        factory = GameButtonFactory(
            config.section("button_styles"),
            config.section("fonts"),
            config.section("interface")["buttons"],
        )
        long_error = "这是一段需要在页面内完整换行的输入校验错误。" * 16
        try:
            page = InputPage(
                root,
                factory,
                config.section("theme"),
                config.section("fonts"),
                "默认布局验证",
                "请输入避难所名称，这段长提示不应被压成每行只有三个字。" * 4,
                lambda _value: None,
                on_back=lambda: None,
                initial_value="保留的草稿",
                validator=lambda _value: long_error,
            )
            page.place(x=0, y=0, relwidth=1, relheight=1)
            root.update()

            back_button = page._back_button
            self.assertIsNotNone(back_button)
            self.assertGreaterEqual(back_button.winfo_x(), 0)
            self.assertGreaterEqual(back_button.winfo_y(), 0)
            self.assertLessEqual(
                back_button.winfo_x() + back_button.winfo_width(),
                page._header_frame.winfo_width(),
            )
            self.assertLessEqual(
                back_button.winfo_y() + back_button.winfo_height(),
                page._header_frame.winfo_height(),
            )
            self.assertEqual(
                page._body_wrap_length(),
                int(page.prompt_label.cget("wraplength")),
            )
            self.assertGreater(
                int(page.prompt_label.cget("wraplength")),
                page._settings.positive_integer("input_width"),
            )

            single_line_height = page._notice_label.winfo_reqheight()
            page.submit_button.invoke()
            root.update()
            self.assertEqual("保留的草稿", page.value)
            self.assertEqual(long_error, page.error_message)
            self.assertEqual(
                page._body_wrap_length(),
                int(page._notice_label.cget("wraplength")),
            )
            self.assertGreater(page._notice_label.winfo_reqheight(), single_line_height)
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_selection_page_scrolls_twelve_options(self) -> None:
        """十二个选项应保留正文空间，并能滚动到最后一行。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui_pages import PageOption, SelectionPage
        from apocalypse_game.widgets import GameButtonFactory

        root = tk.Tk()
        root.geometry("1280x760+0+0")
        application = build_application()
        config = application.config
        page_config = config.section("interface")["pages"]
        factory = GameButtonFactory(
            config.section("button_styles"),
            config.section("fonts"),
            config.section("interface")["buttons"],
        )
        try:
            page = SelectionPage(
                root,
                factory,
                config.section("theme"),
                config.section("fonts"),
                "十二条路线",
                "即使选项很多，这段正文也必须保持可读。",
                tuple(
                    PageOption("route_{}".format(index), "路线 {}".format(index))
                    for index in range(12)
                ),
                lambda _option_id: None,
                page_config=page_config,
            )
            page.place(x=0, y=0, relwidth=1, relheight=1)
            root.update()

            option_gap = page_config["option_gap"]
            button_height = max(
                button.winfo_reqheight() for button in page.option_buttons.values()
            )
            expected_height = page_config["option_max_visible_rows"] * (
                button_height + option_gap * 2
            )
            self.assertEqual(expected_height, int(page._option_canvas.cget("height")))
            self.assertGreater(page.body_text.winfo_height(), 1)
            bounds = page._option_canvas.bbox("all")
            self.assertIsNotNone(bounds)
            self.assertGreater(bounds[3], page._option_canvas.winfo_height())
            self.assertTrue(page._option_scrollbar.winfo_ismapped())

            page._option_canvas.yview_moveto(1.0)
            root.update()
            self.assertGreater(page._option_canvas.yview()[0], 0.0)
            last_button = page.option_buttons["route_11"]
            self.assertGreaterEqual(
                last_button.winfo_rooty(),
                page._option_canvas.winfo_rooty(),
            )
            self.assertLessEqual(
                last_button.winfo_rooty() + last_button.winfo_height(),
                page._option_canvas.winfo_rooty() + page._option_canvas.winfo_height(),
            )
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_page_back_handler_matches_button_and_escape(self) -> None:
        """页面返回按钮与 Escape 必须转发到同一个回调。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui_navigation import PageStack
        from apocalypse_game.ui_pages import MessagePage
        from apocalypse_game.widgets import GameButtonFactory

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        config = application.config
        factory = GameButtonFactory(
            config.section("button_styles"),
            config.section("fonts"),
            config.section("interface")["buttons"],
        )
        calls = []
        try:
            stack = PageStack(root)
            stack.reset("root", tk.Frame(root))
            page = MessagePage(
                root,
                factory,
                config.section("theme"),
                config.section("fonts"),
                "统一返回",
                "按钮和 Escape 都应执行页面回调。",
                on_back=lambda: calls.append("back"),
                page_config=config.section("interface")["pages"],
            )
            stack.push("message", page, back_handler=page.back_handler)

            page._back_button.invoke()
            stack._on_escape(None)

            self.assertEqual(["back", "back"], calls)
            self.assertEqual("message", stack.current_page_id)
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_exploration_replace_and_management_back_semantics(self) -> None:
        """探索事件不可返回重抽，经营项目返回时应回到类别页。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.ui_pages import SelectionPage

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        try:
            window = GameWindow(root, application)
            report = application.start_new_game(["导航冒烟"], "single")
            window._open_game_screen(report)
            turn_before = application.state.turn_number

            window._explore()
            root.update_idletasks()
            city_page = self._widgets_of_type(root, SelectionPage)[0]
            self.assertEqual(2, window.page_stack.depth)
            city_page.option_buttons["city_a"].invoke()
            root.update_idletasks()
            self.assertEqual("exploration_event", window.page_stack.current_page_id)
            self.assertEqual(2, window.page_stack.depth)
            self.assertIsNotNone(application.state.pending_exploration)

            window.page_stack.request_back()
            self.assertEqual("dashboard", window.page_stack.current_page_id)
            self.assertIsNone(application.state.pending_exploration)
            self.assertEqual(turn_before + 1, application.state.turn_number)

            window._show_shelter_management()
            root.update_idletasks()
            category_page = self._widgets_of_type(root, SelectionPage)[0]
            category_page.option_buttons["facility"].invoke()
            root.update_idletasks()
            self.assertEqual("management_options", window.page_stack.current_page_id)
            self.assertEqual(3, window.page_stack.depth)
            window.page_stack.request_back()
            self.assertEqual(
                "management_categories",
                window.page_stack.current_page_id,
            )
            self.assertEqual([], self._widgets_of_type(root, tk.Toplevel))
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_failed_exploration_choice_stays_on_event_page(self) -> None:
        """资源不足时应在原事件页提示，不清空事件或推进回合。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.domain import PendingExplorationState
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.ui_pages import SelectionPage

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        try:
            window = GameWindow(root, application)
            report = application.start_new_game(["事件冒烟"], "single")
            window._open_game_screen(report)
            application.state.active_player.food = 0
            application.state.pending_exploration = PendingExplorationState(
                city_id="city_a",
                event_id="elder",
            )
            turn_before = application.state.turn_number

            window._explore()
            root.update_idletasks()
            event_page = self._widgets_of_type(root, SelectionPage)[0]
            event_page.option_buttons["help"].invoke()
            root.update_idletasks()

            self.assertEqual("exploration_event", window.page_stack.current_page_id)
            self.assertTrue(event_page.error_message)
            self.assertEqual(turn_before, application.state.turn_number)
            self.assertEqual(
                "elder",
                application.state.pending_exploration.event_id,
            )
            self.assertEqual([], self._widgets_of_type(root, tk.Toplevel))
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_dashboard_fits_configured_minimum_window(self) -> None:
        """指挥台在配置声明的最小窗口中不得裁切任何控件。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow

        root = tk.Tk()
        application = build_application()
        try:
            window = GameWindow(root, application)
            report = application.start_new_game(["布局冒烟"], "single")
            window._open_game_screen(report)
            window_config = application.config.section("window")
            root.geometry(
                "{}x{}+0+0".format(
                    window_config["minimum_width"],
                    window_config["minimum_height"],
                )
            )
            root.update()

            outside_widgets = self._mapped_widgets_outside(root)
            self.assertEqual([], outside_widgets)
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_destroyed_pages_cancel_pending_idle_callbacks(self) -> None:
        """快速替换或重置页面时必须取消尚未执行的 Tk 空闲回调。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui_navigation import PageStack
        from apocalypse_game.ui_pages import InputPage, PageOption, SelectionPage
        from apocalypse_game.widgets import GameButtonFactory

        root = tk.Tk()
        root.withdraw()
        background_errors = []
        root.tk.createcommand("bgerror", background_errors.append)
        application = build_application()
        config = application.config
        factory = GameButtonFactory(
            config.section("button_styles"),
            config.section("fonts"),
            config.section("interface")["buttons"],
        )
        stack = PageStack(root)
        try:
            stack.reset("root", tk.Frame(root))
            selection_page = SelectionPage(
                root,
                factory,
                config.section("theme"),
                config.section("fonts"),
                "快速销毁",
                "尚未进入空闲阶段。",
                (PageOption("continue", "继续"),),
                lambda _option_id: None,
                page_config=config.section("interface")["pages"],
            )
            stack.push("selection", selection_page)
            stack.reset("replacement", tk.Frame(root))

            input_page = InputPage(
                root,
                factory,
                config.section("theme"),
                config.section("fonts"),
                "快速输入",
                "输入任意文本。",
                lambda _value: None,
                page_config=config.section("interface")["pages"],
            )
            stack.push("input", input_page)
            stack.replace("final", tk.Frame(root))
            root.update()

            self.assertEqual([], background_errors)
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_returning_to_menu_clears_destroyed_dashboard_references(self) -> None:
        """返回封面后不得继续持有已销毁的仪表盘组件。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        try:
            window = GameWindow(root, application)
            report = application.start_new_game(["引用冒烟"], "single")
            window._open_game_screen(report)
            old_log_widget = window._log_widget

            window.show_main_menu()
            root.update()

            self.assertEqual(0, old_log_widget.winfo_exists())
            self.assertIsNone(window._log_widget)
            self.assertIsNone(window._time_label)
            self.assertEqual({}, window._player_values)
            self.assertEqual({}, window._action_buttons)
            window._append_log("迟到消息")
            window._refresh_dashboard()
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_leaving_battle_clears_page_reference(self) -> None:
        """战斗页刷新后用 Escape 返回仍应清理已销毁的页面引用。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        try:
            window = GameWindow(root, application)
            opening = application.start_new_game(["战斗引用冒烟"], "single")
            window._open_game_screen(opening)
            route = (
                ("last_pot_of_porridge", "share_rations"),
                ("money_and_secrets", "decrypt_ledger"),
                ("doctor_in_the_rain", "medical_rescue"),
                ("rail_butcher", "call_his_name"),
            )
            for scene_id, choice_id in route:
                application.resolve_story_choice(scene_id, choice_id)
            self.assertIsNotNone(application.state.battle)

            window._run_battle()
            root.update_idletasks()
            first_battle_page = window._battle_page
            self.assertEqual("battle", window.page_stack.current_page_id)
            first_battle_page.option_buttons["guard"].invoke()
            root.update_idletasks()
            battle_page = window._battle_page
            self.assertIsNot(first_battle_page, battle_page)
            self.assertEqual(0, first_battle_page.winfo_exists())

            window.page_stack.request_back()

            self.assertEqual("dashboard", window.page_stack.current_page_id)
            self.assertIsNone(window._battle_page)
            self.assertEqual(0, battle_page.winfo_exists())
        finally:
            root.destroy()

    def _canvas_texts(self, canvas):
        """返回一个 Canvas 顶层直接绘制的可见非空文本。"""

        return [
            canvas.itemcget(item_id, "text")
            for item_id in canvas.find_all()
            if canvas.type(item_id) == "text"
            and canvas.itemcget(item_id, "text")
            and canvas.itemcget(item_id, "state") != "hidden"
        ]

    def _cover_canvas(self, root, game_button_type):
        """返回主菜单封面 Canvas，排除继承 Canvas 的自绘按钮。"""

        import tkinter as tk

        canvases = [
            canvas
            for canvas in self._widgets_of_type(root, tk.Canvas)
            if not isinstance(canvas, game_button_type)
        ]
        self.assertEqual(1, len(canvases))
        return canvases[0]

    def _widgets_of_type(self, widget, widget_type):
        """递归收集单一类型的 Tk 组件。"""

        result = []
        for child in widget.winfo_children():
            if isinstance(child, widget_type):
                result.append(child)
            result.extend(self._widgets_of_type(child, widget_type))
        return result

    def _mapped_widgets_outside(self, root):
        """返回超出根窗口客户区的所有可见组件边界。"""

        root_x = root.winfo_rootx()
        root_y = root.winfo_rooty()
        root_width = root.winfo_width()
        root_height = root.winfo_height()
        outside = []
        for widget in self._all_widgets(root):
            if not widget.winfo_ismapped():
                continue
            x_position = widget.winfo_rootx() - root_x
            y_position = widget.winfo_rooty() - root_y
            width = widget.winfo_width()
            height = widget.winfo_height()
            if (
                x_position < -1
                or y_position < -1
                or x_position + width > root_width + 1
                or y_position + height > root_height + 1
            ):
                outside.append(
                    (
                        widget.winfo_class(),
                        x_position,
                        y_position,
                        width,
                        height,
                    )
                )
        return outside

    def _all_widgets(self, widget):
        """递归返回根组件之下的全部后代组件。"""

        result = []
        for child in widget.winfo_children():
            result.append(child)
            result.extend(self._all_widgets(child))
        return result


if __name__ == "__main__":
    unittest.main()
