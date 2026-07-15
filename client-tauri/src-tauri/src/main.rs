use workhub_client_tauri::config::{load_shell_config_from_json_and_env, WorkHubShellConfig};
use workhub_client_tauri::deep_link::{deep_link_plan_from_url, describe_deep_link_error};
use workhub_client_tauri::events::{event_channel_name, ShellEvent};
use workhub_client_tauri::locale::{normalize_workhub_locale, WorkHubLocale};
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
use workhub_client_tauri::single_instance::single_instance_plan_from_args_for_locale;
use workhub_client_tauri::sse_worker::{spawn_default_shell_sse_workers, ShellClientToken};
use workhub_client_tauri::tray::{
    tray_menu_action_plan_by_id_for_locale, tray_tooltip, TRAY_HIDE_MAIN_ID, TRAY_OPEN_INBOX_ID,
    TRAY_OPEN_SETTINGS_ID, TRAY_OPEN_WORKBENCH_ID, TRAY_QUIT_ID, TRAY_RESTORE_PET_INTERACTION_ID,
    TRAY_SHOW_MAIN_ID, TRAY_TOGGLE_PET_ID, WORKHUB_TRAY_ID,
};
use workhub_client_tauri::window_controls::{
    focus_main_route as focus_main_route_plan, hide_main_window as hide_main_window_plan,
    hide_pet_window as hide_pet_window_plan, show_main_window as show_main_window_plan,
    show_pet_window as show_pet_window_plan, toggle_pet_window as toggle_pet_window_plan,
    ShellWindowControlAction, ShellWindowControlPlan, ShellWindowControlSource,
};

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    utils::config::Color,
    Emitter, LogicalPosition as TauriLogicalPosition, LogicalSize, Manager,
    PhysicalPosition as TauriPhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(target_os = "macos")]
use objc2_app_kit::NSWindow;

const WORKHUB_DISABLE_SSE_ENV: &str = "WORKHUB_DISABLE_SSE";
const WORKHUB_CUU_QA_HIDE_ON_HOVER_ENV: &str = "WORKHUB_CUU_QA_HIDE_ON_HOVER";
const WORKHUB_CUU_QA_PET_SCALE_PERCENT_ENV: &str = "WORKHUB_CUU_QA_PET_SCALE_PERCENT";
const WORKHUB_CUU_QA_PET_OPACITY_PERCENT_ENV: &str = "WORKHUB_CUU_QA_PET_OPACITY_PERCENT";
const WORKHUB_CUU_QA_PET_PASS_THROUGH_ENV: &str = "WORKHUB_CUU_QA_PET_PASS_THROUGH";
const WORKHUB_CUU_QA_MODEL_PACK_ID_ENV: &str = "WORKHUB_CUU_QA_MODEL_PACK_ID";
const WORKHUB_CUU_QA_SCENARIO_ENV: &str = "WORKHUB_CUU_QA_SCENARIO";
const WORKHUB_CUU_QA_LOCALE_ENV: &str = "WORKHUB_CUU_QA_LOCALE";
const WORKHUB_CUU_QA_DOM_REPORT_PATH_ENV: &str = "WORKHUB_CUU_QA_DOM_REPORT_PATH";
const WORKHUB_CUU_QA_CLIENT_TOKEN_ENV: &str = "WORKHUB_CUU_QA_CLIENT_TOKEN";
const WORKHUB_CUU_QA_RESTORE_STATE_ENV: &str = "WORKHUB_CUU_QA_RESTORE_STATE";
const WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN_ENV: &str = "WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN";
const WORKHUB_CUU_RESTORE_STORAGE_KEY: &str = "workhub.cuu.currentRun.v1";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct CuuQaPreferenceOverrides {
    pet_scale_percent: Option<u16>,
    pet_opacity_percent: Option<u8>,
    pet_pass_through: Option<bool>,
    pet_hide_on_hover: Option<bool>,
    pet_model_pack_id: Option<String>,
    pet_qa_scenario: Option<String>,
    pet_qa_locale: Option<String>,
    pet_qa_dom_report: bool,
    pet_qa_client_token: Option<String>,
    pet_qa_restore_state: Option<String>,
}

fn workhub_sse_disabled_from_env(get_env: impl Fn(&str) -> Option<String>) -> bool {
    workhub_env_flag_enabled(WORKHUB_DISABLE_SSE_ENV, get_env)
}

fn workhub_tray_quit_dry_run_from_env(get_env: impl Fn(&str) -> Option<String>) -> bool {
    workhub_env_flag_enabled(WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN_ENV, &get_env)
        && workhub_env_string_nonempty(WORKHUB_CUU_QA_SCENARIO_ENV, &get_env)
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
            &[
                "launcher",
                "settings-menu",
                "settings-menu-model-switch",
                "settings-menu-hover-sync",
                "pass-through-recovery-settings",
                "pass-through-recovery-tray",
                "pass-through-recovery-tray-physical",
                "clarify",
                "approval",
                "search",
                "sync",
                "done",
                "run-stream",
                "run-failure",
                "reload-session",
                "reload-active-run",
                "reload-terminal-run",
                "permission-401",
                "permission-403",
                "generic-runtime-error",
                "stream-offline",
                "offline",
            ],
        ),
        pet_qa_locale: workhub_qa_locale_from_env(WORKHUB_CUU_QA_LOCALE_ENV, &get_env),
        pet_qa_dom_report: workhub_env_string_nonempty(
            WORKHUB_CUU_QA_DOM_REPORT_PATH_ENV,
            &get_env,
        ),
        pet_qa_client_token: workhub_env_string_value_nonempty(
            WORKHUB_CUU_QA_CLIENT_TOKEN_ENV,
            &get_env,
        ),
        pet_qa_restore_state: workhub_env_string_value_nonempty(
            WORKHUB_CUU_QA_RESTORE_STATE_ENV,
            &get_env,
        ),
    }
}

fn workhub_qa_locale_from_env<F>(name: &str, get_env: &F) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    workhub_env_string_value_nonempty(name, get_env)
        .map(|value| normalize_workhub_locale(&value).as_str().to_string())
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

