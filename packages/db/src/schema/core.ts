import type {
  AiMode,
  ConversationKind,
  ConversationMessageKind,
  ConversationSenderType,
  ConversationVisibility,
  CuuProactivity,
  DeliverableChange,
  DeliverableChangeManifest,
  DispatchPolicy,
  ExecutionHint,
  RiskLevel,
  TaskPlanItemRole,
  TaskPlanItemStatus,
  TaskPlanStatus,
  UserMemoryCategory,
  WorkHubLocale,
  WorkItemMode,
  WorkItemStatus
} from "@workhub/contracts";
import { DEFAULT_CUU_PROACTIVITY, taskPlanStatuses } from "@workhub/contracts";
import { sql } from "drizzle-orm";
import type { AnyPgColumn, PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  ForeignKeyBuilder,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

// R14 批 AVATAR：drizzle-orm 0.44 的 pg-core 没有内置 bytea 列类型（客户端 canvas 降采样出的头像
// 二进制直接落库，见 02-construction-plan「零对象存储」设计）。node-postgres 驱动对 bytea 列本就
// 原生收发 Buffer，这里只需要声明 SQL 类型字符串，不需要 toDriver/fromDriver 转换。
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  }
});

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];
type ObjectiveStatus = "active" | "paused" | "done" | "archived";
type KeyResultStatus = "active" | "done" | "at_risk" | "cancelled";
type ConversationParticipantRole = "owner" | "member";
// R14 批 CHAT：精选五键反应的 ASCII slug 集合（emoji 字形只在桌面渲染层映射，不入 schema/契约）。
type ConversationReactionKey = "approve" | "disagree" | "done" | "question" | "watch";
type ActionCardStatus = "active" | "superseded";
type ActionCardItemKind = "execute" | "decide" | "observe";
type ActionCardConfidence = "high" | "mid" | "low";
type ActionCardItemStatus = "running" | "done" | "undone" | "waiting_decision" | "dismissed" | "escalated";

// R13 批 P1.5（右栏变动文件区）：proposals.diff_stats_json 的持久化形状——agent-runner 在 workdir
// 仍存活时把 estimateDeliverableDiffStats 算出的聚合 + per-file 明细一起写进来（同一次计算的两个
// 视图，保证「产出卡系统消息」与「右栏变动文件」两条路径数字一致）。字段整体可空：历史行/未跑过
// 统计的行留 null，读侧诚实展示「改动详情不可用」而不是冒充 0（见 conversation-army.ts 的映射）。
export type ProposalDiffStatsFile = {
  change_id: string;
  path?: string;
  change_type: DeliverableChange["change_type"];
  // adds/dels 缺省即「这条改动没能计入统计」（新建/被删/非文本/超限等 fail-open 情形），不是 0。
  adds?: number;
  dels?: number;
};
export type ProposalDiffStats = {
  total: { adds: number; dels: number };
  files: ProposalDiffStatsFile[];
};

type DeferredForeignKeyConfig = {
  name?: string;
  columns: AnyPgColumn[];
  foreignColumns: AnyPgColumn[];
};

const deferredForeignKey = (reference: () => DeferredForeignKeyConfig) => new ForeignKeyBuilder(reference);

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
    // 团队就绪 must-have（通知偏好-按类型静音）：被静音的通知类型清单（jsonb 字符串数组）。
    // 空数组=不静音=既有行为逐字不变（DEFAULT-OFF 不变量）。通知创建路径命中此列则跳过、不建。
    mutedNotificationTypes: jsonb("muted_notification_types").$type<string[]>().notNull().default([]),
    // R14 批 AVATAR：用户自配头像。客户端裁剪+降采样到 256x256 再上传，服务端只做 magic bytes
    // 校验（webp/png/jpeg）+ 256KB 硬顶，不做图片处理、不引对象存储（开源自托管友好）。两列均可空——
    // 没头像时渲染层回退既有首字母色块 tile（不受影响）。avatarUpdatedAt 兼作 GET 端点的 ETag 源。
    avatarWebp: bytea("avatar_webp"),
    avatarUpdatedAt: timestampTz("avatar_updated_at"),
    deletedAt: timestampTz("deleted_at"),
    // R2 auth epic：记录是谁停用/离职了该账号（与 softDeleteColumns() 约定一致）。自引用 set null。
    deletedByUserId: uuid("deleted_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    ...timestamps()
  },
  (table) => [
    // M18：partial unique（WHERE deleted_at IS NULL），与其余 soft-delete 表一致——否则 soft-delete 后
    // 该昵称/cookie 被墓碑行永久占用，重新注册同名会撞死索引 500。
    uniqueIndex("users_nickname_uq").on(table.nickname).where(sql`${table.deletedAt} is null`),
    uniqueIndex("users_cookie_token_uq").on(table.cookieToken).where(sql`${table.deletedAt} is null`),
    index("users_is_admin_idx").on(table.isAdmin),
    index("users_deleted_at_idx").on(table.deletedAt)
  ]
);

