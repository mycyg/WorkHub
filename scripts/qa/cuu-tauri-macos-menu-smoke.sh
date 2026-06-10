#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
out_dir="${WORKHUB_MACOS_MENU_SMOKE_OUT_DIR:-/tmp/workhub-cuu-macos-menu-smoke}"
wait_seconds="${WORKHUB_MACOS_MENU_SMOKE_WAIT_SECONDS:-22}"
port="1420"
app_bin="$repo_root/client-tauri/src-tauri/target/debug/workhub-client-tauri"

mkdir -p "$out_dir"

record_env() {
  {
    echo "captured_at=$(date -Is)"
    echo "repo=$repo_root"
    echo "head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)"
    echo "uname=$(uname -a)"
    if command -v sw_vers >/dev/null 2>&1; then
      sw_vers
    fi
    echo "osascript=$(command -v osascript || true)"
    echo "screencapture=$(command -v screencapture || true)"
    echo "system_profiler=$(command -v system_profiler || true)"
    echo "port=$port"
  } > "$out_dir/macos-env-report.txt"
}

require_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "macOS menu smoke requires Darwin; current platform is $(uname -s)." | tee "$out_dir/status.txt" >&2
    return 2
  fi
  for command_name in osascript screencapture; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      echo "Required macOS command '$command_name' is unavailable." >&2
      return 1
    fi
  done
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

wait_for_port() {
  local pid="$1"
  local label="$2"
  for _ in $(seq 1 80); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$label exited early." >&2
      return 1
    fi
    if port_is_open 127.0.0.1 "$port"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_app_process() {
  for _ in $(seq 1 "$wait_seconds"); do
    if pgrep -f "workhub-client-tauri" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

capture_menu_bar_inventory() {
  osascript > "$out_dir/menu-bar-inventory.txt" <<'OSA' || true
tell application "System Events"
  set output to {}
  repeat with processName in {"SystemUIServer", "WorkHub"}
    if exists process processName then
      tell process processName
        repeat with barIndex from 1 to count of menu bars
          set end of output to "process=" & processName & " menu_bar=" & barIndex
          repeat with itemIndex from 1 to count of menu bar items of menu bar barIndex
            set itemRef to menu bar item itemIndex of menu bar barIndex
            set itemName to ""
            set itemDescription to ""
            try
              set itemName to name of itemRef
            end try
            try
              set itemDescription to description of itemRef
            end try
            set end of output to "  item=" & itemIndex & " name=" & itemName & " description=" & itemDescription
          end repeat
        end repeat
      end tell
    end if
  end repeat
  return output as text
end tell
OSA
}

click_workhub_menu_bar_item() {
  osascript > "$out_dir/menu-click.txt" <<'OSA'
tell application "System Events"
  repeat with processName in {"SystemUIServer", "WorkHub"}
    if exists process processName then
      tell process processName
        repeat with barIndex from 1 to count of menu bars
          repeat with itemIndex from 1 to count of menu bar items of menu bar barIndex
            set itemRef to menu bar item itemIndex of menu bar barIndex
            set itemName to ""
            set itemDescription to ""
            try
              set itemName to name of itemRef
            end try
            try
              set itemDescription to description of itemRef
            end try
            if itemName contains "WorkHub" or itemName contains "Cuu" or itemDescription contains "WorkHub" or itemDescription contains "Cuu" then
              click itemRef
              return "clicked process=" & processName & " menu_bar=" & barIndex & " item=" & itemIndex & " name=" & itemName & " description=" & itemDescription
            end if
          end repeat
        end repeat
      end tell
    end if
  end repeat
  error "Unable to find WorkHub/Cuu menu bar item. Accessibility permission or menu bar visibility may be missing."
end tell
OSA
}

run_smoke() {
  cd "$repo_root"
  rm -f "$out_dir"/screen*.png "$out_dir"/menu*.txt "$out_dir"/app-stdout.txt "$out_dir"/vite-dev.txt

  pnpm --filter @workhub/desktop-webview test > "$out_dir/desktop-webview-test.txt" 2>&1
  pnpm --filter @workhub/desktop-webview build > "$out_dir/desktop-webview-build.txt" 2>&1
  cargo test --manifest-path client-tauri/src-tauri/Cargo.toml > "$out_dir/cargo-test.txt" 2>&1
  cargo build --manifest-path client-tauri/src-tauri/Cargo.toml > "$out_dir/cargo-build.txt" 2>&1

  if [ ! -x "$app_bin" ]; then
    echo "Expected Tauri debug binary is not executable: $app_bin" >&2
    return 1
  fi
  if port_is_open 127.0.0.1 "$port"; then
    echo "127.0.0.1:$port is already in use before this smoke starts; refusing to reuse a stale dev server." >&2
    return 1
  fi

  vite_pid=""
  app_pid=""
  cleanup() {
    if [ -n "$app_pid" ]; then kill "$app_pid" >/dev/null 2>&1 || true; fi
    if [ -n "$vite_pid" ]; then kill "$vite_pid" >/dev/null 2>&1 || true; fi
  }
  trap cleanup RETURN

  pnpm --filter @workhub/desktop-webview dev -- --host 127.0.0.1 --port "$port" > "$out_dir/vite-dev.txt" 2>&1 &
  vite_pid=$!
  wait_for_port "$vite_pid" "Vite dev server"

  export WORKHUB_DISABLE_SSE=1
  export WORKHUB_CUU_QA_SCENARIO="${WORKHUB_CUU_QA_SCENARIO:-pass-through-recovery-tray-physical}"
  export WORKHUB_CUU_QA_LOCALE="${WORKHUB_CUU_QA_LOCALE:-en-US}"
  export WORKHUB_CUU_QA_HIDE_ON_HOVER="${WORKHUB_CUU_QA_HIDE_ON_HOVER:-1}"
  export WORKHUB_CUU_QA_PET_PASS_THROUGH="${WORKHUB_CUU_QA_PET_PASS_THROUGH:-true}"

  "$app_bin" > "$out_dir/app-stdout.txt" 2>&1 &
  app_pid=$!
  wait_for_app_process
  sleep 3

  screencapture -x "$out_dir/screen-before-menu.png"
  capture_menu_bar_inventory
  click_workhub_menu_bar_item
  sleep 1
  screencapture -x "$out_dir/screen-after-menu-click.png"

  echo "ok" > "$out_dir/status.txt"
}

record_env
require_macos
run_smoke
