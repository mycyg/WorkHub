use serde::{Deserialize, Serialize};

use crate::windows::{main_window_plan, pet_window_plan, workbench_window_plan, ShellWindowPlan};

/// 主窗（聚焦盒）的窗口 label。壳层里唯一消费 `navigate` 事件的窗口，见 `shell_navigate_payload`。
pub const MAIN_WINDOW_LABEL: &str = "main";
/// `show_main_window` / dock reopen / 全局热键这类「只是把窗口显示出来」的计划带的 route。
/// 它不是一个导航目标，见 `shell_navigate_payload` 的注释。
pub const SHELL_ROOT_ROUTE: &str = "/";

pub const SHOW_MAIN_WINDOW_COMMAND: &str = "show_main_window";
pub const HIDE_MAIN_WINDOW_COMMAND: &str = "hide_main_window";
pub const FOCUS_MAIN_ROUTE_COMMAND: &str = "focus_main_route";
pub const SHOW_PET_WINDOW_COMMAND: &str = "show_pet_window";
pub const HIDE_PET_WINDOW_COMMAND: &str = "hide_pet_window";
pub const TOGGLE_PET_WINDOW_COMMAND: &str = "toggle_pet_window";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellWindowControlAction {
    Show,
    Hide,
    Toggle,
    Focus,
    ShowAndFocus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellWindowControlSource {
    Tray,
    DeepLink,
    CuuBubble,
    Setting,
    SystemNotification,
    Startup,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellWindowControlPlan {
    pub label: String,
    pub action: ShellWindowControlAction,
    pub source: ShellWindowControlSource,
    pub route: Option<String>,
    pub focus: bool,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellWindowControlError {
    EmptyRoute,
    UnsafeRoute,
}

/// 壳层发给主窗（聚焦盒）的一次导航请求。
///
/// **S3-#6 根因（深链/托盘热态导航失效）**：`execute_window_control` 过去对 label=="main" 的任何计划都
/// 无条件 `app.emit("navigate", route)` 广播一个**裸字符串**。而 `show_main_window()` 这种「只是把窗口
/// 显示出来」的计划带的 route 是根路径 `/`——webview 侧 `capabilityForShellRoute("/")` 认不出能力，
/// 于是落进 `spotlight.reset()`，把用户正开着的能力**清空成 idle 搜索条**。
///
/// macOS 上 `open workhub://open/settings`（应用已在跑）会同时触发两件事：
/// 1. deep-link 插件的 `on_open_url` → navigate `/settings`（正确）；
/// 2. 应用被激活 → `RunEvent::Reopen` → 主窗此刻通常是隐藏态 → `show_main_window_plan` → navigate `/`。
///
/// 第二条随后把第一条刚打开的能力洗掉，肉眼结果就是「深链只把 app 拉到前台、聚焦盒复位成 idle 条」。
/// 托盘「打开收件箱 / 设置」走同一条 `execute_window_control` 通道，点击托盘同样会激活应用，故同废。
///
/// 修法：把「显示窗口」和「导航到目标」拆开——根路径 `/` 不再产生 navigate 事件（显示窗口不是导航），
/// 并且 payload 从裸字符串换成带 `label` / `source` / `reason` 的结构体，让接收端能判断这条导航
/// 是谁、为什么发的（webview 侧据此对 `show-main` 这类原因兜底忽略）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellNavigatePayload {
    pub route: String,
    pub label: String,
    pub source: ShellWindowControlSource,
    pub reason: String,
}

/// 某个窗口控制计划该不该、以及以什么内容广播一次主窗导航。纯函数，便于单测 payload 形状。
///
/// 三条 None：非主窗（只有聚焦盒消费 navigate）、没有 route（hide 一类）、route 是根路径
/// （「显示窗口」不是「导航」，见 `ShellNavigatePayload` 的根因注释）。
pub fn shell_navigate_payload(plan: &ShellWindowControlPlan) -> Option<ShellNavigatePayload> {
    if plan.label != MAIN_WINDOW_LABEL {
        return None;
    }
    let route = plan.route.as_deref()?.trim();
    if route.is_empty() || route == SHELL_ROOT_ROUTE {
        return None;
    }
    Some(ShellNavigatePayload {
        route: route.to_string(),
        label: plan.label.clone(),
        source: plan.source,
        reason: plan.reason.clone(),
    })
}

pub fn show_main_window(source: ShellWindowControlSource) -> ShellWindowControlPlan {
    control_plan(
        main_window_plan(),
        ShellWindowControlAction::ShowAndFocus,
        source,
        Some("/".to_string()),
        "show-main",
    )
}

pub fn hide_main_window(source: ShellWindowControlSource) -> ShellWindowControlPlan {
    control_plan(
        main_window_plan(),
        ShellWindowControlAction::Hide,
        source,
        None,
        "hide-main",
    )
}

pub fn focus_main_route(
    source: ShellWindowControlSource,
    route: &str,
) -> Result<ShellWindowControlPlan, ShellWindowControlError> {
    Ok(control_plan(
        main_window_plan(),
        ShellWindowControlAction::ShowAndFocus,
        source,
        Some(safe_route(route)?),
        "focus-main-route",
    ))
}

pub fn focus_workbench_route(
    source: ShellWindowControlSource,
    route: &str,
) -> Result<ShellWindowControlPlan, ShellWindowControlError> {
    Ok(control_plan(
        workbench_window_plan(),
        ShellWindowControlAction::ShowAndFocus,
        source,
        Some(safe_route(route)?),
        "focus-workbench-route",
    ))
}

pub fn show_pet_window(source: ShellWindowControlSource) -> ShellWindowControlPlan {
    let window = pet_window_plan();
    let route = Some(window.route.clone());
    control_plan(
        window,
        ShellWindowControlAction::Show,
        source,
        route,
        "show-pet",
    )
}

pub fn hide_pet_window(source: ShellWindowControlSource) -> ShellWindowControlPlan {
    control_plan(
        pet_window_plan(),
        ShellWindowControlAction::Hide,
        source,
        None,
        "hide-pet",
    )
}

pub fn toggle_pet_window(source: ShellWindowControlSource) -> ShellWindowControlPlan {
    let window = pet_window_plan();
    let route = Some(window.route.clone());
    control_plan(
        window,
        ShellWindowControlAction::Toggle,
        source,
        route,
        "toggle-pet",
    )
}

fn control_plan(
    window: ShellWindowPlan,
    action: ShellWindowControlAction,
    source: ShellWindowControlSource,
    route: Option<String>,
    reason: &str,
) -> ShellWindowControlPlan {
    let focus = should_focus(action, &window);
    ShellWindowControlPlan {
        label: window.label,
        action,
        source,
        route,
        focus,
        reason: reason.to_string(),
    }
}

fn should_focus(action: ShellWindowControlAction, window: &ShellWindowPlan) -> bool {
    matches!(
        action,
        ShellWindowControlAction::Focus | ShellWindowControlAction::ShowAndFocus
    ) && window.focus
}

fn safe_route(route: &str) -> Result<String, ShellWindowControlError> {
    let trimmed = route.trim();
    if trimmed.is_empty() {
        return Err(ShellWindowControlError::EmptyRoute);
    }
    if !trimmed.starts_with('/')
        || trimmed.starts_with("//")
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains('\n')
        || trimmed.contains('\r')
    {
        return Err(ShellWindowControlError::UnsafeRoute);
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_controls_show_and_focus_known_routes() {
        let plan =
            focus_main_route(ShellWindowControlSource::DeepLink, "/proposal/proposal-1").unwrap();

        assert_eq!(plan.label, "main");
        assert_eq!(plan.action, ShellWindowControlAction::ShowAndFocus);
        assert_eq!(plan.source, ShellWindowControlSource::DeepLink);
        assert_eq!(plan.route, Some("/proposal/proposal-1".to_string()));
        assert!(plan.focus);
    }

    #[test]
    fn command_names_match_the_tauri_runtime_entry() {
        assert_eq!(SHOW_MAIN_WINDOW_COMMAND, "show_main_window");
        assert_eq!(HIDE_MAIN_WINDOW_COMMAND, "hide_main_window");
        assert_eq!(FOCUS_MAIN_ROUTE_COMMAND, "focus_main_route");
        assert_eq!(SHOW_PET_WINDOW_COMMAND, "show_pet_window");
        assert_eq!(HIDE_PET_WINDOW_COMMAND, "hide_pet_window");
        assert_eq!(TOGGLE_PET_WINDOW_COMMAND, "toggle_pet_window");
    }

    #[test]
    fn pet_window_controls_do_not_steal_focus() {
        let show = show_pet_window(ShellWindowControlSource::CuuBubble);
        let toggle = toggle_pet_window(ShellWindowControlSource::Tray);

        assert_eq!(show.label, "pet");
        assert_eq!(show.action, ShellWindowControlAction::Show);
        assert_eq!(show.route, Some("/pet.html".to_string()));
        assert!(!show.focus);
        assert_eq!(toggle.action, ShellWindowControlAction::Toggle);
        assert!(!toggle.focus);
    }

    #[test]
    fn hidden_windows_do_not_carry_stale_routes() {
        let main = hide_main_window(ShellWindowControlSource::Tray);
        let pet = hide_pet_window(ShellWindowControlSource::Setting);

        assert_eq!(main.route, None);
        assert_eq!(pet.route, None);
        assert!(!main.focus);
        assert!(!pet.focus);
    }

    #[test]
    fn rejects_unsafe_deep_link_routes() {
        assert_eq!(
            focus_main_route(ShellWindowControlSource::DeepLink, "").unwrap_err(),
            ShellWindowControlError::EmptyRoute
        );
        assert_eq!(
            focus_main_route(ShellWindowControlSource::DeepLink, "https://evil.test").unwrap_err(),
            ShellWindowControlError::UnsafeRoute
        );
        assert_eq!(
            focus_main_route(ShellWindowControlSource::DeepLink, "/../settings").unwrap_err(),
            ShellWindowControlError::UnsafeRoute
        );
    }

    // S3-#6：只有真正的导航目标才广播 navigate。「把主窗显示出来」（托盘「打开 WorkHub」/全局热键/
    // dock reopen/工作台的「打开聚焦盒」按钮）带的 route 是根路径，广播它等于让 webview 复位聚焦盒，
    // 会把深链/托盘刚打开的能力洗掉。
    #[test]
    fn showing_the_main_window_is_not_a_navigation() {
        assert_eq!(
            shell_navigate_payload(&show_main_window(ShellWindowControlSource::Tray)),
            None
        );
        assert_eq!(
            shell_navigate_payload(&show_main_window(ShellWindowControlSource::Setting)),
            None
        );
        // hide 没有 route，同样不广播。
        assert_eq!(
            shell_navigate_payload(&hide_main_window(ShellWindowControlSource::Tray)),
            None
        );
        // 桌宠窗/工作台窗不消费 navigate 事件（工作台走 deep-link 通道）。
        assert_eq!(
            shell_navigate_payload(&show_pet_window(ShellWindowControlSource::CuuBubble)),
            None
        );
        assert_eq!(
            shell_navigate_payload(
                &focus_workbench_route(ShellWindowControlSource::DeepLink, "/workbench").unwrap()
            ),
            None
        );
    }

    #[test]
    fn deep_link_and_tray_routes_carry_a_structured_navigate_payload() {
        let deep_link =
            focus_main_route(ShellWindowControlSource::DeepLink, "/notifications").unwrap();
        let payload = shell_navigate_payload(&deep_link).expect("deep link should navigate");

        assert_eq!(payload.route, "/notifications");
        assert_eq!(payload.label, MAIN_WINDOW_LABEL);
        assert_eq!(payload.source, ShellWindowControlSource::DeepLink);
        assert_eq!(payload.reason, "focus-main-route");

        let tray = focus_main_route(ShellWindowControlSource::Tray, "/inbox").unwrap();
        let tray_payload = shell_navigate_payload(&tray).expect("tray should navigate");
        assert_eq!(tray_payload.route, "/inbox");
        assert_eq!(tray_payload.source, ShellWindowControlSource::Tray);
    }

    // webview（shell-events.ts parseDesktopShellNavigatePayload）按这些字段名读；改名即断链。
    #[test]
    fn navigate_payload_serializes_with_the_webview_field_names() {
        let payload = shell_navigate_payload(
            &focus_main_route(ShellWindowControlSource::SystemNotification, "/approvals").unwrap(),
        )
        .expect("notification route should navigate");
        let value = serde_json::to_value(&payload).expect("navigate payload should serialize");

        assert_eq!(value["route"], "/approvals");
        assert_eq!(value["label"], "main");
        assert_eq!(value["source"], "system_notification");
        assert_eq!(value["reason"], "focus-main-route");
    }

    #[test]
    fn main_window_label_matches_the_declared_window_plan() {
        assert_eq!(MAIN_WINDOW_LABEL, main_window_plan().label);
        assert_eq!(SHELL_ROOT_ROUTE, main_window_plan().route);
    }

    #[test]
    fn serializes_for_tauri_command_payloads() {
        let value = serde_json::to_value(show_main_window(ShellWindowControlSource::Startup))
            .expect("window control plan should serialize");

        assert_eq!(value["label"], "main");
        assert_eq!(value["action"], "show_and_focus");
        assert_eq!(value["source"], "startup");
        assert_eq!(value["route"], "/");
        assert_eq!(value["focus"], true);
    }
}
