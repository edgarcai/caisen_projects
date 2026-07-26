"""验证主窗口页面栈的压栈、替换、返回与重置语义。"""

import unittest

from apocalypse_game.ui_navigation import PageStack


class FakeRoot:
    """提供 PageStack 所需的最小根窗口协议。"""

    def __init__(self) -> None:
        """初始化按键绑定和响铃计数。"""

        self.bindings = {}
        self.bell_count = 0

    def bind(self, sequence, callback, add=None) -> None:
        """记录页面栈注册的按键回调。"""

        self.bindings[sequence] = (callback, add)

    def bell(self) -> None:
        """记录无法返回时的提示。"""

        self.bell_count += 1


class FakeFrame:
    """记录页面组件收到的显示、隐藏、聚焦和销毁命令。"""

    def __init__(self, name: str) -> None:
        """保存调试名称并清空所有调用状态。"""

        self.name = name
        self.placed = False
        self.destroyed = False
        self.focused = False
        self.hidden_count = 0

    def place(self, **_kwargs) -> None:
        """记录页面已经铺满宿主。"""

        self.placed = True

    def place_forget(self) -> None:
        """记录页面被新页面暂时遮蔽。"""

        self.placed = False
        self.hidden_count += 1

    def lift(self) -> None:
        """模拟把当前页提升到组件树顶部。"""

    def focus_set(self) -> None:
        """记录当前页恢复了键盘焦点。"""

        self.focused = True

    def destroy(self) -> None:
        """记录页面已永久销毁。"""

        self.destroyed = True


class PageStackTests(unittest.TestCase):
    """确保非模态页面导航不会泄漏页面或破坏返回语义。"""

    def setUp(self) -> None:
        """为每个用例创建独立的假根窗口和页面栈。"""

        self.root = FakeRoot()
        self.stack = PageStack(self.root)

    def test_push_and_pop_restore_previous_page(self) -> None:
        """压入子页应隐藏根页，返回应销毁子页并恢复根页。"""

        root_page = FakeFrame("root")
        child_page = FakeFrame("child")
        self.stack.reset("root", root_page)
        self.stack.push("child", child_page)

        self.assertEqual("child", self.stack.current_page_id)
        self.assertEqual(2, self.stack.depth)
        self.assertEqual(1, root_page.hidden_count)
        self.assertTrue(self.stack.pop())
        self.assertTrue(child_page.destroyed)
        self.assertTrue(root_page.placed)
        self.assertEqual("root", self.stack.current_page_id)

    def test_replace_and_pop_to_destroy_discarded_pages(self) -> None:
        """替换和定点返回应销毁所有不再可达的页面。"""

        root_page = FakeFrame("root")
        first_page = FakeFrame("first")
        replaced_page = FakeFrame("replaced")
        final_page = FakeFrame("final")
        self.stack.reset("root", root_page)
        self.stack.push("first", first_page)
        self.stack.replace("replaced", replaced_page)
        self.stack.push("final", final_page)

        self.assertTrue(first_page.destroyed)
        self.assertTrue(self.stack.pop_to("root"))
        self.assertTrue(replaced_page.destroyed)
        self.assertTrue(final_page.destroyed)
        self.assertEqual(1, self.stack.depth)

    def test_custom_back_handler_takes_priority(self) -> None:
        """探索撤离等自定义返回行为应优先于默认出栈。"""

        calls = []
        self.stack.reset("root", FakeFrame("root"))
        self.stack.push(
            "event",
            FakeFrame("event"),
            back_handler=lambda: calls.append("cancelled"),
        )

        self.assertTrue(self.stack.request_back())
        self.assertEqual(["cancelled"], calls)
        self.assertEqual("event", self.stack.current_page_id)

    def test_root_page_cannot_be_popped(self) -> None:
        """没有自定义行为的根页面不能被默认返回移除。"""

        self.stack.reset("root", FakeFrame("root"))

        self.assertFalse(self.stack.pop())
        self.assertFalse(self.stack.request_back())
        self.assertEqual("root", self.stack.current_page_id)

    def test_reset_destroys_previous_stack(self) -> None:
        """切换主菜单或仪表盘根页时应销毁整条旧页面链。"""

        root_page = FakeFrame("root")
        child_page = FakeFrame("child")
        replacement = FakeFrame("replacement")
        self.stack.reset("root", root_page)
        self.stack.push("child", child_page)
        self.stack.reset("replacement", replacement)

        self.assertTrue(root_page.destroyed)
        self.assertTrue(child_page.destroyed)
        self.assertEqual("replacement", self.stack.current_page_id)
        self.assertEqual(1, self.stack.depth)


if __name__ == "__main__":
    unittest.main()
