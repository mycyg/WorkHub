import assert from "node:assert/strict";
import test from "node:test";

import {
  GithubHttpError,
  GithubNetworkError,
  createGithubClient,
  humanizeGithubError,
  parseRateLimitHeaders,
  rateLimitWaitMs
} from "./github-client.js";

const pat = "ghp_secret_token_0123456789abcdef";
const repo = "octocat/Hello-World";
const now = new Date("2026-07-14T10:00:00.000Z");

type RecordedRequest = { url: string; headers: Record<string, string> };

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

function recordingFetch(responses: Array<Response | Error>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
        key.toLowerCase(),
        value
      ])
    );
    requests.push({ url: String(input), headers });
    const next = responses.shift();
    if (!next) {
      throw new Error("mock fetch ran out of responses");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetchImpl, requests };
}

function fakeSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    }
  };
}

test("R14 批 GH client: rate-limit header parsing is exact and tolerant of absent headers", () => {
  const headers = new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1783941000" });
  assert.deepEqual(parseRateLimitHeaders(headers), { remaining: 0, resetAtMs: 1783941000000 });
  assert.deepEqual(parseRateLimitHeaders(new Headers()), {});
  assert.deepEqual(parseRateLimitHeaders(new Headers({ "x-ratelimit-remaining": "garbage" })), {});
});

test("R14 批 GH client: rate-limit wait is only armed when the quota is exhausted", () => {
  // 未耗尽：不等待。
  assert.equal(rateLimitWaitMs({ remaining: 4999 }, now.getTime()), undefined);
  assert.equal(rateLimitWaitMs({}, now.getTime()), undefined);
  // 耗尽 + reset 在未来：等到 reset（假时钟验证计算，不真的 sleep）。
  const resetAtMs = now.getTime() + 90_000;
  assert.equal(rateLimitWaitMs({ remaining: 0, resetAtMs }, now.getTime()), 90_000);
  // 耗尽 + reset 已过：等 0。
  assert.equal(rateLimitWaitMs({ remaining: 0, resetAtMs: now.getTime() - 1000 }, now.getTime()), 0);
  // 耗尽但没有 reset 头：保守小窗口。
  assert.equal(rateLimitWaitMs({ remaining: 0 }, now.getTime()), 1000);
});

