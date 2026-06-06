use workhub_client_tauri::pet_commands::{
    body_position_from_window_position, pet_window_rect_from_position, restore_saved_body_position,
    sample_pet_cursor_near_command_plan, save_pet_window_position_command_plan,
    set_pet_window_mode_command_plan, start_pet_window_drag_command_plan,
    PetWindowModeCommandInput, PetWindowRuntimeCommandPlan, PetWindowRuntimeState,
    PetWindowSavePositionCommandInput, PetWindowSavedPlacement,
};
use workhub_client_tauri::pet_window::{
    LogicalPosition, LogicalRect, PetWindowMode, PetWindowPointerInput,
    DEFAULT_PET_CURSOR_NEAR_RADIUS,
};
use workhub_client_tauri::tray::{
    tray_menu_action_plan_by_id, TRAY_HIDE_MAIN_ID, TRAY_OPEN_INBOX_ID, TRAY_QUIT_ID,
    TRAY_SHOW_MAIN_ID, TRAY_TOGGLE_PET_ID, WORKHUB_TRAY_ID, WORKHUB_TRAY_TOOLTIP,
};
use workhub_client_tauri::window_controls::{
    focus_main_route as focus_main_route_plan, hide_main_window as hide_main_window_plan,
    hide_pet_window as hide_pet_window_plan, show_main_window as show_main_window_plan,
    show_pet_window as show_pet_window_plan, toggle_pet_window as toggle_pet_window_plan,
    ShellWindowControlAction, ShellWindowControlPlan, ShellWindowControlSource,
};

