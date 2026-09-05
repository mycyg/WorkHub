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

/// R25-Q：壳层对外的"连接状态单一真相"——三窗（工作台头部/主窗聚焦盒顶部细条/桌宠离线卡）只认这三个
/// 值，不再各自拿 `ShellSseConnectionState`（per-subscription 的 Connecting/Open/Retrying/Closed 四态）
/// 去猜一遍（那正是 `r24-S5-reverify.md` 项 9 记录的"三窗各说各话"的根因——三份猜测代码，此前就已经
/// 实际漂移过）。`snake_case` 序列化后正是 webview 三处订阅代码认的字面量："connected" / "reconnecting"
/// / "offline"。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellConnectionState {
    Connected,
    Reconnecting,
    Offline,
}

/// `workhub-connection-changed` 广播 / `get_connection_state` 命令的返回体——同一个形状两处复用，
/// 三窗 boot 时拉的初值与运行期收到的广播必须是同一个契约，否则初值判定和后续迁移会对不上。
///
/// - `server_url`：当前壳层连的服务器地址（三窗文案里都要点名"连不上服务器 <地址>"，不能只说"连不上"）；
/// - `since_ms`：进入当前 `state` 的 unix 毫秒时间戳——只在 `state` 本身变化时更新，同一状态里 `attempt`
///   涨（重连计次）不会推迟它；
/// - `attempt`：连续失败的重连尝试次数。`state == connected` 时恒为 0；`offline` 之后不再继续累计
///   （复用跨过 `CONNECTION_OFFLINE_AFTER_ATTEMPTS` 那一刻定住的值——离线文案不展示计次，见
///   `next_shell_connection_payload`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellConnectionChangedPayload {
    pub state: ShellConnectionState,
    pub server_url: String,
    pub since_ms: u64,
    pub attempt: u32,
}

impl Default for ShellConnectionChangedPayload {
    /// 应用刚起、SSE worker 还没来得及跑出第一次真实判定时的占位值——`get_connection_state` 在这个
    /// 窗口期被窗口 boot 调到也能拿到一个不撒谎的答案："reconnecting"（正在尝试，不是已经离线，也
    /// 还不能断言已连上）好过凭空断言 connected。真实的第一次判定通常在这之后几百毫秒内就到达并覆盖它。
    fn default() -> Self {
        Self {
            state: ShellConnectionState::Reconnecting,
            server_url: String::new(),
            since_ms: 0,
            attempt: 0,
        }
    }
}

/// 连续多少次重连失败之后，对外摘要从"reconnecting"翻成"offline"。三窗文案在这条线两侧不同
/// （桌宠："重连中（第 N 次）" vs "已离线"；主窗/工作台同理）——纯常量，不是魔数散落各处。
/// 5s 基准退避下（`sse_worker::reconnect_backoff`）三次失败约合 5s+10s+20s=35s，给瞬时抖动/短暂
/// 服务重启留出不喊"离线"的宽限，又不会让真正断线的用户等太久才看到诚实的状态。
pub const CONNECTION_OFFLINE_AFTER_ATTEMPTS: u32 = 3;

/// 把 SSE worker 内部的 `ShellSseConnectionState`（per-subscription、协议粒度）机械收敛成对外三态。
/// 纯函数，状态机的"迁移判定"这一半单独可测，不需要真的起一条 tokio 任务。
///
/// - `Open` → `Connected`（`consecutive_failures` 此时总是 0——调用方在判定 Open 前已经复位过）；
/// - `Closed` → `Offline`（协议层面已经放弃这条连接；目前 SSE worker 还不会主动进入这个状态，纯粹
///   为了 match 穷尽——一旦未来真的用上，行为已经是对的）；
/// - `Connecting` / `Retrying`：还在尝试。`consecutive_failures` 越过阈值前是 `Reconnecting`，
///   之后是 `Offline`——同一个"还在试"的动作，只是对用户的诚实程度不同。
pub fn shell_connection_state_for(
    sse_state: ShellSseConnectionState,
    consecutive_failures: u32,
) -> ShellConnectionState {
    match sse_state {
        ShellSseConnectionState::Open => ShellConnectionState::Connected,
        ShellSseConnectionState::Closed => ShellConnectionState::Offline,
        ShellSseConnectionState::Connecting | ShellSseConnectionState::Retrying => {
            if consecutive_failures >= CONNECTION_OFFLINE_AFTER_ATTEMPTS {
                ShellConnectionState::Offline
            } else {
                ShellConnectionState::Reconnecting
            }
        }
    }
}

