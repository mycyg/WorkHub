use workhub_client_tauri::config::{load_shell_config_from_json_and_env, WorkHubShellConfig};
use workhub_client_tauri::deep_link::{deep_link_plan_from_url, DEEP_LINK_SCHEMES};
use workhub_client_tauri::events::{event_channel_name, ShellEvent};
use workhub_client_tauri::pet_commands::{
    body_position_from_window_position_with_settings, pet_window_rect_from_position_with_settings,
    restore_saved_body_position, sample_pet_cursor_near_command_plan,
    save_pet_window_position_command_plan, set_pet_window_mode_command_plan,
    set_pet_window_settings_command_plan, start_pet_window_drag_command_plan,
    PetWindowModeCommandInput, PetWindowRuntimeCommandPlan, PetWindowRuntimeState,
    PetWindowSavePositionCommandInput, PetWindowSavedPlacement, PetWindowSettingsCommandInput,
};
use workhub_client_tauri::pet_window::{
    LogicalPosition, LogicalRect, PetWindowMode, PetWindowPlacementPlan, PetWindowPointerInput,
    PetWindowSettings, DEFAULT_PET_CURSOR_NEAR_RADIUS,
};
use workhub_client_tauri::single_instance::single_instance_plan_from_args;
use workhub_client_tauri::sse_worker::spawn_default_shell_sse_workers;
use workhub_client_tauri::tray::{
    tray_menu_action_plan_by_id, TRAY_HIDE_MAIN_ID, TRAY_OPEN_INBOX_ID,
    TRAY_OPEN_SETTINGS_ID, TRAY_QUIT_ID, TRAY_RESTORE_PET_INTERACTION_ID, TRAY_SHOW_MAIN_ID,
    TRAY_TOGGLE_PET_ID, WORKHUB_TRAY_ID, WORKHUB_TRAY_TOOLTIP,
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
    utils::config::Color,
    Emitter, LogicalPosition as TauriLogicalPosition, LogicalSize, Manager,
    PhysicalPosition as TauriPhysicalPosition, State, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;

const WORKHUB_DISABLE_SSE_ENV: &str = "WORKHUB_DISABLE_SSE";
const WORKHUB_CUU_QA_HIDE_ON_HOVER_ENV: &str = "WORKHUB_CUU_QA_HIDE_ON_HOVER";
const WORKHUB_CUU_QA_PET_SCALE_PERCENT_ENV: &str = "WORKHUB_CUU_QA_PET_SCALE_PERCENT";
const WORKHUB_CUU_QA_PET_OPACITY_PERCENT_ENV: &str = "WORKHUB_CUU_QA_PET_OPACITY_PERCENT";
const WORKHUB_CUU_QA_PET_PASS_THROUGH_ENV: &str = "WORKHUB_CUU_QA_PET_PASS_THROUGH";
const WORKHUB_CUU_QA_MODEL_PACK_ID_ENV: &str = "WORKHUB_CUU_QA_MODEL_PACK_ID";
const WORKHUB_CUU_QA_SCENARIO_ENV: &str = "WORKHUB_CUU_QA_SCENARIO";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct CuuQaPreferenceOverrides {
    pet_scale_percent: Option<u16>,
    pet_opacity_percent: Option<u8>,
    pet_pass_through: Option<bool>,
    pet_hide_on_hover: Option<bool>,
    pet_model_pack_id: Option<String>,
    pet_qa_scenario: Option<String>,
}

fn workhub_sse_disabled_from_env(get_env: impl Fn(&str) -> Option<String>) -> bool {
    workhub_env_flag_enabled(WORKHUB_DISABLE_SSE_ENV, get_env)
}

fn workhub_cuu_qa_preferences_from_env<F>(get_env: F) -> CuuQaPreferenceOverrides
where
    F: Fn(&str) -> Option<String>,
{
    CuuQaPreferenceOverrides {
        pet_scale_percent: workhub_env_u16_allowed(
            WORKHUB_CUU_QA_PET_SCALE_PERCENT_ENV,
            &get_env,
            &[75, 100, 125, 150],
        ),
        pet_opacity_percent: workhub_env_u8_allowed(
            WORKHUB_CUU_QA_PET_OPACITY_PERCENT_ENV,
            &get_env,
            &[60, 80, 100],
        ),
        pet_pass_through: workhub_env_flag_value(WORKHUB_CUU_QA_PET_PASS_THROUGH_ENV, &get_env),
        pet_hide_on_hover: workhub_env_flag_value(WORKHUB_CUU_QA_HIDE_ON_HOVER_ENV, &get_env),
        pet_model_pack_id: workhub_env_string_allowed(
            WORKHUB_CUU_QA_MODEL_PACK_ID_ENV,
            &get_env,
            &["cuu-hijiki-live2d-cubism2", "cuu-tororo-live2d-cubism2"],
        ),
        pet_qa_scenario: workhub_env_string_allowed(
            WORKHUB_CUU_QA_SCENARIO_ENV,
            &get_env,
            &["clarify", "approval", "search", "sync", "done", "offline"],
        ),
    }
}

fn workhub_env_flag_enabled(name: &str, get_env: impl Fn(&str) -> Option<String>) -> bool {
    workhub_env_flag_value(name, get_env).unwrap_or(false)
}

fn workhub_env_flag_value(name: &str, get_env: impl Fn(&str) -> Option<String>) -> Option<bool> {
    get_env(name).map(|value| match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        _ => false,
    })
}

