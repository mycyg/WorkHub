#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
out_dir="${WORKHUB_LINUX_SMOKE_OUT_DIR:-/tmp/workhub-cuu-tauri-linux-smoke}"
wait_seconds="${WORKHUB_LINUX_SMOKE_WAIT_SECONDS:-22}"
scenario="${WORKHUB_CUU_QA_SCENARIO:-run-failure}"
locale="${WORKHUB_CUU_QA_LOCALE:-en-US}"
port="1420"

if [ -n "${WORKHUB_LINUX_SMOKE_DEV_PORT:-}" ] && [ "${WORKHUB_LINUX_SMOKE_DEV_PORT}" != "$port" ]; then
  echo "WORKHUB_LINUX_SMOKE_DEV_PORT must stay 1420 because tauri.conf.json devUrl is fixed to http://127.0.0.1:1420." >&2
  exit 1
fi

mkdir -p "$out_dir"

record_env() {
  {
    echo "captured_at=$(date -Is)"
    echo "repo=$repo_root"
    echo "head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)"
    echo "uname=$(uname -a)"
    echo "session_type=${XDG_SESSION_TYPE:-}"
    echo "display=${DISPLAY:-}"
    echo "wayland_display=${WAYLAND_DISPLAY:-}"
    echo "desktop=${XDG_CURRENT_DESKTOP:-}"
    echo "node=$(node -v 2>/dev/null || true)"
    echo "pnpm=$(pnpm -v 2>/dev/null || true)"
    echo "cargo=$(cargo -V 2>/dev/null || true)"
    echo "rustc=$(rustc -V 2>/dev/null || true)"
    echo "xvfb_run=$(command -v xvfb-run || true)"
    echo "openbox=$(command -v openbox || true)"
    echo "wmctrl=$(command -v wmctrl || true)"
    echo "xdotool=$(command -v xdotool || true)"
    echo "scrot=$(command -v scrot || true)"
  } > "$out_dir/linux-env-report.txt"
}

