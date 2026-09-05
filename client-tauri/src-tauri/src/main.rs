use workhub_client_tauri::config::{
    detect_system_device_name, load_shell_config_from_json_env_system_and_device,
    normalize_shell_server_url, shell_config_json_with_server_url, WorkHubShellConfig,
    WORKHUB_SERVER_URL_ENV,
};
use workhub_client_tauri::deep_link::{
    deep_link_plan_from_url, describe_deep_link_error, ShellDeepLinkPlan,
};
use workhub_client_tauri::events::{event_channel_name, ShellEvent};
use workhub_client_tauri::locale::{
    detect_system_workhub_locale, normalize_optional_workhub_locale, normalize_workhub_locale,
    WorkHubLocale, DEFAULT_WORKHUB_LOCALE,
};
// 只有 macOS 的 macos_preferred_languages() 用得到它——非 macOS 上留着这条 use 会是未用导入，
// 而 Linux CI 的 clippy 是 -D warnings（同 MainWindowStartupFallbackStep 那处 cfg 的先例）。
#[cfg(target_os = "macos")]
use workhub_client_tauri::locale::parse_macos_preferred_languages;
use workhub_client_tauri::notify::{
    deep_link_plan_for_notification_click, ShellSystemNotificationPlan,
};
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
use workhub_client_tauri::shell_log::{
    init_shell_log_dir, shell_log_error, shell_log_info, shell_log_warn,
};
use workhub_client_tauri::single_instance::single_instance_plan_from_args_for_locale;
use workhub_client_tauri::sse::ShellConnectionChangedPayload;
use workhub_client_tauri::sse_worker::{
    spawn_default_shell_sse_workers, ShellClientToken, ShellConnectionStatus, ShellServerUrl,
};
use workhub_client_tauri::tray::{
    shell_badge_count, tray_menu_action_plan_by_id_for_locale, tray_tooltip,
    tray_tooltip_with_badge, TRAY_HIDE_MAIN_ID, TRAY_OPEN_INBOX_ID, TRAY_OPEN_SETTINGS_ID,
    TRAY_OPEN_WORKBENCH_ID, TRAY_QUIT_ID, TRAY_RESTORE_PET_INTERACTION_ID, TRAY_SHOW_MAIN_ID,
    TRAY_TOGGLE_PET_ID, WORKHUB_TRAY_ID,
};
// 单色 template 托盘图标只在 macOS 上使用（其它平台的托盘图标是彩色的），同上 cfg 理由。
#[cfg(target_os = "macos")]
use workhub_client_tauri::tray::{tray_template_icon_rgba, TRAY_TEMPLATE_ICON_SIZE};
use workhub_client_tauri::window_controls::{
    focus_main_route as focus_main_route_plan, hide_main_window as hide_main_window_plan,
    hide_pet_window as hide_pet_window_plan, shell_navigate_payload,
    show_main_window as show_main_window_plan, show_pet_window as show_pet_window_plan,
    toggle_pet_window as toggle_pet_window_plan, ShellWindowControlAction, ShellWindowControlPlan,
    ShellWindowControlSource, MAIN_WINDOW_LABEL,
};
use workhub_client_tauri::windows::workbench_window_title;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

/// L-07：壳层数据文件名。两份都从 Application Support **根目录**搬进应用专属目录，
/// 见 `shell_data_path` / `migrate_legacy_shell_data`。
const PET_WINDOW_STATE_FILE: &str = "pet-window-state.json";
const SHELL_CONFIG_FILE: &str = "workhub-shell-config.json";
const SHELL_DATA_FILES: &[&str] = &[PET_WINDOW_STATE_FILE, SHELL_CONFIG_FILE];

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    utils::config::Color,
    Emitter, LogicalPosition as TauriLogicalPosition, LogicalSize, Manager,
    PhysicalPosition as TauriPhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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

// R24 玻璃通透度调试开关（与 WORKHUB_DISABLE_VIBRANCY 同族，只为真机肉眼对比留着；两个都不置位
// = 走下面写死的默认值，生产零行为变化）。WORKHUB_GLASS_MATERIAL 换原生材质，WORKHUB_GLASS_ALPHA
// 覆写盒子的半透白底（真正决定"能不能看见背后的窗口"的那一档，前端 token 见 spotlight/css.ts）。
// 一次构建就能把"材质 × 白底"的候选组合跑完，不必为每个候选各编一次。
const WORKHUB_GLASS_MATERIAL_ENV: &str = "WORKHUB_GLASS_MATERIAL";
const WORKHUB_GLASS_ALPHA_ENV: &str = "WORKHUB_GLASS_ALPHA";

/// 聚焦盒/工作台窗的原生毛玻璃材质。做成跨平台可测的纯枚举，只有映射到 AppKit
/// NSVisualEffectMaterial 的那一步是 macOS 专属。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum GlassMaterial {
    /// R24 默认：弹出层材质。真机对比里它是「跟随外观的浅色材质」中最通透的一档——背后的窗口
    /// 透出可辨的模糊色块，而黑字仍有 9.8:1（对比表见 Agent Note）。
    #[default]
    Popover,
    Sidebar,
    Menu,
    HeaderView,
    /// AppKit 里最不透的一档衬底材质：几乎只吃桌面壁纸、不显示背后的窗口。R14–R23 的默认值，
    /// 也正是 R24 用户反馈「盒子是一块实灰」的根因。留着当对照。
    UnderWindowBackground,
    /// 深色 HUD 材质，不跟随系统外观——R14 之前用的就是它，留着当对照。
    HudWindow,
}

impl GlassMaterial {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "popover" => Some(Self::Popover),
            "sidebar" => Some(Self::Sidebar),
            "menu" => Some(Self::Menu),
            "header" | "header_view" | "headerview" => Some(Self::HeaderView),
            "under_window" | "under_window_background" | "underwindowbackground" => {
                Some(Self::UnderWindowBackground)
            }
            "hud" | "hud_window" | "hudwindow" => Some(Self::HudWindow),
            _ => None,
        }
    }

    #[cfg(target_os = "macos")]
    fn ns_material(self) -> window_vibrancy::NSVisualEffectMaterial {
        use window_vibrancy::NSVisualEffectMaterial as M;
        match self {
            Self::UnderWindowBackground => M::UnderWindowBackground,
            Self::Popover => M::Popover,
            Self::Sidebar => M::Sidebar,
            Self::Menu => M::Menu,
            Self::HeaderView => M::HeaderView,
            Self::HudWindow => M::HudWindow,
        }
    }
}

/// 认不出的值静默退回默认材质——调试开关拼错不该让窗口失去玻璃。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn workhub_glass_material_from_env(get_env: impl Fn(&str) -> Option<String>) -> GlassMaterial {
    get_env(WORKHUB_GLASS_MATERIAL_ENV)
        .as_deref()
        .and_then(GlassMaterial::parse)
        .unwrap_or_default()
}

/// 白底 alpha 覆写：只认 (0,1] 的有限数（0 = 盒子全透明、字读不了，不给这个脚）。
fn workhub_glass_alpha_from_env(get_env: impl Fn(&str) -> Option<String>) -> Option<f64> {
    let raw = get_env(WORKHUB_GLASS_ALPHA_ENV)?;
    let value: f64 = raw.trim().parse().ok()?;
    if value.is_finite() && value > 0.0 && value <= 1.0 {
        Some(value)
    } else {
        None
    }
}

/// 把 alpha 递给 webview：既写 window.__WORKHUB_GLASS_ALPHA__（挂载时由 desktop-glass-alpha.ts 读），
/// 也直接补写已经挂好的宿主元素——两种先后顺序都能落地。没置位时不注入任何脚本。
fn glass_alpha_override_script(alpha: Option<f64>) -> Option<String> {
    let alpha = alpha?;
    Some(format!(
        "(function(){{try{{window.__WORKHUB_GLASS_ALPHA__={alpha};var h=document.querySelector('.wh-spot-stage');if(h){{h.style.setProperty('--wh-spot-glass-top','rgba(255,255,255,{alpha})');h.style.setProperty('--wh-spot-glass-bottom','rgba(255,255,255,{bottom})');h.style.setProperty('--ds-glass-strong','rgba(255,255,255,{alpha})');}}}}catch(e){{}}}})()",
        alpha = (alpha * 100.0).round() / 100.0,
        bottom = (alpha * 77.0).round() / 100.0,
    ))
}

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
    get_env(name).map(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
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
        shell_log_info("client_token_cleared", "webview cleared the client token");
        // SEC P0-02：清空必须递增身份代际并唤醒等待者（ShellClientToken::set 内部两件事都做）——退出/换号后
        // 旧账号私有 SSE pump 靠代际变更立即中止，不再一直把旧身份事件灌到 TCP 偶然断。旧实现在这里只写 None
        // 后直接 return（连 notify 都不发），正是本缺陷根因。
        let generation = state.set(None);
        shell_log_info(
            "client_token_generation",
            format!("now {generation} (cleared); any active SSE pump aborts on the next tick"),
        );
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
    shell_log_info(
        "client_token_received",
        format!("…{tail}; SSE /me authenticates on next reconnect"),
    );
    // 递增身份代际并唤醒（RUST-1 + SEC P0-02）：挂起中的 worker 立即以新身份重连；活跃的旧身份 pump 感知代际
    // 变更后中止，再以新令牌重连——不再干等满一个退避周期，也不再拿旧身份续流。
    let generation = state.set(Some(trimmed.to_string()));
    shell_log_info(
        "client_token_generation",
        format!("now {generation}; SSE reconnects with the new identity"),
    );
}

