import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { userMemoryCategorySchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultUserMemoryGovernanceService,
  type UserMemoryGovernanceService
} from "../services/user-memory-governance.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R14 批 MEM（记忆可见可治理）：用户记忆治理端点——本人可读写，管理员也不能代读/代改他人记忆。
// 工厂导出不挂载；挂载/openapi/app.test 白名单归集成者。语义红线见 03-mem-design §2.1/§3.1。
//
// 集成者缝合位（本工包围栏禁改 app.ts/openapi.ts，具体片段见批次汇报 r14-mem-server.md）：
//   - app.ts import：import { createUserMemoryGovernanceRoutes } from "./routes/user-memory-governance.js";
//                    app.route("/api", createUserMemoryGovernanceRoutes());
//   - app.ts onError：补 if (error instanceof UserMemoryGovernanceServiceError) 分支（透传 status/code），
//                     否则 400/404/409 会被兜底压成无语义码的 500。
//   - openapi.ts：/api/me/memories 的 GET(list)/GET(:id)/PATCH(:id)/DELETE(:id) 四条路径文档。

// value_md/expected_updated_at 的「结构」校验在路由（非字符串/非 ISO → 422）；「语义」校验（空白/超长/注入 → 400）
// 在 service。这样超长与注入按 03-mem-design §3.1 表格返回 400，而非 zod 的 422（导出的
// patchUserMemoryRequestSchema 带 max(2000) 是客户端契约，服务端刻意用宽松 body 让语义错落到 service，见汇报偏离）。
const patchUserMemoryBodySchema = z.object({
  value_md: z.string(),
  expected_updated_at: z.string().datetime({ offset: true })
});
const categoryQuerySchema = userMemoryCategorySchema.optional();

export type UserMemoryGovernanceRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: UserMemoryGovernanceService;
};

function requireMemoryId(id: string): string {
  if (!isUuidParam(id)) {
    throw new HTTPException(404, { message: "没有找到这条记忆。" });
  }
  return id;
}

export function createUserMemoryGovernanceRoutes(deps: UserMemoryGovernanceRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultUserMemoryGovernanceService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/me/memories", requireCurrentUser, async (c) => {
    const category = categoryQuerySchema.parse(c.req.query("category") || undefined);
    const data = await service.listMemories({
      actor: c.var.actor,
      ...(category ? { category } : {})
    });
    return c.json({ ok: true, data });
  });

  routes.get("/me/memories/:id", requireCurrentUser, async (c) => {
    const id = requireMemoryId(c.req.param("id"));
    const data = await service.getMemory({ actor: c.var.actor, id });
    return c.json({ ok: true, data });
  });

  routes.patch("/me/memories/:id", requireCurrentUser, async (c) => {
    const id = requireMemoryId(c.req.param("id"));
    const payload = patchUserMemoryBodySchema.parse(await readJsonObject(c));
    const data = await service.patchMemory({
      actor: c.var.actor,
      id,
      valueMd: payload.value_md,
      expectedUpdatedAt: new Date(payload.expected_updated_at)
    });
    return c.json({ ok: true, data });
  });

  routes.delete("/me/memories/:id", requireCurrentUser, async (c) => {
    const id = requireMemoryId(c.req.param("id"));
    const data = await service.deleteMemory({ actor: c.var.actor, id });
    return c.json({ ok: true, data });
  });

  return routes;
}
