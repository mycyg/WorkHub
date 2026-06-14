CREATE TABLE "team_skills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_key" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"when_to_use" text NOT NULL,
	"content_md" text NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_kind" varchar(16) DEFAULT 'distilled' NOT NULL,
	"created_by_kind" varchar(16) DEFAULT 'ai' NOT NULL,
	"confidence_score" double precision,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"samples_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_run_id" uuid,
	"deprecated_reason" text,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_skills" ADD CONSTRAINT "team_skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_skills" ADD CONSTRAINT "team_skills_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_skills_workspace_key_version_uq" ON "team_skills" USING btree ("workspace_id","skill_key","version");--> statement-breakpoint
CREATE INDEX "team_skills_workspace_status_idx" ON "team_skills" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "team_skills_workspace_key_idx" ON "team_skills" USING btree ("workspace_id","skill_key");--> statement-breakpoint
CREATE INDEX "team_skills_created_at_idx" ON "team_skills" USING btree ("created_at");