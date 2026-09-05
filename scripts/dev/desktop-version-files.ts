/**
 * 桌面端版本号「单一事实源 + 四处同步」的读写辅助（R24-S2 W-3）。
 *
 * 单一事实源 = 根 package.json 的 "version"。另外四处（apps/desktop-webview/package.json、
 * client-tauri/src-tauri/Cargo.toml 的 [package].version、client-tauri/src-tauri/tauri.conf.json
 * 的 "version"，以及不计入门禁主报告、但同样必须同步的 Cargo.lock 里 workhub-client-tauri 的
 * version 行）都应该跟它一致。
 *
 * 由 check-desktop-version.ts（门禁，只读）与 sync-desktop-version.ts（同步，读写）共用同一份
 * 解析逻辑——两处各写一份的话，同步脚本"修好"的字段和门禁脚本"检查"的字段很容易悄悄长歪。
 *
 * 写入用文本替换而不是 JSON.parse + JSON.stringify 整份重新序列化：后者会按 JS 对象 key
 * 顺序重新格式化整份文件（哪怕 version 值没变也可能改缩进/换行），在 git diff 里制造无关噪音，
 * 也可能被 qa:r2-release-gate 的 git 卫生门认成"意外改动"。TOML/Cargo.lock 同理用行级替换。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const TAURI_CRATE_NAME = "workhub-client-tauri";

export type DesktopVersionTargetKind = "json" | "cargo-toml-package" | "cargo-lock-crate";

export type DesktopVersionTarget = {
  label: string;
  path: string;
  kind: DesktopVersionTargetKind;
};

/** 单一事实源。 */
export const ROOT_TARGET: DesktopVersionTarget = {
  label: "根 package.json（单一事实源）",
  path: "package.json",
  kind: "json"
};

/** "四处一致"里,除根 package.json 外的另外三处——check-desktop-version.ts 的主门禁只比这三个。 */
export const SYNCED_TARGETS: DesktopVersionTarget[] = [
  { label: "apps/desktop-webview/package.json", path: "apps/desktop-webview/package.json", kind: "json" },
  { label: "client-tauri/src-tauri/Cargo.toml", path: "client-tauri/src-tauri/Cargo.toml", kind: "cargo-toml-package" },
  { label: "client-tauri/src-tauri/tauri.conf.json", path: "client-tauri/src-tauri/tauri.conf.json", kind: "json" }
];

/**
 * 不计入「四处」主报告，但同样必须同步：漂移会让 `cargo build --locked/--frozen` 直接失败，
 * 或者让一次普通 `cargo build`/`clippy` 悄悄改写 Cargo.lock（之后 git 卫生门会看到意外 diff）。
 */
export const CARGO_LOCK_TARGET: DesktopVersionTarget = {
  label: "client-tauri/src-tauri/Cargo.lock（workhub-client-tauri crate）",
  path: "client-tauri/src-tauri/Cargo.lock",
  kind: "cargo-lock-crate"
};

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export function isValidSemver(version: string): boolean {
  return SEMVER_RE.test(version);
}

function readJsonVersion(path: string): string | null {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : null;
}

function readCargoTomlPackageVersion(path: string): string | null {
  const lines = readFileSync(path, "utf8").split(/\r?\n/u);
  let inPackage = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.+\]$/u.test(trimmed)) {
      inPackage = trimmed === "[package]";
      continue;
    }
    if (inPackage) {
      const match = /^version\s*=\s*"([^"]*)"/u.exec(trimmed);
      if (match) return match[1];
    }
  }
  return null;
}

function readCargoLockCrateVersion(path: string, crateName: string): string | null {
  const text = readFileSync(path, "utf8");
  const marker = `name = "${crateName}"`;
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const rest = text.slice(idx + marker.length);
  const match = /^\r?\n\s*version = "([^"]*)"/u.exec(rest);
  return match ? match[1] : null;
}

export function readVersion(target: DesktopVersionTarget): string | null {
  if (!existsSync(target.path)) return null;
  switch (target.kind) {
    case "json":
      return readJsonVersion(target.path);
    case "cargo-toml-package":
      return readCargoTomlPackageVersion(target.path);
    case "cargo-lock-crate":
      return readCargoLockCrateVersion(target.path, TAURI_CRATE_NAME);
    default: {
      const exhaustive: never = target.kind;
      throw new Error(`unknown target kind: ${String(exhaustive)}`);
    }
  }
}

function writeJsonVersion(path: string, version: string): boolean {
  const text = readFileSync(path, "utf8");
  const globalPattern = /"version"\s*:\s*"([^"]*)"/gu;
  const matches = [...text.matchAll(globalPattern)];
  if (matches.length === 0) {
    throw new Error(`${path}: no "version" field found`);
  }
  if (matches.length > 1) {
    throw new Error(`${path}: expected exactly one "version" field, found ${matches.length}`);
  }
  if (matches[0][1] === version) return false;
  const updated = text.replace(/"version"\s*:\s*"([^"]*)"/u, `"version": "${version}"`);
  writeFileSync(path, updated, "utf8");
  return true;
}

function writeCargoTomlPackageVersion(path: string, version: string): boolean {
  const original = readFileSync(path, "utf8");
  const lines = original.split(/\r?\n/u);
  let inPackage = false;
  let changed = false;
  let found = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^\[.+\]$/u.test(trimmed)) {
      inPackage = trimmed === "[package]";
      continue;
    }
    if (inPackage) {
      const match = /^version\s*=\s*"([^"]*)"/u.exec(trimmed);
      if (match) {
        found = true;
        if (match[1] !== version) {
          lines[i] = lines[i].replace(/version\s*=\s*"[^"]*"/u, `version = "${version}"`);
          changed = true;
        }
        break;
      }
    }
  }
  if (!found) {
    throw new Error(`${path}: no [package] version field found`);
  }
  if (changed) {
    writeFileSync(path, lines.join("\n"), "utf8");
  }
  return changed;
}

function writeCargoLockCrateVersion(path: string, crateName: string, version: string): boolean {
  const text = readFileSync(path, "utf8");
  const marker = `name = "${crateName}"`;
  const idx = text.indexOf(marker);
  if (idx === -1) {
    throw new Error(`${path}: crate ${crateName} not found`);
  }
  const afterMarker = idx + marker.length;
  const rest = text.slice(afterMarker);
  const match = /^(\r?\n\s*)version = "([^"]*)"/u.exec(rest);
  if (!match) {
    throw new Error(`${path}: could not find a version line for crate ${crateName}`);
  }
  const [whole, leading, current] = match;
  if (current === version) return false;
  const updated = `${text.slice(0, afterMarker)}${leading}version = "${version}"${rest.slice(whole.length)}`;
  writeFileSync(path, updated, "utf8");
  return true;
}

/** 写入后返回是否真的改了内容（幂等：已经是目标版本时返回 false，不touch 文件/mtime）。 */
export function writeVersion(target: DesktopVersionTarget, version: string): boolean {
  if (!existsSync(target.path)) {
    throw new Error(`${target.path}: file not found`);
  }
  switch (target.kind) {
    case "json":
      return writeJsonVersion(target.path, version);
    case "cargo-toml-package":
      return writeCargoTomlPackageVersion(target.path, version);
    case "cargo-lock-crate":
      return writeCargoLockCrateVersion(target.path, TAURI_CRATE_NAME, version);
    default: {
      const exhaustive: never = target.kind;
      throw new Error(`unknown target kind: ${String(exhaustive)}`);
    }
  }
}
