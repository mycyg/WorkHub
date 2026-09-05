// WorkHub 桌面 · Spotlight「设置」的「MCP 服务器」分区（R26 工包 M7）。
//
// 为什么这块只在桌面端：要填的是**跑着 API 的那台机器**上的一条启动命令与一个工作目录。
// 在网页里让人凭空写一条服务器命令既说不清也验不了——与插件安装入口只在桌面端是同一条理由
// （见 settings.ts 顶部「R24-P 阶段 1」那段注释）。网页只渲只读清单。
//
// 为什么单独一个文件而不是继续堆进 settings.ts：这一分区的纯渲染面（状态行 / 错误码人话 /
// 添加表单 / 工具名预览）本身就有十来个可独立证伪的判定，堆进那个已经 2400 行的文件里，
// 单测就只能从整份 innerHTML 里捞正则。有状态的那半（拉清单、发动作、两段式确认）仍然住在
// createSettingsView 的闭包里——那是既有架构，不在这一批里改。
//
// 文案纪律：本文件**一个中文字面量都没有**，全部走 ./locales.js（门禁 scripts/dev/check-ui-i18n.ts）。
// 带值的句子在词典里留 `{name}` 占位符，值在这里填（同 apps/api/src/services/mcp-servers-copy.ts 的口径）。

import type {
  McpServerConnectionVM,
  McpServerErrorCode,
  McpServerTrustLevel,
  McpServerVM
} from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { withErrorDetail } from "../../load-state-copy.js";
import { spotlightViewsT, type SpotlightViewsCopyKey } from "./locales.js";

/**
 * 工具名预览的三个常量与 `@workhub/mcp-client` 的 `names.ts` 逐字对齐，但**刻意不 import 那个包**：
 * ① 它不是 desktop-webview 的依赖，加依赖要动 package.json 与 lockfile（不在本工包范围）；
 * ② 它的 `names.ts` 顶层 `import { createHash } from "node:crypto"`，进浏览器包会在打包期就炸——
 *    一个纯展示用的字符数预览不值得为它把 node 内置模块拖进 webview 的模块图。
 * 这三个值一旦在那边改了，这里的预览会说错话；`settings-mcp.test.ts` 里有一条把三个常量写死的
 * 断言，改那边就会想起改这边。
 */
export const MCP_TOOL_ID_PREFIX = "mcp__";
export const MCP_SERVER_NAME_MAX_CHARS = 32;
export const MCP_TOOL_ID_MAX_CHARS = 64;

/** 把一段名字压成模型 API 收得下的字符集（同 `sanitizeMcpNameSegment`）。 */
function sanitizeNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_");
}

/** 词典里 `{key}` 占位符的填值。词典条目保持纯字符串，才撑得住 `satisfies` 那条编译期对齐。 */
function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/**
 * 填名字时的实时预览：工具名会长成什么样、还剩多少字符给服务器自己的工具名。
 *
 * 这不是装饰。算术是 `mcp__`(5) + 名字(≤32) + `__`(2) = 最多 39 字符，64 的预算只剩 25 给
 * 服务器自己的工具名；超了就会挂指纹后缀变得难认。预览会自然把人推向 `gh`、`fs` 这种短名。
 */
export function mcpToolNamePreview(serverName: string, zh: boolean): string | undefined {
  const trimmed = serverName.trim();
  if (!trimmed) {
    return undefined;
  }
  const prefix = `${MCP_TOOL_ID_PREFIX}${sanitizeNameSegment(trimmed).slice(0, MCP_SERVER_NAME_MAX_CHARS)}__`;
  const room = Math.max(0, MCP_TOOL_ID_MAX_CHARS - prefix.length);
  return fill(spotlightViewsT(zh, "mcpToolNamePrefixHint"), { prefix, chars: String(room) });
}

/** 「N 个工具」——英文的单复数是语法不是逻辑，故拆成两条词典条目而不是在句子里拼 `s`。 */
export function mcpToolCountText(count: number, zh: boolean): string {
  return count === 1
    ? spotlightViewsT(zh, "mcpToolCountOne")
    : fill(spotlightViewsT(zh, "mcpToolCountMany"), { count: String(count) });
}

