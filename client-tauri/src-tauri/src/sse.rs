use serde::{Deserialize, Serialize};

use crate::config::WorkHubShellConfig;
use crate::events::{event_channel_name, ShellEvent};
use crate::http::{plan_daemon_request, ShellHeader};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellSseTarget {
    Global,
    Me,
    WorkItem(String),
    LegacyRequirement(String),
    Run(String),
    Session(String),
    Proposal(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellSsePlanError {
    EmptyId,
    UnsafeId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellSseSubscription {
    pub kind: String,
    pub path: String,
    pub url: String,
    pub headers: Vec<ShellHeader>,
    pub event_channel: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedSseFrame {
    pub event: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellPushEventPayload {
    pub event: String,
    pub data: String,
    pub stream_kind: String,
    pub stream_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellSseConnectionState {
    Connecting,
    Open,
    Retrying,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellSseStatusPayload {
    pub stream_kind: String,
    pub stream_path: String,
    pub state: ShellSseConnectionState,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellSseWorkerPlan {
    pub subscriptions: Vec<ShellSseSubscription>,
    pub reconnect_delay_ms: u64,
}

impl ShellSseTarget {
    pub fn kind(&self) -> &'static str {
        match self {
            ShellSseTarget::Global => "global",
            ShellSseTarget::Me => "me",
            ShellSseTarget::WorkItem(_) => "workitem",
            ShellSseTarget::LegacyRequirement(_) => "legacy_requirement",
            ShellSseTarget::Run(_) => "run",
            ShellSseTarget::Session(_) => "session",
            ShellSseTarget::Proposal(_) => "proposal",
        }
    }

    pub fn path(&self) -> Result<String, ShellSsePlanError> {
        match self {
            ShellSseTarget::Global => Ok("/api/push/stream".to_string()),
            ShellSseTarget::Me => Ok("/api/push/stream/me".to_string()),
            ShellSseTarget::WorkItem(id) => {
                Ok(format!("/api/push/stream/workitem/{}", safe_stream_id(id)?))
            }
            ShellSseTarget::LegacyRequirement(id) => {
                Ok(format!("/api/push/stream/req/{}", safe_stream_id(id)?))
            }
            ShellSseTarget::Run(id) => Ok(format!("/api/push/stream/run/{}", safe_stream_id(id)?)),
            ShellSseTarget::Session(id) => {
                Ok(format!("/api/push/stream/session/{}", safe_stream_id(id)?))
            }
            ShellSseTarget::Proposal(id) => {
                Ok(format!("/api/push/stream/proposal/{}", safe_stream_id(id)?))
            }
        }
    }
}

pub fn default_shell_sse_targets() -> Vec<ShellSseTarget> {
    vec![ShellSseTarget::Global, ShellSseTarget::Me]
}

pub fn startup_shell_sse_targets(config: &WorkHubShellConfig) -> Vec<ShellSseTarget> {
    let mut targets = vec![ShellSseTarget::Global];
    if config.has_trusted_device_token() {
        targets.push(ShellSseTarget::Me);
    }
    targets
}

pub fn plan_shell_sse_worker(
    config: &WorkHubShellConfig,
    targets: Vec<ShellSseTarget>,
    reconnect_delay_ms: u64,
) -> Result<ShellSseWorkerPlan, ShellSsePlanError> {
    let subscriptions = targets
        .into_iter()
        .map(|target| plan_shell_sse_subscription(config, target))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ShellSseWorkerPlan {
        subscriptions,
        reconnect_delay_ms,
    })
}

pub fn plan_shell_sse_subscription(
    config: &WorkHubShellConfig,
    target: ShellSseTarget,
) -> Result<ShellSseSubscription, ShellSsePlanError> {
    let path = target.path()?;
    let request = plan_daemon_request(config, &path);
    Ok(ShellSseSubscription {
        kind: target.kind().to_string(),
        path,
        url: request.url,
        headers: request.headers,
        event_channel: event_channel_name(ShellEvent::PushEvent).to_string(),
    })
}

pub fn parse_sse_frames(input: &str) -> Vec<ParsedSseFrame> {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    normalized
        .split("\n\n")
        .filter_map(|frame| {
            let trimmed = frame.trim();
            if trimmed.is_empty() || trimmed.starts_with(':') {
                return None;
            }

            let mut event = "message".to_string();
            let mut data_lines = Vec::new();
            for line in frame.split('\n') {
                if let Some(rest) = line.strip_prefix("event:") {
                    event = rest.trim().to_string();
                } else if let Some(rest) = line.strip_prefix("data:") {
                    data_lines.push(rest.trim_start().to_string());
                }
            }

            Some(ParsedSseFrame {
                event,
                data: data_lines.join("\n"),
            })
        })
        .collect()
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ShellSseFrameBuffer {
    pending: String,
}

impl ShellSseFrameBuffer {
    pub fn push_chunk(&mut self, chunk: &str) -> Vec<ParsedSseFrame> {
        self.pending.push_str(chunk);
        self.pending = self.pending.replace("\r\n", "\n").replace('\r', "\n");

        let mut frames = Vec::new();
        while let Some(index) = self.pending.find("\n\n") {
            let frame = self.pending[..index].to_string();
            self.pending = self.pending[index + 2..].to_string();
            frames.extend(parse_sse_frames(&format!("{frame}\n\n")));
        }
        frames
    }

    pub fn pending_bytes(&self) -> usize {
        self.pending.len()
    }
}

pub fn push_payload_from_frame(
    subscription: &ShellSseSubscription,
    frame: ParsedSseFrame,
) -> ShellPushEventPayload {
    ShellPushEventPayload {
        event: frame.event,
        data: frame.data,
        stream_kind: subscription.kind.clone(),
        stream_path: subscription.path.clone(),
    }
}

pub fn status_payload(
    subscription: &ShellSseSubscription,
    state: ShellSseConnectionState,
    message: Option<String>,
) -> ShellSseStatusPayload {
    ShellSseStatusPayload {
        stream_kind: subscription.kind.clone(),
        stream_path: subscription.path.clone(),
        state,
        message,
    }
}

pub fn status_event_channel() -> &'static str {
    event_channel_name(ShellEvent::SseStatus)
}

fn safe_stream_id(id: &str) -> Result<String, ShellSsePlanError> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(ShellSsePlanError::EmptyId);
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains(':')
        || trimmed.contains('?')
        || trimmed.contains('#')
    {
        return Err(ShellSsePlanError::UnsafeId);
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> WorkHubShellConfig {
        WorkHubShellConfig {
            server_url: "http://127.0.0.1:8787/".to_string(),
            client_token: Some("device-token".to_string()),
            device_name: "desktop".to_string(),
        }
    }

    #[test]
    fn default_sse_targets_keep_global_and_private_streams() {
        let plans = default_shell_sse_targets()
            .into_iter()
            .map(|target| plan_shell_sse_subscription(&config(), target).unwrap())
            .collect::<Vec<_>>();

        assert_eq!(plans[0].path, "/api/push/stream");
        assert_eq!(plans[1].path, "/api/push/stream/me");
        assert_eq!(plans[0].event_channel, "push-event");
        assert_eq!(plans[0].headers.len(), 2);
    }

    #[test]
    fn startup_targets_wait_for_a_trusted_device_token_before_private_streams() {
        let mut without_token = config();
        without_token.client_token = None;
        let with_token = config();

        assert_eq!(
            startup_shell_sse_targets(&without_token),
            vec![ShellSseTarget::Global]
        );
        assert_eq!(
            startup_shell_sse_targets(&with_token),
            vec![ShellSseTarget::Global, ShellSseTarget::Me]
        );
    }

    #[test]
    fn worker_plan_keeps_retry_policy_and_subscription_headers() {
        let plan = plan_shell_sse_worker(&config(), startup_shell_sse_targets(&config()), 5_000)
            .expect("worker plan should build");

        assert_eq!(plan.reconnect_delay_ms, 5_000);
        assert_eq!(plan.subscriptions.len(), 2);
        assert_eq!(plan.subscriptions[0].path, "/api/push/stream");
        assert_eq!(plan.subscriptions[1].path, "/api/push/stream/me");
        assert_eq!(plan.subscriptions[1].headers.len(), 2);
    }

    #[test]
    fn plans_contract_stream_paths_without_copying_domain_logic() {
        let workitem = plan_shell_sse_subscription(
            &config(),
            ShellSseTarget::WorkItem("10000000-0000-4000-8000-000000000001".to_string()),
        )
        .unwrap();
        let session = plan_shell_sse_subscription(
            &config(),
            ShellSseTarget::Session("session-1".to_string()),
        )
        .unwrap();
        let proposal = plan_shell_sse_subscription(
            &config(),
            ShellSseTarget::Proposal("proposal-1".to_string()),
        )
        .unwrap();

        assert_eq!(
            workitem.url,
            "http://127.0.0.1:8787/api/push/stream/workitem/10000000-0000-4000-8000-000000000001"
        );
        assert_eq!(session.path, "/api/push/stream/session/session-1");
        assert_eq!(proposal.path, "/api/push/stream/proposal/proposal-1");
    }

    #[test]
    fn rejects_unsafe_stream_path_segments() {
        assert_eq!(
            plan_shell_sse_subscription(&config(), ShellSseTarget::Session("../other".to_string()))
                .unwrap_err(),
            ShellSsePlanError::UnsafeId
        );
        assert_eq!(
            plan_shell_sse_subscription(&config(), ShellSseTarget::Run("".to_string()))
                .unwrap_err(),
            ShellSsePlanError::EmptyId
        );
    }

    #[test]
    fn parses_sse_frames_like_the_ts_client() {
        let frames = parse_sse_frames(
            ": ping\n\n\
             event: permission.ask\n\
             data: {\"ok\":true}\n\n\
             event: agent_run.step\r\n\
             data: line 1\r\n\
             data: line 2\r\n\r\n",
        );

        assert_eq!(
            frames,
            vec![
                ParsedSseFrame {
                    event: "permission.ask".to_string(),
                    data: "{\"ok\":true}".to_string(),
                },
                ParsedSseFrame {
                    event: "agent_run.step".to_string(),
                    data: "line 1\nline 2".to_string(),
                },
            ]
        );
    }

    #[test]
    fn frame_buffer_holds_partial_sse_frames_across_chunks() {
        let mut buffer = ShellSseFrameBuffer::default();

        assert!(buffer
            .push_chunk("event: notification.created\n")
            .is_empty());
        assert!(buffer.pending_bytes() > 0);
        let frames = buffer.push_chunk("data: {\"id\":\"n1\"}\n\n: ping\n\n");

        assert_eq!(
            frames,
            vec![ParsedSseFrame {
                event: "notification.created".to_string(),
                data: "{\"id\":\"n1\"}".to_string(),
            }]
        );
        assert_eq!(buffer.pending_bytes(), 0);
    }

    #[test]
    fn forwards_sse_payloads_as_opaque_webview_events() {
        let subscription = plan_shell_sse_subscription(&config(), ShellSseTarget::Me).unwrap();
        let payload = push_payload_from_frame(
            &subscription,
            ParsedSseFrame {
                event: "proposal.opened".to_string(),
                data: "{\"proposal_id\":\"p1\"}".to_string(),
            },
        );

        assert_eq!(payload.event, "proposal.opened");
        assert_eq!(payload.data, "{\"proposal_id\":\"p1\"}");
        assert_eq!(payload.stream_kind, "me");
        assert_eq!(
            serde_json::to_value(&payload).unwrap()["data"],
            serde_json::Value::String("{\"proposal_id\":\"p1\"}".to_string())
        );
    }

    #[test]
    fn status_payloads_use_the_dedicated_sse_status_channel() {
        let subscription = plan_shell_sse_subscription(&config(), ShellSseTarget::Global).unwrap();
        let payload = status_payload(&subscription, ShellSseConnectionState::Open, None);

        assert_eq!(status_event_channel(), "sse-status");
        assert_eq!(payload.state, ShellSseConnectionState::Open);
        assert_eq!(payload.stream_path, "/api/push/stream");
    }
}
