import assert from "node:assert/strict";
import test from "node:test";

import type { McpServerConnectionVM, McpServerErrorCode, McpServerVM } from "@workhub/contracts";

import {
  MCP_SERVER_NAME_MAX_CHARS,
  MCP_TOOL_ID_MAX_CHARS,
  MCP_TOOL_ID_PREFIX,
  emptyMcpFormState,
  mcpAddErrorText,
  mcpErrorCodeLine,
  mcpReasonLine,
  mcpServersSectionHtml,
  mcpStatusLine,
  mcpToolNamePreview,
  parseMcpArgs,
  parseMcpEnv,
  parseMcpTimeoutMs,
  type DesktopMcpSectionState
} from "./settings-mcp.js";

const SERVER_ID = "90000000-0000-4000-8000-000000000001";

function mcpServerVm(over: Partial<McpServerVM> = {}): McpServerVM {
  return {
    id: SERVER_ID,
    server_name: "gh",
    transport: "stdio",
    command: "/usr/local/bin/mcp-server-github",
    args: ["--stdio"],
    env: {},
    secret_refs: {},
    tool_call_timeout_ms: 60000,
    enabled: true,
    status: "connected",
    trust_level: "external_effect",
    precheck_report: { verdict: "ok", checks: [], checked_at: "2026-09-06T00:00:00.000Z" },
    tool_count: 2,
    tools: ["create_issue", "list_issues"],
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    ...over
  } as unknown as McpServerVM;
}

function sectionState(over: Partial<DesktopMcpSectionState> = {}): DesktopMcpSectionState {
  return {
    visible: true,
    servers: [mcpServerVm()],
    connections: { [SERVER_ID]: { live: true, tool_count: 2, tool_ids: ["mcp__gh__create_issue"] } },
    secretRefEnvPrefix: "WORKHUB_MCP_SECRET_",
    availableSecretRefs: ["WORKHUB_MCP_SECRET_GITHUB_TOKEN"],
    riskTokens: {},
    failed: false,
    armedKey: undefined,
    busyId: undefined,
    errorText: undefined,
    form: emptyMcpFormState(),
    addOutcome: undefined,
    supported: true,
    ...over
  };
}

// —— 名字预览：钉住与 @workhub/mcp-client 逐字对齐的三个常量 —— //

test("the tool-name constants stay pinned to the ones @workhub/mcp-client computes names with", () => {
  // 这三个值在 packages/mcp-client/src/names.ts 里；那边改了这边的预览就会说错话。
  assert.equal(MCP_TOOL_ID_PREFIX, "mcp__");
  assert.equal(MCP_SERVER_NAME_MAX_CHARS, 32);
  assert.equal(MCP_TOOL_ID_MAX_CHARS, 64);
});

test("mcpToolNamePreview shows the prefix a tool name will carry and how much room is left", () => {
  const preview = mcpToolNamePreview("gh", true);
  assert.ok(preview);
  assert.match(preview, /mcp__gh__/u);
  // mcp__(5) + gh(2) + __(2) = 9；64 - 9 = 55。
  assert.match(preview, /55/u);
  assert.equal(mcpToolNamePreview("   ", true), undefined, "还没填名字就不预告");
});

test("mcpToolNamePreview squeezes illegal characters the same way the名字 sanitizer does", () => {
  assert.match(mcpToolNamePreview("my server.1", true) ?? "", /mcp__my_server_1__/u);
});

test("a long server name visibly eats the tool-name budget — that is the point of the preview", () => {
  const long = mcpToolNamePreview("a".repeat(40), true) ?? "";
  // 名字段被夹到 32：5 + 32 + 2 = 39，剩 25。
  assert.match(long, /25/u);
});

// —— 状态行的三种说法 + 空闲这一种 —— //

test("mcpStatusLine says connected with a tool count, in the viewer's language", () => {
  assert.equal(mcpStatusLine(mcpServerVm(), { live: true, tool_count: 2 }, true), "已连接 · 2 个工具");
  assert.equal(mcpStatusLine(mcpServerVm(), { live: true, tool_count: 2 }, false), "Connected · 2 tools");
});

test("one tool reads as '1 tool', not '1 tools' — plurals are grammar, not a template", () => {
  assert.equal(mcpStatusLine(mcpServerVm(), { live: true, tool_count: 1 }, false), "Connected · 1 tool");
  assert.equal(mcpStatusLine(mcpServerVm(), { live: true, tool_count: 1 }, true), "已连接 · 1 个工具");
});

