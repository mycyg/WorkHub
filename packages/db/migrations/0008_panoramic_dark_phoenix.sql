CREATE TABLE "budget_policies" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"scope_kind" varchar(16) NOT NULL,
	"period" varchar(16) NOT NULL,
	"max_tokens" integer NOT NULL,
	"max_cost_cny" numeric(12, 6) NOT NULL,
	"warning_ratio" numeric(5, 4) DEFAULT '0.8' NOT NULL,
	"critical_ratio" numeric(5, 4) DEFAULT '0.95' NOT NULL,
	"on_warning" varchar(32) NOT NULL,
	"on_exhausted" varchar(32) NOT NULL,
	"model_route_hint" varchar(32),
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"org_id" uuid,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_policies_scope_kind_idx" ON "budget_policies" USING btree ("scope_kind");--> statement-breakpoint
CREATE INDEX "budget_policies_enabled_idx" ON "budget_policies" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "budget_policies_workspace_id_idx" ON "budget_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "budget_policies_updated_by_user_id_idx" ON "budget_policies" USING btree ("updated_by_user_id");