import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { patchTeamSkillRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultTeamSkillGovernanceService,
  type TeamSkillGovernanceService
} from "../services/team-skill-governance.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R14 批 MEM（记忆可见可治理）：团队技能治理端点——列表/详情全员可读，编辑/停用仅管理员（actor.isAdmin）。
// 工厂导出不挂载；挂载/openapi/app.test 白名单归集成者。语义红线见 03-mem-design §2.2/§3.2。
//
// 集成者缝合位（本工包围栏禁改 app.ts/openapi.ts，具体片段见批次汇报 r14-mem-server.md）：
//   - app.ts import：import { createTeamSkillGovernanceRoutes } from "./routes/team-skill-governance.js";
//                    app.route("/api", createTeamSkillGovernanceRoutes());
//   - app.ts onError：补 if (error instanceof TeamSkillGovernanceServiceError) 分支（透传 status/code），
//                     否则 403/404/409 会被兜底压成无语义码的 500。
//   - openapi.ts：/api/team-skills/manage 的 GET(list)/GET(:id)/PATCH(:id)/POST(:id/deactivate) 四条路径文档。
// 上述缝合位已完成（app.ts:300 挂载 + onError 透传 TeamSkillGovernanceServiceError + openapi 四条已落）。
// R23 SA-06 追加第五条：POST /team-skills/curate-now（管理员手动催一轮 AI 自学），openapi/SDK 同批已补。

const deactivateTeamSkillBodySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});

export type TeamSkillGovernanceRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: TeamSkillGovernanceService;
};

function requireSkillId(id: string): string {
  if (!isUuidParam(id)) {
    throw new HTTPException(404, { message: "没有找到这个团队技能。" });
  }
  return id;
}

export function createTeamSkillGovernanceRoutes(deps: TeamSkillGovernanceRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultTeamSkillGovernanceService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/team-skills/manage", requireCurrentUser, async (c) => {
    const data = await service.listSkills({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.get("/team-skills/manage/:id", requireCurrentUser, async (c) => {
    const id = requireSkillId(c.req.param("id"));
    const data = await service.getSkill({ actor: c.var.actor, id });
    return c.json({ ok: true, data });
  });

  routes.patch("/team-skills/manage/:id", requireCurrentUser, async (c) => {
    const id = requireSkillId(c.req.param("id"));
    const payload = patchTeamSkillRequestSchema.parse(await readJsonObject(c));
    const data = await service.patchSkill({
      actor: c.var.actor,
      id,
      ops: payload.ops,
      baseVersion: payload.base_version,
      ...(payload.rationale_md !== undefined ? { rationaleMd: payload.rationale_md } : {})
    });
    return c.json({ ok: true, data });
  });

  // R23 SA-06：管理员立刻催一轮「AI 自学团队技能」，不必等今晚。鉴权/防抖/未启用判定全在服务层
  // （见 curateNow）：非管理员 403、进行中 409、开关关着 409、没配密钥 503。
  routes.post("/team-skills/curate-now", requireCurrentUser, async (c) => {
    const data = await service.curateNow({ actor: c.var.actor });
    // 202：这一轮在后台跑，回执只承诺「已经开跑」，跑完的结果去技能页看 curation 区块。
    return c.json({ ok: true, data }, 202);
  });

  routes.post("/team-skills/manage/:id/deactivate", requireCurrentUser, async (c) => {
    const id = requireSkillId(c.req.param("id"));
    const payload = deactivateTeamSkillBodySchema.parse(await readJsonObject(c));
    const data = await service.deactivateSkill({
      actor: c.var.actor,
      id,
      ...(payload.reason ? { reason: payload.reason } : {})
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
