# R3.21 Linux Xvfb/Openbox DevUrl Smoke

Date: 2026-06-11

Host: `mycyg@192.168.5.53`

Result: pass for Linux compile/build/test and headless X11 window/render smoke. This does not prove physical Linux tray menu click because the remote session has no real desktop panel.

Evidence:

- `desktop-webview-test.txt`: 82/82 pass.
- `desktop-webview-build.txt`: Vite build pass.
- `cargo-test.txt`: Tauri Rust tests pass.
- `cargo-build.txt`: debug binary build pass.
- `wmctrl.txt`: `WorkHub` and `Cuu` windows visible.
- `xwininfo.txt`: `WorkHub 1180x780`, `Cuu 520x720`, tray icon `16x16`.
- `screen.png`: main window and independent Cuu pet window rendered under Xvfb/openbox.
- `cuu-tauri-dom-report.json`: `data_pet_window_height=720`, bubble and surface horizontal overflow are false.

Known limits:

- The remote Linux login is `tty` with no native `DISPLAY`, `WAYLAND_DISPLAY`, or `XDG_CURRENT_DESKTOP`.
- Xvfb/openbox can show the tray icon X window but does not provide a real GNOME/KDE/Xfce appindicator panel for physical tray menu click recovery.
- The smoke uses Tauri debug `devUrl`, so Vite on `127.0.0.1:1420` must be running.
