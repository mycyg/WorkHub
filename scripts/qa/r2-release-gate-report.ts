import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

type GateStatus = "pass" | "fail";

type Gate = {
  id: string;
  label: string;
  status: GateStatus;
  evidence: string;
};

const root = process.cwd();
const docsRoot = join(root, "docs", "workhub");

function relativePath(path: string) {
  return relative(root, path).replace(/\\/gu, "/");
}

function readText(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
}

function git(args: string[]) {
  return run("git", args);
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if ([".git", "node_modules", "dist", "build"].includes(entry)) {
        continue;
      }
      files.push(...walk(absolute));
      continue;
    }
    files.push(absolute);
  }
  return files;
}

function countDocs() {
  return walk(docsRoot).filter((path) => path.endsWith(".md")).length;
}

function addGate(gates: Gate[], id: string, label: string, passed: boolean, evidence: string) {
  gates.push({
    id,
    label,
    status: passed ? "pass" : "fail",
    evidence
  });
}

function includesAll(text: string, needles: string[]) {
  return needles.every((needle) => text.includes(needle));
}

function changedReferencePaths() {
  const changed = [
    git(["diff", "--name-only"]),
    git(["diff", "--cached", "--name-only"])
  ]
    .flatMap((result) => result.stdout.split(/\r?\n/u))
    .filter(Boolean)
    .map((path) => path.replace(/\\/gu, "/"));
  return changed.filter((path) => path === "reference" || path === "references" || path.startsWith("reference/") || path.startsWith("references/"));
}

function trackedReferencePaths() {
  const result = git(["ls-files", "reference", "references"]);
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

function secretLikeDiffCount() {
  const unstaged = git(["diff", "-U0", "--", ".", ":(exclude)reference/**", ":(exclude)references/**"]);
  const staged = git(["diff", "--cached", "-U0", "--", ".", ":(exclude)reference/**", ":(exclude)references/**"]);
  // 词界前置：避免 "task-plan-…" 这类文件名里的 "sk-" 误报；真实 key（独立 token 开头的 sk-）仍命中。
  const matches = `${unstaged.stdout}\n${staged.stdout}`.match(/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/gu);
  return matches?.length ?? 0;
}

function staleDocMatches() {
  const stalePatterns = [
    "R2.6 待落",
    "stuck-job 后台调度、Proposal/审批 REST 权限全面收口仍未完成",
    "Proposal route 自身仍缺",
    "尚未接后台调度",
    "REST 权限全面收口仍未完成",
    /(?<!\d)58 篇/u,
    /当前 58(?!\d)/u,
    "R2.6 stuck-job 后台调度"
  ];
  const matches: string[] = [];
  for (const file of walk(docsRoot)) {
    if (!file.endsWith(".md")) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const pattern of stalePatterns) {
      const matched = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
      if (matched) {
        matches.push(`${relativePath(file)}:${typeof pattern === "string" ? pattern : pattern.source}`);
      }
    }
  }
  return matches;
}

const gates: Gate[] = [];
const packageJson = JSON.parse(readText("package.json")) as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
const workflow = readText(".github/workflows/verify.yml");
const readme = readText("docs/workhub/README.md");
const docCount = countDocs();
const readmeCount = Number(/\*\*(\d+) 篇文档已落盘\*\*/u.exec(readme)?.[1] ?? NaN);

addGate(
  gates,
  "scripts.release-gate",
  "Root package exposes R2 release gate and keeps it inside verify",
  scripts["qa:r2-release-gate"] === "tsx scripts/qa/r2-release-gate-report.ts" &&
    typeof scripts.lint === "string" &&
    scripts.lint.includes("pnpm qa:r2-release-gate") &&
    typeof scripts.verify === "string" &&
    scripts.verify.includes("pnpm lint"),
  `qa:r2-release-gate=${scripts["qa:r2-release-gate"] ?? "missing"}`
);

addGate(
  gates,
  "workflow.workspace",
  "Workspace CI runs pnpm verify on Node 22",
  includesAll(workflow, ["workspace:", "node-version: 22", "pnpm verify"]),
  "verify.yml workspace job"
);

addGate(
  gates,
  "workflow.migration-audit",
  "CI runs the real migration audit instead of a placeholder",
  includesAll(workflow, ["migration-audit:", "node-version: 22", "pnpm audit:migrations"]),
  "verify.yml migration-audit job"
);

addGate(
  gates,
  "workflow.r1-smoke",
  "CI keeps the R1 PostgreSQL smoke job wired",
  includesAll(workflow, ["r1-pg-smoke:", "postgres:16", "pnpm qa:r1-pg-smoke"]),
  "verify.yml r1-pg-smoke job"
);

