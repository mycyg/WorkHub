use serde::{Deserialize, Serialize};

use crate::windows::{main_window_plan, pet_window_plan, ShellWindowPlan};

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
        assert_eq!(plan.focus, true);
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
        assert_eq!(show.route, Some("/".to_string()));
        assert_eq!(show.focus, false);
        assert_eq!(toggle.action, ShellWindowControlAction::Toggle);
        assert_eq!(toggle.focus, false);
    }

    #[test]
    fn hidden_windows_do_not_carry_stale_routes() {
        let main = hide_main_window(ShellWindowControlSource::Tray);
        let pet = hide_pet_window(ShellWindowControlSource::Setting);

        assert_eq!(main.route, None);
        assert_eq!(pet.route, None);
        assert_eq!(main.focus, false);
        assert_eq!(pet.focus, false);
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
