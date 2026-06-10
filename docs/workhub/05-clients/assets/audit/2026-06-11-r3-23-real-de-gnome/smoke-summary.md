# R3.23 GNOME real-DE smoke evidence

Date: 2026-06-11

Remote host: `192.168.5.53`, user `mycyg`

Repo head: `2e2e1b4e10ec5b8671999b89e576fb0325505ba5`

## Result

This run proves the Linux GNOME real desktop bridge can start the Tauri app from SSH when `DISPLAY`, `WAYLAND_DISPLAY`, DBus and Xauthority are bridged into the smoke process. It does not yet prove tray menu action clicks, because the GNOME session did not provide `org.kde.StatusNotifierWatcher`.

## Passing evidence

- `linux-env-report.txt`: real GNOME/Wayland session bridge with `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`, `XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.1SGUP3`, DBus, Node 22.22.1, pnpm 11.0.9, Cargo/Rust 1.93.1.
- `wmctrl.txt`: reports both `WorkHub` and `Cuu` windows.
- `xwininfo.txt`: reports a `Cuu` 520x720 window and the Tauri tray icon X window.
- `screen.png` / `screen-identify.txt`: root screenshot capture produced a 1100x3840 PNG, but it is visually black under this GNOME/remote session and is not used as UI acceptance evidence.
- `cuu-tauri-dom-report.json`: `data_pet_window_height=720`, no horizontal/vertical overflow, `spatial_safety.bubble_overlaps_live2d=false`, failed run card keeps context sections.
- `desktop-webview-test.txt`, `desktop-webview-build.txt`, `cargo-test.txt`, `cargo-build.txt` remained passing on the remote clone.

## Blocking evidence

- `linux-status-notifier-items.err.txt`: `org.kde.StatusNotifierWatcher` is not provided by the session.
- `gnome-appindicator-status.txt`: `ubuntu-appindicators@ubuntu.com` is installed and enabled, but GNOME reports it as `INACTIVE`; DBus still has no StatusNotifier/AppIndicator watcher.
- `linux-x11-tray-owner.txt`: `_NET_SYSTEM_TRAY_S0` is not present.
- `screen.png`: GNOME root capture is black; future visual proof should use per-window capture while the app is still running or a session with screen-capture permission.

## Next

Restart or recreate the GNOME desktop session after enabling `ubuntu-appindicators@ubuntu.com`, then rerun `WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1`. If the watcher appears, the existing DBus menu action matrix can continue to `GetLayout` / `Event(clicked)` proof. If it remains absent, add an explicit X11 tray-icon fallback driver and document that it is not AppIndicator panel proof.
