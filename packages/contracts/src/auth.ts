import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./domain/common.js";
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

// R24 S3 严重#4：四个建号入口（identify/desktop-bootstrap/register/invites-accept）新增可选
// locale——服务端建新用户时优先用它，其次探测 Accept-Language，都没有才落旧默认 zh-CN
// （见 apps/api/src/middleware/auth.ts 的 resolveNewUserLocale）。契约新增，additive，不破坏性；
// 只在真正新建用户时生效，已存在用户的偏好不因请求带这个字段而被覆盖。
export const identifyRequestSchema = z.object({
  nickname: z.string().min(1).max(64),
  admin_secret: z.string().max(256).optional(),
  locale: workHubLocaleSchema.optional()
});
export type IdentifyRequest = z.infer<typeof identifyRequestSchema>;

// R2 auth epic（密码基线，AUTH_MODE!='nickname' 时启用）。email 落库为 citext（大小写不敏感）；
// 这里只做基础格式 + 长度边界，强度策略在 apps/api 的 password 模块。
export const passwordRegisterRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(1024),
  nickname: z.string().min(1).max(64),
  // R24 S3 严重#4：新建号可选 locale，见 identifyRequestSchema 顶注。
  locale: workHubLocaleSchema.optional()
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
  password: z.string().min(8).max(1024),
  // R24 S3 严重#4：新建号可选 locale，见 identifyRequestSchema 顶注。
  locale: workHubLocaleSchema.optional()
});
export type InviteAcceptRequest = z.infer<typeof inviteAcceptRequestSchema>;

// R18 批 H1（成员管理面板 · 未过期邀请清单）：GET /api/auth/invites?status=pending 的一条邀请。
// 绝不带 token——服务端只存 sha256(token)，明文取不回（POST 创建时一次性回过），这里如实只暴露
// invite_id/email/过期时间/创建时间，供管理员在 web 成员分区追踪尚未被接受、且还没过期的邀请。
export const pendingInviteVmSchema = z
  .object({
    invite_id: idSchema,
    email: z.string().email().max(320),
    expires_at: isoDateTimeSchema,
    created_at: isoDateTimeSchema
  })
  .strict();
export type PendingInviteVM = z.infer<typeof pendingInviteVmSchema>;

export const listPendingInvitesResultVmSchema = z
  .object({
    invites: z.array(pendingInviteVmSchema)
  })
  .strict();
export type ListPendingInvitesResultVM = z.infer<typeof listPendingInvitesResultVmSchema>;

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

// R18 批 H1（web 成员管理面板 · 成员清单）：GET /api/workspace/members 的一行成员——昵称/角色/加入时间。
// is_self 供客户端把自己那行去掉管理动作（服务端也会以 member_manage_self 兜底，不依赖客户端自觉）。
// 只读窄端点，管理员门控（同 DELETE/PATCH），供 web /settings 成员分区渲染 roster。
export const workspaceMemberSummaryVmSchema = z
  .object({
    user_id: idSchema,
    nickname: z.string().min(1).max(96),
    role: workspaceMemberRoleSchema,
    joined_at: isoDateTimeSchema,
    is_self: z.boolean()
  })
  .strict();
export type WorkspaceMemberSummaryVM = z.infer<typeof workspaceMemberSummaryVmSchema>;

export const listWorkspaceMembersResultVmSchema = z
  .object({
    members: z.array(workspaceMemberSummaryVmSchema)
  })
  .strict();
export type ListWorkspaceMembersResultVM = z.infer<typeof listWorkspaceMembersResultVmSchema>;

// R20 P2A（P1-08 修复 · workspace-scoped roster）：GET /api/workspace/roster 的分页查询参数。
// 背景：/api/users 是全局用户目录（跨租户泄露 + 全局昵称排序 + 硬上限 200 截断），却被消费端误当工作区
// 花名册。本端点按调用者所在工作区 join membership 列成员，limit/offset 分页——无硬 200 截断，任意工作区
// 成员可读。查询参数来自 URL query string（字符串），故 coerce；越界/非法一律回退默认（.catch），只读列表
// 不因坏参数 422 阻断（客户端翻页体验优先）。
export const workspaceRosterQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).catch(50),
  offset: z.coerce.number().int().min(0).default(0).catch(0)
});
export type WorkspaceRosterQuery = z.infer<typeof workspaceRosterQuerySchema>;

// roster 一行成员：昵称/角色/加入时间/是否本人 + 头像占位 + 在线态占位。
//   * avatar_updated_at：非空表示该成员有头像（兼作 GET /api/users/:id/avatar 的缓存键）；此处不回二进制。
//   * online：在线态占位——当前恒 null（presence 接线后由后续批次填真值），字段先就位以免届时改契约。
//   * is_admin：R20 P1-08 收尾 · 全局管理员标签（users.is_admin，非本工作区角色）——additive 补字段，供
//     web 审批转交选择器等消费端摆脱全局 /api/users（该端点跨租户泄露 + 硬 200 截断）后仍能标「管理员」。
export const workspaceRosterMemberVmSchema = z
  .object({
    user_id: idSchema,
    nickname: z.string().min(1).max(96),
    role: workspaceMemberRoleSchema,
    joined_at: isoDateTimeSchema,
    is_self: z.boolean(),
    is_admin: z.boolean(),
    avatar_updated_at: isoDateTimeSchema.nullable(),
    online: z.boolean().nullable()
  })
  .strict();
export type WorkspaceRosterMemberVM = z.infer<typeof workspaceRosterMemberVmSchema>;

// roster 分页响应：本页成员 + 工作区活跃成员总数 + 回显本次 limit/offset。
//   * total 修「计数错」——/api/users 的全局计数含跨租户且封顶 200；这里是本工作区 active 成员真实总数。
//   * total > offset + members.length 即还有下一页，客户端据此翻页；全量成员皆可经 offset 达到（无 200 截断）。
export const workspaceRosterResultVmSchema = z
  .object({
    members: z.array(workspaceRosterMemberVmSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative()
  })
  .strict();
export type WorkspaceRosterResultVM = z.infer<typeof workspaceRosterResultVmSchema>;

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
  platform: z.string().max(64).optional(),
  // R24 S3 严重#4：新建号可选 locale，见 identifyRequestSchema 顶注。桌面端应在首启时带上
  // 系统/应用语言（目前尚未接线——见 apps/api 端该轮 Agent Note 的遗留项）。
  locale: workHubLocaleSchema.optional()
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
