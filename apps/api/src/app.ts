import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { settings } from "@workhub/config";
import { getDefaultProviderRegistry } from "./services/provider-registry.js";

import { getOpenApiDocument } from "./openapi.js";
import { createAuthRoutes, createUserDirectoryRoutes } from "./routes/auth.js";
import { createClientDeviceRoutes } from "./routes/client-devices.js";
import { createApprovalRoutes } from "./routes/approvals.js";
import { createEscalationRoutes } from "./routes/escalations.js";
import { createObjectiveRoutes } from "./routes/objectives.js";
import { createMemoryConflictRoutes } from "./routes/memory-conflicts.js";
import { createAgentRunRoutes } from "./routes/agent-runs.js";
import { AgentRunnerError } from "./workers/agent-runner.js";
import { createPermissionRoutes } from "./routes/permissions.js";
import { createPushRoutes } from "./routes/push.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createPageRoutes } from "./routes/pages.js";
import { createAiWorklogRoutes } from "./routes/ai-worklog.js";
import { createDriveRoutes } from "./routes/drive.js";
import { createMeetingRoutes } from "./routes/meetings.js";
import { createPilotRoutes } from "./routes/pilot.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createKnowledgeRoutes } from "./routes/knowledge.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import { createTaskPlanRoutes } from "./routes/task-plans.js";
import { createProposalRoutes, createWorkItemProposalRoutes } from "./routes/proposals.js";
import { createCostRoutes } from "./routes/cost.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createDmRoutes } from "./routes/dm.js";
import { createAiSettingsRoutes } from "./routes/ai-settings.js";
import { createUserProfileRoutes } from "./routes/user-profile.js";
import { createUserAvatarRoutes } from "./routes/user-avatar.js";
import { createConversationArmyRoutes } from "./routes/conversation-army.js";
import { createActionCardRoutes } from "./routes/action-cards.js";
import { createConversationTurnRoutes } from "./routes/conversation-turns.js";
import { createConversationTypingRoutes } from "./routes/conversation-typing.js";
import { createConversationMessageActionRoutes } from "./routes/conversation-message-actions.js";
import { createConversationReadRoutes } from "./routes/conversation-read.js";
import { createConversationRenameRoutes } from "./routes/conversation-rename.js";
import { createConversationCuuRoutes } from "./routes/conversation-cuu.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { createSearchRoutes } from "./routes/search.js";
import { createUserMemoryGovernanceRoutes } from "./routes/user-memory-governance.js";
import { createTeamSkillGovernanceRoutes } from "./routes/team-skill-governance.js";
import { UserMemoryGovernanceServiceError } from "./services/user-memory-governance.js";
import { TeamSkillGovernanceServiceError } from "./services/team-skill-governance.js";
import { createConversationMessageFeedbackRoutes } from "./routes/conversation-message-feedback.js";
import { createProposalFeedbackRoutes } from "./routes/proposal-feedback.js";
import { createActionCardItemFeedbackRoutes } from "./routes/action-card-item-feedback.js";
import { AiFeedbackServiceError } from "./services/ai-feedback.js";
import { createGithubBindingRoutes } from "./routes/github-bindings.js";
import { createDriveVersionRoutes } from "./routes/drive-versions.js";
import { createSpotlightIntentRoutes } from "./routes/spotlight-intent.js";
import { createPersonalProjectRoutes } from "./routes/personal-projects.js";
import { TaskPlanApprovalError } from "./services/task-plan-approval.js";
import { ProjectServiceError } from "./services/projects.js";
import { PilotDay1MetricsServiceError } from "./services/pilot-day1-metrics.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { ApprovalServiceError } from "./services/approvals.js";
import { EscalationServiceError } from "./services/escalations.js";
import { MemoryConflictServiceError } from "./services/memory-conflicts.js";
import { NotificationServiceError } from "./services/notifications.js";
import {
  ProposalServiceError,
  ProposalServiceMergeConflictError,
  ProposalServiceRebaseRequiredError
} from "./services/proposals.js";
import { WorkItemServiceError } from "./services/work-items.js";
import { InternalContractError } from "./pages/output-contract.js";
import { ConversationServiceError } from "./services/conversations.js";
import { AiSettingsServiceError } from "./services/ai-settings.js";
import { UserProfileServiceError } from "./services/user-profile.js";
import { UserAvatarServiceError } from "./services/user-avatar.js";
import { ConversationTurnServiceError } from "./services/conversation-turns.js";
import { SpotlightIntentServiceError } from "./services/spotlight-intent.js";
import { ActionCardServiceError } from "./services/action-cards.js";
import { ConversationArmyServiceError } from "./services/conversation-army.js";