test("an idle-reclaimed server is still connected — it is not the same thing as can't connect", () => {
  const idle = mcpStatusLine(mcpServerVm(), { live: false, tool_count: 2 }, true);
  assert.match(idle, /已连接（空闲/u);
  assert.doesNotMatch(idle, /连不上/u);
  // 连接快照整个缺席（本进程还没连过它）也走同一句，不冒充一个「活着」的结论。
  assert.match(mcpStatusLine(mcpServerVm(), undefined, true), /已连接（空闲/u);
});

test("a disabled server says disabled and carries no reason line", () => {
  const server = mcpServerVm({ enabled: false, status: "disabled", tool_count: 0 } as Partial<McpServerVM>);
  assert.equal(mcpStatusLine(server, undefined, true), "已停用");
  assert.equal(mcpReasonLine(server, undefined, true), undefined);
});

test("a failed server leads with plain language and keeps the server's diagnostic as secondary detail", () => {
  const server = mcpServerVm({
    status: "connect_failed",
    tool_count: 0,
    tools: [],
    last_error: "mcp handshake timed out after 20000ms"
  } as Partial<McpServerVM>);
  assert.equal(mcpStatusLine(server, undefined, true), "连不上");
  const reason = mcpReasonLine(server, undefined, true) ?? "";
  assert.match(reason, /^连不上这台服务器。/u, "产品文案在前");
  assert.match(reason, /handshake timed out/u, "原始诊断只作为括号里的次级信息");
});

test("a spent reconnect budget says why nothing is being retried and points at Test connection", () => {
  const server = mcpServerVm({ status: "connect_failed", tool_count: 0 } as Partial<McpServerVM>);
  const connection: McpServerConnectionVM = {
    live: false,
    tool_count: 0,
    blocked_reason: "mcp server 'gh' failed 4 times within 10 minutes; last error: spawn ENOENT"
  };
  const reason = mcpReasonLine(server, connection, true) ?? "";
  assert.match(reason, /不自动重连/u);
  assert.match(reason, /测试连接/u);
});

// —— R26 F3：连不上的原因按稳定错误码出话 —— //

// 契约 mcpServerErrorCodeSchema 的九条码。这里写死一份，是为了在契约新增一条码而
// MCP_ERROR_CODE_COPY 忘了跟时**测试先红**（那张表的 satisfies 只保证不缺键，保证不了这里有覆盖）。
const MCP_ERROR_CODES: readonly McpServerErrorCode[] = [
  "mcp_spawn_failed",
  "mcp_handshake_timeout",
  "mcp_protocol_version_unsupported",
  "mcp_protocol_error",
  "mcp_server_error",
  "mcp_call_timeout",
  "mcp_not_running",
  "mcp_exited",
  "mcp_connect_failed"
];

test("every error code has its own sentence in both languages, and no code leaves it blank", () => {
  const zhLines = new Set<string>();
  for (const code of MCP_ERROR_CODES) {
    const zhLine = mcpErrorCodeLine(code, true) ?? "";
    const enLine = mcpErrorCodeLine(code, false) ?? "";
    assert.ok(zhLine.length > 0, `${code} 没有中文句子`);
    assert.ok(enLine.length > 0, `${code} has no English sentence`);
    assert.notEqual(zhLine, enLine, `${code} 两种语言给了同一串`);
    zhLines.add(zhLine);
  }
  // 九条各说各的：合并两条码会让两种完全不同的下一步动作看起来是同一件事。
  assert.equal(zhLines.size, MCP_ERROR_CODES.length);
  // 拿不到码时不出这一行——由 mcpReasonLine 落回通用句，而不是在这里编一个原因。
  assert.equal(mcpErrorCodeLine(undefined, true), undefined);
});

test("the fallback code says exactly what a missing code says — it means the same thing", () => {
  const withFallbackCode = mcpServerVm({
    status: "connect_failed",
    tool_count: 0,
    last_error_code: "mcp_connect_failed"
  } as Partial<McpServerVM>);
  const withNoCode = mcpServerVm({ status: "connect_failed", tool_count: 0 } as Partial<McpServerVM>);
  assert.equal(mcpReasonLine(withFallbackCode, undefined, true), mcpReasonLine(withNoCode, undefined, true));
});

