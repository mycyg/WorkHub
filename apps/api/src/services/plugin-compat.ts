/**
 * 安装前静态体检（R24-P 阶段 1）。**不执行插件任何代码**——只 stat 目录、读 `package.json`。
 *
 * 为什么要有这一层：阶段 0 的实测（见 `.agents/notes/implemented/2026-09-05-dsh-plugin-host-phase0.md`
 * 的 Consequences）里，报告点名的真实插件 `dsh-plugin-finance-data@0.2.0` 在宿主里加载期直接抛错——
 * 它是对着另一个 dsh-tools 版本发的。没有体检，用户会遇到「装了三个有两个装不上」，还只能从
 * 一段英文堆栈里猜原因。
 *
 * 五条规则（id 是契约里的固定枚举 `pluginCompatCheckIdSchema`，两端 UI 靠它出人话）：
 *
 * | id              | 判据                                                     | 结论  |
 * |-----------------|----------------------------------------------------------|-------|
 * | manifest        | 路径不是本机绝对目录 / 目录不存在 / 无 package.json / JSON 坏 | block |
 * | client_surface  | package.json 里有 `dsh.client`                            | block |
 * | install_scripts | scripts 里有 preinstall/install/postinstall/prepare        | block |
 * | dsh_tools_peer  | peer 的 `@deepseek-ai/dsh-tools` 范围与宿主捆绑版本不相容    | warn  |
 * | bundle_manifest | 没有 `dsh.bundle.patch`                                   | warn  |
 *
 * 两条 block 的道理各不相同，都不是保守起见：
 * - `dsh.client` 是**界面/主题类**插件的标志（浏览器侧第二个 Cordis Context + React +
 *   `ctx.slots.register`）。WorkHub 全仓零 `.tsx`、桌面端是字符串模板 DOM，这一类**永远**兼容不了。
 *   装进来只会得到一个「加载成功但什么都没发生」的空壳，还不如在安装前说清楚。
 * - `prepare`/`postinstall` 等安装期脚本是**任何沙箱之外的任意代码执行**（dsh 自己的
 *   `SAFETY.md` 就这么写）。宿主子进程的 env 白名单管不到它——它在 pnpm/npm 装包时就跑了。
 *
 * warn 一律**允许尝试**：静态体检没法预判 dsh 的 `defineTool` 会不会在加载期抛错，说「可能装不上」
 * 已经是这一层能诚实给出的最强结论，剩下的交给真的试加载。
 */
import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { hostBundledDshToolsVersion } from "@workhub/plugin-host";
import type { PluginCompatCheck, PluginCompatReport } from "@workhub/contracts";

/** 安装期会被包管理器执行的脚本名。命中任何一个就拒装。 */
export const PLUGIN_INSTALL_SCRIPT_KEYS = ["preinstall", "install", "postinstall", "prepare"] as const;

const DSH_TOOLS_PACKAGE = "@deepseek-ai/dsh-tools";

export type PluginManifest = {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  scripts?: unknown;
  dsh?: unknown;
  peerDependencies?: unknown;
  dependencies?: unknown;
};

export type EvaluatePluginManifestInput = {
  /** 读到的 package.json（读不出/不是对象时传 undefined）。 */
  manifest: PluginManifest | undefined;
  /** 读不出时的英文原因（进 manifest 这条的 detail）。 */
  manifestError?: string | undefined;
  /** 宿主捆绑的 dsh-tools 版本；读不出时该条降级为「说不准」。 */
  hostDshToolsVersion?: string | undefined;
  checkedAt: Date;
};