addGate(
  gates,
  "workflow.r2-smoke",
  "CI keeps the R2 PostgreSQL plus Redis smoke job wired",
  includesAll(workflow, ["r2-pg-redis-smoke:", "postgres:16", "redis:7", "BROKER_BACKEND: redis", "WORKER_COUNT: \"2\"", "pnpm qa:r2-pg-redis-smoke"]),
  "verify.yml r2-pg-redis-smoke job"
);

addGate(
  gates,
  "docs.count",
  "README document count matches docs/workhub markdown files",
  Number.isFinite(readmeCount) && docCount === readmeCount && docCount >= 60,
  `README=${Number.isFinite(readmeCount) ? readmeCount : "missing"}, actual=${docCount}`
);

const requiredDocs = [
  "docs/workhub/02-ai-engine/r2-agent-run-claim-lease.md",
  "docs/workhub/02-ai-engine/r2-multi-worker-pump.md",
  "docs/workhub/02-ai-engine/r2-redis-broker-presence.md",
  "docs/workhub/02-ai-engine/r2-topic-boundary.md",
  "docs/workhub/02-ai-engine/r2-pg-redis-heartbeat-matrix.md",
  "docs/workhub/02-ai-engine/r2-recovery-rest-auth.md",
  "docs/workhub/02-ai-engine/r2-release-gate.md",
  "docs/workhub/06-roadmap/recovery-r0-r4-roadmap-2026-06-08.md",
  "docs/workhub/06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md"
];
const missingDocs = requiredDocs.filter((path) => !existsSync(join(root, path)));
addGate(gates, "docs.required", "R2 release documentation set exists", missingDocs.length === 0, missingDocs.length === 0 ? `${requiredDocs.length} docs` : `missing=${missingDocs.join(", ")}`);

const requiredRuntimePaths = [
  "apps/api/src/workers/agent-runner.ts",
  "apps/api/src/workers/agent-run-recovery.ts",
  "apps/api/src/routes/push.ts",
  "apps/api/src/routes/proposals.ts",
  "apps/api/src/routes/approvals.ts",
  "apps/api/src/routes/pages.ts",
  "apps/api/src/qa/r1-pg-agent-run-smoke.ts",
  "apps/api/src/qa/r2-pg-redis-smoke.ts",
  "packages/config/src/env.ts",
  "packages/db/src/repositories/agent-runs.ts",
  "packages/db/src/repositories/proposals.ts"
];
const missingRuntimePaths = requiredRuntimePaths.filter((path) => !existsSync(join(root, path)));
addGate(gates, "runtime.required", "R2 runtime and smoke entrypoints exist", missingRuntimePaths.length === 0, missingRuntimePaths.length === 0 ? `${requiredRuntimePaths.length} paths` : `missing=${missingRuntimePaths.join(", ")}`);

const staleMatches = staleDocMatches();
addGate(gates, "docs.no-stale-r2", "Docs do not contain stale R2.6 pending language", staleMatches.length === 0, staleMatches.length === 0 ? "0 stale phrases" : `${staleMatches.length} stale phrases`);

const diffCheck = git(["diff", "--check"]);
const cachedDiffCheck = git(["diff", "--cached", "--check"]);
addGate(gates, "git.diff-check", "Git diff whitespace checks pass", diffCheck.status === 0 && cachedDiffCheck.status === 0, `unstaged=${diffCheck.status ?? "signal"}, staged=${cachedDiffCheck.status ?? "signal"}`);

const changedRefs = changedReferencePaths();
const trackedRefs = trackedReferencePaths();
addGate(
  gates,
  "git.no-reference",
  "reference and references folders are not part of tracked or pending delivery",
  changedRefs.length === 0 && trackedRefs.length === 0,
  `changed=${changedRefs.length}, tracked=${trackedRefs.length}`
);

const secretCount = secretLikeDiffCount();
addGate(gates, "git.no-secret-diff", "Pending diff has no secret-like API keys", secretCount === 0, `secret_like_diff_count=${secretCount}`);

const failed = gates.filter((gate) => gate.status === "fail");
const report = [
  "# WorkHub R2 Release Gate Report",
  "",
  `Overall: ${failed.length === 0 ? "PASS" : "FAIL"}`,
  "",
  "| Gate | Result | Evidence |",
  "|---|---|---|",
  ...gates.map((gate) => `| ${gate.label} | ${gate.status.toUpperCase()} | ${gate.evidence.replace(/\|/gu, "\\|")} |`)
].join("\n");

console.log(report);

if (failed.length > 0) {
  throw new Error(`R2 release gate failed: ${failed.map((gate) => gate.id).join(", ")}`);
}
