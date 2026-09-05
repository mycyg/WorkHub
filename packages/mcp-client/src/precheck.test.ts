import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_PRECHECK_CHECK_IDS,
  detectRemoteExecLauncher,
  mcpPrecheckErrorCode,
  normalizeMcpCommandName,
  precheckMcpServer,
  type McpPrecheckCheckId,
  type McpPrecheckReport,
  type PrecheckMcpServerInput
} from "./precheck.js";

const NULL_BYTE = "\x00";

const baseInput: PrecheckMcpServerInput = {
  serverName: "gh",
  command: "/usr/local/bin/mcp-server-github",
  args: ["--stdio"],
  commandResolution: { found: true, executable: true, resolvedPath: "/usr/local/bin/mcp-server-github" },
  checkedAt: new Date("2026-09-05T00:00:00.000Z")
};

function levelOf(report: McpPrecheckReport, id: McpPrecheckCheckId) {
  return report.checks.find((check) => check.id === id)?.level;
}

function check(overrides: Partial<PrecheckMcpServerInput>) {
  return precheckMcpServer({ ...baseInput, ...overrides });
}

test("一份干净配置全 pass，八条体检项一条不少", () => {
  const report = check({});
  assert.equal(report.verdict, "ok");
  assert.deepEqual(report.checks.map((entry) => entry.id), [...MCP_PRECHECK_CHECK_IDS]);
  assert.equal(report.checks.every((entry) => entry.level === "pass"), true);
  assert.equal(report.checked_at, "2026-09-05T00:00:00.000Z");
  assert.equal(mcpPrecheckErrorCode(report), undefined);
});

test("服务器名：形状不对与已被占用是两种拒绝，各有各的码", () => {
  const invalid = check({ serverName: "has.dot" });
  assert.equal(levelOf(invalid, "server_name"), "block");
  assert.equal(mcpPrecheckErrorCode(invalid), "mcp_server_name_invalid");
  const taken = check({ serverName: "gh", takenServerNames: ["gh"] });
  assert.equal(levelOf(taken, "server_name"), "block");
  assert.equal(mcpPrecheckErrorCode(taken), "mcp_server_name_taken");
  assert.equal(levelOf(check({ serverName: "gh", takenServerNames: ["fs"] }), "server_name"), "pass");
});

test("命令：空 / 相对路径 / 找不到 / 不可执行都拒，绝对路径且可执行才过", () => {
  assert.equal(levelOf(check({ command: "   " }), "command_resolvable"), "block");
  assert.equal(levelOf(check({ command: "./server" }), "command_resolvable"), "block");
  assert.equal(levelOf(check({ command: "bin/server" }), "command_resolvable"), "block");
  assert.equal(levelOf(check({ commandResolution: { found: false, executable: false } }), "command_resolvable"), "block");
  assert.equal(levelOf(check({ commandResolution: { found: true, executable: false } }), "command_resolvable"), "block");
  assert.equal(levelOf(check({}), "command_resolvable"), "pass");
  assert.equal(mcpPrecheckErrorCode(check({ commandResolution: { found: false, executable: false } })), "mcp_command_not_found");
});

test("命令里的 NUL 字节直接拒", () => {
  assert.equal(levelOf(check({ command: `/usr/bin/x${NULL_BYTE}y` }), "command_resolvable"), "block");
});

test("裸名要靠调用方查 PATH；没查就诚实说没验证，不假装查过", () => {
  // 刻意把这个字段整个拿掉，而不是传一个 undefined —— 「调用方没查」在类型上就是「没这个键」。
  const { commandResolution: _unused, ...withoutResolution } = baseInput;
  const unchecked = precheckMcpServer({ ...withoutResolution, command: "mcp-server-github" });
  assert.equal(levelOf(unchecked, "command_resolvable"), "warn");
  assert.equal(unchecked.verdict, "warn");
  const found = check({ command: "mcp-server-github", commandResolution: { found: true, executable: true } });
  assert.equal(levelOf(found, "command_resolvable"), "pass");
});

test("现下现跑的启动器一律拒（阶段 0 拍板）", () => {
  for (const [command, args] of [
    ["npx", ["-y", "@modelcontextprotocol/server-github"]],
    ["/usr/local/bin/npx", ["-y", "x"]],
    ["npx.cmd", ["x"]],
    ["bunx", ["x"]],
    ["uvx", ["mcp-server-git"]],
    ["pnpx", ["x"]],
    ["pnpm", ["dlx", "x"]],
    ["pnpm", ["-s", "dlx", "x"]],
    ["yarn", ["dlx", "x"]],
    ["npm", ["exec", "x"]],
    ["npm", ["x", "y"]],
    ["bun", ["x", "y"]],
    ["uv", ["tool", "run", "x"]],
    ["pipx", ["run", "x"]]
  ] as [string, string[]][]) {
    const report = check({ command, args, commandResolution: { found: true, executable: true } });
    assert.equal(levelOf(report, "remote_exec_launcher"), "block", `${command} ${args.join(" ")}`);
    assert.equal(mcpPrecheckErrorCode(report), "mcp_remote_exec_refused", `${command} ${args.join(" ")}`);
  }
});

