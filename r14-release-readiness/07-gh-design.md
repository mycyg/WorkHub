# R14 · 批 GH 实现级设计（GitHub 集成）

> 集成裁定（2026-07-14）：批准设计，含 AES-256-GCM+GITHUB_TOKEN_ENC_KEY 密钥方案与 fail-closed 503 语义。迁移 0060=when 1783914000000。GH-A（opus）与 FEEDBACK/RISK 服务端并行发车（journal 尾多方冲突由集成者合并归一，纪律成熟）；GH-B/GH-C 待 GH-A 合入后发。PR 链接字段砍除+标题匹配 stretch 的判断=认。

> 状态：施工设计草稿 · 2026-07-14 · 上游：00-plan.md §2 批 GH（我判断做，未被用户否决）
> 侦察基础：全仓库密钥/加密先例扫描 + project_ai_governance 治理面模式 + 三例 scheduler 范式 +
> project-home/project-health 两个页面 VM + proposal/diff-manifest 契约 + LLM transport 的裸 fetch 惯例 +
> retry.ts 退避先例 + run_command 沙箱白名单（确认无 git/gh）+ 05-risk-design.md（digest 接缝）
> 纪律：04 手册 13 条铁律不变；本稿只读侦察，未改动仓库任何文件。
> 迁移号：**0060**（`when=1783913000000`，集成者预分配；FEEDBACK 占 0058、RISK 占 0059）。

---

## 0. 范围裁定（照抄 00-plan §2 批 GH 原文）

> 项目级绑定 repo（PAT/deploy key，服务端存储加密，桌面端零密钥纪律不变）；轮询为主（自托管无公网
> webhook 也能用），webhook 可选加速。信号消费：commit/PR/issue 动态进项目健康与 Cuu 巡检上下文；军团
> run 产出若关联 PR，链接进提议卡。明确不做：代码托管镜像、CI 状态面板、review 工具——只做「信号进
> 感知」，不重造 GitHub。

本设计对拍板范围做两处**如实收窄**（侦察证实、非曲解）：

1. **「军团 run 产出若关联 PR，链接进提议卡」——查实为不可达，v1 砍掉**。见 §1.6：`run_command` 白名单
   （`packages/tools/src/sandbox.ts:8-18`）不含 `git`/`gh`，agent 循环没有任何写 GitHub 的能力（无 OAuth
   device flow、无 push 凭据下发），`proposal`/`diff_manifest` 契约（`packages/contracts/src/domain/collaboration.ts:32-47`）
   描述的是 WorkHub 自己的交付物变更（drive 文件 diff），语义上就不是 GitHub PR，字段里也没有任何
   external link 位。`command-palette.ts:80` 的 "pr"/"pull request" 只是「提案」搜索关键词同义词，不是接线。
   **v1 只做单向 GitHub→WorkHub 的信号消费；WorkHub→GitHub 的产出回链无地基，不装样子**。
   替代方案（真正可落地、方向不同但满足"让 Cuu 感知外部事实"的精神）：轮询拉到的 commit
   message / PR title 里若能匹配到本项目某个 `work_items.code`（如 `WI-123`），作为**只读关联**挂在该
   工作项详情页（"提到这个工作项的 GitHub 活动"），不是挂在 proposal 卡上、也不是反向写 GitHub。
   这条留作 v1 可选 stretch（§3.5），核心范围不依赖它。
2. **isConfigured 门控不适用**：GH 轮询是纯 HTTP 轮询，不调 LLM，与 05-risk-design.md §0 对「isConfigured
   守卫」的裁定同一逻辑——不应挂在 `getDefaultProviderRegistry().isConfigured()` 后面（那会导致没配 LLM
   key 的自托管实例连 GitHub 轮询这种零 LLM 成本的功能都用不了）。GH 轮询本身也不应默认全局启动，而是
   **逐项目按是否绑定 repo 门控**（见 §5）。

---

## 1. 侦察结论

### 1.1 密钥加密存储先例——**不存在，需要新建**

全仓库扫描 `encrypt|decrypt|aes|kms|cipher`（排除测试文件）零命中。已有的密钥/凭据相关机制全部是
**单向哈希**，不适用于「需要明文取回去调 GitHub API」的 PAT：

- `apps/api/src/auth/password.ts:1-165`：口令用 node 内置 `scrypt`（PHC 风格自描述串 `$scrypt$ln=...$salt$hash`），
  单向、不可逆——用户口令语义上本就不需要解密。
- `apps/api/src/middleware/auth.ts:161-188`：会话 token 用 `randomBytes` 生成 + `createHash("sha256")`
  存哈希（`sessions.token_hash`，`core.ts:170`），同样单向。
- `packages/db/src/repositories/user-credentials.ts:1-40`：只存 `password_hash`/`password_algo`，仓库层
  对哈希策略无感知，语义上排除了可逆场景。
- LLM API key（`LLM_API_KEY`）走 env 变量（`packages/config/src/env.ts:78`），**根本不落库**——进程内存持有，
  从不触碰这个问题。这是 WorkHub 目前唯一的「敏感凭据」，用的是「不落库」策略，而 GH PAT 必须落库
  （项目级、多个、需要持久轮询水位），env 策略不适用。

**结论：需要新建一个最小可逆加密原语，这是本批唯一的新基础设施，其余全部复用既有模式。**

设计（AES-256-GCM + env 主密钥，node 内置 `node:crypto`，零新依赖，与 `password.ts`/`auth.ts` 同样
"零依赖、glibc/musl 无关"的选型哲学一致）：

```ts
// apps/api/src/services/secret-box.ts（新文件，纯函数，无 DB 依赖，可单测）
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 主密钥来源：新 env GITHUB_TOKEN_ENC_KEY（32 字节，base64），与 COOKIE_SECRET 分离——
// 理由：COOKIE_SECRET 泄漏影响面是"能伪造会话"，加密密钥泄漏影响面是"能解密所有项目的 GitHub PAT"，
// 两者威胁模型不同、轮换节奏不同，合用一把钥匙会在轮换其中一个时被迫连带失效另一个的保护。
// 未配置时不崩服务：GH 绑定端点返回 503 + 人话「GitHub 集成未配置加密密钥，见部署文档」——
// 与 FIX 批第8条「无 key 自托管静默死」同一纪律：明确报告，不静默失败、不明文兜底存储。
export type SecretBox = {
  seal: (plaintext: string) => { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  open: (input: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }) => string;
};

export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("GITHUB_TOKEN_ENC_KEY must decode to exactly 32 bytes");
  }
  return {
    seal(plaintext) {
      const iv = randomBytes(12); // GCM 推荐 96-bit nonce
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return { ciphertext, iv, authTag: cipher.getAuthTag() };
    },
    open({ ciphertext, iv, authTag }) {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    }
  };
}
```

