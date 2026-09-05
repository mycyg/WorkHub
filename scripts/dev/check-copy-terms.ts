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
 *   tsx scripts/dev/check-copy-terms.ts --files a.ts b.ts   # 只扫指定文件（pre-commit 用）
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BASELINE_PATH as UI_I18N_BASELINE_PATH,
  ROOT,
  buildBaseline,
  collectCjkLiterals,
  collectCopyLiterals,
  copyTermScanTargets,
  diffAgainstBaseline,
  isLocaleOwnerFile,
  loadBaselineFile,
  relativizeToRoot,
  type UiI18nViolation
} from "./check-ui-i18n.ts";

const BASELINE_PATH = "scripts/dev/copy-terms-baseline.json";

// 禁词表：内部实现词（对用户无意义）+ AI 味套话。命中即报告（带白名单注释豁免：行内含 term-allow）。
//
// 这一张表跑在**含汉字的字面量**上（全部扫描目标）。夹在中文里的英文内部词（「看改动 / diff」
// 「派 run」）因此也会被逮到，而纯 ASCII 的接口路径 `/api/agent-runs/:id` 不会误伤。
const BANNED: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /AgentRun|agent[-_ ]run(?!_)/i, why: "内部实体名；对用户说「这次执行/执行回放」" },
  { pattern: /snapshot_id|快照 id/i, why: "内部 id；对用户说「还原点」" },
  { pattern: /(?<![a-z-])trace(?![a-z_])/i, why: "内部词；对用户说「轨迹/回放」" },
  { pattern: /租约|lease/i, why: "队列实现细节" },
  { pattern: /UTF-8/i, why: "编码细节；对用户说「不是纯文本」" },
  { pattern: /蒸馏/, why: "ML 内部词；对用户说「AI 自学/总结」" },
  { pattern: /沉淀/, why: "AI 味套话；说「攒下/学会」" },
  { pattern: /闭环/, why: "黑名单套话；说「完成/收尾」" },
  { pattern: /赋能|抓手|颗粒度|拉齐/, why: "AI 味套话" },
  { pattern: /option-first|file-only/i, why: "设计文档语言泄漏" },

  // —— R26 A1 文案审查补的 15 组（每组都有本轮实证，见 .agents/notes 的落地台账）——
  { pattern: /我将|我们可以|本页面|本页用于|此处展示|用于说明|用于展示|实现了/, why: "解释型文案：界面只服务业务目标，不解说自己" },
  { pattern: /界面只显示|这里会显示|稍后只展示|会打开.{0,6}详情/, why: "在解说界面自己会渲染什么；直接说结论" },
  { pattern: /即将上线|正在接入|敬请期待|演示数据|示例数据|占位符|占位文案|占位内容/, why: "非最终态 / 路线图 / 脚手架语言" },
  { pattern: /预览环境|开发预览|发给开发/, why: "开发运行方式与团队内部视角泄漏" },
  { pattern: /聚焦盒/, why: "内部设计代号；对用户说「快捷入口」" },
  { pattern: /\bdaemon\b|\bmanifest\b|\bdiff\b|\bfixture\b|\bmock\b|(?<![a-z])dsh(?![a-z])/i, why: "内部实体/结构名" },
  { pattern: /派 ?run|dispatch run|子运行|child run/i, why: "内部实体名混排；对用户说「派活给 AI / 子任务」" },
  { pattern: /物化|materiali[sz]e/i, why: "数据库词；对用户说「写入」" },
  { pattern: /正在拉(?!伸)|没拉到|拉不到/, why: "开发口里的 fetch/pull；用 load-state-copy.ts 的统一句式" },
  { pattern: /范围 ?ID|Scope ID|必要参数|missing details/i, why: "接口字段名直出；说清楚要填什么" },
  { pattern: /调度器|scheduler|主动性|proactivity|巡检|sweep/i, why: "后台子系统名；换成用户视角的说法" },
  { pattern: /客户端能力|client capability|桌面桥接|bridge unavailable/i, why: "能力协商 / 通道实现词；告诉用户该做什么" },
  { pattern: /实验锁定|Experiment locked/i, why: "功能开关的内部状态名；说「暂未开放」" },
  { pattern: /为(?:了)?避免.{0,12}(?:所以|，).{0,20}不可用|可能是.{0,12}(?:截断|过滤)/, why: "设计理由 / 实现推理泄漏；理由属于代码注释" }
];

/**
 * 纯英文禁词表：只跑在**词典文件**（i18n*.ts / locale*.ts / locales/** / *-copy.ts）上，
 * 且不要求字面量含汉字。
 *
 * 缘由：BANNED 的汉字前置过滤会把纯英文文案整片放过——`"Run trace"`、`"Loading trace…"`、
 * `"Curation budget"`、`"Eval budget"` 全都是这么漏检的（R26 A1 审查「缺口二」）。词典文件
 * 里除了 key 与 import 之外全是文案（collectCopyLiterals 已剔除标识符位置），误报面很小；
 * 普通产品文件里满是选择器与接口路径，不适用这套判据，故不扩到那边。
 */