test("正常的本机命令不会被误判成启动器", () => {
  for (const [command, args] of [
    ["/usr/local/bin/node", ["server.js"]],
    ["/opt/homebrew/bin/uv", ["run", "--directory", "/srv", "server.py"]],
    ["/usr/bin/pnpm", ["start"]],
    ["/usr/bin/python3", ["-m", "mcp_server"]]
  ] as [string, string[]][]) {
    assert.equal(detectRemoteExecLauncher(command, args), undefined, `${command} ${args.join(" ")}`);
  }
});

test("命令名归一化：去目录、去 Windows 扩展名、转小写", () => {
  assert.equal(normalizeMcpCommandName("/usr/local/bin/NPX.CMD"), "npx");
  assert.equal(normalizeMcpCommandName("node"), "node");
});

test("参数：NUL 拒、`..` 只警告", () => {
  const nullByte = check({ args: [`a${NULL_BYTE}b`] });
  assert.equal(levelOf(nullByte, "args_shape"), "block");
  assert.equal(mcpPrecheckErrorCode(nullByte), "mcp_args_invalid");
  const traversal = check({ args: ["--root", "/srv/../etc"] });
  assert.equal(levelOf(traversal, "args_shape"), "warn");
  assert.equal(traversal.verdict, "warn");
  assert.equal(levelOf(check({ args: ["--root", "/srv/data"] }), "args_shape"), "pass");
  // `..` 只在整段等于两点时才算穿越，文件名里的两点不算。
  assert.equal(levelOf(check({ args: ["/srv/a..b"] }), "args_shape"), "pass");
});

test("环境变量：凭据形状拒、顶掉基座键拒", () => {
  const credential = check({ env: { GITHUB_TOKEN: "x" } });
  assert.equal(levelOf(credential, "env_credential_shaped"), "block");
  assert.equal(mcpPrecheckErrorCode(credential), "mcp_env_credential_shaped");
  const base = check({ env: { PATH: "/evil" } });
  assert.equal(levelOf(base, "env_overrides_base"), "block");
  assert.equal(mcpPrecheckErrorCode(base), "mcp_env_overrides_base");
  assert.equal(levelOf(check({ env: { GITHUB_HOST: "github.example.com" } }), "env_credential_shaped"), "pass");
});

test("引用式密钥：指向命名空间之外的变量直接拒", () => {
  const outOfScope = check({ secretRefs: { GITHUB_TOKEN: "COOKIE_SECRET" } });
  assert.equal(levelOf(outOfScope, "secret_ref_scope"), "block");
  assert.equal(mcpPrecheckErrorCode(outOfScope), "mcp_secret_ref_out_of_scope");
  const inScope = check({
    secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" },
    presentSecretEnvNames: ["WORKHUB_MCP_SECRET_GITHUB"]
  });
  assert.equal(levelOf(inScope, "secret_ref_scope"), "pass");
  assert.equal(levelOf(inScope, "secret_refs_present"), "pass");
});

test("引用的变量还没配只警告（管理员可以先填后重启），但 spawn 时是 fail-closed 的", () => {
  const report = check({ secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" }, presentSecretEnvNames: [] });
  assert.equal(levelOf(report, "secret_refs_present"), "warn");
  assert.equal(report.verdict, "warn");
  assert.equal(mcpPrecheckErrorCode(report), undefined);
});

test("有 block 就是 blocked，只有 warn 才是 warn", () => {
  assert.equal(check({}).verdict, "ok");
  assert.equal(check({ args: ["/a/../b"] }).verdict, "warn");
  assert.equal(check({ args: ["/a/../b"], command: "./x" }).verdict, "blocked");
});

test("错误码按体检项顺序取第一条 block", () => {
  const report = check({ serverName: "bad.name", command: "npx", args: ["-y", "x"] });
  assert.equal(mcpPrecheckErrorCode(report), "mcp_server_name_invalid");
});

test("detail 有 500 字符上限", () => {
  const report = check({ args: [`/${"a".repeat(2000)}/../b`] });
  const detail = report.checks.find((entry) => entry.id === "args_shape")?.detail ?? "";
  assert.equal(detail.length <= 500, true, `${detail.length}`);
});