fn workhub_env_u16_allowed<F>(name: &str, get_env: &F, allowed: &[u16]) -> Option<u16>
where
    F: Fn(&str) -> Option<String>,
{
    let value = get_env(name)?.trim().parse::<u16>().ok()?;
    allowed.contains(&value).then_some(value)
}

fn workhub_env_u8_allowed<F>(name: &str, get_env: &F, allowed: &[u8]) -> Option<u8>
where
    F: Fn(&str) -> Option<String>,
{
    let value = get_env(name)?.trim().parse::<u8>().ok()?;
    allowed.contains(&value).then_some(value)
}

fn workhub_env_string_allowed<F>(name: &str, get_env: &F, allowed: &[&str]) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    let value = get_env(name)?.trim().to_string();
    allowed.contains(&value.as_str()).then_some(value)
}

#[tauri::command]
fn set_pet_window_mode(
    app: tauri::AppHandle,
    runtime_state: State<'_, Mutex<PetWindowRuntimeState>>,
    mode: PetWindowMode,
) -> Result<PetWindowRuntimeCommandPlan, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let scale_factor = scale_factor_for_window(&window);
    let current_position = window
        .outer_position()
        .ok()
        .map(|position| physical_position_to_logical(position, scale_factor));
    let state = *runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    let body_position = state.body_position.or_else(|| {
        current_position.map(|position| {
            body_position_from_window_position_with_settings(state.mode, position, state.settings)
        })
    });
    let plan = set_pet_window_mode_command_plan(PetWindowModeCommandInput {
        mode,
        work_area: work_area_for_pet_window(&window),
        body_position,
        settings: Some(state.settings),
    });
    let placement = plan
        .placement
        .as_ref()
        .ok_or_else(|| "pet placement plan is missing".to_string())?;

    apply_pet_window_placement(&window, placement, "set mode")?;
    keep_pet_window_above_desktop(&window)?;
    window
        .show()
        .map_err(|error| format!("failed to show pet window: {error}"))?;

    let mut state = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    state.mode = mode;
    state.body_position = Some(body_position_from_window_position_with_settings(
        mode,
        placement.position,
        state.settings,
    ));

    Ok(plan)
}

