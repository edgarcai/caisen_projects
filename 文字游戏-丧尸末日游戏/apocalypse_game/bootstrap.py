"""组合配置、基础设施、领域服务和 Tkinter 界面的程序入口。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional, Sequence

from apocalypse_game.application import GameApplication
from apocalypse_game.assets import AssetError, validate_png
from apocalypse_game.combat import CombatService
from apocalypse_game.config import ConfigError, ConfigLoader
from apocalypse_game.events import ExplorationEventService
from apocalypse_game.infrastructure import (
    JsonSaveRepository,
    StdRandomSource,
    V1ToV2SaveMigrator,
)
from apocalypse_game.rules import GameRules
from apocalypse_game.shelter import ShelterService
from apocalypse_game.state_ops import StateOperations
from apocalypse_game.story import StoryService


def build_application(config_path: Optional[Path] = None) -> GameApplication:
    """构建一套依赖完整、可被界面或测试复用的游戏应用。"""

    resolved_config_path = config_path or (
        Path(__file__).resolve().parent.parent / "config" / "game_config.json"
    )
    config = ConfigLoader.load(resolved_config_path)
    random_source = StdRandomSource()
    operations = StateOperations(random_source)
    story_service = StoryService(config, operations)
    shelter_service = ShelterService(
        config,
        operations,
        story_service,
        random_source,
    )
    combat_service = CombatService(config.story, random_source, shelter_service)
    rules_config = config.section("rules")
    repository = JsonSaveRepository(
        config.resolve_path("save"),
        schema_version=config.data["save_schema_version"],
        validation_rules={
            "player_counts": rules_config["player_counts"],
            "time": rules_config["time"],
            "limits": rules_config["limits"],
        },
        migrators=[
            V1ToV2SaveMigrator.from_path(config.resolve_path("save_migration_v1_to_v2"))
        ],
    )
    event_service = ExplorationEventService(config, random_source)
    rules = GameRules(config, shelter_service)
    return GameApplication(
        config=config,
        event_service=event_service,
        story_service=story_service,
        combat_service=combat_service,
        shelter_service=shelter_service,
        rules=rules,
        repository=repository,
        random_source=random_source,
    )


def check_project(config_path: Optional[Path] = None) -> int:
    """无窗口检查配置、事件引用和概念图资源是否可读取。"""

    try:
        application = build_application(config_path)
        config = application.config
        image_path = config.resolve_path("concept_art")
        window = config.section("window")
        validate_png(image_path, window["image_width"], window["image_height"])
    except (ConfigError, AssetError, OSError) as error:
        print("项目自检失败：{}".format(error), file=sys.stderr)
        return 1
    print("项目自检通过：配置、事件引用与概念图均可读取。")
    return 0


def run(arguments: Optional[Sequence[str]] = None) -> None:
    """解析启动参数并运行无窗口自检或桌面游戏。"""

    command_arguments = list(arguments) if arguments is not None else sys.argv[1:]
    if "--check" in command_arguments:
        raise SystemExit(check_project())
    try:
        application = build_application()
    except ConfigError as error:
        print("配置错误：{}".format(error), file=sys.stderr)
        raise SystemExit(1) from error
    try:
        import tkinter as tk
    except ImportError as error:
        print("启动失败：当前 Python 没有安装 Tkinter。", file=sys.stderr)
        raise SystemExit(1) from error
    minimum_tk = application.config.section("runtime")["minimum_tk_version"]
    if tk.TkVersion < minimum_tk:
        print(
            "启动失败：需要 Tk {} 或更高版本，当前为 Tk {}。请改用带 Tk 8.6 的 Python。".format(
                minimum_tk,
                tk.TkVersion,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
    from apocalypse_game.ui import GameWindow

    try:
        root = tk.Tk()
    except tk.TclError as error:
        print("启动失败：无法创建桌面窗口：{}".format(error), file=sys.stderr)
        raise SystemExit(1) from error
    GameWindow(root, application)
    root.mainloop()
