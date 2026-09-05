import type {
  ApiEnvelope,
  ApprovalPageRequestOptions,
  ConversationMessageListRequestOptions,
  FetchLike,
  HealthResponse,
  IdentifyRequest,
  IdentityResponse,
  CalendarPageRequestOptions,
  DrivePageRequestOptions,
  EscalationDelegateResult,
  EscalationResolveResult,
  MemoryConflictResolveResult,
  PageRequestOptions,
  PilotDay1MetricsRequestOptions,
  MeetingPageRequestOptions,
  SearchRequestParams,
  UserMemoryListRequestOptions,
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
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (record.ok === true && "data" in record) || (record.ok === false && "error" in record);
}

// UI-06：已知合法的非信封 2xx 端点（存活/就绪探针、OpenAPI 文档、根信息）——它们回原始 JSON
// 不带 {ok,data} 信封属正常。其余路径的 2xx 响应必须是完整信封、裸 ack（{ok:true}，如 logout/
// revoke 一族）或空 body（/api/auth/me 未识别时 200 空 body）；其它形状在此前会原样塞给调用方，
// 畸形 VM 到渲染期才炸成整页错误卡——这里 fail-fast，抛带 path 的契约错误。
const RAW_JSON_RESPONSE_PATHS = new Set(["/", "/api/health", "/api/ready", "/api/openapi.json", "/openapi.json"]);

function pathWithoutQuery(path: string) {
  return path.split("?")[0]?.split("#")[0] ?? path;
}

function contractViolation(responseStatus: number, path: string, detail: string): WorkHubApiError {
  return new WorkHubApiError(
    responseStatus,
    "contract_violation",
    `WorkHub API 响应不符合契约（${path}）：${detail}`
  );
}

function assertSuccessBodyShape(body: unknown, path: string, responseStatus: number) {
  if (body === null || body === undefined) {
    return;
  }
  if (typeof body !== "object") {
    // SPA fallback / 网关错误页把 HTML 或纯文本塞进 2xx——绝不能当 VM 交给渲染层。
    throw contractViolation(responseStatus, path, "non-json body");
  }
  const record = body as Record<string, unknown>;
  if ("ok" in record) {
    if (typeof record.ok !== "boolean") {
      throw contractViolation(responseStatus, path, "envelope ok flag is not a boolean");
    }
    // ok:false 却缺 error 半边（错误被吞比炸页面更难查）；{ok:true} 无 data 是合法裸 ack。
    if (record.ok === false) {
      throw contractViolation(responseStatus, path, "error envelope missing error field");
    }
    return;
  }
  if (RAW_JSON_RESPONSE_PATHS.has(pathWithoutQuery(path))) {
    return;
  }
  throw contractViolation(responseStatus, path, "missing envelope");
}

function encodedStreamPath(kind: "workitem" | "run" | "session" | "proposal" | "conversation", id: string) {
  return `/api/push/stream/${kind}/${encodeURIComponent(id)}`;
}

function withPageLocale(path: string, options?: PageRequestOptions) {
  return options?.locale ? `${path}?locale=${encodeURIComponent(options.locale)}` : path;
}

