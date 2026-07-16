import { z } from "zod";

import { idSchema } from "./domain/common.js";
import { clientDeviceSchema, userSchema } from "./domain/identity.js";
import { identityContextSchema } from "./identity.js";
import { workHubLocaleInputSchema, workHubLocaleSchema } from "./locale.js";

export const userPreferencesSchema = z.object({
  locale: workHubLocaleSchema
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const updateUserPreferencesRequestSchema = z.object({
  locale: workHubLocaleInputSchema
});
export type UpdateUserPreferencesRequest = z.infer<typeof updateUserPreferencesRequestSchema>;

export const identifyRequestSchema = z.object({
  nickname: z.string().min(1).max(64),
  admin_secret: z.string().max(256).optional()
});
export type IdentifyRequest = z.infer<typeof identifyRequestSchema>;

// R2 auth epic（密码基线，AUTH_MODE!='nickname' 时启用）。email 落库为 citext（大小写不敏感）；
// 这里只做基础格式 + 长度边界，强度策略在 apps/api 的 password 模块。
export const passwordRegisterRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(1024),
  nickname: z.string().min(1).max(64)
});
export type PasswordRegisterRequest = z.infer<typeof passwordRegisterRequestSchema>;

export const passwordLoginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024)
});
export type PasswordLoginRequest = z.infer<typeof passwordLoginRequestSchema>;

// 改密：已登录用户用旧密码换新密码。new_password 走与注册同口径的强度边界。
export const passwordChangeRequestSchema = z.object({
  current_password: z.string().min(1).max(1024),
  new_password: z.string().min(8).max(1024)
});
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;

// 邀请（out-of-band）：管理员建邀请（返回一次性 token，自行拼链接分发）；收件人凭 token 接受建账号。
export const inviteCreateRequestSchema = z.object({
  email: z.string().email().max(320)
});
export type InviteCreateRequest = z.infer<typeof inviteCreateRequestSchema>;

export const inviteAcceptRequestSchema = z.object({
  token: z.string().min(1).max(512),
  nickname: z.string().min(1).max(64),
  password: z.string().min(8).max(1024)
});
export type InviteAcceptRequest = z.infer<typeof inviteAcceptRequestSchema>;

// R17 批 G1（群成员管理 · #15 工作区成员移出/角色变更）：工作区成员角色枚举——与 db
// memberships.role（'member'|'admin'|'owner'）对齐。
export const workspaceMemberRoleSchema = z.enum(["member", "admin", "owner"]);
export type WorkspaceMemberRole = z.infer<typeof workspaceMemberRoleSchema>;

// PATCH /api/workspace/members/:userId 的请求体——只带目标角色。权限红线（仅 admin/owner；不能改自己；
// 不能把最后一名 admin/owner 降级）在服务层强制，见 apps/api/src/services/workspace-members.ts。
export const updateWorkspaceMemberRoleRequestSchema = z
  .object({
    role: workspaceMemberRoleSchema
  })
  .strict();
export type UpdateWorkspaceMemberRoleRequest = z.infer<typeof updateWorkspaceMemberRoleRequestSchema>;

// DELETE /api/workspace/members/:userId 移出成功的响应——回被移出者 user_id（客户端据此就地从 roster
// 剔除），角色变更则额外回新角色。both additive，纯为客户端就地刷新用。
export const removeWorkspaceMemberResultVmSchema = z
  .object({
    removed_user_id: idSchema
  })
  .strict();
export type RemoveWorkspaceMemberResultVM = z.infer<typeof removeWorkspaceMemberResultVmSchema>;

export const updateWorkspaceMemberRoleResultVmSchema = z
  .object({
    user_id: idSchema,
    role: workspaceMemberRoleSchema
  })
  .strict();
export type UpdateWorkspaceMemberRoleResultVM = z.infer<typeof updateWorkspaceMemberRoleResultVmSchema>;

export const identifyResponseSchema = userSchema.pick({
  id: true,
  nickname: true,
  is_admin: true,
  availability_status: true
}).extend({
  display_name: z.string().min(1).max(96),
  created: z.boolean(),
  locale: workHubLocaleSchema,
  preferences: userPreferencesSchema,
  availability_text: z.string().max(128).optional()
});
export type IdentifyResponse = z.infer<typeof identifyResponseSchema>;

export const meResponseSchema = identifyResponseSchema.extend({
  identity: identityContextSchema
}).nullable();
export type MeResponse = z.infer<typeof meResponseSchema>;

export const logoutResponseSchema = z.object({
  ok: z.literal(true)
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

export const clientDeviceRegisterRequestSchema = z.object({
  device_name: z.string().trim().min(1).max(128),
  platform: z.string().max(64).optional()
});
export type ClientDeviceRegisterRequest = z.infer<typeof clientDeviceRegisterRequestSchema>;

export const clientDeviceResponseSchema = clientDeviceSchema;
export type ClientDeviceResponse = z.infer<typeof clientDeviceResponseSchema>;

export const clientDeviceRegisterResponseSchema = z.object({
  device: clientDeviceResponseSchema,
  client_token: z.string().min(32)
});
export type ClientDeviceRegisterResponse = z.infer<typeof clientDeviceRegisterResponseSchema>;

// 桌面端首启引导：一次调用完成 昵称 identify + 设备注册，并在响应体里回 client_token。
// 桌面是跨源(tauri://localhost → 127.0.0.1)，SameSite=Lax cookie 不随跨源 fetch 发出、且没有 token 可发，
// 形成「拿 token 需先鉴权、鉴权又需 token」的死循环。本端点是 CSRF 同源守卫豁免的引导出口，
// 仅在昵称/非密码模式开放（密码模式必须走凭据，返回 404）。token 走响应体而非 cookie：
// 跨源攻击页即便能发起此 POST，也因 CORS 不反射其源而读不到响应体 → 偷不到 token（比现有 /identify 更弱）。
export const desktopBootstrapRequestSchema = z.object({
  nickname: z.string().min(1).max(64),
  admin_secret: z.string().max(256).optional(),
  device_name: z.string().trim().min(1).max(128),
  platform: z.string().max(64).optional()
});
export type DesktopBootstrapRequest = z.infer<typeof desktopBootstrapRequestSchema>;

export const desktopBootstrapResponseSchema = z.object({
  identity: identifyResponseSchema,
  device: clientDeviceResponseSchema,
  client_token: z.string().min(32)
});
export type DesktopBootstrapResponse = z.infer<typeof desktopBootstrapResponseSchema>;

export const authContextSchema = z.object({
  user: identifyResponseSchema,
  device: clientDeviceResponseSchema.optional(),
  identity: identityContextSchema
});
export type AuthContext = z.infer<typeof authContextSchema>;
