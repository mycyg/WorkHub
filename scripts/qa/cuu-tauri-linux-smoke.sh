#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
out_dir="${WORKHUB_LINUX_SMOKE_OUT_DIR:-/tmp/workhub-cuu-tauri-linux-smoke}"
wait_seconds="${WORKHUB_LINUX_SMOKE_WAIT_SECONDS:-22}"
scenario="${WORKHUB_CUU_QA_SCENARIO:-run-failure}"
locale="${WORKHUB_CUU_QA_LOCALE:-en-US}"
port="1420"
api_port="8787"
require_real_de="${WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE:-0}"
menu_action_sequence="${WORKHUB_LINUX_MENU_ACTIONS:-restore-pet-interaction,open-settings,open-inbox,toggle-pet,show-main,hide-main,quit}"

if [ -n "${WORKHUB_LINUX_SMOKE_DEV_PORT:-}" ] && [ "${WORKHUB_LINUX_SMOKE_DEV_PORT}" != "$port" ]; then
  echo "WORKHUB_LINUX_SMOKE_DEV_PORT must stay 1420 because tauri.conf.json devUrl is fixed to http://127.0.0.1:1420." >&2
  exit 1
fi
if [ -n "${WORKHUB_LINUX_SMOKE_API_PORT:-}" ] && [ "${WORKHUB_LINUX_SMOKE_API_PORT}" != "$api_port" ]; then
  echo "WORKHUB_LINUX_SMOKE_API_PORT must stay 8787 because apps/desktop-webview/vite.config.ts proxies /api to http://127.0.0.1:8787." >&2
  exit 1
fi

mkdir -p "$out_dir"

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

requires_real_de() {
  case "$require_real_de" in
    1|true|TRUE|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

tray_menu_label_for_action() {
  case "$1" in
    show-main) printf '%s\n' "Open WorkHub" ;;
    hide-main) printf '%s\n' "Hide main window" ;;
    toggle-pet) printf '%s\n' "Show / hide Cuu" ;;
    restore-pet-interaction) printf '%s\n' "Restore Cuu interaction" ;;
    open-inbox) printf '%s\n' "Open inbox" ;;
    open-settings) printf '%s\n' "Settings" ;;
    quit) printf '%s\n' "Quit WorkHub" ;;
    *) return 1 ;;
  esac
}

bootstrap_real_desktop_session_env() {
  if ! requires_real_de; then
    return 0
  fi
  local uid
  uid="$(id -u)"
  if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$uid" ]; then
    export XDG_RUNTIME_DIR="/run/user/$uid"
  fi
  if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "${XDG_RUNTIME_DIR:-}/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
  fi
  if [ -n "${DISPLAY:-}" ] && [ -z "${XAUTHORITY:-}" ]; then
    local candidate
    for candidate in "${XDG_RUNTIME_DIR:-}"/.mutter-Xwaylandauth.* "$HOME/.Xauthority"; do
      if [ -f "$candidate" ]; then
        export XAUTHORITY="$candidate"
        break
      fi
    done
  fi
}

record_env() {
  {
    echo "captured_at=$(date -Is)"
    echo "repo=$repo_root"
    echo "head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)"
    echo "uname=$(uname -a)"
    echo "session_type=${XDG_SESSION_TYPE:-}"
    echo "display=${DISPLAY:-}"
    echo "wayland_display=${WAYLAND_DISPLAY:-}"
    echo "xauthority=${XAUTHORITY:-}"
    echo "xdg_runtime_dir=${XDG_RUNTIME_DIR:-}"
    echo "dbus_session_bus_address=${DBUS_SESSION_BUS_ADDRESS:-}"
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
    echo "gnome_screenshot=$(command -v gnome-screenshot || true)"
    echo "busctl=$(command -v busctl || true)"
    echo "gdbus=$(command -v gdbus || true)"
    echo "require_real_de=$require_real_de"
    echo "menu_action_sequence=$menu_action_sequence"
  } > "$out_dir/linux-env-report.txt"
}

