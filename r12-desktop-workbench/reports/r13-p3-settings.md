# R13 批 P3 完成汇报 · 设置面补齐

> 分支 `r13/p3-settings`（已 rebase 到 origin/main @ 3a9a70d9，即 H1/P2 批合入之后）· 2026-07-13
> 背景：00-plan §批 P3 · 功能审查 2026-07-13 主题 B（B1-B4）

## 做了什么

1. **桌面 Spotlight 设置视图「AI」分区**（B1/B2 收口）：五档默认模式 / 接单策略三档 / Granular 四开关 / Cuu 主动性，全部接真 GET/PATCH `/api/me/ai-profile`。挂载时并行拉档案（拉失败不挡设置页其余部分，给独立的「重试」）；写=即改即 PATCH + 乐观更新 + 失败回滚 + 温和行内错误。Granular 每次全量重发四个 key 的显式布尔（PATCH 的 granular_settings 是整体替换写，只发一个 key 会清掉其余覆盖）。「只观察 409 文案指向的设置 · AI」从此真实存在。
2. **工作台项目治理入口**（B3 收口）：rail 选中项目行的项目名右侧加齿轮按钮（仅 `vm.viewer.is_project_owner` 渲染）→ 中栏 `centerTab='project-settings'` 渲染治理表单（新目录 `apps/desktop-webview/src/workbench/settings/`：api/render/view 三层，照 drive 标签既有分工）——观察者开关 / 静默窗口秒数（显式保存 + 0-86400 客户端预检）/ 安静时段（开启带合理默认：本地时区 22:00-08:00 每天；起止时间 + 星期 chips + 最少一天守卫）/ Granular 四开关。开关即改即 PATCH + 乐观回滚；表单按 editable 渲染（非负责人只读降级兜底）。
3. **web /settings「AI 助手」区块**（B4 收口）：default_mode 与 dispatch_policy 两个真表单（`<select>` + change 即 PATCH，串行保存链 + 失败回滚），SSR 锁定、由 browser.ts 的 `bindSettingsAiProfilePanel` GET 回填后解禁（照通知静音面板 R10-P1-7 的水合竞态收口：读不到当前值就保持锁定 + 显式错误 + 重试，绝不让用户在假的当前值上保存）；其余 AI 项（细粒度开关/助手主动性/模型档位/项目治理）用既有 `data-requires-desktop` 提示模式诚实标注，不再静默留白。web-only 用户可自行脱离只观察档。

## 改动文件清单

- `apps/desktop-webview/src/spotlight/views/settings.ts` — AI 分区（四组配置 + 乐观 PATCH + 分区级重试）
- `apps/desktop-webview/src/spotlight/views/settings.test.ts` — 新增（5 条：渲染选中态/乐观 PATCH/失败回滚/Granular 全量重发/档案拉失败降级）
- `apps/desktop-webview/src/workbench/settings/{api,render,view}.ts` — 新目录：治理表单三层
- `apps/desktop-webview/src/workbench/settings/{render,view}.test.ts` — 新增（16 条）
- `apps/desktop-webview/src/workbench/store.ts` — WorkbenchCenterTab 加 `"project-settings"`
- `apps/desktop-webview/src/workbench/rail.ts` — 项目行齿轮（owner-only）+ onOpenProjectSettings 回调（与 P2 的新建协同会话按钮 rebase 合并）
- `apps/desktop-webview/src/workbench/rail.test.ts` — 齿轮三条测试（owner-only/不漏渲/选中态）
- `apps/desktop-webview/src/workbench/shell.ts` — project-settings 中栏分支（key 复用纪律 + dispose 全路径）
- `apps/desktop-webview/src/workbench/icons.ts` — gear 图标（SVG，无 emoji）
- `apps/desktop-webview/src/workbench/css.ts` — 齿轮 + 治理表单样式（浅色 token，无 box-shadow 新增，无定高 line-clamp）
- `packages/ui/src/gold-path/route-components.ts` — `renderSettingsAiAssistantCard`（个人设置 grid 第三卡）
- `packages/ui/src/gold-path/route-components.test.ts` — AI 区块断言（锁定 select/全选项/桌面提示）
- `apps/web/src/browser.ts` — `bindSettingsAiProfilePanel`（水合 + change→PATCH 串行链 + 回滚）
- `apps/web/src/routes.test.ts` — /settings AI 区块断言