// R2 auth epic（密码+会话基线，password-first）：以下两表是认证安全基础。纯 schema/迁移门，
// 首版不接线（中间件仍走 nickname cookieToken），引入会话与口令存储，为后续 AUTH_MODE 切换铺路。
// email 用 citext 列（迁移 CREATE EXTENSION citext）——drizzle 侧声明 varchar 即可：citext 与 text 兼容，
// eq() 生成的 `email = $1` 在 citext 列上天然大小写不敏感，免自定义类型 / 免 LOWER() 函数索引。
export const userCredentials = pgTable(
  "user_credentials",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    email: varchar("email", { length: 320 }).notNull(), // DB 列为 citext（大小写不敏感唯一）
    passwordHash: varchar("password_hash", { length: 256 }), // argon2id PHC 串；null=仅 OIDC/未设密码
    passwordAlgo: varchar("password_algo", { length: 32 }), // 例 "argon2id"，便于将来无停机轮换哈希算法
    emailVerifiedAt: timestampTz("email_verified_at"), // out-of-band：trust-on-first-use，可空
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestampTz("locked_until"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("user_credentials_user_id_uq").on(table.userId), // 每用户至多一份口令记录
    uniqueIndex("user_credentials_email_uq").on(table.email) // 登录用 email 查找；citext 唯一=大小写不敏感唯一
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(), // sha256(session secret)，不存明文
    authMethod: varchar("auth_method", { length: 16 }).notNull().default("password"), // password|oidc|nickname
    oidcProvider: varchar("oidc_provider", { length: 64 }), // OIDC 登录时记录 provider id（首版接 0 个）
    ipHash: varchar("ip_hash", { length: 128 }), // 可选审计：sha256(ip)
    userAgent: varchar("user_agent", { length: 256 }),
    absoluteExpiresAt: timestampTz("absolute_expires_at").notNull(), // 绝对过期（硬上限，到点强制重登）
    idleExpiresAt: timestampTz("idle_expires_at").notNull(), // 滑动过期（每次活动续期）
    lastSeenAt: timestampTz("last_seen_at"),
    revokedAt: timestampTz("revoked_at"), // 登出/停用置墓碑
    ...timestamps()
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId), // 按用户列会话 + 停用时批量 revoke
    // 过期清扫：仅扫未撤销行（partial index，墓碑行不进索引）。
    index("sessions_idle_expires_idx").on(table.idleExpiresAt).where(sql`${table.revokedAt} is null`)
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

// R2 多租户 epic Phase 1：用户↔工作区成员模型。今天租户隔离是惰性的（actor 租户写死 config 常量、
// 无成员模型），本表为「从成员关系派生 actor 租户」铺真实地基。纯加表、不接线（actor 仍走常量），
// 零运行时行为变化——只有当真实第二工作区+成员出现时，既有 scope 检查才开始区分。
export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull().default("member"), // member|admin|owner
    defaultWorkspace: boolean("default_workspace").notNull().default(false),
    deletedAt: timestampTz("deleted_at"),
    ...timestamps()
  },
  (table) => [
    // 每 (workspace,user) 至多一条 active 成员行（soft-delete 后可重新加入，不被墓碑永久占位）。
    uniqueIndex("workspace_memberships_ws_user_uq")
      .on(table.workspaceId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    // 每用户至多一个 default workspace（actor 租户解析的兜底锚点）。
    uniqueIndex("workspace_memberships_user_default_uq")
      .on(table.userId)
      .where(sql`${table.defaultWorkspace} and ${table.deletedAt} is null`),
    index("workspace_memberships_user_id_idx").on(table.userId),
    index("workspace_memberships_workspace_id_idx").on(table.workspaceId),
    index("workspace_memberships_deleted_at_idx").on(table.deletedAt)
  ]
);