function withApprovalPageOptions(path: string, options?: ApprovalPageRequestOptions) {
  const params = new URLSearchParams();
  if (options?.locale) {
    params.set("locale", options.locale);
  }
  if (options?.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function withDrivePageOptions(path: string, options?: DrivePageRequestOptions) {
  const params = new URLSearchParams();
  if (options?.locale) {
    params.set("locale", options.locale);
  }
  const projectId = options?.projectId ?? options?.project_id;
  if (projectId) {
    params.set("project_id", projectId);
  }
  const itemId = options?.itemId ?? options?.item_id;
  if (itemId) {
    params.set("item_id", itemId);
  }
  if (options?.q) {
    params.set("q", options.q);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function withMeetingPageOptions(path: string, options?: MeetingPageRequestOptions) {
  const params = new URLSearchParams();
  if (options?.locale) {
    params.set("locale", options.locale);
  }
  const projectId = options?.projectId ?? options?.project_id;
  if (projectId) {
    params.set("project_id", projectId);
  }
  const meetingId = options?.meetingId ?? options?.meeting_id;
  if (meetingId) {
    params.set("m", meetingId);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function withCalendarPageOptions(path: string, options?: CalendarPageRequestOptions) {
  const params = new URLSearchParams();
  if (options?.locale) {
    params.set("locale", options.locale);
  }
  if (options?.date) {
    params.set("date", options.date);
  }
  if (options?.view) {
    params.set("view", options.view);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function withPilotDay1MetricsOptions(path: string, options?: PilotDay1MetricsRequestOptions) {
  const params = new URLSearchParams();
  if (options?.from) {
    params.set("from", options.from);
  }
  if (options?.to) {
    params.set("to", options.to);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

// R14 批 SEARCH（web-search-page）：q 必填、scopes 逗号拼接（省略即用服务端默认四 scope 全开）、limit 可选。
function withSearchParams(path: string, params: SearchRequestParams) {
  const query = new URLSearchParams({ q: params.q });
  if (params.scopes && params.scopes.length > 0) {
    query.set("scopes", params.scopes.join(","));
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  return `${path}?${query.toString()}`;
}

// R14 批 MEM：用户记忆列表可选按 category 过滤。
function withUserMemoryListOptions(path: string, options?: UserMemoryListRequestOptions) {
  return options?.category ? `${path}?category=${encodeURIComponent(options.category)}` : path;
}

// R15 批 web-mirror：会话消息读端点分页参数。beforeSeq/afterSeq 契约层互斥——beforeSeq 优先（给
// 了就走反向游标），否则用 afterSeq（默认 0=从头正向）。limit 可选，服务端夹紧到 [1,100]。
function withConversationMessageListOptions(path: string, options?: ConversationMessageListRequestOptions) {
  const params = new URLSearchParams();
  if (options?.beforeSeq !== undefined) {
    params.set("beforeSeq", String(options.beforeSeq));
  } else if (options?.afterSeq !== undefined) {
    params.set("afterSeq", String(options.afterSeq));
  }
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
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

// 非 2xx 时 body 是整个错误信封 {ok:false,error:{code,message,details}}；取出内层 details，
// 使 error.details 的语义与 2xx-信封分支(传 body.error.details)一致。非信封 body 回退到原值。
function errorDetailsFrom(body: unknown, fallback: unknown) {
  if (body && typeof body === "object") {
    const error = (body as Record<string, unknown>).error;
    if (error && typeof error === "object" && "details" in (error as Record<string, unknown>)) {
      return (error as Record<string, unknown>).details;
    }
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

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function hasDriveUploadBlob(payload: Parameters<WorkHubApiClient["uploadDriveFile"]>[1]): payload is Extract<Parameters<WorkHubApiClient["uploadDriveFile"]>[1], { file: Blob }> {
  return Boolean(
    "file" in payload &&
      payload.file &&
      typeof payload.file === "object" &&
      typeof (payload.file as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function filenameFromBlob(file: Blob, fallback?: string) {
  const named = (file as { name?: unknown }).name;
  return fallback ?? (typeof named === "string" && named.trim() ? named : "upload.bin");
}

function driveUploadBody(payload: Parameters<WorkHubApiClient["uploadDriveFile"]>[1]): NonNullable<RequestInit["body"]> {
  if (!hasDriveUploadBlob(payload)) {
    return JSON.stringify(payload);
  }
  const form = new FormData();
  form.set("file", payload.file, filenameFromBlob(payload.file, payload.filename));
  const mime = payload.mime ?? payload.file.type;
  if (mime) {
    form.set("mime", mime);
  }
  if (payload.parsed_text) {
    form.set("parsed_text", payload.parsed_text);
  }
  if (typeof payload.parent_id === "string" && payload.parent_id.trim()) {
    form.set("parent_id", payload.parent_id.trim());
  }
  return form;
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
    if (init.body && !headers.has("Content-Type") && !isFormDataBody(init.body)) {
      headers.set("Content-Type", "application/json");
    }

    // 可选请求超时：超时即用 AbortController 中止，避免连接卡死时 UI 动作永远 pending。
    // 与调用方自带的 signal 组合（任一触发即中止）。
    const timeoutMs = options.requestTimeoutMs;
    let timeoutController: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const callerSignal = init.signal ?? undefined;
    let signal = callerSignal;
    if (timeoutMs && timeoutMs > 0) {
      timeoutController = new AbortController();
      timer = setTimeout(() => timeoutController?.abort(), timeoutMs);
      if (callerSignal && typeof AbortSignal.any === "function") {
        signal = AbortSignal.any([callerSignal, timeoutController.signal]);
      } else if (callerSignal) {
        // findings[#low]：AbortSignal.any 不可用时也必须尊重调用方 signal——转发到 timeout
        // controller，而不是把调用方 signal 丢掉。
        if (callerSignal.aborted) {
          timeoutController.abort(callerSignal.reason);
        } else {
          callerSignal.addEventListener("abort", () => timeoutController?.abort(callerSignal.reason), { once: true });
        }
        signal = timeoutController.signal;
      } else {
        signal = timeoutController.signal;
      }
    }

    let response: Response;
    let body: unknown;
    try {
      response = await fetchFn(joinApiUrl(options.baseUrl, path), {
        ...init,
        credentials,
        headers,
        ...(signal ? { signal } : {})
      });
      // findings[#low]：body 读取也纳入超时窗口（此前 timer 在 fetch 后即清，readJson 不计时）。
      body = await readJson(response);
    } catch (error) {
      // 仅超时触发、且非调用方自己 abort 的中止才映射为 408（含 body 读取阶段的中止）；
      // 调用方 abort（即便经 timeout controller 转发）保持原始 AbortError。
      if (
        timeoutController?.signal.aborted &&
        !callerSignal?.aborted &&
        (error as { name?: string } | null)?.name === "AbortError"
      ) {
        throw new WorkHubApiError(408, "request_timeout", `WorkHub API 请求超时（${timeoutMs}ms）`);
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
    if (!response.ok) {
      throw new WorkHubApiError(
        response.status,
        errorCodeFrom(body, "http_error"),
        errorMessageFrom(body, `WorkHub API request failed with ${response.status}`),
        errorDetailsFrom(body, body)
      );
    }
    if (isEnvelope<T>(body)) {
      if (!body.ok) {
        throw new WorkHubApiError(response.status, body.error.code, body.error.message, body.error.details);
      }
      return body.data;
    }
    assertSuccessBodyShape(body, path, response.status);
    return body as T;
  }

  return {
    request,
    streamUrl: (path) => joinApiUrl(options.baseUrl, path),
    streams: {
      all: () => joinApiUrl(options.baseUrl, "/api/push/stream"),
      me: () => joinApiUrl(options.baseUrl, "/api/push/stream/me"),
      workItem: (id) => joinApiUrl(options.baseUrl, encodedStreamPath("workitem", id)),
      run: (id) => joinApiUrl(options.baseUrl, encodedStreamPath("run", id)),
      session: (id) => joinApiUrl(options.baseUrl, encodedStreamPath("session", id)),
      proposal: (id) => joinApiUrl(options.baseUrl, encodedStreamPath("proposal", id)),
      conversation: (id) => joinApiUrl(options.baseUrl, encodedStreamPath("conversation", id))
    },
    health: () => request<HealthResponse>("/api/health"),
    openapi: () => request<unknown>("/api/openapi.json"),
    identify: (payload: IdentifyRequest) =>
      request<IdentityResponse>("/api/auth/identify", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    // 桌面凭据登录（密码/hybrid 模式）：明文密码只走请求体，建会话 cookie（credentials: include），随后 bootstrapDesktop 据会话换 client_token。
    login: (payload) =>
      request<IdentityResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    bootstrapDesktop: (payload) =>
      request("/api/auth/desktop-bootstrap", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    registerClientDevice: (payload) =>
      request("/api/client-devices/register", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    listClientDevices: () => request("/api/client-devices/me"),
    currentClientDevice: () => request("/api/client-devices/current"),
    revokeClientDevice: (deviceId) =>
      request(`/api/client-devices/${encodeURIComponent(deviceId)}/revoke`, { method: "POST" }),
    revokeCurrentClientDevice: () =>
      request("/api/client-devices/revoke-current", { method: "POST" }),
    me: () => request<IdentityResponse | null>("/api/auth/me"),
    logout: () =>
      request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    updatePreferences: (payload) =>
      request<IdentityResponse>("/api/auth/preferences", {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    notifications: () => request("/api/notifications"),
    markNotificationRead: (id) =>
      request(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: "POST"
      }),
    markAllNotificationsRead: () =>
      request("/api/notifications/read-all", {
        method: "POST"
      }),
    dismissNotification: (id) =>
      request(`/api/notifications/${encodeURIComponent(id)}/dismiss`, {
        method: "POST"
      }),
    completeNotification: (id) =>
      request(`/api/notifications/${encodeURIComponent(id)}/complete`, {
        method: "POST"
      }),
    // R15 批 A（A2 提醒阶梯）：暂停这条通知的 24h 叮嘱（服务端置 next_remind_at=null，读/归档态不动）。
    snoozeNotification: (id) =>
      request(`/api/notifications/${encodeURIComponent(id)}/snooze`, {
        method: "POST"
      }),
    getNotificationPreferences: () =>
      request("/api/notifications/preferences"),
    setNotificationPreferences: (mutedNotificationTypes, options) =>
      request("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({
          muted_notification_types: mutedNotificationTypes,
          // G4 #10：只在调用方显式给了值时才带 care_messages_enabled——缺省＝不动关怀开关（服务端
          // 的 PUT schema 对该字段为 optional，缺省不覆盖存量）。
          ...(options?.careMessagesEnabled !== undefined
            ? { care_messages_enabled: options.careMessagesEnabled }
            : {})
        })
      }),
    bootstrapProject: (payload = {}) =>
      request("/api/projects/bootstrap", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    createSession: (payload = {}, options) =>
      request(withPageLocale("/api/sessions", options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    getSession: (id, options) => request(withPageLocale(`/api/sessions/${encodeURIComponent(id)}`, options)),
    createWorkItem: (payload, options) =>
      request(withPageLocale("/api/workitems", options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    createTaskPlan: (workItemId, payload = {}, options) =>
      request(withPageLocale(`/api/workitems/${encodeURIComponent(workItemId)}/task-plan`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    // R20 wave4（R19-1 OKR 前端接线）：创建目标（可带关键结果）+ 把工作项挂到目标上——服务端早已有
    // POST /api/objectives 与 POST /api/objectives/:id/link，此前没有任何类型化客户端方法能调用它们。
    createObjective: (payload) =>
      request("/api/objectives", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    linkObjective: (objectiveId, payload) =>
      request(`/api/objectives/${encodeURIComponent(objectiveId)}/link`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    // R23 F-01（OKR 列表/详情持久化）：项目主页 OKR 面板首屏真拉取 + 详情抽屉——GET /api/projects/:id/
    // objectives 与 GET /api/objectives/:id，同 createObjective/linkObjective 一样直接透传信封解包出的
    // data，无额外加工。
    listObjectives: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/objectives`),
    getObjective: (objectiveId) => request(`/api/objectives/${encodeURIComponent(objectiveId)}`),
    startAgentRun: (workItemId, payload = {}, options) =>
      request(withPageLocale(`/api/workitems/${encodeURIComponent(workItemId)}/agent-runs`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    getAgentRun: (runId) => request(`/api/agent-runs/${encodeURIComponent(runId)}`),
    getAgentRunTrace: (runId, after) =>
      request(
        `/api/agent-runs/${encodeURIComponent(runId)}/trace${after === undefined ? "" : `?after=${encodeURIComponent(String(after))}`}`
      ),
    abortAgentRun: (runId) =>
      request(`/api/agent-runs/${encodeURIComponent(runId)}/abort`, {
        method: "POST"
      }),
    // R20 DSK-UX（R19-3）：撤销这次 AI 执行对文件的改动——POST /api/agent-runs/:id/revert，body 带要还原的
    // snapshot_id（可选 reason_md）。服务端本地客户端门控，桌面壳层天然满足。
    revertAgentRun: (runId, payload) =>
      request(`/api/agent-runs/${encodeURIComponent(runId)}/revert`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    // R20 R19-29：getAgentRunHandoff（GET /api/agent-runs/:id/handoff）已删——web/desktop 均无调用点，
    // 结构化 handoff 数据早已内嵌进 replayAgentRun 的回放页，核实零消费后随后端路由一并删除。
    respondApproval: (id, payload) =>
      request(`/api/approvals/${encodeURIComponent(id)}/respond`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    respondApprovalsBatch: (ids) =>
      request("/api/approvals/respond-batch", {
        method: "POST",
        body: JSON.stringify({ ids })
      }),
    delegateApproval: (id, payload) =>
      request(`/api/approvals/${encodeURIComponent(id)}/delegate`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    skipTaskPlanProposal: (proposalId, options) =>
      request(withPageLocale(`/api/proposals/${encodeURIComponent(proposalId)}/skip-plan`, options), { method: "POST" }),
    pauseTaskPlan: (planId) =>
      request(`/api/task-plans/${encodeURIComponent(planId)}/pause`, { method: "POST" }),
    resumeTaskPlan: (planId) =>
      request(`/api/task-plans/${encodeURIComponent(planId)}/resume`, { method: "POST" }),
    resolveEscalation: (id, payload, options) =>
      request<EscalationResolveResult>(withPageLocale(`/api/escalations/${encodeURIComponent(id)}/resolve`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    resolveBudgetDecision: (id, actionId, options) =>
      request<EscalationResolveResult>(
        withPageLocale(`/api/escalations/${encodeURIComponent(id)}/budget-actions/${encodeURIComponent(actionId)}`, options),
        { method: "POST" }
      ),
    delegateEscalation: (id, payload, options) =>
      request<EscalationDelegateResult>(withPageLocale(`/api/escalations/${encodeURIComponent(id)}/delegate`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    resolveMemoryConflict: (id, payload) => {
      const params = new URLSearchParams({ expected_updated_at: payload.expected_updated_at });
      const path =
        `/api/memory-conflicts/${encodeURIComponent(id)}/resolve/${encodeURIComponent(payload.resolution)}?${params.toString()}`;
      const body = {
        ...(payload.value_md ? { value_md: payload.value_md } : {})
      };
      return request<MemoryConflictResolveResult>(path, {
        method: "POST",
        ...(payload.value_md ? { body: JSON.stringify(body) } : {})
      });
    },
    listApprovalComments: (id) => request(`/api/approvals/${encodeURIComponent(id)}/comments`),
    postApprovalComment: (id, payload) =>
      request(`/api/approvals/${encodeURIComponent(id)}/comments`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    createProposalFromManifest: (workItemId, payload) =>
      request(`/api/workitems/${encodeURIComponent(workItemId)}/proposals`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    // R20 R19-29：listWorkItemProposals（GET /api/workitems/:id/proposals）已删——web/desktop 均无调用点，
    // 同样的提议列表数据早已内嵌进工作项详情页 VM，核实零消费后随后端路由一并删除。
    listWorkItemConflicts: (workItemId) => request(`/api/workitems/${encodeURIComponent(workItemId)}/conflicts`),
    getWorkItemAuditTimeline: (workItemId) => request(`/api/workitems/${encodeURIComponent(workItemId)}/audit`),
    getProposal: (id) => request(`/api/proposals/${encodeURIComponent(id)}`),
    reviewProposal: (id, payload, options) =>
      request(withPageLocale(`/api/proposals/${encodeURIComponent(id)}/review`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    mergeProposal: (id, payload = {}, options) =>
      request(withPageLocale(`/api/proposals/${encodeURIComponent(id)}/merge`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    // R14 批 FEEDBACK（web-feedback-ui）：提议详情页「有用/没用」轻反馈——204 No Content，request()
    // 对空响应体返回 null（见上方 readJson），void 化即可，调用方不需要回执数据。
    putProposalFeedback: (id, payload) =>
      request(`/api/proposals/${encodeURIComponent(id)}/feedback`, {
        method: "PUT",
        body: JSON.stringify(payload)
      }),
    deleteProposalFeedback: (id) =>
      request(`/api/proposals/${encodeURIComponent(id)}/feedback`, { method: "DELETE" }),
    rebaseProposal: (id) =>
      request(`/api/proposals/${encodeURIComponent(id)}/rebase`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    chooseMergeProposalCandidate: (id, payload) =>
      request(`/api/merge-proposals/${encodeURIComponent(id)}/choose`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    applyMergeProposalCandidate: (id, payload = {}, options) =>
      request(withPageLocale(`/api/merge-proposals/${encodeURIComponent(id)}/apply`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    nextQuestion: (sessionId, payload = {}, options) =>
      request(withPageLocale(`/api/sessions/${encodeURIComponent(sessionId)}/next-question`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    searchKnowledge: (payload = {}, options) =>
      request(withPageLocale("/api/knowledge/search", options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    search: (params) => request(withSearchParams("/api/search", params)),
    useEvidenceForWorkItem: (workItemId, payload) =>
      request(`/api/workitems/${encodeURIComponent(workItemId)}/evidence-bindings`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    restoreAcceptedDeliverable: (workItemId, acceptedChangeId) =>
      request(
        `/api/workitems/${encodeURIComponent(workItemId)}/deliverables/${encodeURIComponent(acceptedChangeId)}/restore`,
        { method: "POST" }
      ),
    uploadDriveFile: (projectId, payload, options) =>
      request(withPageLocale(`/api/drive/projects/${encodeURIComponent(projectId)}/files`, options), {
        method: "POST",
        body: driveUploadBody(payload)
      }),
    deleteDriveItem: (projectId, itemId, payload = {}, options) =>
      request(withPageLocale(`/api/drive/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/delete`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    restoreDriveItem: (projectId, itemId, options) =>
      request(withPageLocale(`/api/drive/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/restore`, options), {
        method: "POST"
      }),
    createDriveComment: (projectId, payload, options) =>
      request(withPageLocale(`/api/drive/projects/${encodeURIComponent(projectId)}/comments`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    createDriveCommentDraft: (projectId, commentId, options) =>
      request(withPageLocale(`/api/drive/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}/draft`, options), {
        method: "POST"
      }),
    createDriveDraftProposal: (workItemId, options) =>
      request(withPageLocale(`/api/drive/workitems/${encodeURIComponent(workItemId)}/proposal-draft`, options), {
        method: "POST"
      }),
    importMeetingTranscript: (projectId, payload, options) =>
      request(withPageLocale(`/api/meetings/projects/${encodeURIComponent(projectId)}/import`, options), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    listUsers: () => request("/api/users"),
    listConversationMessages: (conversationId, options) =>
      request(
        withConversationMessageListOptions(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
          options
        )
      ),
    createMeetingInsightDraft: (projectId, insightId, options) =>
      request(withPageLocale(`/api/meetings/projects/${encodeURIComponent(projectId)}/insights/${encodeURIComponent(insightId)}/draft`, options), {
        method: "POST"
      }),
    dismissMeetingInsight: (projectId, insightId, options) =>
      request(withPageLocale(`/api/meetings/projects/${encodeURIComponent(projectId)}/insights/${encodeURIComponent(insightId)}/dismiss`, options), {
        method: "POST"
      }),
    createMeetingDraftProposal: (workItemId, options) =>
      request(withPageLocale(`/api/meetings/workitems/${encodeURIComponent(workItemId)}/proposal-draft`, options), {
        method: "POST"
      }),
    costUsage: () => request("/api/cost/usage"),
    costPolicies: () => request("/api/cost/policies"),
    updateCostPolicy: (scope, id, payload) =>
      request(`/api/cost/policies/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      }),
    // R20 DSK-UX（R19-5）：撤销一条学到的自动通过/权限策略——DELETE /api/permissions/:id（本地客户端 + 管理员门）。
    revokePermissionPolicy: (id) =>
      request(`/api/permissions/${encodeURIComponent(id)}`, {
        method: "DELETE"
      }),
    pilotDay1Metrics: (options) => request(withPilotDay1MetricsOptions("/api/pilot/day1/metrics", options)),
    listProjects: () => request("/api/projects"),
    replayAgentRun: (runId, options) => request(withPageLocale(`/api/agent-runs/${encodeURIComponent(runId)}/replay`, options)),
    // R14 批 MEM（记忆可见可治理）：用户记忆治理面。
    listUserMemories: (options) => request(withUserMemoryListOptions("/api/me/memories", options)),
    patchUserMemory: (id, payload) =>
      request(`/api/me/memories/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    deleteUserMemory: (id) =>
      request(`/api/me/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
    // 团队技能治理面。
    listTeamSkillsManage: () => request("/api/team-skills/manage"),
    patchTeamSkillManage: (id, payload) =>
      request(`/api/team-skills/manage/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    deactivateTeamSkillManage: (id, payload = {}) =>
      request(`/api/team-skills/manage/${encodeURIComponent(id)}/deactivate`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    pages: {
      attention: (options) => request(withPageLocale("/api/pages/attention", options)),
      approvals: (options) => request(withApprovalPageOptions("/api/pages/approvals", options)),
      cost: (options) => request(withPageLocale("/api/pages/cost", options)),
      agents: (options) => request(withPageLocale("/api/pages/agents", options)),
      skills: (options) => request(withPageLocale("/api/pages/skills", options)),
      settings: (options) => request(withPageLocale("/api/pages/settings", options)),
      goldPath: (options) => request(withPageLocale("/api/pages/gold-path", options)),
      drive: (options) => request(withDrivePageOptions("/api/pages/drive", options)),
      meetings: (options) => request(withMeetingPageOptions("/api/pages/meetings", options)),
      notifications: (options) => request(withPageLocale("/api/pages/notifications", options)),
      calendar: (options) => request(withCalendarPageOptions("/api/pages/calendar", options)),
      projectHealth: (options) => request(withPageLocale("/api/pages/health", options)),
      project: (id, options) => request(withPageLocale(`/api/pages/project/${encodeURIComponent(id)}`, options)),
      workItem: (id, options) => request(withPageLocale(`/api/pages/workitems/${encodeURIComponent(id)}`, options)),
      proposal: (id, options) => request(withPageLocale(`/api/pages/proposals/${encodeURIComponent(id)}`, options)),
      workbench: (projectId, options) => request(withPageLocale(`/api/pages/workbench/${encodeURIComponent(projectId)}`, options)),
      projectTimeline: (projectId, options) =>
        request(withPageLocale(`/api/pages/project/${encodeURIComponent(projectId)}/timeline`, options))
    }
  };
}
