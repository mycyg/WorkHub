-- R14 批 RISK（风险预警巡检）：project_ai_governance 加一列存三信号巡检阈值——照 quiet_hours_json/
-- granular_json 的既有 jsonb-blob-with-default-merge 模式（读侧 DEFAULT_RISK_MONITOR_SETTINGS 兜底），
-- 不新建表、不新建路由，只在既有 GET/PATCH /projects/:id/ai-governance 上加一个 additive 字段。
-- ADD COLUMN IF NOT EXISTS 保证重放安全（migration-audit 的 replay 阶段整链重跑）。
ALTER TABLE "project_ai_governance"
  ADD COLUMN IF NOT EXISTS "risk_monitor_json" jsonb NOT NULL DEFAULT '{}'::jsonb;
