use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShellEvent {
    PushEvent,
    SseStatus,
    Navigate,
    DeepLink,
    TrayAction,
    SystemNotification,
    SingleInstance,
    /// S5：壳层服务器地址已变更（`set_server_url`）。三窗订阅它自行 reload，照 `workhub-logged-out`
    /// 那条既有广播的模式来——不新造协议。
    ServerChanged,
    /// R25-Q：壳层"连接状态单一真相"——SSE worker 在判定出的三态（connected/reconnecting/offline）
    /// 迁移时 emit 这个事件（payload 见 `sse::ShellConnectionChangedPayload`）。三窗（工作台头部状态词/
    /// 主窗聚焦盒顶部细条/桌宠离线卡）只从这一个事件取状态，不再各自从 `sse-status`（per-subscription
    /// 原始信号）猜一遍——那曾经三窗各说各话（`r24-S5-reverify.md` 项 9）。`get_connection_state`
    /// 命令供窗口 boot 时拉初值，不必等下一次真实迁移才第一次知道状态。
    ConnectionChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellEventChannel {
    pub event: ShellEvent,
    pub channel: String,
}

pub fn event_channel(event: ShellEvent) -> ShellEventChannel {
    ShellEventChannel {
        channel: event_channel_name(event.clone()).to_string(),
        event,
    }
}

pub fn event_channel_name(event: ShellEvent) -> &'static str {
    match event {
        ShellEvent::PushEvent => "push-event",
        ShellEvent::SseStatus => "sse-status",
        ShellEvent::Navigate => "navigate",
        ShellEvent::DeepLink => "deep-link",
        ShellEvent::TrayAction => "tray-action",
        ShellEvent::SystemNotification => "system-notification",
        ShellEvent::SingleInstance => "single-instance",
        ShellEvent::ServerChanged => "workhub-server-changed",
        ShellEvent::ConnectionChanged => "workhub-connection-changed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_tauri_channel_names_stable() {
        assert_eq!(event_channel_name(ShellEvent::PushEvent), "push-event");
        assert_eq!(event_channel_name(ShellEvent::SseStatus), "sse-status");
        assert_eq!(
            event_channel_name(ShellEvent::SystemNotification),
            "system-notification"
        );
        assert_eq!(event_channel_name(ShellEvent::DeepLink), "deep-link");
        assert_eq!(
            event_channel_name(ShellEvent::SingleInstance),
            "single-instance"
        );
        // 三窗（browser.ts / workbench/boot.ts / pet-surface.ts）按这个字面量订阅换服务器广播；
        // 改名等于让另外两个窗口悄悄停在旧服务器上。
        assert_eq!(
            event_channel_name(ShellEvent::ServerChanged),
            "workhub-server-changed"
        );
        // R25-Q：同上——三窗按这个字面量订阅连接状态广播，改名等于让三窗的连接横幅/卡片悄悄停摆。
        assert_eq!(
            event_channel_name(ShellEvent::ConnectionChanged),
            "workhub-connection-changed"
        );
    }
}
