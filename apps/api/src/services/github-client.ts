import { nextRetryDecision } from "@workhub/agent/providers";

// R14 批 GH（07-gh-design.md §1.5）：裸 REST v3 GitHub 客户端，零 SDK 依赖（不引 octokit——
// 十几个传递依赖换三个只读列表端点是过度设计）。照 anthropic-compatible.ts 的 transport 惯例：
// 裸 fetch + fetchImpl 注入（测试全走 mock，绝不真网），显式状态码检查抛自定义错误类。
// ETag/rate-limit 头解析是独立纯函数（可穷举单测）；退避复用 @workhub/agent 的 nextRetryDecision
// （通用 HTTP 重试判定，非 LLM 专属），GitHub 特有的 X-RateLimit-Remaining:0 短路检查在它之前。
// 安全红线：PAT 只进请求头，任何错误消息/日志字段都不携带它（构造错误时根本不引用 token 变量）。

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_PER_PAGE = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
// findings[#49] 同款纪律：Retry-After/RateLimit-Reset 由上游控制且无上界，单次等待钳顶，
// 防一个异常头把轮询 worker park 住。
const DEFAULT_MAX_DELAY_MS = 60_000;

export class GithubHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GithubHttpError";
  }
}

export class GithubNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GithubNetworkError";
  }
}

export type GithubRateLimitInfo = {
  remaining?: number;
  resetAtMs?: number;
};

// 纯函数：解析 GitHub rate-limit 头。X-RateLimit-Reset 是 unix 秒。
export function parseRateLimitHeaders(headers: {
  get: (name: string) => string | null;
}): GithubRateLimitInfo {
  const info: GithubRateLimitInfo = {};
  const remainingRaw = headers.get("x-ratelimit-remaining");
  if (remainingRaw !== null && remainingRaw.trim() !== "") {
    const remaining = Number(remainingRaw);
    if (Number.isFinite(remaining) && remaining >= 0) {
      info.remaining = remaining;
    }
  }
  const resetRaw = headers.get("x-ratelimit-reset");
  if (resetRaw !== null && resetRaw.trim() !== "") {
    const resetSeconds = Number(resetRaw);
    if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
      info.resetAtMs = resetSeconds * 1000;
    }
  }
  return info;
}

// 纯函数：配额耗尽（remaining=0）时等到 reset 的时长；未耗尽/头缺失返回 undefined。
// 假时钟可测（07-gh-design 验收3：验证等待时长计算，不真的 sleep）。
export function rateLimitWaitMs(info: GithubRateLimitInfo, nowMs: number): number | undefined {
  if (info.remaining !== 0) {
    return undefined;
  }
  if (info.resetAtMs === undefined) {
    // 配额耗尽但没有 reset 头：保守等一个固定小窗口，交给上层钳顶。
    return 1000;
  }
  return Math.max(0, info.resetAtMs - nowMs);
}

// 纯函数：把 GitHub/网络错误收敛成人话摘要——绝不包含 token/URL 查询串/堆栈。
// 绑定卡 last_error 与 test 端点的 error 字段都走这一个口。
export function humanizeGithubError(error: unknown): string {
  if (error instanceof GithubHttpError) {
    if (error.status === 401) {
      return "PAT 无效或已过期";
    }
    if (error.status === 403) {
      return "GitHub 拒绝访问（限流或权限不足），稍后重试";
    }
    if (error.status === 404) {
      return "仓库不存在或无访问权限";
    }
    if (error.status >= 500) {
      return "GitHub 服务暂不可用，稍后重试";
    }
    return `GitHub 请求失败（HTTP ${error.status}）`;
  }
  if (error instanceof GithubNetworkError) {
    return "网络错误，稍后重试";
  }
  return "GitHub 同步失败，稍后重试";
}

export type GithubRepoInfo = {
  full_name: string;
  default_branch?: string;
  private?: boolean;
};

export type GithubCommitItem = {
  sha: string;
  message: string;
  author_login?: string;
  html_url: string;
  occurred_at: string;
};