import { LOCAL_CLIENT_HEADER } from "./middleware/auth.js";
import { createSameOriginGuardMiddleware } from "./middleware/csrf.js";
import { createRequestLogMiddleware, createStructuredLogger } from "./logging.js";
import { checkReadiness } from "./readiness.js";

export const logger = createStructuredLogger({ format: settings.logFormat });

export const app = new Hono();

app.use("*", createRequestLogMiddleware(logger));

// 请求体大小上限（抗大负载 DoS）：仅对带体方法（POST/PUT/PATCH）按 Content-Length 早拒，超限回 413。
// 1 MB 默认对 JSON API 足够宽裕；可经 MAX_REQUEST_BODY_BYTES 调整（无效/非正值回退默认）。
// 注意：仅看头部声明，不缓冲/不测量流——缺 Content-Length 时放行（chunked/流式由下游各自把关）。
const DEFAULT_MAX_REQUEST_BODY_BYTES = 1_048_576; // 1 MiB
function resolveMaxRequestBodyBytes(): number {
  const raw = process.env.MAX_REQUEST_BODY_BYTES;
  if (!raw) {
    return DEFAULT_MAX_REQUEST_BODY_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUEST_BODY_BYTES;
}
// 安全响应头（纵深防御）：在所有响应上钉死浏览器侧的几道防线，紧跟请求日志、早于路由。
// - X-Content-Type-Options: nosniff —— 禁 MIME 嗅探，挡内容类型混淆。
// - X-Frame-Options: DENY —— 禁任何站点 iframe 嵌入本服务，挡点击劫持。
// - Referrer-Policy —— 跨源只带 origin，避免把带 token 的路径泄露到外站。
// - Strict-Transport-Security —— HTTPS 强制（明文 http 下浏览器自动忽略，无害）。
// CSP：本服务经 attachWebStatic 直供 Web SSR 产物。该构建的 CSS 由 Vite 以运行时注入的内联 <style>
// 下发（dist 无独立 .css），React 也用内联 style props——故 style-src 必须放行 'unsafe-inline'，否则白屏。
// 脚本侧 index.html 仅有外链 module（无内联 <script>），故 script-src 'self' 即可；SSE(EventSource) 同源，
// connect-src 'self' 足够，附带 ws: 兜底任何 websocket。但 web-live-route-smoke 这道渲染门无法在本地复跑，
// 为零风险落地策略，CSP 一律以 Report-Only 下发——只上报违例、绝不拦截渲染，待线上确认无违例再考虑改为强制。
// R4 #12：安全头中间件必须注册在 body-size 限制之前——后者超限会提前 return 413 短路，若它先注册则 413 响应
// 绕过本中间件、丢失全部安全头。注册在前 → 本中间件 `await next()` 包裹住 413 分支 → 413 也带齐安全头。
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'"
].join("; ");
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  c.header("Content-Security-Policy-Report-Only", CONTENT_SECURITY_POLICY);
});

const MAX_REQUEST_BODY_BYTES = resolveMaxRequestBodyBytes();
const BODY_BEARING_METHODS = new Set(["POST", "PUT", "PATCH"]);
// R9 批次0-5：网盘上传不再整体豁免请求体上限（豁免后 drive 路由是先 formData() 全量入内存
// 才比 32MiB，登录成员发 GB 级 body 可在 413 之前打爆进程）。改为同一中间件里给它一个
// 更高的专属上限：32MiB 文件 + multipart 包头/JSON 封装余量；且该路由必须声明 Content-Length，
// 堵 chunked 无声明长度的绕过（其余路由维持既有「缺声明放行、下游把关」语义不变）。
const DRIVE_UPLOAD_BODY_LIMIT_BYTES = 34 * 1024 * 1024;
function isDriveUploadRoute(method: string, pathname: string) {
  return method === "POST" && /^\/api\/drive\/projects\/[^/]+\/files$/u.test(pathname);
}
app.use("*", async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (BODY_BEARING_METHODS.has(c.req.method)) {
    const driveUpload = isDriveUploadRoute(c.req.method, pathname);
    const cap = driveUpload ? DRIVE_UPLOAD_BODY_LIMIT_BYTES : MAX_REQUEST_BODY_BYTES;
    const declared = c.req.header("content-length");
    if (declared) {
      const length = Number.parseInt(declared, 10);
      if (Number.isFinite(length) && length > cap) {
        return c.json(
          {
            ok: false,
            error: {
              code: "payload_too_large",
              message: `Request body exceeds the ${cap}-byte limit.`
            }
          },
          413
        );
      }
    }
    // 缺 Content-Length 的 drive 上传（chunked）在路由内、鉴权之后拒（411）——
    // 这里若直接拒会在认证前返回非 401/403，破坏 fail-closed 姿态（route-auth-posture）。
  }
  await next();
});

