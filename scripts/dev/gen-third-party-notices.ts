/**
 * Adapted from deepseek-harness (MIT), scripts/gen-third-party-notices.ts.
 * Copyright (c) 2026 DeepSeek. Upstream commit d347e703908d0406b7a7ef80e3a0e594d86b2215.
 * Local changes: dropped Cordis vendor-manifest parsing, Python/pyproject
 * handling, pnpm-patch disclosure, and the Claude Agent SDK platform-payload
 * special case (none apply to this workspace); resolves each dependency's
 * metadata by walking the node_modules of the manifest(s) that declare it
 * instead of scanning the pnpm virtual store; groups by license family
 * (MIT / Apache-2.0 / ISC / BSD / Unknown) instead of runtime-vs-dev tiers;
 * records each package's installed version in the table.
 *
 * 从工作区各 package.json 生成 THIRD_PARTY_NOTICES.md：列出每个直接外部依赖
 * （包名/版本/license），按 license 分组；未知/无法归类的 license 单独列出，
 * 促使人工复核而不是悄悄归进某一类。license/repo 元数据来自已安装的
 * node_modules，跑之前先 `pnpm install`。
 *
 * `--check` 比较生成结果与已提交文件的字节，不一致则非零退出（不写文件）——
 * 见 `pnpm audit:third-party-notices`；平时改依赖后跑 `pnpm gen:third-party-notices`
 * 重新生成并连同 package.json/pnpm-lock.yaml 一起提交。
 */
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const OUT = "THIRD_PARTY_NOTICES.md";

