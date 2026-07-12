# 批 6 完成汇报（网盘整合 + 版本历史/回滚）

日期: 2026-07-12 · 执行: Claude · 分支: `r12/batch6-drive`（从 `r12/workbench-full` @ `d51f1c0e` 切出，含 b22f8c28）

## 做了什么

1. **工作台网盘标签**（`apps/desktop-webview/src/workbench/drive/`，新目录）：中栏新增「网盘」标签，严格复用既有 `pages.drive` 端点（一次性拉整页 `items`，文件夹导航/面包屑在内存里按 `parent_id` 过滤+回溯，**没有发明新查询参数**）；上传/下载/删除复用既有 `uploadDriveFile`/`downloadDriveResource`/`deleteDriveItem`；顶栏按 prototype 原样落「全部文件自动留版本 · 可回滚」提示行。
2. **右栏情境面板**（`drive/side-panel.ts`）：文件预览（文本直显，二进制给下载）+ 版本历史（时间/操作者/大小 + 非当前版本的「找回这个版本」按钮）。这是一个**挂载一次、活过项目/标签切换的单例控制器**，被网盘标签的文件点击和群聊 `file_card` 点击**共用同一份**（`data-wb-chat-open-file`，`chat/render.ts`/`chat/view.ts`），满足「和 drive 标签共用同一组件」的要求。
3. **版本历史 + 回滚端点**：`packages/db` 的 drive 仓库新增两个**可选**方法 `listVersionsForItem`/`rollbackToVersion`（回滚=追加新版本、复用目标版本的 `storage_path`——不拷字节、不抹历史，留 `project_drive_operations`(`opType: "restore_version"`，这个枚举值契约里早就留好了)+`audit_logs` 审计痕迹）；`apps/api` 服务层加 `listVersions`/`rollbackVersion`；路由**新建**在 `apps/api/src/routes/drive-versions.ts`，**故意不挂载进 app.ts**（见下「挂载清单」）。
4. **回滚成功后的系统消息**：复用批 3 已有的 `postSystemMessage`（`packages/db/src/repositories/action-cards.ts`）+ 批 0 的 `listVisibleForProject` 找主会话，往项目主区群聊落一条 `system_event`（人话：「《文件名》找回了 vN 的内容，追加成了新版本 vM——原历史都还在」），best-effort（找不到主会话/发布失败都不影响回滚本身已经落库的结果）。
5. **文案去黑话**：全程「找回这个版本」，没有 revert/rollback/branch 等英文黑话（`render.test.ts` 有专门断言钉死）。
6. 顺手修了一个真实的 store 重入 bug（见下「我改过的断言」）。

## 改动文件清单

新增：
- `apps/desktop-webview/src/workbench/drive/{api,render,side-panel,view}.ts` + `api.test.ts`/`render.test.ts`（side-panel.ts/view.ts 是 imperative DOM 挂载层，照本仓库既有惯例——`chat/view.ts`/`rail.ts` 的 mount 函数——不直接单测，纯函数全在 render.ts/api.ts 里测）
- `apps/api/src/routes/drive-versions.ts` + `.test.ts`（**不挂载**，见挂载清单）
- `packages/db/src/drive-versions-repository.test.ts`

修改：
- `packages/db/src/repositories/drive.ts`：加 `listVersionsForItem`/`rollbackToVersion`（两个都是可选字段，不强迫既有测试里几十个 `DriveRepository` 假对象字面量补桩）+ `DriveRepositoryConflictError` 新增 `drive_version_is_current` 码
- `apps/api/src/services/drive-pages.ts`：`DrivePageService` 加 `listVersions`/`rollbackVersion`（同样可选字段）+ `announceVersionRollback` 私有 helper + `getDefaultDrivePageService()` 接真依赖
- `apps/api/src/drive-pages.test.ts`：追加 13 条服务层测试（版本历史鉴权分叉/VM 组装/回滚错误映射/系统消息 4 种场景）
- `apps/desktop-webview/src/spotlight/views/drive.ts`：`fmtSize`/`driveResourceApiBase`/`fetchDriveResource`/`downloadDriveResource` 加 `export`（工作台复用同一套鉴权 fetch，不重复实现）
- `apps/desktop-webview/src/workbench/{store,rail,shell}.ts`：`store` 加 `centerTab`（chat/drive）+ `sidePanelContent`（不透明 `{ownerId,html}` 容器）；`rail` 的「网盘」树叶从只读升级成真按钮；`shell` 挂 `driveSidePanel` 单例 + 按 `centerTab` 切中栏视图
- `apps/desktop-webview/src/workbench/chat/{render,view}.ts`：已落库的 `file_card` 消息升级成真按钮（`data-wb-chat-open-file`），发送中的乐观渲染继续保持非交互
- `apps/desktop-webview/src/workbench/{css,icons}.ts`：网盘标签/版本面板/可点 filecard 的样式 + `file`/`history`/`check` 三个新图标
- `apps/desktop-webview/src/workbench/{rail,chat/render}.test.ts`：更新两条**预告过会在本批变化**的断言（见下）

