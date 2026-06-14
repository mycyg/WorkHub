import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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

const pathInput = z.object({ path: z.string().default("."), description: z.string().optional() });
const requiredPathInput = z.object({ path: z.string().min(1) });
const readablePathInput = z.object({ path: z.string().min(1).optional(), description: z.string().optional() });

function tool<TInput>(spec: ToolSpec<TInput>) {
  return spec;
}

async function enforceBudget(ctx: ToolExecutionContext) {
  return enforceSandboxBudget(ctx.workdir, ctx.sandboxBudget ?? defaultSandboxBudget);
}

// 写前预检：单次写入的字节数本身就超预算时，先拒绝再落盘。否则巨型 payload 会先写满主机磁盘，
// 事后的 enforceBudget 才报错——损害已造成（DoS）。
function assertWriteWithinBudget(ctx: ToolExecutionContext, byteLength: number) {
  const budget = ctx.sandboxBudget ?? defaultSandboxBudget;
  if (byteLength > budget.maxBytes) {
    throw new Error(`sandbox byte budget exceeded: write of ${byteLength} bytes over limit ${budget.maxBytes}`);
  }
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

async function inferSingleInputFile(workdir: string) {
  const inputs = safeResolvePath(workdir, "inputs");
  try {
    const files = (await listRelativeFiles(safeResolvePath(workdir), inputs, 10))
      .filter((item) => !item.endsWith("/"));
    return files.length === 1 ? files[0] : undefined;
  } catch {
    return undefined;
  }
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipPathName(input: string) {
  return input.split(path.sep).join("/");
}

async function collectZipEntries(root: string, current: string, excluded: string, entries: { name: string; data: Buffer }[] = []) {
  const currentStat = await stat(current);
  if (path.resolve(current) === excluded) {
    return entries;
  }
  if (!currentStat.isDirectory()) {
    const relative = path.relative(root, current);
    const name = zipPathName(relative || path.basename(current));
    entries.push({ name, data: await readFile(current) });
    return entries;
  }

  const children = await readdir(current, { withFileTypes: true });
  for (const child of children) {
    await collectZipEntries(root, path.join(current, child.name), excluded, entries);
  }
  return entries;
}

function createStoredZip(entries: { name: string; data: Buffer }[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function createZipArchive(input: { src: string; dest: string }) {
  const srcStat = await stat(input.src);
  const root = srcStat.isDirectory() ? input.src : path.dirname(input.src);
  const entries = await collectZipEntries(root, input.src, path.resolve(input.dest));
  if (entries.length === 0) {
    throw new Error("zip_path source has no files to archive");
  }
  await mkdir(path.dirname(input.dest), { recursive: true });
  const archive = createStoredZip(entries);
  await writeFile(input.dest, archive);
  return { entries: entries.map((entry) => entry.name), bytes: archive.length };
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
      schema: readablePathInput,
      sideEffect: "none",
      async execute(input, ctx) {
        const requestedPath = input.path ?? await inferSingleInputFile(ctx.workdir);
        if (!requestedPath) {
          return errorToolResult("read_file requires path. Example: {\"path\":\"inputs/meeting-notes.md\"}");
        }
        const target = safeResolvePath(ctx.workdir, requestedPath);
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
        assertWriteWithinBudget(ctx, Buffer.byteLength(input.content, "utf8"));
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
        const bytes = Buffer.from(input.base64_content, "base64");
        assertWriteWithinBudget(ctx, bytes.byteLength);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
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
      description: "Create a zip archive for a sandbox file or folder.",
      schema: z.object({ src: z.string().min(1), dest: z.string().min(1) }),
      sideEffect: "sandbox_file",
      async execute(input, ctx) {
        const src = safeResolvePath(ctx.workdir, input.src);
        const dest = safeResolvePath(ctx.workdir, input.dest);
        const archive = await createZipArchive({ src, dest });
        await enforceBudget(ctx);
        return okToolResult(`archived ${input.src} to ${input.dest}`, { data: archive });
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
