import assert from "node:assert/strict";
import test from "node:test";

import type { GithubBindingRow, GithubSyncWatermarkPatch, UpsertGithubActivityInput } from "@workhub/db";

import { createGithubSyncService, type GithubSyncServiceDependencies } from "./github-poll.js";
import {
  createGithubClient,
  type GithubClient,
  type GithubCommitItem,
  type GithubIssueItem,
  type GithubListResult
} from "./github-client.js";
import { createSecretBox } from "./secret-box.js";

// R14 批 GH-B（07-gh-design.md §4 + r14-gh-server.md §5）：runOnce() 的正反例——水位推进/ETag 304
// 空转/单绑定失败降级不连累其余/未到期跳过（含失败退避与健康节奏分道）/加密密钥缺失静默跳过/
// 活动 upsert 的去重键幂等。限流退避那一例故意接真 createGithubClient + fetchImpl mock（禁真网），
// 因为退避逻辑整个活在客户端里，worker/service 只是"尊重它的决定"——要验证的是这层透传关系，
// 不是重新断言客户端内部算法（那是 github-client.test.ts 的territory）。

const now = new Date("2026-07-14T12:00:00.000Z");
const projectId = "40000000-0000-4000-8000-000000000001";
const secretBox = createSecretBox(Buffer.alloc(32, 7).toString("base64"));
const sealedPat = secretBox.seal("ghp_fake_pat_0123456789");
const PLAINTEXT_PAT = "ghp_fake_pat_0123456789";

