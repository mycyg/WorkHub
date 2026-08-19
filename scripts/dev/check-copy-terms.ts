/**
 * 文案禁词门禁（借鉴 deepseek-harness 的生成目录+CI 校验思路；落地台账 COPY 系统性建议 #2）。
 *
 * 扫描用户可见的中文词典文件，命中「内部黑话/AI 味」禁词即报告。
 * 自 2026-08-19 文案批（台账第七节）起为**硬门禁**：命中即 exit 1。
 * 标识符（词典 key / 事件名 / VM 枚举）不可避免命中时，在该行内加 `term-allow` 注释豁免并注明原因。
 *
 *
 * 术语单一事实源上线前，本脚本兼任「两套话」纪律的最低限度防线。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 只扫「整本都是用户可见文案」的词典文件，避免误扫逻辑代码。
const DICTIONARIES = [
  "packages/ui/src/gold-path/i18n.ts",
  "packages/ui/src/gold-path/route-components.ts",
  "packages/ui/src/i18n.ts",
  "apps/api/src/pages/i18n.ts",
  "packages/cuu/src/i18n.ts"
];

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

async function main() {
  const hits: string[] = [];
  for (const rel of DICTIONARIES) {
    const file = path.join(ROOT, rel);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (line.includes("term-allow")) return;
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      // 只查中文字符串字面量里的内容（粗判：行内含中文）
      if (!/[一-鿿]/.test(line)) return;
      for (const { pattern, why } of BANNED) {
        if (pattern.test(line)) {
          hits.push(`${rel}:${index + 1}: 命中 /${pattern.source}/ —— ${why}\n    ${line.trim().slice(0, 100)}`);
        }
      }
    });
  }
  if (hits.length > 0) {
    console.error(`文案禁词扫描：${hits.length} 处命中（硬门禁，须清理或加 term-allow 豁免）:`);
    for (const hit of hits.slice(0, 60)) console.error(`  ${hit}`);
    if (hits.length > 60) console.error(`  …另有 ${hits.length - 60} 处`);
    process.exit(1);
  } else {
    console.log("文案禁词扫描通过");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