collect_desktop_environment_probe() {
  {
    echo "captured_at=$(date -Is)"
    echo "require_real_de=$require_real_de"
    echo "session_type=${XDG_SESSION_TYPE:-}"
    echo "desktop=${XDG_CURRENT_DESKTOP:-}"
    echo "display=${DISPLAY:-}"
    echo "wayland_display=${WAYLAND_DISPLAY:-}"
    echo "dbus_session_bus_address=${DBUS_SESSION_BUS_ADDRESS:-}"
    if command -v loginctl >/dev/null 2>&1; then
      echo "loginctl_available=true"
      loginctl show-session "${XDG_SESSION_ID:-self}" -p Type -p Desktop -p Name -p State -p Remote -p Class 2>/dev/null || true
    else
      echo "loginctl_available=false"
    fi
  } > "$out_dir/linux-desktop-probe.txt"

  if command -v ps >/dev/null 2>&1; then
    if ps -eo pid,comm,args >/dev/null 2>&1; then
      ps -eo pid,comm,args | grep -Ei 'gnome-shell|plasmashell|xfce4-panel|mate-panel|lxqt-panel|cinnamon|budgie-panel|waybar|kstatus|appindicator|ayatana|xembedsniproxy|snixembed|openbox' > "$out_dir/linux-panel-processes.txt" 2>&1 || true
    else
      ps aux | grep -Ei 'gnome-shell|plasmashell|xfce4-panel|mate-panel|lxqt-panel|cinnamon|budgie-panel|waybar|kstatus|appindicator|ayatana|xembedsniproxy|snixembed|openbox' > "$out_dir/linux-panel-processes.txt" 2>&1 || true
    fi
  else
    echo "ps unavailable" > "$out_dir/linux-panel-processes.txt"
  fi

  if command -v xprop >/dev/null 2>&1; then
    xprop -root _NET_SYSTEM_TRAY_S0 _NET_CLIENT_LIST > "$out_dir/linux-x11-tray-owner.txt" 2>&1 || true
  else
    echo "xprop unavailable" > "$out_dir/linux-x11-tray-owner.txt"
  fi

  if command -v busctl >/dev/null 2>&1; then
    busctl --user list > "$out_dir/linux-dbus-services.txt" 2>&1 || true
  elif command -v qdbus >/dev/null 2>&1; then
    qdbus > "$out_dir/linux-dbus-services.txt" 2>&1 || true
  else
    echo "busctl/qdbus unavailable" > "$out_dir/linux-dbus-services.txt"
  fi
}

has_real_panel_process() {
  if ! command -v ps >/dev/null 2>&1; then
    return 1
  fi
  if ps -eo comm= >/dev/null 2>&1; then
    ps -eo comm= | grep -Eiq 'gnome-shell|plasmashell|xfce4-panel|mate-panel|lxqt-panel|cinnamon|budgie-panel|waybar|kstatus|appindicator|ayatana'
  else
    ps aux | grep -Eiq 'gnome-shell|plasmashell|xfce4-panel|mate-panel|lxqt-panel|cinnamon|budgie-panel|waybar|kstatus|appindicator|ayatana'
  fi
}

require_real_desktop_session() {
  if ! requires_real_de; then
    return 0
  fi
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 requires an existing DISPLAY or WAYLAND_DISPLAY; refusing Xvfb/openbox fallback." >&2
    return 1
  fi
  if [ -z "${XDG_CURRENT_DESKTOP:-}" ]; then
    echo "WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 requires XDG_CURRENT_DESKTOP from a real desktop session." >&2
    return 1
  fi
  case "${XDG_SESSION_TYPE:-}" in
    x11|wayland)
      ;;
    *)
      echo "WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 requires XDG_SESSION_TYPE=x11 or wayland, got '${XDG_SESSION_TYPE:-}'." >&2
      return 1
      ;;
  esac
  if ! has_real_panel_process; then
    echo "WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 requires a detected desktop panel/appindicator process. See $out_dir/linux-panel-processes.txt." >&2
    return 1
  fi
  return 0
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

scenario_uses_run_api() {
  case "$1" in
    run-stream|run-failure|permission-401|permission-403|generic-runtime-error|stream-offline)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_outcome_for_scenario() {
  case "$1" in
    run-failure)
      printf '%s\n' "${WORKHUB_CUU_QA_RUN_OUTCOME:-failed}"
      ;;
    *)
      printf '%s\n' "${WORKHUB_CUU_QA_RUN_OUTCOME:-succeeded}"
      ;;
  esac
}

