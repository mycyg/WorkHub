# Agent Notes —— 决策档案制度

> 借鉴 deepseek-harness 的 Agent Note 制度（`reference/deepseek-harness/.agents/notes/`）。
> 目的：WorkHub 重度依赖 AI 协作开发。没有决策档案，AI（和新人）会反复重开已否定的方案、
> 推翻已拍板的取舍。每条非琐碎的架构/产品决策都在这里留一份档案，按生命周期流转。

## 规则

1. **非琐碎变更必须带 Note**：凡是「为什么这么做的理由在代码里看不出来」的决策——
   架构取舍、协议/契约变更、被否掉的替代方案——都应在同一 PR 里附一份 Note。
2. **路径即生命周期**：
   - `proposed/` 提议中（还没做，供讨论）
   - `implemented/` 已落地（随代码合并移入）
   - `rejected/` 已否决（**最重要的一类**：写明为什么不做，防止重来）
   - `archived/` 已归档（曾落地后被取代/移除）
3. 文件名：`YYYY-MM-DD-主题.md`（kebab-case）。
4. 状态流转 = 移动文件，不原地改状态字段。

## 格式（由 `pnpm audit:agent-notes` 门禁校验）

```markdown
# <标题>

- Status: proposed | implemented | rejected | archived（必须与所在目录一致）
- Date: YYYY-MM-DD
- Owner: <人或 agent>

## Problem
<要解决什么问题>

## Decision
<决定了什么>

## Alternatives considered
<考虑过什么、为什么没选>

## Consequences
<代价与后续约束>
```

## 校验

`pnpm audit:agent-notes`（scripts/dev/check-agent-notes.ts）检查：
frontmatter 三字段齐全、Status 与目录一致、四个小节齐全。