fn workhub_env_string_nonempty<F>(name: &str, get_env: &F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    get_env(name)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn workhub_env_string_value_nonempty<F>(name: &str, get_env: &F) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    let value = get_env(name)?.trim().to_string();
    (!value.is_empty()).then_some(value)
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

    app.emit_to(
        "pet",
        "pet-settings",
        serde_json::json!({
            "scale_percent": next_settings.scale_percent,
            "opacity_percent": next_settings.opacity_percent,
            "pass_through": next_settings.pass_through,
            "hide_on_hover": next_settings.hide_on_hover,
        }),
    )
    .map_err(|error| format!("failed to emit pet settings event: {error}"))?;

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

#[derive(Clone, Copy, serde::Serialize)]
struct PetCursorClientPosition {
    x: i32,
    y: i32,
    inside: bool,
}

// R7.1 桌宠动态穿透：返回原生光标在 pet 窗口客户区的逻辑坐标(CSS px)+ 是否落在窗口内。
// webview 拿它配合 elementFromPoint 做命中测试，决定该不该让窗口点击穿透到下方应用。
// 穿透开启时 webview 收不到任何鼠标事件，所以必须由原生侧采样光标，而不能靠 webview 的 mousemove。
#[tauri::command]
fn pet_cursor_client_position(app: tauri::AppHandle) -> Result<PetCursorClientPosition, String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let scale_factor = scale_factor_for_window(&window);
    let cursor = app
        .cursor_position()
        .map_err(|error| format!("failed to read cursor position: {error}"))?;
    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read pet window position: {error}"))?;
    let size = window
        .inner_size()
        .map_err(|error| format!("failed to read pet window size: {error}"))?;
    let cursor = cursor.to_logical::<i32>(scale_factor);
    let position = physical_position_to_logical(position, scale_factor);
    let size = size.to_logical::<i32>(scale_factor);
    let x = cursor.x - position.x;
    let y = cursor.y - position.y;
    let inside = x >= 0 && y >= 0 && x < size.width && y < size.height;
    Ok(PetCursorClientPosition { x, y, inside })
}

// R8：webview 把首启 bootstrap 拿到的设备令牌(localStorage workhub_client_token)推给 Rust 壳层，
// 供 SSE worker 每次重连注入鉴权头 → 全局 /api/push/stream 不再 401、Cuu 上线。空串视为清空。
#[tauri::command]
fn set_client_token(state: tauri::State<'_, ShellClientToken>, token: String) {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        eprintln!("WorkHub: client token cleared by webview");
        if let Ok(mut guard) = state.0.lock() {
            *guard = None;
        }
        return;
    }
    // 仅记录尾 4 位用于诊断（绝不打印完整令牌）。SSE worker 下一拍重连即带它鉴权 → Cuu 上线。
    // rank21：按「字符」取末 4 位，不按字节切片——token 来自 webview localStorage，非保证 ASCII，
    // 字节切片若落在多字节字符边界内会 panic 掉这个 #[tauri::command]。
    let tail = trimmed
        .char_indices()
        .nth_back(3)
        .map(|(i, _)| &trimmed[i..])
        .unwrap_or(trimmed);
    eprintln!("WorkHub: client token received (…{tail}); SSE /me authenticates on next reconnect");
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(trimmed.to_string());
    }
    // RUST-1：唤醒在退避 sleep 上等待的 SSE worker，令牌一到即刻重连（不再干等满一个退避周期）。
    state.1.notify_waiters();
}

// R8 真·Spotlight：webview 测得盒子内容高度后调它缩放主窗（盒子随内容生长/收缩，苹果聚焦风）。
// 只改 main 窗内尺寸，top-left 锚定不动 → 向下生长。clamp 防 webview 传来的异常值把窗口撑爆/压没。
fn clamp_spotlight_size(width: f64, height: f64) -> (f64, f64) {
    let safe_width = if width.is_finite() { width.clamp(420.0, 1600.0) } else { 720.0 };
    let safe_height = if height.is_finite() { height.clamp(48.0, 1400.0) } else { 480.0 };
    (safe_width, safe_height)
}

#[tauri::command]
fn set_spotlight_size(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    // 下限对齐窗口计划的 minWidth=420 / minHeight=48，让 idle 细搜索条能真正贴住内容；上限防越界。
    let (safe_width, safe_height) = clamp_spotlight_size(width, height);
    window
        .set_size(LogicalSize::new(safe_width, safe_height))
        .map_err(|error| format!("failed to resize main window: {error}"))?;
    // chain3：内容变高时把窗口顶回工作区内——否则小屏 / 窗口被拖到靠下时，盒子底部会长到屏幕外够不着。
    keep_window_bottom_in_work_area(&window, safe_height);
    Ok(())
}

#[tauri::command]
fn start_main_window_drag(window: tauri::Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window drag can only be started from the main window".to_string());
    }
    window
        .start_dragging()
        .map_err(|error| format!("failed to start main window dragging: {error}"))
}

#[tauri::command]
fn move_main_window_by(app: tauri::AppHandle, delta_x: f64, delta_y: f64) -> Result<(), String> {
    if !delta_x.is_finite() || !delta_y.is_finite() {
        return Ok(());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        _ => window.primary_monitor().ok().flatten(),
    };
    let scale = monitor
        .map(|monitor| valid_scale_factor(monitor.scale_factor()))
        .unwrap_or(1.0);
    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read main window position: {error}"))?
        .to_logical::<f64>(scale);
    window
        .set_position(TauriLogicalPosition::new(
            position.x + delta_x,
            position.y + delta_y,
        ))
        .map_err(|error| format!("failed to move main window: {error}"))
}

// 若窗口底边超出当前显示器工作区，则上移使其落回区内（不小于工作区顶）。失败不致命。
fn keep_window_bottom_in_work_area(window: &tauri::WebviewWindow, height_logical: f64) {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        _ => window.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        return;
    };
    let scale = valid_scale_factor(monitor.scale_factor());
    let area = monitor.work_area();
    let area_pos = area.position.to_logical::<f64>(scale);
    let area_size = area.size.to_logical::<f64>(scale);
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let pos = pos.to_logical::<f64>(scale);
    let max_bottom = area_pos.y + area_size.height;
    if pos.y + height_logical > max_bottom {
        let new_y = (max_bottom - height_logical).max(area_pos.y);
        let _ = window.set_position(TauriLogicalPosition::new(pos.x, new_y));
    }
}

