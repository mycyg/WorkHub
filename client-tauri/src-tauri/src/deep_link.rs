use serde::{Deserialize, Serialize};
use url::Url;

use crate::locale::WorkHubLocale;
use crate::window_controls::{
    focus_main_route, ShellWindowControlError, ShellWindowControlPlan, ShellWindowControlSource,
};

pub const WORKHUB_DEEP_LINK_SCHEME: &str = "workhub";
pub const LEGACY_DEEP_LINK_SCHEME: &str = "yqgl";
pub const DEEP_LINK_SCHEMES: &[&str] = &[WORKHUB_DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEME];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellDeepLinkPlan {
    pub raw_url: String,
    pub scheme: String,
    pub route: String,
    pub window_control: ShellWindowControlPlan,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellDeepLinkError {
    InvalidUrl,
    UnsupportedScheme(String),
    MissingTarget,
    UnknownTarget(String),
    UnsafeTarget(String),
    UnsafeRoute(ShellWindowControlError),
}

pub fn deep_link_plan_from_url(raw_url: &str) -> Result<ShellDeepLinkPlan, ShellDeepLinkError> {
    reject_raw_path_traversal(raw_url)?;
    let url = Url::parse(raw_url).map_err(|_| ShellDeepLinkError::InvalidUrl)?;
    let scheme = url.scheme().to_ascii_lowercase();
    if !DEEP_LINK_SCHEMES.contains(&scheme.as_str()) {
        return Err(ShellDeepLinkError::UnsupportedScheme(scheme));
    }

    let route = route_from_deep_link(&url)?;
    let window_control = focus_main_route(ShellWindowControlSource::DeepLink, &route)
        .map_err(ShellDeepLinkError::UnsafeRoute)?;

    Ok(ShellDeepLinkPlan {
        raw_url: raw_url.to_string(),
        scheme,
        route,
        window_control,
    })
}

pub fn describe_deep_link_error(error: &ShellDeepLinkError, locale: WorkHubLocale) -> String {
    match (locale, error) {
        (WorkHubLocale::ZhCn, ShellDeepLinkError::InvalidUrl) => "链接格式无效".to_string(),
        (WorkHubLocale::ZhCn, ShellDeepLinkError::UnsupportedScheme(scheme)) => {
            format!("不支持的链接协议: {scheme}")
        }
        (WorkHubLocale::ZhCn, ShellDeepLinkError::MissingTarget) => "缺少打开目标".to_string(),
        (WorkHubLocale::ZhCn, ShellDeepLinkError::UnknownTarget(target)) => {
            format!("未知打开目标: {target}")
        }
        (WorkHubLocale::ZhCn, ShellDeepLinkError::UnsafeTarget(target)) => {
            format!("不安全的打开目标: {target}")
        }
        (WorkHubLocale::ZhCn, ShellDeepLinkError::UnsafeRoute(error)) => {
            format!(
                "不安全的主窗路由: {}",
                describe_window_control_error(error, locale)
            )
        }
        (WorkHubLocale::EnUs, ShellDeepLinkError::InvalidUrl) => "Invalid URL".to_string(),
        (WorkHubLocale::EnUs, ShellDeepLinkError::UnsupportedScheme(scheme)) => {
            format!("Unsupported link scheme: {scheme}")
        }
        (WorkHubLocale::EnUs, ShellDeepLinkError::MissingTarget) => {
            "Missing open target".to_string()
        }
        (WorkHubLocale::EnUs, ShellDeepLinkError::UnknownTarget(target)) => {
            format!("Unknown open target: {target}")
        }
        (WorkHubLocale::EnUs, ShellDeepLinkError::UnsafeTarget(target)) => {
            format!("Unsafe open target: {target}")
        }
        (WorkHubLocale::EnUs, ShellDeepLinkError::UnsafeRoute(error)) => {
            format!(
                "Unsafe main route: {}",
                describe_window_control_error(error, locale)
            )
        }
    }
}

fn describe_window_control_error(
    error: &ShellWindowControlError,
    locale: WorkHubLocale,
) -> &'static str {
    match (locale, error) {
        (WorkHubLocale::ZhCn, ShellWindowControlError::EmptyRoute) => "路由为空",
        (WorkHubLocale::ZhCn, ShellWindowControlError::UnsafeRoute) => "路由不安全",
        (WorkHubLocale::EnUs, ShellWindowControlError::EmptyRoute) => "empty route",
        (WorkHubLocale::EnUs, ShellWindowControlError::UnsafeRoute) => "unsafe route",
    }
}