/**
 * 状态行。三种说法直接对应契约里的三个 status，外加一条只有连接快照才知道的事实：
 * 空闲回收把子进程收掉之后 `live=false` 而 `status` 仍是 `connected`——这不是矛盾，
 * 下一次用到它会重新握手。把两件事挤进一句话，就只能在「刚回收过」和「连不上」之间二选一地说错话。
 */
export function mcpStatusLine(server: McpServerVM, connection: McpServerConnectionVM | undefined, zh: boolean): string {
  if (!server.enabled || server.status === "disabled") {
    return spotlightViewsT(zh, "disabled");
  }
  if (server.status === "connect_failed") {
    return spotlightViewsT(zh, "mcpConnectFailed");
  }
  const toolCount = connection?.tool_count ?? server.tool_count;
  const head = connection?.live === true
    ? spotlightViewsT(zh, "mcpConnected")
    : spotlightViewsT(zh, "mcpConnectedIdle");
  return `${head} · ${mcpToolCountText(toolCount, zh)}`;
}

/**
 * 连接/会话失败的**稳定错误码** → 一句人话。
 *
 * 全表覆盖 `mcpServerErrorCodeSchema` 的九条码（`satisfies` 保证契约新增一条码时这里编译不过，
 * 而不是悄悄落到兜底句上）。句子与网页只读清单逐字同句，同一台服务器在两端只有一种说法。
 *
 * `mcp_connect_failed` 是「这次说不出原因」的兜底码，它的那一句就是既有的通用句——不为它编一个
 * 更具体的原因。**绝不解析 `last_error` 里的英文诊断串**：那是给人看的现场信息（stderr 尾巴、
 * 命令路径、失败次数），照着它切字符串会在下一次改措辞时把中文界面变成半截英文。
 */
const MCP_ERROR_CODE_COPY = {
  mcp_spawn_failed: "mcpFailSpawn",
  mcp_handshake_timeout: "mcpFailHandshakeTimeout",
  mcp_protocol_version_unsupported: "mcpFailProtocolVersion",
  mcp_protocol_error: "mcpFailProtocol",
  mcp_server_error: "mcpFailServerError",
  mcp_call_timeout: "mcpFailCallTimeout",
  mcp_not_running: "mcpFailNotRunning",
  mcp_exited: "mcpFailExited",
  mcp_connect_failed: "mcpConnectFailedHint"
} as const satisfies Record<McpServerErrorCode, SpotlightViewsCopyKey>;

export function mcpErrorCodeLine(code: McpServerErrorCode | undefined, zh: boolean): string | undefined {
  return code === undefined ? undefined : spotlightViewsT(zh, MCP_ERROR_CODE_COPY[code]);
}

/**
 * 状态行之下的补充说明：为什么连不上 / 为什么不再自动重连 / 连上了却一个工具都没有。
 *
 * 「为什么连不上」优先按 `last_error_code` 出人话（R26 M8 才把码带到读形状上；在那之前这里只能
 * 落回通用的一句）。码**可能缺席**——行上有诊断、这个进程却不记得那次失败时（重启之后）就没有码，
 * 那时仍然说通用的那一句，而不是编一个它并不知道的原因。连接快照上的码优先于行上的码：
 * 前者来自这个进程最近一次握手，后者是上一次持久化的分类。
 *
 * `last_error` 与 `blocked_reason` 都是服务端给的**诊断串**（多数情况下是英文），不是界面文案——
 * 所以产品句子在前、原始诊断只作为括号里的次级信息（`withErrorDetail` 的既有口径），
 * 而不是把一句英文直接当结论渲上去。
 *
 * 重连预算耗尽时两句话都要说：为什么失败（码）+ 为什么不再自动重试。它们是两件事，
 * 下一步动作也不同（修服务器 vs 点「测试连接」）。
 */