// R2 auth epic（账号生命周期-邀请，out-of-band 链接，无 SMTP）：管理员建邀请→拿一次性链接手动分发；
// 收件人凭 token 接受→建账号 + 凭据 + 默认成员。token_hash=sha256(明文 token)，明文只回管理员一次。
// 纯加表、不接线（无路由），零行为变化——为邀请路由铺地基。
export const userInvites = pgTable(
  "user_invites",
  {
    id: id(),
    email: varchar("email", { length: 320 }).notNull(), // DB 列为 citext（大小写不敏感）
    tokenHash: varchar("token_hash", { length: 128 }).notNull(), // sha256(邀请 token)，不存明文
    invitedByUserId: uuid("invited_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    role: varchar("role", { length: 16 }).notNull().default("member"), // 接受后赋予的成员角色
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), // 加入的工作区（空=默认）
    expiresAt: timestampTz("expires_at").notNull(), // 邀请链接过期
    acceptedAt: timestampTz("accepted_at"), // 已接受墓碑（防重复使用）
    acceptedUserId: uuid("accepted_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    deletedAt: timestampTz("deleted_at"), // 管理员撤销邀请
    ...timestamps()
  },
  (table) => [
    uniqueIndex("user_invites_token_hash_uq").on(table.tokenHash),
    index("user_invites_email_idx").on(table.email),
    // 待接受邀请清单：未接受 ∧ 未撤销。
    index("user_invites_pending_idx")
      .on(table.email, table.expiresAt)
      .where(sql`${table.acceptedAt} is null and ${table.deletedAt} is null`)
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
    // R13 批 A2（派人推荐 v2）：这张表此前是零接线死表（无 repository/service/route/UI）。
    // 补的第一个真字段是 title（职位/角色头衔）——bioMd 已经承担"个人介绍"，确实缺的只有这个。
    title: varchar("title", { length: 128 }),
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
    // R13 批 S3（个人空间）：is_personal=true 的行是「owner_user_id 名下的个人空间」，语义上仍是一条
    // 普通 projects 行（主区/网盘/工单全链路零改动直接复用），只是团队级列表要按这一列过滤掉它、
    // 会话可见性也要收在 owner 一人（见 conversations.ts 的 isPersonal-aware 可见性条件）。
    isPersonal: boolean("is_personal").notNull().default(false),
    ...timestamps()
  },
  (table) => [
    // rank1：slug 唯一性按工作区隔离（非全局），杜绝 create-or-reuse-by-slug 的跨租户串号。见迁移 0028。
    uniqueIndex("projects_slug_uq").on(table.workspaceId, table.slug),
    uniqueIndex("projects_id_workspace_uq").on(table.id, table.workspaceId),
    index("projects_workspace_id_idx").on(table.workspaceId),
    index("projects_owner_user_id_idx").on(table.ownerUserId),
    index("projects_deleted_at_idx").on(table.deletedAt),
    // 「我的空间」列表查询用：按 owner 找他名下的个人空间。部分索引只覆盖 is_personal=true 的行，
    // 不占团队项目（多数行）的索引体积。
    index("projects_personal_owner_idx").on(table.ownerUserId).where(sql`${table.isPersonal}`)
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
    uniqueIndex("work_items_id_project_workspace_uq").on(table.id, table.projectId, table.workspaceId),
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

export const projectConversations = pgTable(
  "project_conversations",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).$type<ConversationKind>().notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    parentConversationId: uuid("parent_conversation_id").references(
      (): AnyPgColumn => projectConversations.id,
      { onDelete: "set null" }
    ),
    sourceMessageId: uuid("source_message_id").references(
      (): AnyPgColumn => conversationMessages.id,
      { onDelete: "set null" }
    ),
    visibility: varchar("visibility", { length: 16 }).$type<ConversationVisibility>().notNull(),
    nextSeq: bigint("next_seq", { mode: "number" }).notNull().default(0),
    // R13 批 G1（小群）：会话级「Cuu 是否参与」硬开关——不可被回话判定（现在的「被 @ 必回」/未来 4c 的
    // 轻量判定器）绕过；false 时 conversation-turns.ts 的 createTurn 在任何判定逻辑之前直接 409。
    // default true 保持所有既有会话（含存量 1:1 协同会话）的当前行为零回归。
    cuuEnabled: boolean("cuu_enabled").notNull().default(true),
    // R13 批 C1（会话上下文压缩）：滚动摘要——context_summary_md 是当前累积摘要正文（null=从未压缩过），
    // context_summary_through_seq 是摘要已经覆盖到的消息 seq（含）。apps/api/src/services/
    // conversation-turns.ts 的 createTurn 用这两列判断何时该刷新摘要、往 system prompt 里注入什么内容。
    // 与 cuuEnabled 同一个教训：conversationSelection 必须显式投影这两列，否则运行时读到的是 undefined。
    contextSummaryMd: text("context_summary_md"),
    contextSummaryThroughSeq: bigint("context_summary_through_seq", { mode: "number" }).notNull().default(0),
    // Legacy projects may not have an owner; new conversation creation must still populate this when known.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestampTz("deleted_at"),
    deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps()
  },
  (table): PgTableExtraConfigValue[] => [
    check("project_conversations_kind_ck", sql`${table.kind} in ('main', 'collab')`),
    check("project_conversations_visibility_ck", sql`${table.visibility} in ('project', 'private')`),
    check(
      "project_conversations_next_seq_ck",
      sql`${table.nextSeq} between 0 and 9007199254740991`
    ),
    check(
      "project_conversations_context_summary_through_seq_ck",
      sql`${table.contextSummaryThroughSeq} between 0 and 9007199254740991`
    ),
    check(
      "project_conversations_source_parent_ck",
      sql`${table.sourceMessageId} is null or ${table.parentConversationId} is not null`
    ),
    foreignKey({
      name: "project_conversations_project_workspace_fk",
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId]
    }),
    deferredForeignKey((): DeferredForeignKeyConfig => ({
      name: "project_conversations_parent_project_fk",
      columns: [table.parentConversationId, table.projectId],
      foreignColumns: [table.id, table.projectId]
    })),
    deferredForeignKey((): DeferredForeignKeyConfig => ({
      name: "project_conversations_source_message_parent_fk",
      columns: [table.parentConversationId, table.sourceMessageId],
      foreignColumns: [conversationMessages.conversationId, conversationMessages.id]
    })),
    uniqueIndex("project_conversations_active_main_uq")
      .on(table.projectId)
      .where(sql`${table.kind} = 'main' and ${table.deletedAt} is null`),
    index("project_conversations_workspace_project_idx").on(table.workspaceId, table.projectId),
    index("project_conversations_project_created_idx").on(table.projectId, table.createdAt),
    uniqueIndex("project_conversations_id_project_uq").on(table.id, table.projectId),
    uniqueIndex("project_conversations_id_project_workspace_uq").on(
      table.id,
      table.projectId,
      table.workspaceId
    ),
    uniqueIndex("project_conversations_id_workspace_uq").on(table.id, table.workspaceId),
    index("project_conversations_parent_id_idx").on(table.parentConversationId),
    index("project_conversations_source_message_id_idx").on(table.sourceMessageId),
    index("project_conversations_deleted_at_idx").on(table.deletedAt)
  ]
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references((): AnyPgColumn => projectConversations.id, {
      onDelete: "cascade"
    }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).$type<ConversationParticipantRole>().notNull(),
    ...timestamps()
  },
  (table) => [
    check("conversation_participants_role_ck", sql`${table.role} in ('owner', 'member')`),
    uniqueIndex("conversation_participants_conversation_user_uq").on(table.conversationId, table.userId),
    index("conversation_participants_user_id_idx").on(table.userId)
  ]
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references((): AnyPgColumn => projectConversations.id, {
      onDelete: "cascade"
    }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    senderType: varchar("sender_type", { length: 16 }).$type<ConversationSenderType>().notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 24 }).$type<ConversationMessageKind>().notNull(),
    contentJson: jsonb("content_json").$type<JsonObject>().notNull(),
    threadRootId: uuid("thread_root_id").references((): AnyPgColumn => conversationMessages.id, {
      onDelete: "set null"
    }),
    // R14 批 CHAT：编辑 / 墓碑删除 / 引用回复 / 置顶的持久化列，全部 nullable（append 语义不变）。
    // editedAt：编辑（仅本人、仅 text、15 分钟窗）后置位；服务端读侧渲染「已编辑」灰标。
    editedAt: timestampTz("edited_at"),
    // deletedAt/deletedByUserId：墓碑删除——content_json 清 {}、seq 不回收、不物理删；VM 层归一成
    // kind:'text' content:{text:''}。deletedByUserId 用户被删时 set null（审计边可断，墓碑本身不丢）。
    deletedAt: timestampTz("deleted_at"),
    deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // replyToMessageId：引用回复目标（同会话、仅 text 新消息可带）。只挂下面的复合外键保「同会话」，
    // 刻意不挂 users 那种 set null 单列外键——目标事后被删只是变墓碑，引用边要保住（读时 join 判墓碑）。
    replyToMessageId: uuid("reply_to_message_id"),
    // pinnedAt/pinnedByUserId：置顶（会话可见者皆可）；pinnedByUserId 同 deletedByUserId set null 语义。
    pinnedAt: timestampTz("pinned_at"),
    pinnedByUserId: uuid("pinned_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt()
  },
  (table): PgTableExtraConfigValue[] => [
    check("conversation_messages_seq_ck", sql`${table.seq} between 0 and 9007199254740991`),
    check("conversation_messages_sender_type_ck", sql`${table.senderType} in ('user', 'cuu', 'system')`),
    check(
      "conversation_messages_kind_ck",
      sql`${table.kind} in ('text', 'file_card', 'action_card', 'system_event', 'tool_note')`
    ),
    deferredForeignKey((): DeferredForeignKeyConfig => ({
      name: "conversation_messages_thread_root_conversation_fk",
      columns: [table.conversationId, table.threadRootId],
      foreignColumns: [table.conversationId, table.id]
    })),
    // R14 批 CHAT：引用回复的同会话保证——照 thread_root 同款复合外键（(conversation_id, reply_to)
    // -> (conversation_id, id)）。无 onDelete（NO ACTION）：消息只软删不物理删，引用边永远指得到那条
    // 墓碑，读时 join 判 deleted_at 决定引用块是否显示「原消息已删除」。
    deferredForeignKey((): DeferredForeignKeyConfig => ({
      name: "conversation_messages_reply_to_conversation_fk",
      columns: [table.conversationId, table.replyToMessageId],
      foreignColumns: [table.conversationId, table.id]
    })),
    uniqueIndex("conversation_messages_conversation_seq_uq").on(table.conversationId, table.seq),
    uniqueIndex("conversation_messages_conversation_id_uq").on(table.conversationId, table.id),
    index("conversation_messages_cursor_idx").on(table.conversationId, table.seq),
    index("conversation_messages_sender_user_id_idx").on(table.senderUserId),
    index("conversation_messages_thread_root_id_idx").on(table.threadRootId),
    // R14 批 CHAT：置顶清单读取端点走这条（(conversation_id, seq) 降序 cap 50），部分索引只覆盖
    // 真正置顶的少数行，不给普通消息付索引成本。
    index("conversation_messages_pinned_idx")
      .on(table.conversationId, table.seq)
      .where(sql`${table.pinnedAt} is not null`)
  ]
);

