// MCP（Model Context Protocol，模型上下文协议）服务器治理面的用户可见文案单一来源（R26 M3）。
//
// 形状照仓库里 per-package 的 `locales.ts`：**中文对象是 key 集的事实源**，英文对象用
// `satisfies Record<keyof typeof zh, string>` 做编译期对齐——少一个键或多一个键都编译不过。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）与
// scripts/dev/check-copy-terms.ts（禁词）。
//
// 为什么治理服务的错误消息也走词典：`services/plugins.ts` 那一批把中文直接写在服务里，代价是
// 整个文件被记进了 ui-i18n 的存量基线，两端 UI 想换语言就只能各自再写一份。这一批不再欠这笔账。
//
// `{command}` / `{keys}` 是占位符，由调用方用真实值替换。词典条目保持纯字符串（而不是函数），
// 是为了让上面那条 `satisfies` 对齐仍然成立。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  // —— 治理门 —— //
  adminRequired: "只有管理员可以管理 MCP 服务器。",
  serverNotFound: "没有找到这台服务器。",
  nothingToUpdate: "这次修改没有要改的内容。",

  // —— 启动前检查拒绝（每条一个稳定错误码，两端界面按码出话） —— //
  serverNameInvalid: "名字只能用字母、数字、下划线和短横线，最长 32 个字符。它会出现在工具名里。",
  serverNameTaken: "这个名字已经被另一台服务器用了。名字会出现在工具名里，必须唯一。",
  commandNotFound: "找不到命令「{command}」。请填这台机器上真实存在的可执行文件，完整路径最稳。",
  remoteExecRefused:
    "「{command}」每次启动都会从网上下载并执行代码，我们不这么起服务器。请先把它装到这台机器上，再填装好之后的路径。",
  argsInvalid: "启动参数里有不能接受的内容，请检查后重填。",
  envCredentialShaped: "环境变量「{keys}」看着像一份凭据。凭据不存在这里——请改用密钥引用，指向服务端上的一个变量名。",
  envOverridesBase: "环境变量里不能覆盖「{keys}」，这些由这台机器决定。",
  secretRefOutOfScope: "密钥引用只能指向服务端上以「{keys}」开头的变量。",
  precheckRefused: "这台服务器没通过启动前检查，没有登记。",

  // —— 连接失败（M2 会话失败原因逐条对应） —— //
  spawnFailed: "这台服务器没能起来。请确认这条命令能在这台机器上直接运行。",
  handshakeTimeout: "这台服务器没有在超时内回应。可能它不是一台 MCP 服务器，或者在等一个没拿到的凭据。",
  protocolVersionUnsupported: "这台服务器用的协议版本这一版还接不了。",
  protocolError: "这台服务器回的内容读不了。",
  serverRejected: "这台服务器拒绝了这次请求。",
  callTimeout: "这次调用超时了。",
  notRunning: "这台服务器现在没有在运行。",
  exited: "这台服务器中途退出了。",
  connectFailed: "连不上这台服务器。"
} as const;

const en = {
  adminRequired: "Only an admin can manage MCP servers.",
  serverNotFound: "No such server.",
  nothingToUpdate: "This change has nothing to change.",

  serverNameInvalid:
    "Names take letters, digits, underscores and hyphens, up to 32 characters. The name shows up inside tool names.",
  serverNameTaken: "That name is already used by another server. Names appear inside tool names, so they must be unique.",
  commandNotFound: "Can't find the command \"{command}\". Point this at a real executable on this machine; a full path is safest.",
  remoteExecRefused:
    "\"{command}\" downloads and runs code from the network on every start, so we don't launch servers that way. Install it on this machine first, then point at the installed path.",
  argsInvalid: "The start-up arguments contain something we can't accept. Check them and try again.",
  envCredentialShaped:
    "The variable \"{keys}\" looks like a credential. Credentials aren't kept here — use a secret reference that points at a server-side variable name.",
  envOverridesBase: "Variables can't override \"{keys}\"; this machine decides those.",
  secretRefOutOfScope: "Secret references can only point at server-side variables starting with \"{keys}\".",
  precheckRefused: "This server didn't pass the pre-start checks, so it wasn't added.",

  spawnFailed: "This server didn't start. Check that the command runs on this machine as written.",
  handshakeTimeout:
    "This server didn't answer in time. Either the command isn't an MCP server, or it's waiting on a credential it didn't get.",
  protocolVersionUnsupported: "This server speaks a protocol version this release can't take.",
  protocolError: "We couldn't read what this server sent back.",
  serverRejected: "This server refused the request.",
  callTimeout: "The call timed out.",
  notRunning: "This server isn't running right now.",
  exited: "This server exited part-way through.",
  connectFailed: "Can't reach this server."
} as const satisfies Record<keyof typeof zh, string>;

export type McpServersCopyKey = keyof typeof zh;

/** 占位符替换。词典条目保持纯字符串，值在调用点填。 */
export function mcpServersT(
  key: McpServersCopyKey,
  options: { locale?: WorkHubLocale; values?: Record<string, string> } = {}
): string {
  const isZh = normalizeWorkHubLocale(options.locale ?? "zh-CN") === "zh-CN";
  const template = (isZh ? zh : en)[key];
  const values = options.values;
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => values[name] ?? match);
}
