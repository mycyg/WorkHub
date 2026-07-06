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

const resolutionSchema = z.enum(["keep_current", "accept_incoming", "discard_both", "edit_memory"]);
const resolveBodySchema = z.object({
  value_md: z.string().min(1).optional()
});

export type MemoryConflictRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: MemoryConflictService;
};

function requireConflictId(id: string) {
  if (!isUuidParam(id)) {
    throw new HTTPException(404, { message: "没有找到这张记忆冲突卡。" });
  }
  return id;
}

function expectedUpdatedAt(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new HTTPException(422, { message: "expected_updated_at 不是有效时间。" });
  }
  return date;
}

export function createMemoryConflictRoutes(deps: MemoryConflictRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createMemoryConflictService();

  routes.post("/:id/resolve/:resolution", createCurrentUserMiddleware(authSource), async (c) => {
    const conflictId = requireConflictId(c.req.param("id"));
    const resolution = resolutionSchema.parse(c.req.param("resolution"));
    const payload = resolveBodySchema.parse(await readJsonObject(c));
    const expected = expectedUpdatedAt(c.req.query("expected_updated_at"));
    const data = await service.resolve({
      actor: c.var.actor,
      conflictId,
      resolution,
      ...(payload.value_md ? { valueMd: payload.value_md } : {}),
      ...(expected ? { expectedUpdatedAt: expected } : {})
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
