# 技能系统分层发现（项目级 > 用户级 > 内置）

- Status: implemented
- Date: 2026-08-19
- Owner: kimi-code

## Problem

`@workhub/tools` 的技能系统只有单一 bundled 目录（`packages/tools/skills/`），
团队/个人无法在不改包源码的情况下沉淀或覆盖技能。参考 deepseek-harness 的
skills 分层（项目级 > 用户级 > 内置），需要让同 id 技能可按层覆盖，同时
不破坏现有 `listSkills` / `loadSkillContent` / `createSkillTool` 调用方。

## Decision

在 `packages/tools/src/skills.ts` 新增分层 API：

- `listLayeredSkills(options?)`：按 rank 合并三层——项目级 `<repo>/.workhub/skills/`
  （rank 100，repo 根由 `process.cwd()` 向上找 `.git`）> 用户级 `~/.workhub/skills/`
  （rank 200）> bundled（rank 600）；同 id 高层覆盖低层，返回的 `SkillMeta`
  附带可选 `layer` / `rank` 字段，原四字段不动（向后兼容）。
- `loadSkillContent(id, root)` 的第二参放宽为 `string | LayeredSkillOptions`：
  传 string 维持原单目录语义；传 options 走分层解析，同 id 取 rank 最小一层。
- 路径覆盖：options 显式传入 > 环境变量 `WORKHUB_SKILLS_PROJECT_DIR` /
  `WORKHUB_SKILLS_USER_DIR` > 默认路径。env 直接在 skills.ts 内读取并注释说明——
  `@workhub/tools` 不依赖 `@workhub/config`，为两个键接入 envSchema 成本高于收益。
- 缓存：`listLayeredSkills` 以三层根目录组合为键（`\0` 连接）缓存合并结果，
  不同层组合互不串缓存；单层 `listSkills` 的缓存语义不变（仅默认根缓存）。

## Alternatives considered

- 把分层做进 `packages/config` 的 envSchema 统一纳管：tools 包当前零依赖 config，
  为两个目录键引入跨包依赖不值；代码内已注释，后续若要统一纳管再迁移。
- 改 `listSkills` 本身直接分层：会改变现有调用方（`skillCatalogForPrompt`、
  `createSkillTool`、既有测试）的语义与缓存行为，违反向后兼容，否决。
- 新增独立 `loadLayeredSkillContent` 而非放宽 `loadSkillContent` 签名：
  两套加载入口易分叉；用 `string | LayeredSkillOptions` 联合类型在单一入口内
  分流，旧调用点零改动。

## Consequences

- `createSkillTool` 尚未接入分层（仍按构造时传入的单 root 工作）；需要项目/用户级
  技能对 agent 可见时，调用方应改用 `listLayeredSkills` / 传 options 给
  `loadSkillContent`，或后续把 `createSkillTool` 的 root 参数同样放宽。
- 分层结果按「层组合」缓存：测试或运行中改技能目录内容不会自动失效，
  与既有 `listSkills` 默认根缓存语义一致；调用方传不同 root 组合即得新结果。
- env 键 `WORKHUB_SKILLS_PROJECT_DIR` / `WORKHUB_SKILLS_USER_DIR` 成为公开约定，
  改名需同步 skills.ts 注释与测试。
