"""验证资源、函数注释和英文代码标识符等工程约束。"""

import ast
import tempfile
import unittest
from pathlib import Path

from apocalypse_game.assets import AssetError, validate_png
from apocalypse_game.config import ConfigLoader
from tests.helpers import CONFIG_PATH, PROJECT_ROOT


class QualityGateTests(unittest.TestCase):
    """把用户要求的代码规范固化为可重复执行的门禁。"""

    def test_all_functions_have_docstrings(self) -> None:
        """产品源码中的每个函数和方法都必须有函数级注释。"""

        missing = []
        for path in (PROJECT_ROOT / "apocalypse_game").glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if ast.get_docstring(node) is None:
                        missing.append("{}:{}".format(path.name, node.lineno))
        self.assertEqual([], missing)

    def test_python_identifiers_are_english_ascii(self) -> None:
        """产品源码的变量、函数、类与参数标识符必须使用英文 ASCII。"""

        non_ascii = []
        for path in (PROJECT_ROOT / "apocalypse_game").glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Name):
                    names.append(node.id)
                elif isinstance(
                    node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
                ):
                    names.append(node.name)
                    if hasattr(node, "args"):
                        names.extend(argument.arg for argument in node.args.args)
                for name in names:
                    if not name.isascii():
                        non_ascii.append(
                            "{}:{}:{}".format(path.name, node.lineno, name)
                        )
        self.assertEqual([], non_ascii)

    def test_concept_art_is_expected_png_size(self) -> None:
        """主菜单概念图必须存在，并具有配置声明的 PNG 尺寸。"""

        config = ConfigLoader.load(CONFIG_PATH)
        image_path = config.resolve_path("concept_art")
        window = config.section("window")
        dimensions = validate_png(
            image_path,
            window["image_width"],
            window["image_height"],
        )
        self.assertEqual((window["image_width"], window["image_height"]), dimensions)

    def test_truncated_png_cannot_pass_quality_gate(self) -> None:
        """仅伪造签名与宽高但缺少完整数据块的文件必须被拒绝。"""

        with tempfile.TemporaryDirectory() as directory:
            fake_path = Path(directory) / "fake.png"
            fake_path.write_bytes(
                b"\x89PNG\r\n\x1a\n"
                + b"\x00\x00\x00\x0dIHDR"
                + (1280).to_bytes(4, "big")
                + (720).to_bytes(4, "big")
            )
            with self.assertRaises(AssetError):
                validate_png(fake_path, 1280, 720)

    def test_legacy_platform_dependencies_are_removed(self) -> None:
        """标准 Python 版本不得继续依赖猿编程专有模块。"""

        product_source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (PROJECT_ROOT / "apocalypse_game").glob("*.py")
        )
        self.assertNotIn("ybc_ui", product_source)
        self.assertNotIn("cosplay", product_source)

    def test_button_text_contrast_is_readable_in_every_active_state(self) -> None:
        """三种按钮在默认、悬停和按压状态下都应保持可读对比度。"""

        config = ConfigLoader.load(CONFIG_PATH)
        styles = config.section("button_styles")
        for style_id in ("primary", "secondary", "danger"):
            palette = styles[style_id]
            for background_key in ("background", "hover", "pressed"):
                contrast = self._contrast_ratio(
                    palette[background_key],
                    palette["foreground"],
                )
                self.assertGreaterEqual(
                    contrast,
                    4.5,
                    "{} 的 {} 状态文字对比度不足".format(
                        style_id,
                        background_key,
                    ),
                )

    def test_native_tk_buttons_are_replaced_by_cross_platform_widgets(self) -> None:
        """界面不得重新使用会在 macOS Aqua 下丢失背景色的原生按钮。"""

        ui_source = (PROJECT_ROOT / "apocalypse_game" / "ui.py").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("tk.Button(", ui_source)

    def _contrast_ratio(self, first: str, second: str) -> float:
        """按照 WCAG 相对亮度公式计算两个十六进制颜色的对比度。"""

        first_luminance = self._relative_luminance(first)
        second_luminance = self._relative_luminance(second)
        lighter = max(first_luminance, second_luminance)
        darker = min(first_luminance, second_luminance)
        return (lighter + 0.05) / (darker + 0.05)

    def _relative_luminance(self, color: str) -> float:
        """把十六进制 RGB 颜色转换为 WCAG 相对亮度。"""

        channels = [int(color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
        linear = [
            channel / 12.92
            if channel <= 0.03928
            else ((channel + 0.055) / 1.055) ** 2.4
            for channel in channels
        ]
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


if __name__ == "__main__":
    unittest.main()
