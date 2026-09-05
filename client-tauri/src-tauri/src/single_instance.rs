use serde::{Deserialize, Serialize};

use crate::deep_link::{deep_link_plan_from_url, describe_deep_link_error, ShellDeepLinkPlan};
use crate::locale::WorkHubLocale;
use crate::window_controls::{show_main_window, ShellWindowControlPlan, ShellWindowControlSource};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSingleInstancePlan {
    pub args: Vec<String>,
    pub cwd: String,
    pub window_control: ShellWindowControlPlan,
    pub deep_links: Vec<ShellDeepLinkPlan>,
    pub rejected_deep_links: Vec<String>,
}

pub fn single_instance_plan_from_args(args: &[String], cwd: &str) -> ShellSingleInstancePlan {
    single_instance_plan_from_args_for_locale(args, cwd, WorkHubLocale::default())
}

pub fn single_instance_plan_from_args_for_locale(
    args: &[String],
    cwd: &str,
    locale: WorkHubLocale,
) -> ShellSingleInstancePlan {
    let mut deep_links = Vec::new();
    let mut rejected_deep_links = Vec::new();

    for arg in args {
        let trimmed = arg.trim();
        if !looks_like_workhub_deep_link(trimmed) {
            continue;
        }
        match deep_link_plan_from_url(trimmed) {
            Ok(plan) => deep_links.push(plan),
            Err(error) => rejected_deep_links.push(format!(
                "{trimmed}: {}",
                describe_deep_link_error(&error, locale)
            )),
        }
    }

    ShellSingleInstancePlan {
        args: args.to_vec(),
        cwd: cwd.to_string(),
        window_control: show_main_window(ShellWindowControlSource::Startup),
        deep_links,
        rejected_deep_links,
    }
}

fn looks_like_workhub_deep_link(arg: &str) -> bool {
    let lower = arg.to_ascii_lowercase();
    lower.starts_with("workhub://") || lower.starts_with("yqgl://")
}

#[cfg(test)]
mod tests {
    use crate::window_controls::{shell_navigate_payload, MAIN_WINDOW_LABEL};

    use super::*;

    #[test]
    fn second_launch_without_deep_link_focuses_the_main_window() {
        let plan = single_instance_plan_from_args(
            &[
                "WorkHub.exe".to_string(),
                "--flag-from-os-shell".to_string(),
            ],
            "C:/Users/mycyg",
        );

        assert!(plan.deep_links.is_empty());
        assert!(plan.rejected_deep_links.is_empty());
        assert_eq!(plan.window_control.label, "main");
        assert_eq!(plan.window_control.route, Some("/".to_string()));
        assert_eq!(plan.cwd, "C:/Users/mycyg");
    }

    #[test]
    fn second_launch_extracts_workhub_and_legacy_deep_links() {
        let plan = single_instance_plan_from_args(
            &[
                "WorkHub.exe".to_string(),
                "workhub://open/proposal/proposal-1".to_string(),
                "yqgl://r/REQ-42".to_string(),
            ],
            "C:/WorkHub",
        );

        assert_eq!(plan.deep_links.len(), 2);
        assert_eq!(plan.deep_links[0].route, "/proposals/proposal-1");
        assert_eq!(plan.deep_links[1].route, "/r/REQ-42");
        assert!(plan.rejected_deep_links.is_empty());
    }

    #[test]
    fn malformed_workhub_deep_links_are_kept_for_diagnostics() {
        let plan = single_instance_plan_from_args_for_locale(
            &[
                "WorkHub.exe".to_string(),
                "workhub://open?route=https://evil.test".to_string(),
                "https://workhub.test/open/task/1".to_string(),
            ],
            "C:/WorkHub",
            WorkHubLocale::EnUs,
        );

        assert!(plan.deep_links.is_empty());
        assert_eq!(plan.rejected_deep_links.len(), 1);
        assert!(plan.rejected_deep_links[0].contains("Unsafe open target"));
        assert!(plan.rejected_deep_links[0].contains("https://evil.test"));
    }

    // S5-N-04 根因锁（macOS）：第二实例的交接**只带得动 argv**。macOS 上 `open workhub://…` 的 URL
    // 是 Apple Event（`application:openURLs:`），从来不进 argv——所以当 LaunchServices 把 URL 交给了
    // 另一份注册的 WorkHub.app 时（同 bundle id 的多份副本：DMG 还挂着 / 装了两处 / 开发构建），
    // 那个第二进程会被 tauri-plugin-single-instance 在插件 setup 里 `process::exit(0)` 掐掉，
    // URL 随它一起消失，主实例只收到一条"没有深链的 argv"。
    //
    // 此时唯一还成立的语义是「把主窗显示出来」，而显示窗口**不是导航**——所以这条交接绝不能广播
    // navigate（广播 `/` 会把用户正开着的能力洗成 idle 搜索条，即 S3-#6 的原始现场）。
    #[test]
    fn a_macos_second_instance_handoff_carries_no_deep_link_and_never_navigates() {
        let plan = single_instance_plan_from_args(
            &["/Applications/WorkHub.app/Contents/MacOS/workhub-client-tauri".to_string()],
            "/",
        );

        assert!(
            plan.deep_links.is_empty(),
            "macOS 的深链不在 argv 里，交接必然无深链"
        );
        assert!(plan.rejected_deep_links.is_empty());
        assert_eq!(plan.window_control.label, MAIN_WINDOW_LABEL);
        assert_eq!(plan.window_control.reason, "show-main");
        assert_eq!(
            shell_navigate_payload(&plan.window_control),
            None,
            "显示窗口不是导航：这条交接绝不能复位聚焦盒"
        );
    }

    #[test]
    fn rejected_deep_link_diagnostics_follow_locale_but_keep_raw_url() {
        let plan = single_instance_plan_from_args_for_locale(
            &[
                "WorkHub.exe".to_string(),
                "workhub://open?route=https://evil.test".to_string(),
            ],
            "C:/WorkHub",
            WorkHubLocale::ZhCn,
        );

        assert_eq!(plan.rejected_deep_links.len(), 1);
        assert!(plan.rejected_deep_links[0].contains("不安全的打开目标"));
        assert!(plan.rejected_deep_links[0].contains("https://evil.test"));
    }
}
