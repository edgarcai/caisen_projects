import type {
  ShelterAssignmentOption,
  ShelterFloorView,
  ShelterLayoutConfig,
  ShelterLayoutView,
  ShelterRequirementView,
  ShelterRoomView,
} from "../../domain/shelter-layout";
import type { GameUiConfig } from "../../styles/GameTheme";
import type { ResponsiveLayout } from "../../styles/ResponsiveLayout";
import type { UiFactory } from "../components/UiFactory";
import type { LayaRuntimeLike } from "../laya/LayaRuntime";
import type { UiOptionView, UiPromptView } from "../ports/GameUiPort";
import { createChoicePage } from "./ChoicePage";
import { PageScaffold, type PageView } from "./PageView";

/** 横切面首页可发出的导航意图。 */
export interface ShelterMapActions {
  readonly back: () => void;
  readonly openRoom: (roomId: string) => void;
}

/** 单个房间人员规划页可发出的领域意图。 */
export interface ShelterRoomPlanningActions {
  readonly back: () => void;
  readonly changeAssignment: (
    residentId: string,
    targetRoomId: string | null,
  ) => void;
}

/** 横切面中一个房间的纯几何结果。 */
export interface ShelterMapRoomGeometry {
  readonly roomId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 横切面中一层房间的纯几何结果。 */
export interface ShelterMapFloorGeometry {
  readonly floorId: string;
  readonly y: number;
  readonly height: number;
  readonly labelY: number;
  readonly rooms: readonly ShelterMapRoomGeometry[];
}

/** 整个横切面在滚动内容中的纯几何结果。 */
export interface ShelterMapGeometry {
  readonly width: number;
  readonly height: number;
  readonly floors: readonly ShelterMapFloorGeometry[];
}

/**
 * 按桌面网格或手机单列规则计算横切面，不依赖 Laya 显示树。
 */
export function resolveShelterMapGeometry(
  config: ShelterLayoutConfig,
  view: ShelterLayoutView,
  contentWidth: number,
  usesCompactUi: boolean,
): ShelterMapGeometry {
  const layout = config.layout;
  const roomGap = layout.room_gap;
  const floorPadding = layout.floor_padding;
  const roomHeight = usesCompactUi
    ? layout.mobile_room_height
    : layout.desktop_room_height;
  let cursorY = 0;
  const floors = view.floors.map((floor) => {
    const geometry = usesCompactUi
      ? resolveCompactFloorGeometry(
          floor,
          contentWidth,
          cursorY,
          roomHeight,
          layout.floor_label_height,
          floorPadding,
          roomGap,
        )
      : resolveDesktopFloorGeometry(
          config,
          floor,
          contentWidth,
          cursorY,
          roomHeight,
        );
    cursorY += geometry.height + layout.floor_gap;
    return geometry;
  });
  return {
    width: contentWidth,
    height: Math.max(0, cursorY - layout.floor_gap),
    floors,
  };
}

/** 创建可滚动、可点击房间的避难所横切面页。 */
export function createShelterMapPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  uiConfig: GameUiConfig,
  layout: ResponsiveLayout,
  shelterConfig: ShelterLayoutConfig,
  view: ShelterLayoutView,
  actions: ShelterMapActions,
): PageView {
  const page = new PageScaffold(
    runtime,
    factory,
    uiConfig,
    layout,
    "page-shelter-map",
    view.title,
    actions.back,
    [{
      id: "back",
      testId: "page-shelter-map-back",
      label: shelterConfig.copy.back_label,
      onClick: actions.back,
    }],
  );
  const summary = factory.autoText(page.content, {
    testId: "page-shelter-map-summary",
    text: buildShelterMapSummary(shelterConfig, view),
    x: 0,
    y: 0,
    width: page.contentWidth,
    fontSize: uiConfig.typography.body_size,
  });
  const summaryHeight = Math.max(
    summary.height,
    shelterConfig.layout.summary_min_height,
  );
  const mapTop = summaryHeight + layout.sectionGap;
  const geometry = resolveShelterMapGeometry(
    shelterConfig,
    view,
    page.contentWidth,
    layout.usesCompactUi,
  );
  renderShelterFloors(
    factory,
    uiConfig,
    shelterConfig,
    page,
    view,
    geometry,
    mapTop,
    actions,
  );
  const rosterTop = mapTop + geometry.height + layout.sectionGap;
  const roster = factory.autoText(page.content, {
    testId: "page-shelter-map-unassigned",
    text: formatShelterTemplate(shelterConfig.copy.unassigned_roster_format, {
      names: view.unassignedResidents.length === 0
        ? shelterConfig.copy.empty_residents
        : view.unassignedResidents
            .map((resident) => resident.name)
            .join(shelterConfig.copy.list_separator),
    }),
    x: 0,
    y: rosterTop,
    width: page.contentWidth,
    fontSize: uiConfig.typography.body_size,
    color: view.unassignedResidents.length > 0
      ? uiConfig.theme.warning
      : uiConfig.theme.muted_text,
  });
  page.scroll.setContentHeight(
    rosterTop
      + Math.max(roster.height, shelterConfig.layout.roster_min_height)
      + layout.sectionGap,
  );
  return page;
}

