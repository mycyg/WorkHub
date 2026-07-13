# R12 人工验收打回·服务端修复报告（ENV-01 + E-01）

分支：`r12/acceptance-server-fixes`（起初从 `origin/main` @ `2e4e2382` 拉出；开工期间 `origin/main` 前进
到 `94e331e7`——那两笔新提交里第一笔就是把
`r12-desktop-workbench/reports/r12-acceptance-2026-07-13/R12-acceptance-report.md` 本体连同证据附件一起
加了进来——两笔新提交都不touch本次改动的文件，rebase 到 `94e331e7` 干净、无冲突，已 rebase）。未合并、
未推送。

## 0. 一个流程性说明（先讲清楚，免得报告对不上账）

任务指定要先读上面那份验收报告的 ENV-01 与 E-01 两节。**开工时核实过：这个文件在当时的 `origin/main`
（`2e4e2382`）和本机能看到的所有 worktree 里都不存在**（`find`/`grep -rl "ENV-01"` 全库没有命中）——
两处修复因此完全依据任务描述里给出的诊断原文（诊断本身足够具体，精确到文件/行号/字段名）来实现。收尾
rebase 到最新 `origin/main` 时，这份报告作为新提交出现了；对照读了一遍原文，结论：**任务描述给出的诊断
与验收报告原文逐字对得上，两处修复的方向和范围都不需要调整**。摘录相关原文如下（完整版见
`r12-desktop-workbench/reports/r12-acceptance-2026-07-13/R12-acceptance-report.md`）：

> **ENV-01（报告 §3「ENV-01 / A-B-G」）**：“阿曼、张三均成功建号且 `auth/me` 显示同一 workspace，但两人
> `workspace_memberships` 行数为 0；阿曼访问项目会话返回 404。”……“预期：阿曼、张三是同一 workspace 的
> 有效成员；阿曼能拿到自动创建的 main conversation，双端可进入同一项目。”“实际：两人均无
> `workspace_memberships` 行；阿曼请求返回 `404 conversation_project_not_found`。”

> **E-01（报告 §3「E-01：同名文件第二次上传返回 409，未生成 v2」）**：“修改同一本地文件内容为 v2
> （117 B），保持文件名不变。再次通过原生文件选择器上传同名文件。”……“预期：同名上传成功并新增 v2；
> 后续可对 v1 执行『找回这个版本』，生成 v3 且历史不丢。”“实际：桌面端发出两个同名上传 POST，API 均
> 返回 409，列表仍显示 67 B，versions API 只有 v1，因此回滚链无法继续。”

报告原文里**没有提到任何「同名条目已软删」的场景**——E-01 就是最朴素的“同一文件名再传一次”。我在实现
时对这个未出现在验收报告里、只出现在任务描述转述里的边界做了一处保守解读（见下方第 2 节「决策说明」），
现在有了报告原文，可以确认：这条边界不影响本次验收判据，我的保守选择（不新增限制、只在真正的并发竞态
窗口生效）是安全的。

## 1. ENV-01：昵称 identify 不建 workspace_memberships

### 根因（已核实与诊断一致）
`apps/api/src/routes/auth.ts` 的 `/identify` 与 `/desktop-bootstrap` 都只调用
`deps.users.getOrCreateActiveByNickname(...)`，从未建 `workspace_memberships` 行。密码注册路径
（`/register`、`/invites/accept`）早就有正确先例（`memberships.create({..., defaultWorkspace: true})`）。
conversations/workbench 等路由的鉴权要求 active membership，昵称模式建出来的用户因此处处 404。

### 修法
新增 `ensureDefaultWorkspaceMembership(deps, userId)`（`apps/api/src/routes/auth.ts`），在 `/identify`
成功之后、`/desktop-bootstrap` 铸造设备 token 之前分别调用一次：

1. 先查 `deps.memberships.findActiveForUserWorkspace(userId, defaultWorkspaceId)`——命中即幂等短路，
   不重复建、不覆写既有 `role`/`defaultWorkspace`。
2. 未命中时，再查 `resolveDefaultWorkspace(userId)` 判断该用户是否已在别的工作区有 active 默认成员行——
   `workspace_memberships` 有部分唯一索引 `workspace_memberships_user_default_uq`
   （每用户至多一个 `default_workspace=true ∧ deleted_at is null` 的行），只有确认没有才把新建的这行标
   `defaultWorkspace: true`，避免撞索引。
