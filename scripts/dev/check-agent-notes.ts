/**
 * Agent Note 格式门禁（借鉴 deepseek-harness 的 verify-agent-note-format.ts）。
 * 校验 .agents/notes/<lifecycle>/*.md：
 *  - frontmatter 三字段（Status/Date/Owner）齐全；
 *  - Status 与所在生命周期目录一致；
 *  - 四个小节（Problem/Decision/Alternatives considered/Consequences）齐全。
 * README.md 豁免。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NOTES_DIR = path.join(ROOT, ".agents", "notes");
const LIFECYCLES = ["proposed", "implemented", "rejected", "archived"] as const;
const REQUIRED_SECTIONS = ["## Problem", "## Decision", "## Alternatives considered", "## Consequences"];

async function main() {
  const failures: string[] = [];
  let checked = 0;
  for (const lifecycle of LIFECYCLES) {
    const dir = path.join(NOTES_DIR, lifecycle);
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      checked += 1;
      const file = path.join(dir, entry);
      const text = await readFile(file, "utf8");
      const label = `${lifecycle}/${entry}`;
      for (const field of ["- Status:", "- Date:", "- Owner:"]) {
        if (!text.includes(field)) failures.push(`${label}: 缺 frontmatter 字段 ${field}`);
      }
      const statusMatch = text.match(/^- Status:\s*(\S+)/m);
      if (statusMatch && statusMatch[1] !== lifecycle) {
        failures.push(`${label}: Status=${statusMatch[1]} 与目录 ${lifecycle} 不一致（流转=移动文件）`);
      }
      for (const section of REQUIRED_SECTIONS) {
        if (!text.includes(section)) failures.push(`${label}: 缺小节 ${section}`);
      }
    }
  }
  if (failures.length > 0) {
    console.error(`agent-notes 校验失败（${failures.length} 项）:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`agent-notes 校验通过（${checked} 份档案）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