- `GITHUB_TOKEN_ENC_KEY` 新 env（`packages/config/src/env.ts` 加一行 `z.string().default("")`；
  `settings.github.tokenEncKey`，仿 `settings.auth.cookieSecret` 挂法）；`.env.example` 加一行注释
  「`openssl rand -base64 32` 生成」。
- 三列落库（不是单个 base64 大字符串）：`pat_ciphertext bytea`、`pat_iv bytea`、`pat_auth_tag bytea`——
  照 `packages/db/src/schema/core.ts:48` 头像批已经引入的 `bytea` customType 复用，三列分开存比拼接成
  一个字符串再切割更不容易在读写两端切错位。
- **评估「要不要 KMS 抽象层」**：不做。这是开源自托管单实例项目（OSS 批定位），真 KMS（AWS
  KMS/HashiCorp Vault）会引入新的外部依赖/新的自托管门槛，与 SEARCH 批「不引 zhparser 因为自托管装
  扩展门槛劝退贡献者」同一judgment call。`GITHUB_TOKEN_ENC_KEY` 是够用的最简方案：加密密钥与数据库
  分开保管（env vs DB dump），数据库泄漏不等于 PAT 泄漏，这是关键威胁模型改善点；密钥本身泄漏是另一
  个话题（部署方的运维责任，与 `COOKIE_SECRET`/`ADMIN_CLAIM_SECRET` 现状同一档次）。

### 1.2 项目设置面——治理端点/UI 已有成熟模式，GH 绑定卡挂靠同一落点

- 端点范式：`GET/PATCH /api/projects/:id/ai-governance`（`apps/api/src/routes/ai-settings.ts:56-68`）。
  访问收口在仓库层 `activeProjectOwnerCondition`（`packages/db/src/repositories/ai-settings.ts:277-285`）：
  **严格 `projects.ownerUserId === actor.userId`，无 isAdmin 旁路**（`ai-settings.ts:388-396` 的
  `findProjectGovernanceAccessRecord` 查询里 admin 也没有特殊分支）。GH 绑定的写操作（绑定/解绑/改
  PAT）**照抄同一收紧程度**——PAT 比 AI 治理开关敏感得多，没有理由比治理设置更松。
- UI 落点：`apps/desktop-webview/src/workbench/settings/{render,api,view}.ts`——项目 AI 治理是当前唯一
  的"项目级设置"分区，`render.ts:129` 的分区标题旁注明"项目负责人可见可改，非负责人只读"。GH 绑定卡
  加在同一个设置视图里（新分区，紧邻治理分区），复用同一套「project owner 可编辑/其余人只读」UI 态
  （`view.ts` 已有 `input.editable` 贯穿判断，直接复用）。
- **web 端无对应 UI**（`apps/web/src/routes.ts` 未挂 governance 相关路由）——与 CHAT 批"聊天归桌面"
  同一先例："项目级 AI/集成配置归桌面"，web 只读消费（项目主页/健康页）。GH 绑定的写操作**不在
  web 端实现**，与治理设置现状对齐，不是本批引入新的双端不一致。

### 1.3 轮询 worker 范式 + rate limit 意识

三例 scheduler 骨架（05-risk-design.md §1.1 已系统梳理，此处只摘 GH 特有的增量点）：
`createXScheduler` 返回 `{tick,start,stop,stats}`、`running` 重入守卫、`timer.unref?.()`、薄 worker+
厚 service 二层结构（`workers/risk-monitor.ts` 30 行壳 + `services/risk-monitor.ts` 纯函数
`runOnce()`）——**GH worker 照此结构**：`services/github-sync.ts`（`runOnce()`，纯依赖注入可单测）+
`workers/github-sync.ts`（调度壳）。

**节流/水位设计**：

- **每绑定项目独立水位**（不是全局一个 cursor）：`project_github_bindings` 存三个水位列
  `last_synced_at`（本次成功轮询完成时刻）、`commits_since`（下次 `since` 参数，取本次拉到的最新
  commit 时间）、`etag_json`（三个列表端点各自的 ETag，见下）。
- **GitHub REST v3 三个端点的增量参数不对称**（这是设计里最容易踩坑的点，必须分别处理）：
  - `GET /repos/{owner}/{repo}/commits?since=<ISO8601>&per_page=50`——原生支持 `since`，最干净。
  - `GET /repos/{owner}/{repo}/issues?since=<ISO8601>&state=all&per_page=50`——原生支持 `since`，但
    **该端点会把 PR 也混进结果**（GitHub 的历史包袱：issue 是 PR 的超集），响应里每条有 `pull_request`
    字段的即为 PR，要在应用层过滤/分流，不能直接当 issue 落库。
  - `GET /repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=50`——**不支持
    `since`**，只能拉一页按更新时间倒序的列表，本地判断"是否已经追上水位"（`updated_at <=
    last_synced_pr_updated_at` 即可停止翻页，因为已按 updated 降序）。**建议 v1 只用 issues 端点的
    PR 子集做 PR 信号**（同一次请求省一个端点的配额，issues 端点返回的 PR 条目已经带
    `state`/`title`/`html_url`/`updated_at`，够用；`pulls` 端点独有的字段如 merge 状态细节 v1 不需要），
    `pulls` 端点列为**可选增强、非 v1 必需**，省一次请求换更简单的实现。
  - **ETag 缓存**：三个端点都支持 `If-None-Match` + 响应 `ETag`，命中 304 时**不消耗 rate limit 配额**
    （GitHub 文档保证的行为）——每个端点独立存 ETag（`etag_json: {commits, issues, pulls}`），下次请求
    带上，304 即跳过本次解析、只推进 `last_synced_at`。
