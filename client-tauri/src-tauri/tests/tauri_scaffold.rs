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
    assert_eq!(permissions, HashSet::from(["core:default"]));
    assert!(permissions.iter().all(|permission| {
        !permission.starts_with("fs:")
            && !permission.starts_with("shell:")
            && !permission.starts_with("process:")
    }));
}