/// `set_server_url` / `get_server_url` 的返回体。`get` 的 `url` 可空，表示壳层手上没有地址——正常路径
/// 下不会发生（兜底值是本机默认），但 webview 那边必须能区分「壳层说不知道」和「壳层说是本机」，否则
/// 一个空配置会被当成"已经连上本机了"。
#[derive(Clone, Debug, serde::Serialize)]
struct ShellServerUrlResponse {
    url: String,
}

#[derive(Clone, Debug, serde::Serialize)]
struct ShellServerUrlQuery {
    url: Option<String>,
}

/// 把新的服务器地址写回 `workhub-shell-config.json`（`load_workhub_shell_config` 读的同一份）。
/// 只改 `server_url` 并删掉 `client_token`，其余键（含用户手写的）原样保留——见
/// `shell_config_json_with_server_url` 的说明。
fn save_workhub_shell_server_url(app: &tauri::AppHandle, server_url: &str) -> Result<(), String> {
    let path = shell_config_path(app)?;
    let raw =
        if path.exists() {
            Some(fs::read_to_string(&path).map_err(|error| {
                format!("failed to read shell config {}: {error}", path.display())
            })?)
        } else {
            None
        };
    let next = shell_config_json_with_server_url(raw.as_deref(), server_url).map_err(|error| {
        format!(
            "failed to update shell config {}: {error:?}",
            path.display()
        )
    })?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create shell config directory: {error}"))?;
    }
    fs::write(&path, format!("{next}\n"))
        .map_err(|error| format!("failed to write shell config {}: {error}", path.display()))
}

/// S5（S1 报告 E-06）：壳层服务器地址的**唯一**写入口。
///
/// 在此之前壳层的 `server_url` 只能来自 `workhub-shell-config.json` / `WORKHUB_SERVER_URL`，且在
/// `.setup()` 里按值捕获一次；webview 那边用户改了 API 地址，壳层的 SSE 仍连着旧地址。而托盘角标、系统
/// 通知、Cuu 上线状态全部只由这条 SSE 供给——地址分叉的后果不是"少一点功能"，是这三样**静默地永远不响**。
///
/// 顺序是刻意的：**校验 → 落盘 → 改运行时 → 广播**。先落盘是因为写盘失败时整条命令失败、什么都不变，
/// 绝不留下「这次连新服务器、重启又回旧的」这种只有重启才暴露的分裂态。
#[tauri::command]
fn set_server_url(
    app: tauri::AppHandle,
    server: tauri::State<'_, ShellServerUrl>,
    token: tauri::State<'_, ShellClientToken>,
    url: String,
) -> Result<ShellServerUrlResponse, String> {
    // 与 webview 的 normalizeDesktopApiBase 同口径（见 config::normalize_shell_server_url）。webview 已经
    // 校验过一遍，这里不是冗余：命令是进程边界，不能假设调用方一定是自家那段 JS。
    let normalized = normalize_shell_server_url(&url).map_err(|error| error.to_string())?;
    let previous = server.snapshot().url;

    save_workhub_shell_server_url(&app, &normalized)?;

    // 换服务器 = 换身份域：A 服务器铸的设备令牌对 B 毫无意义，留着只会被当成有效凭据发给 B。webview 侧
    // 也会清一遍（双保险）。清空同样递增身份代际 → 活跃的旧连接立刻中止（SEC P0-02 的既有机制）。
    let token_generation = token.set(None);
    let server_generation = server.set(normalized.clone());
    shell_log_info(
        "server_url_changed",
        format!(
            "from {previous} to {normalized}; client token cleared (identity generation \
             {token_generation}), endpoint generation {server_generation}; SSE reconnects against \
             the new server"
        ),
    );
    if std::env::var(WORKHUB_SERVER_URL_ENV).is_ok() {
        // 环境变量在启动时覆盖配置文件（见 load_shell_config_from_json_and_env）——本次改动在运行期生效，
        // 但下次启动会被环境变量顶回去。这是运维自己设的优先级，不去偷偷改它，只留一行诊断。
        shell_log_warn(
            "server_url_env_override",
            format!(
                "{WORKHUB_SERVER_URL_ENV} is set and will override this saved address on the next launch"
            ),
        );
    }

    // 三窗（main / pet / workbench）订阅这条广播后各自 reload——照既有 workhub-logged-out 的模式，
    // 不新造协议。**广播失败不上抛**：地址此刻已经落盘并生效了，回一个 Err 会让 webview 以为切换失败、
    // 不去更新自己那份 api base——那正是本批要消灭的「壳层连 A、webview 连 B」分叉。降级后果只是另外两窗
    // 要等各自重启才跟上（= S5 之前的行为），比分叉轻得多。
    if let Err(error) = app.emit(
        event_channel_name(ShellEvent::ServerChanged),
        ShellServerUrlResponse {
            url: normalized.clone(),
        },
    ) {
        shell_log_warn(
            "server_change_broadcast_failed",
            format!("{error}; other windows keep the old address until they reload"),
        );
    }

    Ok(ShellServerUrlResponse { url: normalized })
}

/// S5-M-07：这台机器报到时用的设备名。真相在启动配置里
/// （`DEFAULT_DEVICE_NAME` < 机器名 < 配置文件 `device_name` < `WORKHUB_DEVICE_NAME`），
/// 但真正调 `/api/auth/desktop-bootstrap` 报到的是 webview，所以壳层把解析结果托管一份供它取。
#[derive(Default)]
struct ShellDeviceName(Mutex<String>);

/// webview 报到前问一次：这台机器该叫什么。取不到（浏览器 dev 态/壳层没解析出来）时返回 None，
/// 由 webview 保留它自己的兜底名。
#[tauri::command]
fn get_device_name(state: tauri::State<'_, ShellDeviceName>) -> Option<String> {
    let name = state.0.lock().ok()?.trim().to_string();
    (!name.is_empty()).then_some(name)
}

/// 壳层当前持有的服务器地址。webview 用它核对「壳层和我连的是不是同一台」——两份地址曾经可以永久分叉，
/// 现在至少能被看见。
#[tauri::command]
fn get_server_url(server: tauri::State<'_, ShellServerUrl>) -> ShellServerUrlQuery {
    let url = server.snapshot().url;
    let trimmed = url.trim();
    ShellServerUrlQuery {
        url: (!trimmed.is_empty()).then(|| trimmed.to_string()),
    }
}

/// R25-Q：壳层连接状态"单一真相"——三窗（工作台头部状态词/主窗聚焦盒顶部细条/桌宠离线卡）boot 时
/// 各调一次拿初值，不必等 SSE worker 下一次真实状态迁移才第一次知道当前是 connected/reconnecting/
/// offline。运行期的后续变化走 `workhub-connection-changed` 广播（`sse_worker::emit_connection_transition`），
/// 这个命令只负责"我刚开机，现在是什么状态"这一次性问题。
#[tauri::command]
fn get_connection_state(
    status: tauri::State<'_, ShellConnectionStatus>,
) -> ShellConnectionChangedPayload {
    status.snapshot()
}

// R8 真·Spotlight：webview 测得盒子内容高度后调它缩放主窗（盒子随内容生长/收缩，苹果聚焦风）。
// 只改 main 窗内尺寸，top-left 锚定不动 → 向下生长。clamp 防 webview 传来的异常值把窗口撑爆/压没。
fn clamp_spotlight_size(width: f64, height: f64) -> (f64, f64) {
    let safe_width = if width.is_finite() {
        width.clamp(420.0, 1600.0)
    } else {
        720.0
    };
    let safe_height = if height.is_finite() {
        height.clamp(48.0, 1400.0)
    } else {
        480.0
    };
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

// R15 批 A6（托盘/Dock 角标）：把「有几件待办/未读」推到系统托盘 + macOS Dock 层——workbench 关着、聚焦盒
// 收着时也能一眼看到有事要处理。由 browser.ts 既有的 refreshApprovalsBadge 30s 轮询顺带 invoke（它已经算了
// attention 队列数，再加上未读通知数）。count<=0 清角标（macOS set_badge_count(None) 清 dock 角标）；托盘
// tooltip 带上计数（0 回到基线「Cuu 已就绪」）。托盘/tooltip 拿不到时 best-effort 不致命——Dock 角标是主承诺。
#[tauri::command]
fn set_shell_badge(
    app: tauri::AppHandle,
    count: i64,
    locale: Option<String>,
) -> Result<(), String> {
    let resolved_locale =
        normalize_optional_workhub_locale(locale).unwrap_or(DEFAULT_WORKHUB_LOCALE);
    // Dock 角标（macOS）——app 级，用 main 窗句柄设置。main 窗还没建好（冷启动竞态）时静默跳过，下一拍再来。
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_badge_count(shell_badge_count(count))
            .map_err(|error| format!("failed to set shell dock badge: {error}"))?;
    }
    // 托盘 tooltip 带数——best-effort：没有托盘（无 tray-icon feature / 尚未装好）时不报错。
    if let Some(tray) = app.tray_by_id(WORKHUB_TRAY_ID) {
        let badge = i64::max(count, 0).min(u32::MAX as i64) as u32;
        let _ = tray.set_tooltip(Some(tray_tooltip_with_badge(resolved_locale, badge)));
    }
    Ok(())
}