// R14 批 CHAT：精选五键 emoji 反应。存储/契约层全程 ASCII slug（approve/disagree/done/question/watch），
// emoji 字形只存在于桌面渲染层的映射表——本表不出现任何 emoji 字符。conversationId 是冗余列，配合下面
// 的 (conversation_id, message_id) 复合外键保「反应与目标消息同会话」，也便于按会话批量清理/校验。
// unique(message_id, user_id, reaction_key) 兜底幂等：一人对同一条消息的同一个键至多一条。
export const messageReactions = pgTable(
  "message_reactions",
  {
    id: id(),
    messageId: uuid("message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reactionKey: varchar("reaction_key", { length: 24 }).$type<ConversationReactionKey>().notNull(),
    createdAt: createdAt()
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "message_reactions_reaction_key_ck",
      sql`${table.reactionKey} in ('approve', 'disagree', 'done', 'question', 'watch')`
    ),
    foreignKey({
      name: "message_reactions_conversation_message_fk",
      columns: [table.conversationId, table.messageId],
      foreignColumns: [conversationMessages.conversationId, conversationMessages.id]
    }).onDelete("cascade"),
    uniqueIndex("message_reactions_message_user_key_uq").on(
      table.messageId,
      table.userId,
      table.reactionKey
    ),
    index("message_reactions_message_id_idx").on(table.messageId)
  ]
);

// R14 批 CHAT：已读游标。刻意不动 conversation_participants（main 会话无参与者行、小群参与者语义纠缠），
// 单开一张表。last_read_seq 单调推进（服务端夹紧，收到更小值静默返回当前值，不得超过会话当前最大 seq），
// 聚合式「已读 N/M」+ 未读分割线共用这一份游标（砍展示零成本）。unique(conversation_id, user_id)。
export const conversationReadCursors = pgTable(
  "conversation_read_cursors",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => projectConversations.id, {
      onDelete: "cascade"
    }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    updatedAt: updatedAt()
  },
  (table): PgTableExtraConfigValue[] => [
    check("conversation_read_cursors_last_read_seq_ck", sql`${table.lastReadSeq} >= 0`),
    uniqueIndex("conversation_read_cursors_conversation_user_uq").on(table.conversationId, table.userId)
  ]
);

export const actionCards = pgTable(
  "action_cards",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => projectConversations.id, {
      onDelete: "cascade"
    }),
    messageId: uuid("message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).$type<ActionCardStatus>().notNull().default("active"),
    analyzedToSeq: bigint("analyzed_to_seq", { mode: "number" }).notNull(),
    ...timestamps()
  },
  (table) => [
    check("action_cards_status_ck", sql`${table.status} in ('active', 'superseded')`),
    check("action_cards_analyzed_to_seq_ck", sql`${table.analyzedToSeq} between 0 and 9007199254740991`),
    foreignKey({
      name: "action_cards_conversation_message_fk",
      columns: [table.conversationId, table.messageId],
      foreignColumns: [conversationMessages.conversationId, conversationMessages.id]
    }),
    index("action_cards_conversation_status_idx").on(table.conversationId, table.status),
    uniqueIndex("action_cards_message_id_uq").on(table.messageId),
    uniqueIndex("action_cards_conversation_id_uq").on(table.conversationId, table.id)
  ]
);

