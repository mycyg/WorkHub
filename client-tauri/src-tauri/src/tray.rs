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
// R13 批 V2：托盘加「打开工作台」。这个动作不走 ShellWindowControlPlan/execute_window_control
// 那套通用窗口控制（那套假定窗口已存在，`focus_main_route` 也只认 main 窗的 `/`-前缀前端路由）——
// workbench 窗是 create:false 按需建（create_workbench_window_if_missing），且真正的"打开工作台"
// 语义（无参数=复用上次选中项目/前端默认态）已经由 `open_workbench` 这个 tauri::command 定义好了，
// 就是深链 `workhub://workbench` 的同一条管线。所以这个 kind 的 window_control 留空（同 Quit 的先例），
// main.rs 的 handle_tray_action 特判这个 id 直接调 open_workbench(app, None, None)。
pub const TRAY_OPEN_WORKBENCH_ID: &str = "open-workbench";
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
    OpenWorkbench,
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
            TRAY_OPEN_WORKBENCH_ID,
            tray_label(locale, TrayMenuActionKind::OpenWorkbench),
            TrayMenuActionKind::OpenWorkbench,
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

/// R15 批 A6（托盘/Dock 角标）：托盘 tooltip 带上「待处理」计数——0 时回到基线 tooltip（Cuu 已就绪），
/// 让「有待办/未读」在托盘悬停时也可见。纯函数，可单测。
pub fn tray_tooltip_with_badge(locale: WorkHubLocale, badge_count: u32) -> String {
    if badge_count == 0 {
        return tray_tooltip(locale).to_string();
    }
    match locale {
        WorkHubLocale::ZhCn => format!("WorkHub · {badge_count} 项待处理"),
        WorkHubLocale::EnUs => format!("WorkHub · {badge_count} pending"),
    }
}

