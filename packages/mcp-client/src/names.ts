/**
 * MCP 工具名的命名空间与不变式（M-MCP 设计稿 4.2「逐字段映射表」前两行）。
 *
 * 一条不变式压倒其它所有考虑：**两台不同 MCP 服务器的两个不同工具，公开名永不坍缩。**
 * 跨服务器重名是常态而非意外（设计稿 2.6 引的调查里，1470 台服务器出现 775 个重名工具，
 * 光 `search` 一个名字就出现在 32 台上）。一旦坍缩，模型以为在调 A 服务器的 `search`，
 * 实际打到 B 服务器上——这不是显示问题，是把调用送错了目的地。
 *
 * 名字预算的算术要摆在明处：`mcp__`(5) + 服务器名(≤32) + `__`(2) = 最多 39，
 * 64 的总预算只剩 25 给服务器自己的工具名。真实服务器的工具名（`create_pull_request` = 19、
 * `search_repositories` = 19）大多刚好塞得下，但服务器名一长就会批量挂指纹后缀、名字变得没法读。
 * `mcpToolNameBudget` 就是给设置页做实时预览用的，让人在填名字时就被推向 `gh`、`fs` 这种短名。
 *
 * 上限 64 = DeepSeek 函数名约定与 Anthropic `^[a-zA-Z0-9_-]{1,128}$` 的交集
 * （WorkHub 走 DeepSeek 的 /anthropic 兼容端点，`packages/config/src/providers.ts`）。
 *
 * 本模块零 IO：`node:crypto` 的 `createHash` 是纯计算，不碰文件、不碰网络。
 */
import { createHash } from "node:crypto";

/** 公开工具名前缀。与内置工具（read_file / run_command / load_skill…）名字空间彻底隔开。 */
export const MCP_TOOL_ID_PREFIX = "mcp__";

/** 服务器名上限。它是模型可见工具名的一部分，短名才有可读性。 */
export const MCP_SERVER_NAME_MAX_CHARS = 32;

/** 服务器名形状：只收 `[A-Za-z0-9_-]`，因为它要原样进模型 API 的 tool name。 */
export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;

/** 公开工具名总长上限。 */
export const MCP_TOOL_ID_MAX_CHARS = 64;

/** 有损改名时追加的指纹长度（SHA-256 前 12 位十六进制）。 */
export const MCP_TOOL_NAME_FINGERPRINT_CHARS = 12;

/** 指纹与名字主体之间的分隔符。连同指纹一共 13 个字符，要从预算里扣掉。 */
const FINGERPRINT_SEPARATOR = "_";

/** 服务器名是否合法。治理层用它拒掉不合形状的名字，`publicToolName` 不依赖这一层。 */
export function isValidMcpServerName(value: string): boolean {
  return MCP_SERVER_NAME_PATTERN.test(value);
}

/**
 * 把一段名字压成模型 API 收得下的字符集。
 *
 * 与 `plugin-host/src/translate.ts` 的 `sanitizeToolNameSegment` **刻意不共享**：那边压完就完事
 * （插件 id 由我们自己登记，不会撞），这边压完必须补指纹（MCP 工具名由第三方给，`a.b` 与 `a_b`
 * 压完是同一个串）。强行合并会造出一个带开关的四不像。
 */
export function sanitizeMcpNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_");
}

/**
 * 一个工具身份的指纹：SHA-256(`<服务器名>\0<原始工具名>`) 的前 12 位十六进制。
 *
 * 用 NUL 分隔而不是别的字符：服务器名与原始工具名都可能含 `_`/`-`/`.`，用可打印分隔符会让
 * (`a_b`, `c`) 与 (`a`, `b_c`) 指纹相同。NUL 不会出现在任何一个合法名字里。
 * **喂进哈希的是原始输入，不是压缩后的串**——否则两个压完相同的名字会得到相同指纹，
 * 指纹就白加了。
 */
export function mcpToolNameFingerprint(serverName: string, rawName: string): string {
  return createHash("sha256")
    .update(`${serverName}\u0000${rawName}`, "utf8")
    .digest("hex")
    .slice(0, MCP_TOOL_NAME_FINGERPRINT_CHARS);
}

/**
 * 模型看到的公开工具名：`mcp__<服务器名>__<工具名>`。
 *
 * **只有在改名有损时才挂指纹**（字符被压过，或总长超了 64）。干净且够短的名字原样保留——
 * 给每个名字都挂指纹会让 `mcp__gh__create_issue` 变成 `mcp__gh__create_issue_1a2b3c4d5e6f`，
 * 白白吃掉预算、也让人对不上服务器文档里的名字。
 *
 * 反方向**不提供**：原始工具名只在 `tools/call` 的线上用，公开名从不反解。
 * 反解需要「压缩/截断可逆」，而这两件事本来就不可逆；留一个假装能反解的函数，
 * 早晚会有人拿它去拼一次真实调用。原始名请从描述符里取。
 */