- **rate limit 意识**：PAT 认证请求 5000/h（GitHub 文档口径）。设计轮询间隔为**每绑定项目 15 分钟一次**
  （不是全局一次 tick 扫全部项目就完事——tick 本身可以 1 分钟跑一次，但对每个绑定项目按
  `now - last_synced_at >= 15min` 才真正发请求，与 RISK worker "1 小时 tick、按 dedupeKey 天然节流"
  同一节奏哲学但间隔更短，因为 commit/PR 活动比风险信号更适合准实时）。3 个端点 × 每 15 分钟 × 4
  次/小时 = 每绑定项目 12 次/小时（ETag 命中时不算真实配额消耗，是"检查"不是"计费"——按 GitHub 文档，
  304 响应仍计入 rate limit 请求数但不算「使用」在某些工具语境下的说法不一，保守按"仍计入 5000 配额"
  估算：12 次/小时/项目，5000/h 配额下可支撑约 **400 个绑定项目同时轮询**，对内部研发团队/开源自托管
  单实例规模綽綽有余，不需要 v1 就做多 PAT 分池)。
- **退避复用既有先例**：`packages/agent/src/providers/retry.ts` 的 `nextRetryDecision`/
  `parseRetryAfterMs`（`@workhub/agent` 已导出，`apps/api` 已依赖该包，如 `agent-runner.ts` 直接复用）
  **可以直接拿来用**——它是状态码/header 驱动的通用 HTTP 重试判定（429/5xx 可重试、读
  `Retry-After` header、指数退避+封顶），不是 LLM 专属逻辑，虽然命名在 `providers/` 目录下但语义
  完全通用。GH 客户端额外加一层 GitHub 特有的判断（`nextRetryDecision` 不认得的）：
  `X-RateLimit-Remaining: 0` 时不管状态码是不是 403，都从 `X-RateLimit-Reset`（unix 秒）算等待时长，
  这个检查在调 `nextRetryDecision` **之前**短路。
- **失败降级不骚扰**（拍板要求）：单个项目本次轮询失败（网络错误/PAT 失效/repo 改名 404）——`runOnce()`
  该项目候选 catch 后计入 `failed`，**不推进水位**（下次重试从同一水位起）、**不发通知**（轮询失败是
  运维噪音，不是要用户处理的信号；但连续失败 N 次后——如连续 5 次 24 小时——可选降级为「binding
  状态标记 `last_error`」，UI 端在设置卡里静态显示"最近一次同步失败：<时间>+<原因摘要>"，不主动推送）。
  这条与 RISK 的"会话播报失败只告警不重试"同一取舍方向。

### 1.4 信号落地点

- **项目健康页**（`apps/api/src/services/project-health-pages.ts:1-205`）是**跨项目汇总列表**（每项目
  一张卡、5 个 count+band 信号），走 `projectHealthSignalKeySchema` 枚举
  （`packages/contracts/src/pages.ts:570-576`）+ 固定阈值表（`pages.ts:580-586`）。**这个页面的形状
  不适合塞 GitHub 活动**——它是"数一数有多少个 XX"的计数卡片，不是时间线；给它加一个
  `github_activity` 信号在语义上说得通（"最近 N 条未读活动"），但**只有绑定了 repo 的项目才有意义，
  未绑定项目该信号天然为 0**，不会破坏现有卡片结构，是**可选增量**（§3.4），非本批阻塞项。
- **项目主页**（`apps/api/src/services/project-home-pages.ts:1-234`）是**单项目深度页**，已有
  `drive.recent_files`（§184-189，"最近文件+跳转链接"模式）——**这才是 GitHub 活动的天然落点**：
  新增 `github?: {repo_full_name, recent_activity: [{kind, title, url, occurred_at}], sync_status}`
  区块，照抄 `recent_files` 的"展示切片+总数+外链"手法（§3.4 详细字段）。未绑定项目该字段整体缺省
  （optional，不是空数组——"没绑定"和"绑定了但没活动"要能区分，前者不渲染整个区块，后者渲染"暂无
  最近活动"）。
- **Cuu 巡检上下文 = RISK 批 digest 的接缝**（05-risk-design.md §3.5 `RiskDigestSignal` 是一个判别
  联合 `{kind:"stalled"}|{kind:"deadline"}|{kind:"cost_spike"}`，`buildRiskDigest()` 消费一个数组）。
  **v1 不在这批直接扩这个联合**——理由：RISK 批设计已"批准"且大概率已进施工/合入（`git log` 显示
  `5b2c7be0 docs(r14): RISK patrol worker design` 已是最新提交之一，晚于 CHAT/MEM/SEARCH），本批（GH）
  排在 RISK 之后开工（00-plan §1 依赖序表已写明"建议放 RISK 后"），此时去改一个刚定稿/可能已在合并
  中的批次的核心判别联合，是跨批次冲突面，不符合"围栏纪律"。**正确的接缝方式是留一个未来钩子而非
  现在就焊死**：`packages/db/src/repositories/risk-monitor.ts`（RISK 批产物）的
  `listProjectsPendingDigest` 已经按项目分组读 governance；GH 批只需保证
  `project_github_bindings` 表**可以被未来的 RISK v2 用 `project_id` 简单 JOIN 查询**（不设计任何
  依赖 RISK 内部类型的耦合）。本设计在 §3.4 给出一个独立的
  `listStaleReposSinceThreshold(projectIds, thresholdDays)` 查询函数作为**未来 RISK 扩展点的候选
  签名**（"这个项目绑了 repo 但 N 天没有新 commit，尽管工单在 ai_working"——这是一个真正有 PM 价值
  的新风险信号，但**不在本批实现落库消费**，只在设计里标注钩子位置，避免与 RISK 批的施工窗口打架）。
- **提议卡 PR 链接字段**：已在 §0 结论——**查实不存在，v1 明确不做**，替代为工单详情页的只读关联
  （§3.5 stretch）。

### 1.5 GitHub API 客户端选型——裸 REST，零 SDK 依赖

- 全仓库唯一的外部 HTTP 客户端先例是 LLM provider transport
  （`packages/agent/src/providers/anthropic-compatible.ts:471-529`）：**裸 `fetch`**（`fetchImpl`
  可注入，默认 `globalThis.fetch`）+ `AbortSignal.timeout`/`AbortSignal.any` 做超时+外部取消合成
  + 显式 `assertOk()` 检查状态码抛自定义错误类（`LlmHttpError`）。**无 axios/undici 直连/任何第三方
  HTTP 库**，`package.json` 里也没有任何 http-client 类第三方包（这是刻意的零依赖姿态，OSS 批"密钥
  卫生+精简依赖"的开源门面定位与此一致）。