/// R15 批 A6：Dock 角标计数归一——正数才显示，<=0 清空（None）。macOS 上 set_badge_count(None) 清 dock
/// 角标（tauri-runtime-wry 把 count 映射到 NSApp.dockTile.badgeLabel）。纯函数，可单测。
pub fn shell_badge_count(raw: i64) -> Option<i64> {
    if raw > 0 {
        Some(raw)
    } else {
        None
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
        (WorkHubLocale::ZhCn, TrayMenuActionKind::OpenWorkbench) => "打开工作台",
        (WorkHubLocale::ZhCn, TrayMenuActionKind::Quit) => "退出 WorkHub",
        (WorkHubLocale::EnUs, TrayMenuActionKind::ShowMain) => "Open WorkHub",
        (WorkHubLocale::EnUs, TrayMenuActionKind::HideMain) => "Hide main window",
        (WorkHubLocale::EnUs, TrayMenuActionKind::TogglePet) => "Show / hide Cuu",
        (WorkHubLocale::EnUs, TrayMenuActionKind::RestorePetInteraction) => {
            "Restore Cuu interaction"
        }
        (WorkHubLocale::EnUs, TrayMenuActionKind::OpenInbox) => "Open inbox",
        (WorkHubLocale::EnUs, TrayMenuActionKind::OpenSettings) => "Settings",
        (WorkHubLocale::EnUs, TrayMenuActionKind::OpenWorkbench) => "Open workbench",
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
        // 特判在 main.rs 的 handle_tray_action：直接调 open_workbench(app, None, None)，
        // 不走通用 window_control（见上面 TRAY_OPEN_WORKBENCH_ID 的注释）。
        TrayMenuActionKind::OpenWorkbench => None,
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
    fn tray_tooltip_with_badge_shows_pending_count_and_falls_back_to_baseline_at_zero() {
        assert_eq!(
            tray_tooltip_with_badge(WorkHubLocale::ZhCn, 0),
            "WorkHub - Cuu 已就绪"
        );
        assert_eq!(
            tray_tooltip_with_badge(WorkHubLocale::EnUs, 0),
            "WorkHub - Cuu is ready"
        );
        assert_eq!(
            tray_tooltip_with_badge(WorkHubLocale::ZhCn, 3),
            "WorkHub · 3 项待处理"
        );
        assert_eq!(
            tray_tooltip_with_badge(WorkHubLocale::EnUs, 3),
            "WorkHub · 3 pending"
        );
    }

    #[test]
    fn shell_badge_count_only_shows_positive_counts() {
        assert_eq!(shell_badge_count(0), None);
        assert_eq!(shell_badge_count(-2), None);
        assert_eq!(shell_badge_count(5), Some(5));
    }

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

        assert_eq!(items.len(), 8);
        assert_eq!(ids.len(), items.len());
        assert!(ids.contains(TRAY_SHOW_MAIN_ID));
        assert!(ids.contains(TRAY_HIDE_MAIN_ID));
        assert!(ids.contains(TRAY_TOGGLE_PET_ID));
        assert!(ids.contains(TRAY_RESTORE_PET_INTERACTION_ID));
        assert!(ids.contains(TRAY_OPEN_INBOX_ID));
        assert!(ids.contains(TRAY_OPEN_SETTINGS_ID));
        assert!(ids.contains(TRAY_OPEN_WORKBENCH_ID));
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
        assert!(!toggle_control.focus);
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
        assert!(!control.focus);
    }

    #[test]
    fn opens_inbox_through_a_safe_main_route() {
        let plan = tray_menu_action_plan_by_id(TRAY_OPEN_INBOX_ID).unwrap();
        let control = plan.window_control.unwrap();

        assert_eq!(control.label, "main");
        assert_eq!(control.action, ShellWindowControlAction::ShowAndFocus);
        assert_eq!(control.source, ShellWindowControlSource::Tray);
        assert_eq!(control.route, Some(INBOX_TRAY_ROUTE.to_string()));
        assert!(control.focus);
    }

    #[test]
    fn opens_settings_through_a_safe_main_route() {
        let plan = tray_menu_action_plan_by_id(TRAY_OPEN_SETTINGS_ID).unwrap();
        let control = plan.window_control.unwrap();

        assert_eq!(control.label, "main");
        assert_eq!(control.action, ShellWindowControlAction::ShowAndFocus);
        assert_eq!(control.source, ShellWindowControlSource::Tray);
        assert_eq!(control.route, Some(SETTINGS_TRAY_ROUTE.to_string()));
        assert!(control.focus);
    }

    #[test]
    fn quit_action_does_not_claim_business_window_control() {
        let plan = tray_menu_action_plan_by_id(TRAY_QUIT_ID).unwrap();

        assert_eq!(plan.kind, TrayMenuActionKind::Quit);
        assert!(plan.exits_app);
        assert_eq!(plan.window_control, None);
    }

    // R13 批 V2：托盘「打开工作台」不走通用 ShellWindowControlPlan（workbench 窗按需建、
    // open_workbench 自己的深链管线才知道怎么处理"无参数"），main.rs 的 handle_tray_action 特判这个
    // id 直接调 open_workbench(app, None, None)——这里只锁住 id/label/kind 契约不漂移，不锁具体调用
    // （那部分只能在 main.rs 里用集成测试或真机验）。
    #[test]
    fn open_workbench_action_claims_no_generic_window_control_and_does_not_exit_the_app() {
        let plan = tray_menu_action_plan_by_id(TRAY_OPEN_WORKBENCH_ID).unwrap();

        assert_eq!(plan.kind, TrayMenuActionKind::OpenWorkbench);
        assert_eq!(plan.window_control, None);
        assert!(!plan.exits_app);
        assert_eq!(
            tray_menu_action_plan_by_id_for_locale(TRAY_OPEN_WORKBENCH_ID, WorkHubLocale::ZhCn)
                .unwrap()
                .label,
            "打开工作台"
        );
        assert_eq!(
            tray_menu_action_plan_by_id_for_locale(TRAY_OPEN_WORKBENCH_ID, WorkHubLocale::EnUs)
                .unwrap()
                .label,
            "Open workbench"
        );
    }
}
