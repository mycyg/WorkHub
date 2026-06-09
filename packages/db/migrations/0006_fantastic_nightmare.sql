CREATE TABLE "merge_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"branch_id" uuid,
	"actor_kind" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"result" varchar(16) NOT NULL,
	"merge_snapshot_id" uuid,
	"conflicts_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted_target_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merge_attempts" ADD CONSTRAINT "merge_attempts_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_attempts" ADD CONSTRAINT "merge_attempts_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_attempts" ADD CONSTRAINT "merge_attempts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_attempts" ADD CONSTRAINT "merge_attempts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_attempts" ADD CONSTRAINT "merge_attempts_merge_snapshot_id_snapshots_id_fk" FOREIGN KEY ("merge_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merge_attempts_proposal_id_idx" ON "merge_attempts" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "merge_attempts_work_item_id_idx" ON "merge_attempts" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "merge_attempts_branch_id_idx" ON "merge_attempts" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "merge_attempts_actor_user_id_idx" ON "merge_attempts" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "merge_attempts_result_idx" ON "merge_attempts" USING btree ("result");--> statement-breakpoint
CREATE INDEX "merge_attempts_merge_snapshot_id_idx" ON "merge_attempts" USING btree ("merge_snapshot_id");--> statement-breakpoint
CREATE INDEX "merge_attempts_created_at_idx" ON "merge_attempts" USING btree ("created_at");