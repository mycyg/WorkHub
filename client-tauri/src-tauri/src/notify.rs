use std::collections::{HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::plugin::PermissionState;
use tauri_plugin_notification::NotificationExt;

use crate::deep_link::{ShellDeepLinkPlan, WORKHUB_DEEP_LINK_SCHEME};
use crate::events::{event_channel_name, ShellEvent};
use crate::locale::WorkHubLocale;
use crate::sse::ShellPushEventPayload;
use crate::window_controls::{
    focus_main_route, ShellWindowControlError, ShellWindowControlPlan, ShellWindowControlSource,
};

pub const MAX_SYSTEM_NOTIFICATION_TITLE_CHARS: usize = 96;
pub const MAX_SYSTEM_NOTIFICATION_BODY_CHARS: usize = 220;
pub const MAX_SYSTEM_NOTIFICATION_DEDUPE_KEYS: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellSystemNotificationUrgency {
    High,
    Urgent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSystemNotificationPlan {
    pub id: String,
    pub event: String,
    pub title: String,
    pub body: String,
    // P2-07/R19-12：locale 由服务端/壳层拥有,webview 从不做客户端翻译。壳层向 webview 广播此计划时会带上
    // locale,但 webview 侧的 DesktopShellSystemNotificationPlan 并不保留它;当通知点击经命令桥把计划回传给
    // focus_system_notification 时,payload 里没有 locale。#[serde(default)] 让回传能反序列化(缺省=ZhCn),
    // 而点击落地路径(deep_link_plan_for_notification_click)只用 route + window_control,并不读 locale。
    #[serde(default)]
    pub locale: WorkHubLocale,
    pub urgency: ShellSystemNotificationUrgency,
    pub route: String,
    pub window_control: ShellWindowControlPlan,
    pub stream_kind: String,
    pub stream_path: String,
}

#[derive(Debug, Clone)]
pub struct ShellSystemNotificationDeduper {
    max_keys: usize,
    seen: HashSet<String>,
    order: VecDeque<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellSystemNotificationError {
    EmptyId,
    UnsafeId,
    UnsafeRoute(ShellWindowControlError),
}

struct ParsedPushData {
    event: String,
    event_id: Option<String>,
    preview_text: Option<String>,
    data: Value,
}

pub fn system_notification_event_channel() -> &'static str {
    event_channel_name(ShellEvent::SystemNotification)
}

impl Default for ShellSystemNotificationDeduper {
    fn default() -> Self {
        Self::with_capacity(MAX_SYSTEM_NOTIFICATION_DEDUPE_KEYS)
    }
}

impl ShellSystemNotificationDeduper {
    pub fn with_capacity(max_keys: usize) -> Self {
        Self {
            max_keys,
            seen: HashSet::new(),
            order: VecDeque::new(),
        }
    }

    pub fn should_deliver(&mut self, plan: &ShellSystemNotificationPlan) -> bool {
        if self.max_keys == 0 {
            return true;
        }

        let key = system_notification_dedupe_key(plan);
        if self.seen.contains(&key) {
            return false;
        }

        self.seen.insert(key.clone());
        self.order.push_back(key);
        while self.order.len() > self.max_keys {
            if let Some(oldest) = self.order.pop_front() {
                self.seen.remove(&oldest);
            }
        }
        true
    }
}

pub fn system_notification_dedupe_key(plan: &ShellSystemNotificationPlan) -> String {
    format!("{}:{}:{}", plan.id, plan.event, plan.route)
}

/// 通知点击 → 深链计划映射（P2-07 / R19-12）。壳层为 high/urgent 事件算好了目标 route + window_control
/// （见 `system_notification_plan_from_push_payload_for_locale`），但 tauri-plugin-notification 2.3.3 桌面端
/// 的 `show()` 只是 `spawn` 一个 `notify_rust` 调用并**丢弃返回句柄**（见 `show_system_notification` 顶部注释），
/// 没有任何 click/action 回调可挂——OS 弹窗被点击时壳层拿不到信号。于是"点击消费"落在 webview 侧：webview
/// 收到 `system-notification` 事件、由生产绑定的 `onSystemNotification` 经命令桥（`focus_system_notification`）
/// 把本计划回传，这里把它整形成与 REL-6 统一深链落地路径同型的 `ShellDeepLinkPlan`，交回 `handle_deep_link_plan`
/// 执行（含 workbench 按需建窗）。route 与 window_control 直接复用、绝不重算——审批通知落审批面板、消息通知落
/// 对应会话，都由壳层原来算好的 route 决定。纯函数便于单测。
pub fn deep_link_plan_for_notification_click(
    plan: &ShellSystemNotificationPlan,
) -> ShellDeepLinkPlan {
    ShellDeepLinkPlan {
        // raw_url 仅作诊断/事件载荷,永不被 handle_deep_link_plan 重新解析(它直接用下面的 route/window_control)。
        // 点击来源是 OS/webview 通知而非真实 URL,这里合成一个可读的 workhub://open?route= 形态标注来源。
        raw_url: format!("workhub://open?route={}", plan.route),
        scheme: WORKHUB_DEEP_LINK_SCHEME.to_string(),
        route: plan.route.clone(),
        window_control: plan.window_control.clone(),
    }
}

pub fn show_system_notification(
    app: &tauri::AppHandle,
    plan: &ShellSystemNotificationPlan,
) -> Result<bool, String> {
    // P2-07/R19-12 降级说明：tauri-plugin-notification 2.3.3 桌面端 `NotificationBuilder::show()` 内部
    // `tauri::async_runtime::spawn` 后调 `notify_rust::Notification::show()` 并丢弃其返回句柄,桌面端**没有**
    // click/action 回调接口(action 仅移动端)。升级到 2.x 更高小版本也不改变这一点(上游桌面端仍无点击路由)。
    // 因此壳层这里只负责"弹出",点击目标 route 由 webview 侧经 focus_system_notification 命令桥消费
    // (见 deep_link_plan_for_notification_click)。macOS 上点击弹窗只会激活 App(→ RunEvent::Reopen,恢复主窗)。
    let notifications = app.notification();
    let mut permission = notifications
        .permission_state()
        .map_err(|error| format!("failed to read notification permission: {error}"))?;
    if matches!(
        permission,
        PermissionState::Prompt | PermissionState::PromptWithRationale
    ) {
        permission = notifications
            .request_permission()
            .map_err(|error| format!("failed to request notification permission: {error}"))?;
    }
    if permission != PermissionState::Granted {
        return Ok(false);
    }

    notifications
        .builder()
        .title(&plan.title)
        .body(&plan.body)
        .show()
        .map_err(|error| format!("failed to show system notification: {error}"))?;
    Ok(true)
}

pub fn system_notification_plan_from_push_payload(
    payload: &ShellPushEventPayload,
) -> Result<Option<ShellSystemNotificationPlan>, ShellSystemNotificationError> {
    system_notification_plan_from_push_payload_for_locale(payload, WorkHubLocale::default())
}

pub fn system_notification_plan_from_push_payload_for_locale(
    payload: &ShellPushEventPayload,
    locale: WorkHubLocale,
) -> Result<Option<ShellSystemNotificationPlan>, ShellSystemNotificationError> {
    if !allows_os_notification_stream(payload) {
        return Ok(None);
    }

    let parsed = parse_push_data(payload);
    let Some(urgency) = urgency_for_event(&parsed) else {
        return Ok(None);
    };

    // route 侧已优雅降级（畸形 ID → 兜底路由，见 route_for_notification），此处不再产生路由类错误；
    // focus_main_route 仅对兜底集合外的异常路由兜住最后一道防线。
    let route = route_for_notification(&parsed);
    let window_control = focus_main_route(ShellWindowControlSource::SystemNotification, &route)
        .map_err(ShellSystemNotificationError::UnsafeRoute)?;

    let title = trim_notification_text(
        title_for_notification(&parsed, locale),
        MAX_SYSTEM_NOTIFICATION_TITLE_CHARS,
    );
    let body = trim_notification_text(
        body_for_notification(&parsed, locale),
        MAX_SYSTEM_NOTIFICATION_BODY_CHARS,
    );
    let id = notification_id(payload, &parsed)?;

    Ok(Some(ShellSystemNotificationPlan {
        id,
        event: parsed.event,
        title,
        body,
        locale,
        urgency,
        route,
        window_control,
        stream_kind: payload.stream_kind.clone(),
        stream_path: payload.stream_path.clone(),
    }))
}

fn allows_os_notification_stream(payload: &ShellPushEventPayload) -> bool {
    matches!(
        payload.stream_kind.as_str(),
        "me" | "workitem" | "run" | "session" | "proposal"
    )
}

fn parse_push_data(payload: &ShellPushEventPayload) -> ParsedPushData {
    let parsed = serde_json::from_str::<Value>(&payload.data).unwrap_or(Value::Null);
    if let Some(record) = parsed.as_object() {
        if let Some(event) = string_value(record.get("type")) {
            let data = record.get("data").cloned().unwrap_or(Value::Null);
            return ParsedPushData {
                event,
                event_id: string_value(record.get("event_id")),
                preview_text: string_value(record.get("preview_text")),
                data,
            };
        }
    }

    ParsedPushData {
        event: payload.event.clone(),
        event_id: None,
        preview_text: None,
        data: parsed,
    }
}

fn urgency_for_event(parsed: &ParsedPushData) -> Option<ShellSystemNotificationUrgency> {
    match parsed.event.as_str() {
        "budget.exhausted" => Some(ShellSystemNotificationUrgency::Urgent),
        "budget.warning" => Some(ShellSystemNotificationUrgency::High),
        "permission.ask" => Some(ShellSystemNotificationUrgency::Urgent),
        "agent_run.escalated" | "agent_run.failed" | "escalation.opened" | "sync.conflict" => {
            Some(ShellSystemNotificationUrgency::High)
        }
        // proposal.* 与 webview 侧 interruption-policy 的分类保持一致：opened/reviewed/merged 同为
        // "终局/决策"信号，都按 High 弹桌面通知（双端一致性基准见 workbench/interruption-policy.ts）。
        "proposal.opened" | "proposal.reviewed" | "proposal.merged" | "revision.fedback" => {
            Some(ShellSystemNotificationUrgency::High)
        }
        "notification.created" => urgency_from_payload_fields(parsed),
        _ => None,
    }
}

fn urgency_from_payload_fields(parsed: &ParsedPushData) -> Option<ShellSystemNotificationUrgency> {
    let severity = field_string(&parsed.data, "severity")
        .or_else(|| field_string(&parsed.data, "priority"))
        .or_else(|| nested_field_string(&parsed.data, &["attention", "priority"]));
    match severity.as_deref() {
        Some("urgent") | Some("critical") => Some(ShellSystemNotificationUrgency::Urgent),
        Some("high") => Some(ShellSystemNotificationUrgency::High),
        _ => None,
    }
}

fn title_for_notification(parsed: &ParsedPushData, locale: WorkHubLocale) -> String {
    field_string(&parsed.data, "title")
        .or_else(|| nested_field_string(&parsed.data, &["attention", "title"]))
        .or_else(|| parsed.preview_text.clone())
        .unwrap_or_else(|| fallback_title_for_event(&parsed.event, locale).to_string())
}

fn body_for_notification(parsed: &ParsedPushData, locale: WorkHubLocale) -> String {
    field_string(&parsed.data, "body")
        .or_else(|| field_string(&parsed.data, "summary_text"))
        .or_else(|| field_string(&parsed.data, "message"))
        .or_else(|| nested_field_string(&parsed.data, &["attention", "summary_text"]))
        .or_else(|| parsed.preview_text.clone())
        .unwrap_or_else(|| fallback_body_for_event(&parsed.event, locale).to_string())
}

/// 通知落地路由。畸形 ID 绝不上抛：`safe_route_segment` 失败时与上面 target_url 分支同款优雅降级——
/// 跳过精确路由、落到该事件的兜底路由（审批 → /approvals，其余 → 后续分支直至 /inbox）。过去这里对
/// approval_id/proposal_id/run_id/work_item_id 硬 `?` 失败，经 process_sse_chunk 一路上抛把整条 SSE
/// 连接打断重连——单条通知的脏数据不该有连接级杀伤力。因此本函数不再返回 Result。
fn route_for_notification(parsed: &ParsedPushData) -> String {
    if let Some(route) = field_string(&parsed.data, "target_url")
        .or_else(|| field_string(&parsed.data, "targetUrl"))
        .or_else(|| nested_field_string(&parsed.data, &["attention", "actions", "0", "href"]))
    {
        if focus_main_route(ShellWindowControlSource::SystemNotification, &route).is_ok() {
            return route;
        }
    }

    if parsed.event == "budget.warning" || parsed.event == "budget.exhausted" {
        return "/dashboard/cost".to_string();
    }
    if parsed.event == "permission.ask" {
        if let Some(segment) = field_string(&parsed.data, "approval_id")
            .or_else(|| field_string(&parsed.data, "approvalId"))
            .and_then(|approval_id| safe_route_segment(&approval_id).ok())
        {
            return format!("/approvals?approvalId={segment}");
        }
        // 无 approval_id 或其含非法字符：落审批中心，仅失去精确定位。
        return "/approvals".to_string();
    }
    if let Some(segment) = field_string(&parsed.data, "proposal_id")
        .or_else(|| field_string(&parsed.data, "proposalId"))
        .and_then(|proposal_id| safe_route_segment(&proposal_id).ok())
    {
        return format!("/proposals/{segment}");
    }
    if let Some(segment) = field_string(&parsed.data, "run_id")
        .or_else(|| field_string(&parsed.data, "runId"))
        .and_then(|run_id| safe_route_segment(&run_id).ok())
    {
        return format!("/agent-runs/{segment}/replay");
    }
    if let Some(segment) = field_string(&parsed.data, "work_item_id")
        .or_else(|| field_string(&parsed.data, "workItemId"))
        .and_then(|work_item_id| safe_route_segment(&work_item_id).ok())
    {
        return format!("/workitems/{segment}");
    }

    "/inbox".to_string()
}

fn notification_id(
    payload: &ShellPushEventPayload,
    parsed: &ParsedPushData,
) -> Result<String, ShellSystemNotificationError> {
    let raw = parsed
        .event_id
        .clone()
        .or_else(|| field_string(&parsed.data, "id"))
        .unwrap_or_else(|| {
            format!(
                "{}:{}:{}",
                payload.stream_kind, payload.stream_path, parsed.event
            )
        });
    let id = raw.trim();
    if id.is_empty() {
        return Err(ShellSystemNotificationError::EmptyId);
    }
    if id.contains('\n') || id.contains('\r') || id.contains('\0') {
        return Err(ShellSystemNotificationError::UnsafeId);
    }
    Ok(id.to_string())
}

fn safe_route_segment(raw: &str) -> Result<String, ShellSystemNotificationError> {
    let segment = raw.trim();
    if segment.is_empty() {
        return Err(ShellSystemNotificationError::EmptyId);
    }
    if segment.len() > 160
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
    {
        return Err(ShellSystemNotificationError::UnsafeId);
    }
    Ok(segment.to_string())
}

fn trim_notification_text(raw: String, max_chars: usize) -> String {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut output = String::new();
    for ch in normalized.chars().take(max_chars) {
        output.push(ch);
    }
    if normalized.chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

fn fallback_title_for_event(event: &str, locale: WorkHubLocale) -> &'static str {
    match locale {
        WorkHubLocale::ZhCn => match event {
            "budget.exhausted" => "AI 预算已耗尽",
            "budget.warning" => "AI 预算接近上限",
            "permission.ask" => "Cuu 需要你的审批",
            "proposal.opened" => "新的变更提案",
            "proposal.reviewed" => "变更提案有反馈",
            "proposal.merged" => "变更提案已合并",
            "revision.fedback" => "需要修订",
            "agent_run.failed" => "AI 运行失败",
            "agent_run.escalated" | "escalation.opened" => "Cuu 需要你决策",
            "sync.conflict" => "本地同步冲突",
            _ => "WorkHub 有新的提醒",
        },
        WorkHubLocale::EnUs => match event {
            "budget.exhausted" => "AI budget is exhausted",
            "budget.warning" => "AI budget is near the limit",
            "permission.ask" => "Cuu needs your approval",
            "proposal.opened" => "New change proposal",
            "proposal.reviewed" => "Change proposal feedback",
            "proposal.merged" => "Change proposal merged",
            "revision.fedback" => "Revision requested",
            "agent_run.failed" => "AI run failed",
            "agent_run.escalated" | "escalation.opened" => "Cuu needs a decision",
            "sync.conflict" => "Local sync conflict",
            _ => "WorkHub has a new alert",
        },
    }
}

fn fallback_body_for_event(event: &str, locale: WorkHubLocale) -> &'static str {
    match locale {
        WorkHubLocale::ZhCn => match event {
            "permission.ask" => "打开 WorkHub 允许、拒绝或记住这条规则。",
            "budget.exhausted" => "新的自动运行会暂停，直到预算问题被处理。",
            "budget.warning" => "打开成本看板，选择更省的执行路径。",
            "proposal.merged" => "变更已并入底稿，打开 WorkHub 查看合并结果。",
            "sync.conflict" => "选择本地、云端或 AI 合并建议。",
            _ => "打开 WorkHub 查看详情。",
        },
        WorkHubLocale::EnUs => match event {
            "permission.ask" => "Open WorkHub to allow, deny, or remember this rule.",
            "budget.exhausted" => "New automated runs are paused until the budget is handled.",
            "budget.warning" => "Open the cost dashboard and choose a cheaper execution path.",
            "proposal.merged" => {
                "The change is merged into the draft. Open WorkHub for the result."
            }
            "sync.conflict" => "Choose local, cloud, or the AI merge suggestion.",
            _ => "Open WorkHub for details.",
        },
    }
}

fn field_string(value: &Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|record| string_value(record.get(key)))
}