// R19-13：壳层 locale 运行时同步。壳层 locale 过去启动即冻结（setup 从 config 读一次写进 Mutex），应用内
// 切语言只改 webview 的 localStorage + reload，到不了原生外壳——托盘菜单/tooltip、深链错误、通知兜底文案
// 都卡在启动语言。webview 语言开关成功切换后 invoke 本命令：更新共享 locale 源（Mutex<WorkHubLocale>，通知
// worker 每次弹通知都实时读它，见 sse_worker::current_shell_locale）并重建托盘菜单/tooltip 为新语言。
#[tauri::command]
fn set_shell_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    apply_shell_locale(&app, normalize_workhub_locale(&locale))
}

fn apply_shell_locale(app: &tauri::AppHandle, locale: WorkHubLocale) -> Result<(), String> {
    if let Ok(mut current) = app.state::<Mutex<WorkHubLocale>>().lock() {
        *current = locale;
    }
    // 托盘存在时重建菜单/tooltip 为新语言。没有托盘（无 tray-icon feature / 尚未装好）时 best-effort 不致命。
    // tooltip 这里回到基线文案；下一次 set_shell_badge（badge 30s 轮询携带 locale）会把带计数的 tooltip 也刷成新语言。
    if let Some(tray) = app.tray_by_id(WORKHUB_TRAY_ID) {
        let menu = build_workhub_tray_menu(app, locale)?;
        tray.set_menu(Some(menu))
            .map_err(|error| format!("failed to update tray menu locale: {error}"))?;
        tray.set_tooltip(Some(tray_tooltip(locale)))
            .map_err(|error| format!("failed to update tray tooltip locale: {error}"))?;
    }
    // 工作台窗已开着时标题跟着切（没建过就不用管，建窗时会按当时的 locale 设）。best-effort。
    if let Some(workbench) = app.get_webview_window("workbench") {
        if let Err(error) = workbench.set_title(workbench_window_title(locale)) {
            shell_log_warn("workbench_title_locale_failed", error);
        }
    }
    Ok(())
}

// P2-07/R19-12：OS 通知点击深链的原生半边（命令桥）。桌面端 tauri-plugin-notification 无点击回调（见
// notify::show_system_notification 注释），故"点击消费"由 webview 侧的 onSystemNotification 触发：把它收到的
// system-notification 计划经此命令回传，壳层整形成深链计划后走 REL-6 统一的 handle_deep_link_plan（含 workbench
// 按需建窗），不另造窗口控制路。审批通知落审批面板、消息通知落对应会话，都由计划里壳层原算好的 route 决定。
#[tauri::command]
fn focus_system_notification(
    app: tauri::AppHandle,
    plan: ShellSystemNotificationPlan,
) -> Result<(), String> {
    let deep_link = deep_link_plan_for_notification_click(&plan);
    handle_deep_link_plan(&app, &deep_link)
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

// DSK-12：写文件的 QA 命令只在 debug build 编入（release 里不存在这个入口）。
// release 构建连名字都不注册，打包产物里没有任何「webview 一句话就写任意路径文件」的面。
#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

    if plan.label == MAIN_WINDOW_LABEL {
        if let Err(error) = configure_main_window_chrome(&window) {
            shell_log_warn(
                "main_window_chrome_failed",
                format!(
                    "failed to configure main window chrome; continuing window control: {error}"
                ),
            );
        }
    }

    // S3-#6：只有真正的导航目标才发（根路径 = 「显示窗口」而非「导航」，发它会让 webview 复位聚焦盒、
    // 洗掉深链/托盘刚打开的能力，见 shell_navigate_payload 的根因注释）。用 emit_to 指名收件人而不是
    // 全局 emit：桌宠/工作台窗从不消费 navigate（工作台走 deep-link 通道），事件面越窄越好。
    // 注意 Tauri 的过滤只作用于**显式限定了 target 的**监听器，JS 侧默认的 Any 监听仍会收到——
    // 所以 payload 里也带上 label，接收端要自证时有据可依。
    match shell_navigate_payload(&plan) {
        Some(payload) => {
            let route = payload.route.clone();
            let label = payload.label.clone();
            app.emit_to(
                label.clone(),
                event_channel_name(ShellEvent::Navigate),
                payload,
            )
            .map_err(|error| format!("failed to emit main window navigation: {error}"))?;
            shell_log_info(
                "shell_navigate_emitted",
                format!(
                    "route={route} label={label} source={:?} reason={}",
                    plan.source, plan.reason
                ),
            );
        }
        None => shell_log_info(
            "shell_navigate_skipped",
            format!(
                "label={} action={:?} source={:?} reason={} route={}",
                plan.label,
                plan.action,
                plan.source,
                plan.reason,
                plan.route.as_deref().unwrap_or("-")
            ),
        ),
    }

    Ok(plan)
}

// R15：全局热键 Option+Space（macOS 上 Alt 键位即 Option；不占系统级 Cmd+Space）唤起/收起聚焦盒——
// 桌宠常驻小窗/托盘之外补上"聚焦盒"这个名字暗示的 Spotlight 心智模型的第二条召唤路径。用
// on_shortcut() 而非插件 Builder::with_shortcut()：后者在插件自己的 setup 阶段用 `?` 直接把
// register() 的失败上抛，会让整个 tauri::Builder::run() 失败（应用起不来）；on_shortcut() 把
// Result 交回调用方，可以自行降级——热键被别的应用占用时只记日志，应用照常启动。
fn install_workhub_global_hotkey(app: &tauri::AppHandle) -> Result<(), String> {
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            // 全局热键的按下/松开各触发一次事件；只在按下时切换，否则一次按键会触发两次 toggle
            // （按下唤起、松开又立刻收起）。
            if event.state == ShortcutState::Pressed {
                toggle_main_window_from_global_hotkey(app);
            }
        })
        .map_err(|error| format!("failed to register global hotkey Option+Space: {error}"))
}

// Spotlight 手感：主窗已聚焦（前台且拿到焦点）→ 收起；否则（不可见，或可见但焦点被别的应用抢走）
// → 唤起并聚焦。故意用 is_focused() 而非泛用的 ShellWindowControlAction::Toggle（它只看 is_visible()）
// ——聚焦盒常驻可见、alwaysOnTop，"可见但没聚焦"是最常见的起点，此时应当唤起而不是被 Toggle 藏起来。
// 复用既有的 show_main_window_plan/hide_main_window_plan + execute_window_control 执行路径
// （跟托盘/深链/通知同一条控制协议），不另造第二套窗口控制协议。
fn toggle_main_window_from_global_hotkey(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        shell_log_warn(
            "global_hotkey_no_main_window",
            "global hotkey fired but the main window is unavailable",
        );
        return;
    };
    let is_focused = window.is_focused().unwrap_or(false);
    let plan = if is_focused {
        hide_main_window_plan(ShellWindowControlSource::Setting)
    } else {
        show_main_window_plan(ShellWindowControlSource::Setting)
    };
    if let Err(error) = execute_window_control(app, plan) {
        shell_log_error("global_hotkey_control_failed", error);
    }
}

// R19-16：Dock 图标点击（Reopen）时的主窗恢复决策。纯函数便于单测。主窗已可见 → 不动（macOS 会自行把 App
// 前置，重复 show/focus 只会平白抢焦点）；主窗被藏起来（最常见：自绘关闭 / Cmd+W hide 到托盘）→ 用与托盘
// 「打开 WorkHub」/全局热键同一套 show_main_window_plan 恢复并聚焦，不另造第二套控制协议。传入的是主窗**自身**
// 的可见性，而非 RunEvent 的 has_visible_windows——桌宠常驻可见会让 has_visible_windows=true，但主窗仍可能隐藏。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn dock_reopen_plan(main_window_visible: bool) -> Option<ShellWindowControlPlan> {
    if main_window_visible {
        None
    } else {
        Some(show_main_window_plan(ShellWindowControlSource::Setting))
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn apply_dock_reopen(app: &tauri::AppHandle) -> Result<(), String> {
    let visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if let Some(plan) = dock_reopen_plan(visible) {
        execute_window_control(app, plan)?;
    }
    Ok(())
}

// R19-16：App::run 的 RunEvent 回调宿主。目前只消费 macOS 的 Reopen（Dock 图标点击 /
// applicationShouldHandleReopen）。非 macOS 上整段 cfg 掉，参数随之未用，故 allow(unused_variables)。
#[allow(unused_variables)]
fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    // S5-N-04 诊断：macOS 热态深链的每一段都要留痕。`Opened` 是 deep-link 插件唯一的热态入口
    // （插件在自己的 on_event 里把它转成 `deep-link://new-url` 事件），`Reopen` 则是"应用被激活"
    // 那条与之赛跑的路径——两条分别记一行，日志里就能直接读出"URL 到底有没有送到壳层"。
    #[cfg(target_os = "macos")]
    match &event {
        tauri::RunEvent::Opened { urls } => {
            let joined = urls
                .iter()
                .map(|url| url.as_str().to_string())
                .collect::<Vec<_>>()
                .join(" ");
            shell_log_info("run_event_opened", format!("urls=[{joined}]"));
        }
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => shell_log_info(
            "run_event_reopen",
            format!("has_visible_windows={has_visible_windows}"),
        ),
        _ => {}
    }
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen { .. } = event {
        if let Err(error) = apply_dock_reopen(app) {
            shell_log_error("dock_reopen_failed", error);
        }
    }
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
    // S3 严重 #4：声明层的 title 是语言中立的产品名（tauri.conf.json 在读系统语言之前就被消费），
    // 给人看的标题在这里按壳层语言设；切语言时 apply_shell_locale 会再刷一次。
    .title(workbench_window_title(current_workhub_locale(app)))
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
        shell_log_warn("workbench_glass_schedule_failed", error);
    }
    Ok(window)
}

