/**
 * 桌面端版本号同步（R24-S2 W-3）。
 *
 * 用法：
 *   pnpm sync:desktop-version              # 把根 package.json 当前版本号原样同步到另外三处 + Cargo.lock
 *   pnpm sync:desktop-version -- 0.2.0     # 先把根 package.json 改成 0.2.0，再同步到其余各处
 *
 * 根 package.json 的 "version" 是单一事实源：不带参数时纯粹做"修复漂移"（比如有人手改了
 * tauri.conf.json 却忘了改别处）；带参数时先建立新的事实源再传播，两种模式共用同一套写入逻辑，
 * 因此"根版本号真的改了"与"其余各处真的追上了"不会出现中间态。
 *
 * 由 scripts/dev/release-desktop.sh 在打 tag 前调用；也可以单独跑来修复 check-desktop-version.ts
 * 报的漂移。
 */
import { CARGO_LOCK_TARGET, ROOT_TARGET, SYNCED_TARGETS, isValidSemver, readVersion, writeVersion } from "./desktop-version-files.js";

const requestedVersion = process.argv[2];

if (requestedVersion !== undefined) {
  if (!isValidSemver(requestedVersion)) {
    console.error(`sync-desktop-version: version must look like 0.2.0 (or 0.2.0-rc.1), got "${requestedVersion}"`);
    process.exit(1);
  }
  const bumped = writeVersion(ROOT_TARGET, requestedVersion);
  console.log(`sync-desktop-version: ${ROOT_TARGET.label} ${bumped ? `bumped to ${requestedVersion}` : `already ${requestedVersion}`}`);
}

const sourceVersion = readVersion(ROOT_TARGET);
if (!sourceVersion) {
  throw new Error(`${ROOT_TARGET.path}: could not read a "version" field (single source of truth)`);
}

const changed: string[] = [];
for (const target of [...SYNCED_TARGETS, CARGO_LOCK_TARGET]) {
  if (writeVersion(target, sourceVersion)) {
    changed.push(target.label);
  }
}

console.log(`sync-desktop-version: source version is ${sourceVersion} (${ROOT_TARGET.path})`);
if (changed.length === 0) {
  console.log("sync-desktop-version: all desktop artifacts already in sync, nothing to change");
} else {
  for (const label of changed) {
    console.log(`sync-desktop-version: updated ${label}`);
  }
}
