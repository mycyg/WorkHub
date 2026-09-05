# F-02/F-03 收尾：权限策略新增/调整 + 设备撤销收口的取舍记录

- Status: implemented
- Date: 2026-09-05
- Owner: claude（R23 p5b 施工批）

## Problem

侦察报告（scout-D-wiring.md）点出两处收口：① 权限策略四端点（GET/PUT/DELETE/ask）
后端与 OpenAPI 早就齐了，SDK 只有 revokePermissionPolicy，桌面设置页只能撤销、不能
新增/调整；② 设备管理五端点齐了，web 已有列表+撤销他机，但代码里明写「本机自撤销
不在本工单范围内，这里不接」，桌面端更是完全没有设备列表。这两处都要不新增迁移、
不改后端契约的前提下补齐前端与 SDK。补齐过程中出现几处非显然的决策点，记录如下。

## Decision

**F-02 SDK 面（api-client）**

- 新增 `listPermissionPolicies`/`createPermissionPolicy`/`askPermission` 三个方法，
  全部标**可选**（`?:`），照 `revokePermissionPolicy` 的既有取舍——避免强迫其它
  workspace 里已经存在的完整 `WorkHubApiClient` 字面量 mock 补一个用不到的桩。
- `listPermissionPolicies` **没有内置消费者**：桌面设置页的列表来源一直是
  `pages.settings()` 的 `permission_policies`（那份 VM 已经够用），新增策略成功后
  按响应里的 `id` 去重合并进本地列表（服务端对等价规则会直接返回已存在的记录，见
  `services/approvals.ts` 的 `findEquivalentActivePolicy`），不必整表重拉。
  `listPermissionPolicies` 留作对齐 4 端点的 SDK 完整面——按
  `2026-08-20-reserved-endpoints-and-sdk-policy.md` 的既定口径，零调用方法属正常
  SDK 面，不因此判定为缺陷。
- `askPermission`（POST /ask，「主动申请审批」）**同样没有 UI 消费者**——它是运行时
  权限判定/审批创建的入口，语义上不属于「新增/调整策略」这件事（那是 PUT），本批
  只补 SDK 方法与测试，不臆造一个假消费场景。真正要接它的是未来某个「AI 想做一件
  没有匹配策略的事」的调用点，不在本工单范围。

**F-02 新增策略表单（桌面设置页）**

- 字段：scope_kind（org/workspace/role/session）× scope_id × action_pattern ×
  effect（allow/deny/ask）× priority；`learned_from_session` 恒送 `false`，不给
  UI 开关——这是系统在审批里自动学出规则时才该置的溯源位，人工新建规则暴露这个
  开关只会造成误解。
- `scope_kind=org/workspace` 时 `scope_id` 必须等于 actor 自己的 org_id/workspace_id
  （服务端 `assertPolicyScopeWithinActorTenant` 强制 403）。桌面当前能拿到的 VM
  （`SettingsPageVM`/`UserAiProfileVM`）里**只有 workspace_id、没有 org_id**——不
  为了这一个字段新开端点或扩契约（超出本工单范围，且会牵动 app.test.ts 的路由
  覆盖门）。取舍：切到 workspace 且 scope_id 尚为空时，用 `aiProfile.workspace_id`
  顺手预填；org/role/session 三档留空 + 占位符文案说明预期格式，真填错了由服务端
  403 兜底，前端不假装能校验。
- effect=deny 且优先级达到 1000 时给出「跨范围强制熔断」的显式警告——这是
  `packages/permissions/src/evaluate.ts` 里 `OVERRIDE_DENY_PRIORITY` 的真实语义
  （连管理员的窄 scope allow 都会被压过），不解释清楚容易被admin 无意中建成一个
  全局熔断。

**F-03 桌面「撤销本机」**

- 桌面设备列表里，当前设备那一行**不调用**任何撤销类 SDK 方法（既不是
  `revokeClientDevice`，也不是 `revokeCurrentClientDevice`），而是复用既有登出/
  重绑状态机 `runDesktopLogout`。原因：服务端 `POST /api/auth/logout` 处理器本来
  就会按当前请求携带的 client-token 撤销这台设备（`apps/api/src/routes/auth.ts`
  的 `if (rawToken) revokeByTokenHash(...)`）——如果先调撤销接口、成功后当前
  client-token 立刻失效，紧接着要发的登出请求自己都认证不了（`findActiveByTokenHash`
  会把已撤销设备的 token 当无效）。直接复用登出状态机既更简单，也避免了这个自己
  给自己断网的坑。