test("a handshake timeout finally gets the sentence M7 could not give", () => {
  const server = mcpServerVm({
    status: "connect_failed",
    tool_count: 0,
    tools: [],
    last_error: "mcp handshake timed out after 20000ms",
    last_error_code: "mcp_handshake_timeout"
  } as Partial<McpServerVM>);
  const reason = mcpReasonLine(server, undefined, true) ?? "";
  assert.match(reason, /^服务器没有在规定时间内应答。/u, "按码出的原因在最前");
  assert.match(reason, /handshake timed out/u, "原始诊断仍然只是括号里的次级信息");
  assert.doesNotMatch(reason, /连不上这台服务器/u, "有了具体原因就不再说那句笼统的");
  assert.match(mcpReasonLine(server, undefined, false) ?? "", /^The server did not answer in time\./u);
});

test("the connection snapshot's code wins over the row's — it is this process's latest handshake", () => {
  const server = mcpServerVm({
    status: "connect_failed",
    tool_count: 0,
    last_error: "spawn ENOENT",
    last_error_code: "mcp_spawn_failed"
  } as Partial<McpServerVM>);
  const connection: McpServerConnectionVM = {
    live: false,
    tool_count: 0,
    last_error: "mcp server exited with code 1",
    last_error_code: "mcp_exited"
  };
  assert.match(mcpReasonLine(server, connection, true) ?? "", /^这台服务器自己退出了。/u);
});

test("no code at all keeps M7's generic sentence rather than inventing a reason", () => {
  const server = mcpServerVm({
    status: "connect_failed",
    tool_count: 0,
    last_error: "mcp server 'gh' is not running"
  } as Partial<McpServerVM>);
  const reason = mcpReasonLine(server, undefined, true) ?? "";
  assert.match(reason, /^连不上这台服务器。/u);
  assert.match(reason, /is not running/u);
});

test("a spent retry budget says both things: why it failed and why nothing is retrying", () => {
  const server = mcpServerVm({ status: "connect_failed", tool_count: 0 } as Partial<McpServerVM>);
  const connection: McpServerConnectionVM = {
    live: false,
    tool_count: 0,
    blocked_reason: "mcp server 'gh' failed 4 times within 10 minutes; last error: spawn ENOENT",
    last_error_code: "mcp_spawn_failed"
  };
  const reason = mcpReasonLine(server, connection, true) ?? "";
  assert.match(reason, /^这台服务器没能启动。/u);
  assert.match(reason, /不自动重连/u);
  assert.match(reason, /测试连接/u);
  // 英文两句之间要有空格，不然会连成一串。
  assert.match(mcpReasonLine(server, connection, false) ?? "", /start\. It failed too many times/u);
});

test("connected with zero tools is its own answer, not a silent success", () => {
  const server = mcpServerVm({ tool_count: 0, tools: [] } as Partial<McpServerVM>);
  const reason = mcpReasonLine(server, { live: true, tool_count: 0 }, true) ?? "";
  assert.match(reason, /没有提供工具/u);
  assert.match(mcpReasonLine(server, { live: true, tool_count: 0 }, false) ?? "", /offers no tools/u);
});

// —— 清单渲染 —— //

test("mcpServersSectionHtml renders nothing for a non-admin", () => {
  assert.equal(mcpServersSectionHtml(sectionState({ visible: false }), true), "");
});

test("mcpServersSectionHtml lists the name, status, trust, command and tool preview with every action", () => {
  const html = mcpServersSectionHtml(sectionState(), true);
  assert.match(html, /data-spot-mcp-section="true"/u);
  assert.match(html, new RegExp(`data-spot-mcp-server="${SERVER_ID}"`, "u"));
  assert.match(html, /data-spot-mcp-status="connected"/u);
  assert.match(html, /data-spot-mcp-trust="external_effect"/u);
  assert.match(html, /\/usr\/local\/bin\/mcp-server-github --stdio/u);
  assert.match(html, /mcp__gh__create_issue/u);
  assert.match(html, new RegExp(`data-set-mcp-test="${SERVER_ID}"`, "u"));
  assert.match(html, new RegExp(`data-set-mcp-toggle="${SERVER_ID}"`, "u"));
  assert.match(html, new RegExp(`data-set-mcp-trust="${SERVER_ID}"`, "u"));
  assert.match(html, new RegExp(`data-set-mcp-remove="${SERVER_ID}"`, "u"));
  assert.match(html, new RegExp(`data-set-mcp-timeout="${SERVER_ID}"`, "u"));
});

test("the tool preview stops at six names and says how many are left", () => {
  const tools = Array.from({ length: 9 }, (_, index) => `mcp__gh__t${index}`);
  const html = mcpServersSectionHtml(
    sectionState({ connections: { [SERVER_ID]: { live: true, tool_count: 9, tool_ids: tools } } }),
    true
  );
  assert.match(html, /mcp__gh__t5/u);
  assert.doesNotMatch(html, /mcp__gh__t6/u);
  assert.match(html, /还有 3 个/u);
});

