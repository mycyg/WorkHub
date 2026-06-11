use serde::{Deserialize, Serialize};

use crate::locale::WorkHubLocale;
use crate::window_controls::{
    focus_main_route, hide_main_window, show_main_window, show_pet_window, toggle_pet_window,
    ShellWindowControlPlan, ShellWindowControlSource,
};

pub const WORKHUB_TRAY_ID: &str = "workhub-main-tray";
pub const WORKHUB_TRAY_TOOLTIP: &str = "WorkHub - Cuu 已就绪";
pub const WORKHUB_TRAY_TOOLTIP_EN: &str = "WorkHub - Cuu is ready";

pub const TRAY_SHOW_MAIN_ID: &str = "show-main";
pub const TRAY_HIDE_MAIN_ID: &str = "hide-main";
pub const TRAY_TOGGLE_PET_ID: &str = "toggle-pet";
pub const TRAY_RESTORE_PET_INTERACTION_ID: &str = "restore-pet-interaction";
pub const TRAY_OPEN_INBOX_ID: &str = "open-inbox";
pub const TRAY_OPEN_SETTINGS_ID: &str = "open-settings";
pub const TRAY_QUIT_ID: &str = "quit";

pub const MAIN_TRAY_FOCUS_ROUTE: &str = "/";
pub const INBOX_TRAY_ROUTE: &str = "/inbox";
pub const SETTINGS_TRAY_ROUTE: &str = "/settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrayMenuActionKind {
    ShowMain,
    HideMain,
    TogglePet,
    RestorePetInteraction,
    OpenInbox,
    OpenSettings,
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
    tray_menu_items(WorkHubLocale::default())
}

pub fn tray_menu_items(locale: WorkHubLocale) -> Vec<TrayMenuActionPlan> {
    vec![
        tray_menu_action_plan(
            TRAY_SHOW_MAIN_ID,
            tray_label(locale, TrayMenuActionKind::ShowMain),
            TrayMenuActionKind::ShowMain,
        ),
        tray_menu_action_plan(
            TRAY_HIDE_MAIN_ID,
            tray_label(locale, TrayMenuActionKind::HideMain),
            TrayMenuActionKind::HideMain,
        ),
        tray_menu_action_plan(
            TRAY_TOGGLE_PET_ID,
            tray_label(locale, TrayMenuActionKind::TogglePet),
            TrayMenuActionKind::TogglePet,
        ),
        tray_menu_action_plan(
            TRAY_RESTORE_PET_INTERACTION_ID,
            tray_label(locale, TrayMenuActionKind::RestorePetInteraction),
            TrayMenuActionKind::RestorePetInteraction,
        ),
        tray_menu_action_plan(
            TRAY_OPEN_INBOX_ID,
            tray_label(locale, TrayMenuActionKind::OpenInbox),
            TrayMenuActionKind::OpenInbox,
        ),
        tray_menu_action_plan(
            TRAY_OPEN_SETTINGS_ID,
            tray_label(locale, TrayMenuActionKind::OpenSettings),
            TrayMenuActionKind::OpenSettings,
        ),
        tray_menu_action_plan(
            TRAY_QUIT_ID,
            tray_label(locale, TrayMenuActionKind::Quit),
            TrayMenuActionKind::Quit,
        ),
    ]
}

pub fn tray_menu_action_plan_by_id(id: &str) -> Option<TrayMenuActionPlan> {
    tray_menu_action_plan_by_id_for_locale(id, WorkHubLocale::default())
}

pub fn tray_menu_action_plan_by_id_for_locale(
    id: &str,
    locale: WorkHubLocale,
) -> Option<TrayMenuActionPlan> {
    tray_menu_items(locale)
        .into_iter()
        .find(|item| item.id == id)
}

pub fn tray_tooltip(locale: WorkHubLocale) -> &'static str {
    match locale {
        WorkHubLocale::ZhCn => WORKHUB_TRAY_TOOLTIP,
        WorkHubLocale::EnUs => WORKHUB_TRAY_TOOLTIP_EN,
    }
}

fn tray_label(locale: WorkHubLocale, kind: TrayMenuActionKind) -> &'static str {
    match (locale, kind) {
        (WorkHubLocale::ZhCn, TrayMenuActionKind::ShowMain) => "打开 WorkHub",
        (WorkHubLocale::ZhCn, TrayMenuActionKind::HideMain) => "隐藏主窗",
        (WorkHubLocale::ZhCn, TrayMenuActionKind::TogglePet) => "显示/隐藏 Cuu",
        (WorkHubLocale::ZhCn, TrayMenuActionKind::RestorePetInteraction) => "恢复 Cuu 交互",
        (WorkHubLocale::ZhCn, TrayMenuActionKind::OpenInbox) => "打开收件箱",
        (WorkHubLocale::ZhCn, TrayMenuActionKind::OpenSettings) => "设置",
        (WorkHubLocale::ZhCn, TrayMenuActionKind::Quit) => "退出 WorkHub",
        (WorkHubLocale::EnUs, TrayMenuActionKind::ShowMain) => "Open WorkHub",
        (WorkHubLocale::EnUs, TrayMenuActionKind::HideMain) => "Hide main window",
        (WorkHubLocale::EnUs, TrayMenuActionKind::TogglePet) => "Show / hide Cuu",
        (WorkHubLocale::EnUs, TrayMenuActionKind::RestorePetInteraction) => {
            "Restore Cuu interaction"
        }
        (WorkHubLocale::EnUs, TrayMenuActionKind::OpenInbox) => "Open inbox",
        (WorkHubLocale::EnUs, TrayMenuActionKind::OpenSettings) => "Settings",
        (WorkHubLocale::EnUs, TrayMenuActionKind::Quit) => "Quit WorkHub",
    }
}