## 自查输出（rebase 到 3a9a70d9 后全量重跑）

```
pnpm --filter @workhub/desktop-webview test   # 753/753 pass（此前 690 → 含 P2/H1 上游新增与本批 21 条）
pnpm --filter @workhub/api test               # 1078 tests, 1077 pass, 1 skipped（skip 为基线既有）
pnpm --filter @workhub/ui test                # 143/143 pass
pnpm --filter @workhub/web test               # 68/68 pass
pnpm -r typecheck                             # 16/16 workspace Done, exit 0
```

我没有改任何既有断言；rail.test.ts 的合并只是与 P2 上游新测试共存。

## 关键取舍（偏离任务书字面的两处，都有依据）

1. **web AI 区块的当前值不走 SettingsPageVM**：任务书写「apps/api/src/pages/settings.ts VM …加 AI 区块」，但 `settingsPageVmSchema` 在 packages/contracts、/settings 路由装配在 apps/api/src/routes/pages.ts——两者都在本批围栏外（围栏明令禁碰 routes，contracts 不在允许清单），且 parseOutputContract 会剥掉 schema 外的新字段。改走 **客户端水合**（通知静音面板 R10-P1-7 的既有先例，同一竞态收口纪律），`apps/api/src/pages/settings.ts` 因此未动。若下一批允许动 contracts，可把 AI 档案并进 VM 消掉这次额外的 GET。
2. **治理表单「非 owner 只读展示」的真实形态**：服务端仓库层把治理 GET 也锁在负责人上（`packages/db/src/repositories/ai-settings.ts` 的 `activeProjectOwnerCondition` 同时约束 find 与 upsert），非负责人连读都是 404。所以 rail 齿轮只对负责人渲染（铁律 3：不摆点开必撞 404 的按钮）；表单本身仍实现了完整的 editable=false 只读态（所有权中途变更时的兜底 + 404 时渲染「只有项目负责人能查看和修改」的诚实说明）。**若产品要真的「成员只读可见」，需要服务端把 GET 放宽到项目成员——围栏外，列为缺口。**

## 范围外发现（不修，只报）

- 治理读取 owner-only（见上）：功能审查 B3 的「成员至少只读」在当前服务端权限模型下无法诚实实现。
- `apps/web/src/qa` 目录不存在（任务书提到的位置）；真正的请求计数/泄漏门在 `apps/web/qa/r4-web-live-api-pg-seed.ts` 等——其中 `no_main_window_cuu` 门会扫 /settings 文本，web 区块文案已特意避开「Cuu」字样（用「助手主动性」），未破门。本批新增的 `/api/me/ai-profile` 请求不在任何计数门的断言集内。
- 工作树曾误弹出他人 stash（r12/workbench-full 的「codex半成品:smoke升级R12表覆盖」，涉 `apps/api/src/qa/r2-pg-redis-smoke.ts`）——已原样重新 stash 并附说明（现 stash@{0}），未混入本批任何提交。

## 没做/存疑

- Spotlight AI 分区未做模型档位偏好（model_tier_preference）选择器——任务书四项清单未含它，providers/预算摘要字段留给设置页后续消费。
- 真机（Tauri .app）验收未做：desktop-webview 在浏览器预览渲染不出（无 Tauri），本批按仓库既定路线以单测+typecheck 验证；治理表单/齿轮/AI 分区的观感需集成者真机过一眼。
- 未合并未推送（按任务书）。