api_fault_for_scenario() {
  case "$1" in
    permission-401|permission-403|stream-offline)
      printf '%s\n' "$1"
      ;;
    generic-runtime-error)
      printf '%s\n' "generic-502"
      ;;
    *)
      printf '%s\n' "${WORKHUB_CUU_QA_API_FAULT:-none}"
      ;;
  esac
}

wait_for_api_server() {
  local expected_run_outcome="$1"
  local expected_api_fault="$2"
  for _ in $(seq 1 80); do
    if ! kill -0 "$api_pid" >/dev/null 2>&1; then
      echo "Cuu R3 mock API server exited early. See $out_dir/api-server.txt." >&2
      return 1
    fi
    if python3 - "$api_port" "$expected_run_outcome" "$expected_api_fault" > "$out_dir/api-server-health.json.tmp" 2>/dev/null <<'PY'
import json
import sys
import urllib.request

port = int(sys.argv[1])
expected_run_outcome = sys.argv[2]
expected_api_fault = sys.argv[3]
with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.35) as response:
    data = json.loads(response.read().decode("utf-8"))
if data.get("service") != "workhub-cuu-r3-tauri-run-stream":
    raise SystemExit(f"unexpected service: {data!r}")
if data.get("run_outcome") != expected_run_outcome:
    raise SystemExit(f"unexpected run_outcome: {data!r}")
if data.get("api_fault") != expected_api_fault:
    raise SystemExit(f"unexpected api_fault: {data!r}")
print(json.dumps(data, ensure_ascii=False, sort_keys=True))
PY
    then
      mv "$out_dir/api-server-health.json.tmp" "$out_dir/api-server-health.json"
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

safe_file_token() {
  printf '%s' "$1" | tr '/: ' '___' | tr -cd '[:alnum:]_.-'
}

capture_linux_screen() {
  local name="$1"
  if command -v scrot >/dev/null 2>&1; then
    scrot "$out_dir/screen-$name.png" > "$out_dir/screen-$name.txt" 2>&1 || true
  elif command -v gnome-screenshot >/dev/null 2>&1; then
    gnome-screenshot -f "$out_dir/screen-$name.png" > "$out_dir/screen-$name.txt" 2>&1 || true
  else
    echo "scrot/gnome-screenshot unavailable" > "$out_dir/screen-$name.txt"
  fi
}

status_notifier_items() {
  local raw="$out_dir/linux-status-notifier-items.raw.txt"
  if [ -n "${WORKHUB_LINUX_STATUS_NOTIFIER_ITEM:-}" ]; then
    printf '%s\n' "$WORKHUB_LINUX_STATUS_NOTIFIER_ITEM" > "$raw"
    printf '%s\n' "$WORKHUB_LINUX_STATUS_NOTIFIER_ITEM"
    return 0
  fi
  if command -v busctl >/dev/null 2>&1; then
    if ! busctl --user get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems > "$raw" 2> "$out_dir/linux-status-notifier-items.err.txt"; then
      return 1
    fi
  elif command -v gdbus >/dev/null 2>&1; then
    if ! gdbus call --session --dest org.kde.StatusNotifierWatcher --object-path /StatusNotifierWatcher --method org.freedesktop.DBus.Properties.Get org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems > "$raw" 2> "$out_dir/linux-status-notifier-items.err.txt"; then
      return 1
    fi
  else
    echo "busctl/gdbus unavailable" > "$out_dir/linux-status-notifier-items.err.txt"
    return 1
  fi
  python3 - "$raw" <<'PY'
import re
import sys

text = open(sys.argv[1], "r", encoding="utf-8", errors="replace").read()
items = []
for single, double in re.findall(r"'([^']+)'|\"([^\"]+)\"", text):
    value = single or double
    if "/" in value and value not in items:
        items.append(value)
for item in items:
    print(item)
PY
}

