use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use workhub_client_tauri::windows::default_window_plans;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_json(relative_path: &str) -> Value {
    let path = manifest_dir().join(relative_path);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

#[test]
fn tauri_build_points_at_the_desktop_webview_surface() {
    let config = read_json("tauri.conf.json");
    let build = &config["build"];

    assert_eq!(build["devUrl"], "http://127.0.0.1:1420");
    assert_eq!(build["frontendDist"], "../../apps/desktop-webview/dist");
    assert!(build["beforeDevCommand"]
        .as_str()
        .unwrap()
        .contains("@workhub/desktop-webview"));
    assert!(build["beforeBuildCommand"]
        .as_str()
        .unwrap()
        .contains("@workhub/desktop-webview"));
}

#[test]
fn tauri_windows_match_the_shell_window_contract() {
    let config = read_json("tauri.conf.json");
    assert_eq!(config["app"]["withGlobalTauri"], true);

    let windows = config["app"]["windows"].as_array().unwrap();
    let plans = default_window_plans();

    assert_eq!(windows.len(), plans.len());

    for plan in plans {
        let window = windows
            .iter()
            .find(|window| window["label"] == plan.label)
            .unwrap_or_else(|| panic!("missing Tauri window config for {}", plan.label));

        assert_eq!(window["title"], plan.title);
        assert_eq!(window["url"], plan.route);
        assert_eq!(window["width"], plan.width);
        assert_eq!(window["height"], plan.height);
        assert_eq!(window["minWidth"], plan.min_width.unwrap());
        assert_eq!(window["minHeight"], plan.min_height.unwrap());
        assert_eq!(window["resizable"], plan.resizable);
        assert_eq!(window["visible"], plan.visible);
        assert_eq!(window["focus"], plan.focus);
        assert_eq!(window["transparent"], plan.transparent);
        assert_eq!(window["decorations"], plan.decorations);
        assert_eq!(window["alwaysOnTop"], plan.always_on_top);

        if plan.is_pet_window() {
            assert_eq!(plan.skip_taskbar, true);
            assert!(
                window.get("skipTaskbar").is_none(),
                "skipTaskbar stays in the WorkHub plan until it is confirmed by the Tauri v2 schema"
            );
        }
    }
}

#[test]
fn transparent_windows_declare_a_fully_transparent_webview_background() {
    let config = read_json("tauri.conf.json");
    let windows = config["app"]["windows"].as_array().unwrap();

    for window in windows {
        if window["transparent"].as_bool() == Some(true) {
            assert_eq!(
                window["backgroundColor"], "#00000000",
                "transparent window {:?} must not let the webview fall back to a white background",
                window["label"]
            );
        }
    }
}

#[test]
fn macos_main_window_restores_native_vibrancy_for_real_frosted_glass() {
    // 纯透明窗里 CSS backdrop-filter 没有可糊的内容，半透白底只是奶白不带模糊——真·毛玻璃必须靠 OS vibrancy。
    // 主窗仍保持透明（背景色 alpha≈0），vibrancy 只在 webview 之后贴一层系统材质，透出并模糊桌面。
    let main_rs_path = manifest_dir().join("src/main.rs");
    let raw = fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", main_rs_path.display()));

    assert!(
        raw.contains("apply_vibrancy("),
        "main window must re-apply native vibrancy so the Spotlight glass actually frosts the desktop"
    );
    assert!(
        raw.contains("NSVisualEffectMaterial::HudWindow"),
        "Spotlight vibrancy should use the HudWindow material to match the glass tint"
    );
    assert!(
        raw.contains("WORKHUB_DISABLE_VIBRANCY"),
        "vibrancy must stay gated behind WORKHUB_DISABLE_VIBRANCY for automated screenshot capture"
    );
}

#[test]
fn macos_main_window_receives_pointer_events_with_a_native_one_alpha_hit_surface() {
    let main_rs_path = manifest_dir().join("src/main.rs");
    let raw = fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", main_rs_path.display()));

    // 旧断言只查全局存在 Color(0, 0, 0, 1)，这会允许 Windows/Linux 也套用一像素黑底；
    // 3-5 的目标是只在 macOS 透明主窗上补 native hit surface，避免其他平台主窗变纯黑。
    assert!(
        raw.contains("#[cfg(target_os = \"macos\")]\nfn configure_main_window_hit_surface"),
        "macOS transparent windows need a gated native one-alpha hit surface; CSS zero-alpha centers still click through"
    );
    assert!(
        raw.contains("#[cfg(not(target_os = \"macos\"))]\nfn configure_main_window_hit_surface"),
        "non-macOS main windows must not receive the one-alpha black hit surface"
    );
    assert!(
        raw.contains(".set_ignore_cursor_events(false)"),
        "transparent Spotlight must keep native pointer reception enabled"
    );
}

#[test]
fn macos_main_window_exposes_manual_drag_fallback_for_transparent_search_center() {
    let main_rs_path = manifest_dir().join("src/main.rs");
    let raw = fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", main_rs_path.display()));

    assert!(
        raw.contains("setMovableByWindowBackground(true)"),
        "transparent Spotlight must enable native NSWindow background dragging after the WKWebView is attached"
    );
    assert!(
        raw.contains("setMovable(true)"),
        "background dragging depends on the NSWindow staying movable"
    );
    assert!(
        raw.contains("fn move_main_window_by("),
        "Spotlight center dragging cannot depend only on native drag regions because the search input can consume the gesture"
    );
    assert!(raw.contains("window.outer_position()"));
    assert!(raw.contains("window.set_position(TauriLogicalPosition::new("));
    assert!(raw.contains("move_main_window_by,"));
}

#[test]
fn tauri_bundle_targets_are_platform_native_not_windows_only() {
    let config = read_json("tauri.conf.json");
    let targets = &config["bundle"]["targets"];

    assert_eq!(
        targets, "all",
        "bundle targets must stay platform-native; nsis-only config cannot produce macOS app/dmg bundles"
    );
}

#[test]
fn macos_info_plist_overrides_legacy_carbon_requirement() {
    let config = read_json("tauri.conf.json");
    assert_eq!(config["bundle"]["macOS"]["infoPlist"], "Info.plist");

    let plist_path = manifest_dir().join("Info.plist");
    let raw = fs::read_to_string(&plist_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", plist_path.display()));

    assert!(raw.contains("<key>LSRequiresCarbon</key>"));
    assert!(raw.contains("<false/>"));
    assert!(!raw.contains("<true/>"));
}

#[test]
fn default_capability_is_local_and_window_scoped() {
    let capability = read_json("capabilities/default.json");
    let windows = capability["windows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect::<HashSet<_>>();
    let permissions = capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect::<HashSet<_>>();

    assert_eq!(capability["identifier"], "default");
    assert_eq!(windows, HashSet::from(["main", "pet"]));
    // 旧断言把 allow-start-resize-dragging 视为默认权限；3-1 已删除可见 resize 控件，
    // 继续授予无人调用的 capability 只会扩大桌面运行时权限面。
    assert_eq!(
        permissions,
        HashSet::from(["core:default", "core:window:allow-start-dragging"])
    );
    assert!(permissions.iter().all(|permission| {
        !permission.starts_with("fs:")
            && !permission.starts_with("shell:")
            && !permission.starts_with("process:")
    }));
}

#[test]
fn main_window_control_logs_chrome_configuration_failures_without_blocking_navigation() {
    let main_rs_path = manifest_dir().join("src/main.rs");
    let raw = fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", main_rs_path.display()));

    assert!(
        !raw.contains("configure_main_window_chrome(&window)?"),
        "tray/deep-link navigation must continue when chrome configuration is unavailable"
    );
    assert!(
        raw.contains("if let Err(error) = configure_main_window_chrome(&window)"),
        "main chrome configuration failures should be handled locally"
    );
    assert!(
        raw.contains("failed to configure main window chrome; continuing window control"),
        "the fallback must leave a diagnostic for real-device follow-up"
    );
    assert!(
        raw.contains("app.emit(\"navigate\", route.clone())"),
        "route navigation still needs to run after a chrome fallback"
    );
}

#[test]
fn unused_main_resize_drag_runtime_entry_is_retired() {
    let main_rs_path = manifest_dir().join("src/main.rs");
    let raw = fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", main_rs_path.display()));

    assert!(
        !raw.contains("start_main_window_resize_drag"),
        "3-1 removed the Spotlight resize handles, so the unused resize command should not stay registered"
    );
    assert!(
        !raw.contains("start_resize_dragging"),
        "no remaining Rust path should require the retired start-resize-dragging permission"
    );
}
