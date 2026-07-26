"""管理 Tk 主窗口内页面的压栈、替换、返回与根页面切换。"""

from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from typing import Callable, List, Optional


BackHandler = Callable[[], None]


@dataclass
class PageEntry:
    """记录页面标识、根组件和自定义返回行为。"""

    page_id: str
    frame: tk.Frame
    back_handler: Optional[BackHandler] = None


class PageStack:
    """在一个 Tk 根窗口内维护非模态页面栈。"""

    def __init__(self, root: tk.Tk) -> None:
        """绑定根窗口，并统一接管 Escape 返回键。"""

        self._root = root
        self._entries: List[PageEntry] = []
        self._root.bind("<Escape>", self._on_escape, add="+")

    @property
    def current_page_id(self) -> Optional[str]:
        """返回当前顶部页面标识；空栈时返回 ``None``。"""

        return self._entries[-1].page_id if self._entries else None

    @property
    def current_frame(self) -> Optional[tk.Frame]:
        """返回当前顶部页面组件；空栈时返回 ``None``。"""

        return self._entries[-1].frame if self._entries else None

    @property
    def depth(self) -> int:
        """返回当前页面栈深度。"""

        return len(self._entries)

    @property
    def can_go_back(self) -> bool:
        """判断当前页面是否允许执行栈级返回。"""

        if not self._entries:
            return False
        return len(self._entries) > 1 or self._entries[-1].back_handler is not None

    def reset(
        self,
        page_id: str,
        frame: tk.Frame,
        back_handler: Optional[BackHandler] = None,
    ) -> None:
        """销毁全部旧页面，并把指定页面设置为新的根页面。"""

        for entry in self._entries:
            entry.frame.destroy()
        self._entries = [PageEntry(page_id, frame, back_handler)]
        self._show_top()

    def push(
        self,
        page_id: str,
        frame: tk.Frame,
        back_handler: Optional[BackHandler] = None,
    ) -> None:
        """隐藏当前页并把新页面压到栈顶。"""

        if self._entries:
            self._entries[-1].frame.place_forget()
        self._entries.append(PageEntry(page_id, frame, back_handler))
        self._show_top()

    def replace(
        self,
        page_id: str,
        frame: tk.Frame,
        back_handler: Optional[BackHandler] = None,
    ) -> None:
        """销毁当前页并在相同栈位置显示新页面。"""

        if not self._entries:
            self.reset(page_id, frame, back_handler)
            return
        current = self._entries.pop()
        current.frame.destroy()
        self._entries.append(PageEntry(page_id, frame, back_handler))
        self._show_top()

    def pop(self) -> bool:
        """销毁顶部子页面并恢复上一页，根页面不会被移除。"""

        if len(self._entries) <= 1:
            return False
        current = self._entries.pop()
        current.frame.destroy()
        self._show_top()
        return True

    def pop_to(self, page_id: str) -> bool:
        """连续返回直到指定页面成为顶部页面。"""

        target_index = next(
            (
                index
                for index in range(len(self._entries) - 1, -1, -1)
                if self._entries[index].page_id == page_id
            ),
            None,
        )
        if target_index is None:
            return False
        while len(self._entries) - 1 > target_index:
            current = self._entries.pop()
            current.frame.destroy()
        self._show_top()
        return True

    def request_back(self) -> bool:
        """执行当前页自定义返回行为，或使用默认出栈行为。"""

        if not self._entries:
            return False
        handler = self._entries[-1].back_handler
        if handler is not None:
            handler()
            return True
        return self.pop()

    def _show_top(self) -> None:
        """铺满并聚焦当前顶部页面。"""

        if not self._entries:
            return
        frame = self._entries[-1].frame
        frame.place(x=0, y=0, relwidth=1, relheight=1)
        frame.lift()
        frame.focus_set()

    def _on_escape(self, _event: tk.Event) -> str:
        """把 Escape 键路由到当前页面的返回策略。"""

        if not self.request_back():
            self._root.bell()
        return "break"
