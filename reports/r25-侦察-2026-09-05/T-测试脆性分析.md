只读侦察完成。全部结论基于精确 grep 计数与 file:line，未做任何写操作。

---

# A 节：重复覆盖同一行为的测试族（按可精简行数降序）

## A1. 路由测试的鉴权脚手架逐文件复制 —— 可精简约 1700 行

**精确计数**（模式 → 命中/文件，均已排除 `.claude/**`、`reference/**`、`node_modules/**`）：

| 模式 | 文件数 | 命中数 |
|---|---|---|
| `function authDeps` | 41 | 41 |
| `class MemoryUsers` | 43 | 43 |
| `implements ClientDeviceRepository` | 42 | 42 |
| `generateSignedCookie(COOKIE_NAME` | 45 | 64 |
| `function settings(): Settings` | 40 | 40 |

用 `awk '/^(class MemoryUsers|class MemoryDevices)/,/^}/'` + `awk '/^function (settings|authDeps|user|cookie)/,/^}/'` 对 41 个 `authDeps` 文件求和：**严格重复的脚手架 = 1943 行**。41 个文件首个 `test()` 之前的前言合计 **10511 行，均值 256 行/文件**。

**逐字对照证据**：`diff <(sed -n '1,180p' apps/api/src/routes/conversation-rename.test.ts) <(sed -n '1,182p' apps/api/src/routes/conversation-cuu.test.ts)` 只有 **30 行差异（15 对）**——即 180 行前言中约 165 行完全一致，差异全部是常量改名（`cookie-r14fix-owner` → `cookie-r15-cuu-owner`）和被测工厂名。

每文件脚手架规模（前 5）：
- `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/audit.test.ts` 66 行
- `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/approvals.test.ts` 65 行
- `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/drive-pages.test.ts:2619` 起 56 行
- `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/agent-runs.test.ts:304` 起 56 行
- `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/routes/conversation-rename.test.ts:52` 起 43 行

抽成一个 `test-support/auth-harness.ts`（导出 `createAuthedRouteApp({ cookieToken, service })`），每文件保留 ~6 行配置，可删 **约 1700 行**。

---

## A2. 路由守卫「四联测试」跨 9 个文件逐字重复 —— 可精简约 770 行

同一条规则（未登录 401 / 非法 UUID 404 / 畸形 body 422 / 透传 service 的 typed 错误）在每个路由文件各写一遍。

**精确计数**：
- `"requires authentication before reaching the service"` → **14 命中 / 10 文件**
- `"without entering the service"` → **10 命中 / 10 文件**
- `"preserves the service's typed"` → **17 命中 / 8 文件**
- `"422s before the service"` → **5 命中 / 5 文件**

**file:line 对照（同一行为，46 个用例，实测跨度合计 921 行）**：

| 行为 | 位置 |
|---|---|
| 未登录先 401，不进 service | `routes/workspace-members.test.ts:142`、`:203`；`routes/conversation-rename.test.ts:178`；`routes/conversation-cuu.test.ts:182`；`routes/conversation-turns.test.ts:171`；`routes/conversation-typing.test.ts:254`；`routes/conversation-participants.test.ts:162`、`:269`、`:376`；`routes/dm.test.ts:200`、`:323`；`routes/drive-versions.test.ts:233`、`:343`；`routes/spotlight-intent.test.ts:145` |
| 非法 UUID → 统一 404，不进 service | `conversation-routes.test.ts:278`；`routes/conversation-rename.test.ts:198`；`routes/conversation-cuu.test.ts:202`；`routes/conversation-turns.test.ts:191`；`routes/conversation-typing.test.ts:273`；`routes/conversation-army.test.ts:262`；`routes/conversation-participants.test.ts:178`、`:394`；`routes/workspace-members.test.ts:219`；`action-card-routes.test.ts:195` |
| 畸形 body → 422，先于 service | `routes/conversation-rename.test.ts:226`；`routes/conversation-cuu.test.ts:230`；`routes/conversation-turns.test.ts:219`；`routes/dm.test.ts:220`；`routes/spotlight-intent.test.ts:165` |
| 透传 service typed 错误 | `routes/conversation-rename.test.ts:284`、`:309`；`routes/conversation-cuu.test.ts:283`、`:312`、`:333`；`routes/conversation-turns.test.ts:272`、`:297`；`routes/conversation-participants.test.ts:250`、`:349`、`:445`；`routes/dm.test.ts:273`、`:298`；`routes/workspace-members.test.ts:185`、`:260`；`routes/drive-versions.test.ts:322`；`routes/spotlight-intent.test.ts:222`、`:247` |

