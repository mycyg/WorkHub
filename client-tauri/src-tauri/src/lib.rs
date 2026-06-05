pub mod config;
pub mod events;
pub mod http;
pub mod sse;

pub const RUST_SHELL_OWNS: &[&str] = &[
    "base_url",
    "device_token",
    "tray",
    "deep_link",
    "system_notification",
    "sse_worker",
    "sse_frame_parser",
    "local_file_sync",
];

pub const RUST_SHELL_DOES_NOT_OWN: &[&str] = &[
    "permission_policy",
    "workitem_status_machine",
    "approval_routing",
    "domain_dto",
    "cuu_animation_state",
];
