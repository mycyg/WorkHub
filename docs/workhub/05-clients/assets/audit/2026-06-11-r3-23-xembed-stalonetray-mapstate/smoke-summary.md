# R3.23 XEmbed stalonetray Map State smoke

Date: 2026-06-11

Remote: `192.168.5.53` GNOME Wayland session via SSH -> `DISPLAY=:0`

Commit: `883fbd82a5731fcbf9ecb443f5067d12f390f00e`

Command shape:

```bash
WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 \
WORKHUB_LINUX_MENU_DRIVER=x11-tray-icon \
WORKHUB_LINUX_X11_TRAY_HOST=stalonetray \
WORKHUB_CUU_QA_SCENARIO=run-failure \
WORKHUB_CUU_QA_LOCALE=en-US \
bash scripts/qa/cuu-tauri-linux-smoke.sh
```

Result: pass.

Key evidence:

- `status.txt`: `ok`
- `linux-smoke-mode.txt`: `real_de_tray_menu_smoke_done`
- `linux-menu-action-status.txt`: `driver=x11-tray-icon`, `x11_tray_host=stalonetray`, action matrix ended with `ok`
- `linux-env-report.txt`: GNOME Wayland, `XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.1SGUP3`, commit `883fbd82a5731fcbf9ecb443f5067d12f390f00e`
- `linux-menu-action-after-restore-pet-interaction-window-states.txt`: `Cuu` is `Map State: IsViewable`
- `linux-menu-action-after-toggle-pet-window-states.txt`: `Cuu` is `Map State: IsUnMapped`, while `WorkHub` stays `IsViewable`
- `linux-menu-action-after-hide-main-window-states.txt`: `WorkHub` and `Cuu` are both `Map State: IsUnMapped`
- `linux-menu-action-after-quit-ps-app.txt`: app process remains alive under `WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN=1`
- `cuu-tauri-dom-report.json`: `surface.horizontal_overflow=false`, `surface.vertical_overflow=false`, `bubble.horizontal_overflow=false`, `bubble.vertical_overflow=false`, `spatial_safety.bubble_overlaps_live2d=false`

Boundary:

- This proves a physical XEmbed tray host path using `stalonetray`; it does not prove native GNOME AppIndicator / StatusNotifier panel integration.
- `wmctrl -l` still segfaulted intermittently in this GNOME/XWayland/stalonetray combination, so pass/fail does not depend on `wmctrl`. The script uses `xwininfo -id ... -stats` and `Map State: IsViewable` for window visibility.
- `screen.png` and per-action screenshots were captured, but the remote GNOME root capture is black. They are retained as environment artifacts, not visual UI acceptance evidence.
