# R24 S3 严重#4/#7 修复：桌面首启并发幂等死代码 + 新建用户 locale 判优先级

- Status: implemented
- Date: 2026-09-05
- Owner: claude（R24 S3 服务端批，工位 wt-e，分支 r24/e-api-bootstrap-locale）

## Problem

`r24-S3-walkthrough.md`（本机真机走查报告）记了三处服务端问题：

- **严重#7**：走查实测「首启主窗 + 桌宠两个 WKWebView 进程同刻打
  `POST /api/auth/desktop-bootstrap`」，API 日志出现一条真实未捕获 500：
  `Failed query: insert into "workspace_memberships" ...`。根因是
  `apps/api/src/routes/auth.ts` 的 `isUniqueViolation`/`isForeignKeyViolation`
  直接读 `error.code`，但 drizzle-orm 0.45 的 node-postgres 驱动
  （`pg-core/session.js` 的 `queryWithCache`）把裸 `pg` DatabaseError 包进
  `DrizzleQueryError` 的 `.cause`（`throw new DrizzleQueryError(sql, params, e)`），
  顶层 `error.code` 恒为 `undefined`——这个幂等守卫从建库以来就是死代码，唯一冲突
  永远原样冒泡成 500，而不是被 `ensureDefaultWorkspaceMembership` 的 catch 块吞掉。
  全仓 grep 同一读法还命中 `packages/db/src/repositories/drive.ts` 的
  `isActivePathUniqueViolation`、`packages/db/src/repositories/proposals.ts` 的
  `isProposalsUniqueViolation`、`apps/api/src/workers/conversation-observer.ts` 的
  `isUniqueViolation`——四处同一个死代码模式，且后两处已有对应的既存测试用
  **顶层塞 code 的假错误**验证过（这类假错误在生产里并不真实存在，测试一直在验证
  一个不会发生的形状）。
- **严重#4**：服务端新建用户的 `preferred_locale` 恒为 `"zh-CN"`——
  `packages/db/src/repositories/users.ts` 的 `getOrCreateActiveByNickname`（供
  `/identify`、`/desktop-bootstrap` 昵称模式用）在插入时硬编码
  `preferredLocale: "zh-CN"`，完全不看请求方语言；`/register`、
  `/invites/accept` 虽然走的是已支持 `preferredLocale` 可选字段的 `createUser`，
  但路由层从没传过这个字段。`packages/web-runtime/src/locale.ts` 的
  `applyIdentityLocale` 又会用服务端 `identity.locale` 无条件覆盖本地/系统语言，
  于是英文用户首次入驻后，桌面/web 整壳被翻译成中文（走查截图 17/38/46/47 复现）。
- **中 M-07**：设备列表里同名设备（默认都叫 "WorkHub Desktop"）无法分辨。

## Decision

**严重#7（`packages/db/src/pg-error.ts`，新文件）**

- 新增 `findPgError(error, maxDepth=5)`：沿 `error` 自身与其 `.cause` 链查找第一个
  带**字符串** `.code` 属性的对象，深度设上限（防御多层包装/循环引用，正常只包
  一层）；`isPgErrorCode(error, code)` 是最常见用法的简写。同时兼容两种形状：
  历史测试里顶层塞 code 的假错误、生产真实的嵌套包装。
- 从 `packages/db` 导出，四个调用点全部改用它：
  `apps/api/src/routes/auth.ts`（`isUniqueViolation`/`isForeignKeyViolation`）、
  `apps/api/src/workers/conversation-observer.ts`（本地 `isUniqueViolation`）、
  `packages/db/src/repositories/drive.ts`（`isActivePathUniqueViolation`，多判一层
  `.constraint`）、`packages/db/src/repositories/proposals.ts`
  （`isProposalsUniqueViolation`，同样多判 `.constraint`）。**没有改动**
  `ensureDefaultWorkspaceMembership` 本身的吞错逻辑——它的 catch 块早就是对的
  （`isUniqueViolation` 命中就 `return`，达到「输家幂等短路」），只是判定函数从不
  命中；修好判定后这条路径自然生效，不需要额外的「返回既有身份」代码——那部分
  由 `getOrCreateActiveByNickname` 的 `onConflictDoNothing()` 早就正确处理。
