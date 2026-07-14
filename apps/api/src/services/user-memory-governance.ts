import {
  userMemoryManagementItemVmSchema,
  userMemoryManagementPageVmSchema,
  type UserMemoryCategory,
  type UserMemoryManagementItemVM,
  type UserMemoryManagementPageVM,
  type UserMemoryProvenance
} from "@workhub/contracts";
import {
  createUserMemoryRepository,
  getSharedDatabaseClient,
  type UserMemoryRepository,
  type UserMemoryRow,
  type UserMemoryRunProvenance,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { looksLikeInjection } from "./skill-curation.js";

// R14 批 MEM（记忆可见可治理）：用户记忆治理管理面服务——列表/详情/编辑/删除，严格「本人可读写」。
// 管理员也不能代读/代改他人记忆（04 手册纪律：不无理由扩大数据可见面）。语义红线见 03-mem-design §2.1。

// value_md 宽松上限（防注入 worker prompt 时膨胀，同时不打断正常表达）。超限 → 400（非 zod 422），见 §2.1。
const USER_MEMORY_VALUE_MAX_CHARS = 2000;
const PROPOSAL_KEY_PREFIX = "proposal:";

export class UserMemoryGovernanceServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "UserMemoryGovernanceServiceError";
  }
}

export type UserMemoryGovernanceServiceDependencies = {
  repository: Pick<
    UserMemoryRepository,
    "listForUser" | "getForUser" | "updateValueForUser" | "resolveRunProvenance" | "softDeleteForUser"
  >;
  now?: () => Date;
};

export type UserMemoryGovernanceService = {
  listMemories(input: { actor: AuthActor; category?: UserMemoryCategory }): Promise<UserMemoryManagementPageVM>;
  getMemory(input: { actor: AuthActor; id: string }): Promise<UserMemoryManagementItemVM>;
  patchMemory(input: {
    actor: AuthActor;
    id: string;
    valueMd: string;
    expectedUpdatedAt: Date;
  }): Promise<UserMemoryManagementItemVM>;
  deleteMemory(input: { actor: AuthActor; id: string }): Promise<{ deleted: true }>;
};

type HumanScope = { userId: string; workspaceId: string };

function requireHumanActor(actor: AuthActor): HumanScope {
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId) {
    throw new UserMemoryGovernanceServiceError(
      403,
      "user_memory_access_denied",
      "需要已登录的真人用户才能管理个人记忆。"
    );
  }
  return { userId, workspaceId: actor.workspaceId };
}

