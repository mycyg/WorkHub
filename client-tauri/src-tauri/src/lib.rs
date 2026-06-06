pub mod config;
pub mod deep_link;
pub mod events;
pub mod http;
pub mod notify;
pub mod pet_commands;
pub mod pet_window;
pub mod sse;
pub mod sse_worker;
pub mod tray;
pub mod window_controls;
pub mod windows;

pub const RUST_SHELL_OWNS: &[&str] = &[
    "base_url",
    "device_token",
    "tray",
    "tray_menu",
    "deep_link",
    "system_notification",
    "window_plan",
    "window_control",
    "pet_window",
    "pet_window_geometry",
    "pet_window_drag",
    "pet_window_commands",
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
