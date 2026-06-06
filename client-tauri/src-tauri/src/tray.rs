use serde::{Deserialize, Serialize};

use crate::window_controls::{
    focus_main_route, hide_main_window, show_main_window, toggle_pet_window,
    ShellWindowControlPlan, ShellWindowControlSource,
};

pub const WORKHUB_TRAY_ID: &str = "workhub-main-tray";
pub const WORKHUB_TRAY_TOOLTIP: &str = "WorkHub - Cuu is ready";

pub const TRAY_SHOW_MAIN_ID: &str = "show-main";
pub const TRAY_HIDE_MAIN_ID: &str = "hide-main";
pub const TRAY_TOGGLE_PET_ID: &str = "toggle-pet";
pub const TRAY_OPEN_INBOX_ID: &str = "open-inbox";
pub const TRAY_QUIT_ID: &str = "quit";

pub const MAIN_TRAY_FOCUS_ROUTE: &str = "/";
pub const INBOX_TRAY_ROUTE: &str = "/inbox";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrayMenuActionKind {
    ShowMain,
    HideMain,
    TogglePet,
    OpenInbox,
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuActionPlan {
    pub id: String,
    pub label: String,
    pub kind: TrayMenuActionKind,
    pub window_control: Option<ShellWindowControlPlan>,
    pub exits_app: bool,
}

pub fn default_tray_menu_items() -> Vec<TrayMenuActionPlan> {
    vec![
        tray_menu_action_plan(
            TRAY_SHOW_MAIN_ID,
            "Open WorkHub",
            TrayMenuActionKind::ShowMain,
        ),
        tray_menu_action_plan(
            TRAY_HIDE_MAIN_ID,
            "Hide main window",
            TrayMenuActionKind::HideMain,
        ),
        tray_menu_action_plan(
            TRAY_TOGGLE_PET_ID,
            "Show / hide Cuu",
            TrayMenuActionKind::TogglePet,
        ),
        tray_menu_action_plan(
            TRAY_OPEN_INBOX_ID,
            "Open inbox",
            TrayMenuActionKind::OpenInbox,
        ),
        tray_menu_action_plan(TRAY_QUIT_ID, "Quit WorkHub", TrayMenuActionKind::Quit),
    ]
}

pub fn tray_menu_action_plan_by_id(id: &str) -> Option<TrayMenuActionPlan> {
    default_tray_menu_items()
        .into_iter()
        .find(|item| item.id == id)
}

fn tray_menu_action_plan(id: &str, label: &str, kind: TrayMenuActionKind) -> TrayMenuActionPlan {
    let window_control = match kind {
        TrayMenuActionKind::ShowMain => Some(show_main_window(ShellWindowControlSource::Tray)),
        TrayMenuActionKind::HideMain => Some(hide_main_window(ShellWindowControlSource::Tray)),
        TrayMenuActionKind::TogglePet => Some(toggle_pet_window(ShellWindowControlSource::Tray)),
        TrayMenuActionKind::OpenInbox => {
            focus_main_route(ShellWindowControlSource::Tray, INBOX_TRAY_ROUTE).ok()
        }
        TrayMenuActionKind::Quit => None,
    };

    TrayMenuActionPlan {
        id: id.to_string(),
        label: label.to_string(),
        kind,
        window_control,
        exits_app: matches!(kind, TrayMenuActionKind::Quit),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::window_controls::ShellWindowControlAction;
    use std::collections::HashSet;

    #[test]
    fn keeps_tray_ids_stable_and_unique() {
        assert_eq!(WORKHUB_TRAY_ID, "workhub-main-tray");
        assert_eq!(WORKHUB_TRAY_TOOLTIP, "WorkHub - Cuu is ready");

        let items = default_tray_menu_items();
        let ids = items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(items.len(), 5);
        assert_eq!(ids.len(), items.len());
        assert!(ids.contains(TRAY_SHOW_MAIN_ID));
        assert!(ids.contains(TRAY_HIDE_MAIN_ID));
        assert!(ids.contains(TRAY_TOGGLE_PET_ID));
        assert!(ids.contains(TRAY_OPEN_INBOX_ID));
        assert!(ids.contains(TRAY_QUIT_ID));
    }

    #[test]
    fn maps_tray_window_actions_to_existing_window_control_contract() {
        let show = tray_menu_action_plan_by_id(TRAY_SHOW_MAIN_ID).unwrap();
        let hide = tray_menu_action_plan_by_id(TRAY_HIDE_MAIN_ID).unwrap();
        let toggle = tray_menu_action_plan_by_id(TRAY_TOGGLE_PET_ID).unwrap();

        let show_control = show.window_control.unwrap();
        assert_eq!(show_control.label, "main");
        assert_eq!(show_control.action, ShellWindowControlAction::ShowAndFocus);
        assert_eq!(show_control.source, ShellWindowControlSource::Tray);
        assert_eq!(show_control.route, Some(MAIN_TRAY_FOCUS_ROUTE.to_string()));

        let hide_control = hide.window_control.unwrap();
        assert_eq!(hide_control.label, "main");
        assert_eq!(hide_control.action, ShellWindowControlAction::Hide);
        assert_eq!(hide_control.source, ShellWindowControlSource::Tray);
        assert_eq!(hide_control.route, None);

        let toggle_control = toggle.window_control.unwrap();
        assert_eq!(toggle_control.label, "pet");
        assert_eq!(toggle_control.action, ShellWindowControlAction::Toggle);
        assert_eq!(toggle_control.source, ShellWindowControlSource::Tray);
        assert_eq!(toggle_control.route, Some("/?surface=pet".to_string()));
        assert_eq!(toggle_control.focus, false);
    }

    #[test]
    fn opens_inbox_through_a_safe_main_route() {
        let plan = tray_menu_action_plan_by_id(TRAY_OPEN_INBOX_ID).unwrap();
        let control = plan.window_control.unwrap();

        assert_eq!(control.label, "main");
        assert_eq!(control.action, ShellWindowControlAction::ShowAndFocus);
        assert_eq!(control.source, ShellWindowControlSource::Tray);
        assert_eq!(control.route, Some(INBOX_TRAY_ROUTE.to_string()));
        assert_eq!(control.focus, true);
    }

    #[test]
    fn quit_action_does_not_claim_business_window_control() {
        let plan = tray_menu_action_plan_by_id(TRAY_QUIT_ID).unwrap();

        assert_eq!(plan.kind, TrayMenuActionKind::Quit);
        assert!(plan.exits_app);
        assert_eq!(plan.window_control, None);
    }
}
