#!/usr/bin/env bash
# WorkHub 桌面 · 正式 .app 构建 + 验签门禁（macOS 专用，本机/CI-macOS 手动跑）。
#
# 背景（BUG-01 / P0）：`cargo tauri build` 在没有签名身份时 exit 0，但 tauri-bundler 的
# macos/app.rs 在 `signing_identity == None && APPLE_CERTIFICATE 未设` 时直接 `Ok(None)`——
# 整个 .app bundle 根本不签名（只有 linker 给 arm64 可执行体打的 ad-hoc 标记，bundle 无
# `_CodeSignature/CodeResources`）。于是 `codesign --verify` 报「code has no resources but
# signature indicates they must be present」、`spctl` 报「bundle format unrecognized」、
# 可执行体被 AMFI SIGKILL(137)。
#
# 修法双保险：
#   1) tauri.conf.json 的 bundle.macOS.signingIdentity="-"（+ hardenedRuntime=false）让
#      `cargo tauri build` 自身就 ad-hoc 由内向外签整包（frameworks→sidecar→.app），一步到位。
#   2) 本脚本作为“构建 + 验签 smoke”门禁：构建后强制 codesign --verify；万一 bundle 仍缺
#      `_CodeSignature`（旧 tauri/被环境覆盖），兜底 ad-hoc 重签一次再验，验不过就非零退出。
#
# 注意：ad-hoc 签名不是 Apple 公证，`spctl --assess` 仍会「rejected（未公证）」——这是预期的，
# 本门禁只保证「bundle 结构完整、签名自洽、能本机启动」，不保证 Gatekeeper 放行分发。
#
# 产物路径口（R24-S2 W-4）：不带 --target 的本机构建产物在 target/release/bundle/macos/，
# 但 `cargo tauri build --target <triple>` 交叉/多 target 构建时产物在
# target/<triple>/release/bundle/macos/ 下——原先写死前者，桌面发布 workflow 每个矩阵 target
# 跑完都会在这一步报「expected bundle not found」。路径解析顺序（不改变默认行为）：
#   1) WORKHUB_MACOS_BUILD_APP_PATH 显式给整条路径（绝对路径直接用；相对路径按仓库根解析）——
#      CI 在 WORKHUB_MACOS_BUILD_SKIP_BUILD=1 模式下没有 "$@" 可供解析 --target，只能靠这个。
#   2) 否则从传给本脚本的构建参数里找 --target/-t <triple>（本机手动交叉构建时最省心，
#      跟真正执行的 `cargo tauri build "$@"` 用的是同一份参数，不会两处漂移）。
#   3) 都没有 → 回退到原先的默认路径（本机原生构建，行为不变）。
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
tauri_dir="$repo_root/client-tauri/src-tauri"

resolve_app_path() {
  if [[ -n "${WORKHUB_MACOS_BUILD_APP_PATH:-}" ]]; then
    if [[ "$WORKHUB_MACOS_BUILD_APP_PATH" == /* ]]; then
      echo "$WORKHUB_MACOS_BUILD_APP_PATH"
    else
      echo "$repo_root/$WORKHUB_MACOS_BUILD_APP_PATH"
    fi
    return
  fi

  local build_target=""
  local args=("$@")
  local i arg
  for ((i = 0; i < ${#args[@]}; i++)); do
    arg="${args[$i]}"
    case "$arg" in
      --target=*) build_target="${arg#--target=}" ;;
      --target | -t)
        if ((i + 1 < ${#args[@]})); then
          build_target="${args[$((i + 1))]}"
        fi
        ;;
    esac
  done

  if [[ -n "$build_target" ]]; then
    echo "$tauri_dir/target/$build_target/release/bundle/macos/WorkHub.app"
  else
    echo "$tauri_dir/target/release/bundle/macos/WorkHub.app"
  fi
}

app_path="$(resolve_app_path "$@")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-macos-app: this gate only runs on macOS (uname=$(uname -s)); skipping." >&2
  exit 0
fi

# WORKHUB_MACOS_BUILD_SKIP_BUILD=1 → 只对已存在的 .app 跑验签门禁（不重新构建）。
if [[ "${WORKHUB_MACOS_BUILD_SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> cargo tauri build (release .app; ad-hoc self-signed via tauri.conf signingIdentity=\"-\")"
  (cd "$tauri_dir" && cargo tauri build "$@")
fi

if [[ ! -d "$app_path" ]]; then
  echo "build-macos-app: expected bundle not found at $app_path" >&2
  exit 1
fi

# 兜底：bundle 若缺 _CodeSignature（signingIdentity 未生效/被旧 CLI 忽略），ad-hoc 重签一次。
if [[ ! -d "$app_path/Contents/_CodeSignature" ]]; then
  echo "==> bundle missing _CodeSignature; applying ad-hoc re-sign fallback"
  codesign --force --deep --sign - "$app_path"
fi

echo "==> codesign --verify (structural seal must be intact)"
if ! codesign --verify --deep --strict --verbose=2 "$app_path"; then
  echo "build-macos-app: codesign --verify FAILED — bundle seal is broken (BUG-01 regression)." >&2
  exit 1
fi

# spctl 仅用于诊断：ad-hoc 不公证必然 rejected，但绝不能再是「bundle format unrecognized」。
echo "==> spctl assessment (diagnostic; ad-hoc is expected to be 'rejected', not 'unrecognized')"
spctl_out="$(spctl -a -vvv -t exec "$app_path" 2>&1 || true)"
echo "$spctl_out"
if echo "$spctl_out" | grep -qi "bundle format unrecognized"; then
  echo "build-macos-app: spctl reports 'bundle format unrecognized' — bundle is still malformed." >&2
  exit 1
fi

echo "==> OK: $app_path is ad-hoc signed and structurally valid (launchable locally)."
