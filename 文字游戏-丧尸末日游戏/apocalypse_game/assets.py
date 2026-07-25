"""提供不依赖 GUI 或 Pillow 的项目资源完整性校验。"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import Tuple


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class AssetError(RuntimeError):
    """表示游戏资源缺失、损坏或规格不匹配。"""


def validate_png(
    path: Path, expected_width: int, expected_height: int
) -> Tuple[int, int]:
    """校验 PNG 签名、数据块边界、CRC、IHDR 尺寸与 IEND 完整性。"""

    try:
        data = path.read_bytes()
    except OSError as error:
        raise AssetError("无法读取概念图 {}：{}".format(path, error)) from error
    if not data.startswith(PNG_SIGNATURE):
        raise AssetError("概念图缺少有效 PNG 签名")

    offset = len(PNG_SIGNATURE)
    found_header = False
    found_end = False
    image_width = 0
    image_height = 0
    while offset < len(data):
        if offset + 12 > len(data):
            raise AssetError("PNG 数据块头被截断")
        chunk_length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_data_start = offset + 8
        chunk_data_end = chunk_data_start + chunk_length
        chunk_end = chunk_data_end + 4
        if chunk_end > len(data):
            raise AssetError("PNG 数据块内容被截断")
        expected_crc = struct.unpack(">I", data[chunk_data_end:chunk_end])[0]
        actual_crc = zlib.crc32(chunk_type)
        actual_crc = (
            zlib.crc32(data[chunk_data_start:chunk_data_end], actual_crc) & 0xFFFFFFFF
        )
        if expected_crc != actual_crc:
            raise AssetError("PNG 数据块 CRC 校验失败")

        if chunk_type == b"IHDR":
            if found_header or offset != len(PNG_SIGNATURE) or chunk_length != 13:
                raise AssetError("PNG 的 IHDR 数据块无效")
            image_width, image_height = struct.unpack(
                ">II",
                data[chunk_data_start : chunk_data_start + 8],
            )
            found_header = True
        elif chunk_type == b"IEND":
            if chunk_length != 0:
                raise AssetError("PNG 的 IEND 数据块无效")
            found_end = True
            offset = chunk_end
            break
        offset = chunk_end

    if not found_header or not found_end:
        raise AssetError("PNG 缺少 IHDR 或 IEND 数据块")
    if offset != len(data):
        raise AssetError("PNG 结束块后包含意外数据")
    if (image_width, image_height) != (expected_width, expected_height):
        raise AssetError(
            "概念图尺寸应为 {}x{}，实际为 {}x{}".format(
                expected_width,
                expected_height,
                image_width,
                image_height,
            )
        )
    return image_width, image_height
