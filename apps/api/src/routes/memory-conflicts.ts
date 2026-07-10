import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createMemoryConflictService,
  type MemoryConflictService
} from "../services/memory-conflicts.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

const memoryConflictResolutionSchema = z.enum(["keep_current", "accept_incoming", "merge_both", "edit_memory", "discard_both"]);
const expectedUpdatedAtSchema = z.string().datetime({ offset: true });
const memoryConflictResolveRequestSchema = z.object({
  value_md: z.string().trim().min(1).max(4000).optional(),
  expected_updated_at: expectedUpdatedAtSchema.optional()
});

export type MemoryConflictRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: MemoryConflictService;
};

function requireMemoryConflictId(id: string) {
  if (!isUuidParam(id)) {
    throw new HTTPException(404, { message: "没有找到这张记忆冲突卡。" });
  }
  return id;
}

export function createMemoryConflictRoutes(deps: MemoryConflictRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createMemoryConflictService();

  routes.post("/:id/resolve/:resolution", createCurrentUserMiddleware(authSource), async (c) => {
    const conflictId = requireMemoryConflictId(c.req.param("id"));
    const resolution = memoryConflictResolutionSchema.parse(c.req.param("resolution"));
    const payload = memoryConflictResolveRequestSchema.parse(await readJsonObject(c));
    const expectedUpdatedAt = new Date(expectedUpdatedAtSchema.parse(
      payload.expected_updated_at ?? c.req.query("expected_updated_at")
    ));
    const data = await service.resolve({
      actor: c.var.actor,
      conflictId,
      resolution,
      expectedUpdatedAt,
      ...(payload.value_md ? { valueMd: payload.value_md } : {})
    });
    // 普通用户审查：四个动作点完回执都是「操作成功」分不清发生了什么——按 resolution 给人话回执。
    const zh = (c.req.query("locale") ?? c.req.header("Accept-Language") ?? "zh-CN").startsWith("zh");
    const summaries: Record<typeof resolution, [string, string]> = {
      keep_current: ["已保留现有记忆（A），新学到的那条不会被使用。", "Kept the current memory (A); the new one will not be used."],
      accept_incoming: ["已改用新学到的记忆（B），旧的那条已被替换。", "Switched to the new memory (B); the old one was replaced."],
      merge_both: ["已把两条合并成一条记忆，之后按合并稿使用。", "Merged both into one memory."],
      edit_memory: ["已按你的编辑保存这条记忆。", "Saved the memory with your edits."],
      discard_both: ["已把两条都撤下——包括原本生效的那条，AI 之后不会再用它们。", "Discarded both — including the one that was in use."]
    };
    const [zhText, enText] = summaries[resolution];
    return c.json({ ok: true, data: { ...data, attention: { summary_text: zh ? zhText : enText } } });
  });

  return routes;
}
