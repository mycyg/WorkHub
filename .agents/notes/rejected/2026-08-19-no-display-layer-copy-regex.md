# 否决：用展示层 replaceAll 正则「洗」术语

- Status: rejected
- Date: 2026-08-19
- Owner: kimi-code（审查发现，记录以绝后患）

## Problem

产品对用户有一套术语纪律（branch=工作副本、merge=采纳进正式版、conflict=撞车了……），
但词典散落在 packages/ui、packages/cuu、apps/api、client-tauri 等多处各自维护，漂移不可避免。

## Decision

不修这个词表问题本身，而是否决一种修法：在展示层用 `replaceAll` 正则把旧词替换成新词。

## Alternatives considered

- 展示层正则补丁（`packages/cuu/src/cards.ts:184`、`packages/ui/src/proposal/render.ts:132`、
  `apps/api/src/services/cross-agent-judge.ts:334` 三处现存实例）：脆弱（误伤子串、洗不动拼接结果、
  产生「把握程度：把握不足」式叠词），且掩盖源头失控。**否决，现存三处应逐步回删。**
- 采纳方向：contracts 级术语表模块作单一事实源，各端 import；lint 禁词表门禁
  （用户可见串禁止出现 AgentRun|snapshot_id|trace|lease|UTF-8|merge|base 等）。

## Consequences

任何新代码不得再引入「展示层正则改文案」的做法；review 时见到即打回。
术语表模块落地前，改文案必须改源头词典。
