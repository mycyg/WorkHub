/**
 * lefthook pre-commit 门禁：拒绝提交真实 .env 文件 / 密钥形态字符串 / reference 路径。
 * 只看暂存区（git diff --cached），CI 不在 git commit 语境下跑它，不影响 CI。
 * 密钥形态与 reference 路径的判定逻辑与 scripts/qa/r2-release-gate-report.ts 的
 * git.no-secret-diff / git.no-reference 门保持一致（那两条门在 pnpm lint 里扫全量
 * 未暂存+已暂存 diff；这一条在提交前先扫一遍暂存区，把红线前移到本机）。
 */
import { spawnSync } from "node:child_process";

function git(args: string[]) {
  return spawnSync("git", args, { encoding: "utf8" });
}

const stagedFiles = git(["diff", "--cached", "--name-only"]).stdout
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((path) => path.replaceAll("\\", "/"));

const failures: string[] = [];

for (const path of stagedFiles) {
  const base = path.split("/").pop() ?? path;
  if (/^\.env(\..+)?$/u.test(base) && !base.endsWith(".example")) {
    failures.push(`${path}: 疑似真实 .env 文件（可能含密钥），不许提交——模板用 .env.example 后缀`);
  }
  if (path === "reference" || path === "references" || path.startsWith("reference/") || path.startsWith("references/")) {
    failures.push(`${path}: reference/ 是只读侦察素材，不许进提交`);
  }
}

const stagedDiff = git(["diff", "--cached", "-U0", "--", ".", ":(exclude)reference/**", ":(exclude)references/**"]).stdout;
// 词界前置：避免 "task-plan-…" 这类文件名里的 "sk-" 误报；真实 key（独立 token 开头的 sk-）仍命中。
const secretMatches = stagedDiff.match(/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/gu);
if (secretMatches !== null && secretMatches.length > 0) {
  failures.push(`暂存区命中 ${secretMatches.length} 处密钥形态字符串（sk- 开头 20+ 字符）`);
}

if (failures.length > 0) {
  console.error(`暂存路径门禁未通过（${failures.length} 项）:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`暂存路径门禁通过（${stagedFiles.length} 个暂存文件）`);