- **不用 octokit**（`@octokit/rest` 一个包会拖入十几个传递依赖，且它的分页/认证/webhook 校验能力
  对 v1 的 3 个只读列表端点是过度设计）。**推荐裸 REST v3**，最小端点集：
  1. `GET /repos/{owner}/{repo}`——测试连接用（验证 PAT 能读到这个 repo，顺带拿 `default_branch`/
     `private` 展示在绑定卡上）。
  2. `GET /repos/{owner}/{repo}/commits?since=&per_page=`
  3. `GET /repos/{owner}/{repo}/issues?since=&state=all&per_page=`（含 PR 子集，见 §1.3）
  - 头部：`Authorization: Bearer <pat>`、`Accept: application/vnd.github+json`、
    `X-GitHub-Api-Version: 2022-11-28`（GitHub 现行推荐做法，固定版本号防止 GitHub 侧行为漂移影响
    轮询稳定性）。
- 新文件 `apps/api/src/services/github-client.ts`，函数式（`createGithubClient(deps)`，`deps.fetchImpl`
  可注入，与 LLM transport 同款测试手法），返回
  `{getRepo, listCommitsSince, listIssuesSince}` 三个方法，每个方法内部处理 ETag/rate-limit
  header 读取 + `nextRetryDecision` 调用，返回统一的
  `{items, notModified: boolean, newEtag?, rateLimitRemaining}` 形状。

### 1.6 网络边界

- **本 agent（我，侦察者）所在的开发沙箱断网**：`~/.claude` memory
  `workbench-browser-verify-harness.md` 记录"Bash 工具沙箱内起的 API 出不了网（undici fetch
  failed）——要真调用必须 dangerouslyDisableSandbox"。这是**这次侦察会话所在环境**的限制，不是
  WorkHub 生产/CI 环境本身的限制，但佐证了同一件事：**任何依赖真实出网的验证都不能在默认沙箱里做**，
  施工/验收阶段测试 GitHub 轮询必须走 mock，不能指望"真跑一次连 GitHub"作为 CI 门禁的一部分。
- **测试 mock 方式=已有定式，直接复用**：`packages/agent/src/providers/providers.test.ts:198-502`
  全部通过 `fetchImpl: typeof fetch = async (url, init) => {...}` 注入假响应（`Response` 对象/
  抛错模拟超时），**没有 nock/msw 之类的 HTTP mock 库**，`package.json` 里也没有。GH 客户端测试照抄
  同一手法：`createGithubClient({fetchImpl: async () => new Response(JSON.stringify([...]), {status:
  200, headers: {etag: '"abc"'}})})`，覆盖：200 首次拉取、304 ETag 命中、403+`X-RateLimit-Remaining:0`
  退避、404（repo 被删/改名/PAT 权限不够）、5xx 重试、网络异常（`fetchImpl` 直接 reject）。
- **CI/pilot 环境本身是否断网**：仓库内没有找到 CI 配置显式声明沙箱网络策略的文档（`.github/
  workflows/*` 未在本次侦察范围深挖，超出任务给定的文件:行号精确度要求），但**不需要知道答案**——
  设计已经保证 GH worker 的默认状态是"没有绑定任何项目 = 一次真实请求都不发"（§5 的空转 tick 提前
  return），CI 跑测试时只要不真的插入一条 `project_github_bindings` 行并等 worker tick，就不会触发
  真实出网，测试全部走 `runOnce()` 的依赖注入直接单测（同 RISK/reply-judge 的既有测试哲学，不碰真
  scheduler 的 `setInterval`）。**禁止真网测试的红线本设计天然遵守，无需额外防护栏**。

---

## 2. 数据模型（迁移 0060）

`0060_project_github_bindings.sql`，journal `idx=60`、`when=1783913000000`、
`tag=0060_project_github_bindings`。

### 2.1 绑定表：单表存配置+密态凭据+轮询水位（不拆表）

```sql
-- R14 批 GH：项目级 GitHub 仓库绑定——配置、加密 PAT、轮询水位放同一行（不是三张表），
-- 因为它们的读写生命周期一致（改配置/转 PAT/水位推进都是"这个绑定的状态"，拆表只会徒增 JOIN）。
CREATE TABLE "project_github_bindings" (
  "project_id" uuid PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
  "repo_full_name" varchar(255) NOT NULL, -- "owner/repo"
  "pat_ciphertext" bytea NOT NULL,
  "pat_iv" bytea NOT NULL,
  "pat_auth_tag" bytea NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- 轮询水位：每类信号独立 since 时间戳 + 每端点独立 ETag（jsonb 存三键，见 §1.3）
  "commits_since" timestamptz,
  "issues_since" timestamptz,
  "etag_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at" timestamptz,
  "last_error" text, -- 最近一次失败摘要（人话，不含 PAT/堆栈），成功后清空
  "last_error_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
```

**取舍：PRIMARY KEY 直接用 `project_id`（一对一），不设自增 id**——一个项目只绑一个 repo（拍板范围
"项目级绑定 repo"是单数），照 `project_ai_governance` 同款一对一形状（`core.ts:792` 该表主键也是
`project_id`），风格一致、query 更简单（不需要"这个项目当前生效的绑定是哪条"的额外判定）。

### 2.2 活动落地表：独立小表，不进 notifications/audit_logs

```sql
-- 轮询拉到的原始活动条目——独立表而非塞进 audit_logs/notifications，理由见下方取舍说明。
CREATE TABLE "project_github_activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "kind" varchar(16) NOT NULL, -- 'commit' | 'issue' | 'pull_request'
  "external_id" varchar(128) NOT NULL, -- commit sha / issue或PR number（转字符串）
  "title" text NOT NULL, -- commit message 首行 / issue-PR 标题
  "author_login" varchar(255),
  "html_url" text NOT NULL,
  "state" varchar(32), -- issue/PR: open/closed/merged；commit 恒 null
  "occurred_at" timestamptz NOT NULL, -- commit: author date；issue/PR: updated_at
  "related_work_item_id" uuid REFERENCES "work_items"("id") ON DELETE SET NULL, -- §3.5 stretch，v1 可选
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_github_activities_dedupe_uq" UNIQUE ("project_id", "kind", "external_id")
);
CREATE INDEX "project_github_activities_project_occurred_idx"
  ON "project_github_activities" ("project_id", "occurred_at" DESC);
```

