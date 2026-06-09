CREATE TABLE "merge_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merge_attempt_id" uuid NOT NULL,
	"conflict_key" varchar(768) NOT NULL,
	"candidates_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_option_key" varchar(64),
	"chosen_option_key" varchar(64),
	"chosen_by_user_id" uuid,
	"chosen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merge_proposals" ADD CONSTRAINT "merge_proposals_merge_attempt_id_merge_attempts_id_fk" FOREIGN KEY ("merge_attempt_id") REFERENCES "public"."merge_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_proposals" ADD CONSTRAINT "merge_proposals_chosen_by_user_id_users_id_fk" FOREIGN KEY ("chosen_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merge_proposals_attempt_id_idx" ON "merge_proposals" USING btree ("merge_attempt_id");--> statement-breakpoint
CREATE INDEX "merge_proposals_conflict_key_idx" ON "merge_proposals" USING btree ("conflict_key");--> statement-breakpoint
CREATE INDEX "merge_proposals_chosen_by_user_id_idx" ON "merge_proposals" USING btree ("chosen_by_user_id");--> statement-breakpoint
CREATE INDEX "merge_proposals_chosen_at_idx" ON "merge_proposals" USING btree ("chosen_at");