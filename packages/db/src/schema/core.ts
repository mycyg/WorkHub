import type {
  DeliverableChange,
  DeliverableChangeManifest,
  RiskLevel,
  WorkHubLocale,
  WorkItemMode,
  WorkItemStatus
} from "@workhub/contracts";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

const id = () => uuid("id").primaryKey();
const timestampTz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestampTz("created_at").notNull().defaultNow();
const updatedAt = () => timestampTz("updated_at").notNull().defaultNow();
const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const softDeleteColumns = () => ({
  deletedAt: timestampTz("deleted_at"),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" })
});
const tenantColumns = () => ({
  orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" })
});

export const users = pgTable(
  "users",
  {
    id: id(),
    nickname: varchar("nickname", { length: 64 }).notNull(),
    cookieToken: varchar("cookie_token", { length: 128 }).notNull(),
    preferredLocale: varchar("preferred_locale", { length: 16 }).$type<WorkHubLocale>().notNull().default("zh-CN"),
    availabilityStatus: varchar("availability_status", { length: 16 }).notNull().default("free"),
    availabilityText: varchar("availability_text", { length: 128 }),
    availabilityUpdatedAt: timestampTz("availability_updated_at"),
    isAdmin: boolean("is_admin").notNull().default(false),
    deletedAt: timestampTz("deleted_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("users_nickname_uq").on(table.nickname),
    uniqueIndex("users_cookie_token_uq").on(table.cookieToken),
    index("users_is_admin_idx").on(table.isAdmin),
    index("users_deleted_at_idx").on(table.deletedAt)
  ]
);

export const orgs = pgTable(
  "orgs",
  {
    id: id(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    plan: varchar("plan", { length: 32 }).notNull().default("lan"),
    deletedAt: timestampTz("deleted_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("orgs_slug_uq").on(table.slug),
    index("orgs_deleted_at_idx").on(table.deletedAt)
  ]
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    deletedAt: timestampTz("deleted_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("workspaces_org_slug_uq").on(table.orgId, table.slug),
    index("workspaces_org_id_idx").on(table.orgId),
    index("workspaces_deleted_at_idx").on(table.deletedAt)
  ]
);

export const clientDevices = pgTable(
  "client_devices",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceName: varchar("device_name", { length: 128 }).notNull(),
    clientTokenHash: varchar("client_token_hash", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 64 }).notNull(),
    lastSeenAt: timestampTz("last_seen_at"),
    revokedAt: timestampTz("revoked_at"),
    ...timestamps()
  },
  (table) => [
    index("client_devices_user_id_idx").on(table.userId),
    uniqueIndex("client_devices_token_hash_uq").on(table.clientTokenHash),
    index("client_devices_revoked_at_idx").on(table.revokedAt)
  ]
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bioMd: text("bio_md"),
    skillsText: text("skills_text"),
    skillTags: jsonb("skill_tags").$type<string[]>().notNull().default([]),
    availabilityPref: jsonb("availability_pref").$type<JsonObject>().notNull().default({}),
    onboardedAt: timestampTz("onboarded_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("user_profiles_user_id_uq").on(table.userId)
  ]
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    description: text("description"),
    ownerNickname: varchar("owner_nickname", { length: 64 }).notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    archived: boolean("archived").notNull().default(false),
    deletedAt: timestampTz("deleted_at"),
    deletedByNickname: varchar("deleted_by_nickname", { length: 64 }),
    nextSeq: integer("next_seq").notNull().default(0),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("projects_slug_uq").on(table.slug),
    index("projects_workspace_id_idx").on(table.workspaceId),
    index("projects_owner_user_id_idx").on(table.ownerUserId),
    index("projects_deleted_at_idx").on(table.deletedAt)
  ]
);

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: id(),
    kind: varchar("kind", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    progressPercent: integer("progress_percent").notNull().default(0),
    message: text("message"),
    resultRef: varchar("result_ref", { length: 128 }),
    error: text("error"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    startedAt: timestampTz("started_at"),
    finishedAt: timestampTz("finished_at"),
    ...timestamps()
  },
  (table) => [
    index("background_jobs_kind_idx").on(table.kind),
    index("background_jobs_status_idx").on(table.status),
    index("background_jobs_result_ref_idx").on(table.resultRef),
    index("background_jobs_created_by_user_id_idx").on(table.createdByUserId)
  ]
);