实测各文件这批测试的行数：rename 119、cuu 138、participants 159、turns 135、dm 106、drive-versions 44、spotlight-intent 93、workspace-members 86、typing 41 = **921 行**。改成一张表驱动的 `describeRouteGuards(factory, cases)` 后约 150 行，**可删 770 行**。

---

## A3. db 层 workspace_id 隔离断言按仓储方法逐一重测 —— 可精简约 250–350 行

**精确计数**：`queryReferences\([^,]+,\s*\w+\.workspaceId\)|queryParamValues\([^)]*\)\.includes\(workspaceId\)` → **142 命中 / 21 文件**（`packages/db/**/*.test.ts`）。

分布前 6：
- `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/task-plans.test.ts` **58**
- `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/confidence.test.ts` **23**
- `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/agent-memory.test.ts` **16**
- `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/objectives.test.ts` **14**
- `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/budget-reservations.test.ts` **9**
- `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/user-memory.test.ts` **6**

逐字重复行示例（同一断言文本跨文件出现）：
- `assert.ok(queryParamValues(query?.where).includes(workspaceId));` — 14 次，跨 `user-memory.test.ts:86`、`confidence.test.ts:33`、`:67`、`objectives.test.ts:334`、`agent-memory.test.ts:139`、`task-plans.test.ts:313`、`:383`、`:564` 等
- `assert.ok(queryReferences(scopeQuery?.where, workItems.workspaceId));` — 5 次：`objectives.test.ts:189`、`:235`、`task-plans.test.ts:77`、`:341`、`:438`
- `assert.ok(queryReferences(scopeQuery?.where, workItems.deletedAt));` — 5 次：`objectives.test.ts:191`、`:236`、`task-plans.test.ts:78`、`:342`、`:439`
- `assert.deepEqual(transactions, [{ outcome: "resolved" }]);` — **34 次**跨 `projects-r12.test.ts:107/132/150/178/280`、`budget-reservations.test.ts:193`、`work-items-handover.test.ts:33` 等

这是"每个方法都手写一遍租户围栏断言"，宜换成一个 `assertTenantFenced(query, table)` 断言助手 + 一张方法清单。

---

## A4. gold-path 渲染断言在 packages/ui 内部 + apps/web 三处重复 —— 可精简约 120 行

**逐字相同的断言行**（跨文件）：

| 断言 | 位置 A | 位置 B |
|---|---|---|
| `assert.equal(approvals.html.includes("<strong>Tool approval</strong>"), true);` | `packages/ui/src/gold-path/render.test.ts:94` | `packages/ui/src/gold-path/route-components.test.ts:3330` |
| `...includes("tool.write_file"), false` | `render.test.ts:91` | `route-components.test.ts:3316` |
| `...includes("2026-07-05T00:00:00.000Z"), false` | `render.test.ts:93` | `route-components.test.ts:3329` |
| `...includes(">Routed</span>"), true` | `render.test.ts:97` | `route-components.test.ts:3273` |
| `...includes('data-r4-approval-page-has-more="true"'), true` | `render.test.ts:75` | `route-components.test.ts:3345` |
| `...includes('data-r4-route-component="notifications"'), true` | `apps/web/src/routes.test.ts:2310` | `route-components.test.ts:3714` |
| `...includes('data-r5-notifications-route="true"'), true` | `apps/web/src/routes.test.ts:2311` | `route-components.test.ts:3715` |
| `...includes('data-r5-notification-needs-decision-count="1"'), true` | `apps/web/src/routes.test.ts:2312` | `route-components.test.ts:3716` |
| `...includes('data-r4-route-component="calendar"'), true` | `apps/web/src/routes.test.ts:2314` | `route-components.test.ts:3839` |
| `...includes('data-r5-calendar-route="true"'), true` | `apps/web/src/routes.test.ts:2315` | `route-components.test.ts:3840` |
| `...includes('data-r5-calendar-date="2026-06-11"'), true` | `apps/web/src/routes.test.ts:2316` | `route-components.test.ts:3841` |

