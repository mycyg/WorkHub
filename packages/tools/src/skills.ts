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

/** 注入工人 system prompt 的技能目录（id + 适用场景一句话）。 */
export function skillCatalogForPrompt(root = skillsRoot): string {
  const skills = listSkills(root);
  if (skills.length === 0) {
    return "";
  }
  return skills.map((skill) => `- ${skill.id}：${skill.whenToUse || skill.description}`).join("\n");
}

export function createSkillTool(root = skillsRoot): AnyToolSpec {
  return {
    id: "load_skill",
    description:
      "加载一个预设技能（交付物类型的库用法合同与模板）。涉及对应交付物时必须先加载再动手，库用法以技能内容为准。",
    schema: z.object({
      id: z.string().min(1).optional().describe("技能 id，如 docx-document / stat-charts"),
      skill: z.string().min(1).optional().describe("技能 id 的兼容别名")
    }).refine((input) => Boolean(input.id ?? input.skill), {
      message: "id is required"
    }),
    sideEffect: "none",
    async execute(input: { id?: string; skill?: string }) {
      const id = input.id ?? input.skill ?? "";
      const content = loadSkillContent(id, root);
      if (!content) {
        const available = listSkills(root).map((skill) => skill.id).join(", ");
        return errorToolResult(`未知技能 id: ${id}。可用技能: ${available || "(无)"}`);
      }
      return okToolResult(content, { data: { id } });
    }
  } as AnyToolSpec;
}