function clampConfidence(value: number): number {
  // confidence 是 doublePrecision，越界/NaN 会撞 min(0).max(1) schema——夹紧，非有限值归 0。
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function runProvenanceLabel(info: UserMemoryRunProvenance): string {
  if (info.conversationTitle) {
    return `来自会话《${info.conversationTitle}》的一次 AI 执行`;
  }
  if (info.workItemTitle) {
    return `来自任务《${info.workItemTitle}》的一次 AI 执行`;
  }
  return `来自一次 AI 执行 · ${info.createdAt.toISOString().slice(0, 10)}`;
}

// 出处三级降级（§2.3）：run join → proposal key 反解 → 诚实缺省（返回 undefined，前端渲染「出处不明」）。
function provenanceFor(
  row: UserMemoryRow,
  runMap: Map<string, UserMemoryRunProvenance>
): UserMemoryProvenance | undefined {
  if (row.sourceRunId) {
    const info = runMap.get(row.sourceRunId);
    if (info) {
      return {
        kind: "agent_run",
        label: runProvenanceLabel(info),
        run_id: row.sourceRunId,
        ...(info.sourceConversationId ? { conversation_id: info.sourceConversationId } : {})
      };
    }
    // source_run_id 已设但 run 不可解析（极少见）——诚实缺省，不再往下反解，不瞎编。
    return undefined;
  }
  if (row.category === "correction" && row.key.startsWith(PROPOSAL_KEY_PREFIX)) {
    const proposalId = row.key.slice(PROPOSAL_KEY_PREFIX.length).trim();
    if (proposalId) {
      return {
        kind: "review_correction",
        label: "来自你对某次变更申请的审批意见",
        proposal_id: proposalId
      };
    }
  }
  return undefined;
}

function toItem(row: UserMemoryRow, runMap: Map<string, UserMemoryRunProvenance>): UserMemoryManagementItemVM {
  const provenance = provenanceFor(row, runMap);
  return {
    id: row.id,
    category: row.category as UserMemoryCategory,
    key: row.key,
    value_md: row.valueMd,
    confidence: clampConfidence(row.confidence),
    workspace_scoped: row.workspaceId !== null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(row.lastUsedAt ? { last_used_at: row.lastUsedAt.toISOString() } : {}),
    ...(row.editedAt ? { edited_at: row.editedAt.toISOString() } : {}),
    ...(provenance ? { provenance } : {})
  };
}

export function createUserMemoryGovernanceService(
  deps: UserMemoryGovernanceServiceDependencies
): UserMemoryGovernanceService {
  const clock = deps.now ?? (() => new Date());

  async function resolveRuns(rows: UserMemoryRow[]): Promise<Map<string, UserMemoryRunProvenance>> {
    const runIds = [...new Set(rows.map((row) => row.sourceRunId).filter((value): value is string => Boolean(value)))];
    if (runIds.length === 0) {
      return new Map();
    }
    const infos = await deps.repository.resolveRunProvenance(runIds);
    return new Map(infos.map((info) => [info.runId, info]));
  }

  return {
    async listMemories({ actor, category }) {
      const scope = requireHumanActor(actor);
      const rows = await deps.repository.listForUser(scope.userId, {
        workspaceId: scope.workspaceId,
        ...(category ? { categories: [category] } : {})
      });
      const runMap = await resolveRuns(rows);
      return parseOutputContract(
        userMemoryManagementPageVmSchema,
        {
          generated_at: clock().toISOString(),
          memories: rows.map((row) => toItem(row, runMap)),
          totals: { active: rows.length }
        },
        "user-memory-governance.page"
      );
    },

    async getMemory({ actor, id }) {
      const scope = requireHumanActor(actor);
      const row = await deps.repository.getForUser(scope.userId, id, { workspaceId: scope.workspaceId });
      if (!row || row.deletedAt) {
        throw new UserMemoryGovernanceServiceError(404, "user_memory_not_found", "没有找到这条记忆。");
      }
      const runMap = await resolveRuns([row]);
      return parseOutputContract(userMemoryManagementItemVmSchema, toItem(row, runMap), "user-memory-governance.item");
    },

    async patchMemory({ actor, id, valueMd, expectedUpdatedAt }) {
      const scope = requireHumanActor(actor);
      if (!valueMd.trim()) {
        throw new UserMemoryGovernanceServiceError(400, "user_memory_value_required", "记忆内容不能为空。");
      }
      if (valueMd.length > USER_MEMORY_VALUE_MAX_CHARS) {
        throw new UserMemoryGovernanceServiceError(
          400,
          "user_memory_value_too_long",
          `记忆内容最多 ${USER_MEMORY_VALUE_MAX_CHARS} 字。`
        );
      }
      // value_md 会经 buildUserMemoryPromptSection 注入 worker prompt——人工编辑不该比 AI 自己写的更松。
      if (looksLikeInjection(valueMd)) {
        throw new UserMemoryGovernanceServiceError(
          400,
          "user_memory_value_injection",
          "记忆内容包含可能干扰 AI 的指令式措辞，请改写后再保存。"
        );
      }
      const row = await deps.repository.getForUser(scope.userId, id, { workspaceId: scope.workspaceId });
      if (!row) {
        throw new UserMemoryGovernanceServiceError(404, "user_memory_not_found", "没有找到这条记忆。");
      }
      if (row.deletedAt) {
        throw new UserMemoryGovernanceServiceError(409, "user_memory_deleted", "这条记忆已被删除，请刷新。");
      }
      if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new UserMemoryGovernanceServiceError(
          409,
          "user_memory_version_conflict",
          "这条记忆已更新，请刷新后再编辑。"
        );
      }
      const updated = await deps.repository.updateValueForUser({
        userId: scope.userId,
        id,
        valueMd,
        expectedValueMd: row.valueMd,
        editedByUserId: scope.userId,
        at: clock(),
        workspaceId: scope.workspaceId
      });
      if (!updated) {
        // 读到写之间被并发编辑改了正文——竞态兜底闸门落空，按并发冲突处理。
        throw new UserMemoryGovernanceServiceError(
          409,
          "user_memory_version_conflict",
          "这条记忆刚被并发编辑改动，请刷新后再试。"
        );
      }
      const runMap = await resolveRuns([updated]);
      return parseOutputContract(
        userMemoryManagementItemVmSchema,
        toItem(updated, runMap),
        "user-memory-governance.item"
      );
    },

    async deleteMemory({ actor, id }) {
      const scope = requireHumanActor(actor);
      const deleted = await deps.repository.softDeleteForUser(scope.userId, id, clock(), {
        workspaceId: scope.workspaceId
      });
      if (deleted) {
        return { deleted: true };
      }
      // 幂等：softDelete 落空可能是「已是删除态」（幂等成功）或「不存在/非本人」（404）——用 getForUser 区分。
      const row = await deps.repository.getForUser(scope.userId, id, { workspaceId: scope.workspaceId });
      if (row) {
        return { deleted: true };
      }
      throw new UserMemoryGovernanceServiceError(404, "user_memory_not_found", "没有找到这条记忆。");
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: UserMemoryGovernanceService | undefined;

export function getDefaultUserMemoryGovernanceService(): UserMemoryGovernanceService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createUserMemoryGovernanceService({
      repository: createUserMemoryRepository(defaultDbClient.db)
    });
  }
  return defaultService;
}
