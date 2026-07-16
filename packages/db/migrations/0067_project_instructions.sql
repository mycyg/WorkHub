-- R16 批 W4a（项目级自定义指令 · 纯后端）：projects 加 instructions_md——项目设置里的一段自由文本，
-- 注入该项目所有 Cuu 对话回复与 agent-run 的 worker system prompt（优先级=高于通用默认、低于系统工作
-- 纪律，见 apps/api/src/services/project-instructions.ts / packages/agent/src/turns/prompt.ts 的
-- buildTurnProjectInstructionsSection）。additive-only，replay 幂等安全：
--   ADD COLUMN IF NOT EXISTS instructions_md text，可空、无默认值——既有项目行留空即等同"未配置"，
--   读侧/注入侧对 NULL 一律按空串处理（不注入）。长度上限 4000 字符在契约层校验（zod .max()，超限走
--   全局 ZodError → 422 validation_error 兜底），DB 侧不加 CHECK——保持这份迁移纯粹只加一列。
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "instructions_md" text;
