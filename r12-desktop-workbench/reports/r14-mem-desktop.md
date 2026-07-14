# R14 批 MEM · W-C desktop-memory-view 施工汇报

- 分支：`r14/mem-desktop`
- 施工说明书：`r14-release-readiness/03-mem-design.md` §6.2（独立 Spotlight 能力视图方案）+ §2（语义红线）
- 服务端依赖：`r12-desktop-workbench/reports/r14-mem-server.md`（8 端点已挂载，`3b471d18`）
- 验收自查：`@workhub/desktop-webview` test + `pnpm -r typecheck` 全绿（见文末计数）

## 1. 做了什么

### §6.2 独立能力视图（不塞进 settings 内联区块）

- 新文件 `apps/desktop-webview/src/spotlight/views/memory.ts`：`createMemoryView()` 实现
  `SpotlightCapabilityView`，照 `drive.ts` 的 list→detail 结构。两个 tab（`memoryTabsHtml`，
  `ctx.setSubtitle` 随 tab 切换显示「关于我」/「团队技能」）：
  - **关于我**（`GET/PATCH/DELETE /api/me/memories`）：列表（`value_md` 摘要 + category 徽标 `wh-spot-row-tag`
    + 出处行）→ 详情（完整正文 + 出处 + `edited_at` 叠加行）→ 编辑（整段替换 textarea +
    `expected_updated_at` 乐观并发，409 提示刷新）→ 删除（armed 两步确认）。
  - **团队技能**（`GET/PATCH /api/team-skills/manage` + `POST .../deactivate`）：全员可读列表（`status`
    徽标含 deprecated）→ 详情（`content_md` 全文、版本/样本数/置信度、K2 精修出处或
    ai/human 创建标注）→ 编辑（仅 `isAdmin`：K2「选段→改文本」最简表单——解析 `## 标题` 分节为可点
    chip，选中段落预填正文，改完提交单个 `modify_section` op；另有「+ 新段落」chip 走
    `add_section`；`base_version` 用当前 `item.version`）→ 停用（仅 `isAdmin`，armed 两步确认 + 可选
    reason 输入框）。
  - **出处渲染**：服务端已经三级降级拼好人话 `provenance.label`（03-mem-design §2.3），前端只在
    `provenance` 缺省时兜底「早期记录，出处不明」，不编造、不留空白；`edited_at` 非空时叠加独立一行
    「最近由你于 X 修改」（不与出处合并）。
  - **错误文案**：服务端错误 `message` 恒为中文硬编码字面量（无 i18n 分支），en-US 桌面不能直接透传——
    按 `error.code` 建了双语查表（`MEMORY_ERROR_MESSAGES`/`SKILL_ERROR_MESSAGES`，覆盖 03-mem-design
    §3 表格列出的全部错误码），未知 code 落通用兜底。
  - **armed 两步确认**：`decideArmedConfirmation` 纯函数 + 5 秒自动复原定时器，写法照抄
    `apps/desktop-webview/src/workbench/drive/side-panel.ts` 的 `decideRollbackConfirmation`/
    `armedRollbackTimer`——**只借鉴写法，未 import、未改 workbench/** 任何文件**（工包围栏禁区）。
  - **isAdmin 判定**：mount 时调 `ctx.client.me()`（`GET /api/auth/me`，桌面既有身份来源——`browser.ts`
    启动时同一方法做死 token 自愈判定；此前没有任何 Spotlight 视图直接调用它，本视图是第一个消费点）取
    `is_admin`，与列表/详情加载并行、失败/未就绪时 fail-closed（不显示编辑/停用按钮），就绪较晚且用户已
    在团队技能 tab 时补一次重渲。

### 接线（command-palette / registry / settings 入口）

- `apps/desktop-webview/src/command-palette.ts`：`CommandId` 加 `"memory"`；`commandRegistry` 加一条
  「Cuu 的记忆」命令，`action: {kind:"open-window", target:"memory"}`（与 `settings` 同款
  `open-window`——两者都是「设置区旁挂」语义，见文件内注释）。
- `apps/desktop-webview/src/spotlight/registry.ts`：`builtViews` 加 `memory: createMemoryView`。
- `apps/desktop-webview/src/spotlight/views/settings.ts`：`settingsHtml()` 加一行可点导航
  `<button data-set-open-memory>`（同「桌面客户端」那种展示 row 的视觉位置，但可点击），点击调
  `ctx.open("memory")`；`createSettingsView().mount()` 的点击委托里加对应分支。

## 2. 偏离说明（禁区外必要改动，逐条列明理由）

1. **`apps/desktop-webview/src/browser.ts` 加了一行**——不在工包字面授权范围（「只许动
   `apps/desktop-webview/src/{command-palette.ts, spotlight/**}`」），但该文件的
   `COMMAND_ROUTE: Record<CommandId, string>` 是一张穷举表（文件内既有注释承认这条路径已是死代码，
   `mountCommandHome()`/`boot()` 没有任何调用点，但仍编译进 bundle、`Record<CommandId,string>` 仍要求
   TS 穷举全部键）。`CommandId` 新增 `"memory"` 后，不补这一行会导致 `apps/desktop-webview` 编译失败——
   `pnpm -r typecheck` 全绿是验收硬指标，此文件既不属于 `workbench/**` 也不是 `spotlight/views/search.ts`
   （两处真正的并行 agent 地盘），风险可控。照 R12 批 1 新增 `workbench`/`new_project` 时的同款先例
   （给死路径一个占位路由，真实路由走 `bootSpotlight()`/`registry.ts`），加了一行注释说明理由。
2. **`apps/desktop-webview/src/command-palette.test.ts`**——`commandRegistry` 的穷举断言列表需要加
   `"memory"`（属于「注册表可能有穷举断言，正当扩展列明理由」的既知情形）。`registry.test.ts` 本身遍历
   `commandRegistry` 动态断言，无需改动。
3. **K2 团队技能编辑范围收窄为「改」+「加」，不做「删段落」UI**——03-mem-design §3.2 原话
   「选段→改文本，≤3 op」字面只要求「选一段、改文字」这一个最简流程；`remove_section` 虽然后端
   `skillEditOpSchema` 支持，但设计正文没有点名要求这个动作出现在管理面 UI 上（对比「删除整条记忆」/
   「停用整个技能」这两个被 §2 明确点名要求 armed 确认的动作）。为避免范围膨胀出第二套无设计文档背书的
   确认流程，本批只做 `modify_section`（选段改文本）+ `add_section`（新段落，覆盖「补充新指引」的
   自然需求），不建 `remove_section` 的入口。后端校验/仓库方法不受影响，若后续要加，是纯前端补丁。
4. **未做团队技能「查看历史版本详情」的深链**——列表里非 active 的历史版本（deprecated）显示徽标即可
   点开详情（只读，无编辑/停用按钮，因为 `opts.isAdmin && item.status === "active"` 门控），满足
   03-mem-design 「管理面列表比现有消费页多……含 deprecated 状态的历史版本」的字面要求，未额外做版本间
   diff 或时间线视图（不在拍板范围内）。

## 3. 测试与 typecheck

| 检查 | 结果 |
|---|---|
| `pnpm --filter @workhub/desktop-webview test`（前） | 966/966 通过（改分支基线） |
| `pnpm --filter @workhub/desktop-webview test`（后） | **992/992** 通过（+26：`memory.test.ts` 新增 25 条
  纯函数 + mount 集成测试，`settings.test.ts` 新增 1 条记忆入口导航测试） |
| `pnpm -r typecheck`（16 个受影响包，含 `apps/desktop-webview`） | 全绿 |

`memory.test.ts` 覆盖：category/status 双语标签、出处三级降级兜底文案、`edited_at` 叠加行、armed
确认状态机、错误码双语查表（含未知 code 兜底）、tab 切换 aria、列表/详情/编辑态 HTML 结构、
`parseSkillSections` 分节解析、mount 级集成（默认关于我 tab 加载、tab 懒加载并缓存、非管理员看不到
编辑/停用按钮、删除两次点击才真正 DELETE、编辑 409 冲突显示对应文案、管理员编辑技能段落 PATCH 出正确
`ops`/`base_version`、停用 armed 确认 + 可选 reason 转发）。

## 4. 完成矩阵（对照施工说明书要点重申 1-5）

| 要点 | 状态 |
|---|---|
| 1. 独立能力视图（非 settings 内联）+ CommandId/命令条目 + registry 接线 + `spotlight/views/memory.ts` | 完成 |
| 2. settings.ts 可点导航 row → `ctx.open("memory")` | 完成 |
| 3. 两 tab、`setSubtitle`；关于我＝列表→详情→编辑→删除（armed）；团队技能＝全员读列表 + 仅
  admin 编辑（K2 最简表单）/停用（armed + 可选 reason） | 完成（编辑范围见偏离 3） |
| 4. 桌面用「Cuu」+ 无 emoji + 中文人话 | 完成 |
| 5. api 取数照 spotlight 其他视图 client 模式（`ctx.client.request`/`ctx.client.me()`） | 完成 |

## 5. 未做 / 留给后续

- `remove_section` 编辑动作的 UI（见偏离 3）。
- 团队技能历史版本的 diff/时间线视图（不在拍板范围）。
- 用户记忆 `category` 过滤 UI（设计未点名，管理面列表本就 ≤50 条，暂不需要）。
