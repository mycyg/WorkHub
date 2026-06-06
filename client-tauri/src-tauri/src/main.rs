use workhub_client_tauri::pet_commands::{
    save_pet_window_position_command_plan, set_pet_window_mode_command_plan,
    start_pet_window_drag_command_plan, PetWindowModeCommandInput, PetWindowRuntimeCommandPlan,
    PetWindowSavePositionCommandInput,
};
use workhub_client_tauri::pet_window::{LogicalPosition, LogicalRect, PetWindowMode};

use tauri::{LogicalPosition as TauriLogicalPosition, LogicalSize, Manager};

#[tauri::command]
fn set_pet_window_mode(
    app: tauri::AppHandle,
    mode: PetWindowMode,
) -> Result<PetWindowRuntimeCommandPlan, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let body_position = window
        .outer_position()
        .ok()
        .map(|position| LogicalPosition {
            x: position.x,
            y: position.y,
        });
    let plan = set_pet_window_mode_command_plan(PetWindowModeCommandInput {
        mode,
        work_area: default_work_area(),
        body_position,
    });
    let placement = plan
        .placement
        .as_ref()
        .ok_or_else(|| "pet placement plan is missing".to_string())?;

    window
        .set_size(LogicalSize::new(
            placement.size.width as f64,
            placement.size.height as f64,
        ))
        .map_err(|error| format!("failed to resize pet window: {error}"))?;
    window
        .set_position(TauriLogicalPosition::new(
            placement.position.x as f64,
            placement.position.y as f64,
        ))
        .map_err(|error| format!("failed to position pet window: {error}"))?;
    window
        .show()
        .map_err(|error| format!("failed to show pet window: {error}"))?;

    Ok(plan)
}

#[tauri::command]
fn start_pet_window_drag(app: tauri::AppHandle) -> Result<PetWindowRuntimeCommandPlan, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let plan = start_pet_window_drag_command_plan();
    window
        .start_dragging()
        .map_err(|error| format!("failed to start pet window dragging: {error}"))?;
    Ok(plan)
}

#[tauri::command]
fn save_pet_window_position(app: tauri::AppHandle) -> Result<PetWindowRuntimeCommandPlan, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read pet window position: {error}"))?;
    Ok(save_pet_window_position_command_plan(
        PetWindowSavePositionCommandInput {
            position: LogicalPosition {
                x: position.x,
                y: position.y,
            },
        },
    ))
}

#[tauri::command]
fn sample_pet_cursor_near() -> bool {
    false
}

fn default_work_area() -> LogicalRect {
    LogicalRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    }
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
