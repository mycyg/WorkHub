use serde::{Deserialize, Serialize};

use crate::deep_link::{deep_link_plan_from_url, ShellDeepLinkPlan};
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
    let mut deep_links = Vec::new();
    let mut rejected_deep_links = Vec::new();

    for arg in args {
        let trimmed = arg.trim();
        if !looks_like_workhub_deep_link(trimmed) {
            continue;
        }
        match deep_link_plan_from_url(trimmed) {
            Ok(plan) => deep_links.push(plan),
            Err(error) => rejected_deep_links.push(format!("{trimmed}: {error:?}")),
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
        let plan = single_instance_plan_from_args(
            &[
                "WorkHub.exe".to_string(),
                "workhub://open?route=https://evil.test".to_string(),
                "https://workhub.test/open/task/1".to_string(),
            ],
            "C:/WorkHub",
        );

        assert!(plan.deep_links.is_empty());
        assert_eq!(plan.rejected_deep_links.len(), 1);
        assert!(plan.rejected_deep_links[0].contains("https://evil.test"));
    }
}
