/**
 * 插件宿主子进程入口（方案 B'：适配壳 + 子进程宿主）。
 *
 * 这个进程里跑第三方代码，所以它**没有** PG/Redis 连接、没有 LLM key、没有工作区身份——
 * env 由主进程按白名单组装（见 env.ts）。它只做三件事：
 *   1. 起一个最小 Cordis Context，提供 dsh 插件用到的 `ctx.tools` / `ctx.systemPrompt` service；
 *   2. 从 `WORKHUB_PLUGIN_PATHS`（逗号分隔的**本地路径**）加载插件；
 *   3. 在 stdin/stdout 上跑 newline-delimited JSON-RPC，应答 `list_tools` / `call_tool`。
 *
 * 为什么不把 Cordis 装进 apps/api：`apps/api` 进程里有整套多租户围栏与凭据，
 * 加载第三方 JS 等于把它们交出去（dsh 自己的 SAFETY.md 就写明插件可以泄露凭据）。
 * 进程边界同时把 GPL 插件的链接争议解掉（进程分离 + 明确 wire 协议）。
 *
 * stdout 纪律：插件随手 `console.log` 会污染 RPC 流，所以启动第一件事是把
 * `process.stdout.write` 改道到 stderr，只有本文件的 writer 持有原始句柄。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Context, Service } from "@deepseek-ai/cordis";

import { parsePluginPaths } from "./env.js";
import {
  encodeFrame,
  createFrameDecoder,
  PLUGIN_HOST_PROTOCOL_VERSION,
  type CallToolResult,
  type ListToolsResult,
  type PluginHostRequest,
  type PluginHostResponse,
  type PluginLoadReport,
  type PluginToolDescriptor
} from "./protocol.js";
import { describePluginTool, renderToolContent, type DshToolDefinition } from "./translate.js";

/** 插件贡献的系统提示词段。阶段 0 只收集，不进 WorkHub 的提示词（见 to-tool-spec.ts 的口径）。 */
export type PromptSection = { name: string; order?: number; text: string };

type RegisteredTool = { pluginId: string; definition: DshToolDefinition };

/**
 * 宿主共享状态。故意放在 Context 之外的普通对象里：Cordis 的 `ctx.tools` 是代理，
 * 读写它的自有属性要依赖代理语义；宿主自己的簿记走这个对象，只有插件真正会碰的
 * `register()` / `section()` 才经过代理，出问题的面最小。
 */
export type PluginHostState = {
  currentPluginId: string;
  tools: Map<string, RegisteredTool>;
  sections: { pluginId: string; section: PromptSection }[];
};

export function createPluginHostState(): PluginHostState {
  return { currentPluginId: "unknown", tools: new Map(), sections: [] };
}

/**
 * `ctx.tools`——dsh 工具型插件的主战场。只实现 `register`：dsh 真实 service 还有 waterfall
 * 事件、guard、并发分组，那些是 dsh 自己 loop 的内部机制；我们的 loop 有另一套等价治理
 * （快照门 / human-reserved / 审批），不在这里重造。
 */
export class HostToolsService extends Service {
  constructor(ctx: Context, private readonly state: PluginHostState) {
    super(ctx, "tools");
  }

  register(definition: DshToolDefinition) {
    if (!definition || typeof definition.name !== "string" || definition.name.length === 0) {
      throw new Error("ctx.tools.register(): tool definition needs a name");
    }
    if (typeof definition.execute !== "function") {
      throw new Error(`ctx.tools.register(${definition.name}): tool definition needs an execute()`);
    }
    const pluginId = this.state.currentPluginId;
    const key = `${pluginId}::${definition.name}`;
    if (this.state.tools.has(key)) {
      throw new Error(`ctx.tools.register(${definition.name}): duplicate tool name in plugin ${pluginId}`);
    }
    this.state.tools.set(key, { pluginId, definition });
    // Cordis 的「注册即效果」语义：插件卸载时自动摘掉它注册的工具。
    this.ctx.effect(() => () => {
      this.state.tools.delete(key);
    }, `tools.register(${definition.name})`);
    return definition;
  }

  /** dsh 插件偶尔会先探一眼已有工具；给只读视图，不给可变引用。 */
  list() {
    return [...this.state.tools.values()].map((entry) => entry.definition);
  }
}

/** `ctx.systemPrompt`——只收集 section，够 dsh 工具型插件跑通 apply()。 */
export class HostSystemPromptService extends Service {
  constructor(ctx: Context, private readonly state: PluginHostState) {
    super(ctx, "systemPrompt");
  }