function stringOrUndefined(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 只做「这个版本落在这个范围里吗」的够用判断，不引 semver 依赖。
 * 认得的形式：`*` / `x` / 精确版本 / `^` / `~` / `>=`。**认不出就返回 undefined**（说不准），
 * 由调用方转成一条诚实的 warn，而不是假装判断过。
 */
export function satisfiesDshToolsRange(range: string, version: string): boolean | undefined {
  const cleanRange = range.trim();
  const cleanVersion = version.trim();
  if (cleanRange.length === 0 || cleanVersion.length === 0) {
    return undefined;
  }
  if (cleanRange === "*" || cleanRange === "x" || cleanRange === "latest") {
    return true;
  }
  const target = parseSemver(cleanVersion);
  if (!target) {
    return undefined;
  }
  const match = /^(\^|~|>=|=)?\s*(.+)$/u.exec(cleanRange);
  if (!match) {
    return undefined;
  }
  const operator = match[1] ?? "=";
  const base = parseSemver(match[2] ?? "");
  if (!base) {
    return undefined;
  }
  if (operator === "=") {
    return compareSemver(target, base) === 0;
  }
  if (compareSemver(target, base) < 0) {
    return false;
  }
  if (operator === ">=") {
    return true;
  }
  if (operator === "~") {
    // ~1.2.3 → >=1.2.3 <1.3.0
    return target.major === base.major && target.minor === base.minor;
  }
  // ^1.2.3 → <2.0.0；^0.1.2 → <0.2.0；^0.0.3 → 只有 0.0.3（npm 的 0.x 语义）
  if (base.major > 0) {
    return target.major === base.major;
  }
  if (base.minor > 0) {
    return target.major === 0 && target.minor === base.minor;
  }
  return target.major === 0 && target.minor === 0 && target.patch === base.patch;
}

type Semver = { major: number; minor: number; patch: number; prerelease: string };

function parseSemver(raw: string): Semver | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ""
  };
}

function compareSemver(left: Semver, right: Semver): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  // 预发布版排在同一个正式版之前（semver §11）。dsh 生态整个跑在 -rc.N 上，这条不是学术细节。
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === "") return 1;
  if (right.prerelease === "") return -1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNum = /^\d+$/u.test(a) ? Number(a) : undefined;
    const bNum = /^\d+$/u.test(b) ? Number(b) : undefined;
    if (aNum !== undefined && bNum !== undefined) {
      if (aNum !== bNum) return aNum - bNum;
      continue;
    }
    if (aNum !== undefined) return -1;
    if (bNum !== undefined) return 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/** 纯判定：给一份 package.json（或它读不出来的原因），出一份体检报告。无 IO、可直接单测。 */
export function evaluatePluginManifest(input: EvaluatePluginManifestInput): PluginCompatReport {
  const checks: PluginCompatCheck[] = [];
  const checkedAt = input.checkedAt.toISOString();
  const manifest = input.manifest;

  if (!manifest) {
    checks.push({
      id: "manifest",
      level: "block",
      ...(input.manifestError ? { detail: input.manifestError.slice(0, 500) } : {})
    });
    return { verdict: "blocked", checks, checked_at: checkedAt };
  }
  checks.push({ id: "manifest", level: "pass" });

  const dsh = record(manifest.dsh);
  const clientSurface = dsh?.["client"];
  if (clientSurface !== undefined && clientSurface !== null && clientSurface !== false) {
    checks.push({
      id: "client_surface",
      level: "block",
      detail: "declares dsh.client (browser-side UI/theme plugin)"
    });
  } else {
    checks.push({ id: "client_surface", level: "pass" });
  }

  const scripts = record(manifest.scripts);
  const installScripts = scripts
    ? PLUGIN_INSTALL_SCRIPT_KEYS.filter((key) => typeof scripts[key] === "string" && scripts[key] !== "")
    : [];
  if (installScripts.length > 0) {
    checks.push({
      id: "install_scripts",
      level: "block",
      detail: `install-time scripts: ${installScripts.join(", ")}`
    });
  } else {
    checks.push({ id: "install_scripts", level: "pass" });
  }

  const peers = record(manifest.peerDependencies);
  const peerRange = stringOrUndefined(peers?.[DSH_TOOLS_PACKAGE], 120);
  const hostVersion = stringOrUndefined(input.hostDshToolsVersion, 80);
  if (!peerRange) {
    // 不声明这个 peer 的插件多半不是 dsh 工具型插件——不拦，但要说一声。
    checks.push({ id: "dsh_tools_peer", level: "warn", detail: `no ${DSH_TOOLS_PACKAGE} peer declared` });
  } else if (!hostVersion) {
    checks.push({ id: "dsh_tools_peer", level: "warn", detail: "host bundled version is unknown" });
  } else {
    const satisfied = satisfiesDshToolsRange(peerRange, hostVersion);
    if (satisfied === true) {
      checks.push({ id: "dsh_tools_peer", level: "pass", detail: `${peerRange} covers host ${hostVersion}` });
    } else if (satisfied === false) {
      checks.push({
        id: "dsh_tools_peer",
        level: "warn",
        detail: `wants ${peerRange}, host bundles ${hostVersion}`
      });
    } else {
      checks.push({ id: "dsh_tools_peer", level: "warn", detail: `unrecognized range ${peerRange}` });
    }
  }

  const bundlePatch = record(dsh?.["bundle"])?.["patch"];
  if (typeof bundlePatch === "string" && bundlePatch.length > 0) {
    checks.push({ id: "bundle_manifest", level: "pass" });
  } else {
    checks.push({ id: "bundle_manifest", level: "warn", detail: "no dsh.bundle.patch in package.json" });
  }

  const verdict = checks.some((check) => check.level === "block")
    ? "blocked"
    : checks.some((check) => check.level === "warn")
      ? "warn"
      : "ok";
  return {
    verdict,
    checks,
    ...(stringOrUndefined(manifest.name, 200) ? { manifest_name: stringOrUndefined(manifest.name, 200)! } : {}),
    ...(stringOrUndefined(manifest.version, 80) ? { manifest_version: stringOrUndefined(manifest.version, 80)! } : {}),
    ...(stringOrUndefined(manifest.license, 120) ? { manifest_license: stringOrUndefined(manifest.license, 120)! } : {}),
    ...(peerRange ? { peer_dsh_tools_range: peerRange } : {}),
    ...(hostVersion ? { host_dsh_tools_version: hostVersion } : {}),
    checked_at: checkedAt
  };
}