/**
 * 创建一个房间的人员调度页，当前成员点击后移出，其余成员调入。
 */
export function createShelterRoomPlanningPage(
  runtime: LayaRuntimeLike,
  factory: UiFactory,
  uiConfig: GameUiConfig,
  layout: ResponsiveLayout,
  shelterConfig: ShelterLayoutConfig,
  room: ShelterRoomView,
  options: readonly ShelterAssignmentOption[],
  actions: ShelterRoomPlanningActions,
): PageView {
  return createChoicePage(runtime, factory, uiConfig, layout, {
    testId: "page-shelter-room-planning",
    title: formatShelterTemplate(shelterConfig.copy.room_planning_title_format, {
      name: room.name,
    }),
    prompt: buildShelterRoomPlanningPrompt(shelterConfig, room, options),
    onBack: actions.back,
    onSelect: (option): void => {
      const assignment = options.find(
        (candidate) => candidate.residentId === option.id,
      );
      if (assignment === undefined) return;
      actions.changeAssignment(
        assignment.residentId,
        assignment.assignedToTarget ? null : room.roomId,
      );
    },
  });
}

/** 组装横切面首部概览、说明与调度建议。 */
export function buildShelterMapSummary(
  config: ShelterLayoutConfig,
  view: ShelterLayoutView,
): string {
  const summary = formatShelterTemplate(config.copy.map_summary_format, {
    assigned: view.assignedCount,
    active: view.activeCount,
    unassigned: view.unassignedResidents.length,
    harmony: view.harmony,
    harmony_label: view.harmonyLabel,
  });
  return [
    summary,
    view.description,
    view.advice.join(config.copy.advice_separator),
  ].filter((text) => text.trim().length > 0).join(config.copy.section_separator);
}

/** 将房间状态、需求和人员偏好投影为通用选择页。 */
export function buildShelterRoomPlanningPrompt(
  config: ShelterLayoutConfig,
  room: ShelterRoomView,
  assignments: readonly ShelterAssignmentOption[],
): UiPromptView {
  return {
    id: `shelter-room-${room.roomId}`,
    title: formatShelterTemplate(config.copy.room_planning_title_format, {
      name: room.name,
    }),
    body: [
      config.copy.room_planning_body,
      buildShelterRoomDetail(config, room),
    ].join(config.copy.section_separator),
    options: assignments.map((assignment): UiOptionView => ({
      id: assignment.residentId,
      label: formatShelterTemplate(config.copy.resident_option_format, {
        name: assignment.residentName,
        gender: config.copy.gender_labels[assignment.gender],
        action: assignment.assignedToTarget
          ? config.copy.remove_action
          : config.copy.assign_action,
      }),
      description: formatShelterTemplate(config.copy.resident_option_detail_format, {
        likes: displayList(
          assignment.likesNames,
          config.copy.empty_preferences,
          config.copy.list_separator,
        ),
        dislikes: displayList(
          assignment.dislikesNames,
          config.copy.empty_preferences,
          config.copy.list_separator,
        ),
        current_room: assignment.currentRoomName ?? config.copy.unassigned_label,
        preference_note: assignment.preferenceNote,
      }),
      disabled: !assignment.available,
      disabledReason: assignment.unavailableReason || undefined,
      tone: assignment.assignedToTarget ? "warning" : "primary",
    })),
  };
}

/** 组装房间功能、容量、需求、和谐度与建议。 */
export function buildShelterRoomDetail(
  config: ShelterLayoutConfig,
  room: ShelterRoomView,
): string {
  const requirements = [
    config.copy.unlock_requirements_title,
    requirementList(config, room.unlockRequirements),
    config.copy.expansion_requirements_title,
    room.nextExpansionRequirements.length === 0
      ? room.expansionLabel
      : requirementList(config, room.nextExpansionRequirements),
  ].join(config.copy.advice_separator);
  return formatShelterTemplate(config.copy.room_detail_format, {
    function: room.function,
    level: room.levelLabel,
    residents: displayList(
      room.residentNames,
      config.copy.empty_residents,
      config.copy.list_separator,
    ),
    harmony: room.harmony,
    harmony_label: room.harmonyLabel,
    requirements,
    advice: room.advice.join(config.copy.advice_separator),
  });
}

