import {
  createDatabaseClient,
  createUserMemoryRepository,
  type UpsertUserMemoryInput,
  type UserMemoryRepository,
  type UserMemoryRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { USER_MEMORY_PROMPT_TOP_N, type UserMemoryCategory } from "@workhub/contracts";

const CATEGORY_LABEL: Record<UserMemoryCategory, string> = {
  preference: "偏好",
  correction: "纠正过",
  recurring_context: "常用上下文"
};

// READ：把用户记忆拼成一段 prompt（注入 worker，减少重复澄清）。空则返回 ""。
export function buildUserMemoryPromptSection(rows: UserMemoryRow[]): string {
  if (rows.length === 0) {
    return "";
  }
  const lines = rows.map((row) => `- [${CATEGORY_LABEL[row.category as UserMemoryCategory] ?? row.category}] ${row.valueMd}`);
  return ["", "该用户的既定偏好与历史纠正（请优先遵循，不要重复询问已知信息）：", ...lines].join("\n");
}

// WRITE 规则：用户打回(request_changes)并写了原因 → 存为 correction 记忆（v0 无 LLM 蒸馏）。
export function correctionFromReview(input: {
  reviewerUserId?: string | null;
  decision: "approve" | "request_changes";
  reasonMd?: string | undefined;
  proposalId: string;
}): UpsertUserMemoryInput | null {
  if (input.decision !== "request_changes" || !input.reviewerUserId) {
    return null;
  }
  const reason = input.reasonMd?.trim();
  if (!reason) {
    return null;
  }
  return {
    userId: input.reviewerUserId,
    category: "correction",
    key: `proposal:${input.proposalId}`,
    valueMd: reason.length > 400 ? `${reason.slice(0, 400)}…` : reason,
    confidence: 0.9
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultRepository: UserMemoryRepository | undefined;

export function getDefaultUserMemoryRepository(): UserMemoryRepository {
  if (!defaultRepository) {
    defaultDbClient = defaultDbClient ?? createDatabaseClient();
    defaultRepository = createUserMemoryRepository(defaultDbClient.db);
  }
  return defaultRepository;
}

export type UserMemoryContextProvider = (run: { actor_id: string }) => Promise<string | undefined>;

// 给 agent-runner 用的默认提供者：取该用户 top-N 记忆、touch 之、拼成 prompt 段。失败静默降级。
export function getDefaultUserMemoryContextProvider(): UserMemoryContextProvider {
  return async (run) => {
    try {
      const repository = getDefaultUserMemoryRepository();
      const rows = await repository.listForUser(run.actor_id, { limit: USER_MEMORY_PROMPT_TOP_N });
      if (rows.length === 0) {
        return undefined;
      }
      await repository.touch(rows.map((row) => row.id));
      return buildUserMemoryPromptSection(rows);
    } catch {
      return undefined;
    }
  };
}