export type PluginInspection = {
  /** 归一化后的绝对路径（登记进 DB 的就是它——两次装同一个目录要能撞上唯一索引）。 */
  sourcePath: string;
  /** 插件自报包名；读不出时退化成目录名（不编一个「未知插件」出来）。 */
  name: string;
  version?: string;
  report: PluginCompatReport;
};

export type InspectPluginSourceOptions = {
  hostDshToolsVersion?: string | undefined;
  now?: () => Date;
};

/**
 * 归一化安装路径。只认**本机绝对目录**：
 * - 带 scheme（`npm:` / `https:` / `git+ssh:`）→ 拒。从这些源装包会跑它自己的 prepare/postinstall。
 * - 相对路径 → 拒。相对谁？API 进程的 cwd 是部署细节，用户看不见也控制不了，含糊的路径不如直接拒。
 */
export function normalizePluginSourcePath(raw: string): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "source path is empty" };
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
    return { ok: false, reason: "only a local directory is installable (no npm / git / url source)" };
  }
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, reason: "source path must be absolute" };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, reason: "source path contains a null byte" };
  }
  // 末尾斜杠一并抹掉：`/srv/p/echo` 与 `/srv/p/echo/` 是同一个目录，唯一索引
  // （plugins_workspace_source_path_uq）要能把「装两次」认出来，否则同一个插件能被装成两条记录。
  const normalized = path.normalize(trimmed).replace(/\/+$/u, "");
  return { ok: true, path: normalized.length > 0 ? normalized : "/" };
}

/** 真去磁盘上看一眼（stat + 读 package.json），然后交给纯判定。 */
export async function inspectPluginSource(
  sourcePath: string,
  options: InspectPluginSourceOptions = {}
): Promise<PluginInspection> {
  const now = options.now ?? (() => new Date());
  const hostDshToolsVersion = options.hostDshToolsVersion ?? hostBundledDshToolsVersion();
  const normalized = normalizePluginSourcePath(sourcePath);
  if (!normalized.ok) {
    return {
      sourcePath: sourcePath.trim(),
      name: path.basename(sourcePath.trim()) || sourcePath.trim(),
      report: evaluatePluginManifest({
        manifest: undefined,
        manifestError: normalized.reason,
        hostDshToolsVersion,
        checkedAt: now()
      })
    };
  }
  const dir = normalized.path;
  const fallbackName = path.basename(dir) || dir;
  let manifest: PluginManifest | undefined;
  let manifestError: string | undefined;
  try {
    const stats = await stat(dir);
    if (!stats.isDirectory()) {
      manifestError = "source path is not a directory";
    } else {
      const raw = await readFile(path.join(dir, "package.json"), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        manifestError = "package.json is not a JSON object";
      } else {
        manifest = parsed as PluginManifest;
      }
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    manifestError =
      code === "ENOENT"
        ? "no such directory, or it has no package.json"
        : error instanceof Error
          ? error.message
          : String(error);
  }
  const report = evaluatePluginManifest({ manifest, manifestError, hostDshToolsVersion, checkedAt: now() });
  return {
    sourcePath: dir,
    name: report.manifest_name ?? fallbackName,
    ...(report.manifest_version ? { version: report.manifest_version } : {}),
    report
  };
}
