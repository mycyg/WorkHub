CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"workspace_id" uuid,
	"work_item_id" uuid NOT NULL,
	"branch_id" uuid,
	"mode" varchar(16) NOT NULL,
	"actor" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"model" varchar(64) NOT NULL,
	"turns_used" integer DEFAULT 0 NOT NULL,
	"max_turns" integer NOT NULL,
	"seconds" double precision,
	"token_in" integer DEFAULT 0 NOT NULL,
	"token_out" integer DEFAULT 0 NOT NULL,
	"cost_estimate" numeric(12, 6),
	"outcome_reason" varchar(256),
	"handoff_md" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"phase" varchar(32) NOT NULL,
	"tool_name" varchar(64),
	"input_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_excerpt" text,
	"control_signal" varchar(16),
	"snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid,
	"agent_run_id" uuid,
	"action_pattern" varchar(128) NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"routed_to_user_id" uuid,
	"decided_by_user_id" uuid,
	"decision_reason_md" text,
	"delegated_to_user_id" uuid,
	"sla_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"filename" varchar(256) NOT NULL,
	"mime" varchar(128),
	"size_bytes" bigint NOT NULL,
	"storage_path" varchar(512) NOT NULL,
	"sha256" varchar(64),
	"parsed_text" text,
	"parsed_text_path" varchar(512),
	"role_in_req" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"workspace_id" uuid,
	"actor_kind" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"actor_nickname" varchar(64),
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_id" uuid,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"message" text,
	"result_ref" varchar(128),
	"error" text,
	"created_by_user_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"actor_kind" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"agent_run_id" uuid,
	"kind" varchar(16) DEFAULT 'work' NOT NULL,
	"base_snapshot_id" uuid,
	"head_ref" varchar(128),
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"content_json" jsonb NOT NULL,
	"selected_option_key" varchar(64),
	"user_other_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_name" varchar(128) NOT NULL,
	"client_token_hash" varchar(64) NOT NULL,
	"platform" varchar(64) NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"author_nickname" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confidence_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"proposal_id" uuid,
	"agent_run_id" uuid,
	"confidence_score" double precision NOT NULL,
	"risk_score" double precision NOT NULL,
	"grade" varchar(8) NOT NULL,
	"risk_level" varchar(8) NOT NULL,
	"verdict" varchar(16) NOT NULL,
	"signals_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"proposal_id" uuid,
	"round" integer NOT NULL,
	"package_path" varchar(512) NOT NULL,
	"package_size" bigint NOT NULL,
	"package_sha256" varchar(64) NOT NULL,
	"file_count" integer NOT NULL,
	"delivery_doc_md" text,
	"notes" text,
	"submitted_by_nickname" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"confidence_id" uuid,
	"trigger" varchar(24) NOT NULL,
	"reason_md" text NOT NULL,
	"handoff_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggested_lead_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_ask_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"project_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"job_id" uuid,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"answer_md" text,
	"citations_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"work_item_id" uuid,
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"title" varchar(256) NOT NULL,
	"source_url" varchar(512) NOT NULL,
	"corpus_path" varchar(512) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_insights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"target_work_item_id" uuid,
	"confidence_reason" text,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_work_item_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"work_item_id" uuid,
	"uploaded_by_user_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"audio_filename" varchar(256) NOT NULL,
	"audio_mime" varchar(128),
	"audio_size_bytes" bigint NOT NULL,
	"audio_path" varchar(512) NOT NULL,
	"transcript_text" text,
	"minutes_md" text,
	"status" varchar(32) DEFAULT 'processing' NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"severity" varchar(16) DEFAULT 'normal' NOT NULL,
	"title" varchar(256) NOT NULL,
	"body" text,
	"target_url" varchar(512),
	"project_id" uuid,
	"work_item_id" uuid,
	"dedupe_key" varchar(256),
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"plan" varchar(32) DEFAULT 'lan' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"workspace_id" uuid,
	"scope_kind" varchar(16) NOT NULL,
	"scope_id" varchar(64) NOT NULL,
	"action_pattern" varchar(128) NOT NULL,
	"effect" varchar(8) NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"learned_from_session" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_drive_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"author_user_id" uuid NOT NULL,
	"author_nickname" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending_llm' NOT NULL,
	"llm_kind" varchar(32),
	"llm_reason" text,
	"draft_work_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_drive_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(256) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"current_version_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_drive_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"op_type" varchar(32) NOT NULL,
	"payload_json" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_drive_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"filename" varchar(256) NOT NULL,
	"mime" varchar(128),
	"size_bytes" bigint NOT NULL,
	"storage_path" varchar(512) NOT NULL,
	"sha256" varchar(64),
	"parsed_text" text,
	"parsed_text_path" varchar(512),
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"name" varchar(128) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" text,
	"owner_nickname" varchar(64) NOT NULL,
	"owner_user_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_nickname" varchar(64),
	"next_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"title" varchar(256) NOT NULL,
	"status" varchar(16) DEFAULT 'opened' NOT NULL,
	"diff_manifest" jsonb NOT NULL,
	"confidence_id" uuid,
	"merge_snapshot_id" uuid,
	"opened_by_kind" varchar(16) NOT NULL,
	"opened_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"reviewer_kind" varchar(16) NOT NULL,
	"reviewer_user_id" uuid,
	"decision" varchar(16) NOT NULL,
	"reason_md" text,
	"reason_fed_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"work_item_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"event_type" varchar(32) DEFAULT 'custom' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone NOT NULL,
	"participant_user_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" varchar(16) NOT NULL,
	"ref" varchar(128) NOT NULL,
	"content_sha256" varchar(64),
	"created_by_kind" varchar(16) NOT NULL,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_docs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_kind" varchar(16) NOT NULL,
	"work_item_id" uuid,
	"project_id" uuid,
	"title" varchar(256) NOT NULL,
	"content_md" text NOT NULL,
	"content_sha256" varchar(64),
	"version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"bio_md" text,
	"skills_text" text,
	"skill_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability_pref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nickname" varchar(64) NOT NULL,
	"cookie_token" varchar(128) NOT NULL,
	"availability_status" varchar(16) DEFAULT 'free' NOT NULL,
	"availability_text" varchar(128),
	"availability_updated_at" timestamp with time zone,
	"is_admin" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_acceptance_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"assigned_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_progress_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"workspace_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"actor_nickname" varchar(64) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"body" text NOT NULL,
	"phase" varchar(64),
	"progress_percent" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_task_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"item_type" varchar(16) DEFAULT 'task' NOT NULL,
	"suggested_user_id" uuid,
	"estimate_hours" double precision,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_task_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"stage" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"summary" text,
	"risks" text,
	"job_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"target_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_workspace_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"status" varchar(16) DEFAULT 'todo' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phase" varchar(64) DEFAULT '未开始' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"status_note" text,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid,
	"submitter_user_id" uuid NOT NULL,
	"claimed_by_user_id" uuid,
	"claimed_by_nickname" varchar(64),
	"title" varchar(256),
	"raw_description" text,
	"summary_md" text,
	"status" varchar(32) DEFAULT 'intake' NOT NULL,
	"priority" varchar(16) DEFAULT 'normal' NOT NULL,
	"estimate_hours" double precision,
	"estimate_confidence" varchar(16),
	"planning_note" text,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"source_meeting_id" uuid,
	"source_work_item_id" uuid,
	"claimed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_doc_ready_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"sync_state" varchar(16) DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"mode" varchar(16) DEFAULT 'worker' NOT NULL,
	"human_reserved" boolean DEFAULT false NOT NULL,
	"current_spec_id" uuid,
	"main_branch_id" uuid,
	"latest_confidence_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_routed_to_user_id_users_id_fk" FOREIGN KEY ("routed_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_delegated_to_user_id_users_id_fk" FOREIGN KEY ("delegated_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_devices" ADD CONSTRAINT "client_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confidence_records" ADD CONSTRAINT "confidence_records_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confidence_records" ADD CONSTRAINT "confidence_records_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confidence_records" ADD CONSTRAINT "confidence_records_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_confidence_id_confidence_records_id_fk" FOREIGN KEY ("confidence_id") REFERENCES "public"."confidence_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_suggested_lead_user_id_users_id_fk" FOREIGN KEY ("suggested_lead_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_ask_runs" ADD CONSTRAINT "knowledge_ask_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_ask_runs" ADD CONSTRAINT "knowledge_ask_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_ask_runs" ADD CONSTRAINT "knowledge_ask_runs_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_insights" ADD CONSTRAINT "meeting_insights_meeting_id_meeting_records_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_insights" ADD CONSTRAINT "meeting_insights_target_work_item_id_work_items_id_fk" FOREIGN KEY ("target_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_insights" ADD CONSTRAINT "meeting_insights_created_work_item_id_work_items_id_fk" FOREIGN KEY ("created_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_insights" ADD CONSTRAINT "meeting_insights_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_comments" ADD CONSTRAINT "project_drive_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_comments" ADD CONSTRAINT "project_drive_comments_folder_id_project_drive_items_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."project_drive_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_comments" ADD CONSTRAINT "project_drive_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_comments" ADD CONSTRAINT "project_drive_comments_draft_work_item_id_work_items_id_fk" FOREIGN KEY ("draft_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_items" ADD CONSTRAINT "project_drive_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_items" ADD CONSTRAINT "project_drive_items_parent_id_project_drive_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_drive_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_items" ADD CONSTRAINT "project_drive_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_items" ADD CONSTRAINT "project_drive_items_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_items" ADD CONSTRAINT "project_drive_items_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_operations" ADD CONSTRAINT "project_drive_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_operations" ADD CONSTRAINT "project_drive_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_versions" ADD CONSTRAINT "project_drive_versions_item_id_project_drive_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."project_drive_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drive_versions" ADD CONSTRAINT "project_drive_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_docs" ADD CONSTRAINT "spec_docs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_docs" ADD CONSTRAINT "spec_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_acceptance_items" ADD CONSTRAINT "work_item_acceptance_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_acceptance_items" ADD CONSTRAINT "work_item_acceptance_items_source_plan_id_work_item_task_plans_id_fk" FOREIGN KEY ("source_plan_id") REFERENCES "public"."work_item_task_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_progress_updates" ADD CONSTRAINT "work_item_progress_updates_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_progress_updates" ADD CONSTRAINT "work_item_progress_updates_workspace_id_work_item_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."work_item_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_progress_updates" ADD CONSTRAINT "work_item_progress_updates_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_task_items" ADD CONSTRAINT "work_item_task_items_plan_id_work_item_task_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."work_item_task_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_task_items" ADD CONSTRAINT "work_item_task_items_suggested_user_id_users_id_fk" FOREIGN KEY ("suggested_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_task_plans" ADD CONSTRAINT "work_item_task_plans_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_task_plans" ADD CONSTRAINT "work_item_task_plans_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_task_plans" ADD CONSTRAINT "work_item_task_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_task_plans" ADD CONSTRAINT "work_item_task_plans_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_task_plans" ADD CONSTRAINT "work_item_task_plans_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_workspace_items" ADD CONSTRAINT "work_item_workspace_items_workspace_id_work_item_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."work_item_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_workspaces" ADD CONSTRAINT "work_item_workspaces_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_workspaces" ADD CONSTRAINT "work_item_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_submitter_user_id_users_id_fk" FOREIGN KEY ("submitter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_source_meeting_id_meeting_records_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meeting_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_source_work_item_id_work_items_id_fk" FOREIGN KEY ("source_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_current_spec_id_spec_docs_id_fk" FOREIGN KEY ("current_spec_id") REFERENCES "public"."spec_docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_main_branch_id_branches_id_fk" FOREIGN KEY ("main_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_latest_confidence_id_confidence_records_id_fk" FOREIGN KEY ("latest_confidence_id") REFERENCES "public"."confidence_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_org_id_idx" ON "agent_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_id_idx" ON "agent_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_runs_work_item_id_idx" ON "agent_runs" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "agent_runs_branch_id_idx" ON "agent_runs" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_step_uq" ON "agent_steps" USING btree ("agent_run_id","step_no");--> statement-breakpoint
CREATE INDEX "agent_steps_agent_run_id_idx" ON "agent_steps" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "agent_steps_snapshot_id_idx" ON "agent_steps" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "approval_requests_work_item_id_idx" ON "approval_requests" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "approval_requests_agent_run_id_idx" ON "approval_requests" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_routed_to_user_id_idx" ON "approval_requests" USING btree ("routed_to_user_id");--> statement-breakpoint
CREATE INDEX "approval_requests_decided_by_user_id_idx" ON "approval_requests" USING btree ("decided_by_user_id");--> statement-breakpoint
CREATE INDEX "approval_requests_delegated_to_user_id_idx" ON "approval_requests" USING btree ("delegated_to_user_id");--> statement-breakpoint
CREATE INDEX "approval_requests_sla_due_at_idx" ON "approval_requests" USING btree ("sla_due_at");--> statement-breakpoint
CREATE INDEX "attachments_work_item_id_idx" ON "attachments" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_id_idx" ON "audit_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_id_idx" ON "audit_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_snapshot_id_idx" ON "audit_logs" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "background_jobs_kind_idx" ON "background_jobs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "background_jobs_status_idx" ON "background_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "background_jobs_result_ref_idx" ON "background_jobs" USING btree ("result_ref");--> statement-breakpoint
CREATE INDEX "background_jobs_created_by_user_id_idx" ON "background_jobs" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "branches_work_item_id_idx" ON "branches" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "branches_actor_user_id_idx" ON "branches" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "branches_agent_run_id_idx" ON "branches" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "branches_base_snapshot_id_idx" ON "branches" USING btree ("base_snapshot_id");--> statement-breakpoint
CREATE INDEX "branches_status_idx" ON "branches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_messages_work_item_id_idx" ON "chat_messages" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "client_devices_user_id_idx" ON "client_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_devices_token_hash_uq" ON "client_devices" USING btree ("client_token_hash");--> statement-breakpoint
CREATE INDEX "client_devices_revoked_at_idx" ON "client_devices" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "comments_work_item_id_idx" ON "comments" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "confidence_records_work_item_id_idx" ON "confidence_records" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "confidence_records_proposal_id_idx" ON "confidence_records" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "confidence_records_agent_run_id_idx" ON "confidence_records" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_work_item_round_uq" ON "deliveries" USING btree ("work_item_id","round");--> statement-breakpoint
CREATE INDEX "deliveries_work_item_id_idx" ON "deliveries" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "deliveries_proposal_id_idx" ON "deliveries" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "escalation_events_work_item_id_idx" ON "escalation_events" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "escalation_events_agent_run_id_idx" ON "escalation_events" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "escalation_events_confidence_id_idx" ON "escalation_events" USING btree ("confidence_id");--> statement-breakpoint
CREATE INDEX "escalation_events_suggested_lead_user_id_idx" ON "escalation_events" USING btree ("suggested_lead_user_id");--> statement-breakpoint
CREATE INDEX "knowledge_ask_runs_project_id_idx" ON "knowledge_ask_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "knowledge_ask_runs_created_by_user_id_idx" ON "knowledge_ask_runs" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "knowledge_ask_runs_job_id_idx" ON "knowledge_ask_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "knowledge_ask_runs_status_idx" ON "knowledge_ask_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_source_uq" ON "knowledge_documents" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_project_id_idx" ON "knowledge_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_work_item_id_idx" ON "knowledge_documents" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_source_type_idx" ON "knowledge_documents" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "knowledge_documents_source_id_idx" ON "knowledge_documents" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "meeting_insights_meeting_id_idx" ON "meeting_insights" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_insights_kind_idx" ON "meeting_insights" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "meeting_insights_target_work_item_id_idx" ON "meeting_insights" USING btree ("target_work_item_id");--> statement-breakpoint
CREATE INDEX "meeting_insights_status_idx" ON "meeting_insights" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meeting_insights_created_work_item_id_idx" ON "meeting_insights" USING btree ("created_work_item_id");--> statement-breakpoint
CREATE INDEX "meeting_insights_confirmed_by_user_id_idx" ON "meeting_insights" USING btree ("confirmed_by_user_id");--> statement-breakpoint
CREATE INDEX "meeting_records_project_id_idx" ON "meeting_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "meeting_records_work_item_id_idx" ON "meeting_records" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "meeting_records_uploaded_by_user_id_idx" ON "meeting_records" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "meeting_records_status_idx" ON "meeting_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meeting_records_job_id_idx" ON "meeting_records" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notifications_severity_idx" ON "notifications" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "notifications_project_id_idx" ON "notifications" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notifications_work_item_id_idx" ON "notifications" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "notifications_dedupe_key_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_read_at_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "notifications_archived_at_idx" ON "notifications" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_slug_uq" ON "orgs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "orgs_deleted_at_idx" ON "orgs" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "permission_policies_org_id_idx" ON "permission_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "permission_policies_workspace_id_idx" ON "permission_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "permission_policies_scope_idx" ON "permission_policies" USING btree ("scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "permission_policies_action_pattern_idx" ON "permission_policies" USING btree ("action_pattern");--> statement-breakpoint
CREATE INDEX "permission_policies_deleted_at_idx" ON "permission_policies" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "project_drive_comments_project_id_idx" ON "project_drive_comments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_drive_comments_folder_id_idx" ON "project_drive_comments" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "project_drive_comments_author_user_id_idx" ON "project_drive_comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "project_drive_comments_status_idx" ON "project_drive_comments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_drive_comments_draft_work_item_id_idx" ON "project_drive_comments" USING btree ("draft_work_item_id");--> statement-breakpoint
CREATE INDEX "project_drive_items_project_id_idx" ON "project_drive_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_drive_items_parent_id_idx" ON "project_drive_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "project_drive_items_current_version_id_idx" ON "project_drive_items" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "project_drive_items_created_by_user_id_idx" ON "project_drive_items" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "project_drive_items_updated_by_user_id_idx" ON "project_drive_items" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE INDEX "project_drive_items_deleted_at_idx" ON "project_drive_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "project_drive_items_deleted_by_user_id_idx" ON "project_drive_items" USING btree ("deleted_by_user_id");--> statement-breakpoint
CREATE INDEX "project_drive_operations_project_id_idx" ON "project_drive_operations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_drive_operations_actor_user_id_idx" ON "project_drive_operations" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_drive_versions_item_version_uq" ON "project_drive_versions" USING btree ("item_id","version_no");--> statement-breakpoint
CREATE INDEX "project_drive_versions_item_id_idx" ON "project_drive_versions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "project_drive_versions_created_by_user_id_idx" ON "project_drive_versions" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_uq" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "projects_workspace_id_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "projects_owner_user_id_idx" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "projects_deleted_at_idx" ON "projects" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_branch_round_uq" ON "proposals" USING btree ("branch_id","round");--> statement-breakpoint
CREATE INDEX "proposals_work_item_id_idx" ON "proposals" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "proposals_branch_id_idx" ON "proposals" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "proposals_confidence_id_idx" ON "proposals" USING btree ("confidence_id");--> statement-breakpoint
CREATE INDEX "proposals_merge_snapshot_id_idx" ON "proposals" USING btree ("merge_snapshot_id");--> statement-breakpoint
CREATE INDEX "reviews_proposal_id_idx" ON "reviews" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "reviews_reviewer_user_id_idx" ON "reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "schedule_events_project_id_idx" ON "schedule_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "schedule_events_work_item_id_idx" ON "schedule_events" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "schedule_events_created_by_user_id_idx" ON "schedule_events" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "schedule_events_event_type_idx" ON "schedule_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "schedule_events_end_at_idx" ON "schedule_events" USING btree ("end_at");--> statement-breakpoint
CREATE INDEX "snapshots_work_item_id_idx" ON "snapshots" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "snapshots_branch_id_idx" ON "snapshots" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "snapshots_content_sha256_idx" ON "snapshots" USING btree ("content_sha256");--> statement-breakpoint
CREATE INDEX "spec_docs_work_item_id_idx" ON "spec_docs" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "spec_docs_project_id_idx" ON "spec_docs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "spec_docs_content_sha256_idx" ON "spec_docs" USING btree ("content_sha256");--> statement-breakpoint
CREATE INDEX "spec_docs_deleted_at_idx" ON "spec_docs" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_user_id_uq" ON "user_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_uq" ON "users" USING btree ("nickname");--> statement-breakpoint
CREATE UNIQUE INDEX "users_cookie_token_uq" ON "users" USING btree ("cookie_token");--> statement-breakpoint
CREATE INDEX "users_is_admin_idx" ON "users" USING btree ("is_admin");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "work_item_acceptance_items_work_item_id_idx" ON "work_item_acceptance_items" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_acceptance_items_status_idx" ON "work_item_acceptance_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_item_acceptance_items_source_plan_id_idx" ON "work_item_acceptance_items" USING btree ("source_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_assignments_item_user_uq" ON "work_item_assignments" USING btree ("work_item_id","user_id");--> statement-breakpoint
CREATE INDEX "work_item_assignments_work_item_id_idx" ON "work_item_assignments" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_assignments_user_id_idx" ON "work_item_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_item_assignments_assigned_by_user_id_idx" ON "work_item_assignments" USING btree ("assigned_by_user_id");--> statement-breakpoint
CREATE INDEX "work_item_progress_updates_work_item_id_idx" ON "work_item_progress_updates" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_progress_updates_workspace_id_idx" ON "work_item_progress_updates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "work_item_progress_updates_actor_user_id_idx" ON "work_item_progress_updates" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "work_item_progress_updates_kind_idx" ON "work_item_progress_updates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "work_item_task_items_plan_id_idx" ON "work_item_task_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "work_item_task_items_item_type_idx" ON "work_item_task_items" USING btree ("item_type");--> statement-breakpoint
CREATE INDEX "work_item_task_items_suggested_user_id_idx" ON "work_item_task_items" USING btree ("suggested_user_id");--> statement-breakpoint
CREATE INDEX "work_item_task_plans_work_item_id_idx" ON "work_item_task_plans" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_task_plans_stage_idx" ON "work_item_task_plans" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "work_item_task_plans_status_idx" ON "work_item_task_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_item_task_plans_job_id_idx" ON "work_item_task_plans" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "work_item_task_plans_created_by_user_id_idx" ON "work_item_task_plans" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "work_item_task_plans_target_user_id_idx" ON "work_item_task_plans" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "work_item_task_plans_confirmed_by_user_id_idx" ON "work_item_task_plans" USING btree ("confirmed_by_user_id");--> statement-breakpoint
CREATE INDEX "work_item_workspace_items_workspace_id_idx" ON "work_item_workspace_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "work_item_workspace_items_status_idx" ON "work_item_workspace_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_workspaces_item_user_uq" ON "work_item_workspaces" USING btree ("work_item_id","user_id");--> statement-breakpoint
CREATE INDEX "work_item_workspaces_work_item_id_idx" ON "work_item_workspaces" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_workspaces_user_id_idx" ON "work_item_workspaces" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_code_uq" ON "work_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "work_items_project_id_idx" ON "work_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_items_workspace_id_idx" ON "work_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "work_items_submitter_user_id_idx" ON "work_items" USING btree ("submitter_user_id");--> statement-breakpoint
CREATE INDEX "work_items_claimed_by_user_id_idx" ON "work_items" USING btree ("claimed_by_user_id");--> statement-breakpoint
CREATE INDEX "work_items_status_idx" ON "work_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_items_source_meeting_id_idx" ON "work_items" USING btree ("source_meeting_id");--> statement-breakpoint
CREATE INDEX "work_items_source_work_item_id_idx" ON "work_items" USING btree ("source_work_item_id");--> statement-breakpoint
CREATE INDEX "work_items_current_spec_id_idx" ON "work_items" USING btree ("current_spec_id");--> statement-breakpoint
CREATE INDEX "work_items_main_branch_id_idx" ON "work_items" USING btree ("main_branch_id");--> statement-breakpoint
CREATE INDEX "work_items_latest_confidence_id_idx" ON "work_items" USING btree ("latest_confidence_id");--> statement-breakpoint
CREATE INDEX "work_items_deleted_at_idx" ON "work_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_org_slug_uq" ON "workspaces" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "workspaces_org_id_idx" ON "workspaces" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "workspaces_deleted_at_idx" ON "workspaces" USING btree ("deleted_at");