// 工作台毛玻璃:同主窗策略——透明窗 + OS 原生材质(macOS vibrancy / Windows acrylic),透明窗里
// CSS backdrop-filter 无内容可糊。失败不致命(前端 ds-glass-strong 半透底兜底),但留下真机诊断。
fn apply_workbench_glass(window: &tauri::WebviewWindow) {
    if let Err(error) = window.set_background_color(Some(Color(0, 0, 0, 0))) {
        shell_log_warn("workbench_background_failed", error);
    }
    // R13 V1：固定浅色玻璃（用户拍板）——先把窗口外观钉死 light（系统深色模式下浅色材质会翻黑,
    // set_theme 在 macOS 落到 NSAppearance）。R24 起材质与聚焦盒共用同一个默认值（见 GlassMaterial）：
    // 两个窗是同一套玻璃语言，工作台没有"要更实"的理由，材质分叉只会让同屏两个窗看起来不是一家的。
    if let Err(error) = window.set_theme(Some(tauri::Theme::Light)) {
        shell_log_warn("workbench_appearance_failed", error);
    }
    #[cfg(target_os = "macos")]
    if std::env::var("WORKHUB_DISABLE_VIBRANCY").is_err() {
        let material =
            workhub_glass_material_from_env(|name| std::env::var(name).ok()).ns_material();
        if let Err(error) = window_vibrancy::apply_vibrancy(
            window,
            material,
            Some(window_vibrancy::NSVisualEffectState::Active),
            Some(24.0),
        ) {
            shell_log_warn(
                "workbench_vibrancy_unavailable",
                format!("falling back to the translucent base: {error}"),
            );
        }
    }
    #[cfg(target_os = "windows")]
    if let Err(error) = window_vibrancy::apply_acrylic(window, Some((24, 24, 32, 120))) {
        shell_log_warn(
            "workbench_acrylic_unavailable",
            format!("falling back to the translucent base: {error}"),
        );
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
    // Linux CI 的 clippy 看不到 macOS cfg 分支里的构造点（P3-01 把 clippy -D warnings 拉上 CI 后暴露），
    // 与下一行 WindowsAcrylic 同款：仅在非目标平台上放行 dead_code。
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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
    shell_log_warn(
        "main_window_startup_fallback",
        main_window_startup_fallback_message(step, error),
    );
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

// R19-13：托盘菜单构建抽成独立函数,让启动安装(install_workhub_tray)与运行时切语言(set_shell_locale →
// apply_shell_locale)复用同一份构建逻辑——切语言时用新 locale 重建菜单再 tray.set_menu,不各写一份。
fn build_workhub_tray_menu(
    app: &tauri::AppHandle,
    locale: WorkHubLocale,
) -> Result<Menu<tauri::Wry>, String> {
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

    MenuBuilder::new(app)
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
        .map_err(|error| format!("failed to build WorkHub tray menu: {error}"))
}

fn install_workhub_tray(app: &tauri::App, locale: WorkHubLocale) -> Result<(), String> {
    let menu = build_workhub_tray_menu(app.handle(), locale)?;

    let mut builder = TrayIconBuilder::with_id(WORKHUB_TRAY_ID)
        .tooltip(tray_tooltip(locale))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Err(error) = handle_tray_action(app, event.id().as_ref()) {
                shell_log_error("tray_action_failed", error);
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
                    shell_log_error("tray_left_click_failed", error);
                }
            }
        });

    // L-02：macOS 菜单栏走**单色 template 图标**（系统按明暗自动反色），不再复用紫色的应用图标——
    // 那张图在菜单栏里既不自适应、22pt 下两行小字也读不出来。其它平台的托盘图标本就是彩色的，
    // 继续用应用图标。
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::image::Image::new_owned(
                tray_template_icon_rgba(TRAY_TEMPLATE_ICON_SIZE),
                TRAY_TEMPLATE_ICON_SIZE,
                TRAY_TEMPLATE_ICON_SIZE,
            ))
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
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
    set_pet_window_settings(
        app.clone(),
        runtime_state,
        scale_percent,
        opacity_percent,
        false,
        false,
    )?;
    Ok(())
}

// WIRE-04：前端零 invoke 的死命令——它只为 QA 录屏流水线存在（scripts/qa/cuu-tauri-motion-capture.ps1
// 通过它触发与托盘菜单相同的恢复 handler，见 cuu-r3-agent-entry.md），与 DSK-12 同口径：仅 debug build 编入。
#[cfg(debug_assertions)]
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
    shell_log_info(
        "deep_link_startup_urls",
        format!(
            "count={}",
            start_urls.as_ref().map(|urls| urls.len()).unwrap_or(0)
        ),
    );
    if let Some(urls) = start_urls {
        for url in urls {
            // A malformed cold-start deep link must never brick launch: log and
            // continue, mirroring the runtime on_open_url handler below rather
            // than propagating with `?` and aborting the whole app setup.
            if let Err(error) = handle_deep_link_url(&app_handle, url.as_str()) {
                shell_log_error("startup_deep_link_failed", format!("{url}: {error}"));
            }
        }
    }

    let listener_app = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            shell_log_info("deep_link_url_received", url.as_str());
            if let Err(error) = handle_deep_link_url(&listener_app, url.as_str()) {
                shell_log_error("deep_link_failed", format!("{url}: {error}"));
            }
        }
    });

    Ok(())
}

// P1-04:workbench 窗在 tauri.conf.json 里是 create:false(按需建)。除它以外的窗口(main/pet)启动时
// 已经建好,深链落地前不需要"先建窗"这一步。抽成纯函数,不依赖 AppHandle,便于单测。
fn deep_link_target_requires_window_creation(label: &str) -> bool {
    label == "workbench"
}

/// 深链落地要做的两件事:按需建窗 + 执行窗口控制(show/focus/...)。抽成 trait 是为了让下面的
/// `apply_deep_link_plan` 脱离真实 `tauri::AppHandle` 也能单测——生产实现见 `TauriDeepLinkWindowHost`,
/// 测试里用一个纯内存假实现记录调用顺序,直接复现/验证 P1-04 的根因与修复。
trait DeepLinkWindowHost {
    fn create_window(&mut self, label: &str) -> Result<(), String>;
    fn control_window(&mut self, control: &ShellWindowControlPlan) -> Result<(), String>;
}

struct TauriDeepLinkWindowHost<'a> {
    app: &'a tauri::AppHandle,
}

impl DeepLinkWindowHost for TauriDeepLinkWindowHost<'_> {
    fn create_window(&mut self, label: &str) -> Result<(), String> {
        if label == "workbench" {
            create_workbench_window_if_missing(self.app)?;
        }
        Ok(())
    }

    fn control_window(&mut self, control: &ShellWindowControlPlan) -> Result<(), String> {
        execute_window_control(self.app, control.clone()).map(|_| ())
    }
}

/// deep-link(冷启动 URL / 运行时 on_open_url)与 single-instance(第二实例)两条入口共享的落地路径:
/// 目标窗若按需创建,先确保它存在,再执行窗口控制。P1-04 根因:此前只有正常 deep-link 分支走这套
/// create-if-missing,single-instance 分支直接执行窗口控制——应用已运行但 workbench 窗还没被建过时
/// (用户从未点开过工作台),`execute_window_control` 报 "workbench window is not available",深链
/// 目标直接丢失。现在两条入口都收敛到这一个函数,不再各自维护一份判断逻辑。
fn apply_deep_link_plan<H: DeepLinkWindowHost>(
    host: &mut H,
    plan: &ShellDeepLinkPlan,
) -> Result<(), String> {
    if deep_link_target_requires_window_creation(&plan.window_control.label) {
        host.create_window(&plan.window_control.label)?;
    }
    host.control_window(&plan.window_control)
}

