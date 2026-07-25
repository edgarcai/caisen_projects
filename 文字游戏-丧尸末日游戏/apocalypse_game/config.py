"""读取并校验游戏配置。"""

from __future__ import annotations

import json
from calendar import monthrange
from dataclasses import dataclass, field
from pathlib import Path
from string import Formatter
from typing import Any, Dict, List, Mapping, Set


PLAYER_EFFECT_FIELDS = frozenset(
    {
        "health",
        "attack",
        "defense",
        "agility",
        "medical_supplies",
        "food",
        "hunger",
        "intelligence",
        "coins",
        "parts",
        "negative_status",
        "antidotes",
    }
)
SHELTER_EFFECT_FIELDS = frozenset(
    {
        "population",
        "group_hunger",
        "health",
        "defense_damage",
        "activity",
        "newspapers",
        "books",
        "magazines",
        "toys",
        "game_consoles",
    }
)


def _is_integer(value: Any) -> bool:
    """仅把非布尔的真正整数视为合法配置整数。"""

    return isinstance(value, int) and not isinstance(value, bool)


def _is_hex_color(value: Any) -> bool:
    """判断配置值是否为完整的六位十六进制颜色。"""

    if not isinstance(value, str) or len(value) != 7 or not value.startswith("#"):
        return False
    try:
        int(value[1:], 16)
    except ValueError:
        return False
    return True


def _resolve_project_path(
    project_root: Path, relative_path: str, path_key: str
) -> Path:
    """解析项目内相对路径，并拒绝绝对路径或目录逃逸。"""

    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise ConfigError("路径 {} 必须是项目内相对路径".format(path_key))
    resolved_root = project_root.resolve()
    resolved_path = (resolved_root / candidate).resolve()
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as error:
        raise ConfigError("路径 {} 不能逃逸项目目录".format(path_key)) from error
    return resolved_path


class ConfigError(RuntimeError):
    """表示配置文件缺失、损坏或结构不兼容。"""


@dataclass(frozen=True)
class GameConfig:
    """提供只读式配置访问和项目路径解析。"""

    data: Mapping[str, Any]
    events: Mapping[str, Mapping[str, Any]]
    project_root: Path
    story: Mapping[str, Any] = field(default_factory=dict)

    def section(self, name: str) -> Mapping[str, Any]:
        """返回指定顶层配置段，不存在时抛出可读错误。"""

        value = self.data.get(name)
        if not isinstance(value, Mapping):
            raise ConfigError("缺少配置段：{}".format(name))
        return value

    def value(self, dotted_path: str) -> Any:
        """按照点分路径读取嵌套配置值，并在路径无效时给出明确错误。"""

        current: Any = self.data
        for segment in dotted_path.split("."):
            if not isinstance(current, Mapping) or segment not in current:
                raise ConfigError("缺少配置路径：{}".format(dotted_path))
            current = current[segment]
        return current

    def text(self, key: str, **values: Any) -> str:
        """读取中文文案，并使用调用方提供的值完成安全格式化。"""

        texts = self.section("texts")
        template = texts.get(key)
        if not isinstance(template, str):
            raise ConfigError("缺少文案配置：{}".format(key))
        try:
            return template.format(**values)
        except (KeyError, ValueError, IndexError) as error:
            raise ConfigError(
                "文案 {} 缺少格式化参数：{}".format(key, error)
            ) from error

    def resolve_path(self, path_key: str) -> Path:
        """把配置中的项目相对路径转换为绝对路径。"""

        paths = self.section("paths")
        relative_path = paths.get(path_key)
        if not isinstance(relative_path, str) or not relative_path:
            raise ConfigError("缺少路径配置：{}".format(path_key))
        return _resolve_project_path(self.project_root, relative_path, path_key)

    def city(self, city_id: str) -> Mapping[str, Any]:
        """按英文城市标识查找城市配置。"""

        for city in self.data.get("cities", []):
            if city.get("id") == city_id:
                return city
        raise ConfigError(self.text("unknown_city", city_id=city_id))

    def cities(self) -> List[Mapping[str, Any]]:
        """按配置顺序返回可探索城市列表的副本。"""

        cities = self.data.get("cities")
        if not isinstance(cities, list):
            raise ConfigError("cities 必须是列表")
        return list(cities)

    def story_scene(self, scene_id: str) -> Mapping[str, Any]:
        """按稳定英文 ID 返回一个主线场景配置。"""

        return self._story_entry("scenes", "scene_id", scene_id)

    def boss(self, boss_id: str) -> Mapping[str, Any]:
        """按稳定英文 ID 返回一个首领配置。"""

        return self._story_entry("bosses", "boss_id", boss_id)

    def ending(self, ending_id: str) -> Mapping[str, Any]:
        """按稳定英文 ID 返回一个主线结局配置。"""

        return self._story_entry("endings", "ending_id", ending_id)

    def companion_profile(self, companion_id: str) -> Mapping[str, Any]:
        """按稳定英文 ID 返回一名剧情伙伴资料。"""

        return self._story_entry("companions", "companion_id", companion_id)

    def _story_entry(
        self,
        collection_name: str,
        id_field: str,
        entry_id: str,
    ) -> Mapping[str, Any]:
        """在指定剧情目录中查找配置对象并统一处理未知 ID。"""

        entries = self.story.get(collection_name, [])
        for entry in entries:
            if entry.get(id_field) == entry_id:
                return entry
        raise ConfigError("未知剧情配置 {}：{}".format(collection_name, entry_id))