export function mcpReasonLine(
  server: McpServerVM,
  connection: McpServerConnectionVM | undefined,
  zh: boolean
): string | undefined {
  if (!server.enabled || server.status === "disabled") {
    return undefined;
  }
  if (server.status === "connect_failed") {
    const blocked = connection?.blocked_reason;
    const reason = blocked ?? connection?.last_error ?? server.last_error;
    const coded = mcpErrorCodeLine(connection?.last_error_code ?? server.last_error_code, zh);
    const sentences = [coded, blocked ? spotlightViewsT(zh, "mcpRetryBudgetSpent") : undefined]
      .filter((sentence): sentence is string => sentence !== undefined);
    // 中文句子自带句号，英文句间要一个空格（同 withErrorDetail 里按语言分叉的口径）。
    const lead = sentences.length > 0
      ? sentences.join(zh ? "" : " ")
      : spotlightViewsT(zh, "mcpConnectFailedHint");
    return reason ? withErrorDetail(zh, lead, new Error(reason)) : lead;
  }
  const toolCount = connection?.tool_count ?? server.tool_count;
  return toolCount === 0 ? spotlightViewsT(zh, "mcpNoToolsOffered") : undefined;
}

/** 信任级别这一行：说的是这台服务器的**风险上限**，不是「它安全」。 */
export function mcpTrustLine(server: McpServerVM, zh: boolean): string {
  return spotlightViewsT(zh, server.trust_level === "read_only" ? "mcpTrustReadOnly" : "mcpTrustExternalEffect");
}

/** 命令行（含参数）。网页看不到这一行——它是宿主机事实。 */
export function mcpCommandLine(server: McpServerVM): string {
  return [server.command, ...server.args].join(" ");
}

/**
 * 添加被拒时的人话。**按稳定错误码出**，绝不解析服务端的英文诊断，也不把服务端消息当界面文案用
 * （服务端那份只有部署方的语言，界面要两种）。码表见 .agents/notes/implemented/
 * 2026-09-05-mcp-m3-governance-endpoints.md 第 3 节。
 */
export function mcpAddErrorText(code: string | undefined, zh: boolean): string {
  switch (code) {
    case "mcp_server_name_invalid":
      return spotlightViewsT(zh, "mcpErrNameInvalid");
    case "mcp_server_name_taken":
      return spotlightViewsT(zh, "mcpErrNameTaken");
    case "mcp_command_not_found":
      return spotlightViewsT(zh, "mcpErrCommandNotFound");
    case "mcp_remote_exec_refused":
      return spotlightViewsT(zh, "mcpErrRemoteExec");
    case "mcp_args_invalid":
      return spotlightViewsT(zh, "mcpErrArgsInvalid");
    case "mcp_env_credential_shaped":
      return spotlightViewsT(zh, "mcpErrEnvCredentialShaped");
    case "mcp_env_overrides_base":
      return spotlightViewsT(zh, "mcpErrEnvOverridesBase");
    case "mcp_secret_ref_out_of_scope":
      return spotlightViewsT(zh, "mcpErrSecretRefOutOfScope");
    case "mcp_precheck_refused":
      return spotlightViewsT(zh, "mcpErrPrecheckRefused");
    case "mcp_admin_required":
      return spotlightViewsT(zh, "mcpErrAdminRequired");
    case "mcp_server_not_found":
      return spotlightViewsT(zh, "mcpErrNotFound");
    case "validation_error":
      return spotlightViewsT(zh, "mcpErrValidation");
    default:
      return spotlightViewsT(zh, "mcpErrAddFailed");
  }
}

/** 启动参数：一行一个。参数本身可以含空格，所以按行切而不是按空格切。 */
export function parseMcpArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 环境变量：一行一条 `KEY=VALUE`。读不了的那一行原样回给调用方，好让错误文案点到具体是哪一行。 */
export function parseMcpEnv(text: string): { ok: true; env: Record<string, string> } | { ok: false; badLine: string } {
  const env: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const at = line.indexOf("=");
    const key = at > 0 ? line.slice(0, at).trim() : "";
    if (!key) {
      return { ok: false, badLine: line };
    }
    env[key] = line.slice(at + 1).trim();
  }
  return { ok: true, env };
}