snapshot_status_notifier_item() {
  local item="$1"
  local token
  token="$(safe_file_token "$item")"
  local service="${item%%/*}"
  local path="/${item#*/}"
  {
    echo "item=$item"
    echo "service=$service"
    echo "path=$path"
    if command -v busctl >/dev/null 2>&1; then
      for prop in Id Title Status IconName ToolTip Menu; do
        printf '%s=' "$prop"
        busctl --user get-property "$service" "$path" org.kde.StatusNotifierItem "$prop" 2>/dev/null || true
      done
      echo "introspect="
      busctl --user introspect "$service" "$path" org.kde.StatusNotifierItem 2>/dev/null || true
    elif command -v gdbus >/dev/null 2>&1; then
      gdbus introspect --session --dest "$service" --object-path "$path" 2>/dev/null || true
    fi
  } > "$out_dir/linux-status-notifier-item-$token.txt"
}

select_workhub_status_notifier_item() {
  local items_file="$out_dir/linux-status-notifier-items.txt"
  if ! status_notifier_items > "$items_file"; then
    echo "Could not read org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems." >&2
    return 1
  fi
  if [ ! -s "$items_file" ]; then
    echo "StatusNotifierWatcher did not report any tray items." >&2
    return 1
  fi
  local item
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    snapshot_status_notifier_item "$item"
    local token
    token="$(safe_file_token "$item")"
    if grep -Eiq 'WorkHub|Cuu|workhub|workhub-main-tray|workhub-client-tauri' "$out_dir/linux-status-notifier-item-$token.txt"; then
      printf '%s\n' "$item"
      return 0
    fi
  done < "$items_file"
  echo "No WorkHub/Cuu StatusNotifier item found. Set WORKHUB_LINUX_STATUS_NOTIFIER_ITEM=service/path to override after inspecting $items_file." >&2
  return 1
}

status_notifier_menu_path() {
  local item="$1"
  local service="${item%%/*}"
  local path="/${item#*/}"
  local raw="$out_dir/linux-status-notifier-menu-path.raw.txt"
  if command -v busctl >/dev/null 2>&1; then
    busctl --user get-property "$service" "$path" org.kde.StatusNotifierItem Menu > "$raw" 2> "$out_dir/linux-status-notifier-menu-path.err.txt"
  elif command -v gdbus >/dev/null 2>&1; then
    gdbus call --session --dest "$service" --object-path "$path" --method org.freedesktop.DBus.Properties.Get org.kde.StatusNotifierItem Menu > "$raw" 2> "$out_dir/linux-status-notifier-menu-path.err.txt"
  else
    echo "busctl/gdbus unavailable" > "$out_dir/linux-status-notifier-menu-path.err.txt"
    return 1
  fi
  python3 - "$raw" <<'PY'
import re
import sys

text = open(sys.argv[1], "r", encoding="utf-8", errors="replace").read()
match = re.search(r"['\"](/[^'\"]+)['\"]", text)
if not match:
    raise SystemExit(1)
print(match.group(1))
PY
}

capture_dbusmenu_layout() {
  local service="$1"
  local menu_path="$2"
  local action_id="$3"
  local raw="$out_dir/linux-dbusmenu-layout-$action_id.txt"
  if command -v gdbus >/dev/null 2>&1; then
    gdbus call --session --dest "$service" --object-path "$menu_path" --method com.canonical.dbusmenu.GetLayout 0 -1 "[]" > "$raw" 2> "$out_dir/linux-dbusmenu-layout-$action_id.err.txt"
  elif command -v busctl >/dev/null 2>&1; then
    busctl --user call "$service" "$menu_path" com.canonical.dbusmenu GetLayout iias 0 -1 0 > "$raw" 2> "$out_dir/linux-dbusmenu-layout-$action_id.err.txt"
  else
    echo "gdbus/busctl unavailable" > "$out_dir/linux-dbusmenu-layout-$action_id.err.txt"
    return 1
  fi
}

