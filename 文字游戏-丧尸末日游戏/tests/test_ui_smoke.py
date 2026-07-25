"""在显式启用时验证真实 Tk 主菜单和游戏面板控件。"""

import os
import unittest


class TkInterfaceSmokeTests(unittest.TestCase):
    """把需要可用桌面会话的 Tk 验证与无头单元测试分开。"""

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_menu_and_game_buttons_render(self) -> None:
        """创建真实窗口并确认三个主菜单按钮及游戏行动按钮可渲染。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import GameWindow
        from apocalypse_game.widgets import GameButton

        root = tk.Tk()
        root.withdraw()
        try:
            application = build_application()
            window = GameWindow(root, application)
            root.update_idletasks()
            menu_buttons = self._button_texts(root, (tk.Button, GameButton))
            self.assertEqual(["新的游戏", "游玩存档", "多人游戏"], menu_buttons)
            self.assertEqual([], self._widgets_of_type(root, tk.Button))
            report = application.start_new_game(["界面冒烟"], "single")
            window._open_game_screen(report)
            root.update_idletasks()
            action_buttons = self._widgets_of_type(root, GameButton)
            self.assertIn(
                "探索城市",
                [button.cget("text") for button in action_buttons],
            )
            self.assertTrue(
                all(
                    button.cget("foreground") != button.cget("background")
                    for button in action_buttons
                )
            )
        finally:
            root.destroy()

    @unittest.skipUnless(os.environ.get("RUN_GUI_TESTS") == "1", "未启用真实 GUI 冒烟")
    def test_choice_dialogs_and_button_states_use_custom_rendering(self) -> None:
        """剧情弹窗及按钮悬停、禁用状态都应使用自绘调色板。"""

        import tkinter as tk

        from apocalypse_game.bootstrap import build_application
        from apocalypse_game.ui import ChoiceDialog, RichChoiceDialog
        from apocalypse_game.widgets import GameButton

        root = tk.Tk()
        root.withdraw()
        application = build_application()
        config = application.config
        try:
            choice_dialog = ChoiceDialog(
                root,
                "选择测试",
                "所有选项都必须清晰可见。",
                (("continue", "继续前进"),),
                config,
            )
            root.update_idletasks()
            choice_buttons = self._widgets_of_type(
                choice_dialog._window,
                GameButton,
            )
            self.assertEqual(
                ["继续前进"], [button.cget("text") for button in choice_buttons]
            )
            choice_dialog._cancel()

            rich_dialog = RichChoiceDialog(
                root,
                "命运岔路",
                "可用和锁定路线需要有明确不同的视觉状态。",
                (
                    ("available", "进入", "继续当前路线", True),
                    ("locked", "锁定", "尚未满足条件", False),
                ),
                config,
            )
            root.update_idletasks()
            rich_buttons = self._widgets_of_type(rich_dialog._window, GameButton)
            self.assertEqual(
                ["normal", "disabled"],
                [button.cget("state") for button in rich_buttons],
            )
            primary_button = rich_buttons[0]
            default_background = primary_button.cget("background")
            primary_button.event_generate("<Enter>")
            root.update_idletasks()
            self.assertNotEqual(default_background, primary_button.cget("background"))
            rich_dialog._cancel()
        finally:
            root.destroy()

    def _button_texts(self, widget, button_types):
        """递归收集指定 Tk 组件树中的按钮文字。"""

        return [
            button.cget("text")
            for button in self._widgets_of_types(widget, button_types)
        ]

    def _widgets_of_type(self, widget, widget_type):
        """递归收集单一类型的 Tk 组件。"""

        return self._widgets_of_types(widget, (widget_type,))

    def _widgets_of_types(self, widget, widget_types):
        """递归收集任一目标类型的 Tk 组件。"""

        result = []
        for child in widget.winfo_children():
            if isinstance(child, widget_types):
                result.append(child)
            result.extend(self._widgets_of_types(child, widget_types))
        return result


if __name__ == "__main__":
    unittest.main()