**整块测试重复**：
- 「不泄漏 raw approval facts」：`packages/ui/src/gold-path/render.test.ts:80-99`（20 行）↔ `packages/ui/src/gold-path/route-components.test.ts:3303-3341`（39 行）——同一断言集，只是入口从 `renderGoldPathSurface` 换成 `renderWebRouteComponents`
- 「page_info 截断」：`render.test.ts:67-78`（12 行）↔ `route-components.test.ts:3343-3353`（11 行）

---

## A5. settings 面板 render 层与 view 层同行为双测 —— 可精简约 130 行

`apps/desktop-webview/src/workbench/settings/render.test.ts`（545 行）纯渲染断言，`.../view.test.ts`（1126 行）挂载 DOM 后跑同一条规则。9 对：

| 行为 | render.test.ts | view.test.ts |
|---|---|---|
| 未绑定 GitHub → 占位 + owner 的 bind CTA | `:181` | `:424` |
| 已绑定 → repo/同步时间/7 天活动 | `:192` | `:439` |
| GH 加载失败 → 独立 retry 钩子 | `:175` | `:471` |
| PAT 永不回显 | `:276` | `:500` |
| owner-only 只读态是诚实说明 | `:128` | `:216` |
| risk monitor 只读态无写钩子 | `:319` | `:797` |
| instructions 只读态渲染只读文本 | `:409`、`:424` | `:1072` |
| instructions forbidden 态无 textarea | `:438` | `:950` |
| instructions 错误态 scoped retry | `:454` | `:1028` |

`view.test.ts` 侧是真行为（发不发 PATCH），`render.test.ts` 侧只是重述同一 HTML；删 render 侧这 9 个即可。

---

## A6. drive 版本历史三层重测 —— 可精简约 120 行

| 规则 | 仓储层 | 服务层 | 路由层 |
|---|---|---|---|
| `drive_versions_unavailable`（8 命中/2 文件） | — | `apps/api/src/drive-pages.test.ts:4258`、`:4356` | `apps/api/src/routes/drive-versions.test.ts:309`、`:403` |
| 回滚到"已是当前版本" → 冲突 | `packages/db/src/drive-versions-repository.test.ts:198` | — | `apps/api/src/routes/drive-versions.test.ts:417` |
| limit 越界钳制 | `packages/db/src/drive-versions-repository.test.ts:106`（钳进 [1,200]） | — | `apps/api/src/routes/drive-versions.test.ts:290`（忽略非正/畸形 limit） |
| 目标不存在/是文件夹/已删 → null/404 | `packages/db/src/drive-versions-repository.test.ts:121`、`:131`、`:244` | `apps/api/src/drive-pages.test.ts:4268`、`:4342` | `apps/api/src/routes/drive-versions.test.ts:246`、`:358` |

---

## A7. workspace-members roster 分页/403 三层重测 —— 可精简约 90 行

| 规则 | 契约层 | 仓储层 | 路由层 | 服务层 |
|---|---|---|---|---|
| limit/offset 默认值与越界回落 | `packages/contracts/src/workspace-roster.test.ts:12`、`:17`、`:21` | `packages/db/src/memberships-roster.test.ts:102` | `apps/api/src/routes/workspace-members.test.ts:458` | — |
| 分页上限不再硬卡 200 | — | `packages/db/src/memberships-roster.test.ts:86` | `apps/api/src/routes/workspace-members.test.ts:481` | — |
| 非 manager → 403 | — | — | `apps/api/src/routes/workspace-members.test.ts:185` | `apps/api/src/services/workspace-members.test.ts:264` |

---

## A8. i18n 双语文案逐字符串断言 —— 分散在 61 个文件

**精确计数**：
- `'zh-CN'|"zh-CN"` → **987 命中 / 120 文件**
- `'en-US'|"en-US"` → **501 命中 / 69 文件**
- **同时含两者的文件：61 个**
- 断言行里含 ≥8 个连续中文字的 `assert.*(...)` 行 → **341 命中**；含 ≥10 连续中文字的字面量 → **1916 命中**

