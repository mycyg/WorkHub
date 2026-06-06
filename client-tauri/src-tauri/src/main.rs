use workhub_client_tauri::pet_commands::{
    sample_pet_cursor_near_command_plan, save_pet_window_position_command_plan,
    set_pet_window_mode_command_plan, start_pet_window_drag_command_plan,
    PetWindowModeCommandInput, PetWindowRuntimeCommandPlan, PetWindowSavePositionCommandInput,
};
use workhub_client_tauri::pet_window::{
    LogicalPosition, LogicalRect, PetWindowMode, PetWindowPointerInput,
    DEFAULT_PET_CURSOR_NEAR_RADIUS,
};

#[tauri::command]
fn set_pet_window_mode(mode: PetWindowMode) -> PetWindowRuntimeCommandPlan {
    set_pet_window_mode_command_plan(PetWindowModeCommandInput {
        mode,
        work_area: default_work_area(),
        body_position: None,
    })
}

#[tauri::command]
fn start_pet_window_drag() -> PetWindowRuntimeCommandPlan {
    start_pet_window_drag_command_plan()
}

#[tauri::command]
fn save_pet_window_position() -> PetWindowRuntimeCommandPlan {
    save_pet_window_position_command_plan(PetWindowSavePositionCommandInput {
        position: default_body_position(),
    })
}

#[tauri::command]
fn sample_pet_cursor_near() -> bool {
    let plan = sample_pet_cursor_near_command_plan(PetWindowPointerInput {
        cursor: default_body_position(),
        window: LogicalRect {
            x: default_body_position().x,
            y: default_body_position().y,
            width: 180,
            height: 220,
        },
        near_radius: DEFAULT_PET_CURSOR_NEAR_RADIUS,
    });

    plan.pointer
        .map(|pointer| pointer.cursor_near)
        .unwrap_or(false)
}

fn default_work_area() -> LogicalRect {
    LogicalRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    }
}

fn default_body_position() -> LogicalPosition {
    LogicalPosition { x: 1716, y: 796 }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_pet_window_mode,
            start_pet_window_drag,
            save_pet_window_position,
            sample_pet_cursor_near
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WorkHub Tauri shell");
}
