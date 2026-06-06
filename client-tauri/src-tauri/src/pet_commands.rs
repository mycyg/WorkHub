use serde::{Deserialize, Serialize};

use crate::pet_window::{
    clamp_position, default_pet_window_placement, pet_pointer_decision, pet_window_size,
    place_pet_window_from_body_anchor, save_pet_window_position_plan, start_pet_window_drag_plan,
    LogicalPosition, LogicalRect, PetWindowDragPlan, PetWindowMode, PetWindowPlacementPlan,
    PetWindowPointerDecision, PetWindowPointerInput, DEFAULT_PET_WINDOW_MARGIN,
};

pub const SET_PET_WINDOW_MODE_COMMAND: &str = "set_pet_window_mode";
pub const START_PET_WINDOW_DRAG_COMMAND: &str = "start_pet_window_drag";
pub const SAVE_PET_WINDOW_POSITION_COMMAND: &str = "save_pet_window_position";
pub const SAMPLE_PET_CURSOR_NEAR_COMMAND: &str = "sample_pet_cursor_near";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowModeCommandInput {
    pub mode: PetWindowMode,
    pub work_area: LogicalRect,
    pub body_position: Option<LogicalPosition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowSavePositionCommandInput {
    pub position: LogicalPosition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowRuntimeCommandPlan {
    pub command: String,
    pub label: String,
    pub focus: bool,
    pub placement: Option<PetWindowPlacementPlan>,
    pub drag: Option<PetWindowDragPlan>,
    pub saved_position: Option<LogicalPosition>,
    pub pointer: Option<PetWindowPointerDecision>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowRuntimeState {
    pub mode: PetWindowMode,
    pub body_position: Option<LogicalPosition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowSavedPlacement {
    pub body_position: LogicalPosition,
    pub monitor_name: Option<String>,
}

impl Default for PetWindowRuntimeState {
    fn default() -> Self {
        Self {
            mode: PetWindowMode::BodyOnly,
            body_position: None,
        }
    }
}

pub fn restore_saved_body_position(
    saved: &PetWindowSavedPlacement,
    work_area: LogicalRect,
) -> LogicalPosition {
    clamp_position(
        saved.body_position,
        pet_window_size(PetWindowMode::BodyOnly),
        work_area,
        DEFAULT_PET_WINDOW_MARGIN,
    )
}

pub fn body_position_from_window_position(
    mode: PetWindowMode,
    window_position: LogicalPosition,
) -> LogicalPosition {
    let body_size = pet_window_size(PetWindowMode::BodyOnly);
    let window_size = pet_window_size(mode);

    LogicalPosition {
        x: window_position.x + window_size.width as i32 - body_size.width as i32,
        y: window_position.y + window_size.height as i32 - body_size.height as i32,
    }
}

pub fn pet_window_rect_from_position(
    mode: PetWindowMode,
    window_position: LogicalPosition,
) -> LogicalRect {
    let size = pet_window_size(mode);
    LogicalRect {
        x: window_position.x,
        y: window_position.y,
        width: size.width,
        height: size.height,
    }
}

pub fn set_pet_window_mode_command_plan(
    input: PetWindowModeCommandInput,
) -> PetWindowRuntimeCommandPlan {
    let placement = match input.body_position {
        Some(position) => {
            place_pet_window_from_body_anchor(input.work_area, position, input.mode, 24)
        }
        None => {
            if input.mode == PetWindowMode::BodyOnly {
                default_pet_window_placement(input.work_area)
            } else {
                place_pet_window_from_body_anchor(
                    input.work_area,
                    default_pet_window_placement(input.work_area).position,
                    input.mode,
                    24,
                )
            }
        }
    };

    PetWindowRuntimeCommandPlan {
        command: SET_PET_WINDOW_MODE_COMMAND.to_string(),
        label: placement.label.clone(),
        focus: false,
        placement: Some(placement),
        drag: None,
        saved_position: None,
        pointer: None,
    }
}

pub fn start_pet_window_drag_command_plan() -> PetWindowRuntimeCommandPlan {
    let drag = start_pet_window_drag_plan();
    PetWindowRuntimeCommandPlan {
        command: START_PET_WINDOW_DRAG_COMMAND.to_string(),
        label: drag.label.clone(),
        focus: false,
        placement: None,
        drag: Some(drag),
        saved_position: None,
        pointer: None,
    }
}

pub fn save_pet_window_position_command_plan(
    input: PetWindowSavePositionCommandInput,
) -> PetWindowRuntimeCommandPlan {
    let drag = save_pet_window_position_plan();
    PetWindowRuntimeCommandPlan {
        command: SAVE_PET_WINDOW_POSITION_COMMAND.to_string(),
        label: drag.label.clone(),
        focus: false,
        placement: None,
        drag: Some(drag),
        saved_position: Some(input.position),
        pointer: None,
    }
}

pub fn sample_pet_cursor_near_command_plan(
    input: PetWindowPointerInput,
) -> PetWindowRuntimeCommandPlan {
    let pointer = pet_pointer_decision(input);
    PetWindowRuntimeCommandPlan {
        command: SAMPLE_PET_CURSOR_NEAR_COMMAND.to_string(),
        label: "pet".to_string(),
        focus: false,
        placement: None,
        drag: None,
        saved_position: None,
        pointer: Some(pointer),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work_area() -> LogicalRect {
        LogicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        }
    }

    #[test]
    fn command_names_match_the_desktop_webview_bridge() {
        assert_eq!(SET_PET_WINDOW_MODE_COMMAND, "set_pet_window_mode");
        assert_eq!(START_PET_WINDOW_DRAG_COMMAND, "start_pet_window_drag");
        assert_eq!(SAVE_PET_WINDOW_POSITION_COMMAND, "save_pet_window_position");
        assert_eq!(SAMPLE_PET_CURSOR_NEAR_COMMAND, "sample_pet_cursor_near");
    }

    #[test]
    fn set_mode_command_expands_card_without_stealing_focus() {
        let plan = set_pet_window_mode_command_plan(PetWindowModeCommandInput {
            mode: PetWindowMode::Card,
            work_area: work_area(),
            body_position: Some(LogicalPosition { x: 1716, y: 796 }),
        });

        let placement = plan.placement.expect("placement should be present");
        assert_eq!(plan.command, SET_PET_WINDOW_MODE_COMMAND);
        assert_eq!(plan.label, "pet");
        assert_eq!(plan.focus, false);
        assert_eq!(placement.mode, PetWindowMode::Card);
        assert_eq!(placement.position, LogicalPosition { x: 1516, y: 456 });
        assert_eq!(placement.size.width, 380);
        assert_eq!(placement.size.height, 560);
    }

    #[test]
    fn set_mode_command_starts_body_only_at_bottom_right_without_focus() {
        let plan = set_pet_window_mode_command_plan(PetWindowModeCommandInput {
            mode: PetWindowMode::BodyOnly,
            work_area: work_area(),
            body_position: None,
        });

        let placement = plan.placement.expect("placement should be present");
        assert_eq!(plan.command, SET_PET_WINDOW_MODE_COMMAND);
        assert_eq!(plan.label, "pet");
        assert_eq!(plan.focus, false);
        assert_eq!(placement.mode, PetWindowMode::BodyOnly);
        assert_eq!(placement.position, LogicalPosition { x: 1716, y: 796 });
    }

    #[test]
    fn drag_and_save_position_commands_are_focusless_and_persistable() {
        let drag = start_pet_window_drag_command_plan();
        let save = save_pet_window_position_command_plan(PetWindowSavePositionCommandInput {
            position: LogicalPosition { x: 1280, y: 720 },
        });

        assert_eq!(drag.command, START_PET_WINDOW_DRAG_COMMAND);
        assert_eq!(drag.drag.unwrap().animation_action, "drag_hold");
        assert_eq!(save.command, SAVE_PET_WINDOW_POSITION_COMMAND);
        assert_eq!(save.focus, false);
        assert_eq!(
            save.saved_position,
            Some(LogicalPosition { x: 1280, y: 720 })
        );
    }

    #[test]
    fn card_window_position_converts_back_to_body_anchor_without_drift() {
        let body = LogicalPosition { x: 1716, y: 796 };
        let card = place_pet_window_from_body_anchor(work_area(), body, PetWindowMode::Card, 24);

        assert_eq!(card.position, LogicalPosition { x: 1516, y: 456 });
        assert_eq!(
            body_position_from_window_position(PetWindowMode::Card, card.position),
            body
        );
        assert_eq!(
            body_position_from_window_position(PetWindowMode::BodyOnly, body),
            body
        );
    }

    #[test]
    fn pet_window_rect_uses_the_active_mode_size() {
        assert_eq!(
            pet_window_rect_from_position(
                PetWindowMode::BodyOnly,
                LogicalPosition { x: 10, y: 20 }
            ),
            LogicalRect {
                x: 10,
                y: 20,
                width: 180,
                height: 220
            }
        );
        assert_eq!(
            pet_window_rect_from_position(PetWindowMode::Card, LogicalPosition { x: 10, y: 20 }),
            LogicalRect {
                x: 10,
                y: 20,
                width: 380,
                height: 560
            }
        );
    }

    #[test]
    fn saved_body_position_is_clamped_when_the_monitor_layout_changes() {
        let saved = PetWindowSavedPlacement {
            body_position: LogicalPosition { x: -2000, y: 3000 },
            monitor_name: Some("old-monitor".to_string()),
        };

        assert_eq!(
            restore_saved_body_position(&saved, work_area()),
            LogicalPosition { x: 24, y: 796 }
        );
    }

    #[test]
    fn cursor_near_command_returns_pointer_decision_for_scheduler() {
        let plan = sample_pet_cursor_near_command_plan(PetWindowPointerInput {
            cursor: LogicalPosition { x: 1800, y: 900 },
            window: LogicalRect {
                x: 1716,
                y: 796,
                width: 180,
                height: 220,
            },
            near_radius: 72,
        });

        let pointer = plan.pointer.expect("pointer should be present");
        assert_eq!(plan.command, SAMPLE_PET_CURSOR_NEAR_COMMAND);
        assert_eq!(pointer.inside_window, true);
        assert_eq!(pointer.cursor_near, true);
    }
}