3. `memberships.create({ workspaceId: defaultWorkspaceId, userId, role: "member", defaultWorkspace })`；
   插入若因并发竞态撞上 `(workspace,user)` 唯一索引（23505），按幂等语义吞掉（另一个并发请求已经建好了）。
4. `deps.memberships` 是 OPTIONAL seam——未注入（老运行时/测试假仓库不带 memberships）时整段跳过，不抛错，
   与 `/register` 现有的 `if (memberships)` 同范式，不引入新的运行时依赖。

两条路由都调用同一个 helper（`desktop-bootstrap` 同样只建用户不建成员的问题一并补上）。**没有改
`packages/db` 的 `workspace-memberships` 仓库**——`findActiveForUserWorkspace`/`resolveDefaultWorkspace`
本来就已经存在于 `WorkspaceMembershipRepository`，只是 auth 路由此前没用它们。

### 行为变化
- Before：`POST /api/auth/identify` 建出/找到的用户没有任何工作区成员行；后续访问
  `conversations`/`workbench` 等要求 active membership 的路由一律 404。
- After：identify/desktop-bootstrap 成功后该用户保证在默认工作区有一条 active membership
  （`role: "member"`，`defaultWorkspace` 视其是否已有别处默认工作区而定）。重复 identify 不产生重复行、
  不改变既有 role。

### 测试（`apps/api/src/auth.test.ts`，65 → 71，+6，全部新增无改断言）
- 新建昵称用户 identify → 建出恰好一条 membership（workspace=默认、role=member、default=true）。
- 重复 identify 同一昵称 → 不重复建行（幂等）。
- `deps.memberships` 未注入（老运行时/假仓库）→ identify 依旧成功，不因缺失可选 seam 报错。
- 已有 active membership 的用户再次 identify → 不新建、不覆写既有 role（用 `owner` 验证不被降级）。
- 用户在别的工作区已有 default membership → identify 在默认工作区新增一行但 `defaultWorkspace: false`
  （验证不撞部分唯一索引）。
- `desktop-bootstrap` 同样建出 membership。

## 2. E-01：同名文件二次上传应生成新版本，而不是 409

### 根因（已核实与诊断一致）
`apps/api/src/services/drive-pages.ts` 的 `uploadFile` 直调 `deps.repo.uploadFile`；仓库层
（`packages/db/src/repositories/drive.ts`）在同 parent 下发现同名活跃条目就直接
`throw new DriveRepositoryConflictError("drive_name_conflict", ...)`，服务层 `mutationError` 把它映射成
409，用户除了改名没有别的路。批 6 的 `rollbackToVersion` 已经有「追加新版本、不抹历史」的完整先例。

### 修法（`packages/db/src/repositories/drive.ts`）
`uploadFile` 事务内，原本「查到同名活跃条目就 409」的一行改成分支：

- 查到的活跃条目 `kind !== "file"`（即撞的是文件夹）→ **保持 409**（`drive_name_conflict`），不能把版本
  挂在文件夹名下。
- 查到的活跃条目是文件 → 调用新增的 `appendUploadedVersion(tx, project, matchedItem, input, at)`：
  1. 对该 item 行重新 `SELECT ... FOR UPDATE`（关闭「非锁定预检」和「实际写」之间的竞态窗口）；拿锁后
     若发现条目已被软删或已不是文件（并发竞态），当作真冲突处理（同样 409 `drive_name_conflict`），
     不会悄悄新建一个重名条目——这是我对任务里「目标条目已软删仍保持 409」这句话的落地方式：只在**这个
     并发竞态窗口**里生效，不是给「同名条目此前已被软删、现在正常重新上传」这个既有、无冲突的回收站语义
     加新限制（那个语义完全不受影响，见下方「决策说明」）。
  2. 复用 `nextVersionNoForItem` 算下一个 `version_no`；insert 一条新 `project_drive_versions` 行（历史版
     本行原样保留，不删不改）；update `project_drive_items.current_version_id` 指到新版本。
  3. `operations` 留痕：`op_type` 复用既有值 `"upload_file"`（`packages/contracts` 的 `op_type` 枚举是
     固定 7 值集合，没有专门的“新版本”值，且这个动作本质仍是“上传文件”，只是落到了已有条目上——按范围
     围栏不碰 `packages/contracts`，也不新增枚举值）；`payload_json` 额外带 `new_version_no` /
     `previous_version_id` 供审计区分。
  4. `audit_logs` 留痕：`action` 用 `"drive.item.version_uploaded"`（`action` 列是纯 `varchar(64)`，非枚
     举，新增字符串值不涉及 schema 改动）。
