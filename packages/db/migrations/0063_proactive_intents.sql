-- R15 批 D（主动性 MVP · ProactiveIntent 管线）：主动打扰的审计地基。
-- 设计原则「先记 intent 再投递」：任何一次主动打扰(追 DDL、找人，未来 Cuu 主动开口)先在这张表落一条
-- intent，再过频控闸、再投递。投递失败 intent 仍在(审计留痕)。同一 suppression_key 幂等——撞唯一约束
-- 即「这件事已处理过」，跳过不重投(每个 DDL 阶梯对每工作项只发一次全靠它)。
--   status: created(已记未投) / delivered(已投递) / suppressed(被频控/静音/重复挡下)
--   delivered_via: 本批唯一投递通道='notification'(投递成功时写)；未来会话卡/SSE 各有自己的值。
-- 全 additive；CREATE TABLE / CREATE INDEX IF NOT EXISTS 保证 migration-audit replay 整链重跑安全
-- （同 0061/0062 约定）。
CREATE TABLE IF NOT EXISTS "proactive_intents" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE cascade,
  "work_item_id" uuid REFERENCES "work_items"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "stage" text,
  "target_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "suppression_key" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'created',
  "delivered_via" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "proactive_intents_status_ck"
    CHECK ("status" IN ('created','delivered','suppressed'))
);
--> statement-breakpoint

-- suppression_key 全局幂等键：先记 intent 时 INSERT ... ON CONFLICT DO NOTHING 撞它即「已处理过」。
CREATE UNIQUE INDEX IF NOT EXISTS "proactive_intents_suppression_key_uq"
  ON "proactive_intents" ("suppression_key");
--> statement-breakpoint

-- 每人每日频控热路径：WHERE target_user_id = ? AND status = 'delivered' AND created_at 落在当日区间。
-- 部分索引只覆盖 delivered 行(created/suppressed 不参与配额统计)，让当日已投数计数走窄索引。
CREATE INDEX IF NOT EXISTS "proactive_intents_target_delivered_idx"
  ON "proactive_intents" ("target_user_id","created_at")
  WHERE "status" = 'delivered';
--> statement-breakpoint

-- 工作项维度回查(改期重算/审计某工作项发过哪些阶梯)。
CREATE INDEX IF NOT EXISTS "proactive_intents_work_item_id_idx"
  ON "proactive_intents" ("work_item_id");
