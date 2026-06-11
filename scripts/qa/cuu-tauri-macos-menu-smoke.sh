#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
out_dir="${WORKHUB_MACOS_MENU_SMOKE_OUT_DIR:-/tmp/workhub-cuu-macos-menu-smoke}"
wait_seconds="${WORKHUB_MACOS_MENU_SMOKE_WAIT_SECONDS:-22}"
menu_action_sequence="${WORKHUB_MACOS_MENU_ACTIONS:-restore-pet-interaction,open-settings,open-inbox,toggle-pet,show-main,hide-main,quit}"
smoke_locale_raw="${WORKHUB_MACOS_MENU_SMOKE_LOCALE:-${WORKHUB_LOCALE:-zh-CN}}"
case "$smoke_locale_raw" in
  en | en-* | en_*) smoke_locale="en-US" ;;
  *) smoke_locale="zh-CN" ;;
esac
port="1420"
app_bin="$repo_root/client-tauri/src-tauri/target/debug/workhub-client-tauri"

mkdir -p "$out_dir"

timestamp_iso() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

capture_screen() {
  local label="$1"
  local target="$2"
  local error_file="$out_dir/screencapture-$label.err"

  if ! screencapture -x "$target" 2> "$error_file"; then
    {
      echo "screencapture_failed"
      echo "label=$label"
      echo "target=$target"
      echo "error_file=$error_file"
      echo "hint=Screen Recording permission or an attached/capturable desktop session may be missing."
    } > "$out_dir/status.txt"
    return 1
  fi
}

record_osascript_failure() {
  local phase="$1"
  local error_file="$2"
  local reason="${3:-osascript_menu_automation_failed}"
  local hint="${4:-Ensure Accessibility permission is enabled, then inspect the phase-specific error file for menu structure or label mismatches.}"

  {
    echo "$reason"
    echo "phase=$phase"
    echo "error_file=$error_file"
    echo "hint=$hint"
  } > "$out_dir/status.txt"
}

probe_accessibility() {
  local error_file="$out_dir/osascript-accessibility-probe.err"
  if ! osascript > "$out_dir/osascript-accessibility-probe.txt" 2> "$error_file" <<'OSA'; then
tell application "System Events"
  return "process_count=" & (count of processes)
end tell
OSA
    record_osascript_failure \
      "accessibility-probe" \
      "$error_file" \
      "osascript_accessibility_failed" \
      "Grant Accessibility permission to osascript/Codex/Terminal in macOS Privacy & Security settings, then rerun this smoke."
    return 1
  fi
}

write_tray_menu_action_matrix() {
  cat > "$out_dir/tray-menu-action-matrix.json" <<'JSON'
{
  "contract": "workhub.cuu.tray-menu-action-matrix",
  "version": 1,
  "actions": [
    {
      "id": "show-main",
      "label": "Open WorkHub",
      "target": "main",
      "expected_effect": "show_and_focus_main_route_root",
      "destructive": false,
      "dry_run_only": false
    },
    {
      "id": "hide-main",
      "label": "Hide main window",
      "target": "main",
      "expected_effect": "hide_main_window",
      "destructive": false,
      "dry_run_only": false
    },
    {
      "id": "toggle-pet",
      "label": "Show / hide Cuu",
      "target": "pet",
      "expected_effect": "toggle_pet_window",
      "destructive": false,
      "dry_run_only": false
    },
    {
      "id": "restore-pet-interaction",
      "label": "Restore Cuu interaction",
      "target": "pet",
      "expected_effect": "pass_false_hide_false_opacity_100",
      "destructive": false,
      "dry_run_only": false
    },
    {
      "id": "open-inbox",
      "label": "Open inbox",
      "target": "main",
      "expected_effect": "show_and_focus_main_route_inbox",
      "destructive": false,
      "dry_run_only": false
    },
    {
      "id": "open-settings",
      "label": "Settings",
      "target": "main",
      "expected_effect": "show_and_focus_main_route_settings",
      "destructive": false,
      "dry_run_only": false
    },
    {
      "id": "quit",
      "label": "Quit WorkHub",
      "target": "app",
      "expected_effect": "exit_app",
      "destructive": true,
      "dry_run_only": true
    }
  ]
}
JSON
}

tray_menu_label_for_action() {
  case "$smoke_locale:$1" in
    en-US:show-main) printf '%s\n' "Open WorkHub" ;;
    en-US:hide-main) printf '%s\n' "Hide main window" ;;
    en-US:toggle-pet) printf '%s\n' "Show / hide Cuu" ;;
    en-US:restore-pet-interaction) printf '%s\n' "Restore Cuu interaction" ;;
    en-US:open-inbox) printf '%s\n' "Open inbox" ;;
    en-US:open-settings) printf '%s\n' "Settings" ;;
    en-US:quit) printf '%s\n' "Quit WorkHub" ;;
    zh-CN:show-main) printf '%s\n' "打开 WorkHub" ;;
    zh-CN:hide-main) printf '%s\n' "隐藏主窗" ;;
    zh-CN:toggle-pet) printf '%s\n' "显示/隐藏 Cuu" ;;
    zh-CN:restore-pet-interaction) printf '%s\n' "恢复 Cuu 交互" ;;
    zh-CN:open-inbox) printf '%s\n' "打开收件箱" ;;
    zh-CN:open-settings) printf '%s\n' "设置" ;;
    zh-CN:quit) printf '%s\n' "退出 WorkHub" ;;
    *) return 1 ;;
  esac
}