fn handle_deep_link_plan(app: &tauri::AppHandle, plan: &ShellDeepLinkPlan) -> Result<(), String> {
    let mut host = TauriDeepLinkWindowHost { app };
    apply_deep_link_plan(&mut host, plan)?;
    // MRG-23：先暂存再广播。目标窗若是这次调用刚创建的（workbench 是 create:false 按需建），它的
    // webview 还没跑到订阅 "deep-link" 那一步，这次 emit 必丢——暂存一份（TTL 15s、按目标窗口
    // label 认领、一次性），目标窗 boot 完成后调 take_pending_deep_link 取回。覆盖全部三条入口：
    // 冷启动 URL、single-instance argv、focus_system_notification。
    if let Ok(mut pending) = app.state::<Mutex<PendingShellDeepLink>>().lock() {
        pending.plan = Some((plan.clone(), Instant::now()));
    }
    app.emit(event_channel_name(ShellEvent::DeepLink), plan.clone())
        .map_err(|error| format!("failed to emit deep-link event: {error}"))
}

// MRG-23：深链事件重放兜底的状态与判定（纯函数部分脱离 AppHandle 可单测）。
const PENDING_DEEP_LINK_TTL: Duration = Duration::from_secs(15);

#[derive(Default)]
struct PendingShellDeepLink {
    plan: Option<(ShellDeepLinkPlan, Instant)>,
}

// 认领一条暂存深链：只对「目标窗口 label 匹配 + 未过期」返回并清除；不匹配则放回去等目标窗口来取，
// 过期即弃。一次性语义防止窗口长期隐藏复用时，一条陈旧 stash 被误当成「这次」的目标。
fn take_pending_deep_link_from(
    pending: &mut Option<(ShellDeepLinkPlan, Instant)>,
    window_label: &str,
    now: Instant,
) -> Option<ShellDeepLinkPlan> {
    let (plan, stashed_at) = pending.take()?;
    if now.duration_since(stashed_at) > PENDING_DEEP_LINK_TTL {
        return None;
    }
    if plan.window_control.label != window_label {
        *pending = Some((plan, stashed_at));
        return None;
    }
    Some(plan)
}

// 目标窗 webview 加载完成、订阅好 "deep-link" 事件后调用：取回窗口创建期间错过的那条深链计划。
// 浏览器 dev 态/无暂存/非本窗目标都回 None，前端按「没有兜底」继续正常启动。
#[tauri::command]
fn take_pending_deep_link(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Option<ShellDeepLinkPlan> {
    let state = app.state::<Mutex<PendingShellDeepLink>>();
    let Ok(mut pending) = state.lock() else {
        return None;
    };
    take_pending_deep_link_from(&mut pending.plan, window.label(), Instant::now())
}

// S5-N-04 诊断出口：webview 侧（聚焦盒的 navigate/deep-link 处理）把自己看到的东西写进同一份壳层日志。
// 打包后的 release webview 没有检查器、stderr 也没人读，缺了这条就只能靠"窗口有没有变"猜前端收没收到事件。
// 纪律：事件名归一成 `webview_` 前缀的 snake_case（与壳层自己的事件名不撞车、便于 grep），长度设硬上限，
// 换行压平——一条日志一行是 shell_log 的既定形状。
const WEBVIEW_DIAGNOSTIC_EVENT_MAX: usize = 64;
const WEBVIEW_DIAGNOSTIC_MESSAGE_MAX: usize = 512;

fn webview_diagnostic_event_name(event: &str) -> String {
    let sanitized: String = event
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(WEBVIEW_DIAGNOSTIC_EVENT_MAX)
        .collect();
    if sanitized.is_empty() {
        "webview_diagnostic".to_string()
    } else {
        format!("webview_{sanitized}")
    }
}

fn webview_diagnostic_message(message: &str) -> String {
    message
        .chars()
        .take(WEBVIEW_DIAGNOSTIC_MESSAGE_MAX)
        .collect()
}

#[tauri::command]
fn record_shell_diagnostic(event: String, message: String) {
    shell_log_info(
        &webview_diagnostic_event_name(&event),
        webview_diagnostic_message(&message),
    );
}

fn handle_deep_link_url(app: &tauri::AppHandle, raw_url: &str) -> Result<(), String> {
    let locale = current_workhub_locale(app);
    let plan = deep_link_plan_from_url(raw_url).map_err(|error| {
        format!(
            "invalid WorkHub deep link {raw_url}: {}",
            describe_deep_link_error(&error, locale)
        )
    })?;

    shell_log_info(
        "deep_link_plan",
        format!(
            "url={raw_url} route={} label={} action={:?}",
            plan.route, plan.window_control.label, plan.window_control.action
        ),
    );
    handle_deep_link_plan(app, &plan)
}

fn handle_single_instance_launch(
    app: &tauri::AppHandle,
    args: Vec<String>,
    cwd: String,
) -> Result<(), String> {
    let plan = single_instance_plan_from_args_for_locale(&args, &cwd, current_workhub_locale(app));
    shell_log_info(
        "single_instance_launch",
        format!(
            "args=[{}] deep_links={}",
            args.join(" "),
            plan.deep_links.len()
        ),
    );
    // S5-N-04 的可诊断化：macOS 上 `open workhub://…` 的 URL 是 Apple Event，**不在 argv 里**。
    // 当 LaunchServices 把链接交给了另一份注册的 WorkHub.app（同 bundle id 的多份副本）时，那个第二
    // 进程会被 single-instance 在插件 setup 里掐掉，URL 随它一起消失，主实例只会收到一条没有深链的
    // 交接——肉眼现象正是「点了链接，窗口跳出来但没导航」。这行日志把那个静默的黑洞变成可 grep 的证据。
    #[cfg(target_os = "macos")]
    if plan.deep_links.is_empty() {
        shell_log_warn(
            "single_instance_without_deep_link",
            format!(
                "a second WorkHub copy handed off to this instance; on macOS a workhub:// URL \
                 travels as an Apple Event and cannot cross this handoff, so a link that triggered \
                 it is lost. Keep a single registered copy of WorkHub.app (secondary executable: {})",
                args.first().map(String::as_str).unwrap_or("<unknown>")
            ),
        );
    }
    if plan.deep_links.is_empty() {
        execute_window_control(app, plan.window_control.clone())?;
    } else {
        // 第二实例带深链:复用与冷启动/运行时深链相同的落地路径(含按需建窗),不再绕开 create-if-missing。
        for deep_link in &plan.deep_links {
            handle_deep_link_plan(app, deep_link)?;
        }
    }

    app.emit(event_channel_name(ShellEvent::SingleInstance), plan)
        .map_err(|error| format!("failed to emit single-instance event: {error}"))
}

fn pet_window_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    shell_data_path(app, PET_WINDOW_STATE_FILE)
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
    shell_data_path(app, SHELL_CONFIG_FILE)
}

/// L-07：壳层自己的数据文件都放**应用专属目录**（macOS 的
/// `~/Library/Application Support/com.mycyg.workhub/`），而不是 `BaseDirectory::Config` 解析到的
/// Application Support **根目录**——之前 `pet-window-state.json` / `workhub-shell-config.json` 就是
/// 直接躺在根目录里，跟别的 app 的数据混在一起，卸载时也没人知道该删哪几个文件。
fn shell_data_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(file_name, BaseDirectory::AppConfig)
        .map_err(|error| format!("failed to resolve shell data path {file_name}: {error}"))
}

/// 旧位置（Application Support 根目录）。只在一次性迁移里用到。
fn legacy_shell_data_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(file_name, BaseDirectory::Config)
        .map_err(|error| format!("failed to resolve legacy shell data path {file_name}: {error}"))
}

/// 把一个旧位置的数据文件搬进应用专属目录。返回是否真的搬了。
///
/// 三条守卫：旧文件不存在 → 什么都不做；新位置已有文件 → 保留新的（新位置才是真相，旧的留在原地
/// 由用户自行清理，绝不覆盖）；跨卷 rename 失败 → 退回「复制 + 删除」。纯路径函数，可用临时目录单测。
fn migrate_shell_data_file(legacy: &Path, current: &Path) -> Result<bool, String> {
    if !legacy.exists() || current.exists() {
        return Ok(false);
    }
    if let Some(parent) = current.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create shell data directory {}: {error}",
                parent.display()
            )
        })?;
    }
    if fs::rename(legacy, current).is_ok() {
        return Ok(true);
    }
    fs::copy(legacy, current).map_err(|error| {
        format!(
            "failed to copy {} to {}: {error}",
            legacy.display(),
            current.display()
        )
    })?;
    fs::remove_file(legacy).map_err(|error| {
        format!(
            "failed to remove the migrated legacy file {}: {error}",
            legacy.display()
        )
    })?;
    Ok(true)
}

/// 启动时跑一次：把 L-07 的两份旧数据文件搬进应用专属目录。任何失败都只记日志——迁移失败最坏
/// 结果是「桌宠位置/服务器地址回到默认」，绝不能因此让应用起不来。
fn migrate_legacy_shell_data(app: &tauri::AppHandle) {
    for file_name in SHELL_DATA_FILES {
        let paths = legacy_shell_data_path(app, file_name)
            .and_then(|legacy| shell_data_path(app, file_name).map(|current| (legacy, current)));
        match paths {
            Ok((legacy, current)) => {
                if legacy == current {
                    continue;
                }
                match migrate_shell_data_file(&legacy, &current) {
                    Ok(true) => shell_log_info(
                        "shell_data_migrated",
                        format!("moved {} to {}", legacy.display(), current.display()),
                    ),
                    Ok(false) => {}
                    Err(error) => shell_log_warn(
                        "shell_data_migration_failed",
                        format!(
                            "could not move {file_name} into the app data directory; continuing \
                             with defaults: {error}"
                        ),
                    ),
                }
            }
            Err(error) => shell_log_warn(
                "shell_data_migration_failed",
                format!("could not resolve {file_name}: {error}"),
            ),
        }
    }
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

    load_shell_config_from_json_env_system_and_device(
        raw.as_deref(),
        |name| std::env::var(name).ok(),
        system_workhub_locale(),
        system_device_name(),
    )
    .map_err(|error| format!("failed to load shell config {}: {error:?}", path.display()))
}

