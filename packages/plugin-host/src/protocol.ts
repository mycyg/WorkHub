/**
 * 插件宿主子进程 ↔ apps/api 的 stdio 线协议（newline-delimited JSON-RPC，方案 B'）。
 *
 * 只有两个请求方法：`list_tools`（握手后拉一次插件贡献的工具清单）与 `call_tool`
 * （一次工具调用）。故意不做「插件回调主进程」的反向通道——插件宿主只提供**能力实现**，
 * 不提供**授权**：canUse / 快照门 / human-reserved / 审批全部留在主进程侧。
 *
 * 帧格式：一行一个 JSON 对象，`\n` 分隔，UTF-8。选 newline-delimited 而不是
 * Content-Length 分帧，是因为两端都在 Node 里、消息都是小对象，行分隔可读性更好、
 * 调试时能直接 `cat`。插件自己往 stdout 打印的内容会污染这条流，所以宿主进程启动时
 * 会先把 `process.stdout.write` 劫持到 stderr（见 host.ts），只有 RPC writer 用原始句柄。
 */

/**
 * 线协议版本。两端不一致时握手直接失败，不做「尽力兼容」。
 *
 * 2（R26 X）：`PluginToolDescriptor` 增 `selfReportedReadOnly`。做成必填 + 版本号推进，
 * 而不是「可选字段，缺了当 false」：缺了当 false 会让一台过期宿主把整个部署静默降级成
 * 「每次插件调用都转人」，看起来像功能坏了却没有任何解释；握手直接失败至少说得清是什么。
 */
export const PLUGIN_HOST_PROTOCOL_VERSION = 2;

/** 插件工具在线上的描述符——函数过不了 JSON，只能传结构。 */
export type PluginToolDescriptor = {
  /** 贡献这个工具的插件 id（本地路径安装时取包名）。 */
  pluginId: string;
  /** 插件自报的工具名（dsh `defineTool` 的 `name`）。 */
  toolName: string;
  /** WorkHub 侧的工具 id：`plugin__<pluginId>__<toolName>`，与内置工具名字空间隔离。 */
  toolId: string;
  /** 喂给模型的能力说明。 */
  description: string;
  /** dsh 侧已经转好的 JSON Schema（dsh 工具没有 Zod，走 ToolSpec.jsonSchema 旁路）。 */
  jsonSchema: Record<string, unknown>;
  /**
   * 工具**自述**是否只读。真值表见 `to-tool-spec.ts`：它只在管理员把这个插件断言成
   * `read_only` 时才有意义，且只能**降**风险——插件永远不能靠自述抬权限。
   *
   * 判据是 `translate.ts` 的 `readsAsReadOnly()`：dsh `defineTool` 在
   * `@deepseek-ai/dsh-tools@0.1.0-rc.8` 上**没有**只读自述字段（它按白名单归一化，
   * 作者写的额外键会被丢掉），所以这个信号来自 `ctx.tools.register()` 收到的定义对象上的
   * `readOnlyHint === true`——那是宿主自己的 service 面，作者要显式声明就得
   * `register({ ...defineTool({...}), readOnlyHint: true })`。没写就是 false（最高风险）。
   */
  selfReportedReadOnly: boolean;
  /** 插件声明的单次调用超时（毫秒）；缺省由客户端兜底。 */
  timeoutMs?: number;
};

/** 一个插件的加载结果——失败的也要报上来，好在设置页/日志里说清哪装不上。 */
export type PluginLoadReport = {
  pluginId: string;
  path: string;
  ok: boolean;
  toolCount: number;
  /** 插件贡献的系统提示词段（阶段 0 只收集不使用，见 Agent Note 的 Consequences）。 */
  promptSectionCount: number;
  error?: string;
};

export type ListToolsResult = {
  protocolVersion: number;
  tools: PluginToolDescriptor[];
  plugins: PluginLoadReport[];
};

export type CallToolResult = {
  ok: boolean;
  /** 模型可见文本：dsh `output.render(args, value)` 的 text 块拼接。 */
  content: string;
  /** dsh `execute` 返回的规范 JSON 值，原样带回（进 ToolResult.data）。 */
  data?: unknown;
  /** 毫秒耗时，进审计。 */
  durationMs: number;
};

export type PluginHostRequest =
  | { id: number; method: "list_tools"; params?: Record<string, never> }
  | { id: number; method: "call_tool"; params: { toolId: string; input: unknown } };

export type PluginHostResponse =
  | { id: number; ok: true; result: ListToolsResult | CallToolResult }
  | { id: number; ok: false; error: { code: string; message: string } };

/** 把一帧编码成一行（内嵌换行由 JSON 转义保证不会破帧）。 */
export function encodeFrame(message: PluginHostRequest | PluginHostResponse): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * 增量行解析器：喂进任意切分的 chunk，吐出解析好的帧。
 * 非 JSON 的行（插件漏打到 stdout 的噪声、宿主启动前的 banner）直接丢弃并计数，
 * 不让一行脏数据把整条流带崩。
 */
export function createFrameDecoder<T>() {
  let buffer = "";
  let dropped = 0;
  return {
    push(chunk: string): T[] {
      buffer += chunk;
      const frames: T[] = [];
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length > 0) {
          try {
            frames.push(JSON.parse(line) as T);
          } catch {
            dropped += 1;
          }
        }
        index = buffer.indexOf("\n");
      }
      return frames;
    },
    /** 被丢弃的坏行数——诊断用，正常应恒为 0。 */
    droppedLines() {
      return dropped;
    },
    /** 尚未成帧的残留（进程退出时用来解释「话说了一半」）。 */
    pending() {
      return buffer;
    }
  };
}
