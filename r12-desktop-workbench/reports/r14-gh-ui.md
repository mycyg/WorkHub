# R14 批 GH · 工包 GH-C gh-ui 施工汇报

- 分支：`r14/gh-ui`
- 施工说明书：`r14-release-readiness/07-gh-design.md` UI 节（§1.2/§3/§5.1）+
  `r12-desktop-workbench/reports/r14-gh-server.md`（GH-A，绑定/测试连接/契约）+
  `r12-desktop-workbench/reports/r14-gh-worker.md`（GH-B，轮询 worker + `github_activities` VM 字段的
  实际落地形状——扁平 `GithubActivityVM[]`，不是设计稿草案的富对象）
- 服务端依赖：GH-A/GH-B 均已合入本分支基线（`git log` 可见 `feat(api): mount the R14 GitHub binding
  routes`、`feat(api): merge the GitHub poll worker and start it at boot`），四个绑定端点已挂载、
  `ProjectHomePageVM.github_activities?` 已在 `packages/contracts/src/pages.ts` 定稿，本工包零改动这两个
  包（禁区）。
- 验收自查：`pnpm --filter @workhub/desktop-webview test`（**1100/1100**，基线 1079，+21）+
  `pnpm --filter @workhub/ui test`（**204/204**，基线 203，+1）+ `pnpm --filter @workhub/web test`
  （**83/83**，零改动）+ `pnpm -r typecheck`（16/17 工作区包全绿，桌面 Rust crate 不在 tsc 范围内）

## 1. 做了什么

### 1.1 桌面项目设置绑定卡（`apps/desktop-webview/src/workbench/settings/{api,render,view}.ts` + `css.ts`）

新分区，紧邻既有 AI 治理分区，独立加载态——这是本工包最重要的架构决定，记录理由：

- **GET 绑定状态的权限口径比 AI 治理宽**（`canViewProjectDrive`：项目可见者皆可读）而 AI 治理连 GET
  都锁在 owner-only（非 owner 直接 404 → `renderProjectSettingsOwnerOnlyHtml` 整页替换）。如果把 GH 卡
  挂在 governance 现有的 `loadState` 早退分支上，非 owner 打开设置页会连 GH 只读状态都看不到——这既不
  符合设计稿"团队协作透明度"的定性，也会让非 owner 除了 governance 的 owner-only 说明外看不到任何东西。
  因此 `view.ts` 的 `render()` 被重构为「`governanceSectionHtml()` + `renderGithubBindingSectionHtml()`
  两段拼接」，governance 原有四态（loading/error/owner_only/ready）**逐字节保留**，只是从"直接
  `container.innerHTML =`"改成"拼进数组再 join"；GH 分区有自己独立的 `githubLoadState`/`githubMode`/
  `githubLoadGeneration`，独立 `container.addEventListener("click", …)`（不挂在 governance 那个已有的
  `!governance || !input.editable` 早退守卫上——两个监听器互不干扰，各自 `return` 只退出自己的回调）。
- **写操作（绑定/换 PAT/解绑/测试）严格收紧到 `input.editable`**（即 `vm.viewer.is_project_owner`，与
  governance 同一个 prop，语义对齐服务端"PAT 比 AI 治理开关更敏感，收紧程度不应更松"的判断）。非
  owner：已绑定渲状态字段（repo/最近同步/最近错误/近 7 天活动数），未绑定渲诚实的"还没有关联"说明，
  两者都**不渲染任何写钩子**（`data-wb-gh-bind-cta`/`edit-cta`/`unbind`/`test`/`submit` 全部不出现，不
  是渲了但 disabled——同 04 手册"看起来能点的必须真能点"反过来的镜像：看不见的就真的点不到，测试
  `R14 GH: a non-owner viewer never issues a write request…` 断言即使强行 dispatch 点击这些 hook 的
  `click` 事件，因为 hook 压根没渲染，`target.closest(...)` 找不到目标，早退守卫 `!input.editable` 兜底
  第二层）。
- **表单**：repo（`type=text`）+ PAT（`type=password`，`autocomplete=off`）两个输入 + 「测试连接」+
  「绑定仓库」/「更新绑定」+ 「取消」。值不走"每次击键都全量 rerender"（会丢焦点），而是照抄
  `silence_window_seconds` 保存钮的既有手法——只在点击「测试连接」/「绑定」时用
  `container.querySelector(...)` 从 DOM 读一次当前值，写进闭包变量 `githubFormRepo`/`githubFormPat`，
  再喂回 `render()` 的 `formRepo`/`formPat` 参数保证跨异步态（"测试中…"/"保存中…"disabled 态）重渲后
  值不丢。**提交成功后立即清空**（`githubFormRepo = ""; githubFormPat = "";`）——服务端响应 VM 结构性无
  token 字段，客户端草稿也一并丢弃，测试 `…the typed PAT is never echoed back afterward` 断言成功后的
  整个 `container.innerHTML` 不含刚才提交的 PAT 字符串。
