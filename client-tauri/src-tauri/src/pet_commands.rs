use serde::{Deserialize, Serialize};

use crate::pet_window::{
    clamp_position, default_pet_window_placement_with_settings, normalize_pet_window_settings,
    pet_pointer_decision, pet_window_size_for_settings, pet_window_visual_settings_plan,
    place_pet_window_from_body_anchor, save_pet_window_position_plan, start_pet_window_drag_plan,
    LogicalPosition, LogicalRect, PetWindowDragPlan, PetWindowMode, PetWindowPlacementPlan,
    PetWindowPointerDecision, PetWindowPointerInput, PetWindowSettings,
    PetWindowVisualSettingsPlan, DEFAULT_PET_WINDOW_MARGIN,
};

pub const SET_PET_WINDOW_MODE_COMMAND: &str = "set_pet_window_mode";
pub const SET_PET_WINDOW_SETTINGS_COMMAND: &str = "set_pet_window_settings";
pub const START_PET_WINDOW_DRAG_COMMAND: &str = "start_pet_window_drag";
pub const SAVE_PET_WINDOW_POSITION_COMMAND: &str = "save_pet_window_position";
pub const SAMPLE_PET_CURSOR_NEAR_COMMAND: &str = "sample_pet_cursor_near";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowModeCommandInput {
    pub mode: PetWindowMode,
    pub work_area: LogicalRect,
    pub body_position: Option<LogicalPosition>,
    pub settings: Option<PetWindowSettings>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowSettingsCommandInput {
    pub scale_percent: u16,
    pub opacity_percent: u8,
    pub pass_through: bool,
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
    pub settings: Option<PetWindowVisualSettingsPlan>,
    pub drag: Option<PetWindowDragPlan>,
    pub saved_position: Option<LogicalPosition>,
    pub pointer: Option<PetWindowPointerDecision>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowRuntimeState {
    pub mode: PetWindowMode,
    pub body_position: Option<LogicalPosition>,
    pub settings: PetWindowSettings,
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
            settings: PetWindowSettings::default(),
        }
    }
}

pub fn restore_saved_body_position(
    saved: &PetWindowSavedPlacement,
    work_area: LogicalRect,
) -> LogicalPosition {
    clamp_position(
        saved.body_position,
        pet_window_size_for_settings(PetWindowMode::BodyOnly, PetWindowSettings::default()),
        work_area,
        DEFAULT_PET_WINDOW_MARGIN,
    )
}

pub fn body_position_from_window_position(
    mode: PetWindowMode,
    window_position: LogicalPosition,
) -> LogicalPosition {
    body_position_from_window_position_with_settings(
        mode,
        window_position,
        PetWindowSettings::default(),
    )
}

pub fn body_position_from_window_position_with_settings(
    mode: PetWindowMode,
    window_position: LogicalPosition,
    settings: PetWindowSettings,
) -> LogicalPosition {
    let body_size = pet_window_size_for_settings(PetWindowMode::BodyOnly, settings);
    let window_size = pet_window_size_for_settings(mode, settings);

    LogicalPosition {
        x: window_position.x + window_size.width as i32 - body_size.width as i32,
        y: window_position.y + window_size.height as i32 - body_size.height as i32,
    }
}

pub fn pet_window_rect_from_position(
    mode: PetWindowMode,
    window_position: LogicalPosition,
) -> LogicalRect {
    pet_window_rect_from_position_with_settings(mode, window_position, PetWindowSettings::default())
}

pub fn pet_window_rect_from_position_with_settings(
    mode: PetWindowMode,
    window_position: LogicalPosition,
    settings: PetWindowSettings,
) -> LogicalRect {
    let size = pet_window_size_for_settings(mode, settings);
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
    let settings = normalize_pet_window_settings(input.settings.unwrap_or_default());
    let placement = match input.body_position {
        Some(position) => {
            place_pet_window_from_body_anchor(input.work_area, position, input.mode, 24, settings)
        }
        None => {
            if input.mode == PetWindowMode::BodyOnly {
                default_pet_window_placement_with_settings(input.work_area, settings)
            } else {
                place_pet_window_from_body_anchor(
                    input.work_area,
                    default_pet_window_placement_with_settings(input.work_area, settings).position,
                    input.mode,
                    24,
                    settings,
                )
            }
        }
    };

    PetWindowRuntimeCommandPlan {
        command: SET_PET_WINDOW_MODE_COMMAND.to_string(),
        label: placement.label.clone(),
        focus: false,
        placement: Some(placement),
        settings: Some(pet_window_visual_settings_plan(settings)),
        drag: None,
        saved_position: None,
        pointer: None,
    }
}

