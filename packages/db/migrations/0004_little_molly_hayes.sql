CREATE TABLE "accepted_deliverable_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"branch_id" uuid,
	"change_id" uuid NOT NULL,
	"target_kind" varchar(32) NOT NULL,
	"target_entity_type" varchar(32) NOT NULL,
	"target_entity_id" uuid,
	"target_path" varchar(512),
	"target_key" varchar(768) NOT NULL,
	"change_type" varchar(32) NOT NULL,
	"accepted_version" integer DEFAULT 1 NOT NULL,
	"base_version_ref" varchar(128),
	"accepted_ref" varchar(512),
	"sha256_before" varchar(64),
	"sha256_after" varchar(64),
	"preview_ref_json" jsonb,
	"manifest_change_json" jsonb NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accepted_deliverable_changes" ADD CONSTRAINT "accepted_deliverable_changes_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accepted_deliverable_changes" ADD CONSTRAINT "accepted_deliverable_changes_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accepted_deliverable_changes" ADD CONSTRAINT "accepted_deliverable_changes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accepted_deliverable_changes_work_item_id_idx" ON "accepted_deliverable_changes" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "accepted_deliverable_changes_proposal_id_idx" ON "accepted_deliverable_changes" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "accepted_deliverable_changes_branch_id_idx" ON "accepted_deliverable_changes" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "accepted_deliverable_changes_target_idx" ON "accepted_deliverable_changes" USING btree ("work_item_id","target_key");--> statement-breakpoint
CREATE INDEX "accepted_deliverable_changes_current_idx" ON "accepted_deliverable_changes" USING btree ("work_item_id","target_key","superseded_at");--> statement-breakpoint
CREATE INDEX "accepted_deliverable_changes_created_at_idx" ON "accepted_deliverable_changes" USING btree ("created_at");