// R7.1：切换 pet 窗口的 ignore_cursor_events(true=点击穿透到下方/false=接管点击)。由 webview 命中测试驱动，
// 默认在缝隙处穿透、仅在猫猫实体与气泡上接管，替代旧的「整窗静态 pass_through」全有或全无开关。
#[tauri::command]
fn set_pet_window_click_through(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| format!("failed to set pet window click-through: {error}"))?;
    Ok(())
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

#[tauri::command]
fn write_cuu_qa_dom_report(report_json: String) -> Result<(), String> {
    let Some(path) = std::env::var(WORKHUB_CUU_QA_DOM_REPORT_PATH_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    else {
        return Ok(());
    };
    let report: serde_json::Value = serde_json::from_str(&report_json)
        .map_err(|error| format!("failed to parse Cuu QA DOM report JSON: {error}"))?;
    write_cuu_qa_dom_report_to_path(&path, &report)
}

fn write_cuu_qa_dom_report_to_path(path: &Path, report: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Cuu QA DOM report directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(report)
        .map_err(|error| format!("failed to serialize Cuu QA DOM report: {error}"))?;
    fs::write(path, raw).map_err(|error| {
        format!(
            "failed to write Cuu QA DOM report {}: {error}",
            path.display()
        )
    })
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
        if let Err(error) = configure_main_window_chrome(&window) {
            eprintln!("failed to configure main window chrome; continuing window control: {error}");
        }
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
    window
        .show()
        .map_err(|error| format!("failed to show pet window on startup: {error}"))?;

    let mut state = runtime_state
        .lock()
        .map_err(|_| "pet runtime state is poisoned".to_string())?;
    state.mode = PetWindowMode::BodyOnly;
    state.body_position = Some(body_position_from_window_position_with_settings(
        PetWindowMode::BodyOnly,
        placement.position,
        settings,
    ));

    // The pet window is visible on startup but never focused; the webview still
    // syncs the exact body/card mode after its first DOM paint.
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

    let mut builder = WebviewWindowBuilder::new(
        app.handle(),
        pet_config.label.clone(),
        WebviewUrl::App("pet.html".into()),
    )
    .title(pet_config.title.clone())
    .inner_size(pet_config.width, pet_config.height)
    .resizable(pet_config.resizable)
    .maximizable(pet_config.maximizable)
    .minimizable(pet_config.minimizable)
    .closable(pet_config.closable)
    .fullscreen(pet_config.fullscreen)
    .focused(pet_config.focus)
    .decorations(pet_config.decorations)
    .always_on_top(pet_config.always_on_top)
    .skip_taskbar(true)
    .visible(pet_config.visible)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .shadow(false)
    .initialization_script(initialization_script);
    if let (Some(min_width), Some(min_height)) = (pet_config.min_width, pet_config.min_height) {
        builder = builder.min_inner_size(min_width, min_height);
    }
    if pet_config.center {
        builder = builder.center();
    }

    let window = builder
        .build()
        .map_err(|error| format!("failed to create pet window: {error}"))?;
    configure_pet_window_chrome(&window)?;

    Ok(())
}

fn create_workbench_window_if_missing(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("workbench") {
        return Ok(window);
    }
    // R13 真机根因二号（webview 空白灰）：Tauri command 跑在线程池上,而 macOS 的窗口创建/Overlay 标题栏/
    // 红绿灯偏移都是 AppKit 主线程契约——非主线程建窗时窗框能出来（红绿灯可见）,webview 内容却不挂/零尺寸。
    // 与 apply_vibrancy 主线程修复同族:整个建窗过程调度回主线程,用通道同步拿结果（5s 超时防死等）。
    if std::thread::current().name() != Some("main") {
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = tx.send(create_workbench_window_if_missing(&handle));
        })
        .map_err(|error| format!("failed to schedule workbench window creation: {error}"))?;
        return rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| format!("workbench window creation timed out: {error}"))?;
    }

    let workbench_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "workbench")
        .ok_or_else(|| "workbench window config is missing".to_string())?;

    let mut builder = WebviewWindowBuilder::new(
        app,
        workbench_config.label.clone(),
        WebviewUrl::App("workbench.html".into()),
    )
    .title(workbench_config.title.clone())
    .inner_size(workbench_config.width, workbench_config.height)
    .resizable(workbench_config.resizable)
    .maximizable(workbench_config.maximizable)
    .minimizable(workbench_config.minimizable)
    .closable(workbench_config.closable)
    .fullscreen(workbench_config.fullscreen)
    .focused(workbench_config.focus)
    // Cross-platform base: frameless + fully self-drawn chrome (min/close buttons in shell.ts).
    // The macOS branch below overrides this to native traffic lights.
    .decorations(workbench_config.decorations)
    .always_on_top(workbench_config.always_on_top)
    .skip_taskbar(workbench_config.skip_taskbar)
    .visible(workbench_config.visible)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    // R13 批 V2：圆角工艺三层打架的第二块——阴影交给原生 NSWindow.hasShadow（webview 侧的
    // CSS box-shadow 已删，见 css.ts），显式声明而不依赖 tao 的隐式默认值。
    .shadow(true);
    // R13 批 V2：macOS 用原生红绿灯（decorations:true + titleBarStyle Overlay + hiddenTitle），
    // 标题栏透明、内容全出血（webview 撑满整个窗口，webview 侧的 .wh-wb-titlebar 仍渲染，只是自绘的
    // min/close 按钮不再渲染——见 shell.ts renderWorkbenchShellHtml 的 nativeWindowChrome 分支）。
    // trafficLightPosition 把红绿灯挪进玻璃内部的呼吸空间，跟 css.ts 的 .wh-wb-titlebar--native
    // padding-left 对应（真机像素值待集成者核对，见批 V2 报告的验收清单）。用户已拍板 Windows 暂不做
    // 平台分支，非 macOS 维持上面的 decorations:false 全自绘路径不变。
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(18.0, 16.0));
    }
    if let (Some(min_width), Some(min_height)) =
        (workbench_config.min_width, workbench_config.min_height)
    {
        builder = builder.min_inner_size(min_width, min_height);
    }
    if workbench_config.center {
        builder = builder.center();
    }

    let window = builder
        .build()
        .map_err(|error| format!("failed to create workbench window: {error}"))?;
    // R13 真机根因（验收 F-01）:apply_vibrancy 只能在主线程调,而 open_workbench 作为 Tauri command
    // 跑在线程池上——此前直接调用永远静默失败(eprintln 无人看),工作台从没真正有过毛玻璃,用户看到的
    // 是 CSS 半透兜底的"实底"。必须调度回主线程。
    let glass_window = window.clone();
    if let Err(error) = window.run_on_main_thread(move || apply_workbench_glass(&glass_window)) {
        eprintln!("failed to schedule workbench glass on main thread: {error}");
    }
    Ok(window)
}