// CORS：此前 CORS_ALLOW_ORIGINS 被解析+生产校验却从未挂载（死配置）。挂上 hono/cors，由 settings 驱动。
// 凭据走 cookie，故不能用通配 origin——用 "*" 时按白名单反射；否则只放行配置白名单。生产已禁止 "*"（validateRuntimeConfig）。
// R2 audit#28：'*'(dev 默认)此前反射任意请求 origin + credentials:true——开发者浏览恶意站点即可携带 cookie 跨源读
// localhost daemon。改为通配模式下**只反射本机回环 + 桌面 tauri 源**，杜绝任意 origin 反射；无 Origin(同源/非浏览器)保持放行。
const corsAllowOrigins = settings.auth.corsAllowOrigins;
const isDevReflectableOrigin = (origin: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/u.test(origin) ||
  origin === "tauri://localhost" ||
  /^https?:\/\/tauri\.localhost(:\d+)?$/u.test(origin);
app.use("/api/*", cors({
  origin: corsAllowOrigins.includes("*")
    ? (origin) => (!origin ? "*" : isDevReflectableOrigin(origin) ? origin : null)
    : corsAllowOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // 桌面 webview 从 tauri://localhost 跨源调 daemon，且每个认证请求都带这两个自定义令牌头
  // （api-client 同时发 X-YQGL + X-WorkHub 别名）。自定义头触发 CORS 预检；hono/cors 设了 allowHeaders 后只回显
  // 这个白名单，故必须把令牌头列进来，否则桌面所有写请求 + fetch-SSE 在预检处被浏览器拦掉。
  allowHeaders: ["Content-Type", "Authorization", "X-Requested-With", LOCAL_CLIENT_HEADER, "X-WorkHub-Client-Token"]
}));

// findings[8]：CSRF 纵深防御——在 SameSite=Lax cookie 之上加同源守卫，对 cookie 认证的写请求把关。
// 安全方法 no-op；桌面 token header / 同源浏览器 / 非浏览器调用放行，跨站浏览器写拒绝。见 middleware/csrf.ts。
app.use("/api/*", createSameOriginGuardMiddleware());

// attachWebStatic() 之后根路径服务 SPA；未挂载 web dist 时保留 API banner。
let webIndexHtml: string | undefined;

app.get("/", (c) => {
  if (webIndexHtml) {
    return c.html(webIndexHtml);
  }
  return c.json({
    ok: true,
    service: "workhub-api",
    message: "WorkHub API daemon is running",
    health: "/api/health"
  });
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "workhub-api",
    env: settings.appEnv,
    runtime: "node",
    port: settings.port,
    // R14 FIX#8（无 key 自托管的静默死）：LLM provider 未配置时观察者/判定器不启动、turn 直接失败，
    // 而用户端此前毫无感知。健康端点先把事实亮出来，前端横幅（合并波后接）与自托管排障都读这里。
    ai_provider_configured: getDefaultProviderRegistry().isConfigured()
  })
);

// 深度就绪探针（编排器 readiness probe 用）：与 /api/health 的存活探针分离——liveness 不依赖任何外部依赖，
// readiness 真打 DB（SELECT 1）+ Redis（若 BROKER_BACKEND=redis）。每项检查带超时与 try/catch，绝不挂死；
// 全通过回 200 {ready:true,...}，任一依赖故障回 503 {ready:false,...}。单测不调用此端点，DB 不在时返回 503 也无碍。
app.get("/api/ready", async (c) => {
  const result = await checkReadiness(settings);
  return c.json(result, result.ready ? 200 : 503);
});

