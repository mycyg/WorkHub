use workhub_client_tauri::pet_commands::{
    body_position_from_window_position, pet_window_rect_from_position,
    restore_saved_body_position,
    sample_pet_cursor_near_command_plan, save_pet_window_position_command_plan,
    set_pet_window_mode_command_plan, start_pet_window_drag_command_plan, PetWindowModeCommandInput,
    PetWindowRuntimeCommandPlan, PetWindowRuntimeState, PetWindowSavePositionCommandInput,
    PetWindowSavedPlacement,
};
use workhub_client_tauri::pet_window::{
    LogicalPosition, LogicalRect, PetWindowMode, PetWindowPointerInput,
    DEFAULT_PET_CURSOR_NEAR_RADIUS,
};

use std::{fs, path::PathBuf, sync::Mutex};

use tauri::{
    path::BaseDirectory, LogicalPosition as TauriLogicalPosition, LogicalSize, Manager, State,
};

#[tauri::command]
fn set_pet_window_mode(
    app: tauri::AppHandle,
    runtime_state: State<'_, Mutex<PetWindowRuntimeState>>,
    mode: PetWindowMode,
) -> Result<PetWindowRuntimeCommandPlan, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let current_position = window
        .outer_position()
        .ok()
        .map(|position| LogicalPosition {
            x: position.x,
            y: position.y,
        });
    let state = *runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    let body_position = state.body_position.or_else(|| {
        current_position.map(|position| body_position_from_window_position(state.mode, position))
    });
    let plan = set_pet_window_mode_command_plan(PetWindowModeCommandInput {
        mode,
        work_area: work_area_for_pet_window(&window),
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

    let mut state = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    state.mode = mode;
    state.body_position = Some(body_position_from_window_position(mode, placement.position));

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
    let runtime_state = app.state::<Mutex<PetWindowRuntimeState>>();
    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read pet window position: {error}"))?;
    let mode = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .mode;
    let body_position = body_position_from_window_position(
        mode,
        LogicalPosition {
            x: position.x,
            y: position.y,
        },
    );
    runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .body_position = Some(body_position);
    save_pet_window_saved_placement(
        &app,
        PetWindowSavedPlacement {
            body_position,
            monitor_name: current_monitor_name(&window),
        },
    )?;
    Ok(save_pet_window_position_command_plan(
        PetWindowSavePositionCommandInput {
            position: body_position,
        },
    ))
}

#[tauri::command]
fn sample_pet_cursor_near(
    app: tauri::AppHandle,
) -> Result<PetWindowRuntimeCommandPlan, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let runtime_state = app.state::<Mutex<PetWindowRuntimeState>>();
    let mode = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .mode;
    let cursor = app
        .cursor_position()
        .map_err(|error| format!("failed to read cursor position: {error}"))?;
    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read pet window position: {error}"))?;
    Ok(sample_pet_cursor_near_command_plan(PetWindowPointerInput {
        cursor: LogicalPosition {
            x: cursor.x.round() as i32,
            y: cursor.y.round() as i32,
        },
        window: pet_window_rect_from_position(
            mode,
            LogicalPosition {
                x: position.x,
                y: position.y,
            },
        ),
        near_radius: DEFAULT_PET_CURSOR_NEAR_RADIUS,
    }))
}

fn work_area_for_pet_window(window: &tauri::WebviewWindow) -> LogicalRect {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        _ => window.primary_monitor().ok().flatten(),
    };

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        return LogicalRect {
            x: work_area.position.x,
            y: work_area.position.y,
            width: work_area.size.width,
            height: work_area.size.height,
        };
    }

    default_work_area()
}

fn default_work_area() -> LogicalRect {
    LogicalRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    }
}

fn pet_window_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("pet-window-state.json", BaseDirectory::Config)
        .map_err(|error| format!("failed to resolve pet window state path: {error}"))
}

fn load_pet_window_saved_placement(
    app: &tauri::AppHandle,
) -> Result<Option<PetWindowSavedPlacement>, String> {
    let path = pet_window_state_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read pet window state: {error}"))?;
    serde_json::from_str(&raw).map(Some).map_err(|error| {
        format!(
            "failed to parse pet window state {}: {error}",
            path.display()
        )
    })
}

fn save_pet_window_saved_placement(
    app: &tauri::AppHandle,
    saved: PetWindowSavedPlacement,
) -> Result<(), String> {
    let path = pet_window_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create pet window state directory: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(&saved)
        .map_err(|error| format!("failed to serialize pet window state: {error}"))?;
    fs::write(&path, raw)
        .map_err(|error| format!("failed to write pet window state {}: {error}", path.display()))
}

fn current_monitor_name(window: &tauri::WebviewWindow) -> Option<String> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().cloned())
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(PetWindowRuntimeState::default()))
        .setup(|app| {
            if let Ok(Some(saved)) = load_pet_window_saved_placement(&app.handle()) {
                let work_area = app
                    .get_webview_window("pet")
                    .map(|window| work_area_for_pet_window(&window))
                    .unwrap_or_else(default_work_area);
                if let Ok(mut state) = app.state::<Mutex<PetWindowRuntimeState>>().lock() {
                    state.body_position = Some(restore_saved_body_position(&saved, work_area));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_pet_window_mode,
            start_pet_window_drag,
            save_pet_window_position,
            sample_pet_cursor_near
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WorkHub Tauri shell");
}