- 没查到同名活跃条目（含「同名条目已被软删」的情形——`activeItemByName` 本来就只查
  `deleted_at IS NULL` 的行，查不到即视为无冲突）→ 原样落到「全新条目 + version 1」分支，**行为完全不
  变**（回收站里的旧同名条目不受影响）。

`uploadFile` 的输入类型抽成具名 `UploadFileInput`（原来是内联在 `DriveRepository` 类型字面量里），供
`appendUploadedVersion` 复用，避免类型重复。

### 决策说明：「目标条目已软删」这条 409 情形怎么落地的
任务原文列了三种「仍保持 409」的情形：同名撞文件夹、撞文件夹、目标条目已软删（按仓库现状语义）。前两条
在代码里是同一个判断（`existingActive.kind !== "file"`），已确认无歧义。第三条有歧义——`activeItemByName`
的既有语义本来就只匹配 `deleted_at IS NULL` 的行，「同名条目已经在回收站里」在**今天的仓库现状**下根本
不算冲突（`activeItemByName` 查不到，直接落到全新条目分支，这是删除后重新上传同名文件的既有回收站行
为）。把这种情况新增成 409 会是一个**新的限制**，不是「保持现状」。我按字面「按仓库现状语义」最保守地
理解为：不新增限制，只在真正的并发竞态窗口（预检时活跃、拿锁那一刻发现已被软删）里保持 409，因为那确实
是「防止在条目已经不可用时还悄悄建一个重名条目」的既有仓库编码习惯（`softDeleteItem`/`rollbackToVersion`
都有类似的「拿锁后重新校验再抛冲突」的写法）。如果人工验收的原始报告对这条有更明确的界定，请指出，我可以
按实际预期调整（改动会很局部，就是 `appendUploadedVersion` 顶部那个 `if` 判断）。

### 行为变化
- Before：`POST /drive/projects/:id/files` 撞同名活跃文件 → 409 `drive_name_conflict`，用户只能改名。
- After：撞同名活跃文件 → 200，响应是刷新后的网盘页（`selected_item_id` 还是同一个 item，
  `current_version`/`current_version_id` 指向新插入的版本，`version_no` 递增，历史版本原样留着）。撞
  同名文件夹、或并发竞态里目标条目被抢先软删，仍然 409。

### 测试
- `packages/db/src/drive-versions-repository.test.ts`（8 → 12，+4，query-recorder 风格，仿旁边
  `rollbackToVersion` 的既有写法，不连真库）：
  - 撞同名活跃文件 → 追加版本成功（`version_no` 递增而非重置为 1、`item.currentVersionId` 更新、只
    insert 版本行不 update/delete 历史版本行、写了 operation + audit）。
  - 撞同名文件夹 → 仍 409，且在锁/插入之前就拒绝（只 2 条查询）。
  - 没有同名活跃条目 → 仍走全新条目+version 1（回归防护，确认没改坏原路径）。
  - 并发竞态下拿锁后发现条目已被软删 → 视为冲突拒绝，不悄悄建重名条目。
- `apps/api/src/drive-pages.test.ts`（73 → 74，+1，服务层）：假仓库模拟“仓库层追加版本成功”的返回值，
  断言 `service.uploadFile` 正常 `resolve`（不再抛 409），刷新出来的页面 `selected_item_id` 落在同一个
  item 上、`current_version.version_no` 反映追加后的版本号。
- 未新增 env-gated 真 PG 测试：仓库里已有的真 PG drive 竞态覆盖在
  `apps/api/src/qa/r2-pg-redis-smoke.ts`，但该文件不在本次任务的范围围栏内（只列了
  `apps/api/src/services/drive-pages.ts` 及其测试、`packages/db` 的 drive/workspace-memberships 仓库及
  测试），按铁律 7「不许碰当前批次范围外的文件」没有动它。**待人工**：如果需要真 PG 覆盖，建议另起一个
  任务在 `r2-pg-redis-smoke.ts` 里补一段（本文件已有大量 `drive.uploadFile` 真库用例可以照抄）。

