CREATE TABLE "cost_ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usage_record_id" varchar(512) NOT NULL,
	"policy_id" varchar(128),
	"run_id" uuid,
	"work_item_id" uuid,
	"user_id" uuid,
	"team_id" uuid,
	"scope_kind" varchar(16) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"scope_json" jsonb NOT NULL,
	"period_bucket" varchar(16) NOT NULL,
	"token_in" integer DEFAULT 0 NOT NULL,
	"token_out" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cny" numeric(12, 6) DEFAULT '0' NOT NULL,
	"unit_price_cny" numeric(12, 6),
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"provider" varchar(64),
	"model" varchar(128) NOT NULL,
	"source" varchar(32) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" varchar(512) PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"work_item_id" uuid,
	"user_id" uuid,
	"actor_id" varchar(128),
	"provider" varchar(64) NOT NULL,
	"model" varchar(128) NOT NULL,
	"task" varchar(64) NOT NULL,
	"source" varchar(32) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cny" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_usage_record_id_usage_records_id_fk" FOREIGN KEY ("usage_record_id") REFERENCES "public"."usage_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_team_id_workspaces_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_ledger_entries_usage_scope_uq" ON "cost_ledger_entries" USING btree ("usage_record_id","scope_kind","scope_id","period_bucket");--> statement-breakpoint
CREATE INDEX "cost_ledger_entries_run_id_idx" ON "cost_ledger_entries" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_entries_work_item_id_idx" ON "cost_ledger_entries" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_entries_user_id_idx" ON "cost_ledger_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_entries_team_id_idx" ON "cost_ledger_entries" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_entries_scope_idx" ON "cost_ledger_entries" USING btree ("scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_entries_period_bucket_idx" ON "cost_ledger_entries" USING btree ("period_bucket");--> statement-breakpoint
CREATE INDEX "cost_ledger_entries_created_at_idx" ON "cost_ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_records_run_id_idx" ON "usage_records" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "usage_records_work_item_id_idx" ON "usage_records" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "usage_records_user_id_idx" ON "usage_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_records_created_at_idx" ON "usage_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_records_provider_model_idx" ON "usage_records" USING btree ("provider","model");