/// 状态机的"要不要广播"这一半：给定上一次广播出去的 payload 与这一拍的原始输入，算出下一份 payload——
/// 三态摘要、`attempt` 或 `server_url` 任一变了才 `Some`（真正的一次"迁移"），否则 `None`（沙场同一
/// 状态里的虚假唤醒/重复 tick，不值得再广播一次、不该让三窗各自多渲一帧）。纯函数，便于单测钉死
/// 迁移边界，不用真的跑 SSE worker。
///
/// `since_ms` 只在三态摘要本身变化时前进到 `now_ms`；`attempt` 在同一 `state` 里可以独立变化
/// （reconnecting 阶段每次重试都想让"第 N 次"跟着涨），互不影响。`state == connected` 时 `attempt`
/// 固定收作 0（不管 `consecutive_failures` 传进来是什么——连上了就没有"第几次"这回事）；`offline` 时
/// `attempt` 定格在跨过阈值那一刻的值，之后哪怕 `consecutive_failures` 继续涨也不再体现进 payload
/// （离线文案本就不展示计次，没必要为不会显示的数字重复广播）。
pub fn next_shell_connection_payload(
    previous: &ShellConnectionChangedPayload,
    sse_state: ShellSseConnectionState,
    consecutive_failures: u32,
    server_url: &str,
    now_ms: u64,
) -> Option<ShellConnectionChangedPayload> {
    let state = shell_connection_state_for(sse_state, consecutive_failures);
    let attempt = match state {
        ShellConnectionState::Connected => 0,
        ShellConnectionState::Offline if previous.state == ShellConnectionState::Offline => {
            previous.attempt
        }
        ShellConnectionState::Offline | ShellConnectionState::Reconnecting => consecutive_failures,
    };
    if state == previous.state && attempt == previous.attempt && server_url == previous.server_url {
        return None;
    }
    let since_ms = if state == previous.state {
        previous.since_ms
    } else {
        now_ms
    };
    Some(ShellConnectionChangedPayload {
        state,
        server_url: server_url.to_string(),
        since_ms,
        attempt,
    })
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

pub fn startup_shell_sse_targets(_config: &WorkHubShellConfig) -> Vec<ShellSseTarget> {
    // 桌面 = 单用户客户端：只订阅 per-user `/api/push/stream/me`（承载本用户的通知/决策事件——
    // notifications.ts 发到 topics.user，topic-access.ts {kind:"me"} 解析到同一话题）。运行时设备令牌
    // 经 set_client_token 注入鉴权头后该流 200。
    // 绝不订阅全局 `/api/push/stream`——"all" 话题仅管理员可读（topic-access.ts:34），而 desktop-bootstrap
    // 铸的是非管理员用户 → 全局流恒 403 "cannot stream global events" → Cuu 永远「重连中」(这是根因)。
    vec![ShellSseTarget::Me]
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

// R4 #29：单个未终止 SSE 残片（无 `\n\n` 帧边界）的累积上限。超过即视为畸形/滥用流，丢弃以防内存耗尽
// 与每 chunk 全量扫描的 O(n^2)。1 MiB 远超任何正常 agent 事件帧。sse_worker 也复用此常量做硬错误中断。
pub const MAX_SSE_PENDING_BYTES: usize = 1024 * 1024;

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
        // R4 #29：防御无界缓冲——排空完整帧后仍超上限说明是一段过大的未终止残片，丢弃以约束内存。
        // 生产路径下 sse_worker 只喂完整帧、不会触发；此为独立/异常使用时的兜底。
        if self.pending.len() > MAX_SSE_PENDING_BYTES {
            self.pending.clear();
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
            locale: crate::locale::WorkHubLocale::EnUs,
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
    fn startup_targets_subscribe_to_the_per_user_stream_not_the_admin_only_global() {
        // 修 Cuu「重连中」：桌面是非管理员单用户客户端，读全局 `/api/push/stream` 恒 403，
        // 故启动只订 per-user `/me`（运行时设备令牌经 set_client_token 鉴权），无论 config 是否带 token。
        let mut without_token = config();
        without_token.client_token = None;
        let with_token = config();

        assert_eq!(
            startup_shell_sse_targets(&without_token),
            vec![ShellSseTarget::Me]
        );
        assert_eq!(
            startup_shell_sse_targets(&with_token),
            vec![ShellSseTarget::Me]
        );
    }

    #[test]
    fn worker_plan_keeps_retry_policy_and_subscription_headers() {
        let plan = plan_shell_sse_worker(&config(), startup_shell_sse_targets(&config()), 5_000)
            .expect("worker plan should build");

        assert_eq!(plan.reconnect_delay_ms, 5_000);
        assert_eq!(plan.subscriptions.len(), 1);
        assert_eq!(plan.subscriptions[0].path, "/api/push/stream/me");
        assert_eq!(plan.subscriptions[0].headers.len(), 2);
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

    // R25-Q：连接状态单一真相——三态摘要的推导 + 迁移判定，纯函数单测钉死状态机边界。

    #[test]
    fn connection_state_maps_open_to_connected_regardless_of_failure_count() {
        // Open 只会在 consecutive_failures 已经复位为 0 时判定（调用方保证），但函数本身对任意计数
        // 都该忽略它——Open 就是 Connected，没有"部分连接"这回事。
        assert_eq!(
            shell_connection_state_for(ShellSseConnectionState::Open, 0),
            ShellConnectionState::Connected
        );
        assert_eq!(
            shell_connection_state_for(ShellSseConnectionState::Open, 9),
            ShellConnectionState::Connected
        );
    }

    #[test]
    fn connection_state_maps_closed_to_offline() {
        assert_eq!(
            shell_connection_state_for(ShellSseConnectionState::Closed, 0),
            ShellConnectionState::Offline
        );
    }

    #[test]
    fn connection_state_stays_reconnecting_below_the_offline_threshold() {
        for state in [
            ShellSseConnectionState::Connecting,
            ShellSseConnectionState::Retrying,
        ] {
            for failures in 0..CONNECTION_OFFLINE_AFTER_ATTEMPTS {
                assert_eq!(
                    shell_connection_state_for(state, failures),
                    ShellConnectionState::Reconnecting,
                    "state={state:?} failures={failures}"
                );
            }
        }
    }

    #[test]
    fn connection_state_flips_to_offline_at_the_threshold_and_beyond() {
        for state in [
            ShellSseConnectionState::Connecting,
            ShellSseConnectionState::Retrying,
        ] {
            assert_eq!(
                shell_connection_state_for(state, CONNECTION_OFFLINE_AFTER_ATTEMPTS),
                ShellConnectionState::Offline
            );
            assert_eq!(
                shell_connection_state_for(state, CONNECTION_OFFLINE_AFTER_ATTEMPTS + 50),
                ShellConnectionState::Offline
            );
        }
    }

    #[test]
    fn connection_payload_shape_serializes_the_three_literal_states_webview_expects() {
        // 三窗订阅代码按这些字面量分支——改了任一个就是静默把三窗的连接横幅/卡片全部打哑。
        let connected = ShellConnectionChangedPayload {
            state: ShellConnectionState::Connected,
            server_url: "http://127.0.0.1:8787".to_string(),
            since_ms: 1_000,
            attempt: 0,
        };
        let json = serde_json::to_value(&connected).unwrap();
        assert_eq!(
            json["state"],
            serde_json::Value::String("connected".to_string())
        );
        assert_eq!(
            json["server_url"],
            serde_json::Value::String("http://127.0.0.1:8787".to_string())
        );
        assert_eq!(json["since_ms"], serde_json::Value::from(1_000));
        assert_eq!(json["attempt"], serde_json::Value::from(0));

        assert_eq!(
            serde_json::to_value(ShellConnectionState::Reconnecting).unwrap(),
            serde_json::Value::String("reconnecting".to_string())
        );
        assert_eq!(
            serde_json::to_value(ShellConnectionState::Offline).unwrap(),
            serde_json::Value::String("offline".to_string())
        );
    }

    #[test]
    fn connection_payload_default_is_an_honest_pre_first_attempt_placeholder() {
        // 应用刚起、SSE worker 还没跑出第一次真实判定前，`get_connection_state` 拿到的就是这份默认值——
        // 断言它是"reconnecting"而不是凭空断言"connected"（那会在真正连不上时短暂撒谎）。
        let default = ShellConnectionChangedPayload::default();
        assert_eq!(default.state, ShellConnectionState::Reconnecting);
        assert_eq!(default.attempt, 0);
    }

    #[test]
    fn connection_transition_is_none_when_nothing_meaningful_changed() {
        let previous = ShellConnectionChangedPayload {
            state: ShellConnectionState::Connected,
            server_url: "http://127.0.0.1:8787".to_string(),
            since_ms: 1_000,
            attempt: 0,
        };
        // 同一状态、同一地址、同一 attempt（Open 恒 0）——虚假唤醒/重复 tick，不该广播第二次。
        assert_eq!(
            next_shell_connection_payload(
                &previous,
                ShellSseConnectionState::Open,
                0,
                "http://127.0.0.1:8787",
                2_000
            ),
            None
        );
    }

    #[test]
    fn connection_transition_fires_on_the_first_ever_judgement() {
        // 默认占位值 → 第一次真实判定（Open）：状态从 reconnecting 变成 connected，必须是一次迁移。
        let previous = ShellConnectionChangedPayload::default();
        let next = next_shell_connection_payload(
            &previous,
            ShellSseConnectionState::Open,
            0,
            "http://127.0.0.1:8787",
            5_000,
        )
        .expect("first judgement after boot must be a transition");
        assert_eq!(next.state, ShellConnectionState::Connected);
        assert_eq!(next.attempt, 0);
        assert_eq!(next.since_ms, 5_000);
        assert_eq!(next.server_url, "http://127.0.0.1:8787");
    }

    #[test]
    fn connection_transition_keeps_since_ms_while_attempt_climbs_in_the_same_state() {
        // reconnecting 阶段每次重试 attempt 涨都要广播（桌宠"重连中(第 N 次)"需要活的数字），
        // 但 since_ms（"进入这个状态是什么时候"）不该跟着每次重试往后挪。
        let previous = ShellConnectionChangedPayload {
            state: ShellConnectionState::Reconnecting,
            server_url: "http://127.0.0.1:8787".to_string(),
            since_ms: 1_000,
            attempt: 1,
        };
        let next = next_shell_connection_payload(
            &previous,
            ShellSseConnectionState::Retrying,
            2,
            "http://127.0.0.1:8787",
            9_000,
        )
        .expect("attempt count climbing is a transition");
        assert_eq!(next.state, ShellConnectionState::Reconnecting);
        assert_eq!(next.attempt, 2);
        assert_eq!(
            next.since_ms, 1_000,
            "since_ms must not move within the same state"
        );
    }

    #[test]
    fn connection_transition_flips_to_offline_and_resets_since_ms_at_the_threshold() {
        let previous = ShellConnectionChangedPayload {
            state: ShellConnectionState::Reconnecting,
            server_url: "http://127.0.0.1:8787".to_string(),
            since_ms: 1_000,
            attempt: CONNECTION_OFFLINE_AFTER_ATTEMPTS - 1,
        };
        let next = next_shell_connection_payload(
            &previous,
            ShellSseConnectionState::Retrying,
            CONNECTION_OFFLINE_AFTER_ATTEMPTS,
            "http://127.0.0.1:8787",
            40_000,
        )
        .expect("crossing the offline threshold is a transition");
        assert_eq!(next.state, ShellConnectionState::Offline);
        assert_eq!(next.attempt, CONNECTION_OFFLINE_AFTER_ATTEMPTS);
        assert_eq!(
            next.since_ms, 40_000,
            "since_ms resets when the summary state itself changes"
        );
    }

    #[test]
    fn connection_transition_pins_the_attempt_count_while_offline_persists() {
        // 已经离线之后 consecutive_failures 继续涨（每 60s 封顶退避仍在重试）——但离线文案不展示计次，
        // attempt 定格在跨过阈值那一刻，不用为一个不会显示的数字反复广播/让三窗反复重渲。
        let previous = ShellConnectionChangedPayload {
            state: ShellConnectionState::Offline,
            server_url: "http://127.0.0.1:8787".to_string(),
            since_ms: 40_000,
            attempt: CONNECTION_OFFLINE_AFTER_ATTEMPTS,
        };
        assert_eq!(
            next_shell_connection_payload(
                &previous,
                ShellSseConnectionState::Retrying,
                CONNECTION_OFFLINE_AFTER_ATTEMPTS + 7,
                "http://127.0.0.1:8787",
                100_000
            ),
            None,
            "still offline with a pinned attempt count is not a new transition"
        );
    }

    #[test]
    fn connection_transition_fires_when_only_the_server_url_changes() {
        // 换服务器（set_server_url）时哪怕两边判定出的三态摘要和 attempt 恰好相同，地址本身变了
        // 也必须广播——三窗文案要点名"连不上服务器 <地址>"，不能沿用旧地址的文本。
        let previous = ShellConnectionChangedPayload {
            state: ShellConnectionState::Reconnecting,
            server_url: "http://127.0.0.1:8787".to_string(),
            since_ms: 1_000,
            attempt: 1,
        };
        let next = next_shell_connection_payload(
            &previous,
            ShellSseConnectionState::Retrying,
            1,
            "https://workhub.example.com",
            1_500,
        )
        .expect("a server address change is itself a transition");
        assert_eq!(next.server_url, "https://workhub.example.com");
        assert_eq!(next.state, ShellConnectionState::Reconnecting);
        assert_eq!(next.since_ms, 1_000);
    }

    #[test]
    fn connection_transition_recovering_resets_attempt_and_since_ms() {
        let previous = ShellConnectionChangedPayload {
            state: ShellConnectionState::Offline,
            server_url: "http://127.0.0.1:8787".to_string(),
            since_ms: 40_000,
            attempt: CONNECTION_OFFLINE_AFTER_ATTEMPTS,
        };
        let next = next_shell_connection_payload(
            &previous,
            ShellSseConnectionState::Open,
            0,
            "http://127.0.0.1:8787",
            120_000,
        )
        .expect("recovering from offline to connected is a transition");
        assert_eq!(next.state, ShellConnectionState::Connected);
        assert_eq!(next.attempt, 0);
        assert_eq!(next.since_ms, 120_000);
    }
}