export const actionCardItems = pgTable(
  "action_card_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    actionCardId: uuid("action_card_id").notNull().references(() => actionCards.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    kind: varchar("kind", { length: 16 }).$type<ActionCardItemKind>().notNull(),
    titleMd: text("title_md").notNull(),
    confidence: varchar("confidence", { length: 16 }).$type<ActionCardConfidence>().notNull(),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    runId: uuid("run_id").references((): AnyPgColumn => agentRuns.id, { onDelete: "set null" }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 24 }).$type<ActionCardItemStatus>().notNull(),
    undoDeadlineAt: timestampTz("undo_deadline_at"),
    ...timestamps()
  },
  (table): PgTableExtraConfigValue[] => [
    check("action_card_items_ordinal_ck", sql`${table.ordinal} >= 0`),
    check("action_card_items_kind_ck", sql`${table.kind} in ('execute', 'decide', 'observe')`),
    check("action_card_items_confidence_ck", sql`${table.confidence} in ('high', 'mid', 'low')`),
    check(
      "action_card_items_status_ck",
      sql`${table.status} in ('running', 'done', 'undone', 'waiting_decision', 'dismissed', 'escalated')`
    ),
    check(
      "action_card_items_run_requires_work_item_ck",
      sql`${table.runId} is null or ${table.workItemId} is not null`
    ),
    foreignKey({
      name: "action_card_items_conversation_scope_fk",
      columns: [table.conversationId, table.projectId, table.workspaceId],
      foreignColumns: [projectConversations.id, projectConversations.projectId, projectConversations.workspaceId]
    }),
    foreignKey({
      name: "action_card_items_action_card_conversation_fk",
      columns: [table.conversationId, table.actionCardId],
      foreignColumns: [actionCards.conversationId, actionCards.id]
    }),
    foreignKey({
      name: "action_card_items_work_item_scope_fk",
      columns: [table.workItemId, table.projectId, table.workspaceId],
      foreignColumns: [workItems.id, workItems.projectId, workItems.workspaceId]
    }),
    deferredForeignKey((): DeferredForeignKeyConfig => ({
      name: "action_card_items_run_scope_fk",
      columns: [table.runId, table.workItemId, table.workspaceId],
      foreignColumns: [agentRuns.id, agentRuns.workItemId, agentRuns.workspaceId]
    })),
    uniqueIndex("action_card_items_card_ordinal_uq").on(table.actionCardId, table.ordinal),
    uniqueIndex("action_card_items_id_conversation_workspace_uq").on(
      table.id,
      table.conversationId,
      table.workspaceId
    ),
    index("action_card_items_scope_idx").on(table.workspaceId, table.projectId, table.conversationId),
    index("action_card_items_work_item_id_idx").on(table.workItemId),
    index("action_card_items_run_id_idx").on(table.runId),
    index("action_card_items_assignee_status_idx").on(table.assigneeUserId, table.status)
  ]
);

export const conversationObserverState = pgTable(
  "conversation_observer_state",
  {
    conversationId: uuid("conversation_id").primaryKey().references(() => projectConversations.id, {
      onDelete: "cascade"
    }),
    lastAnalyzedSeq: bigint("last_analyzed_seq", { mode: "number" }).notNull().default(0),
    activeCardId: uuid("active_card_id").references(() => actionCards.id, { onDelete: "set null" }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    updatedAt: updatedAt()
  },
  (table) => [
    check(
      "conversation_observer_state_last_seq_ck",
      sql`${table.lastAnalyzedSeq} between 0 and 9007199254740991`
    ),
    check("conversation_observer_state_failures_ck", sql`${table.consecutiveFailures} >= 0`),
    foreignKey({
      name: "conversation_observer_state_active_card_conversation_fk",
      columns: [table.conversationId, table.activeCardId],
      foreignColumns: [actionCards.conversationId, actionCards.id]
    }),
    index("conversation_observer_state_active_card_id_idx").on(table.activeCardId)
  ]
);

export const userAiProfiles = pgTable(
  "user_ai_profiles",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    defaultMode: smallint("default_mode").$type<AiMode>().notNull().default(3),
    granularJson: jsonb("granular_json").$type<JsonObject>().notNull().default({}),
    dispatchPolicy: varchar("dispatch_policy", { length: 16 }).$type<DispatchPolicy>().notNull().default("auto"),
    cuuProactivity: varchar("cuu_proactivity", { length: 32 })
      .$type<CuuProactivity>()
      .notNull()
      .default(DEFAULT_CUU_PROACTIVITY),
    modelTierPref: varchar("model_tier_pref", { length: 32 }),
    ...timestamps()
  },
  (table) => [
    check("user_ai_profiles_default_mode_ck", sql`${table.defaultMode} between 1 and 5`),
    check("user_ai_profiles_dispatch_policy_ck", sql`${table.dispatchPolicy} in ('auto', 'ask', 'manual')`),
    check(
      "user_ai_profiles_cuu_proactivity_ck",
      sql`${table.cuuProactivity} in ('quiet', 'balanced', 'proactive')`
    ),
    uniqueIndex("user_ai_profiles_workspace_user_uq").on(table.workspaceId, table.userId),
    index("user_ai_profiles_user_id_idx").on(table.userId)
  ]
);

