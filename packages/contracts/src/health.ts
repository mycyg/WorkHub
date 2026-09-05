// WorkHub · 服务器健康探针（GET /api/health）的契约。
//
// R24 S3：这个端点从「存活探针」升格成**桌面端连接服务器屏的一次性探测口**——用户在客户端里敲一个
// 自托管服务器地址、点「测试连接」，一次请求就要拿到足够判断「这是不是我要连的那台、连上之后能干活吗」
// 的全部事实：实例名、版本、认证模式、AI 是否配置。此前只有 ok/service/env/runtime/port/
// ai_provider_configured，认证模式得靠「拿 identify 的 404 当探针」这类取巧手段反推
// （apps/web/src/auth-screen-mode.ts 自陈是权衡之举）。
//
// 兼容性：新增的三个字段对**旧客户端**是纯增量（不读即无感）；对**新客户端连旧服务端**则可能缺失，
// 所以这里全部声明为可选，读取端必须按「未知」降级处理，绝不因为缺字段就判定服务器不可用。

import { z } from "zod";

// 服务端 AUTH_MODE 的三个取值（packages/config/src/env.ts 的 AUTH_MODE 枚举是同一份事实）。
// nickname=局域网信任、无口令；password=服务端会话；hybrid=会话优先、解析不到回退昵称（迁移期）。
export const workHubAuthModes = ["nickname", "hybrid", "password"] as const;
export const workHubAuthModeSchema = z.enum(workHubAuthModes);
export type WorkHubAuthMode = z.infer<typeof workHubAuthModeSchema>;

export const serverHealthSchema = z.object({
  ok: z.literal(true),
  service: z.string().min(1),
  env: z.string().min(1).optional(),
  runtime: z.string().min(1),
  port: z.number().int().positive(),
  ai_provider_configured: z.boolean(),
  // 以下三个是 R24 S3 新增：旧服务端不会返回，故可选。
  auth_mode: workHubAuthModeSchema.optional(),
  version: z.string().min(1).optional(),
  // 管理员给这台服务器起的名字（env WORKHUB_INSTANCE_NAME，默认 "WorkHub"）——用户在连接屏上
  // 靠它确认「我连的是团队那台，不是隔壁的测试机」。
  instance_name: z.string().min(1).optional()
});
export type ServerHealth = z.infer<typeof serverHealthSchema>;