- **测试连接**：body 按当前表单填的内容（`repo_full_name`/`personal_access_token` 均按非空才带，省略
  的字段走服务端"用已存 PAT 重测"分支）；结果内联展示（成功=repo/默认分支/公开私有摘要，失败=服务端
  `humanizeGithubError` 给的人话原因）。绑定状态卡上还有一个独立的「重新测试连接」（`data-wb-gh-retest`，
  空 body，验证已存 PAT），与表单内的「测试连接」共用同一份 `githubTestPending`/`githubTestResult`
  状态（同一时间只可能有一路在跑）。
- **解绑两步确认**：照抄 `workbench/drive/side-panel.ts` 的 `decideRollbackConfirmation` 武装态先例（不
  是重新发明）——第一次点「解绑」只武装（按钮文案变「确认解绑？」+ `wh-wb-pset-gh-unbind--armed` 警示
  样式，5 秒后自动复原，同 drive 回滚的武装时长），第二次点才真正 `DELETE`。
- **503（未配置加密密钥）温和话术**：`githubErrorMessage()` 显式判 `error.status === 503`，给出
  "GitHub 集成未配置加密密钥，请联系管理员查看部署文档完成配置。"（不是通用的"保存失败，重试"），
  与设计稿 §1.1 的 fail-closed 纪律对齐——面向自托管者，不是让普通项目成员去猜为什么突然连不上。
- **`api.ts`**：`fetchGithubBindingStatus`/`putGithubBinding`/`deleteGithubBinding`/
  `testGithubBindingConnection` 四个薄封装，走既有 `client.request<T>` 转发口（与 `fetchProjectAiGovernance`
  同款），**没有给 `packages/api-client` 加任何具名方法**——集成裁定"api-client 加方法必须两侧穷举
  mock"这条纪律因此不适用，`apps/web/src/main.test.ts`/`apps/desktop-webview/src/main.test.ts` 的
  `fakeClient` 零改动（`git status` 可核，两个文件完全不在本次 diff 里）。
- **`css.ts`**：新增 `.wh-wb-pset-gh-*` 一组类（表单/状态卡/操作行/武装态），复用既有 `--ds-accent`/
  `--ds-danger`/`--ds-warn` 等 design token，未动任何既有 `.wh-wb-pset-*` 规则。

### 1.2 项目主页活动区——桌面（`apps/desktop-webview/src/spotlight/views/dashboards.ts`）

**落点核实结论**：桌面 `workbench/` 目录下没有独立的"项目主页"面板——工作台中栏只有
`chat`/`drive`/`project-settings` 三个标签（`shell.ts` 的 `centerTab` 枚举），`ProjectHomePageVM` 唯一的
真实消费方是 **Spotlight 能力面板**的 `createProjectsView`/`projectHomeDetailHtml`
（`spotlight/views/dashboards.ts`，走 `ctx.client.pages.project(id)`，点项目行 list→detail morph 出的
那个盒子，已经渲 `drive.recent_files` 等字段，是设计稿 §1.4/§5.1 描述的"项目主页天然落点"在桌面的实际
对应物）。因此 GitHub 活动区加在这里，**不是**"找不到明确落点就只做设置卡"的降级路径——落点是明确
存在且已核实的。

- 新增 `githubActivityRow`/`githubActivityKindLabel` 两个纯函数 + `projectHomeDetailHtml` 尾部追加
  `githubBlock`（同 `filesBlock` 的"标题+列表"结构），只在 `vm.github_activities` 非空数组时渲染——
  服务端对"未绑定/绑定但暂无活动/取数失败"三种情况都省略这个字段（不是空数组），判空即覆盖三种情况，
  不需要额外区分。
- **外链处理**：GitHub `html_url` 是真外部网站，桌面 Tauri webview 对这类链接没有任何承接能力
  （`target=_blank` 点了没反应——这不是本工包新发现，是 `spotlight/views/dashboards.ts` 里知识检索证据
  行早已踩过的坑，代码注释原文"target=_blank 在 Tauri 内无承接"），而且 `client-tauri/src-tauri/
  capabilities/default.json` 里确认没有 `shell`/`opener` 插件权限，桌面客户端目前**完全没有**打开外部
  浏览器或写剪贴板的能力。本工包**没有**新增 Tauri capability（这是 UI 批的范围外改动，且会牵扯
  `client-tauri/` 的 Rust/capabilities 配置，风险面不在本工包评估范围内）——照抄知识检索证据行的既有
  处理：GitHub 活动行渲成可点按钮，点击给一句诚实的 `ctx.toast`"GitHub 链接需要在系统浏览器中打开"，
  不是假装能内联打开的死链接。

### 1.3 项目主页活动区——web（`packages/ui/src/gold-path/route-components.ts`）

`renderProjectHomeRouteComponent` 新增「最近 GitHub 动态」卡，结构照抄紧邻的"最近文件"卡（`wh-card
wh-r4-route-card` + `wh-r4-route-table` 行列表），`github_activities` 非空数组才渲染。每行是真实
`target="_blank" rel="noreferrer"` 外链（web 是真浏览器，不像桌面 Tauri webview 那样没有承接），
`data-native-resource-link="true"` 同网盘下载链接的既有外链标记手法。kind/state/author 用 `wh-pill`
徽标（提交/PR/议题三态标签，PR 保留缩写不译）。文案无 Cuu 出现（web 端本来就无 Cuu 概念，`i18n`
新增的 `projectHome.github` 键是纯产品中性文案）。