  section(section: PromptSection) {
    const entry = { pluginId: this.state.currentPluginId, section };
    this.state.sections.push(entry);
    return () => {
      const index = this.state.sections.indexOf(entry);
      if (index >= 0) {
        this.state.sections.splice(index, 1);
      }
    };
  }
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 从本地目录读 `package.json`，解析出插件 id 与入口文件。
 * 只认本地路径：npm 包名 / git url / tarball 在 `parsePluginPaths` 就被拒了。
 */
export async function resolvePluginEntry(pluginPath: string) {
  const dir = path.resolve(pluginPath);
  const manifestPath = path.join(dir, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    name?: string;
    main?: string;
    exports?: unknown;
  };
  const pluginId = typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : path.basename(dir);
  return { pluginId, dir, entryPath: path.join(dir, resolveEntryFromManifest(manifest)) };
}

function resolveEntryFromManifest(manifest: { main?: string; exports?: unknown }): string {
  const exportsField = manifest.exports;
  if (typeof exportsField === "string") {
    return exportsField;
  }
  if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    const root = (exportsField as Record<string, unknown>)["."];
    if (typeof root === "string") {
      return root;
    }
    if (root && typeof root === "object" && !Array.isArray(root)) {
      const conditions = root as Record<string, unknown>;
      for (const key of ["import", "default", "require"]) {
        const value = conditions[key];
        if (typeof value === "string") {
          return value;
        }
      }
    }
  }
  return typeof manifest.main === "string" && manifest.main.length > 0 ? manifest.main : "index.js";
}

/**
 * 归一化插件模块的三种形态（dsh `docs/user/develop/basic/index.md`）：
 * 函数模块 / `{name, inject, apply}` 对象默认导出 / 命名导出 `apply`（真实插件
 * `dsh-plugin-finance-data` 就是第三种）。class 形态（插件自己 provide service）阶段 0 不支持——
 * 我们没有给它可 provide 的 service 面，装上去只会静默失效，不如直接报错。
 */
export function normalizePluginModule(module: Record<string, unknown>) {
  const fallback = module["default"];
  if (typeof fallback === "function") {
    return fallback;
  }
  if (fallback && typeof fallback === "object" && typeof (fallback as { apply?: unknown }).apply === "function") {
    return fallback;
  }
  if (typeof module["apply"] === "function") {
    return {
      ...(typeof module["name"] === "string" ? { name: module["name"] } : {}),
      ...(module["inject"] !== undefined ? { inject: module["inject"] } : {}),
      ...(module["Config"] !== undefined ? { Config: module["Config"] } : {}),
      apply: module["apply"]
    };
  }
  throw new Error("plugin module exports neither a function, an { apply } object, nor a named apply export");
}

export type PluginHostRuntime = {
  listTools: () => ListToolsResult;
  callTool: (toolId: string, input: unknown) => Promise<CallToolResult>;
};

/**
 * 起 Context、装插件，返回 RPC 能直接用的 runtime。
 * 单个插件加载失败**不影响**其它插件——错误落进它自己的 report，主进程据此把它标为不可用。
 */
