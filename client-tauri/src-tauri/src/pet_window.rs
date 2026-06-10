use serde::{Deserialize, Serialize};

use crate::windows::pet_window_plan;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PetWindowMode {
    BodyOnly,
    Card,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowPlacementPlan {
    pub label: String,
    pub route: String,
    pub mode: PetWindowMode,
    pub position: LogicalPosition,
    pub size: LogicalSize,
    pub margin: u32,
    pub focus: bool,
    pub transparent: bool,
    pub decorations: bool,
    pub always_on_top: bool,
    pub skip_taskbar: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowSettings {
    pub scale_percent: u16,
    pub opacity_percent: u8,
    pub pass_through: bool,
    pub hide_on_hover: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowVisualSettingsPlan {
    pub label: String,
    pub scale_percent: u16,
    pub opacity_percent: u8,
    pub pass_through: bool,
    pub hide_on_hover: bool,
    pub focus: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowPointerInput {
    pub cursor: LogicalPosition,
    pub window: LogicalRect,
    pub near_radius: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowPointerDecision {
    pub inside_window: bool,
    pub cursor_near: bool,
    pub distance_to_window_px: u32,
    pub look_x_percent: i16,
    pub look_y_percent: i16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PetWindowDragAction {
    StartDragging,
    SavePosition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowDragPlan {
    pub label: String,
    pub action: PetWindowDragAction,
    pub focus: bool,
    pub animation_action: String,
}

pub const DEFAULT_PET_WINDOW_MARGIN: u32 = 24;
pub const DEFAULT_PET_CURSOR_NEAR_RADIUS: u32 = 72;
pub const DEFAULT_PET_WINDOW_SCALE_PERCENT: u16 = 100;
pub const DEFAULT_PET_WINDOW_OPACITY_PERCENT: u8 = 100;
pub const PET_BODY_ONLY_SIZE: LogicalSize = LogicalSize {
    width: 260,
    height: 340,
};
pub const PET_CARD_SIZE: LogicalSize = LogicalSize {
    width: 520,
    height: 640,
};

impl Default for PetWindowSettings {
    fn default() -> Self {
        Self {
            scale_percent: DEFAULT_PET_WINDOW_SCALE_PERCENT,
            opacity_percent: DEFAULT_PET_WINDOW_OPACITY_PERCENT,
            pass_through: false,
            hide_on_hover: false,
        }
    }
}

pub fn pet_window_size(mode: PetWindowMode) -> LogicalSize {
    match mode {
        PetWindowMode::BodyOnly => PET_BODY_ONLY_SIZE,
        PetWindowMode::Card => PET_CARD_SIZE,
    }
}

pub fn pet_window_size_with_scale(mode: PetWindowMode, scale_percent: u16) -> LogicalSize {
    let size = pet_window_size(mode);
    let scale_percent = normalize_pet_window_scale_percent(scale_percent);
    LogicalSize {
        width: scaled_dimension(size.width, scale_percent),
        height: scaled_dimension(size.height, scale_percent),
    }
}

pub fn pet_window_size_for_settings(
    mode: PetWindowMode,
    settings: PetWindowSettings,
) -> LogicalSize {
    pet_window_size_with_scale(mode, settings.scale_percent)
}

pub fn default_pet_window_placement(work_area: LogicalRect) -> PetWindowPlacementPlan {
    default_pet_window_placement_with_settings(work_area, PetWindowSettings::default())
}

pub fn default_pet_window_placement_with_settings(
    work_area: LogicalRect,
    settings: PetWindowSettings,
) -> PetWindowPlacementPlan {
    place_pet_window_bottom_right(
        work_area,
        PetWindowMode::BodyOnly,
        DEFAULT_PET_WINDOW_MARGIN,
        settings,
    )
}

pub fn place_pet_window_bottom_right(
    work_area: LogicalRect,
    mode: PetWindowMode,
    margin: u32,
    settings: PetWindowSettings,
) -> PetWindowPlacementPlan {
    let size = pet_window_size_for_settings(mode, settings);
    let x = work_area.x + work_area.width as i32 - size.width as i32 - margin as i32;
    let y = work_area.y + work_area.height as i32 - size.height as i32 - margin as i32;
    pet_window_placement(
        mode,
        clamp_position(LogicalPosition { x, y }, size, work_area, margin),
        size,
        margin,
    )
}

pub fn place_pet_window_from_body_anchor(
    work_area: LogicalRect,
    body_position: LogicalPosition,
    mode: PetWindowMode,
    margin: u32,
    settings: PetWindowSettings,
) -> PetWindowPlacementPlan {
    let body_size = pet_window_size_for_settings(PetWindowMode::BodyOnly, settings);
    let size = pet_window_size_for_settings(mode, settings);
    let bottom_right_x = body_position.x + body_size.width as i32;
    let bottom_right_y = body_position.y + body_size.height as i32;
    let position = match mode {
        PetWindowMode::BodyOnly => body_position,
        PetWindowMode::Card => LogicalPosition {
            x: bottom_right_x - size.width as i32,
            y: bottom_right_y - size.height as i32,
        },
    };

    pet_window_placement(
        mode,
        clamp_position(position, size, work_area, margin),
        size,
        margin,
    )
}

pub fn clamp_position(
    position: LogicalPosition,
    size: LogicalSize,
    work_area: LogicalRect,
    margin: u32,
) -> LogicalPosition {
    let margin = margin as i32;
    let min_x = work_area.x + margin;
    let min_y = work_area.y + margin;
    let max_x = work_area.x + work_area.width as i32 - size.width as i32 - margin;
    let max_y = work_area.y + work_area.height as i32 - size.height as i32 - margin;

    LogicalPosition {
        x: clamp_axis(position.x, min_x, max_x),
        y: clamp_axis(position.y, min_y, max_y),
    }
}

pub fn pet_pointer_decision(input: PetWindowPointerInput) -> PetWindowPointerDecision {
    let distance = distance_to_rect(input.cursor, input.window);
    PetWindowPointerDecision {
        inside_window: distance == 0,
        cursor_near: distance <= input.near_radius,
        distance_to_window_px: distance,
        look_x_percent: pointer_axis_percent(
            input.cursor.x,
            input.window.x,
            input.window.width,
            input.near_radius,
        ),
        look_y_percent: pointer_axis_percent(
            input.cursor.y,
            input.window.y,
            input.window.height,
            input.near_radius,
        ),
    }
}

pub fn start_pet_window_drag_plan() -> PetWindowDragPlan {
    PetWindowDragPlan {
        label: pet_window_plan().label,
        action: PetWindowDragAction::StartDragging,
        focus: false,
        animation_action: "drag_hold".to_string(),
    }
}

pub fn save_pet_window_position_plan() -> PetWindowDragPlan {
    PetWindowDragPlan {
        label: pet_window_plan().label,
        action: PetWindowDragAction::SavePosition,
        focus: false,
        animation_action: "idle_breathe".to_string(),
    }
}

pub fn normalize_pet_window_settings(settings: PetWindowSettings) -> PetWindowSettings {
    PetWindowSettings {
        scale_percent: normalize_pet_window_scale_percent(settings.scale_percent),
        opacity_percent: normalize_pet_window_opacity_percent(settings.opacity_percent),
        pass_through: settings.pass_through,
        hide_on_hover: settings.hide_on_hover,
    }
}

pub fn pet_window_visual_settings_plan(settings: PetWindowSettings) -> PetWindowVisualSettingsPlan {
    let settings = normalize_pet_window_settings(settings);
    PetWindowVisualSettingsPlan {
        label: pet_window_plan().label,
        scale_percent: settings.scale_percent,
        opacity_percent: settings.opacity_percent,
        pass_through: settings.pass_through,
        hide_on_hover: settings.hide_on_hover,
        focus: false,
    }
}

fn pet_window_placement(
    mode: PetWindowMode,
    position: LogicalPosition,
    size: LogicalSize,
    margin: u32,
) -> PetWindowPlacementPlan {
    let window = pet_window_plan();
    PetWindowPlacementPlan {
        label: window.label,
        route: window.route,
        mode,
        position,
        size,
        margin,
        focus: false,
        transparent: window.transparent,
        decorations: window.decorations,
        always_on_top: window.always_on_top,
        skip_taskbar: window.skip_taskbar,
    }
}

fn clamp_axis(value: i32, min: i32, max: i32) -> i32 {
    if max < min {
        return min;
    }
    value.clamp(min, max)
}

fn normalize_pet_window_scale_percent(value: u16) -> u16 {
    match value {
        75 | 100 | 125 | 150 => value,
        _ => DEFAULT_PET_WINDOW_SCALE_PERCENT,
    }
}

fn normalize_pet_window_opacity_percent(value: u8) -> u8 {
    match value {
        60 | 80 | 100 => value,
        _ => DEFAULT_PET_WINDOW_OPACITY_PERCENT,
    }
}

fn scaled_dimension(value: u32, scale_percent: u16) -> u32 {
    ((value * scale_percent as u32) + 50) / 100
}

fn distance_to_rect(point: LogicalPosition, rect: LogicalRect) -> u32 {
    let right = rect.x + rect.width as i32;
    let bottom = rect.y + rect.height as i32;
    let dx = if point.x < rect.x {
        rect.x - point.x
    } else if point.x > right {
        point.x - right
    } else {
        0
    };
    let dy = if point.y < rect.y {
        rect.y - point.y
    } else if point.y > bottom {
        point.y - bottom
    } else {
        0
    };
    (((dx * dx + dy * dy) as f64).sqrt().round()) as u32
}

fn pointer_axis_percent(cursor: i32, origin: i32, size: u32, near_radius: u32) -> i16 {
    let half_size = (size as f64 / 2.0).max(1.0);
    let center = origin as f64 + half_size;
    let radius = half_size + near_radius as f64;
    (((cursor as f64 - center) / radius) * 100.0)
        .round()
        .clamp(-100.0, 100.0) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    fn primary_work_area() -> LogicalRect {
        LogicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        }
    }

    #[test]
    fn body_only_pet_defaults_to_visible_bottom_right() {
        let plan = default_pet_window_placement(primary_work_area());

        assert_eq!(plan.label, "pet");
        assert_eq!(plan.route, "/pet.html");
        assert_eq!(plan.mode, PetWindowMode::BodyOnly);
        assert_eq!(plan.size, PET_BODY_ONLY_SIZE);
        assert_eq!(plan.position, LogicalPosition { x: 1636, y: 676 });
        assert_eq!(plan.focus, false);
        assert_eq!(plan.transparent, true);
        assert_eq!(plan.decorations, false);
        assert_eq!(plan.always_on_top, true);
        assert_eq!(plan.skip_taskbar, true);
    }

    #[test]
    fn card_mode_expands_left_and_up_from_body_anchor() {
        let body = LogicalPosition { x: 1600, y: 650 };
        let plan = place_pet_window_from_body_anchor(
            primary_work_area(),
            body,
            PetWindowMode::Card,
            24,
            PetWindowSettings::default(),
        );

        assert_eq!(plan.mode, PetWindowMode::Card);
        assert_eq!(plan.size, PET_CARD_SIZE);
        assert_eq!(plan.position, LogicalPosition { x: 1340, y: 350 });
    }

    #[test]
    fn window_settings_scale_the_body_and_card_without_losing_anchor() {
        let settings = PetWindowSettings {
            scale_percent: 125,
            opacity_percent: 80,
            pass_through: true,
            hide_on_hover: true,
        };
        let body = LogicalPosition { x: 1500, y: 500 };
        let body_plan = place_pet_window_from_body_anchor(
            primary_work_area(),
            body,
            PetWindowMode::BodyOnly,
            24,
            settings,
        );
        let card_plan = place_pet_window_from_body_anchor(
            primary_work_area(),
            body,
            PetWindowMode::Card,
            24,
            settings,
        );
        let visual = pet_window_visual_settings_plan(settings);

        assert_eq!(
            body_plan.size,
            LogicalSize {
                width: 325,
                height: 425
            }
        );
        assert_eq!(
            card_plan.size,
            LogicalSize {
                width: 650,
                height: 800
            }
        );
        assert_eq!(card_plan.position, LogicalPosition { x: 1175, y: 125 });
        assert_eq!(visual.scale_percent, 125);
        assert_eq!(visual.opacity_percent, 80);
        assert_eq!(visual.pass_through, true);
        assert_eq!(visual.hide_on_hover, true);
        assert_eq!(visual.focus, false);
    }

    #[test]
    fn placement_clamps_to_work_area_when_saved_position_is_offscreen() {
        let plan = place_pet_window_from_body_anchor(
            LogicalRect {
                x: 100,
                y: 50,
                width: 800,
                height: 600,
            },
            LogicalPosition { x: -400, y: 2000 },
            PetWindowMode::BodyOnly,
            24,
            PetWindowSettings::default(),
        );

        assert_eq!(plan.position, LogicalPosition { x: 124, y: 286 });
    }

    #[test]
    fn pointer_decision_marks_inside_and_near_without_expanding_click_area() {
        let window = LogicalRect {
            x: 100,
            y: 100,
            width: 260,
            height: 340,
        };

        let inside = pet_pointer_decision(PetWindowPointerInput {
            cursor: LogicalPosition { x: 120, y: 130 },
            window,
            near_radius: DEFAULT_PET_CURSOR_NEAR_RADIUS,
        });
        let nearby = pet_pointer_decision(PetWindowPointerInput {
            cursor: LogicalPosition { x: 420, y: 470 },
            window,
            near_radius: DEFAULT_PET_CURSOR_NEAR_RADIUS,
        });
        let far = pet_pointer_decision(PetWindowPointerInput {
            cursor: LogicalPosition { x: 600, y: 600 },
            window,
            near_radius: DEFAULT_PET_CURSOR_NEAR_RADIUS,
        });

        assert_eq!(inside.inside_window, true);
        assert_eq!(inside.cursor_near, true);
        assert_eq!(inside.look_x_percent, -54);
        assert_eq!(inside.look_y_percent, -58);
        assert_eq!(nearby.inside_window, false);
        assert_eq!(nearby.cursor_near, true);
        assert_eq!(nearby.look_x_percent, 94);
        assert_eq!(nearby.look_y_percent, 83);
        assert_eq!(far.cursor_near, false);
        assert_eq!(far.look_x_percent, 100);
        assert_eq!(far.look_y_percent, 100);
    }

    #[test]
    fn drag_plans_never_steal_focus_and_map_to_cuu_actions() {
        let start = start_pet_window_drag_plan();
        let save = save_pet_window_position_plan();

        assert_eq!(start.label, "pet");
        assert_eq!(start.action, PetWindowDragAction::StartDragging);
        assert_eq!(start.focus, false);
        assert_eq!(start.animation_action, "drag_hold");
        assert_eq!(save.action, PetWindowDragAction::SavePosition);
        assert_eq!(save.animation_action, "idle_breathe");
    }
}
