/**
 * 线协议描述符 → WorkHub `ToolSpec`（主进程侧翻译器）。
 *
 * 这是「插件宿主只提供能力实现、不提供授权」的落点：翻出来的 ToolSpec 走的是**既有**
 * 注册表通道，于是自动继承 `canUse` 双检、副作用工具的快照门、human-reserved 拦截、
 * 以及审批链——插件代码在子进程里，授权判断全在这一侧。
 *
 * 两条口径：
 * 1. `sideEffect` 由「管理员断言 AND 工具自述」定（R26 X 阶段 2，见下方 {@link resolvePluginToolSideEffect}）。
 *    默认仍是 `external_effect`——没人表过态就按最高风险跑。
 * 2. 不设 `promptSnippet`/`promptGuidelines`：插件文案会进系统提示词，属于提示词注入面，
 *    要排在提示词 golden 之后。模型仍能通过 `toModelTools`（tool description 通道）看到并调用它。
 */
import {
  sanitizeModelFacingText,
  type AnyToolSpec,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSideEffect
} from "@workhub/tools";
import { z } from "zod";

import type { PluginToolDescriptor } from "./protocol.js";

/**
 * 管理员对一个插件的信任断言 = 它的**风险上限**。与 `@workhub/contracts` 的
 * `pluginTrustLevelSchema` 逐字同一套词（本包不依赖 contracts，两处由 `apps/api` 侧的
 * 类型接线在编译期对齐：`PluginRow["trustLevel"]` 直接喂进这里的参数）。
 */
export type PluginTrustLevel = "read_only" | "external_effect";

/**
 * 插件工具的最终副作用档 = **管理员断言 AND 工具自述**。真值表（四行就是全部）：
 *
 * | 管理员断言 trust_level | 工具自述 selfReportedReadOnly | sideEffect         | minScope                        |
 * | ---------------------- | ---------------------------- | ------------------ | ------------------------------- |
 * | `external_effect`（默认） | true                      | `external_effect`  | `plugin:<id>:external_effect`   |
 * | `external_effect`（默认） | false                     | `external_effect`  | `plugin:<id>:external_effect`   |
 * | `read_only`            | true                         | `none`             | `plugin:<id>:read`              |
 * | `read_only`            | false                        | `external_effect`  | `plugin:<id>:external_effect`   |
 *
 * 两条不对称是有意的：
 * - **自述只能降不能抬。** 管理员断言 `external_effect` 时，插件把每个工具都标成只读也没用——
 *   自述来自第三方代码，它不是授权来源。
 * - **没有自述就取最高风险。** dsh `defineTool` 根本不提供只读声明面（见 `translate.ts` 的
 *   `readsAsReadOnly`），所以绝大多数现存插件即使被断言成 `read_only` 也仍然是最高档——
 *   这正是「默认拒绝」该有的样子，不是漏配。
 *
 * 低风险档选 `none` 而不是 `sandbox_file`：`sandbox_file` 的语义是「写 run 工作目录里的文件」，
 * 一个只读检索工具一个字节都不写，把它标成 `sandbox_file` 会让快照门为它开一个永远没用的还原点
 * （`SnapshotHookInput.sideEffect` 排除了 `none`，正是这个原因）。`none` 同时让它顺着
 * `canUseToolForTaskPlanRole` 的既有规则对 research / review 角色可见——那条规则本来就放行
 * `none` / `sandbox_file` 两档，这里没有新开口子。
 */
export function resolvePluginToolSideEffect(input: {
  trustLevel: PluginTrustLevel;
  selfReportedReadOnly: boolean;
}): ToolSideEffect {
  return input.trustLevel === "read_only" && input.selfReportedReadOnly ? "none" : "external_effect";
}

/**
 * capability 键（R24-P 报告 6.2：复活 `ToolSpec.minScope` 当 capability 键，
 * 拼法 `plugin:<pluginId>:<capability>`）。与副作用档同源，两者不许各说各话。
 * `read` 这个词与 R25 M-MCP 设计 4.2 给 MCP 定的 `mcp:<server>:read` 同口径。
 *
 * 如实说明：`minScope` 至今零消费者——它是给 `packages/permissions` 的 glob 预留的封禁键
 * （`plugin:<id>:*`、`plugin:*`），不是当前生效的门。
 */
export function pluginToolMinScope(pluginId: string, sideEffect: ToolSideEffect): string {
  return `plugin:${pluginId}:${sideEffect === "none" ? "read" : "external_effect"}`;
}

/** 插件文案进模型可见通道前的长度上限——插件描述再长也不该把提示词预算吃光。 */
export const PLUGIN_TEXT_MAX_CHARS = 4000;

/**
 * 插件自报文案的最低限度中和：去掉 C0 控制字符（除换行/制表），砍到上限。
 * 不做语义改写——真正的「装不装、给不给看」由阶段 1 的安装审批决定，这里只保证
 * 一段第三方字符串不会把请求体搞坏或撑爆预算。
 */
export function sanitizePluginText(value: string, maxChars = PLUGIN_TEXT_MAX_CHARS) {
  // 委托给 packages/tools 的共享实现（R26 M1b）：tail 截断 + 控制字符清理，
  // 不开 neutralizeFenceTags——插件描述符文案不进围栏，行为必须与旧版逐字相同
  // （gen:expected 之后 git status 必须无变化，见该函数原先的行为注释）。
  return sanitizeModelFacingText(value, { maxChars, truncation: "tail" });
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

/** 这个插件的信任级别怎么查。不传 = 全部按 `external_effect`（调用方没接线时的安全缺省）。 */
export type PluginTrustLevelLookup = (descriptor: PluginToolDescriptor) => PluginTrustLevel;

export function toPluginToolSpec(
  descriptor: PluginToolDescriptor,
  invoke: PluginToolInvoker,
  trustLevel: PluginTrustLevel = "external_effect"
): AnyToolSpec {
  const sideEffect = resolvePluginToolSideEffect({
    trustLevel,
    selfReportedReadOnly: descriptor.selfReportedReadOnly
  });
  return {
    id: descriptor.toolId,
    description: sanitizePluginText(descriptor.description),
    schema: pluginToolInputSchema,
    jsonSchema: descriptor.jsonSchema,
    sideEffect,
    minScope: pluginToolMinScope(descriptor.pluginId, sideEffect),
    execute: (input, ctx) =>
      invoke({
        descriptor,
        args: (input ?? {}) as Record<string, unknown>,
        ctx
      })
  };
}

export function toPluginToolSpecs(
  descriptors: PluginToolDescriptor[],
  invoke: PluginToolInvoker,
  trustLevelOf?: PluginTrustLevelLookup
): AnyToolSpec[] {
  return descriptors.map((descriptor) =>
    toPluginToolSpec(descriptor, invoke, trustLevelOf?.(descriptor) ?? "external_effect")
  );
}
