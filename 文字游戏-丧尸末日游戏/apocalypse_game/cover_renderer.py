"""为 Tk 主菜单提供可响应窗口尺寸变化的封面图渲染。"""

from __future__ import annotations

import logging
import tkinter as tk
from pathlib import Path
from typing import Mapping, Optional, Tuple

try:
    from PIL import Image, ImageOps, ImageTk
except ImportError:  # pragma: no cover - 仅在未安装可选图像依赖时触发
    Image = None
    ImageOps = None
    ImageTk = None


LOGGER = logging.getLogger(__name__)


class CoverRenderer:
    """按 Canvas 实际尺寸绘制封面，并管理缩放防抖与图片引用。"""

    def __init__(
        self,
        canvas: tk.Canvas,
        image_path: Path,
        cover_config: Mapping[str, object],
        font_family: str,
        fallback_message: str,
    ) -> None:
        """保存渲染依赖，创建稳定图层并监听 Canvas 尺寸变化。"""

        self._canvas = canvas
        self._image_path = image_path
        self._config = cover_config
        self._font_family = font_family
        self._fallback_message = fallback_message
        self._photo_image = None
        self._source_image = None
        self._resize_callback_id: Optional[str] = None
        self._render_size: Optional[Tuple[int, int]] = None
        self._last_error: Optional[BaseException] = None
        self._disposed = False
        self._image_item = canvas.create_image(
            int(cover_config["art_x"]),
            int(cover_config["art_y"]),
            anchor=str(cover_config["art_anchor"]),
            state=tk.HIDDEN,
        )
        self._fallback_item: Optional[int] = None
        self._canvas.tag_lower(self._image_item)
        self._canvas.bind("<Configure>", self._on_canvas_configure, add="+")

    @property
    def render_size(self) -> Optional[Tuple[int, int]]:
        """返回最近一次成功或降级渲染所使用的画布尺寸。"""

        return self._render_size

    @property
    def image_size(self) -> Optional[Tuple[int, int]]:
        """返回当前 Tk 封面图尺寸；降级纯色界面没有图片尺寸。"""

        if self._photo_image is None:
            return None
        return self._photo_image.width(), self._photo_image.height()

    @property
    def last_error(self) -> Optional[BaseException]:
        """返回最近一次封面渲染异常，便于启动诊断和回归测试读取。"""

        return self._last_error

    def render(self, width: int, height: int) -> None:
        """立即按目标尺寸更新同一图片图元，失败时展示配置化降级提示。"""

        if self._disposed or width < 1 or height < 1:
            return
        target_size = (width, height)
        if target_size == self._render_size:
            return
        try:
            photo_image = self._build_photo_image(width, height)
        except (OSError, tk.TclError, ValueError) as error:
            self._show_fallback(error, target_size)
            return
        self._photo_image = photo_image
        self._last_error = None
        self._render_size = target_size
        self._canvas.itemconfigure(
            self._image_item,
            image=self._photo_image,
            state=tk.NORMAL,
        )
        if self._fallback_item is not None:
            self._canvas.itemconfigure(self._fallback_item, state=tk.HIDDEN)
        self._canvas.tag_lower(self._image_item)

    def dispose(self) -> None:
        """取消待执行的缩放回调，阻止已销毁页面继续访问 Tk 组件。"""

        if self._disposed:
            return
        self._disposed = True
        if self._resize_callback_id is not None:
            try:
                self._canvas.after_cancel(self._resize_callback_id)
            except tk.TclError:
                pass
            self._resize_callback_id = None
        if self._source_image is not None:
            self._source_image.close()
            self._source_image = None

    def _on_canvas_configure(self, event: tk.Event) -> None:
        """收到连续尺寸事件时，仅保留最后一次配置化延迟重绘。"""

        if self._disposed or event.width < 1 or event.height < 1:
            return
        target_size = (event.width, event.height)
        if target_size == self._render_size:
            return
        if self._resize_callback_id is not None:
            self._canvas.after_cancel(self._resize_callback_id)
        self._resize_callback_id = self._canvas.after(
            int(self._config["resize_debounce_ms"]),
            self._render_scheduled_size,
            target_size,
        )

    def _render_scheduled_size(self, target_size: Tuple[int, int]) -> None:
        """执行最后一次防抖尺寸对应的封面重绘。"""

        self._resize_callback_id = None
        self.render(*target_size)

    def _build_photo_image(self, width: int, height: int):
        """优先通过 Pillow 等比裁切，缺少依赖时使用 Tk 原生缩放。"""

        if Image is not None and ImageOps is not None and ImageTk is not None:
            source = self._pillow_source()
            resampling = getattr(Image, "Resampling", Image).LANCZOS
            fitted = ImageOps.fit(source, (width, height), method=resampling)
            self._apply_overlay(fitted, width, height)
            return ImageTk.PhotoImage(fitted, master=self._canvas)
        return self._build_tk_photo_image(width, height)

    def _pillow_source(self):
        """首次读取封面原图并缓存独立 RGB 副本，避免每次缩放重复访问磁盘。"""

        if self._source_image is None:
            with Image.open(str(self._image_path)) as source:
                self._source_image = source.convert("RGB").copy()
        return self._source_image

    def _apply_overlay(self, fitted, width: int, height: int) -> None:
        """按配置为封面左侧叠加从深到浅的横向渐变。"""

        start_x = int(self._config["overlay_start_x"])
        end_x = int(self._config["overlay_end_x"])
        start_opacity = int(self._config["overlay_start_opacity"])
        end_opacity = int(self._config["overlay_end_opacity"])
        opacity_values = []
        for x_position in range(width):
            if x_position <= start_x:
                opacity = start_opacity
            elif x_position >= end_x:
                opacity = end_opacity
            else:
                progress = (x_position - start_x) / (end_x - start_x)
                opacity = round(
                    start_opacity + (end_opacity - start_opacity) * progress
                )
            opacity_values.append(opacity)
        mask = Image.new("L", (width, 1))
        mask.putdata(opacity_values)
        mask = mask.resize((width, height))
        overlay = Image.new(
            "RGB",
            (width, height),
            str(self._config["overlay_color"]),
        )
        fitted.paste(overlay, (0, 0), mask)

    def _build_tk_photo_image(self, width: int, height: int) -> tk.PhotoImage:
        """在无 Pillow 环境中用整数放大和居中裁切生成铺满画布的封面。"""

        source = tk.PhotoImage(master=self._canvas, file=str(self._image_path))
        width_factor = (width + source.width() - 1) // source.width()
        height_factor = (height + source.height() - 1) // source.height()
        zoom_factor = max(width_factor, height_factor, 1)
        scaled = source.zoom(zoom_factor, zoom_factor)
        source_x = max((scaled.width() - width) // 2, 0)
        source_y = max((scaled.height() - height) // 2, 0)
        target = tk.PhotoImage(master=self._canvas, width=width, height=height)
        target.tk.call(
            str(target),
            "copy",
            str(scaled),
            "-from",
            source_x,
            source_y,
            source_x + width,
            source_y + height,
            "-to",
            0,
            0,
        )
        return target

    def _show_fallback(
        self,
        error: BaseException,
        target_size: Tuple[int, int],
    ) -> None:
        """记录封面异常，并切换到可辨识而非静默空白的降级界面。"""

        LOGGER.exception(self._fallback_message)
        self._photo_image = None
        self._last_error = error
        self._render_size = target_size
        self._canvas.itemconfigure(self._image_item, image="", state=tk.HIDDEN)
        if self._fallback_item is None:
            self._fallback_item = self._canvas.create_text(
                int(self._config["fallback_text_x"]),
                int(self._config["fallback_text_y"]),
                anchor=str(self._config["fallback_text_anchor"]),
                text=self._fallback_message,
                fill=str(self._config["fallback_text_color"]),
                width=int(self._config["fallback_wrap_length"]),
                font=(
                    self._font_family,
                    int(self._config["fallback_text_size"]),
                    "bold",
                ),
            )
            return
        self._canvas.itemconfigure(self._fallback_item, state=tk.NORMAL)