/** 调用超时：契约与 DB 的 CHECK 都是 [1000, 300000]，这里先拦一次，不拿一个注定 422 的值去打服务端。 */
export const MCP_TIMEOUT_MIN_MS = 1000;
export const MCP_TIMEOUT_MAX_MS = 300000;

export function parseMcpTimeoutMs(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  return value >= MCP_TIMEOUT_MIN_MS && value <= MCP_TIMEOUT_MAX_MS ? value : undefined;
}

export type DesktopMcpAddOutcome =
  | {
      kind: "added";
      server: McpServerVM;
      connection: McpServerConnectionVM | undefined;
      riskTokens: readonly string[];
    }
  | { kind: "refused"; code: string | undefined };

export type DesktopMcpFormState = {
  serverName: string;
  displayName: string;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  trustLevel: McpServerTrustLevel;
  timeoutText: string;
  /** 已加好的引用式密钥：{子进程变量名: 服务端变量名}。存的永远只有名字。 */
  secretRefs: Record<string, string>;
  secretRefChildKey: string;
  secretRefEnvVar: string;
  busy: boolean;
  errorText: string | undefined;
};

export type DesktopMcpSectionState = {
  /** 管理员门：服务端只给管理员填 settings VM 的 mcp_servers 字段，这里跟着同一个信号（见 settings.ts 的接线注释）。 */
  visible: boolean;
  servers: readonly McpServerVM[] | undefined;
  /** 按 id 索引的连接事实。停用/尚未连过的服务器不在这张表里。 */
  connections: Record<string, McpServerConnectionVM>;
  secretRefEnvPrefix: string;
  /** 服务端上已有的引用式密钥变量名。**只有名字，没有值**。 */
  availableSecretRefs: readonly string[];
  /**
   * 每台服务器最近一次动作回执报的高风险词。清单端点不带这个字段（它是回执上的），
   * 所以这里是「攒下来的」而不是「拉下来的」——没做过动作的行就没有这一句。
   */
  riskTokens: Record<string, readonly string[]>;
  failed: boolean;
  /** 两段式确认的武装态。键带动作前缀（`toggle:` / `trust:` / `remove:`），几个按钮互不解除对方。 */
  armedKey: string | undefined;
  busyId: string | undefined;
  errorText: string | undefined;
  form: DesktopMcpFormState;
  addOutcome: DesktopMcpAddOutcome | undefined;
  /** 旧服务端没有这批端点时（api-client 上是可选方法）安静降级，不给一个点了没反应的按钮。 */
  supported: boolean;
};

export function emptyMcpFormState(): DesktopMcpFormState {
  return {
    serverName: "",
    displayName: "",
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
    // 新增服务器不假设它安全：默认最高风险，要降级得管理员自己按（同契约里 trust_level 的默认）。
    trustLevel: "external_effect",
    timeoutText: "60000",
    secretRefs: {},
    secretRefChildKey: "",
    secretRefEnvVar: "",
    busy: false,
    errorText: undefined
  };
}

function subRow(text: string): string {
  return `<div class="wh-spot-row-sub wh-spot-row-sub--wrap">${escapeHtml(text)}</div>`;
}

function riskTokenRow(tokens: readonly string[], zh: boolean): string {
  return tokens.length > 0
    ? `<div class="wh-spot-row-sub wh-spot-row-sub--wrap" data-spot-mcp-risk-tokens="true">${escapeHtml(
        `${spotlightViewsT(zh, "mcpRiskTokensInName")}${tokens.join("、")}`
      )}</div>`
    : "";
}

/** 工具名预览：最多 6 个，其余收成「还有 N 个」——一台服务器几十个工具时这一行不该占满整屏。 */
const MCP_TOOL_PREVIEW_LIMIT = 6;