function binding(overrides: Partial<GithubBindingRow> = {}): GithubBindingRow {
  return {
    projectId,
    repoFullName: "octocat/Hello-World",
    patCiphertext: sealedPat.ciphertext,
    patIv: sealedPat.iv,
    patAuthTag: sealedPat.authTag,
    enabled: true,
    createdByUserId: null,
    commitsSince: null,
    issuesSince: null,
    etagJson: {},
    lastSyncedAt: null,
    lastError: null,
    lastErrorAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as GithubBindingRow;
}

function commitsResult(
  items: GithubCommitItem[],
  extra: Partial<GithubListResult<GithubCommitItem>> = {}
): GithubListResult<GithubCommitItem> {
  return { items, notModified: false, ...extra };
}

function issuesResult(
  items: GithubIssueItem[],
  extra: Partial<GithubListResult<GithubIssueItem>> = {}
): GithubListResult<GithubIssueItem> {
  return { items, notModified: false, ...extra };
}

type FakeRepoState = {
  activities: Map<string, UpsertGithubActivityInput>;
  successPatches: Array<{ projectId: string; patch: GithubSyncWatermarkPatch; at: Date }>;
  failures: Array<{ projectId: string; error: string; at: Date }>;
};

function fakeRepository(bindings: GithubBindingRow[]): {
  repository: GithubSyncServiceDependencies["repository"];
  state: FakeRepoState;
} {
  const state: FakeRepoState = { activities: new Map(), successPatches: [], failures: [] };
  const repository: GithubSyncServiceDependencies["repository"] = {
    async listEnabledBindings() {
      return bindings;
    },
    async upsertActivity(input) {
      // ON CONFLICT (project_id, kind, external_id) DO UPDATE 的内存等价物——同 key 覆盖而非追加，
      // 用来在测试里断言"重复 upsert 相同活动不会堆积第二行"。
      state.activities.set(`${input.projectId}:${input.kind}:${input.externalId}`, input);
    },
    async recordSyncSuccess(pid, patch, at) {
      state.successPatches.push({ projectId: pid, patch, at });
      const row = bindings.find((candidate) => candidate.projectId === pid);
      if (row) {
        if (patch.commitsSince !== undefined) {
          row.commitsSince = patch.commitsSince;
        }
        if (patch.issuesSince !== undefined) {
          row.issuesSince = patch.issuesSince;
        }
        if (patch.etagJson !== undefined) {
          row.etagJson = patch.etagJson;
        }
        row.lastSyncedAt = at;
        row.lastError = null;
        row.lastErrorAt = null;
      }
    },
    async recordSyncFailure(pid, error, at) {
      state.failures.push({ projectId: pid, error, at });
      const row = bindings.find((candidate) => candidate.projectId === pid);
      if (row) {
        row.lastError = error;
        row.lastErrorAt = at;
      }
    }
  };
  return { repository, state };
}

function fakeClient(
  commits: () => GithubListResult<GithubCommitItem> | Error,
  issues: () => GithubListResult<GithubIssueItem> | Error
): { client: Pick<GithubClient, "listCommitsSince" | "listIssuesSince">; calls: Array<{ endpoint: string; repo: string; pat: string; options: unknown }> } {
  const calls: Array<{ endpoint: string; repo: string; pat: string; options: unknown }> = [];
  const client: Pick<GithubClient, "listCommitsSince" | "listIssuesSince"> = {
    async listCommitsSince(repo, pat, options = {}) {
      calls.push({ endpoint: "commits", repo, pat, options });
      const result = commits();
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
    async listIssuesSince(repo, pat, options = {}) {
      calls.push({ endpoint: "issues", repo, pat, options });
      const result = issues();
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }
  };
  return { client, calls };
}

test("runOnce advances the watermark, upserts commit/issue/PR activity, and captures new ETags", async () => {
  const b = binding();
  const { repository, state } = fakeRepository([b]);
  const { client, calls } = fakeClient(
    () =>
      commitsResult(
        [
          {
            sha: "sha1",
            message: "feat: one",
            html_url: "https://x/commit/sha1",
            occurred_at: "2026-07-14T09:00:00Z",
            author_login: "octocat"
          },
          { sha: "sha2", message: "fix: two", html_url: "https://x/commit/sha2", occurred_at: "2026-07-14T10:00:00Z" }
        ],
        { newEtag: '"c-etag"' }
      ),
    () =>
      issuesResult(
        [
          {
            number: 7,
            title: "bug report",
            state: "open",
            html_url: "https://x/issues/7",
            updated_at: "2026-07-14T08:30:00Z",
            is_pull_request: false,
            author_login: "reporter"
          },
          {
            number: 8,
            title: "add feature",
            state: "closed",
            html_url: "https://x/pull/8",
            updated_at: "2026-07-14T11:00:00Z",
            is_pull_request: true
          }
        ],
        { newEtag: '"i-etag"' }
      )
  );

  const service = createGithubSyncService({ repository, client, secretBox, now: () => now });
  const result = await service.runOnce();

  assert.equal(result.scanned, 1);
  assert.equal(result.synced, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped_not_due, 0);

  assert.equal(state.activities.size, 4);
  assert.equal(state.activities.get(`${projectId}:commit:sha1`)?.title, "feat: one");
  assert.equal(state.activities.get(`${projectId}:pull_request:8`)?.kind, "pull_request");
  assert.equal(state.activities.get(`${projectId}:issue:7`)?.kind, "issue");

  assert.equal(state.successPatches.length, 1);
  const patch = state.successPatches[0]!.patch;
  assert.equal(patch.commitsSince?.toISOString(), "2026-07-14T10:00:00.000Z");
  assert.equal(patch.issuesSince?.toISOString(), "2026-07-14T11:00:00.000Z");
  assert.deepEqual(patch.etagJson, { commits: '"c-etag"', issues: '"i-etag"' });

  // PAT 明文确实被拿去调了客户端(否则拉不到数据)，但从不出现在 runOnce() 的返回值/失败摘要里——
  // 那条红线由错误路径的 humanizeGithubError 测试覆盖，这里只确认它被正确解出并传递。
  assert.equal(calls[0]?.pat, PLAINTEXT_PAT);
});

test("a 304 ETag hit skips body parsing, keeps the prior watermark, but still advances last_synced_at", async () => {
  const b = binding({
    commitsSince: new Date("2026-07-13T00:00:00Z"),
    issuesSince: new Date("2026-07-13T00:00:00Z"),
    etagJson: { commits: '"old-c"', issues: '"old-i"' }
  });
  const { repository, state } = fakeRepository([b]);
  const { client, calls } = fakeClient(
    () => commitsResult([], { notModified: true }),
    () => issuesResult([], { notModified: true })
  );

  const service = createGithubSyncService({ repository, client, secretBox, now: () => now });
  const result = await service.runOnce();

  assert.equal(result.synced, 1);
  assert.equal(state.activities.size, 0, "304 responses never reach upsertActivity");
  assert.equal(state.successPatches.length, 1);
  const patch = state.successPatches[0]!.patch;
  assert.equal(patch.commitsSince, undefined, "an empty batch never moves the watermark");
  assert.equal(patch.issuesSince, undefined);
  assert.deepEqual(
    patch.etagJson,
    { commits: '"old-c"', issues: '"old-i"' },
    "the prior ETag is preserved when the response carries no new one"
  );
  assert.equal((calls[0]?.options as { etag?: string }).etag, '"old-c"', "304 request replays the last known ETag");
  assert.equal((calls[1]?.options as { etag?: string }).etag, '"old-i"');
});

test("a single binding's sync failure is recorded without a watermark advance and does not affect other bindings", async () => {
  const failing = binding({ projectId: "40000000-0000-4000-8000-000000000002", repoFullName: "octocat/broken" });
  const healthy = binding({ projectId: "40000000-0000-4000-8000-000000000003", repoFullName: "octocat/healthy" });
  const { repository, state } = fakeRepository([failing, healthy]);
  const client: Pick<GithubClient, "listCommitsSince" | "listIssuesSince"> = {
    async listCommitsSince(repo) {
      if (repo === "octocat/broken") {
        throw new Error("network unreachable");
      }
      return commitsResult([]);
    },
    async listIssuesSince() {
      return issuesResult([]);
    }
  };

  const service = createGithubSyncService({ repository, client, secretBox, now: () => now });
  const result = await service.runOnce();

  assert.equal(result.scanned, 2);
  assert.equal(result.synced, 1);
  assert.equal(result.failed, 1);
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0]?.projectId, failing.projectId);
  assert.ok(state.failures[0]?.error.length, "a human-readable reason is recorded");
  assert.equal(state.successPatches.length, 1);
  assert.equal(state.successPatches[0]?.projectId, healthy.projectId);
});

