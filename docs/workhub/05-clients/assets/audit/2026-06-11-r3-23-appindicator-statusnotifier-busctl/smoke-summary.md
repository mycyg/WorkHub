# R3.23 GNOME AppIndicator / StatusNotifier Smoke Summary

Date: 2026-06-11

Host: `192.168.5.53` / `ubuntu:GNOME` / `XDG_SESSION_TYPE=wayland`

Result: pass

## Command Shape

```bash
WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 \
WORKHUB_LINUX_MENU_DRIVER=status-notifier \
WORKHUB_CUU_QA_SCENARIO=run-failure \
WORKHUB_CUU_QA_LOCALE=en-US \
bash scripts/qa/cuu-tauri-linux-smoke.sh
```

The remote GNOME session required `ayatana-indicator-application.service` so `org.kde.StatusNotifierWatcher` existed on the session bus.

## Evidence

| Gate | Evidence |
|---|---|
| StatusNotifier watcher | `linux-status-notifier-items.txt` includes WorkHub at `:1.771/org/ayatana/NotificationItem/tray_icon_tray_app_workhub_main_tray` |
| DBusMenu path | `linux-status-notifier-menu-path.raw.txt` returns `/org/ayatana/NotificationItem/tray_icon_tray_app_workhub_main_tray/Menu` |
| Menu layout parser | `linux-dbusmenu-layout-restore-pet-interaction-summary.json` maps `Restore Cuu interaction` to item id `6`; all expected labels are present |
| Menu Event calls | `linux-dbusmenu-event-*.err.txt` files are empty for restore/settings/inbox/toggle/show/hide/quit |
| Window effects | `linux-menu-action-status.txt` ends with `ok`; per-action `*-window-states.txt` files use `Map State: IsViewable` / `IsUnMapped` gates |
| Text/frame | `cuu-tauri-dom-report.json` reports `horizontal_overflow=false`, `vertical_overflow=false`, `bubble_overlaps_live2d=false`, and `bubble_gap_to_live2d_px=22.04` |
| Test/build | `desktop-webview-test.txt`, `desktop-webview-build.txt`, `cargo-test.txt`, and `cargo-build.txt` are present |

## Fixes Proven

- `scripts/qa/cuu-tauri-linux-smoke.sh` now parses compact `busctl` DBusMenu layout output.
- DBusMenu layout uses `busctl ... GetLayout iias 0 1 0`, avoiding the earlier `-1` argument being parsed as a busctl option.
- R3.22 text/frame gate is stricter after the user screenshot: run cards must keep at least 8 px between bubble and Live2D; this run measured 22.04 px.

## Boundary

This proves GNOME session-bus StatusNotifier / AppIndicator menu action automation on Linux. It does not prove macOS menu bar behavior. The screen PNGs from this remote GNOME session are black/environment artifacts and are not used as visual UI acceptance; the DOM and window-state files are the acceptance evidence here.