export const workItems = pgTable(
  "work_items",
  {
    id: id(),
    code: varchar("code", { length: 64 }).notNull(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    submitterUserId: uuid("submitter_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    claimedByNickname: varchar("claimed_by_nickname", { length: 64 }),
    title: varchar("title", { length: 256 }),
    rawDescription: text("raw_description"),
    summaryMd: text("summary_md"),
    status: varchar("status", { length: 32 }).$type<WorkItemStatus>().notNull().default("intake"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    estimateHours: doublePrecision("estimate_hours"),
    estimateConfidence: varchar("estimate_confidence", { length: 16 }).$type<"low" | "medium" | "high">(),
    planningNote: text("planning_note"),
    startAt: timestampTz("start_at"),
    dueAt: timestampTz("due_at"),
    sourceMeetingId: uuid("source_meeting_id").references((): AnyPgColumn => meetingRecords.id, {
      onDelete: "set null"
    }),
    sourceWorkItemId: uuid("source_work_item_id").references((): AnyPgColumn => workItems.id, { onDelete: "set null" }),
    claimedAt: timestampTz("claimed_at"),
    doneAt: timestampTz("done_at"),
    deliveredAt: timestampTz("delivered_at"),
    deliveryDocReadyAt: timestampTz("delivery_doc_ready_at"),
    acceptedAt: timestampTz("accepted_at"),
    syncState: varchar("sync_state", { length: 16 }).notNull().default("pending"),
    version: integer("version").notNull().default(0),
    mode: varchar("mode", { length: 16 }).$type<WorkItemMode>().notNull().default("worker"),
    humanReserved: boolean("human_reserved").notNull().default(false),
    currentSpecId: uuid("current_spec_id").references((): AnyPgColumn => specDocs.id, { onDelete: "set null" }),
    mainBranchId: uuid("main_branch_id").references((): AnyPgColumn => branches.id, { onDelete: "set null" }),
    latestConfidenceId: uuid("latest_confidence_id").references((): AnyPgColumn => confidenceRecords.id, {
      onDelete: "set null"
    }),
    deletedAt: timestampTz("deleted_at"),
    deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("work_items_code_uq").on(table.code),
    index("work_items_project_id_idx").on(table.projectId),
    index("work_items_workspace_id_idx").on(table.workspaceId),
    index("work_items_submitter_user_id_idx").on(table.submitterUserId),
    index("work_items_claimed_by_user_id_idx").on(table.claimedByUserId),
    index("work_items_status_idx").on(table.status),
    index("work_items_source_meeting_id_idx").on(table.sourceMeetingId),
    index("work_items_source_work_item_id_idx").on(table.sourceWorkItemId),
    index("work_items_current_spec_id_idx").on(table.currentSpecId),
    index("work_items_main_branch_id_idx").on(table.mainBranchId),
    index("work_items_latest_confidence_id_idx").on(table.latestConfidenceId),
    index("work_items_deleted_at_idx").on(table.deletedAt)
  ]
);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: id(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 64 }).notNull(),
    sourceId: varchar("source_id", { length: 128 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    sourceUrl: varchar("source_url", { length: 512 }).notNull(),
    corpusPath: varchar("corpus_path", { length: 512 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("knowledge_documents_source_uq").on(table.sourceType, table.sourceId),
    index("knowledge_documents_project_id_idx").on(table.projectId),
    index("knowledge_documents_work_item_id_idx").on(table.workItemId),
    index("knowledge_documents_source_type_idx").on(table.sourceType),
    index("knowledge_documents_source_id_idx").on(table.sourceId)
  ]
);

export const knowledgeAskRuns = pgTable(
  "knowledge_ask_runs",
  {
    id: id(),
    question: text("question").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").references(() => backgroundJobs.id, { onDelete: "set null" }),
    status: varchar("status", { length: 16 }).notNull().default("running"),
    answerMd: text("answer_md"),
    citationsJson: jsonb("citations_json").$type<JsonArray>().notNull().default([]),
    traceJson: jsonb("trace_json").$type<JsonArray>().notNull().default([]),
    ...timestamps()
  },
  (table) => [
    index("knowledge_ask_runs_project_id_idx").on(table.projectId),
    index("knowledge_ask_runs_created_by_user_id_idx").on(table.createdByUserId),
    index("knowledge_ask_runs_job_id_idx").on(table.jobId),
    index("knowledge_ask_runs_status_idx").on(table.status)
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull().default("normal"),
    title: varchar("title", { length: 256 }).notNull(),
    body: text("body"),
    targetUrl: varchar("target_url", { length: 512 }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references((): AnyPgColumn => workItems.id, { onDelete: "set null" }),
    dedupeKey: varchar("dedupe_key", { length: 256 }),
    readAt: timestampTz("read_at"),
    archivedAt: timestampTz("archived_at"),
    ...timestamps()
  },
  (table) => [
    index("notifications_user_id_idx").on(table.userId),
    index("notifications_type_idx").on(table.type),
    index("notifications_severity_idx").on(table.severity),
    index("notifications_project_id_idx").on(table.projectId),
    index("notifications_work_item_id_idx").on(table.workItemId),
    index("notifications_dedupe_key_idx").on(table.dedupeKey),
    index("notifications_read_at_idx").on(table.readAt),
    index("notifications_archived_at_idx").on(table.archivedAt),
    // M13/M15：同一用户同一 dedupeKey 只能有一条，挡住并发 check-then-insert 产生的重复通知。
    uniqueIndex("notifications_user_dedupe_uq")
      .on(table.userId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`)
  ]
);

export const projectDriveItems = pgTable(
  "project_drive_items",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => projectDriveItems.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    currentVersionId: uuid("current_version_id"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestampTz("deleted_at"),
    deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps()
  },
  (table) => [
    index("project_drive_items_project_id_idx").on(table.projectId),
    index("project_drive_items_parent_id_idx").on(table.parentId),
    index("project_drive_items_current_version_id_idx").on(table.currentVersionId),
    index("project_drive_items_created_by_user_id_idx").on(table.createdByUserId),
    index("project_drive_items_updated_by_user_id_idx").on(table.updatedByUserId),
    index("project_drive_items_deleted_at_idx").on(table.deletedAt),
    index("project_drive_items_deleted_by_user_id_idx").on(table.deletedByUserId),
    uniqueIndex("project_drive_items_active_path_uq")
      .on(table.projectId, sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`, table.name)
      .where(sql`${table.deletedAt} is null`)
  ]
);

export const projectDriveVersions = pgTable(
  "project_drive_versions",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => projectDriveItems.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    filename: varchar("filename", { length: 256 }).notNull(),
    mime: varchar("mime", { length: 128 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storagePath: varchar("storage_path", { length: 512 }).notNull(),
    sha256: varchar("sha256", { length: 64 }),
    parsedText: text("parsed_text"),
    parsedTextPath: varchar("parsed_text_path", { length: 512 }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("project_drive_versions_item_version_uq").on(table.itemId, table.versionNo),
    index("project_drive_versions_item_id_idx").on(table.itemId),
    index("project_drive_versions_created_by_user_id_idx").on(table.createdByUserId)
  ]
);

export const projectDriveOperations = pgTable(
  "project_drive_operations",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    opType: varchar("op_type", { length: 32 }).notNull(),
    payloadJson: jsonb("payload_json").$type<JsonObject>().notNull(),
    undoneAt: timestampTz("undone_at"),
    ...timestamps()
  },
  (table) => [
    index("project_drive_operations_project_id_idx").on(table.projectId),
    index("project_drive_operations_actor_user_id_idx").on(table.actorUserId)
  ]
);

export const projectDriveComments = pgTable(
  "project_drive_comments",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => projectDriveItems.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    authorNickname: varchar("author_nickname", { length: 64 }).notNull(),
    body: text("body").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("pending_llm"),
    llmKind: varchar("llm_kind", { length: 32 }),
    llmReason: text("llm_reason"),
    draftWorkItemId: uuid("draft_work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    ...timestamps()
  },
  (table) => [
    index("project_drive_comments_project_id_idx").on(table.projectId),
    index("project_drive_comments_folder_id_idx").on(table.folderId),
    index("project_drive_comments_author_user_id_idx").on(table.authorUserId),
    index("project_drive_comments_status_idx").on(table.status),
    index("project_drive_comments_draft_work_item_id_idx").on(table.draftWorkItemId)
  ]
);

export const scheduleEvents = pgTable(
  "schedule_events",
  {
    id: id(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    eventType: varchar("event_type", { length: 32 }).notNull().default("custom"),
    startAt: timestampTz("start_at"),
    endAt: timestampTz("end_at").notNull(),
    participantUserIdsJson: jsonb("participant_user_ids_json").$type<string[]>().notNull().default([]),
    ...timestamps()
  },
  (table) => [
    index("schedule_events_project_id_idx").on(table.projectId),
    index("schedule_events_work_item_id_idx").on(table.workItemId),
    index("schedule_events_created_by_user_id_idx").on(table.createdByUserId),
    index("schedule_events_event_type_idx").on(table.eventType),
    index("schedule_events_end_at_idx").on(table.endAt)
  ]
);

export const meetingRecords = pgTable(
  "meeting_records",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 256 }).notNull(),
    audioFilename: varchar("audio_filename", { length: 256 }).notNull(),
    audioMime: varchar("audio_mime", { length: 128 }),
    audioSizeBytes: bigint("audio_size_bytes", { mode: "number" }).notNull(),
    audioPath: varchar("audio_path", { length: 512 }).notNull(),
    transcriptText: text("transcript_text"),
    minutesMd: text("minutes_md"),
    status: varchar("status", { length: 32 }).notNull().default("processing"),
    jobId: uuid("job_id").references(() => backgroundJobs.id, { onDelete: "set null" }),
    ...timestamps()
  },
  (table) => [
    index("meeting_records_project_id_idx").on(table.projectId),
    index("meeting_records_work_item_id_idx").on(table.workItemId),
    index("meeting_records_uploaded_by_user_id_idx").on(table.uploadedByUserId),
    index("meeting_records_status_idx").on(table.status),
    index("meeting_records_job_id_idx").on(table.jobId)
  ]
);

export const meetingInsights = pgTable(
  "meeting_insights",
  {
    id: id(),
    meetingId: uuid("meeting_id").notNull().references(() => meetingRecords.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description").notNull(),
    targetWorkItemId: uuid("target_work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    confidenceReason: text("confidence_reason"),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    createdWorkItemId: uuid("created_work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestampTz("confirmed_at"),
    ...timestamps()
  },
  (table) => [
    index("meeting_insights_meeting_id_idx").on(table.meetingId),
    index("meeting_insights_kind_idx").on(table.kind),
    index("meeting_insights_target_work_item_id_idx").on(table.targetWorkItemId),
    index("meeting_insights_status_idx").on(table.status),
    index("meeting_insights_created_work_item_id_idx").on(table.createdWorkItemId),
    index("meeting_insights_confirmed_by_user_id_idx").on(table.confirmedByUserId)
  ]
);

export const workItemAssignments = pgTable(
  "work_item_assignments",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 16 }).notNull(),
    assignedByUserId: uuid("assigned_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("work_item_assignments_item_user_uq").on(table.workItemId, table.userId),
    index("work_item_assignments_work_item_id_idx").on(table.workItemId),
    index("work_item_assignments_user_id_idx").on(table.userId),
    index("work_item_assignments_assigned_by_user_id_idx").on(table.assignedByUserId)
  ]
);

export const workItemWorkspaces = pgTable(
  "work_item_workspaces",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    phase: varchar("phase", { length: 64 }).notNull().default("未开始"),
    progressPercent: integer("progress_percent").notNull().default(0),
    statusNote: text("status_note"),
    blockedReason: text("blocked_reason"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("work_item_workspaces_item_user_uq").on(table.workItemId, table.userId),
    index("work_item_workspaces_work_item_id_idx").on(table.workItemId),
    index("work_item_workspaces_user_id_idx").on(table.userId)
  ]
);

export const workItemWorkspaceItems = pgTable(
  "work_item_workspace_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workItemWorkspaces.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("todo"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps()
  },
  (table) => [
    index("work_item_workspace_items_workspace_id_idx").on(table.workspaceId),
    index("work_item_workspace_items_status_idx").on(table.status)
  ]
);

export const workItemProgressUpdates = pgTable(
  "work_item_progress_updates",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workItemWorkspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    actorNickname: varchar("actor_nickname", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    body: text("body").notNull(),
    phase: varchar("phase", { length: 64 }),
    progressPercent: integer("progress_percent"),
    ...timestamps()
  },
  (table) => [
    index("work_item_progress_updates_work_item_id_idx").on(table.workItemId),
    index("work_item_progress_updates_workspace_id_idx").on(table.workspaceId),
    index("work_item_progress_updates_actor_user_id_idx").on(table.actorUserId),
    index("work_item_progress_updates_kind_idx").on(table.kind)
  ]
);

export const workItemTaskPlans = pgTable(
  "work_item_task_plans",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    summary: text("summary"),
    risks: text("risks"),
    jobId: uuid("job_id").references(() => backgroundJobs.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestampTz("confirmed_at"),
    ...timestamps()
  },
  (table) => [
    index("work_item_task_plans_work_item_id_idx").on(table.workItemId),
    index("work_item_task_plans_stage_idx").on(table.stage),
    index("work_item_task_plans_status_idx").on(table.status),
    index("work_item_task_plans_job_id_idx").on(table.jobId),
    index("work_item_task_plans_created_by_user_id_idx").on(table.createdByUserId),
    index("work_item_task_plans_target_user_id_idx").on(table.targetUserId),
    index("work_item_task_plans_confirmed_by_user_id_idx").on(table.confirmedByUserId)
  ]
);

export const workItemTaskItems = pgTable(
  "work_item_task_items",
  {
    id: id(),
    planId: uuid("plan_id").notNull().references(() => workItemTaskPlans.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    itemType: varchar("item_type", { length: 16 }).notNull().default("task"),
    suggestedUserId: uuid("suggested_user_id").references(() => users.id, { onDelete: "set null" }),
    estimateHours: doublePrecision("estimate_hours"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps()
  },
  (table) => [
    index("work_item_task_items_plan_id_idx").on(table.planId),
    index("work_item_task_items_item_type_idx").on(table.itemType),
    index("work_item_task_items_suggested_user_id_idx").on(table.suggestedUserId)
  ]
);

export const workItemAcceptanceItems = pgTable(
  "work_item_acceptance_items",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourcePlanId: uuid("source_plan_id").references(() => workItemTaskPlans.id, { onDelete: "set null" }),
    ...timestamps()
  },
  (table) => [
    index("work_item_acceptance_items_work_item_id_idx").on(table.workItemId),
    index("work_item_acceptance_items_status_idx").on(table.status),
    index("work_item_acceptance_items_source_plan_id_idx").on(table.sourcePlanId)
  ]
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 256 }).notNull(),
    mime: varchar("mime", { length: 128 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storagePath: varchar("storage_path", { length: 512 }).notNull(),
    sha256: varchar("sha256", { length: 64 }),
    parsedText: text("parsed_text"),
    parsedTextPath: varchar("parsed_text_path", { length: 512 }),
    roleInReq: varchar("role_in_req", { length: 64 }),
    ...timestamps()
  },
  (table) => [
    index("attachments_work_item_id_idx").on(table.workItemId)
  ]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    contentJson: jsonb("content_json").$type<JsonObject>().notNull(),
    selectedOptionKey: varchar("selected_option_key", { length: 64 }),
    userOtherText: text("user_other_text"),
    ...timestamps()
  },
  (table) => [
    index("chat_messages_work_item_id_idx").on(table.workItemId)
  ]
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
    round: integer("round").notNull(),
    packagePath: varchar("package_path", { length: 512 }).notNull(),
    packageSize: bigint("package_size", { mode: "number" }).notNull(),
    packageSha256: varchar("package_sha256", { length: 64 }).notNull(),
    fileCount: integer("file_count").notNull(),
    deliveryDocMd: text("delivery_doc_md"),
    notes: text("notes"),
    submittedByNickname: varchar("submitted_by_nickname", { length: 64 }).notNull(),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("deliveries_work_item_round_uq").on(table.workItemId, table.round),
    index("deliveries_work_item_id_idx").on(table.workItemId),
    index("deliveries_proposal_id_idx").on(table.proposalId)
  ]
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    authorNickname: varchar("author_nickname", { length: 64 }).notNull(),
    body: text("body").notNull(),
    ...timestamps()
  },
  (table) => [
    index("comments_work_item_id_idx").on(table.workItemId)
  ]
);