function toolsPreviewRow(
  server: McpServerVM,
  connection: McpServerConnectionVM | undefined,
  zh: boolean
): string {
  const names = connection?.tool_ids ?? server.tools ?? [];
  if (names.length === 0) {
    return "";
  }
  const shown = names.slice(0, MCP_TOOL_PREVIEW_LIMIT).join(" · ");
  const rest = names.length - MCP_TOOL_PREVIEW_LIMIT;
  const more = rest > 0 ? ` ${fill(spotlightViewsT(zh, "mcpMoreTools"), { count: String(rest) })}` : "";
  return subRow(`${spotlightViewsT(zh, "mcpToolsPreview")}${shown}${more}`);
}

function serverRowHtml(state: DesktopMcpSectionState, server: McpServerVM, zh: boolean): string {
  const connection = state.connections[server.id];
  const busy = state.busyId === server.id;
  const enabled = server.enabled && server.status !== "disabled";
  const armed = (action: string) => state.armedKey === `${action}:${server.id}`;
  const label = (action: string, idle: string) =>
    busy ? spotlightViewsT(zh, "working") : armed(action) ? spotlightViewsT(zh, "sureClickAgain3") : idle;

  const title = server.display_name ? `${server.display_name} · ${server.server_name}` : server.server_name;
  const reason = mcpReasonLine(server, connection, zh);
  const trustIdle = server.trust_level === "read_only"
    ? spotlightViewsT(zh, "takeBackReadOnlyTrust")
    : spotlightViewsT(zh, "trustAsReadOnly");

  return `<div class="wh-spot-row" style="cursor:default" data-spot-mcp-server="${escapeHtml(server.id)}" data-spot-mcp-status="${escapeHtml(server.status)}" data-spot-mcp-trust="${escapeHtml(server.trust_level)}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(title)}</div>
      <div class="wh-spot-row-sub">${escapeHtml(mcpStatusLine(server, connection, zh))}</div>
      ${reason ? subRow(reason) : ""}
      <div class="wh-spot-row-sub">${escapeHtml(mcpTrustLine(server, zh))}</div>
      ${riskTokenRow(state.riskTokens[server.id] ?? [], zh)}
      ${subRow(`${spotlightViewsT(zh, "mcpCommandLabel")}${mcpCommandLine(server)}`)}
      ${toolsPreviewRow(server, connection, zh)}
      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldTimeout"))}</div>
      <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-mcp-timeout="${escapeHtml(server.id)}" value="${escapeHtml(String(server.tool_call_timeout_ms))}" maxlength="6" inputmode="numeric" ${busy ? "disabled" : ""} />
    </div>
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-mcp-test="${escapeHtml(server.id)}" ${busy ? "disabled" : ""}>${busy ? spotlightViewsT(zh, "mcpTesting") : spotlightViewsT(zh, "mcpTestConnection")}</button>
    <button type="button" class="wh-spot-act ds-pressable ${armed("trust") ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-mcp-trust="${escapeHtml(server.id)}" ${busy ? "disabled" : ""}>${label("trust", trustIdle)}</button>
    <button type="button" class="wh-spot-act ds-pressable ${armed("toggle") ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-mcp-toggle="${escapeHtml(server.id)}" ${busy ? "disabled" : ""}>${label("toggle", spotlightViewsT(zh, enabled ? "disable" : "enable"))}</button>
    <button type="button" class="wh-spot-act ds-pressable ${armed("remove") ? "wh-spot-act--danger" : "wh-spot-act--quiet"}" data-set-mcp-remove="${escapeHtml(server.id)}" ${busy ? "disabled" : ""}>${label("remove", spotlightViewsT(zh, "remove"))}</button>
  </div>`;
}