热点（zh-CN / en-US）：
- `/Users/apple/Desktop/开发项目/WorkHub/packages/ui/src/gold-path/route-components.test.ts` 103 / 94
- `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/workbench/chat/render.test.ts` 85 / 18
- `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/workbench/rail.test.ts` 79 / —
- `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/work-items-service.test.ts` 61 / 3
- `/Users/apple/Desktop/开发项目/WorkHub/apps/web/src/routes.test.ts` 34 / 54

同一条文案在多文件各测一遍的实例：
- `你没有权限修改这个事项。` — **19 命中 / 7 文件**：`workitems.test.ts:545/569/717/742`、`gold-path.test.ts:1342/1365/1443/1466`、`work-items-service.test.ts:675/1737/1908`、`agent-runs.test.ts:1398/1424/3485`、`services/escalations.test.ts:829/861`、`proposals.test.ts:189/211`、`project-timeline.test.ts:170`
- `没有找到这个会话。` — **11 命中 / 8 文件**：`routes/conversation-typing.test.ts`、`routes/conversation-rename.test.ts`、`routes/conversation-participants.test.ts`、`routes/conversation-cuu.test.ts`、`conversation-routes.test.ts`、`routes/conversation-turns.test.ts`、`ai-feedback.test.ts`、`apps/web/src/routes.test.ts`

对照：真正的 i18n 专测文件极小（`packages/ui/src/gold-path/i18n.test.ts` 19 行、`packages/ui/src/task-plan-i18n.test.ts` 36 行、`packages/web-runtime/src/locale.test.ts` 32 行）。也就是说文案覆盖几乎全部散落在 61 个渲染/路由测试里，不在字典层集中断言。

---

## A9. apps/web loader 的 re-auth 规则四份复制 —— 可精简 28 行

`/Users/apple/Desktop/开发项目/WorkHub/apps/web/src/routes.test.ts` 中 4 个 10 行测试测同一条规则（loader 必须重抛 `not_identified` 而非降级）：`:1711-1720`、`:1754-1763`、`:2468-2477`、`:2479-2488`。参数化成一张 loader 表约 12 行。

---

### A 节合计估算
**约 3100–3200 行可合并/删除**，其中 A1（1700）+ A2（770）占 77%，且这两项风险最低——纯脚手架/纯样板，不减少任何行为覆盖。

---

# B 节：只测实现细节、对重构极脆的测试（按可精简行数降序）

## 全局命中计数（精确模式 + 命中数）

| # | 模式 | 命中 | 文件数 |
|---|---|---|---|
| P1 | `assert\.(match\|doesNotMatch)\([^,]*innerHTML` | **251** | 11 |
| P2 | `innerHTML`（原始 token） | **297** | 18 |
| P3 | `assert\.(match\|doesNotMatch)\((html\|markup\|out\|rendered\|body\|view)\b` | **1124** | 60+ |
| P4 | `html\.includes\(` | **1988** | — |
| P5 | `[^>]*`（正则里的属性顺序胶水） | **156** | 17 |
| P6 | `includes("<`（精确标签串） | **44** | 13 |
| P7 | `data-testid` / `[data-` | **210+** | 20 |
| P8 | `assert.*` 行含 ≥8 连续中文字 | **341** | 60+ |
| P9 | `toMatchSnapshot` / `toMatchInlineSnapshot` | **0** | 0 |
| P10 | `outerHTML` | **0** | 0 |

好消息：没有任何快照测试（P9/P10 = 0）。坏消息：等价的脆性以手写正则形式出现了 1400 多处。

**P1 按文件**：`pet-surface.test.ts` 118、`workbench/settings/view.test.ts` 51、`spotlight/views/settings.test.ts` 45、`spotlight/views/memory.test.ts` 8、`spotlight/views/search.test.ts` 6、`spotlight/views/replay.test.ts` 6、`spotlight/views/attention.test.ts` 6、`spotlight/views/workbench-open.test.ts` 5、`apps/web/src/browser-actions.test.ts` 2、`spotlight/views/workitem.test.ts` 2、`apps/desktop-webview/src/main.test.ts` 2。

**P3 按文件（前 8）**：`workbench/chat/render.test.ts` 355、`workbench/settings/render.test.ts` 111、`workbench/rail.test.ts` 70、`workbench/drive/render.test.ts` 66、`workbench/army/render.test.ts` 59、`spotlight/views/settings.test.ts` 51、`cuu-preferences.test.ts` 45、`spotlight/views/proposals.test.ts` 30。

