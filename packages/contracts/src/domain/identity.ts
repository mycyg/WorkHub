import { z } from "zod";

import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";

export const userSchema = timestampFieldsSchema.extend({
  id: idSchema,
  nickname: z.string().min(1).max(64),
  display_name: z.string().min(1).max(96),
  availability_status: z.string().max(16),
  availability_text: z.string().max(128).optional(),
  availability_updated_at: isoDateTimeSchema.optional(),
  is_admin: z.boolean(),
  deleted_at: isoDateTimeSchema.optional()
});
export type User = z.infer<typeof userSchema>;

export const clientDeviceSchema = timestampFieldsSchema.extend({
  id: idSchema,
  user_id: idSchema,
  device_name: z.string().min(1).max(128),
  platform: z.string().min(1).max(64),
  last_seen_at: isoDateTimeSchema.optional(),
  revoked_at: isoDateTimeSchema.optional()
});
export type ClientDevice = z.infer<typeof clientDeviceSchema>;

export const userProfileSchema = timestampFieldsSchema.extend({
  id: idSchema,
  user_id: idSchema,
  bio_md: z.string().optional(),
  skills_text: z.string().optional(),
  skill_tags: z.array(z.string()).default([]),
  availability_pref: z.record(z.string(), z.unknown()).default({}),
  onboarded_at: isoDateTimeSchema.optional()
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const orgSchema = timestampFieldsSchema.extend({
  id: idSchema,
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(64),
  plan: z.string().max(32),
  deleted_at: isoDateTimeSchema.optional()
});
export type Org = z.infer<typeof orgSchema>;

export const workspaceSchema = timestampFieldsSchema.extend({
  id: idSchema,
  org_id: idSchema,
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(64),
  deleted_at: isoDateTimeSchema.optional()
});
export type Workspace = z.infer<typeof workspaceSchema>;
