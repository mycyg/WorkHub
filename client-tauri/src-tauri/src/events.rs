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
    }
}
