import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// R24-P 阶段 1（装得进来、管得住）。阶段 0 只有一个 env 变量 `WORKHUB_PLUGIN_PATHS`；这一层把
// 「装了哪些插件」变成可查询、可治理的记录：清单落库、安装前先做**不执行代码**的静态体检、
// 启停走管理员端点并逐条落审计。
//
// 兼容口径（安装页与文档必须同口径，不许含糊）：我们兼容的是 DeepSeek Harness 的**工具类**插件。
// 声明了 `dsh.client` 的界面/主题类插件走的是浏览器侧第二个 Cordis Context + React，
// WorkHub 全仓零 .tsx、桌面端是字符串模板 DOM，永远兼容不了——所以在安装前就明确拒绝并说清原因，
// 而不是让用户装完看一个失败堆栈。

// 安装源。阶段 1 仍**只**认本地目录：npm 包名 / git url / tarball 会在安装期跑包自己的
// prepare/postinstall，那是任何沙箱之外的任意代码执行。留成单值枚举而不是裸字符串，
// 是为了以后放开时有明确的迁移点。
export const pluginSourceKindSchema = z.literal("local_path");
export type PluginSourceKind = z.infer<typeof pluginSourceKindSchema>;

// installed=登记且试加载成功；load_failed=登记了但宿主加载失败（原因在 load_report）；
// disabled=管理员停用（不进宿主，工具不出现在任何一次执行里）。
export const pluginStatusSchema = z.enum(["installed", "load_failed", "disabled"]);
export type PluginStatus = z.infer<typeof pluginStatusSchema>;

// 静态体检单条结论。block=拒装；warn=允许尝试但先把话说清；pass=这条没问题。
export const pluginCompatCheckLevelSchema = z.enum(["pass", "warn", "block"]);
export type PluginCompatCheckLevel = z.infer<typeof pluginCompatCheckLevelSchema>;

// 体检项 id——服务端与两端 UI 共用的稳定键，文案由展示层按 locale 出（这里只存结构与英文诊断）。
export const pluginCompatCheckIdSchema = z.enum([
  // 目标目录存在且是目录、能读出 package.json
  "manifest",
  // 声明了 dsh.client（界面/主题类）→ 拒
  "client_surface",
  // 有 prepare/postinstall/preinstall/install 脚本 → 拒
  "install_scripts",
  // peer 里的 @deepseek-ai/dsh-tools 范围与宿主捆绑版本对不上 → 警告（仍可尝试）
  "dsh_tools_peer",
  // 有没有 dsh.bundle.patch（可安装性的惯例判据）→ 缺失只警告，不拦
  "bundle_manifest"
]);
export type PluginCompatCheckId = z.infer<typeof pluginCompatCheckIdSchema>;

export const pluginCompatCheckSchema = z.object({
  id: pluginCompatCheckIdSchema,
  level: pluginCompatCheckLevelSchema,
  // 英文诊断细节（版本范围、脚本名等）。人话由展示层按 check id + detail 组装。
  detail: z.string().max(500).optional()
});
export type PluginCompatCheck = z.infer<typeof pluginCompatCheckSchema>;

// 一次静态体检的完整结论。**不执行插件任何代码**——只读 package.json。
export const pluginCompatReportSchema = z.object({
  // ok=可以装；warn=能装但有已知风险/可能装不上；blocked=拒装。
  verdict: z.enum(["ok", "warn", "blocked"]),
  checks: z.array(pluginCompatCheckSchema),
  // 从 package.json 读到的自报信息（缺就是缺，不编）。
  manifest_name: z.string().max(200).optional(),
  manifest_version: z.string().max(80).optional(),
  manifest_license: z.string().max(120).optional(),
  // 插件 peer 声明的 @deepseek-ai/dsh-tools 范围，与我们宿主捆绑的版本——两个都摆出来，
  // 用户自己能判断「这插件是对着哪个版本发的」。
  peer_dsh_tools_range: z.string().max(120).optional(),
  host_dsh_tools_version: z.string().max(80).optional(),
  // 体检那一刻的时间戳，进 DB 的 compat_report。
  checked_at: isoDateTimeSchema
});
export type PluginCompatReport = z.infer<typeof pluginCompatReportSchema>;

// 宿主试加载的结果（`packages/plugin-host` 的 PluginLoadReport 的对外形状）。
export const pluginLoadReportSchema = z.object({
  ok: z.boolean(),
  tool_count: z.number().int().nonnegative(),
  prompt_section_count: z.number().int().nonnegative(),
  error: z.string().max(2000).optional(),
  loaded_at: isoDateTimeSchema
});
export type PluginLoadReportVM = z.infer<typeof pluginLoadReportSchema>;

// 一条插件记录的对外 VM。source_path 是本机绝对路径——只对管理员可见（设置页整段就是管理员门）。
export const pluginVmSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  version: z.string().max(80).optional(),
  source_kind: pluginSourceKindSchema,
  source_path: z.string().min(1).max(1000),
  enabled: z.boolean(),
  status: pluginStatusSchema,
  // 已上线的工具数（试加载成功才有）。
  tool_count: z.number().int().nonnegative(),
  compat_report: pluginCompatReportSchema,
  load_report: pluginLoadReportSchema.optional(),
  installed_by: idSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type PluginVM = z.infer<typeof pluginVmSchema>;

// 安装请求。只有一个字段：本机目录路径。strict——多传字段直接 422，不静默忽略。
export const installPluginRequestSchema = z
  .object({
    source_path: z.string().min(1).max(1000)
  })
  .strict();
export type InstallPluginRequest = z.infer<typeof installPluginRequestSchema>;

// 列表响应：记录 + 一条环境说明（宿主捆绑版本、开发引导路径是否在用）。
export const pluginListVmSchema = z.object({
  plugins: z.array(pluginVmSchema),
  // 宿主捆绑的 @deepseek-ai/dsh-tools 版本——安装页据此解释「可能装不上」的警告。
  host_dsh_tools_version: z.string().max(80).optional(),
  // 来自 `WORKHUB_PLUGIN_PATHS` 的开发/引导路径条数（这些不在清单里，但确实会被加载）。
  bootstrap_path_count: z.number().int().nonnegative()
});
export type PluginListVM = z.infer<typeof pluginListVmSchema>;

// web 设置页的**只读**行。刻意不含 source_path——那是本机绝对路径，属于桌面端管理面的信息，
// 网页只回答「这个部署上装了什么、还活着吗」。
export const pluginSummaryVmSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  version: z.string().max(80).optional(),
  enabled: z.boolean(),
  status: pluginStatusSchema,
  tool_count: z.number().int().nonnegative(),
  compat_verdict: pluginCompatReportSchema.shape.verdict
});
export type PluginSummaryVM = z.infer<typeof pluginSummaryVmSchema>;
