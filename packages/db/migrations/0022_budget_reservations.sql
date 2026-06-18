-- Custom SQL migration file, put your code below! --
-- R2 epic(原子预算)：budget_reservations 持有 IN-FLIGHT（已授权未结算）预留，作为「在飞」额度的唯一真相源；
-- cost_ledger_entries 仍是 SETTLED（已结算）真相源。并发起跑要满足：
--   committed(ledger, scope, bucket) + reserved_outstanding(本表 active 行 SUM(est-actual)) + 本 run 估算 <= cap。
-- scope 列与 cost_ledger_entries 对齐，复用同一 scope helper 与 period_bucket 键。手写 SQL（snapshot 链止于 0015，
-- 不跑 drizzle-kit generate 以免污染 journal）。
CREATE TABLE IF NOT EXISTS "budget_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "agent_runs" ("id") ON DELETE CASCADE,
  "scope_kind" varchar(16) NOT NULL,
  "scope_id" varchar(128) NOT NULL,
  "period" varchar(16) NOT NULL,
  "period_bucket" varchar(16) NOT NULL,
  "est_tokens" integer NOT NULL DEFAULT 0,
  "est_cost_cny" numeric(12,6) NOT NULL DEFAULT 0,
  "actual_tokens" integer NOT NULL DEFAULT 0,
  "actual_cost_cny" numeric(12,6) NOT NULL DEFAULT 0,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "lease_expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- 每 run 每 (scope,bucket) 至多一条 active 预留 → reserve 在重试下幂等（onConflictDoNothing）。
CREATE UNIQUE INDEX IF NOT EXISTS "budget_reservations_run_scope_active_uq"
  ON "budget_reservations" ("run_id", "scope_kind", "scope_id", "period_bucket")
  WHERE "status" = 'active';

-- outstanding SUM(est-actual) 读取按 (scope,bucket) 索引，不扫 settled/expired 行。
CREATE INDEX IF NOT EXISTS "budget_reservations_scope_bucket_active_idx"
  ON "budget_reservations" ("scope_kind", "scope_id", "period_bucket")
  WHERE "status" = 'active';

-- 租约过期清扫（mirror agent_runs_claim_idx）。
CREATE INDEX IF NOT EXISTS "budget_reservations_lease_idx"
  ON "budget_reservations" ("status", "lease_expires_at")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "budget_reservations_run_id_idx" ON "budget_reservations" ("run_id");