dbusmenu_item_id_for_label() {
  local layout_file="$1"
  local action_label="$2"
  local summary_file="$3"
  python3 - "$layout_file" "$action_label" "$summary_file" <<'PY'
import json
import re
import sys

layout_file, wanted_label, summary_file = sys.argv[1:4]
text = open(layout_file, "r", encoding="utf-8", errors="replace").read()
items = []
for match in re.finditer(r"\((\d+),\s*\{(.*?)\}", text, flags=re.S):
    item_id = int(match.group(1))
    props = match.group(2)
    label_match = re.search(r"['\"]label['\"]\s*:\s*<['\"]([^'\"]+)['\"]>", props)
    if label_match:
        items.append({"id": item_id, "label": label_match.group(1)})
if not items:
    for match in re.finditer(r"\bi\s+(\d+)\s+a\{sv\}\s+\d+\s+(.*?)(?=\s+av\s+\d+\s+i\s+\d+\s+a\{sv\}|\s+i\s+\d+\s+a\{sv\}|\Z)", text, flags=re.S):
        item_id = int(match.group(1))
        props = match.group(2)
        label_match = re.search(r'["\']label["\']\s+v\s+s\s+["\']([^"\']+)["\']', props)
        if label_match:
            items.append({"id": item_id, "label": label_match.group(1)})
open(summary_file, "w", encoding="utf-8").write(json.dumps(items, ensure_ascii=False, indent=2))
for item in items:
    if item["label"] == wanted_label:
        print(item["id"])
        raise SystemExit(0)
raise SystemExit(f"Could not find menu label {wanted_label!r}; parsed labels: {items!r}")
PY
}

emit_dbusmenu_click_event() {
  local service="$1"
  local menu_path="$2"
  local menu_id="$3"
  local action_id="$4"
  if command -v busctl >/dev/null 2>&1; then
    busctl --user call "$service" "$menu_path" com.canonical.dbusmenu Event isvu "$menu_id" clicked s "" 0 > "$out_dir/linux-dbusmenu-event-$action_id.txt" 2> "$out_dir/linux-dbusmenu-event-$action_id.err.txt"
  elif command -v gdbus >/dev/null 2>&1; then
    gdbus call --session --dest "$service" --object-path "$menu_path" --method com.canonical.dbusmenu.Event "$menu_id" clicked "<''>" 0 > "$out_dir/linux-dbusmenu-event-$action_id.txt" 2> "$out_dir/linux-dbusmenu-event-$action_id.err.txt"
  else
    echo "busctl/gdbus unavailable" > "$out_dir/linux-dbusmenu-event-$action_id.err.txt"
    return 1
  fi
}

capture_linux_menu_action_state() {
  local label="$1"
  ps -p "$app_pid" -o pid,stat,etime,cmd > "$out_dir/linux-menu-action-$label-ps-app.txt" 2>&1 || true
  wmctrl -l > "$out_dir/linux-menu-action-$label-wmctrl.txt" 2>&1 || true
  {
    xdotool search --name WorkHub
    xdotool search --name Cuu
  } > "$out_dir/linux-menu-action-$label-xdotool.txt" 2>&1 || true
  capture_linux_screen "menu-action-$label"
}

click_linux_dbus_menu_action() {
  local item="$1"
  local menu_path="$2"
  local action_id="$3"
  local action_label="$4"
  local service="${item%%/*}"
  capture_dbusmenu_layout "$service" "$menu_path" "$action_id"
  local menu_id
  menu_id="$(dbusmenu_item_id_for_label "$out_dir/linux-dbusmenu-layout-$action_id.txt" "$action_label" "$out_dir/linux-dbusmenu-layout-$action_id-summary.json")"
  echo "action_id=$action_id label=$action_label menu_id=$menu_id service=$service menu_path=$menu_path" > "$out_dir/linux-dbusmenu-click-$action_id.txt"
  emit_dbusmenu_click_event "$service" "$menu_path" "$menu_id" "$action_id"
}