wait_for_vite() {
  for _ in $(seq 1 80); do
    if ! kill -0 "$vite_pid" >/dev/null 2>&1; then
      echo "Vite dev server process exited early. See $out_dir/vite-dev.txt." >&2
      return 1
    fi
    if port_is_open 127.0.0.1 "$port"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

port_is_open() {
  local host="$1"
  local check_port="$2"
  python3 - "$host" "$check_port" >/dev/null 2>&1 <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket()
sock.settimeout(0.2)
sock.connect((host, port))
sock.close()
PY
}

run_desktop_smoke() {
  cd "$repo_root"
  rm -f "$out_dir"/screen*.png "$out_dir"/cuu-tauri-dom-report.json

  export NO_AT_BRIDGE=1
  export GDK_BACKEND=x11
  export LIBGL_ALWAYS_SOFTWARE=1
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
  export WEBKIT_DISABLE_COMPOSITING_MODE=1

  if port_is_open 127.0.0.1 "$port"; then
    echo "127.0.0.1:$port is already in use before this smoke starts; refusing to reuse a stale dev server." >&2
    return 1
  fi

  pnpm --filter @workhub/desktop-webview dev -- --host 127.0.0.1 --port "$port" > "$out_dir/vite-dev.txt" 2>&1 &
  vite_pid=$!

  wm_pid=""
  app_pid=""
  cleanup() {
    if [ -n "$app_pid" ]; then kill "$app_pid" >/dev/null 2>&1 || true; fi
    if [ -n "$vite_pid" ] && command -v pkill >/dev/null 2>&1; then pkill -TERM -P "$vite_pid" >/dev/null 2>&1 || true; fi
    if [ -n "$vite_pid" ]; then kill "$vite_pid" >/dev/null 2>&1 || true; fi
    if command -v pkill >/dev/null 2>&1; then pkill -TERM -f "$repo_root/apps/desktop-webview/.*vite.*--port $port" >/dev/null 2>&1 || true; fi
    if [ -n "$wm_pid" ]; then kill "$wm_pid" >/dev/null 2>&1 || true; fi
  }
  trap cleanup RETURN

  if ! wait_for_vite; then
    echo "Vite dev server did not open 127.0.0.1:$port." >&2
    return 1
  fi

  if command -v openbox >/dev/null 2>&1; then
    openbox > "$out_dir/openbox.txt" 2>&1 &
    wm_pid=$!
    sleep 2
  else
    echo "openbox not found; continuing without a window manager" > "$out_dir/openbox.txt"
  fi

  export WORKHUB_DISABLE_SSE=1
  export WORKHUB_CUU_QA_SCENARIO="$scenario"
  export WORKHUB_CUU_QA_LOCALE="$locale"
  export WORKHUB_CUU_QA_RUN_OUTCOME="${WORKHUB_CUU_QA_RUN_OUTCOME:-failed}"
  export WORKHUB_CUU_QA_DOM_REPORT_PATH="$out_dir/cuu-tauri-dom-report.json"

  "$repo_root/client-tauri/src-tauri/target/debug/workhub-client-tauri" > "$out_dir/app-stdout.txt" 2>&1 &
  app_pid=$!
  echo "$app_pid" > "$out_dir/app.pid"

  sleep "$wait_seconds"

  ps -p "$app_pid" -o pid,stat,etime,cmd > "$out_dir/ps-app.txt" 2>&1 || true
  ps -p "$vite_pid" -o pid,stat,etime,cmd > "$out_dir/ps-vite.txt" 2>&1 || true
  wmctrl -l > "$out_dir/wmctrl.txt" 2>&1 || true
  {
    xdotool search --name WorkHub
    xdotool search --name Cuu
  } > "$out_dir/xdotool.txt" 2>&1 || true
  xwininfo -root -tree > "$out_dir/xwininfo.txt" 2>&1 || true

  if command -v scrot >/dev/null 2>&1; then
    scrot "$out_dir/screen.png" > "$out_dir/scrot-path.txt" 2>&1 || true
  else
    echo "scrot not found" > "$out_dir/scrot-path.txt"
  fi
  if [ -s "$out_dir/screen.png" ] && command -v identify >/dev/null 2>&1; then
    identify "$out_dir/screen.png" > "$out_dir/screen-identify.txt" 2>&1 || true
  fi

  if ! ps -p "$app_pid" >/dev/null 2>&1; then
    echo "Tauri app process exited before capture finished." >&2
    return 1
  fi
  if ! grep -q "WorkHub" "$out_dir/wmctrl.txt" || ! grep -q "Cuu" "$out_dir/wmctrl.txt"; then
    echo "wmctrl did not report both WorkHub and Cuu windows." >&2
    return 1
  fi
  if ! grep -q "Cuu.*520x720" "$out_dir/xwininfo.txt"; then
    echo "xwininfo did not report a Cuu 520x720 window." >&2
    return 1
  fi
  if [ ! -s "$out_dir/screen.png" ]; then
    echo "screen.png was not captured." >&2
    return 1
  fi
  if [ ! -s "$out_dir/cuu-tauri-dom-report.json" ]; then
    echo "Cuu DOM report was not written." >&2
    return 1
  fi
  python3 - "$out_dir/cuu-tauri-dom-report.json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    report = json.load(handle)

pet_window_height = report.get("surface", {}).get("data", {}).get("data_pet_window_height")
surface_overflow = report.get("surface", {}).get("layout", {}).get("horizontal_overflow")
bubble_overflow = report.get("bubble", {}).get("layout", {}).get("horizontal_overflow")
if pet_window_height != "720" or surface_overflow or bubble_overflow:
    raise SystemExit(
        f"Unexpected DOM report: height={pet_window_height}, "
        f"surface_overflow={surface_overflow}, bubble_overflow={bubble_overflow}"
    )
PY

  echo "xvfb_openbox_devserver_smoke_done" > "$out_dir/xvfb-status.txt"
}

record_env

cd "$repo_root"
pnpm --filter @workhub/desktop-webview test > "$out_dir/desktop-webview-test.txt" 2>&1
pnpm --filter @workhub/desktop-webview build > "$out_dir/desktop-webview-build.txt" 2>&1
cargo test --manifest-path client-tauri/src-tauri/Cargo.toml > "$out_dir/cargo-test.txt" 2>&1
cargo build --manifest-path client-tauri/src-tauri/Cargo.toml > "$out_dir/cargo-build.txt" 2>&1

if [ -z "${DISPLAY:-}" ]; then
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "DISPLAY is empty and xvfb-run is unavailable" >&2
    exit 1
  fi
  smoke_entry="$(declare -f port_is_open wait_for_vite run_desktop_smoke); repo_root='$repo_root'; out_dir='$out_dir'; wait_seconds='$wait_seconds'; scenario='$scenario'; locale='$locale'; port='$port'; run_desktop_smoke"
  if command -v dbus-run-session >/dev/null 2>&1; then
    xvfb-run -a --server-args='-screen 0 1280x900x24' dbus-run-session bash -c "$smoke_entry"
  else
    xvfb-run -a --server-args='-screen 0 1280x900x24' bash -c "$smoke_entry"
  fi
else
  run_desktop_smoke
fi

echo "ok" > "$out_dir/status.txt"
echo "$out_dir"