fn reject_raw_path_traversal(raw_url: &str) -> Result<(), ShellDeepLinkError> {
    let lower = raw_url.to_ascii_lowercase();
    if lower.contains("/../") || lower.ends_with("/..") {
        return Err(ShellDeepLinkError::UnsafeTarget("..".to_string()));
    }
    if lower.contains("/./") || lower.ends_with("/.") {
        return Err(ShellDeepLinkError::UnsafeTarget(".".to_string()));
    }
    if lower.contains("%2e") {
        return Err(ShellDeepLinkError::UnsafeTarget("%2e".to_string()));
    }
    Ok(())
}

fn route_from_deep_link(url: &Url) -> Result<String, ShellDeepLinkError> {
    if let Some(route) = route_query_value(url) {
        return checked_direct_route(&route);
    }

    let host = url.host_str().unwrap_or("").trim();
    let path_segments = path_segments(url);

    if host.eq_ignore_ascii_case("open") {
        return route_from_open_segments(&path_segments);
    }

    let mut target_segments = Vec::new();
    if !host.is_empty() {
        target_segments.push(host.to_string());
    }
    target_segments.extend(path_segments);
    route_from_target_segments(&target_segments)
}

fn route_query_value(url: &Url) -> Option<String> {
    url.query_pairs()
        .find_map(|(key, value)| (key == "route").then(|| value.to_string()))
}