**取舍说明（回应侦察任务1"github_events 落地表还是直接进既有信号表"）**：

- **不进 `notifications`**：notifications 是"给某个用户的待处理提醒"，一条 commit 不是提醒，是
  背景事实；把每条 commit 落成一条通知会在活跃 repo 下瞬间刷爆通知收件箱，语义和体量都不对。
- **不进 `audit_logs`**：audit_logs 是"WorkHub 内部实体变更的审计轨迹"（`entity_type`/`entity_id`/
  `action` 三元组描述的是"谁在 WorkHub 里做了什么"），GitHub commit 是外部世界的事实，混进同一张表
  会让审计查询（"谁删除了这个工单"）意外掺进外部噪音，且 audit_logs 没有 `(kind, external_id)` 唯一
  约束这种"增量同步去重"需要的形状，硬塞要么破坏其索引设计要么新增一堆 nullable 列专门为 GH 服务。
- **新建独立小表是对的**：`(project_id, kind, external_id)` 唯一约束是**增量轮询天然需要的幂等
  写入原语**（`INSERT ... ON CONFLICT DO NOTHING` 或 `DO UPDATE` 更新 state/title——PR
  从 open 变 merged 需要更新已存在行的 `state`，不是插入新行）。这与 `notifications`
  的 `dedupe_key` unique 是同一设计手法（05-risk-design.md §1.4 已指出的"天然去重点"），只是这里
  的"重复"判定键是 `(project_id, kind, external_id)` 而非时间维度的 `dedupe_key` 字符串。
- **体量评估**：一个活跃 repo 每天几十条 commit/issue/PR 活动，独立小表 + 索引，即使跑一年也就几万行
  每项目，Postgres 完全无压力，不需要 v1 就做保留策略/分区；未来若真的成为问题（数百个绑定项目、
  多年积累），加一条"只保留最近 N 条/最近 M 天"的定期清理任务是纯粹的后续优化，不影响本设计的表结构。

### 2.3 契约（新文件 `packages/contracts/src/domain/github.ts`）

```ts
export const githubBindingRequestSchema = z.object({
  repo_full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/u, "expected owner/repo"),
  personal_access_token: z.string().min(20).max(512) // 只写不回读——见 §4
}).strict();
export type GithubBindingRequest = z.infer<typeof githubBindingRequestSchema>;

export const githubBindingStatusVmSchema = z.object({
  project_id: idSchema,
  repo_full_name: z.string().optional(), // 未绑定时缺省
  bound: z.boolean(),
  enabled: z.boolean().optional(),
  last_synced_at: isoDateTimeSchema.optional(),
  last_error: z.string().optional(), // 人话摘要，从不含 token 片段
  activity_count_7d: z.number().int().nonnegative().optional()
});
export type GithubBindingStatusVM = z.infer<typeof githubBindingStatusVmSchema>;

export const githubTestConnectionResultSchema = z.object({
  ok: z.boolean(),
  repo_default_branch: z.string().optional(),
  repo_private: z.boolean().optional(),
  error: z.string().optional() // ok=false 时人话原因："PAT 无效或已过期"/"repo 不存在或无权访问"等
});
```

**PAT 只写不回读的落地方式**：`githubBindingStatusVmSchema` 里**没有任何 token 字段**——不是"脱敏成
`ghp_****`"，是**该 schema 根本不含这个位置**，从类型层面杜绝「写完之后哪个响应不小心把密文/明文
带出去」这类事故（比脱敏字符串更强的保证：脱敏逻辑可能被漏改，字段不存在则无从泄漏）。

---

## 3. 端点与服务（`apps/api/src/routes/github-bindings.ts`，不挂载；`services/github-bindings.ts`）

| 端点 | 语义 | 权限 | 成败 |
|---|---|---|---|
| `PUT /api/projects/:id/github-binding` | 绑定或更新（含换 PAT） | 仅 project owner | 201/200（复用同一路由区分新建/更新）/ 403(非owner) / 404(项目不存在) / 422(repo_full_name 格式错) / 503(未配置加密密钥) |
| `DELETE /api/projects/:id/github-binding` | 解绑（物理删行，含活动表 cascade） | 仅 project owner | 204 / 403 / 404 |
| `GET /api/projects/:id/github-binding` | 读绑定状态（**不含 PAT**） | 项目可见者（`canViewProjectDrive` 同口径，读比写松） | 200 `GithubBindingStatusVM`（未绑定时 `bound:false`，其余字段缺省）|
| `POST /api/projects/:id/github-binding/test` | 测试连接（用当前已存 PAT，或 body 里临时传一个待验证的 PAT，不落库） | 仅 project owner | 200 `GithubTestConnectionResult`（`ok` 可能为 false，不是 HTTP 层错误——"连接失败"是正常业务结果，不是异常）|

**§3.1 `PUT` 的绑定流程**（`services/github-bindings.ts`）：

1. `requireProjectOwner`（照抄 `readGovernanceAccess` 的 `activeProjectOwnerCondition` 收紧程度）。
2. `githubBindingRequestSchema.parse()`。
3. **绑定前必须先测试连接**（不是"先存后台异步验证"）——调 `githubClient.getRepo(repo_full_name,
   pat)`，失败直接 422 返回人话原因（"PAT 无效"/"repo 不存在或无访问权限"/"网络错误，稍后重试"），
   不写入任何行。这是同步校验，用户提交时立刻知道对错，不是"存了但轮询要等 15 分钟才发现绑错"。
4. 测试通过后：`secretBox.seal(pat)` → 三列密文写入（`ON CONFLICT (project_id) DO UPDATE`，重新绑定
   即覆盖旧密文+重置水位——换 repo 或换 PAT 都视为"重新开始"，不带着旧仓库的水位去拉新仓库）。
5. 响应 `GithubBindingStatusVM`（不含 PAT）。

**§3.2 `test` 端点的两种用法**：body 带 `personal_access_token` 时验证这个临时值（表单填完提交前先
"测试连接"按钮的场景，不落库）；body 为空时验证已存的 PAT（"这个绑定还活着吗"手动重新探测，绑定卡
上的"重新测试"按钮）。两种情况都不修改 `last_synced_at`/水位（那些只由轮询 worker 推进，测试连接是
用户触发的即时探测，与后台轮询的状态机分开，避免"手动点了测试"意外影响轮询节奏）。