// 工作台毛玻璃:同主窗策略——透明窗 + OS 原生材质(macOS vibrancy / Windows acrylic),透明窗里
// CSS backdrop-filter 无内容可糊。失败不致命(前端 ds-glass-strong 半透底兜底),但留下真机诊断。
fn apply_workbench_glass(window: &tauri::WebviewWindow) {
    if let Err(error) = window.set_background_color(Some(Color(0, 0, 0, 0))) {
        eprintln!("failed to clear workbench window background: {error}");
    }
    // R13 V1：固定浅色玻璃（用户拍板）——先把窗口外观钉死 light（系统深色模式下浅色材质会翻黑,
    // set_theme 在 macOS 落到 NSAppearance）,材质从深色 HudWindow 换 UnderWindowBackground
    // （浅外观下的标准衬底毛玻璃;真机 A/B 候选还有 Sidebar/Popover,以与聚焦盒浅色面板协调为准）。
    if let Err(error) = window.set_theme(Some(tauri::Theme::Light)) {
        eprintln!("failed to pin workbench light appearance: {error}");
    }
    #[cfg(target_os = "macos")]
    if std::env::var("WORKHUB_DISABLE_VIBRANCY").is_err() {
        if let Err(error) = window_vibrancy::apply_vibrancy(
            window,
            window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
            Some(window_vibrancy::NSVisualEffectState::Active),
            Some(24.0),
        ) {
            eprintln!("workbench vibrancy unavailable, falling back to translucent base: {error}");
        }
    }
    #[cfg(target_os = "windows")]
    if let Err(error) = window_vibrancy::apply_acrylic(window, Some((24, 24, 32, 120))) {
        eprintln!("workbench acrylic unavailable, falling back to translucent base: {error}");
    }
}

// R12:打开项目工作台。合成规范深链走统一管线(段校验/窗口分流/deep-link 事件),不造第二条控制路。
#[tauri::command]
fn open_workbench(
    app: tauri::AppHandle,
    project_id: Option<String>,
    conversation_id: Option<String>,
) -> Result<(), String> {
    let project_id = project_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let conversation_id = conversation_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if conversation_id.is_some() && project_id.is_none() {
        return Err("open_workbench: conversation_id requires project_id".to_string());
    }
    for id in [project_id.as_deref(), conversation_id.as_deref()]
        .into_iter()
        .flatten()
    {
        if id.contains('/') || id.contains('\\') || id.contains('?') || id.contains('#') {
            return Err(format!("open_workbench: unsafe id segment: {id}"));
        }
    }

    let mut url = String::from("workhub://workbench");
    if let Some(project) = project_id {
        url.push('/');
        url.push_str(&project);
        if let Some(conversation) = conversation_id {
            url.push('/');
            url.push_str(&conversation);
        }
    }
    handle_deep_link_url(&app, &url)
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
    let locale_script = preferences
        .pet_qa_locale
        .map(|locale| format!(r#" window.__WORKHUB_CUU_QA_LOCALE__ = "{locale}";"#))
        .unwrap_or_default();
    let dom_report_script = if preferences.pet_qa_dom_report {
        r#" window.__WORKHUB_CUU_QA_DOM_REPORT__ = true;"#
    } else {
        ""
    };
    let client_token_script = preferences
        .pet_qa_client_token
        .map(|token| {
            let token = js_string_literal(&token);
            format!(
                r#" try {{ window.localStorage.setItem("workhub_client_token", {token}); window.localStorage.setItem("yqgl_client_token", {token}); }} catch (_) {{}}"#
            )
        })
        .unwrap_or_default();
    let restore_state_script = preferences
        .pet_qa_restore_state
        .map(|state| {
            let state = js_string_literal(&state);
            format!(
                r#" try {{ window.localStorage.setItem("{WORKHUB_CUU_RESTORE_STORAGE_KEY}", {state}); }} catch (_) {{}}"#
            )
        })
        .unwrap_or_default();

    if fields.is_empty() {
        format!(
            r#"window.__WORKHUB_SURFACE__ = "pet";{scenario_script}{locale_script}{dom_report_script}{client_token_script}{restore_state_script}"#
        )
    } else {
        format!(
            r#"window.__WORKHUB_SURFACE__ = "pet"; window.__WORKHUB_CUU_PREFERENCES__ = {{ {} }};{scenario_script}{locale_script}{dom_report_script}{client_token_script}{restore_state_script}"#,
            fields.join(", "),
        )
    }
}

fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
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

fn configure_main_window_chrome(window: &tauri::WebviewWindow) -> Result<(), String> {
    configure_main_window_hit_surface(window)?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| format!("failed to keep main window pointer events enabled: {error}"))?;
    configure_main_window_native_drag(window)
}

#[derive(Clone, Copy)]
enum MainWindowStartupFallbackStep {
    Chrome,
    MacosVibrancy,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    WindowsAcrylic,
}

impl MainWindowStartupFallbackStep {
    fn action(self) -> &'static str {
        match self {
            Self::Chrome => "configure main window chrome during startup",
            Self::MacosVibrancy => "apply main window macOS vibrancy",
            Self::WindowsAcrylic => "apply main window Windows acrylic",
        }
    }
}