test("R14 批 GH client: getRepo sends the exact GitHub headers and parses the repo shape", async () => {
  const { fetchImpl, requests } = recordingFetch([
    jsonResponse({ full_name: repo, default_branch: "main", private: true })
  ]);
  const client = createGithubClient({ fetchImpl, now: () => now });

  const result = await client.getRepo(repo, pat);

  assert.deepEqual(result.repo, { full_name: repo, default_branch: "main", private: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, `https://api.github.com/repos/${repo}`);
  assert.equal(requests[0]?.headers["authorization"], `Bearer ${pat}`);
  assert.equal(requests[0]?.headers["accept"], "application/vnd.github+json");
  assert.equal(requests[0]?.headers["x-github-api-version"], "2022-11-28");
  assert.equal("if-none-match" in (requests[0]?.headers ?? {}), false);
});

test("R14 批 GH client: first commits fetch returns items plus the new ETag; next fetch sends If-None-Match", async () => {
  const commit = {
    sha: "abc123",
    html_url: "https://github.com/octocat/Hello-World/commit/abc123",
    commit: { message: "feat: first line\n\nbody detail", author: { date: "2026-07-14T09:00:00Z", name: "Octo Cat" } },
    author: { login: "octocat" }
  };
  const { fetchImpl, requests } = recordingFetch([
    jsonResponse([commit], { headers: { etag: '"etag-1"', "x-ratelimit-remaining": "4999" } }),
    new Response(null, { status: 304, headers: { "x-ratelimit-remaining": "4999" } })
  ]);
  const client = createGithubClient({ fetchImpl, now: () => now });

  const first = await client.listCommitsSince(repo, pat, { since: new Date("2026-07-13T00:00:00Z") });
  assert.equal(first.notModified, false);
  assert.equal(first.newEtag, '"etag-1"');
  assert.equal(first.rateLimitRemaining, 4999);
  assert.deepEqual(first.items, [{
    sha: "abc123",
    message: "feat: first line",
    html_url: "https://github.com/octocat/Hello-World/commit/abc123",
    occurred_at: "2026-07-14T09:00:00Z",
    author_login: "octocat"
  }]);
  const firstUrl = new URL(requests[0]!.url);
  assert.equal(firstUrl.pathname, `/repos/${repo}/commits`);
  assert.equal(firstUrl.searchParams.get("since"), "2026-07-13T00:00:00.000Z");
  assert.equal(firstUrl.searchParams.get("per_page"), "50");

  // 304 命中：不解析 body、items 空、notModified=true；请求带上次的 ETag。
  const second = await client.listCommitsSince(repo, pat, { etag: '"etag-1"' });
  assert.equal(requests[1]?.headers["if-none-match"], '"etag-1"');
  assert.deepEqual(second, { items: [], notModified: true, rateLimitRemaining: 4999 });
});

test("R14 批 GH client: issues endpoint separates true issues from the PR subset", async () => {
  const { fetchImpl, requests } = recordingFetch([
    jsonResponse([
      {
        number: 7,
        title: "bug: broken",
        state: "open",
        html_url: "https://github.com/octocat/Hello-World/issues/7",
        updated_at: "2026-07-14T08:00:00Z",
        user: { login: "reporter" }
      },
      {
        number: 8,
        title: "feat: add thing",
        state: "closed",
        html_url: "https://github.com/octocat/Hello-World/pull/8",
        updated_at: "2026-07-14T09:00:00Z",
        user: { login: "author" },
        pull_request: { url: "https://api.github.com/repos/octocat/Hello-World/pulls/8" }
      }
    ])
  ]);
  const client = createGithubClient({ fetchImpl, now: () => now });

  const result = await client.listIssuesSince(repo, pat);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.is_pull_request, false);
  assert.equal(result.items[1]?.is_pull_request, true);
  const url = new URL(requests[0]!.url);
  assert.equal(url.searchParams.get("state"), "all");
});

test("R14 批 GH client: quota exhaustion waits until X-RateLimit-Reset before retrying (clamped)", async () => {
  const resetSeconds = Math.floor(now.getTime() / 1000) + 42;
  const { fetchImpl, requests } = recordingFetch([
    jsonResponse({ message: "API rate limit exceeded" }, {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) }
    }),
    jsonResponse({ full_name: repo, default_branch: "main", private: false })
  ]);
  const { sleep, waits } = fakeSleep();
  const client = createGithubClient({ fetchImpl, now: () => now, sleep });

  const result = await client.getRepo(repo, pat);

  assert.equal(result.repo.default_branch, "main");
  assert.equal(requests.length, 2);
  // 等待时长=reset - now（假时钟计算，未触发钳顶）。
  assert.deepEqual(waits, [42_000]);
});

test("R14 批 GH client: rate-limit waits are clamped so a hostile reset header cannot park the worker", async () => {
  const resetSeconds = Math.floor(now.getTime() / 1000) + 86_400;
  const { fetchImpl } = recordingFetch([
    jsonResponse({}, {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) }
    }),
    jsonResponse({ full_name: repo })
  ]);
  const { sleep, waits } = fakeSleep();
  const client = createGithubClient({ fetchImpl, now: () => now, sleep, maxDelayMs: 60_000 });

  await client.getRepo(repo, pat);

  assert.deepEqual(waits, [60_000]);
});