// S5-M-07：设备名的第一来源是**机器名**（此前恒为一个常量，两台 mac 在设备列表里两行同名）。
// 纯逻辑在 config.rs（normalize_system_device_name / detect_system_device_name），这里只负责取回来源。
// 与系统语言同一条纪律：用现成命令读，不引新 crate；只在启动时跑一次；任何失败都静默换下一个来源，
// 一个都问不出来时由 detect_system_device_name 回 None，配置层保留 DEFAULT_DEVICE_NAME。
fn system_device_name() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    // macOS：「共享」偏好里用户自己起的那个名字（可含空格与中文），比 hostname 好读得多。
    #[cfg(target_os = "macos")]
    if let Some(value) = command_output("scutil", &["--get", "ComputerName"]) {
        candidates.push(value);
    }
    // Windows 的 COMPUTERNAME / 各平台 shell 的 HOSTNAME。`.app` 双击启动时继承不到 shell 环境变量，
    // 所以它排在系统来源之后（同 AppleLanguages 优先于 LANG 的取舍）。
    for name in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(value) = std::env::var(name) {
            candidates.push(value);
        }
    }
    if let Some(value) = command_output("hostname", &[]) {
        candidates.push(value);
    }
    detect_system_device_name(candidates)
}

// 只给上面两个系统来源用：跑一条命令取 stdout，任何失败（命令不存在/非零退出）都回 None。
fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

// S3 严重 #4：壳层语言的第一来源是**系统语言**（此前写死中文）。纯逻辑在 locale.rs
// (detect_system_workhub_locale / parse_macos_preferred_languages)，这里只负责把两个来源取回来。
fn system_workhub_locale() -> Option<WorkHubLocale> {
    detect_system_workhub_locale(&macos_preferred_languages(), |name| {
        std::env::var(name).ok()
    })
}