fn main_window_startup_fallback_message(
    step: MainWindowStartupFallbackStep,
    error: impl std::fmt::Display,
) -> String {
    format!(
        "failed to {}; continuing with CSS glass fallback: {error}",
        step.action()
    )
}

fn log_main_window_startup_fallback(
    step: MainWindowStartupFallbackStep,
    error: impl std::fmt::Display,
) {
    eprintln!("{}", main_window_startup_fallback_message(step, error));
}

#[cfg(target_os = "macos")]
fn configure_main_window_hit_surface(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .set_background_color(Some(Color(0, 0, 0, 1)))
        .map_err(|error| format!("failed to make main window hit surface opaque: {error}"))
}

#[cfg(not(target_os = "macos"))]
fn configure_main_window_hit_surface(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_main_window_native_drag(window: &tauri::WebviewWindow) -> Result<(), String> {
    let ns_window = window
        .ns_window()
        .map_err(|error| format!("failed to read main NSWindow handle: {error}"))?;
    if ns_window.is_null() {
        return Err("main NSWindow handle is null".to_string());
    }
    let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
    ns_window.setMovable(true);
    ns_window.setMovableByWindowBackground(true);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn configure_main_window_native_drag(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

// R8 真·Spotlight：启动时把主窗摆到屏幕上方居中（苹果聚焦盒的位置），之后随内容向下生长。失败不致命。
fn position_main_window_top_center(window: &tauri::WebviewWindow) {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        _ => window.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        return;
    };
    let scale = valid_scale_factor(monitor.scale_factor());
    let area = monitor.work_area();
    let area_pos = area.position.to_logical::<f64>(scale);
    let area_size = area.size.to_logical::<f64>(scale);
    let Ok(inner) = window.inner_size() else {
        return;
    };
    let inner = inner.to_logical::<f64>(scale);
    let x = area_pos.x + (area_size.width - inner.width).max(0.0) / 2.0;
    let y = area_pos.y + area_size.height * 0.10;
    let _ = window.set_position(TauriLogicalPosition::new(x, y));
}

fn install_workhub_tray(app: &tauri::App, locale: WorkHubLocale) -> Result<(), String> {
    let show_main = tray_menu_action_plan_by_id_for_locale(TRAY_SHOW_MAIN_ID, locale)
        .ok_or_else(|| "missing show-main tray action".to_string())?;
    let hide_main = tray_menu_action_plan_by_id_for_locale(TRAY_HIDE_MAIN_ID, locale)
        .ok_or_else(|| "missing hide-main tray action".to_string())?;
    let toggle_pet = tray_menu_action_plan_by_id_for_locale(TRAY_TOGGLE_PET_ID, locale)
        .ok_or_else(|| "missing toggle-pet tray action".to_string())?;
    let restore_pet =
        tray_menu_action_plan_by_id_for_locale(TRAY_RESTORE_PET_INTERACTION_ID, locale)
            .ok_or_else(|| "missing restore-pet-interaction tray action".to_string())?;
    let open_inbox = tray_menu_action_plan_by_id_for_locale(TRAY_OPEN_INBOX_ID, locale)
        .ok_or_else(|| "missing open-inbox tray action".to_string())?;
    let open_settings = tray_menu_action_plan_by_id_for_locale(TRAY_OPEN_SETTINGS_ID, locale)
        .ok_or_else(|| "missing open-settings tray action".to_string())?;
    // R13 批 V2：托盘加「打开工作台」，跟 open_settings 同款挂法（构建 MenuItemBuilder → 塞进
    // MenuBuilder），行为特判在 handle_tray_action 里直接调 open_workbench。
    let open_workbench = tray_menu_action_plan_by_id_for_locale(TRAY_OPEN_WORKBENCH_ID, locale)
        .ok_or_else(|| "missing open-workbench tray action".to_string())?;
    let quit = tray_menu_action_plan_by_id_for_locale(TRAY_QUIT_ID, locale)
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
    let open_workbench_item =
        MenuItemBuilder::with_id(open_workbench.id.as_str(), open_workbench.label.as_str())
            .build(app)
            .map_err(|error| format!("failed to build open-workbench tray item: {error}"))?;
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
        .item(&open_workbench_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|error| format!("failed to build WorkHub tray menu: {error}"))?;

    let mut builder = TrayIconBuilder::with_id(WORKHUB_TRAY_ID)
        .tooltip(tray_tooltip(locale))
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

fn restore_pet_window_interaction_state(app: &tauri::AppHandle) -> Result<(), String> {
    // RUST-3：恢复交互只该复位 pass_through / hide_on_hover。此前 opacity 硬编码 100，会把用户特意调过的
    // 60%/80% 透明度悄悄重置——scale 已保留、opacity 却没,口径不一致。读回用户设的 opacity 一并保留。
    let (scale_percent, opacity_percent) = {
        let runtime_state = app.state::<Mutex<PetWindowRuntimeState>>();
        let state = runtime_state
            .lock()
            .map_err(|_| "pet runtime state is poisoned".to_string())?;
        (state.settings.scale_percent, state.settings.opacity_percent)
    };
    let runtime_state = app.state::<Mutex<PetWindowRuntimeState>>();
    set_pet_window_settings(app.clone(), runtime_state, scale_percent, opacity_percent, false, false)?;
    Ok(())
}

#[tauri::command]
fn restore_pet_window_interaction(app: tauri::AppHandle) -> Result<(), String> {
    handle_tray_action(&app, TRAY_RESTORE_PET_INTERACTION_ID)
}

fn handle_tray_action(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let locale = current_workhub_locale(app);
    let Some(plan) = tray_menu_action_plan_by_id_for_locale(id, locale) else {
        return Ok(());
    };

    if plan.exits_app {
        if workhub_tray_quit_dry_run_from_env(|name| std::env::var(name).ok()) {
            app.emit("tray-action", plan)
                .map_err(|error| format!("failed to emit tray-action event: {error}"))?;
            return Ok(());
        }
        app.exit(0);
        return Ok(());
    }

    if plan.id == TRAY_RESTORE_PET_INTERACTION_ID {
        restore_pet_window_interaction_state(app)?;
    }

    // R13 批 V2：「打开工作台」不走通用 window_control（那套假定窗口已存在）——workbench 窗
    // create:false 按需建，且"无参数=复用上次选中项目/前端默认态"这个语义已经在 open_workbench
    // 自己的深链管线里定义好了（同 workhub://workbench 深链、同 create_workbench_window_if_missing
    // 的存在即复用逻辑），这里直接复用它，不新造第二条控制路。
    if plan.id == TRAY_OPEN_WORKBENCH_ID {
        open_workbench(app.clone(), None, None)?;
    }

    if let Some(control) = plan.window_control.clone() {
        execute_window_control(app, control)?;
    }

    app.emit("tray-action", plan)
        .map_err(|error| format!("failed to emit tray-action event: {error}"))
}

fn current_workhub_locale(app: &tauri::AppHandle) -> WorkHubLocale {
    app.state::<Mutex<WorkHubLocale>>()
        .lock()
        .map(|locale| *locale)
        .unwrap_or_default()
}

fn install_workhub_deep_links(app: &tauri::App) -> Result<(), String> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        use workhub_client_tauri::deep_link::DEEP_LINK_SCHEMES;

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
            // A malformed cold-start deep link must never brick launch: log and
            // continue, mirroring the runtime on_open_url handler below rather
            // than propagating with `?` and aborting the whole app setup.
            if let Err(error) = handle_deep_link_url(&app_handle, url.as_str()) {
                eprintln!("failed to handle startup deep link {url}: {error}");
            }
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
    let locale = current_workhub_locale(app);
    let plan = deep_link_plan_from_url(raw_url).map_err(|error| {
        format!(
            "invalid WorkHub deep link {raw_url}: {}",
            describe_deep_link_error(&error, locale)
        )
    })?;

    // 工作台窗按需创建(conf 里 create:false);先确保存在再执行 show/focus,否则冷启动深链会打空。
    if plan.window_control.label == "workbench" {
        create_workbench_window_if_missing(app)?;
    }
    execute_window_control(app, plan.window_control.clone())?;
    app.emit(event_channel_name(ShellEvent::DeepLink), plan)
        .map_err(|error| format!("failed to emit deep-link event: {error}"))
}

fn handle_single_instance_launch(
    app: &tauri::AppHandle,
    args: Vec<String>,
    cwd: String,
) -> Result<(), String> {
    let plan = single_instance_plan_from_args_for_locale(&args, &cwd, current_workhub_locale(app));
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

// findings[#132/H15] + R13 批 V2：main/workbench 都是 create:false 复用同一个窗口实例（托盘/深链/
// 通知/open_workbench 都要能再次唤起），关闭按钮（不管是自绘的还是 macOS 原生红绿灯的）语义都是
// 「藏起来」而不是「销毁」——销毁后下次唤起都会先撞见 get_webview_window(label)==None。pet 窗口
// visible:false 也是常驻复用，但它从不带 OS 关闭按钮（decorations:false 全自绘，且没有关闭 UI），
// 不需要拦截。抽成纯函数是因为这条判断此前内联在 on_window_event 闭包里、完全没有测试覆盖过。
fn should_hide_instead_of_close(window_label: &str) -> bool {
    matches!(window_label, "main" | "workbench")
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
        .manage(Mutex::new(WorkHubLocale::default()))
        // R8：webview bootstrap 拿到的设备令牌经 set_client_token 写入此处，供 Rust SSE worker 鉴权（修 Cuu 重连中）。
        .manage(ShellClientToken::default())
        .on_window_event(|window, event| {
            // findings[#132/H15]：主窗口带 OS 关闭按钮(tauri.conf decorations:true)，Tauri v2 默认关闭即销毁 webview，
            // 之后托盘/深链/通知再想唤起主窗都会因 get_webview_window("main")==None 而失败（execute_window_control 报错），
            // 等于关一次主窗就永久失联。改为「关闭即收进托盘」：拦截 main 窗的 CloseRequested、阻止真正关闭、改为隐藏；
            // show_main_window（托盘/深链/通知触发）仍可把它重新显示出来。
            // R13 批 V2：workbench 窗在 macOS 换成原生红绿灯（decorations:true + titleBarStyle Overlay）后，
            // 点原生关闭按钮会触发同样的默认销毁行为——workbench 窗是 create:false 复用同一个实例
            // （create_workbench_window_if_missing 先查存在再建），销毁一次就必须重新走一遍窗口构建，
            // 且下次 open_workbench/深链/托盘唤起都会先撞见"窗口不存在"。语义上关闭按钮本就是「藏起来」
            // （shell.ts 自绘关闭按钮此前就是调 hide 不是 close，见 window-bridge.ts），拦截逻辑照 main 窗同款处理，
            // 让原生红绿灯的关闭按钮和自绘关闭按钮语义一致。pet 等其它 label 的窗口行为不变。
            if should_hide_instead_of_close(window.label()) {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let shell_config = load_workhub_shell_config(&app.handle())?;
            if let Ok(mut locale) = app.state::<Mutex<WorkHubLocale>>().lock() {
                *locale = shell_config.locale;
            }
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
            install_workhub_tray(app, shell_config.locale)?;
            install_workhub_deep_links(app)?;
            if workhub_sse_disabled_from_env(|name| std::env::var(name).ok()) {
                eprintln!("WorkHub SSE worker disabled by {WORKHUB_DISABLE_SSE_ENV}.");
            } else {
                spawn_default_shell_sse_workers(app.handle().clone(), shell_config)
                    .map_err(|error| format!("failed to start WorkHub SSE worker: {error:?}"))?;
            }
            // R13 真机迭代 QA 钩子（与 WORKHUB_DISABLE_VIBRANCY 同族,仅本机截图验收用）:置位时启动即开
            // 工作台窗,免去截图流水线里"深链被旧注册劫持/键盘敲不进聚焦盒"的木偶戏。生产不置位=零行为变化。
            if std::env::var("WORKHUB_QA_OPEN_WORKBENCH").is_ok() {
                let qa_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    if let Err(error) = open_workbench(qa_handle, None, None) {
                        eprintln!("qa open_workbench failed: {error}");
                    }
                });
            }
            // 主窗口保持透明 + 原生拖拽，且贴一层 OS 级毛玻璃（macOS vibrancy / Windows acrylic）让玻璃真正"磨砂"
            // 透出桌面 —— 纯透明窗里 CSS backdrop-filter 无内容可糊，半透白底也只是奶白不带模糊，真·毛玻璃必须靠原生材质。
            // 失败不致命（不支持的系统退回半透白底 ds-glass-strong 兜底），但必须留下真机诊断。第 4 参数=圆角半径，对齐盒子 24px。
            // WORKHUB_DISABLE_VIBRANCY（仅自动化截图验收用）置位时跳过——vibrancy 窗由窗口服务器合成会被原生截图过滤掉。
            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(error) = configure_main_window_chrome(&main_window) {
                    log_main_window_startup_fallback(MainWindowStartupFallbackStep::Chrome, error);
                }
                #[cfg(target_os = "macos")]
                if std::env::var("WORKHUB_DISABLE_VIBRANCY").is_err() {
                    // R14 真机反馈：聚焦盒肉眼看"太透"（背景穿透强），但 screencapture 截图仍是预期的半透明——
                    // vibrancy 是窗口服务器原生合成，截图工具天生看不到它，只有肉眼能看出真实观感。根因是材质：
                    // HudWindow 是深色 HUD 材质、不跟随系统外观；工作台窗踩过同一类"材质与浅色玻璃前景不搭"的坑
                    // （R13 F-01，见 r13-workbench-refinement/00-plan.md），修法是换成跟随外观的
                    // UnderWindowBackground 并把外观钉死 Light（聚焦盒 CSS 本就是硬编码浅色，不适配系统深色，
                    // 不钉死的话深色模式下 UnderWindowBackground 会翻黑）。聚焦盒抄同一份材质。
                    if let Err(error) = main_window.set_theme(Some(tauri::Theme::Light)) {
                        log_main_window_startup_fallback(
                            MainWindowStartupFallbackStep::MacosVibrancy,
                            error,
                        );
                    }
                    // state=Active 强制毛玻璃常亮：默认 FollowsWindowActiveState 会让窗口"没被点中(非 key)"时
                    // vibrancy 退成扁平不透明材质 —— 表现就是"点一下才有毛玻璃"。聚焦盒不抢焦点也要一直是玻璃。
                    if let Err(error) = window_vibrancy::apply_vibrancy(
                        &main_window,
                        window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
                        Some(window_vibrancy::NSVisualEffectState::Active),
                        Some(24.0),
                    ) {
                        log_main_window_startup_fallback(
                            MainWindowStartupFallbackStep::MacosVibrancy,
                            error,
                        );
                    }
                }
                #[cfg(target_os = "windows")]
                if let Err(error) =
                    window_vibrancy::apply_acrylic(&main_window, Some((24, 24, 32, 120)))
                {
                    log_main_window_startup_fallback(
                        MainWindowStartupFallbackStep::WindowsAcrylic,
                        error,
                    );
                }
            }
            // R8 真·Spotlight：把主窗摆到屏幕上方居中（聚焦盒位置）；之后 set_spotlight_size 随内容缩放。
            if let Some(main_window) = app.get_webview_window("main") {
                position_main_window_top_center(&main_window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_pet_window_mode,
            set_pet_window_settings,
            start_pet_window_drag,
            save_pet_window_position,
            sample_pet_cursor_near,
            pet_cursor_client_position,
            set_pet_window_click_through,
            set_client_token,
            set_spotlight_size,
            start_main_window_drag,
            move_main_window_by,
            show_main_window,
            hide_main_window,
            focus_main_route,
            open_workbench,
            show_pet_window,
            hide_pet_window,
            toggle_pet_window,
            restore_pet_window_interaction,
            write_cuu_qa_dom_report
        ])
        .run(tauri::generate_context!())
        // 启动失败（坏 tauri.conf.json / 缺 main·pet 窗口标签 / 缺图标 / 插件初始化失败等）原本只 panic 出
        // 一句无上下文的 "failed to run WorkHub Tauri shell"。改为打印真实错误(Debug)再非零退出，便于诊断。
        .unwrap_or_else(|error| {
            eprintln!("WorkHub Tauri shell failed to start: {error:?}");
            std::process::exit(1);
        });
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
    fn should_hide_instead_of_close_covers_main_and_workbench_but_not_pet_or_unknown_labels() {
        assert!(should_hide_instead_of_close("main"));
        assert!(should_hide_instead_of_close("workbench"));
        assert!(!should_hide_instead_of_close("pet"));
        assert!(!should_hide_instead_of_close("some-other-window"));
    }

    #[test]
    fn main_window_startup_fallback_messages_keep_real_device_diagnostics() {
        assert_eq!(
            main_window_startup_fallback_message(
                MainWindowStartupFallbackStep::Chrome,
                "main NSWindow handle is null"
            ),
            "failed to configure main window chrome during startup; continuing with CSS glass fallback: main NSWindow handle is null"
        );
        assert_eq!(
            main_window_startup_fallback_message(
                MainWindowStartupFallbackStep::MacosVibrancy,
                "visual effect view failed"
            ),
            "failed to apply main window macOS vibrancy; continuing with CSS glass fallback: visual effect view failed"
        );
        assert_eq!(
            main_window_startup_fallback_message(
                MainWindowStartupFallbackStep::WindowsAcrylic,
                "composition unavailable"
            ),
            "failed to apply main window Windows acrylic; continuing with CSS glass fallback: composition unavailable"
        );
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
    fn spotlight_size_clamp_allows_idle_search_bar_height() {
        assert_eq!(clamp_spotlight_size(720.0, 52.0), (720.0, 52.0));
        assert_eq!(clamp_spotlight_size(200.0, 20.0), (420.0, 48.0));
        assert_eq!(clamp_spotlight_size(f64::NAN, f64::INFINITY), (720.0, 480.0));
    }

    #[test]
    fn tray_quit_dry_run_env_accepts_truthy_values_only() {
        for value in ["1", "true", "TRUE", "yes", "on", " on "] {
            assert!(workhub_tray_quit_dry_run_from_env(named_env(&[
                (WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN_ENV, value),
                (
                    WORKHUB_CUU_QA_SCENARIO_ENV,
                    "pass-through-recovery-tray-physical"
                ),
            ])));
        }
        for value in ["", "0", "false", "off", "no", "disabled"] {
            assert!(!workhub_tray_quit_dry_run_from_env(named_env(&[
                (WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN_ENV, value),
                (
                    WORKHUB_CUU_QA_SCENARIO_ENV,
                    "pass-through-recovery-tray-physical"
                ),
            ])));
        }
        assert!(!workhub_tray_quit_dry_run_from_env(env_value(None)));
        assert!(!workhub_tray_quit_dry_run_from_env(named_env(&[(
            WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN_ENV,
            "1",
        )])));
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
                (WORKHUB_CUU_QA_LOCALE_ENV, "en-US"),
            ])),
            CuuQaPreferenceOverrides {
                pet_scale_percent: Some(150),
                pet_opacity_percent: Some(60),
                pet_pass_through: Some(true),
                pet_hide_on_hover: Some(true),
                pet_model_pack_id: Some("cuu-tororo-live2d-cubism2".to_string()),
                pet_qa_scenario: None,
                pet_qa_locale: Some("en-US".to_string()),
                pet_qa_dom_report: false,
                pet_qa_client_token: None,
                pet_qa_restore_state: None,
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
                (WORKHUB_CUU_QA_LOCALE_ENV, "fr-FR"),
            ])),
            CuuQaPreferenceOverrides {
                pet_scale_percent: None,
                pet_opacity_percent: None,
                pet_pass_through: Some(false),
                pet_hide_on_hover: None,
                pet_model_pack_id: None,
                pet_qa_scenario: None,
                pet_qa_locale: Some("zh-CN".to_string()),
                pet_qa_dom_report: false,
                pet_qa_client_token: None,
                pet_qa_restore_state: None,
            }
        );
    }

    #[test]
    fn cuu_qa_preferences_env_accepts_qa_capture_scenarios() {
        for scenario in [
            "launcher",
            "settings-menu",
            "settings-menu-model-switch",
            "settings-menu-hover-sync",
            "pass-through-recovery-settings",
            "pass-through-recovery-tray",
            "pass-through-recovery-tray-physical",
            "clarify",
            "approval",
            "search",
            "sync",
            "done",
            "run-stream",
            "run-failure",
            "reload-session",
            "reload-active-run",
            "reload-terminal-run",
            "permission-401",
            "permission-403",
            "generic-runtime-error",
            "stream-offline",
            "offline",
        ] {
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
            pet_qa_locale: Some("en-US".to_string()),
            pet_qa_dom_report: true,
            pet_qa_client_token: Some("qa-token-1".to_string()),
            pet_qa_restore_state: Some(
                r#"{"version":1,"entity_type":"agent_run","entity_id":"run-1","updated_at_ms":1}"#
                    .to_string(),
            ),
        });
        assert!(script.contains("__WORKHUB_CUU_PREFERENCES__"));
        assert!(script.contains("pet_scale_percent: 75"));
        assert!(script.contains("pet_opacity_percent: 80"));
        assert!(script.contains("pet_pass_through: true"));
        assert!(script.contains("pet_hide_on_hover: true"));
        assert!(script.contains(r#"pet_model_pack_id: "cuu-tororo-live2d-cubism2""#));
        assert!(script.contains(r#"__WORKHUB_CUU_QA_SCENARIO__ = "approval""#));
        assert!(script.contains(r#"__WORKHUB_CUU_QA_LOCALE__ = "en-US""#));
        assert!(script.contains("__WORKHUB_CUU_QA_DOM_REPORT__ = true"));
        assert!(script.contains(r#"localStorage.setItem("workhub_client_token", "qa-token-1")"#));
        assert!(script
            .contains(r#"localStorage.setItem("workhub.cuu.currentRun.v1", "{\"version\":1,"#));
    }

    #[test]
    fn cuu_qa_preferences_env_enables_dom_report_when_path_is_present() {
        assert_eq!(
            workhub_cuu_qa_preferences_from_env(named_env(&[(
                WORKHUB_CUU_QA_DOM_REPORT_PATH_ENV,
                "C:\\temp\\cuu-tauri-dom-report.json"
            )]))
            .pet_qa_dom_report,
            true
        );
        assert_eq!(
            workhub_cuu_qa_preferences_from_env(named_env(&[(
                WORKHUB_CUU_QA_DOM_REPORT_PATH_ENV,
                " "
            )]))
            .pet_qa_dom_report,
            false
        );
    }

    #[test]
    fn cuu_qa_dom_report_writer_writes_pretty_json_to_the_env_owned_path() {
        let path = std::env::temp_dir().join(format!(
            "workhub-cuu-qa-dom-report-{}-{}.json",
            std::process::id(),
            "writer"
        ));
        let _ = fs::remove_file(&path);
        let report = serde_json::json!({
            "contract": "workhub.cuu.tauri.actual-dom-report",
            "surface": {
                "data": {
                    "data_pet_window_mode": "card",
                    "data_cuu_behavior_state": "asking_approval"
                }
            }
        });

        write_cuu_qa_dom_report_to_path(&path, &report).expect("writes Cuu QA DOM report");

        let raw = fs::read_to_string(&path).expect("reads Cuu QA DOM report");
        assert!(raw.contains("workhub.cuu.tauri.actual-dom-report"));
        assert!(raw.contains("data_cuu_behavior_state"));
        let _ = fs::remove_file(&path);
    }
}