export type GithubIssueItem = {
  number: number;
  title: string;
  state?: string;
  author_login?: string;
  html_url: string;
  updated_at: string;
  is_pull_request: boolean;
};

export type GithubListOptions = {
  since?: Date;
  etag?: string;
  perPage?: number;
};

export type GithubListResult<TItem> = {
  items: TItem[];
  notModified: boolean;
  newEtag?: string;
  rateLimitRemaining?: number;
};

export type GithubRepoResult = {
  repo: GithubRepoInfo;
  rateLimitRemaining?: number;
};

export type GithubClient = {
  getRepo: (repoFullName: string, pat: string) => Promise<GithubRepoResult>;
  listCommitsSince: (
    repoFullName: string,
    pat: string,
    options?: GithubListOptions
  ) => Promise<GithubListResult<GithubCommitItem>>;
  listIssuesSince: (
    repoFullName: string,
    pat: string,
    options?: GithubListOptions
  ) => Promise<GithubListResult<GithubIssueItem>>;
};

export type GithubClientDependencies = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxDelayMs?: number;
  now?: () => Date;
  // 注入等待，测试断言等待时长而不真的 sleep。
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

function requestHeaders(pat: string, etag?: string): Record<string, string> {
  return {
    authorization: `Bearer ${pat}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "workhub-github-sync",
    ...(etag ? { "if-none-match": etag } : {})
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function parseRepoInfo(raw: unknown, fallbackFullName: string): GithubRepoInfo {
  const record = asRecord(raw);
  const info: GithubRepoInfo = {
    full_name: stringField(record, "full_name") ?? fallbackFullName
  };
  const defaultBranch = stringField(record, "default_branch");
  if (defaultBranch) {
    info.default_branch = defaultBranch;
  }
  const isPrivate = record?.["private"];
  if (typeof isPrivate === "boolean") {
    info.private = isPrivate;
  }
  return info;
}

function parseCommitItems(raw: unknown): GithubCommitItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: GithubCommitItem[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const sha = stringField(record, "sha");
    const htmlUrl = stringField(record, "html_url");
    const commit = asRecord(record?.["commit"]);
    const message = stringField(commit, "message");
    const commitAuthor = asRecord(commit?.["author"]);
    const occurredAt = stringField(commitAuthor, "date");
    if (!sha || !htmlUrl || !occurredAt || message === undefined) {
      continue;
    }
    const topAuthor = asRecord(record?.["author"]);
    const authorLogin = stringField(topAuthor, "login") ?? stringField(commitAuthor, "name");
    items.push({
      sha,
      // commit message 只取首行（落库 title 的口径，§2.2）。
      message: message.split("\n", 1)[0] ?? "",
      html_url: htmlUrl,
      occurred_at: occurredAt,
      ...(authorLogin ? { author_login: authorLogin } : {})
    });
  }
  return items;
}

function parseIssueItems(raw: unknown): GithubIssueItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: GithubIssueItem[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const title = stringField(record, "title");
    const htmlUrl = stringField(record, "html_url");
    const updatedAt = stringField(record, "updated_at");
    const numberValue = record?.["number"];
    if (!title || !htmlUrl || !updatedAt || typeof numberValue !== "number") {
      continue;
    }
    const user = asRecord(record?.["user"]);
    const authorLogin = stringField(user, "login");
    const state = stringField(record, "state");
    items.push({
      number: numberValue,
      title,
      html_url: htmlUrl,
      updated_at: updatedAt,
      // GitHub 历史包袱：issues 端点把 PR 也混进来，带 pull_request 字段的即为 PR（§1.3）。
      is_pull_request: asRecord(record?.["pull_request"]) !== null,
      ...(state ? { state } : {}),
      ...(authorLogin ? { author_login: authorLogin } : {})
    });
  }
  return items;
}

export function createGithubClient(deps: GithubClientDependencies = {}): GithubClient {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const baseUrl = (deps.baseUrl ?? GITHUB_API_BASE_URL).replace(/\/+$/u, "");
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxDelayMs = deps.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;

  async function requestWithRetry(path: string, pat: string, etag?: string): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method: "GET",
          headers: requestHeaders(pat, etag),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        // 网络层错误：交给通用重试判定（fetch failed/timeout/abort 均算瞬态）。
        const decision = nextRetryDecision(
          error instanceof Error ? error : { message: String(error) },
          attempt,
          { maxAttempts, maxDelayMs, now: now() }
        );
        if (!decision.retry) {
          throw new GithubNetworkError("GitHub request failed at the network layer", { cause: error });
        }
        attempt += 1;
        await sleep(decision.delayMs);
        continue;
      }

      if (response.ok || response.status === 304) {
        return response;
      }

      // GitHub 特有短路（在 nextRetryDecision 之前）：配额耗尽时不管状态码是不是 403，
      // 都按 X-RateLimit-Reset 计算等待时长（钳顶后）再重试。
      const rateLimit = parseRateLimitHeaders(response.headers);
      const waitMs = rateLimitWaitMs(rateLimit, now().getTime());
      if (waitMs !== undefined) {
        if (attempt + 1 >= maxAttempts) {
          throw new GithubHttpError(response.status, `GitHub rate limit exhausted (HTTP ${response.status})`);
        }
        attempt += 1;
        await sleep(Math.min(waitMs, maxDelayMs));
        continue;
      }

      const decision = nextRetryDecision(
        { status: response.status, headers: response.headers },
        attempt,
        { maxAttempts, maxDelayMs, now: now() }
      );
      if (!decision.retry) {
        // 错误消息只含状态码，绝不带响应体/URL 查询串/token。
        throw new GithubHttpError(response.status, `GitHub returned HTTP ${response.status}`);
      }
      attempt += 1;
      await sleep(decision.delayMs);
    }
  }

  function listQuery(options: GithubListOptions): string {
    const query = new URLSearchParams();
    if (options.since) {
      query.set("since", options.since.toISOString());
    }
    query.set("per_page", String(options.perPage ?? DEFAULT_PER_PAGE));
    return query.toString();
  }

  async function readListResponse<TItem>(
    response: Response,
    parse: (raw: unknown) => TItem[]
  ): Promise<GithubListResult<TItem>> {
    const rateLimit = parseRateLimitHeaders(response.headers);
    const base = rateLimit.remaining !== undefined
      ? { rateLimitRemaining: rateLimit.remaining }
      : {};
    if (response.status === 304) {
      // ETag 命中：不解析 body，调用方只推进 last_synced_at。
      return { items: [], notModified: true, ...base };
    }
    const newEtag = response.headers.get("etag");
    return {
      items: parse(await response.json()),
      notModified: false,
      ...(newEtag ? { newEtag } : {}),
      ...base
    };
  }

  return {
    async getRepo(repoFullName, pat) {
      const response = await requestWithRetry(`/repos/${repoFullName}`, pat);
      const rateLimit = parseRateLimitHeaders(response.headers);
      return {
        repo: parseRepoInfo(await response.json(), repoFullName),
        ...(rateLimit.remaining !== undefined ? { rateLimitRemaining: rateLimit.remaining } : {})
      };
    },

    async listCommitsSince(repoFullName, pat, options = {}) {
      const response = await requestWithRetry(
        `/repos/${repoFullName}/commits?${listQuery(options)}`,
        pat,
        options.etag
      );
      return readListResponse(response, parseCommitItems);
    },

    async listIssuesSince(repoFullName, pat, options = {}) {
      const query = new URLSearchParams();
      if (options.since) {
        query.set("since", options.since.toISOString());
      }
      query.set("state", "all");
      query.set("per_page", String(options.perPage ?? DEFAULT_PER_PAGE));
      const response = await requestWithRetry(
        `/repos/${repoFullName}/issues?${query.toString()}`,
        pat,
        options.etag
      );
      return readListResponse(response, parseIssueItems);
    }
  };
}