export const branches = pgTable(
  "branches",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    actorKind: varchar("actor_kind", { length: 16 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id"),
    kind: varchar("kind", { length: 16 }).notNull().default("work"),
    baseSnapshotId: uuid("base_snapshot_id"),
    headRef: varchar("head_ref", { length: 128 }),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    version: integer("version").notNull().default(0),
    ...timestamps()
  },
  (table) => [
    index("branches_work_item_id_idx").on(table.workItemId),
    index("branches_actor_user_id_idx").on(table.actorUserId),
    index("branches_agent_run_id_idx").on(table.agentRunId),
    index("branches_base_snapshot_id_idx").on(table.baseSnapshotId),
    index("branches_status_idx").on(table.status)
  ]
);

export const proposals = pgTable(
  "proposals",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("opened"),
    diffManifest: jsonb("diff_manifest").$type<DeliverableChangeManifest>().notNull(),
    confidenceId: uuid("confidence_id"),
    mergeSnapshotId: uuid("merge_snapshot_id"),
    openedByKind: varchar("opened_by_kind", { length: 16 }).notNull(),
    openedByUserId: uuid("opened_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestampTz("reviewed_at"),
    mergedAt: timestampTz("merged_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("proposals_branch_round_uq").on(table.branchId, table.round),
    index("proposals_work_item_id_idx").on(table.workItemId),
    index("proposals_branch_id_idx").on(table.branchId),
    index("proposals_status_idx").on(table.status),
    index("proposals_confidence_id_idx").on(table.confidenceId),
    index("proposals_merge_snapshot_id_idx").on(table.mergeSnapshotId)
  ]
);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    reviewerKind: varchar("reviewer_kind", { length: 16 }).notNull(),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    decision: varchar("decision", { length: 16 }).notNull(),
    reasonMd: text("reason_md"),
    reasonFedBackAt: timestampTz("reason_fed_back_at"),
    ...timestamps()
  },
  (table) => [
    index("reviews_proposal_id_idx").on(table.proposalId),
    index("reviews_reviewer_user_id_idx").on(table.reviewerUserId)
  ]
);

