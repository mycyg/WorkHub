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
  description: string;
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
