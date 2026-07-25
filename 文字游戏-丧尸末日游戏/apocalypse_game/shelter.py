"""配置驱动的避难所设施、工作、交易和招募服务。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Mapping, Protocol, Sequence, Tuple

from apocalypse_game.config import GameConfig
from apocalypse_game.domain import GameState
from apocalypse_game.ports import RandomSource
from apocalypse_game.state_ops import StateOperationError, StateOperations


class ShelterManagementError(RuntimeError):
    """表示避难所经营请求未知、锁定或资源不足。"""


class RequirementChecker(Protocol):
    """隔离经营服务与具体剧情条件实现。"""

    def requirements_met(
        self,
        requirements: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> bool:
        """返回一组配置化条件是否全部满足。"""


@dataclass(frozen=True)
class ManagementOption:
    """描述界面可展示的一项经营操作及其锁定状态。"""

    option_id: str
    label: str
    category: str
    available: bool
    description: str


@dataclass(frozen=True)
class ManagementResolution:
    """描述一次经营操作是否生效、是否消耗回合及反馈文案。"""

    messages: Tuple[str, ...]
    applied: bool
    consumes_turn: bool
    turns_consumed: int = 0


class ShelterService:
    """负责设施升级、工作、市场交易、人员招募和被动规则查询。"""

    def __init__(
        self,
        config: GameConfig,
        operations: StateOperations,
        requirement_checker: RequirementChecker,
        random_source: RandomSource,
    ) -> None:
        """注入配置、状态操作器、条件检查器与可复现随机源。"""

        self._config = config
        self._story = config.story
        self._operations = operations
        self._requirements = requirement_checker
        self._random = random_source
        self._facilities = {
            item["facility_id"]: item for item in self._story["facilities"]
        }
        self._jobs = {item["job_id"]: item for item in self._story["jobs"]}
        self._trades = {item["trade_id"]: item for item in self._story["trades"]}
        self._recruits = {item["recruit_id"]: item for item in self._story["recruits"]}

    def options(self, state: GameState) -> Tuple[ManagementOption, ...]:
        """返回全部设施、工作、买卖和招募操作的实时可用状态。"""

        options: List[ManagementOption] = []
        options.extend(self._facility_options(state))
        options.extend(self._job_options(state))
        options.extend(self._trade_options(state))
        options.extend(self._recruit_options(state))
        return tuple(options)

    def perform(
        self,
        state: GameState,
        category: str,
        option_id: str,
    ) -> ManagementResolution:
        """按类别路由经营命令，并保持具体系统相互独立。"""

        handlers = {
            "facility": self._upgrade_facility,
            "job": self._perform_job,
            "trade_buy": self._buy_trade,
            "trade_sell": self._sell_trade,
            "recruit": self._recruit,
        }
        handler = handlers.get(category)
        if handler is None:
            raise ShelterManagementError("未知经营类别：{}".format(category))
        return handler(state, option_id)

    def overview(self, state: GameState) -> str:
        """生成设施等级、人口和可执行经营项目的中文总览。"""

        facility_lines = []
        for facility in self._story["facilities"]:
            level = state.facility_levels[facility["facility_id"]]
            facility_lines.append(
                "{}  Lv.{}/{}｜{}".format(
                    facility["name"],
                    level,
                    facility["max_level"],
                    facility["description"],
                )
            )
        available_count = sum(1 for option in self.options(state) if option.available)
        return "人口：{}｜当前可执行计划：{}\n\n{}".format(
            state.shelter.population,
            available_count,
            "\n".join(facility_lines),
        )

    def passive_modifier(self, state: GameState, target: str) -> int:
        """汇总设施、招募成员与同行伙伴提供的配置化规则修正。"""

        total = 0
        for facility in self._story["facilities"]:
            current_level = state.facility_levels.get(facility["facility_id"], 0)
            for level in facility["levels"]:
                if level["level"] > current_level:
                    continue
                for effect in level.get("effects", []):
                    if effect["target"] != target:
                        continue
                    amount = effect["amount"]
                    if not isinstance(amount, int):
                        continue
                    if effect["operation"] == "add":
                        total += amount
                    elif effect["operation"] == "subtract":
                        total -= amount
                    elif effect["operation"] == "set":
                        total = amount
        for recruit in self._story["recruits"]:
            if not any(flag in state.story.flags for flag in recruit["add_flags"]):
                continue
            for effect in recruit.get("effects", []):
                if effect["target"] != target or not isinstance(effect["amount"], int):
                    continue
                if effect["operation"] == "add":
                    total += effect["amount"]
                elif effect["operation"] == "subtract":
                    total -= effect["amount"]
                elif effect["operation"] == "set":
                    total = effect["amount"]
        for profile in self._story["companions"]:
            companion = state.companion(profile["companion_id"])
            if companion is None or companion.status != "active":
                continue
            for perk in profile.get("trust_perks", []):
                if companion.trust < perk["unlock_trust"]:
                    continue
                for effect in perk.get("effects", []):
                    if effect["target"] != target or not isinstance(
                        effect["amount"], int
                    ):
                        continue
                    if effect["operation"] == "add":
                        total += effect["amount"]
                    elif effect["operation"] == "subtract":
                        total -= effect["amount"]
                    elif effect["operation"] == "set":
                        total = effect["amount"]
        return total

    def _facility_options(self, state: GameState) -> List[ManagementOption]:
        """构造每项设施的下一等级升级选项。"""

        options: List[ManagementOption] = []
        for facility in self._story["facilities"]:
            facility_id = facility["facility_id"]
            current_level = state.facility_levels[facility_id]
            if current_level >= facility["max_level"]:
                options.append(
                    ManagementOption(
                        option_id=facility_id,
                        label="{}（已满级）".format(facility["name"]),
                        category="facility",
                        available=False,
                        description=facility["description"],
                    )
                )
                continue
            level = facility["levels"][current_level]
            parts_cost, coins_cost = self._facility_costs(state, level)
            available = self._requirements.requirements_met(
                facility.get("unlock_requirements", []), state
            ) and self._can_pay_facility(state, level)
            options.append(
                ManagementOption(
                    option_id=facility_id,
                    label="升级{}至 Lv.{}".format(facility["name"], level["level"]),
                    category="facility",
                    available=available,
                    description="{}｜零件 {}，金币 {}".format(
                        facility["description"],
                        parts_cost,
                        coins_cost,
                    )
                    + "｜耗时 {} 小时".format(level["build_hours"]),
                )
            )
        return options

    def _job_options(self, state: GameState) -> List[ManagementOption]:
        """构造所有配置化工作选项。"""

        return [
            ManagementOption(
                option_id=job["job_id"],
                label="工作：{}".format(job["name"]),
                category="job",
                available=self._requirements.requirements_met(
                    job.get("requirements", []), state
                )
                and self._can_pay_effects(state, job.get("costs", [])),
                description="{}｜耗时 {} 小时".format(
                    job["description"], job["duration_hours"]
                ),
            )
            for job in self._story["jobs"]
        ]

    def _trade_options(self, state: GameState) -> List[ManagementOption]:
        """为每个已解锁商品同时构造购买与出售选项。"""

        options: List[ManagementOption] = []
        for trade in self._story["trades"]:
            unlocked = self._requirements.requirements_met(
                trade.get("unlock_requirements", []), state
            )
            current = self._operations.read(trade["resource_target"], state)
            options.append(
                ManagementOption(
                    option_id=trade["trade_id"],
                    label="购买：{} ×{}".format(trade["item_name"], trade["quantity"]),
                    category="trade_buy",
                    available=unlocked
                    and state.active_player.coins
                    >= self._trade_buy_price(state, trade),
                    description="{}｜价格 {} 金币".format(
                        trade["vendor_name"], self._trade_buy_price(state, trade)
                    ),
                )
            )
            options.append(
                ManagementOption(
                    option_id=trade["trade_id"],
                    label="出售：{} ×{}".format(trade["item_name"], trade["quantity"]),
                    category="trade_sell",
                    available=unlocked and current >= trade["quantity"],
                    description="{}｜回收 {} 金币".format(
                        trade["vendor_name"], trade["sell_price"]
                    ),
                )
            )
        return options

    def _recruit_options(self, state: GameState) -> List[ManagementOption]:
        """构造人员招募选项并阻止重复招募。"""

        options: List[ManagementOption] = []
        for recruit in self._story["recruits"]:
            recruited_flag = recruit["add_flags"][0]
            already_recruited = recruited_flag in state.story.flags
            available = (
                not already_recruited
                and self._requirements.requirements_met(
                    recruit.get("requirements", []), state
                )
                and self._can_pay_effects(state, recruit.get("costs", []))
            )
            options.append(
                ManagementOption(
                    option_id=recruit["recruit_id"],
                    label="招募：{}（{}）".format(recruit["name"], recruit["role"]),
                    category="recruit",
                    available=available,
                    description=(
                        "已加入避难所" if already_recruited else recruit["description"]
                    ),
                )
            )
        return options

    def _upgrade_facility(
        self, state: GameState, facility_id: str
    ) -> ManagementResolution:
        """支付配置成本并把指定设施提升一级。"""

        facility = self._facilities.get(facility_id)
        if facility is None:
            raise ShelterManagementError("未知设施：{}".format(facility_id))
        current_level = state.facility_levels[facility_id]
        if current_level >= facility["max_level"]:
            return self._unavailable("{}已经满级。".format(facility["name"]))
        if not self._requirements.requirements_met(
            facility.get("unlock_requirements", []), state
        ):
            return self._unavailable("该设施尚未解锁。")
        level = facility["levels"][current_level]
        if not self._can_pay_facility(state, level):
            return self._unavailable("升级零件或金币不足。")
        parts_cost, coins_cost = self._facility_costs(state, level)
        state.active_player.parts -= parts_cost
        state.active_player.coins -= coins_cost
        state.facility_levels[facility_id] = level["level"]
        immediate_effects = [
            effect
            for effect in level.get("effects", [])
            if not effect["target"].startswith("rules.")
        ]
        self._apply_effects(immediate_effects, state)
        return ManagementResolution(
            messages=(
                "{}已升级至 Lv.{}，新的避难所能力开始生效。".format(
                    facility["name"], level["level"]
                ),
            ),
            applied=True,
            consumes_turn=True,
            turns_consumed=self._duration_turns(level["build_hours"]),
        )

    def _perform_job(self, state: GameState, job_id: str) -> ManagementResolution:
        """结算工作成本、随机产出和配置化风险事件。"""

        job = self._jobs.get(job_id)
        if job is None:
            raise ShelterManagementError("未知工作：{}".format(job_id))
        if not self._requirements.requirements_met(job.get("requirements", []), state):
            return self._unavailable("当前条件不能安排这项工作。")
        if not self._can_pay_effects(state, job.get("costs", [])):
            return self._unavailable("完成工作所需资源不足。")
        self._apply_effects(job.get("costs", []), state)
        self._apply_effects(job.get("rewards", []), state)
        evidence_bonus = self.passive_modifier(
            state,
            "rules.story_evidence_job_bonus",
        )
        if evidence_bonus > 0 and any(
            reward["target"] == "story.evidence" for reward in job.get("rewards", [])
        ):
            state.story.evidence += evidence_bonus
        messages = ["工作【{}】完成：{}".format(job["name"], job["description"])]
        risk = job.get("risk", {})
        if risk and self._random.randint(1, 100) <= risk["chance_percent"]:
            self._apply_effects(risk.get("effects", []), state)
            messages.append(risk["message"])
        return ManagementResolution(
            messages=tuple(messages),
            applied=True,
            consumes_turn=True,
            turns_consumed=self._duration_turns(job["duration_hours"]),
        )

    def _buy_trade(self, state: GameState, trade_id: str) -> ManagementResolution:
        """支付金币并购入一份配置化商品。"""

        trade = self._trade(trade_id)
        if not self._requirements.requirements_met(
            trade.get("unlock_requirements", []), state
        ):
            return self._unavailable("该交易商尚未与你建立联系。")
        buy_price = self._trade_buy_price(state, trade)
        if state.active_player.coins < buy_price:
            return self._unavailable("金币不足。")
        state.active_player.coins -= buy_price
        current = self._operations.read(trade["resource_target"], state)
        self._operations.write(
            trade["resource_target"], current + trade["quantity"], state
        )
        return ManagementResolution(
            messages=(
                "从{}购入{} ×{}，支付{}金币。".format(
                    trade["vendor_name"],
                    trade["item_name"],
                    trade["quantity"],
                    buy_price,
                ),
            ),
            applied=True,
            consumes_turn=False,
        )

    def _sell_trade(self, state: GameState, trade_id: str) -> ManagementResolution:
        """出售一份配置化商品并获得金币。"""

        trade = self._trade(trade_id)
        if not self._requirements.requirements_met(
            trade.get("unlock_requirements", []), state
        ):
            return self._unavailable("该交易商尚未与你建立联系。")
        current = self._operations.read(trade["resource_target"], state)
        if current < trade["quantity"]:
            return self._unavailable("可出售物资不足。")
        self._operations.write(
            trade["resource_target"], current - trade["quantity"], state
        )
        state.active_player.coins += trade["sell_price"]
        return ManagementResolution(
            messages=(
                "向{}出售{} ×{}，获得{}金币。".format(
                    trade["vendor_name"],
                    trade["item_name"],
                    trade["quantity"],
                    trade["sell_price"],
                ),
            ),
            applied=True,
            consumes_turn=False,
        )

    def _recruit(self, state: GameState, recruit_id: str) -> ManagementResolution:
        """支付招募成本、应用新成员效果并写入不可重复标记。"""

        recruit = self._recruits.get(recruit_id)
        if recruit is None:
            raise ShelterManagementError("未知招募对象：{}".format(recruit_id))
        if any(flag in state.story.flags for flag in recruit["add_flags"]):
            return self._unavailable("这名幸存者已经加入避难所。")
        if not self._requirements.requirements_met(
            recruit.get("requirements", []), state
        ):
            return self._unavailable("对方还不信任你的避难所。")
        if not self._can_pay_effects(state, recruit.get("costs", [])):
            return self._unavailable("招募所需物资不足。")
        self._apply_effects(recruit.get("costs", []), state)
        self._apply_effects(
            [
                effect
                for effect in recruit.get("effects", [])
                if not effect["target"].startswith("rules.")
            ],
            state,
        )
        for flag in recruit["add_flags"]:
            state.story.add_flag(flag)
        return ManagementResolution(
            messages=(
                "{}（{}）加入避难所：{}".format(
                    recruit["name"], recruit["role"], recruit["description"]
                ),
            ),
            applied=True,
            consumes_turn=True,
            turns_consumed=1,
        )

    def _can_pay_facility(
        self,
        state: GameState,
        level: Mapping[str, Any],
    ) -> bool:
        """检查当前所长能否支付设施升级的零件和金币。"""

        parts_cost, coins_cost = self._facility_costs(state, level)
        return (
            state.active_player.parts >= parts_cost
            and state.active_player.coins >= coins_cost
        )

    def _facility_costs(
        self,
        state: GameState,
        level: Mapping[str, Any],
    ) -> Tuple[int, int]:
        """按伙伴信任修正返回本级设施的实际零件和金币成本。"""

        parts_percent = 100 + self.passive_modifier(
            state,
            "rules.facility_parts_cost_percent",
        )
        parts_cost = max(0, level["parts_cost"] * parts_percent // 100)
        return parts_cost, level["coins_cost"]

    def _trade_buy_price(
        self,
        state: GameState,
        trade: Mapping[str, Any],
    ) -> int:
        """按设施和伙伴议价特性计算一份商品的实际买入价格。"""

        price_percent = 100 + self.passive_modifier(
            state,
            "rules.trade_buy_price_percent",
        )
        return max(1, trade["buy_price"] * price_percent // 100)

    def _duration_turns(self, duration_hours: int) -> int:
        """把配置化耗时换算为至少一个完整世界生存回合。"""

        hours_per_turn = self._config.section("rules")["time"]["hours_per_action"]
        return max(1, (duration_hours + hours_per_turn - 1) // hours_per_turn)

    def _can_pay_effects(
        self,
        state: GameState,
        effects: Sequence[Mapping[str, Any]],
    ) -> bool:
        """检查所有 subtract 成本都不会把对应资源扣为负数。"""

        for effect in effects:
            if effect["operation"] != "subtract":
                continue
            amount = effect["amount"]
            required = amount[1] if isinstance(amount, list) else amount
            try:
                current = self._operations.read(effect["target"], state)
            except StateOperationError:
                return False
            if current < required:
                return False
        return True

    def _apply_effects(
        self,
        effects: Sequence[Mapping[str, Any]],
        state: GameState,
    ) -> None:
        """应用经营效果，并把状态目标错误转换为经营层异常。"""

        try:
            self._operations.apply_effects(effects, state)
        except StateOperationError as error:
            raise ShelterManagementError(
                "经营效果无法应用：{}".format(error)
            ) from error

    def _trade(self, trade_id: str) -> Mapping[str, Any]:
        """按稳定 ID 获取交易配置。"""

        trade = self._trades.get(trade_id)
        if trade is None:
            raise ShelterManagementError("未知交易：{}".format(trade_id))
        return trade

    @staticmethod
    def _unavailable(message: str) -> ManagementResolution:
        """构造不改变状态也不消耗回合的经营失败报告。"""

        return ManagementResolution(
            messages=(message,),
            applied=False,
            consumes_turn=False,
        )