export const acceptedDeliverableChanges = pgTable(
  "accepted_deliverable_changes",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    // P-COLLAB：项目级采纳命名空间（同一项目跨任务改同一文件 → 同一并发边界，防丢更新）。
    // 暂可空（兼容历史行）；新采纳一律按所属 work_item 的 project 填入。
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    changeId: uuid("change_id").notNull(),
    targetKind: varchar("target_kind", { length: 32 }).$type<DeliverableChange["target_kind"]>().notNull(),
    targetEntityType: varchar("target_entity_type", { length: 32 })
      .$type<DeliverableChange["target_ref"]["entity_type"]>()
      .notNull(),
    targetEntityId: uuid("target_entity_id"),
    targetPath: varchar("target_path", { length: 512 }),
    targetKey: varchar("target_key", { length: 768 }).notNull(),
    changeType: varchar("change_type", { length: 32 }).$type<DeliverableChange["change_type"]>().notNull(),
    acceptedVersion: integer("accepted_version").notNull().default(1),
    baseVersionRef: varchar("base_version_ref", { length: 128 }),
    acceptedRef: varchar("accepted_ref", { length: 512 }),
    driveItemId: uuid("drive_item_id").references(() => projectDriveItems.id, { onDelete: "set null" }),
    driveVersionId: uuid("drive_version_id").references(() => projectDriveVersions.id, { onDelete: "set null" }),
    sha256Before: varchar("sha256_before", { length: 64 }),
    sha256After: varchar("sha256_after", { length: 64 }),
    previewRefJson: jsonb("preview_ref_json").$type<DeliverableChange["preview_ref"]>(),
    manifestChangeJson: jsonb("manifest_change_json").$type<DeliverableChange>().notNull(),
    supersededAt: timestampTz("superseded_at"),
    ...timestamps()
  },
  (table) => [
    index("accepted_deliverable_changes_work_item_id_idx").on(table.workItemId),
    index("accepted_deliverable_changes_proposal_id_idx").on(table.proposalId),
    index("accepted_deliverable_changes_branch_id_idx").on(table.branchId),
    index("accepted_deliverable_changes_drive_item_id_idx").on(table.driveItemId),
    index("accepted_deliverable_changes_drive_version_id_idx").on(table.driveVersionId),
    index("accepted_deliverable_changes_target_idx").on(table.workItemId, table.targetKey),
    index("accepted_deliverable_changes_current_idx").on(table.workItemId, table.targetKey, table.supersededAt),
    index("accepted_deliverable_changes_project_current_idx").on(table.projectId, table.targetKey, table.supersededAt),
    index("accepted_deliverable_changes_created_at_idx").on(table.createdAt)
  ]
);