test("the empty list explains itself, the failed list offers a retry, and neither pretends to be the other", () => {
  assert.match(mcpServersSectionHtml(sectionState({ servers: [] }), true), /还没有接入 MCP 服务器/u);
  const failed = mcpServersSectionHtml(sectionState({ failed: true }), true);
  assert.match(failed, /data-set-mcp-retry="true"/u);
  assert.doesNotMatch(failed, /还没有接入 MCP 服务器/u);
});

test("only one control is armed at a time — each action carries its own armed key", () => {
  const armed = mcpServersSectionHtml(sectionState({ armedKey: `remove:${SERVER_ID}` }), true);
  assert.equal(armed.match(/确定？再点一次/gu)?.length, 1);
  const trustArmed = mcpServersSectionHtml(sectionState({ armedKey: `trust:${SERVER_ID}` }), true);
  assert.equal(trustArmed.match(/确定？再点一次/gu)?.length, 1);
});

test("a server against an older backend degrades to an explanation, not a dead Add button", () => {
  const html = mcpServersSectionHtml(sectionState({ supported: false }), true);
  assert.doesNotMatch(html, /data-set-mcp-add="true"/u);
  assert.match(html, /还没有 MCP 服务器管理接口/u);
});

// —— 名字里的高风险词 —— //

test("the add form warns that words in a name are graded for risk before any trust level applies", () => {
  const zh = mcpServersSectionHtml(sectionState(), true);
  assert.match(zh, /finance、publish/u);
  assert.match(zh, /和信任级别无关/u);
  assert.match(mcpServersSectionHtml(sectionState(), false), /whatever trust level you set/u);
});

test("a row echoes the exact risk words the server reported back, not a generic warning", () => {
  const html = mcpServersSectionHtml(sectionState({ riskTokens: { [SERVER_ID]: ["finance", "publish"] } }), true);
  assert.match(html, /data-spot-mcp-risk-tokens="true"/u);
  assert.match(html, /finance、publish/u);
  // 没有回执的行不凭空编一句。
  assert.doesNotMatch(mcpServersSectionHtml(sectionState(), true), /data-spot-mcp-risk-tokens/u);
});

// —— 密钥引用 —— //

test("the secret-reference picker offers variable names only — there is no value anywhere in the markup", () => {
  const html = mcpServersSectionHtml(sectionState(), true);
  assert.match(html, /data-set-mcp-secret-var/u);
  assert.match(html, /WORKHUB_MCP_SECRET_GITHUB_TOKEN/u);
  assert.match(html, /以 WORKHUB_MCP_SECRET_ 开头/u);
  assert.match(html, /data-set-mcp-secret-child/u);
});