test("only due bindings are synced: healthy 15-minute cadence and failure backoff are separate clocks", async () => {
  const recentlyHealthy = binding({
    projectId: "40000000-0000-4000-8000-000000000010",
    repoFullName: "octocat/recently-healthy",
    lastSyncedAt: new Date(now.getTime() - 5 * 60 * 1000) // 5 分钟前，未到 15 分钟节奏
  });
  const dueHealthy = binding({
    projectId: "40000000-0000-4000-8000-000000000011",
    repoFullName: "octocat/due-healthy",
    lastSyncedAt: new Date(now.getTime() - 20 * 60 * 1000) // 20 分钟前，超过 15 分钟节奏
  });
  const recentlyFailed = binding({
    projectId: "40000000-0000-4000-8000-000000000012",
    repoFullName: "octocat/recently-failed",
    lastSyncedAt: new Date(now.getTime() - 20 * 60 * 1000), // 若按健康节奏本该到期……
    lastError: "PAT 无效或已过期",
    lastErrorAt: new Date(now.getTime() - 20 * 60 * 1000) // ……但失败退避(60 分钟)还没到
  });
  const longFailed = binding({
    projectId: "40000000-0000-4000-8000-000000000013",
    repoFullName: "octocat/long-failed",
    lastError: "PAT 无效或已过期",
    lastErrorAt: new Date(now.getTime() - 90 * 60 * 1000) // 超过 60 分钟退避窗口，重新尝试
  });
  const { repository } = fakeRepository([recentlyHealthy, dueHealthy, recentlyFailed, longFailed]);
  const { client, calls } = fakeClient(() => commitsResult([]), () => issuesResult([]));

  const service = createGithubSyncService({ repository, client, secretBox, now: () => now });
  const result = await service.runOnce();

  assert.equal(result.scanned, 2, "only due-healthy and long-failed are due this tick");
  assert.equal(result.skipped_not_due, 2);
  const syncedRepos = new Set(calls.map((call) => call.repo));
  assert.deepEqual(syncedRepos, new Set(["octocat/due-healthy", "octocat/long-failed"]));
});