export const mergeAttempts = pgTable(
  "merge_attempts",
  {
    id: id(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    actorKind: varchar("actor_kind", { length: 16 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    result: varchar("result", { length: 16 }).notNull(),
    mergeSnapshotId: uuid("merge_snapshot_id").references((): AnyPgColumn => snapshots.id, { onDelete: "set null" }),
    conflictsJson: jsonb("conflicts_json").$type<JsonArray>().notNull().default([]),
    acceptedTargetKeys: jsonb("accepted_target_keys").$type<string[]>().notNull().default([]),
    targetKeys: jsonb("target_keys").$type<string[]>().notNull().default([]),
    conflictCount: integer("conflict_count").notNull().default(0),
    createdAt: createdAt()
  },
  (table) => [
    index("merge_attempts_proposal_id_idx").on(table.proposalId),
    index("merge_attempts_work_item_id_idx").on(table.workItemId),
    index("merge_attempts_branch_id_idx").on(table.branchId),
    index("merge_attempts_actor_user_id_idx").on(table.actorUserId),
    index("merge_attempts_result_idx").on(table.result),
    index("merge_attempts_merge_snapshot_id_idx").on(table.mergeSnapshotId),
    index("merge_attempts_created_at_idx").on(table.createdAt)
  ]
);

export const mergeProposals = pgTable(
  "merge_proposals",
  {
    id: id(),
    mergeAttemptId: uuid("merge_attempt_id").notNull().references(() => mergeAttempts.id, { onDelete: "cascade" }),
    conflictKey: varchar("conflict_key", { length: 768 }).notNull(),
    candidatesJson: jsonb("candidates_json").$type<JsonArray>().notNull().default([]),
    recommendedOptionKey: varchar("recommended_option_key", { length: 64 }),
    chosenOptionKey: varchar("chosen_option_key", { length: 64 }),
    chosenByUserId: uuid("chosen_by_user_id").references(() => users.id, { onDelete: "set null" }),
    chosenAt: timestampTz("chosen_at"),
    ...timestamps()
  },
  (table) => [
    index("merge_proposals_attempt_id_idx").on(table.mergeAttemptId),
    index("merge_proposals_conflict_key_idx").on(table.conflictKey),
    index("merge_proposals_chosen_by_user_id_idx").on(table.chosenByUserId),
    index("merge_proposals_chosen_at_idx").on(table.chosenAt)
  ]
);

export const specDocs = pgTable(
  "spec_docs",
  {
    id: id(),
    scopeKind: varchar("scope_kind", { length: 16 }).notNull(),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).notNull(),
    contentMd: text("content_md").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }),
    version: integer("version").notNull().default(0),
    deletedAt: timestampTz("deleted_at"),
    ...timestamps()
  },
  (table) => [
    index("spec_docs_work_item_id_idx").on(table.workItemId),
    index("spec_docs_project_id_idx").on(table.projectId),
    index("spec_docs_content_sha256_idx").on(table.contentSha256),
    index("spec_docs_deleted_at_idx").on(table.deletedAt)
  ]
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    ...tenantColumns(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    mode: varchar("mode", { length: 16 }).$type<WorkItemMode>().notNull(),
    actor: varchar("actor", { length: 32 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 256 }).notNull().default("AI worker run"),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    model: varchar("model", { length: 64 }).notNull(),
    turnsUsed: integer("turns_used").notNull().default(0),
    maxTurns: integer("max_turns").notNull(),
    totalTimeoutS: integer("total_timeout_s").notNull().default(300),
    maxTokens: integer("max_tokens").notNull().default(120000),
    maxCostCny: numeric("max_cost_cny", { precision: 12, scale: 6 }).notNull().default("5"),
    seconds: doublePrecision("seconds"),
    tokenIn: integer("token_in").notNull().default(0),
    tokenOut: integer("token_out").notNull().default(0),
    costEstimate: numeric("cost_estimate", { precision: 12, scale: 6 }),
    budgetDecisionJson: jsonb("budget_decision_json").$type<JsonObject>().notNull().default({}),
    outcomeReason: varchar("outcome_reason", { length: 256 }),
    handoffMd: text("handoff_md"),
    handoffJson: jsonb("handoff_json").$type<JsonObject>(),
    workdirRef: varchar("workdir_ref", { length: 512 }),
    claimedBy: varchar("claimed_by", { length: 128 }),
    claimedAt: timestampTz("claimed_at"),
    heartbeatAt: timestampTz("heartbeat_at"),
    leaseExpiresAt: timestampTz("lease_expires_at"),
    startedAt: timestampTz("started_at"),
    finishedAt: timestampTz("finished_at"),
    ...timestamps()
  },
  (table) => [
    index("agent_runs_org_id_idx").on(table.orgId),
    index("agent_runs_workspace_id_idx").on(table.workspaceId),
    index("agent_runs_work_item_id_idx").on(table.workItemId),
    index("agent_runs_branch_id_idx").on(table.branchId),
    index("agent_runs_actor_user_id_idx").on(table.actorUserId),
    index("agent_runs_status_idx").on(table.status),
    uniqueIndex("agent_runs_work_item_active_uq")
      .on(table.workItemId)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("agent_runs_claim_idx").on(table.status, table.leaseExpiresAt, table.createdAt),
    index("agent_runs_claimed_by_idx").on(table.claimedBy)
  ]
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: id(),
    agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull().default(0),
    stepNo: integer("step_no").notNull(),
    phase: varchar("phase", { length: 32 }).notNull(),
    toolName: varchar("tool_name", { length: 64 }),
    inputJson: jsonb("input_json").$type<JsonObject>().notNull().default({}),
    outputExcerpt: text("output_excerpt"),
    controlSignal: varchar("control_signal", { length: 16 }),
    snapshotId: uuid("snapshot_id"),
    createdAt: createdAt()
  },
  (table) => [
    index("agent_steps_agent_run_id_idx").on(table.agentRunId),
    index("agent_steps_run_seq_idx").on(table.agentRunId, table.seq),
    index("agent_steps_snapshot_id_idx").on(table.snapshotId)
  ]
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: varchar("id", { length: 512 }).primaryKey(),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actorId: varchar("actor_id", { length: 128 }),
    provider: varchar("provider", { length: 64 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    task: varchar("task", { length: 64 }).notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostCny: numeric("estimated_cost_cny", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestampTz("created_at").notNull()
  },
  (table) => [
    index("usage_records_run_id_idx").on(table.runId),
    index("usage_records_work_item_id_idx").on(table.workItemId),
    index("usage_records_user_id_idx").on(table.userId),
    index("usage_records_created_at_idx").on(table.createdAt),
    index("usage_records_provider_model_idx").on(table.provider, table.model)
  ]
);

export const costLedgerEntries = pgTable(
  "cost_ledger_entries",
  {
    id: id(),
    usageRecordId: varchar("usage_record_id", { length: 512 }).notNull().references(() => usageRecords.id, {
      onDelete: "cascade"
    }),
    policyId: varchar("policy_id", { length: 128 }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references(() => workspaces.id, { onDelete: "set null" }),
    scopeKind: varchar("scope_kind", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 128 }).notNull(),
    scopeJson: jsonb("scope_json").$type<JsonObject>().notNull(),
    periodBucket: varchar("period_bucket", { length: 16 }).notNull(),
    tokenIn: integer("token_in").notNull().default(0),
    tokenOut: integer("token_out").notNull().default(0),
    estimatedCostCny: numeric("estimated_cost_cny", { precision: 12, scale: 6 }).notNull().default("0"),
    unitPriceCny: numeric("unit_price_cny", { precision: 12, scale: 6 }),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    provider: varchar("provider", { length: 64 }),
    model: varchar("model", { length: 128 }).notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    createdAt: timestampTz("created_at").notNull()
  },
  (table) => [
    uniqueIndex("cost_ledger_entries_usage_scope_uq").on(
      table.usageRecordId,
      table.scopeKind,
      table.scopeId,
      table.periodBucket
    ),
    index("cost_ledger_entries_run_id_idx").on(table.runId),
    index("cost_ledger_entries_work_item_id_idx").on(table.workItemId),
    index("cost_ledger_entries_user_id_idx").on(table.userId),
    index("cost_ledger_entries_team_id_idx").on(table.teamId),
    index("cost_ledger_entries_scope_idx").on(table.scopeKind, table.scopeId),
    index("cost_ledger_entries_period_bucket_idx").on(table.periodBucket),
    index("cost_ledger_entries_created_at_idx").on(table.createdAt)
  ]
);

export const budgetPolicies = pgTable(
  "budget_policies",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    scopeKind: varchar("scope_kind", { length: 16 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    maxTokens: integer("max_tokens").notNull(),
    maxCostCny: numeric("max_cost_cny", { precision: 12, scale: 6 }).notNull(),
    warningRatio: numeric("warning_ratio", { precision: 5, scale: 4 }).notNull().default("0.8"),
    criticalRatio: numeric("critical_ratio", { precision: 5, scale: 4 }).notNull().default("0.95"),
    onWarning: varchar("on_warning", { length: 32 }).notNull(),
    onExhausted: varchar("on_exhausted", { length: 32 }).notNull(),
    modelRouteHint: varchar("model_route_hint", { length: 32 }),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...tenantColumns(),
    ...timestamps()
  },
  (table) => [
    index("budget_policies_scope_kind_idx").on(table.scopeKind),
    index("budget_policies_enabled_idx").on(table.enabled),
    index("budget_policies_workspace_id_idx").on(table.workspaceId),
    index("budget_policies_updated_by_user_id_idx").on(table.updatedByUserId)
  ]
);

export const confidenceRecords = pgTable(
  "confidence_records",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    confidenceScore: doublePrecision("confidence_score").notNull(),
    riskScore: doublePrecision("risk_score").notNull(),
    grade: varchar("grade", { length: 8 }).$type<"low" | "medium" | "high">().notNull(),
    riskLevel: varchar("risk_level", { length: 8 }).$type<RiskLevel>().notNull(),
    verdict: varchar("verdict", { length: 16 }).notNull(),
    signalsJson: jsonb("signals_json").$type<JsonObject>().notNull().default({}),
    rationaleMd: text("rationale_md"),
    createdAt: createdAt()
  },
  (table) => [
    index("confidence_records_work_item_id_idx").on(table.workItemId),
    index("confidence_records_proposal_id_idx").on(table.proposalId),
    index("confidence_records_agent_run_id_idx").on(table.agentRunId)
  ]
);

export const escalationEvents = pgTable(
  "escalation_events",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    confidenceId: uuid("confidence_id").references(() => confidenceRecords.id, { onDelete: "set null" }),
    trigger: varchar("trigger", { length: 24 }).notNull(),
    reasonMd: text("reason_md").notNull(),
    handoffJson: jsonb("handoff_json").$type<JsonObject>().notNull().default({}),
    suggestedLeadUserId: uuid("suggested_lead_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestampTz("resolved_at"),
    createdAt: createdAt()
  },
  (table) => [
    index("escalation_events_work_item_id_idx").on(table.workItemId),
    index("escalation_events_agent_run_id_idx").on(table.agentRunId),
    index("escalation_events_confidence_id_idx").on(table.confidenceId),
    index("escalation_events_suggested_lead_user_id_idx").on(table.suggestedLeadUserId)
  ]
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    ref: varchar("ref", { length: 128 }).notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }),
    createdByKind: varchar("created_by_kind", { length: 16 }).notNull(),
    revertedAt: timestampTz("reverted_at"),
    createdAt: createdAt()
  },
  (table) => [
    index("snapshots_work_item_id_idx").on(table.workItemId),
    index("snapshots_branch_id_idx").on(table.branchId),
    index("snapshots_content_sha256_idx").on(table.contentSha256)
  ]
);

