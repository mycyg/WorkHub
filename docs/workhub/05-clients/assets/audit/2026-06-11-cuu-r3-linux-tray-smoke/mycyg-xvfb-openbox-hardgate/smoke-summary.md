# R3.21 Linux Xvfb/Openbox Hardgate

- Host: `mycyg@192.168.5.53`
- Command: `WORKHUB_LINUX_SMOKE_OUT_DIR=/tmp/workhub-r3-linux-smoke-20260611-hardgate5 WORKHUB_LINUX_SMOKE_WAIT_SECONDS=18 bash scripts/qa/cuu-tauri-linux-smoke.sh`
- Result: exit code 0, `status.txt=ok`
- Cleanup check: a follow-up `ps` scan for the WorkHub Vite/1420 process printed no process rows.

Hard gates enforced by `scripts/qa/cuu-tauri-linux-smoke.sh`:

- Refuses to start if `127.0.0.1:1420` is already occupied, so it cannot reuse a stale Vite server.
- Fails if the launched Vite process exits before the devUrl is ready.
- Cleans the launched Vite wrapper and scoped Vite child process after capture.
- `pnpm --filter @workhub/desktop-webview test`
- `pnpm --filter @workhub/desktop-webview build`
- `cargo test --manifest-path client-tauri/src-tauri/Cargo.toml`
- `cargo build --manifest-path client-tauri/src-tauri/Cargo.toml`
- Xvfb/openbox smoke with Vite devUrl on `127.0.0.1:1420`
- `wmctrl.txt` contains both `WorkHub` and `Cuu`
- `xwininfo.txt` contains `Cuu 520x720`
- `screen.png` exists
- `cuu-tauri-dom-report.json` exists and reports `data_pet_window_height="720"`
- surface and bubble `horizontal_overflow=false`

Observed limitation:

- The remote session is `tty` without a real GNOME/KDE/Xfce panel, so this proves Linux build/window/pet text hard gates, not a physical appindicator menu click.
