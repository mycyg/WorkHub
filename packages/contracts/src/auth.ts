import { z } from "zod";

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
  email: z.string().email().max(320),
  role: z.enum(["member", "admin", "owner"]).optional(),
  workspace_id: z.string().uuid().optional()
});
export type InviteCreateRequest = z.infer<typeof inviteCreateRequestSchema>;

export const inviteAcceptRequestSchema = z.object({
  token: z.string().min(1).max(512),
  nickname: z.string().min(1).max(64),
  password: z.string().min(8).max(1024)
});
export type InviteAcceptRequest = z.infer<typeof inviteAcceptRequestSchema>;

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
  device_name: z.string().min(1).max(128),
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

export const authContextSchema = z.object({
  user: identifyResponseSchema,
  device: clientDeviceResponseSchema.optional(),
  identity: identityContextSchema
});
export type AuthContext = z.infer<typeof authContextSchema>;