export const permissionPolicies = pgTable(
  "permission_policies",
  {
    id: id(),
    ...tenantColumns(),
    scopeKind: varchar("scope_kind", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 64 }).notNull(),
    actionPattern: varchar("action_pattern", { length: 128 }).notNull(),
    effect: varchar("effect", { length: 8 }).notNull(),
    priority: integer("priority").notNull().default(0),
    learnedFromSession: boolean("learned_from_session").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...softDeleteColumns(),
    ...timestamps()
  },
  (table) => [
    index("permission_policies_org_id_idx").on(table.orgId),
    index("permission_policies_workspace_id_idx").on(table.workspaceId),
    index("permission_policies_scope_idx").on(table.scopeKind, table.scopeId),
    index("permission_policies_action_pattern_idx").on(table.actionPattern),
    index("permission_policies_deleted_at_idx").on(table.deletedAt)
  ]
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    actionPattern: varchar("action_pattern", { length: 128 }).notNull(),
    payloadJson: jsonb("payload_json").$type<JsonObject>().notNull().default({}),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    routedToUserId: uuid("routed_to_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decisionReasonMd: text("decision_reason_md"),
    delegatedToUserId: uuid("delegated_to_user_id").references(() => users.id, { onDelete: "set null" }),
    slaDueAt: timestampTz("sla_due_at"),
    ...timestamps()
  },
  (table) => [
    index("approval_requests_work_item_id_idx").on(table.workItemId),
    index("approval_requests_agent_run_id_idx").on(table.agentRunId),
    index("approval_requests_status_idx").on(table.status),
    index("approval_requests_routed_to_user_id_idx").on(table.routedToUserId),
    index("approval_requests_decided_by_user_id_idx").on(table.decidedByUserId),
    index("approval_requests_delegated_to_user_id_idx").on(table.delegatedToUserId),
    index("approval_requests_sla_due_at_idx").on(table.slaDueAt)
  ]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    actorKind: varchar("actor_kind", { length: 16 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorNickname: varchar("actor_nickname", { length: 64 }),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    detailJson: jsonb("detail_json").$type<JsonObject>().notNull().default({}),
    snapshotId: uuid("snapshot_id").references(() => snapshots.id, { onDelete: "set null" }),
    undoneAt: timestampTz("undone_at"),
    createdAt: createdAt()
  },
  (table) => [
    index("audit_logs_org_id_idx").on(table.orgId),
    index("audit_logs_workspace_id_idx").on(table.workspaceId),
    index("audit_logs_actor_user_id_idx").on(table.actorUserId),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_snapshot_id_idx").on(table.snapshotId),
    index("audit_logs_created_at_idx").on(table.createdAt)
  ]
);

