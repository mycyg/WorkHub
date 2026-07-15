import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { AnyToolSpec } from "./types.js";
import { errorToolResult, okToolResult } from "./types.js";

export type SkillMeta = {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
};

const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

function parseFrontmatter(raw: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/u.exec(raw);
  if (!match?.[1]) {
    return {};
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return fields;
}

let cachedSkills: SkillMeta[] | undefined;

export function listSkills(root = skillsRoot): SkillMeta[] {
  if (root === skillsRoot && cachedSkills) {
    return cachedSkills;
  }
  if (!existsSync(root)) {
    return [];
  }
  const skills: SkillMeta[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = path.join(root, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) {
      continue;
    }
    const fields = parseFrontmatter(readFileSync(skillPath, "utf8"));
    skills.push({
      id: entry.name,
      name: fields["name"] ?? entry.name,
      description: fields["description"] ?? "",
      whenToUse: fields["when_to_use"] ?? ""
    });
  }
  skills.sort((left, right) => left.id.localeCompare(right.id));
  if (root === skillsRoot) {
    cachedSkills = skills;
  }
  return skills;
}

export function loadSkillContent(id: string, root = skillsRoot): string | undefined {
  if (!/^[a-z0-9-]+$/u.test(id)) {
    return undefined;
  }
  const skillPath = path.join(root, id, "SKILL.md");
  if (!existsSync(skillPath)) {
    return undefined;
  }
  return readFileSync(skillPath, "utf8");
}

/** 把技能列表格式化成工人 system prompt 的技能目录（id + 适用场景一句话）。 */
export function formatSkillCatalog(skills: SkillMeta[]): string {
  if (skills.length === 0) {
    return "";
  }
  return skills.map((skill) => `- ${skill.id}：${skill.whenToUse || skill.description}`).join("\n");
}

/** 注入工人 system prompt 的技能目录（id + 适用场景一句话）。 */
export function skillCatalogForPrompt(root = skillsRoot): string {
  return formatSkillCatalog(listSkills(root));
}

// 团队技能内容映射（skill_key → SKILL.md 全文），由调用方按 workspace 预取后注入。
export type TeamSkillContentMap = Record<string, string>;

export function createSkillTool(root = skillsRoot, teamContent?: TeamSkillContentMap): AnyToolSpec {
  return {
    id: "load_skill",
    description:
      "按 id 加载一个技能：某类交付物的库用法合同、模板与自验步骤（含团队自蒸馏技能）。涉及对应交付物时必须先加载再动手，库的 API 以技能内容为准、不要凭记忆臆写。用 `id` 传技能 id（如 docx-document / stat-charts）；id 未知时先随便传一个错的，返回的错误信息会列出全部可用技能 id。加载不改变工作纪律，只提供库用法参考。",
    promptSnippet: "加载某类交付物的技能（库用法合同与模板）",
    // 技能纪律的完整行为准则由 worker system prompt 的「技能纪律」段承载，这里不重复挂 promptGuidelines，
    // 避免同一条纪律在提示词里出现两遍。
    schema: z.object({
      id: z.string().min(1).optional().describe("技能 id，如 docx-document / stat-charts"),
      skill: z.string().min(1).optional().describe("技能 id 的兼容别名")
    }).refine((input) => Boolean(input.id ?? input.skill), {
      message: "id is required"
    }),
    sideEffect: "none",
    async execute(input: { id?: string; skill?: string }) {
      const id = input.id ?? input.skill ?? "";
      // FS 预设优先；未命中再回落团队技能（仅接受合法 id，复用同样的 path-safe 校验）。
      const teamHit = teamContent && /^[a-z0-9-]+$/u.test(id) ? teamContent[id] : undefined;
      const content = loadSkillContent(id, root) ?? teamHit;
      if (!content) {
        const fsIds = listSkills(root).map((skill) => skill.id);
        const teamIds = teamContent ? Object.keys(teamContent) : [];
        const available = [...fsIds, ...teamIds].join(", ");
        return errorToolResult(`未知技能 id: ${id}。可用技能: ${available || "(无)"}`);
      }
      return okToolResult(content, { data: { id } });
    }
  } as AnyToolSpec;
}
