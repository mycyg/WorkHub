ALTER TABLE "agent_runs" ADD COLUMN "claimed_by" varchar(128);--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agent_runs_claim_idx" ON "agent_runs" USING btree ("status","lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_claimed_by_idx" ON "agent_runs" USING btree ("claimed_by");