- 测试：`packages/db/src/pg-error.test.ts`（新文件，纯函数单测：顶层/嵌套/深度
  上限/非法输入）；`drive-path.test.ts`、`proposals-repository.test.ts`
  各补一条嵌套 `.cause` 用例（原有顶层 code 用例保留，锁死向后兼容）；
  `apps/api/src/conversation-observer.test.ts` 补一条嵌套用例；
  `apps/api/src/auth.test.ts` 补
  `S-04: two racing desktop-bootstrap calls ...`——两次 `app.request` 调用，
  `memberships.findActiveForUserWorkspace` 强制回 `null`（模拟并发可见性窗口），
  `memberships.create` 第二次调用抛出手搭的嵌套 `.cause` 唯一冲突错误，断言两次
  请求都拿到 201 且是同一身份、只留一行 membership。

**严重#4（`apps/api/src/middleware/auth.ts` 新增 `resolveNewUserLocale`）**

判优先级：①请求体显式 `locale`（四个建号端点新增的可选契约字段，
`packages/contracts/src/auth.ts` 的 `workHubLocaleSchema.optional()`，严格
`"zh-CN"|"en-US"` 二选一，不接受宽松变体）> ②没带则看 `Accept-Language`
首选——只取第一段主标签、不管 q 权重，`zh`/`zh-*` 前缀 → `zh-CN`，**其它任何值
（含无法识别的怪值）→ `en-US`** > ③请求方连 `Accept-Language` 都没带，才落旧
默认 `zh-CN`（不改变这个无信号场景，如内部脚本/curl 调用的既有行为）。

只在**真正新建**用户时生效：

- `getOrCreateActiveByNickname` 新增第三个可选参数
  `options?: { preferredLocale?: WorkHubLocale }`——命中 `existing` 分支时
  压根不看它，只有走到 `onConflictDoNothing()` 插入分支才用
  `options?.preferredLocale ?? "zh-CN"`。`/identify`、`/desktop-bootstrap`
  （昵称模式分支）两处路由都在调用前算好 `resolveNewUserLocale` 传进去。
- `/register`、`/invites/accept` 两处总是新建用户（都已有邮箱唯一预检），直接把
  算好的 locale 塞进 `createUserOr409` 的 input（`createUser` 早就支持
  `preferredLocale` 可选字段，未改其签名）。
- **密码模式的 `/desktop-bootstrap`**（会话换设备令牌那条分支）**没有**接
  locale——它操作的是已存在用户（凭会话解析），不建号，不适用这条逻辑。

契约同步：`packages/contracts/src/auth.ts` 四个 schema
（`identifyRequestSchema`/`desktopBootstrapRequestSchema`/
`passwordRegisterRequestSchema`/`inviteAcceptRequestSchema`）新增可选
`locale` 字段；`apps/api/src/openapi.ts` 对应四个手写 JSON-schema 常量同步
（`app.test.ts` 的 openapi 覆盖门只断言 `required` 数组，我加的是可选字段，
不进 `required`，未触发那道门的改动）；`packages/api-client/src/types.ts` 里
本地手写的 `IdentifyRequest`/`PasswordRegisterRequest` 补 `locale?:
WorkHubLocale`（`DesktopBootstrapRequest` 已经是从 `@workhub/contracts`
直接 import，随契约自动带上，不用改）；`invites/accept` 在 api-client 里从来
没有类型化包装方法（只在裸 JSON 白名单里），没有对应类型可改。

**M-07（设备同名不可分辨）—— 核实结论：服务端已具备最小可分辨信息，本项不改代码**

先看了 `packages/db/src/schema/core.ts` 的 `client_devices` 表：只有
`device_name`/`platform`/`last_seen_at`/`revoked_at`/`created_at`/`updated_at`，
**没有 IP 列**（`ip_hash` 只在 `sessions` 表，密码模式会话专用，不在
`client_devices` 上）。`apps/api/src/middleware/auth.ts` 的
`toClientDeviceResponse` **已经**把 `created_at`（即注册时间）、`platform`、
以及有值时的 `last_seen_at` 都放进响应；`GET /api/client-devices/me` 统一走
这个函数。`packages/contracts/src/domain/identity.ts` 的 `clientDeviceSchema`
（继承 `timestampFieldsSchema` 拿到必填 `created_at`/`updated_at`，加
`platform` 必填、`last_seen_at` 可选）确认这是稳定契约，不是临时字段。也就是
说走查报告本身的截图（`47-settings-signout-zh.png`「WorkHub Desktop · desktop ·
15:37/15:44/15:45 · 活跃」）已经在用这几个字段做区分——服务端这一侧没有缺口。
按工单「不加迁移、若已显示时间则本项仅核实并记录，不硬造」的指示，这里**不改
任何代码**。真正让三台设备「看起来一样」的是设备**名字**恒为
`"WorkHub Desktop"`——那是 `client-tauri/src-tauri/src/config.rs` 的
`device_name` 默认值，是桌面壳（Rust）的默认值选择，不是服务端/契约缺口，超出
本工单范围（本工单只做服务端与契约）。

