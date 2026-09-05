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
            assert!(plan.skip_taskbar);
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
fn main_window_declares_native_shadow_explicitly() {
    // R13 V2 established the pattern (workbench window, r13-v2-window-craft.md): a window's own CSS
    // box-shadow paints a rectangular projection outside the native rounded-corner clip, leaving a
    // flat-edge artifact on real hardware — depth must come from the native NSWindow shadow instead,
    // with the CSS radius only clipping content. The main/Spotlight window relies on this exact same
    // native shadow (its own CSS box-shadow's outer term was removed for R14), so the declarative
    // config must say so explicitly rather than resting on tauri-utils' implicit default.
    let config = read_json("tauri.conf.json");
    let windows = config["app"]["windows"].as_array().unwrap();
    let main_window = windows
        .iter()
        .find(|window| window["label"] == "main")
        .expect("main window config must exist");

    assert_eq!(
        main_window["shadow"], true,
        "main window must keep the native window shadow so the Spotlight glass has real depth \
         without a CSS box-shadow poking a flat edge past the rounded corners"
    );
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
    // R14 真机反馈：聚焦盒肉眼太透（HudWindow 是深色 HUD 材质、不跟随外观，跟聚焦盒硬编码浅色 CSS 前景不搭，
    // 同一类问题工作台窗踩过一次、R13 F-01 换成了跟随外观的 UnderWindowBackground——聚焦盒抄同一份材质）。
    assert!(
        raw.contains("NSVisualEffectMaterial::UnderWindowBackground"),
        "Spotlight vibrancy should use the UnderWindowBackground material like the workbench window, not the dark HudWindow HUD material"
    );
    assert!(
        !raw.contains("NSVisualEffectMaterial::HudWindow"),
        "Spotlight vibrancy must not regress to the dark HudWindow material that read as too see-through against the light glass foreground"
    );
    // UnderWindowBackground follows system appearance; the Spotlight CSS is hardcoded light-only
    // (no prefers-color-scheme branch), so the window appearance must be pinned Light or dark mode
    // would flip the vibrancy black behind light content — same fix the workbench window needed.
    assert!(
        raw.contains("main_window.set_theme(Some(tauri::Theme::Light))"),
        "Spotlight window appearance must be pinned Light to match its hardcoded-light CSS, like the workbench window"
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

// R24 S5 核实（S1 侦察报告 E-13「macOS 深链 scheme 注册未经真机核实」）：**不需要修，配置已经是官方形态**。
//
// 证据链，三条都亲自验过：
//  1. 真实产物。本仓 `client-tauri/src-tauri/target/release/bundle/macos/WorkHub.app/Contents/Info.plist`
//     里确实有 `CFBundleURLTypes → [{ CFBundleURLSchemes: ["workhub", "yqgl"], CFBundleTypeRole: Editor }]`，
//     是打包器从 `plugins.deep-link.desktop.schemes` 生成的；同一份 plist 里还留着手写文件那条
//     `LSRequiresCarbon`——说明 `bundle.macOS.infoPlist` 是**合并**进生成结果，不是替换它。
//  2. 插件源码。`tauri-plugin-deep-link` 的 `DesktopProtocol` 字段带着 `// Used in tauri-bundler` 注释，
//     `tauri_utils::config::DeepLinkProtocol` 的 `name`/`role` 也直说映射到 `CFBundleTypeName`/`CFBundleTypeRole`
//     ——desktop schemes 的 macOS 归宿就是打包器。
//  3. `register_all()` 的 Win/Linux cfg 守卫同样是对的：插件的 `register()` 在 macOS 上明确返回
//     `UnsupportedPlatform`（LaunchServices 只从 app bundle 读注册信息，不接受运行时注册）。
//
// 所以这里钉死的是「别去手写那份 CFBundleURLTypes」：合并时手写文件的键会**盖掉**打包器生成的那份，
// 从此 scheme 得靠人肉两处同步，反而是引入缺陷。
#[test]
fn macos_deep_link_schemes_are_generated_by_the_bundler_not_hand_written_into_info_plist() {
    let config = read_json("tauri.conf.json");
    let schemes = config["plugins"]["deep-link"]["desktop"]["schemes"]
        .as_array()
        .expect(
            "deep-link desktop schemes must stay declared for the bundler to emit CFBundleURLTypes",
        )
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        schemes,
        vec!["workhub", "yqgl"],
        "macOS registers deep links from the bundled Info.plist, which the bundler generates from this list"
    );

    let plist_path = manifest_dir().join("Info.plist");
    let raw = fs::read_to_string(&plist_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", plist_path.display()));
    assert!(
        !raw.contains("CFBundleURLTypes"),
        "the hand-written Info.plist is merged over the generated one, so a hand-written \
         CFBundleURLTypes would shadow the bundler's and drift from plugins.deep-link.desktop.schemes"
    );

    let main_rs_path = manifest_dir().join("src/main.rs");
    let main_rs = fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", main_rs_path.display()));
    assert!(
        main_rs.contains("#[cfg(any(windows, target_os = \"linux\"))]"),
        "register_all() must stay gated off macOS, where the plugin returns UnsupportedPlatform"
    );
}

// S5：换服务器的两条命令必须留在 invoke handler 里。它们是壳层地址的唯一写/读入口——掉出清单等于
// 托盘角标、系统通知、Cuu 推送重新钉死在启动时那个地址上（S1 报告 E-06）。
//
// 这里**不该**有对应的 capabilities/*.json 条目：Tauri v2 的 ACL 只管插件命令，应用自己 `generate_handler!`
// 出来的命令不走权限表（既有的 set_client_token / open_workbench 等二十来条同样没有条目，真实 .app 上工作正常）。
#[test]
fn runtime_server_url_commands_stay_registered_without_widening_the_capability_surface() {
    let main_rs_path = manifest_dir().join("src/main.rs");
    let raw = fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", main_rs_path.display()));

    assert!(raw.contains("            set_server_url,"));
    assert!(raw.contains("            get_server_url,"));
    assert!(
        raw.contains(".manage(ShellServerUrl::default())"),
        "the runtime server url must be managed before setup so both commands always find their state"
    );

    for capability in ["capabilities/default.json", "capabilities/workbench.json"] {
        let permissions = read_json(capability)["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert!(
            permissions.iter().all(|permission| permission.starts_with("core:")),
            "{capability} should only carry core plugin permissions; app commands are not ACL-gated"
        );
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
    // S3-#6：navigate 不再是裸字符串广播,而是 shell_navigate_payload 产出的结构体定向发给目标窗口
    // （根路径 = 「显示窗口」不再广播,否则会把深链/托盘刚打开的能力洗成 idle 条）。这条断言钉住
    // 「chrome 兜底之后导航照常执行」这个原意,同时钉住新的发送形状。
    assert!(
        raw.contains("if let Some(payload) = shell_navigate_payload(&plan)"),
        "route navigation still needs to run after a chrome fallback"
    );
    assert!(
        !raw.contains("app.emit(\"navigate\""),
        "navigate must carry the structured ShellNavigatePayload, not a bare route string"
    );
    assert!(
        raw.contains("event_channel_name(ShellEvent::Navigate)"),
        "the navigate channel name must come from the shared ShellEvent contract"
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
