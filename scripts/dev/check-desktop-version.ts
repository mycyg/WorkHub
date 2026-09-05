/**
 * 桌面端版本号一致性门禁（R24-S2 W-3）。
 *
 * 背景：根 package.json、apps/desktop-webview/package.json、
 * client-tauri/src-tauri/Cargo.toml、client-tauri/src-tauri/tauri.conf.json 四处版本号
 * 目前一致纯属巧合（都是 0.1.0）——没有任何门禁校验它们，漂移后的症状是"Release 资产名里的
 * 版本跟应用内显示的版本对不上"，很难在事后定位。本门禁把这类漂移从隐性 bug 变成 CI 红。
 *
 * 挂进 pnpm lint（package.json 的 audit:migrations 之后）。
 */
import { CARGO_LOCK_TARGET, ROOT_TARGET, SYNCED_TARGETS, readVersion } from "./desktop-version-files.js";

const rootVersion = readVersion(ROOT_TARGET);
if (!rootVersion) {
  throw new Error(`${ROOT_TARGET.path}: could not read a "version" field (single source of truth)`);
}

const syncedResults = SYNCED_TARGETS.map((target) => ({ target, version: readVersion(target) }));
const cargoLockVersion = readVersion(CARGO_LOCK_TARGET);

const lines = [
  `${ROOT_TARGET.label}: ${rootVersion}`,
  ...syncedResults.map((result) => `${result.target.label}: ${result.version ?? "<missing>"}`),
  `${CARGO_LOCK_TARGET.label}: ${cargoLockVersion ?? "<missing>"}`
];

const mismatched = syncedResults.filter((result) => result.version !== rootVersion);
const cargoLockMismatched = cargoLockVersion !== rootVersion;

if (mismatched.length > 0 || cargoLockMismatched) {
  throw new Error(
    [
      `desktop version audit failed — every desktop artifact must carry the same version as ${ROOT_TARGET.path} (${rootVersion}):`,
      ...lines.map((line) => `  ${line}`),
      "Fix with: pnpm sync:desktop-version"
    ].join("\n")
  );
}

console.log(`desktop version audit passed (${rootVersion}):\n${lines.map((line) => `  ${line}`).join("\n")}`);