// macOS 的 `.app` 被双击启动时**继承不到 shell 的 LANG/LC_ALL**，AppleLanguages 才是 GUI 应用能问到
// 的唯一系统语言来源。用现成的 `defaults` 命令读（不引新 crate；两次调用各带 1 次进程创建，只在启动
// 时跑一次）。任何失败都静默回空列表，由 detect_system_workhub_locale 继续问环境变量、最后保留默认。
#[cfg(target_os = "macos")]
fn macos_preferred_languages() -> Vec<String> {
    for key in ["AppleLanguages", "AppleLocale"] {
        let Ok(output) = std::process::Command::new("defaults")
            .args(["read", "-g", key])
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let parsed = parse_macos_preferred_languages(&String::from_utf8_lossy(&output.stdout));
        if !parsed.is_empty() {
            return parsed;
        }
    }
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
fn macos_preferred_languages() -> Vec<String> {
    Vec::new()
}

// findings[#132/H15] + R13 批 V2：main/workbench 都是 create:false 复用同一个窗口实例（托盘/深链/
// 通知/open_workbench 都要能再次唤起），关闭按钮（不管是自绘的还是 macOS 原生红绿灯的）语义都是
// 「藏起来」而不是「销毁」——销毁后下次唤起都会先撞见 get_webview_window(label)==None。pet 窗口
// visible:false 也是常驻复用，但它从不带 OS 关闭按钮（decorations:false 全自绘，且没有关闭 UI），
// 不需要拦截。抽成纯函数是因为这条判断此前内联在 on_window_event 闭包里、完全没有测试覆盖过。
fn should_hide_instead_of_close(window_label: &str) -> bool {
    matches!(window_label, "main" | "workbench")
}

// DSK-12 / WIRE-04：write_cuu_qa_dom_report 与 restore_pet_window_interaction 是 QA 专用命令（录屏/截图
// 流水线用），只在 debug build 注册进 invoke handler——release 产物里这两个入口不存在。用宏把命令清单
// 收敛成一份，debug/release 只差尾部两个 QA 命令，避免整份清单在两个 cfg 分支里各写一遍漂移。
macro_rules! workhub_invoke_handler {
    ($($qa_command:ident),* $(,)?) => {
        tauri::generate_handler![
            set_pet_window_mode,
            set_pet_window_settings,
            start_pet_window_drag,
            save_pet_window_position,
            sample_pet_cursor_near,
            pet_cursor_client_position,
            set_pet_window_click_through,
            set_client_token,
            set_server_url,
            get_server_url,
            get_connection_state,
            set_spotlight_size,
            set_shell_badge,
            set_shell_locale,
            focus_system_notification,
            start_main_window_drag,
            move_main_window_by,
            show_main_window,
            hide_main_window,
            focus_main_route,
            open_workbench,
            show_pet_window,
            hide_pet_window,
            toggle_pet_window,
            take_pending_deep_link,
            record_shell_diagnostic,
            get_device_name
            $(, $qa_command)*
        ]
    };
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Err(error) = handle_single_instance_launch(app, args, cwd) {
                shell_log_error("single_instance_failed", error);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        // R15：全局热键宿主插件——只登记插件本身（不预注册任何 accelerator,见插件的
        // Builder::with_shortcut，那条路径会在 setup 阶段用 `?` 直接让 register() 失败上抛,
        // 导致整个 .run() 失败/应用起不来）。真正的 Option+Space 注册放在下面 .setup() 里，
        // 用 on_shortcut() 的 Result 手动兜底降级，绝不让"热键被别的应用占用"炸掉整个启动。
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(PetWindowRuntimeState::default()))
        .manage(Mutex::new(WorkHubLocale::default()))
        // R8：webview bootstrap 拿到的设备令牌经 set_client_token 写入此处，供 Rust SSE worker 鉴权（修 Cuu 重连中）。
        .manage(ShellClientToken::default())
        // S5：壳层服务器地址的运行时真相（set_server_url 写、SSE worker 每次重连读）。这里先托管本机默认值，
        // 因为 .manage() 早于 .setup()（配置文件那时还没读）——setup 里再把配置/环境变量里的真值 set 进去。
        // 先托管的好处是：即使 setup 因为别的原因失败，两个命令也不会因为 state 缺席而炸。
        .manage(ShellServerUrl::default())
        // R25-Q：壳层连接状态"单一真相"（SSE worker 每次状态迁移写入 + 广播 workhub-connection-changed，
        // get_connection_state 命令读它给窗口 boot 拉初值）。同 ShellServerUrl 一样先托管默认值——
        // SSE worker 在 .setup() 里才 spawn，命令在那之前也得拿到一个能用的值（不撒谎的占位，
        // 见 ShellConnectionChangedPayload::default 顶部注释）。
        .manage(ShellConnectionStatus::default())
        // S5-M-07：设备名的解析结果（setup 里读完配置后灌进来），供 webview 报到时取用。
        .manage(ShellDeviceName::default())
        // MRG-23：深链事件重放兜底（见 handle_deep_link_plan / take_pending_deep_link）。
        .manage(Mutex::new(PendingShellDeepLink::default()))
        // R24 玻璃调试开关的前端半边：材质在 Rust 里贴，盒子的半透白底只有 webview 能改，
        // 所以 WORKHUB_GLASS_ALPHA 置位时在页面加载完成后把值递进去（不置位=不注入任何脚本）。
        // 只递给带聚焦盒外壳的两个窗；桌宠窗没有玻璃盒，不掺和。
        .on_page_load(|webview, _payload| {
            if !matches!(webview.label(), "main" | "workbench") {
                return;
            }
            let Some(script) = glass_alpha_override_script(workhub_glass_alpha_from_env(|name| {
                std::env::var(name).ok()
            })) else {
                return;
            };
            if let Err(error) = webview.eval(&script) {
                shell_log_warn("glass_alpha_override_failed", error);
            }
        })
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
            // BX-01：先装文件日志出口，后面所有 shell_log_* 才能落盘（装之前只进 stderr）。
            // 目录解析失败/建不出来都不算失败，退回只有 stderr 的旧行为。
            match app.path().resolve("", BaseDirectory::AppLog) {
                Ok(dir) => {
                    let where_to_look = dir.display().to_string();
                    init_shell_log_dir(dir);
                    // 路径也写进日志：用户报障时「日志在哪」这一问必须有答案，而这一行本身就在那份文件里。
                    // S5-N-04：同一个 bundle id 在一台机器上常常注册着好几份 .app（DMG 还挂着、装了
                    // 两处、开发构建）。「是哪一份应答了这次 workhub:// 」是排查深链的第一问，所以启动
                    // 第一行就写下本进程的可执行体路径。
                    let running_from = std::env::current_exe()
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|_| "<unknown>".to_string());
                    shell_log_info(
                        "shell_started",
                        format!(
                            "WorkHub {} started from {running_from}; shell logs are written to {where_to_look}",
                            app.package_info().version
                        ),
                    );
                }
                Err(error) => eprintln!(
                    "WorkHub: could not resolve the log directory; logging to stderr only: {error}"
                ),
            }
            // L-07：先把旧位置（Application Support 根目录）的数据文件搬进应用专属目录，再读配置——
            // 否则这次启动会读不到用户此前设过的服务器地址/桌宠位置。失败只记日志。
            migrate_legacy_shell_data(app.handle());
            let shell_config = load_workhub_shell_config(app.handle())?;
            if let Ok(mut locale) = app.state::<Mutex<WorkHubLocale>>().lock() {
                *locale = shell_config.locale;
            }
            // S5：把启动配置里的地址灌进运行时真相。此刻还没有任何 SSE worker 在跑，故这里递增到的端点
            // 代际 1 不会打断任何连接——worker 稍后开流时读到的就是它。
            app.state::<ShellServerUrl>()
                .set(shell_config.server_url.clone());
            if let Ok(mut device_name) = app.state::<ShellDeviceName>().0.lock() {
                device_name.clone_from(&shell_config.device_name);
            }
            create_pet_window_with_surface_flag(app)?;
            if let Ok(Some(saved)) = load_pet_window_saved_placement(app.handle()) {
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
            // R15：全局热键唤起聚焦盒（交互规划 04 §二第 2 项）——注册失败（多半是 Option+Space 被
            // 别的应用占用）只记日志降级，绝不 panic/绝不让应用起不来：托盘/常驻小窗仍是保底触达路径。
            if let Err(error) = install_workhub_global_hotkey(app.handle()) {
                shell_log_warn(
                    "global_hotkey_unavailable",
                    format!(
                        "{error}; continuing without the global hotkey (tray icon and the docked \
                         spotlight window remain available)"
                    ),
                );
            }
            if workhub_sse_disabled_from_env(|name| std::env::var(name).ok()) {
                shell_log_info(
                    "sse_worker_disabled",
                    format!("disabled by {WORKHUB_DISABLE_SSE_ENV}"),
                );
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
                        shell_log_error("qa_open_workbench_failed", error);
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
                    // R14 真机反馈：聚焦盒肉眼看"太透"，于是从深色 HudWindow 换成跟随外观的
                    // UnderWindowBackground，白底也从 .52/.36 提到 .78/.6（工作台窗踩过同一类"材质与浅色
                    // 玻璃前景不搭"的坑，R13 F-01，见 r13-workbench-refinement/00-plan.md）。
                    //
                    // R24 用户反馈把这个结论反转了：把一个深色终端窗放到聚焦盒后面，盒子仍是一块实灰，
                    // 「桌面版怎么不透明了」。根因是两档叠着一起收紧了——UnderWindowBackground 是 AppKit
                    // 里最不透的一档衬底材质（几乎不显示背后的窗口，只吃桌面壁纸），前面又压了 .78 白底。
                    // 修法：材质换 GlassMaterial 的默认值，白底降档（token 在 spotlight/css.ts）。
                    // 外观仍钉死 Light —— 聚焦盒 CSS 是硬编码浅色，不钉死的话系统深色下浅色材质会翻黑、
                    // 黑字压在深材质上直接不可读（R24 真机深色外观复验过）。工作台窗抄同一份材质。
                    // 材质/白底都留了 env 覆写（WORKHUB_GLASS_MATERIAL / WORKHUB_GLASS_ALPHA）供真机对比。
                    if let Err(error) = main_window.set_theme(Some(tauri::Theme::Light)) {
                        log_main_window_startup_fallback(
                            MainWindowStartupFallbackStep::MacosVibrancy,
                            error,
                        );
                    }
                    // state=Active 强制毛玻璃常亮：默认 FollowsWindowActiveState 会让窗口"没被点中(非 key)"时
                    // vibrancy 退成扁平不透明材质 —— 表现就是"点一下才有毛玻璃"。聚焦盒不抢焦点也要一直是玻璃。
                    let material = workhub_glass_material_from_env(|name| std::env::var(name).ok())
                        .ns_material();
                    if let Err(error) = window_vibrancy::apply_vibrancy(
                        &main_window,
                        material,
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
        .invoke_handler({
            #[cfg(debug_assertions)]
            {
                workhub_invoke_handler!(restore_pet_window_interaction, write_cuu_qa_dom_report)
            }
            #[cfg(not(debug_assertions))]
            {
                workhub_invoke_handler!()
            }
        })
        // R19-16：改用 build()? + App::run(callback) 收尾，以便注册 RunEvent 回调消费 macOS Dock 图标点击
        // （applicationShouldHandleReopen → RunEvent::Reopen）。主窗自绘关闭/Cmd+W 都是 hide 不是 close
        // （见 should_hide_instead_of_close），用户经常把主窗藏进托盘；此前 main() 以 Builder::run 收尾、
        // 没有任何 RunEvent 回调，点 Dock 图标毫无反应，藏起来的主窗只能靠托盘/深链/通知找回。
        .build(tauri::generate_context!())
        // 启动失败（坏 tauri.conf.json / 缺 main·pet 窗口标签 / 缺图标 / 插件初始化失败等）原本只 panic 出
        // 一句无上下文的 "failed to run WorkHub Tauri shell"。改为打印真实错误(Debug)再非零退出，便于诊断。
        .unwrap_or_else(|error| {
            shell_log_error("shell_start_failed", format!("{error:?}"));
            std::process::exit(1);
        })
        .run(handle_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use workhub_client_tauri::single_instance::single_instance_plan_from_args;

    // R24 玻璃通透度开关：材质/白底两档都只在真机上肉眼可判，能自动测的就是"env 解析别把默认值弄丢"。
    fn env_map(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + use<> {
        let owned: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        move |name: &str| {
            owned
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        }
    }

    #[test]
    fn glass_material_defaults_and_parses_every_documented_alias() {
        assert_eq!(
            workhub_glass_material_from_env(env_map(&[])),
            GlassMaterial::default(),
            "没置位就必须是默认材质"
        );
        assert_eq!(
            workhub_glass_material_from_env(env_map(&[(WORKHUB_GLASS_MATERIAL_ENV, "  PopOver ")])),
            GlassMaterial::Popover,
            "大小写/空白都该收——真机对比时是手敲的"
        );
        for (raw, expected) in [
            ("sidebar", GlassMaterial::Sidebar),
            ("menu", GlassMaterial::Menu),
            ("header", GlassMaterial::HeaderView),
            ("under_window", GlassMaterial::UnderWindowBackground),
            ("hud", GlassMaterial::HudWindow),
        ] {
            assert_eq!(
                workhub_glass_material_from_env(env_map(&[(WORKHUB_GLASS_MATERIAL_ENV, raw)])),
                expected,
                "别名 {raw} 应当解析成 {expected:?}"
            );
        }
        assert_eq!(
            workhub_glass_material_from_env(env_map(&[(WORKHUB_GLASS_MATERIAL_ENV, "frosted")])),
            GlassMaterial::default(),
            "拼错的调试值该静默退回默认，不该让窗口失去玻璃"
        );
    }

    #[test]
    fn glass_alpha_env_only_accepts_a_readable_range() {
        assert_eq!(workhub_glass_alpha_from_env(env_map(&[])), None);
        assert_eq!(
            workhub_glass_alpha_from_env(env_map(&[(WORKHUB_GLASS_ALPHA_ENV, " 0.45 ")])),
            Some(0.45)
        );
        assert_eq!(
            workhub_glass_alpha_from_env(env_map(&[(WORKHUB_GLASS_ALPHA_ENV, "1")])),
            Some(1.0)
        );
        for bad in ["0", "-0.2", "1.4", "abc", ""] {
            assert_eq!(
                workhub_glass_alpha_from_env(env_map(&[(WORKHUB_GLASS_ALPHA_ENV, bad)])),
                None,
                "{bad} 该被拒——全透明/越界的盒子读不了字"
            );
        }
    }

    #[test]
    fn glass_alpha_script_is_only_injected_when_the_switch_is_set() {
        assert_eq!(glass_alpha_override_script(None), None);
        let script = glass_alpha_override_script(Some(0.5)).expect("置位时该有脚本");
        assert!(script.contains("window.__WORKHUB_GLASS_ALPHA__=0.5"));
        // 渐变底端按 .77 比例更透一档，与 desktop-glass-alpha.ts 的 BOTTOM_RATIO 对齐。
        assert!(script.contains("--wh-spot-glass-top','rgba(255,255,255,0.5)"));
        assert!(script.contains("--wh-spot-glass-bottom','rgba(255,255,255,0.39)"));
        assert!(script.contains("--ds-glass-strong','rgba(255,255,255,0.5)"));
        assert!(
            script.contains("try{") && script.contains("catch(e){}"),
            "注入脚本必须自带兜底：调试开关不该让 webview 起不来"
        );
    }

    // L-07：一次性数据迁移（Application Support 根目录 → 应用专属目录）。用真实临时目录跑，
    // 因为这条逻辑的全部风险都在文件系统语义上（已存在就不覆盖、搬完删旧、缺目录先建）。
    fn migration_sandbox(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "workhub-shell-data-migration-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("sandbox should be creatable");
        dir
    }

    #[test]
    fn migrates_a_legacy_shell_data_file_into_the_app_data_directory() {
        let sandbox = migration_sandbox("moves");
        let legacy = sandbox.join(SHELL_CONFIG_FILE);
        // 应用专属目录还不存在——迁移要负责把它建出来。
        let current = sandbox.join("com.mycyg.workhub").join(SHELL_CONFIG_FILE);
        fs::write(&legacy, r#"{"server_url":"http://192.168.1.10:8787"}"#).unwrap();

        assert_eq!(migrate_shell_data_file(&legacy, &current), Ok(true));
        assert!(
            !legacy.exists(),
            "旧文件搬完就该消失，否则下次启动还会看到它"
        );
        assert_eq!(
            fs::read_to_string(&current).unwrap(),
            r#"{"server_url":"http://192.168.1.10:8787"}"#
        );

        // 幂等：再跑一次什么都不做。
        assert_eq!(migrate_shell_data_file(&legacy, &current), Ok(false));

        let _ = fs::remove_dir_all(&sandbox);
    }

    #[test]
    fn migration_never_overwrites_an_existing_app_data_file_and_skips_missing_legacy_ones() {
        let sandbox = migration_sandbox("keeps");
        let legacy = sandbox.join(PET_WINDOW_STATE_FILE);
        let current = sandbox
            .join("com.mycyg.workhub")
            .join(PET_WINDOW_STATE_FILE);
        fs::create_dir_all(current.parent().unwrap()).unwrap();
        fs::write(&legacy, "legacy").unwrap();
        fs::write(&current, "current").unwrap();

        // 新位置才是真相：绝不用旧文件覆盖它。
        assert_eq!(migrate_shell_data_file(&legacy, &current), Ok(false));
        assert_eq!(fs::read_to_string(&current).unwrap(), "current");
        assert!(legacy.exists());

        // 旧文件根本不存在（全新安装）→ 无操作。
        let absent = sandbox.join("never-written.json");
        let target = sandbox.join("com.mycyg.workhub").join("never-written.json");
        assert_eq!(migrate_shell_data_file(&absent, &target), Ok(false));
        assert!(!target.exists());

        let _ = fs::remove_dir_all(&sandbox);
    }

    // P1-04:纯内存假实现,记录调用顺序/次数,脱离真实 tauri::AppHandle 复现"第二实例带 workbench 深链、
    // workbench 窗尚未创建"场景,并验证 apply_deep_link_plan 是否先建窗再控制窗口。
    #[derive(Default)]
    struct FakeDeepLinkWindowHost {
        existing_windows: HashSet<String>,
        created_windows: Vec<String>,
        controlled_labels: Vec<String>,
    }

    impl DeepLinkWindowHost for FakeDeepLinkWindowHost {
        fn create_window(&mut self, label: &str) -> Result<(), String> {
            self.created_windows.push(label.to_string());
            self.existing_windows.insert(label.to_string());
            Ok(())
        }

        fn control_window(&mut self, control: &ShellWindowControlPlan) -> Result<(), String> {
            if !self.existing_windows.contains(&control.label) {
                return Err(format!("{} window is not available", control.label));
            }
            self.controlled_labels.push(control.label.clone());
            Ok(())
        }
    }

    #[test]
    fn skipping_the_create_step_loses_a_workbench_deep_link_when_window_is_missing() {
        // 复现 P1-04 根因:旧的 single-instance 分支直接执行窗口控制、不先建窗;应用已运行但用户从未
        // 点开过工作台(workbench 窗还不存在)时,窗口控制直接报"不可用",深链目标丢失。
        let mut host = FakeDeepLinkWindowHost::default();
        let plan =
            deep_link_plan_from_url("workhub://workbench/86000000-0000-4000-8000-000000000001")
                .unwrap();

        let result = host.control_window(&plan.window_control);

        assert_eq!(result, Err("workbench window is not available".to_string()));
    }

    #[test]
    fn apply_deep_link_plan_creates_the_missing_workbench_window_before_navigating() {
        // 修复后:deep-link 与 single-instance 共享的落地路径按需建窗后再执行窗口控制,深链不丢。
        let mut host = FakeDeepLinkWindowHost::default();
        let plan =
            deep_link_plan_from_url("workhub://workbench/86000000-0000-4000-8000-000000000001")
                .unwrap();

        apply_deep_link_plan(&mut host, &plan).unwrap();

        assert_eq!(host.created_windows, vec!["workbench".to_string()]);
        assert_eq!(host.controlled_labels, vec!["workbench".to_string()]);
    }

    #[test]
    fn apply_deep_link_plan_does_not_create_the_always_present_main_window() {
        // main 窗启动时已建好(create 未置 false),不需要走按需建窗这一步。
        let mut host = FakeDeepLinkWindowHost::default();
        host.existing_windows.insert("main".to_string());
        let plan = deep_link_plan_from_url("workhub://open/approvals").unwrap();

        apply_deep_link_plan(&mut host, &plan).unwrap();

        assert!(host.created_windows.is_empty());
        assert_eq!(host.controlled_labels, vec!["main".to_string()]);
    }

    #[test]
    fn single_instance_workbench_deep_link_creates_the_window_via_shared_apply_path() {
        // 串联 single_instance 的纯规划(从第二实例 argv 提取 deep_links)与 main.rs 的共享落地路径:
        // 第二实例带 workbench 深链时,即便 workbench 窗从未创建过,也不会丢链。
        let single_instance_plan = single_instance_plan_from_args(
            &[
                "WorkHub.exe".to_string(),
                "workhub://workbench/86000000-0000-4000-8000-000000000001".to_string(),
            ],
            "C:/WorkHub",
        );
        assert_eq!(single_instance_plan.deep_links.len(), 1);

        let mut host = FakeDeepLinkWindowHost::default();
        for deep_link in &single_instance_plan.deep_links {
            apply_deep_link_plan(&mut host, deep_link).unwrap();
        }

        assert_eq!(host.created_windows, vec!["workbench".to_string()]);
        assert_eq!(host.controlled_labels, vec!["workbench".to_string()]);
    }

    // MRG-23：暂存深链的认领语义——目标窗口 label 匹配且未过期才交出（一次性），错窗认领放回去，过期即弃。
    #[test]
    fn pending_deep_link_is_taken_only_by_its_target_window_while_fresh() {
        let plan =
            deep_link_plan_from_url("workhub://workbench/86000000-0000-4000-8000-000000000001")
                .unwrap();
        let stashed_at = Instant::now();

        // 别的窗口（main 先 boot）来问：拿不到，且 stash 留给真正的目标窗。
        let mut pending = Some((plan.clone(), stashed_at));
        let taken =
            take_pending_deep_link_from(&mut pending, "main", stashed_at + Duration::from_secs(1));
        assert!(taken.is_none());
        assert!(
            pending.is_some(),
            "mismatched window must not consume the stash"
        );

        // 目标窗（workbench）来问：拿到且一次性清除。
        let taken = take_pending_deep_link_from(
            &mut pending,
            "workbench",
            stashed_at + Duration::from_secs(2),
        );
        assert_eq!(taken, Some(plan.clone()));
        assert!(pending.is_none());
        assert!(take_pending_deep_link_from(
            &mut pending,
            "workbench",
            stashed_at + Duration::from_secs(3)
        )
        .is_none());

        // 过期（> TTL）：目标窗来问也拿不到，stash 清掉不留污染。
        let mut stale = Some((plan, stashed_at));
        let taken = take_pending_deep_link_from(
            &mut stale,
            "workbench",
            stashed_at + PENDING_DEEP_LINK_TTL + Duration::from_secs(1),
        );
        assert!(taken.is_none());
        assert!(stale.is_none(), "expired stash must be dropped");
    }

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

    // R19-16：Dock 图标点击恢复隐藏的主窗。修复前 main() 无 RunEvent 回调、点 Dock 无反应;这条锁住恢复决策
    // ——主窗隐藏时用与托盘同一套 show_main_window_plan 恢复,已可见时不动（不抢焦点）。
    #[test]
    fn dock_reopen_restores_only_a_hidden_main_window() {
        let plan =
            dock_reopen_plan(false).expect("hidden main window should be restored on Dock reopen");
        assert_eq!(plan.label, "main");
        assert_eq!(plan.action, ShellWindowControlAction::ShowAndFocus);
        assert_eq!(plan.source, ShellWindowControlSource::Setting);
        assert_eq!(plan.route, Some("/".to_string()));

        assert!(dock_reopen_plan(true).is_none());
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
        assert_eq!(
            clamp_spotlight_size(f64::NAN, f64::INFINITY),
            (720.0, 480.0)
        );
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
        assert!(
            workhub_cuu_qa_preferences_from_env(named_env(&[(
                WORKHUB_CUU_QA_DOM_REPORT_PATH_ENV,
                "C:\\temp\\cuu-tauri-dom-report.json"
            )]))
            .pet_qa_dom_report
        );
        assert!(
            !workhub_cuu_qa_preferences_from_env(named_env(&[(
                WORKHUB_CUU_QA_DOM_REPORT_PATH_ENV,
                " "
            )]))
            .pet_qa_dom_report
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