test("an already-added secret reference shows both names and a way to drop it", () => {
  const state = sectionState();
  const html = mcpServersSectionHtml(
    { ...state, form: { ...state.form, secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB_TOKEN" } } },
    true
  );
  assert.match(html, /data-spot-mcp-secret-ref="GITHUB_TOKEN"/u);
  assert.match(html, /GITHUB_TOKEN → WORKHUB_MCP_SECRET_GITHUB_TOKEN/u);
  assert.match(html, /data-set-mcp-secret-drop="GITHUB_TOKEN"/u);
});

test("with no server-side variables configured the picker says so instead of offering an empty dropdown", () => {
  const html = mcpServersSectionHtml(sectionState({ availableSecretRefs: [] }), true);
  assert.doesNotMatch(html, /data-set-mcp-secret-var/u);
  assert.match(html, /还没有可以引用的变量名/u);
});

// —— 添加结果卡与错误码 —— //

test("a refused add renders the reason card and never adds a row", () => {
  const html = mcpServersSectionHtml(
    sectionState({ servers: [], addOutcome: { kind: "refused", code: "mcp_remote_exec_refused" } }),
    true
  );
  assert.match(html, /data-spot-mcp-outcome="refused"/u);
  assert.match(html, /先在这台机器上把它装好/u);
  assert.doesNotMatch(html, /data-set-mcp-toggle=/u);
});

test("an added-but-not-connected server says so and carries the reason — it is not reported as a success", () => {
  const server = mcpServerVm({ status: "connect_failed", tool_count: 0, last_error: "spawn ENOENT" } as Partial<McpServerVM>);
  const html = mcpServersSectionHtml(
    sectionState({
      servers: [server],
      connections: {},
      addOutcome: { kind: "added", server, connection: undefined, riskTokens: [] }
    }),
    true
  );
  assert.match(html, /data-spot-mcp-outcome="connect_failed"/u);
  assert.match(html, /登记好了，但没连上/u);
  assert.match(html, /spawn ENOENT/u);
});

test("the add outcome card echoes the risk words the server reported for that name", () => {
  const server = mcpServerVm({ server_name: "finance" } as Partial<McpServerVM>);
  const html = mcpServersSectionHtml(
    sectionState({
      servers: [server],
      addOutcome: {
        kind: "added",
        server,
        connection: { live: true, tool_count: 2 },
        riskTokens: ["finance"]
      }
    }),
    true
  );
  assert.match(html, /data-spot-mcp-outcome="connected"/u);
  assert.match(html, /data-spot-mcp-risk-tokens="true"/u);
  assert.match(html, /名字里命中的高风险词：finance/u);
});

test("mcpAddErrorText explains each refusal by stable code, in both languages", () => {
  assert.match(mcpAddErrorText("mcp_command_not_found", true), /找不到这条命令/u);
  assert.match(mcpAddErrorText("mcp_command_not_found", false), /Can't find that command/u);
  assert.match(mcpAddErrorText("mcp_remote_exec_refused", true), /npx/u);
  assert.match(mcpAddErrorText("mcp_remote_exec_refused", false), /Install it on this machine first/u);
  assert.match(mcpAddErrorText("mcp_server_name_taken", true), /已经被另一台服务器用了/u);
  assert.match(mcpAddErrorText("mcp_server_name_invalid", true), /最长 32 个字符/u);
  assert.match(mcpAddErrorText("mcp_env_credential_shaped", true), /密钥引用/u);
  assert.match(mcpAddErrorText("mcp_env_overrides_base", true), /PATH/u);
  assert.match(mcpAddErrorText("mcp_secret_ref_out_of_scope", true), /前缀/u);
  assert.match(mcpAddErrorText("mcp_args_invalid", true), /启动参数/u);
  assert.match(mcpAddErrorText("mcp_precheck_refused", true), /启动前检查/u);
  assert.match(mcpAddErrorText("mcp_admin_required", true), /只有管理员/u);
  assert.match(mcpAddErrorText("mcp_server_not_found", true), /没有找到这台服务器/u);
  assert.match(mcpAddErrorText("validation_error", true), /检查后重填/u);
  assert.match(mcpAddErrorText(undefined, true), /没接上/u);
  assert.match(mcpAddErrorText("something_new_from_the_future", true), /没接上/u);
});

// —— 表单输入的解析 —— //

test("parseMcpArgs keeps one argument per line, spaces and all", () => {
  assert.deepEqual(parseMcpArgs("--stdio\n --repo owner/name \n\n"), ["--stdio", "--repo owner/name"]);
  assert.deepEqual(parseMcpArgs("   "), []);
});

test("parseMcpEnv reads KEY=VALUE lines and names the line it cannot read", () => {
  assert.deepEqual(parseMcpEnv("A=1\n B = two \n"), { ok: true, env: { A: "1", B: "two" } });
  assert.deepEqual(parseMcpEnv("A=1\nnope\n"), { ok: false, badLine: "nope" });
  assert.deepEqual(parseMcpEnv("=1"), { ok: false, badLine: "=1" });
  assert.deepEqual(parseMcpEnv("A="), { ok: true, env: { A: "" } }, "空值是合法的，不是读不了");
  assert.deepEqual(parseMcpEnv("A=x=y"), { ok: true, env: { A: "x=y" } }, "只按第一个等号切");
});

test("parseMcpTimeoutMs holds the same [1000, 300000] bounds the contract and the table do", () => {
  assert.equal(parseMcpTimeoutMs("60000"), 60000);
  assert.equal(parseMcpTimeoutMs(" 1000 "), 1000);
  assert.equal(parseMcpTimeoutMs("300000"), 300000);
  assert.equal(parseMcpTimeoutMs("999"), undefined);
  assert.equal(parseMcpTimeoutMs("300001"), undefined);
  assert.equal(parseMcpTimeoutMs("6e4"), undefined);
  assert.equal(parseMcpTimeoutMs("-1"), undefined);
  assert.equal(parseMcpTimeoutMs(""), undefined);
});

test("a new form starts at the highest risk tier — adding a server never assumes it is safe", () => {
  assert.equal(emptyMcpFormState().trustLevel, "external_effect");
});
