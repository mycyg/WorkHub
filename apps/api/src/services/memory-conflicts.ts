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
  userMemories?: Pick<UserMemoryRepository, "upsert" | "softDeleteByKey">;
  now?: () => Date;
};

type ResolveMemoryConflictInput = {
  actor: AuthActor;
  conflictId: string;
  resolution: MemoryConflictResolution;
  expectedUpdatedAt: Date;
  valueMd?: string;
};

type MemoryConflictDecisionStores = {
  conflicts: Pick<MemoryConflictRepository, "findOpenForUser" | "resolve">;
  userMemories: Pick<UserMemoryRepository, "upsert" | "softDeleteByKey">;
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

function resolveHref(row: Pick<MemoryConflictRow, "id" | "updatedAt">, resolution: MemoryConflictResolution) {
  const query = new URLSearchParams({ expected_updated_at: row.updatedAt.toISOString() });
  return `/api/memory-conflicts/${row.id}/resolve/${resolution}?${query.toString()}`;
}

// UX-M5：SSE 推送卡（agent-memory L1）与收件箱卡共用这一个构造器——两处内联曾经漂移
// （「纠正过」vs「纠正」、动作集不同步、L1 无双语）。参数收窄成用到的字段，L1 侧可直接喂。
export type MemoryConflictCardRow = Pick<
  MemoryConflictRow,
  "id" | "category" | "key" | "currentValueMd" | "incomingValueMd" | "sourceRunId" | "createdAt" | "updatedAt"
>;

export function buildMemoryConflictAttentionItem(row: MemoryConflictCardRow, locale: WorkHubLocale): AttentionItem {
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
    // 普通用户审查 high：A/B 只有字母代号没人知道哪条正在生效，「都不要」会删现存记忆也没说。
    // 身份写死在正文里（现在生效/新学到），按钮后果在正文说明。
    summary_text: zh
      ? `${label}「${row.key}」出现两种说法，需要确认后再使用。「都不要」会把现有这条记忆也撤下。`
      : `${label} "${row.key}" has two conflicting values. "Discard both" also retires the current memory.`,
    reason_text: zh
      ? `A（现在生效）：${row.currentValueMd}\nB（新学到）：${row.incomingValueMd}`
      : `A (currently in use): ${row.currentValueMd}\nB (newly learned): ${row.incomingValueMd}`,
    // B-R9.6 §3.7（ux-flow-spec §1 卡定义）：动作 = [要 A][要 B][都不要][合并成一条（可编辑）]。
    // merge 动作带 request_json.value_md 合并草稿，web 端渲成可编辑文本框后再提交；
    // 「都不要」= 两条都不该成为记忆（收卡 + 撤下现存记忆），与「要 A」（维持现状）语义分开。
    actions: [
      action("keep_current", zh ? "要 A" : "Keep A", "secondary", "POST", resolveHref(row, "keep_current")),
      action("accept_incoming", zh ? "要 B" : "Use B", "primary", "POST", resolveHref(row, "accept_incoming")),
      action("discard_both", zh ? "都不要" : "Discard both", "danger", "POST", resolveHref(row, "discard_both")),
      {
        ...action("merge_both", zh ? "合并成一条（可编辑）" : "Merge into one (editable)", "secondary", "POST", resolveHref(row, "merge_both")),
        request_json: { value_md: mergedValue(row) }
      },
      // 出处（哪个子任务学的）：B 侧有来源 run 时给回放链接；A 是现存记忆，出处即设置页里的记忆本身。
      ...(row.sourceRunId
        ? [action("open_incoming_source", zh ? "看 B 的出处" : "View B's source", "quiet", "GET", `/agent-runs/${row.sourceRunId}/replay`)]
        : [action("open_settings", zh ? "打开设置" : "Open settings", "quiet", "GET", "/settings")])
    ],
    cuu_state: "worried",
    created_at: row.createdAt.toISOString()
  };
}

function mergedValue(row: Pick<MemoryConflictRow, "currentValueMd" | "incomingValueMd">, override?: string) {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (row.currentValueMd === row.incomingValueMd) {
    return row.currentValueMd;
  }
  return `${row.currentValueMd}\n${row.incomingValueMd}`;
}

function resolvedValue(row: MemoryConflictRow, resolution: MemoryConflictResolution, override?: string) {
  switch (resolution) {
    case "keep_current":
      return row.currentValueMd;
    case "accept_incoming":
      return row.incomingValueMd;
    case "merge_both":
      return mergedValue(row, override);
    case "edit_memory": {
      const edited = override?.trim();
      if (!edited) {
        throw new MemoryConflictServiceError(400, "memory_conflict_edit_value_required", "手动编辑记忆时必须提交编辑后的内容。");
      }
      return edited;
    }
    // B-R9.6 §3.7「都不要」：没有胜出值——记录 null，随后撤下现存记忆。
    case "discard_both":
      return null;
  }
}

let defaultRepository: MemoryConflictRepository | undefined;
let defaultUserMemoryRepository: Pick<UserMemoryRepository, "upsert" | "softDeleteByKey"> | undefined;

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
  if (row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    throw new MemoryConflictServiceError(409, "memory_conflict_status_changed", "这张记忆冲突卡已经更新，请刷新。");
  }

  const valueMd = resolvedValue(row, input.resolution, input.valueMd);
  const resolved = await stores.conflicts.resolve({
    workspaceId: input.actor.workspaceId,
    userId,
    conflictId: input.conflictId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    resolution: input.resolution,
    resolvedValueMd: valueMd,
    resolvedAt
  });
  if (!resolved) {
    throw new MemoryConflictServiceError(409, "memory_conflict_status_changed", "这张记忆冲突卡已经被处理，请刷新。");
  }

  if (input.resolution === "discard_both") {
    // 「都不要」：撤下这个 key 的现存记忆（含遗留 NULL 行），两条说法都不晋升。
    await stores.userMemories.softDeleteByKey({
      userId,
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
      category: row.category,
      key: row.key,
      at: resolvedAt
    });
  } else if (input.resolution !== "keep_current" && valueMd) {
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

  return { conflict: resolved };
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
