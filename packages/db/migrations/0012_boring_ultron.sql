CREATE TABLE "user_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"category" varchar(32) NOT NULL,
	"key" varchar(256) NOT NULL,
	"value_md" text NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"source_run_id" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_memories_key_uq" ON "user_memories" USING btree ("user_id","category","key") WHERE "user_memories"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "user_memories_user_id_idx" ON "user_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_memories_workspace_id_idx" ON "user_memories" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "user_memories_category_idx" ON "user_memories" USING btree ("category");--> statement-breakpoint
CREATE INDEX "user_memories_confidence_idx" ON "user_memories" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "user_memories_last_used_at_idx" ON "user_memories" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "user_memories_expires_at_idx" ON "user_memories" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_memories_deleted_at_idx" ON "user_memories" USING btree ("deleted_at");