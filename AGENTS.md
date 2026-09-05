# AGENTS.md

WorkHub 是一个 AI 项目经理产品（后端 API + agent 循环 + web/桌面双前端）。本文件是给 AI 协作者的常驻规约；详细规则链到它的家，不在这里重复。`CLAUDE.md` 软链到本文件——改真身。

## 仓库地图

- `apps/api` —— 后端 API：路由 + agent 循环/worker + SSE 广播 + 迁移消费方，唯一的跨包汇聚点。
- `apps/web` —— Web 前端：字符串模板路由渲染（GitHub 风项目管理 + 网盘），会话页是只读镜像。
- `apps/desktop-webview` —— 桌面 webview 前端：三个 Tauri 窗口（主命令条/桌宠/工作台）的 TS 界面层。
- `client-tauri` —— 桌面原生壳：Tauri/Rust，托盘、深链、按窗口分域的能力、CSP。
- `packages/agent` —— agent 循环本体：传统 loop + loop2（vendored pi）双引擎、fixtures、会话轮次。
- `packages/api-client` —— 前端调用后端 API 的类型化客户端，web/desktop 共用。
- `packages/audit` —— 审计快照与留痕（manifest/policy 快照服务）。
- `packages/config` —— 环境变量单一事实源（`src/env.ts`）。
- `packages/contracts` —— 跨端共享的 zod schema 契约（domain 类型 + 校验）。
- `packages/cost` —— 预算四道闸（准入/原子预留/循环内/评审前）+ 7 种 `BudgetScope`。
- `packages/cuu` —— 桌宠 Cuu 的状态机与 i18n 字典。
- `packages/db` —— Drizzle schema + `migrations/`（replay-safe 纪律见 `CONTRIBUTING.md`）。
- `packages/events` —— SSE 信封、事件类型、生命周期投影。
- `packages/permissions` —— 权限评估：动作策略阶梯 + 资源能力谓词。
- `packages/tools` —— agent 工具注册表 + 用户态软沙箱（`sandbox.ts`）。
- `packages/ui` —— gold-path 路由渲染（web 主力，`route-components.ts` ~6200 行）+ 回放渲染。
- `packages/web-runtime` —— web 端 SSE 实时运行时（`EventSource` 包装）。

## 必跑门禁

```sh
pnpm typecheck   # 写完 *.test.ts 后必跑一遍——pnpm test 走 tsx，不做严格类型检查
pnpm test        # 单测（tsx，node:test / vitest 视包而定）
pnpm lint        # audit:* 六件套 + qa:r2-release-gate + qa:r4-rust-system-i18n + cuu-r3 六件套
pnpm verify      # typecheck && test && lint —— CI 的 workspace job 就跑这条，别只跑 test 就当过了
```

- `audit:agent-notes` / `audit:copy-terms` / `audit:portable-config` / `audit:target-paths` / `audit:migrations` / `audit:desktop-version` / `audit:third-party-notices` 和 `qa:r2-release-gate` 全在 `pnpm lint` 里，任何一条红就是 CI 红。
- cargo 三门（`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`，均以 `client-tauri/src-tauri/Cargo.toml` 为 manifest）在改 `client-tauri/**` 时必跑；CI 在 `rust-system-i18n` job 里跑，本地对应 `pnpm qa:r4-rust-system-i18n`（fmt/clippy 命令见 `.github/workflows/verify.yml`）。
- web 路由冒烟 `pnpm qa:r4-web-live-route-interaction` 在改 `apps/web/src/routes.ts`、`packages/ui/src/gold-path/route-components.ts` 或任何路由 VM 时必跑；CI 的 `web-live-route-smoke` job 总会跑，但它烧真 Chrome + PG 种子，本地按需跑而非每次都跑。

## 纪律