## 2. 偏离说明

1. **`github_activities` 是扁平数组，不是设计稿草案的富对象**（`{repo_full_name, recent_activity,
   sync_status, ...}`）——这是 GH-B 已经做出的裁定（见 `r14-gh-worker.md` §4"设计取舍"），本工包照实
   消费，不重新引入富对象包装。绑定/同步元信息（repo/最近同步/最近错误）走独立的绑定卡端点
   （`GET .../github-binding`），项目主页只展示活动条目本身——这也是为什么设置卡和项目主页活动区是
   两个完全独立的数据源/两次独立请求，不是同一个 VM 拆开展示。
2. **桌面外链未新增 Tauri opener 能力**——如上节所述，属于范围外改动（会涉及 `client-tauri/src-tauri/
   capabilities/*.json`），本工包保持"诚实提示，不假装能打开"的既有降级路径，未尝试补全这个能力。
3. **未给 `packages/api-client` 加具名方法**——四个 GH 端点全部走 `client.request<T>` 直接转发，理由
   见 §1.1。这不是偷懒，是与 AI 治理分区同一个既有先例的延续（`settings/api.ts` 顶部注释原话："照
   army/api.ts、chat/api.ts 顶部注释的先例，走 client.request<T> 这个既有的类型安全转发口，不为这一个
   批次特性扩大 packages/api-client 的具名方法面"）。
4. **未做**：项目健康页 `github_stale` 信号（设计稿 §5.2 明确 v1 不做）、RISK digest 第四种信号
   （§5.3 留白）、工单详情页的 `related_work_item_id` 关联展示（§3.5/§5.4 stretch，GH-B 本就未消费
   这个字段，本工包也不新增）。
5. **未动**：`apps/api/**`、`packages/db/**`、`packages/contracts/**`、`workbench/chat|proposal|army/**`、
   `spotlight/views/search.ts`、`spotlight/views/memory.ts`（`git status`/`git diff --stat` 可核，全部
   在禁区外）。

## 3. 测试

| 文件 | 新增 | 覆盖 |
|---|---|---|
| `workbench/settings/render.test.ts` | +12 | 加载态/错误态+独立重试钩子/未绑定 owner 与只读两态/已绑定状态字段（含从未同步/最近失败横幅）/owner 才有的 retest·edit·unbind 钩子/武装态文案与样式钩子/表单字段+password 类型/测试结果成功失败两态/绑定后 PAT 全局不回显/en-US 文案 |
| `workbench/settings/view.test.ts` | +8 | 未绑定 owner 渲 CTA/非 owner 只读态与 governance owner-only 互不干扰的独立加载证明/GH 分区独立重试/owner 开表单→测试→绑定全链路+PAT 事后不回显/PAT 留空客户端拦截不发 PUT/503 温和话术/两步解绑武装确认/非 owner 强行点写钩子零请求 |
| `spotlight/views/dashboards.test.ts` | +1 | 三类 kind 徽标+state+author 渲染、html_url 挂到 `data-open-gh-activity`、无绑定/无活动时区块整体不出现 |
| `packages/ui/.../route-components.test.ts` | +1 | kind/state/author 徽标、真实 `target=_blank`+`rel=noreferrer` 外链、无活动不渲区块、en-US 文案、`assertNoMainWindowBoundaryLeak` 通过（无 Cuu 泄漏） |

`pnpm --filter @workhub/desktop-webview test`：1079 → **1100**（+21，与上表桌面三个文件加总一致）。
`pnpm --filter @workhub/ui test`：203 → **204**（+1）。`pnpm --filter @workhub/web test`：83 → 83
（零改动，web 侧改动全在 `packages/ui`）。`pnpm -r typecheck` 全绿（`exactOptionalPropertyTypes: true`
下补了几处 `| undefined` 到可选字段类型，未改任何运行时逻辑）。

## 4. 施工围栏核对

只动：`apps/desktop-webview/src/workbench/settings/{api,render,view}.ts` + 两个同名 `.test.ts` +
`apps/desktop-webview/src/workbench/css.ts`（仅追加 `.wh-wb-pset-gh-*` 规则，未动既有 `.wh-wb-pset-*`
串）+ `apps/desktop-webview/src/spotlight/views/dashboards.ts`/`dashboards.test.ts` + `packages/ui/src/
gold-path/route-components.ts`/`route-components.test.ts`。未碰 `apps/api/**`、`packages/db/**`、
`packages/contracts/**`；未碰 `workbench/chat/**`、`workbench/proposal/**`、`workbench/army/**`；未碰
`spotlight/views/search.ts`、`spotlight/views/memory.ts`；未碰 `apps/web/src/main.test.ts`、
`apps/desktop-webview/src/main.test.ts`（因为没有新增 api-client 具名方法）。未跑 qa smoke/artifacts、
未起后台进程、未打真网、无 emoji（GH 活动 kind 徽标用"提交/PR/议题"文字标签，不是 emoji）。