**P5 按文件**：`workbench/rail.test.ts` 24、`workbench/chat/render.test.ts` 24、`gold-path/route-components.test.ts` 18、`spotlight/views/settings.test.ts` 10、`workbench/drive/render.test.ts` 9、`workbench/settings/render.test.ts` 8、`apps/web/src/routes.test.ts` 4、`workbench/settings/view.test.ts` 4、`workbench/army/render.test.ts` 3、`spotlight/views/search.test.ts` 3、`cuu-preferences.test.ts` 3、`pet-surface.test.ts` 2。

**P7 按文件（前 6）**：`workbench/settings/view.test.ts` 56、`spotlight/views/settings.test.ts` 23、`spotlight/views/search.test.ts` 22、`spotlight/views/memory.test.ts` 20、`workbench/proposal/panel.test.ts` 15、`pet-surface.test.ts` 12。

**P8 按文件（前 6）**：`gold-path/route-components.test.ts` 27、`conversation-turns.test.ts` 17、`workbench/chat/render.test.ts` 15、`desktop-cuu-runtime.test.ts` 14、`packages/agent/src/turns/prompt.test.ts` 12、`workbench/settings/render.test.ts` 11。

---

## 最脆的 10 个位置

**1. `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/pet-surface.test.ts:709`** —— 最脆。假 DOM 的 `querySelector` 自己用正则从 `innerHTML` 里抠元素：