## Alternatives considered

- **严重#7**：只改 `apps/api/src/routes/auth.ts` 一处，不动 drive.ts/proposals.ts/
  conversation-observer.ts——否决。工单明确要求「全仓 grep 其它读 error.code
  判 pg 错误码的地方一并用同一 helper」，且这几处是同一根因、同一时间线的死代码
  （proposals.ts/drive.ts 的既存测试甚至已经在验证一个生产里不会出现的假错误
  形状），只修一处等于把另外三个已知的同款炸弹留在原地。
- **严重#7**：`findPgError` 不设深度上限，无限沿 `.cause` 走——否决，防御性
  上限成本几乎为零（正常只包一层），换来对循环引用/未来多层包装的安全网。
- **严重#4**：复用 `packages/contracts/src/locale.ts` 现成的
  `normalizeWorkHubLocale`——否决。它对无法识别的值兜底 `zh-CN`
  （`defaultWorkHubLocale`），而这里要的语义是「有 `Accept-Language` 但认不出
  是不是中文」一律落 `en-US`，两者默认方向相反：如果复用它，一个 `fr-FR`/
  `ja-JP` 的 `Accept-Language` 会被误判成中文用户，比完全不处理还糟。因此在
  `middleware/auth.ts` 写了一个语义更窄的专用函数，只解析首选主标签、按
  zh/非-zh 二分。
- **严重#4**：给 `getOrCreateActiveByNickname` 建完号后再补一次
  `updatePreferredLocale` 写——否决，多一次往返 + 非原子（两次写之间有可观测的
  「刚建号、locale 还是默认值」窗口）；`CreateUserInput`/插入语句本来就能一次性
  带上 `preferredLocale`，直接在 INSERT 里给对值更简单也更原子。
- **M-07**：借道加 `client_devices.ip_hash` 列或采集 app 版本——否决，工单明确
  「不加迁移」，且当前请求路径压根不采集 IP/版本，硬造一个新采集点超出「核实
  已有信息」的最小范围；服务端已经暴露的 `created_at`/`last_seen_at`/`platform`
  已经足够区分「哪个是最近这次」，真正的可读性缺口在桌面壳的默认设备名，那是另一
  个工单的事。

## Consequences

- `desktop-bootstrap` 并发 500（S-04）修复后，下一次真机走查应该只会看到两条
  `201`，不再有一条 `500` + 一条 `201`；`drive`/`proposals`/
  `conversation-observer` 三处同款死代码一并修好，此前「并发同名 upload」
  「并发同 proposal_id」「observer 重扫撞 items 唯一约束」这几条 TOCTOU 注释
  里描述的 409/幂等路径现在才是真的会走到，而不是继续原样冒泡 500——不过這几处
  没有对应走查复现，只是同根因顺手堵上。
- **遗留（桌面客户端接线点，本工单未做，超出服务端与契约范围）**：
  `apps/desktop-webview` 目前调用 `client.identify()`/`client.bootstrapDesktop()`
  时都没有传 `locale`——契约字段是 additive 的可选项，桌面端需要在这两处调用点
  读取系统/应用语言（Tauri 侧 `client-tauri/src-tauri/src/locale.rs` 的
  `DEFAULT_WORKHUB_LOCALE`目前恒为 `ZhCn`，也需要一并看是否该读系统语言）传进
  请求体，才能让这批服务端修复真正在桌面端生效；这批修复即使桌面端不接线也不
  会更差——没有 `locale` 字段时行为退回 `Accept-Language`/旧默认，与修复前一致，
  纯粹是新增可选项。
- `getOrCreateActiveByNickname` 的仓库接口签名多了一个可选第三参数，是
  additive 变更（TS 结构类型下少参数的实现依然赋值兼容），但测试里的
  `MemoryUsers` 假仓库已经同步更新以真正尊重这个参数——若后续还有其它自定义假
  仓库实现了 `UserRepository`，编译不会报错，但如果他们想测 locale 透传也需要
  照此更新假实现，否则那个假实现里 locale 会被静默忽略（不是 bug，只是没接住
  新参数）。
