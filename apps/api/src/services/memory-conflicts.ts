import {
  createMemoryConflictRepository,
  createUserMemoryRepository,
  getSharedDatabaseClient,
  type MemoryConflictRepository,
  type MemoryConflictResolution,
  type MemoryConflictRow,
  type UserMemoryRepository
} from "@workhub/db";
import type { AttentionItem, WorkHubLocale } from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";

export class MemoryConflictServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "MemoryConflictServiceError";
  }
}

export type MemoryConflictService = ReturnType<typeof createMemoryConflictService>;

export type MemoryConflictServiceDependencies = {
  conflicts?: MemoryConflictRepository;
  userMemories?: Pick<UserMemoryRepository, "upsert">;
  now?: () => Date;
};

type ResolveMemoryConflictInput = {
  actor: AuthActor;
  conflictId: string;
  resolution: MemoryConflictResolution;
  valueMd?: string;
  expectedUpdatedAt?: Date;
};

type MemoryConflictDecisionStores = {
  conflicts: Pick<MemoryConflictRepository, "findOpenForUser" | "resolve">;
  userMemories: Pick<UserMemoryRepository, "upsert">;
};

function userIdFor(actor: AuthActor) {
  return actor.userId ?? actor.id;
}

function categoryLabel(category: MemoryConflictRow["category"], locale: WorkHubLocale) {
  if (locale === "en-US") {
    return category === "preference" ? "Preference" : category === "correction" ? "Correction" : "Recurring context";
  }
  return category === "preference" ? "偏好" : category === "correction" ? "纠正" : "常用上下文";
}

function action(
  id: AttentionItem["actions"][number]["id"],
  label: string,
  style: AttentionItem["actions"][number]["style"],
  method: AttentionItem["actions"][number]["method"],
  href: string
): AttentionItem["actions"][number] {
  return { id, label, style, method, href };
}

function resolveHref(row: MemoryConflictRow, resolution: MemoryConflictResolution) {
  return `/api/memory-conflicts/${row.id}/resolve/${resolution}`;
}

export function buildMemoryConflictAttentionItem(row: MemoryConflictRow, locale: WorkHubLocale): AttentionItem {
  const zh = locale !== "en-US";
  const label = categoryLabel(row.category, locale);
  return {
    id: row.id,
    kind: "sync_conflict",
    priority: "high",
    source_ref: row.sourceRunId
      ? { entity_type: "agent_run", entity_id: row.sourceRunId }
      : { entity_type: "notification", entity_id: row.id },
    title: zh ? "Cuu 学到了两条打架的偏好" : "Cuu found conflicting memory",
    summary_text: zh
      ? `${label}「${row.key}」出现两种说法，需要确认后再晋升。`
      : `${label} "${row.key}" has conflicting values and needs your decision.`,
    reason_text: zh
      ? `A：${row.currentValueMd}\nB：${row.incomingValueMd}`
      : `A: ${row.currentValueMd}\nB: ${row.incomingValueMd}`,
    actions: [
      action("keep_current", zh ? "要 A" : "Keep A", "secondary", "POST", resolveHref(row, "keep_current")),
      action("accept_incoming", zh ? "要 B" : "Use B", "primary", "POST", resolveHref(row, "accept_incoming")),
      action("discard_both", zh ? "都不要" : "Discard both", "danger", "POST", resolveHref(row, "discard_both")),
      action("edit_memory", zh ? "合并成一条" : "Edit memory", "secondary", "POST", resolveHref(row, "edit_memory"))
    ],
    cuu_state: "worried",
    created_at: row.createdAt.toISOString()
  };
}

function resolvedValue(row: MemoryConflictRow, resolution: MemoryConflictResolution, override?: string) {
  switch (resolution) {
    case "keep_current":
      return row.currentValueMd;
    case "accept_incoming":
      return row.incomingValueMd;
    case "discard_both":
      return undefined;
    case "edit_memory": {
      const edited = override?.trim();
      if (!edited) {
        throw new MemoryConflictServiceError(422, "memory_conflict_value_required", "合并成一条记忆时必须提交编辑后的内容。");
      }
      return edited;
    }
  }
}

