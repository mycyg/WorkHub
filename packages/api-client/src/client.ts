import type {
  ApiEnvelope,
  FetchLike,
  HealthResponse,
  IdentifyRequest,
  IdentityResponse,
  WorkHubApiClient,
  WorkHubApiClientOptions
} from "./types.js";

export class WorkHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function joinApiUrl(baseUrl: string | undefined, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = baseUrl?.trim();
  if (!base) {
    return normalizedPath;
  }
  return `${trimTrailingSlash(base)}${normalizedPath}`;
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return Boolean(value && typeof value === "object" && "ok" in value);
}

async function readJson(response: Response) {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageFrom(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") {
      return message;
    }
  }
  const detail = record.detail;
  if (typeof detail === "string") {
    return detail;
  }
  return fallback;
}

function errorCodeFrom(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const error = (body as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string") {
      return code;
    }
  }
  return fallback;
}

export function createApiClient(options: WorkHubApiClientOptions = {}): WorkHubApiClient {
  const fetchFn: FetchLike = options.fetchFn ?? fetch;
  const credentials = options.credentials ?? "include";

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const token = options.getClientToken?.();
    if (token) {
      headers.set("X-WorkHub-Client-Token", token);
      headers.set("X-YQGL-Client-Token", token);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchFn(joinApiUrl(options.baseUrl, path), {
      ...init,
      credentials,
      headers
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new WorkHubApiError(
        response.status,
        errorCodeFrom(body, "http_error"),
        errorMessageFrom(body, `WorkHub API request failed with ${response.status}`),
        body
      );
    }
    if (isEnvelope<T>(body)) {
      if (!body.ok) {
        throw new WorkHubApiError(response.status, body.error.code, body.error.message, body.error.details);
      }
      return body.data;
    }
    return body as T;
  }

  return {
    request,
    streamUrl: (path) => joinApiUrl(options.baseUrl, path),
    health: () => request<HealthResponse>("/api/health"),
    openapi: () => request<unknown>("/api/openapi.json"),
    identify: (payload: IdentifyRequest) =>
      request<IdentityResponse>("/api/auth/identify", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    me: () => request<IdentityResponse | null>("/api/auth/me"),
    notifications: () => request("/api/notifications"),
    respondApproval: (id, payload) =>
      request(`/api/approvals/${id}/respond`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    reviewProposal: (id, payload) =>
      request(`/api/proposals/${id}/review`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    mergeProposal: (id, payload = {}) =>
      request(`/api/proposals/${id}/merge`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    nextQuestion: (sessionId) =>
      request(`/api/sessions/${sessionId}/next-question`, {
        method: "POST"
      }),
    searchKnowledge: (payload = {}) =>
      request("/api/knowledge/search", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    replayAgentRun: (runId) => request(`/api/agent-runs/${runId}/replay`),
    pages: {
      attention: () => request("/api/pages/attention"),
      approvals: () => request("/api/pages/approvals"),
      cost: () => request("/api/pages/cost"),
      goldPath: () => request("/api/pages/gold-path"),
      workItem: (id) => request(`/api/pages/workitems/${id}`),
      proposal: (id) => request(`/api/pages/proposals/${id}`)
    }
  };
}
