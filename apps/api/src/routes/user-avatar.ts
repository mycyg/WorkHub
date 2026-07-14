import { Hono, type Context } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultUserAvatarService,
  UserAvatarServiceError,
  type UserAvatarService
} from "../services/user-avatar.js";
import { isUuidParam } from "./uuid-param.js";

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：PUT/DELETE /me/avatar（本人头像写）+
// GET /api/users/:id/avatar（登录且同工作区可见，ETag=avatar_updated_at 毫秒值，304 缓存）。
// 零对象存储、零图片处理依赖——头像二进制原样落库，客户端 canvas 裁剪+降采样到 256x256 再上传，
// 服务端只做 magic bytes 校验（webp/png/jpeg）+ 256KB 硬顶。
//
// 集成者缝合位（本批范围围栏禁止直接改 app.ts/openapi.ts/server.ts，需要集成者补上）：
//   - app.ts 挂载：import { createUserAvatarRoutes } from "./routes/user-avatar.js";
//                  app.route("/api", createUserAvatarRoutes());
//   - app.ts onError：新增一段
//       if (error instanceof UserAvatarServiceError) {
//         return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
//       }
//     （照 UserProfileServiceError 现有写法插在同一批 instanceof 分支旁）。
//   - openapi.ts：PUT /api/me/avatar、DELETE /api/me/avatar、GET /api/users/{id}/avatar 三条路径文档
//     （PUT 请求体是二进制 image/*，响应 `{ ok: true, data: { avatar_updated_at: string } }`；
//     DELETE 响应 `{ ok: true, data: { avatar_updated_at: null } }`；GET 响应二进制图片，支持
//     If-None-Match → 304，404 = 未登录同工作区不可见或用户没有头像）。

export type UserAvatarRoutesDependencies = {
  auth?: AuthDependencySource;
  userAvatar?: UserAvatarService;
};

// 256KB 硬顶之上只多留 1 字节判定"确实超限"——不需要为了报错文案精确到字节而多缓冲更多。
const AVATAR_UPLOAD_BODY_CAP_BYTES = 256 * 1024 + 1;

// 流式读入、边读边计数，一旦确认超限立刻中止底层流——不把恶意/异常大 body 一路缓冲进内存
// 才发现太大（同 apps/api/src/routes/drive.ts 的 readBoundedUploadBytes 同一套纪律，头像上传体量
// 小得多，用独立的小上限）。
async function readBoundedAvatarBytes(c: Context<AuthEnv>): Promise<Buffer> {
  const stream = c.req.raw.body;
  if (!stream) {
    return Buffer.alloc(0);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      chunks.push(value);
      if (total > AVATAR_UPLOAD_BODY_CAP_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export function createUserAvatarRoutes(deps: UserAvatarRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const userAvatar = deps.userAvatar ?? getDefaultUserAvatarService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.put("/me/avatar", requireCurrentUser, async (c) => {
    const bytes = await readBoundedAvatarBytes(c);
    const data = await userAvatar.putMyAvatar({ actor: c.var.actor, bytes });
    return c.json({ ok: true, data });
  });

  routes.delete("/me/avatar", requireCurrentUser, async (c) => {
    const data = await userAvatar.deleteMyAvatar({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.get("/users/:id/avatar", requireCurrentUser, async (c) => {
    const targetUserId = c.req.param("id");
    if (!isUuidParam(targetUserId)) {
      // 非法 uuid 与"合法但不存在/不可见"同样回 404——不给攻击者用状态码区分存在性的 oracle
      // （与 routes/uuid-param.ts 头部注释的既有约定一致）。
      throw new UserAvatarServiceError(404, "user_avatar_not_found", "找不到这位用户的头像。");
    }
    const ifNoneMatch = c.req.header("If-None-Match") ?? undefined;
    const result = await userAvatar.getUserAvatar({ actor: c.var.actor, targetUserId, ifNoneMatch });
    c.header("Cache-Control", "private, max-age=0, must-revalidate");
    c.header("ETag", result.etag);
    if (result.kind === "not_modified") {
      return c.body(null, 304);
    }
    c.header("Content-Type", result.contentType);
    c.header("Content-Length", String(result.bytes.byteLength));
    // Hono 的 Data 联合类型钉的是 Uint8Array<ArrayBuffer>，Node Buffer 的类型形状不完全等价
    // （即便运行时是同一份字节）——显式拷贝一份标准 Uint8Array 规避类型不匹配，256KB 量级拷贝开销可忽略。
    return c.body(new Uint8Array(result.bytes), 200);
  });

  return routes;
}