/** 绘制所有楼层外框和可点击房间。 */
function renderShelterFloors(
  factory: UiFactory,
  uiConfig: GameUiConfig,
  shelterConfig: ShelterLayoutConfig,
  page: PageScaffold,
  view: ShelterLayoutView,
  geometry: ShelterMapGeometry,
  mapTop: number,
  actions: ShelterMapActions,
): void {
  const floorById = new Map(view.floors.map((floor) => [floor.floorId, floor]));
  const roomById = new Map(view.rooms.map((room) => [room.roomId, room]));
  geometry.floors.forEach((floorGeometry) => {
    const floor = floorById.get(floorGeometry.floorId);
    if (floor === undefined) return;
    const floorPanel = factory.panel(page.content, {
      testId: `shelter-floor-${floor.floorId}`,
      x: 0,
      y: mapTop + floorGeometry.y,
      width: geometry.width,
      height: floorGeometry.height,
      translucent: true,
    });
    factory.text(floorPanel, {
      testId: `shelter-floor-${floor.floorId}-label`,
      text: formatShelterTemplate(shelterConfig.copy.floor_label_format, {
        floor: floor.label,
        name: floor.name,
      }),
      x: shelterConfig.layout.floor_padding,
      y: floorGeometry.labelY,
      width: geometry.width - shelterConfig.layout.floor_padding * 2,
      height: shelterConfig.layout.floor_label_height,
      fontSize: uiConfig.typography.section_title_size,
      color: uiConfig.theme.accent,
      bold: true,
      valign: "middle",
    });
    floorGeometry.rooms.forEach((roomGeometry) => {
      const room = roomById.get(roomGeometry.roomId);
      if (room === undefined) return;
      factory.button(floorPanel, {
        testId: `shelter-room-${room.roomId}`,
        label: formatShelterTemplate(shelterConfig.copy.room_button_format, {
          icon: room.icon,
          name: room.name,
          occupancy: room.residentIds.length,
          capacity: room.capacity,
          status: room.statusLabel,
        }),
        x: roomGeometry.x,
        y: roomGeometry.y,
        width: roomGeometry.width,
        height: roomGeometry.height,
        tone: room.full ? "warning" : "primary",
        lockedAppearance: room.locked,
        fontSize: shelterConfig.layout.room_font_size,
        wordWrap: true,
        onClick: (): void => { actions.openRoom(room.roomId); },
      });
    });
  });
}

/** 计算手机窄屏下一层房间的单列流式布局。 */
function resolveCompactFloorGeometry(
  floor: ShelterFloorView,
  width: number,
  y: number,
  roomHeight: number,
  labelHeight: number,
  padding: number,
  gap: number,
): ShelterMapFloorGeometry {
  const roomsTop = padding + labelHeight;
  const rooms = floor.rooms.map((room, index) => ({
    roomId: room.roomId,
    x: padding,
    y: roomsTop + index * (roomHeight + gap),
    width: Math.max(0, width - padding * 2),
    height: roomHeight,
  }));
  const roomsHeight = floor.rooms.length === 0
    ? 0
    : floor.rooms.length * roomHeight + (floor.rooms.length - 1) * gap;
  return {
    floorId: floor.floorId,
    y,
    height: roomsTop + roomsHeight + padding,
    labelY: padding,
    rooms,
  };
}

/** 计算桌面端一层房间的十二列横切面布局。 */
function resolveDesktopFloorGeometry(
  config: ShelterLayoutConfig,
  floor: ShelterFloorView,
  width: number,
  y: number,
  roomHeight: number,
): ShelterMapFloorGeometry {
  const layout = config.layout;
  const columns = layout.desktop_grid_columns;
  const innerWidth = Math.max(0, width - layout.floor_padding * 2);
  const cellWidth = Math.max(
    0,
    (innerWidth - layout.room_gap * (columns - 1)) / columns,
  );
  const roomsTop = layout.floor_padding + layout.floor_label_height;
  const rooms = floor.rooms.map((room) => {
    const safeColumn = Math.min(columns, Math.max(1, room.gridColumn));
    const safeSpan = Math.min(
      columns - safeColumn + 1,
      Math.max(1, room.gridSpan),
    );
    return {
      roomId: room.roomId,
      x: layout.floor_padding
        + (safeColumn - 1) * (cellWidth + layout.room_gap),
      y: roomsTop,
      width: safeSpan * cellWidth + (safeSpan - 1) * layout.room_gap,
      height: roomHeight,
    };
  });
  return {
    floorId: floor.floorId,
    y,
    height: roomsTop + roomHeight + layout.floor_padding,
    labelY: layout.floor_padding,
    rooms,
  };
}

/** 把需求列表转换为可阅读多行文本。 */
function requirementList(
  config: ShelterLayoutConfig,
  requirements: readonly ShelterRequirementView[],
): string {
  return requirements.length === 0
    ? config.copy.no_requirement
    : requirements
        .map((requirement) => requirement.text)
        .join(config.copy.advice_separator);
}

/** 把姓名列表转换为顿号分隔文本。 */
function displayList(
  values: readonly string[],
  emptyText: string,
  separator: string,
): string {
  return values.length === 0 ? emptyText : values.join(separator);
}

/** 替换避难所页面配置文案中的稳定占位符。 */
function formatShelterTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
