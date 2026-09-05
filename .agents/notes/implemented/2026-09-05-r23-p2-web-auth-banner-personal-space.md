# R23 P2：web 密码登录屏 / AI 就绪横幅 / 个人空间新建按钮

- Status: implemented
- Date: 2026-09-05
- Owner: 接班工人（scout-A-product-gaps.md SA-04/SA-08/SA-05，工位 wt-p2）

## Problem

侦察报告（scout-A-product-gaps.md）三条产品缺口：
1. SA-04（高）：生产模式强制非 nickname 认证时，web 端没有任何登录表单（只有桌面走 client.login）。
2. SA-08（中）：README/DEPLOY.md 承诺无 key 时顶部横幅，web 端实际没有。
3. SA-05（中）：个人空间只能在桌面创建，web 端此前连按钮都没有（后来发现 SSR 已由前序工人补好，只是点击没接线）。

## Decision（SA-05，已实现）

- 「新建个人空间」按钮点击后**停留在 /projects 原地、`renderCurrentRoute` 整页刷新**，不像团队项目
  bootstrap 那样跳转到新资源的项目主页。理由：个人空间创建是「清单里多一行」的轻量操作，服务端自动
  命名（无表单字段可填），跳转体验对「还没想好要不要开一个」的场景反而更重；团队项目创建有名字/描述
  等输入,跳进主页开始配置是自然延续,两者场景不同,不强求同一模式。
- 前序工人在 my-conversations.ts 里加了一个 `createPersonalSpaceError` 专用错误文案，但从未接线到
  实际的 catch 分支。检查后发现同级的 `createNamedProjectActionFromHref` 分支用的是通用
  `actionErrorNotice(locale, error, actionId)`（从 WorkHubApiError 派生消息，不查专用文案表）——
  为保持同一分发器内所有分支的错误处理口径一致，删掉了这条死文案，改用通用错误提示，而不是新造一条
  「跨模块查文案表」的特殊路径。
- 顺手把 `bindMyConversationsPanel` 里裸的 `client.request<ProjectListVM>("/api/me/personal-projects")`
  换成新补的类型化 `client.listPersonalProjects()`——同一端点的读/写现在走同一个类型化方法族。

## Alternatives considered（SA-05）

- 创建成功后 `navigateWebRoute` 跳进新空间主页（团队项目的既有模式）：否决，见上文「场景不同」。
- 保留 `createPersonalSpaceError` 死文案、想办法接线：否决——引入「browser.ts 反向 import
  my-conversations.ts 的私有 copy()」的耦合，收益（更友好的错误文案）不值这个耦合成本。

## Consequences

- 两处手写的全量 `WorkHubApiClient` 假实现（apps/web/src/main.test.ts、
  apps/desktop-webview/src/main.test.ts）在这一批新增 3 个接口方法（register/listPersonalProjects/
  createPersonalProject）后必须同步补桩，否则 tsc 报接口缺字段——这是本仓库「改 SDK 接口＝至少两处
  手写 stub 联动」的已知摩擦点，未来再加方法时记得同查这两个文件。