**§3.3 权限收口对齐**：`GET`（读状态）用 `canViewProjectDrive` 同口径（项目成员皆可见"绑了哪个
repo/上次同步时间"，这是团队协作透明度，不是敏感信息）；`PUT`/`DELETE`/`test` 全部收紧到 project
owner-only（与 ai-governance 完全同一收紧程度，PAT 管理理应比只读状态更严）。

---

## 4. 轮询 worker（`apps/api/src/workers/github-sync.ts` + `services/github-sync.ts`）

### 4.1 `runOnce()` 骨架

```ts
export type GithubSyncRunResult = {
  scanned: number;       // 本 tick 判定"到该轮询"的绑定数
  synced: number;        // 成功完成一轮拉取（无论有没有新活动）
  skipped_not_due: number; // 未到 15 分钟间隔，本 tick 跳过
  failed: number;
  started_at: string;
  finished_at: string;
};

export async function runOnce(deps: GithubSyncDeps): Promise<GithubSyncRunResult> {
  const bindings = await deps.repo.listEnabledBindings(); // enabled=true 全部，不分页（自托管规模小）
  const due = bindings.filter((b) =>
    !b.lastSyncedAt || deps.now().getTime() - b.lastSyncedAt.getTime() >= deps.intervalMs
  );
  let synced = 0, failed = 0;
  for (const binding of due) {
    try {
      await syncOneProject(deps, binding);
      synced += 1;
    } catch (error) {
      failed += 1;
      await deps.repo.recordSyncFailure(binding.projectId, humanizeGithubError(error), deps.now());
      deps.logger.warn("github_sync_failed", { projectId: binding.projectId, error });
      // 单个绑定失败 continue，不连累其余候选——同三例 scheduler 的既有纪律。
    }
  }
  return { scanned: due.length, synced, skipped_not_due: bindings.length - due.length, failed, ... };
}
```

### 4.2 `syncOneProject` 内部步骤

1. `secretBox.open()` 解出明文 PAT（**只在这一个函数调用栈内存活，用完立即让引用离开作用域**；
   **绝不 `logger.info`/`console.log` 打印任何变量可能含 PAT 的对象**——这是安全红线，见 §6）。
2. 依次调 `githubClient.listCommitsSince(repo, pat, {since: binding.commitsSince, etag:
   binding.etagJson.commits})`、`listIssuesSince(repo, pat, {since: binding.issuesSince, etag:
   binding.etagJson.issues})`。
3. 每个返回的条目 `upsertActivity()`（`ON CONFLICT (project_id, kind, external_id) DO UPDATE SET
   title=excluded.title, state=excluded.state` ——只更新会变的字段，`occurred_at`/`html_url`
   不会变不需要覆盖）。
4. §3.5 stretch 若启用：对每条新 upsert 的活动跑 `matchWorkItemCode(title, projectWorkItemCodes)`
   正则匹配，命中则回填 `related_work_item_id`（批量预取该项目全部 `work_items.code` 到内存 Set 后
   逐条判断，避免逐条查库）。
5. 推进水位：`commits_since = 本批最新 commit 的 author date`（若本批为空，水位不动——没有新数据不
   代表"现在"就是新水位，要防止 clock skew 导致漏拉下一批边界数据；`etag_json` 每端点独立更新）。
6. `last_synced_at = now()`、`last_error = null`（成功后清空上一次的失败记录）。

### 4.3 `workers/github-sync.ts` 调度壳

照抄 `workers/risk-monitor.ts` 30 行结构。**tick 间隔 = 5 分钟**（不是每绑定项目的 15 分钟同步间隔——
两者是不同维度：tick 频率决定"多快发现某个绑定到期该同步了"，同步间隔决定"每个绑定多久真正打一次
GitHub"；5 分钟 tick + 15 分钟同步间隔，意味着最坏延迟 20 分钟，可接受）。

```ts
export function getDefaultGithubSyncScheduler(): GithubSyncScheduler {
  // db = getSharedDatabaseClient().db
  // repo = createGithubBindingRepository(db)
  // client = createGithubClient({}) // 默认 fetchImpl
  // secretBox = settings.github.tokenEncKey ? createSecretBox(settings.github.tokenEncKey) : undefined
  // intervalMs = 5 * 60 * 1000（tick 频率，DEFAULT_TICK_INTERVAL_MS）
  // 若 secretBox 未配置：scheduler 仍可 start()，但 runOnce() 内部空转（listEnabledBindings 前先查
  //   secretBox 是否存在，不存在直接 return 空结果 + 一次性 warn 日志，不逐 tick 刷屏）——
  //   这样"没配加密密钥"不会导致进程崩溃，只是这个功能实质关闭，与 §1.1 的 503 端点行为一致口径。
}
```

### 4.4 `server.ts` 接线

```ts
import { getDefaultGithubSyncScheduler } from "./workers/github-sync.js";
// ...
const githubSyncScheduler = getDefaultGithubSyncScheduler();
githubSyncScheduler.start(); // 不经 isConfigured——理由见 §0 结论2
// shutdown(): githubSyncScheduler.stop();
```
挂在 `recoveryScheduler`/`sessionSweepScheduler`/`riskMonitorScheduler` 同一档（无条件启动、内部
自行判断要不要真正干活），不挂在 `conversationObserverScheduler` 那一档（isConfigured 门控）。

---

## 5. 信号消费

### 5.1 项目主页新增区块（`project-home-pages.ts`，additive）

```ts
// ProjectHomePageVM 新增可选字段
github?: {
  repo_full_name: string;
  recent_activity: Array<{
    kind: "commit" | "issue" | "pull_request";
    title: string;
    html_url: string;
    occurred_at: string; // ISO
    state?: string;
  }>; // 展示切片，cap 8（照 recent_files 的 RECENT_FILE_LIMIT=5 手法，GH 活动条目更短所以给多一点）
  activity_count_total: number;
  last_synced_at?: string;
  sync_status: "ok" | "error" | "never_synced";
}
```
未绑定项目 `github` 字段整体不出现（不是 `null`/空对象——"这个项目没有 GitHub 集成"和"有集成但取数
失败"是不同的展示状态，前者不渲染区块，后者渲染区块+错误态提示）。取数：新增仓库查询函数
`listRecentActivitiesByProject(projectId, limit)`，`project-home-pages.ts` 的 `Promise.all` 并行取数
列表里加一项，取数失败**不拖垮整个项目主页**（照抄 §154-166 军团 pill 的 try/catch 静默降级手法）。

