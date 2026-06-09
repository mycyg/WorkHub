---
module: 05-clients
layer: C-WEB / C-DESKTOP / QA
status: r1-39-landed
owner: workflow
date: 2026-06-10
visuals:
  - ./assets/audit/2026-06-10-r1-route-visual-qa/contact-sheet.png
  - ./assets/audit/2026-06-10-r1-route-visual-qa/web-proposal-zh-desktop.png
  - ./assets/audit/2026-06-10-r1-route-visual-qa/web-proposal-en-mobile.png
  - ./assets/audit/2026-06-10-r1-route-visual-qa/desktop-proposal-zh.png
  - ./assets/audit/2026-06-10-r1-route-visual-qa/web-replay-en-desktop.png
  - ./assets/audit/2026-06-10-r1-route-visual-qa/desktop-replay-zh.png
  - ./assets/audit/2026-06-10-r1-route-visual-qa/web-route-states-zh.png
---

# R1.39 Route Visual QA

R1.39 的目标是把 Proposal / Replay 已有的共享组件放进真实 Web 与 desktop webview surface 的 route wrapper 里做浏览器截图验收，避免只靠 renderer 字符串测试宣称页面已可用。

## 1. 当前产物

| 产物 | 路径 |
|---|---|
| QA 脚本 | `scripts/qa/r1-route-visual-qa.ts` |
| 命令 | `pnpm qa:r1-route-visual` |
| 截图目录 | `docs/workhub/05-clients/assets/audit/2026-06-10-r1-route-visual-qa/` |
| DOM / gate report | `route-visual-report.json` |
| 总览图 | `contact-sheet.png` |

脚本通过 `apps/web/src/main.ts` 与 `apps/desktop-webview/src/main.ts` 的 surface 函数渲染，不直接绕过到共享 renderer。fixture 覆盖 Proposal 与 Replay 两条 route：

- `/api/pages/proposals/:id`
- `/api/agent-runs/:id/replay`

## 2. 已验收内容

| Gate | 证据 |
|---|---|
| Web Proposal zh-CN desktop | `web-proposal-zh-desktop.png` |
| Web Proposal en-US mobile-narrow | `web-proposal-en-mobile.png` |
| Desktop Proposal zh-CN | `desktop-proposal-zh.png` |
| Web Replay en-US desktop | `web-replay-en-desktop.png` |
| Desktop Replay zh-CN | `desktop-replay-zh.png` |
| loading / empty / error / forbidden 四态示意 | `web-route-states-zh.png` |

DOM gates 来自真实浏览器 dump：

- `data-rich-patch-viewer="true"`
- `data-rich-patch-truncated="true"`
- `data-overlap-hunk-review="true"`
- `data-proposal-subrecord-item-diff="true"`
- `data-replay-subrecord-item-diff="true"`
- `data-proposal-conflict-workbench="true"`
- `no_horizontal_overflow=true`
- `cuuLeak=0`
- `kanbanLeak=0`

## 3. 同步修复

截图暴露了 mobile route 的横向撑宽风险，本切片同步修复：

- `packages/ui/src/proposal/render.ts`
  - grid item 增加 `min-width:0`。
  - mobile 下 `.wh-grid` 收为单列。
  - 长标题、说明、卡片标题允许强制断行。
  - 富 diff、字段编辑、子记录编辑在窄屏下改为单列。
- `packages/ui/src/replay/render.ts`
  - 与 Proposal 同步移动端布局规则。
- `packages/ui/src/rich-patch-viewer.ts`
  - rich patch 容器不再把页面整体撑宽。
  - diff code 外溢限制在 patch 容器内。

## 4. 当前边界

R1.39 不是 Web 产品化终点，只是把 R1 已落的高风险页面组件纳入浏览器证据门。

| 项 | 当前结论 |
|---|---|
| Cuu | 主窗口截图无 Cuu 本体；桌宠仍独立 pet window |
| 看板 | 未引入重型看板；多冲突入口仍折叠 |
| 多语言 | 覆盖 zh-CN desktop 与 en-US mobile-narrow |
| 四态 | 已有 route-state evidence page，后续 R4 需要接真实 route loading/error/forbidden VM |
| 截图方式 | 当前用本机 Chrome headless；CI 只跑代码测试，截图证据手动执行后入库 |

## 5. 后续施工计划

| 阶段 | 工作 |
|---|---|
| R1.40 | Task plan scope UI：多 `dispatch` / 多阶段 plan 下，Proposal / Cuu 必须先让用户点选目标 plan，再允许写入 `task_items` |
| R1.41 | Text hunk materializer：`text_hunk_overrides` 进入 API / service / DB，逐段 materialize 最终文本 |
| R1.42 | Multi-conflict execution audit：批量 keep / accept 前端执行器、`bulk_action` audit、局部失败说明 |
| R4-1 | 把 route-state evidence page 替换为真实 home/intake/workitem/proposal/replay/cost/approvals 四态截图 |
| R4-2 | 将截图命令接入 CI 或 nightly artifact，不要求每次 PR 都提交 PNG |

## 6. 复跑命令

```powershell
pnpm qa:r1-route-visual
```

在 Windows 沙箱环境里，若 `corepack` 无法读取用户目录，可直接运行：

```powershell
& 'D:\WorkHub\node_modules\.bin\tsx.CMD' 'D:\WorkHub\scripts\qa\r1-route-visual-qa.ts'
```

截图脚本会自动查找 Chrome / Edge，并把 HTML、PNG、contact sheet 与 `route-visual-report.json` 写入同一 audit 目录。
