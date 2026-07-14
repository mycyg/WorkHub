import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// R14 批 GH（GitHub 集成 · 07-gh-design.md §2.3）。安全红线（§6）在契约层的落地：
// 响应 VM 结构性地不含任何 token 位——不是「脱敏成 ghp_****」，是「schema 根本没有这个字段」，
// 从类型层杜绝密文/明文经任何响应泄漏（比记得脱敏更强的防线，缺字段就无从泄漏）。

// owner/repo 形如 "octocat/Hello-World"：owner 与 repo 段都限制在 GitHub 允许的字符集内。
export const githubRepoFullNameSchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/u, "expected owner/repo");

export const githubActivityKindSchema = z.enum(["commit", "issue", "pull_request"]);
export type GithubActivityKind = z.infer<typeof githubActivityKindSchema>;

// 绑定/换 PAT 的写请求体。PAT 只写不回读：它只出现在请求体，从不出现在任何响应 schema。
export const githubBindingRequestSchema = z
  .object({
    repo_full_name: githubRepoFullNameSchema,
    personal_access_token: z.string().min(20).max(512)
  })
  .strict();
export type GithubBindingRequest = z.infer<typeof githubBindingRequestSchema>;

// 测试连接请求：body 里的 PAT 可选——带则验证这个临时值（表单「测试连接」按钮，不落库），
// 不带则验证已存的绑定 PAT（绑定卡「重新测试」按钮）。同样 strict，杜绝多余字段。
export const githubTestConnectionRequestSchema = z
  .object({
    personal_access_token: z.string().min(20).max(512).optional(),
    // 首次绑定前测试时前端需要顺带传 repo（还没有已存绑定可查）；已绑定的重测可省略。
    repo_full_name: githubRepoFullNameSchema.optional()
  })
  .strict();
export type GithubTestConnectionRequest = z.infer<typeof githubTestConnectionRequestSchema>;

// 读绑定状态的响应 VM——**没有任何 token 字段**（§2.3/§6）。未绑定时 bound=false，其余字段缺省。
export const githubBindingStatusVmSchema = z.object({
  project_id: idSchema,
  bound: z.boolean(),
  repo_full_name: z.string().optional(),
  repo_default_branch: z.string().optional(),
  repo_private: z.boolean().optional(),
  enabled: z.boolean().optional(),
  last_synced_at: isoDateTimeSchema.optional(),
  // 人话失败摘要，从不含 token 片段（humanizeGithubError 收敛，见 services/github-client.ts）。
  last_error: z.string().optional(),
  last_error_at: isoDateTimeSchema.optional(),
  activity_count_7d: z.number().int().nonnegative().optional()
});
export type GithubBindingStatusVM = z.infer<typeof githubBindingStatusVmSchema>;

// 测试连接结果：ok=false 是正常业务结果（连接失败），不是 HTTP 层错误。error 为人话原因，不含 token。
export const githubTestConnectionResultSchema = z.object({
  ok: z.boolean(),
  repo_full_name: z.string().optional(),
  repo_default_branch: z.string().optional(),
  repo_private: z.boolean().optional(),
  error: z.string().optional()
});
export type GithubTestConnectionResult = z.infer<typeof githubTestConnectionResultSchema>;

// 单条 GitHub 活动的展示 VM（项目主页 github 区块由 GH-C 消费；此处先定义供两侧共享类型，additive）。
export const githubActivityVmSchema = z.object({
  kind: githubActivityKindSchema,
  title: z.string(),
  html_url: z.string(),
  occurred_at: isoDateTimeSchema,
  author_login: z.string().optional(),
  state: z.string().optional()
});
export type GithubActivityVM = z.infer<typeof githubActivityVmSchema>;