record_env() {
  {
    echo "captured_at=$(timestamp_iso)"
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
    echo "menu_action_sequence=$menu_action_sequence"
    echo "smoke_locale=$smoke_locale"
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
  local error_file="$out_dir/menu-bar-inventory.err"
  if ! osascript > "$out_dir/menu-bar-inventory.txt" 2> "$error_file" <<'OSA'; then
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
    record_osascript_failure "menu-bar-inventory" "$error_file"
    return 1
  fi
}

click_workhub_menu_action() {
  local action_id="$1"
  local action_label="$2"
  local error_file="$out_dir/menu-click-$action_id.err"
  if ! osascript - "$action_id" "$action_label" > "$out_dir/menu-click-$action_id.txt" 2> "$error_file" <<'OSA'; then
on run argv
set actionId to item 1 of argv
set wantedLabel to item 2 of argv
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
            set itemNameText to ""
            set itemDescriptionText to ""
            try
              if itemName is not missing value then set itemNameText to itemName as text
            end try
            try
              if itemDescription is not missing value then set itemDescriptionText to itemDescription as text
            end try
            set statusMenuCandidate to false
            if barIndex > 1 then set statusMenuCandidate to true
            if itemDescriptionText contains "status" then set statusMenuCandidate to true
            if itemDescriptionText contains "WorkHub" then set statusMenuCandidate to true
            if itemDescriptionText contains "Cuu" then set statusMenuCandidate to true
            if itemNameText contains "Cuu" then set statusMenuCandidate to true
            if statusMenuCandidate then
              try
                perform action "AXShowMenu" of itemRef
              on error actionError
                error "Unable to open WorkHub/Cuu menu through AXShowMenu: " & actionError
              end try
              delay 0.4
              if exists menu 1 of itemRef then
                if exists menu item wantedLabel of menu 1 of itemRef then
                  click menu item wantedLabel of menu 1 of itemRef
                  return "clicked action_id=" & actionId & " label=" & wantedLabel & " process=" & processName & " menu_bar=" & barIndex & " item=" & itemIndex & " name=" & itemName & " description=" & itemDescription
                end if
                set availableItems to {}
                repeat with menuItemIndex from 1 to count of menu items of menu 1 of itemRef
                  set menuItemRef to menu item menuItemIndex of menu 1 of itemRef
                  set menuItemName to ""
                  try
                    if name of menuItemRef is not missing value then set menuItemName to name of menuItemRef as text
                  end try
                  set end of availableItems to (menuItemIndex as text) & ":" & menuItemName
                end repeat
                set AppleScript's text item delimiters to ", "
                set availableText to availableItems as text
                set AppleScript's text item delimiters to ""
                error "Unable to find menu item '" & wantedLabel & "' after opening WorkHub/Cuu menu bar item. Available menu items: " & availableText
              end if
              error "Unable to find menu item '" & wantedLabel & "' after opening WorkHub/Cuu menu bar item."
            end if
          end repeat
        end repeat
      end tell
    end if
  end repeat
  error "Unable to find WorkHub/Cuu menu bar item. Accessibility permission or menu bar visibility may be missing."
end tell
end run
OSA
    record_osascript_failure "menu-click-$action_id" "$error_file"
    return 1
  fi
}

assert_app_still_running_after_action() {
  local action_id="$1"
  if [ -n "$app_pid" ] && ! kill -0 "$app_pid" >/dev/null 2>&1; then
    echo "WorkHub app exited after tray menu action '$action_id'; quit dry-run guard failed or the smoke clicked a destructive native menu item." >&2
    return 1
  fi
}

run_menu_action_matrix() {
  local old_ifs="$IFS"
  IFS=","
  for action_id in $menu_action_sequence; do
    IFS="$old_ifs"
    action_id="$(printf '%s' "$action_id" | tr -d '[:space:]')"
    if [ -z "$action_id" ]; then
      IFS=","
      continue
    fi
    action_label="$(tray_menu_label_for_action "$action_id")"
    capture_menu_bar_inventory
    click_workhub_menu_action "$action_id" "$action_label"
    sleep 1
    assert_app_still_running_after_action "$action_id"
    capture_screen "after-$action_id" "$out_dir/screen-after-$action_id.png"
    IFS=","
  done
  IFS="$old_ifs"
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
  export WORKHUB_LOCALE="$smoke_locale"
  export WORKHUB_CUU_QA_LOCALE="${WORKHUB_CUU_QA_LOCALE:-$smoke_locale}"
  export WORKHUB_CUU_QA_HIDE_ON_HOVER="${WORKHUB_CUU_QA_HIDE_ON_HOVER:-1}"
  export WORKHUB_CUU_QA_PET_PASS_THROUGH="${WORKHUB_CUU_QA_PET_PASS_THROUGH:-true}"
  export WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN=1

  "$app_bin" > "$out_dir/app-stdout.txt" 2>&1 &
  app_pid=$!
  wait_for_app_process
  sleep 3

  capture_screen "before-menu" "$out_dir/screen-before-menu.png"
  probe_accessibility
  run_menu_action_matrix

  echo "ok" > "$out_dir/status.txt"
}

write_tray_menu_action_matrix
record_env
require_macos
run_smoke