export async function createPluginHostRuntime(pluginPaths: string[]): Promise<PluginHostRuntime> {
  const state = createPluginHostState();
  // Cordis 的 `plugin()` 类型面按「插件自带 Config 推导」设计，我们这里装的是自定义 service 类与
  // 运行时才知道形状的第三方模块，两者都推不出静态 config 类型——统一收窄到一个最小签名，
  // 而不是在每个调用点撒 `as never`（那会把参数个数校验也一并关掉）。
  const ctx = new Context() as Context & { plugin: (plugin: unknown, config?: unknown) => PromiseLike<unknown> };
  await ctx.plugin(HostToolsService, state);
  await ctx.plugin(HostSystemPromptService, state);
  const reports: PluginLoadReport[] = [];

  for (const pluginPath of pluginPaths) {
    let pluginId = pluginPath;
    const toolsBefore = state.tools.size;
    const sectionsBefore = state.sections.length;
    try {
      const resolved = await resolvePluginEntry(pluginPath);
      pluginId = resolved.pluginId;
      state.currentPluginId = pluginId;
      const module = (await import(pathToFileURL(resolved.entryPath).href)) as Record<string, unknown>;
      const plugin = normalizePluginModule(module);
      await ctx.plugin(plugin);
      reports.push({
        pluginId,
        path: pluginPath,
        ok: true,
        toolCount: state.tools.size - toolsBefore,
        promptSectionCount: state.sections.length - sectionsBefore
      });
    } catch (error) {
      reports.push({
        pluginId,
        path: pluginPath,
        ok: false,
        toolCount: 0,
        promptSectionCount: 0,
        error: readErrorMessage(error)
      });
    } finally {
      state.currentPluginId = "unknown";
    }
  }

  const byToolId = new Map<string, RegisteredTool>();
  const descriptors: PluginToolDescriptor[] = [];
  for (const entry of state.tools.values()) {
    const descriptor = describePluginTool(entry.pluginId, entry.definition);
    if (byToolId.has(descriptor.toolId)) {
      // 两个插件的工具名压成同一个 id（名字里的非法字符被统一替换后可能撞车）。
      // 先到先得，后来的直接不上线，而不是让调用随机落到其中一个。
      continue;
    }
    byToolId.set(descriptor.toolId, entry);
    descriptors.push(descriptor);
  }

  function listTools(): ListToolsResult {
    return { protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION, tools: descriptors, plugins: reports };
  }

  async function callTool(toolId: string, input: unknown): Promise<CallToolResult> {
    const entry = byToolId.get(toolId);
    if (!entry) {
      throw new Error(`unknown plugin tool: ${toolId}`);
    }
    const args = (input ?? {}) as Record<string, unknown>;
    const startedAt = Date.now();
    // dsh 的 ToolRunContext 在阶段 0 给一个最小对象：插件宿主没有会话/嵌套/审批身份可给，
    // 需要那些的插件会自己抛错，我们把错误如实回给主进程，而不是伪造一份假身份。
    const value = await entry.definition.execute(args, { toolId, callId: `${toolId}:${startedAt}` });
    return {
      ok: true,
      content: renderToolContent(entry.definition, args, value),
      data: value,
      durationMs: Date.now() - startedAt
    };
  }

  return { listTools, callTool };
}

/**
 * stdio JSON-RPC 服务端。返回一个 stop()，测试里可以直接关掉。
 * `write` 注入的是**原始** stdout 句柄（劫持前捕获），插件的 console.log 走不到这里。
 */
export function serveStdio(
  runtime: PluginHostRuntime,
  input: NodeJS.ReadableStream,
  write: (chunk: string) => void
) {
  const decoder = createFrameDecoder<PluginHostRequest>();
  const onData = (chunk: Buffer | string) => {
    for (const request of decoder.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"))) {
      void handle(request);
    }
  };

  async function handle(request: PluginHostRequest) {
    const respond = (response: PluginHostResponse) => write(encodeFrame(response));
    try {
      if (request.method === "list_tools") {
        respond({ id: request.id, ok: true, result: runtime.listTools() });
        return;
      }
      if (request.method === "call_tool") {
        respond({ id: request.id, ok: true, result: await runtime.callTool(request.params.toolId, request.params.input) });
        return;
      }
      const unknown = request as { id: number; method: string };
      respond({
        id: unknown.id,
        ok: false,
        error: { code: "unknown_method", message: `unknown method: ${unknown.method}` }
      });
    } catch (error) {
      respond({ id: request.id, ok: false, error: { code: "plugin_tool_failed", message: readErrorMessage(error) } });
    }
  }

  input.on("data", onData);
  return () => {
    input.off("data", onData);
  };
}

/** 进程入口：劫持 stdout → stderr，装插件，跑 RPC 循环。 */
async function main() {
  const rawWrite = process.stdout.write.bind(process.stdout);
  // 插件（和它依赖的库）往 stdout 打的任何东西都改道 stderr，否则会插进 RPC 帧中间。
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
    (process.stderr.write as (...args: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;

  const pluginPaths = parsePluginPaths(process.env.WORKHUB_PLUGIN_PATHS);
  const runtime = await createPluginHostRuntime(pluginPaths);
  process.stdin.setEncoding("utf8");
  serveStdio(runtime, process.stdin, rawWrite);
  // 主进程关掉 stdin 就是「优雅收尾」的信号。
  process.stdin.on("end", () => {
    process.exit(0);
  });
}

// 只有被当作进程入口跑时才启动 RPC 循环；被单测 import 时不启动。
if (process.env.WORKHUB_PLUGIN_HOST_ENTRY === "1") {
  main().catch((error) => {
    process.stderr.write(`plugin-host failed to start: ${readErrorMessage(error)}\n`);
    process.exit(1);
  });
}