fn nested_field_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        if let Ok(index) = key.parse::<usize>() {
            current = current.as_array()?.get(index)?;
        } else {
            current = current.as_object()?.get(*key)?;
        }
    }
    current.as_str().map(ToString::to_string)
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value?.as_str().map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(event: &str, data: &str, stream_kind: &str) -> ShellPushEventPayload {
        ShellPushEventPayload {
            event: event.to_string(),
            data: data.to_string(),
            stream_kind: stream_kind.to_string(),
            stream_path: match stream_kind {
                "me" => "/api/push/stream/me".to_string(),
                "workitem" => "/api/push/stream/workitem/work-1".to_string(),
                _ => "/api/push/stream".to_string(),
            },
        }
    }

    #[test]
    fn high_private_notifications_become_os_notification_plans() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"n1","severity":"high","title":"Review needed","body":"Cuu prepared the result.","target_url":"/workitems/work-1"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.id, "n1");
        assert_eq!(plan.locale, WorkHubLocale::ZhCn);
        assert_eq!(plan.title, "Review needed");
        assert_eq!(plan.body, "Cuu prepared the result.");
        assert_eq!(plan.urgency, ShellSystemNotificationUrgency::High);
        assert_eq!(plan.route, "/workitems/work-1");
        assert_eq!(
            plan.window_control.source,
            ShellWindowControlSource::SystemNotification
        );
    }

    #[test]
    fn normal_notifications_do_not_interrupt_the_desktop() {
        assert!(system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"n2","severity":"normal","title":"Normal notice"}"#,
            "me",
        ))
        .unwrap()
        .is_none());
    }

    #[test]
    fn global_streams_never_create_os_notifications() {
        assert!(system_notification_plan_from_push_payload(&payload(
            "permission.ask",
            r#"{"approval_id":"approval-1","title":"Needs approval"}"#,
            "global",
        ))
        .unwrap()
        .is_none());
    }

    #[test]
    fn permission_asks_route_to_approval_center() {
        let plan = system_notification_plan_from_push_payload_for_locale(
            &payload("permission.ask", r#"{"approval_id":"approval-1"}"#, "me"),
            WorkHubLocale::EnUs,
        )
        .unwrap()
        .unwrap();

        assert_eq!(plan.urgency, ShellSystemNotificationUrgency::Urgent);
        assert_eq!(plan.locale, WorkHubLocale::EnUs);
        assert_eq!(plan.title, "Cuu needs your approval");
        assert_eq!(
            plan.body,
            "Open WorkHub to allow, deny, or remember this rule."
        );
        assert_eq!(plan.route, "/approvals?approvalId=approval-1");
    }

    #[test]
    fn default_notification_fallback_copy_is_chinese() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "permission.ask",
            r#"{"approval_id":"approval-1"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.locale, WorkHubLocale::ZhCn);
        assert_eq!(plan.title, "Cuu 需要你的审批");
        assert_eq!(plan.body, "打开 WorkHub 允许、拒绝或记住这条规则。");
    }

    #[test]
    fn dynamic_notification_payload_text_is_not_client_translated() {
        let plan = system_notification_plan_from_push_payload_for_locale(
            &payload(
                "notification.created",
                r#"{"id":"n4","severity":"urgent","title":"中文任务标题","body":"Keep this exact body.","target_url":"/workitems/work-1"}"#,
                "me",
            ),
            WorkHubLocale::EnUs,
        )
        .unwrap()
        .unwrap();

        assert_eq!(plan.locale, WorkHubLocale::EnUs);
        assert_eq!(plan.title, "中文任务标题");
        assert_eq!(plan.body, "Keep this exact body.");
    }

    // proposal.merged 与 opened/reviewed 同级（对齐 webview interruption-policy 的 proposal 分类）：
    // 必须产出 High 桌面通知，且中英 fallback 文案齐备、路由落到具体提案。
    #[test]
    fn merged_proposals_notify_at_high_urgency_with_fallback_copy() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "proposal.merged",
            r#"{"proposal_id":"proposal-9"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.urgency, ShellSystemNotificationUrgency::High);
        assert_eq!(plan.title, "变更提案已合并");
        assert_eq!(plan.body, "变更已并入底稿，打开 WorkHub 查看合并结果。");
        assert_eq!(plan.route, "/proposals/proposal-9");

        let plan_en = system_notification_plan_from_push_payload_for_locale(
            &payload("proposal.merged", r#"{"proposal_id":"proposal-9"}"#, "me"),
            WorkHubLocale::EnUs,
        )
        .unwrap()
        .unwrap();

        assert_eq!(plan_en.title, "Change proposal merged");
        assert_eq!(
            plan_en.body,
            "The change is merged into the draft. Open WorkHub for the result."
        );
    }

    // 畸形 approval_id 只降级不冒泡：仍产出通知计划，路由落审批中心兜底，绝不 Err（过去会 `?` 上抛
    // 打断整条 SSE 连接）。
    #[test]
    fn malformed_approval_ids_degrade_to_the_approvals_route_without_erroring() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "permission.ask",
            r#"{"approval_id":"../../evil?x=1"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.urgency, ShellSystemNotificationUrgency::Urgent);
        assert_eq!(plan.route, "/approvals");
    }

    // 其余精确路由分支（proposal/run/workitem）同款降级：ID 含非法字符时跳过精确路由，落 /inbox 兜底。
    #[test]
    fn malformed_precise_route_ids_fall_back_to_inbox() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "proposal.reviewed",
            r#"{"proposal_id":"a/b","run_id":"x?y","work_item_id":"..\\z"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.route, "/inbox");
    }

    #[test]
    fn budget_events_route_to_cost_dashboard() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "budget.exhausted",
            r#"{"message":"This AI run has exhausted its budget."}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.urgency, ShellSystemNotificationUrgency::Urgent);
        assert_eq!(plan.route, "/dashboard/cost");
    }

    #[test]
    fn embedded_workhub_event_envelopes_are_supported() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "message",
            r#"{"event_id":"evt-1","type":"proposal.opened","topic":"user:me","ts":"2026-06-06T00:00:00.000Z","preview_text":"New change proposal","data":{"proposal_id":"proposal-1","summary_text":"Review it like a PR."}}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.id, "evt-1");
        assert_eq!(plan.event, "proposal.opened");
        assert_eq!(plan.route, "/proposals/proposal-1");
    }

    #[test]
    fn unsafe_target_urls_fall_back_to_safe_routes() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"n3","severity":"urgent","title":"No external link","target_url":"https://evil.test"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        assert_eq!(plan.route, "/inbox");
    }

    // P2-07/R19-12：通知点击 → 深链计划映射。route + window_control 必须从通知计划原样带过去(壳层已算好
    // 审批/会话目标),交给 handle_deep_link_plan 走统一落地路径,而不是在点击时重算或丢失。
    #[test]
    fn notification_click_maps_to_deep_link_plan_preserving_route_and_window_control() {
        let plan = system_notification_plan_from_push_payload_for_locale(
            &payload("permission.ask", r#"{"approval_id":"approval-1"}"#, "me"),
            WorkHubLocale::EnUs,
        )
        .unwrap()
        .unwrap();

        let deep_link = deep_link_plan_for_notification_click(&plan);

        assert_eq!(deep_link.scheme, WORKHUB_DEEP_LINK_SCHEME);
        assert_eq!(deep_link.route, "/approvals?approvalId=approval-1");
        assert_eq!(deep_link.window_control, plan.window_control);
        assert_eq!(deep_link.window_control.label, "main");
        assert_eq!(
            deep_link.window_control.source,
            ShellWindowControlSource::SystemNotification
        );
    }

    // 会话/消息类通知(带 work_item_id)点击落到工作项路由——window_control 仍指主窗,由 webview 命令桥执行。
    #[test]
    fn conversation_notification_click_targets_the_work_item_route() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"n1","severity":"high","title":"Review","body":"ready","work_item_id":"work-1"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();

        let deep_link = deep_link_plan_for_notification_click(&plan);

        assert_eq!(deep_link.route, "/workitems/work-1");
        assert_eq!(
            deep_link.window_control.route,
            Some("/workitems/work-1".to_string())
        );
    }

    // 命令桥回传的 payload 没有 locale 字段(webview 端不保留),#[serde(default)] 必须让它照样反序列化。
    #[test]
    fn system_notification_plan_deserializes_without_a_locale_field() {
        let json = r#"{
            "id":"evt-1",
            "event":"permission.ask",
            "title":"Cuu needs your approval",
            "body":"Open WorkHub.",
            "urgency":"urgent",
            "route":"/approvals?approvalId=approval-1",
            "windowControl":{
                "label":"main",
                "action":"show_and_focus",
                "source":"system_notification",
                "route":"/approvals?approvalId=approval-1",
                "focus":true,
                "reason":"focus-main-route"
            },
            "streamKind":"me",
            "streamPath":"/api/push/stream/me"
        }"#;

        let plan: ShellSystemNotificationPlan = serde_json::from_str(json).unwrap();

        assert_eq!(plan.locale, WorkHubLocale::default());
        let deep_link = deep_link_plan_for_notification_click(&plan);
        assert_eq!(deep_link.route, "/approvals?approvalId=approval-1");
        assert_eq!(deep_link.window_control.label, "main");
    }

    #[test]
    fn notification_deduper_suppresses_replayed_events() {
        let plan = system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"n-dedupe","severity":"urgent","title":"Needs attention"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();
        let mut deduper = ShellSystemNotificationDeduper::with_capacity(8);

        assert!(deduper.should_deliver(&plan));
        assert!(!deduper.should_deliver(&plan));
        assert_eq!(
            system_notification_dedupe_key(&plan),
            "n-dedupe:notification.created:/inbox"
        );
    }

    #[test]
    fn notification_deduper_evicts_oldest_keys_when_full() {
        let mut first = system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"first","severity":"urgent","title":"First"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();
        let second = system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"second","severity":"urgent","title":"Second"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();
        let third = system_notification_plan_from_push_payload(&payload(
            "notification.created",
            r#"{"id":"third","severity":"urgent","title":"Third"}"#,
            "me",
        ))
        .unwrap()
        .unwrap();
        let mut deduper = ShellSystemNotificationDeduper::with_capacity(2);

        assert!(deduper.should_deliver(&first));
        assert!(deduper.should_deliver(&second));
        assert!(deduper.should_deliver(&third));
        assert!(deduper.should_deliver(&first));

        first.id = "third".to_string();
        assert!(!deduper.should_deliver(&first));
    }
}
