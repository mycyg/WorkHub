/**
 * 测试文件约定门禁。
 *
 * 规则 1：测试里不许对 `process.stdout.write` / `process.stderr.write` 赋值。`node --test` 把每个测试文件放子进程跑，
 * 父进程解析子进程 stdout 里的 TAP 行计数；报告器对上一条测试的 `ok N` 行是异步写出的，落进被整段替换的窗口
 * 就被吞掉，那条测试会从汇总里悄悄消失（`# tests` 变少、`# fail` 仍 0、退出码仍 0）。要捕获结构化日志，
 * 用 `@workhub/tools/test-support` 的 `captureStdoutLines` / `captureStderrLines`（捕获且透传）。
 *
 * 用法：`pnpm audit:test-conventions`。纯函数 `findTestConventionViolations` 供单测。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface TestConventionViolation {
  file: string;
  line: number;
  rule: "stdout_write_reassigned";
  snippet: string;
}

const STREAM_REASSIGN = /process\.(stdout|stderr)\.write\s*=(?!=)/u;
/** 行内豁免标记：只给「测的就是这条流本身」的助手自测用，同一行要写清理由。 */
export const ALLOW_MARKER = "test-conventions-allow";

export function findTestConventionViolations(files: Array<{ path: string; text: string }>): TestConventionViolation[] {
  const violations: TestConventionViolation[] = [];
  for (const file of files) {
    file.text.split("\n").forEach((line, index) => {
      if (line.includes(ALLOW_MARKER)) return;
      if (STREAM_REASSIGN.test(line)) {
        violations.push({ file: file.path, line: index + 1, rule: "stdout_write_reassigned", snippet: line.trim() });
      }
    });
  }
  return violations;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "expected", "reference", ".claude", "target", ".git"]);

export function collectTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
  };
  for (const top of ["apps", "packages"]) {
    const dir = path.join(root, top);
    try {
      if (statSync(dir).isDirectory()) walk(dir);
    } catch {
      // 目录不存在就跳过。
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const files = collectTestFiles(root).map((file) => ({
    path: path.relative(root, file).split(path.sep).join("/"),
    text: readFileSync(file, "utf8")
  }));
  const violations = findTestConventionViolations(files);
  if (violations.length === 0) {
    process.stdout.write(`测试约定门禁通过（扫描 ${files.length} 个测试文件）\n`);
    return;
  }
  for (const violation of violations) {
    process.stdout.write(`  ${violation.file}:${violation.line} ${violation.snippet}\n`);
  }
  process.stdout.write(
    `测试约定门禁未通过：${violations.length} 处对 process.stdout/stderr.write 赋值。` +
      `整段替换会吞掉 node --test 报告器的 TAP 行、让测试从汇总里消失；` +
      `请改用 @workhub/tools/test-support 的 captureStdoutLines / captureStderrLines（捕获且透传）。\n`
  );
  process.exit(1);
}

if (import.meta.filename === path.resolve(process.argv[1] ?? "")) {
  await main();
}
