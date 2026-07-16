-- R15 批 E3（项目规划 agent）：Cuu 起草项目级计划草案 → 人审 → 物化。additive-only：一张新表
-- project_plan_drafts。建表与建索引全部带 IF NOT EXISTS，保证 migration-audit 的 replay 阶段
-- （>=0031 整链重跑一次）幂等安全，且不改任何既有列/约束。
--
-- 为什么新表而不是复用 task_plans：草案是「项目级」对象——物化前工作项尚不存在，无 work_item 可挂；
-- task_plans.work_item_id 是 NOT NULL，其 role/预算份额语义（agent 子任务 DAG）与项目排期（里程碑/工作项/
-- 人类依赖）完全不同。强行复用只会污染两边的不变式。
--
-- payload_json 存草案本体：里程碑 / 工作项 / 依赖，全用草案内局部 ref（物化时映射成真 uuid）。
-- status 状态机：pending_review（起草通过 judge 即待人审）→ approved（人批）→ materialized（物化落库，幂等）；
--   pending_review → rejected（人驳回，理由存 review_reason_md，回灌下次起草上下文）。
-- 'draft' 枚举保留给未来「暂存未提交」；当前起草路径起草即进 pending_review。
CREATE TABLE IF NOT EXISTS "project_plan_drafts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "status" varchar(16) NOT NULL DEFAULT 'pending_review',
  "intent_md" text NOT NULL,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "rationale_md" text,
  "review_reason_md" text,
  "decomposition_context_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result_json" jsonb,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reviewed_at" timestamp with time zone,
  "materialized_at" timestamp with time zone,
  CONSTRAINT "project_plan_drafts_status_ck" CHECK ("status" IN ('draft','pending_review','approved','rejected','materialized'))
);
--> statement-breakpoint
-- 项目主页/审批队列读草案：按项目 + 状态取（如「本项目待审的规划草案」）。
CREATE INDEX IF NOT EXISTS "project_plan_drafts_project_status_idx" ON "project_plan_drafts" ("project_id","status");
--> statement-breakpoint
-- 工作区级审批盘点（跨项目待审草案）走这条；workspace 钉死防跨租户。
CREATE INDEX IF NOT EXISTS "project_plan_drafts_workspace_status_idx" ON "project_plan_drafts" ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_plan_drafts_created_at_idx" ON "project_plan_drafts" ("created_at");
