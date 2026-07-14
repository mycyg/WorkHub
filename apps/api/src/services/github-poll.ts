import { settings as defaultSettings } from "@workhub/config";
import {
  createGithubBindingRepository,
  getSharedDatabaseClient,
  type GithubBindingRepository,
  type GithubBindingRow,
  type GithubSyncWatermarkPatch,
  type WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import {
  createGithubClient,
  humanizeGithubError,
  type GithubClient
} from "./github-client.js";
import { createSecretBox, type SecretBox } from "./secret-box.js";

// R14 批 GH（07-gh-design.md §4）：GitHub 仓库轮询——厚 service 层（`runOnce()`，依赖注入、可单测）。
// 薄调度壳在 apps/api/src/workers/github-poll.ts（tick/start/stop/stats），照
// apps/api/src/services/risk-monitor.ts 的"薄 worker + 厚 service"二层结构。
//
// 节奏（§1.3/§4.3）：每绑定项目独立水位（不是全局 cursor）——tick 频率(5 分钟，worker 层)决定
// "多快发现某个绑定到期"，本文件内部的 syncIntervalMs(15 分钟)才是"多久真正打一次 GitHub"。
// 已知处于失败态的绑定改用更长的 failureBackoffMs(1 小时)——PAT 失效/仓库改名这类会持续失败的
// 绑定，若继续按健康节奏(15 分钟)重试，会在 lastSyncedAt 停滞不前的情况下被"到期"判定命中每一次
// 5 分钟 tick(因为 now - lastSyncedAt 只会越来越大，永远 >= 15 分钟)，等于把 tick 频率当成了重试
// 频率——这不是"更快恢复"而是浪费配额、反复产生同一个失败。恢复判据=下一次 recordSyncSuccess
// 清空 lastError/lastErrorAt(仓库层已有)，届时立刻回到健康节奏。
//
// 安全红线（§6）：PAT 明文只在 syncOneProject 这一个调用栈内瞬时存在，用完不持有引用，
// 不出现在任何 logger 调用的字段里。加密密钥未配置（secretBox undefined）时 runOnce() 直接空转
// 返回零结果——不查绑定表、不发任何 GitHub 请求（fail-closed，见 §0 结论2/§4.3），只在第一次
// 命中时 warn 一次，不逐 tick 刷屏。

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_FAILURE_BACKOFF_MS = 60 * 60 * 1000;

export type GithubSyncRunResult = {
  scanned: number; // 本 tick 判定"到该轮询"的绑定数
  synced: number; // 成功完成一轮拉取（无论有没有新活动）
  skipped_not_due: number; // enabled 绑定里未到间隔/退避窗口，本 tick 跳过
  failed: number;
  started_at: string;
  finished_at: string;
};

function zeroResult(startedAt: Date): GithubSyncRunResult {
  const iso = startedAt.toISOString();
  return { scanned: 0, synced: 0, skipped_not_due: 0, failed: 0, started_at: iso, finished_at: iso };
}

function isBindingDue(
  binding: GithubBindingRow,
  now: Date,
  syncIntervalMs: number,
  failureBackoffMs: number
): boolean {
  if (binding.lastError && binding.lastErrorAt) {
    return now.getTime() - binding.lastErrorAt.getTime() >= failureBackoffMs;
  }
  if (!binding.lastSyncedAt) {
    return true;
  }
  return now.getTime() - binding.lastSyncedAt.getTime() >= syncIntervalMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 纯函数：一批 ISO 时间戳字符串里的最大值（用于推进 commits_since/issues_since 水位）。
// 空批次不推进水位——不能拿"现在"当新水位，clock skew 会导致漏拉下一批边界数据（§4.2 步骤5）。
function maxOccurredAt(isoDates: string[]): Date | undefined {
  let maxMs: number | undefined;
  for (const iso of isoDates) {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms) && (maxMs === undefined || ms > maxMs)) {
      maxMs = ms;
    }
  }
  return maxMs === undefined ? undefined : new Date(maxMs);
}

export type GithubSyncServiceDependencies = {
  repository: Pick<
    GithubBindingRepository,
    "listEnabledBindings" | "upsertActivity" | "recordSyncSuccess" | "recordSyncFailure"
  >;
  client: Pick<GithubClient, "listCommitsSince" | "listIssuesSince">;
  // undefined = GITHUB_TOKEN_ENC_KEY 未配置：runOnce() 空转，不查绑定表、不发任何请求。
  secretBox?: SecretBox;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "warn">;
  syncIntervalMs?: number;
  failureBackoffMs?: number;
};

export type GithubSyncService = {
  runOnce(): Promise<GithubSyncRunResult>;
};

