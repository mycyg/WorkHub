import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

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

async function createZipArchive(input: { src: string; dest: string; ctx: ToolExecutionContext }) {
  const srcStat = await stat(input.src);
  const root = srcStat.isDirectory() ? input.src : path.dirname(input.src);
  const entries = await collectZipEntries(root, input.src, path.resolve(input.dest));
  if (entries.length === 0) {
    throw new Error("zip_path source has no files to archive");
  }
  const archive = createStoredZip(entries);
  // R4 #39：写盘前先校验归档体积在沙箱字节预算内（与 write_file 的 assertWriteWithinBudget 同口径），
  // 否则巨型归档会先落满主机磁盘、事后的 enforceBudget 才报错——损害已造成。
  assertWriteWithinBudget(input.ctx, archive.length);
  await mkdir(path.dirname(input.dest), { recursive: true });
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
        // 读上限：沙箱文件可达 maxBytes(默认 200MB)，且 run_command 能廉价造大文件。
        // 整文件塞回 tool-result→agent loop/LLM context 会撑爆 agent 宿主内存或炸 context/成本。
        // 超过 cap 只读前 cap 字节并标 [truncated]（这是唯一没有预算约束的 ingest 路径）。
        const READ_FILE_MAX_BYTES = 2 * 1024 * 1024;
        const info = await stat(target);
        if (info.size > READ_FILE_MAX_BYTES) {
          const handle = await open(target, "r");
          try {
            const buffer = Buffer.alloc(READ_FILE_MAX_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, READ_FILE_MAX_BYTES, 0);
            // findings[#low]：直接 toString('utf8') 会把跨越 cap 边界的半个多字节字符
            // 解成 U+FFFD（）。StringDecoder.write 只吐完整字符、扣下尾部不完整序列
            // （文件本就被截断，扣掉正合适）。
            const head = new StringDecoder("utf8").write(buffer.subarray(0, bytesRead));
            return okToolResult(
              `${head}\n[truncated: 文件 ${info.size} 字节，仅读取前 ${READ_FILE_MAX_BYTES} 字节]`
            );
          } finally {
            await handle.close();
          }
        }
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
        // 沙箱逃逸 fail-closed：run_command 跑的是白名单解释器（python3/node/…），cwd 在 workdir 但**进程不隔离**
        // ——无 chroot/namespace/seccomp，PATH 是宿主 PATH。未注入受控 runner 时底层会回退到无约束的
        // nodeCommandRunner，可读写宿主任意路径（已 live 验证可读 /etc/hosts），击穿 safeResolvePath 这层防护。
        // 因此默认拒绝执行；部署方必须显式注入一个隔离 runner（或在受信本地环境显式注入 nodeCommandRunner 作为 opt-in）。
        if (!ctx.commandRunner) {
          return errorToolResult(
            "run_command 已禁用：当前部署没有配置受控命令执行器（沙箱）。需要由部署方注入隔离的 commandRunner 后才能运行命令。"
          );
        }
        const budget = ctx.sandboxBudget ?? defaultSandboxBudget;
        const timeoutSeconds = input.timeout_s ?? budget.commandTimeoutSeconds;
        const result = await runSandboxedCommand({
          args: input.args,
          cwd: input.cwd,
          workdir: ctx.workdir,
          timeoutSeconds,
          runner: ctx.commandRunner
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
        // R4 #39：先确认沙箱当前未超盘预算，再读整棵树/建归档——避免「已超预算还把整树读进内存+落盘」。
        await enforceBudget(ctx);
        const archive = await createZipArchive({ src, dest, ctx });
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