test("R14 批 GH client: 404 is a terminal error with a human message that never leaks the PAT", async () => {
  const { fetchImpl, requests } = recordingFetch([
    jsonResponse({ message: "Not Found" }, { status: 404 })
  ]);
  const client = createGithubClient({ fetchImpl, now: () => now });

  await assert.rejects(
    client.getRepo(repo, pat),
    (error: unknown) => {
      assert.ok(error instanceof GithubHttpError);
      assert.equal(error.status, 404);
      assert.equal(error.message.includes(pat), false, "error message must not contain the PAT");
      assert.equal(humanizeGithubError(error), "仓库不存在或无访问权限");
      return true;
    }
  );
  // 4xx 不重试。
  assert.equal(requests.length, 1);
});

test("R14 批 GH client: 401 maps to the invalid-PAT human message and does not retry", async () => {
  const { fetchImpl, requests } = recordingFetch([jsonResponse({}, { status: 401 })]);
  const client = createGithubClient({ fetchImpl, now: () => now });

  await assert.rejects(client.getRepo(repo, pat), (error: unknown) => {
    assert.ok(error instanceof GithubHttpError);
    assert.equal(humanizeGithubError(error), "PAT 无效或已过期");
    return true;
  });
  assert.equal(requests.length, 1);
});

test("R14 批 GH client: 5xx retries with backoff then succeeds", async () => {
  const { fetchImpl, requests } = recordingFetch([
    jsonResponse({}, { status: 502 }),
    jsonResponse({}, { status: 503 }),
    jsonResponse({ full_name: repo, default_branch: "main" })
  ]);
  const { sleep, waits } = fakeSleep();
  const client = createGithubClient({ fetchImpl, now: () => now, sleep });

  const result = await client.getRepo(repo, pat);

  assert.equal(result.repo.default_branch, "main");
  assert.equal(requests.length, 3);
  assert.equal(waits.length, 2);

  // 用尽重试后抛错并给人话降级。nextRetryDecision 的 attempt 语义=已失败次数（从 0 起），
  // maxAttempts=3 意味着最多 3 次重试=4 次请求。
  const exhausted = recordingFetch([
    jsonResponse({}, { status: 500 }),
    jsonResponse({}, { status: 500 }),
    jsonResponse({}, { status: 500 }),
    jsonResponse({}, { status: 500 })
  ]);
  const failingClient = createGithubClient({
    fetchImpl: exhausted.fetchImpl,
    now: () => now,
    sleep: fakeSleep().sleep
  });
  await assert.rejects(failingClient.getRepo(repo, pat), (error: unknown) => {
    assert.ok(error instanceof GithubHttpError);
    assert.equal(humanizeGithubError(error), "GitHub 服务暂不可用，稍后重试");
    return true;
  });
});

test("R14 批 GH client: network failures retry then surface as a network error without the PAT", async () => {
  const { fetchImpl, requests } = recordingFetch([
    new Error("fetch failed"),
    jsonResponse({ full_name: repo })
  ]);
  const { sleep } = fakeSleep();
  const client = createGithubClient({ fetchImpl, now: () => now, sleep });
  const recovered = await client.getRepo(repo, pat);
  assert.equal(recovered.repo.full_name, repo);
  assert.equal(requests.length, 2);

  const alwaysFailing = createGithubClient({
    fetchImpl: async () => {
      throw new Error("fetch failed");
    },
    now: () => now,
    sleep: fakeSleep().sleep
  });
  await assert.rejects(alwaysFailing.getRepo(repo, pat), (error: unknown) => {
    assert.ok(error instanceof GithubNetworkError);
    assert.equal(error.message.includes(pat), false);
    assert.equal(humanizeGithubError(error), "网络错误，稍后重试");
    return true;
  });
});

test("R14 批 GH client: malformed payload entries are skipped instead of crashing the sync", async () => {
  const { fetchImpl } = recordingFetch([
    jsonResponse([
      { sha: "ok1", html_url: "https://x/commit/ok1", commit: { message: "fine", author: { date: "2026-07-14T00:00:00Z" } } },
      { sha: "broken-no-commit" },
      "not-an-object",
      null
    ])
  ]);
  const client = createGithubClient({ fetchImpl, now: () => now });

  const result = await client.listCommitsSince(repo, pat);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.sha, "ok1");
});
