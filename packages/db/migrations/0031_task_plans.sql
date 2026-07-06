-- R9.1 Task Plan + Meta-Planner foundation.
-- Keep this separate from the older work_item_task_plans/work_item_task_items tables:
-- those tables back structured proposal patching, while task_plans/task_plan_items are
-- the auditable agent-army decomposition artifact reviewed by humans before dispatch.
CREATE TABLE IF NOT EXISTS "task_plans" (
  "id" uuid PRIMARY KEY NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "status" varchar(16) NOT NULL DEFAULT 'draft',
  "objective_id" uuid,
  "budget_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "decomposition_context_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "task_plans_status_ck" CHECK ("status" IN ('draft','proposed','approved','dispatching','done','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_plan_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "task_plans"("id") ON DELETE cascade,
  "parent_item_id" uuid REFERENCES "task_plan_items"("id") ON DELETE set null,
  "seq" integer NOT NULL,
  "title" varchar(256) NOT NULL,
  "role" varchar(16) NOT NULL,
  "objective_md" text NOT NULL,
  "acceptance_md" text NOT NULL,
  "budget_share_pct" integer NOT NULL,
  "depends_on" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "task_plan_items_role_ck" CHECK ("role" IN ('research','produce','review','integrate')),
  CONSTRAINT "task_plan_items_status_ck" CHECK ("status" IN ('pending','dispatched','succeeded','failed','skipped')),
  CONSTRAINT "task_plan_items_budget_share_pct_ck" CHECK ("budget_share_pct" >= 0 AND "budget_share_pct" <= 100)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plans_work_item_id_idx" ON "task_plans" ("work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plans_workspace_status_idx" ON "task_plans" ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plans_work_item_status_idx" ON "task_plans" ("work_item_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plans_created_by_idx" ON "task_plans" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plans_created_at_idx" ON "task_plans" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plan_items_plan_seq_idx" ON "task_plan_items" ("plan_id","seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plan_items_parent_item_id_idx" ON "task_plan_items" ("parent_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plan_items_status_idx" ON "task_plan_items" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_plan_items_role_idx" ON "task_plan_items" ("role");
