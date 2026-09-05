#!/usr/bin/env bash
# WorkHub 桌面端 · 发布打标签（R24-S2 W-3）。
#
# 用法：pnpm release:desktop -- 0.2.0
#
# 只做「同步版本号 + 提交 + 打本地 tag」，**不 push**——推送 v<version> tag 才是触发
# .github/workflows/desktop-release.yml 真发布的动作，必须由人显式执行（见脚本末尾提示）。
set -euo pipefail

version="${1:-}"
if [[ -z "$version" ]]; then
  echo "用法: pnpm release:desktop -- <version>，例如 pnpm release:desktop -- 0.2.0" >&2
  exit 1
fi
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "release-desktop: version 需形如 0.2.0 / 0.2.0-rc.1，收到：$version" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "release-desktop: 工作树不干净（git status --porcelain 非空），请先提交或暂存改动。" >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "main" ]]; then
  echo "release-desktop: 当前分支是 '$current_branch'，不是 main —— 发布必须从 main 打标签。" >&2
  exit 1
fi

tag="v$version"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "release-desktop: tag $tag 已存在，拒绝重复发布同一版本号。" >&2
  exit 1
fi

echo "==> 同步版本号到 $version（package.json ×2 / Cargo.toml / tauri.conf.json / Cargo.lock）"
pnpm exec tsx scripts/dev/sync-desktop-version.ts "$version"

changed_paths=(
  package.json
  apps/desktop-webview/package.json
  client-tauri/src-tauri/Cargo.toml
  client-tauri/src-tauri/tauri.conf.json
  client-tauri/src-tauri/Cargo.lock
)
# 严格 targeted add：绝不 git add -A（工作树可能残留其它无关改动）。
git add -- "${changed_paths[@]}"

if git diff --cached --quiet; then
  echo "release-desktop: 版本号本来就是 $version，没有可提交的改动——仍会打 tag $tag。"
else
  git commit -m "release: 桌面端 v$version"
fi

git tag -a "$tag" -m "WorkHub 桌面端 $tag"

cat <<EOF

==> 已在本地提交并打 tag $tag。这一步不会 push —— 推送 tag 就是触发发布，请确认无误后手动执行：

    git push origin $current_branch
    git push origin $tag

推送 $tag 后 .github/workflows/desktop-release.yml 会自动跑四平台打包并创建 Release 草稿；
人工核对 Release 页的资产（文件名/说明）无误后再点 Publish。想先不推 tag、只验证 workflow 本身，
改用手动干跑：gh workflow run desktop-release.yml --ref main -f dry_run=true
EOF
