/**
 * 线协议描述符 → WorkHub `ToolSpec`（主进程侧翻译器）。
 *
 * 这是「插件宿主只提供能力实现、不提供授权」的落点：翻出来的 ToolSpec 走的是**既有**
 * 注册表通道，于是自动继承 `canUse` 双检、副作用工具的快照门、human-reserved 拦截、
 * 以及审批链——插件代码在子进程里，授权判断全在这一侧。
 *
 * 阶段 0 的两条保守口径（R24-P 报告第 5 节「阶段 0 硬约束」）：
 * 1. `sideEffect` 一律按 `external_effect`（最高风险）对待。清单式能力声明留到阶段 1，
 *    在那之前**默认拒绝比默认放行安全**——副作用非 none 会强制走快照门，且
 *    `sideEffectRiskCategory()` 会把它归到 external 风险类，直接进 human-reserved 门。
 * 2. 不设 `promptSnippet`/`promptGuidelines`：插件文案会进系统提示词，属于提示词注入面，
 *    要排在提示词 golden 之后。模型仍能通过 `toModelTools`（tool description 通道）看到并调用它。
 */
import type { AnyToolSpec, ToolExecutionContext, ToolResult } from "@workhub/tools";
import { z } from "zod";

import type { PluginToolDescriptor } from "./protocol.js";

/** 插件文案进模型可见通道前的长度上限——插件描述再长也不该把提示词预算吃光。 */
export const PLUGIN_TEXT_MAX_CHARS = 4000;

/**
 * 插件自报文案的最低限度中和：去掉 C0 控制字符（除换行/制表），砍到上限。
 * 不做语义改写——真正的「装不装、给不给看」由阶段 1 的安装审批决定，这里只保证
 * 一段第三方字符串不会把请求体搞坏或撑爆预算。
 */
export function sanitizePluginText(value: string, maxChars = PLUGIN_TEXT_MAX_CHARS) {
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ");
  return stripped.length > maxChars ? `${stripped.slice(0, maxChars)}\u2026` : stripped;
}

/**
 * 插件工具入参：只要求「是个对象」。真正的结构校验交给插件侧的 dsh `execute`
 * （它自带 JSON Schema 校验，缺必填抛 INVALID_ARGS）——在主进程里重实现一份 JSON Schema
 * 校验器既重复又容易和插件不一致。模型看到的形状由 `jsonSchema` 旁路给。
 */
const pluginToolInputSchema = z.custom<Record<string, unknown>>(
  (value) =>
    value === undefined ||
    value === null ||
    (typeof value === "object" && !Array.isArray(value)),
  { message: "plugin tool input must be an object" }
);

/** 一次插件工具调用的执行口——由 apps/api 侧注入（负责 RPC、超时、熔断、审计）。 */
export type PluginToolInvoker = (input: {
  descriptor: PluginToolDescriptor;
  args: Record<string, unknown>;
  ctx: ToolExecutionContext;
}) => Promise<ToolResult>;

export function toPluginToolSpec(descriptor: PluginToolDescriptor, invoke: PluginToolInvoker): AnyToolSpec {
  return {
    id: descriptor.toolId,
    description: sanitizePluginText(descriptor.description),
    schema: pluginToolInputSchema,
    jsonSchema: descriptor.jsonSchema,
    // 阶段 0 硬约束：插件工具一律按最高风险对待。
    sideEffect: "external_effect",
    // 报告 6.2：复活 ToolSpec.minScope 当 capability 键，拼法 `plugin:<pluginId>:<capability>`。
    // 阶段 0 还没有清单式能力声明，先钉死在最保守的那一档。
    minScope: `plugin:${descriptor.pluginId}:external_effect`,
    execute: (input, ctx) =>
      invoke({
        descriptor,
        args: (input ?? {}) as Record<string, unknown>,
        ctx
      })
  };
}

export function toPluginToolSpecs(descriptors: PluginToolDescriptor[], invoke: PluginToolInvoker): AnyToolSpec[] {
  return descriptors.map((descriptor) => toPluginToolSpec(descriptor, invoke));
}
