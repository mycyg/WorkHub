import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HTTPException } from "hono/http-exception";

import {
  addApprovalCommentRequestSchema,
  createApprovalRequestSchema,
  delegateApprovalRequestSchema,
  delegateEscalationRequestSchema,
  patchProjectAiGovernanceRequestSchema,
  patchUserAiProfileRequestSchema,
  permissionPolicyWriteSchema,
  resolveEscalationRequestSchema,
  respondApprovalRequestSchema,
  useEvidenceForTaskRequestSchema
} from "@workhub/contracts";

import app from "./app.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { jsonObjectMessage, malformedJsonMessage } from "./routes/json-body.js";

interface HealthBody {
  ok: true;
  service: string;
  runtime: string;
}

interface ErrorBody {
  ok: false;
  error: {
    code: string;
  };
}

type ZodRequestObject = {
  shape: Record<string, { isOptional: () => boolean }>;
};

const documentedMethods = new Set(["delete", "get", "head", "options", "patch", "post", "put"]);
const runtimeContractRouteIgnores = new Set(["/", "/openapi.json", "/api/openapi.json"]);

function normalizeContractPath(path: string) {
  return path.replace(/\/:([A-Za-z0-9_]+)/gu, "/{$1}").replace(/\/$/u, "") || "/";
}