const BANNED_EN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /(?<![a-z-])trace(?![a-z_])/i, why: "内部词；对用户说 timeline / record" },
  { pattern: /\bcuration\b|\beval budget\b|\bevaluation budget\b/i, why: "内部子系统名；说 self-learning / quality check" },
  { pattern: /\bdiff\b|\bmanifest\b|\bdaemon\b|\bfixture\b|\bmock\b|(?<![a-z])dsh(?![a-z])/i, why: "内部实体/结构名" },
  { pattern: /\bcoming soon\b/i, why: "非最终态 / 路线图语言" },
  { pattern: /\bthis preview\b|\bdev preview\b/i, why: "开发运行方式泄漏" },
  { pattern: /\bscope id\b|\bmissing details\b/i, why: "接口字段名直出" },
  { pattern: /\bdispatch runs?\b|\bchild runs?\b|\btouch drive\b/i, why: "内部实体名；说 start AI runs / subtasks / modify drive files" },
  { pattern: /materiali[sz]e/i, why: "数据库词；说 add to …" },
  { pattern: /\bscheduler\b|\bproactivity\b|\bSLA sweep\b/i, why: "后台子系统名" },
  { pattern: /\bclient capability\b|\bbridge is unavailable\b|\bdesktop bridge\b/i, why: "能力协商 / 通道实现词" },
  { pattern: /\bexperiment locked\b/i, why: "功能开关的内部状态名" },
  { pattern: /\bPM mode\b|\bdeprecated\b/i, why: "枚举字面 / 工程词直出" },
  { pattern: /\bthis page (?:is used to|shows)\b|\bdemo data\b|\bplaceholder text\b/i, why: "解释型文案 / 脚手架语言" }
];

const BASELINE_NOTE =
  "文案禁词存量棘轮基线（scripts/dev/check-copy-terms.ts）。键是「禁词 | 归一化文案片段」，" +
  "值是允许出现次数；新增命中一律 exit 1。改掉一条文案就从这里删一条；`--write-baseline` 可整体重录。";

/** 扫一个文件：中文禁词表跑含汉字的字面量，英文禁词表只在词典文件上跑全部字面量。 */
export function collectFileHits(rel: string, text: string): UiI18nViolation[] {
  const hits: UiI18nViolation[] = [];
  const lines = text.split("\n");
  // 行内 term-allow 豁免（多行模板字面量按起始行判定，与旧行为一致）。
  const allowed = (literal: UiI18nViolation): boolean => lines[literal.line - 1]?.includes("term-allow") === true;

  for (const literal of collectCjkLiterals(rel, text)) {
    if (allowed(literal)) continue;
    for (const { pattern, why } of BANNED) {
      if (pattern.test(literal.text)) {
        hits.push({ ...literal, text: `${pattern.source} | ${literal.text}`, kind: why });
      }
    }
  }

  if (isLocaleOwnerFile(rel)) {
    for (const literal of collectCopyLiterals(rel, text)) {
      if (allowed(literal)) continue;
      for (const { pattern, why } of BANNED_EN) {
        if (pattern.test(literal.text)) {
          hits.push({ ...literal, text: `${pattern.source} | ${literal.text}`, kind: why });
        }
      }
    }
  }
  // 同一条字面量可能同时命中两张表；按行列排序让输出与基线的顺序稳定。
  return hits.sort((left, right) => left.line - right.line || left.column - right.column);
}

async function collectHits(targets: readonly string[]): Promise<UiI18nViolation[]> {
  const hits: UiI18nViolation[] = [];
  for (const rel of targets) {
    let text: string;
    try {
      text = await readFile(path.join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    hits.push(...collectFileHits(rel, text));
  }
  return hits;
}

async function main() {
  const argv = process.argv.slice(2);
  const writeBaseline = argv.includes("--write-baseline");
  const filesFlag = argv.indexOf("--files");
  const explicitFiles =
    filesFlag < 0 ? undefined : argv.slice(filesFlag + 1).filter((value) => !value.startsWith("--"));

  if (writeBaseline && explicitFiles !== undefined) {
    console.error("文案禁词扫描：--write-baseline 需要全量扫描，不能与 --files 同用");
    process.exit(1);
  }

  // --files 免掉全量 glob（pre-commit 预算）：暂存文件里只有词典或基线文件才需要扫。
  const baselineFiles = new Set(Object.keys(loadBaselineFile(BASELINE_PATH).entries));
  const uiI18nBaselineFiles = new Set(Object.keys(loadBaselineFile(UI_I18N_BASELINE_PATH).entries));
  const targets =
    explicitFiles === undefined
      ? copyTermScanTargets()
      : [
          ...new Set(
            explicitFiles
              .map((file) => relativizeToRoot(file))
              .filter((file) => isLocaleOwnerFile(file) || baselineFiles.has(file) || uiI18nBaselineFiles.has(file))
          )
        ].sort();
  if (explicitFiles === undefined && targets.length < 5) {
    console.error(`文案禁词扫描：只发现 ${targets.length} 个文案文件，扫描范围疑似失效，拒绝通过`);
    process.exit(1);
  }
  if (explicitFiles !== undefined && targets.length === 0) {
    console.log("文案禁词扫描：本次没有需要检查的文案文件");
    return;
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

// 只有被直接执行时才跑全量扫描——colocated 测试要 import collectFileHits，不能顺带触发一次全库扫。
if (import.meta.filename === path.resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