fn path_segments(url: &Url) -> Vec<String> {
    url.path_segments()
        .map(|segments| {
            segments
                .filter(|segment| !segment.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn route_from_open_segments(segments: &[String]) -> Result<String, ShellDeepLinkError> {
    let kind = segments
        .first()
        .ok_or(ShellDeepLinkError::MissingTarget)?
        .to_ascii_lowercase();

    match kind.as_str() {
        "task" | "workitem" | "workitems" => route_with_id("/workitems", segments.get(1)),
        "r" | "requirement" | "requirements" => route_with_id("/r", segments.get(1)),
        "proposal" | "proposals" => route_with_id("/proposals", segments.get(1)),
        "p" | "project" | "projects" => route_with_optional_id("/p", segments.get(1)),
        "run" | "agent-run" | "agent_run" => {
            let id = safe_segment(segments.get(1).ok_or(ShellDeepLinkError::MissingTarget)?)?;
            Ok(format!("/agent-runs/{id}/replay"))
        }
        "approval" => route_with_query_id("/approvals", "approvalId", segments.get(1)),
        "approvals" => Ok("/approvals".to_string()),
        "session" | "intake" => route_with_id("/intake", segments.get(1)),
        "inbox" => Ok("/inbox".to_string()),
        "notifications" => Ok("/notifications".to_string()),
        "settings" => Ok("/settings".to_string()),
        "me" => Ok("/me".to_string()),
        "cost" | "budget" => Ok("/dashboard/cost".to_string()),
        other => Err(ShellDeepLinkError::UnknownTarget(other.to_string())),
    }
}

fn route_from_target_segments(segments: &[String]) -> Result<String, ShellDeepLinkError> {
    let kind = segments
        .first()
        .ok_or(ShellDeepLinkError::MissingTarget)?
        .to_ascii_lowercase();

    match kind.as_str() {
        "r" => route_with_id("/r", segments.get(1)),
        "p" => route_with_optional_id("/p", segments.get(1)),
        "task" | "workitem" | "workitems" => route_with_id("/workitems", segments.get(1)),
        "proposal" | "proposals" => route_with_id("/proposals", segments.get(1)),
        "run" | "agent-run" | "agent_run" => {
            let id = safe_segment(segments.get(1).ok_or(ShellDeepLinkError::MissingTarget)?)?;
            Ok(format!("/agent-runs/{id}/replay"))
        }
        "approval" => route_with_query_id("/approvals", "approvalId", segments.get(1)),
        "approvals" => Ok("/approvals".to_string()),
        "session" | "intake" => route_with_id("/intake", segments.get(1)),
        "inbox" => Ok("/inbox".to_string()),
        "notifications" => Ok("/notifications".to_string()),
        "settings" => Ok("/settings".to_string()),
        "me" => Ok("/me".to_string()),
        "cost" | "budget" => Ok("/dashboard/cost".to_string()),
        other => Err(ShellDeepLinkError::UnknownTarget(other.to_string())),
    }
}

fn route_with_id(prefix: &str, raw_id: Option<&String>) -> Result<String, ShellDeepLinkError> {
    let id = safe_segment(raw_id.ok_or(ShellDeepLinkError::MissingTarget)?)?;
    Ok(format!("{prefix}/{id}"))
}

fn route_with_optional_id(
    prefix: &str,
    raw_id: Option<&String>,
) -> Result<String, ShellDeepLinkError> {
    raw_id
        .map(|value| safe_segment(value).map(|id| format!("{prefix}/{id}")))
        .unwrap_or_else(|| Ok(prefix.to_string()))
}

fn route_with_query_id(
    route: &str,
    query_key: &str,
    raw_id: Option<&String>,
) -> Result<String, ShellDeepLinkError> {
    raw_id
        .map(|value| safe_segment(value).map(|id| format!("{route}?{query_key}={id}")))
        .unwrap_or_else(|| Ok(route.to_string()))
}

fn safe_segment(raw: &str) -> Result<String, ShellDeepLinkError> {
    let segment = raw.trim();
    let lower = segment.to_ascii_lowercase();
    if segment.is_empty()
        || segment.len() > 160
        || segment.contains('/')
        || segment.contains('\\')
        || segment.contains("..")
        || segment.contains(':')
        || segment.contains('?')
        || segment.contains('#')
        || segment.contains('%')
        || segment.contains('\n')
        || segment.contains('\r')
        || segment.contains('\0')
        || lower.contains("%2f")
        || lower.contains("%5c")
        || lower.contains("%2e")
    {
        return Err(ShellDeepLinkError::UnsafeTarget(segment.to_string()));
    }
    Ok(segment.to_string())
}

fn checked_direct_route(raw_route: &str) -> Result<String, ShellDeepLinkError> {
    let route = raw_route.trim();
    if !allowed_direct_route(route) {
        return Err(ShellDeepLinkError::UnsafeTarget(route.to_string()));
    }
    Ok(route.to_string())
}

fn allowed_direct_route(route: &str) -> bool {
    if route.is_empty()
        || !route.starts_with('/')
        || route.starts_with("//")
        || route.contains('\\')
        || route.contains("..")
        || route.contains('%')
        || route.contains('\n')
        || route.contains('\r')
        || route.contains('\0')
    {
        return false;
    }

    route == "/"
        || route.starts_with("/intake/")
        || route.starts_with("/workitems/")
        || route.starts_with("/proposals/")
        || route.starts_with("/agent-runs/")
        || route.starts_with("/approvals")
        || route.starts_with("/dashboard/cost")
        || route.starts_with("/inbox")
        || route.starts_with("/notifications")
        || route.starts_with("/settings")
        || route.starts_with("/me")
        || route.starts_with("/r/")
        || route.starts_with("/p")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_workhub_open_task_to_current_workitem_route() {
        let plan = deep_link_plan_from_url("workhub://open/task/work-123").unwrap();

        assert_eq!(plan.scheme, "workhub");
        assert_eq!(plan.route, "/workitems/work-123");
        assert_eq!(plan.window_control.label, "main");
        assert_eq!(
            plan.window_control.route,
            Some("/workitems/work-123".to_string())
        );
        assert_eq!(
            plan.window_control.source,
            ShellWindowControlSource::DeepLink
        );
    }

    #[test]
    fn maps_workhub_proposal_and_replay_targets() {
        assert_eq!(
            deep_link_plan_from_url("workhub://open/proposal/proposal-1")
                .unwrap()
                .route,
            "/proposals/proposal-1"
        );
        assert_eq!(
            deep_link_plan_from_url("workhub://open/run/run-1")
                .unwrap()
                .route,
            "/agent-runs/run-1/replay"
        );
    }

    #[test]
    fn maps_legacy_yqgl_short_routes() {
        assert_eq!(
            deep_link_plan_from_url("yqgl://r/REQ-42").unwrap().route,
            "/r/REQ-42"
        );
        assert_eq!(
            deep_link_plan_from_url("yqgl://p/project-7").unwrap().route,
            "/p/project-7"
        );
        assert_eq!(
            deep_link_plan_from_url("yqgl://inbox").unwrap().route,
            "/inbox"
        );
    }

    #[test]
    fn allows_whitelisted_direct_route_query() {
        let plan = deep_link_plan_from_url("workhub://open?route=/approvals").unwrap();

        assert_eq!(plan.route, "/approvals");
    }

    #[test]
    fn rejects_external_or_traversal_deep_links() {
        assert_eq!(
            deep_link_plan_from_url("https://workhub.test/open/task/1").unwrap_err(),
            ShellDeepLinkError::UnsupportedScheme("https".to_string())
        );
        assert_eq!(
            deep_link_plan_from_url("workhub://open/task/../settings").unwrap_err(),
            ShellDeepLinkError::UnsafeTarget("..".to_string())
        );
        assert_eq!(
            deep_link_plan_from_url("workhub://open?route=https://evil.test").unwrap_err(),
            ShellDeepLinkError::UnsafeTarget("https://evil.test".to_string())
        );
    }

    #[test]
    fn localizes_deep_link_error_diagnostics_without_hiding_raw_values() {
        let error = ShellDeepLinkError::UnsafeTarget("https://evil.test".to_string());

        assert_eq!(
            describe_deep_link_error(&error, WorkHubLocale::ZhCn),
            "不安全的打开目标: https://evil.test"
        );
        assert_eq!(
            describe_deep_link_error(&error, WorkHubLocale::EnUs),
            "Unsafe open target: https://evil.test"
        );
    }
}