### 5.2 项目健康页——v1 不改（见 §1.4 理由），仅记录扩展点供未来批次引用

`projectHealthSignalKeySchema` 若未来要加 `github_stale` 信号，阈值/target_href 要素齐全，落点
明确在 `packages/contracts/src/pages.ts:570-586`，本设计不动它。

### 5.3 RISK digest 扩展钩子——v1 不做，只留查询函数签名供未来引用

`packages/db/src/repositories/github-bindings.ts` 额外导出（不被本批任何调用方使用，纯粹为未来
RISK v2 准备的独立可测函数，不产生跨批次运行时耦合）：

```ts
export async function listStaleReposSinceThreshold(
  db: WorkHubDb,
  input: { projectIds: string[]; thresholdDays: number; now: Date }
): Promise<Array<{ projectId: string; lastActivityAt: Date | null }>> {
  // FROM project_github_bindings b
  // LEFT JOIN LATERAL (
  //   SELECT MAX(occurred_at) AS last_activity_at FROM project_github_activities
  //   WHERE project_id = b.project_id
  // ) a ON true
  // WHERE b.project_id = ANY(:projectIds) AND b.enabled = true
  //   AND (a.last_activity_at IS NULL OR a.last_activity_at < :now - :thresholdDays days)
}
```

### 5.4 提议卡 PR 链接——v1 不做（见 §0），替代 stretch：工单关联

`related_work_item_id` 列（§2.2）+ `matchWorkItemCode()` 纯函数（正则匹配 commit message/issue-PR
标题中的工单 code）已在 §4.2 步骤4 埋好落库位置。**v1 消费端只做最小可见性**：工单详情页
（若有，本次侦察未深入工单详情 VM 结构，留给施工阶段核实挂载点）加一个可选的"相关 GitHub 活动"列表
（若 `related_work_item_id` 命中该工单则显示），无命中则整个区块不出现。这是 stretch，不设验收门，
不阻塞本批合入。

---

## 6. 安全红线

1. **PAT 全生命周期不明文落库/不明文入日志**：`secretBox.seal()` 是写入前唯一入口，`open()` 只在
   `syncOneProject`/`test` 端点两处调用栈内瞬时存在。全仓库任何 `logger.*`/`console.*` 调用点传入
   binding 相关对象前，必须显式挑字段（不能 `logger.info("x", {binding})` 整对象序列化——密文
   `bytea` 序列化成日志虽不是明文但仍是敏感物料，同样禁止整对象打印）。
2. **响应 VM 结构性排除 PAT**：`githubBindingStatusVmSchema` 没有 token 字段（§2.3），任何后续加字段
   的 PR 若想加回明文/密文位置，走 contracts 层 review 会立刻显眼（这是"结构不允许"比"记得脱敏"更
   强的防线，同 R14 CHAT 批"响应永不回明文/密文"的字面要求）。
3. **加密密钥与数据分开保管**：`GITHUB_TOKEN_ENC_KEY` 是 env（进程内存/部署方 secret 管理），数据库
   dump 泄漏不直接等于 PAT 泄漏（除非攻击者同时拿到 env）。
4. **未配置加密密钥时 fail-closed，不降级明文存储**：§1.1/§4.3 已述——宁可整个 GH 功能不可用，也
   不做"没配密钥就先存明文，以后再补"的妥协（那种妥协在开源自托管场景下极易变成"永远没人补"）。
5. **桌面/web 客户端零密钥纪律不变**：PAT 只在服务端存在（用户在设置表单里输入，POST 到服务端后
   服务端立即加密落库，明文不在客户端本地存储/不在 SSE 事件里出现）；桌面端渲染绑定卡时只拿
   `GithubBindingStatusVM`（不含 PAT），与 LLM key 的"服务端 env 持有，客户端从不看见"同一纪律的
   项目级变体。
6. **测试连接的临时 PAT 不落库、不出现在日志**：`POST .../test` 若 body 带 `personal_access_token`，
   这个值只用于当次 `githubClient.getRepo()` 调用，函数返回后不持有引用；请求体本身走 HTTPS（部署
   前提），应用层不额外记录 request body。
7. **删除绑定即物理删除凭据**：`DELETE` 端点删的是整行（含三个密文列），不是软删——PAT 一旦解绑，
   没有理由继续保留密文（即使加密，也是"能力上可被恢复解密"的风险面，解绑即销毁更干净）；
   `project_github_activities` 走 `ON DELETE CASCADE` 一并清理（活动数据脱离了绑定关系就是孤儿数据）。

---

## 7. 明确不做（照抄 00-plan §2 批 GH + 本设计新增的收窄）

- 代码托管镜像、CI 状态面板、review 工具——只做信号进感知，不重造 GitHub（00-plan 原文）。
- **军团 run 产出反向创建/链接 GitHub PR**（§0 结论1，查实无地基，v1 砍）。
- webhook 接收端（拍板"可选加速"，v1 不做，轮询已满足"自托管无公网也能用"的核心约束；未来若要做，
  是独立的新端点+签名校验，不影响本设计的轮询主链路，可平行叠加）。
- 项目健康页 `github_stale` 信号、RISK digest 第四种信号类型（§5.2/5.3，只留查询函数签名，不接线）。
- 多 repo 绑定（拍板是"项目级绑定 repo"单数）；组织级/工作区级批量绑定。
- deploy key（SSH）认证路径——拍板提了"PAT/deploy key"两个选项，本设计**只做 PAT**：deploy key 是
  SSH 密钥对，走 git 协议而非 REST API，与"裸 REST 轮询三个 JSON 端点"的整个技术路线不是一回事，
  引入 deploy key 意味着要么调 git 命令行（run_command 白名单没有 git，§0 已述）要么再学一套 SSH
  库，性价比远低于 PAT——**PAT 覆盖 v1 全部信号消费场景**（GitHub REST API 认证首选也是 PAT/GitHub
  App token），deploy key 留作未来若有"需要 git clone 全量代码"的场景（当前范围没有）才重新评估。
- GitHub App / OAuth App 集成（更复杂的认证与安装模型，PAT 对"一个项目绑一个 repo"的体量是够用的
  最简方案，App 模式的多租户安装管理是过度设计）。

---

## 8. 施工切片

