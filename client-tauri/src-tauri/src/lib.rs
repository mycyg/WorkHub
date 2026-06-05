pub mod config;
pub mod events;
pub mod http;

pub const RUST_SHELL_OWNS: &[&str] = &[
    "base_url",
    "device_token",
    "tray",
    "deep_link",
    "system_notification",
    "local_file_sync",
];

pub const RUST_SHELL_DOES_NOT_OWN: &[&str] = &[
    "permission_policy",
    "workitem_status_machine",
    "approval_routing",
    "domain_dto",
];