```
const href = new RegExp(`href="([^"]+)"[^>]*data-cuu-action-id="${actionId}"`, "u").exec(this.innerHTML)?.[1];
```

要求渲染产物里 `href` **必须排在** `data-cuu-action-id` 之前。渲染器交换属性顺序 → 假 DOM 静默返回 `null` → 整个「Enter 发送」测试族以非行为原因红掉，且报错完全指不到根因。该文件另有 118 处 `assert.match(root.innerHTML, ...)` 全部依赖这套假 DOM（`:696`、`:699`、`:702` 同样是 `innerHTML.includes('attr="value"')` 字符串匹配）。

**2. `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/workbench/chat/render.test.ts:1995`**
```
assert.match(selected, /class="wh-wb-mode-lvl wh-wb-mode-lvl--on wh-wb-mode-lvl--warn" data-wb-chat-mode-option="5"/u);
```
锁死了 class 内部的三个 token 顺序 + class 与 data 属性的相对顺序。配套 `:1980`、`:1983`、`:1994` 同款。

**3. `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/workbench/chat/render.test.ts:2246` 与 `:2252`**
```
assert.match(useful, /wh-wb-chat-fb-badge wh-wb-chat-fb-badge--useful" data-wb-chat-feedback-note-toggle="m1">✓/u);
assert.match(notUseful, /wh-wb-chat-fb-badge wh-wb-chat-fb-badge--not-useful" data-wb-chat-feedback-note-toggle="m1">✗/u);
```
class 顺序 + 属性顺序 + 字面字形 `✓/✗` 三重耦合。换个图标或加个 class 就红。

**4. `/Users/apple/Desktop/开发项目/WorkHub/packages/ui/src/gold-path/route-components.test.ts:1360`**
```
assert.equal(workitem.html.includes('data-action-id="create_task_plan" role="button" data-method="POST"'), true);
```
三个属性的精确书写顺序。

**5. `/Users/apple/Desktop/开发项目/WorkHub/packages/ui/src/gold-path/route-components.test.ts:2422-2425`**
```
assert.equal(zh.html.includes("<h3 role=\"heading\" aria-level=\"2\">会话</h3>"), true);   // 及 网盘/任务/会议
```
标签名 + 属性顺序 + 中文文案四重耦合，4 行一组。改 `h3→h2`、加 class、或改「会话」为「对话」都必改测试。

**6. `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/workbench/settings/render.test.ts:419`**
```
assert.match(html, /<pre class="wh-wb-pset-instr-readonly" data-wb-instr-readonly="true">别用黑话<\/pre>/u);
```
完整标签 + class 名 + 属性 + 用户输入文案全锁死。同文件 `:480`、`:483`、`:102`、`:103`（`data-sel="true" data-wb-pset-quiet-weekday="1"`）、`:252`、`:253` 同类，共 8 处 P5 命中。

**7. `/Users/apple/Desktop/开发项目/WorkHub/apps/web/src/routes.test.ts:1930-1934`**
```
assert.equal(skills.html.includes("<strong>5</strong><span>Active skills</span>"), true);
assert.equal(skills.html.includes("<strong>2</strong><span>Refined</span>"), true);
assert.equal(skills.html.includes("<strong>3</strong><span>AI-authored</span>"), true);
```
断言两个相邻兄弟节点之间**没有空白**。加一个换行/缩进即红。`:1940` 同款。

**8. `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/spotlight/views/settings.test.ts:237-239`**
```
assert.match(body.innerHTML, /data-set-ai-mode="4" data-sel="true"/u);
assert.match(body.innerHTML, /data-set-ai-dispatch="ask" data-sel="true"/u);
assert.match(body.innerHTML, /data-set-ai-proactivity="proactive" data-sel="true"/u);
```
该文件 45 处 innerHTML 正则里有 16 处带属性顺序胶水；`:425`、`:459`、`:466`、`:533`、`:573` 的 `data-set-profile-title[^>]*value="前端负责人"` 还额外把顺序耦合和中文文案绑在一起。

**9. `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/workbench/rail.test.ts:186`、`:210`、`:233`**
```
assert.match(selected.match(/<button[^>]*data-wb-open-timeline[^>]*>/u)![0], / sel/u);
```
先用正则手工切出 `<button ...>` 片段，再在原始属性串里匹配裸的 ` sel`。`![0]` 还是非空断言——渲染结构一变就是 `TypeError` 而非有意义的断言失败。该文件 24 处 P5 命中，其中 `:151/:165/:178/:291/:414/:427/:429/:583/:827/:857` 是 `<button[^>]*data-xxx[^>]*>[^]*中文标签` 的结构+文案双耦合。

**10. `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/workbench/settings/view.test.ts:308` 与 `:260/:263/:270`**
```
assert.match(container.innerHTML, /value="120" data-wb-pset-silence-input/u);
assert.match(container.innerHTML, /data-on="false"[^>]*data-wb-pset-observer/u);
```
以及 `:613` 断言整句中文错误文案 `GitHub 集成未配置加密密钥，请联系管理员查看部署文档完成配置。`——该文件 51 处 innerHTML 正则里 6 处含长中文句。

**次级候选（并列 11–13，同类型）**：
- `/Users/apple/Desktop/开发项目/WorkHub/packages/ui/src/gold-path/render.test.ts:610-615` — `<p class="wh-subtle">接近上限</p>`、`<strong>接近上限</strong>`
- `/Users/apple/Desktop/开发项目/WorkHub/packages/ui/src/proposal/render.test.ts:48`、`:50`、`:455-457` — `<h1 class="wh-title">交付物变更申请</h1>`、`<span class="wh-pill">文档</span>`
- `/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/pet-surface.test.ts:1593` — `/>重新开始<\/a>/u`；`:1416` — `/data-chip-id="create-workitem"[^>]+data-selected="true"/u`

---

## B 节可精简估算

不是简单删行，而是「换断言方式」——用 `data-*` 语义选择器 + 单属性断言替代整串正则：

| 项 | 位置 | 现状行数 | 估计可精简 |
|---|---|---|---|
| pet-surface 假 DOM 正则解析改为真 DOM/语义查询 | `pet-surface.test.ts`（3253 行，118 P1） | ~600 | ~350 |
| chat/render 355 处 html 正则合并为属性断言助手 | `workbench/chat/render.test.ts`（2590 行） | ~700 | ~300 |
| settings 三件套（view 51 + spotlight 45 + render 111） | 3 文件（2763 行） | ~500 | ~250 |
| 156 处 `[^>]*` 属性顺序胶水全部去掉 | 17 文件 | 156 | ~80（行数不减但脆性归零） |
| 44 处 `includes("<`）精确标签串改语义断言 | 13 文件 | 44 | ~30 |
| 341 处长中文句断言改为 i18n key 断言 | 60+ 文件 | 341 | ~200 |

**B 节合计约 1200 行可精简**，但真正的收益是把约 **1400 处**（P1 251 + P5 156 + P6 44 + P8 341 + P3 中的结构类）与实现细节耦合的断言转成行为断言——目前任何一次「换标签、调 class 顺序、加缩进、改文案」都会触发跨 20+ 文件的批量红灯。