async function syncOneProject(
  deps: {
    repository: Pick<GithubBindingRepository, "upsertActivity" | "recordSyncSuccess">;
    client: Pick<GithubClient, "listCommitsSince" | "listIssuesSince">;
    secretBox: SecretBox;
  },
  binding: GithubBindingRow,
  at: Date
): Promise<void> {
  // PAT 明文只在这个函数调用栈内瞬时存在——不打日志、不透传出这个作用域（安全红线 §6-1）。
  const pat = deps.secretBox.open({
    ciphertext: binding.patCiphertext,
    iv: binding.patIv,
    authTag: binding.patAuthTag
  });
  const etagJson = isRecord(binding.etagJson) ? binding.etagJson : {};
  const commitsEtag = typeof etagJson["commits"] === "string" ? (etagJson["commits"] as string) : undefined;
  const issuesEtag = typeof etagJson["issues"] === "string" ? (etagJson["issues"] as string) : undefined;

  const commitsResult = await deps.client.listCommitsSince(binding.repoFullName, pat, {
    ...(binding.commitsSince ? { since: binding.commitsSince } : {}),
    ...(commitsEtag ? { etag: commitsEtag } : {})
  });
  for (const item of commitsResult.items) {
    await deps.repository.upsertActivity({
      projectId: binding.projectId,
      kind: "commit",
      externalId: item.sha,
      title: item.message,
      htmlUrl: item.html_url,
      occurredAt: new Date(item.occurred_at),
      authorLogin: item.author_login ?? null
    });
  }

  // issues 端点把 PR 也混进结果（GitHub 历史包袱）——is_pull_request 已在客户端分流，这里按它落 kind。
  const issuesResult = await deps.client.listIssuesSince(binding.repoFullName, pat, {
    ...(binding.issuesSince ? { since: binding.issuesSince } : {}),
    ...(issuesEtag ? { etag: issuesEtag } : {})
  });
  for (const item of issuesResult.items) {
    await deps.repository.upsertActivity({
      projectId: binding.projectId,
      kind: item.is_pull_request ? "pull_request" : "issue",
      externalId: String(item.number),
      title: item.title,
      htmlUrl: item.html_url,
      occurredAt: new Date(item.updated_at),
      authorLogin: item.author_login ?? null,
      state: item.state ?? null
    });
  }

  // ETag 命中(304)时客户端不返回 newEtag——保留上一次的值，不丢已有的缓存有效性。
  const nextEtagJson: Record<string, string> = {};
  const nextCommitsEtag = commitsResult.newEtag ?? commitsEtag;
  if (nextCommitsEtag) {
    nextEtagJson["commits"] = nextCommitsEtag;
  }
  const nextIssuesEtag = issuesResult.newEtag ?? issuesEtag;
  if (nextIssuesEtag) {
    nextEtagJson["issues"] = nextIssuesEtag;
  }

  const patch: GithubSyncWatermarkPatch = { etagJson: nextEtagJson };
  const newCommitsSince = maxOccurredAt(commitsResult.items.map((item) => item.occurred_at));
  if (newCommitsSince) {
    patch.commitsSince = newCommitsSince;
  }
  const newIssuesSince = maxOccurredAt(issuesResult.items.map((item) => item.updated_at));
  if (newIssuesSince) {
    patch.issuesSince = newIssuesSince;
  }

  // last_synced_at 无条件推进(即使两个端点本批都是 304/空)——"检查过一次"本身就是成功的一轮同步。
  await deps.repository.recordSyncSuccess(binding.projectId, patch, at);
}

export function createGithubSyncService(deps: GithubSyncServiceDependencies): GithubSyncService {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const syncIntervalMs = deps.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const failureBackoffMs = deps.failureBackoffMs ?? DEFAULT_FAILURE_BACKOFF_MS;
  let warnedUnconfigured = false;

  return {
    async runOnce() {
      const startedAt = now();
      const secretBox = deps.secretBox;
      if (!secretBox) {
        if (!warnedUnconfigured) {
          warnedUnconfigured = true;
          logger.warn("github_sync_encryption_unconfigured", {
            message: "GITHUB_TOKEN_ENC_KEY 未配置，GitHub 轮询 worker 空转（fail-closed）"
          });
        }
        return zeroResult(startedAt);
      }

      const bindings = await deps.repository.listEnabledBindings();
      const due = bindings.filter((binding) => isBindingDue(binding, startedAt, syncIntervalMs, failureBackoffMs));

      let synced = 0;
      let failed = 0;
      for (const binding of due) {
        try {
          await syncOneProject(
            { repository: deps.repository, client: deps.client, secretBox },
            binding,
            startedAt
          );
          synced += 1;
        } catch (error) {
          failed += 1;
          const reason = humanizeGithubError(error);
          logger.warn("github_sync_binding_failed", { project_id: binding.projectId, reason });
          await deps.repository.recordSyncFailure(binding.projectId, reason, startedAt);
        }
      }

      return {
        scanned: due.length,
        synced,
        skipped_not_due: bindings.length - due.length,
        failed,
        started_at: startedAt.toISOString(),
        finished_at: now().toISOString()
      };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: GithubSyncService | undefined;

export function getDefaultGithubSyncService(): GithubSyncService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createGithubSyncService({
      repository: createGithubBindingRepository(defaultDbClient.db),
      client: createGithubClient(),
      // 未配置=undefined → runOnce() 空转 fail-closed；与 github-bindings.ts 的 getDefault 同一口径。
      ...(defaultSettings.github.tokenEncKey
        ? { secretBox: createSecretBox(defaultSettings.github.tokenEncKey) }
        : {})
    });
  }
  return defaultService;
}