/** Manifest fields this generator reads. */
interface Manifest {
  name?: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const ALL_KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/**
 * The `packages:` globs pnpm-workspace.yaml declares, read without a YAML
 * dependency: this file's shape is a short flat list under one top-level key,
 * so a line-anchored regex is simpler and cheaper than pulling in `js-yaml`
 * for three lines. A workspace member area added outside that list (e.g. a
 * new `workers/*` package) is picked up the next time this runs; a malformed
 * or emptied `packages:` block fails loud instead of silently scanning zero
 * manifests.
 */
function workspaceGlobs(): string[] {
  const text = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const packagesBlock = /^packages:\n((?:[ \t]+-[^\n]*\n?)+)/mu.exec(text)?.[1];
  if (packagesBlock === undefined) {
    throw new Error("gen-third-party-notices: pnpm-workspace.yaml has no `packages:` list; the parser needs updating.");
  }
  const globs = [...packagesBlock.matchAll(/-\s*"([^"]+)"/gu)].map((match) => match[1]!);
  if (globs.length === 0) {
    throw new Error("gen-third-party-notices: pnpm-workspace.yaml `packages:` list parsed to zero globs.");
  }
  return globs;
}

/** Every workspace manifest keyed by repository-relative path, plus the set of workspace package names. */
function loadWorkspaceManifests(): { manifests: Map<string, Manifest>; names: Set<string> } {
  const manifests = new Map<string, Manifest>();
  const names = new Set<string>();
  const patterns = ["package.json", ...workspaceGlobs().map((glob) => `${glob}/package.json`)];
  for (const pattern of patterns) {
    for (const path of globSync(pattern, { cwd: root })) {
      const normalized = path.replaceAll("\\", "/");
      const manifest = JSON.parse(readFileSync(join(root, normalized), "utf8")) as Manifest;
      manifests.set(normalized, manifest);
      if (manifest.name !== undefined) names.add(manifest.name);
    }
  }
  if (manifests.size < 10) {
    throw new Error(`gen-third-party-notices: only ${manifests.size} workspace manifests found; the glob set looks stale.`);
  }
  return { manifests, names };
}

/** One disclosed external dependency, resolved from the installed tree. */
interface ExternalDep {
  name: string;
  version: string;
  license: string | undefined;
  repo: string | undefined;
}

/** Manifest directories (relative to root) that declare an external dependency, keyed by name. */
function collectDeclaringDirs(manifests: Map<string, Manifest>, names: Set<string>): Map<string, string[]> {
  const declaring = new Map<string, string[]>();
  for (const [path, manifest] of manifests) {
    const dir = path === "package.json" ? "." : path.slice(0, -"/package.json".length);
    for (const kind of ALL_KINDS) {
      for (const [dep, range] of Object.entries(manifest[kind] ?? {})) {
        if (names.has(dep) || range.startsWith("workspace:")) continue;
        const dirs = declaring.get(dep) ?? [];
        if (!dirs.includes(dir)) dirs.push(dir);
        declaring.set(dep, dirs);
      }
    }
  }
  return declaring;
}

/** Normalize a manifest repository/homepage field to a browsable https URL. */
function normalizeRepo(raw: string | { url?: string } | undefined): string | undefined {
  const value = typeof raw === "string" ? raw : raw?.url;
  if (value === undefined || value === "") return undefined;
  const url = value
    .replace(/^git\+ssh:\/\/git@/u, "https://")
    .replace(/^git\+/u, "")
    .replace(/^git:\/\//u, "https://")
    .replace(/^github:/u, "https://github.com/")
    .replace(/\.git$/u, "");
  return url.startsWith("http") ? url : `https://github.com/${url}`;
}

/** An installed package's manifest fields this generator reads (superset of the workspace `Manifest` shape). */
interface InstalledManifest {
  version?: string;
  license?: string;
  repository?: string | { url?: string };
  homepage?: string;
}

/** Resolve one external dependency's installed package.json from the node_modules of each manifest declaring it. */
function resolveExternalDep(name: string, declaringDirs: string[]): ExternalDep {
  let resolved: { dir: string; manifest: InstalledManifest } | undefined;
  for (const dir of declaringDirs) {
    const candidate = resolve(root, dir, "node_modules", name, "package.json");
    if (!existsSync(candidate)) continue;
    const manifest = JSON.parse(readFileSync(candidate, "utf8")) as InstalledManifest;
    if (resolved === undefined) {
      resolved = { dir, manifest };
    } else if (resolved.manifest.version !== manifest.version) {
      throw new Error(
        `gen-third-party-notices: ${name} resolves to different versions across declaring manifests `
          + `(${resolved.dir} -> ${resolved.manifest.version}, ${dir} -> ${manifest.version}); the workspace needs a single resolved version before this can be disclosed.`,
      );
    }
  }
  if (resolved === undefined) {
    throw new Error(`gen-third-party-notices: cannot resolve ${name} in node_modules under ${declaringDirs.join(", ")}; run \`pnpm install\`.`);
  }
  const { manifest } = resolved;
  if (manifest.version === undefined) {
    throw new Error(`gen-third-party-notices: installed ${name} has no version field.`);
  }
  return { name, version: manifest.version, license: manifest.license, repo: normalizeRepo(manifest.repository ?? manifest.homepage) };
}

type LicenseBucket = "MIT" | "Apache-2.0" | "ISC" | "BSD" | "Unknown";
const BUCKET_ORDER: LicenseBucket[] = ["MIT", "Apache-2.0", "ISC", "BSD", "Unknown"];

/**
 * Classify a manifest license string into one of the four permissive families
 * this project ships without further review, or "Unknown" — which also
 * catches a missing field, a copyleft license, an unparsed dual-license
 * expression, or anything this list has never seen. Unknown fails closed to
 * manual review rather than guessing a family.
 */
function bucketFor(license: string | undefined): LicenseBucket {
  if (license === undefined) return "Unknown";
  const normalized = license.trim();
  if (normalized === "MIT") return "MIT";
  if (normalized === "Apache-2.0") return "Apache-2.0";
  if (normalized === "ISC") return "ISC";
  if (normalized === "0BSD" || /^BSD-[23]-Clause$/u.test(normalized)) return "BSD";
  return "Unknown";
}

/** Manually maintained record of concepts/code borrowed from deepseek-harness. Update when a new borrow lands. */
const DSH_BORROWS = [
  { what: "Agent Note decision-log system (proposed/implemented/rejected/archived lifecycle)", kind: "idea/format — no code copied", where: "`.agents/notes/README.md`" },
  { what: "Root `AGENTS.md` conventions (repo map + must-run gates + review rules, line-budgeted)", kind: "idea/format — no code copied", where: "`AGENTS.md`" },
  { what: "`gen-X` / `--check` regenerate-rather-than-reject pattern for this generator", kind: "adapted code — MIT header retained", where: "this file's header comment" },
  { what: "lefthook pre-commit job layering (staged whitespace/path/audit checks + regenerate-rather-than-reject notices job)", kind: "adapted config — MIT header retained", where: "`lefthook.yml`'s header comment" },
];

/** Render one license-family table, or nothing when the bucket is empty. */
function renderBucket(bucket: LicenseBucket, deps: ExternalDep[]): string {
  if (deps.length === 0) return "";
  const intro = bucket === "Unknown"
    ? "## Unknown license\n\nThe following dependencies carry a license field this generator could not classify (missing, copyleft, or an unparsed expression). Review the upstream terms before shipping a change that adds to this list.\n\n"
    : `## ${bucket}\n\n`;
  const rows = deps.map((dep) => `| ${dep.repo ? `[\`${dep.name}\`](${dep.repo})` : `\`${dep.name}\``} | ${dep.version} | ${dep.license ?? "(missing)"} |`);
  return `${intro}| Package | Version | License |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
}

/** Render the complete notices document. */
export function render(): string {
  const { manifests, names } = loadWorkspaceManifests();
  const declaring = collectDeclaringDirs(manifests, names);
  const deps = [...declaring.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => resolveExternalDep(name, declaring.get(name)!));
  const buckets = new Map<LicenseBucket, ExternalDep[]>(BUCKET_ORDER.map((bucket) => [bucket, []]));
  for (const dep of deps) buckets.get(bucketFor(dep.license))!.push(dep);

  const borrowRows = DSH_BORROWS.map((row) => `| ${row.what} | ${row.kind} | ${row.where} |`);

  return `<!-- Generated by scripts/dev/gen-third-party-notices.ts — do not edit by hand.
     Run \`pnpm gen:third-party-notices\` to regenerate. -->

# Third-Party Notices

WorkHub is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). It depends on the third-party software listed below; each project remains under its own license terms, which this file does not change.

This file lists every **direct** external dependency declared by a workspace \`package.json\` (root, \`apps/*\`, \`packages/*\`), grouped by license family. It is generated from the workspace manifests by \`scripts/dev/gen-third-party-notices.ts\`; \`pnpm audit:third-party-notices\` (\`--check\`) asserts the committed bytes match. The complete transitive closure with exact pinned versions is recorded in [\`pnpm-lock.yaml\`](pnpm-lock.yaml).

## Vendored source

\`packages/agent/src/loop2/vendor/\` vendors the pure-function agent loop from [pi](https://github.com/earendil-works/pi) (MIT, Copyright (c) 2025 Mario Zechner). Upstream commit, file-by-file mapping, and every local adaptation are recorded in [\`packages/agent/src/loop2/NOTICE.md\`](packages/agent/src/loop2/NOTICE.md).

${BUCKET_ORDER.map((bucket) => renderBucket(bucket, buckets.get(bucket)!)).filter(Boolean).join("\n")}
## Derived from DeepSeek Harness (MIT)

WorkHub borrows selected engineering conventions and, in places, code from [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT, Copyright (c) 2026 DeepSeek), read locally at \`reference/deepseek-harness\` (upstream commit \`d347e703908d0406b7a7ef80e3a0e594d86b2215\`). This table is manually maintained and updated whenever a new borrow lands — it does not enumerate general inspiration, only borrows recorded against this generator's known inputs. "idea/format" rows copied no source and carry no MIT notice obligation; "adapted code" rows carry their own attribution header in the file itself, reproduced here as the notice this project retains.

| What | Kind | Where |
| --- | --- | --- |
${borrowRows.join("\n")}
`;
}

/** CLI entry: default writes the notices; `--check` fails if the committed copy is stale. */
function main(): void {
  const content = render();
  if (process.argv.includes("--check")) {
    let committed: string | null;
    try {
      committed = readFileSync(join(root, OUT), "utf8");
    } catch {
      // Only ENOENT (never generated yet) is expected here; anything else is
      // a real filesystem problem the same remedy (regenerate) does not fix,
      // but there is no committed-vs-generated distinction to draw without a
      // readable file, so the check still reports staleness.
      committed = null;
    }
    if (committed === content) {
      console.log(`gen-third-party-notices: ${OUT} is up to date.`);
      process.exit(0);
    }
    console.error(`gen-third-party-notices: ${OUT} is stale. Run \`pnpm gen:third-party-notices\` and commit ${OUT}.`);
    process.exit(1);
  }
  writeFileSync(join(root, OUT), content);
  console.log(`gen-third-party-notices: wrote ${OUT}.`);
}

main();