#[tauri::command]
fn set_pet_window_settings(
    app: tauri::AppHandle,
    runtime_state: State<'_, Mutex<PetWindowRuntimeState>>,
    scale_percent: u16,
    opacity_percent: u8,
    pass_through: bool,
    hide_on_hover: bool,
) -> Result<PetWindowRuntimeCommandPlan, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let scale_factor = scale_factor_for_window(&window);
    let current_position = window
        .outer_position()
        .ok()
        .map(|position| physical_position_to_logical(position, scale_factor));
    let state = *runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    let body_position = state.body_position.or_else(|| {
        current_position.map(|position| {
            body_position_from_window_position_with_settings(state.mode, position, state.settings)
        })
    });
    let plan = set_pet_window_settings_command_plan(PetWindowSettingsCommandInput {
        scale_percent,
        opacity_percent,
        pass_through,
        hide_on_hover,
        mode: state.mode,
        work_area: work_area_for_pet_window(&window),
        body_position,
    });
    let settings = plan
        .settings
        .as_ref()
        .ok_or_else(|| "pet settings plan is missing".to_string())?;
    let next_settings = PetWindowSettings {
        scale_percent: settings.scale_percent,
        opacity_percent: settings.opacity_percent,
        pass_through: settings.pass_through,
        hide_on_hover: settings.hide_on_hover,
    };
    let placement = plan
        .placement
        .as_ref()
        .ok_or_else(|| "pet placement plan is missing".to_string())?;

    apply_pet_window_placement(&window, placement, "set settings")?;
    window
        .set_ignore_cursor_events(settings.pass_through)
        .map_err(|error| format!("failed to set pet window click-through: {error}"))?;
    keep_pet_window_above_desktop(&window)?;

    let mut state = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    state.settings = next_settings;
    state.body_position = Some(body_position_from_window_position_with_settings(
        state.mode,
        placement.position,
        next_settings,
    ));

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
    let scale_factor = scale_factor_for_window(&window);
    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read pet window position: {error}"))?;
    let mode = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .mode;
    let settings = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .settings;
    let position = physical_position_to_logical(position, scale_factor);
    let body_position = body_position_from_window_position_with_settings(
        mode,
        LogicalPosition {
            x: position.x,
            y: position.y,
        },
        settings,
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
    let settings = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .settings;
    let scale_factor = scale_factor_for_window(&window);
    let cursor = app
        .cursor_position()
        .map_err(|error| format!("failed to read cursor position: {error}"))?;
    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read pet window position: {error}"))?;
    let cursor = cursor.to_logical::<i32>(scale_factor);
    let position = physical_position_to_logical(position, scale_factor);
    Ok(sample_pet_cursor_near_command_plan(PetWindowPointerInput {
        cursor: LogicalPosition {
            x: cursor.x,
            y: cursor.y,
        },
        window: pet_window_rect_from_position_with_settings(
            mode,
            LogicalPosition {
                x: position.x,
                y: position.y,
            },
            settings,
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
        let scale_factor = valid_scale_factor(monitor.scale_factor());
        let position = work_area.position.to_logical::<i32>(scale_factor);
        let size = work_area.size.to_logical::<u32>(scale_factor);
        return LogicalRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
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

fn physical_position_to_logical(
    position: TauriPhysicalPosition<i32>,
    scale_factor: f64,
) -> LogicalPosition {
    let position = position.to_logical::<i32>(valid_scale_factor(scale_factor));
    LogicalPosition {
        x: position.x,
        y: position.y,
    }
}

fn scale_factor_for_window(window: &tauri::WebviewWindow) -> f64 {
    window
        .scale_factor()
        .ok()
        .map(valid_scale_factor)
        .unwrap_or(1.0)
}

fn valid_scale_factor(scale_factor: f64) -> f64 {
    if scale_factor.is_sign_positive() && scale_factor.is_normal() {
        scale_factor
    } else {
        1.0
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
        ShellWindowControlAction::Show => {
            if plan.label == "pet" {
                keep_pet_window_above_desktop(&window)?;
            }
            window
                .show()
                .map_err(|error| format!("failed to show {} window: {error}", plan.label))?
        }
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
                if plan.label == "pet" {
                    keep_pet_window_above_desktop(&window)?;
                }
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

fn prepare_pet_window_on_startup(app: &tauri::App) -> Result<(), String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let runtime_state = app.state::<Mutex<PetWindowRuntimeState>>();
    let body_position = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .body_position;
    let settings = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?
        .settings;
    let plan = set_pet_window_mode_command_plan(PetWindowModeCommandInput {
        mode: PetWindowMode::BodyOnly,
        work_area: work_area_for_pet_window(&window),
        body_position,
        settings: Some(settings),
    });
    let placement = plan
        .placement
        .as_ref()
        .ok_or_else(|| "pet startup placement plan is missing".to_string())?;

    apply_pet_window_placement(&window, placement, "startup")?;
    window
        .set_ignore_cursor_events(settings.pass_through)
        .map_err(|error| format!("failed to set pet window startup click-through: {error}"))?;
    keep_pet_window_above_desktop(&window)?;

    let mut state = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    state.mode = PetWindowMode::BodyOnly;
    state.body_position = Some(body_position_from_window_position_with_settings(
        PetWindowMode::BodyOnly,
        placement.position,
        settings,
    ));

    // The pet webview shows itself through set_pet_window_mode after the first DOM paint,
    // so motion capture no longer records cold-start blank frames.
    Ok(())
}

fn create_pet_window_with_surface_flag(app: &tauri::App) -> Result<(), String> {
    if app.get_webview_window("pet").is_some() {
        return Ok(());
    }

    let pet_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "pet")
        .ok_or_else(|| "pet window config is missing".to_string())?;

    let initialization_script =
        pet_window_initialization_script(workhub_cuu_qa_preferences_from_env(|name| {
            std::env::var(name).ok()
        }));

    let window = WebviewWindowBuilder::from_config(app.handle(), pet_config)
        .map_err(|error| format!("failed to create pet window builder: {error}"))?
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .skip_taskbar(true)
        .shadow(false)
        .initialization_script(initialization_script)
        .build()
        .map_err(|error| format!("failed to create pet window: {error}"))?;
    configure_pet_window_chrome(&window)?;

    Ok(())
}

fn configure_pet_window_chrome(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .set_background_color(Some(Color(0, 0, 0, 0)))
        .map_err(|error| format!("failed to make pet window background transparent: {error}"))?;
    window
        .set_shadow(false)
        .map_err(|error| format!("failed to disable pet window shadow: {error}"))?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| format!("failed to keep pet window out of taskbar: {error}"))
}

fn pet_window_initialization_script(preferences: CuuQaPreferenceOverrides) -> String {
    let mut fields = Vec::new();
    if let Some(scale) = preferences.pet_scale_percent {
        fields.push(format!("pet_scale_percent: {scale}"));
    }
    if let Some(opacity) = preferences.pet_opacity_percent {
        fields.push(format!("pet_opacity_percent: {opacity}"));
    }
    if let Some(pass_through) = preferences.pet_pass_through {
        fields.push(format!(
            "pet_pass_through: {}",
            if pass_through { "true" } else { "false" }
        ));
    }
    if let Some(hide_on_hover) = preferences.pet_hide_on_hover {
        fields.push(format!(
            "pet_hide_on_hover: {}",
            if hide_on_hover { "true" } else { "false" }
        ));
    }
    if let Some(model_pack_id) = preferences.pet_model_pack_id {
        fields.push(format!("pet_model_pack_id: \"{model_pack_id}\""));
    }

    let scenario_script = preferences
        .pet_qa_scenario
        .map(|scenario| format!(r#" window.__WORKHUB_CUU_QA_SCENARIO__ = "{scenario}";"#))
        .unwrap_or_default();

    if fields.is_empty() {
        format!(r#"window.__WORKHUB_SURFACE__ = "pet";{scenario_script}"#)
    } else {
        format!(
            r#"window.__WORKHUB_SURFACE__ = "pet"; window.__WORKHUB_CUU_PREFERENCES__ = {{ {} }};{scenario_script}"#,
            fields.join(", "),
        )
    }
}

fn apply_pet_window_placement(
    window: &tauri::WebviewWindow,
    placement: &PetWindowPlacementPlan,
    reason: &str,
) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(
            placement.size.width as f64,
            placement.size.height as f64,
        ))
        .map_err(|error| format!("failed to resize pet window for {reason}: {error}"))?;
    window
        .set_position(TauriLogicalPosition::new(
            placement.position.x as f64,
            placement.position.y as f64,
        ))
        .map_err(|error| format!("failed to position pet window for {reason}: {error}"))
}

fn keep_pet_window_above_desktop(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .set_always_on_top(true)
        .map_err(|error| format!("failed to keep pet window above desktop: {error}"))
}

fn install_workhub_tray(app: &tauri::App) -> Result<(), String> {
    let show_main = tray_menu_action_plan_by_id(TRAY_SHOW_MAIN_ID)
        .ok_or_else(|| "missing show-main tray action".to_string())?;
    let hide_main = tray_menu_action_plan_by_id(TRAY_HIDE_MAIN_ID)
        .ok_or_else(|| "missing hide-main tray action".to_string())?;
    let toggle_pet = tray_menu_action_plan_by_id(TRAY_TOGGLE_PET_ID)
        .ok_or_else(|| "missing toggle-pet tray action".to_string())?;
    let restore_pet = tray_menu_action_plan_by_id(TRAY_RESTORE_PET_INTERACTION_ID)
        .ok_or_else(|| "missing restore-pet-interaction tray action".to_string())?;
    let open_inbox = tray_menu_action_plan_by_id(TRAY_OPEN_INBOX_ID)
        .ok_or_else(|| "missing open-inbox tray action".to_string())?;
    let open_settings = tray_menu_action_plan_by_id(TRAY_OPEN_SETTINGS_ID)
        .ok_or_else(|| "missing open-settings tray action".to_string())?;
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
    let restore_pet_item =
        MenuItemBuilder::with_id(restore_pet.id.as_str(), restore_pet.label.as_str())
            .build(app)
            .map_err(|error| {
                format!("failed to build restore-pet-interaction tray item: {error}")
            })?;
    let open_inbox_item =
        MenuItemBuilder::with_id(open_inbox.id.as_str(), open_inbox.label.as_str())
            .build(app)
            .map_err(|error| format!("failed to build open-inbox tray item: {error}"))?;
    let open_settings_item =
        MenuItemBuilder::with_id(open_settings.id.as_str(), open_settings.label.as_str())
            .build(app)
            .map_err(|error| format!("failed to build open-settings tray item: {error}"))?;
    let quit_item = MenuItemBuilder::with_id(quit.id.as_str(), quit.label.as_str())
        .build(app)
        .map_err(|error| format!("failed to build quit tray item: {error}"))?;

    let menu = MenuBuilder::new(app)
        .item(&show_main_item)
        .item(&hide_main_item)
        .separator()
        .item(&toggle_pet_item)
        .item(&restore_pet_item)
        .item(&open_inbox_item)
        .item(&open_settings_item)
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

fn restore_pet_window_interaction(app: &tauri::AppHandle) -> Result<(), String> {
    let scale_percent = {
        let runtime_state = app.state::<Mutex<PetWindowRuntimeState>>();
        let state = runtime_state
            .lock()
            .map_err(|_| "pet runtime state is poisoned".to_string())?;
        state.settings.scale_percent
    };
    let runtime_state = app.state::<Mutex<PetWindowRuntimeState>>();
    set_pet_window_settings(app.clone(), runtime_state, scale_percent, 100, false, false)?;
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

    if plan.id == TRAY_RESTORE_PET_INTERACTION_ID {
        restore_pet_window_interaction(app)?;
    }

    if let Some(control) = plan.window_control.clone() {
        execute_window_control(app, control)?;
    }

    app.emit("tray-action", plan)
        .map_err(|error| format!("failed to emit tray-action event: {error}"))
}

fn install_workhub_deep_links(app: &tauri::App) -> Result<(), String> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        let schemes = DEEP_LINK_SCHEMES.join(", ");
        app.deep_link().register_all().map_err(|error| {
            format!("failed to register WorkHub deep-link schemes ({schemes}): {error}")
        })?;
    }

    let app_handle = app.handle().clone();
    let start_urls = app
        .deep_link()
        .get_current()
        .map_err(|error| format!("failed to read startup deep-link URLs: {error}"))?;
    if let Some(urls) = start_urls {
        for url in urls {
            handle_deep_link_url(&app_handle, url.as_str())?;
        }
    }

    let listener_app = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if let Err(error) = handle_deep_link_url(&listener_app, url.as_str()) {
                eprintln!("failed to handle WorkHub deep link {}: {error}", url);
            }
        }
    });

    Ok(())
}

fn handle_deep_link_url(app: &tauri::AppHandle, raw_url: &str) -> Result<(), String> {
    let plan = deep_link_plan_from_url(raw_url)
        .map_err(|error| format!("invalid WorkHub deep link {raw_url}: {error:?}"))?;

    execute_window_control(app, plan.window_control.clone())?;
    app.emit(event_channel_name(ShellEvent::DeepLink), plan)
        .map_err(|error| format!("failed to emit deep-link event: {error}"))
}

fn handle_single_instance_launch(
    app: &tauri::AppHandle,
    args: Vec<String>,
    cwd: String,
) -> Result<(), String> {
    let plan = single_instance_plan_from_args(&args, &cwd);
    if plan.deep_links.is_empty() {
        execute_window_control(app, plan.window_control.clone())?;
    } else {
        for deep_link in &plan.deep_links {
            execute_window_control(app, deep_link.window_control.clone())?;
            app.emit(event_channel_name(ShellEvent::DeepLink), deep_link.clone())
                .map_err(|error| format!("failed to emit deep-link event: {error}"))?;
        }
    }

    app.emit(event_channel_name(ShellEvent::SingleInstance), plan)
        .map_err(|error| format!("failed to emit single-instance event: {error}"))
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

fn shell_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("workhub-shell-config.json", BaseDirectory::Config)
        .map_err(|error| format!("failed to resolve shell config path: {error}"))
}

fn load_workhub_shell_config(app: &tauri::AppHandle) -> Result<WorkHubShellConfig, String> {
    let path = shell_config_path(app)?;
    let raw =
        if path.exists() {
            Some(fs::read_to_string(&path).map_err(|error| {
                format!("failed to read shell config {}: {error}", path.display())
            })?)
        } else {
            None
        };

    load_shell_config_from_json_and_env(raw.as_deref(), |name| std::env::var(name).ok())
        .map_err(|error| format!("failed to load shell config {}: {error:?}", path.display()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Err(error) = handle_single_instance_launch(app, args, cwd) {
                eprintln!("failed to handle WorkHub single-instance launch: {error}");
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Mutex::new(PetWindowRuntimeState::default()))
        .setup(|app| {
            create_pet_window_with_surface_flag(app)?;
            if let Ok(Some(saved)) = load_pet_window_saved_placement(&app.handle()) {
                let work_area = app
                    .get_webview_window("pet")
                    .map(|window| work_area_for_pet_window(&window))
                    .unwrap_or_else(default_work_area);
                if let Ok(mut state) = app.state::<Mutex<PetWindowRuntimeState>>().lock() {
                    state.body_position = Some(restore_saved_body_position(&saved, work_area));
                }
            }
            prepare_pet_window_on_startup(app)?;
            install_workhub_tray(app)?;
            install_workhub_deep_links(app)?;
            if workhub_sse_disabled_from_env(|name| std::env::var(name).ok()) {
                eprintln!("WorkHub SSE worker disabled by {WORKHUB_DISABLE_SSE_ENV}.");
            } else {
                let shell_config = load_workhub_shell_config(&app.handle())?;
                spawn_default_shell_sse_workers(app.handle().clone(), shell_config)
                    .map_err(|error| format!("failed to start WorkHub SSE worker: {error:?}"))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_pet_window_mode,
            set_pet_window_settings,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn env_value(value: Option<&'static str>) -> impl Fn(&str) -> Option<String> {
        move |_| value.map(str::to_string)
    }

    fn named_env<'a>(entries: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            entries
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    }

    #[test]
    fn sse_disable_env_accepts_explicit_truthy_values() {
        for value in ["1", "true", "TRUE", "yes", "on", " on "] {
            assert!(workhub_sse_disabled_from_env(env_value(Some(value))));
        }
    }

    #[test]
    fn sse_disable_env_ignores_missing_and_falsey_values() {
        assert!(!workhub_sse_disabled_from_env(env_value(None)));
        for value in ["", "0", "false", "off", "no", "disabled"] {
            assert!(!workhub_sse_disabled_from_env(env_value(Some(value))));
        }
    }

    #[test]
    fn cuu_qa_preferences_env_accepts_hide_on_hover_truthy_values() {
        assert_eq!(
            workhub_cuu_qa_preferences_from_env(named_env(&[(
                WORKHUB_CUU_QA_HIDE_ON_HOVER_ENV,
                "1"
            )]))
            .pet_hide_on_hover,
            Some(true)
        );
        assert_eq!(
            workhub_cuu_qa_preferences_from_env(named_env(&[(
                WORKHUB_CUU_QA_HIDE_ON_HOVER_ENV,
                "true"
            )]))
            .pet_hide_on_hover,
            Some(true)
        );
        assert_eq!(
            workhub_cuu_qa_preferences_from_env(named_env(&[(
                WORKHUB_CUU_QA_HIDE_ON_HOVER_ENV,
                "0"
            )]))
            .pet_hide_on_hover,
            Some(false)
        );
    }

    #[test]
    fn cuu_qa_preferences_env_accepts_window_settings() {
        assert_eq!(
            workhub_cuu_qa_preferences_from_env(named_env(&[
                (WORKHUB_CUU_QA_PET_SCALE_PERCENT_ENV, "150"),
                (WORKHUB_CUU_QA_PET_OPACITY_PERCENT_ENV, "60"),
                (WORKHUB_CUU_QA_PET_PASS_THROUGH_ENV, "true"),
                (WORKHUB_CUU_QA_HIDE_ON_HOVER_ENV, "1"),
                (
                    WORKHUB_CUU_QA_MODEL_PACK_ID_ENV,
                    "cuu-tororo-live2d-cubism2"
                ),
            ])),
            CuuQaPreferenceOverrides {
                pet_scale_percent: Some(150),
                pet_opacity_percent: Some(60),
                pet_pass_through: Some(true),
                pet_hide_on_hover: Some(true),
                pet_model_pack_id: Some("cuu-tororo-live2d-cubism2".to_string()),
                pet_qa_scenario: None,
            }
        );
    }

    #[test]
    fn cuu_qa_preferences_env_ignores_invalid_settings() {
        assert_eq!(
            workhub_cuu_qa_preferences_from_env(named_env(&[
                (WORKHUB_CUU_QA_PET_SCALE_PERCENT_ENV, "110"),
                (WORKHUB_CUU_QA_PET_OPACITY_PERCENT_ENV, "75"),
                (WORKHUB_CUU_QA_PET_PASS_THROUGH_ENV, "0"),
                (WORKHUB_CUU_QA_MODEL_PACK_ID_ENV, "legacy-cuu-pack"),
                (WORKHUB_CUU_QA_SCENARIO_ENV, "orange"),
            ])),
            CuuQaPreferenceOverrides {
                pet_scale_percent: None,
                pet_opacity_percent: None,
                pet_pass_through: Some(false),
                pet_hide_on_hover: None,
                pet_model_pack_id: None,
                pet_qa_scenario: None,
            }
        );
    }

    #[test]
    fn cuu_qa_preferences_env_accepts_business_motion_scenarios() {
        for scenario in ["clarify", "approval", "search", "sync", "done", "offline"] {
            assert_eq!(
                workhub_cuu_qa_preferences_from_env(named_env(&[(
                    WORKHUB_CUU_QA_SCENARIO_ENV,
                    scenario
                )]))
                .pet_qa_scenario,
                Some(scenario.to_string())
            );
        }
    }

    #[test]
    fn pet_initialization_script_can_inject_qa_preferences() {
        assert_eq!(
            pet_window_initialization_script(CuuQaPreferenceOverrides::default()),
            r#"window.__WORKHUB_SURFACE__ = "pet";"#
        );
        let script = pet_window_initialization_script(CuuQaPreferenceOverrides {
            pet_scale_percent: Some(75),
            pet_opacity_percent: Some(80),
            pet_pass_through: Some(true),
            pet_hide_on_hover: Some(true),
            pet_model_pack_id: Some("cuu-tororo-live2d-cubism2".to_string()),
            pet_qa_scenario: Some("approval".to_string()),
        });
        assert!(script.contains("__WORKHUB_CUU_PREFERENCES__"));
        assert!(script.contains("pet_scale_percent: 75"));
        assert!(script.contains("pet_opacity_percent: 80"));
        assert!(script.contains("pet_pass_through: true"));
        assert!(script.contains("pet_hide_on_hover: true"));
        assert!(script.contains(r#"pet_model_pack_id: "cuu-tororo-live2d-cubism2""#));
        assert!(script.contains(r#"__WORKHUB_CUU_QA_SCENARIO__ = "approval""#));
    }
}
