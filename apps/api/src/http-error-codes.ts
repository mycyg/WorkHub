import { HTTPException } from "hono/http-exception";

import { jsonBodyTooLargeMessage, jsonObjectMessage, malformedJsonMessage } from "./routes/json-body.js";

export function httpErrorCodeFor(error: HTTPException) {
  if (error.status === 403 && error.message === "invalid client token") {
    return "invalid_client_token";
  }
  if (error.status === 400 && error.message === malformedJsonMessage) {
    return "malformed_json";
  }
  if (error.status === 400 && error.message === jsonObjectMessage) {
    return "json_object_required";
  }
  // API-03：readJsonObject 流式硬上限抛的 413。
  if (error.status === 413 && error.message === jsonBodyTooLargeMessage) {
    return "payload_too_large";
  }
  const codeByStatus: Record<number, string> = {
    400: "bad_request",
    401: "not_identified",
    413: "payload_too_large",
    422: "validation_error",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    429: "rate_limited"
  };
  return codeByStatus[error.status] ?? "http_error";
}