- **绝不 `git add -A` / `git add .`**：工作树常有并行工作留下的残留文件；只 targeted add 自己改的（本地钩子见下）。
- **改产线行为要同步改 PG smoke 断言**：`qa:r1-pg-smoke` / `qa:r2-pg-redis-smoke` / `pilot-stack-smoke` 断言的是真库行为；行为变了断言不跟着变，等于没人会发现真的坏没坏。
- **新端点同批补三处**：`apps/api/src/openapi.ts`（手写 OpenAPI）+ `packages/contracts`（zod schema）+ `packages/api-client`（前端调用客户端）——三者没有自动同步，漏一处是运行时才炸的漂移。
- **用户可见文案**走 i18n 字典（不是内联三元），禁黑话（表见 `docs/workhub/00-overview/glossary-dejargon.md`），禁 emoji（chat reaction 表情是唯一例外，见 `CONTRIBUTING.md`）。
- **非平凡变更必须带 Agent Note**：`.agents/notes/{proposed,implemented,rejected,archived}/`，格式见 `.agents/notes/README.md`，`pnpm audit:agent-notes` 校验。
- **`docs/workhub/*.md` 计数门**：增删该目录下 `.md` 必须同 commit 改 `docs/workhub/README.md` 里「N 篇文档已落盘」那一行，否则 `qa:r2-release-gate` 的 `docs.count` 门红。
- **生成物重生成而非手改**：`THIRD_PARTY_NOTICES.md`（`pnpm gen:third-party-notices`）、桌面版本号（`pnpm sync:desktop-version`）——改了输入就重跑生成脚本，别手改产出文件。
- **桌面端改动必须真机走查**：`apps/desktop-webview` 在浏览器预览里渲染不出（没有 Tauri 运行时），typecheck/单测能过不代表界面对，改动要在 `.app`（模拟器或真机）里实际看一眼。

## 评审规则（借鉴 deepseek-harness `packages/AGENTS.md`）

- **决策在做出它的那个操作里落地**：schema 省略、提示词过滤、门面、包装器、监听顺序都不算强制——能被直接调用者绕过的检查不算数，要测拒绝路径测在执行者身上。正面样本：`packages/tools/src/registry.ts` 的双重 `canUse`（`visibleFor` 列出时查一次、`execute` 执行时再查一次，缺一个都不够）。
- **只在提交点发布状态**：每条通知、每处派生状态只在操作**成功之后**发布；派生缓存、提示词、UI 回显、回放、查询视图都从同一个权威源派生，不要各自维护一份影子状态。
- **要求当前的所有者和需求**：每个抽象、状态机、可选项、防御性拷贝都要能指向一个当前契约或生产消费者；只为「将来可能用得上」而加的分支和选项，删。
- **一个门禁只有在回归能让它红的时候才算门禁**：新增门禁的 PR 要附「先引入一次回归、看它红、再还原」的证据；没验证过会红的门禁形同虚设——这是本仓 12 道 release gate 目前普遍缺的一环。
- **验证世界，不验证自述**：e2e 断言要重跑命令或从外部重读文件；对着被测代码自己吐出来的文本做关键词匹配，会连作弊的实现也放行。
- **优先用真实现而非 mock**：只在昂贵或非确定的边界（LLM、网络、时钟）上 mock，下游全部走真实路径。
- **给完整结果加限界**：字节/条数/时间上限要套在最终吐出的值上（含包装器和元数据），不能只测中间值；测试要覆盖极小值、临界值、超大单块、多字节边界。
- **模型可见的文本从模型的视角写**：提示词、工具 schema、结果、诊断信息只放任务相关的概念，不泄漏 UI/传输层/实现细节的词汇；稳定的模型可见文本变化要有可见的评审证据（golden/snapshot 或端到端覆盖）。
- **测试描述行为，不描述"正确性"**：改掉过时的行为要连带改它的测试，并在 PR 里说明这不是"改坏了"而是行为变更。
- **并行跑的测试不许互相依赖执行顺序或共享端口/路径**：每个测试认领并清理自己申请的资源；一个测试只有单独跑才过，说明这个测试本身有缺陷,不是环境问题。
- **公开的可配置项要有证据支撑**：新增的选项、默认值、格式要有当前调用者的证据或对照先例撑腰；没有就先要求一个明确值,或者把决定权留到有证据的时候再做。
- **并列结构保持对称**：几个并列的值如果形状不对称，通常是少提了一次公共部分出来,而不是它们本该不同。

## 编辑本文件

`CLAUDE.md` 是软链到本文件；改真身 `AGENTS.md`。每条尽量自包含，链到更详细的文档而不是复制内容。全文预算 ≤120 行；超了先搬到 `CONTRIBUTING.md` 或 `docs/workhub/`，不是无限往上堆。