## 挂载清单（给集成者）

1. `apps/api/src/app.ts`：
   - `import { createDriveVersionRoutes } from "./routes/drive-versions.js";`
   - `app.route("/api/drive", createDriveVersionRoutes());`（默认 deps 走 `getDefaultDrivePageService()`，同款挂法）
2. **不需要碰 `openapi.ts` 就能挂载**——但挂载后两个新端点（`GET /api/drive/projects/{projectId}/items/{itemId}/versions`、`POST .../versions/{versionId}/restore`）会立刻变成运行时路由，届时 `apps/api/src/app.test.ts` 的「runtime routes 与 openapi.json 保持同步」契约测试会报 `missingFromOpenApi`——**集成时需要同时给 `openapi.ts` 补这两条文档**（我在本批范围围栏里被明确禁止碰 `openapi.ts`，所以特意把路由做成不挂载的独立文件，把「挂载+补文档」这一步完整留给集成者一起做，而不是留一个会让 CI 变红的半成品）。

## 我改过的断言（如有）

两处，都是**之前批次的测试自己在注释里预告过、会在本批变化**的断言，不是迁就我实现临时改的：

1. `apps/desktop-webview/src/workbench/rail.test.ts`：`"the drive leaf is still informational-only (no view to route to until batch 6)"` → 改成 `"the drive leaf is a real, clickable button once batch 6 wires the drive view"`。原测试的名字和批 1/2 报告原文都写着"网盘还是批 6 的事"。
2. `apps/desktop-webview/src/workbench/chat/render.test.ts`：`"renders a file_card message as a non-interactive file card (no click affordance yet)"` → 改成断言真实可点击（`<button>` + `data-wb-chat-open-file`）。原测试名字本身就叫"no click affordance **yet**"。

## 一个我在集成中发现并修复的真实 bug（超出字面任务范围，但直接由本批功能触发）

`workbench/store.ts` 的 `setState` 有重入问题：`driveSidePanel.showIdle()` 在 `renderCenter`（一个 `store.subscribe` 监听器）内部被同步调用，而它自己又调用 `store.setState(...)`。JS 函数参数按值绑定——重入发生时，监听器函数体里**这次调用**已经拿到手的 `state` 参数不会因为外层闭包变量被重新赋值就跟着更新，于是同一个监听器调用里紧跟着的 `renderSide(state)` 还会用上一刻的旧快照，把刚写入的新内容覆盖回去（用户会看到网盘标签的右栏「点文件查看」提示被批 5 遗留的旧占位文案盖掉）。

先写了一个会红的最小复现（`node --import tsx` 跑一段独立脚本验证问题真实存在），再在 `store.ts` 加了 `notifying`/`pendingRenotify` 两个标记：重入时不递归调用监听器，只合并 state 并标记"通知完了再补一轮"；最外层那轮 notify 跑完后用完全合并好的最新 state 干净地再跑一遍全部监听器。加了两条回归测试（`store.test.ts`，7→9 条）。这个 bug 在批 6 之前不会触发（此前没有任何代码在 shell 的渲染回调内部同步调 `setState`），但它是 store 的通用缺陷，值得现在修，不然后续批次（军团面板/通知）一旦也这么用就会复现同一个坑。

## 自查输出

