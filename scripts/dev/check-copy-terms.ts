/**
 * 文案禁词门禁（借鉴 deepseek-harness 的生成目录+CI 校验思路；落地台账 COPY 系统性建议 #2）。
 *
 * 扫描用户可见的中文文案，命中「内部黑话/AI 味」禁词即报告。
 * 自 2026-08-19 文案批（台账第七节）起为**硬门禁**：命中即 exit 1。
 * 标识符（词典 key / 事件名 / VM 枚举）不可避免命中时，在该行内加 `term-allow` 注释豁免并注明原因。
 *
 * 覆盖范围（2026-09-05 起）：不再是手写的 5 个词典文件，而是
 * `scripts/dev/check-ui-i18n.ts` 的 `copyTermScanTargets()`——全部词典文件（i18n*.ts /
 * locale*.ts / locales/ 目录 / *-copy.ts）**加上**棘轮基线里仍然含硬编码文案的文件。
 * 两个门共用同一份文件发现逻辑，故「文案搬到哪，禁词门跟到哪」，不会再出现
 * 「文案在 A 文件、门只扫 B 文件」的错位。
 *
 * 判据也从「整行含中文」升级成 AST 上的**含汉字字符串/模板字面量**：注释里的中文、
 * 正则里的字符类、行尾中文注释都不再误伤，命中位置也精确到字面量本身。
 *
 * 覆盖面一次扩到 260 个文件会把大量**存量**命中一次性暴露出来，逐条改文案属于产品决策
 * （改词就改了用户看到的字，要连测试与 golden 一起动），所以这里同样上棘轮：
 * `copy-terms-baseline.json` 记存量，新增一律 exit 1。清一条删一条。
 *
 * 用法：
 *   pnpm audit:copy-terms
 *   tsx scripts/dev/check-copy-terms.ts --write-baseline
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ROOT,
  buildBaseline,
  collectCjkLiterals,
  copyTermScanTargets,
  diffAgainstBaseline,
  loadBaselineFile,
  type UiI18nViolation
} from "./check-ui-i18n.ts";

const BASELINE_PATH = "scripts/dev/copy-terms-baseline.json";

// 禁词表：内部实现词（对用户无意义）+ AI 味套话。命中即报告（带白名单注释豁免：行内含 term-allow）。
const BANNED: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /AgentRun|agent_run(?!_)/, why: "内部实体名；对用户说「这次执行/执行回放」" },
  { pattern: /snapshot_id|快照 id/i, why: "内部 id；对用户说「还原点」" },
  { pattern: /(?<![a-z-])trace(?![a-z_])/i, why: "内部词；对用户说「轨迹/回放」" },
  { pattern: /租约|lease/i, why: "队列实现细节" },
  { pattern: /UTF-8/i, why: "编码细节；对用户说「不是纯文本」" },
  { pattern: /蒸馏/, why: "ML 内部词；对用户说「AI 自学/总结」" },
  { pattern: /沉淀/, why: "AI 味套话；说「攒下/学会」" },
  { pattern: /闭环/, why: "黑名单套话；说「完成/收尾」" },
  { pattern: /赋能|抓手|颗粒度|拉齐/, why: "AI 味套话" },
  { pattern: /option-first|file-only/i, why: "设计文档语言泄漏" }
];

const BASELINE_NOTE =
  "文案禁词存量棘轮基线（scripts/dev/check-copy-terms.ts）。键是「禁词 | 归一化文案片段」，" +
  "值是允许出现次数；新增命中一律 exit 1。改掉一条文案就从这里删一条；`--write-baseline` 可整体重录。";

async function collectHits(targets: readonly string[]): Promise<UiI18nViolation[]> {
  const hits: UiI18nViolation[] = [];
  for (const rel of targets) {
    let text: string;
    try {
      text = await readFile(path.join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (const literal of collectCjkLiterals(rel, text)) {
      // 行内 term-allow 豁免（多行模板字面量按起始行判定，与旧行为一致）。
      if (lines[literal.line - 1]?.includes("term-allow")) continue;
      for (const { pattern, why } of BANNED) {
        if (pattern.test(literal.text)) {
          hits.push({ ...literal, text: `${pattern.source} | ${literal.text}`, kind: why });
        }
      }
    }
  }
  return hits;
}

async function main() {
  const writeBaseline = process.argv.includes("--write-baseline");
  const targets = copyTermScanTargets();
  if (targets.length < 5) {
    console.error(`文案禁词扫描：只发现 ${targets.length} 个文案文件，扫描范围疑似失效，拒绝通过`);
    process.exit(1);
  }
  const hits = await collectHits(targets);

  if (writeBaseline) {
    const baseline = { ...buildBaseline(hits), note: BASELINE_NOTE };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    console.log(`文案禁词扫描：已重录基线 ${BASELINE_PATH}（${hits.length} 处存量）`);
    return;
  }

  const { added, stale } = diffAgainstBaseline(hits, loadBaselineFile(BASELINE_PATH), new Set(targets));
  for (const entry of stale) {
    console.warn(
      `文案禁词扫描：基线条目已消失（请从 ${BASELINE_PATH} 删除）：${entry.file} × ${entry.remaining} —— ${entry.text}`
    );
  }
  if (added.length > 0) {
    console.error(`文案禁词扫描：${added.length} 处新增命中（硬门禁，须清理或加 term-allow 豁免）:`);
    for (const hit of added.slice(0, 60)) {
      console.error(`  ${hit.file}:${hit.line}: ${hit.kind}\n    ${hit.text.slice(0, 120)}`);
    }
    if (added.length > 60) console.error(`  …另有 ${added.length - 60} 处`);
    process.exit(1);
  }
  console.log(`文案禁词扫描通过（${targets.length} 个文案文件，基线内 ${hits.length} 处存量待清）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