app.get("/openapi.json", (c) => c.json(getOpenApiDocument()));
app.get("/api/openapi.json", (c) => c.json(getOpenApiDocument()));

app.route("/api/auth", createAuthRoutes());
app.route("/api", createUserDirectoryRoutes());
app.route("/api/client-devices", createClientDeviceRoutes());
app.route("/api/push", createPushRoutes());
app.route("/api/approvals", createApprovalRoutes());
app.route("/api/escalations", createEscalationRoutes());
app.route("/api/objectives", createObjectiveRoutes());
app.route("/api/memory-conflicts", createMemoryConflictRoutes());
app.route("/api/permissions", createPermissionRoutes());
app.route("/api", createAgentRunRoutes());
app.route("/api/notifications", createNotificationRoutes());
app.route("/api", createAuditRoutes());
app.route("/api", createSessionRoutes());
app.route("/api", createWorkItemRoutes());
app.route("/api", createTaskPlanRoutes());
app.route("/api/knowledge", createKnowledgeRoutes());
app.route("/api", createWorkItemProposalRoutes());
app.route("/api/proposals", createProposalRoutes());
app.route("/api/cost", createCostRoutes());
app.route("/api/pages", createPageRoutes());
app.route("/api/drive", createDriveRoutes());
app.route("/api/meetings", createMeetingRoutes());
app.route("/api/projects", createProjectRoutes());
app.route("/api", createConversationRoutes());
app.route("/api/dm", createDmRoutes());
app.route("/api", createAiSettingsRoutes());
// R13 批 A2（派人推荐 v2）：GET/PATCH /me/profile ——「我是谁」资料面（title/bio/技能标签）。
app.route("/api", createUserProfileRoutes());
// R14 批 AVATAR：头像上传/删除/读取（PUT/DELETE /me/avatar + GET /users/:id/avatar，ETag 304）。
app.route("/api", createUserAvatarRoutes());
app.route("/api", createConversationArmyRoutes());
app.route("/api", createActionCardRoutes());
app.route("/api", createConversationTurnRoutes());
app.route("/api", createConversationTypingRoutes());
// R14 批 CHAT：消息动作（编辑/删除/reaction/置顶）+ 已读游标 + presence 读端点。
app.route("/api", createConversationMessageActionRoutes());
app.route("/api", createConversationReadRoutes());
// R14 验收修复批 A：协同会话重命名（main 主区不可改名，服务层强制）。
app.route("/api", createConversationRenameRoutes());
// R15 批 cuu-toggle：会话级 Cuu 参与开关（PATCH /cuu，main 一律 409）。
app.route("/api", createConversationCuuRoutes());
app.route("/api", createPresenceRoutes());
// R14 批 SEARCH：全局搜索统一读端点（四 scope 鉴权在 SQL 内逐 actor 收口）。
app.route("/api", createSearchRoutes());
// R14 批 MEM：记忆可见可治理——用户记忆（本人可读写）与团队技能（全员读、管理员写）管理面。
app.route("/api", createUserMemoryGovernanceRoutes());
app.route("/api", createTeamSkillGovernanceRoutes());
// R14 批 FEEDBACK：Cuu 回复/提议/行动卡条目的二值反馈（自见性，喂夜间蒸馏）。
app.route("/api", createConversationMessageFeedbackRoutes());
app.route("/api", createProposalFeedbackRoutes());
app.route("/api", createActionCardItemFeedbackRoutes());
// R14 批 GH：项目级 GitHub 绑定（PAT 密文落库，路由自带错误映射）。
app.route("/api", createGithubBindingRoutes());
app.route("/api/drive", createDriveVersionRoutes());
app.route("/api", createSpotlightIntentRoutes());
app.route("/api", createPersonalProjectRoutes());
app.route("/api/pilot", createPilotRoutes());
app.route("/api/ai-worklog", createAiWorklogRoutes());

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json(
      {
        ok: false,
        error: {
          code: "validation_error",
          message: "Request payload does not match the WorkHub API contract.",
          details: error.issues
        }
      },
      422
    );
  }

  if (error instanceof HTTPException) {
    return c.json(
      {
        ok: false,
        error: {
          code: httpErrorCodeFor(error),
          message: error.message
        }
      },
      error.status
    );
  }

  if (error instanceof AgentRunnerError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      },
      error.status as 400
    );
  }

  if (error instanceof ApprovalServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof EscalationServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof MemoryConflictServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof NotificationServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof ProjectServiceError || error instanceof PilotDay1MetricsServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof ConversationServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof AiSettingsServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 403
    );
  }

  // R14 批 AVATAR：头像端点的类型化错误（400/403/404/413）——同上，不进表就是 500。
  if (error instanceof UserAvatarServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status
    );
  }

  // R13 批 A2：/me/profile 的类型化 403——不进这张表会被兜底压成 500。
  if (error instanceof UserProfileServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status
    );
  }

  // R14 批 FEEDBACK：反馈服务的类型化 400/403/404——不进这张表会被兜底压成 500。
  if (error instanceof AiFeedbackServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  // R14 批 MEM：记忆/技能管理面的类型化 400/403/404/409——不进这张表会被兜底压成 500。
  if (error instanceof UserMemoryGovernanceServiceError || error instanceof TeamSkillGovernanceServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  // R14 验收修复批 B：聚焦盒问 Cuu 的类型化错误此前完全不在本映射表（既有缺口，403/429 也会
  // 被压成 500）；批 B 又给它加了 503 ai_provider_not_configured，一并透传。
  if (error instanceof SpotlightIntentServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  // R12 终缝复核发现:turn/行动卡/军团三个新服务的类型化错误此前没进这张映射表,
  // 线上会被兜底压成 500——busy/observe_only/预算等语义码前端全都接了,必须透传。
  if (
    error instanceof ConversationTurnServiceError ||
    error instanceof ActionCardServiceError ||
    error instanceof ConversationArmyServiceError
  ) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof TaskPlanApprovalError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof ProposalServiceError) {
    // 保留真实 code（409/422/415 等）与冲突/rebase 子类的 details，供客户端据 code 分支驱动 UX。
    const details = error instanceof ProposalServiceRebaseRequiredError
      ? { conflicts: error.conflicts, card: error.card }
      : error instanceof ProposalServiceMergeConflictError
        ? { conflicts: error.conflicts }
        : undefined;
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(details ? { details } : {})
        }
      },
      error.status as 400
    );
  }

  if (error instanceof WorkItemServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof InternalContractError) {
    // findings[#79]：服务端装配 VM 违反自身契约——按 500 给 on-call 告警（含 context/issues，仅服务端日志），
    // response 不回 issues、不甩锅调用方。
    logger.error("internal_contract_error", {
      path: new URL(c.req.url).pathname,
      context: error.context,
      issues: error.issues
    });
    return c.json(
      {
        ok: false,
        error: {
          code: "internal_contract_error",
          message: "WorkHub hit an unexpected server error."
        }
      },
      500
    );
  }

  logger.error("unhandled_error", { path: new URL(c.req.url).pathname, error });
  return c.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "WorkHub hit an unexpected server error."
      }
    },
    500
  );
});

