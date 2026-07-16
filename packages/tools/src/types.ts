import type { z } from "zod";

export type ToolSideEffect = "none" | "sandbox_file" | "business_write" | "external_effect";

export type SandboxBudget = {
  maxFiles: number;
  maxBytes: number;
  commandTimeoutSeconds: number;
};

export const defaultSandboxBudget: SandboxBudget = {
  maxFiles: 800,
  maxBytes: 200 * 1024 * 1024,
  commandTimeoutSeconds: 45
};

export type ToolResult = {
  ok: boolean;
  content: string;
  isError: boolean;
  toolUseId?: string;
  data?: unknown;
  snapshotId?: string;
};

export type SnapshotHookInput = {
  toolId: string;
  sideEffect: Exclude<ToolSideEffect, "none">;
  input: unknown;
  workdir: string;
  runId?: string;
  workItemId?: string;
};

export type SnapshotHook = (input: SnapshotHookInput) => Promise<{ snapshotId: string }> | { snapshotId: string };

export type CommandRunnerInput = {
  args: string[];
  cwd: string;
  timeoutSeconds: number;
  env: Record<string, string>;
};

export type CommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (input: CommandRunnerInput) => Promise<CommandRunnerOutput>;

export type ToolExecutionContext = {
  workdir: string;
  actorId?: string;
  runId?: string;
  workItemId?: string;
  sandboxBudget?: SandboxBudget;
  snapshot?: SnapshotHook;
  snapshotId?: string;
  commandRunner?: CommandRunner;
};

export type ToolSpec<TInput = unknown> = {
  id: string;
  /**
   * 喂给模型 API 的完整能力说明（tool description 通道）。内联常见误用与截断续读说明，越具体越能
   * 减少模型踩坑——与下面的 promptSnippet/promptGuidelines 是两条独立通道，互不替代。
   */
  description: string;
  /**
   * system prompt 里「可用工具（Available tools）」清单用的一行能力广告（不带参数细节）。留空则该工具
   * 不进清单——组装侧据此决定要不要在提示词里挂出来。
   */
  promptSnippet?: string;
  /**
   * system prompt 里「工具使用准则（Guidelines）」段用的行为准则。每条必须点名本工具的 id（例如
   * 「用 read_file 而不是 cat」），不许写「this tool / 本工具」这类无主语指代——组装侧会跨工具 Set 去重合并。
   */
  promptGuidelines?: string[];
  schema: z.ZodType<TInput>;
  sideEffect: ToolSideEffect;
  minScope?: string;
  execute: (input: TInput, ctx: ToolExecutionContext) => Promise<ToolResult> | ToolResult;
};

export type AnyToolSpec = ToolSpec<any>;

export function okToolResult(content: string, extras: Omit<ToolResult, "ok" | "isError" | "content"> = {}): ToolResult {
  return {
    ok: true,
    isError: false,
    content,
    ...extras
  };
}

export function errorToolResult(content: string, extras: Omit<ToolResult, "ok" | "isError" | "content"> = {}): ToolResult {
  return {
    ok: false,
    isError: true,
    content,
    ...extras
  };
}
