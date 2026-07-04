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

const memoryConflictResolutionSchema = z.enum(["keep_current", "accept_incoming", "merge_both", "edit_memory"]);
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
    return c.json({ ok: true, data });
  });

  return routes;
}