app.notFound((c) =>
  c.json(
    {
      ok: false,
      error: {
        code: "not_found",
        message: "The requested WorkHub endpoint does not exist."
      }
    },
    404
  )
);

/**
 * Pilot 单源部署：API 进程直接服务 Web 构建产物。
 * 非 /api、/openapi 路径返回静态文件；未命中文件回 index.html（SPA fallback）。
 */
export function attachWebStatic(target: Hono, distDir: string, log = logger) {
  const indexPath = path.join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    log.warn("web_dist_missing", { dist_dir: distDir });
    return false;
  }
  const indexHtml = readFileSync(indexPath, "utf8");
  if (target === app) {
    webIndexHtml = indexHtml;
  }
  target.get("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api") || pathname.startsWith("/openapi")) {
      await next();
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const resolved = path.resolve(distDir, relative);
    const distRoot = path.resolve(distDir) + path.sep;
    if (resolved.startsWith(distRoot) && resolved !== path.resolve(indexPath) && existsSync(resolved)) {
      const body = readFileSync(resolved);
      const types: Record<string, string> = {
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".json": "application/json; charset=utf-8",
        ".map": "application/json; charset=utf-8",
        ".woff2": "font/woff2",
        ".html": "text/html; charset=utf-8"
      };
      const type = types[path.extname(resolved)] ?? "application/octet-stream";
      return c.body(new Uint8Array(body), 200, { "Content-Type": type });
    }
    return c.html(indexHtml);
  });
  log.info("web_static_attached", { dist_dir: distDir });
  return true;
}

export default app;
