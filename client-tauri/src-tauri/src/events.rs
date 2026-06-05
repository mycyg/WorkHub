#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellEvent {
    PushEvent,
    SseStatus,
    Navigate,
    TrayAction,
    SystemNotification,
}

pub fn event_channel_name(event: ShellEvent) -> &'static str {
    match event {
        ShellEvent::PushEvent => "push-event",
        ShellEvent::SseStatus => "sse-status",
        ShellEvent::Navigate => "navigate",
        ShellEvent::TrayAction => "tray-action",
        ShellEvent::SystemNotification => "system-notification",
    }
}