run_linux_menu_action_matrix() {
  if ! requires_real_de; then
    echo "skipped because WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE is not enabled" > "$out_dir/linux-menu-action-status.txt"
    return 0
  fi
  local item
  item="$(select_workhub_status_notifier_item)"
  local menu_path
  menu_path="$(status_notifier_menu_path "$item")"
  {
    echo "status_notifier_item=$item"
    echo "menu_path=$menu_path"
    echo "menu_action_sequence=$menu_action_sequence"
  } > "$out_dir/linux-menu-action-status.txt"

  local old_ifs="$IFS"
  IFS=","
  for action_id in $menu_action_sequence; do
    IFS="$old_ifs"
    action_id="$(printf '%s' "$action_id" | tr -d '[:space:]')"
    if [ -z "$action_id" ]; then
      IFS=","
      continue
    fi
    local action_label
    action_label="$(tray_menu_label_for_action "$action_id")"
    capture_linux_menu_action_state "before-$action_id"
    click_linux_dbus_menu_action "$item" "$menu_path" "$action_id" "$action_label"
    sleep 1
    if ! ps -p "$app_pid" >/dev/null 2>&1; then
      echo "Tauri app process exited after tray menu action '$action_id'; quit dry-run guard failed or a destructive native item was clicked." >&2
      return 1
    fi
    capture_linux_menu_action_state "after-$action_id"
    IFS=","
  done
  IFS="$old_ifs"
  echo "ok" >> "$out_dir/linux-menu-action-status.txt"
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

  vite_pid=""
  wm_pid=""
  app_pid=""
  api_pid=""
  uses_api="false"
  run_outcome=""
  api_fault=""
  cleanup() {
    if [ -n "${app_pid:-}" ]; then kill "$app_pid" >/dev/null 2>&1 || true; fi
    if [ -n "${api_pid:-}" ] && command -v pkill >/dev/null 2>&1; then pkill -TERM -P "$api_pid" >/dev/null 2>&1 || true; fi
    if [ -n "${api_pid:-}" ]; then kill "$api_pid" >/dev/null 2>&1 || true; fi
    if [ -n "${vite_pid:-}" ] && command -v pkill >/dev/null 2>&1; then pkill -TERM -P "$vite_pid" >/dev/null 2>&1 || true; fi
    if [ -n "${vite_pid:-}" ]; then kill "$vite_pid" >/dev/null 2>&1 || true; fi
    if command -v pkill >/dev/null 2>&1; then pkill -TERM -f "$repo_root/client-tauri/src-tauri/target/debug/workhub-client-tauri" >/dev/null 2>&1 || true; fi
    if command -v pkill >/dev/null 2>&1; then pkill -TERM -f "$repo_root/.*cuu-r3-tauri-run-stream-server" >/dev/null 2>&1 || true; fi
    if command -v pkill >/dev/null 2>&1; then pkill -TERM -f "$repo_root/.*@workhub/desktop-webview.*dev" >/dev/null 2>&1 || true; fi
    if command -v pkill >/dev/null 2>&1; then pkill -TERM -f "$repo_root/apps/desktop-webview/.*vite.*--port $port" >/dev/null 2>&1 || true; fi
    if [ -n "${wm_pid:-}" ]; then kill "$wm_pid" >/dev/null 2>&1 || true; fi
  }
  trap cleanup RETURN
  trap cleanup EXIT

  if scenario_uses_run_api "$scenario"; then
    uses_api="true"
    run_outcome="$(run_outcome_for_scenario "$scenario")"
    api_fault="$(api_fault_for_scenario "$scenario")"
    if port_is_open 127.0.0.1 "$api_port"; then
      echo "127.0.0.1:$api_port is already in use before this smoke starts; refusing to reuse a stale mock API server." >&2
      return 1
    fi
    PORT="$api_port" HOST=127.0.0.1 WORKHUB_CUU_QA_RUN_OUTCOME="$run_outcome" WORKHUB_CUU_QA_API_FAULT="$api_fault" \
      pnpm --filter @workhub/api qa:cuu-r3-tauri-run-stream-server > "$out_dir/api-server.txt" 2>&1 &
    api_pid=$!
    if ! wait_for_api_server "$run_outcome" "$api_fault"; then
      echo "Cuu R3 mock API server did not become healthy on 127.0.0.1:$api_port." >&2
      return 1
    fi
  fi

  pnpm --filter @workhub/desktop-webview dev -- --host 127.0.0.1 --port "$port" > "$out_dir/vite-dev.txt" 2>&1 &
  vite_pid=$!

  if ! wait_for_vite; then
    echo "Vite dev server did not open 127.0.0.1:$port." >&2
    return 1
  fi

  if requires_real_de; then
    echo "real desktop session requested; preserving the existing desktop shell instead of starting openbox" > "$out_dir/openbox.txt"
  elif command -v openbox >/dev/null 2>&1; then
    openbox > "$out_dir/openbox.txt" 2>&1 &
    wm_pid=$!
    sleep 2
  else
    echo "openbox not found; continuing without a window manager" > "$out_dir/openbox.txt"
  fi

  export WORKHUB_DISABLE_SSE=1
  export WORKHUB_CUU_QA_SCENARIO="$scenario"
  export WORKHUB_CUU_QA_LOCALE="$locale"
  export WORKHUB_CUU_QA_DOM_REPORT_PATH="$out_dir/cuu-tauri-dom-report.json"
  export WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN=1
  if [ "$uses_api" = "true" ]; then
    export WORKHUB_CUU_QA_CLIENT_TOKEN="cuu-r3-local-client-token"
    export WORKHUB_CLIENT_TOKEN="cuu-r3-local-client-token"
    export WORKHUB_CUU_QA_RUN_OUTCOME="$run_outcome"
    export WORKHUB_CUU_QA_API_FAULT="$api_fault"
  else
    export WORKHUB_CUU_QA_RUN_OUTCOME="${WORKHUB_CUU_QA_RUN_OUTCOME:-failed}"
    unset WORKHUB_CUU_QA_API_FAULT
  fi

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
  if ! python3 - "$out_dir/cuu-tauri-dom-report.json" "$scenario" "$locale" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    report = json.load(handle)

scenario = sys.argv[2]
locale = sys.argv[3]
pet_window_height = report.get("surface", {}).get("data", {}).get("data_pet_window_height")
surface_layout = report.get("surface", {}).get("layout", {})
bubble_layout = report.get("bubble", {}).get("layout", {})
primary_action_layout = report.get("primary_action", {}).get("layout", {})
surface_overflow = surface_layout.get("horizontal_overflow")
surface_vertical_overflow = surface_layout.get("vertical_overflow")
bubble_overflow = bubble_layout.get("horizontal_overflow")
bubble_vertical_overflow = bubble_layout.get("vertical_overflow")
primary_action_overflow = primary_action_layout.get("horizontal_overflow")
primary_action_vertical_overflow = primary_action_layout.get("vertical_overflow")
spatial = report.get("spatial_safety", {})
bubble_within_vertical = spatial.get("bubble_within_surface_vertical")
bubble_within_horizontal = spatial.get("bubble_within_surface_horizontal")
bubble_overlaps_live2d = spatial.get("bubble_overlaps_live2d")
bubble_text = report.get("bubble", {}).get("text") or ""
surface_data = report.get("surface", {}).get("data", {})
bubble_data = report.get("bubble", {}).get("data", {})
primary_action_data = report.get("primary_action", {}).get("data", {})
has_run_context = surface_data.get("data_pet_card_has_context") == "true"
run_api_scenarios = {
    "run-stream",
    "run-failure",
    "permission-401",
    "permission-403",
    "generic-runtime-error",
    "stream-offline",
}
if (
    pet_window_height != "720" or
    surface_overflow or
    surface_vertical_overflow or
    bubble_overflow or
    bubble_vertical_overflow or
    primary_action_overflow or
    primary_action_vertical_overflow
):
    raise SystemExit(
        f"Unexpected DOM report: height={pet_window_height}, "
        f"surface_overflow={surface_overflow}, surface_vertical_overflow={surface_vertical_overflow}, "
        f"bubble_overflow={bubble_overflow}, bubble_vertical_overflow={bubble_vertical_overflow}, "
        f"primary_action_overflow={primary_action_overflow}, "
        f"primary_action_vertical_overflow={primary_action_vertical_overflow}"
    )
if scenario in run_api_scenarios and (
    bubble_within_vertical is not True or
    bubble_within_horizontal is not True or
    bubble_overlaps_live2d is not False
):
    raise SystemExit(f"Unsafe pet card spatial report: {spatial!r}")
expected_state = {
    "run-stream": "celebrating",
    "run-failure": "worried",
    "permission-401": "worried",
    "permission-403": "worried",
    "generic-runtime-error": "worried",
    "stream-offline": "offline",
}
expected_kind = {
    "run-stream": "trace",
    "run-failure": "trace",
    "permission-401": "bubble",
    "permission-403": "bubble",
    "generic-runtime-error": "bubble",
    "stream-offline": "offline",
}
if scenario in run_api_scenarios:
    if surface_data.get("data_cuu_behavior_state") != expected_state[scenario]:
        raise SystemExit(f"Unexpected Cuu state for {scenario}: {surface_data!r}")
    if bubble_data.get("data_pet_bubble_kind") != expected_kind[scenario]:
        raise SystemExit(f"Unexpected bubble kind for {scenario}: {bubble_data!r}")
    if bubble_data.get("data_pet_payload_ref_entity_type") != "agent_run":
        raise SystemExit(f"Missing agent_run payload ref for {scenario}: {bubble_data!r}")
    if not bubble_data.get("data_pet_payload_ref_entity_id") or not bubble_data.get("data_pet_payload_ref_href"):
        raise SystemExit(f"Incomplete payload ref for {scenario}: {bubble_data!r}")
    if primary_action_data.get("data_cuu_action_id") != "view_replay":
        raise SystemExit(f"Unexpected primary action for {scenario}: {primary_action_data!r}")
if scenario == "run-failure":
    expected_sections = ("Run progress", "Budget") if locale == "en-US" else ("运行进度", "预算")
    if not has_run_context or not all(text in bubble_text for text in expected_sections):
        raise SystemExit(
            f"Failed run card lost context sections: has_run_context={has_run_context}, "
            f"expected={expected_sections!r}, text={bubble_text!r}"
        )
scenario_text = {
    ("permission-401", "en-US"): ("This step needs permission", "Permission"),
    ("permission-403", "en-US"): ("This step needs permission", "Permission"),
    ("generic-runtime-error", "en-US"): ("This start did not finish", "Error"),
    ("stream-offline", "en-US"): ("Cuu cannot receive progress", "Offline"),
    ("permission-401", "zh-CN"): ("这步需要权限", "权限"),
    ("permission-403", "zh-CN"): ("这步需要权限", "权限"),
    ("generic-runtime-error", "zh-CN"): ("这次启动没有成功", "异常"),
    ("stream-offline", "zh-CN"): ("Cuu 暂时收不到进度", "离线"),
}
expected_text = scenario_text.get((scenario, locale))
if expected_text and not all(text in bubble_text for text in expected_text):
    raise SystemExit(f"Unexpected text for {scenario}/{locale}: expected={expected_text!r}, text={bubble_text!r}")
PY
  then
    return 1
  fi

  run_linux_menu_action_matrix

  if requires_real_de; then
    echo "real_de_tray_menu_smoke_done" > "$out_dir/linux-smoke-mode.txt"
  else
    echo "xvfb_openbox_devserver_smoke_done" > "$out_dir/linux-smoke-mode.txt"
  fi
}

bootstrap_real_desktop_session_env
record_env
collect_desktop_environment_probe
write_tray_menu_action_matrix
require_real_desktop_session

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
  smoke_entry="$(declare -f requires_real_de tray_menu_label_for_action bootstrap_real_desktop_session_env port_is_open safe_file_token capture_linux_screen status_notifier_items snapshot_status_notifier_item select_workhub_status_notifier_item status_notifier_menu_path capture_dbusmenu_layout dbusmenu_item_id_for_label emit_dbusmenu_click_event capture_linux_menu_action_state click_linux_dbus_menu_action run_linux_menu_action_matrix scenario_uses_run_api run_outcome_for_scenario api_fault_for_scenario wait_for_api_server wait_for_vite run_desktop_smoke); set -euo pipefail; repo_root='$repo_root'; out_dir='$out_dir'; wait_seconds='$wait_seconds'; scenario='$scenario'; locale='$locale'; port='$port'; api_port='$api_port'; require_real_de='$require_real_de'; menu_action_sequence='$menu_action_sequence'; run_desktop_smoke"
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