function runtimeContractRoutes() {
  const routes = (app as typeof app & { routes?: Array<{ method: string; path: string }> }).routes ?? [];
  return new Set(
    routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method.toLowerCase()} ${normalizeContractPath(route.path)}`)
      .filter((route) => !runtimeContractRouteIgnores.has(route.split(" ")[1] ?? ""))
  );
}

function openApiContractRoutes(paths: Record<string, Record<string, unknown>>) {
  const routes = new Set<string>();
  for (const [path, operations] of Object.entries(paths)) {
    for (const method of Object.keys(operations)) {
      if (documentedMethods.has(method)) {
        routes.add(`${method} ${normalizeContractPath(path)}`);
      }
    }
  }
  return routes;
}

function jsonRequestProperties(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string
) {
  const schema = jsonRequestSchema(paths, path, method);
  return schema?.properties ?? {};
}

function jsonRequestSchema(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string
) {
  const operation = paths[path]?.[method] as {
    requestBody?: {
      required?: boolean;
      content?: {
        "application/json"?: {
          schema?: {
            properties?: Record<string, unknown>;
            required?: string[];
          };
        };
      };
    };
  } | undefined;
  return operation?.requestBody?.content?.["application/json"]?.schema;
}

function jsonRequestBodyRequired(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string
) {
  const operation = paths[path]?.[method] as { requestBody?: { required?: boolean } } | undefined;
  return operation?.requestBody?.required === true;
}

function jsonResponseSchema(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string,
  status: string
) {
  const operation = paths[path]?.[method] as {
    responses?: Record<string, {
      content?: {
        "application/json"?: {
          schema?: {
            properties?: Record<string, unknown>;
            required?: string[];
          };
        };
      };
    }>;
  } | undefined;
  return operation?.responses?.[status]?.content?.["application/json"]?.schema;
}

function jsonErrorCodeProperty(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string,
  status: string
) {
  const schema = jsonResponseSchema(paths, path, method, status);
  const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(schema?.required, ["ok", "error"], `${method.toUpperCase()} ${path} ${status} missing error envelope`);
  return error?.properties?.code;
}

function assertJsonErrorCodes(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string,
  status: string,
  codes: string[]
) {
  assert.deepEqual(jsonErrorCodeProperty(paths, path, method, status), {
    type: "string",
    enum: codes
  }, `${method.toUpperCase()} ${path} ${status} error codes drifted`);
}

function zodPropertyNames(schema: ZodRequestObject) {
  return Object.keys(schema.shape).sort();
}

function zodRequiredPropertyNames(schema: ZodRequestObject) {
  return Object.entries(schema.shape)
    .filter(([, field]) => !field.isOptional())
    .map(([name]) => name)
    .sort();
}

function assertJsonRequestMatchesZodObject(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string,
  schema: ZodRequestObject
) {
  const openApiSchema = jsonRequestSchema(paths, path, method);
  assert.deepEqual(
    Object.keys(openApiSchema?.properties ?? {}).sort(),
    zodPropertyNames(schema),
    `${method.toUpperCase()} ${path} request properties drifted from zod schema`
  );
  assert.deepEqual(
    [...(openApiSchema?.required ?? [])].sort(),
    zodRequiredPropertyNames(schema),
    `${method.toUpperCase()} ${path} required request properties drifted from zod schema`
  );
}

function responseObject(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string,
  status: string
) {
  const operation = paths[path]?.[method] as {
    responses?: Record<string, {
      headers?: Record<string, unknown>;
      content?: Record<string, unknown>;
    }>;
  } | undefined;
  return operation?.responses?.[status];
}

function operationParameters(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string
) {
  const operation = paths[path]?.[method] as {
    parameters?: Array<{
      name?: string;
      in?: string;
      required?: boolean;
      schema?: Record<string, unknown>;
    }>;
  } | undefined;
  return operation?.parameters ?? [];
}

function parameterByName(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string,
  name: string
) {
  return operationParameters(paths, path, method).find((parameter) => parameter.name === name);
}

test("GET /api/health returns the daemon health payload", async () => {
  const response = await app.request("/api/health");

  assert.equal(response.status, 200);
  const body = (await response.json()) as HealthBody;
  assert.equal(body.ok, true);
  assert.equal(body.service, "workhub-api");
  assert.equal(body.runtime, "node");
});

test("global body limit does not shadow the Drive upload size contract", async () => {
  const overJsonLimit = String(1_048_576 + 1);
  const regularJson = await app.request("/api/sessions", {
    method: "POST",
    headers: { "Content-Length": overJsonLimit, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(regularJson.status, 413);
  const regularBody = await regularJson.json() as ErrorBody;
  assert.equal(regularBody.error.code, "payload_too_large");

  const driveUpload = await app.request("/api/drive/projects/91000000-0000-4000-8000-000000000001/files", {
    method: "POST",
    headers: { "Content-Length": overJsonLimit, "Content-Type": "multipart/form-data; boundary=x" },
    body: "x"
  });
  assert.notEqual(driveUpload.status, 413);
  if (driveUpload.status >= 400) {
    const body = await driveUpload.json() as ErrorBody;
    assert.notEqual(body.error.code, "payload_too_large");
  }

  // R9 批次0-5：上传路由不是无限豁免——声明超过 34MiB（32MiB 文件 + 封装余量）在读 body 前直接 413；
  // 不声明 Content-Length 的 chunked 请求由路由内的流式边读边限量兜底（见 drive.ts readBoundedUploadBytes），
  // 未认证时保持 fail-closed 401/403（route-auth-posture）。
  const overDriveLimit = await app.request("/api/drive/projects/91000000-0000-4000-8000-000000000001/files", {
    method: "POST",
    headers: { "Content-Length": String(34 * 1024 * 1024 + 1), "Content-Type": "multipart/form-data; boundary=x" },
    body: "x"
  });
  assert.equal(overDriveLimit.status, 413);
  assert.equal(((await overDriveLimit.json()) as ErrorBody).error.code, "payload_too_large");
});

test("CORS preflight allows the desktop client token headers (cross-origin desktop fetch)", async () => {
  const response = await app.request("/api/sessions", {
    method: "OPTIONS",
    headers: {
      Origin: "http://tauri.localhost",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-yqgl-client-token, x-workhub-client-token, content-type"
    }
  });

  assert.equal(response.status, 204);
  const allowHeaders = (response.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
  // 桌面 webview 每个认证请求都带这两个令牌头；预检必须放行，否则跨源桌面写请求全被浏览器拦掉。
  assert.ok(allowHeaders.includes("x-yqgl-client-token"));
  assert.ok(allowHeaders.includes("x-workhub-client-token"));
});

test("R2 audit#28: CORS wildcard dev mode reflects loopback/tauri but not arbitrary internet origins", async () => {
  // 默认 CORS_ALLOW_ORIGINS='*'：本机回环 origin 仍被反射放行（dev web）。
  const loopback = await app.request("/api/sessions", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" }
  });
  assert.equal(loopback.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  // 任意互联网 origin 不再被反射——携带凭据的跨源读被挡（开发者浏览恶意站点也读不到 localhost daemon）。
  const arbitrary = await app.request("/api/sessions", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "POST" }
  });
  assert.notEqual(arbitrary.headers.get("Access-Control-Allow-Origin"), "https://evil.example.com");
});

test("GET /api/openapi.json exposes the headless daemon contract seed", async () => {
  const response = await app.request("/api/openapi.json");

  assert.equal(response.status, 200);
  const body = await response.json() as { openapi: string; paths: Record<string, Record<string, unknown>> };
  assert.equal(body.openapi, "3.1.0");
  const expectedRoutes = [
    ["get", "/api/health"],
    ["get", "/api/ready"],
    ["post", "/api/auth/identify"],
    ["post", "/api/auth/desktop-bootstrap"],
    ["post", "/api/auth/register"],
    ["post", "/api/auth/login"],
    ["post", "/api/auth/logout"],
    ["post", "/api/auth/password"],
    ["post", "/api/auth/invites"],
    ["post", "/api/auth/invites/accept"],
    ["patch", "/api/auth/preferences"],
    ["get", "/api/auth/me"],
    ["post", "/api/auth/users/{id}/deactivate"],
    ["post", "/api/client-devices/register"],
    ["get", "/api/client-devices/me"],
    ["get", "/api/client-devices/current"],
    ["post", "/api/client-devices/{deviceId}/revoke"],
    ["post", "/api/client-devices/revoke-current"],
    ["get", "/api/approvals"],
    ["post", "/api/approvals/{id}/respond"],
    ["post", "/api/approvals/{id}/delegate"],
    ["get", "/api/approvals/{id}/comments"],
    ["post", "/api/approvals/{id}/comments"],
    ["post", "/api/escalations/{id}/resolve"],
    ["post", "/api/escalations/{id}/budget-actions/{actionId}"],
    ["post", "/api/escalations/{id}/delegate"],
    ["post", "/api/memory-conflicts/{id}/resolve/{resolution}"],
    ["get", "/api/permissions"],
    ["put", "/api/permissions"],
    ["delete", "/api/permissions/{id}"],
    ["post", "/api/permissions/ask"],
    ["get", "/api/pages/attention"],
    ["get", "/api/pages/gold-path"],
    ["get", "/api/pages/approvals"],
    ["get", "/api/pages/workitems/{id}"],
    ["get", "/api/pages/proposals/{id}"],
    ["get", "/api/pages/drive"],
    ["get", "/api/pages/project/{id}"],
    ["get", "/api/pages/workbench/{projectId}"],
    ["get", "/api/pages/meetings"],
    ["get", "/api/pages/notifications"],
    ["get", "/api/pages/calendar"],
    ["get", "/api/pages/health"],
    ["get", "/api/pages/cost"],
    ["get", "/api/pages/agents"],
    ["get", "/api/pages/skills"],
    ["get", "/api/pages/settings"],
    ["get", "/api/drive/projects/{projectId}/items/{itemId}/download"],
    ["get", "/api/drive/projects/{projectId}/items/{itemId}/preview"],
    ["post", "/api/drive/projects/{projectId}/files"],
    ["post", "/api/drive/projects/{projectId}/items/{itemId}/delete"],
    ["post", "/api/drive/projects/{projectId}/items/{itemId}/restore"],
    ["post", "/api/drive/projects/{projectId}/comments/{commentId}/draft"],
    ["post", "/api/drive/workitems/{workItemId}/proposal-draft"],
    ["post", "/api/meetings/projects/{projectId}/insights/{insightId}/draft"],
    ["post", "/api/meetings/projects/{projectId}/insights/{insightId}/dismiss"],
    ["post", "/api/meetings/workitems/{workItemId}/proposal-draft"],
    ["get", "/api/notifications"],
    ["get", "/api/notifications/preferences"],
    ["put", "/api/notifications/preferences"],
    ["post", "/api/notifications/{id}/read"],
    ["post", "/api/notifications/read-all"],
    ["post", "/api/notifications/{id}/dismiss"],
    ["post", "/api/notifications/{id}/complete"],
    ["get", "/api/projects"],
    ["post", "/api/projects/bootstrap"],
    ["get", "/api/projects/{id}/conversations"],
    ["post", "/api/projects/{id}/conversations"],
    ["get", "/api/conversations/{id}/messages"],
    ["post", "/api/conversations/{id}/messages"],
    ["get", "/api/me/ai-profile"],
    ["patch", "/api/me/ai-profile"],
    ["get", "/api/projects/{id}/ai-governance"],
    ["patch", "/api/projects/{id}/ai-governance"],
    ["post", "/api/workitems/{id}/proposals"],
    ["get", "/api/workitems/{id}/proposals"],
    ["get", "/api/workitems/{id}/conflicts"],
    ["get", "/api/proposals/{id}"],
    ["post", "/api/proposals/{id}/review"],
    ["post", "/api/proposals/{id}/merge"],
    ["post", "/api/proposals/{id}/rebase"],
    ["post", "/api/merge-proposals/{id}/choose"],
    ["post", "/api/merge-proposals/{id}/apply"],
    ["get", "/api/cost/usage"],
    ["get", "/api/cost/policies"],
    ["put", "/api/cost/policies/{scope}/{id}"],
    ["post", "/api/workitems/{id}/agent-runs"],
    ["get", "/api/agent-runs/{id}"],
    ["get", "/api/agent-runs/{id}/trace"],
    ["get", "/api/agent-runs/{id}/handoff"],
    ["post", "/api/agent-runs/{id}/abort"],
    ["get", "/api/agent-runs/{id}/replay"],
    ["post", "/api/agent-runs/{id}/revert"],
    ["post", "/api/sessions"],
    ["get", "/api/sessions/{id}"],
    ["post", "/api/sessions/{id}/next-question"],
    ["get", "/api/push/stream"],
    ["get", "/api/push/stream/me"],
    ["get", "/api/push/stream/workitem/{id}"],
    ["get", "/api/push/stream/req/{id}"],
    ["get", "/api/push/stream/run/{id}"],
    ["get", "/api/push/stream/session/{id}"],
    ["get", "/api/push/stream/proposal/{id}"],
    ["get", "/api/push/stream/conversation/{id}"],
    ["post", "/api/workitems"],
    ["post", "/api/workitems/{id}/evidence-bindings"],
    ["get", "/api/workitems/{id}/deliverables/{acceptedChangeId}/download"],
    ["get", "/api/workitems/{id}/deliverables/{acceptedChangeId}/preview"],
    ["post", "/api/workitems/{id}/deliverables/{acceptedChangeId}/restore"],
    ["post", "/api/knowledge/search"],
    ["get", "/api/workitems/{id}/audit"],
    ["get", "/api/pilot/day1/metrics"],
    ["get", "/api/ai-worklog/today"],
    ["get", "/api/conversations/{id}/army"],
    ["get", "/api/me/army"],
    ["post", "/api/action-card-items/{id}/decide"],
    ["post", "/api/action-card-items/{id}/undo"],
    ["post", "/api/conversations/{id}/turns"],
    ["post", "/api/conversations/{id}/typing"],
    ["patch", "/api/conversations/{id}/messages/{messageId}"],
    ["delete", "/api/conversations/{id}/messages/{messageId}"],
    ["put", "/api/conversations/{id}/messages/{messageId}/reactions/{key}"],
    ["delete", "/api/conversations/{id}/messages/{messageId}/reactions/{key}"],
    ["put", "/api/conversations/{id}/messages/{messageId}/pin"],
    ["delete", "/api/conversations/{id}/messages/{messageId}/pin"],
    ["get", "/api/conversations/{id}/pins"],
    ["put", "/api/conversations/{id}/read"],
    ["get", "/api/conversations/{id}/receipts"],
    ["get", "/api/presence"],
    ["post", "/api/spotlight/intent"],
    ["get", "/api/me/personal-projects"],
    ["post", "/api/me/personal-projects"],
    ["get", "/api/drive/projects/{projectId}/items/{itemId}/versions"],
    ["post", "/api/drive/projects/{projectId}/items/{itemId}/versions/{versionId}/restore"]
  ] as const;
  for (const [method, route] of expectedRoutes) {
    assert.ok(body.paths[route]?.[method], `${method.toUpperCase()} ${route} missing from OpenAPI document`);
  }
  const driveUpload = body.paths["/api/drive/projects/{projectId}/files"]?.post as {
    requestBody?: {
      content?: {
        "application/json"?: { schema?: { properties?: Record<string, unknown> } };
        "multipart/form-data"?: { schema?: { properties?: Record<string, unknown> } };
      };
    };
  } | undefined;
  assert.ok(driveUpload?.requestBody?.content?.["application/json"]?.schema?.properties?.parent_id);
  assert.ok(driveUpload?.requestBody?.content?.["multipart/form-data"]?.schema?.properties?.parent_id);
});

test("R12 conversation runtime and OpenAPI expose only the four batch-0 HTTP endpoints", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const projectPath = body.paths["/api/projects/{id}/conversations"] as {
    get?: {
      parameters?: Array<{ name: string; in: string; description?: string; "x-workhub-paired-with"?: string }>;
      responses?: Record<string, unknown>;
      "x-workhub-query-constraints"?: { allOrNone?: string[][] };
    };
    post?: {
      parameters?: Array<{ name: string; in: string }>;
      requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
      responses?: Record<string, unknown>;
    };
  } | undefined;
  const messagePath = body.paths["/api/conversations/{id}/messages"] as {
    get?: {
      parameters?: Array<{ name: string; in: string; description?: string; "x-workhub-mutually-exclusive-with"?: string }>;
      responses?: Record<string, unknown>;
      "x-workhub-query-constraints"?: { exclusive?: string[][] };
    };
    post?: {
      parameters?: Array<{ name: string; in: string }>;
      requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
      responses?: Record<string, unknown>;
    };
  } | undefined;

  assert.deepEqual(projectPath?.get?.parameters?.map((parameter) => `${parameter.in}:${parameter.name}`), [
    "path:id",
    "query:afterCreatedAt",
    "query:afterId",
    "query:limit"
  ]);
  assert.deepEqual(projectPath?.post?.parameters?.map((parameter) => `${parameter.in}:${parameter.name}`), [
    "path:id"
  ]);
  assert.deepEqual(messagePath?.get?.parameters?.map((parameter) => `${parameter.in}:${parameter.name}`), [
    "path:id",
    "query:afterSeq",
    "query:beforeSeq",
    "query:limit"
  ]);
  assert.deepEqual(messagePath?.post?.parameters?.map((parameter) => `${parameter.in}:${parameter.name}`), [
    "path:id"
  ]);
  assert.deepEqual(Object.keys(projectPath?.get?.responses ?? {}).sort(), ["200", "401", "403", "404", "422", "500"]);
  assert.deepEqual(Object.keys(projectPath?.post?.responses ?? {}).sort(), ["201", "400", "401", "403", "404", "413", "422", "500"]);
  assert.deepEqual(Object.keys(messagePath?.get?.responses ?? {}).sort(), ["200", "401", "403", "404", "422", "500"]);
  assert.deepEqual(Object.keys(messagePath?.post?.responses ?? {}).sort(), ["201", "400", "401", "403", "404", "409", "413", "422", "500"]);
  assertJsonErrorCodes(body.paths, "/api/projects/{id}/conversations", "post", "413", ["payload_too_large"]);
  assertJsonErrorCodes(body.paths, "/api/conversations/{id}/messages", "post", "413", ["payload_too_large"]);

  assert.deepEqual(projectPath?.get?.["x-workhub-query-constraints"], {
    allOrNone: [["afterCreatedAt", "afterId"]]
  });
  const createdAtParameter = projectPath?.get?.parameters?.find((parameter) => parameter.name === "afterCreatedAt");
  const afterIdParameter = projectPath?.get?.parameters?.find((parameter) => parameter.name === "afterId");
  assert.equal(createdAtParameter?.["x-workhub-paired-with"], "afterId");
  assert.equal(afterIdParameter?.["x-workhub-paired-with"], "afterCreatedAt");
  assert.match(createdAtParameter?.description ?? "", /must be provided together/iu);
  assert.match(afterIdParameter?.description ?? "", /must be provided together/iu);

  // R12 批8：beforeSeq（反向翻页）与 afterSeq 互斥——同 afterCreatedAt/afterId 配对标记同款模式，
  // 只是语义反过来（互斥而非成对）。
  assert.deepEqual(messagePath?.get?.["x-workhub-query-constraints"], {
    exclusive: [["afterSeq", "beforeSeq"]]
  });
  const afterSeqParameter = messagePath?.get?.parameters?.find((parameter) => parameter.name === "afterSeq");
  const beforeSeqParameter = messagePath?.get?.parameters?.find((parameter) => parameter.name === "beforeSeq");
  assert.equal(afterSeqParameter?.["x-workhub-mutually-exclusive-with"], "beforeSeq");
  assert.equal(beforeSeqParameter?.["x-workhub-mutually-exclusive-with"], "afterSeq");
  assert.match(afterSeqParameter?.description ?? "", /mutually exclusive/iu);
  assert.match(beforeSeqParameter?.description ?? "", /mutually exclusive/iu);

  const projectBody = projectPath?.post?.requestBody?.content?.["application/json"]?.schema as {
    properties?: Record<string, unknown>;
    required?: string[];
    dependentRequired?: Record<string, string[]>;
  } | undefined;
  assert.deepEqual(projectBody?.required, ["kind", "title", "visibility"]);
  assert.deepEqual(Object.keys(projectBody?.properties ?? {}).sort(), [
    "cuu_enabled",
    "kind",
    "parent_conversation_id",
    "participant_user_ids",
    "source_message_id",
    "title",
    "visibility"
  ]);
  assert.deepEqual(projectBody?.dependentRequired, {
    source_message_id: ["parent_conversation_id"]
  });
  const participants = projectBody?.properties?.participant_user_ids as {
    uniqueItems?: boolean;
    description?: string;
    "x-workhub-case-insensitive-unique"?: boolean;
  } | undefined;
  assert.equal(participants?.uniqueItems, true);
  assert.equal(participants?.["x-workhub-case-insensitive-unique"], true);
  assert.match(participants?.description ?? "", /case-insensitive/iu);

  const messageBody = messagePath?.post?.requestBody?.content?.["application/json"]?.schema as {
    oneOf?: Array<{
      properties?: {
        kind?: { const?: string };
        content?: { properties?: Record<string, unknown> };
      };
    }>;
  } | undefined;
  const fileVariant = messageBody?.oneOf?.find((variant) => variant.properties?.kind?.const === "file_card");
  assert.deepEqual(Object.keys(fileVariant?.properties?.content?.properties ?? {}), ["drive_item_id"]);

  // R12 批3落地后,decide/undo 的真实路径是 /api/action-card-items/{id}/*(见 routes/action-cards.ts);
  // 批0 预占的会话嵌套形态从未实现,必须继续保持未文档化,防止旧猜测路径复活。
  for (const stale of [
    "/api/conversations/{id}/action-cards/{itemId}/decide",
    "/api/conversations/{id}/action-cards/{itemId}/undo"
  ]) {
    assert.equal(body.paths[stale], undefined, `${stale} is a superseded speculative path and must stay undocumented`);
  }
});

test("R12 AI settings runtime and OpenAPI expose four strict secret-free operations", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const profilePath = body.paths["/api/me/ai-profile"] as {
    get?: { responses?: Record<string, unknown> };
    patch?: {
      requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
      responses?: Record<string, unknown>;
    };
  } | undefined;
  const governancePath = body.paths["/api/projects/{id}/ai-governance"] as {
    get?: { parameters?: unknown[]; responses?: Record<string, unknown> };
    patch?: {
      parameters?: unknown[];
      requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
      responses?: Record<string, unknown>;
    };
  } | undefined;

  assert.deepEqual(
    Object.keys(body.paths).filter((path) => path.includes("ai-profile") || path.includes("ai-governance")).sort(),
    ["/api/me/ai-profile", "/api/projects/{id}/ai-governance"]
  );
  assert.deepEqual(Object.keys(profilePath ?? {}).sort(), ["get", "patch"]);
  assert.deepEqual(Object.keys(governancePath ?? {}).sort(), ["get", "patch"]);
  assert.deepEqual(
    parameterByName(body.paths, "/api/projects/{id}/ai-governance", "get", "id"),
    { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }
  );
  assert.deepEqual(
    parameterByName(body.paths, "/api/projects/{id}/ai-governance", "patch", "id"),
    { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }
  );

  assert.deepEqual(Object.keys(profilePath?.get?.responses ?? {}).sort(), ["200", "401", "403", "500"]);
  assert.deepEqual(
    Object.keys(profilePath?.patch?.responses ?? {}).sort(),
    ["200", "400", "401", "403", "413", "422", "500"]
  );
  assert.deepEqual(
    Object.keys(governancePath?.get?.responses ?? {}).sort(),
    ["200", "401", "403", "404", "500"]
  );
  assert.deepEqual(
    Object.keys(governancePath?.patch?.responses ?? {}).sort(),
    ["200", "400", "401", "403", "404", "413", "422", "500"]
  );
  assertJsonErrorCodes(body.paths, "/api/me/ai-profile", "patch", "400", [
    "malformed_json",
    "json_object_required"
  ]);
  assertJsonErrorCodes(body.paths, "/api/me/ai-profile", "patch", "413", ["payload_too_large"]);
  assertJsonErrorCodes(body.paths, "/api/me/ai-profile", "patch", "422", [
    "validation_error",
    "ai_model_preference_unavailable"
  ]);
  assertJsonErrorCodes(body.paths, "/api/projects/{id}/ai-governance", "get", "404", [
    "ai_governance_not_found"
  ]);
  assertJsonErrorCodes(body.paths, "/api/projects/{id}/ai-governance", "patch", "400", [
    "malformed_json",
    "json_object_required"
  ]);
  assertJsonErrorCodes(body.paths, "/api/projects/{id}/ai-governance", "patch", "413", [
    "payload_too_large"
  ]);
  assertJsonErrorCodes(body.paths, "/api/projects/{id}/ai-governance", "patch", "422", [
    "validation_error"
  ]);

  const profileRequest = jsonRequestSchema(body.paths, "/api/me/ai-profile", "patch") as {
    minProperties?: number;
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
  } | undefined;
  assert.equal(profileRequest?.minProperties, 1);
  assert.equal(profileRequest?.additionalProperties, false);
  assert.deepEqual(Object.keys(profileRequest?.properties ?? {}).sort(), [
    "cuu_proactivity",
    "default_mode",
    "dispatch_policy",
    "granular_settings",
    "model_tier_preference"
  ]);
  const modelPreference = profileRequest?.properties?.model_tier_preference as {
    anyOf?: Array<Record<string, unknown>>;
    description?: string;
  } | undefined;
  assert.deepEqual(modelPreference?.anyOf, [
    {
      type: "string",
      minLength: 1,
      maxLength: 32,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$"
    },
    { type: "null" }
  ]);
  assert.match(modelPreference?.description ?? "", /provider model id/iu);

  const governanceRequest = jsonRequestSchema(
    body.paths,
    "/api/projects/{id}/ai-governance",
    "patch"
  ) as {
    minProperties?: number;
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
  } | undefined;
  assert.equal(governanceRequest?.minProperties, 1);
  assert.equal(governanceRequest?.additionalProperties, false);
  const quietHours = governanceRequest?.properties?.quiet_hours as {
    oneOf?: Array<{
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    }>;
    "x-workhub-runtime-supported-timezone"?: boolean;
    "x-workhub-start-end-must-differ"?: boolean;
  } | undefined;
  assert.equal(quietHours?.["x-workhub-runtime-supported-timezone"], true);
  assert.equal(quietHours?.["x-workhub-start-end-must-differ"], true);
  assert.equal(quietHours?.oneOf?.length, 2);
  assert.equal(quietHours?.oneOf?.every((variant) => variant.additionalProperties === false), true);
  const enabledQuietHours = quietHours?.oneOf?.find((variant) =>
    (variant.properties?.enabled as { const?: boolean } | undefined)?.const === true
  );
  assert.deepEqual(enabledQuietHours?.required, [
    "enabled",
    "timezone",
    "start_minute",
    "end_minute",
    "weekdays"
  ]);
  assert.deepEqual(enabledQuietHours?.properties?.start_minute, {
    type: "integer",
    minimum: 0,
    maximum: 1439
  });
  assert.deepEqual(enabledQuietHours?.properties?.weekdays, {
    type: "array",
    minItems: 1,
    maxItems: 7,
    uniqueItems: true,
    items: { type: "integer", minimum: 0, maximum: 6 }
  });

  const profileResponse = jsonResponseSchema(body.paths, "/api/me/ai-profile", "get", "200");
  const profileData = profileResponse?.properties?.data as {
    required?: string[];
    properties?: Record<string, unknown>;
    additionalProperties?: boolean;
  } | undefined;
  assert.deepEqual(profileResponse?.required, ["ok", "data"]);
  assert.deepEqual(profileData?.required, [
    "workspace_id",
    "user_id",
    "default_mode",
    "granular_settings",
    "dispatch_policy",
    "cuu_proactivity",
    "model_tier_preference",
    "providers",
    "budget_summary",
    "generated_at",
    "updated_at"
  ]);
  assert.equal(profileData?.additionalProperties, false);
  const serializedProfileSchema = JSON.stringify(profileData);
  for (const secretField of ["api_key", "base_url", "storage_secret"]) {
    assert.equal(serializedProfileSchema.includes(secretField), false, `profile schema leaked ${secretField}`);
  }
  const providerSchema = (profileData?.properties?.providers as {
    items?: { properties?: Record<string, unknown>; additionalProperties?: boolean };
  } | undefined)?.items;
  assert.equal(providerSchema?.additionalProperties, false);
  const modelsSchema = providerSchema?.properties?.models as {
    minItems?: number;
    items?: { additionalProperties?: boolean };
    "x-workhub-unique-model-ids"?: boolean;
    "x-workhub-contains-default-model-id"?: boolean;
  } | undefined;
  assert.equal(modelsSchema?.minItems, 1);
  assert.equal(modelsSchema?.items?.additionalProperties, false);
  assert.equal(modelsSchema?.["x-workhub-unique-model-ids"], true);
  assert.equal(modelsSchema?.["x-workhub-contains-default-model-id"], true);
  const budget = profileData?.properties?.budget_summary as { properties?: Record<string, unknown> } | undefined;
  const usage = budget?.properties?.usage as { properties?: Record<string, unknown> } | undefined;
  const month = usage?.properties?.month as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(Object.keys(month?.properties ?? {}).sort(), [
    "estimated_cost_cny",
    "period",
    "token_in",
    "token_out",
    "total_tokens"
  ]);

  const governanceResponse = jsonResponseSchema(
    body.paths,
    "/api/projects/{id}/ai-governance",
    "get",
    "200"
  );
  const governanceData = governanceResponse?.properties?.data as {
    required?: string[];
    additionalProperties?: boolean;
  } | undefined;
  assert.deepEqual(governanceData?.required, [
    "project_id",
    "observer_enabled",
    "silence_window_seconds",
    "quiet_hours",
    "granular_settings",
    "updated_at"
  ]);
  assert.equal(governanceData?.additionalProperties, false);

  for (const path of [
    "/api/me/ai-profile",
    `/api/projects/14000000-0000-4000-8000-000000000004/ai-governance`
  ]) {
    const overLimit = await app.request(path, {
      method: "PATCH",
      headers: {
        "Content-Length": String(1_048_576 + 1),
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    assert.equal(overLimit.status, 413);
    assert.equal((await overLimit.json() as ErrorBody).error.code, "payload_too_large");
  }
});

test("runtime API routes stay in lockstep with the OpenAPI document", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const runtimeRoutes = runtimeContractRoutes();
  const openApiRoutes = openApiContractRoutes(body.paths);

  assert.deepEqual({
    missingFromOpenApi: [...runtimeRoutes].filter((route) => !openApiRoutes.has(route)).sort(),
    staleOpenApiRoutes: [...openApiRoutes].filter((route) => !runtimeRoutes.has(route)).sort()
  }, {
    missingFromOpenApi: [],
    staleOpenApiRoutes: []
  });
});

test("templated OpenAPI paths declare their required path parameters", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const missing: string[] = [];

  for (const [path, operations] of Object.entries(body.paths)) {
    const pathParamNames = [...path.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]).filter((name): name is string => Boolean(name));
    if (pathParamNames.length === 0) {
      continue;
    }
    for (const method of Object.keys(operations)) {
      if (!documentedMethods.has(method)) {
        continue;
      }
      const declared = operationParameters(body.paths, path, method).filter((parameter) => parameter.in === "path");
      for (const name of pathParamNames) {
        const parameter = declared.find((candidate) => candidate.name === name);
        if (!parameter || parameter.required !== true) {
          missing.push(`${method.toUpperCase()} ${path} missing required path parameter ${name}`);
        }
      }
    }
  }

  assert.deepEqual(missing, []);
});

test("core JSON mutation routes document their request body fields", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/sessions", "post")).sort(), [
    "intent_text",
    "project_id",
    "title",
    "work_item_id"
  ]);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/projects/bootstrap", "post")).sort(), [
    "description",
    "name",
    "slug"
  ]);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/workitems", "post")).sort(), [
    "cuu_launcher_spec",
    "free_text",
    "kickoff_agent",
    "project_id",
    "raw_description",
    "selected_option_ids",
    "session_id",
    "title"
  ]);
  assert.deepEqual(
    Object.keys(jsonRequestProperties(body.paths, "/api/workitems/{id}/evidence-bindings", "post")).sort(),
    ["evidence_bubble_id", "evidence_refs", "note"]
  );
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/knowledge/search", "post")).sort(), [
    "limit",
    "project_id",
    "q",
    "query",
    "run",
    "scope",
    "source_ref",
    "work_item_id"
  ]);
});

test("core JSON mutation routes document optional bodies and nested fields accurately", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/sessions", "post"), false);
  assert.equal(jsonRequestBodyRequired(body.paths, "/api/projects/bootstrap", "post"), false);
  assert.equal(jsonRequestBodyRequired(body.paths, "/api/knowledge/search", "post"), false);
  assert.equal(jsonRequestBodyRequired(body.paths, "/api/workitems", "post"), true);
  assert.equal(jsonRequestBodyRequired(body.paths, "/api/workitems/{id}/evidence-bindings", "post"), true);

  const workItemProps = jsonRequestProperties(body.paths, "/api/workitems", "post");
  const cuuSpec = workItemProps.cuu_launcher_spec as {
    required?: string[];
    properties?: Record<string, { type?: string; enum?: string[]; items?: { properties?: Record<string, unknown> } }>;
  };
  assert.deepEqual(cuuSpec.required, ["source", "selected_options"]);
  assert.deepEqual(cuuSpec.properties?.source?.enum, ["cuu_desktop_launcher"]);
  assert.deepEqual(Object.keys(cuuSpec.properties?.selected_options?.items?.properties ?? {}).sort(), [
    "default_acceptance",
    "delivery_kind",
    "description",
    "id",
    "label",
    "risk_hint"
  ]);

  const evidenceProps = jsonRequestProperties(body.paths, "/api/workitems/{id}/evidence-bindings", "post");
  const evidenceRefs = evidenceProps.evidence_refs as {
    items?: { required?: string[]; properties?: Record<string, unknown> };
  };
  assert.deepEqual(evidenceRefs.items?.required, ["id", "source_type", "source_id", "title"]);
  assert.deepEqual(Object.keys(evidenceRefs.items?.properties ?? {}).sort(), [
    "confidence_hint",
    "excerpt",
    "href",
    "id",
    "locator",
    "source_id",
    "source_type",
    "title"
  ]);

  const knowledgeResponse = jsonResponseSchema(body.paths, "/api/knowledge/search", "post", "200");
  const knowledgeData = knowledgeResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(knowledgeResponse?.required, ["ok", "data", "meta"]);
  assert.deepEqual(knowledgeData?.required, ["id", "summary_text", "evidence_refs", "actions"]);
  assert.deepEqual(Object.keys(knowledgeData?.properties ?? {}).sort(), [
    "actions",
    "evidence_refs",
    "id",
    "missing_evidence_note",
    "query_text",
    "summary_text"
  ]);
});

test("OpenAPI JSON request bodies stay aligned with zod input contracts", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const { path, method, schema } of [
    { path: "/api/permissions", method: "put", schema: permissionPolicyWriteSchema },
    { path: "/api/permissions/ask", method: "post", schema: createApprovalRequestSchema },
    { path: "/api/approvals/{id}/respond", method: "post", schema: respondApprovalRequestSchema },
    { path: "/api/approvals/{id}/delegate", method: "post", schema: delegateApprovalRequestSchema },
    { path: "/api/approvals/{id}/comments", method: "post", schema: addApprovalCommentRequestSchema },
    { path: "/api/escalations/{id}/resolve", method: "post", schema: resolveEscalationRequestSchema },
    { path: "/api/escalations/{id}/delegate", method: "post", schema: delegateEscalationRequestSchema },
    { path: "/api/workitems/{id}/evidence-bindings", method: "post", schema: useEvidenceForTaskRequestSchema },
    { path: "/api/me/ai-profile", method: "patch", schema: patchUserAiProfileRequestSchema },
    {
      path: "/api/projects/{id}/ai-governance",
      method: "patch",
      schema: patchProjectAiGovernanceRequestSchema
    }
  ] as const) {
    assertJsonRequestMatchesZodObject(body.paths, path, method, schema);
  }
});

test("project and drive OpenAPI routes document runtime path and query parameters", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  assert.deepEqual(operationParameters(body.paths, "/api/pages/project/{id}", "get"), [
    { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);
  assert.deepEqual(operationParameters(body.paths, "/api/pages/drive", "get"), [
    { name: "project_id", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    { name: "item_id", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);

  for (const [path, method, names] of [
    ["/api/drive/projects/{projectId}/items/{itemId}/download", "get", ["projectId", "itemId"]],
    ["/api/drive/projects/{projectId}/items/{itemId}/preview", "get", ["projectId", "itemId"]],
    ["/api/drive/projects/{projectId}/files", "post", ["projectId"]],
    ["/api/drive/projects/{projectId}/items/{itemId}/delete", "post", ["projectId", "itemId"]],
    ["/api/drive/projects/{projectId}/items/{itemId}/restore", "post", ["projectId", "itemId"]],
    ["/api/drive/projects/{projectId}/comments/{commentId}/draft", "post", ["projectId", "commentId"]],
    ["/api/drive/workitems/{workItemId}/proposal-draft", "post", ["workItemId"]],
    ["/api/meetings/projects/{projectId}/insights/{insightId}/draft", "post", ["projectId", "insightId"]],
    ["/api/meetings/projects/{projectId}/insights/{insightId}/dismiss", "post", ["projectId", "insightId"]],
    ["/api/meetings/workitems/{workItemId}/proposal-draft", "post", ["workItemId"]],
    ["/api/workitems/{id}/proposals", "post", ["id"]],
    ["/api/workitems/{id}/proposals", "get", ["id"]],
	    ["/api/workitems/{id}/conflicts", "get", ["id"]],
	    ["/api/proposals/{id}", "get", ["id"]],
	    ["/api/proposals/{id}/review", "post", ["id"]],
	    ["/api/proposals/{id}/merge", "post", ["id"]],
	    ["/api/proposals/{id}/rebase", "post", ["id"]],
	    ["/api/merge-proposals/{id}/choose", "post", ["id"]],
	    ["/api/merge-proposals/{id}/apply", "post", ["id"]],
	    ["/api/sessions/{id}", "get", ["id"]],
	    ["/api/sessions/{id}/next-question", "post", ["id"]],
	    ["/api/workitems/{id}/evidence-bindings", "post", ["id"]],
	    ["/api/workitems/{id}/agent-runs", "post", ["id"]],
	    ["/api/agent-runs/{id}", "get", ["id"]],
	    ["/api/agent-runs/{id}/trace", "get", ["id"]],
	    ["/api/agent-runs/{id}/handoff", "get", ["id"]],
	    ["/api/agent-runs/{id}/abort", "post", ["id"]],
	    ["/api/agent-runs/{id}/replay", "get", ["id"]],
	    ["/api/agent-runs/{id}/revert", "post", ["id"]],
	    ["/api/approvals/{id}/respond", "post", ["id"]],
	    ["/api/approvals/{id}/delegate", "post", ["id"]],
	    ["/api/approvals/{id}/comments", "get", ["id"]],
	    ["/api/approvals/{id}/comments", "post", ["id"]],
	    ["/api/escalations/{id}/resolve", "post", ["id"]],
	    ["/api/escalations/{id}/delegate", "post", ["id"]],
	    ["/api/memory-conflicts/{id}/resolve/{resolution}", "post", ["id"]],
	    ["/api/permissions/{id}", "delete", ["id"]]
	  ] as const) {
    for (const name of names) {
      assert.deepEqual(parameterByName(body.paths, path, method, name), {
        name,
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" }
      });
    }
  }

  for (const [path, method] of [
    ["/api/drive/projects/{projectId}/files", "post"],
    ["/api/drive/projects/{projectId}/items/{itemId}/delete", "post"],
    ["/api/drive/projects/{projectId}/items/{itemId}/restore", "post"],
    ["/api/drive/projects/{projectId}/comments/{commentId}/draft", "post"],
	    ["/api/drive/workitems/{workItemId}/proposal-draft", "post"],
	    ["/api/meetings/projects/{projectId}/insights/{insightId}/draft", "post"],
	    ["/api/meetings/projects/{projectId}/insights/{insightId}/dismiss", "post"],
	    ["/api/meetings/workitems/{workItemId}/proposal-draft", "post"],
	    ["/api/proposals/{id}/review", "post"],
	    ["/api/proposals/{id}/merge", "post"],
	    ["/api/merge-proposals/{id}/apply", "post"]
	  ] as const) {
    assert.deepEqual(parameterByName(body.paths, path, method, "locale"), {
      name: "locale",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["zh-CN", "en-US"] }
    }, `${method.toUpperCase()} ${path} missing locale query parameter`);
  }
});

test("R12 workbench OpenAPI locks the bounded strict VM, invariants, and non-oracle errors", async () => {
  type OpenApiSchema = {
    additionalProperties?: boolean;
    enum?: unknown[];
    items?: OpenApiSchema;
    maxItems?: number;
    properties?: Record<string, OpenApiSchema>;
    required?: string[];
  };
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const path = "/api/pages/workbench/{projectId}";
  const operation = body.paths[path]?.get as {
    responses?: Record<string, unknown>;
    "x-workhub-invariants"?: string[];
  } | undefined;

  assert.deepEqual(operationParameters(body.paths, path, "get"), [
    { name: "projectId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);
  assert.deepEqual(Object.keys(operation?.responses ?? {}).sort(), ["200", "401", "403", "404", "500"]);
  assert.deepEqual(operation?.["x-workhub-invariants"], [
    "Exactly one conversation is kind=main; every conversation matches data.project.id and workspace_id.",
    "conversations.capped is true if and only if conversations.next_cursor is non-null.",
    "workspace_members.total is at least returned; returned equals items.length; capped is true if and only if total is greater than returned.",
    "Exactly one returned workspace member is self; it is first and matches viewer.user_id, viewer.membership_role, and viewer.is_project_owner.",
    "At most one returned workspace member is the project owner.",
    "army_summary and recent_project_files expose their empty_state exactly when their corresponding result is empty."
  ]);

  const envelope = jsonResponseSchema(body.paths, path, "get", "200") as OpenApiSchema | undefined;
  const data = envelope?.properties?.data;
  const meta = envelope?.properties?.meta;
  assert.equal(envelope?.additionalProperties, false);
  assert.deepEqual(envelope?.required, ["ok", "data", "meta"]);
  assert.equal(meta?.additionalProperties, false);
  assert.deepEqual(meta?.required, ["locale"]);
  assert.equal(data?.additionalProperties, false);
  assert.deepEqual(data?.required, [
    "generated_at",
    "project",
    "viewer",
    "conversations",
    "workspace_members",
    "army_summary",
    "recent_project_files"
  ]);
  assert.deepEqual(Object.keys(data?.properties ?? {}).sort(), [
    "army_summary",
    "conversations",
    "generated_at",
    "project",
    "recent_project_files",
    "viewer",
    "workspace_members"
  ]);

  const project = data?.properties?.project;
  assert.equal(project?.additionalProperties, false);
  assert.deepEqual(project?.required, ["id", "workspace_id", "name", "slug", "description", "owner_label"]);
  const viewer = data?.properties?.viewer;
  assert.equal(viewer?.additionalProperties, false);
  assert.deepEqual(viewer?.required, ["user_id", "membership_role", "is_project_owner"]);
  assert.deepEqual(viewer?.properties?.membership_role?.enum, ["member", "admin", "owner"]);

  const conversations = data?.properties?.conversations;
  assert.equal(conversations?.additionalProperties, false);
  assert.deepEqual(conversations?.required, ["conversations", "capped", "next_cursor"]);
  assert.equal(conversations?.properties?.conversations?.maxItems, 50);
  assert.equal(conversations?.properties?.conversations?.items?.additionalProperties, false);
  assert.deepEqual(conversations?.properties?.conversations?.items?.required, [
    "id",
    "workspace_id",
    "project_id",
    "kind",
    "title",
    "parent_conversation_id",
    "source_message_id",
    "visibility",
    "cuu_enabled",
    "next_seq",
    "created_by",
    "participant_role",
    "created_at",
    "updated_at"
  ]);

  const memberPage = data?.properties?.workspace_members;
  const member = memberPage?.properties?.items?.items;
  assert.equal(memberPage?.additionalProperties, false);
  assert.deepEqual(memberPage?.required, ["scope", "total", "returned", "capped", "items"]);
  assert.deepEqual(memberPage?.properties?.scope?.enum, ["workspace"]);
  assert.equal(memberPage?.properties?.items?.maxItems, 100);
  assert.equal(member?.additionalProperties, false);
  assert.deepEqual(member?.required, [
    "user_id",
    "nickname",
    "membership_role",
    "is_project_owner",
    "is_self"
  ]);
  assert.deepEqual(member?.properties?.membership_role?.enum, ["member", "admin", "owner"]);

  const army = data?.properties?.army_summary;
  assert.equal(army?.additionalProperties, false);
  assert.deepEqual(army?.required, ["active_plan_count"]);
  assert.deepEqual(army?.properties?.empty_state?.enum, ["no_active_armies"]);
  const files = data?.properties?.recent_project_files;
  assert.equal(files?.additionalProperties, false);
  assert.deepEqual(files?.required, ["items"]);
  assert.equal(files?.properties?.items?.maxItems, 5);
  assert.equal(files?.properties?.items?.items?.additionalProperties, false);
  assert.deepEqual(files?.properties?.items?.items?.required, ["id", "name", "updated_at", "href"]);
  assert.deepEqual(files?.properties?.empty_state?.enum, ["no_recent_files"]);

  assertJsonErrorCodes(body.paths, path, "get", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, path, "get", "403", ["invalid_client_token"]);
  assertJsonErrorCodes(body.paths, path, "get", "404", ["workbench_not_found"]);
  assertJsonErrorCodes(body.paths, path, "get", "500", ["internal_contract_error", "internal_error"]);
});

test("push streams and audit OpenAPI routes document runtime UUID guards and responses", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const path of [
    "/api/push/stream/workitem/{id}",
    "/api/push/stream/req/{id}",
    "/api/push/stream/run/{id}",
    "/api/push/stream/session/{id}",
    "/api/push/stream/proposal/{id}",
    "/api/push/stream/conversation/{id}"
  ] as const) {
    assert.deepEqual(parameterByName(body.paths, path, "get", "id"), {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" }
    });
  }

  for (const path of [
    "/api/push/stream",
    "/api/push/stream/me",
    "/api/push/stream/workitem/{id}",
    "/api/push/stream/req/{id}",
    "/api/push/stream/run/{id}",
    "/api/push/stream/session/{id}",
    "/api/push/stream/proposal/{id}",
    "/api/push/stream/conversation/{id}"
  ] as const) {
    assert.ok(
      responseObject(body.paths, path, "get", "200")?.content?.["text/event-stream"],
      `GET ${path} missing text/event-stream response`
    );
  }
  for (const path of [
    "/api/push/stream",
    "/api/push/stream/me",
    "/api/push/stream/workitem/{id}",
    "/api/push/stream/req/{id}",
    "/api/push/stream/run/{id}",
    "/api/push/stream/session/{id}",
    "/api/push/stream/proposal/{id}",
    "/api/push/stream/conversation/{id}"
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, "get", "401"), {
      type: "string",
      enum: ["not_identified"]
    });
  }
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/push/stream/me", "get", "403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });
  for (const path of [
    "/api/push/stream",
    "/api/push/stream/workitem/{id}",
    "/api/push/stream/req/{id}",
    "/api/push/stream/run/{id}",
    "/api/push/stream/session/{id}",
    "/api/push/stream/proposal/{id}",
    "/api/push/stream/conversation/{id}"
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, "get", "403"), {
      type: "string",
      enum: ["invalid_client_token", "forbidden"]
    });
  }

  const conversationStream = body.paths["/api/push/stream/conversation/{id}"]?.get as {
    responses?: Record<string, { description?: string }>;
  } | undefined;
  assert.deepEqual(Object.keys(conversationStream?.responses ?? {}).sort(), ["200", "401", "403"]);
  assert.match(conversationStream?.responses?.["200"]?.description ?? "", /one conversation topic/iu);
  assert.match(conversationStream?.responses?.["200"]?.description ?? "", /live-only/iu);
  assert.match(conversationStream?.responses?.["200"]?.description ?? "", /no replay/iu);
  assert.match(
    conversationStream?.responses?.["200"]?.description ?? "",
    /GET \/api\/conversations\/\{id\}\/messages\?afterSeq/iu
  );

  assert.deepEqual(parameterByName(body.paths, "/api/workitems/{id}/audit", "get", "id"), {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" }
  });
  const auditResponse = jsonResponseSchema(body.paths, "/api/workitems/{id}/audit", "get", "200");
  assert.deepEqual(auditResponse?.required, ["ok", "data"]);
  const auditForbidden = jsonResponseSchema(body.paths, "/api/workitems/{id}/audit", "get", "403");
  const auditForbiddenError = auditForbidden?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(auditForbidden?.required, ["ok", "error"]);
  assert.deepEqual(auditForbiddenError?.properties?.code, { type: "string", enum: ["forbidden"] });
  const auditNotFound = jsonResponseSchema(body.paths, "/api/workitems/{id}/audit", "get", "404");
  const auditNotFoundError = auditNotFound?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(auditNotFound?.required, ["ok", "error"]);
  assert.deepEqual(auditNotFoundError?.properties?.code, { type: "string", enum: ["not_found"] });
});

test("pilot metrics and AI worklog OpenAPI routes document query and response contracts", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const name of ["from", "to"] as const) {
    assert.deepEqual(parameterByName(body.paths, "/api/pilot/day1/metrics", "get", name), {
      name,
      in: "query",
      required: false,
      schema: { type: "string", format: "date-time" }
    });
  }

  const pilotResponse = jsonResponseSchema(body.paths, "/api/pilot/day1/metrics", "get", "200");
  const pilotData = pilotResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(pilotResponse?.required, ["ok", "data"]);
  assert.deepEqual(pilotData?.required, ["generated_at", "range", "metrics", "raw_counts", "cost", "gates", "notes"]);
  assert.deepEqual(Object.keys(pilotData?.properties ?? {}).sort(), [
    "cost",
    "gates",
    "generated_at",
    "metrics",
    "notes",
    "range",
    "raw_counts"
  ]);
  const pilotForbidden = jsonResponseSchema(body.paths, "/api/pilot/day1/metrics", "get", "403");
  const pilotForbiddenError = pilotForbidden?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(pilotForbidden?.required, ["ok", "error"]);
  assert.deepEqual(pilotForbiddenError?.properties?.code, { type: "string", enum: ["admin_required"] });
  const pilotValidation = jsonResponseSchema(body.paths, "/api/pilot/day1/metrics", "get", "422");
  const pilotValidationError = pilotValidation?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(pilotValidation?.required, ["ok", "error"]);
  assert.deepEqual(pilotValidationError?.properties?.code, {
    type: "string",
    enum: ["validation_error", "invalid_range"]
  });

  const worklogResponse = jsonResponseSchema(body.paths, "/api/ai-worklog/today", "get", "200");
  const worklogData = worklogResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(worklogResponse?.required, ["ok", "data"]);
  assert.deepEqual(worklogData?.required, [
    "runs_today",
    "autonomy_rate",
    "accepted_today",
    "saved_hours_estimate",
    "skills_promoted_today",
    "skills_refined_today",
    "generated_at"
  ]);
  assert.deepEqual(Object.keys(worklogData?.properties ?? {}).sort(), [
    "accepted_today",
    "autonomy_rate",
    "generated_at",
    "range_label",
    "runs_today",
    "saved_hours_estimate",
    "skills_promoted_today",
    "skills_refined_today"
  ]);
  const worklogAuth = jsonResponseSchema(body.paths, "/api/ai-worklog/today", "get", "401");
  const worklogAuthError = worklogAuth?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(worklogAuth?.required, ["ok", "error"]);
  assert.deepEqual(worklogAuthError?.properties?.code, { type: "string", enum: ["not_identified"] });
});

test("Task intake and AgentRun OpenAPI responses document the execution chain", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const [path, method, status] of [
    ["/api/sessions", "post", "200"],
    ["/api/sessions/{id}", "get", "200"],
    ["/api/sessions/{id}/next-question", "post", "200"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, status);
    assert.deepEqual(schema?.required, ["ok", "data", "meta"], `${method.toUpperCase()} ${path} missing session envelope`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, ["session_id", "topic", "stream_href", "next_question_href", "question"]);
    assert.ok(data?.properties?.question, `${method.toUpperCase()} ${path} missing question card schema`);
  }

  for (const [path, method] of [
    ["/api/sessions", "post"],
    ["/api/sessions/{id}", "get"],
    ["/api/sessions/{id}/next-question", "post"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "403"), {
      type: "string",
      enum: ["invalid_client_token", "forbidden"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "404"), {
      type: "string",
      enum: path === "/api/sessions" ? ["not_found", "project_not_found"] : ["not_found"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "502"), {
      type: "string",
      enum: [
        "clarification_file_context_failed",
        "clarification_llm_failed",
        "clarification_llm_empty_response",
        "clarification_llm_templated_response",
        "clarification_llm_invalid_response",
        "clarification_llm_missing_named_file"
      ]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "503"), {
      type: "string",
      enum: ["clarification_llm_unavailable"]
    });
  }
  for (const path of ["/api/sessions", "/api/sessions/{id}/next-question"] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, "post", "400"), {
      type: "string",
      enum: ["malformed_json", "json_object_required"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, "post", "422"), {
      type: "string",
      enum: ["validation_error"]
    });
  }

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/sessions/{id}/next-question", "post"), false);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/sessions/{id}/next-question", "post")).sort(), [
    "free_text",
    "selected_option_ids"
  ]);

  for (const [path, status] of [
    ["/api/workitems", "201"],
    ["/api/workitems/{id}/evidence-bindings", "200"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, "post", status);
    assert.deepEqual(schema?.required, ["ok", "data", "meta"], `POST ${path} missing work item detail envelope`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, [
      "workitem",
      "acceptance",
      "agent_trace_preview",
      "accepted_deliverables",
      "evidence_refs",
      "actions"
    ]);
    assert.ok(data?.properties?.workitem, `POST ${path} missing WorkItem schema`);
  }
  for (const [path, method] of [
    ["/api/workitems", "post"],
    ["/api/workitems/{id}/evidence-bindings", "post"],
    ["/api/knowledge/search", "post"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "400"), {
      type: "string",
      enum: ["malformed_json", "json_object_required"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "403"), {
      type: "string",
      enum: ["invalid_client_token", "forbidden"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "404"), {
      type: "string",
      enum: path === "/api/workitems/{id}/evidence-bindings" ? ["not_found"] : ["not_found", "project_not_found"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "422"), {
      type: "string",
      enum: ["validation_error"]
    });
  }
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems", "post", "409"), {
    type: "string",
    enum: ["workitem_state_conflict"]
  });

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/workitems/{id}/agent-runs", "post"), false);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/workitems/{id}/agent-runs", "post")).sort(), [
    "mode",
    "title"
  ]);

  const persistedAgentRunStatusSchema = {
    type: "string",
    enum: ["queued", "running", "succeeded", "failed", "escalated", "cancelled"]
  };
  for (const [path, method, status] of [
    ["/api/workitems/{id}/agent-runs", "post", "202"],
    ["/api/agent-runs/{id}", "get", "200"],
    ["/api/agent-runs/{id}/abort", "post", "200"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, status);
    assert.deepEqual(schema?.required, ["ok", "data"], `${method.toUpperCase()} ${path} missing AgentRun envelope`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, [
      "run",
      "run_id",
      "work_item_id",
      "title",
      "status",
      "budget",
      "budget_decision",
      "usage",
      "trace",
      "stream_href",
      "replay_href"
    ]);
    assert.ok(data?.properties?.trace, `${method.toUpperCase()} ${path} missing AgentRun trace schema`);
    // R9.7 review: the old response contract let `budget_exhausted` appear as a
    // persisted run status. That was wrong because budget exhaustion rejects the
    // start request with HTTP 402 and opens a budget card instead of saving a run.
    assert.deepEqual(data?.properties?.status, persistedAgentRunStatusSchema);
    const runSchema = data?.properties?.run as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(runSchema?.properties?.status, persistedAgentRunStatusSchema);
    assert.deepEqual(runSchema?.properties?.parent_run_id, { type: "string", format: "uuid" });
    assert.deepEqual(runSchema?.properties?.task_plan_id, { type: "string", format: "uuid" });
    assert.deepEqual(runSchema?.properties?.task_plan_item_id, { type: "string", format: "uuid" });
    assert.deepEqual(runSchema?.properties?.agent_role, {
      type: "string",
      enum: ["research", "produce", "review", "integrate"]
    });
    assert.deepEqual(runSchema?.properties?.objective_md, { type: "string", minLength: 1 });
  }

  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems/{id}/agent-runs", "post", "400"), {
    type: "string",
    enum: ["malformed_json", "json_object_required"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems/{id}/agent-runs", "post", "402"), {
    type: "string",
    enum: ["budget_exhausted"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems/{id}/agent-runs", "post", "409"), {
    type: "string",
    enum: ["agent_run_already_active", "agent_run_not_startable", "human_reserved"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems/{id}/agent-runs", "post", "422"), {
    type: "string",
    enum: ["validation_error"]
  });
  // R9.7 review: the old 503 contract only documented kickoff HTTP failures, but
  // budget persistence/reservation outages also fail closed before any unreserved run may proceed.
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems/{id}/agent-runs", "post", "503"), {
    type: "string",
    enum: ["http_error", "budget_decision_persist_failed", "budget_reservation_failed"]
  });

  for (const [path, method] of [
    ["/api/workitems/{id}/agent-runs", "post"],
    ["/api/agent-runs/{id}", "get"],
    ["/api/agent-runs/{id}/trace", "get"],
    ["/api/agent-runs/{id}/handoff", "get"],
    ["/api/agent-runs/{id}/abort", "post"],
    ["/api/agent-runs/{id}/replay", "get"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
  }

  for (const [path, method] of [
    ["/api/workitems/{id}/agent-runs", "post"],
    ["/api/agent-runs/{id}", "get"],
    ["/api/agent-runs/{id}/trace", "get"],
    ["/api/agent-runs/{id}/handoff", "get"],
    ["/api/agent-runs/{id}/abort", "post"],
    ["/api/agent-runs/{id}/replay", "get"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "403"), {
      type: "string",
      enum: path === "/api/agent-runs/{id}/abort"
        ? ["invalid_client_token", "forbidden", "agent_run_abort_forbidden"]
        : ["invalid_client_token", "forbidden"]
    });
  }

  for (const [path, method] of [
    ["/api/workitems/{id}/agent-runs", "post"],
    ["/api/agent-runs/{id}", "get"],
    ["/api/agent-runs/{id}/trace", "get"],
    ["/api/agent-runs/{id}/handoff", "get"],
    ["/api/agent-runs/{id}/abort", "post"],
    ["/api/agent-runs/{id}/replay", "get"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "404"), {
      type: "string",
      enum: ["not_found"]
    });
  }

  assert.deepEqual(parameterByName(body.paths, "/api/agent-runs/{id}/trace", "get", "after"), {
    name: "after",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 0 }
  });
  const traceResponse = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/trace", "get", "200");
  assert.deepEqual(traceResponse?.required, ["ok", "data"]);
  const traceData = traceResponse?.properties?.data as { items?: { required?: string[]; properties?: Record<string, unknown> } } | undefined;
  assert.deepEqual(traceData?.items?.required, ["id", "agent_run_id", "step_no", "phase", "input_json", "created_at"]);
  assert.deepEqual(traceData?.items?.properties?.phase, { type: "string", enum: ["think", "tool_call", "tool_result", "final"] });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/agent-runs/{id}/trace", "get", "422"), {
    type: "string",
    enum: ["validation_error"]
  });

  const handoffResponse = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/handoff", "get", "200");
  assert.deepEqual(handoffResponse?.required, ["ok", "data"]);
  assert.ok(handoffResponse?.properties?.data, "GET /api/agent-runs/{id}/handoff missing nullable handoff data schema");

  const replayResponse = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/replay", "get", "200");
  assert.deepEqual(replayResponse?.required, ["ok", "data", "meta"]);
  const replayData = replayResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(replayData?.required, ["run", "steps", "evidence_refs", "snapshots"]);
  assert.ok(replayData?.properties?.manifest_facts, "GET /api/agent-runs/{id}/replay missing manifest facts schema");
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/agent-runs/{id}/abort", "post", "409"), {
    type: "string",
    enum: ["agent_run_already_settled"]
  });

  assert.deepEqual(jsonRequestSchema(body.paths, "/api/agent-runs/{id}/revert", "post")?.required, ["snapshot_id"]);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/agent-runs/{id}/revert", "post")).sort(), [
    "reason_md",
    "snapshot_id"
  ]);
  const revertResponse = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/revert", "post", "200");
  assert.deepEqual(revertResponse?.required, ["ok", "data"]);
  const revertData = revertResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(revertData?.required, ["status", "snapshot"]);
  assert.deepEqual(revertData?.properties?.status, { type: "string", enum: ["reverted"] });
  const revertForbidden = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/revert", "post", "403");
  const revertForbiddenError = revertForbidden?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(revertForbidden?.required, ["ok", "error"]);
  assert.deepEqual(revertForbiddenError?.properties?.code, {
    type: "string",
    enum: ["invalid_client_token", "forbidden"]
  });
  const revertNotFound = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/revert", "post", "404");
  const revertNotFoundError = revertNotFound?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(revertNotFound?.required, ["ok", "error"]);
  assert.deepEqual(revertNotFoundError?.properties?.code, { type: "string", enum: ["not_found"] });
  const revertConflict = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/revert", "post", "409");
  const revertConflictError = revertConflict?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(revertConflict?.required, ["ok", "error"]);
  assert.deepEqual(revertConflictError?.properties?.code, { type: "string", enum: ["conflict"] });
  const revertValidation = jsonResponseSchema(body.paths, "/api/agent-runs/{id}/revert", "post", "422");
  const revertValidationError = revertValidation?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(revertValidation?.required, ["ok", "error"]);
  assert.deepEqual(revertValidationError?.properties?.code, { type: "string", enum: ["validation_error"] });
});

test("Approval and permission OpenAPI contracts document decision and policy actions", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  const approvalList = jsonResponseSchema(body.paths, "/api/approvals", "get", "200");
  assert.deepEqual(approvalList?.required, ["ok", "data"]);
  const approvalCenter = approvalList?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(approvalCenter?.required, ["items", "requests", "filters", "counts", "items_detail"]);
  const approvalRequest = (approvalCenter?.properties?.requests as { items?: { required?: string[]; properties?: Record<string, unknown> } } | undefined)?.items;
  assert.deepEqual(approvalRequest?.required, ["id", "action_pattern", "payload_json", "status", "created_at", "updated_at"]);
  assert.deepEqual(approvalRequest?.properties?.status, {
    type: "string",
    enum: ["pending", "approved", "denied", "expired", "delegated"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals", "get", "401"), {
    type: "string",
    enum: ["not_identified"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals", "get", "403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });

  assert.deepEqual(jsonRequestSchema(body.paths, "/api/approvals/{id}/respond", "post")?.required, ["decision"]);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/approvals/{id}/respond", "post")).sort(), [
    "decision",
    "reason_md",
    "remember"
  ]);
  const respondRequest = jsonRequestSchema(body.paths, "/api/approvals/{id}/respond", "post") as {
    anyOf?: Array<{ required?: string[]; properties?: Record<string, unknown> }>;
  } | undefined;
  assert.deepEqual(respondRequest?.anyOf?.map((variant) => variant.required), [
    ["decision"],
    ["decision", "reason_md"]
  ]);
  const respond = jsonResponseSchema(body.paths, "/api/approvals/{id}/respond", "post", "200");
  assert.deepEqual(respond?.required, ["ok", "data"]);
  const respondData = respond?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(respondData?.required, ["approval"]);
  assert.ok(respondData?.properties?.learned_policy, "POST /api/approvals/{id}/respond missing learned policy schema");
  const respondRace = jsonResponseSchema(body.paths, "/api/approvals/{id}/respond", "post", "409");
  const respondRaceError = respondRace?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(respondRace?.required, ["ok", "error"]);
  assert.deepEqual(respondRaceError?.properties?.code, { type: "string", enum: ["approval_race"] });

  assert.deepEqual(jsonRequestSchema(body.paths, "/api/approvals/{id}/delegate", "post")?.required, ["to_user_id"]);
  const delegate = jsonResponseSchema(body.paths, "/api/approvals/{id}/delegate", "post", "200");
  const delegateData = delegate?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(delegateData?.required, ["approval", "attention"]);
  const delegateRace = jsonResponseSchema(body.paths, "/api/approvals/{id}/delegate", "post", "409");
  const delegateRaceError = delegateRace?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(delegateRace?.required, ["ok", "error"]);
  assert.deepEqual(delegateRaceError?.properties?.code, { type: "string", enum: ["approval_race"] });
  const delegateNotFound = jsonResponseSchema(body.paths, "/api/approvals/{id}/delegate", "post", "404");
  const delegateNotFoundError = delegateNotFound?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(delegateNotFound?.required, ["ok", "error"]);
  assert.deepEqual(delegateNotFoundError?.properties?.code, {
    type: "string",
    enum: ["not_found", "delegate_target_not_found"]
  });
  const delegateSemanticError = jsonResponseSchema(body.paths, "/api/approvals/{id}/delegate", "post", "422");
  const delegateSemanticPayload = delegateSemanticError?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(delegateSemanticError?.required, ["ok", "error"]);
  assert.deepEqual(delegateSemanticPayload?.properties?.code, {
    type: "string",
    enum: ["delegate_to_requester", "delegate_target_cannot_view"]
  });

  assert.deepEqual(jsonRequestSchema(body.paths, "/api/escalations/{id}/resolve", "post")?.required, ["action"]);
  assert.deepEqual(operationParameters(body.paths, "/api/escalations/{id}/resolve", "post"), [
    { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/escalations/{id}/resolve", "post")).sort(), [
    "action",
    "reason_md"
  ]);
  const escalationResolve = jsonResponseSchema(body.paths, "/api/escalations/{id}/resolve", "post", "200");
  const escalationResolveData = escalationResolve?.properties?.data as {
    required?: string[];
    properties?: Record<string, unknown>;
  } | undefined;
  assert.deepEqual(escalationResolveData?.required, ["escalation", "work_item_status", "attention"]);
  // R9.7 review: the old assertion only allowed direct work-item resolve statuses,
  // but task-scoped escalation resolution returns the unchanged parent work item status
  // (for example `escalated`) while mutating the task plan instead.
  assert.deepEqual(escalationResolveData?.properties?.work_item_status, {
    type: "string",
    enum: ["intake", "ai_clarifying", "spec_ready", "ai_working", "escalated", "pm_mode", "in_review", "merged", "done", "cancelled"]
  });

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post"), false);
  assert.deepEqual(operationParameters(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post"), [
    { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    { name: "actionId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 64 } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);
  const escalationBudget = jsonResponseSchema(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post", "200");
  const escalationBudgetData = escalationBudget?.properties?.data as {
    required?: string[];
    properties?: Record<string, unknown>;
  } | undefined;
  assert.deepEqual(escalationBudgetData?.required, ["escalation", "work_item_status", "attention"]);
  assert.deepEqual(escalationBudgetData?.properties?.work_item_status, {
    type: "string",
    enum: ["intake", "ai_clarifying", "spec_ready", "ai_working", "escalated", "pm_mode", "in_review", "merged", "done", "cancelled"]
  });

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post"), false);
  // R9.7 review: the old assertion only documented `value_md`, but resolving a sync-conflict
  // without the card version lets a stale UI click decide a newer overwritten memory conflict.
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post")).sort(), [
    "expected_updated_at",
    "value_md"
  ]);
  assert.deepEqual(parameterByName(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "resolution"), {
    name: "resolution",
    in: "path",
    required: true,
    schema: { type: "string", enum: ["keep_current", "accept_incoming", "merge_both", "edit_memory", "discard_both"] }
  });
  assert.deepEqual(parameterByName(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "expected_updated_at"), {
    name: "expected_updated_at",
    in: "query",
    required: false,
    schema: { type: "string", format: "date-time" }
  });
  const memoryConflictResolve = jsonResponseSchema(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "200");
  const memoryConflictResolveData = memoryConflictResolve?.properties?.data as {
    required?: string[];
    properties?: Record<string, unknown>;
  } | undefined;
  assert.deepEqual(memoryConflictResolveData?.required, ["conflict"]);
  const memoryConflict = memoryConflictResolveData?.properties?.conflict as {
    required?: string[];
    properties?: Record<string, unknown>;
  } | undefined;
  assert.deepEqual(memoryConflict?.properties?.status, {
    type: "string",
    enum: ["open", "resolved"]
  });
  assert.deepEqual(memoryConflict?.properties?.category, {
    type: "string",
    enum: ["preference", "correction", "recurring_context"]
  });
  assert.deepEqual(memoryConflict?.properties?.resolution, {
    anyOf: [
      { type: "string", enum: ["keep_current", "accept_incoming", "merge_both", "edit_memory", "discard_both"] },
      { type: "null" }
    ]
  });

  assert.deepEqual(jsonRequestSchema(body.paths, "/api/escalations/{id}/delegate", "post")?.required, ["to_user_id"]);
  assert.deepEqual(operationParameters(body.paths, "/api/escalations/{id}/delegate", "post"), [
    { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/escalations/{id}/delegate", "post")).sort(), [
    "reason_md",
    "to_user_id"
  ]);
  const escalationDelegate = jsonResponseSchema(body.paths, "/api/escalations/{id}/delegate", "post", "200");
  const escalationDelegateData = escalationDelegate?.properties?.data as {
    required?: string[];
    properties?: Record<string, unknown>;
  } | undefined;
  assert.deepEqual(escalationDelegateData?.required, ["escalation", "attention"]);

  const comments = jsonResponseSchema(body.paths, "/api/approvals/{id}/comments", "get", "200");
  assert.deepEqual(comments?.required, ["ok", "data"]);
  const commentItem = (comments?.properties?.data as { items?: { required?: string[] } } | undefined)?.items;
  assert.deepEqual(commentItem?.required, ["id", "author_label", "body", "created_at"]);
  assert.deepEqual(jsonRequestSchema(body.paths, "/api/approvals/{id}/comments", "post")?.required, ["body"]);
  const createdComment = jsonResponseSchema(body.paths, "/api/approvals/{id}/comments", "post", "200");
  const createdCommentData = createdComment?.properties?.data as { required?: string[] } | undefined;
  assert.deepEqual(createdCommentData?.required, ["id", "author_label", "body", "created_at"]);
  for (const method of ["get", "post"] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals/{id}/comments", method, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals/{id}/comments", method, "403"), {
      type: "string",
      enum: ["invalid_client_token", "forbidden"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals/{id}/comments", method, "404"), {
      type: "string",
      enum: ["not_found"]
    });
  }
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals/{id}/comments", "post", "400"), {
    type: "string",
    enum: ["malformed_json", "json_object_required"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals/{id}/comments", "post", "422"), {
    type: "string",
    enum: ["validation_error"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/approvals/{id}/comments", "post", "503"), {
    type: "string",
    enum: ["comments_unavailable"]
  });

  const permissions = jsonResponseSchema(body.paths, "/api/permissions", "get", "200");
  const permissionItem = (permissions?.properties?.data as { items?: { required?: string[]; properties?: Record<string, unknown> } } | undefined)?.items;
  assert.deepEqual(permissionItem?.required, [
    "id",
    "scope_kind",
    "scope_id",
    "action_pattern",
    "effect",
    "priority",
    "learned_from_session",
    "created_at",
    "updated_at"
  ]);
  assert.deepEqual(permissionItem?.properties?.effect, { type: "string", enum: ["allow", "deny", "ask"] });
  assert.deepEqual(jsonRequestSchema(body.paths, "/api/permissions", "put")?.required, [
    "scope_kind",
    "scope_id",
    "action_pattern",
    "effect"
  ]);
  const permissionWriteProps = jsonRequestProperties(body.paths, "/api/permissions", "put");
  assert.deepEqual(Object.keys(permissionWriteProps).sort(), [
    "action_pattern",
    "effect",
    "learned_from_session",
    "priority",
    "scope_id",
    "scope_kind"
  ]);
  const createPermission = jsonResponseSchema(body.paths, "/api/permissions", "put", "200");
  assert.deepEqual((createPermission?.properties?.data as { required?: string[] } | undefined)?.required, permissionItem?.required);
  const deletePermission = jsonResponseSchema(body.paths, "/api/permissions/{id}", "delete", "200");
  assert.deepEqual((deletePermission?.properties?.data as { required?: string[] } | undefined)?.required, permissionItem?.required);
  for (const [path, method] of [
    ["/api/permissions", "get"],
    ["/api/permissions", "put"],
    ["/api/permissions/{id}", "delete"],
    ["/api/permissions/ask", "post"]
  ] as const) {
    const forbidden = jsonResponseSchema(body.paths, path, method, "403");
    const forbiddenError = forbidden?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(forbidden?.required, ["ok", "error"]);
    assert.deepEqual(forbiddenError?.properties?.code, { type: "string", enum: ["forbidden"] });
  }
  const deletePermissionNotFound = jsonResponseSchema(body.paths, "/api/permissions/{id}", "delete", "404");
  const deletePermissionNotFoundError = deletePermissionNotFound?.properties?.error as {
    properties?: Record<string, unknown>;
  } | undefined;
  assert.deepEqual(deletePermissionNotFound?.required, ["ok", "error"]);
  // Old assertion expected generic not_found. That was wrong because permissions.revokePolicy
  // returns the domain code permission_policy_not_found, and clients branch on that code.
  assert.deepEqual(deletePermissionNotFoundError?.properties?.code, {
    type: "string",
    enum: ["permission_policy_not_found"]
  });

  assert.deepEqual(jsonRequestSchema(body.paths, "/api/permissions/ask", "post")?.required, ["action_pattern"]);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/permissions/ask", "post")).sort(), [
    "action_pattern",
    "agent_run_id",
    "kind",
    "payload_json",
    "routed_to_user_id",
    "sla_due_at",
    "work_item_id"
  ]);
  const ask = jsonResponseSchema(body.paths, "/api/permissions/ask", "post", "200");
  const askData = ask?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(askData?.required, ["outcome"]);
  assert.deepEqual(askData?.properties?.outcome, {
    type: "string",
    enum: ["allowed", "denied", "escalated", "pending"]
  });
  assert.ok(askData?.properties?.approval, "POST /api/permissions/ask missing pending approval schema");
});

test("OpenAPI error responses document approval, meeting, and work item mutation status matrices", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  assertJsonErrorCodes(body.paths, "/api/workitems", "post", "409", ["workitem_state_conflict"]);
  assertJsonErrorCodes(body.paths, "/api/permissions/{id}", "delete", "404", ["permission_policy_not_found"]);

  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/respond", "post", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/respond", "post", "403", ["invalid_client_token", "forbidden"]);
  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/respond", "post", "404", ["not_found"]);
  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/respond", "post", "409", ["approval_race"]);

  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/delegate", "post", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/delegate", "post", "403", ["invalid_client_token", "forbidden"]);
  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/delegate", "post", "404", ["not_found", "delegate_target_not_found"]);
  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/delegate", "post", "409", ["approval_race"]);
  assertJsonErrorCodes(body.paths, "/api/approvals/{id}/delegate", "post", "422", ["delegate_to_requester", "delegate_target_cannot_view"]);

  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/resolve", "post", "400", ["malformed_json", "json_object_required"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/resolve", "post", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/resolve", "post", "403", ["invalid_client_token", "forbidden"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/resolve", "post", "404", ["not_found", "escalation_not_found"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/resolve", "post", "409", [
    "escalation_race",
    "escalation_status_conflict"
  ]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/resolve", "post", "422", ["validation_error"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/resolve", "post", "503", ["task_dispatch_retry_failed", "agent_run_retry_failed"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post", "403", [
    "invalid_client_token",
    "forbidden"
  ]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post", "404", [
    "not_found",
    "escalation_not_found"
  ]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post", "409", ["escalation_race"]);
  // R9.7 review: the old assertion documented only missing-option failures, but
  // unapplied choices such as `add_budget` now fail closed instead of resolving the card.
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/budget-actions/{actionId}", "post", "422", [
    "budget_action_not_available",
    "budget_action_requires_budget_update"
  ]);
  assertJsonErrorCodes(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "400", [
    "malformed_json",
    "json_object_required"
  ]);
  assertJsonErrorCodes(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "403", [
    "invalid_client_token",
    "forbidden"
  ]);
  assertJsonErrorCodes(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "404", [
    "not_found",
    "memory_conflict_not_found"
  ]);
  assertJsonErrorCodes(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "409", [
    "memory_conflict_status_changed"
  ]);
  assertJsonErrorCodes(body.paths, "/api/memory-conflicts/{id}/resolve/{resolution}", "post", "422", ["validation_error"]);

  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/delegate", "post", "400", ["malformed_json", "json_object_required"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/delegate", "post", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/delegate", "post", "403", ["invalid_client_token", "forbidden"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/delegate", "post", "404", [
    "not_found",
    "escalation_not_found",
    "delegate_target_not_found"
  ]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/delegate", "post", "409", ["escalation_race"]);
  assertJsonErrorCodes(body.paths, "/api/escalations/{id}/delegate", "post", "422", ["validation_error"]);

  for (const path of [
    "/api/meetings/projects/{projectId}/insights/{insightId}/draft",
    "/api/meetings/projects/{projectId}/insights/{insightId}/dismiss"
  ] as const) {
    assertJsonErrorCodes(body.paths, path, "post", "401", ["not_identified"]);
    assertJsonErrorCodes(body.paths, path, "post", "403", ["invalid_client_token", "meeting_forbidden"]);
    assertJsonErrorCodes(body.paths, path, "post", "404", ["meeting_not_found", "meeting_insight_not_found"]);
  }

  assertJsonErrorCodes(body.paths, "/api/meetings/workitems/{workItemId}/proposal-draft", "post", "401", ["not_identified"]);
  assertJsonErrorCodes(body.paths, "/api/meetings/workitems/{workItemId}/proposal-draft", "post", "403", [
    "invalid_client_token",
    "forbidden",
    "meeting_forbidden"
  ]);
  assertJsonErrorCodes(body.paths, "/api/meetings/workitems/{workItemId}/proposal-draft", "post", "404", [
    "not_found",
    "meeting_not_found",
    "meeting_insight_not_found"
  ]);
  assertJsonErrorCodes(body.paths, "/api/meetings/workitems/{workItemId}/proposal-draft", "post", "409", [
    "meeting_draft_source_missing",
    "meeting_insight_dismissed"
  ]);
});

test("Proposal OpenAPI contracts document review, merge, and conflict action payloads", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  const createRequest = jsonRequestSchema(body.paths, "/api/workitems/{id}/proposals", "post");
  assert.deepEqual(createRequest?.required, ["manifest"]);
  assert.deepEqual(Object.keys(createRequest?.properties ?? {}).sort(), ["branch_id", "manifest", "title"]);

  const createResponse = jsonResponseSchema(body.paths, "/api/workitems/{id}/proposals", "post", "201");
  assert.deepEqual(createResponse?.required, ["ok", "data"]);
  const created = createResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(created?.required, [
    "id",
    "work_item_id",
    "branch_id",
    "round",
    "title",
    "status",
    "diff_manifest",
    "opened_by_kind",
    "created_at",
    "updated_at"
  ]);

  for (const [path, method] of [
    ["/api/workitems/{id}/proposals", "post"],
    ["/api/workitems/{id}/proposals", "get"],
    ["/api/workitems/{id}/conflicts", "get"],
    ["/api/proposals/{id}", "get"],
    ["/api/proposals/{id}/review", "post"],
    ["/api/proposals/{id}/merge", "post"],
    ["/api/proposals/{id}/rebase", "post"],
    ["/api/merge-proposals/{id}/choose", "post"],
    ["/api/merge-proposals/{id}/apply", "post"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "403"), {
      type: "string",
      enum: ["invalid_client_token", "forbidden"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "404"), {
      type: "string",
      enum: ["not_found"]
    });
  }

  for (const [path, method] of [
    ["/api/workitems/{id}/proposals", "post"],
    ["/api/proposals/{id}/review", "post"],
    ["/api/proposals/{id}/merge", "post"],
    ["/api/merge-proposals/{id}/choose", "post"],
    ["/api/merge-proposals/{id}/apply", "post"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "400"), {
      type: "string",
      enum: ["malformed_json", "json_object_required"]
    });
  }

  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems/{id}/proposals", "post", "422"), {
    type: "string",
    enum: [
      "validation_error",
      "manifest_workitem_mismatch",
      "duplicate_target_key",
      "proposal_branch_workitem_mismatch"
    ]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/workitems/{id}/proposals", "post", "409"), {
    type: "string",
    enum: ["proposal_already_exists"]
  });

  for (const [path, method] of [
    ["/api/workitems/{id}/proposals", "get"],
    ["/api/proposals/{id}", "get"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    assert.deepEqual(schema?.required, ["ok", "data"], `${method.toUpperCase()} ${path} missing proposal response`);
  }

  const reviewRequest = jsonRequestSchema(body.paths, "/api/proposals/{id}/review", "post");
  assert.deepEqual(reviewRequest?.required, ["decision"]);
  assert.deepEqual(Object.keys(reviewRequest?.properties ?? {}).sort(), ["decision", "reason_md", "remember"]);
  const reviewResponse = jsonResponseSchema(body.paths, "/api/proposals/{id}/review", "post", "200");
  assert.deepEqual(reviewResponse?.required, ["ok", "data"]);
  const reviewData = reviewResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(reviewData?.required, ["proposal_id", "work_item_id", "status", "decision", "attention", "event"]);
  assert.ok(reviewData?.properties?.next_action);
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/proposals/{id}/review", "post", "422"), {
    type: "string",
    enum: ["validation_error"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/proposals/{id}/review", "post", "409"), {
    type: "string",
    enum: ["proposal_already_merged", "proposal_rejected", "proposal_state_changed"]
  });

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/proposals/{id}/merge", "post"), false);
  const mergeRequest = jsonRequestSchema(body.paths, "/api/proposals/{id}/merge", "post");
  // R9.7: the old key set was wrong because approve-hold needs a documented dispatch:false merge request.
  assert.deepEqual(Object.keys(mergeRequest?.properties ?? {}).sort(), ["confirm", "conflict_resolution", "dispatch"]);
  assert.deepEqual(mergeRequest?.properties?.dispatch, { type: "boolean", default: true });
  for (const [path, method] of [
    ["/api/proposals/{id}/merge", "post"],
    ["/api/merge-proposals/{id}/apply", "post"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    assert.deepEqual(schema?.required, ["ok", "data"], `${method.toUpperCase()} ${path} missing merge result response`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, [
      "proposal_id",
      "work_item_id",
      "status",
      "merge_snapshot_id",
      "rollback_available",
      "rollback",
      "attention",
      "events",
      "audit_logs"
    ]);
    const confirmationRequired = jsonResponseSchema(body.paths, path, method, "409");
    assert.deepEqual(confirmationRequired?.required, ["ok", "error"], `${method.toUpperCase()} ${path} missing confirmation-required response`);
    assert.deepEqual(confirmationRequired?.properties?.ok, { type: "boolean", const: false });
    const error = confirmationRequired?.properties?.error as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(error?.required, ["code", "message"]);
    assert.deepEqual(error?.properties?.code, {
      type: "string",
      enum: method === "post" && path === "/api/merge-proposals/{id}/apply"
        ? [
            "confirmation_required",
            "proposal_already_merged",
            "proposal_not_reviewed",
            "merge_proposal_apply_requires_ai_fusion",
            "merge_candidate_missing_result",
            "merge_candidate_target_unsupported",
            "text_hunk_target_unsupported",
            "merge_candidate_artifact_missing",
            "merge_proposal_not_chosen",
            "stale_base",
            "rebase_required"
          ]
        : [
            "confirmation_required",
            "proposal_already_merged",
            "proposal_rejected",
            "proposal_not_reviewed",
            "merge_conflict",
            "rebase_required",
            "stale_base",
            "merge_snapshot_missing",
            "delivery_artifact_missing",
            "delivery_artifact_changed",
            "delivery_artifact_unsafe_path",
            "task_plan_approval_failed",
            "task_plan_items_invalid",
            "task_plan_budget_share_invalid"
          ]
    });
    assert.deepEqual(error?.properties?.recoverable, { type: "boolean", const: true });
  }
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/proposals/{id}/merge", "post", "422"), {
    type: "string",
    enum: ["validation_error"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/proposals/{id}/merge", "post", "503"), {
    type: "string",
    enum: ["task_plan_dispatch_failed"]
  });

  for (const [path, method] of [
    ["/api/workitems/{id}/conflicts", "get"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    assert.deepEqual(schema?.required, ["ok", "data"], `${method.toUpperCase()} ${path} missing conflict-list response`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, ["conflicts"]);
  }
  const rebaseResponse = jsonResponseSchema(body.paths, "/api/proposals/{id}/rebase", "post", "200");
  assert.deepEqual(rebaseResponse?.required, ["ok", "data"]);
  const rebaseData = rebaseResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(rebaseData?.required, ["proposal_id", "work_item_id", "conflicts"]);
  assert.ok(rebaseData?.properties?.empty_state);
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/proposals/{id}/rebase", "post", "409"), {
    type: "string",
    enum: ["not_reviewed"]
  });

  const chooseRequest = jsonRequestSchema(body.paths, "/api/merge-proposals/{id}/choose", "post");
  assert.deepEqual(chooseRequest?.required, ["option_key"]);
  assert.deepEqual(Object.keys(chooseRequest?.properties ?? {}).sort(), ["option_key"]);
  const chooseResponse = jsonResponseSchema(body.paths, "/api/merge-proposals/{id}/choose", "post", "200");
  assert.deepEqual(chooseResponse?.required, ["ok", "data"]);
  const chosen = chooseResponse?.properties?.data as { required?: string[] } | undefined;
  assert.deepEqual(chosen?.required, [
    "merge_proposal_id",
    "conflict_key",
    "chosen_option_key",
    "chosen_at",
    "candidate"
  ]);
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/merge-proposals/{id}/choose", "post", "422"), {
    type: "string",
    enum: ["validation_error", "invalid_merge_proposal_candidate"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/merge-proposals/{id}/choose", "post", "409"), {
    type: "string",
    enum: ["merge_proposal_already_chosen"]
  });

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/merge-proposals/{id}/apply", "post"), false);
  const applyRequest = jsonRequestSchema(body.paths, "/api/merge-proposals/{id}/apply", "post");
  assert.deepEqual(Object.keys(applyRequest?.properties ?? {}).sort(), [
    "confirm",
    "structured_field_overrides",
    "structured_item_overrides",
    "task_plan_scope",
    "text_hunk_overrides"
  ]);
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/merge-proposals/{id}/apply", "post", "422"), {
    type: "string",
    enum: ["validation_error"]
  });
});

test("Drive and Meeting draft action OpenAPI responses document refreshed page envelopes", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const conflictCodeSchema = (path: string, method: string) => {
    const schema = jsonResponseSchema(body.paths, path, method, "409");
    const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "error"], `${method.toUpperCase()} ${path} missing conflict error envelope`);
    return error?.properties?.code;
  };

  for (const [path, method] of [
    ["/api/drive/projects/{projectId}/comments/{commentId}/draft", "post"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    assert.deepEqual(schema?.required, ["ok", "data", "meta"], `${method.toUpperCase()} ${path} missing page envelope response`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, [
      "generated_at",
      "summary",
      "can_manage",
      "items",
      "deleted_items",
      "versions",
      "accepted_deliverables",
      "comments",
      "operations",
      "actions"
    ]);
    assert.ok(data?.properties?.comments, `${method.toUpperCase()} ${path} missing Drive comments schema`);
  }
  assert.deepEqual(conflictCodeSchema("/api/drive/projects/{projectId}/comments/{commentId}/draft", "post"), {
    type: "string",
    enum: [
      "drive_comment_draft_exists",
      "drive_comment_draft_missing",
      "drive_comment_not_pending"
    ]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/comments/{commentId}/draft", "post", "403"), {
    type: "string",
    enum: ["drive_forbidden"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/comments/{commentId}/draft", "post", "404"), {
    type: "string",
    enum: ["drive_not_found", "drive_comment_not_found"]
  });

  for (const [path, method] of [
    ["/api/meetings/projects/{projectId}/insights/{insightId}/draft", "post"],
    ["/api/meetings/projects/{projectId}/insights/{insightId}/dismiss", "post"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    assert.deepEqual(schema?.required, ["ok", "data", "meta"], `${method.toUpperCase()} ${path} missing page envelope response`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, [
      "generated_at",
      "summary",
      "can_manage",
      "meetings"
    ]);
    const summary = data?.properties?.summary as { required?: string[] } | undefined;
    assert.deepEqual(summary?.required, [
      "meeting_count",
      "ready_count",
      "pending_insight_count",
      "confirmed_insight_count",
      "dismissed_insight_count"
    ]);
  }
  assert.deepEqual(conflictCodeSchema("/api/meetings/projects/{projectId}/insights/{insightId}/draft", "post"), {
    type: "string",
    enum: [
      "meeting_insight_not_pending",
      "meeting_insight_draft_missing",
      "meeting_insight_rationale_missing"
    ]
  });
  assert.deepEqual(conflictCodeSchema("/api/meetings/projects/{projectId}/insights/{insightId}/dismiss", "post"), {
    type: "string",
    enum: ["meeting_insight_not_pending"]
  });

  for (const [path, method] of [
    ["/api/drive/workitems/{workItemId}/proposal-draft", "post"],
    ["/api/meetings/workitems/{workItemId}/proposal-draft", "post"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    assert.deepEqual(schema?.required, ["ok", "data", "meta"], `${method.toUpperCase()} ${path} missing detail envelope response`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, [
      "workitem",
      "acceptance",
      "agent_trace_preview",
      "accepted_deliverables",
      "evidence_refs",
      "actions"
    ]);
    assert.ok(data?.properties?.actions, `${method.toUpperCase()} ${path} missing WorkItem actions schema`);
  }
  assert.deepEqual(conflictCodeSchema("/api/drive/workitems/{workItemId}/proposal-draft", "post"), {
    type: "string",
    enum: [
      "drive_draft_source_missing",
      "drive_comment_dismissed"
    ]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/workitems/{workItemId}/proposal-draft", "post", "403"), {
    type: "string",
    enum: ["forbidden", "drive_forbidden"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/workitems/{workItemId}/proposal-draft", "post", "404"), {
    type: "string",
    enum: ["not_found", "drive_not_found"]
  });
  assert.deepEqual(conflictCodeSchema("/api/meetings/workitems/{workItemId}/proposal-draft", "post"), {
    type: "string",
    enum: [
      "meeting_draft_source_missing",
      "meeting_insight_dismissed"
    ]
  });
});

test("drive OpenAPI request bodies match the runtime upload and delete contracts", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const uploadSchema = jsonRequestSchema(body.paths, "/api/drive/projects/{projectId}/files", "post");

  assert.deepEqual(uploadSchema?.required, ["filename", "parsed_text"]);
  assert.deepEqual(Object.keys(uploadSchema?.properties ?? {}).sort(), [
    "filename",
    "mime",
    "parent_id",
    "parsed_text"
  ]);
  assert.deepEqual(uploadSchema?.properties?.parsed_text, { type: "string", minLength: 1, maxLength: 200000 });
  const uploadBadRequest = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/files", "post", "400");
  const uploadBadRequestError = uploadBadRequest?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(uploadBadRequest?.required, ["ok", "error"]);
  assert.deepEqual(uploadBadRequestError?.properties?.code, {
    type: "string",
    enum: ["drive_file_missing", "drive_file_content_missing"]
  });
  const uploadTooLarge = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/files", "post", "413");
  const uploadTooLargeError = uploadTooLarge?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(uploadTooLarge?.required, ["ok", "error"]);
  assert.deepEqual(uploadTooLargeError?.properties?.code, {
    type: "string",
    enum: ["drive_file_too_large"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/files", "post", "403"), {
    type: "string",
    enum: ["drive_forbidden"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/files", "post", "404"), {
    type: "string",
    enum: ["drive_not_found"]
  });
  const uploadConflict = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/files", "post", "409");
  const uploadConflictError = uploadConflict?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(uploadConflict?.required, ["ok", "error"]);
  assert.deepEqual(uploadConflictError?.properties?.code, {
    type: "string",
    enum: ["drive_parent_deleted", "drive_name_conflict"]
  });

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/delete", "post"), false);
  assert.deepEqual(
    jsonRequestProperties(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/delete", "post").expected_current_version_id,
    {
      anyOf: [
        { type: "string", format: "uuid" },
        { type: "null" }
      ]
    }
  );

  const deleteConflict = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/delete", "post", "409");
  const deleteError = deleteConflict?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/delete", "post", "403"), {
    type: "string",
    enum: ["drive_forbidden"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/delete", "post", "404"), {
    type: "string",
    enum: ["drive_not_found", "drive_file_not_found"]
  });
  assert.deepEqual(deleteError?.properties?.code, {
    type: "string",
    enum: [
      "drive_current_version_changed",
      "drive_folder_not_empty",
      "drive_item_already_deleted",
      "drive_accepted_deliverable_locked"
    ]
  });

  const restoreConflict = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/restore", "post", "409");
  const restoreError = restoreConflict?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/restore", "post", "403"), {
    type: "string",
    enum: ["drive_forbidden"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/restore", "post", "404"), {
    type: "string",
    enum: ["drive_not_found", "drive_file_not_found"]
  });
  assert.deepEqual(restoreError?.properties?.code, {
    type: "string",
    enum: [
      "drive_item_not_deleted",
      "drive_parent_deleted",
      "drive_name_conflict"
    ]
  });
});

test("Drive and Project page OpenAPI responses document their page VM envelopes", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const driveResponse = jsonResponseSchema(body.paths, "/api/pages/drive", "get", "200");
  const projectResponse = jsonResponseSchema(body.paths, "/api/pages/project/{id}", "get", "200");
  const pageErrorCode = (path: string, status: string) => {
    const schema = jsonResponseSchema(body.paths, path, "get", status);
    const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "error"], `GET ${path} ${status} missing page error envelope`);
    return error?.properties?.code;
  };

  for (const schema of [driveResponse, projectResponse]) {
    assert.deepEqual(schema?.required, ["ok", "data", "meta"]);
    assert.deepEqual(Object.keys(schema?.properties ?? {}).sort(), ["data", "meta", "ok"]);
    assert.deepEqual(schema?.properties?.ok, { type: "boolean", const: true });
  }

  const driveData = driveResponse?.properties?.data as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  assert.deepEqual(driveData?.required, [
    "generated_at",
    "summary",
    "can_manage",
    "items",
    "deleted_items",
    "versions",
    "accepted_deliverables",
    "comments",
    "operations",
    "actions"
  ]);
  const driveSummary = driveData?.properties?.summary as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  assert.deepEqual(driveSummary?.required, [
    "item_count",
    "file_count",
    "folder_count",
    "deleted_item_count",
    "version_count",
    "accepted_deliverable_count",
    "pending_comment_count",
    "operation_count"
  ]);
  assert.deepEqual(Object.keys(driveSummary?.properties ?? {}).sort(), [
    "accepted_deliverable_count",
    "deleted_item_count",
    "file_count",
    "folder_count",
    "item_count",
    "operation_count",
    "pending_comment_count",
    "version_count"
  ]);

  const projectData = projectResponse?.properties?.data as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  assert.deepEqual(projectData?.required, [
    "generated_at",
    "project",
    "summary",
    "open_work_items",
    "drive",
    "actions"
  ]);
  assert.deepEqual(Object.keys(projectData?.properties ?? {}).sort(), [
    "actions",
    "drive",
    "empty_state",
    "generated_at",
    "open_work_items",
    "project",
    "summary"
  ]);
  assert.deepEqual(pageErrorCode("/api/pages/drive", "403"), { type: "string", enum: ["drive_forbidden"] });
  assert.deepEqual(pageErrorCode("/api/pages/drive", "404"), {
    type: "string",
    enum: ["drive_not_found", "drive_file_not_found"]
  });
  assert.deepEqual(pageErrorCode("/api/pages/project/{id}", "403"), { type: "string", enum: ["project_forbidden"] });
  assert.deepEqual(pageErrorCode("/api/pages/project/{id}", "404"), { type: "string", enum: ["project_not_found"] });
});

test("Calendar page OpenAPI documents query parameters and page VM response", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const pageErrorCode = (path: string, status: string) => {
    const schema = jsonResponseSchema(body.paths, path, "get", status);
    const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "error"], `GET ${path} ${status} missing page error envelope`);
    return error?.properties?.code;
  };

  assert.deepEqual(operationParameters(body.paths, "/api/pages/calendar", "get"), [
    { name: "date", in: "query", required: false, schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
    { name: "view", in: "query", required: false, schema: { type: "string", enum: ["day", "week"] } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);

  const calendarResponse = jsonResponseSchema(body.paths, "/api/pages/calendar", "get", "200");
  const calendarData = calendarResponse?.properties?.data as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  assert.deepEqual(calendarResponse?.required, ["ok", "data", "meta"]);
  assert.deepEqual(calendarData?.required, ["generated_at", "actor_user_id", "scope", "summary", "days", "blocks"]);
  assert.deepEqual(Object.keys(calendarData?.properties ?? {}).sort(), [
    "actor_user_id",
    "blocks",
    "days",
    "empty_state",
    "generated_at",
    "scope",
    "summary"
  ]);

  const scope = calendarData?.properties?.scope as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(scope?.required, ["date", "view", "range_start", "range_end"]);
  assert.deepEqual(scope?.properties?.view, { type: "string", enum: ["day", "week"] });
  const summary = calendarData?.properties?.summary as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(summary?.required, ["block_count", "overdue_count", "today_count", "week_count"]);
  assert.deepEqual(pageErrorCode("/api/pages/calendar", "422"), {
    type: "string",
    enum: ["invalid_calendar_query"]
  });
});

test("secondary page OpenAPI routes document query parameters and page VM envelopes", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const pageErrorCode = (path: string, status: string) => {
    const schema = jsonResponseSchema(body.paths, path, "get", status);
    const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "error"], `GET ${path} ${status} missing page error envelope`);
    return error?.properties?.code;
  };

  assert.deepEqual(operationParameters(body.paths, "/api/pages/meetings", "get"), [
    { name: "project_id", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    { name: "m", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    { name: "meeting_id", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
  ]);

  // 旧断言把 /api/pages/approvals 也钉成只有 locale；那已经不对，因为审批中心现在有真实的下一页入口，
  // typed page endpoint 必须公开 offset/limit 查询参数，否则第 101+ 条仍只是 UI 提示、没有可请求的页面。
  assert.deepEqual(operationParameters(body.paths, "/api/pages/approvals", "get"), [
    { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } },
    { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
    { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } }
  ]);

  for (const path of [
    "/api/pages/notifications",
    "/api/pages/health",
    "/api/pages/cost",
    "/api/pages/agents",
    "/api/pages/skills",
    "/api/pages/settings"
  ] as const) {
    assert.deepEqual(operationParameters(body.paths, path, "get"), [
      { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
    ], `GET ${path} missing locale query parameter`);
  }

  for (const [path, required] of [
    ["/api/pages/meetings", ["generated_at", "summary", "can_manage", "meetings"]],
    ["/api/pages/approvals", ["items", "requests", "filters", "counts", "items_detail"]],
    ["/api/pages/notifications", ["generated_at", "actor_user_id", "summary", "buckets", "items"]],
    ["/api/pages/health", ["generated_at", "actor_user_id", "viewer_scope", "summary", "cards"]],
    // R9.5 cost dashboards must expose army task/objective aggregates; the old required-field list
    // only covered pre-army user/team/workitem buckets and would let the OpenAPI contract drift.
    ["/api/pages/cost", ["generated_at", "currency", "total_cost_cny", "token_in", "token_out", "trend", "by_user", "by_team", "by_workitem", "by_task_plan", "by_objective", "model_breakdown", "budget", "notices", "top_exhaustion_risks"]],
    ["/api/pages/agents", ["generated_at", "kpis", "plans", "recent_escalations", "page_info"]],
    ["/api/pages/skills", ["generated_at", "skills", "totals"]],
    ["/api/pages/settings", ["generated_at", "locale", "runtime", "llm_runtime", "budgets", "language", "device"]]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, "get", "200");
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "data", "meta"], `GET ${path} missing page envelope`);
    assert.deepEqual(data?.required, required, `GET ${path} missing VM required fields`);
  }

  const notifications = jsonResponseSchema(body.paths, "/api/pages/notifications", "get", "200")
    ?.properties?.data as { properties?: Record<string, unknown> } | undefined;
  const notificationItem = (notifications?.properties?.items as {
    items?: { properties?: Record<string, unknown> };
  } | undefined)?.items;
  assert.deepEqual(notificationItem?.properties?.dedupe_key, { type: "string", maxLength: 256 });
  for (const path of [
    "/api/pages/approvals",
    "/api/pages/notifications",
    "/api/pages/health",
    "/api/pages/cost",
    "/api/pages/agents",
    "/api/pages/skills",
    "/api/pages/settings"
  ] as const) {
    assert.deepEqual(pageErrorCode(path, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
    assert.deepEqual(pageErrorCode(path, "403"), {
      type: "string",
      enum: ["invalid_client_token"]
    });
  }
  assert.deepEqual(pageErrorCode("/api/pages/meetings", "403"), { type: "string", enum: ["meeting_forbidden"] });
  assert.deepEqual(pageErrorCode("/api/pages/meetings", "404"), { type: "string", enum: ["meeting_not_found"] });
});

test("R9.7 Agent Army OpenAPI schema documents nested dashboard VM fields", async () => {
  type OpenApiSchema = {
    additionalProperties?: boolean;
    items?: OpenApiSchema;
    maxItems?: number;
    properties?: Record<string, OpenApiSchema>;
    required?: string[];
    type?: string;
  };

  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const data = jsonResponseSchema(body.paths, "/api/pages/agents", "get", "200")
    ?.properties?.data as OpenApiSchema | undefined;

  const plans = data?.properties?.plans;
  const plan = plans?.items;
  assert.equal(plans?.maxItems, 20);
  assert.equal(plan?.additionalProperties, false);
  assert.deepEqual(plan?.required, [
    "plan_id",
    "work_item_id",
    "work_item_code",
    "work_item_title",
    "work_item_href",
    "status",
    "progress",
    "roles",
    "statuses",
    "cost",
    "judge",
    "updated_at"
  ]);

  const progress = plan?.properties?.progress;
  assert.deepEqual(progress?.required, ["completed", "total", "label"]);
  const roles = plan?.properties?.roles;
  assert.deepEqual(roles?.items?.required, ["role", "count"]);
  const statuses = plan?.properties?.statuses;
  assert.deepEqual(statuses?.items?.required, ["status", "count"]);
  const cost = plan?.properties?.cost;
  assert.deepEqual(cost?.required, ["used_cny"]);
  const judge = plan?.properties?.judge;
  assert.deepEqual(judge?.required, ["passed", "total", "pass_rate_pct"]);
  const blocker = plan?.properties?.oldest_blocker;
  assert.deepEqual(blocker?.required, ["kind", "label", "age_seconds"]);

  const recentEscalation = data?.properties?.recent_escalations?.items;
  assert.equal(data?.properties?.recent_escalations?.maxItems, 5);
  assert.equal(recentEscalation?.additionalProperties, false);
  assert.deepEqual(recentEscalation?.required, ["id", "work_item_id", "title", "reason_preview", "created_at", "href"]);
  const sourceWarnings = data?.properties?.source_warnings;
  assert.equal(sourceWarnings?.items?.additionalProperties, false);
  assert.deepEqual(sourceWarnings?.items?.required, ["source", "message"]);
  assert.deepEqual(sourceWarnings?.items?.properties?.source, {
    type: "string",
    enum: ["approvals", "proposals", "escalations", "sync_conflicts"]
  });

  const pageInfo = data?.properties?.page_info;
  assert.equal(pageInfo?.additionalProperties, false);
  assert.deepEqual(pageInfo?.required, [
    "plan_limit",
    "returned",
    "plans_capped",
    "items_capped",
    "runs_capped",
    "escalation_limit",
    "escalation_returned",
    "escalations_capped"
  ]);
});

test("work item and proposal page OpenAPI routes document id parameters and page VM envelopes", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const path of ["/api/pages/workitems/{id}", "/api/pages/proposals/{id}"] as const) {
    assert.deepEqual(operationParameters(body.paths, path, "get"), [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
    ], `GET ${path} missing id/locale parameters`);
  }

  const workItemResponse = jsonResponseSchema(body.paths, "/api/pages/workitems/{id}", "get", "200");
  const workItemData = workItemResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(workItemResponse?.required, ["ok", "data", "meta"]);
  assert.deepEqual(workItemData?.required, [
    "workitem",
    "acceptance",
    "agent_trace_preview",
    "accepted_deliverables",
    "evidence_refs",
    "actions"
  ]);
  const taskPlanSchema = workItemData?.properties?.task_plan as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(taskPlanSchema?.required, [
    "id",
    "work_item_id",
    "workspace_id",
    "status",
    "created_by",
    "created_at",
    "updated_at",
    "items",
    "items_capped"
  ]);
  assert.deepEqual(taskPlanSchema?.properties?.status, {
    type: "string",
    enum: ["draft", "proposed", "approved", "dispatching", "paused", "done", "cancelled"]
  });
  const agentTeamSchema = workItemData?.properties?.agent_team as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(agentTeamSchema?.required, [
    "plan_id",
    "status",
    "completed_count",
    "total_count",
    "cost_used_cny",
    "runs_capped",
    "items"
  ]);
  const agentTeamItems = agentTeamSchema?.properties?.items as { type?: string; maxItems?: number; items?: { required?: string[]; properties?: Record<string, unknown> } } | undefined;
  assert.equal(agentTeamItems?.type, "array");
  assert.equal(agentTeamItems?.maxItems, 50);
  assert.deepEqual(agentTeamItems?.items?.required, [
    "task_plan_item_id",
    "seq",
    "title",
    "role",
    "plan_status",
    "status",
    "budget_share_pct",
    "depends_on",
    "waiting_for_seq"
  ]);
  assert.deepEqual(agentTeamItems?.items?.properties?.status, {
    type: "string",
    enum: ["pending", "dispatched", "succeeded", "failed", "needs_human", "skipped"]
  });
  const pageErrorCode = (path: string, status: string) => {
    const schema = jsonResponseSchema(body.paths, path, "get", status);
    const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "error"], `GET ${path} ${status} missing page error envelope`);
    return error?.properties?.code;
  };
  assert.deepEqual(pageErrorCode("/api/pages/workitems/{id}", "403"), { type: "string", enum: ["forbidden"] });
  assert.deepEqual(pageErrorCode("/api/pages/workitems/{id}", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(pageErrorCode("/api/pages/workitems/{id}", "409"), {
    type: "string",
    enum: ["workitem_state_conflict"]
  });

  const proposalResponse = jsonResponseSchema(body.paths, "/api/pages/proposals/{id}", "get", "200");
  const proposalData = proposalResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(proposalResponse?.required, ["ok", "data", "meta"]);
  assert.deepEqual(proposalData?.required, [
    "proposal_id",
    "work_item_id",
    "title",
    "status",
    "manifest",
    "evidence_refs",
    "review_actions",
    "comments"
  ]);
  const proposalReviewActions = (proposalData?.properties?.review_actions as { properties?: Record<string, unknown> } | undefined)?.properties;
  const approveHoldAction = proposalReviewActions?.approve_hold as { properties?: Record<string, unknown> } | undefined;
  assert.ok(approveHoldAction);
  assert.ok(approveHoldAction?.properties?.request_json);
  assert.ok(proposalReviewActions?.merge);
  assert.deepEqual(pageErrorCode("/api/pages/proposals/{id}", "403"), { type: "string", enum: ["forbidden"] });
  assert.deepEqual(pageErrorCode("/api/pages/proposals/{id}", "404"), { type: "string", enum: ["not_found"] });
});

test("attention and gold path page OpenAPI routes document locale and page VM envelopes", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const path of ["/api/pages/attention", "/api/pages/gold-path"] as const) {
    assert.deepEqual(operationParameters(body.paths, path, "get"), [
      { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["zh-CN", "en-US"] } }
    ], `GET ${path} missing locale query parameter`);
  }

  const attentionResponse = jsonResponseSchema(body.paths, "/api/pages/attention", "get", "200");
  const attentionData = attentionResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(attentionResponse?.required, ["ok", "data", "meta"]);
  assert.deepEqual(attentionData?.required, ["queue", "background_runs", "cuu_state"]);
  assert.deepEqual(Object.keys(attentionData?.properties ?? {}).sort(), [
    "background_runs",
    "cuu_state",
    "primary",
    "queue",
    "source_warnings",
    "worklog"
  ]);
  const sourceWarnings = attentionData?.properties?.source_warnings as {
    items?: { properties?: { source?: unknown } };
  } | undefined;
  assert.deepEqual(sourceWarnings?.items?.properties?.source, {
    type: "string",
    enum: ["approvals", "proposals", "escalations", "sync_conflicts"]
  });

  const goldPathResponse = jsonResponseSchema(body.paths, "/api/pages/gold-path", "get", "200");
  const goldPathData = goldPathResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(goldPathResponse?.required, ["ok", "data", "meta"]);
  assert.deepEqual(goldPathData?.required, ["fixture_id", "routes", "page_vms", "events", "cuu_states"]);
  const routes = goldPathData?.properties?.routes as { required?: string[] } | undefined;
  assert.deepEqual(routes?.required, ["home", "intake", "approvals", "workitem", "proposal", "replay", "cost", "knowledge"]);

  for (const path of ["/api/pages/attention", "/api/pages/gold-path"] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, "get", "401"), {
      type: "string",
      enum: ["not_identified"]
    });
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, "get", "403"), {
      type: "string",
      enum: ["invalid_client_token"]
    });
  }
});

test("health, ready, and client-device OpenAPI routes document startup contracts", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  const health = jsonResponseSchema(body.paths, "/api/health", "get", "200");
  assert.deepEqual(health?.required, ["ok", "service", "env", "runtime", "port", "ai_provider_configured"]);

  for (const status of ["200", "503"] as const) {
    const ready = jsonResponseSchema(body.paths, "/api/ready", "get", status);
    assert.deepEqual(ready?.required, ["ready", "checks"], `GET /api/ready ${status} missing readiness schema`);
  }

  const registerRequest = jsonRequestSchema(body.paths, "/api/client-devices/register", "post");
  assert.deepEqual(registerRequest?.required, ["device_name"]);
  assert.deepEqual(Object.keys(registerRequest?.properties ?? {}).sort(), ["device_name", "platform"]);

  const register = jsonResponseSchema(body.paths, "/api/client-devices/register", "post", "201");
  assert.deepEqual(register?.required, ["device", "client_token"]);
  const registerDevice = register?.properties?.device as { required?: string[] } | undefined;
  assert.deepEqual(registerDevice?.required, ["id", "user_id", "device_name", "platform", "created_at", "updated_at"]);
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/client-devices/register", "post", "400"), {
    type: "string",
    enum: ["malformed_json", "json_object_required"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/client-devices/register", "post", "401"), {
    type: "string",
    enum: ["not_identified"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/client-devices/register", "post", "403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/client-devices/register", "post", "422"), {
    type: "string",
    enum: ["validation_error"]
  });

  const deviceList = jsonResponseSchema(body.paths, "/api/client-devices/me", "get", "200") as { type?: string } | undefined;
  assert.equal(deviceList?.type, "array");
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/client-devices/me", "get", "401"), {
    type: "string",
    enum: ["not_identified"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/client-devices/me", "get", "403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });
  for (const path of [
    "/api/client-devices/current",
    "/api/client-devices/{deviceId}/revoke",
    "/api/client-devices/revoke-current"
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, path.includes("revoke") ? "post" : "get", "200");
    assert.deepEqual(schema?.required, ["id", "user_id", "device_name", "platform", "created_at", "updated_at"]);
  }
  for (const [path, method] of [
    ["/api/client-devices/current", "get"],
    ["/api/client-devices/{deviceId}/revoke", "post"],
    ["/api/client-devices/revoke-current", "post"]
  ] as const) {
    assert.deepEqual(jsonErrorCodeProperty(body.paths, path, method, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
  }
  for (const [path, method] of [
    ["/api/client-devices/current", "get"],
    ["/api/client-devices/revoke-current", "post"]
  ] as const) {
    const localRequired = jsonResponseSchema(body.paths, path, method, "403");
    const localRequiredError = localRequired?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(localRequired?.required, ["ok", "error"]);
    assert.deepEqual(localRequiredError?.properties?.code, {
      type: "string",
      enum: ["invalid_client_token", "forbidden"]
    });
  }
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/client-devices/{deviceId}/revoke", "post", "403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });
  for (const path of [
    "/api/client-devices/{deviceId}/revoke",
    "/api/client-devices/revoke-current"
  ] as const) {
    const missing = jsonResponseSchema(body.paths, path, "post", "404");
    const missingError = missing?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(missing?.required, ["ok", "error"]);
    assert.deepEqual(missingError?.properties?.code, { type: "string", enum: ["not_found"] });
  }
  assert.deepEqual(parameterByName(body.paths, "/api/client-devices/{deviceId}/revoke", "post", "deviceId"), {
    name: "deviceId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" }
  });
});

test("auth OpenAPI routes document request bodies and raw success payloads", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const [path, method, required] of [
    ["/api/auth/identify", "post", ["nickname"]],
    ["/api/auth/desktop-bootstrap", "post", ["nickname", "device_name"]],
    ["/api/auth/register", "post", ["email", "password", "nickname"]],
    ["/api/auth/login", "post", ["email", "password"]],
    ["/api/auth/password", "post", ["current_password", "new_password"]],
    ["/api/auth/invites", "post", ["email"]],
    ["/api/auth/invites/accept", "post", ["token", "nickname", "password"]],
    ["/api/auth/preferences", "patch", ["locale"]]
  ] as const) {
    assert.deepEqual(jsonRequestSchema(body.paths, path, method)?.required, required, `${method.toUpperCase()} ${path} request required fields drifted`);
  }
  const desktopBootstrapRequest = jsonRequestSchema(body.paths, "/api/auth/desktop-bootstrap", "post");
  assert.ok(
    desktopBootstrapRequest?.properties?.admin_secret,
    "POST /api/auth/desktop-bootstrap request schema must document optional admin_secret"
  );

  for (const [path, method, status] of [
    ["/api/auth/identify", "post", "200"],
    ["/api/auth/identify", "post", "201"],
    ["/api/auth/register", "post", "201"],
    ["/api/auth/login", "post", "200"],
    ["/api/auth/invites/accept", "post", "201"],
    ["/api/auth/preferences", "patch", "200"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, status);
    assert.deepEqual(schema?.required, [
      "id",
      "nickname",
      "is_admin",
      "availability_status",
      "display_name",
      "created",
      "locale",
      "preferences"
    ], `${method.toUpperCase()} ${path} ${status} missing identity response`);
  }

  const me = jsonResponseSchema(body.paths, "/api/auth/me", "get", "200") as { anyOf?: unknown[] } | undefined;
  assert.equal(me?.anyOf?.length, 2);

  const desktop = jsonResponseSchema(body.paths, "/api/auth/desktop-bootstrap", "post", "201");
  assert.deepEqual(desktop?.required, ["identity", "device", "client_token"]);

  const invite = jsonResponseSchema(body.paths, "/api/auth/invites", "post", "201");
  assert.deepEqual(invite?.required, ["invite_id", "token", "email", "expires_at"]);

  const authErrorCodes = (path: string, method: string, status: string) => {
    const schema = jsonResponseSchema(body.paths, path, method, status);
    const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "error"], `${method.toUpperCase()} ${path} ${status} missing auth error envelope`);
    return error?.properties?.code;
  };
  assert.deepEqual(authErrorCodes("/api/auth/identify", "post", "403"), { type: "string", enum: ["forbidden"] });
  assert.deepEqual(authErrorCodes("/api/auth/identify", "post", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/identify", "post", "429"), { type: "string", enum: ["rate_limited"] });
  assert.deepEqual(authErrorCodes("/api/auth/desktop-bootstrap", "post", "403"), { type: "string", enum: ["forbidden"] });
  assert.deepEqual(authErrorCodes("/api/auth/desktop-bootstrap", "post", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/desktop-bootstrap", "post", "429"), { type: "string", enum: ["rate_limited"] });
  assert.deepEqual(authErrorCodes("/api/auth/register", "post", "400"), { type: "string", enum: ["bad_request"] });
  assert.deepEqual(authErrorCodes("/api/auth/register", "post", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/register", "post", "409"), { type: "string", enum: ["conflict"] });
  assert.deepEqual(authErrorCodes("/api/auth/register", "post", "422"), { type: "string", enum: ["validation_error"] });
  assert.deepEqual(authErrorCodes("/api/auth/login", "post", "401"), { type: "string", enum: ["not_identified"] });
  assert.deepEqual(authErrorCodes("/api/auth/login", "post", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/login", "post", "429"), { type: "string", enum: ["rate_limited"] });
  assert.deepEqual(authErrorCodes("/api/auth/password", "post", "400"), { type: "string", enum: ["bad_request"] });
  assert.deepEqual(authErrorCodes("/api/auth/password", "post", "401"), { type: "string", enum: ["not_identified"] });
  assert.deepEqual(authErrorCodes("/api/auth/password", "post", "403"), { type: "string", enum: ["forbidden"] });
  assert.deepEqual(authErrorCodes("/api/auth/password", "post", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/password", "post", "422"), { type: "string", enum: ["validation_error"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites", "post", "401"), { type: "string", enum: ["not_identified"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites", "post", "403"), { type: "string", enum: ["forbidden"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites", "post", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites", "post", "422"), { type: "string", enum: ["validation_error"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites/accept", "post", "400"), { type: "string", enum: ["bad_request"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites/accept", "post", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites/accept", "post", "409"), { type: "string", enum: ["conflict"] });
  assert.deepEqual(authErrorCodes("/api/auth/invites/accept", "post", "422"), { type: "string", enum: ["validation_error"] });
  assert.deepEqual(authErrorCodes("/api/auth/logout", "post", "401"), { type: "string", enum: ["not_identified"] });
  assert.deepEqual(authErrorCodes("/api/auth/logout", "post", "403"), { type: "string", enum: ["invalid_client_token"] });
  assert.deepEqual(authErrorCodes("/api/auth/preferences", "patch", "400"), {
    type: "string",
    enum: ["malformed_json", "json_object_required"]
  });
  assert.deepEqual(authErrorCodes("/api/auth/preferences", "patch", "401"), { type: "string", enum: ["not_identified"] });
  assert.deepEqual(authErrorCodes("/api/auth/preferences", "patch", "403"), { type: "string", enum: ["invalid_client_token"] });
  assert.deepEqual(authErrorCodes("/api/auth/preferences", "patch", "404"), { type: "string", enum: ["not_found"] });
  assert.deepEqual(authErrorCodes("/api/auth/preferences", "patch", "422"), { type: "string", enum: ["validation_error"] });
  assert.deepEqual(authErrorCodes("/api/auth/preferences", "patch", "501"), { type: "string", enum: ["http_error"] });
  assert.deepEqual(authErrorCodes("/api/auth/users/{id}/deactivate", "post", "400"), { type: "string", enum: ["bad_request"] });
  assert.deepEqual(authErrorCodes("/api/auth/users/{id}/deactivate", "post", "401"), { type: "string", enum: ["not_identified"] });
  assert.deepEqual(authErrorCodes("/api/auth/users/{id}/deactivate", "post", "403"), { type: "string", enum: ["forbidden"] });
  assert.deepEqual(authErrorCodes("/api/auth/users/{id}/deactivate", "post", "404"), { type: "string", enum: ["not_found"] });

  for (const [path, method] of [
    ["/api/auth/logout", "post"],
    ["/api/auth/password", "post"],
    ["/api/auth/users/{id}/deactivate", "post"]
  ] as const) {
    assert.deepEqual(jsonResponseSchema(body.paths, path, method, "200")?.required, ["ok"]);
  }
  assert.deepEqual(parameterByName(body.paths, "/api/auth/users/{id}/deactivate", "post", "id"), {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" }
  });
});

test("cost OpenAPI routes document budget usage, policies, and update payloads", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  const usageResponse = jsonResponseSchema(body.paths, "/api/cost/usage", "get", "200");
  const usageData = usageResponse?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(usageResponse?.required, ["ok", "data"]);
  assert.deepEqual(usageData?.required, ["me", "team", "scopes", "active_notices", "generated_at"]);
  assert.deepEqual(Object.keys(usageData?.properties ?? {}).sort(), [
    "active_notices",
    "generated_at",
    "me",
    "scopes",
    "team"
  ]);
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/cost/usage", "get", "401"), {
    type: "string",
    enum: ["not_identified"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/cost/usage", "get", "403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });

  const policiesResponse = jsonResponseSchema(body.paths, "/api/cost/policies", "get", "200");
  const policiesData = policiesResponse?.properties?.data as { items?: { required?: string[] } } | undefined;
  assert.deepEqual(policiesResponse?.required, ["ok", "data"]);
  assert.deepEqual(policiesData?.items?.required, [
    "id",
    "scope_kind",
    "period",
    "max_tokens",
    "max_cost_cny",
    "warning_ratio",
    "critical_ratio",
    "on_warning",
    "on_exhausted",
    "enabled",
    "version"
  ]);
  const policiesForbidden = jsonResponseSchema(body.paths, "/api/cost/policies", "get", "403");
  const policiesForbiddenError = policiesForbidden?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(policiesForbidden?.required, ["ok", "error"]);
  assert.deepEqual(policiesForbiddenError?.properties?.code, { type: "string", enum: ["forbidden"] });

  assert.deepEqual(operationParameters(body.paths, "/api/cost/policies/{scope}/{id}", "put"), [
    // R9.5 added task/objective policy overrides; the old path enum documented only
    // pre-army scopes even though the runtime route already accepts the new scopes.
    { name: "scope", in: "path", required: true, schema: { type: "string", enum: ["workitem", "task", "objective", "user", "team", "eval"] } },
    { name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } }
  ]);
  assert.equal(jsonRequestBodyRequired(body.paths, "/api/cost/policies/{scope}/{id}", "put"), true);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/cost/policies/{scope}/{id}", "put")).sort(), [
    "critical_ratio",
    "enabled",
    "max_cost_cny",
    "max_tokens",
    "model_route_hint",
    "on_exhausted",
    "on_warning",
    "warning_ratio"
  ]);

  const updateResponse = jsonResponseSchema(body.paths, "/api/cost/policies/{scope}/{id}", "put", "200");
  const updateData = updateResponse?.properties?.data as { required?: string[] } | undefined;
  assert.deepEqual(updateResponse?.required, ["ok", "data"]);
  assert.deepEqual(updateData?.required, policiesData?.items?.required);
  const updateForbidden = jsonResponseSchema(body.paths, "/api/cost/policies/{scope}/{id}", "put", "403");
  const updateForbiddenError = updateForbidden?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(updateForbidden?.required, ["ok", "error"]);
  assert.deepEqual(updateForbiddenError?.properties?.code, { type: "string", enum: ["forbidden"] });
  const updateNotFound = jsonResponseSchema(body.paths, "/api/cost/policies/{scope}/{id}", "put", "404");
  const updateNotFoundError = updateNotFound?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(updateNotFound?.required, ["ok", "error"]);
  assert.deepEqual(updateNotFoundError?.properties?.code, { type: "string", enum: ["not_found"] });
  const updateValidation = jsonResponseSchema(body.paths, "/api/cost/policies/{scope}/{id}", "put", "422");
  const updateValidationError = updateValidation?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(updateValidation?.required, ["ok", "error"]);
  assert.deepEqual(updateValidationError?.properties?.code, { type: "string", enum: ["validation_error"] });
});

test("Drive mutation OpenAPI responses document the refreshed Drive Page VM envelope", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  for (const [path, method] of [
    ["/api/drive/projects/{projectId}/files", "post"],
    ["/api/drive/projects/{projectId}/items/{itemId}/delete", "post"],
    ["/api/drive/projects/{projectId}/items/{itemId}/restore", "post"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    assert.deepEqual(schema?.required, ["ok", "data", "meta"], `${method.toUpperCase()} ${path} missing page envelope response`);
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, [
      "generated_at",
      "summary",
      "can_manage",
      "items",
      "deleted_items",
      "versions",
      "accepted_deliverables",
      "comments",
      "operations",
      "actions"
    ]);
    assert.ok(data?.properties?.summary, `${method.toUpperCase()} ${path} missing Drive summary schema`);
  }
});

test("Drive preview and download OpenAPI responses document file payloads", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  const download = responseObject(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/download", "get", "200");
  assert.deepEqual(Object.keys(download?.headers ?? {}).sort(), ["Content-Disposition", "Content-Length"]);
  assert.deepEqual(download?.content?.["application/octet-stream"], {
    schema: { type: "string", format: "binary" }
  });
  const driveDownloadMissing = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/download", "get", "404");
  const driveDownloadMissingError = driveDownloadMissing?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(driveDownloadMissing?.required, ["ok", "error"]);
  assert.deepEqual(driveDownloadMissingError?.properties?.code, {
    type: "string",
    enum: ["drive_not_found", "drive_file_not_found", "drive_file_missing"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/download", "get", "403"), {
    type: "string",
    enum: ["drive_forbidden"]
  });

  const preview = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/preview", "get", "200");
  assert.deepEqual(preview?.required, ["ok", "data"]);
  const previewData = preview?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(previewData?.required, [
    "id",
    "item_id",
    "filename",
    "size_bytes",
    "preview_type",
    "text",
    "truncated",
    "download_href"
  ]);
  assert.deepEqual(previewData?.properties?.preview_type, { type: "string", enum: ["text"] });
  const drivePreviewMissing = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/preview", "get", "404");
  const drivePreviewMissingError = drivePreviewMissing?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(drivePreviewMissing?.required, ["ok", "error"]);
  assert.deepEqual(drivePreviewMissingError?.properties?.code, {
    type: "string",
    enum: ["drive_not_found", "drive_file_not_found", "drive_file_missing"]
  });
  assert.deepEqual(jsonErrorCodeProperty(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/preview", "get", "403"), {
    type: "string",
    enum: ["drive_forbidden"]
  });
  const drivePreviewUnsupported = jsonResponseSchema(body.paths, "/api/drive/projects/{projectId}/items/{itemId}/preview", "get", "415");
  const drivePreviewUnsupportedError = drivePreviewUnsupported?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(drivePreviewUnsupported?.required, ["ok", "error"]);
  assert.deepEqual(drivePreviewUnsupportedError?.properties?.code, {
    type: "string",
    enum: ["drive_preview_unsupported"]
  });
});

test("work item accepted deliverable OpenAPI responses document file payloads", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  const download = responseObject(
    body.paths,
    "/api/workitems/{id}/deliverables/{acceptedChangeId}/download",
    "get",
    "200"
  );
  assert.deepEqual(Object.keys(download?.headers ?? {}).sort(), ["Content-Disposition", "Content-Length"]);
  assert.deepEqual(download?.content?.["application/octet-stream"], {
    schema: { type: "string", format: "binary" }
  });
  const downloadMissing = jsonResponseSchema(
    body.paths,
    "/api/workitems/{id}/deliverables/{acceptedChangeId}/download",
    "get",
    "404"
  );
  const downloadMissingError = downloadMissing?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(downloadMissing?.required, ["ok", "error"]);
  assert.deepEqual(downloadMissingError?.properties?.code, {
    type: "string",
    enum: ["not_found", "deliverable_not_found", "deliverable_file_missing"]
  });

  const preview = jsonResponseSchema(
    body.paths,
    "/api/workitems/{id}/deliverables/{acceptedChangeId}/preview",
    "get",
    "200"
  );
  assert.deepEqual(preview?.required, ["ok", "data"]);
  const previewData = preview?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(previewData?.required, [
    "id",
    "filename",
    "size_bytes",
    "preview_type",
    "text",
    "truncated",
    "download_href"
  ]);
  assert.deepEqual(previewData?.properties?.preview_type, { type: "string", enum: ["text"] });
  const previewMissing = jsonResponseSchema(
    body.paths,
    "/api/workitems/{id}/deliverables/{acceptedChangeId}/preview",
    "get",
    "404"
  );
  const previewMissingError = previewMissing?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(previewMissing?.required, ["ok", "error"]);
  assert.deepEqual(previewMissingError?.properties?.code, {
    type: "string",
    enum: ["not_found", "deliverable_not_found", "deliverable_file_missing"]
  });
  const previewUnsupported = jsonResponseSchema(
    body.paths,
    "/api/workitems/{id}/deliverables/{acceptedChangeId}/preview",
    "get",
    "415"
  );
  const previewUnsupportedError = previewUnsupported?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(previewUnsupported?.required, ["ok", "error"]);
  assert.deepEqual(previewUnsupportedError?.properties?.code, {
    type: "string",
    enum: ["deliverable_preview_unsupported"]
  });

  const restore = jsonResponseSchema(
    body.paths,
    "/api/workitems/{id}/deliverables/{acceptedChangeId}/restore",
    "post",
    "200"
  );
  assert.deepEqual(restore?.required, ["ok", "data"]);
  const restoreData = restore?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(restoreData?.required, ["accepted_deliverable"]);
  const accepted = restoreData?.properties?.accepted_deliverable as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(accepted?.required, [
    "id",
    "work_item_id",
    "proposal_id",
    "change_id",
    "target_kind",
    "target_key",
    "change_type",
    "accepted_version",
    "accepted_at"
  ]);
  assert.deepEqual(accepted?.properties?.restore_href, { type: "string", minLength: 1 });
  const restoreConflict = jsonResponseSchema(
    body.paths,
    "/api/workitems/{id}/deliverables/{acceptedChangeId}/restore",
    "post",
    "409"
  );
  const restoreConflictError = restoreConflict?.properties?.error as { properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(restoreConflict?.required, ["ok", "error"]);
  assert.deepEqual(restoreConflictError?.properties?.code, {
    type: "string",
    enum: [
      "deliverable_not_versioned",
      "deliverable_no_previous_version",
      "deliverable_version_changed"
    ]
  });
});

test("notification OpenAPI routes document list, preferences, and action payloads", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };
  const errorCode = (path: string, method: string, status: string) => {
    const schema = jsonResponseSchema(body.paths, path, method, status);
    const error = schema?.properties?.error as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(schema?.required, ["ok", "error"], `${method.toUpperCase()} ${path} ${status} missing error envelope`);
    return error?.properties?.code;
  };

  const list = jsonResponseSchema(body.paths, "/api/notifications", "get", "200");
  assert.deepEqual(list?.required, ["ok", "data"]);
  const listData = list?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(listData?.required, ["items", "counts"]);
  const listItem = (listData?.properties?.items as { items?: { required?: string[]; properties?: Record<string, unknown> } } | undefined)?.items;
  assert.deepEqual(listItem?.required, ["id", "user_id", "type", "severity", "title", "created_at", "updated_at"]);
  assert.deepEqual(listItem?.properties?.severity, { type: "string", enum: ["normal", "high", "urgent"] });
  const counts = listData?.properties?.counts as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(counts?.required, ["unread", "total"]);
  assert.deepEqual(errorCode("/api/notifications", "get", "401"), {
    type: "string",
    enum: ["not_identified"]
  });
  assert.deepEqual(errorCode("/api/notifications", "get", "403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });

  for (const [path, method] of [
    ["/api/notifications/preferences", "get"],
    ["/api/notifications/preferences", "put"]
  ] as const) {
    const schema = jsonResponseSchema(body.paths, path, method, "200");
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, ["muted_notification_types"], `${method.toUpperCase()} ${path} missing preferences response`);
    assert.deepEqual(data?.properties?.muted_notification_types, {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 64 }
    });
  }

  assert.deepEqual(jsonRequestSchema(body.paths, "/api/notifications/preferences", "put")?.required, ["muted_notification_types"]);
  assert.deepEqual(jsonRequestProperties(body.paths, "/api/notifications/preferences", "put").muted_notification_types, {
    type: "array",
    maxItems: 100,
    items: { type: "string", minLength: 1, maxLength: 64 }
  });
  for (const [path, method] of [
    ["/api/notifications/preferences", "get"],
    ["/api/notifications/preferences", "put"],
    ["/api/notifications/read-all", "post"],
    ["/api/notifications/{id}/read", "post"],
    ["/api/notifications/{id}/dismiss", "post"],
    ["/api/notifications/{id}/complete", "post"]
  ] as const) {
    assert.deepEqual(errorCode(path, method, "401"), {
      type: "string",
      enum: ["not_identified"]
    });
    assert.deepEqual(errorCode(path, method, "403"), {
      type: "string",
      enum: ["invalid_client_token"]
    });
  }
  assert.deepEqual(errorCode("/api/notifications/preferences", "put", "400"), {
    type: "string",
    enum: ["malformed_json", "json_object_required"]
  });
  assert.deepEqual(errorCode("/api/notifications/preferences", "put", "422"), {
    type: "string",
    enum: ["validation_error"]
  });
  assert.deepEqual(errorCode("/api/notifications/preferences", "put", "404"), {
    type: "string",
    enum: ["not_found"]
  });
  assert.deepEqual(errorCode("/api/notifications/preferences", "put", "501"), {
    type: "string",
    enum: ["not_implemented"]
  });

  for (const path of [
    "/api/notifications/{id}/read",
    "/api/notifications/{id}/dismiss",
    "/api/notifications/{id}/complete"
  ] as const) {
    assert.deepEqual(parameterByName(body.paths, path, "post", "id"), {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" }
    });
    const schema = jsonResponseSchema(body.paths, path, "post", "200");
    const data = schema?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, ["id", "user_id", "type", "severity", "title", "created_at", "updated_at"]);
    assert.deepEqual(errorCode(path, "post", "404"), {
      type: "string",
      enum: ["not_found"]
    });
  }
  const completeOperation = body.paths["/api/notifications/{id}/complete"]?.post as
    | { summary?: string; description?: string }
    | undefined;
  assert.equal(completeOperation?.summary, "Complete and archive an FYI notification");
  assert.match(completeOperation?.description ?? "", /notification_needs_decision/u);
  assert.deepEqual(errorCode("/api/notifications/{id}/complete", "post", "409"), {
    type: "string",
    enum: ["notification_needs_decision"]
  });

  const readAll = jsonResponseSchema(body.paths, "/api/notifications/read-all", "post", "200");
  const readAllData = readAll?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(readAllData?.required, ["updated"]);
  assert.deepEqual(readAllData?.properties?.updated, { type: "integer", minimum: 0 });
});

test("project OpenAPI routes document list and bootstrap response payloads", async () => {
  const response = await app.request("/api/openapi.json");
  const body = await response.json() as { paths: Record<string, Record<string, unknown>> };

  const list = jsonResponseSchema(body.paths, "/api/projects", "get", "200");
  assert.deepEqual(list?.required, ["ok", "data"]);
  const listData = list?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(listData?.required, ["generated_at", "projects"]);
  const projectItem = (listData?.properties?.projects as { items?: { required?: string[]; properties?: Record<string, unknown> } } | undefined)?.items;
  assert.deepEqual(projectItem?.required, [
    "id",
    "name",
    "slug",
    "owner_nickname",
    "archived",
    "created_at",
    "updated_at",
    "open_work_item_count"
  ]);
  assert.deepEqual(projectItem?.properties?.open_work_item_count, { type: "integer", minimum: 0 });
  const listAuthError = (status: string) => jsonErrorCodeProperty(body.paths, "/api/projects", "get", status);
  assert.deepEqual(listAuthError("401"), {
    type: "string",
    enum: ["not_identified"]
  });
  assert.deepEqual(listAuthError("403"), {
    type: "string",
    enum: ["invalid_client_token"]
  });

  assert.equal(jsonRequestBodyRequired(body.paths, "/api/projects/bootstrap", "post"), false);
  assert.deepEqual(Object.keys(jsonRequestProperties(body.paths, "/api/projects/bootstrap", "post")).sort(), [
    "description",
    "name",
    "slug"
  ]);

  for (const status of ["200", "201"] as const) {
    const bootstrap = jsonResponseSchema(body.paths, "/api/projects/bootstrap", "post", status);
    assert.deepEqual(bootstrap?.required, ["ok", "data"], `POST /api/projects/bootstrap missing ${status} envelope`);
    const data = bootstrap?.properties?.data as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(data?.required, ["project", "created", "context_ready"]);
    assert.deepEqual(data?.properties?.created, { type: "boolean" });
    assert.deepEqual(data?.properties?.context_ready, { type: "boolean", const: true });
    const project = data?.properties?.project as { required?: string[]; properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(project?.required, ["id", "name", "slug", "owner_nickname"]);
  }

  const slugConflict = jsonResponseSchema(body.paths, "/api/projects/bootstrap", "post", "409");
  assert.deepEqual(slugConflict?.required, ["ok", "error"]);
  assert.deepEqual(slugConflict?.properties?.ok, { type: "boolean", const: false });
  const error = slugConflict?.properties?.error as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(error?.required, ["code", "message"]);
  assert.deepEqual(error?.properties?.code, { type: "string", enum: ["project_slug_occupied"] });
  const humanRequired = jsonResponseSchema(body.paths, "/api/projects/bootstrap", "post", "403");
  assert.deepEqual(humanRequired?.required, ["ok", "error"]);
  const humanRequiredError = humanRequired?.properties?.error as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  assert.deepEqual(humanRequiredError?.required, ["code", "message"]);
  assert.deepEqual(humanRequiredError?.properties?.code, { type: "string", enum: ["human_required"] });
});

test("unknown endpoints use the shared error shape", async () => {
  const response = await app.request("/missing");

  assert.equal(response.status, 404);
  const body = (await response.json()) as ErrorBody;
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "not_found");
});

test("invalid desktop client tokens use a stable recoverable error code", () => {
  assert.equal(httpErrorCodeFor(new HTTPException(403, { message: "invalid client token" })), "invalid_client_token");
  assert.equal(httpErrorCodeFor(new HTTPException(403, { message: "forbidden" })), "forbidden");
});

test("malformed JSON request bodies use stable client-debuggable error codes", () => {
  assert.equal(httpErrorCodeFor(new HTTPException(400, { message: malformedJsonMessage })), "malformed_json");
  assert.equal(httpErrorCodeFor(new HTTPException(400, { message: jsonObjectMessage })), "json_object_required");
  assert.equal(httpErrorCodeFor(new HTTPException(422, { message: "from must be an ISO datetime." })), "validation_error");
  assert.equal(httpErrorCodeFor(new HTTPException(409, { message: "Snapshot restore conflict." })), "conflict");
  assert.equal(httpErrorCodeFor(new HTTPException(429, { message: "Too many attempts." })), "rate_limited");
});

function appImportGuardRegisterUrl() {
  const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.endsWith("/apps/api/src/app.ts") || result.url.endsWith("/apps/api/src/app.js")) {
    throw new Error("production app import forbidden in isolated route test guard");
  }
  return result;
}
`;
  const registerSource = `
import { register } from "node:module";
register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loaderSource)}`)}, import.meta.url);
`;
  return `data:text/javascript,${encodeURIComponent(registerSource)}`;
}

function childRouteTestEnv() {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "test"
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST_")) {
      delete env[key];
    }
  }
  return env;
}

test("isolated route tests execute with production app imports forbidden", () => {
  const routeTestFiles = [
    "ai-settings-routes.test.ts",
    "auth.test.ts",
    "gold-path.test.ts",
    "knowledge.test.ts",
    "notifications-routes.test.ts",
    "projects.test.ts"
  ];
  // R9.7 review: the old guard grepped test source for `from "./app.js"`.
  // That was wrong because source text does not prove isolated route tests can execute without the production app.
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--import",
    appImportGuardRegisterUrl(),
    "--test",
    ...routeTestFiles
  ], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
    env: childRouteTestEnv()
  });

  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join("\n"));
});