function secretRefsFieldHtml(form: DesktopMcpFormState, state: DesktopMcpSectionState, zh: boolean): string {
  const pairs = Object.entries(form.secretRefs)
    .map(
      ([childKey, envVar]) =>
        `<div class="wh-spot-row" style="cursor:default" data-spot-mcp-secret-ref="${escapeHtml(childKey)}">
          <div class="wh-spot-row-main"><div class="wh-spot-row-sub">${escapeHtml(`${childKey} → ${envVar}`)}</div></div>
          <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-mcp-secret-drop="${escapeHtml(childKey)}" ${form.busy ? "disabled" : ""}>${spotlightViewsT(zh, "mcpSecretRefDrop")}</button>
        </div>`
    )
    .join("");
  // 下拉里只有变量名。值在这台机器上，永远不经过界面——这不是省事，是这一层结构性拿不到值。
  const options = state.availableSecretRefs
    .map(
      (name) =>
        `<option value="${escapeHtml(name)}" ${name === form.secretRefEnvVar ? "selected" : ""}>${escapeHtml(name)}</option>`
    )
    .join("");
  const picker = state.availableSecretRefs.length === 0
    ? subRow(spotlightViewsT(zh, "mcpSecretRefsNone"))
    : `<input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-mcp-secret-child value="${escapeHtml(form.secretRefChildKey)}" maxlength="200" placeholder="${escapeHtml(spotlightViewsT(zh, "mcpSecretRefChildKey"))}" ${form.busy ? "disabled" : ""} />
      <select class="wh-spot-delegate-select" data-set-mcp-secret-var aria-label="${escapeHtml(spotlightViewsT(zh, "mcpSecretRefPick"))}" ${form.busy ? "disabled" : ""}><option value="">${escapeHtml(spotlightViewsT(zh, "mcpSecretRefPick"))}</option>${options}</select>
      <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-mcp-secret-add="true" ${form.busy ? "disabled" : ""}>${spotlightViewsT(zh, "mcpSecretRefAdd")}</button>`;

  return `<div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldSecretRefs"))}</div>
    ${subRow(fill(spotlightViewsT(zh, "mcpSecretRefsHint"), { prefix: state.secretRefEnvPrefix }))}
    ${pairs}
    ${picker}`;
}

function addFormHtml(state: DesktopMcpSectionState, zh: boolean): string {
  if (!state.supported) {
    return subRow(spotlightViewsT(zh, "mcpUnsupported"));
  }
  const form = state.form;
  const disabled = form.busy ? "disabled" : "";
  const namePreview = mcpToolNamePreview(form.serverName, zh);
  const trustChips = (["external_effect", "read_only"] as const)
    .map(
      (level) =>
        `<button type="button" class="wh-spot-reason" data-set-mcp-form-trust="${level}" data-sel="${form.trustLevel === level}">${escapeHtml(
          spotlightViewsT(zh, level === "read_only" ? "mcpTrustReadOnly" : "mcpTrustExternalEffect")
        )}</button>`
    )
    .join("");

  return `<div class="wh-spot-row" style="cursor:default" data-spot-mcp-add-form="true">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(spotlightViewsT(zh, "mcpAddAServer"))}</div>

      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldName"))}</div>
      <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-mcp-name value="${escapeHtml(form.serverName)}" maxlength="200" placeholder="gh" ${disabled} />
      ${namePreview ? `<div class="wh-spot-row-sub wh-spot-row-sub--wrap" data-spot-mcp-name-preview="true">${escapeHtml(namePreview)}</div>` : ""}
      ${subRow(spotlightViewsT(zh, "mcpNameRiskNote"))}

      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldDisplayName"))}</div>
      <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-mcp-display value="${escapeHtml(form.displayName)}" maxlength="200" ${disabled} />

      <div class="wh-spot-row-sub wh-spot-row-sub--wrap">${escapeHtml(spotlightViewsT(zh, "mcpFieldCommand"))}</div>
      <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-mcp-command value="${escapeHtml(form.command)}" maxlength="1000" placeholder="/usr/local/bin/mcp-server-github" ${disabled} />

      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldArgs"))}</div>
      <textarea class="wh-spot-freetext" data-set-mcp-args rows="2" ${disabled}>${escapeHtml(form.argsText)}</textarea>

      <div class="wh-spot-row-sub wh-spot-row-sub--wrap">${escapeHtml(spotlightViewsT(zh, "mcpFieldEnv"))}</div>
      <textarea class="wh-spot-freetext" data-set-mcp-env rows="2" ${disabled}>${escapeHtml(form.envText)}</textarea>

      ${secretRefsFieldHtml(form, state, zh)}

      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldCwd"))}</div>
      <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-mcp-cwd value="${escapeHtml(form.cwd)}" maxlength="1000" ${disabled} />

      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldTrust"))}</div>
      <div class="wh-spot-reasons-row">${trustChips}</div>

      <div class="wh-spot-row-sub">${escapeHtml(spotlightViewsT(zh, "mcpFieldTimeout"))}</div>
      <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-set-mcp-timeout-new value="${escapeHtml(form.timeoutText)}" maxlength="6" inputmode="numeric" ${disabled} />

      ${form.errorText ? `<div class="wh-spot-row-sub wh-spot-row-sub--wrap" data-spot-mcp-form-error="true" style="color:var(--ds-danger)">${escapeHtml(form.errorText)}</div>` : ""}
    </div>
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-mcp-add="true" ${disabled}>${form.busy ? spotlightViewsT(zh, "mcpAdding") : spotlightViewsT(zh, "mcpAdd")}</button>
  </div>`;
}

