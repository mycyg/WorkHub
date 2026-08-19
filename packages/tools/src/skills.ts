import { readdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
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
  /** 分层发现时标注来源层（listSkills 单目录调用时不填）。 */
  layer?: SkillLayer;
  /** 分层优先级：数值越小层级越高（project 100 > user 200 > bundled 600）。 */
  rank?: number;
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

export function loadSkillContent(id: string, root: string | LayeredSkillOptions = skillsRoot): string | undefined {
  if (!/^[a-z0-9-]+$/u.test(id)) {
    return undefined;
  }
  if (typeof root === "string") {
    const skillPath = path.join(root, id, "SKILL.md");
    if (!existsSync(skillPath)) {
      return undefined;
    }
    return readFileSync(skillPath, "utf8");
  }
  // 分层解析：同 id 取 rank 最小（层级最高）的一层内容。
  const layers = resolveSkillLayers(root).sort((left, right) => left.rank - right.rank);
  for (const { root: layerRoot } of layers) {
    const skillPath = path.join(layerRoot, id, "SKILL.md");
    if (existsSync(skillPath)) {
      return readFileSync(skillPath, "utf8");
    }
  }
  return undefined;
}

// ─── 分层技能发现（参考 deepseek-harness：项目级 > 用户级 > 内置） ───

export type SkillLayer = "project" | "user" | "bundled";

export type LayeredSkillOptions = {
  /** 项目级技能目录，默认 <repo>/.workhub/skills（env: WORKHUB_SKILLS_PROJECT_DIR 覆盖）。 */
  projectRoot?: string;
  /** 用户级技能目录，默认 ~/.workhub/skills（env: WORKHUB_SKILLS_USER_DIR 覆盖）。 */
  userRoot?: string;
  /** 内置（bundled）技能目录，默认 packages/tools/skills。 */
  bundledRoot?: string;
};

const SKILL_LAYER_RANKS: Record<SkillLayer, number> = {
  project: 100,
  user: 200,
  bundled: 600
};

/** 从 start 向上找最近的 .git 所在目录作为 repo 根；找不到则回落 start 本身。 */
function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(start);
    }
    dir = parent;
  }
}

/**
 * 解析三层技能目录。env 覆盖直接在此处读取（WORKHUB_SKILLS_PROJECT_DIR /
 * WORKHUB_SKILLS_USER_DIR）：@workhub/tools 不依赖 @workhub/config，为其接入
 * envSchema 成本高于收益；如需统一纳管，后续再把这两个键加进 config 的 envSchema。
 */
export function resolveSkillLayers(
  options: LayeredSkillOptions = {}
): Array<{ layer: SkillLayer; rank: number; root: string }> {
  const projectRoot =
    options.projectRoot ??
    process.env.WORKHUB_SKILLS_PROJECT_DIR ??
    path.join(findRepoRoot(process.cwd()), ".workhub", "skills");
  const userRoot =
    options.userRoot ??
    process.env.WORKHUB_SKILLS_USER_DIR ??
    path.join(os.homedir(), ".workhub", "skills");
  const bundledRoot = options.bundledRoot ?? skillsRoot;
  return [
    { layer: "project", rank: SKILL_LAYER_RANKS.project, root: projectRoot },
    { layer: "user", rank: SKILL_LAYER_RANKS.user, root: userRoot },
    { layer: "bundled", rank: SKILL_LAYER_RANKS.bundled, root: bundledRoot }
  ];
}

// 缓存键 = 三层根目录组合，保证不同层组合互不串缓存。
const layeredSkillsCache = new Map<string, SkillMeta[]>();

/** 按 rank 合并三层技能：同 id 高层（rank 小）覆盖低层；返回的 SkillMeta 带 layer 与 rank。 */
export function listLayeredSkills(options: LayeredSkillOptions = {}): SkillMeta[] {
  const layers = resolveSkillLayers(options);
  const cacheKey = layers.map((layer) => layer.root).join("\0");
  const cached = layeredSkillsCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const byId = new Map<string, SkillMeta>();
  // 低层先写、高层后写，实现同 id 高层覆盖低层。
  const ordered = [...layers].sort((left, right) => right.rank - left.rank);
  for (const { layer, rank, root } of ordered) {
    for (const skill of listSkills(root)) {
      byId.set(skill.id, { ...skill, layer, rank });
    }
  }
  const skills = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  layeredSkillsCache.set(cacheKey, skills);
  return skills;
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