## 3. 验收对齐：demo-walkthrough.md §4

核对过 `r12-desktop-workbench/demo-walkthrough.md` §4「版本回滚」演示线：步骤 4.3（“再上传一份同名/同
目标文件的新内容…”，预期“文件行更新，版本数变化”“两条版本记录，current 指向最新”）描述的正是本次修复
之后的行为，脚本本身已经是照着*期望*行为写的，不是照着 Bug 修复前的行为写的——**无需改动脚本**。整条
4.2 → 4.3 → 4.5 → 4.6 走下来对应「同名上传→v2→找回v1→v3」，跟修复后的实现一致。没有发现脚本与实现的
出入。

## 4. 自查

```
pnpm --filter @workhub/api test    → 1057 tests, 1056 pass, 1 skip（真 PG 门，无 DATABASE_URL 时按设计跳过）, 0 fail
pnpm --filter @workhub/db test     → 242 tests, 240 pass, 2 skip（同上）, 0 fail
pnpm -r typecheck                  → 16/17 workspace 全部 Done，0 错误（第 17 个 client-tauri 是 Rust，不在这条命令范围内）
git status                         → 只有本次改动的 5 个文件，干净
```

改动文件（targeted，未 `git add -A`）：
- `apps/api/src/routes/auth.ts`（+41 行）：`ensureDefaultWorkspaceMembership` + 两处调用。
- `apps/api/src/auth.test.ts`（+108 行）：ENV-01 六条新测试。
- `packages/db/src/repositories/drive.ts`（+133/-14 行）：`UploadFileInput` 具名类型、
  `appendUploadedVersion`、`uploadFile` 分支改造。
- `packages/db/src/drive-versions-repository.test.ts`（+159 行）：E-01 四条新测试。
- `apps/api/src/drive-pages.test.ts`（+68 行）：E-01 服务层一条新测试。

## 5. 改过的断言

没有改动任何既有断言——所有新增都是纯新增测试。`apps/api/src/drive-pages.test.ts` 里那两条既有的
「假仓库主动 throw `DriveRepositoryConflictError`」测试（约 3306 行、3361 行附近）没有动：它们测的是
“如果仓库层抛这个错，服务层要正确映射成 409 并清理已落盘的字节”这条**通用映射逻辑**（对折叠文件夹撞名
等仍然会 409 的情形依然成立），跟本次改的“仓库层对同名活跃文件不再抛这个错”是两回事，不冲突、不需要改。

## 6. 范围外发现

无。（两处修复都严格在范围围栏内完成，没有顺手碰 `packages/contracts`、`openapi.ts`、`app.ts`、
`desktop-webview`、`client-tauri`。）

## 7. 没做 / 存疑

- E-01「目标条目已软删」这条 409 情形是任务描述转述里的一句话，验收报告原文（rebase 后已能读到）完全没
  提这个场景——已确认我的保守解读（不新增限制，只在并发竞态窗口里生效）不影响本次验收判据，见第 0/2 节。
- 未新增 `apps/api/src/qa/r2-pg-redis-smoke.ts` 里的真 PG 版本追加断言（超出本次范围围栏，见第 2 节）。
- 极小概率的 TOCTOU 竞态（两个并发上传同时对同一个全新文件名发起“brand-new item”插入）仍然沿用修复前
  就有的行为——被 `isActivePathUniqueViolation` 捕获后回 409，不会升级成“自动重试为追加版本”。这与
  E-01 描述的核心场景（用户主动对已存在的文件重新上传）无关，只是一个未被要求覆盖的边界，如实记录。
- 本次任务只覆盖 ENV-01 / E-01 两项。验收报告里的 D-01（模式五档弹层打不开）、F-01/F-02（毛玻璃/标题栏
  拖动）已经在 `origin/main` 的 `a92b7bca fix(desktop): close acceptance findings D-01 and F-02` 里被
  另一条工作线处理（rebase 时带入，未与本次改动冲突，也不在本次范围内，未做核实）。A/B/G 三条主线依赖
  ENV-01 修复后才能重新人工验收，不在本次服务端代码修复的自查范围内（需要真机 + 真双账号重新走一遍
  `demo-walkthrough.md`）。