class ConfigLoader:
    """负责从 JSON 文件构建经过基础校验的游戏配置。"""

    @classmethod
    def load(cls, config_path: Path) -> GameConfig:
        """加载主配置与事件目录，并返回统一配置对象。"""

        absolute_path = config_path.resolve()
        project_root = absolute_path.parent.parent
        data = cls._load_json(absolute_path)
        cls._validate_main_config(data)

        events_value = data["paths"]["events"]
        events_path = _resolve_project_path(project_root, events_value, "events")
        event_document = cls._load_json(events_path)
        cls._validate_event_config(event_document)
        event_map = {event["id"]: event for event in event_document["events"]}
        cls._validate_city_references(data, event_map)
        story_value = data["paths"]["story"]
        story_path = _resolve_project_path(project_root, story_value, "story")
        story_document = cls._load_json(story_path)
        cls._validate_story_config(story_document)
        return GameConfig(
            data=data,
            events=event_map,
            story=story_document,
            project_root=project_root,
        )

    @staticmethod
    def _load_json(path: Path) -> Dict[str, Any]:
        """读取单个 UTF-8 JSON 文件，并统一转换底层异常。"""

        try:
            with path.open("r", encoding="utf-8") as handle:
                document = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ConfigError("无法读取配置 {}：{}".format(path, error)) from error
        if not isinstance(document, dict):
            raise ConfigError("配置文件顶层必须是对象：{}".format(path))
        return document

    @classmethod
    def _validate_main_config(cls, data: Mapping[str, Any]) -> None:
        """检查主配置版本、关键段、运行时规则和界面入口结构。"""

        required_sections = (
            "schema_version",
            "save_schema_version",
            "runtime",
            "game",
            "paths",
            "window",
            "theme",
            "button_styles",
            "interface",
            "fonts",
            "menu",
            "dialogs",
            "mode_labels",
            "rules",
            "defaults",
            "cities",
            "actions",
            "labels",
            "texts",
        )
        missing = [name for name in required_sections if name not in data]
        if missing:
            raise ConfigError("主配置缺少字段：{}".format(", ".join(missing)))
        if not _is_integer(data["schema_version"]) or data["schema_version"] != 1:
            raise ConfigError("不支持的主配置版本：{}".format(data["schema_version"]))
        if (
            not _is_integer(data["save_schema_version"])
            or data["save_schema_version"] < 1
        ):
            raise ConfigError("save_schema_version 必须是正整数")
        mapping_sections = (
            "runtime",
            "game",
            "paths",
            "window",
            "theme",
            "button_styles",
            "interface",
            "fonts",
            "menu",
            "dialogs",
            "mode_labels",
            "rules",
            "defaults",
            "labels",
            "texts",
        )
        for section_name in mapping_sections:
            if not isinstance(data[section_name], Mapping):
                raise ConfigError("配置段 {} 必须是对象".format(section_name))

        minimum_tk = data["runtime"].get("minimum_tk_version")
        if isinstance(minimum_tk, bool) or not isinstance(minimum_tk, (int, float)):
            raise ConfigError("runtime.minimum_tk_version 必须是数字")
        paths = data["paths"]
        for path_key in (
            "events",
            "story",
            "save_migration_v1_to_v2",
            "save",
            "concept_art",
        ):
            if not isinstance(paths.get(path_key), str) or not paths[path_key]:
                raise ConfigError("paths.{} 必须是非空相对路径".format(path_key))

        rules = data["rules"]
        for rule_name in (
            "player_counts",
            "time",
            "limits",
            "turn_costs",
            "failure_endings",
            "items",
        ):
            if not isinstance(rules.get(rule_name), Mapping):
                raise ConfigError("rules.{} 必须是对象".format(rule_name))
        cls._validate_player_counts(rules["player_counts"], data["mode_labels"])
        cls._validate_time_rules(rules["time"])
        cls._validate_numeric_tree(rules["limits"], "rules.limits")
        cls._validate_numeric_tree(rules["turn_costs"], "rules.turn_costs")
        for item_name, item_config in rules["items"].items():
            if not isinstance(item_config, Mapping):
                raise ConfigError("物品配置 {} 必须是对象".format(item_name))
            cls._validate_numeric_tree(item_config, "rules.items.{}".format(item_name))

        defaults = data["defaults"]
        if not isinstance(defaults.get("player"), Mapping) or not isinstance(
            defaults.get("shelter"), Mapping
        ):
            raise ConfigError("defaults 必须包含 player 和 shelter 对象")
        missing_player_fields = PLAYER_EFFECT_FIELDS - set(defaults["player"])
        missing_shelter_fields = SHELTER_EFFECT_FIELDS - set(defaults["shelter"])
        if missing_player_fields or missing_shelter_fields:
            raise ConfigError("默认状态字段不完整")
        cls._validate_numeric_tree(defaults["player"], "defaults.player")
        cls._validate_numeric_tree(defaults["shelter"], "defaults.shelter")

        if not isinstance(data["cities"], list) or not data["cities"]:
            raise ConfigError("至少需要配置一座城市")
        city_ids: Set[str] = set()
        for city in data["cities"]:
            if not isinstance(city, Mapping):
                raise ConfigError("城市配置必须是对象")
            city_id = city.get("id")
            if not isinstance(city_id, str) or not city_id or city_id in city_ids:
                raise ConfigError("城市 ID 必须存在且不能重复")
            city_ids.add(city_id)
            if not isinstance(city.get("name"), str) or not city["name"]:
                raise ConfigError("城市 {} 缺少显示名称".format(city_id))
            event_ids = city.get("event_ids")
            if (
                not isinstance(event_ids, list)
                or not event_ids
                or not all(isinstance(event_id, str) for event_id in event_ids)
            ):
                raise ConfigError("城市 {} 的 event_ids 无效".format(city_id))

        actions = data["actions"]
        if not isinstance(actions, list) or not actions:
            raise ConfigError("actions 必须是非空列表")
        action_ids: Set[str] = set()
        for action in actions:
            if not isinstance(action, Mapping):
                raise ConfigError("行动配置必须是对象")
            action_id = action.get("id")
            if (
                not isinstance(action_id, str)
                or not action_id
                or action_id in action_ids
            ):
                raise ConfigError("行动 ID 必须存在且不能重复")
            action_ids.add(action_id)
            if not isinstance(action.get("label"), str):
                raise ConfigError("行动 {} 缺少中文标签".format(action_id))
            if action.get("style") not in {"primary", "secondary", "danger"}:
                raise ConfigError("行动 {} 的样式无效".format(action_id))
            for presentation_field in ("icon", "subtitle"):
                if not isinstance(action.get(presentation_field), str):
                    raise ConfigError(
                        "行动 {} 缺少界面字段 {}".format(
                            action_id,
                            presentation_field,
                        )
                    )
        cls._validate_interface_config(data, action_ids)

    @classmethod
    def _validate_interface_config(
        cls,
        data: Mapping[str, Any],
        action_ids: Set[str],
    ) -> None:
        """验证按钮调色板、尺寸、行动分组和资源状态条配置。"""

        button_styles = data["button_styles"]
        required_style_ids = {"primary", "secondary", "danger", "disabled"}
        if set(button_styles) != required_style_ids:
            raise ConfigError("button_styles 必须完整配置四种按钮状态")
        required_colors = {
            "background",
            "hover",
            "pressed",
            "foreground",
            "muted_foreground",
            "border",
            "focus",
            "accent",
        }
        for style_id, palette in button_styles.items():
            if not isinstance(palette, Mapping) or set(palette) != required_colors:
                raise ConfigError("按钮样式 {} 字段不完整".format(style_id))
            if not all(_is_hex_color(color) for color in palette.values()):
                raise ConfigError("按钮样式 {} 必须使用十六进制颜色".format(style_id))

        interface = data["interface"]
        for section_name in ("layout", "buttons", "dashboard"):
            if not isinstance(interface.get(section_name), Mapping):
                raise ConfigError("interface.{} 必须是对象".format(section_name))
        cls._validate_numeric_tree(interface["layout"], "interface.layout")
        buttons = interface["buttons"]
        sizes = buttons.get("sizes")
        if not isinstance(sizes, Mapping) or not sizes:
            raise ConfigError("interface.buttons.sizes 必须是非空对象")
        for size_id, size in sizes.items():
            if not isinstance(size, Mapping) or not all(
                _is_integer(size.get(axis)) and size[axis] > 0
                for axis in ("width", "height")
            ):
                raise ConfigError("按钮尺寸 {} 无效".format(size_id))
        required_button_metrics = {
            "border_width",
            "accent_width",
            "icon_center_x",
            "text_without_icon_x",
            "text_with_icon_x",
            "subtitle_offset",
            "prompt_right_padding",
        }
        for metric_name in required_button_metrics:
            if not _is_integer(buttons.get(metric_name)) or buttons[metric_name] < 0:
                raise ConfigError(
                    "interface.buttons.{} 必须是非负整数".format(metric_name)
                )
        if not isinstance(buttons.get("prompt_symbol"), str):
            raise ConfigError("interface.buttons.prompt_symbol 必须是字符串")

        groups = interface.get("action_groups")
        if not isinstance(groups, list) or not groups:
            raise ConfigError("interface.action_groups 必须是非空列表")
        grouped_action_ids: List[str] = []
        group_ids: Set[str] = set()
        for group in groups:
            if not isinstance(group, Mapping):
                raise ConfigError("行动分组必须是对象")
            group_id = group.get("group_id")
            if not isinstance(group_id, str) or not group_id or group_id in group_ids:
                raise ConfigError("行动分组 ID 必须存在且不能重复")
            group_ids.add(group_id)
            if not isinstance(group.get("label"), str) or not group["label"]:
                raise ConfigError("行动分组 {} 缺少标签".format(group_id))
            columns = group.get("columns")
            if not _is_integer(columns) or columns < 1:
                raise ConfigError("行动分组 {} 的列数无效".format(group_id))
            if group.get("button_size") not in sizes:
                raise ConfigError("行动分组 {} 引用了未知按钮尺寸".format(group_id))
            references = group.get("action_ids")
            if (
                not isinstance(references, list)
                or not references
                or not all(isinstance(action_id, str) for action_id in references)
            ):
                raise ConfigError("行动分组 {} 必须引用行动".format(group_id))
            grouped_action_ids.extend(references)
        if len(grouped_action_ids) != len(set(grouped_action_ids)):
            raise ConfigError("行动分组不能重复引用同一行动")
        if set(grouped_action_ids) != action_ids:
            raise ConfigError("行动分组必须完整覆盖 actions")

        dashboard = interface["dashboard"]
        for text_key in (
            "command_status",
            "online_status",
            "action_hint",
            "log_hint",
            "campaign_status_format",
            "meter_value_format",
        ):
            if not isinstance(dashboard.get(text_key), str):
                raise ConfigError(
                    "interface.dashboard.{} 必须是字符串".format(text_key)
                )
        if (
            not _is_integer(dashboard.get("meter_height"))
            or dashboard["meter_height"] <= 0
        ):
            raise ConfigError("interface.dashboard.meter_height 必须是正整数")
        meter_palette = dashboard.get("meter_palette")
        required_meter_colors = {
            "surface",
            "track",
            "label",
            "value",
            "normal",
            "warning",
            "danger",
        }
        if (
            not isinstance(meter_palette, Mapping)
            or set(meter_palette) != required_meter_colors
            or not all(_is_hex_color(color) for color in meter_palette.values())
        ):
            raise ConfigError("interface.dashboard.meter_palette 字段或颜色无效")
        meters = dashboard.get("meters")
        if not isinstance(meters, list) or not meters:
            raise ConfigError("interface.dashboard.meters 必须是非空列表")
        valid_fields = {
            "player": PLAYER_EFFECT_FIELDS,
            "shelter": SHELTER_EFFECT_FIELDS,
        }
        for meter in meters:
            if not isinstance(meter, Mapping):
                raise ConfigError("资源状态条必须是对象")
            scope = meter.get("scope")
            if (
                scope not in valid_fields
                or meter.get("field") not in valid_fields[scope]
            ):
                raise ConfigError("资源状态条引用了未知领域字段")
            if not isinstance(meter.get("label"), str) or not meter["label"]:
                raise ConfigError("资源状态条缺少显示标签")
            if meter.get("direction") not in {
                "higher_is_worse",
                "lower_is_worse",
            }:
                raise ConfigError("资源状态条风险方向无效")
            maximum_path = meter.get("maximum_path")
            maximum = cls._mapping_value(data, maximum_path)
            if not _is_integer(maximum) or maximum <= 0:
                raise ConfigError("资源状态条上限必须指向正整数配置")
            thresholds = meter.get("thresholds")
            if not isinstance(thresholds, Mapping) or not all(
                isinstance(thresholds.get(level), (int, float))
                and not isinstance(thresholds[level], bool)
                and 0 <= thresholds[level] <= 1
                for level in ("warning", "danger")
            ):
                raise ConfigError("资源状态条风险阈值无效")
            warning = thresholds["warning"]
            danger = thresholds["danger"]
            if (meter["direction"] == "higher_is_worse" and warning >= danger) or (
                meter["direction"] == "lower_is_worse" and danger >= warning
            ):
                raise ConfigError("资源状态条警告与危险阈值顺序无效")

        presentations = data["menu"].get("presentations")
        menu_option_ids = {"new_game", "load_game", "multiplayer"}
        if (
            not isinstance(presentations, Mapping)
            or set(presentations) != menu_option_ids
        ):
            raise ConfigError("menu.presentations 必须完整配置三个主菜单入口")
        for option_id, presentation in presentations.items():
            if not isinstance(presentation, Mapping) or not all(
                isinstance(presentation.get(field_name), str)
                for field_name in ("icon", "subtitle")
            ):
                raise ConfigError("主菜单入口 {} 的展示配置无效".format(option_id))

    @staticmethod
    def _mapping_value(data: Mapping[str, Any], dotted_path: Any) -> Any:
        """在配置校验阶段读取点分路径，路径无效时抛出配置错误。"""

        if not isinstance(dotted_path, str) or not dotted_path:
            raise ConfigError("配置引用路径必须是非空字符串")
        current: Any = data
        for segment in dotted_path.split("."):
            if not isinstance(current, Mapping) or segment not in current:
                raise ConfigError("配置引用路径不存在：{}".format(dotted_path))
            current = current[segment]
        return current

    @staticmethod
    def _validate_player_counts(
        player_counts: Mapping[str, Any],
        mode_labels: Mapping[str, Any],
    ) -> None:
        """验证每种游戏模式的玩家数量范围和显示文案。"""

        if not player_counts:
            raise ConfigError("至少需要一种游戏模式")
        for mode, limits in player_counts.items():
            if not isinstance(mode, str) or not isinstance(limits, Mapping):
                raise ConfigError("player_counts 模式配置无效")
            minimum = limits.get("minimum")
            maximum = limits.get("maximum")
            if not _is_integer(minimum) or not _is_integer(maximum):
                raise ConfigError("模式 {} 的玩家数量必须是整数".format(mode))
            if minimum < 1 or maximum < minimum:
                raise ConfigError("模式 {} 的玩家数量范围无效".format(mode))
            if not isinstance(mode_labels.get(mode), str):
                raise ConfigError("模式 {} 缺少显示文案".format(mode))

    @staticmethod
    def _validate_time_rules(time_rules: Mapping[str, Any]) -> None:
        """验证起始日期、每日行动时段和单次行动时长。"""

        required_names = (
            "start_year",
            "start_month",
            "start_day",
            "start_hour",
            "day_start_hour",
            "day_end_hour",
            "hours_per_action",
        )
        if not all(_is_integer(time_rules.get(name)) for name in required_names):
            raise ConfigError("时间配置必须全部使用整数")
        if time_rules["start_year"] < 1 or not 1 <= time_rules["start_month"] <= 12:
            raise ConfigError("起始年月无效")
        days_in_start_month = monthrange(
            time_rules["start_year"],
            time_rules["start_month"],
        )[1]
        if not 1 <= time_rules["start_day"] <= days_in_start_month:
            raise ConfigError("起始日期无效")
        if not 0 <= time_rules["day_start_hour"] < time_rules["day_end_hour"] <= 24:
            raise ConfigError("每日行动时段无效")
        if (
            not time_rules["day_start_hour"]
            <= time_rules["start_hour"]
            < time_rules["day_end_hour"]
        ):
            raise ConfigError("起始小时不在行动时段内")
        if (
            not 0
            < time_rules["hours_per_action"]
            <= (time_rules["day_end_hour"] - time_rules["day_start_hour"])
        ):
            raise ConfigError("单次行动时长无效")

    @staticmethod
    def _validate_numeric_tree(values: Mapping[str, Any], prefix: str) -> None:
        """验证一个只应包含非负整数的配置对象。"""

        if not values:
            raise ConfigError("{} 不能为空".format(prefix))
        for key, value in values.items():
            if not _is_integer(value) or value < 0:
                raise ConfigError("{}.{} 必须是非负整数".format(prefix, key))

    @classmethod
    def _validate_story_config(cls, data: Mapping[str, Any]) -> None:
        """校验剧情图、伙伴、Boss、经营内容与结局之间的稳定引用。"""

        if data.get("schema_version") != 1:
            raise ConfigError("不支持的剧情配置版本")
        required_mappings = ("defaults", "world", "trade", "recruitment")
        required_lists = (
            "chapters",
            "companions",
            "scenes",
            "bosses",
            "discoveries",
            "facilities",
            "jobs",
            "trades",
            "recruits",
            "endings",
        )
        for name in required_mappings:
            if not isinstance(data.get(name), Mapping):
                raise ConfigError("剧情配置 {} 必须是对象".format(name))
        for name in required_lists:
            if not isinstance(data.get(name), list) or not data[name]:
                raise ConfigError("剧情配置 {} 必须是非空列表".format(name))

        chapter_ids = cls._unique_story_ids(data["chapters"], "chapter_id")
        companion_ids = cls._unique_story_ids(data["companions"], "companion_id")
        scene_ids = cls._unique_story_ids(data["scenes"], "scene_id")
        boss_ids = cls._unique_story_ids(data["bosses"], "boss_id")
        ending_ids = cls._unique_story_ids(data["endings"], "ending_id")
        facility_ids = cls._unique_story_ids(data["facilities"], "facility_id")
        cls._unique_story_ids(data["jobs"], "job_id")
        cls._unique_story_ids(data["trades"], "trade_id")
        cls._unique_story_ids(data["recruits"], "recruit_id")
        cls._unique_story_ids(data["discoveries"], "discovery_id")

        defaults = data["defaults"]
        story_defaults = defaults.get("story_state")
        if not isinstance(story_defaults, Mapping):
            raise ConfigError("defaults.story_state 必须是对象")
        if story_defaults.get("current_scene_id") not in scene_ids:
            raise ConfigError("剧情默认场景不存在")
        if story_defaults.get("chapter_id") not in chapter_ids:
            raise ConfigError("剧情默认章节不存在")
        default_companions = defaults.get("companions")
        if not isinstance(default_companions, list):
            raise ConfigError("defaults.companions 必须是列表")
        default_companion_ids = cls._unique_story_ids(
            default_companions,
            "companion_id",
        )
        if default_companion_ids != companion_ids:
            raise ConfigError("剧情默认伙伴必须与伙伴目录完全一致")
        facility_levels = defaults.get("facility_levels")
        if (
            not isinstance(facility_levels, Mapping)
            or set(facility_levels) != facility_ids
        ):
            raise ConfigError("默认设施等级必须与设施目录完全一致")
        if not all(
            _is_integer(level) and level >= 0 for level in facility_levels.values()
        ):
            raise ConfigError("默认设施等级必须是非负整数")

        chapter_scene_ids: List[str] = []
        for chapter in data["chapters"]:
            references = chapter.get("scene_ids")
            if not isinstance(references, list) or not references:
                raise ConfigError("章节必须引用至少一个场景")
            if any(scene_id not in scene_ids for scene_id in references):
                raise ConfigError("章节引用了不存在的场景")
            chapter_scene_ids.extend(references)
        if chapter_scene_ids != [scene["scene_id"] for scene in data["scenes"]]:
            raise ConfigError("章节场景顺序必须与平铺场景目录一致")

        scene_choices: Dict[str, Set[str]] = {}
        for scene in data["scenes"]:
            scene_id = scene["scene_id"]
            if scene.get("chapter_id") not in chapter_ids:
                raise ConfigError("场景 {} 引用了不存在的章节".format(scene_id))
            for text_field in ("title", "body", "objective"):
                if not isinstance(scene.get(text_field), str) or not scene[text_field]:
                    raise ConfigError("场景 {} 缺少 {}".format(scene_id, text_field))
            cls._validate_story_requirements(
                scene.get("entry_requirements", []),
                "场景 {}".format(scene_id),
            )
            choices = scene.get("choices")
            if not isinstance(choices, list) or not 2 <= len(choices) <= 3:
                raise ConfigError("场景 {} 必须提供 2 至 3 个选择".format(scene_id))
            choice_ids = cls._unique_story_ids(choices, "choice_id")
            scene_choices[scene_id] = choice_ids
            for choice in choices:
                choice_id = choice["choice_id"]
                if not isinstance(choice.get("label"), str) or not isinstance(
                    choice.get("result_text"), str
                ):
                    raise ConfigError("剧情选择缺少中文标签或结果文案")
                cls._validate_story_requirements(
                    choice.get("requirements", []),
                    "剧情选择 {}".format(choice_id),
                )
                cls._validate_story_effects(
                    choice.get("effects", []),
                    "剧情选择 {}".format(choice_id),
                )
                next_scene_id = choice.get("next_scene_id")
                if next_scene_id is not None and next_scene_id not in scene_ids:
                    raise ConfigError("剧情选择引用了不存在的下一场景")
                if (
                    choice.get("boss_id") is not None
                    and choice["boss_id"] not in boss_ids
                ):
                    raise ConfigError("剧情选择引用了不存在的 Boss")
                if (
                    choice.get("ending_id") is not None
                    and choice["ending_id"] not in ending_ids
                ):
                    raise ConfigError("剧情选择引用了不存在的结局")

        for boss in data["bosses"]:
            boss_id = boss["boss_id"]
            if boss.get("scene_id") not in scene_ids:
                raise ConfigError("Boss {} 引用了不存在的场景".format(boss_id))
            for field_name in ("max_health", "attack", "defense", "round_limit"):
                if not _is_integer(boss.get(field_name)) or boss[field_name] <= 0:
                    raise ConfigError(
                        "Boss {} 的 {} 必须是正整数".format(boss_id, field_name)
                    )
            outcomes = boss.get("possible_outcomes")
            if not isinstance(outcomes, list) or not outcomes:
                raise ConfigError("Boss {} 缺少可用结算路线".format(boss_id))

        for discovery in data["discoveries"]:
            source_scene_id = discovery.get("source_scene_id")
            if source_scene_id not in scene_ids:
                raise ConfigError("隐藏发现引用了不存在的场景")
            source_choices = discovery.get("source_choice_ids", [])
            if any(
                choice_id not in scene_choices[source_scene_id]
                for choice_id in source_choices
            ):
                raise ConfigError("隐藏发现引用了不存在的选择")

        for facility in data["facilities"]:
            max_level = facility.get("max_level")
            levels = facility.get("levels")
            if not _is_integer(max_level) or max_level < 1:
                raise ConfigError("设施最高等级必须是正整数")
            if not isinstance(levels, list) or len(levels) != max_level:
                raise ConfigError("设施等级配置数量与 max_level 不一致")
            for level in levels:
                if (
                    not _is_integer(level.get("build_hours"))
                    or level["build_hours"] < 1
                ):
                    raise ConfigError("设施建造时长必须是正整数")
        for job in data["jobs"]:
            if not _is_integer(job.get("duration_hours")) or job["duration_hours"] < 1:
                raise ConfigError("工作时长必须是正整数")
        for ending in data["endings"]:
            if not isinstance(ending.get("body"), str) or not ending["body"]:
                raise ConfigError("结局缺少完整正文")
            cls._validate_story_requirements(
                ending.get("requirements", []),
                "结局 {}".format(ending["ending_id"]),
            )

        for companion in data["companions"]:
            recruit_scene_id = companion.get("recruit_scene_id")
            if recruit_scene_id is not None and recruit_scene_id not in scene_ids:
                raise ConfigError("伙伴招募场景不存在")
        if set(story_defaults.get("boss_outcomes", {})) - boss_ids:
            raise ConfigError("默认 Boss 结果包含未知 ID")

    @staticmethod
    def _unique_story_ids(
        entries: List[Mapping[str, Any]],
        id_field: str,
    ) -> Set[str]:
        """读取剧情目录的稳定 ID，并拒绝空值与重复。"""

        identifiers: Set[str] = set()
        for entry in entries:
            if not isinstance(entry, Mapping):
                raise ConfigError("剧情目录条目必须是对象")
            identifier = entry.get(id_field)
            if not isinstance(identifier, str) or not identifier:
                raise ConfigError("剧情目录缺少 {}".format(id_field))
            if identifier in identifiers:
                raise ConfigError("剧情目录 ID 重复：{}".format(identifier))
            identifiers.add(identifier)
        return identifiers

    @classmethod
    def _validate_story_requirements(
        cls,
        requirements: Any,
        location: str,
    ) -> None:
        """递归校验剧情条件使用已支持的类型与基本字段。"""

        allowed_types = {
            "attribute",
            "computed_attribute",
            "scene_completed",
            "flag",
            "flag_absent",
            "key_item",
            "any_key_item",
            "boss_resolved",
            "boss_outcome_any",
            "facility_level",
            "any_of",
            "all_of",
        }
        if not isinstance(requirements, list):
            raise ConfigError("{} 的 requirements 必须是列表".format(location))
        for requirement in requirements:
            if not isinstance(requirement, Mapping):
                raise ConfigError("{} 的条件必须是对象".format(location))
            requirement_type = requirement.get("type")
            if requirement_type not in allowed_types:
                raise ConfigError(
                    "{} 使用未知条件 {}".format(location, requirement_type)
                )
            if requirement_type in {"any_of", "all_of"}:
                nested = requirement.get("requirements")
                if not isinstance(nested, list) or not nested:
                    raise ConfigError("any_of 必须包含非空 requirements")
                cls._validate_story_requirements(nested, location)

    @staticmethod
    def _validate_story_effects(effects: Any, location: str) -> None:
        """校验剧情数值效果的目标、操作和固定或随机数值。"""

        allowed_roots = {
            "player",
            "shelter",
            "story",
            "companion",
            "battle",
            "rules",
        }
        if not isinstance(effects, list):
            raise ConfigError("{} 的 effects 必须是列表".format(location))
        for effect in effects:
            if not isinstance(effect, Mapping):
                raise ConfigError("{} 的效果必须是对象".format(location))
            target = effect.get("target")
            if not isinstance(target, str) or target.split(".")[0] not in allowed_roots:
                raise ConfigError("{} 的效果目标无效".format(location))
            if effect.get("operation") not in {"add", "subtract", "set"}:
                raise ConfigError("{} 的效果操作无效".format(location))
            amount = effect.get("amount")
            valid_range = (
                isinstance(amount, list)
                and len(amount) == 2
                and all(_is_integer(value) for value in amount)
                and amount[0] <= amount[1]
            )
            if not (_is_integer(amount) or valid_range):
                raise ConfigError("{} 的效果数值无效".format(location))

    @classmethod
    def _validate_event_config(cls, data: Mapping[str, Any]) -> None:
        """深度检查事件、选择、结果、条件和数值效果结构。"""

        if data.get("schema_version") != 1:
            raise ConfigError("不支持的事件配置版本")
        events = data.get("events")
        if not isinstance(events, list) or not events:
            raise ConfigError("事件配置至少需要一个事件")
        event_ids: Set[str] = set()
        for event in events:
            if not isinstance(event, Mapping):
                raise ConfigError("每个事件必须是对象")
            event_id = event.get("id")
            if not isinstance(event_id, str) or not event_id or event_id in event_ids:
                raise ConfigError("事件 ID 必须存在且不能重复")
            event_ids.add(event_id)
            if not _is_integer(event.get("weight")) or event["weight"] <= 0:
                raise ConfigError("事件 {} 的权重必须为正整数".format(event_id))
            if event.get("category", "common") not in {
                "common",
                "discovery",
                "ambush",
            }:
                raise ConfigError("事件 {} 的分类无效".format(event_id))
            if not isinstance(event.get("title"), str) or not isinstance(
                event.get("intro"), str
            ):
                raise ConfigError("事件 {} 缺少标题或介绍".format(event_id))
            if "pre_result" in event and not isinstance(event["pre_result"], str):
                raise ConfigError("事件 {} 的 pre_result 必须是字符串".format(event_id))
            cls._validate_effects(event.get("pre_effects", []), event_id)
            pre_tokens = cls._effect_tokens(event.get("pre_effects", []))
            if "pre_result" in event:
                cls._validate_template(event["pre_result"], pre_tokens, event_id)
            cls._validate_event_payload(
                event,
                event_id,
                is_root=True,
                inherited_tokens=pre_tokens,
            )

    @classmethod
    def _validate_event_payload(
        cls,
        payload: Mapping[str, Any],
        event_id: str,
        is_root: bool = False,
        inherited_tokens: Set[str] = None,
    ) -> None:
        """递归验证事件根、选择分支与随机结果叶节点。"""

        cls._validate_effects(payload.get("effects", []), event_id)
        cls._validate_requirements(payload.get("requirements", []), event_id)
        available_tokens = set(inherited_tokens or set())
        available_tokens.update(cls._effect_tokens(payload.get("effects", [])))
        choices = payload.get("choices")
        outcomes = payload.get("outcomes")
        if choices is not None:
            if not isinstance(choices, list) or not choices:
                raise ConfigError("事件 {} 的 choices 必须是非空列表".format(event_id))
            choice_ids: Set[str] = set()
            for choice in choices:
                if not isinstance(choice, Mapping):
                    raise ConfigError("事件 {} 的选择必须是对象".format(event_id))
                choice_id = choice.get("id")
                if (
                    not isinstance(choice_id, str)
                    or not choice_id
                    or choice_id in choice_ids
                ):
                    raise ConfigError("事件 {} 的选择 ID 无效".format(event_id))
                choice_ids.add(choice_id)
                if not isinstance(choice.get("label"), str):
                    raise ConfigError("事件 {} 的选择缺少标签".format(event_id))
                cls._validate_event_payload(
                    choice,
                    event_id,
                    inherited_tokens=available_tokens,
                )
            return
        if outcomes is not None:
            if not isinstance(outcomes, list) or not outcomes:
                raise ConfigError("事件 {} 的 outcomes 必须是非空列表".format(event_id))
            for outcome in outcomes:
                if not isinstance(outcome, Mapping):
                    raise ConfigError("事件 {} 的随机结果必须是对象".format(event_id))
                if not _is_integer(outcome.get("weight")) or outcome["weight"] <= 0:
                    raise ConfigError("事件 {} 的结果权重无效".format(event_id))
                cls._validate_event_payload(
                    outcome,
                    event_id,
                    inherited_tokens=available_tokens,
                )
            return
        if not isinstance(payload.get("result"), str):
            location = "根事件" if is_root else "事件分支"
            raise ConfigError("{} {} 缺少结果文案".format(location, event_id))
        cls._validate_template(payload["result"], available_tokens, event_id)

    @staticmethod
    def _effect_tokens(effects: Any) -> Set[str]:
        """收集一组已验证事件效果对结果文案公开的变量名。"""

        return {
            effect["token"]
            for effect in effects
            if isinstance(effect, Mapping) and isinstance(effect.get("token"), str)
        }

    @staticmethod
    def _validate_template(
        template: str, available_tokens: Set[str], event_id: str
    ) -> None:
        """验证事件文案格式语法以及所有占位符均有对应效果变量。"""

        try:
            fields = {
                field_name
                for _, field_name, _, _ in Formatter().parse(template)
                if field_name is not None
            }
        except ValueError as error:
            raise ConfigError("事件 {} 的文案格式无效".format(event_id)) from error
        unknown_fields = fields - available_tokens
        if unknown_fields:
            raise ConfigError(
                "事件 {} 的文案引用未知变量：{}".format(
                    event_id,
                    ", ".join(sorted(unknown_fields)),
                )
            )

    @staticmethod
    def _validate_effects(effects: Any, event_id: str) -> None:
        """验证事件效果目标、运算、数值区间与可选限制。"""

        if not isinstance(effects, list):
            raise ConfigError("事件 {} 的 effects 必须是列表".format(event_id))
        for effect in effects:
            if not isinstance(effect, Mapping):
                raise ConfigError("事件 {} 的 effect 必须是对象".format(event_id))
            ConfigLoader._validate_target(effect.get("target"), event_id)
            operation = effect.get("operation")
            if operation not in {"add", "subtract", "set"}:
                raise ConfigError("事件 {} 的操作无效".format(event_id))
            amount = effect.get("amount")
            valid_range = (
                isinstance(amount, list)
                and len(amount) == 2
                and all(_is_integer(item) for item in amount)
                and 0 <= amount[0] <= amount[1]
            )
            if not ((_is_integer(amount) and amount >= 0) or valid_range):
                raise ConfigError("事件 {} 的 amount 无效".format(event_id))
            if "token" in effect and not isinstance(effect["token"], str):
                raise ConfigError("事件 {} 的 token 必须是字符串".format(event_id))
            if "limit_to_available" in effect:
                if not isinstance(effect["limit_to_available"], bool):
                    raise ConfigError(
                        "事件 {} 的可用量限制必须是布尔值".format(event_id)
                    )
                if operation != "subtract":
                    raise ConfigError("可用量限制只能用于 subtract 操作")

    @staticmethod
    def _validate_requirements(requirements: Any, event_id: str) -> None:
        """验证事件分支的资源条件结构。"""

        if not isinstance(requirements, list):
            raise ConfigError("事件 {} 的 requirements 必须是列表".format(event_id))
        for requirement in requirements:
            if not isinstance(requirement, Mapping):
                raise ConfigError("事件 {} 的 requirement 必须是对象".format(event_id))
            ConfigLoader._validate_target(requirement.get("target"), event_id)
            if requirement.get("operator") not in {"gte", "lte", "eq"}:
                raise ConfigError("事件 {} 的条件运算无效".format(event_id))
            if not _is_integer(requirement.get("value")):
                raise ConfigError("事件 {} 的条件值必须是整数".format(event_id))

    @staticmethod
    def _validate_target(target: Any, event_id: str) -> None:
        """验证事件只能访问白名单中的玩家或避难所整数属性。"""

        if not isinstance(target, str) or "." not in target:
            raise ConfigError("事件 {} 的目标格式无效".format(event_id))
        root, attribute = target.split(".", 1)
        if root == "player" and attribute in PLAYER_EFFECT_FIELDS:
            return
        if root == "shelter" and attribute in SHELTER_EFFECT_FIELDS:
            return
        raise ConfigError("事件 {} 的目标不受支持：{}".format(event_id, target))

    @staticmethod
    def _validate_city_references(
        data: Mapping[str, Any],
        event_map: Mapping[str, Mapping[str, Any]],
    ) -> None:
        """保证正常启动和无窗口自检使用完全相同的城市事件引用校验。"""

        for city in data["cities"]:
            for event_id in city["event_ids"]:
                if event_id not in event_map:
                    raise ConfigError(
                        "城市 {} 引用了未知事件 {}".format(city["id"], event_id)
                    )
