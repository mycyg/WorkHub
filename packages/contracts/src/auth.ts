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
