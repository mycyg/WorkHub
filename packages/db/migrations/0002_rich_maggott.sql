DROP INDEX "agent_steps_run_step_uq";--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "title" varchar(256) DEFAULT 'AI worker run' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "total_timeout_s" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "max_tokens" integer DEFAULT 120000 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "max_cost_cny" numeric(12, 6) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "budget_decision_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "handoff_json" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "workdir_ref" varchar(512);--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_actor_user_id_idx" ON "agent_runs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "agent_steps_run_seq_idx" ON "agent_steps" USING btree ("agent_run_id","seq");