import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// R13 批 A2（派人推荐 v2）："我是谁"（个人资料）与既有 user-ai-profile（"AI 该怎么替我干活"）语义
// 分开——不同表、不同端点、不混用。user_profiles 在本批之前是零接线死表，这是它的第一份对外契约。
//
// packages/contracts/src/domain/identity.ts 里已经有一份 userProfileSchema，那是「原样镜像 DB 行」的
// 内部契约（无 title 字段，且全仓库零引用——同样是死代码的一部分）。这里的 userProfileVmSchema 是
// 面向 GET/PATCH /me/profile 端点的响应外壳，字段命名/形状独立设计，不 import 也不合并那一份，
// 避免把两个从未被使用过的契约绞在一起造成后续维护混乱。

const skillTagSchema = z.string().trim().min(1).max(64);
const titleSchema = z.string().trim().min(1).max(128);
const bioMdSchema = z.string().trim().min(1).max(4000);

export const userProfileVmSchema = z
  .object({
    user_id: idSchema,
    nickname: z.string().min(1).max(64),
    title: titleSchema.nullable(),
    bio_md: bioMdSchema.nullable(),
    skill_tags: z.array(skillTagSchema).max(50),
    onboarded_at: isoDateTimeSchema.nullable()
  })
  .strict();
export type UserProfileVM = z.infer<typeof userProfileVmSchema>;

export const patchUserProfileRequestSchema = z
  .object({
    title: titleSchema.nullable().optional(),
    bio_md: bioMdSchema.nullable().optional(),
    skill_tags: z.array(skillTagSchema).max(50).optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "user profile patch must include at least one field"
  });
export type PatchUserProfileRequest = z.infer<typeof patchUserProfileRequestSchema>;