function publicResolutionResult(row: MemoryConflictRow) {
  return {
    id: row.id,
    status: row.status,
    resolution: row.resolution,
    resolved_value_md: row.resolvedValueMd
  };
}

let defaultRepository: MemoryConflictRepository | undefined;
let defaultUserMemoryRepository: Pick<UserMemoryRepository, "upsert"> | undefined;

function getDefaultMemoryConflictRepository() {
  defaultRepository = defaultRepository ?? createMemoryConflictRepository(getSharedDatabaseClient().db);
  return defaultRepository;
}

function getDefaultUserMemoryRepository() {
  defaultUserMemoryRepository = defaultUserMemoryRepository ?? createUserMemoryRepository(getSharedDatabaseClient().db);
  return defaultUserMemoryRepository;
}

async function resolveWithStores(
  stores: MemoryConflictDecisionStores,
  input: ResolveMemoryConflictInput,
  resolvedAt: Date
) {
  const userId = userIdFor(input.actor);
  const row = await stores.conflicts.findOpenForUser({
    workspaceId: input.actor.workspaceId,
    userId,
    conflictId: input.conflictId
  });
  if (!row) {
    throw new MemoryConflictServiceError(404, "memory_conflict_not_found", "这张记忆冲突卡不存在或已经处理。");
  }
  if (input.expectedUpdatedAt && row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    throw new MemoryConflictServiceError(409, "memory_conflict_status_changed", "这张记忆冲突卡已经更新，请刷新。");
  }

  const valueMd = resolvedValue(row, input.resolution, input.valueMd);
  const resolved = await stores.conflicts.resolve({
    workspaceId: input.actor.workspaceId,
    userId,
    conflictId: input.conflictId,
    resolution: input.resolution,
    resolvedValueMd: valueMd ?? null,
    resolvedAt,
    ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {})
  });
  if (!resolved) {
    throw new MemoryConflictServiceError(409, "memory_conflict_status_changed", "这张记忆冲突卡已经被处理，请刷新。");
  }

  if (valueMd && input.resolution !== "keep_current") {
    await stores.userMemories.upsert({
      userId,
      workspaceId: input.actor.workspaceId,
      category: row.category,
      key: row.key,
      valueMd,
      confidence: 0.9,
      ...(row.sourceRunId ? { sourceRunId: row.sourceRunId } : {})
    });
  }

  return { conflict: publicResolutionResult(resolved) };
}

export function createMemoryConflictService(deps: MemoryConflictServiceDependencies = {}) {
  const conflicts = deps.conflicts ?? getDefaultMemoryConflictRepository();
  const userMemories = deps.userMemories ?? getDefaultUserMemoryRepository();
  const now = deps.now ?? (() => new Date());
  const hasCustomDecisionStore = Boolean(deps.conflicts || deps.userMemories);

  return {
    async listAttentionItems(input: { actor: AuthActor; locale: WorkHubLocale }): Promise<AttentionItem[]> {
      const result = await conflicts.listOpenForUser({
        workspaceId: input.actor.workspaceId,
        userId: userIdFor(input.actor),
        limit: 50
      });
      return result.rows.map((row) => buildMemoryConflictAttentionItem(row, input.locale));
    },

    async resolve(input: ResolveMemoryConflictInput) {
      const resolvedAt = now();
      if (!hasCustomDecisionStore) {
        return getSharedDatabaseClient().db.transaction((tx) =>
          resolveWithStores({
            conflicts: createMemoryConflictRepository(tx),
            userMemories: createUserMemoryRepository(tx)
          }, input, resolvedAt)
        );
      }
      return resolveWithStores({ conflicts, userMemories }, input, resolvedAt);
    }
  };
}
