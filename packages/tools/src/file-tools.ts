import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  defaultSandboxBudget,
  errorToolResult,
  okToolResult,
  type AnyToolSpec,
  type ToolExecutionContext,
  type ToolSpec
} from "./types.js";
import {
  enforceSandboxBudget,
  runSandboxedCommand,
  safeResolvePath
} from "./sandbox.js";

const pathInput = z.object({ path: z.string().default(".") });
const requiredPathInput = z.object({ path: z.string().min(1) });

function tool<TInput>(spec: ToolSpec<TInput>) {
  return spec;
}

async function enforceBudget(ctx: ToolExecutionContext) {
  return enforceSandboxBudget(ctx.workdir, ctx.sandboxBudget ?? defaultSandboxBudget);
}

async function listRelativeFiles(root: string, start: string, limit: number, acc: string[] = []) {
  if (acc.length >= limit) {
    return acc;
  }
  const entries = await readdir(start, { withFileTypes: true });
  for (const entry of entries) {
    if (acc.length >= limit) {
      break;
    }
    const full = path.join(start, entry.name);
    const relative = path.relative(root, full) || ".";
    acc.push(entry.isDirectory() ? `${relative}/` : relative);
    if (entry.isDirectory()) {
      await listRelativeFiles(root, full, limit, acc);
    }
  }
  return acc;
}

export function createBuiltInFileTools(): AnyToolSpec[] {
  const tools = [
    tool({
      id: "list_files",
      description: "List files inside the current WorkHub sandbox.",
      schema: pathInput,
      sideEffect: "none",
      async execute(input, ctx) {
        const root = safeResolvePath(ctx.workdir);
        const start = safeResolvePath(ctx.workdir, input.path);
        const files = await listRelativeFiles(root, start, 200);
        return okToolResult(files.join("\n") || "(empty)", { data: { files } });
      }
    }),
    tool({
      id: "read_file",
      description: "Read a UTF-8 text file inside the sandbox.",
      schema: requiredPathInput,
      sideEffect: "none",
      async execute(input, ctx) {
        const target = safeResolvePath(ctx.workdir, input.path);
        return okToolResult(await readFile(target, "utf8"));
      }
    }),
    tool({
      id: "write_file",
      description: "Write a UTF-8 text file inside the sandbox.",
      schema: z.object({ path: z.string().min(1), content: z.string() }),
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        const target = safeResolvePath(ctx.workdir, input.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, input.content, "utf8");
        await enforceBudget(ctx);
        return okToolResult(`wrote ${input.path}`);
      }
    }),
    tool({
      id: "write_base64_file",
      description: "Write a binary file from base64 content inside the sandbox.",
      schema: z.object({ path: z.string().min(1), base64_content: z.string().min(1) }),
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        const target = safeResolvePath(ctx.workdir, input.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(input.base64_content, "base64"));
        await enforceBudget(ctx);
        return okToolResult(`wrote ${input.path}`);
      }
    }),
    tool({
      id: "mkdir",
      description: "Create a directory inside the sandbox.",
      schema: requiredPathInput,
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        await mkdir(safeResolvePath(ctx.workdir, input.path), { recursive: true });
        await enforceBudget(ctx);
        return okToolResult(`created ${input.path}`);
      }
    }),
    tool({
      id: "move_path",
      description: "Move or rename a file or folder inside the sandbox.",
      schema: z.object({ src: z.string().min(1), dest: z.string().min(1) }),
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        const src = safeResolvePath(ctx.workdir, input.src);
        const dest = safeResolvePath(ctx.workdir, input.dest);
        await mkdir(path.dirname(dest), { recursive: true });
        await rename(src, dest);
        await enforceBudget(ctx);
        return okToolResult(`moved ${input.src} to ${input.dest}`);
      }
    }),
    tool({
      id: "delete_path",
      description: "Delete a file or folder inside the sandbox.",
      schema: requiredPathInput,
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        await rm(safeResolvePath(ctx.workdir, input.path), { recursive: true, force: true });
        await enforceBudget(ctx);
        return okToolResult(`deleted ${input.path}`);
      }
    }),
    tool({
      id: "run_command",
      description: "Run an allowlisted command inside the sandbox without shell expansion.",
      schema: z.object({
        args: z.array(z.string().min(1)).min(1),
        cwd: z.string().default("."),
        timeout_s: z.number().int().positive().max(60).optional()
      }),
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        const budget = ctx.sandboxBudget ?? defaultSandboxBudget;
        const timeoutSeconds = input.timeout_s ?? budget.commandTimeoutSeconds;
        const result = await runSandboxedCommand({
          args: input.args,
          cwd: input.cwd,
          workdir: ctx.workdir,
          timeoutSeconds,
          ...(ctx.commandRunner ? { runner: ctx.commandRunner } : {})
        });
        await enforceBudget(ctx);
        return result.exitCode === 0
          ? okToolResult(result.stdout || "(no output)", { data: result })
          : errorToolResult(result.stderr || result.stdout || `command exited with ${result.exitCode}`, { data: result });
      }
    }),
    tool({
      id: "zip_path",
      description: "Create an archive manifest for a sandbox path. The document worker will replace this with real zip output.",
      schema: z.object({ src: z.string().min(1), dest: z.string().min(1) }),
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        const src = safeResolvePath(ctx.workdir, input.src);
        const dest = safeResolvePath(ctx.workdir, input.dest);
        await mkdir(path.dirname(dest), { recursive: true });
        const manifest = {
          kind: "archive_manifest",
          source: path.relative(ctx.workdir, src),
          note: "P0 TS sandbox placeholder; real zip writer is a later document worker adapter."
        };
        await writeFile(dest, JSON.stringify(manifest, null, 2), "utf8");
        await enforceBudget(ctx);
        return okToolResult(`archived ${input.src} to ${input.dest}`, { data: manifest });
      }
    }),
    tool({
      id: "submit",
      description: "Optional final note. WorkHub completion is end_turn with no tool request, not this flag.",
      schema: z.object({ notes: z.string().min(1) }),
      sideEffect: "none",
      execute(input) {
        return okToolResult(input.notes);
      }
    })
  ];
  return tools;
}