use std::{fs, path::PathBuf, sync::Mutex};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition as TauriLogicalPosition, LogicalSize, Manager, State,
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
fn sample_pet_cursor_near(app: tauri::AppHandle) -> Result<PetWindowRuntimeCommandPlan, String> {
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

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<ShellWindowControlPlan, String> {
    execute_window_control(
        &app,
        show_main_window_plan(ShellWindowControlSource::Setting),
    )
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<ShellWindowControlPlan, String> {
    execute_window_control(
        &app,
        hide_main_window_plan(ShellWindowControlSource::Setting),
    )
}

#[tauri::command]
fn focus_main_route(
    app: tauri::AppHandle,
    route: String,
) -> Result<ShellWindowControlPlan, String> {
    let plan = focus_main_route_plan(ShellWindowControlSource::DeepLink, &route)
        .map_err(|error| format!("unsafe main window route: {error:?}"))?;
    execute_window_control(&app, plan)
}

#[tauri::command]
fn show_pet_window(app: tauri::AppHandle) -> Result<ShellWindowControlPlan, String> {
    execute_window_control(
        &app,
        show_pet_window_plan(ShellWindowControlSource::Setting),
    )
}

#[tauri::command]
fn hide_pet_window(app: tauri::AppHandle) -> Result<ShellWindowControlPlan, String> {
    execute_window_control(
        &app,
        hide_pet_window_plan(ShellWindowControlSource::Setting),
    )
}

#[tauri::command]
fn toggle_pet_window(app: tauri::AppHandle) -> Result<ShellWindowControlPlan, String> {
    execute_window_control(
        &app,
        toggle_pet_window_plan(ShellWindowControlSource::Setting),
    )
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

fn execute_window_control(
    app: &tauri::AppHandle,
    plan: ShellWindowControlPlan,
) -> Result<ShellWindowControlPlan, String> {
    let window = app
        .get_webview_window(&plan.label)
        .ok_or_else(|| format!("{} window is not available", plan.label))?;

    match plan.action {
        ShellWindowControlAction::Show => window
            .show()
            .map_err(|error| format!("failed to show {} window: {error}", plan.label))?,
        ShellWindowControlAction::Hide => window
            .hide()
            .map_err(|error| format!("failed to hide {} window: {error}", plan.label))?,
        ShellWindowControlAction::Toggle => {
            let visible = window.is_visible().map_err(|error| {
                format!("failed to read {} window visibility: {error}", plan.label)
            })?;
            if visible {
                window
                    .hide()
                    .map_err(|error| format!("failed to hide {} window: {error}", plan.label))?;
            } else {
                window
                    .show()
                    .map_err(|error| format!("failed to show {} window: {error}", plan.label))?;
            }
        }
        ShellWindowControlAction::Focus => window
            .set_focus()
            .map_err(|error| format!("failed to focus {} window: {error}", plan.label))?,
        ShellWindowControlAction::ShowAndFocus => {
            window
                .show()
                .map_err(|error| format!("failed to show {} window: {error}", plan.label))?;
            if plan.focus {
                window
                    .set_focus()
                    .map_err(|error| format!("failed to focus {} window: {error}", plan.label))?;
            }
        }
    }

    if plan.label == "main" {
        if let Some(route) = &plan.route {
            app.emit("navigate", route.clone())
                .map_err(|error| format!("failed to emit main window navigation: {error}"))?;
        }
    }

    Ok(plan)
}

fn install_workhub_tray(app: &tauri::App) -> Result<(), String> {
    let show_main = tray_menu_action_plan_by_id(TRAY_SHOW_MAIN_ID)
        .ok_or_else(|| "missing show-main tray action".to_string())?;
    let hide_main = tray_menu_action_plan_by_id(TRAY_HIDE_MAIN_ID)
        .ok_or_else(|| "missing hide-main tray action".to_string())?;
    let toggle_pet = tray_menu_action_plan_by_id(TRAY_TOGGLE_PET_ID)
        .ok_or_else(|| "missing toggle-pet tray action".to_string())?;
    let open_inbox = tray_menu_action_plan_by_id(TRAY_OPEN_INBOX_ID)
        .ok_or_else(|| "missing open-inbox tray action".to_string())?;
    let quit = tray_menu_action_plan_by_id(TRAY_QUIT_ID)
        .ok_or_else(|| "missing quit tray action".to_string())?;

    let show_main_item = MenuItemBuilder::with_id(show_main.id.as_str(), show_main.label.as_str())
        .build(app)
        .map_err(|error| format!("failed to build show-main tray item: {error}"))?;
    let hide_main_item = MenuItemBuilder::with_id(hide_main.id.as_str(), hide_main.label.as_str())
        .build(app)
        .map_err(|error| format!("failed to build hide-main tray item: {error}"))?;
    let toggle_pet_item =
        MenuItemBuilder::with_id(toggle_pet.id.as_str(), toggle_pet.label.as_str())
            .build(app)
            .map_err(|error| format!("failed to build toggle-pet tray item: {error}"))?;
    let open_inbox_item =
        MenuItemBuilder::with_id(open_inbox.id.as_str(), open_inbox.label.as_str())
            .build(app)
            .map_err(|error| format!("failed to build open-inbox tray item: {error}"))?;
    let quit_item = MenuItemBuilder::with_id(quit.id.as_str(), quit.label.as_str())
        .build(app)
        .map_err(|error| format!("failed to build quit tray item: {error}"))?;

    let menu = MenuBuilder::new(app)
        .item(&show_main_item)
        .item(&hide_main_item)
        .separator()
        .item(&toggle_pet_item)
        .item(&open_inbox_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|error| format!("failed to build WorkHub tray menu: {error}"))?;

    let mut builder = TrayIconBuilder::with_id(WORKHUB_TRAY_ID)
        .tooltip(WORKHUB_TRAY_TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Err(error) = handle_tray_action(app, event.id().as_ref()) {
                eprintln!("failed to handle WorkHub tray action: {error}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = handle_tray_action(tray.app_handle(), TRAY_SHOW_MAIN_ID) {
                    eprintln!("failed to handle WorkHub tray left click: {error}");
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .build(app)
        .map_err(|error| format!("failed to install WorkHub tray: {error}"))?;

    Ok(())
}

fn handle_tray_action(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let Some(plan) = tray_menu_action_plan_by_id(id) else {
        return Ok(());
    };

    if plan.exits_app {
        app.exit(0);
        return Ok(());
    }

    if let Some(control) = plan.window_control.clone() {
        execute_window_control(app, control)?;
    }

    app.emit("tray-action", plan)
        .map_err(|error| format!("failed to emit tray-action event: {error}"))
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
    fs::write(&path, raw).map_err(|error| {
        format!(
            "failed to write pet window state {}: {error}",
            path.display()
        )
    })
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
            install_workhub_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_pet_window_mode,
            start_pet_window_drag,
            save_pet_window_position,
            sample_pet_cursor_near,
            show_main_window,
            hide_main_window,
            focus_main_route,
            show_pet_window,
            hide_pet_window,
            toggle_pet_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WorkHub Tauri shell");
}