export const projectAiGovernance = pgTable(
  "project_ai_governance",
  {
    projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
    observerEnabled: boolean("observer_enabled").notNull().default(true),
    silenceWindowSecs: integer("silence_window_secs").notNull().default(60),
    quietHoursJson: jsonb("quiet_hours_json").$type<JsonObject>().notNull().default({ enabled: false }),
    granularJson: jsonb("granular_json").$type<JsonObject>().notNull().default({}),
    // R14 批 RISK（迁移 0059）：风险巡检阈值（停滞天数/deadline 前瞻窗口/成本放量比例与下限）——
    // 读侧用 DEFAULT_RISK_MONITOR_SETTINGS 做默认合并，语义与 granular_json 平行但不同（阈值而非布尔
    // 开关集），不合并进同一列。
    riskMonitorJson: jsonb("risk_monitor_json").$type<JsonObject>().notNull().default({}),
    ...timestamps()
  },
  (table) => [
    check("project_ai_governance_silence_window_ck", sql`${table.silenceWindowSecs} >= 0`)
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
    // L#56：listForUser 的热路径是 WHERE user_id ORDER BY created_at DESC LIMIT n —— 加复合索引避免按 user 过滤后再全量排序。
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
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

// W2：审批工作台「相关讨论」评论流。克隆自 project_drive_comments 的写法。
export const approvalComments = pgTable(
  "approval_comments",
  {
    id: id(),
    approvalId: uuid("approval_id").notNull().references((): AnyPgColumn => approvalRequests.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    authorNickname: varchar("author_nickname", { length: 64 }).notNull(),
    body: text("body").notNull(),
    ...timestamps()
  },
  (table) => [
    index("approval_comments_approval_created_idx").on(table.approvalId, table.createdAt),
    index("approval_comments_author_user_id_idx").on(table.authorUserId)
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

export const objectives = pgTable(
  "objectives",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).notNull(),
    descriptionMd: text("description_md"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 16 }).$type<ObjectiveStatus>().notNull().default("active"),
    progressPercent: integer("progress_percent").notNull().default(0),
    progressUpdatedAt: timestampTz("progress_updated_at"),
    ...timestamps()
  },
  (table) => [
    index("objectives_workspace_status_idx").on(table.workspaceId, table.status),
    index("objectives_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    index("objectives_owner_user_id_idx").on(table.ownerUserId)
  ]
);

export const keyResults = pgTable(
  "key_results",
  {
    id: id(),
    objectiveId: uuid("objective_id").notNull().references(() => objectives.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    targetValue: numeric("target_value", { precision: 14, scale: 4 }),
    currentValue: numeric("current_value", { precision: 14, scale: 4 }),
    unit: varchar("unit", { length: 32 }),
    status: varchar("status", { length: 16 }).$type<KeyResultStatus>().notNull().default("active"),
    progressPercent: integer("progress_percent").notNull().default(0),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("key_results_objective_seq_uq").on(table.objectiveId, table.seq),
    index("key_results_workspace_objective_idx").on(table.workspaceId, table.objectiveId),
    index("key_results_workspace_status_idx").on(table.workspaceId, table.status)
  ]
);

export const objectiveWorkItemLinks = pgTable(
  "objective_work_item_links",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    objectiveId: uuid("objective_id").notNull().references(() => objectives.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    linkedByUserId: uuid("linked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("objective_work_item_links_objective_work_item_uq").on(table.objectiveId, table.workItemId),
    index("objective_work_item_links_workspace_objective_idx").on(table.workspaceId, table.objectiveId),
    index("objective_work_item_links_workspace_work_item_idx").on(table.workspaceId, table.workItemId),
    index("objective_work_item_links_linked_by_user_id_idx").on(table.linkedByUserId)
  ]
);

export const taskPlans = pgTable(
  "task_plans",
  {
    id: id(),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).$type<TaskPlanStatus>().notNull().default("draft"),
    objectiveId: uuid("objective_id").references(() => objectives.id, { onDelete: "set null" }),
    budgetJson: jsonb("budget_json").$type<JsonObject>().notNull().default({}),
    decompositionContextJson: jsonb("decomposition_context_json").$type<JsonObject>().notNull().default({}),
    createdByUserId: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    ...timestamps()
  },
  (table) => [
    index("task_plans_work_item_id_idx").on(table.workItemId),
    index("task_plans_workspace_status_idx").on(table.workspaceId, table.status),
    index("task_plans_work_item_status_idx").on(table.workItemId, table.status),
    index("task_plans_created_by_idx").on(table.createdByUserId),
    index("task_plans_created_at_idx").on(table.createdAt),
    check(
      "task_plans_status_ck",
      sql`${table.status} in (${sql.raw(taskPlanStatuses.map((status) => `'${status}'`).join(", "))})`
    )
  ]
);

export const taskPlanItems = pgTable(
  "task_plan_items",
  {
    id: id(),
    planId: uuid("plan_id").notNull().references(() => taskPlans.id, { onDelete: "cascade" }),
    parentItemId: uuid("parent_item_id").references((): AnyPgColumn => taskPlanItems.id, { onDelete: "set null" }),
    seq: integer("seq").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    role: varchar("role", { length: 16 }).$type<TaskPlanItemRole>().notNull(),
    objectiveMd: text("objective_md").notNull(),
    acceptanceMd: text("acceptance_md").notNull(),
    budgetSharePct: integer("budget_share_pct").notNull(),
    dependsOn: uuid("depends_on").array().$type<string[]>().notNull().default(sql`'{}'::uuid[]`),
    status: varchar("status", { length: 16 }).$type<TaskPlanItemStatus>().notNull().default("pending"),
    // B-R9.2-3：派发代际——每次 markItemDispatched +1；结算与恢复只认同代 run。
    dispatchEpoch: integer("dispatch_epoch").notNull().default(0),
    ...timestamps()
  },
  (table) => [
    index("task_plan_items_plan_seq_idx").on(table.planId, table.seq),
    index("task_plan_items_parent_item_id_idx").on(table.parentItemId),
    index("task_plan_items_status_idx").on(table.status),
    index("task_plan_items_role_idx").on(table.role)
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
    kind: varchar("kind", { length: 64 }).notNull(),
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
    // R13 批 P1.5：nullable——历史行/未跑过统计的允许为 null，读侧不得冒充 0（见类型定义处注释）。
    diffStatsJson: jsonb("diff_stats_json").$type<ProposalDiffStats>(),
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
    // M19：纵深防护——「每 (project,target) 至多一个未被取代的 current 版本」这条 P-COLLAB 丢失更新不变量
    // 此前只靠应用层 advisory lock + L3 重核守住。加 partial unique，万一某写路径漏锁（如 projectId 为空跳过
    // 项目级锁、或新摄取/回填），DB 直接拒第二个并发 current 行。项目态 + 遗留 null-project 两条各管一段。
    uniqueIndex("accepted_deliverable_changes_project_current_uq")
      .on(table.projectId, table.targetKey)
      .where(sql`${table.supersededAt} is null and ${table.projectId} is not null`),
    uniqueIndex("accepted_deliverable_changes_workitem_current_uq")
      .on(table.workItemId, table.targetKey)
      .where(sql`${table.supersededAt} is null and ${table.projectId} is null`),
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
    parentRunId: uuid("parent_run_id").references((): AnyPgColumn => agentRuns.id, { onDelete: "set null" }),
    taskPlanId: uuid("task_plan_id").references(() => taskPlans.id, { onDelete: "set null" }),
    taskPlanItemId: uuid("task_plan_item_id").references(() => taskPlanItems.id, { onDelete: "set null" }),
    objectiveId: uuid("objective_id").references(() => objectives.id, { onDelete: "set null" }),
    agentRole: varchar("agent_role", { length: 16 }).$type<TaskPlanItemRole>(),
    taskPlanItemEpoch: integer("task_plan_item_epoch"),
    objectiveMd: text("objective_md"),
    mode: varchar("mode", { length: 16 }).$type<WorkItemMode>().notNull(),
    actor: varchar("actor", { length: 32 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 256 }).notNull().default("AI worker run"),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    // L#61：与 usage_records / cost_ledger_entries 的 model(128) 对齐。
    model: varchar("model", { length: 128 }).notNull(),
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
    executionHint: varchar("execution_hint", { length: 16 }).$type<ExecutionHint>().notNull().default("server"),
    sourceConversationId: uuid("source_conversation_id").references(() => projectConversations.id, {
      onDelete: "set null"
    }),
    sourceActionCardItemId: uuid("source_action_card_item_id").references(
      (): AnyPgColumn => actionCardItems.id,
      { onDelete: "set null" }
    ),
    // 因租约过期被恢复(requeue)的累计次数；超过 maxRecoverAttempts 即转死信 failed，不再无限重跑。
    recoverAttempts: integer("recover_attempts").notNull().default(0),
    startedAt: timestampTz("started_at"),
    finishedAt: timestampTz("finished_at"),
    ...timestamps()
  },
  (table) => [
    check("agent_runs_execution_hint_ck", sql`${table.executionHint} in ('server', 'local', 'any')`),
    check(
      "agent_runs_source_conversation_workspace_ck",
      sql`${table.sourceConversationId} is null or ${table.workspaceId} is not null`
    ),
    check(
      "agent_runs_source_action_item_conversation_ck",
      sql`${table.sourceActionCardItemId} is null or ${table.sourceConversationId} is not null`
    ),
    foreignKey({
      name: "agent_runs_source_conversation_workspace_fk",
      columns: [table.sourceConversationId, table.workspaceId],
      foreignColumns: [projectConversations.id, projectConversations.workspaceId]
    }),
    foreignKey({
      name: "agent_runs_source_action_item_conversation_fk",
      columns: [table.sourceActionCardItemId, table.sourceConversationId, table.workspaceId],
      foreignColumns: [actionCardItems.id, actionCardItems.conversationId, actionCardItems.workspaceId]
    }),
    index("agent_runs_org_id_idx").on(table.orgId),
    index("agent_runs_workspace_id_idx").on(table.workspaceId),
    index("agent_runs_work_item_id_idx").on(table.workItemId),
    index("agent_runs_branch_id_idx").on(table.branchId),
    index("agent_runs_parent_run_id_idx").on(table.parentRunId),
    index("agent_runs_task_plan_id_idx").on(table.taskPlanId),
    index("agent_runs_task_plan_item_id_idx").on(table.taskPlanItemId),
    index("agent_runs_objective_id_idx").on(table.objectiveId),
    index("agent_runs_actor_user_id_idx").on(table.actorUserId),
    index("agent_runs_status_idx").on(table.status),
    uniqueIndex("agent_runs_work_item_active_uq")
      .on(table.workItemId)
      .where(sql`${table.status} in ('queued', 'running') and ${table.taskPlanItemId} is null`),
    uniqueIndex("agent_runs_task_plan_item_active_uq")
      .on(table.taskPlanItemId)
      .where(sql`${table.status} in ('queued', 'running') and ${table.taskPlanItemId} is not null`),
    index("agent_runs_claim_idx").on(table.status, table.leaseExpiresAt, table.createdAt),
    index("agent_runs_claimed_by_idx").on(table.claimedBy),
    index("agent_runs_execution_claim_idx").on(
      table.executionHint,
      table.status,
      table.leaseExpiresAt,
      table.createdAt
    ),
    index("agent_runs_source_conversation_id_idx").on(table.sourceConversationId),
    index("agent_runs_source_action_card_item_id_idx").on(table.sourceActionCardItemId),
    uniqueIndex("agent_runs_id_work_item_workspace_uq").on(table.id, table.workItemId, table.workspaceId)
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
    taskPlanId: uuid("task_plan_id").references(() => taskPlans.id, { onDelete: "set null" }),
    objectiveId: uuid("objective_id").references(() => objectives.id, { onDelete: "set null" }),
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
    index("usage_records_task_plan_id_idx").on(table.taskPlanId),
    index("usage_records_objective_id_idx").on(table.objectiveId),
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
    taskPlanId: uuid("task_plan_id").references(() => taskPlans.id, { onDelete: "set null" }),
    objectiveId: uuid("objective_id").references(() => objectives.id, { onDelete: "set null" }),
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
    index("cost_ledger_entries_task_plan_id_idx").on(table.taskPlanId),
    index("cost_ledger_entries_objective_id_idx").on(table.objectiveId),
    index("cost_ledger_entries_user_id_idx").on(table.userId),
    index("cost_ledger_entries_team_id_idx").on(table.teamId),
    index("cost_ledger_entries_scope_idx").on(table.scopeKind, table.scopeId),
    index("cost_ledger_entries_period_bucket_idx").on(table.periodBucket),
    index("cost_ledger_entries_created_at_idx").on(table.createdAt)
  ]
);

// R2 epic(原子预算)：IN-FLIGHT（已授权未结算）预留的唯一真相源；cost_ledger_entries 仍是 SETTLED 真相源。
// 并发起跑要满足 committed(ledger) + reserved_outstanding(本表 active 行 est-actual) + 本 run 估算 <= cap。
// scope 列与 cost_ledger_entries 对齐，复用同一 scope helper 与 period_bucket 键。
export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: id(),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "cascade" }).notNull(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    scopeKind: varchar("scope_kind", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 128 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    periodBucket: varchar("period_bucket", { length: 16 }).notNull(),
    estTokens: integer("est_tokens").notNull().default(0),
    estCostCny: numeric("est_cost_cny", { precision: 12, scale: 6 }).notNull().default("0"),
    actualTokens: integer("actual_tokens").notNull().default(0),
    actualCostCny: numeric("actual_cost_cny", { precision: 12, scale: 6 }).notNull().default("0"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    leaseExpiresAt: timestampTz("lease_expires_at"),
    ...timestamps()
  },
  (table) => [
    // 每 run 每 (scope,bucket) 至多一条 active 预留 → reserve 在重试下幂等（onConflictDoNothing）。
    uniqueIndex("budget_reservations_run_scope_active_uq")
      .on(table.runId, table.scopeKind, table.scopeId, table.periodBucket)
      .where(sql`${table.status} = 'active'`),
    // outstanding SUM(est-actual) 读取按 (scope,bucket) 索引，不扫 settled/expired 行。
    index("budget_reservations_scope_bucket_active_idx")
      .on(table.workspaceId, table.scopeKind, table.scopeId, table.periodBucket)
      .where(sql`${table.status} = 'active'`),
    // 租约过期清扫。
    index("budget_reservations_lease_idx")
      .on(table.status, table.leaseExpiresAt)
      .where(sql`${table.status} = 'active'`),
    index("budget_reservations_run_id_idx").on(table.runId)
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
    ref: varchar("ref", { length: 1024 }).notNull(),
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
// R9.3.3：workspace_id 已参与 L2 key；旧全局记忆保留为 workspace_id IS NULL 的 fallback。
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
    // R14 批 MEM（迁移 0056）：人工 PATCH 编辑正文的留痕。AI/夜间晋升写入的记忆此二列恒为 NULL——
    // 诚实区分「AI 学到的」与「人改过的」；出处展示据此叠加「最近由你于 X 修改」一行（见 03-mem-design §2.3）。
    editedByUserId: uuid("edited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    editedAt: timestampTz("edited_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("user_memories_workspace_key_uq")
      .on(table.userId, table.workspaceId, table.category, table.key)
      .where(sql`${table.deletedAt} is null and ${table.workspaceId} is not null`),
    uniqueIndex("user_memories_global_key_uq")
      .on(table.userId, table.category, table.key)
      .where(sql`${table.deletedAt} is null and ${table.workspaceId} is null`),
    index("user_memories_user_id_idx").on(table.userId),
    index("user_memories_workspace_id_idx").on(table.workspaceId),
    index("user_memories_category_idx").on(table.category),
    index("user_memories_confidence_idx").on(table.confidence),
    index("user_memories_last_used_at_idx").on(table.lastUsedAt),
    index("user_memories_expires_at_idx").on(table.expiresAt),
    index("user_memories_deleted_at_idx").on(table.deletedAt)
  ]
);

export const agentMemory = pgTable(
  "agent_memory",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    // R9.3 L1: this is intentionally a task_plan_items.id, not a generic context id.
    agentContextId: uuid("agent_context_id").notNull().references(() => taskPlanItems.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 32 }).$type<UserMemoryCategory>().notNull(),
    key: varchar("key", { length: 256 }).notNull(),
    valueMd: text("value_md").notNull(),
    confidence: doublePrecision("confidence").notNull().default(0.5),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    baseVersion: integer("base_version").notNull().default(0),
    currentVersion: integer("current_version").notNull().default(1),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("agent_memory_context_key_uq").on(table.workspaceId, table.agentContextId, table.category, table.key),
    index("agent_memory_workspace_context_idx").on(table.workspaceId, table.agentContextId),
    index("agent_memory_source_run_id_idx").on(table.sourceRunId),
    index("agent_memory_confidence_idx").on(table.confidence),
    index("agent_memory_updated_at_idx").on(table.updatedAt)
  ]
);

export const agentMemoryVersions = pgTable(
  "agent_memory_versions",
  {
    id: id(),
    memoryId: uuid("memory_id").notNull().references(() => agentMemory.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    baseVersion: integer("base_version").notNull().default(0),
    valueMd: text("value_md").notNull(),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("agent_memory_versions_memory_version_uq").on(table.memoryId, table.version),
    index("agent_memory_versions_memory_id_idx").on(table.memoryId),
    index("agent_memory_versions_source_run_id_idx").on(table.sourceRunId),
    index("agent_memory_versions_created_at_idx").on(table.createdAt)
  ]
);

export const memoryConflicts = pgTable(
  "memory_conflicts",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    category: varchar("category", { length: 32 }).$type<UserMemoryCategory>().notNull(),
    key: varchar("key", { length: 256 }).notNull(),
    currentValueMd: text("current_value_md").notNull(),
    incomingValueMd: text("incoming_value_md").notNull(),
    baseValueMd: text("base_value_md"),
    candidateMemoryIds: jsonb("candidate_memory_ids").$type<string[]>().notNull().default([]),
    status: varchar("status", { length: 16 }).$type<"open" | "resolved">().notNull().default("open"),
    resolution: varchar("resolution", { length: 32 }).$type<"keep_current" | "accept_incoming" | "merge_both" | "edit_memory" | "discard_both">(),
    resolvedValueMd: text("resolved_value_md"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestampTz("resolved_at"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("memory_conflicts_open_user_key_uq")
      .on(table.workspaceId, table.userId, table.category, table.key)
      .where(sql`${table.status} = 'open'`),
    index("memory_conflicts_workspace_user_status_idx").on(table.workspaceId, table.userId, table.status),
    index("memory_conflicts_source_run_id_idx").on(table.sourceRunId),
    index("memory_conflicts_created_at_idx").on(table.createdAt)
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
  agentMemory,
  agentMemoryVersions,
  memoryConflicts,
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
  projectConversations,
  conversationParticipants,
  conversationMessages,
  messageReactions,
  conversationReadCursors,
  actionCards,
  actionCardItems,
  conversationObserverState,
  userAiProfiles,
  projectAiGovernance,
  workItemAssignments,
  workItemWorkspaces,
  workItemWorkspaceItems,
  workItemProgressUpdates,
  objectives,
  keyResults,
  objectiveWorkItemLinks,
  taskPlans,
  taskPlanItems,
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
  approvalComments,
  auditLogs
} as const;

export type WorkHubTableName = keyof typeof workHubTables;