| 工包 | 分支 | 模型 | 范围 |
|---|---|---|---|
| GH-A github-server-core | r14/github-server | opus | 迁移 0060 + schema.ts 两张表 + `secret-box.ts`（AES-GCM 原语+单测覆盖加解密往返/篡改 authTag 抛错/错误 key 长度）+ `packages/config/src/env.ts` 加 `GITHUB_TOKEN_ENC_KEY` + 契约新文件 `domain/github.ts` + `packages/db/src/repositories/github-bindings.ts`（绑定 CRUD + 活动 upsert + `listStaleReposSinceThreshold` 占位函数）+ `services/github-client.ts`（裸 fetch 客户端，ETag/rate-limit 处理，单测覆盖 §1.6 六种响应场景）+ `services/github-bindings.ts`（绑定服务，owner 权限收口+测试连接同步校验）+ 路由文件（不挂载）+ 测试 |
| GH-B github-sync-worker | r14/github-sync | sonnet | `services/github-sync.ts`（`runOnce`，假仓库+假 client 单测：增量水位推进/ETag 跳过/单绑定失败不连累其余/未到间隔跳过/加密密钥未配置空转）+ `workers/github-sync.ts`（调度壳）+ `server.ts` 接线；依赖 GH-A 的仓库/客户端类型，故 A 合并后发车 |
| GH-C project-home-activity | r14/github-home-ui | sonnet | `project-home-pages.ts` 新增 `github` 区块（§5.1，取数失败降级）+ 桌面设置视图绑定卡（`workbench/settings/{render,api,view}.ts` 新分区：repo 输入+PAT 输入(password 类型 input，从不回填)+测试连接按钮+绑定状态展示+解绑按钮）+ 桌面/web 项目主页渲染 `github` 区块（若已有 UI 组件消费 `ProjectHomePageVM`，定位对应渲染文件在施工时核实）+ 测试；依赖 GH-A 的契约字段，可与 GH-B 并行（互不冲突文件） |

**任务判断**：GH-A 涉及新加密原语+全新外部 HTTP 客户端+安全边界设计，风险集中（密钥处理错误的后果是
真实数据泄漏，不是功能 bug），定 opus。GH-B/GH-C 是在 GH-A 建好的类型/仓库上做既有范式的直接复用
（scheduler 骨架照抄 risk-monitor、UI 区块照抄 recent_files/governance 分区），sonnet 可稳定处理。

**围栏**：不碰 `packages/contracts/src/pages.ts` 的 `projectHealthSignalKeySchema`（§5.2 明确不做）；
不碰 `packages/db/src/repositories/risk-monitor.ts`（§5.3 只加独立不被调用的函数，不改 RISK 批任何
既有导出/签名）；不碰 `collaboration.ts` 的 `proposalSchema`/`deliverableChangeManifestSchema`（§0
结论1，PR 链接不做）；不新增 SSE 事件类型（GH 活动是轮询拉取+落库，不是实时推送场景，客户端下次拉
`ProjectHomePageVM` 自然看到，不需要 `github.activity.created` 之类的事件）。

**冲突磁铁**（集成者手解）：
- `packages/db/src/schema.test.ts` 尾部 "migration journal ends with 00XX" 断言（若 RISK 的 0059 先
  合并，本批把断言从 0059 改成 0060，同 05-risk-design.md §8 同款处理）。
- `packages/db/migrations/meta/_journal.json` 尾部追加（`idx:60, when:1783913000000,
  tag:"0060_project_github_bindings"`）。
- `packages/config/src/env.ts`/`Settings` 类型新增 `github.tokenEncKey` 字段——若同批次内 GH-A 独占
  改这个文件，无冲突；若与其他并行批次撞（历史上少见，env.ts 改动频率低），按行追加不冲突。
- `apps/desktop-webview/src/workbench/settings/render.ts` 新分区——若与 RISK-B（`05-risk-design.md`
  §8 也要改这个文件加"风险巡检"小节）同批次窗口重叠，两个新分区都是"追加式插入"，集成者按最终顺序
  排列即可，非阻塞冲突。
- `server.ts` 的 scheduler 接线区——同 RISK 一样是追加式插入，风险低。

---

## 9. 验收清单（供施工方自查）

1. `secretBox.seal()`→`open()` 往返一致；篡改 `authTag` 任一字节后 `open()` 必须抛错（GCM 认证加密
   的完整性保证）；`GITHUB_TOKEN_ENC_KEY` 长度不对（非 32 字节 base64）启动时/首次调用时明确报错。
2. 真实调用被 mock：`fetchImpl` 返回 200 + ETag → 下次请求带 `If-None-Match`，mock 断言 header 存在；
   mock 返回 304 → `runOnce()` 该端点不解析 body、水位仍推进 `last_synced_at`。
3. `X-RateLimit-Remaining: 0` + 未来 `X-RateLimit-Reset` 时间戳 → 客户端等待到该时间再重试（单测用
   假时钟验证等待时长计算，不真的 sleep）。
4. 单个绑定同步失败（mock 抛网络错误）→ `runOnce()` 该项目计入 `failed`、`last_error` 落库、其余
   候选绑定不受影响、水位不推进。
5. `PUT` 绑定端点：`test connection` 先行——mock 返回 401 → 端点 422，不写入任何行（真库断言
   `project_github_bindings` 表该 `project_id` 无行）。
6. `GET` 绑定状态端点响应体做 JSON 全字段扫描断言：不含 `pat_ciphertext`/`pat_iv`/`pat_auth_tag`/
   `personal_access_token` 等任何可能关联密钥的字段名。
7. 非 project owner 调 `PUT`/`DELETE`/`test` → 403；project owner 换人（转让）后旧 owner 立即失去
   权限、新 owner 立即获得（复用 `activeProjectOwnerCondition` 的既有测试模式）。
8. `DELETE` 绑定后，`project_github_activities` 表该项目的行全部消失（cascade 验证）。
9. 未配置 `GITHUB_TOKEN_ENC_KEY`：`PUT` 端点返回 503+人话提示；`workers/github-sync.ts` 的
   `runOnce()` 直接空转返回 `{scanned:0,...}`，不抛异常、不崩进程。
10. `pnpm -r typecheck` + 各包测试 + 迁移链 scratch 真库 0000→0060 全绿（若 0059 之前有并行批次占用
    实际尾号有偏移，替换成集成后的实际号）。