export function publicToolName(serverName: string, rawName: string): string {
  if (serverName.length === 0 || rawName.length === 0) {
    throw new Error("mcp tool name segments must not be empty");
  }
  const server = sanitizeMcpNameSegment(serverName);
  const raw = sanitizeMcpNameSegment(rawName);
  const exact = `${MCP_TOOL_ID_PREFIX}${server}__${raw}`;
  const lossless = server === serverName && raw === rawName;
  if (lossless && exact.length <= MCP_TOOL_ID_MAX_CHARS) {
    return exact;
  }
  const suffix = `${FINGERPRINT_SEPARATOR}${mcpToolNameFingerprint(serverName, rawName)}`;
  // 服务器名段也要夹到上限内：治理层拦得住 32 字符，但这个函数拿到的可能是任何字符串，
  // 而「结果永远 ≤ 64」是调用方（模型 API）依赖的硬保证。夹短不会造成坍缩——指纹认的是原始输入。
  const head = `${MCP_TOOL_ID_PREFIX}${server.slice(0, MCP_SERVER_NAME_MAX_CHARS)}__`;
  const room = MCP_TOOL_ID_MAX_CHARS - head.length - suffix.length;
  const body = room > 0 ? raw.slice(0, room) : "";
  return `${head}${body}${suffix}`;
}

/** 这个工具 id 属于 MCP 名字空间吗。用于装配处断言与内置工具不相交。 */
export function isMcpToolId(toolId: string): boolean {
  return toolId.startsWith(MCP_TOOL_ID_PREFIX);
}

/** 设置页填名字时的实时预览：前缀长什么样、还剩多少字符给服务器自己的工具名。 */
export function mcpToolNameBudget(serverName: string): {
  prefix: string;
  /** 不挂指纹时，工具名还能有多长。 */
  maxToolNameChars: number;
  /** 挂了指纹之后（名字含非法字符或过长时）还剩多长。 */
  maxToolNameCharsWithFingerprint: number;
} {
  const prefix = `${MCP_TOOL_ID_PREFIX}${sanitizeMcpNameSegment(serverName).slice(0, MCP_SERVER_NAME_MAX_CHARS)}__`;
  const fingerprintCost = FINGERPRINT_SEPARATOR.length + MCP_TOOL_NAME_FINGERPRINT_CHARS;
  return {
    prefix,
    maxToolNameChars: Math.max(0, MCP_TOOL_ID_MAX_CHARS - prefix.length),
    maxToolNameCharsWithFingerprint: Math.max(0, MCP_TOOL_ID_MAX_CHARS - prefix.length - fingerprintCost)
  };
}

/** 一份工具清单翻名字时的失败原因。整份清单不可用，不是某一个工具的问题。 */
export type McpToolNameAssignmentError =
  | { reason: "duplicate_raw_name"; detail: string }
  | { reason: "public_name_collision"; detail: string };

export type McpToolNameAssignment =
  | { ok: true; names: { rawName: string; toolId: string }[] }
  | ({ ok: false } & McpToolNameAssignmentError);

/**
 * 给一台服务器的整份 `tools/list` 分配公开名。
 *
 * 两条整代（整份清单）级别的判定，不是逐工具的：
 * - **raw 名重复**：服务器给了两个同名工具，这份清单本身无效。取第一个会让另一个静默消失，
 *   而消失的那个可能正是模型要用的——整份丢掉、把服务器标成连不上，比留半套可解释。
 * - **公开名坍缩**：指纹在数学上已经堵死了，这里是断言不是逻辑。它要是响了，说明命名规则被改坏了，
 *   而这条正是「调用送错目的地」的入口，宁可整代拒绝也不要带病上线。
 */
export function assignPublicToolNames(serverName: string, rawNames: readonly string[]): McpToolNameAssignment {
  const seenRaw = new Set<string>();
  const seenPublic = new Map<string, string>();
  const names: { rawName: string; toolId: string }[] = [];
  for (const rawName of rawNames) {
    if (seenRaw.has(rawName)) {
      return { ok: false, reason: "duplicate_raw_name", detail: `tool name listed twice: ${rawName}` };
    }
    seenRaw.add(rawName);
    const toolId = publicToolName(serverName, rawName);
    const previous = seenPublic.get(toolId);
    if (previous !== undefined) {
      return {
        ok: false,
        reason: "public_name_collision",
        detail: `${previous} and ${rawName} both map to ${toolId}`
      };
    }
    seenPublic.set(toolId, rawName);
    names.push({ rawName, toolId });
  }
  return { ok: true, names };
}

/**
 * 把一个工具 id 切成词——与 `apps/api/src/services/human-reserved-guard.ts` 的 `toolIdTokens`
 * 同一口径的**镜像**。
 *
 * 为什么要有这份镜像：人工保留门按工具 id 的词判高风险类，而 MCP 的公开名里**服务器名也参与分词**。
 * 一台叫 `finance` 的服务器，它的每个工具都会被归到财务类，每次调用都停下来转人。
 * 这是设计属性（管理员给服务器起名等于给它打风险标签），但必须在添加服务器的界面上先说明白，
 * 否则一台叫 `publish` 的服务器会让所有工具无差别升级，用户只会以为坏了。
 *
 * **权威实现在 apps/api 那一侧，这里只做预告。** 两者不一致时以那边为准——它才是门，这里只是提示。
 * 词表本身刻意不复制到本包：`mcpServerNameRiskTokens` 让调用方把真词表传进来，
 * 从根上没有「两份词表漂移」这回事。
 */
export function mcpToolIdTokens(toolId: string): string[] {
  return toolId
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

/**
 * 这个服务器名里有哪些词会让它的**每一个**工具都被判成高风险。
 * `riskTokens` 由调用方给（apps/api 侧的真词表），本包不留副本。
 */
export function mcpServerNameRiskTokens(serverName: string, riskTokens: readonly string[]): string[] {
  const tokens = new Set(mcpToolIdTokens(serverName));
  return riskTokens.filter((token) => tokens.has(token));
}