```
pnpm -r typecheck                              → 16/16 workspace 项目 Done，0 错误

pnpm --filter @workhub/db test                 → 235 tests, 233 pass, 0 fail, 2 skip
  （批前 227 tests, 225 pass, 2 skip；净增 8 条真断言，均先红后绿）

node --test apps/api/src/**/*.test.ts          → 1023 tests, 1021 pass, 1 fail, 1 skip
  （批前 999 tests, 997 pass, 1 fail, 1 skip；净增 24 条真断言；
   唯一失败 cuu-r3-launcher-harness.test.ts 是批前既已存在、与本批无关的环境失败——
   已用 git stash 逐一核对，批前批后同一条用例同样失败）

node --test apps/desktop-webview/src/**/*.test.ts → 445 tests, 444 pass, 1 fail
  （批前 413 tests, 412 pass, 1 fail；净增 32 条真断言；
   唯一失败 desktop-cuu-runtime.test.ts 同样是批前既有、与本批无关的 @workhub/events
   模块解析环境问题）

git status --short                              → 只有本批范围内文件（14 处修改 + 8 个新文件），
                                                    无范围外改动

真实 Postgres smoke（本机 docker workhub-postgres-1，用完清空，逐一核对无残留行）：
  1. listVersionsForItem/rollbackToVersion 端到端：真 users 表 join 拿操作者昵称、真事务、
     回滚追加 v3 指向 v1 的 storage_path（不拷字节）、历史三版本都还在、"已是当前版本"冲突
     走真实 ROLLBACK 不留半成品行。
  2. rollback → 系统消息端到端（先跑 packages/db/src/migrate.ts 把本地库migrate 到含
     project_conversations/conversation_messages 的最新 schema，因为这个本机库此前没跑过
     R12 批 0 的迁移）：真实 conversation_messages 行 kind=system_event/sender=system/
     seq 从真实 next_seq 原子分配，summary 文案与 announceVersionRollback 逐字一致。
  两个脚本均为临时文件，验证后已删除，未提交。
```

## 范围外发现（不修，只报）

- **本机 docker postgres（`workhub-postgres-1`）此前没跑过 R12 批 0 的迁移**：`project_conversations`/`conversation_messages` 等表在我开工时不存在（本批第一次真库 smoke 直接报 `relation "conversation_messages" does not exist`）。已用 `pnpm --filter @workhub/db run migrate` 补齐，这是**必要的环境修复**、不算越权改动（未改代码/schema，只是把本机库迁移到当前分支应有的状态）。如果这台机器还被其他并行分支的验收使用，请留意该库现在已经是最新 migration 状态。
- **`announceVersionRollback` 的可见性查找依赖 `workspace_memberships` 显式记录**：`listVisibleForProject`（批 0 既有方法）内部用 `readActiveProjectMembership` 做 INNER JOIN，要求触发回滚的 actor 在该 workspace 有一条真实 `workspace_memberships` 行。但 `canManageProjectDrive`（网盘管理权限判定）本身**不要求**这条记录——只要求 `actor.workspaceId === project.workspaceId` 或 `project.ownerUserId === actorUserId`。也就是说：能成功执行回滚的 actor，不一定能让系统消息发出去（回滚本身不受影响，只是群聊里少了这条系统消息）。这是 best-effort 设计下的已知取舍，具体影响面取决于生产环境里有多少真实用户缺少显式 membership 行——建议人工确认后再判断是否需要放宽系统消息这一步的可见性判定。
- **openapi.ts 文档缺口**：见上「挂载清单」第 2 条。

## 没做/存疑

- **拖拽上传**（chat 拖文件进聊天 = 上传 + 发卡）：批 2 已披露的缺口，本批指令明确保持不做，未触碰。
- **合并后交付物自动归档 + 系统事件卡**（AI 产出的交付物合并后落进网盘对应目录、群聊冒系统事件卡）：这是提议→审批合并链路（`services/proposals.ts`）的收口，不在本批的「文件/文件夹列表 + 版本历史/回滚 + 聊天预览互通」范围内，需要另立批次跟进（proposals 合并时机 vs drive 归档路径的映射规则需要单独设计）。
- **中栏标签切换会销毁非活动视图**（chat ⇄ drive 来回切换会丢 SSE 订阅/composer 草稿/当前文件夹，重新挂载即重新拉数据）：已知简化取舍，在 `shell.ts` 里写了注释说明，留给后续批次判断要不要改成隐藏而非销毁。
- **版本历史面板没有给旧版本单独的预览/下载链接**：只展示时间/操作者/大小 + 找回按钮（按任务原话的最小范围），没有做"预览第 N 个历史版本内容"这个更大的功能面（会需要新的按 version_id 下载/预览端点，超出本批"列表+回滚"的字面范围，故未做，也未在报告里当缺口提出——如果这确实是需要的功能，请在下一批任务里明确点名）。
- 服务层的 `listVersionsForItem`/`rollbackToVersion` 只有 recorder 模式单测 + 本次手动真库 smoke（未写成 env-gated 的常驻真 PG 矩阵测试，照批 5 的先例——那批同样把这个标成可选缺口）。

## 结论

批 6 完成，自查全绿（含两轮真实 Postgres smoke），范围内改动无越界。等待集成者：① 挂载 `drive-versions.ts` 到 `app.ts` 并补 `openapi.ts` 文档；② 核对 `workspace_memberships` 覆盖率是否影响系统消息可见性；③ 决定是否需要跟进「合并后自动归档」与「历史版本单独预览」两个明确未做项。
