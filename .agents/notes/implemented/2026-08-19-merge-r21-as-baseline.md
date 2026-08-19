# 以 r21 线为基线合并（而非在 r11 线上续作）

- Status: implemented
- Date: 2026-08-19
- Owner: kimi-code（应用户指令执行）

## Problem

代码线严重分叉：`codex/r11-release-hardening-loop`（发布加固线，12 个独有 commit）与
`fix/r21-review-hardening`（含完整桌面工作台 workbench、DM、conversations，领先合并基点 611 commit）
各自演进。r12/r16 的工作台设计与 r16 gap 审查的 38 项修复只在 r21 线上；r11 线的委派安全加固
（Batch 0）只在 r11 线上。继续在任一单线上工作都会放大分叉。

## Decision

以 r21 为基线：`main` fast-forward 到 r21 末端（main 本是 r21 祖先），再把 r11 的 12 个 commit
合入。冲突一律取 r21 侧，然后逐条核实 r11 的安全意图是否已被 r21 等价覆盖；未覆盖的
（`/api/users` 工作区收拢）以新代码正式移植而非强合。

## Alternatives considered

- 在 r11 线上合 r21：r11 落后合并基点 611 commit，冲突面大得多，且工作台要重新适配旧底座。否决。
- 丢弃 r11 独有 commit：其委派安全加固（活跃用户目录、成员资格双查）经核实 r21 已以
  workspace-roster + 双查形式等价覆盖；唯 `/api/users` 收拢未覆盖，已单独移植。故可安全取 r21 侧。
- 继续双轨：否决，分叉是本次审查确认的最大结构性风险（WIRE-01）。

## Consequences

- r11 分支不再承载新工作；其剩余价值已并入 main-integration。
- 工作区命名事实改变：合并后主线同时包含 Spotlight + 桌宠 + workbench 三界面，
  旧审查（2026-08-19 台账第一~十一节）中针对「无 workbench」的结论随之更新。
