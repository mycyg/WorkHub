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
    }
}