pub fn set_pet_window_settings_command_plan(
    input: PetWindowSettingsCommandInput,
) -> PetWindowRuntimeCommandPlan {
    let settings = normalize_pet_window_settings(PetWindowSettings {
        scale_percent: input.scale_percent,
        opacity_percent: input.opacity_percent,
        pass_through: input.pass_through,
    });
    let placement = match input.body_position {
        Some(position) => {
            place_pet_window_from_body_anchor(input.work_area, position, input.mode, 24, settings)
        }
        None => {
            if input.mode == PetWindowMode::BodyOnly {
                default_pet_window_placement_with_settings(input.work_area, settings)
            } else {
                place_pet_window_from_body_anchor(
                    input.work_area,
                    default_pet_window_placement_with_settings(input.work_area, settings).position,
                    input.mode,
                    24,
                    settings,
                )
            }
        }
    };

    PetWindowRuntimeCommandPlan {
        command: SET_PET_WINDOW_SETTINGS_COMMAND.to_string(),
        label: placement.label.clone(),
        focus: false,
        placement: Some(placement),
        settings: Some(pet_window_visual_settings_plan(settings)),
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
        settings: None,
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
        settings: None,
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
        settings: None,
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
        assert_eq!(SET_PET_WINDOW_SETTINGS_COMMAND, "set_pet_window_settings");
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
            settings: None,
        });

        let placement = plan.placement.expect("placement should be present");
        let settings = plan.settings.expect("settings should be present");
        assert_eq!(plan.command, SET_PET_WINDOW_MODE_COMMAND);
        assert_eq!(plan.label, "pet");
        assert_eq!(plan.focus, false);
        assert_eq!(placement.mode, PetWindowMode::Card);
        assert_eq!(placement.position, LogicalPosition { x: 1516, y: 456 });
        assert_eq!(placement.size.width, 380);
        assert_eq!(placement.size.height, 560);
        assert_eq!(settings.scale_percent, 100);
    }

    #[test]
    fn set_mode_command_starts_body_only_at_bottom_right_without_focus() {
        let plan = set_pet_window_mode_command_plan(PetWindowModeCommandInput {
            mode: PetWindowMode::BodyOnly,
            work_area: work_area(),
            body_position: None,
            settings: None,
        });

        let placement = plan.placement.expect("placement should be present");
        assert_eq!(plan.command, SET_PET_WINDOW_MODE_COMMAND);
        assert_eq!(plan.label, "pet");
        assert_eq!(plan.focus, false);
        assert_eq!(placement.mode, PetWindowMode::BodyOnly);
        assert_eq!(placement.position, LogicalPosition { x: 1716, y: 796 });
    }

    #[test]
    fn settings_command_resizes_the_active_mode_and_confirms_pass_through() {
        let plan = set_pet_window_settings_command_plan(PetWindowSettingsCommandInput {
            scale_percent: 125,
            opacity_percent: 80,
            pass_through: true,
            mode: PetWindowMode::Card,
            work_area: work_area(),
            body_position: Some(LogicalPosition { x: 1600, y: 700 }),
        });

        let placement = plan.placement.expect("placement should be present");
        let settings = plan.settings.expect("settings should be present");

        assert_eq!(plan.command, SET_PET_WINDOW_SETTINGS_COMMAND);
        assert_eq!(placement.mode, PetWindowMode::Card);
        assert_eq!(placement.size.width, 475);
        assert_eq!(placement.size.height, 700);
        assert_eq!(placement.position, LogicalPosition { x: 1350, y: 275 });
        assert_eq!(settings.scale_percent, 125);
        assert_eq!(settings.opacity_percent, 80);
        assert_eq!(settings.pass_through, true);
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
        let card = place_pet_window_from_body_anchor(
            work_area(),
            body,
            PetWindowMode::Card,
            24,
            PetWindowSettings::default(),
        );

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