// R6.M1 用户级 memory：个人偏好/纠正/常用上下文，注入 worker prompt 减少重复澄清。
// 全局 user_id 维度（workspace_id 预留多租户）；用户自助可删（软删 deletedAt）。
export const userMemories = pgTable(
  "user_memories",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 32 }).$type<"preference" | "correction" | "recurring_context">().notNull(),
    key: varchar("key", { length: 256 }).notNull(),
    valueMd: text("value_md").notNull(),
    confidence: doublePrecision("confidence").notNull().default(0.5),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    lastUsedAt: timestampTz("last_used_at"),
    expiresAt: timestampTz("expires_at"),
    deletedAt: timestampTz("deleted_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("user_memories_key_uq").on(table.userId, table.category, table.key).where(sql`${table.deletedAt} is null`),
    index("user_memories_user_id_idx").on(table.userId),
    index("user_memories_workspace_id_idx").on(table.workspaceId),
    index("user_memories_category_idx").on(table.category),
    index("user_memories_confidence_idx").on(table.confidence),
    index("user_memories_last_used_at_idx").on(table.lastUsedAt),
    index("user_memories_expires_at_idx").on(table.expiresAt),
    index("user_memories_deleted_at_idx").on(table.deletedAt)
  ]
);

// R6.S2 团队级技能：AI 闲时从团队真实工作（接受的交付物/升级缺口）自蒸馏的 SKILL.md，
// workspace 维度、版本化。active 版本与 FS 预设技能合并后注入 worker prompt（赋能整个团队）。
// 无人工预审：AI 自验通过即 active；人类仅事后 deprecate/rollback（kill-switch）。
export const teamSkills = pgTable(
  "team_skills",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    skillKey: varchar("skill_key", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    whenToUse: text("when_to_use").notNull(),
    contentMd: text("content_md").notNull(),
    status: varchar("status", { length: 16 }).$type<"draft" | "active" | "deprecated">().notNull().default("draft"),
    version: integer("version").notNull().default(1),
    sourceKind: varchar("source_kind", { length: 16 }).$type<"distilled" | "authored">().notNull().default("distilled"),
    createdByKind: varchar("created_by_kind", { length: 16 }).$type<"ai" | "human">().notNull().default("ai"),
    confidenceScore: doublePrecision("confidence_score"),
    sampleCount: integer("sample_count").notNull().default(0),
    samplesJson: jsonb("samples_json").$type<JsonObject>().notNull().default({}),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    deprecatedReason: text("deprecated_reason"),
    deprecatedAt: timestampTz("deprecated_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("team_skills_workspace_key_version_uq").on(table.workspaceId, table.skillKey, table.version),
    index("team_skills_workspace_status_idx").on(table.workspaceId, table.status),
    index("team_skills_workspace_key_idx").on(table.workspaceId, table.skillKey),
    index("team_skills_created_at_idx").on(table.createdAt)
  ]
);

export const workHubTables = {
  users,
  userMemories,
  teamSkills,
  clientDevices,
  userProfiles,
  orgs,
  workspaces,
  projects,
  backgroundJobs,
  knowledgeDocuments,
  knowledgeAskRuns,
  notifications,
  projectDriveItems,
  projectDriveVersions,
  projectDriveOperations,
  projectDriveComments,
  scheduleEvents,
  meetingRecords,
  meetingInsights,
  workItems,
  workItemAssignments,
  workItemWorkspaces,
  workItemWorkspaceItems,
  workItemProgressUpdates,
  workItemTaskPlans,
  workItemTaskItems,
  workItemAcceptanceItems,
  attachments,
  chatMessages,
  deliveries,
  comments,
  branches,
  proposals,
  reviews,
  acceptedDeliverableChanges,
  mergeAttempts,
  mergeProposals,
  specDocs,
  agentRuns,
  agentSteps,
  usageRecords,
  costLedgerEntries,
  budgetPolicies,
  confidenceRecords,
  escalationEvents,
  snapshots,
  permissionPolicies,
  approvalRequests,
  auditLogs
} as const;

export type WorkHubTableName = keyof typeof workHubTables;