test("runOnce short-circuits to a zero result when the encryption key is unconfigured, warning only once", async () => {
  let listCalls = 0;
  const repository: GithubSyncServiceDependencies["repository"] = {
    async listEnabledBindings() {
      listCalls += 1;
      return [];
    },
    async upsertActivity() {},
    async recordSyncSuccess() {},
    async recordSyncFailure() {}
  };
  const client: Pick<GithubClient, "listCommitsSince" | "listIssuesSince"> = {
    async listCommitsSince() {
      throw new Error("must never be called when the encryption key is unconfigured");
    },
    async listIssuesSince() {
      throw new Error("must never be called when the encryption key is unconfigured");
    }
  };
  const warnCalls: Array<[string, Record<string, unknown> | undefined]> = [];
  const service = createGithubSyncService({
    repository,
    client,
    now: () => now,
    logger: {
      warn(event, fields) {
        warnCalls.push([event, fields]);
      }
    }
  });

  const first = await service.runOnce();
  const second = await service.runOnce();

  const zero = { scanned: 0, synced: 0, skipped_not_due: 0, failed: 0, started_at: now.toISOString(), finished_at: now.toISOString() };
  assert.deepEqual(first, zero);
  assert.deepEqual(second, zero);
  assert.equal(listCalls, 0, "an unconfigured worker never even queries the bindings table (fail-closed)");
  assert.equal(warnCalls.length, 1, "the unconfigured warning fires once, not on every tick");
});

test("re-syncing the same page is idempotent: upserts key on (project, kind, external_id) and never duplicate", async () => {
  const b = binding();
  const { repository, state } = fakeRepository([b]);
  const { client } = fakeClient(
    () =>
      commitsResult([
        { sha: "sha1", message: "feat: one", html_url: "https://x/commit/sha1", occurred_at: "2026-07-14T09:00:00Z" }
      ]),
    () =>
      issuesResult([
        {
          number: 7,
          title: "bug report v1",
          state: "open",
          html_url: "https://x/issues/7",
          updated_at: "2026-07-14T08:30:00Z",
          is_pull_request: false
        }
      ])
  );
  const service = createGithubSyncService({ repository, client, secretBox, now: () => now });

  await service.runOnce();
  // 模拟下一次到期后重新拉到同一批(例如上次拉取后半途某个失败点导致水位没推进)——ON CONFLICT
  // DO UPDATE 的语义要求同一个 key 覆盖，不能在活动表里堆出第二行。
  b.lastSyncedAt = new Date(now.getTime() - 60 * 60 * 1000);
  await service.runOnce();

  assert.equal(state.activities.size, 2, "same (project,kind,external_id) keys collapse instead of accumulating");
});

test("the client's rate-limit backoff is honored transparently: the worker just awaits, it never re-implements it", async () => {
  const b = binding();
  const { repository } = fakeRepository([b]);
  const resetSeconds = Math.floor(now.getTime() / 1000) + 5;
  const responses: Response[] = [
    new Response(JSON.stringify({ message: "rate limited" }), {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) }
    }),
    new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } })
  ];
  const fetchImpl: typeof fetch = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("mock fetch ran out of canned responses");
    }
    return next;
  };
  const waits: number[] = [];
  const realClient = createGithubClient({
    fetchImpl,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
    }
  });

  const service = createGithubSyncService({ repository, client: realClient, secretBox, now: () => now });
  const result = await service.runOnce();

  assert.equal(result.synced, 1, "the worker awaits whatever the client's internal retry decision resolves to");
  assert.equal(result.failed, 0);
  assert.deepEqual(waits, [5000], "no worker-side backoff exists — the wait duration came entirely from the client");
});
