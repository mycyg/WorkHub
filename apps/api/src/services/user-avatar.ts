import {
  createUserRepository,
  createWorkspaceMembershipRepository,
  getSharedDatabaseClient,
  type UserRepository,
  type WorkHubDatabaseClient,
  type WorkspaceMembershipRepository
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：PUT/DELETE /me/avatar（本人头像写）+
// GET /api/users/:id/avatar（登录且同工作区可见）的服务层。零对象存储、零图片处理依赖——头像
// 二进制原样落 users.avatar_webp，客户端 canvas 裁剪+降采样到 256x256 再上传；服务端只做
// magic bytes 校验（webp/png/jpeg）+ 256KB 硬顶，不重新编码、不猜测意图。
//
// 同工作区鉴权设计成 fail-closed、不可省略：memberships 是必需依赖（不是 OPTIONAL），因为
// R14 前一批（8865577c，「要求委派有活跃用户目录」）刚踩过「可选依赖没注入时静默跳过校验」的坑
// ——本批不重蹈覆辙，头像的跨用户可见性检查没有「缺依赖就放行」这个分支。

export class UserAvatarServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 413 | 501,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "UserAvatarServiceError";
  }
}

// 256KB 硬顶——客户端已经把头像降采样到 256x256 再编码，正常输出远小于此；给足格式开销余量,
// 同时挡住恶意/异常大文件。
export const AVATAR_MAX_BYTES = 256 * 1024;

export type AvatarMimeType = "image/webp" | "image/png" | "image/jpeg";

// Magic bytes 探测，不信任声明的 Content-Type——同一批「服务端只做 magic bytes 校验」的设计原话。
export function detectAvatarMimeType(bytes: Buffer): AvatarMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function assertValidAvatarBytes(bytes: Buffer): AvatarMimeType {
  if (bytes.length === 0) {
    throw new UserAvatarServiceError(400, "avatar_empty", "没有收到图片内容，请重新选择头像。");
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    throw new UserAvatarServiceError(
      413,
      "avatar_too_large",
      `头像文件不能超过 ${Math.floor(AVATAR_MAX_BYTES / 1024)}KB，请压缩后重新上传。`
    );
  }
  const mime = detectAvatarMimeType(bytes);
  if (!mime) {
    throw new UserAvatarServiceError(
      400,
      "avatar_invalid_format",
      "头像文件格式不支持，请上传 webp、png 或 jpeg 格式的图片。"
    );
  }
  return mime;
}

type HumanActorId = string;

function requireHumanActor(actor: AuthActor): HumanActorId {
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId) {
    throw new UserAvatarServiceError(403, "user_avatar_access_denied", "需要已登录的真人用户才能操作头像。");
  }
  return userId;
}

function requireMethod<K extends "setAvatar" | "clearAvatar" | "findAvatar">(
  users: UserRepository,
  key: K
): NonNullable<UserRepository[K]> {
  const fn = users[key];
  if (typeof fn !== "function") {
    throw new UserAvatarServiceError(501, "avatar_not_supported", "当前运行时不支持头像功能。");
  }
  return fn.bind(users) as NonNullable<UserRepository[K]>;
}

export type PutMyAvatarResult = { avatar_updated_at: string };
export type DeleteMyAvatarResult = { avatar_updated_at: null };
export type GetUserAvatarResult =
  | { kind: "not_modified"; etag: string }
  | { kind: "found"; bytes: Buffer; contentType: AvatarMimeType | "application/octet-stream"; etag: string };

export type UserAvatarService = {
  putMyAvatar(input: { actor: AuthActor; bytes: Buffer }): Promise<PutMyAvatarResult>;
  deleteMyAvatar(input: { actor: AuthActor }): Promise<DeleteMyAvatarResult>;
  getUserAvatar(input: {
    actor: AuthActor;
    targetUserId: string;
    ifNoneMatch?: string | undefined;
  }): Promise<GetUserAvatarResult>;
};

export type UserAvatarServiceDependencies = {
  users: UserRepository;
  // 必需依赖（非 OPTIONAL）——见文件头注释：同工作区可见性检查不设"缺依赖就跳过"的旁路。
  memberships: Pick<WorkspaceMembershipRepository, "findActiveForUserWorkspace">;
  now?: () => Date;
};

function etagFor(updatedAt: Date): string {
  return `"${updatedAt.getTime()}"`;
}

export function createUserAvatarService(deps: UserAvatarServiceDependencies): UserAvatarService {
  const now = deps.now ?? (() => new Date());

  return {
    async putMyAvatar({ actor, bytes }) {
      const userId = requireHumanActor(actor);
      assertValidAvatarBytes(bytes);
      const setAvatar = requireMethod(deps.users, "setAvatar");
      const at = now();
      const written = await setAvatar(userId, bytes, at);
      if (!written || !written.avatarUpdatedAt) {
        throw new UserAvatarServiceError(404, "user_not_found", "找不到你的账号，头像没有保存成功。");
      }
      return { avatar_updated_at: written.avatarUpdatedAt.toISOString() };
    },

    async deleteMyAvatar({ actor }) {
      const userId = requireHumanActor(actor);
      const clearAvatar = requireMethod(deps.users, "clearAvatar");
      await clearAvatar(userId, now());
      return { avatar_updated_at: null };
    },

    async getUserAvatar({ actor, targetUserId, ifNoneMatch }) {
      const viewerId = requireHumanActor(actor);
      const findAvatar = requireMethod(deps.users, "findAvatar");
      if (targetUserId !== viewerId) {
        const membership = await deps.memberships.findActiveForUserWorkspace(targetUserId, actor.workspaceId);
        if (!membership) {
          // 同一个 404 覆盖「用户不存在」与「用户存在但不同工作区」——不给攻击者一个可用来
          // 枚举工作区外用户是否存在的 oracle。
          throw new UserAvatarServiceError(404, "user_avatar_not_found", "找不到这位用户的头像。");
        }
      }
      const row = await findAvatar(targetUserId);
      if (!row || !row.avatarWebp || !row.avatarUpdatedAt) {
        throw new UserAvatarServiceError(404, "user_avatar_not_found", "这位用户还没有设置头像。");
      }
      const etag = etagFor(row.avatarUpdatedAt);
      if (ifNoneMatch && ifNoneMatch === etag) {
        return { kind: "not_modified", etag };
      }
      const contentType = detectAvatarMimeType(row.avatarWebp) ?? "application/octet-stream";
      return { kind: "found", bytes: row.avatarWebp, contentType, etag };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultUserAvatarService: UserAvatarService | undefined;

export function getDefaultUserAvatarService(): UserAvatarService {
  if (!defaultUserAvatarService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultUserAvatarService = createUserAvatarService({
      users: createUserRepository(defaultDbClient.db),
      memberships: createWorkspaceMembershipRepository(defaultDbClient.db)
    });
  }
  return defaultUserAvatarService;
}