fn tray_menu_action_plan(id: &str, label: &str, kind: TrayMenuActionKind) -> TrayMenuActionPlan {
    let window_control = match kind {
        TrayMenuActionKind::ShowMain => Some(show_main_window(ShellWindowControlSource::Tray)),
        TrayMenuActionKind::HideMain => Some(hide_main_window(ShellWindowControlSource::Tray)),
        TrayMenuActionKind::TogglePet => Some(toggle_pet_window(ShellWindowControlSource::Tray)),
        TrayMenuActionKind::RestorePetInteraction => {
            Some(show_pet_window(ShellWindowControlSource::Tray))
        }
        TrayMenuActionKind::OpenInbox => {
            focus_main_route(ShellWindowControlSource::Tray, INBOX_TRAY_ROUTE).ok()
        }
        TrayMenuActionKind::OpenSettings => {
            focus_main_route(ShellWindowControlSource::Tray, SETTINGS_TRAY_ROUTE).ok()
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
        assert_eq!(tray_tooltip(WorkHubLocale::ZhCn), "WorkHub - Cuu 已就绪");
        assert_eq!(tray_tooltip(WorkHubLocale::EnUs), "WorkHub - Cuu is ready");

        let items = default_tray_menu_items();
        let ids = items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(items.len(), 7);
        assert_eq!(ids.len(), items.len());
        assert!(ids.contains(TRAY_SHOW_MAIN_ID));
        assert!(ids.contains(TRAY_HIDE_MAIN_ID));
        assert!(ids.contains(TRAY_TOGGLE_PET_ID));
        assert!(ids.contains(TRAY_RESTORE_PET_INTERACTION_ID));
        assert!(ids.contains(TRAY_OPEN_INBOX_ID));
        assert!(ids.contains(TRAY_OPEN_SETTINGS_ID));
        assert!(ids.contains(TRAY_QUIT_ID));
    }

    #[test]
    fn localizes_user_visible_tray_labels_without_changing_ids() {
        let zh = tray_menu_items(WorkHubLocale::ZhCn);
        let en = tray_menu_items(WorkHubLocale::EnUs);

        assert_eq!(zh[0].id, en[0].id);
        assert_eq!(zh[0].label, "打开 WorkHub");
        assert_eq!(en[0].label, "Open WorkHub");
        assert_eq!(
            tray_menu_action_plan_by_id_for_locale(
                TRAY_RESTORE_PET_INTERACTION_ID,
                WorkHubLocale::ZhCn
            )
            .unwrap()
            .label,
            "恢复 Cuu 交互"
        );
        assert_eq!(
            tray_menu_action_plan_by_id_for_locale(
                TRAY_RESTORE_PET_INTERACTION_ID,
                WorkHubLocale::EnUs
            )
            .unwrap()
            .label,
            "Restore Cuu interaction"
        );
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
        assert_eq!(toggle_control.route, Some("/pet.html".to_string()));
        assert_eq!(toggle_control.focus, false);
    }

    #[test]
    fn restore_pet_interaction_shows_cuu_without_stealing_focus() {
        let plan = tray_menu_action_plan_by_id(TRAY_RESTORE_PET_INTERACTION_ID).unwrap();
        let control = plan.window_control.unwrap();

        assert_eq!(plan.kind, TrayMenuActionKind::RestorePetInteraction);
        assert_eq!(control.label, "pet");
        assert_eq!(control.action, ShellWindowControlAction::Show);
        assert_eq!(control.source, ShellWindowControlSource::Tray);
        assert_eq!(control.route, Some("/pet.html".to_string()));
        assert_eq!(control.focus, false);
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
    fn opens_settings_through_a_safe_main_route() {
        let plan = tray_menu_action_plan_by_id(TRAY_OPEN_SETTINGS_ID).unwrap();
        let control = plan.window_control.unwrap();

        assert_eq!(control.label, "main");
        assert_eq!(control.action, ShellWindowControlAction::ShowAndFocus);
        assert_eq!(control.source, ShellWindowControlSource::Tray);
        assert_eq!(control.route, Some(SETTINGS_TRAY_ROUTE.to_string()));
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