function addOutcomeHtml(state: DesktopMcpSectionState, zh: boolean): string {
  const outcome = state.addOutcome;
  if (!outcome) {
    return "";
  }
  if (outcome.kind === "refused") {
    return `<div class="wh-spot-row" style="cursor:default" data-spot-mcp-outcome="refused">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${escapeHtml(spotlightViewsT(zh, "mcpNotAdded"))}</div>
        ${subRow(mcpAddErrorText(outcome.code, zh))}
      </div>
    </div>`;
  }
  const connected = outcome.server.status === "connected";
  const reason = mcpReasonLine(outcome.server, outcome.connection, zh);
  return `<div class="wh-spot-row" style="cursor:default" data-spot-mcp-outcome="${connected ? "connected" : "connect_failed"}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(outcome.server.server_name)}</div>
      ${subRow(
        connected
          ? `${spotlightViewsT(zh, "mcpAddedAndConnected")} ${mcpToolCountText(outcome.connection?.tool_count ?? outcome.server.tool_count, zh)}`
          : spotlightViewsT(zh, "mcpAddedButNotConnected")
      )}
      ${reason ? subRow(reason) : ""}
      ${riskTokenRow(outcome.riskTokens, zh)}
    </div>
  </div>`;
}

export function mcpServersSectionHtml(state: DesktopMcpSectionState, zh: boolean): string {
  if (!state.visible) {
    return "";
  }
  const rows = state.failed
    ? `<div class="wh-spot-row" style="cursor:default"><div class="wh-spot-row-main"><div class="wh-spot-row-sub">${escapeHtml(
        spotlightViewsT(zh, "couldnTLoadTheMcpServerList")
      )}</div></div><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-set-mcp-retry="true">${spotlightViewsT(zh, "retry")}</button></div>`
    : !state.servers || state.servers.length === 0
      ? subRow(spotlightViewsT(zh, "mcpNoServersYet"))
      : state.servers.map((server) => serverRowHtml(state, server, zh)).join("");

  const error = state.errorText
    ? `<div class="wh-spot-row-sub wh-spot-row-sub--wrap" data-spot-mcp-error="true" style="color:var(--ds-danger)">${escapeHtml(state.errorText)}</div>`
    : "";

  return `<div class="wh-spot-set-group" data-spot-mcp-section="true">
    <div class="wh-spot-set-label">${spotlightViewsT(zh, "mcpServers")}</div>
    ${subRow(spotlightViewsT(zh, "mcpSectionIntro"))}
    ${subRow(spotlightViewsT(zh, "mcpTrustSectionNote"))}
    ${rows}
    ${addFormHtml(state, zh)}
    ${addOutcomeHtml(state, zh)}
    ${error}
  </div>`;
}