- 撤销他机（非本机）走独立的两段式确认 + `revokeClientDevice`，乐观本地替换
  （REPLACE，不是 FILTER）——撤销后的设备**仍留在列表里**、状态改标「已撤销」，
  与撤销权限策略（撤销后从列表整行摘掉）刻意不同：设备列表本来就是账号的历史留痕
  （GET /me 返回全部曾注册过的设备，不只是活跃的），这个取舍是照抄 web 端
  `settings-devices.ts` 已经确立的 `buildSettingsDeviceRow` 语义，不是新发明。

**F-03 web「撤销本机并登出」**

- web 端从不携带本地客户端 client-token 请求头（`getClientToken` 全仓 grep 只在
  desktop-webview 出现）——这意味着 `POST /api/client-devices/revoke-current` 在
  纯网页会话上**结构性地**唯一可能失败就是 403（`resolveCurrentClientDevice` 抛
  「local client required」）或 404（设备记录已经不在）。这两种不是「出问题了」，
  是「网页本来就没有可撤销的本地客户端设备记录」这件事的正常表现。新纯函数
  `shouldSignOutDespiteRevokeCurrentDeviceFailure`（`apps/web/src/settings-devices.ts`）
  把这两种状态码判定为「继续登出」，其余错误（网络中断/5xx/未知）一律停下、可见、
  可重试——绝不因为一个结构性必然撞见的子步骤失败就悄悄放弃登出，也绝不在真出错时
  假装已经处理好。
- 因为「本机」在纯网页会话上几乎总是探测不到（`currentDeviceId` 恒为 null），这个
  动作**没有绑定到具体某一行设备**，而是设备卡里一个独立的、始终可见的动作行（即便
  设备列表本身是空的也照样渲染），语义上更贴近「登出并顺手撤销可能存在的本地凭证」
  而不是「点某一台设备」。

**web 只读文案（F-02）**

- `/settings` 的自动通过规则卡文案从「撤销需在桌面端操作」改成「新增、调整、撤销
  都在桌面客户端里管理」——桌面现在三件事都能做，旧文案已经不完整。web 侧保持
  纯只读（PUT 要求本地客户端会话，web 结构性做不到），不新增任何写入口。

## Alternatives considered

- **F-02**：让 `listPermissionPolicies` 成为提交后刷新列表的手段（整表重拉）——
  否决，本地按响应 id 去重合并更轻量，且与既有 revoke 的「乐观本地过滤」风格一致；
  整表重拉不会带来任何这批场景下用得上的额外正确性（服务端等价规则收敛已经保证
  响应就是真实结果）。
- **F-02**：为 org 范围新开一个「我的 org_id」端点/字段——否决，超出「两件事」的
  工单范围，且 org 级策略本就是较少用的高权限操作，留给管理员自己填 + 服务端
  403 兜底是可接受的最小实现。
- **F-03 桌面**：撤销本机时先调 `revokeCurrentClientDevice()` 再登出——否决，见
  上面 Decision 里的自断网风险；服务端登出本就会做这件事，重复调用只是徒增一次
  必然因 token 失效而语义诡异的请求。
- **F-03 web**：把 403/404 也当失败显式报错，不自动继续登出——否决，那会让
  「撤销本机并登出」在 99% 的网页场景下变成一个每次都报错、却又无法真正解决
  （网页天生没有本地客户端设备记录）的死胡同按钮，对用户没有意义。

## Consequences

- 桌面与 web 现在对「权限策略」「已登录设备」两个治理面都有对称的读写入口，`web
  只读 + 桌面读写` 的边界（本地客户端会话要求）在文案上说清楚，不再有「界面存在但
  没有任何客户端能用」的死胡同。
- `listPermissionPolicies`/`askPermission` 是刻意保留的零调用 SDK 方法，日后若有
  新调用点直接复用即可；不要因为「零调用」误判成需要删除或标记 experimental（口径
  见 `2026-08-20-reserved-endpoints-and-sdk-policy.md`）。
- 若未来 web 端也长出「本地客户端」概念（例如某种带 client-token 的 PWA 安装态），
  `shouldSignOutDespiteRevokeCurrentDeviceFailure` 的 403/404 折叠仍然成立——那时
  该函数会开始真正撤销一条设备记录，而不再总是命中「结构性无记录」分支，无需改动。
