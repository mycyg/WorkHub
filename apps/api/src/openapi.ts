function jsonRequestBody(schema: Record<string, unknown>, options: { required?: boolean } = {}) {
  return {
    requestBody: {
      required: options.required ?? true,
      content: {
        "application/json": {
          schema
        }
      }
    }
  };
}

const uuidStringSchema = { type: "string", format: "uuid" } as const;
function pathUuidParameter(name: string) {
  return {
    name,
    in: "path",
    required: true,
    schema: uuidStringSchema
  } as const;
}
function optionalUuidQueryParameter(name: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: uuidStringSchema
  } as const;
}
function optionalNonNegativeIntegerQueryParameter(name: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 0 }
  } as const;
}
function optionalDateTimeQueryParameter(name: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: dateTimeStringSchema
  } as const;
}
function optionalDateOnlyQueryParameter(name: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
  } as const;
}
const localeQueryParameter = {
  name: "locale",
  in: "query",
  required: false,
  schema: { type: "string", enum: ["zh-CN", "en-US"] }
} as const;
const approvalOffsetQueryParameter = {
  name: "offset",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 0 }
} as const;
const approvalLimitQueryParameter = {
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: 100 }
} as const;
const dateTimeStringSchema = { type: "string", format: "date-time" } as const;
const cuuStateResponseSchema = {
  type: "string",
  enum: [
    "idle",
    "thinking",
    "asking_approval",
    "carrying_document",
    "searching_evidence",
    "syncing_files",
    "worried",
    "revision_requested",
    "celebrating",
    "offline"
  ]
} as const;
const actionSpecSchema = {
  type: "object",
  required: ["id", "label", "method", "href"],
  properties: {
    id: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
    method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    href: { type: "string", minLength: 1 },
    requires_desktop: { type: "boolean" },
    requires_reason: { type: "boolean" },
    request_json: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
function jsonOkResponse(dataSchema: Record<string, unknown>) {
  return {
    responses: {
      "200": {
        description: "Successful page VM response",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["ok", "data", "meta"],
              properties: {
                ok: { type: "boolean", const: true },
                data: dataSchema,
                meta: {
                  type: "object",
                  required: ["locale"],
                  properties: {
                    locale: { type: "string", enum: ["zh-CN", "en-US"] }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            }
          }
        }
      }
    }
  };
}
function jsonDataResponse(dataSchema: Record<string, unknown>, description = "Successful JSON response") {
  return {
    responses: {
      "200": {
        description,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["ok", "data"],
              properties: {
                ok: { type: "boolean", const: true },
                data: dataSchema
              },
              additionalProperties: false
            }
          }
        }
      }
    }
  };
}
function jsonOkStatusResponse(dataSchema: Record<string, unknown>, status: string, description: string) {
  return {
    responses: {
      [status]: {
        ...jsonOkResponse(dataSchema).responses["200"],
        description
      }
    }
  };
}
function jsonDataStatusResponse(dataSchema: Record<string, unknown>, status: string, description: string) {
  return {
    responses: {
      [status]: {
        ...jsonDataResponse(dataSchema, description).responses["200"],
        description
      }
    }
  };
}
function eventStreamResponse(description: string) {
  return {
    responses: {
      "200": {
        description,
        content: {
          "text/event-stream": {
            schema: { type: "string", description: "Server-sent events stream" }
          }
        }
      }
    }
  };
}
function eventStreamAuthResponse(description: string, forbiddenCodes: string[]) {
  return {
    responses: {
      ...eventStreamResponse(description).responses,
      ...jsonErrorStatusResponse("401", "Push stream requires an authenticated user", [
        "not_identified"
      ]).responses,
      ...jsonErrorStatusResponse("403", "Push stream is not authorized for this topic", forbiddenCodes).responses
    }
  };
}
function rawJsonStatusResponse(dataSchema: Record<string, unknown>, status: string, description: string) {
  return {
    responses: {
      [status]: {
        description,
        content: {
          "application/json": {
            schema: dataSchema
          }
        }
      }
    }
  };
}
function rawJsonResponse(dataSchema: Record<string, unknown>, description = "Successful JSON response") {
  return rawJsonStatusResponse(dataSchema, "200", description);
}
function jsonErrorStatusResponse(status: string, description: string, codes: string[]) {
  return {
    responses: {
      [status]: {
        description,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["ok", "error"],
              properties: {
                ok: { type: "boolean", const: false },
                error: {
                  type: "object",
                  required: ["code", "message"],
                  properties: {
                    code: { type: "string", enum: codes },
                    message: { type: "string", minLength: 1 }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            }
          }
        }
      }
    }
  };
}
function fileDownloadResponse(description: string) {
  return {
    responses: {
      "200": {
        description,
        headers: {
          "Content-Disposition": {
            schema: { type: "string" }
          },
          "Content-Length": {
            schema: { type: "string" }
          }
        },
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" }
          }
        }
      }
    }
  };
}
const driveFileMissingCodes = ["drive_not_found", "drive_file_not_found", "drive_file_missing"];
const driveForbiddenResponse = jsonErrorStatusResponse("403", "Drive resource is not visible to the current user", [
  "drive_forbidden"
]);
const driveProjectMissingResponse = jsonErrorStatusResponse("404", "Drive project was not found", [
  "drive_not_found"
]);
const driveItemMissingResponse = jsonErrorStatusResponse("404", "Drive project or item was not found", [
  "drive_not_found",
  "drive_file_not_found"
]);
const driveCommentMissingResponse = jsonErrorStatusResponse("404", "Drive project or comment was not found", [
  "drive_not_found",
  "drive_comment_not_found"
]);
const driveDraftProposalForbiddenResponse = jsonErrorStatusResponse("403", "Drive comment draft is not mutable by the current user", [
  "forbidden",
  "drive_forbidden"
]);
const driveDraftProposalMissingResponse = jsonErrorStatusResponse("404", "Drive comment draft source or work item was not found", [
  "not_found",
  "drive_not_found"
]);
const driveDownloadResponse = {
  responses: {
    ...fileDownloadResponse("Stored Drive file bytes").responses,
    ...driveForbiddenResponse.responses,
    ...jsonErrorStatusResponse("404", "Stored Drive file was not found", driveFileMissingCodes).responses
  }
} as const;
const acceptedDeliverableMissingCodes = ["not_found", "deliverable_not_found", "deliverable_file_missing"];
const acceptedDeliverableDownloadResponse = {
  responses: {
    ...fileDownloadResponse("Accepted formal deliverable bytes").responses,
    ...jsonErrorStatusResponse("404", "Accepted formal deliverable file was not found", acceptedDeliverableMissingCodes).responses
  }
} as const;
const acceptedDeliverablePreviewResponse = {
  responses: {
    "200": {
      description: "Text-like accepted formal deliverable preview",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["ok", "data"],
            properties: {
              ok: { type: "boolean", const: true },
              data: {
                type: "object",
                required: [
                  "id",
                  "filename",
                  "size_bytes",
                  "preview_type",
                  "text",
                  "truncated",
                  "download_href"
                ],
                properties: {
                  id: uuidStringSchema,
                  filename: { type: "string", minLength: 1 },
                  mime: { type: "string", minLength: 1 },
                  size_bytes: { type: "integer", minimum: 0 },
                  preview_type: { type: "string", enum: ["text"] },
                  text: { type: "string" },
                  truncated: { type: "boolean" },
                  download_href: { type: "string", minLength: 1 }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        }
      }
    },
    ...jsonErrorStatusResponse("404", "Accepted formal deliverable file was not found", acceptedDeliverableMissingCodes).responses,
    ...jsonErrorStatusResponse("415", "Accepted formal deliverable cannot be previewed inline", [
      "deliverable_preview_unsupported"
    ]).responses
  }
} as const;
// R24 S3：auth_mode/version/instance_name 是桌面「连接服务器」屏一次探测就要拿全的展示信息
// （契约见 packages/contracts/src/health.ts）。服务端无条件返回，故列进 required；对客户端而言
// 它们仍是可选的——新客户端连旧服务端会缺，必须按「未知」降级。
const healthResponseSchema = {
  type: "object",
  required: [
    "ok",
    "service",
    "env",
    "runtime",
    "port",
    "ai_provider_configured",
    "auth_mode",
    "version",
    "instance_name"
  ],
  properties: {
    ok: { type: "boolean", const: true },
    service: { type: "string", const: "workhub-api" },
    env: { type: "string", enum: ["development", "test", "production"] },
    runtime: { type: "string", const: "node" },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    ai_provider_configured: { type: "boolean" },
    auth_mode: { type: "string", enum: ["nickname", "hybrid", "password"] },
    version: { type: "string", minLength: 1 },
    instance_name: { type: "string", minLength: 1, maxLength: 80 }
  },
  additionalProperties: false
} as const;
const readinessCheckResponseSchema = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
    error: { type: "string", maxLength: 200 }
  },
  additionalProperties: false
} as const;
const readinessResponseSchema = {
  type: "object",
  required: ["ready", "checks"],
  properties: {
    ready: { type: "boolean" },
    checks: {
      type: "object",
      additionalProperties: readinessCheckResponseSchema
    }
  },
  additionalProperties: false
} as const;
const readinessProbeResponses = {
  responses: {
    "200": rawJsonResponse(readinessResponseSchema, "All required dependencies are ready").responses["200"],
    "503": rawJsonStatusResponse(readinessResponseSchema, "503", "One or more dependencies are not ready").responses["503"]
  }
} as const;
const clientDeviceResponseSchema = {
  type: "object",
  required: ["id", "user_id", "device_name", "platform", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    user_id: uuidStringSchema,
    device_name: { type: "string", minLength: 1, maxLength: 128 },
    platform: { type: "string", minLength: 1, maxLength: 64 },
    last_seen_at: dateTimeStringSchema,
    revoked_at: dateTimeStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const clientDeviceRegisterRequestBodySchema = {
  type: "object",
  required: ["device_name"],
  properties: {
    device_name: { type: "string", minLength: 1, maxLength: 128 },
    platform: { type: "string", maxLength: 64 }
  },
  additionalProperties: false
} as const;
const clientDeviceRegisterResponseSchema = {
  type: "object",
  required: ["device", "client_token"],
  properties: {
    device: clientDeviceResponseSchema,
    client_token: { type: "string", minLength: 32 }
  },
  additionalProperties: false
} as const;
const clientDeviceLocalRequiredResponse = jsonErrorStatusResponse(
  "403",
  "A valid local client token is required for this device action",
  ["invalid_client_token", "forbidden"]
).responses["403"];
const clientDeviceMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Client device request body is malformed or not a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const clientDeviceNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Client device action requires an authenticated user",
  ["not_identified"]
).responses["401"];
const clientDeviceInvalidTokenResponse = jsonErrorStatusResponse(
  "403",
  "Presented client token is invalid",
  ["invalid_client_token"]
).responses["403"];
const clientDeviceNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Client device was not found",
  ["not_found"]
).responses["404"];
const clientDeviceValidationResponse = jsonErrorStatusResponse(
  "422",
  "Client device request payload does not match the API contract",
  ["validation_error"]
).responses["422"];
const clientDeviceRegisterResponse = {
  responses: {
    "201": rawJsonStatusResponse(clientDeviceRegisterResponseSchema, "201", "Registered local client device")
      .responses["201"],
    "400": clientDeviceMalformedJsonResponse,
    "401": clientDeviceNotIdentifiedResponse,
    "403": clientDeviceInvalidTokenResponse,
    "422": clientDeviceValidationResponse
  }
} as const;
const clientDeviceListResponse = {
  responses: {
    "200": rawJsonResponse({ type: "array", items: clientDeviceResponseSchema }, "Current user's client devices")
      .responses["200"],
    "401": clientDeviceNotIdentifiedResponse,
    "403": clientDeviceInvalidTokenResponse
  }
} as const;
const clientDeviceCurrentResponse = {
  responses: {
    "200": rawJsonResponse(clientDeviceResponseSchema, "Current local client device").responses["200"],
    "401": clientDeviceNotIdentifiedResponse,
    "403": clientDeviceLocalRequiredResponse
  }
} as const;
const clientDeviceRevokeResponse = {
  responses: {
    "200": rawJsonResponse(clientDeviceResponseSchema, "Revoked client device").responses["200"],
    "401": clientDeviceNotIdentifiedResponse,
    "403": clientDeviceInvalidTokenResponse,
    "404": clientDeviceNotFoundResponse
  }
} as const;
const clientDeviceRevokeCurrentResponse = {
  responses: {
    "200": rawJsonResponse(clientDeviceResponseSchema, "Revoked current local client device").responses["200"],
    "401": clientDeviceNotIdentifiedResponse,
    "403": clientDeviceLocalRequiredResponse,
    "404": clientDeviceNotFoundResponse
  }
} as const;
const userPreferencesResponseSchema = {
  type: "object",
  required: ["locale"],
  properties: {
    locale: { type: "string", enum: ["zh-CN", "en-US"] }
  },
  additionalProperties: false
} as const;
const authIdentityResponseSchema = {
  type: "object",
  required: [
    "id",
    "nickname",
    "is_admin",
    "availability_status",
    "display_name",
    "created",
    "locale",
    "preferences"
  ],
  properties: {
    id: uuidStringSchema,
    nickname: { type: "string", minLength: 1, maxLength: 64 },
    is_admin: { type: "boolean" },
    availability_status: { type: "string", maxLength: 16 },
    availability_text: { type: "string", maxLength: 128 },
    display_name: { type: "string", minLength: 1, maxLength: 96 },
    created: { type: "boolean" },
    locale: { type: "string", enum: ["zh-CN", "en-US"] },
    preferences: userPreferencesResponseSchema
  },
  additionalProperties: false
} as const;
const identityContextResponseSchema = {
  type: "object",
  required: ["actor_kind", "actor_id", "actor_label", "org_id", "workspace_id", "is_admin"],
  properties: {
    actor_kind: { type: "string", enum: ["human", "ai", "system"] },
    actor_id: { type: "string", minLength: 1 },
    actor_label: { type: "string", minLength: 1 },
    user_id: uuidStringSchema,
    org_id: uuidStringSchema,
    workspace_id: uuidStringSchema,
    is_admin: { type: "boolean" }
  },
  additionalProperties: false
} as const;
const authMeResponseSchema = {
  anyOf: [
    {
      ...authIdentityResponseSchema,
      required: [...authIdentityResponseSchema.required, "identity"],
      properties: {
        ...authIdentityResponseSchema.properties,
        identity: identityContextResponseSchema
      }
    },
    { type: "null" }
  ]
} as const;
const authOkResponseSchema = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: { type: "boolean", const: true }
  },
  additionalProperties: false
} as const;
const identifyRequestBodySchema = {
  type: "object",
  required: ["nickname"],
  properties: {
    nickname: { type: "string", minLength: 1, maxLength: 64 },
    admin_secret: { type: "string", maxLength: 256 },
    // R24 S3 严重#4：新建用户时优先用它，其次探测 Accept-Language，都没有才落 zh-CN；已存在用户不受影响。
    locale: { type: "string", enum: ["zh-CN", "en-US"] }
  },
  additionalProperties: false
} as const;
const desktopBootstrapRequestBodySchema = {
  type: "object",
  required: ["nickname", "device_name"],
  properties: {
    nickname: { type: "string", minLength: 1, maxLength: 64 },
    admin_secret: { type: "string", maxLength: 256 },
    device_name: { type: "string", minLength: 1, maxLength: 128 },
    platform: { type: "string", maxLength: 64 },
    // R24 S3 严重#4：同 identifyRequestBodySchema 的 locale。
    locale: { type: "string", enum: ["zh-CN", "en-US"] }
  },
  additionalProperties: false
} as const;
const desktopBootstrapResponseSchema = {
  type: "object",
  required: ["identity", "device", "client_token"],
  properties: {
    identity: authIdentityResponseSchema,
    device: clientDeviceResponseSchema,
    client_token: { type: "string", minLength: 32 }
  },
  additionalProperties: false
} as const;
const passwordRegisterRequestBodySchema = {
  type: "object",
  required: ["email", "password", "nickname"],
  properties: {
    email: { type: "string", format: "email", maxLength: 320 },
    password: { type: "string", minLength: 8, maxLength: 1024 },
    nickname: { type: "string", minLength: 1, maxLength: 64 },
    // R24 S3 严重#4：同 identifyRequestBodySchema 的 locale。
    locale: { type: "string", enum: ["zh-CN", "en-US"] }
  },
  additionalProperties: false
} as const;
const passwordLoginRequestBodySchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email", maxLength: 320 },
    password: { type: "string", minLength: 1, maxLength: 1024 }
  },
  additionalProperties: false
} as const;
const passwordChangeRequestBodySchema = {
  type: "object",
  required: ["current_password", "new_password"],
  properties: {
    current_password: { type: "string", minLength: 1, maxLength: 1024 },
    new_password: { type: "string", minLength: 8, maxLength: 1024 }
  },
  additionalProperties: false
} as const;
const inviteCreateRequestBodySchema = {
  type: "object",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email", maxLength: 320 }
  },
  additionalProperties: false
} as const;
const inviteCreateResponseSchema = {
  type: "object",
  required: ["invite_id", "token", "email", "expires_at"],
  properties: {
    invite_id: uuidStringSchema,
    token: { type: "string", minLength: 1 },
    email: { type: "string", format: "email", maxLength: 320 },
    expires_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
// R18 批 H1（成员管理面板 · 未过期邀请清单）：GET /api/auth/invites?status=pending 的响应。绝不带
// token——服务端只存 sha256，明文取不回；只回 invite_id/email/过期时间/创建时间。
const pendingInvitesListResponseSchema = {
  type: "object",
  required: ["invites"],
  properties: {
    invites: {
      type: "array",
      items: {
        type: "object",
        required: ["invite_id", "email", "expires_at", "created_at"],
        properties: {
          invite_id: uuidStringSchema,
          email: { type: "string", format: "email", maxLength: 320 },
          expires_at: dateTimeStringSchema,
          created_at: dateTimeStringSchema
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
} as const;
const inviteAcceptRequestBodySchema = {
  type: "object",
  required: ["token", "nickname", "password"],
  properties: {
    token: { type: "string", minLength: 1, maxLength: 512 },
    nickname: { type: "string", minLength: 1, maxLength: 64 },
    password: { type: "string", minLength: 8, maxLength: 1024 },
    // R24 S3 严重#4：同 identifyRequestBodySchema 的 locale。
    locale: { type: "string", enum: ["zh-CN", "en-US"] }
  },
  additionalProperties: false
} as const;
const updateUserPreferencesRequestBodySchema = {
  type: "object",
  required: ["locale"],
  properties: {
    locale: { type: "string", enum: ["zh-CN", "en-US", "zh", "en", "zh_CN", "en_US"] }
  },
  additionalProperties: false
} as const;
const identifyResponses = {
  responses: {
    "200": rawJsonResponse(authIdentityResponseSchema, "Existing identity").responses["200"],
    "201": rawJsonStatusResponse(authIdentityResponseSchema, "201", "Created identity").responses["201"],
    "403": jsonErrorStatusResponse("403", "Nickname identity requires a valid admin claim when targeting admin accounts", [
      "forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Nickname identity is not available in this auth mode", [
      "not_found"
    ]).responses["404"],
    "429": jsonErrorStatusResponse("429", "Admin claim attempts are temporarily rate limited", [
      "rate_limited"
    ]).responses["429"]
  }
} as const;
const authBadRequestResponse = jsonErrorStatusResponse(
  "400",
  "Auth request contains a semantic input error",
  ["bad_request"]
).responses["400"];
const authMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Auth request body must be a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const authNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Auth action requires a current authenticated user",
  ["not_identified"]
).responses["401"];
const authInvalidClientTokenResponse = jsonErrorStatusResponse(
  "403",
  "Auth action requires a valid local client token when one is presented",
  ["invalid_client_token"]
).responses["403"];
const authForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Auth action is not allowed for the current user",
  ["forbidden"]
).responses["403"];
const authNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Auth feature or target was not found",
  ["not_found"]
).responses["404"];
const authConflictResponse = jsonErrorStatusResponse(
  "409",
  "Auth action conflicts with an existing identity",
  ["conflict"]
).responses["409"];
const authValidationResponse = jsonErrorStatusResponse(
  "422",
  "Auth request payload does not match the API contract",
  ["validation_error"]
).responses["422"];
const authUnavailableResponse = jsonErrorStatusResponse(
  "501",
  "Auth preference updates are not supported by this deployment",
  ["http_error"]
).responses["501"];
const authRateLimitedResponse = jsonErrorStatusResponse(
  "429",
  "Auth action is temporarily rate limited",
  ["rate_limited"]
).responses["429"];
const desktopBootstrapResponses = {
  responses: {
    "201": rawJsonStatusResponse(desktopBootstrapResponseSchema, "201", "Bootstrapped desktop identity and client token")
      .responses["201"],
    "403": authForbiddenResponse,
    "404": authNotFoundResponse,
    "429": authRateLimitedResponse
  }
} as const;
const passwordRegisterResponses = {
  responses: {
    "201": rawJsonStatusResponse(authIdentityResponseSchema, "201", "Registered password identity").responses["201"],
    "400": authBadRequestResponse,
    "404": authNotFoundResponse,
    "409": authConflictResponse,
    "422": authValidationResponse
  }
} as const;
const passwordLoginResponses = {
  responses: {
    "200": rawJsonResponse(authIdentityResponseSchema, "Authenticated password identity").responses["200"],
    "401": authNotIdentifiedResponse,
    "404": authNotFoundResponse,
    "429": authRateLimitedResponse
  }
} as const;
const passwordChangeResponses = {
  responses: {
    "200": rawJsonResponse(authOkResponseSchema, "Password changed").responses["200"],
    "400": authBadRequestResponse,
    "401": authNotIdentifiedResponse,
    "403": authForbiddenResponse,
    "404": authNotFoundResponse,
    "422": authValidationResponse
  }
} as const;
const authInviteCreateResponses = {
  responses: {
    "201": rawJsonStatusResponse(inviteCreateResponseSchema, "201", "Created invite").responses["201"],
    "401": authNotIdentifiedResponse,
    "403": authForbiddenResponse,
    "404": authNotFoundResponse,
    "422": authValidationResponse
  }
} as const;
const authInviteAcceptResponses = {
  responses: {
    "201": rawJsonStatusResponse(authIdentityResponseSchema, "201", "Accepted invite and created identity").responses["201"],
    "400": authBadRequestResponse,
    "404": authNotFoundResponse,
    "409": authConflictResponse,
    "422": authValidationResponse
  }
} as const;
const authInviteListResponses = {
  responses: {
    "200": rawJsonResponse(pendingInvitesListResponseSchema, "Pending (unexpired, unaccepted) invites for the workspace").responses["200"],
    "400": authBadRequestResponse,
    "401": authNotIdentifiedResponse,
    "403": authForbiddenResponse,
    "404": authNotFoundResponse
  }
} as const;
// P2-02：账号已停用（墓碑已置）但善后清理（撤会话/设备/凭据/交接/在线态）未完成——回 500 让调用方感知
// （不伪装成功），携带失败步清单；清理步幂等，重发本请求即为重试入口，直至 cleanup.complete。
const authDeactivateCleanupIncompleteResponse = {
  description: "User deactivated (tombstone set) but post-deactivation cleanup did not complete; retry the same request",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["ok", "error", "deactivated", "cleanup"],
        properties: {
          ok: { type: "boolean", const: false },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", enum: ["offboard_cleanup_incomplete"] },
              message: { type: "string", minLength: 1 }
            },
            additionalProperties: false
          },
          deactivated: { type: "boolean", const: true },
          cleanup: {
            type: "object",
            required: ["complete", "steps"],
            properties: {
              complete: { type: "boolean" },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  required: ["step", "ok"],
                  properties: {
                    step: { type: "string" },
                    ok: { type: "boolean" },
                    error: { type: "string" }
                  },
                  additionalProperties: false
                }
              }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    }
  }
} as const;
const authDeactivateResponses = {
  responses: {
    "200": rawJsonResponse(authOkResponseSchema, "Deactivated user").responses["200"],
    "400": authBadRequestResponse,
    "401": authNotIdentifiedResponse,
    "403": authForbiddenResponse,
    "404": authNotFoundResponse,
    "500": authDeactivateCleanupIncompleteResponse
  }
} as const;
// R20 P1-05：撤销邀请回体 { ok, invite_id }。
const authInviteRevokeResponseSchema = {
  type: "object",
  required: ["ok", "invite_id"],
  properties: {
    ok: { type: "boolean", const: true },
    invite_id: { type: "string", format: "uuid" }
  },
  additionalProperties: false
} as const;
const authInviteRevokeResponses = {
  responses: {
    "200": rawJsonResponse(authInviteRevokeResponseSchema, "Revoked (soft-deleted) the pending invite").responses["200"],
    "401": authNotIdentifiedResponse,
    "403": authForbiddenResponse,
    "404": authNotFoundResponse
  }
} as const;
const authLogoutResponses = {
  responses: {
    "200": rawJsonResponse(authOkResponseSchema, "Logged out").responses["200"],
    "401": authNotIdentifiedResponse,
    "403": authInvalidClientTokenResponse
  }
} as const;
const authPreferencesResponses = {
  responses: {
    "200": rawJsonResponse(authIdentityResponseSchema, "Updated user preferences").responses["200"],
    "400": authMalformedJsonResponse,
    "401": authNotIdentifiedResponse,
    "403": authInvalidClientTokenResponse,
    "404": authNotFoundResponse,
    "422": authValidationResponse,
    "501": authUnavailableResponse
  }
} as const;
const acceptedDeliverableVmResponseSchema = {
  type: "object",
  required: [
    "id",
    "work_item_id",
    "proposal_id",
    "change_id",
    "target_kind",
    "target_key",
    "change_type",
    "accepted_version",
    "accepted_at"
  ],
  properties: {
    id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    proposal_id: uuidStringSchema,
    change_id: uuidStringSchema,
    target_kind: { type: "string", minLength: 1 },
    target_key: { type: "string", minLength: 1 },
    change_type: { type: "string", minLength: 1 },
    accepted_version: { type: "integer", minimum: 1 },
    target_path: { type: "string", minLength: 1 },
    sha256: { type: "string", minLength: 64, maxLength: 64 },
    project_id: uuidStringSchema,
    drive_item_id: uuidStringSchema,
    drive_version_id: uuidStringSchema,
    filename: { type: "string", minLength: 1 },
    mime: { type: "string", minLength: 1 },
    size_bytes: { type: "integer", minimum: 0 },
    drive_href: { type: "string", minLength: 1 },
    download_href: { type: "string", minLength: 1 },
    preview_href: { type: "string", minLength: 1 },
    restore_href: { type: "string", minLength: 1 },
    accepted_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const acceptedDeliverableRestoreResponse = {
  responses: {
    "200": {
      description: "Accepted formal deliverable restore result",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["ok", "data"],
            properties: {
              ok: { type: "boolean", const: true },
              data: {
                type: "object",
                required: ["accepted_deliverable"],
                properties: {
                  accepted_deliverable: acceptedDeliverableVmResponseSchema
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        }
      }
    },
    ...jsonErrorStatusResponse("409", "Accepted formal deliverable cannot be restored in its current state", [
      "deliverable_not_versioned",
      "deliverable_no_previous_version",
      "deliverable_version_changed"
    ]).responses
  }
} as const;
const proposalResponseSchema = {
  type: "object",
  required: [
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
  ],
  properties: {
    id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    branch_id: uuidStringSchema,
    round: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 256 },
    status: { type: "string", enum: ["opened", "reviewed", "merged", "rejected"] },
    diff_manifest: { type: "object", additionalProperties: true },
    confidence_id: uuidStringSchema,
    merge_snapshot_id: uuidStringSchema,
    opened_by_kind: { type: "string", enum: ["human", "ai", "system"] },
    opened_by_user_id: uuidStringSchema,
    reviewed_at: dateTimeStringSchema,
    merged_at: dateTimeStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: true
} as const;
const proposalDetailPageResponseSchema = {
  type: "object",
  required: [
    "proposal_id",
    "work_item_id",
    "title",
    "status",
    "manifest",
    "evidence_refs",
    "review_actions",
    "comments"
  ],
  properties: {
    proposal_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["opened", "reviewed", "merged", "rejected"] },
    manifest: { type: "object", additionalProperties: true },
    evidence_refs: { type: "array", items: { type: "object", additionalProperties: true } },
    review_actions: {
      type: "object",
      required: ["approve", "request_changes"],
      properties: {
        approve: actionSpecSchema,
        request_changes: actionSpecSchema,
        merge: actionSpecSchema,
        approve_hold: actionSpecSchema
      },
      additionalProperties: false
    },
    comments: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "author_label", "body", "created_at"],
        properties: {
          id: uuidStringSchema,
          author_label: { type: "string", minLength: 1 },
          body: { type: "string", minLength: 1 },
          created_at: dateTimeStringSchema
        },
        additionalProperties: false
      }
    },
    // R14 批 FEEDBACK：本人二值反馈+服务端算好的动作 href（additive，只进 properties 不进 required）。
    feedback: {
      type: "object",
      required: ["my_verdict", "my_note", "mark_useful", "mark_not_useful"],
      properties: {
        my_verdict: { type: ["string", "null"], enum: ["useful", "not_useful", null] },
        my_note: { type: ["string", "null"], maxLength: 200 },
        mark_useful: actionSpecSchema,
        mark_not_useful: actionSpecSchema,
        clear: actionSpecSchema
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;
const proposalDetailPageResponse = {
  responses: {
    "200": jsonOkResponse(proposalDetailPageResponseSchema).responses["200"],
    "403": jsonErrorStatusResponse("403", "Proposal page is not readable by the current user", [
      "forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Proposal page target was not found", [
      "not_found"
    ]).responses["404"]
  }
} as const;
const createProposalRequestSchema = {
  type: "object",
  required: ["manifest"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 256 },
    branch_id: uuidStringSchema,
    manifest: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
function proposalConflictErrorResponse(description: string, codes: string[]) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["ok", "error"],
          properties: {
            ok: { type: "boolean", const: false },
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", enum: codes },
                message: { type: "string", minLength: 1 },
                details: { type: "object", additionalProperties: true },
                recoverable: { type: "boolean", const: true }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        }
      }
    }
  };
}
const proposalMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Proposal request body is malformed or not a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const proposalNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Proposal action requires an authenticated user",
  ["not_identified"]
).responses["401"];
const proposalForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Proposal target is not visible or mutable by the current user",
  ["invalid_client_token", "forbidden"]
).responses["403"];
const proposalNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Proposal, work item, or merge proposal was not found",
  ["not_found"]
).responses["404"];
// R10-P1-3：提议变更在线预览（内容来自 manifest change 的 machine_summary.generated_content_md）。
const proposalChangePreviewResponse = {
  responses: {
    "200": {
      description: "Inline text preview of a proposal manifest change",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["ok", "data"],
            properties: {
              ok: { type: "boolean", const: true },
              data: {
                type: "object",
                required: ["id", "filename", "size_bytes", "preview_type", "text", "truncated"],
                properties: {
                  id: uuidStringSchema,
                  filename: { type: "string", minLength: 1 },
                  size_bytes: { type: "integer", minimum: 0 },
                  preview_type: { type: "string", enum: ["text"] },
                  text: { type: "string" },
                  truncated: { type: "boolean" }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        }
      }
    },
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": jsonErrorStatusResponse(
      "404",
      "Proposal or manifest change was not found",
      ["not_found", "proposal_change_not_found"]
    ).responses["404"],
    ...jsonErrorStatusResponse("415", "Proposal change has no inline-previewable text", [
      "proposal_change_preview_unsupported"
    ]).responses
  }
} as const;
// R16-W3（变更编辑器）：base vs proposed 逐行 tracked-changes 视图。
const proposalChangeDiffResponse = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: [
          "proposal_id",
          "change_id",
          "path",
          "filename",
          "change_type",
          "status",
          "title",
          "base_available",
          "truncated",
          "segments"
        ],
        properties: {
          proposal_id: uuidStringSchema,
          change_id: uuidStringSchema,
          path: { type: "string" },
          filename: { type: "string", minLength: 1 },
          change_type: {
            type: "string",
            enum: ["created", "updated", "deleted", "renamed", "moved", "replaced", "generated"]
          },
          status: { type: "string", enum: ["opened", "reviewed", "merged", "rejected"] },
          title: { type: "string", minLength: 1 },
          base_available: { type: "boolean" },
          truncated: { type: "boolean" },
          segments: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "lines"],
              properties: {
                type: { type: "string", enum: ["context", "add", "del"] },
                lines: { type: "array", items: { type: "string" } }
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      },
      "Tracked-changes diff between base and proposed content of a manifest change"
    ).responses["200"],
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Proposal or manifest change was not found", [
      "not_found",
      "proposal_change_not_found"
    ]).responses["404"],
    ...jsonErrorStatusResponse("415", "Proposal change has no diffable text content", [
      "proposal_change_diff_unsupported"
    ]).responses
  }
} as const;
const createProposalConflictResponse = jsonErrorStatusResponse(
  "409",
  "Proposal manifest cannot create a new proposal in the current state",
  ["proposal_already_exists"]
).responses["409"];
const createProposalValidationResponse = jsonErrorStatusResponse(
  "422",
  "Proposal manifest does not match the API contract or work item state",
  [
    "validation_error",
    "manifest_workitem_mismatch",
    "duplicate_target_key",
    "proposal_branch_workitem_mismatch"
  ]
).responses["422"];
const proposalValidationResponse = jsonErrorStatusResponse(
  "422",
  "Proposal request does not match the API contract",
  ["validation_error"]
).responses["422"];
const proposalReviewConflictResponse = jsonErrorStatusResponse(
  "409",
  "Proposal review cannot be recorded in the current proposal state",
  ["proposal_already_merged", "proposal_rejected", "proposal_state_changed"]
).responses["409"];
const proposalMergeConflictResponse = proposalConflictErrorResponse(
  "Proposal cannot be merged in the current proposal or accepted-deliverable state",
  [
    "confirmation_required",
    "proposal_already_merged",
    "proposal_rejected",
    "proposal_not_reviewed",
    "merge_conflict",
    "rebase_required",
    "stale_base",
    "delivery_artifact_missing",
    "delivery_artifact_changed",
    "delivery_artifact_unsafe_path",
    // B-R9.1-1：计划提议合入与计划批准同事务，计划不可批准时整笔回滚并回本码。
    "task_plan_approval_failed",
    // R9-BLOCK-7.154：人审修订写回前的图/预算校验，失败整笔回滚。
    "task_plan_items_invalid",
    "task_plan_budget_share_invalid"
  ]
);
// API-07：合并已落库但快照 id 缺失是服务端数据不完整——回 500（客户端不得当失败重试）。
const proposalMergeSnapshotMissingResponse = jsonErrorStatusResponse(
  "500",
  "Merge committed but the snapshot record is incomplete",
  ["merge_snapshot_missing"]
).responses["500"];
const proposalMergeDispatchFailureResponse = jsonErrorStatusResponse(
  "503",
  "Task-plan proposal was approved but child-run dispatch failed",
  ["task_plan_dispatch_failed"]
).responses["503"];
const proposalRebaseConflictResponse = jsonErrorStatusResponse(
  "409",
  "Proposal cannot be rebased before it has been reviewed",
  ["not_reviewed"]
).responses["409"];
const chooseMergeProposalValidationResponse = jsonErrorStatusResponse(
  "422",
  "Merge proposal candidate choice does not match the API contract",
  ["validation_error", "invalid_merge_proposal_candidate"]
).responses["422"];
const chooseMergeProposalConflictResponse = jsonErrorStatusResponse(
  "409",
  "Merge proposal candidate has already been chosen",
  ["merge_proposal_already_chosen"]
).responses["409"];
const applyMergeProposalConflictResponse = proposalConflictErrorResponse(
  "Merge proposal candidate cannot be applied in the current state",
  [
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
);
const createProposalResponse = {
  responses: {
    "201": {
      description: "Created proposal",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["ok", "data"],
            properties: {
              ok: { type: "boolean", const: true },
              data: proposalResponseSchema
            },
            additionalProperties: false
          }
        }
      }
    },
    "400": proposalMalformedJsonResponse,
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse,
    "409": createProposalConflictResponse,
    "422": createProposalValidationResponse
  }
} as const;
// B-R9.1-2：请求体不再接受 memories（可伪造团队记忆直入 planner prompt 的注入面）；
// 记忆上下文一律服务端读 user_memories/team_skills。旧客户端多余字段被忽略。
const createTaskPlanRequestSchema = {
  type: "object",
  properties: {},
  additionalProperties: true
} as const;
const createTaskPlanResponseSchema = {
  type: "object",
  required: ["plan_id", "proposal_id", "proposal_href", "proposal"],
  properties: {
    plan_id: uuidStringSchema,
    proposal_id: uuidStringSchema,
    proposal_href: { type: "string", minLength: 1 },
    proposal: proposalResponseSchema
  },
  additionalProperties: false
} as const;
const createTaskPlanConflictResponse = jsonErrorStatusResponse(
  "409",
  "Task plan decomposition needs human intervention, an existing draft, or proposal state changed",
  ["task_plan_decomposition_needs_human", "task_plan_draft_exists", "task_plan_draft_in_progress", "proposal_already_exists"]
).responses["409"];
const createTaskPlanValidationResponse = jsonErrorStatusResponse(
  "422",
  "Task plan request or work item state is invalid",
  ["validation_error", "task_plan_workspace_missing", "manifest_workitem_mismatch"]
).responses["422"];
const createTaskPlanBadGatewayResponse = jsonErrorStatusResponse(
  "502",
  "Task plan LLM returned an invalid response",
  ["task_plan_llm_invalid_response"]
).responses["502"];
const createTaskPlanUnavailableResponse = jsonErrorStatusResponse(
  "503",
  "Task plan LLM is not configured",
  ["task_plan_llm_unavailable"]
).responses["503"];
const createTaskPlanResponse = {
  responses: {
    ...jsonDataStatusResponse(createTaskPlanResponseSchema, "201", "Created task plan draft and review proposal").responses,
    "400": proposalMalformedJsonResponse,
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse,
    "409": createTaskPlanConflictResponse,
    "422": createTaskPlanValidationResponse,
    "502": createTaskPlanBadGatewayResponse,
    "503": createTaskPlanUnavailableResponse
  }
} as const;
// R20 R19-29：GET /workitems/{id}/proposals（list-work-item-proposals）已删——曾靠 proposalListResponseSchema/
// proposalListResponse 撑门面，核实零消费后随路由一并删掉，POST（下面 createProposalResponse 那条）保留。
const readProposalResponse = {
  responses: {
    "200": jsonDataResponse(proposalResponseSchema, "Deliverable change proposal").responses["200"],
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse
  }
} as const;
const reviewProposalRequestBodySchema = {
  type: "object",
  required: ["decision"],
  properties: {
    decision: { type: "string", enum: ["approve", "request_changes"] },
    reason_md: { type: "string", minLength: 1, maxLength: 10000 },
    remember: { type: "string", enum: ["once", "always"], default: "once" }
  },
  additionalProperties: false
} as const;
const proposalReviewResultResponseSchema = {
  type: "object",
  required: ["proposal_id", "work_item_id", "status", "decision", "attention", "event"],
  properties: {
    proposal_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    status: { type: "string", enum: ["reviewed", "revision_requested"] },
    decision: { type: "string", enum: ["approve", "request_changes"] },
    reason_md: { type: "string" },
    next_action: actionSpecSchema,
    next_agent_context: { type: "object", additionalProperties: true },
    attention: { type: "object", additionalProperties: true },
    event: { type: "object", additionalProperties: true },
    feedback_event: { type: "object", additionalProperties: true },
    audit_logs: { type: "array", items: { type: "object", additionalProperties: true } }
  },
  additionalProperties: false
} as const;
const reviewProposalResponse = {
  responses: {
    "200": jsonDataResponse(proposalReviewResultResponseSchema, "Proposal review result").responses["200"],
    "400": proposalMalformedJsonResponse,
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse,
    "409": proposalReviewConflictResponse,
    "422": proposalValidationResponse
  }
} as const;
const mergeProposalRequestBodySchema = {
  type: "object",
  properties: {
    confirm: { type: "boolean", default: true },
    dispatch: { type: "boolean", default: true },
    conflict_resolution: {
      type: "object",
      properties: {
        accept_incoming_target_keys: {
          type: "array",
          items: { type: "string", minLength: 1 },
          default: []
        },
        bulk_action: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["keep_current", "accept_incoming"] },
            target_keys: {
              type: "array",
              items: { type: "string", minLength: 1 },
              default: []
            },
            conflict_count: { type: "integer", minimum: 0 }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;
const proposalMergeResultResponseSchema = {
  type: "object",
  required: [
    "proposal_id",
    "work_item_id",
    "status",
    "merge_snapshot_id",
    "rollback_available",
    "rollback",
    "attention",
    "events",
    "audit_logs"
  ],
  properties: {
    proposal_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    status: { type: "string", enum: ["merged"] },
    merge_snapshot_id: uuidStringSchema,
    rollback_available: { type: "boolean" },
    rollback: { type: "object", additionalProperties: true },
    attention: { type: "object", additionalProperties: true },
    events: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
    audit_logs: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } }
  },
  additionalProperties: false
} as const;
const proposalMergeResponse = {
  responses: {
    "200": jsonDataResponse(proposalMergeResultResponseSchema, "Proposal merge result").responses["200"],
    "400": proposalMalformedJsonResponse,
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse,
    "409": proposalMergeConflictResponse,
    "422": proposalValidationResponse,
    "500": proposalMergeSnapshotMissingResponse,
    "503": proposalMergeDispatchFailureResponse
  }
} as const;
const proposalMergeCandidateApplyResponse = {
  responses: {
    "200": jsonDataResponse(proposalMergeResultResponseSchema, "Applied merge candidate result").responses["200"],
    "400": proposalMalformedJsonResponse,
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse,
    "409": applyMergeProposalConflictResponse,
    "422": proposalValidationResponse
  }
} as const;
const proposalConflictListResponseSchema = {
  type: "object",
  required: ["conflicts"],
  properties: {
    conflicts: { type: "array", items: { type: "object", additionalProperties: true } },
    empty_state: { type: "string", enum: ["no_conflicts"] }
  },
  additionalProperties: false
} as const;
const proposalConflictListResponse = {
  responses: {
    "200": jsonDataResponse(proposalConflictListResponseSchema, "Current proposal conflicts").responses["200"],
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse
  }
} as const;
const rebaseProposalResultResponseSchema = {
  type: "object",
  required: ["proposal_id", "work_item_id", "conflicts"],
  properties: {
    proposal_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    conflicts: { type: "array", items: { type: "object", additionalProperties: true } },
    empty_state: { type: "string", enum: ["clean_after_rebase"] }
  },
  additionalProperties: false
} as const;
const rebaseProposalResponse = {
  responses: {
    "200": jsonDataResponse(rebaseProposalResultResponseSchema, "Rebased proposal conflicts").responses["200"],
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse,
    "409": proposalRebaseConflictResponse
  }
} as const;
const chooseMergeProposalCandidateRequestBodySchema = {
  type: "object",
  required: ["option_key"],
  properties: {
    option_key: { type: "string", minLength: 1, maxLength: 64 }
  },
  additionalProperties: false
} as const;
const mergeProposalCandidateChoiceResponseSchema = {
  type: "object",
  required: ["merge_proposal_id", "conflict_key", "chosen_option_key", "chosen_at", "candidate"],
  properties: {
    merge_proposal_id: uuidStringSchema,
    conflict_key: { type: "string", minLength: 1 },
    chosen_option_key: { type: "string", minLength: 1 },
    chosen_by_user_id: uuidStringSchema,
    chosen_at: dateTimeStringSchema,
    candidate: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const chooseMergeProposalCandidateResponse = {
  responses: {
    "200": jsonDataResponse(mergeProposalCandidateChoiceResponseSchema, "Chosen merge candidate").responses["200"],
    "400": proposalMalformedJsonResponse,
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse,
    "409": chooseMergeProposalConflictResponse,
    "422": chooseMergeProposalValidationResponse
  }
} as const;
const applyMergeProposalCandidateRequestBodySchema = {
  type: "object",
  properties: {
    confirm: { type: "boolean", default: true },
    structured_field_overrides: { type: "object", additionalProperties: true },
    structured_item_overrides: { type: "object", additionalProperties: true },
    text_hunk_overrides: { type: "object", additionalProperties: true },
    task_plan_scope: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const approvalPayloadResponseSchema = {
  type: "object",
  properties: {
    ui: {
      type: "object",
      properties: {
        summary_text: { type: "string", minLength: 1 },
        reason_text: { type: "string" },
        risk: { type: "object", additionalProperties: true },
        evidence_refs: { type: "array", items: { type: "object", additionalProperties: true } },
        affected_targets: { type: "array", items: { type: "string", minLength: 1 } },
        requires_desktop: { type: "boolean" }
      },
      additionalProperties: false
    },
    raw_args: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const approvalRequestResponseSchema = {
  type: "object",
  required: ["id", "action_pattern", "payload_json", "status", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    agent_run_id: uuidStringSchema,
    action_pattern: { type: "string", minLength: 1, maxLength: 128 },
    payload_json: approvalPayloadResponseSchema,
    status: { type: "string", enum: ["pending", "approved", "denied", "expired"] },
    routed_to_user_id: uuidStringSchema,
    decided_by_user_id: uuidStringSchema,
    decision_reason_md: { type: "string" },
    delegated_to_user_id: uuidStringSchema,
    sla_due_at: dateTimeStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const approvalCommentResponseSchema = {
  type: "object",
  required: ["id", "author_label", "body", "created_at"],
  properties: {
    id: uuidStringSchema,
    author_label: { type: "string", minLength: 1 },
    body: { type: "string", minLength: 1 },
    created_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const approvalCenterResponseSchema = {
  type: "object",
  required: ["items", "requests", "filters", "counts", "items_detail"],
  properties: {
    items: { type: "array", items: { type: "object", additionalProperties: true } },
    requests: { type: "array", items: approvalRequestResponseSchema },
    filters: { type: "object", additionalProperties: true },
    counts: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
    page_info: {
      type: "object",
      required: ["limit", "returned", "has_more"],
      properties: {
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        returned: { type: "integer", minimum: 0 },
        has_more: { type: "boolean" }
      },
      additionalProperties: false
    },
    items_detail: { type: "object", additionalProperties: { type: "object", additionalProperties: true } }
  },
  additionalProperties: false
} as const;
const respondApprovalRequestBodySchema = {
  type: "object",
  required: ["decision"],
  properties: {
    decision: { type: "string", enum: ["allow", "deny"] },
    reason_md: { type: "string", minLength: 1, maxLength: 200000 },
    remember: { type: "string", enum: ["once", "always"], default: "once" }
  },
  anyOf: [
    {
      required: ["decision"],
      properties: {
        decision: { type: "string", enum: ["allow"] }
      }
    },
    {
      required: ["decision", "reason_md"],
      properties: {
        decision: { type: "string", enum: ["deny"] },
        reason_md: { type: "string", minLength: 1, maxLength: 200000 }
      }
    }
  ],
  additionalProperties: false
} as const;
const delegateApprovalRequestBodySchema = {
  type: "object",
  required: ["to_user_id"],
  properties: {
    to_user_id: uuidStringSchema
  },
  additionalProperties: false
} as const;
const addApprovalCommentRequestBodySchema = {
  type: "object",
  required: ["body"],
  properties: {
    body: { type: "string", minLength: 1, maxLength: 4000 }
  },
  additionalProperties: false
} as const;
const permissionPolicyRecordResponseSchema = {
  type: "object",
  required: [
    "id",
    "scope_kind",
    "scope_id",
    "action_pattern",
    "effect",
    "priority",
    "learned_from_session",
    "created_at",
    "updated_at"
  ],
  properties: {
    id: uuidStringSchema,
    scope_kind: { type: "string", enum: ["org", "workspace", "role", "session"] },
    scope_id: { type: "string", minLength: 1, maxLength: 64 },
    action_pattern: { type: "string", minLength: 1, maxLength: 128 },
    effect: { type: "string", enum: ["allow", "deny", "ask"] },
    priority: { type: "integer" },
    learned_from_session: { type: "boolean" },
    created_by_user_id: {
      anyOf: [
        uuidStringSchema,
        { type: "null" }
      ]
    },
    org_id: {
      anyOf: [
        uuidStringSchema,
        { type: "null" }
      ]
    },
    workspace_id: {
      anyOf: [
        uuidStringSchema,
        { type: "null" }
      ]
    },
    deleted_at: {
      anyOf: [
        dateTimeStringSchema,
        { type: "null" }
      ]
    },
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const permissionPolicyWriteRequestBodySchema = {
  type: "object",
  required: ["scope_kind", "scope_id", "action_pattern", "effect"],
  properties: {
    scope_kind: { type: "string", enum: ["org", "workspace", "role", "session"] },
    scope_id: { type: "string", minLength: 1, maxLength: 64 },
    action_pattern: { type: "string", minLength: 1, maxLength: 128 },
    effect: { type: "string", enum: ["allow", "deny", "ask"] },
    priority: { type: "integer", default: 0 },
    learned_from_session: { type: "boolean", default: false }
  },
  additionalProperties: false
} as const;
const createApprovalRequestBodySchema = {
  type: "object",
  required: ["action_pattern"],
  properties: {
    kind: { type: "string", enum: ["tool", "proposal", "revision"], default: "tool" },
    work_item_id: uuidStringSchema,
    agent_run_id: uuidStringSchema,
    action_pattern: { type: "string", minLength: 1, maxLength: 128 },
    payload_json: approvalPayloadResponseSchema,
    routed_to_user_id: uuidStringSchema,
    sla_due_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const approvalCreationResultResponseSchema = {
  type: "object",
  required: ["outcome"],
  properties: {
    outcome: { type: "string", enum: ["allowed", "denied", "escalated", "pending"] },
    decision: { type: "object", additionalProperties: true },
    reason: { type: "string", enum: ["no_approver"] },
    approval: approvalRequestResponseSchema,
    attention: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const permissionForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Permission action is not allowed for the current user",
  ["forbidden"]
).responses["403"];
const permissionPolicyNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Permission policy was not found",
  ["permission_policy_not_found"]
).responses["404"];
const permissionPolicyListResponse = {
  responses: {
    "200": jsonDataResponse({ type: "array", items: permissionPolicyRecordResponseSchema }, "Permission policies")
      .responses["200"],
    "403": permissionForbiddenResponse
  }
} as const;
const permissionPolicyWriteResponse = {
  responses: {
    "200": jsonDataResponse(permissionPolicyRecordResponseSchema, "Created permission policy").responses["200"],
    "403": permissionForbiddenResponse
  }
} as const;
const permissionPolicyDeleteResponse = {
  responses: {
    "200": jsonDataResponse(permissionPolicyRecordResponseSchema, "Revoked permission policy").responses["200"],
    "403": permissionForbiddenResponse,
    "404": permissionPolicyNotFoundResponse
  }
} as const;
const permissionApprovalAskResponse = {
  responses: {
    "200": jsonDataResponse(approvalCreationResultResponseSchema, "Approval request creation result").responses["200"],
    "403": permissionForbiddenResponse
  }
} as const;
const approvalRespondResultResponseSchema = {
  type: "object",
  required: ["approval"],
  properties: {
    approval: approvalRequestResponseSchema,
    learned_policy: permissionPolicyRecordResponseSchema
  },
  additionalProperties: false
} as const;
const approvalDelegateResultResponseSchema = {
  type: "object",
  required: ["approval", "attention"],
  properties: {
    approval: approvalRequestResponseSchema,
    attention: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const resolveEscalationRequestBodySchema = {
  type: "object",
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["retry", "pm_mode", "cancel"] },
    reason_md: { type: "string", minLength: 1, maxLength: 2000 }
  },
  additionalProperties: false
} as const;
const delegateEscalationRequestBodySchema = {
  type: "object",
  required: ["to_user_id"],
  properties: {
    to_user_id: uuidStringSchema,
    reason_md: { type: "string", minLength: 1, maxLength: 2000 }
  },
  additionalProperties: false
} as const;
const escalationResolveResultResponseSchema = {
  type: "object",
  required: ["escalation", "work_item_status", "attention"],
  properties: {
    escalation: {
      type: "object",
      required: ["id", "work_item_id", "resolved_at"],
      properties: {
        id: uuidStringSchema,
        work_item_id: uuidStringSchema,
        resolved_at: dateTimeStringSchema
      },
      additionalProperties: false
    },
    work_item_status: {
      type: "string",
      enum: [
        "intake",
        "ai_clarifying",
        "spec_ready",
        "ai_working",
        "escalated",
        "pm_mode",
        "in_review",
        "merged",
        "done",
        "cancelled"
      ]
    },
    attention: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const workItemStatusResponseSchema = {
  type: "string",
  enum: [
    "intake",
    "ai_clarifying",
    "spec_ready",
    "ai_working",
    "escalated",
    "pm_mode",
    "in_review",
    "merged",
    "done",
    "cancelled"
  ]
} as const;
const escalationBudgetResolveResultResponseSchema = {
  type: "object",
  required: ["escalation", "work_item_status", "attention"],
  properties: {
    escalation: {
      type: "object",
      required: ["id", "work_item_id", "resolved_at"],
      properties: {
        id: uuidStringSchema,
        work_item_id: uuidStringSchema,
        resolved_at: dateTimeStringSchema
      },
      additionalProperties: false
    },
    work_item_status: workItemStatusResponseSchema,
    attention: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const memoryConflictResolutionResponseSchema = {
  type: "string",
  enum: ["keep_current", "accept_incoming", "merge_both", "edit_memory", "discard_both"]
} as const;
const memoryConflictResolveRequestBodySchema = {
  type: "object",
  properties: {
    value_md: { type: "string", minLength: 1, maxLength: 4000 },
    expected_updated_at: { type: "string", format: "date-time" }
  },
  additionalProperties: false
} as const;
const memoryConflictRowResponseSchema = {
  type: "object",
  required: [
    "id",
    "workspaceId",
    "userId",
    "category",
    "key",
    "currentValueMd",
    "incomingValueMd",
    "candidateMemoryIds",
    "status",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: uuidStringSchema,
    workspaceId: uuidStringSchema,
    userId: uuidStringSchema,
    sourceRunId: { anyOf: [uuidStringSchema, { type: "null" }] },
    category: { type: "string", enum: ["preference", "correction", "recurring_context"] },
    key: { type: "string", minLength: 1, maxLength: 256 },
    currentValueMd: { type: "string", minLength: 1 },
    incomingValueMd: { type: "string", minLength: 1 },
    baseValueMd: { anyOf: [{ type: "string" }, { type: "null" }] },
    candidateMemoryIds: { type: "array", items: uuidStringSchema },
    status: { type: "string", enum: ["open", "resolved"] },
    resolution: { anyOf: [memoryConflictResolutionResponseSchema, { type: "null" }] },
    resolvedValueMd: { anyOf: [{ type: "string" }, { type: "null" }] },
    resolvedByUserId: { anyOf: [uuidStringSchema, { type: "null" }] },
    resolvedAt: { anyOf: [dateTimeStringSchema, { type: "null" }] },
    createdAt: dateTimeStringSchema,
    updatedAt: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const memoryConflictResolveResultResponseSchema = {
  type: "object",
  required: ["conflict"],
  properties: {
    conflict: memoryConflictRowResponseSchema
  },
  additionalProperties: false
} as const;
const escalationDelegateResultResponseSchema = {
  type: "object",
  required: ["escalation", "attention"],
  properties: {
    escalation: {
      type: "object",
      required: ["id", "work_item_id", "suggested_lead_user_id"],
      properties: {
        id: uuidStringSchema,
        work_item_id: uuidStringSchema,
        suggested_lead_user_id: uuidStringSchema
      },
      additionalProperties: false
    },
    attention: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const approvalRaceResponse = jsonErrorStatusResponse(
  "409",
  "Approval was already handled before this action completed",
  ["approval_race"]
).responses["409"];
const escalationMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Escalation request body must be a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const approvalDelegateNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Approval or delegate target was not found",
  ["not_found", "delegate_target_not_found"]
).responses["404"];
const escalationResolveNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Escalation was not found",
  ["not_found", "escalation_not_found"]
).responses["404"];
const escalationDelegateNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Escalation or delegate target was not found",
  ["not_found", "escalation_not_found", "delegate_target_not_found"]
).responses["404"];
const escalationRaceResponse = jsonErrorStatusResponse(
  "409",
  "Escalation was already handled before this action completed",
  ["escalation_race", "escalation_status_conflict"]
).responses["409"];
const escalationRetryUnavailableResponse = jsonErrorStatusResponse(
  "503",
  "Escalation retry dispatch failed after reopening the escalation",
  ["task_dispatch_retry_failed", "agent_run_retry_failed"]
).responses["503"];
const escalationDelegateRaceResponse = jsonErrorStatusResponse(
  "409",
  "Escalation delegation raced with another handler",
  ["escalation_race"]
).responses["409"];
const escalationBudgetActionUnavailableResponse = jsonErrorStatusResponse(
  "422",
  "Budget action is not available for this escalation",
  ["budget_action_not_available", "budget_action_requires_budget_update"]
).responses["422"];
const approvalDelegateSemanticResponse = jsonErrorStatusResponse(
  "422",
  "Approval delegation target is not valid for this request",
  ["delegate_to_requester", "delegate_target_cannot_view"]
).responses["422"];
const approvalDelegateAuthorizationUnavailableResponse = jsonErrorStatusResponse(
  "503",
  "Approval delegation target authorization could not be verified",
  ["delegate_membership_unavailable", "delegate_user_directory_unavailable"]
).responses["503"];
const approvalMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Approval comment request body must be a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const approvalNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Approval route requires an authenticated user",
  ["not_identified"]
).responses["401"];
const approvalListForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Approval center requires a valid local client token",
  ["invalid_client_token"]
).responses["403"];
const approvalReadForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Approval is not readable by the current user",
  ["invalid_client_token", "forbidden"]
).responses["403"];
const approvalNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Approval was not found",
  ["not_found"]
).responses["404"];
const approvalValidationResponse = jsonErrorStatusResponse(
  "422",
  "Approval comment request body is not valid",
  ["validation_error"]
).responses["422"];
const escalationValidationResponse = jsonErrorStatusResponse(
  "422",
  "Escalation request body is not valid",
  ["validation_error"]
).responses["422"];
const memoryConflictMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Memory conflict resolve request body must be a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const memoryConflictNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Memory conflict was not found or was already handled",
  ["not_found", "memory_conflict_not_found"]
).responses["404"];
const memoryConflictStatusChangedResponse = jsonErrorStatusResponse(
  "409",
  "Memory conflict was handled before this action completed",
  ["memory_conflict_status_changed"]
).responses["409"];
const memoryConflictValidationResponse = jsonErrorStatusResponse(
  "422",
  "Memory conflict resolve request body or resolution is not valid",
  ["validation_error"]
).responses["422"];
const approvalCommentsUnavailableResponse = jsonErrorStatusResponse(
  "503",
  "Approval comments are not available in this deployment",
  ["comments_unavailable"]
).responses["503"];
const approvalListResponse = {
  responses: {
    "200": jsonDataResponse(approvalCenterResponseSchema, "Visible approval center").responses["200"],
    "401": approvalNotIdentifiedResponse,
    "403": approvalListForbiddenResponse
  }
} as const;
const approvalRespondResponse = {
  responses: {
    "200": jsonDataResponse(approvalRespondResultResponseSchema, "Approval decision result").responses["200"],
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": approvalNotFoundResponse,
    "409": approvalRaceResponse
  }
} as const;
const approvalDelegateResponse = {
  responses: {
    "200": jsonDataResponse(approvalDelegateResultResponseSchema, "Delegated approval result").responses["200"],
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": approvalDelegateNotFoundResponse,
    "422": approvalDelegateSemanticResponse,
    "409": approvalRaceResponse,
    "503": approvalDelegateAuthorizationUnavailableResponse
  }
} as const;
const escalationResolveResponse = {
  responses: {
    "200": jsonDataResponse(escalationResolveResultResponseSchema, "Escalation resolution result").responses["200"],
    "400": escalationMalformedJsonResponse,
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": escalationResolveNotFoundResponse,
    "409": escalationRaceResponse,
    "422": escalationValidationResponse,
    "503": escalationRetryUnavailableResponse
  }
} as const;
const escalationBudgetResolveResponse = {
  responses: {
    "200": jsonDataResponse(escalationBudgetResolveResultResponseSchema, "Budget decision result").responses["200"],
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": escalationResolveNotFoundResponse,
    "409": escalationDelegateRaceResponse,
    "422": escalationBudgetActionUnavailableResponse
  }
} as const;
const memoryConflictResolveResponse = {
  responses: {
    "200": jsonDataResponse(memoryConflictResolveResultResponseSchema, "Memory conflict resolve result").responses["200"],
    "400": memoryConflictMalformedJsonResponse,
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": memoryConflictNotFoundResponse,
    "409": memoryConflictStatusChangedResponse,
    "422": memoryConflictValidationResponse
  }
} as const;
const escalationDelegateResponse = {
  responses: {
    "200": jsonDataResponse(escalationDelegateResultResponseSchema, "Delegated escalation result").responses["200"],
    "400": escalationMalformedJsonResponse,
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": escalationDelegateNotFoundResponse,
    "409": escalationDelegateRaceResponse,
    "422": escalationValidationResponse
  }
} as const;
const approvalCommentListResponse = {
  responses: {
    "200": jsonDataResponse({ type: "array", items: approvalCommentResponseSchema }, "Approval comments").responses["200"],
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": approvalNotFoundResponse
  }
} as const;
const approvalCommentCreateResponse = {
  responses: {
    "200": jsonDataResponse(approvalCommentResponseSchema, "Created approval comment").responses["200"],
    "400": approvalMalformedJsonResponse,
    "401": approvalNotIdentifiedResponse,
    "403": approvalReadForbiddenResponse,
    "404": approvalNotFoundResponse,
    "422": approvalValidationResponse,
    "503": approvalCommentsUnavailableResponse
  }
} as const;
const notificationItemResponseSchema = {
  type: "object",
  required: ["id", "user_id", "type", "severity", "title", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    user_id: uuidStringSchema,
    type: { type: "string", minLength: 1, maxLength: 64 },
    severity: { type: "string", enum: ["normal", "high", "urgent"] },
    title: { type: "string", minLength: 1, maxLength: 256 },
    body: { type: "string" },
    target_url: { type: "string", minLength: 1 },
    project_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    conversation_id: uuidStringSchema,
    next_remind_at: { ...dateTimeStringSchema, description: "Next reminder-ladder resurface time; present only while the notification is still on the 24h nudge ladder (drives the 'snooze reminders' button)." },
    reminder_count: { type: "integer", minimum: 0, description: "How many times this notification has been resurfaced by the reminder ladder." },
    dedupe_key: { type: "string", maxLength: 256 },
    read_at: dateTimeStringSchema,
    archived_at: dateTimeStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const notificationListResponseSchema = {
  type: "object",
  required: ["items", "counts"],
  properties: {
    items: {
      type: "array",
      items: notificationItemResponseSchema
    },
    counts: {
      type: "object",
      required: ["unread", "total"],
      properties: {
        unread: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;
const notificationPreferencesResponseSchema = {
  type: "object",
  required: ["muted_notification_types", "care_messages_enabled"],
  properties: {
    muted_notification_types: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 64 }
    },
    // R15 批 F（主动关怀 opt-out）：是否接收 Cuu 的主动关怀消息（默认 true）。
    care_messages_enabled: { type: "boolean" }
  },
  additionalProperties: false
} as const;
// PUT 请求体：muted_notification_types 必填，care_messages_enabled 可选（缺省=不动关怀开关）。
const notificationPreferencesRequestBodySchema = {
  type: "object",
  required: ["muted_notification_types"],
  properties: {
    muted_notification_types: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 64 }
    },
    care_messages_enabled: { type: "boolean" }
  },
  additionalProperties: false
} as const;
const notificationReadAllResponseSchema = {
  type: "object",
  required: ["updated"],
  properties: {
    updated: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const notificationMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Notification preferences request body must be a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const notificationNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Notification route requires an authenticated user",
  ["not_identified"]
).responses["401"];
const notificationForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Notification route requires a valid local client token",
  ["invalid_client_token"]
).responses["403"];
const notificationMutationNotFoundResponse = jsonErrorStatusResponse("404", "Notification was not found or is not visible to the current user", [
  "not_found"
]).responses["404"];
const notificationValidationResponse = jsonErrorStatusResponse(
  "422",
  "Notification preferences request body is not valid",
  ["validation_error"]
).responses["422"];
const notificationListResponse = {
  responses: {
    "200": jsonDataResponse(notificationListResponseSchema, "Current user's notifications").responses["200"],
    "401": notificationNotIdentifiedResponse,
    "403": notificationForbiddenResponse
  }
} as const;
const notificationPreferencesReadResponse = {
  responses: {
    "200": jsonDataResponse(notificationPreferencesResponseSchema, "Notification mute preferences").responses["200"],
    "401": notificationNotIdentifiedResponse,
    "403": notificationForbiddenResponse
  }
} as const;
const notificationItemMutationResponse = (description: string) => ({
  responses: {
    "200": jsonDataResponse(notificationItemResponseSchema, description).responses["200"],
    "401": notificationNotIdentifiedResponse,
    "403": notificationForbiddenResponse,
    "404": notificationMutationNotFoundResponse
  }
});
const notificationCompleteResponse = {
  responses: {
    "200": jsonDataResponse(notificationItemResponseSchema, "Completed notification").responses["200"],
    "401": notificationNotIdentifiedResponse,
    "403": notificationForbiddenResponse,
    "404": notificationMutationNotFoundResponse,
    "409": jsonErrorStatusResponse("409", "Notification still requires a source decision", [
      "notification_needs_decision"
    ]).responses["409"]
  }
} as const;
const notificationPreferencesUpdateResponse = {
  responses: {
    "200": jsonDataResponse(notificationPreferencesResponseSchema, "Updated notification mute preferences").responses["200"],
    "400": notificationMalformedJsonResponse,
    "401": notificationNotIdentifiedResponse,
    "403": notificationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Notification preferences target user was not found", [
      "not_found"
    ]).responses["404"],
    "422": notificationValidationResponse,
    "501": jsonErrorStatusResponse("501", "Notification preferences are not supported by this deployment", [
      "not_implemented"
    ]).responses["501"]
  }
} as const;
const notificationReadAllResponse = {
  responses: {
    "200": jsonDataResponse(notificationReadAllResponseSchema, "Notification bulk-read result").responses["200"],
    "401": notificationNotIdentifiedResponse,
    "403": notificationForbiddenResponse
  }
} as const;
const calendarViewQueryParameter = {
  name: "view",
  in: "query",
  required: false,
  schema: { type: "string", enum: ["day", "week"] }
} as const;
const scheduleBlockResponseSchema = {
  type: "object",
  required: ["id", "kind", "title", "ends_at", "status", "severity"],
  properties: {
    id: uuidStringSchema,
    kind: { type: "string", enum: ["schedule_event", "work_item_due", "meeting_followup", "review_window"] },
    title: { type: "string", minLength: 1 },
    description: { type: "string" },
    starts_at: dateTimeStringSchema,
    ends_at: dateTimeStringSchema,
    all_day: { type: "boolean" },
    status: { type: "string", enum: ["upcoming", "today", "overdue", "done"] },
    severity: { type: "string", enum: ["normal", "high", "urgent"] },
    target_href: { type: "string", minLength: 1 },
    project_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    source_context: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const calendarPageResponseSchema = {
  type: "object",
  required: ["generated_at", "actor_user_id", "scope", "summary", "days", "blocks"],
  properties: {
    generated_at: dateTimeStringSchema,
    actor_user_id: uuidStringSchema,
    scope: {
      type: "object",
      required: ["date", "view", "range_start", "range_end"],
      properties: {
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        view: { type: "string", enum: ["day", "week"] },
        range_start: dateTimeStringSchema,
        range_end: dateTimeStringSchema
      },
      additionalProperties: false
    },
    summary: {
      type: "object",
      required: ["block_count", "overdue_count", "today_count", "week_count"],
      properties: {
        block_count: { type: "integer", minimum: 0 },
        overdue_count: { type: "integer", minimum: 0 },
        today_count: { type: "integer", minimum: 0 },
        week_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    days: {
      type: "array",
      items: {
        type: "object",
        required: ["date", "blocks"],
        properties: {
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          is_today: { type: "boolean" },
          blocks: { type: "array", items: scheduleBlockResponseSchema }
        },
        additionalProperties: false
      }
    },
    blocks: { type: "array", items: scheduleBlockResponseSchema },
    empty_state: { type: "string", enum: ["no_schedule_blocks"] }
  },
  additionalProperties: false
} as const;
const calendarPageResponse = {
  responses: {
    "200": jsonOkResponse(calendarPageResponseSchema).responses["200"],
    "422": jsonErrorStatusResponse("422", "Calendar page query is not valid", [
      "invalid_calendar_query"
    ]).responses["422"]
  }
} as const;
const projectResponseSchema = {
  type: "object",
  required: ["id", "name", "slug", "owner_nickname"],
  properties: {
    id: uuidStringSchema,
    workspace_id: {
      anyOf: [
        uuidStringSchema,
        { type: "null" }
      ]
    },
    name: { type: "string", minLength: 1, maxLength: 128 },
    slug: { type: "string", minLength: 1, maxLength: 64 },
    description: { type: "string" },
    owner_nickname: { type: "string", minLength: 1, maxLength: 64 },
    owner_user_id: {
      anyOf: [
        uuidStringSchema,
        { type: "null" }
      ]
    }
  },
  additionalProperties: false
} as const;
const projectListItemResponseSchema = {
  ...projectResponseSchema,
  required: [
    "id",
    "name",
    "slug",
    "owner_nickname",
    "archived",
    "created_at",
    "updated_at",
    "open_work_item_count"
  ],
  properties: {
    ...projectResponseSchema.properties,
    archived: { type: "boolean" },
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema,
    open_work_item_count: { type: "integer", minimum: 0 }
  }
} as const;
const projectListResponseSchema = {
  type: "object",
  required: ["generated_at", "projects"],
  properties: {
    generated_at: dateTimeStringSchema,
    projects: {
      type: "array",
      items: projectListItemResponseSchema
    }
  },
  additionalProperties: false
} as const;
const projectListResponse = {
  responses: {
    "200": jsonDataResponse(projectListResponseSchema, "Projects visible to the current actor").responses["200"],
    "401": jsonErrorStatusResponse("401", "Project list requires an authenticated user", [
      "not_identified"
    ]).responses["401"],
    "403": jsonErrorStatusResponse("403", "Project list requires a valid local client token", [
      "invalid_client_token"
    ]).responses["403"]
  }
} as const;
const bootstrapProjectResultResponseSchema = {
  type: "object",
  required: ["project", "created", "context_ready"],
  properties: {
    project: projectResponseSchema,
    created: { type: "boolean" },
    context_ready: { type: "boolean", const: true }
  },
  additionalProperties: false
} as const;
const bootstrapProjectResponse = {
  responses: {
    "200": jsonDataResponse(bootstrapProjectResultResponseSchema, "Existing project bootstrap result").responses["200"],
    "201": jsonDataResponse(bootstrapProjectResultResponseSchema, "Created project bootstrap result").responses["200"],
    "403": jsonErrorStatusResponse("403", "Project bootstrap requires a human user identity", [
      "human_required"
    ]).responses["403"],
    "409": jsonErrorStatusResponse("409", "Requested project slug is occupied by an archived or deleted project", [
      "project_slug_occupied"
    ]).responses["409"]
  }
} as const;
// R20 P2A（R19-18 指派）：work_item_assignments 行的响应形状（与 assignmentSchema 同源）。
const workItemAssignmentResponseSchema = {
  type: "object",
  required: ["id", "work_item_id", "user_id", "role", "assigned_by_user_id", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    user_id: uuidStringSchema,
    role: { type: "string", enum: ["lead", "collaborator"] },
    assigned_by_user_id: uuidStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
// R20 P2A（R19-22 评论）：comments 行的响应形状。
const workItemCommentResponseSchema = {
  type: "object",
  required: ["id", "work_item_id", "author_nickname", "body", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    author_nickname: { type: "string", minLength: 1, maxLength: 64 },
    body: { type: "string", minLength: 1 },
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const drivePreviewResponse = {
  responses: {
    "200": {
      description: "Text-like Drive file preview",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["ok", "data"],
            properties: {
              ok: { type: "boolean", const: true },
              data: {
                type: "object",
                required: [
                  "id",
                  "item_id",
                  "filename",
                  "size_bytes",
                  "preview_type",
                  "text",
                  "truncated",
                  "download_href"
                ],
                properties: {
                  id: uuidStringSchema,
                  item_id: uuidStringSchema,
                  filename: { type: "string", minLength: 1 },
                  mime: { type: "string", minLength: 1 },
                  size_bytes: { type: "integer", minimum: 0 },
                  preview_type: { type: "string", enum: ["text"] },
                  text: { type: "string" },
                  truncated: { type: "boolean" },
                  download_href: { type: "string", minLength: 1 }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        }
      }
    },
    ...driveForbiddenResponse.responses,
    ...jsonErrorStatusResponse("404", "Stored Drive file was not found", driveFileMissingCodes).responses,
    ...jsonErrorStatusResponse("415", "Stored Drive file cannot be previewed inline", [
      "drive_preview_unsupported"
    ]).responses
  }
} as const;
const drivePageResponseSchema = {
  type: "object",
  required: [
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
  ],
  properties: {
    generated_at: dateTimeStringSchema,
    project: {
      type: "object",
      required: ["id", "name", "slug", "status"],
      properties: {
        id: uuidStringSchema,
        name: { type: "string", minLength: 1 },
        slug: { type: "string", minLength: 1 },
        owner_label: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["active", "archived"] }
      },
      additionalProperties: true
    },
    summary: {
      type: "object",
      required: [
        "item_count",
        "file_count",
        "folder_count",
        "deleted_item_count",
        "version_count",
        "accepted_deliverable_count",
        "pending_comment_count",
        "operation_count"
      ],
      properties: {
        item_count: { type: "integer", minimum: 0 },
        file_count: { type: "integer", minimum: 0 },
        folder_count: { type: "integer", minimum: 0 },
        deleted_item_count: { type: "integer", minimum: 0 },
        version_count: { type: "integer", minimum: 0 },
        accepted_deliverable_count: { type: "integer", minimum: 0 },
        pending_comment_count: { type: "integer", minimum: 0 },
        operation_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    can_manage: { type: "boolean" },
    selected_item_id: uuidStringSchema,
    search_query: { type: "string" },
    items: { type: "array", items: { type: "object", additionalProperties: true } },
    deleted_items: { type: "array", items: { type: "object", additionalProperties: true } },
    versions: { type: "array", items: { type: "object", additionalProperties: true } },
    accepted_deliverables: { type: "array", items: { type: "object", additionalProperties: true } },
    comments: { type: "array", items: { type: "object", additionalProperties: true } },
    operations: { type: "array", items: { type: "object", additionalProperties: true } },
    actions: {
      type: "object",
      properties: {
        upload_file: actionSpecSchema,
        delete_item: actionSpecSchema,
        restore_item: actionSpecSchema,
        comment_to_draft: actionSpecSchema
      },
      additionalProperties: false
    },
    empty_state: { type: "string", enum: ["no_project", "no_drive_items", "no_search_match"] }
  },
  additionalProperties: false
} as const;
const meetingPageResponseSchema = {
  type: "object",
  required: [
    "generated_at",
    "summary",
    "can_manage",
    "meetings"
  ],
  properties: {
    generated_at: dateTimeStringSchema,
    project: {
      type: "object",
      required: ["id", "name", "slug", "status"],
      properties: {
        id: uuidStringSchema,
        name: { type: "string", minLength: 1 },
        slug: { type: "string", minLength: 1 },
        owner_label: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["active", "archived"] }
      },
      additionalProperties: true
    },
    summary: {
      type: "object",
      required: [
        "meeting_count",
        "ready_count",
        "pending_insight_count",
        "confirmed_insight_count",
        "dismissed_insight_count"
      ],
      properties: {
        meeting_count: { type: "integer", minimum: 0 },
        ready_count: { type: "integer", minimum: 0 },
        pending_insight_count: { type: "integer", minimum: 0 },
        confirmed_insight_count: { type: "integer", minimum: 0 },
        dismissed_insight_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    can_manage: { type: "boolean" },
    // SA-02：这个部署是否配了 AI。false 时页面必须直说「AI 未配置，只保存了转写」。
    ai_analysis_configured: { type: "boolean" },
    selected_meeting_id: uuidStringSchema,
    meetings: { type: "array", items: { type: "object", additionalProperties: true } },
    empty_state: { type: "string", enum: ["no_project", "no_meetings"] }
  },
  additionalProperties: false
} as const;
const meetingMutationNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Meeting mutation requires an authenticated user",
  ["not_identified"]
).responses["401"];
const meetingInsightForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Meeting insight is not visible or mutable by the current user",
  ["invalid_client_token", "meeting_forbidden"]
).responses["403"];
const meetingInsightNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Meeting project or insight was not found",
  ["meeting_not_found", "meeting_insight_not_found"]
).responses["404"];
const meetingDraftProposalForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Meeting-created work item draft is not visible or mutable by the current user",
  ["invalid_client_token", "forbidden", "meeting_forbidden"]
).responses["403"];
const meetingDraftProposalNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Meeting-created work item draft or source insight was not found",
  ["not_found", "meeting_not_found", "meeting_insight_not_found"]
).responses["404"];
const notificationPageItemResponseSchema = {
  type: "object",
  required: ["id", "type", "severity", "status", "inbox_bucket", "title", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    type: { type: "string", minLength: 1 },
    severity: { type: "string", enum: ["normal", "high", "urgent"] },
    status: { type: "string", enum: ["unread", "read", "done"] },
    inbox_bucket: { type: "string", enum: ["needs_decision", "fyi", "done"] },
    title: { type: "string", minLength: 1 },
    body: { type: "string" },
    target_href: { type: "string", minLength: 1 },
    project_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    conversation_id: uuidStringSchema,
    next_remind_at: { ...dateTimeStringSchema, description: "Next reminder-ladder resurface time; present only while the notification is still on the 24h nudge ladder (drives the 'snooze reminders' button)." },
    reminder_count: { type: "integer", minimum: 0, description: "How many times this notification has been resurfaced by the reminder ladder." },
    dedupe_key: { type: "string", maxLength: 256 },
    read_at: dateTimeStringSchema,
    archived_at: dateTimeStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema,
    actions: { type: "object", additionalProperties: true },
    grounding: { type: "object", additionalProperties: true },
    source_context: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const notificationPageResponseSchema = {
  type: "object",
  required: ["generated_at", "actor_user_id", "summary", "buckets", "items"],
  properties: {
    generated_at: dateTimeStringSchema,
    actor_user_id: uuidStringSchema,
    summary: {
      type: "object",
      required: [
        "total_count",
        "unread_count",
        "needs_decision_count",
        "fyi_count",
        "done_count",
        "urgent_count"
      ],
      properties: {
        total_count: { type: "integer", minimum: 0 },
        unread_count: { type: "integer", minimum: 0 },
        needs_decision_count: { type: "integer", minimum: 0 },
        fyi_count: { type: "integer", minimum: 0 },
        done_count: { type: "integer", minimum: 0 },
        urgent_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    buckets: {
      type: "object",
      required: ["needs_decision", "fyi", "done"],
      properties: {
        needs_decision: { type: "array", items: notificationPageItemResponseSchema },
        fyi: { type: "array", items: notificationPageItemResponseSchema },
        done: { type: "array", items: notificationPageItemResponseSchema }
      },
      additionalProperties: false
    },
    items: { type: "array", items: notificationPageItemResponseSchema },
    actions: { type: "object", additionalProperties: true },
    empty_state: { type: "string", enum: ["no_notifications"] }
  },
  additionalProperties: false
} as const;
const projectHealthPageResponseSchema = {
  type: "object",
  required: ["generated_at", "actor_user_id", "viewer_scope", "summary", "cards"],
  properties: {
    generated_at: dateTimeStringSchema,
    actor_user_id: uuidStringSchema,
    viewer_scope: { type: "string", enum: ["admin", "member"] },
    summary: {
      type: "object",
      required: ["project_count", "healthy_count", "attention_count", "critical_count"],
      properties: {
        project_count: { type: "integer", minimum: 0 },
        healthy_count: { type: "integer", minimum: 0 },
        attention_count: { type: "integer", minimum: 0 },
        critical_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    cards: { type: "array", items: { type: "object", additionalProperties: true } },
    empty_state: { type: "string", enum: ["no_projects"] }
  },
  additionalProperties: false
} as const;
const budgetScopeResponseSchema = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "workitem_id"],
      properties: { kind: { type: "string", const: "workitem" }, workitem_id: uuidStringSchema },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["kind", "task_plan_id"],
      properties: { kind: { type: "string", const: "task" }, task_plan_id: uuidStringSchema },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["kind", "objective_id"],
      properties: { kind: { type: "string", const: "objective" }, objective_id: uuidStringSchema },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["kind", "user_id"],
      properties: { kind: { type: "string", const: "user" }, user_id: uuidStringSchema },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["kind", "team_id"],
      properties: { kind: { type: "string", const: "team" }, team_id: uuidStringSchema },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["kind", "team_id"],
      properties: { kind: { type: "string", const: "curation" }, team_id: uuidStringSchema },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["kind", "suite"],
      properties: { kind: { type: "string", const: "eval" }, suite: { type: "string", enum: ["nightly", "release"] } },
      additionalProperties: false
    }
  ]
} as const;
const budgetUsageResponseSchema = {
  type: "object",
  required: [
    "scope",
    "scope_label",
    "policy_id",
    "period",
    "period_start",
    "period_end",
    "token_in",
    "token_out",
    "total_tokens",
    "max_tokens",
    "remaining_tokens",
    "estimated_cost_cny",
    "max_cost_cny",
    "remaining_cost_cny",
    "warning_ratio",
    "status"
  ],
  properties: {
    scope: budgetScopeResponseSchema,
    scope_label: { type: "string", minLength: 1 },
    policy_id: { type: "string", minLength: 1 },
    period: { type: "string", enum: ["run", "day", "month"] },
    period_start: dateTimeStringSchema,
    period_end: dateTimeStringSchema,
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
    total_tokens: { type: "integer", minimum: 0 },
    max_tokens: { type: "integer", minimum: 0 },
    remaining_tokens: { type: "integer", minimum: 0 },
    estimated_cost_cny: { type: "string" },
    max_cost_cny: { type: "string" },
    remaining_cost_cny: { type: "string" },
    warning_ratio: { type: "number", minimum: 0 },
    status: { type: "string", enum: ["ok", "warning", "critical", "exhausted"] }
  },
  additionalProperties: false
} as const;
const budgetNoticeResponseSchema = {
  type: "object",
  required: ["code", "severity", "message", "scope", "usage_ratio", "recommended_action"],
  properties: {
    code: { type: "string", enum: ["budget_warning", "budget_exhausted"] },
    severity: { type: "string", enum: ["info", "warning", "critical"] },
    message: { type: "string", minLength: 1 },
    scope: budgetScopeResponseSchema,
    usage_ratio: { type: "number", minimum: 0 },
    recommended_action: { type: "string", enum: ["continue", "downgrade_model", "pause", "ask_admin", "add_budget"] },
    options: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "action_href"],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          action_href: { type: "string", minLength: 1 }
        },
        additionalProperties: false
      }
    },
    action_href: { type: "string" }
  },
  additionalProperties: false
} as const;
const costUsageSummaryResponseSchema = {
  type: "object",
  required: ["me", "team", "scopes", "active_notices", "generated_at"],
  properties: {
    me: budgetUsageResponseSchema,
    team: budgetUsageResponseSchema,
    scopes: { type: "array", items: budgetUsageResponseSchema },
    active_notices: { type: "array", items: budgetNoticeResponseSchema },
    generated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const costUsageSummaryResponse = {
  responses: {
    "200": jsonDataResponse(costUsageSummaryResponseSchema, "Current budget usage summary").responses["200"],
    "401": jsonErrorStatusResponse("401", "Cost usage requires an authenticated user", [
      "not_identified"
    ]).responses["401"],
    "403": jsonErrorStatusResponse("403", "Cost usage requires a valid local client token when one is presented", [
      "invalid_client_token"
    ]).responses["403"]
  }
} as const;
const budgetPolicyResponseSchema = {
  type: "object",
  required: [
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
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    scope_kind: { type: "string", enum: ["workitem", "task", "objective", "user", "team", "eval"] },
    period: { type: "string", enum: ["run", "day", "month"] },
    max_tokens: { type: "integer", minimum: 1 },
    max_cost_cny: { type: "string", pattern: "^\\d+(\\.\\d+)?$" },
    warning_ratio: { type: "number", minimum: 0, maximum: 1 },
    critical_ratio: { type: "number", minimum: 0, maximum: 1 },
    on_warning: { type: "string", enum: ["notify", "downgrade_model"] },
    on_exhausted: { type: "string", enum: ["block_new_run", "handoff_current_run"] },
    model_route_hint: { type: "string", enum: ["cheapest_safe", "balanced", "premium"] },
    enabled: { type: "boolean" },
    version: { type: "integer", minimum: 1 }
  },
  additionalProperties: false
} as const;
const budgetPolicyUpdateRequestBodySchema = {
  type: "object",
  minProperties: 1,
  properties: {
    max_tokens: { type: "integer", minimum: 1 },
    max_cost_cny: { type: "string", pattern: "^\\d+(\\.\\d+)?$" },
    warning_ratio: { type: "number", minimum: 0, maximum: 1 },
    critical_ratio: { type: "number", minimum: 0, maximum: 1 },
    on_warning: { type: "string", enum: ["notify", "downgrade_model"] },
    on_exhausted: { type: "string", enum: ["block_new_run", "handoff_current_run"] },
    model_route_hint: { type: "string", enum: ["cheapest_safe", "balanced", "premium"] },
    enabled: { type: "boolean" }
  },
  additionalProperties: false
} as const;
const costPolicyScopePathParameter = {
  name: "scope",
  in: "path",
  required: true,
  schema: { type: "string", enum: ["workitem", "task", "objective", "user", "team", "eval"] }
} as const;
const costPolicyIdPathParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1 }
} as const;
const costPolicyForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Cost policy management requires an admin user",
  ["forbidden"]
).responses["403"];
const costPolicyNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Cost policy was not found",
  ["not_found"]
).responses["404"];
const costPolicyValidationResponse = jsonErrorStatusResponse(
  "422",
  "Cost policy update payload is not valid",
  ["validation_error"]
).responses["422"];
const costPolicyListResponse = {
  responses: {
    "200": jsonDataResponse({ type: "array", items: budgetPolicyResponseSchema }, "AI budget policies").responses["200"],
    "403": costPolicyForbiddenResponse
  }
} as const;
const costPolicyUpdateResponse = {
  responses: {
    "200": jsonDataResponse(budgetPolicyResponseSchema, "Updated AI budget policy").responses["200"],
    "403": costPolicyForbiddenResponse,
    "404": costPolicyNotFoundResponse,
    "422": costPolicyValidationResponse
  }
} as const;
const pageNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Page VM requires an authenticated user",
  ["not_identified"]
).responses["401"];
const pageInvalidClientTokenResponse = jsonErrorStatusResponse(
  "403",
  "Page VM requires a valid local client token when one is presented",
  ["invalid_client_token"]
).responses["403"];
function jsonAuthenticatedPageResponse(dataSchema: Record<string, unknown>) {
  return {
    responses: {
      "200": jsonOkResponse(dataSchema).responses["200"],
      "401": pageNotIdentifiedResponse,
      "403": pageInvalidClientTokenResponse
    }
  };
}
const costDashboardPageResponseSchema = {
  type: "object",
  required: [
    "generated_at",
    "currency",
    "total_cost_cny",
    "token_in",
    "token_out",
    "trend",
    "by_user",
    "by_team",
    "by_workitem",
    "by_task_plan",
    "by_objective",
    "model_breakdown",
    "budget",
    "notices",
    "top_exhaustion_risks"
  ],
  properties: {
    generated_at: dateTimeStringSchema,
    currency: { type: "string", const: "CNY" },
    total_cost_cny: { type: "string" },
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
    unit_cost_cny: { type: "string" },
    trend: { type: "array", items: { type: "object", additionalProperties: true } },
    by_user: { type: "array", items: { type: "object", additionalProperties: true } },
    by_team: { type: "array", items: { type: "object", additionalProperties: true } },
    by_workitem: { type: "array", items: { type: "object", additionalProperties: true } },
    by_task_plan: { type: "array", items: { type: "object", additionalProperties: true } },
    by_objective: { type: "array", items: { type: "object", additionalProperties: true } },
    model_breakdown: { type: "array", items: { type: "object", additionalProperties: true } },
    labor_split: { type: "object", additionalProperties: true },
    budget: { type: "array", items: { type: "object", additionalProperties: true } },
    notices: { type: "array", items: { type: "object", additionalProperties: true } },
    top_exhaustion_risks: { type: "array", items: { type: "object", additionalProperties: true } },
    empty_state: { type: "string", enum: ["no_agent_runs", "usage_not_connected"] }
  },
  additionalProperties: false
} as const;
const taskPlanStatusResponseSchema = { type: "string", enum: ["draft", "proposed", "approved", "dispatching", "paused", "done", "cancelled"] } as const;
const taskPlanItemRoleResponseSchema = { type: "string", enum: ["research", "produce", "review", "integrate"] } as const;
const taskPlanItemStatusResponseSchema = { type: "string", enum: ["pending", "dispatched", "succeeded", "failed", "skipped"] } as const;
const agentArmyItemStatusResponseSchema = { type: "string", enum: ["pending", "dispatched", "succeeded", "failed", "needs_human", "skipped"] } as const;
const taskPlanItemResponseSchema = {
  type: "object",
  required: [
    "id",
    "plan_id",
    "seq",
    "title",
    "role",
    "objective_md",
    "acceptance_md",
    "budget_share_pct",
    "depends_on",
    "status",
    "created_at",
    "updated_at"
  ],
  properties: {
    id: uuidStringSchema,
    plan_id: uuidStringSchema,
    parent_item_id: { anyOf: [uuidStringSchema, { type: "null" }] },
    seq: { type: "integer", minimum: 0 },
    title: { type: "string", minLength: 1, maxLength: 256 },
    role: taskPlanItemRoleResponseSchema,
    objective_md: { type: "string", minLength: 1 },
    acceptance_md: { type: "string", minLength: 1 },
    budget_share_pct: { type: "integer", minimum: 0, maximum: 100 },
    depends_on: { type: "array", items: uuidStringSchema },
    status: taskPlanItemStatusResponseSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const taskPlanVmResponseSchema = {
  type: "object",
  required: [
    "id",
    "work_item_id",
    "workspace_id",
    "status",
    "created_by",
    "created_at",
    "updated_at",
    "items",
    "items_capped"
  ],
  properties: {
    id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    workspace_id: uuidStringSchema,
    status: taskPlanStatusResponseSchema,
    objective_id: { anyOf: [uuidStringSchema, { type: "null" }] },
    budget_json: { type: "object", additionalProperties: true },
    decomposition_context_json: { type: "object", additionalProperties: true },
    created_by: uuidStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema,
    items: { type: "array", items: taskPlanItemResponseSchema, maxItems: 50 },
    items_capped: { type: "boolean" }
  },
  additionalProperties: false
} as const;
const workItemAgentTeamActionResponseSchema = {
  type: "object",
  required: ["kind", "label", "href"],
  properties: {
    kind: { type: "string", enum: ["view_output", "decide"] },
    label: { type: "string", minLength: 1, maxLength: 48 },
    href: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;
const workItemAgentTeamItemResponseSchema = {
  type: "object",
  required: [
    "task_plan_item_id",
    "seq",
    "title",
    "role",
    "plan_status",
    "status",
    "budget_share_pct",
    "depends_on",
    "waiting_for_seq"
  ],
  properties: {
    task_plan_item_id: uuidStringSchema,
    seq: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 256 },
    role: taskPlanItemRoleResponseSchema,
    plan_status: taskPlanItemStatusResponseSchema,
    status: agentArmyItemStatusResponseSchema,
    budget_share_pct: { type: "integer", minimum: 0, maximum: 100 },
    depends_on: { type: "array", items: uuidStringSchema },
    waiting_for_seq: { type: "array", items: { type: "integer", minimum: 1 } },
    cost_estimate_cny: { type: "string" },
    run_id: uuidStringSchema,
    run_workspace_id: uuidStringSchema,
    parent_run_id: uuidStringSchema,
    run_status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "escalated", "cancelled"] },
    replay_href: { type: "string", minLength: 1 },
    decision_href: { type: "string", minLength: 1 },
    action: workItemAgentTeamActionResponseSchema
  },
  additionalProperties: false
} as const;
const workItemAgentTeamResponseSchema = {
  type: "object",
  required: [
    "plan_id",
    "status",
    "completed_count",
    "total_count",
    "cost_used_cny",
    "runs_capped",
    "items"
  ],
  properties: {
    plan_id: uuidStringSchema,
    status: taskPlanStatusResponseSchema,
    completed_count: { type: "integer", minimum: 0 },
    total_count: { type: "integer", minimum: 0 },
    cost_used_cny: { type: "string" },
    cost_budget_cny: { type: "string" },
    cost_burn_pct: { type: "integer", minimum: 0 },
    runs_capped: { type: "boolean" },
    items: { type: "array", items: workItemAgentTeamItemResponseSchema, maxItems: 50 }
  },
  additionalProperties: false
} as const;
const agentArmyDashboardCountByRoleResponseSchema = {
  type: "object",
  required: ["role", "count"],
  properties: {
    role: taskPlanItemRoleResponseSchema,
    count: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const agentArmyDashboardCountByStatusResponseSchema = {
  type: "object",
  required: ["status", "count"],
  properties: {
    status: agentArmyItemStatusResponseSchema,
    count: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const agentArmyDashboardPlanResponseSchema = {
  type: "object",
  required: [
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
  ],
  properties: {
    plan_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    work_item_code: { type: "string", minLength: 1 },
    work_item_title: { type: "string", minLength: 1, maxLength: 256 },
    work_item_href: { type: "string", minLength: 1 },
    objective_id: uuidStringSchema,
    objective_title: { type: "string", minLength: 1, maxLength: 256 },
    status: taskPlanStatusResponseSchema,
    progress: {
      type: "object",
      required: ["completed", "total", "label"],
      properties: {
        completed: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 },
        label: { type: "string", minLength: 1, maxLength: 32 }
      },
      additionalProperties: false
    },
    roles: { type: "array", items: agentArmyDashboardCountByRoleResponseSchema },
    statuses: { type: "array", items: agentArmyDashboardCountByStatusResponseSchema },
    cost: {
      type: "object",
      required: ["used_cny"],
      properties: {
        used_cny: { type: "string" },
        budget_cny: { type: "string" },
        burn_pct: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    judge: {
      type: "object",
      required: ["passed", "total", "pass_rate_pct"],
      properties: {
        passed: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 },
        pass_rate_pct: { type: "integer", minimum: 0, maximum: 100 }
      },
      additionalProperties: false
    },
    oldest_blocker: {
      type: "object",
      required: ["kind", "label", "age_seconds"],
      properties: {
        kind: { type: "string", enum: ["needs_human", "budget", "stalled"] },
        label: { type: "string", minLength: 1, maxLength: 128 },
        age_seconds: { type: "integer", minimum: 0 },
        href: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const agentArmyDashboardRecentEscalationResponseSchema = {
  type: "object",
  required: ["id", "work_item_id", "title", "reason_preview", "created_at", "href"],
  properties: {
    id: uuidStringSchema,
    plan_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    title: { type: "string", minLength: 1, maxLength: 128 },
    reason_preview: { type: "string", minLength: 1, maxLength: 200 },
    created_at: dateTimeStringSchema,
    href: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;
const agentArmyDashboardPageInfoResponseSchema = {
  type: "object",
  required: [
    "plan_limit",
    "returned",
    "plans_capped",
    "items_capped",
    "runs_capped",
    "escalation_limit",
    "escalation_returned",
    "escalations_capped"
  ],
  properties: {
    plan_limit: { type: "integer", minimum: 1 },
    returned: { type: "integer", minimum: 0 },
    plans_capped: { type: "boolean" },
    items_capped: { type: "boolean" },
    runs_capped: { type: "boolean" },
    escalation_limit: { type: "integer", minimum: 1 },
    escalation_returned: { type: "integer", minimum: 0 },
    escalations_capped: { type: "boolean" }
  },
  additionalProperties: false
} as const;
const attentionSourceWarningResponseSchema = {
  type: "object",
  required: ["source", "message"],
  properties: {
    source: { type: "string", enum: ["approvals", "proposals", "escalations", "sync_conflicts"] },
    message: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;
const agentArmyDashboardPageResponseSchema = {
  type: "object",
  required: ["generated_at", "kpis", "plans", "recent_escalations", "page_info"],
  properties: {
    generated_at: dateTimeStringSchema,
    kpis: {
      type: "object",
      required: ["active_team_count", "waiting_decision_count", "today_cost_cny", "autonomy_rate_pct"],
      properties: {
        active_team_count: { type: "integer", minimum: 0 },
        waiting_decision_count: { type: "integer", minimum: 0 },
        today_cost_cny: { type: "string" },
        autonomy_rate_pct: { type: "integer", minimum: 0, maximum: 100 }
      },
      additionalProperties: false
    },
    plans: { type: "array", maxItems: 20, items: agentArmyDashboardPlanResponseSchema },
    recent_escalations: { type: "array", maxItems: 5, items: agentArmyDashboardRecentEscalationResponseSchema },
    source_warnings: { type: "array", items: attentionSourceWarningResponseSchema },
    page_info: agentArmyDashboardPageInfoResponseSchema,
    empty_state: { type: "string", enum: ["no_agent_armies"] }
  },
  additionalProperties: false
} as const;
const teamSkillPageItemResponseSchema = {
  type: "object",
  required: ["skill_key", "name", "when_to_use", "version", "source_kind", "created_by_kind", "sample_count", "updated_at"],
  properties: {
    skill_key: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    when_to_use: { type: "string", minLength: 1 },
    version: { type: "integer", minimum: 1 },
    source_kind: { type: "string", enum: ["distilled", "authored"] },
    created_by_kind: { type: "string", enum: ["ai", "human"] },
    confidence_score: { type: "number", minimum: 0, maximum: 1 },
    sample_count: { type: "integer", minimum: 0 },
    updated_at: dateTimeStringSchema,
    provenance: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
// R23 SA-06：夜间自学的运行状态。enabled = 开关已开且这台部署配了 LLM 密钥（缺一样今晚都不会跑）；
// last_run_at 只反映本进程记到的上一轮，重启后回 null——不拿审计日志里「上次学到新技能的时间」冒充。
const teamSkillCurationStatusResponseSchema = {
  type: "object",
  required: ["enabled", "running", "last_run_at"],
  properties: {
    enabled: { type: "boolean" },
    running: { type: "boolean" },
    last_run_at: { ...dateTimeStringSchema, nullable: true }
  },
  additionalProperties: false
} as const;
const teamSkillsPageResponseSchema = {
  type: "object",
  required: ["generated_at", "skills", "totals", "curation"],
  properties: {
    generated_at: dateTimeStringSchema,
    skills: { type: "array", items: teamSkillPageItemResponseSchema },
    totals: {
      type: "object",
      required: ["active", "ai_authored", "refined"],
      properties: {
        active: { type: "integer", minimum: 0 },
        ai_authored: { type: "integer", minimum: 0 },
        refined: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    curation: teamSkillCurationStatusResponseSchema,
    empty_state: { type: "string", enum: ["no_skills"] }
  },
  additionalProperties: false
} as const;
const settingsPageResponseSchema = {
  type: "object",
  required: ["generated_at", "locale", "runtime", "llm_runtime", "budgets", "language", "device"],
  properties: {
    generated_at: dateTimeStringSchema,
    locale: { type: "string", enum: ["zh-CN", "en-US"] },
    runtime: { type: "object", additionalProperties: true },
    llm_runtime: { type: "object", additionalProperties: true },
    budgets: { type: "object", additionalProperties: true },
    language: { type: "object", additionalProperties: true },
    device: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const attentionHomePageResponseSchema = {
  type: "object",
  required: ["queue", "background_runs", "cuu_state"],
  properties: {
    primary: { type: "object", additionalProperties: true },
    queue: { type: "array", items: { type: "object", additionalProperties: true } },
    source_warnings: {
      type: "array",
      items: attentionSourceWarningResponseSchema
    },
    background_runs: {
      type: "array",
      items: {
        type: "object",
        required: ["run_id", "title", "state", "preview_text"],
        properties: {
          run_id: uuidStringSchema,
          work_item_id: uuidStringSchema,
          title: { type: "string", minLength: 1 },
          state: { type: "string", enum: ["queued", "running", "waiting_for_user", "failed"] },
          preview_text: { type: "string", minLength: 1 }
        },
        additionalProperties: false
      }
    },
    cuu_state: cuuStateResponseSchema,
    worklog: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const goldPathSurfacePageResponseSchema = {
  type: "object",
  required: ["fixture_id", "routes", "page_vms", "events", "cuu_states"],
  properties: {
    fixture_id: { type: "string", minLength: 1 },
    routes: {
      type: "object",
      required: ["home", "intake", "approvals", "workitem", "proposal", "replay", "cost", "knowledge"],
      properties: {
        home: { type: "string", minLength: 1 },
        intake: { type: "string", minLength: 1 },
        approvals: { type: "string", minLength: 1 },
        workitem: { type: "string", minLength: 1 },
        proposal: { type: "string", minLength: 1 },
        replay: { type: "string", minLength: 1 },
        cost: { type: "string", minLength: 1 },
        knowledge: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    page_vms: {
      type: "object",
      required: ["attention", "question", "evidence", "approvals", "workitem", "proposal", "replay", "cost"],
      properties: {
        attention: attentionHomePageResponseSchema,
        question: { type: "object", additionalProperties: true },
        evidence: { type: "object", additionalProperties: true },
        approvals: approvalCenterResponseSchema,
        workitem: { type: "object", additionalProperties: true },
        proposal: proposalDetailPageResponseSchema,
        replay: { type: "object", additionalProperties: true },
        cost: costDashboardPageResponseSchema,
        settings: settingsPageResponseSchema
      },
      additionalProperties: false
    },
    events: { type: "array", items: { type: "object", additionalProperties: true } },
    cuu_states: { type: "array", items: cuuStateResponseSchema }
  },
  additionalProperties: false
} as const;
const workItemDetailResponseSchema = {
  type: "object",
  required: [
    "workitem",
    "acceptance",
    "agent_trace_preview",
    "accepted_deliverables",
    "evidence_refs",
    "actions"
  ],
  properties: {
    workitem: {
      type: "object",
      required: [
        "id",
        "code",
        "project_id",
        "submitter_user_id",
        "status",
        "priority",
        "sync_state",
        "version",
        "mode",
        "human_reserved",
        "created_at",
        "updated_at"
      ],
      properties: {
        id: uuidStringSchema,
        code: { type: "string", minLength: 1 },
        project_id: uuidStringSchema,
        submitter_user_id: uuidStringSchema,
        title: { type: "string", maxLength: 256 },
        raw_description: { type: "string" },
        status: {
          type: "string",
          enum: [
            "intake",
            "ai_clarifying",
            "spec_ready",
            "ai_working",
            "escalated",
            "pm_mode",
            "in_review",
            "merged",
            "done",
            "cancelled"
          ]
        },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        sync_state: { type: "string", enum: ["pending", "synced", "failed"] },
        version: { type: "integer", minimum: 0 },
        mode: { type: "string", enum: ["worker", "pm"] },
        human_reserved: { type: "boolean" },
        created_at: dateTimeStringSchema,
        updated_at: dateTimeStringSchema
      },
      additionalProperties: true
    },
    project_name: { type: "string", minLength: 1 },
    acceptance: { type: "array", items: {} },
    agent_trace_preview: { type: "array", items: { type: "object", additionalProperties: true } },
    latest_proposal: { type: "object", additionalProperties: true },
    accepted_deliverables: { type: "array", items: acceptedDeliverableVmResponseSchema },
    evidence_refs: { type: "array", items: { type: "object", additionalProperties: true } },
    task_plan: taskPlanVmResponseSchema,
    agent_team: workItemAgentTeamResponseSchema,
    source_context: { type: "object", additionalProperties: true },
    actions: {
      type: "object",
      properties: {
        create_proposal_draft: actionSpecSchema
      },
      additionalProperties: false
    },
    can_claim: { type: "boolean" },
    can_assign: { type: "boolean" },
    // R23 P4：指派名单（POST /api/workitems/:id/assign 写入的 work_item_assignments 行）。省略＝无人被指派。
    assignees: {
      type: "array",
      items: {
        type: "object",
        properties: {
          user_id: { type: "string", format: "uuid" },
          nickname: { type: "string" },
          role: { type: "string", enum: ["lead", "collaborator"] }
        },
        required: ["user_id", "role"],
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
} as const;
const workItemDetailPageResponse = {
  responses: {
    "200": jsonOkResponse(workItemDetailResponseSchema).responses["200"],
    "403": jsonErrorStatusResponse("403", "Work item page is not readable by the current user", [
      "forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Work item page target was not found", [
      "not_found"
    ]).responses["404"],
    "409": jsonErrorStatusResponse("409", "Work item page cannot be opened in its current state", [
      "workitem_state_conflict"
    ]).responses["409"]
  }
} as const;
const projectHomePageResponseSchema = {
  type: "object",
  required: [
    "generated_at",
    "project",
    "summary",
    "open_work_items",
    "drive",
    "actions"
  ],
  properties: {
    generated_at: dateTimeStringSchema,
    project: {
      type: "object",
      required: ["id", "name", "slug", "description", "owner_label", "status"],
      properties: {
        id: uuidStringSchema,
        name: { type: "string", minLength: 1 },
        slug: { type: "string", minLength: 1 },
        description: { anyOf: [{ type: "string" }, { type: "null" }] },
        owner_label: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["active", "archived"] }
      },
      additionalProperties: false
    },
    summary: {
      type: "object",
      required: ["open_work_item_count"],
      properties: {
        open_work_item_count: { type: "integer", minimum: 0 },
        total_open_work_item_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    open_work_items: { type: "array", items: { type: "object", additionalProperties: true } },
    drive: {
      type: "object",
      required: ["file_count", "recent_files"],
      properties: {
        file_count: { type: "integer", minimum: 0 },
        recent_files: { type: "array", items: { type: "object", additionalProperties: true } }
      },
      additionalProperties: false
    },
    actions: {
      type: "object",
      required: ["new_task", "open_drive"],
      properties: {
        new_task: actionSpecSchema,
        open_drive: actionSpecSchema
      },
      additionalProperties: false
    },
    empty_state: { type: "string", enum: ["no_open_work"] },
    can_manage_lifecycle: { type: "boolean" }
  },
  additionalProperties: false
} as const;
const drivePageResponse = {
  responses: {
    "200": jsonOkResponse(drivePageResponseSchema).responses["200"],
    "403": jsonErrorStatusResponse("403", "Drive page is not readable by the current user", [
      "drive_forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Drive page project or selected file was not found", [
      "drive_not_found",
      "drive_file_not_found"
    ]).responses["404"]
  }
} as const;
const meetingPageResponse = {
  responses: {
    "200": jsonOkResponse(meetingPageResponseSchema).responses["200"],
    "403": jsonErrorStatusResponse("403", "Meeting page is not readable by the current user", [
      "meeting_forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Meeting page project or selected meeting was not found", [
      "meeting_not_found"
    ]).responses["404"]
  }
} as const;
const projectHomePageResponse = {
  responses: {
    "200": jsonOkResponse(projectHomePageResponseSchema).responses["200"],
    "403": jsonErrorStatusResponse("403", "Project home page is not readable by the current user", [
      "project_forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Project home page target was not found", [
      "project_not_found"
    ]).responses["404"]
  }
} as const;
// R15 批 E1（项目时间线 / 甘特）：里程碑 VM——CRUD 与时间线 VM 共用。
const timelineMilestoneSchema = {
  type: "object",
  required: ["id", "project_id", "title", "due_at", "sort", "status"],
  properties: {
    id: uuidStringSchema,
    project_id: uuidStringSchema,
    title: { type: "string", minLength: 1 },
    due_at: { anyOf: [dateTimeStringSchema, { type: "null" }] },
    sort: { type: "integer", minimum: 0 },
    status: { type: "string", enum: ["open", "done"] }
  },
  additionalProperties: false
} as const;
const timelineForbiddenResponse = jsonErrorStatusResponse("403", "Timeline resource is not mutable by the current user", [
  "project_forbidden",
  "forbidden"
]).responses["403"];
const timelineNotFoundResponse = jsonErrorStatusResponse("404", "Timeline project, milestone, or work item was not found", [
  "project_not_found",
  "milestone_not_found",
  "work_item_not_found",
  "not_found",
  "dependency_work_item_not_found"
]).responses["404"];
const timelineValidationResponse = jsonErrorStatusResponse("422", "Timeline mutation violated a scope, cycle, or self-reference rule", [
  "validation_error",
  "dependency_self_dependency",
  "dependency_cross_project",
  "dependency_cycle",
  "milestone_scope_mismatch"
]).responses["422"];
// R15 批 E3（项目规划 agent）：项目计划草案 VM——起草 / 列表 / 详情 / 审批 / 物化共用。
const projectPlanDraftMilestoneSchema = {
  type: "object",
  required: ["ref", "title", "due_at", "sort"],
  properties: {
    ref: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    due_at: { anyOf: [dateTimeStringSchema, { type: "null" }] },
    sort: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const projectPlanDraftItemSchema = {
  type: "object",
  required: ["ref", "title", "objective_md", "due_at", "milestone_ref", "depends_on_refs", "assignee_suggestion"],
  properties: {
    ref: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    objective_md: { type: "string", minLength: 1 },
    due_at: { anyOf: [dateTimeStringSchema, { type: "null" }] },
    milestone_ref: { anyOf: [{ type: "string" }, { type: "null" }] },
    depends_on_refs: { type: "array", items: { type: "string" } },
    assignee_suggestion: { anyOf: [{ type: "string" }, { type: "null" }] }
  },
  additionalProperties: false
} as const;
const projectPlanDraftResultSchema = {
  type: "object",
  required: ["milestone_ids", "work_item_ids", "dependency_count"],
  properties: {
    milestone_ids: { type: "array", items: uuidStringSchema },
    work_item_ids: { type: "array", items: uuidStringSchema },
    dependency_count: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const projectPlanDraftSchema = {
  type: "object",
  required: [
    "id", "project_id", "workspace_id", "status", "intent_md",
    "rationale_md", "review_reason_md", "milestones", "items", "result",
    "created_by", "reviewed_by", "created_at", "updated_at", "reviewed_at", "materialized_at"
  ],
  properties: {
    id: uuidStringSchema,
    project_id: uuidStringSchema,
    workspace_id: uuidStringSchema,
    status: { type: "string", enum: ["draft", "pending_review", "approved", "rejected", "materialized"] },
    intent_md: { type: "string" },
    rationale_md: { anyOf: [{ type: "string" }, { type: "null" }] },
    review_reason_md: { anyOf: [{ type: "string" }, { type: "null" }] },
    milestones: { type: "array", items: projectPlanDraftMilestoneSchema },
    items: { type: "array", items: projectPlanDraftItemSchema },
    result: { anyOf: [projectPlanDraftResultSchema, { type: "null" }] },
    created_by: uuidStringSchema,
    reviewed_by: { anyOf: [uuidStringSchema, { type: "null" }] },
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema,
    reviewed_at: { anyOf: [dateTimeStringSchema, { type: "null" }] },
    materialized_at: { anyOf: [dateTimeStringSchema, { type: "null" }] }
  },
  additionalProperties: false
} as const;
const projectPlannerForbiddenResponse = jsonErrorStatusResponse("403", "Project is not manageable by the current user", [
  "project_forbidden"
]).responses["403"];
const projectPlannerNotFoundResponse = jsonErrorStatusResponse("404", "Project or plan draft was not found", [
  "project_not_found",
  "project_plan_draft_not_found"
]).responses["404"];
const projectPlannerConflictResponse = jsonErrorStatusResponse("409", "Plan draft state does not allow this action", [
  "project_plan_needs_human",
  "project_plan_review_conflict",
  "project_plan_not_approved",
  "project_plan_cycle_detected"
]).responses["409"];
const projectPlannerValidationResponse = jsonErrorStatusResponse("422", "Planning intent or workspace was missing", [
  "validation_error",
  "project_plan_intent_required",
  "project_plan_reject_reason_required",
  "project_plan_workspace_missing"
]).responses["422"];
const projectPlannerUnavailableResponse = jsonErrorStatusResponse("503", "AI planning is not configured", [
  "project_plan_llm_unavailable"
]).responses["503"];
const projectTimelinePageResponseSchema = {
  type: "object",
  required: ["generated_at", "project", "milestones", "items", "critical"],
  properties: {
    generated_at: dateTimeStringSchema,
    project: {
      type: "object",
      required: ["id", "name", "slug"],
      properties: {
        id: uuidStringSchema,
        name: { type: "string", minLength: 1 },
        slug: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    milestones: { type: "array", items: timelineMilestoneSchema },
    items: { type: "array", items: { type: "object", additionalProperties: true } },
    critical: {
      type: "object",
      required: ["blocking", "overdue_blocking"],
      properties: {
        blocking: { type: "array", items: { type: "object", additionalProperties: true } },
        overdue_blocking: { type: "array", items: { type: "object", additionalProperties: true } }
      },
      additionalProperties: false
    },
    capped: { type: "boolean" },
    empty_state: { type: "string", enum: ["no_work_items"] }
  },
  additionalProperties: false
} as const;
const projectTimelinePageResponse = {
  responses: {
    "200": jsonOkResponse(projectTimelinePageResponseSchema).responses["200"],
    "403": jsonErrorStatusResponse("403", "Project timeline is not readable by the current user", [
      "project_forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Project timeline target was not found", [
      "project_not_found"
    ]).responses["404"]
  }
} as const;
// R16 批 W4a（项目级自定义指令）：权限门与上面的里程碑写同一道 canManageProjectDrive fence——
// 403/404 复用同款 timelineForbiddenResponse/timelineNotFoundResponse 的错误码集合（project_forbidden /
// project_not_found），不重开一套。
const projectInstructionsResponseSchema = {
  type: "object",
  required: ["project_id", "instructions_md", "updated_at"],
  properties: {
    project_id: uuidStringSchema,
    instructions_md: { type: "string", maxLength: 4000 },
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const patchProjectInstructionsRequestBodySchema = {
  type: "object",
  required: ["instructions_md"],
  properties: {
    instructions_md: { type: "string", maxLength: 4000 }
  },
  additionalProperties: false
} as const;
const projectInstructionsForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Project instructions are not manageable by the current user",
  ["project_forbidden"]
).responses["403"];
const projectInstructionsNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Project instructions target was not found",
  ["project_not_found"]
).responses["404"];
const projectInstructionsReadResponses = {
  responses: {
    "200": jsonDataResponse(projectInstructionsResponseSchema, "Project custom instructions for its manager").responses["200"],
    "401": proposalNotIdentifiedResponse,
    "403": projectInstructionsForbiddenResponse,
    "404": projectInstructionsNotFoundResponse
  }
} as const;
const projectInstructionsPatchResponses = {
  responses: {
    "200": jsonDataResponse(projectInstructionsResponseSchema, "Updated project custom instructions").responses["200"],
    "401": proposalNotIdentifiedResponse,
    "403": projectInstructionsForbiddenResponse,
    "404": projectInstructionsNotFoundResponse,
    "422": jsonErrorStatusResponse("422", "Project instructions body does not match the contract", [
      "validation_error"
    ]).responses["422"]
  }
} as const;
const openApiHttpMethods = new Set(["delete", "get", "head", "options", "patch", "post", "put"]);
type OpenApiParameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Record<string, unknown>;
};
type OpenApiOperation = {
  parameters?: OpenApiParameter[];
};
function withInferredPathParameters<T extends { paths: Record<string, Record<string, unknown>> }>(document: T): T {
  for (const [path, operations] of Object.entries(document.paths)) {
    const pathParameterNames = [...path.matchAll(/\{([^}]+)\}/gu)]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name));
    if (pathParameterNames.length === 0) {
      continue;
    }
    for (const [method, maybeOperation] of Object.entries(operations)) {
      if (!openApiHttpMethods.has(method) || typeof maybeOperation !== "object" || maybeOperation === null) {
        continue;
      }
      const operation = maybeOperation as OpenApiOperation;
      const existing = operation.parameters ?? [];
      const existingPathParameterNames = new Set(
        existing
          .filter((parameter) => parameter.in === "path")
          .map((parameter) => parameter.name)
      );
      const missing = pathParameterNames
        .filter((name) => !existingPathParameterNames.has(name))
        .map((name) => ({
          name,
          in: "path",
          required: true,
          schema: { type: "string" }
        }));
      if (missing.length) {
        operation.parameters = [...existing, ...missing];
      }
    }
  }
  return document;
}
const evidenceRefSchema = {
  type: "object",
  required: ["id", "source_type", "source_id", "title"],
  properties: {
    id: uuidStringSchema,
    source_type: {
      type: "string",
      enum: ["drive_file", "meeting", "comment", "work_item", "spec_doc", "agent_step", "audit_log", "external_url"]
    },
    source_id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    excerpt: { type: "string", maxLength: 300 },
    locator: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1 },
        slide: { type: "integer", minimum: 1 },
        sheet: { type: "string" },
        cell_range: { type: "string" },
        timestamp_s: { type: "number", minimum: 0 },
        path: { type: "string" },
        line_start: { type: "integer", minimum: 1 }
      },
      additionalProperties: false
    },
    confidence_hint: { type: "string", enum: ["found", "weak", "missing"] },
    href: { type: "string" }
  },
  additionalProperties: false
} as const;
const evidenceBubbleResponseSchema = {
  type: "object",
  required: ["id", "summary_text", "evidence_refs", "actions"],
  properties: {
    id: uuidStringSchema,
    query_text: { type: "string", minLength: 1 },
    summary_text: { type: "string", minLength: 1 },
    evidence_refs: {
      type: "array",
      items: evidenceRefSchema
    },
    missing_evidence_note: { type: "string", minLength: 1 },
    actions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label"],
        properties: {
          id: {
            type: "string",
            enum: ["use_for_current_task", "open_full_search", "copy_summary", "ask_followup"]
          },
          label: { type: "string", minLength: 1 },
          method: { type: "string", enum: ["GET", "POST"] },
          href: { type: "string", minLength: 1 }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
} as const;
const cuuLauncherSpecOptionSchema = {
  type: "object",
  required: ["id", "delivery_kind", "risk_hint", "default_acceptance"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64 },
    label: { type: "string", minLength: 1, maxLength: 128 },
    description: { type: "string", minLength: 1, maxLength: 300 },
    delivery_kind: { type: "string", enum: ["document_draft", "structured_data", "code_template", "ai_decide"] },
    risk_hint: { type: "string", enum: ["low", "medium", "high"] },
    default_acceptance: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 256 }
    }
  },
  additionalProperties: false
} as const;
const cuuLauncherWorkItemSpecSchema = {
  type: "object",
  required: ["source", "selected_options"],
  properties: {
    source: { type: "string", enum: ["cuu_desktop_launcher"] },
    selected_options: {
      type: "array",
      maxItems: 10,
      items: cuuLauncherSpecOptionSchema
    }
  },
  additionalProperties: false
} as const;
const questionOptionResponseSchema = {
  type: "object",
  required: ["id", "label"],
  properties: {
    id: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
    description: { type: "string" },
    impact: { type: "string" },
    risk_hint: { type: "string", enum: ["low", "medium", "high"] },
    delivery_kind: { type: "string", enum: ["document_draft", "structured_data", "code_template", "ai_decide"] },
    default_acceptance: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 256 }
    },
    icon: { type: "string" }
  },
  additionalProperties: false
} as const;
const questionCardResponseSchema = {
  type: "object",
  required: ["id", "title", "input_mode", "options", "free_text", "progress", "submit"],
  properties: {
    id: uuidStringSchema,
    session_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    title: { type: "string", minLength: 1 },
    body: { type: "string" },
    input_mode: { type: "string", enum: ["single_choice", "multi_choice", "rank", "confirm", "short_text", "long_text"] },
    options: {
      type: "array",
      items: questionOptionResponseSchema
    },
    recommended_option_ids: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    free_text: {
      type: "object",
      required: ["enabled", "collapsed_by_default"],
      properties: {
        enabled: { type: "boolean" },
        collapsed_by_default: { type: "boolean" },
        placeholder: { type: "string" },
        max_length: { type: "integer", minimum: 1 }
      },
      additionalProperties: false
    },
    progress: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "label", "state"],
        properties: {
          key: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          state: { type: "string", enum: ["done", "active", "pending"] }
        },
        additionalProperties: false
      }
    },
    evidence_refs: {
      type: "array",
      items: evidenceRefSchema
    },
    submit: {
      type: "object",
      required: ["method", "href"],
      properties: {
        method: { type: "string", enum: ["POST"] },
        href: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;
const sessionResponseSchema = {
  type: "object",
  required: ["session_id", "topic", "stream_href", "next_question_href", "question"],
  properties: {
    session_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    topic: { type: "string", minLength: 1 },
    stream_href: { type: "string", minLength: 1 },
    next_question_href: { type: "string", minLength: 1 },
    question: questionCardResponseSchema
  },
  additionalProperties: false
} as const;
const nextQuestionRequestBodySchema = {
  type: "object",
  properties: {
    selected_option_ids: {
      type: "array",
      maxItems: 10,
      items: { type: "string", minLength: 1 }
    },
    free_text: { type: "string", maxLength: 1000 }
  },
  additionalProperties: false
} as const;
const intakeMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Intake request body is malformed or not a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const intakeNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Intake action requires an authenticated user",
  ["not_identified"]
).responses["401"];
const intakeForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Intake target is not visible or mutable by the current user",
  ["invalid_client_token", "forbidden"]
).responses["403"];
const sessionCreateMissingResponse = jsonErrorStatusResponse(
  "404",
  "Clarification session work item or project was not found",
  ["not_found", "project_not_found"]
).responses["404"];
const sessionMissingResponse = jsonErrorStatusResponse(
  "404",
  "Clarification session was not found",
  ["not_found"]
).responses["404"];
const intakeValidationResponse = jsonErrorStatusResponse(
  "422",
  "Intake request does not match the API contract",
  ["validation_error"]
).responses["422"];
const clarificationAnalysisFailedResponse = jsonErrorStatusResponse(
  "502",
  "AI material analysis could not produce a grounded clarification question",
  [
    "clarification_file_context_failed",
    "clarification_llm_failed",
    "clarification_llm_empty_response",
    "clarification_llm_templated_response",
    "clarification_llm_invalid_response",
    "clarification_llm_missing_named_file"
  ]
).responses["502"];
const clarificationAnalysisUnavailableResponse = jsonErrorStatusResponse(
  "503",
  "AI material analysis is not configured",
  ["clarification_llm_unavailable"]
).responses["503"];
const createSessionResponse = {
  responses: {
    "200": jsonOkResponse(sessionResponseSchema).responses["200"],
    "400": intakeMalformedJsonResponse,
    "401": intakeNotIdentifiedResponse,
    "403": intakeForbiddenResponse,
    "404": sessionCreateMissingResponse,
    "422": intakeValidationResponse,
    "502": clarificationAnalysisFailedResponse,
    "503": clarificationAnalysisUnavailableResponse
  }
} as const;
const readSessionResponse = {
  responses: {
    "200": jsonOkResponse(sessionResponseSchema).responses["200"],
    "401": intakeNotIdentifiedResponse,
    "403": intakeForbiddenResponse,
    "404": sessionMissingResponse,
    "502": clarificationAnalysisFailedResponse,
    "503": clarificationAnalysisUnavailableResponse
  }
} as const;
const nextSessionQuestionResponse = {
  responses: {
    "200": jsonOkResponse(sessionResponseSchema).responses["200"],
    "400": intakeMalformedJsonResponse,
    "401": intakeNotIdentifiedResponse,
    "403": intakeForbiddenResponse,
    "404": sessionMissingResponse,
    "422": intakeValidationResponse,
    "502": clarificationAnalysisFailedResponse,
    "503": clarificationAnalysisUnavailableResponse
  }
} as const;
const workItemCreateMissingResponse = jsonErrorStatusResponse(
  "404",
  "Work item session or project was not found",
  ["not_found", "project_not_found"]
).responses["404"];
const workItemMissingResponse = jsonErrorStatusResponse(
  "404",
  "Work item was not found",
  ["not_found"]
).responses["404"];
const workItemStateConflictResponse = jsonErrorStatusResponse(
  "409",
  "Work item cannot be finalized from its current state",
  ["workitem_state_conflict"]
).responses["409"];
const createWorkItemRouteResponse = {
  responses: {
    "201": jsonOkStatusResponse(workItemDetailResponseSchema, "201", "Created work item detail page").responses["201"],
    "400": intakeMalformedJsonResponse,
    "401": intakeNotIdentifiedResponse,
    "403": intakeForbiddenResponse,
    "404": workItemCreateMissingResponse,
    "409": workItemStateConflictResponse,
    "422": intakeValidationResponse
  }
} as const;
const bindEvidenceResponse = {
  responses: {
    "200": jsonOkResponse(workItemDetailResponseSchema).responses["200"],
    "400": intakeMalformedJsonResponse,
    "401": intakeNotIdentifiedResponse,
    "403": intakeForbiddenResponse,
    "404": workItemMissingResponse,
    "422": intakeValidationResponse
  }
} as const;
const knowledgeSearchMissingResponse = jsonErrorStatusResponse(
  "404",
  "Knowledge search project or work item was not found",
  ["not_found", "project_not_found"]
).responses["404"];
const knowledgeSearchResponse = {
  responses: {
    "200": jsonOkResponse(evidenceBubbleResponseSchema).responses["200"],
    "400": intakeMalformedJsonResponse,
    "401": intakeNotIdentifiedResponse,
    "403": intakeForbiddenResponse,
    "404": knowledgeSearchMissingResponse,
    "422": intakeValidationResponse
  }
} as const;
const startAgentRunRequestBodySchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["worker", "pm"] },
    title: { type: "string", minLength: 1, maxLength: 256 }
  },
  additionalProperties: false
} as const;
const agentStepResponseSchema = {
  type: "object",
  required: ["id", "agent_run_id", "step_no", "phase", "input_json", "created_at"],
  properties: {
    id: uuidStringSchema,
    agent_run_id: uuidStringSchema,
    step_no: { type: "integer", minimum: 1 },
    phase: { type: "string", enum: ["think", "tool_call", "tool_result", "final"] },
    tool_name: { type: "string", maxLength: 64 },
    input_json: { type: "object", additionalProperties: true },
    output_excerpt: { type: "string" },
    control_signal: { type: "string", enum: ["continue", "stop", "compact", "escalate"] },
    snapshot_id: uuidStringSchema,
    created_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const structuredHandoffResponseSchema = {
  type: "object",
  required: ["done", "remaining", "next_steps", "blockers", "artifacts", "budget_hit"],
  properties: {
    done: { type: "array", items: { type: "string" } },
    remaining: { type: "array", items: { type: "string" } },
    next_steps: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } },
    artifacts: { type: "array", items: { type: "string" } },
    budget_hit: { type: "string", enum: ["steps", "timeout", "tokens", "cost", "doom_loop", "snapshot_gate", "unknown"] }
  },
  additionalProperties: false
} as const;
const agentRunResponseSchema = {
  type: "object",
  required: [
    "id",
    "work_item_id",
    "mode",
    "actor",
    "status",
    "model",
    "turns_used",
    "max_turns",
    "token_in",
    "token_out",
    "created_at",
    "updated_at"
  ],
  properties: {
    id: uuidStringSchema,
    parent_run_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    branch_id: uuidStringSchema,
    task_plan_id: uuidStringSchema,
    task_plan_item_id: uuidStringSchema,
    objective_id: uuidStringSchema,
    agent_role: { type: "string", enum: ["research", "produce", "review", "integrate"] },
    objective_md: { type: "string", minLength: 1 },
    mode: { type: "string", enum: ["worker", "pm"] },
    actor: { type: "string", minLength: 1, maxLength: 32 },
    status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "escalated", "cancelled"] },
    model: { type: "string", minLength: 1, maxLength: 128 },
    turns_used: { type: "integer", minimum: 0 },
    max_turns: { type: "integer", minimum: 1 },
    seconds: { type: "number", minimum: 0 },
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
    cost_estimate: { type: "string" },
    outcome_reason: { type: "string", maxLength: 256 },
    handoff_md: { type: "string" },
    started_at: dateTimeStringSchema,
    finished_at: dateTimeStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const agentRunBudgetResponseSchema = {
  type: "object",
  required: ["max_steps", "total_timeout_s", "max_tokens", "max_cost_cny"],
  properties: {
    max_steps: { type: "integer", minimum: 1 },
    total_timeout_s: { type: "integer", minimum: 1 },
    max_tokens: { type: "integer", minimum: 1 },
    max_cost_cny: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;
const agentRunBudgetDecisionResponseSchema = {
  type: "object",
  required: ["decision_id", "allowed", "model_route"],
  properties: {
    decision_id: { type: "string", minLength: 1 },
    allowed: { type: "boolean" },
    reason: { type: "string" },
    model_route: {
      type: "object",
      required: ["provider", "model", "reason"],
      properties: {
        provider: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    notice: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const agentRunUsageResponseSchema = {
  type: "object",
  required: ["steps_used", "token_in", "token_out", "estimated_cost_cny"],
  properties: {
    steps_used: { type: "integer", minimum: 0 },
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
    estimated_cost_cny: { type: "string" }
  },
  additionalProperties: false
} as const;
const agentRunLiveResponseSchema = {
  type: "object",
  required: [
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
  ],
  properties: {
    run: agentRunResponseSchema,
    run_id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "escalated", "cancelled"] },
    budget: agentRunBudgetResponseSchema,
    budget_decision: agentRunBudgetDecisionResponseSchema,
    usage: agentRunUsageResponseSchema,
    trace: { type: "array", items: agentStepResponseSchema },
    handoff: structuredHandoffResponseSchema,
    stream_href: { type: "string", minLength: 1 },
    replay_href: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;
const snapshotResponseSchema = {
  type: "object",
  required: ["id", "work_item_id", "kind", "ref", "created_by_kind", "created_at"],
  properties: {
    id: uuidStringSchema,
    work_item_id: uuidStringSchema,
    branch_id: uuidStringSchema,
    kind: { type: "string", enum: ["pre_step", "merge", "manual", "base"] },
    ref: { type: "string", minLength: 1, maxLength: 128 },
    content_sha256: { type: "string", minLength: 64, maxLength: 64 },
    created_by_kind: { type: "string", enum: ["ai", "human", "system"] },
    reverted_at: dateTimeStringSchema,
    created_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const replayTraceResponseSchema = {
  type: "object",
  required: ["run", "steps", "evidence_refs", "snapshots"],
  properties: {
    run: agentRunResponseSchema,
    steps: { type: "array", items: agentStepResponseSchema },
    evidence_refs: { type: "array", items: evidenceRefSchema },
    snapshots: { type: "array", items: snapshotResponseSchema },
    audit_logs: { type: "array", items: { type: "object", additionalProperties: true } },
    accepted_deliverables: { type: "array", items: acceptedDeliverableVmResponseSchema },
    merge_timeline: { type: "array", items: { type: "object", additionalProperties: true } },
    manifest_facts: { type: "object", additionalProperties: true },
    cost: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const agentRunMalformedJsonResponse = jsonErrorStatusResponse(
  "400",
  "Agent run request body is malformed or not a JSON object",
  ["malformed_json", "json_object_required"]
).responses["400"];
const agentRunBudgetExhaustedResponse = jsonErrorStatusResponse(
  "402",
  "Agent run cannot start because the AI budget is exhausted",
  ["budget_exhausted"]
).responses["402"];
const agentRunNotIdentifiedResponse = jsonErrorStatusResponse(
  "401",
  "Agent run action requires an authenticated user",
  ["not_identified"]
).responses["401"];
const agentRunForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Agent run target is not visible to the current user",
  ["invalid_client_token", "forbidden"]
).responses["403"];
const agentRunAbortForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Agent run cannot be aborted by the current user",
  ["invalid_client_token", "forbidden", "agent_run_abort_forbidden"]
).responses["403"];
const agentRunNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Agent run or work item was not found",
  ["not_found"]
).responses["404"];
const agentRunStartConflictResponse = jsonErrorStatusResponse(
  "409",
  "Agent run cannot start in the current work item state",
  ["agent_run_already_active", "agent_run_not_startable", "human_reserved"]
).responses["409"];
const agentRunAbortConflictResponse = jsonErrorStatusResponse(
  "409",
  "Agent run is already settled and cannot be aborted",
  ["agent_run_already_settled"]
).responses["409"];
const agentRunValidationResponse = jsonErrorStatusResponse(
  "422",
  "Agent run request does not match the API contract",
  ["validation_error"]
).responses["422"];
const agentRunKickoffUnavailableResponse = jsonErrorStatusResponse(
  "503",
  "Agent run kickoff status transition failed",
  ["http_error", "budget_decision_persist_failed", "budget_reservation_failed"]
).responses["503"];
const startAgentRunResponse = {
  responses: {
    "202": jsonDataStatusResponse(agentRunLiveResponseSchema, "202", "Accepted AI worker run").responses["202"],
    "400": agentRunMalformedJsonResponse,
    "401": agentRunNotIdentifiedResponse,
    "402": agentRunBudgetExhaustedResponse,
    "403": agentRunForbiddenResponse,
    "404": agentRunNotFoundResponse,
    "409": agentRunStartConflictResponse,
    "422": agentRunValidationResponse,
    "503": agentRunKickoffUnavailableResponse
  }
} as const;
const readAgentRunResponse = {
  responses: {
    "200": jsonDataResponse(agentRunLiveResponseSchema, "Live AI worker run").responses["200"],
    "401": agentRunNotIdentifiedResponse,
    "403": agentRunForbiddenResponse,
    "404": agentRunNotFoundResponse
  }
} as const;
const agentRunTraceResponse = {
  responses: {
    "200": jsonDataResponse({ type: "array", items: agentStepResponseSchema }, "Live AI worker trace steps").responses["200"],
    "401": agentRunNotIdentifiedResponse,
    "403": agentRunForbiddenResponse,
    "404": agentRunNotFoundResponse,
    "422": agentRunValidationResponse
  }
} as const;
const abortAgentRunResponse = {
  responses: {
    "200": jsonDataResponse(agentRunLiveResponseSchema, "Cancelled AI worker run").responses["200"],
    "401": agentRunNotIdentifiedResponse,
    "403": agentRunAbortForbiddenResponse,
    "404": agentRunNotFoundResponse,
    "409": agentRunAbortConflictResponse
  }
} as const;
const replayAgentRunResponse = {
  responses: {
    "200": jsonOkResponse(replayTraceResponseSchema).responses["200"],
    "401": agentRunNotIdentifiedResponse,
    "403": agentRunForbiddenResponse,
    "404": agentRunNotFoundResponse
  }
} as const;
const workItemAuditTimelineResponseSchema = {
  type: "object",
  required: ["work_item_id", "snapshots", "audit_logs", "manifest_facts"],
  properties: {
    work_item_id: uuidStringSchema,
    snapshots: { type: "array", items: snapshotResponseSchema },
    audit_logs: { type: "array", items: { type: "object", additionalProperties: true } },
    manifest_facts: { type: "object", additionalProperties: true }
  },
  additionalProperties: false
} as const;
const workItemAuditTimelineResponse = {
  responses: {
    "200": jsonDataResponse(workItemAuditTimelineResponseSchema, "Work item audit facts and snapshots").responses["200"],
    "403": jsonErrorStatusResponse("403", "Work item audit is not readable by the current user", [
      "forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Work item audit target was not found", [
      "not_found"
    ]).responses["404"]
  }
} as const;
const pilotDay1MetricResponseSchema = {
  type: "object",
  required: ["id", "label_zh", "label_en", "value", "numerator", "denominator", "status", "source_tables"],
  properties: {
    id: {
      type: "string",
      enum: [
        "closed_loop_count",
        "proposal_adoption_rate",
        "escalation_count",
        "cost_per_merged_item_cny",
        "conflict_count",
        "notification_density"
      ]
    },
    label_zh: { type: "string", minLength: 1 },
    label_en: { type: "string", minLength: 1 },
    value: { type: "string", minLength: 1 },
    unit: { type: "string", minLength: 1 },
    numerator: { type: "number" },
    denominator: { anyOf: [{ type: "number" }, { type: "null" }] },
    status: { type: "string", enum: ["pass", "watch", "sample_insufficient"] },
    source_tables: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }
  },
  additionalProperties: false
} as const;
const pilotDay1MetricsResponseSchema = {
  type: "object",
  required: ["generated_at", "range", "metrics", "raw_counts", "cost", "gates", "notes"],
  properties: {
    generated_at: dateTimeStringSchema,
    range: {
      type: "object",
      required: ["from", "to"],
      properties: {
        from: dateTimeStringSchema,
        to: dateTimeStringSchema
      },
      additionalProperties: false
    },
    metrics: { type: "array", items: pilotDay1MetricResponseSchema },
    raw_counts: {
      type: "object",
      required: [
        "work_items_created",
        "closed_loop_work_items",
        "proposals_opened",
        "proposals_reviewed",
        "proposals_merged",
        "proposals_rejected",
        "escalation_events",
        "approval_requests",
        "merge_conflict_attempts",
        "merge_conflict_instances",
        "notifications_created",
        "active_user_count",
        "submitter_count"
      ],
      properties: {
        work_items_created: { type: "integer", minimum: 0 },
        closed_loop_work_items: { type: "integer", minimum: 0 },
        proposals_opened: { type: "integer", minimum: 0 },
        proposals_reviewed: { type: "integer", minimum: 0 },
        proposals_merged: { type: "integer", minimum: 0 },
        proposals_rejected: { type: "integer", minimum: 0 },
        escalation_events: { type: "integer", minimum: 0 },
        approval_requests: { type: "integer", minimum: 0 },
        merge_conflict_attempts: { type: "integer", minimum: 0 },
        merge_conflict_instances: { type: "integer", minimum: 0 },
        notifications_created: { type: "integer", minimum: 0 },
        active_user_count: { type: "integer", minimum: 0 },
        submitter_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    cost: {
      type: "object",
      required: ["total_cost_cny", "token_in", "token_out", "unique_usage_records"],
      properties: {
        total_cost_cny: { type: "string" },
        token_in: { type: "integer", minimum: 0 },
        token_out: { type: "integer", minimum: 0 },
        unique_usage_records: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    gates: {
      type: "object",
      required: [
        "feedback_log_ready",
        "metrics_ready",
        "second_user_path_observed",
        "cost_nonzero",
        "conflict_counter_ready",
        "notification_density_ready"
      ],
      properties: {
        feedback_log_ready: { type: "boolean" },
        metrics_ready: { type: "boolean" },
        second_user_path_observed: { type: "boolean" },
        cost_nonzero: { type: "boolean" },
        conflict_counter_ready: { type: "boolean" },
        notification_density_ready: { type: "boolean" }
      },
      additionalProperties: false
    },
    notes: { type: "array", items: { type: "string", minLength: 1 } }
  },
  additionalProperties: false
} as const;
const pilotDay1MetricsResponses = {
  responses: {
    "200": jsonDataResponse(pilotDay1MetricsResponseSchema, "Day 1 pilot metrics snapshot").responses["200"],
    "403": jsonErrorStatusResponse("403", "Day 1 pilot metrics require an admin user", [
      "admin_required"
    ]).responses["403"],
    "422": jsonErrorStatusResponse("422", "Day 1 pilot metric query range is not valid", [
      "validation_error",
      "invalid_range"
    ]).responses["422"]
  }
} as const;
// R20 R19-29：GET /api/ai-worklog/today 已删（曾靠 aiWorklogResponseSchema/aiWorklogTodayResponses 撑门面）
// ——见 paths 里的说明,核实零消费后随路由一并删掉。
const revertAgentRunRequestBodySchema = {
  type: "object",
  required: ["snapshot_id"],
  properties: {
    snapshot_id: uuidStringSchema,
    reason_md: { type: "string", minLength: 1, maxLength: 2000 }
  },
  additionalProperties: false
} as const;
const agentRunRevertResultResponseSchema = {
  type: "object",
  required: ["status", "snapshot"],
  properties: {
    status: { type: "string", enum: ["reverted"] },
    snapshot: snapshotResponseSchema
  },
  additionalProperties: false
} as const;
const agentRunRevertResponse = {
  responses: {
    "200": jsonDataResponse(agentRunRevertResultResponseSchema, "Restored agent run snapshot").responses["200"],
    "403": jsonErrorStatusResponse("403", "Snapshot restore requires a valid local client and mutation access", [
      "invalid_client_token",
      "forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Agent run or snapshot was not found", [
      "not_found"
    ]).responses["404"],
    "409": jsonErrorStatusResponse("409", "Snapshot restore cannot be completed in the current workdir state", [
      "conflict"
    ]).responses["409"],
    "422": jsonErrorStatusResponse("422", "Snapshot restore request is not valid", [
      "validation_error"
    ]).responses["422"]
  }
} as const;

const conversationSafeSequenceSchema = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER
} as const;
const conversationNullableUuidSchema = {
  anyOf: [uuidStringSchema, { type: "null" }]
} as const;
const conversationParticipantRoleSchema = {
  type: "string",
  enum: ["owner", "member"]
} as const;
const conversationNullableParticipantRoleSchema = {
  anyOf: [conversationParticipantRoleSchema, { type: "null" }]
} as const;
const conversationResponseSchema = {
  type: "object",
  required: [
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
  ],
  properties: {
    id: uuidStringSchema,
    workspace_id: uuidStringSchema,
    project_id: uuidStringSchema,
    kind: { type: "string", enum: ["main", "collab"] },
    title: { type: "string", minLength: 1, maxLength: 256 },
    parent_conversation_id: conversationNullableUuidSchema,
    source_message_id: conversationNullableUuidSchema,
    visibility: { type: "string", enum: ["project", "private"] },
    cuu_enabled: { type: "boolean" },
    // R15 批 B（人对人私聊）：additive optional——只在 DM 会话上出现且恒为 true，普通会话不带这个键。
    is_dm: { type: "boolean", description: "Present and true only for direct-message conversations." },
    // R15 批 A（A4 未读聚合）：additive optional——viewer 在这条会话里的未读消息数（会话列表 VM 一次聚合算齐）。
    unread_count: { type: "integer", minimum: 0, description: "Viewer's unread message count in this conversation; present only on conversation-list VMs." },
    next_seq: conversationSafeSequenceSchema,
    created_by: conversationNullableUuidSchema,
    participant_role: conversationNullableParticipantRoleSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const conversationParticipantResponseSchema = {
  type: "object",
  required: ["id", "conversation_id", "user_id", "role", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    conversation_id: uuidStringSchema,
    user_id: uuidStringSchema,
    role: conversationParticipantRoleSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const conversationTextContentResponseSchema = {
  type: "object",
  required: ["text"],
  properties: {
    // R14 批 CHAT：墓碑消息归一为 {text:""}，响应侧允许空串（创建请求侧仍 min 1）。
    text: { type: "string", minLength: 0, maxLength: 20_000 },
    memory_citations: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["kind", "title"],
        properties: {
          kind: { type: "string", enum: ["user_memory", "team_skill"] },
          title: { type: "string", minLength: 1, maxLength: 256 }
        },
        additionalProperties: false
      }
    },
    is_clarifying_question: { type: "boolean" },
    clarify_options: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 200 }
    },
    clarify_placeholder: { type: "string", minLength: 1, maxLength: 200 },
    // R16-W1（工作台聊天流升级）：Cuu 回应展示元信息，additive optional（服务端 turn 结算时写入）。
    model: { type: "string", minLength: 1, maxLength: 128 },
    usage_tokens: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
    elapsed_ms: { type: "integer", minimum: 0, maximum: 86_400_000 }
  },
  additionalProperties: false
} as const;
const conversationFileCardContentResponseSchema = {
  type: "object",
  required: ["drive_item_id", "snapshot_name"],
  properties: {
    drive_item_id: uuidStringSchema,
    snapshot_name: { type: "string", minLength: 1, maxLength: 256 }
  },
  additionalProperties: false
} as const;
const conversationGenericContentResponseSchema = {
  type: "object",
  maxProperties: 64,
  additionalProperties: true
} as const;
function conversationMessageResponseVariant(
  kind: "text" | "file_card" | "action_card" | "system_event" | "tool_note",
  content: Record<string, unknown>
) {
  return {
    type: "object",
    required: [
      "id",
      "conversation_id",
      "seq",
      "sender_type",
      "sender_user_id",
      "kind",
      "content",
      "thread_root_id",
      "created_at"
    ],
    properties: {
      id: uuidStringSchema,
      conversation_id: uuidStringSchema,
      seq: conversationSafeSequenceSchema,
      sender_type: { type: "string", enum: ["user", "cuu", "system"] },
      sender_user_id: conversationNullableUuidSchema,
      kind: { type: "string", const: kind },
      content,
      thread_root_id: conversationNullableUuidSchema,
      created_at: dateTimeStringSchema,
      // R14 批 CHAT：五个 additive optional 字段（只进 properties 不进 required，旧客户端不受影响）。
      edited_at: dateTimeStringSchema,
      deleted_at: dateTimeStringSchema,
      pinned: {
        type: "object",
        required: ["at", "by_user_id"],
        properties: {
          at: dateTimeStringSchema,
          by_user_id: conversationNullableUuidSchema
        },
        additionalProperties: false
      },
      reply_to: {
        type: "object",
        required: ["message_id", "sender_type", "sender_user_id", "preview_text", "deleted"],
        properties: {
          message_id: uuidStringSchema,
          sender_type: { type: "string", enum: ["user", "cuu", "system"] },
          sender_user_id: conversationNullableUuidSchema,
          preview_text: { type: "string", maxLength: 80 },
          deleted: { type: "boolean" }
        },
        additionalProperties: false
      },
      reactions: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          required: ["key", "user_ids"],
          properties: {
            key: { type: "string", enum: ["approve", "disagree", "done", "question", "watch"] },
            user_ids: { type: "array", items: uuidStringSchema }
          },
          additionalProperties: false
        }
      },
      // R14 批 FEEDBACK：本人对这条消息的二值反馈（自见性，additive optional）。
      my_feedback: {
        type: "object",
        required: ["verdict", "updated_at"],
        properties: {
          verdict: { type: "string", enum: ["useful", "not_useful"] },
          note: { type: "string", maxLength: 200 },
          updated_at: dateTimeStringSchema
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  };
}
const conversationMessageResponseSchema = {
  oneOf: [
    conversationMessageResponseVariant("text", conversationTextContentResponseSchema),
    conversationMessageResponseVariant("file_card", conversationFileCardContentResponseSchema),
    conversationMessageResponseVariant("action_card", conversationGenericContentResponseSchema),
    conversationMessageResponseVariant("system_event", conversationGenericContentResponseSchema),
    conversationMessageResponseVariant("tool_note", conversationGenericContentResponseSchema)
  ]
} as const;
const conversationCursorResponseSchema = {
  type: "object",
  required: ["afterCreatedAt", "afterId"],
  properties: {
    afterCreatedAt: {
      type: "string",
      format: "date-time",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$"
    },
    afterId: uuidStringSchema
  },
  additionalProperties: false
} as const;
const conversationListPageResponseSchema = {
  type: "object",
  required: ["conversations", "capped", "next_cursor"],
  properties: {
    conversations: { type: "array", maxItems: 100, items: conversationResponseSchema },
    capped: { type: "boolean" },
    next_cursor: { anyOf: [conversationCursorResponseSchema, { type: "null" }] }
  },
  additionalProperties: false
} as const;
const workbenchMembershipRoleResponseSchema = {
  type: "string",
  enum: ["member", "admin", "owner"]
} as const;
const workbenchPageResponseSchema = {
  type: "object",
  required: [
    "generated_at",
    "project",
    "viewer",
    "conversations",
    "workspace_members",
    "army_summary",
    "recent_project_files"
  ],
  properties: {
    generated_at: dateTimeStringSchema,
    project: {
      type: "object",
      required: ["id", "workspace_id", "name", "slug", "description", "owner_label"],
      properties: {
        id: uuidStringSchema,
        workspace_id: uuidStringSchema,
        name: { type: "string", minLength: 1 },
        slug: { type: "string", minLength: 1 },
        description: { anyOf: [{ type: "string" }, { type: "null" }] },
        owner_label: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    viewer: {
      type: "object",
      required: ["user_id", "membership_role", "is_project_owner"],
      properties: {
        user_id: uuidStringSchema,
        membership_role: workbenchMembershipRoleResponseSchema,
        is_project_owner: { type: "boolean" }
      },
      additionalProperties: false
    },
    conversations: {
      type: "object",
      required: ["conversations", "capped", "next_cursor"],
      properties: {
        conversations: { type: "array", maxItems: 50, items: conversationResponseSchema },
        capped: { type: "boolean" },
        next_cursor: { anyOf: [conversationCursorResponseSchema, { type: "null" }] }
      },
      additionalProperties: false
    },
    workspace_members: {
      type: "object",
      required: ["scope", "total", "returned", "capped", "items"],
      properties: {
        scope: { type: "string", enum: ["workspace"] },
        total: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        returned: { type: "integer", minimum: 0, maximum: 100 },
        capped: { type: "boolean" },
        items: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            required: ["user_id", "nickname", "membership_role", "is_project_owner", "is_self"],
            properties: {
              user_id: uuidStringSchema,
              nickname: { type: "string", minLength: 1 },
              membership_role: workbenchMembershipRoleResponseSchema,
              is_project_owner: { type: "boolean" },
              is_self: { type: "boolean" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    army_summary: {
      type: "object",
      required: ["active_plan_count"],
      properties: {
        active_plan_count: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        empty_state: { type: "string", enum: ["no_active_armies"] }
      },
      additionalProperties: false
    },
    recent_project_files: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            required: ["id", "name", "updated_at", "href"],
            properties: {
              id: uuidStringSchema,
              name: { type: "string", minLength: 1 },
              updated_at: dateTimeStringSchema,
              href: { type: "string", minLength: 1 }
            },
            additionalProperties: false
          }
        },
        empty_state: { type: "string", enum: ["no_recent_files"] }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;
const workbenchPageResponses = {
  responses: {
    "200": jsonOkResponse(workbenchPageResponseSchema).responses["200"],
    "401": pageNotIdentifiedResponse,
    "403": pageInvalidClientTokenResponse,
    "404": jsonErrorStatusResponse("404", "Workbench project is inaccessible or was not found", [
      "workbench_not_found"
    ]).responses["404"],
    "500": jsonErrorStatusResponse("500", "Workbench assembly or a source dependency failed", [
      "internal_contract_error",
      "internal_error"
    ]).responses["500"]
  }
} as const;
const conversationMessagePageResponseSchema = {
  type: "object",
  required: ["messages", "has_more", "next_after_seq"],
  properties: {
    messages: { type: "array", maxItems: 100, items: conversationMessageResponseSchema },
    has_more: { type: "boolean" },
    next_after_seq: conversationSafeSequenceSchema,
    // R12 批8：仅在响应 beforeSeq（反向翻页）请求时出现；afterSeq 请求的响应形状零改动。
    next_before_seq: conversationSafeSequenceSchema
  },
  additionalProperties: false
} as const;
const createConversationResponseSchema = {
  type: "object",
  required: ["conversation", "participants"],
  properties: {
    conversation: conversationResponseSchema,
    participants: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: conversationParticipantResponseSchema
    }
  },
  additionalProperties: false
} as const;
const createConversationRequestBodySchema = {
  type: "object",
  required: ["kind", "title", "visibility"],
  properties: {
    cuu_enabled: { type: "boolean", default: true, description: "Small groups: whether Cuu participates; false = hard mute." },
    kind: { type: "string", const: "collab" },
    title: { type: "string", minLength: 1, maxLength: 256 },
    visibility: { type: "string", enum: ["project", "private"] },
    parent_conversation_id: uuidStringSchema,
    source_message_id: uuidStringSchema,
    participant_user_ids: {
      type: "array",
      maxItems: 99,
      uniqueItems: true,
      description: "Active workspace user UUIDs; uniqueness is enforced case-insensitively.",
      "x-workhub-case-insensitive-unique": true,
      items: uuidStringSchema,
      default: []
    }
  },
  dependentRequired: {
    source_message_id: ["parent_conversation_id"]
  },
  additionalProperties: false
} as const;
// R14 批 CHAT：请求侧 text content 保持 min 1（空串只属于响应侧墓碑归一，不允许发空消息）。
const conversationTextContentRequestSchema = {
  ...conversationTextContentResponseSchema,
  properties: {
    ...conversationTextContentResponseSchema.properties,
    text: { type: "string", minLength: 1, maxLength: 20_000 }
  }
} as const;
const createConversationMessageRequestBodySchema = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "content"],
      properties: {
        kind: { type: "string", const: "text" },
        content: conversationTextContentRequestSchema,
        thread_root_id: uuidStringSchema,
        // R14 批 CHAT：引用回复（additive，仅 text 变体）。
        reply_to_message_id: uuidStringSchema
      },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["kind", "content"],
      properties: {
        kind: { type: "string", const: "file_card" },
        content: {
          type: "object",
          required: ["drive_item_id"],
          properties: { drive_item_id: uuidStringSchema },
          additionalProperties: false
        },
        thread_root_id: uuidStringSchema
      },
      additionalProperties: false
    }
  ]
} as const;
const conversationAfterCreatedAtQueryParameter = {
  name: "afterCreatedAt",
  in: "query",
  required: false,
  description: "Canonical UTC microsecond cursor timestamp; afterCreatedAt and afterId must be provided together.",
  "x-workhub-paired-with": "afterId",
  schema: {
    type: "string",
    format: "date-time",
    pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$"
  }
} as const;
const conversationAfterIdQueryParameter = {
  name: "afterId",
  in: "query",
  required: false,
  description: "Conversation UUID cursor tie-breaker; afterCreatedAt and afterId must be provided together.",
  "x-workhub-paired-with": "afterCreatedAt",
  schema: uuidStringSchema
} as const;
const conversationAfterSeqQueryParameter = {
  name: "afterSeq",
  in: "query",
  required: false,
  description: "Forward cursor; mutually exclusive with beforeSeq.",
  "x-workhub-mutually-exclusive-with": "beforeSeq",
  schema: conversationSafeSequenceSchema
} as const;
// R12 批8：反向翻页游标——「滚到顶加载更早」。与 afterSeq 互斥（契约层用 zod union 天然表达，见
// packages/contracts/src/domain/conversation.ts 的 conversationMessageListQuerySchema）。
const conversationBeforeSeqQueryParameter = {
  name: "beforeSeq",
  in: "query",
  required: false,
  description: "Backward cursor for loading earlier history; mutually exclusive with afterSeq.",
  "x-workhub-mutually-exclusive-with": "afterSeq",
  schema: conversationSafeSequenceSchema
} as const;
const conversationLimitQueryParameter = {
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
} as const;
const conversationAuthRequiredResponse = jsonErrorStatusResponse(
  "401",
  "Conversation access requires an authenticated user",
  ["not_identified"]
).responses["401"];
const conversationForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Conversation access failed the client-token, CSRF, or human-workspace guard",
  ["invalid_client_token", "forbidden", "human_required"]
).responses["403"];
const conversationValidationResponse = jsonErrorStatusResponse(
  "422",
  "Conversation query or request payload does not match the contract",
  ["validation_error"]
).responses["422"];
const conversationInternalResponse = jsonErrorStatusResponse(
  "500",
  "Conversation output assembly or an unexpected dependency failed",
  ["internal_contract_error", "internal_error"]
).responses["500"];
const conversationPayloadTooLargeResponse = jsonErrorStatusResponse(
  "413",
  "Conversation request body exceeds the configured global JSON limit",
  ["payload_too_large"]
).responses["413"];
const conversationProjectListResponses = {
  responses: {
    "200": jsonDataResponse(conversationListPageResponseSchema, "Visible project conversations").responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Project conversation area was not found", [
      "conversation_project_not_found"
    ]).responses["404"],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationProjectCreateResponses = {
  responses: {
    "201": jsonDataStatusResponse(createConversationResponseSchema, "201", "Created a collaboration conversation")
      .responses["201"],
    "400": jsonErrorStatusResponse("400", "Conversation creation input is semantically invalid", [
      "malformed_json",
      "json_object_required",
      "conversation_invalid_input",
      "conversation_participant_invalid",
      "conversation_parent_invalid",
      "conversation_source_invalid"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Project conversation area disappeared or is inaccessible", [
      "conversation_project_not_found",
      "conversation_not_found"
    ]).responses["404"],
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationMessageListResponses = {
  responses: {
    "200": jsonDataResponse(
      conversationMessagePageResponseSchema,
      "Conversation messages after (afterSeq) or before (beforeSeq) the sequence cursor"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses["404"],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationMessageCreateResponses = {
  responses: {
    "201": jsonDataStatusResponse(conversationMessageResponseSchema, "201", "Created a conversation message")
      .responses["201"],
    "400": jsonErrorStatusResponse("400", "Message input is malformed or semantically invalid", [
      "malformed_json",
      "json_object_required",
      "conversation_invalid_input",
      "conversation_thread_invalid",
      "conversation_reply_target_invalid"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation or referenced Drive file was not found", [
      "conversation_not_found",
      "conversation_file_not_found"
    ]).responses["404"],
    "409": jsonErrorStatusResponse("409", "Conversation message sequence is exhausted", [
      "conversation_sequence_exhausted"
    ]).responses["409"],
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;

// R15 批 B（人对人私聊）：POST /api/dm/open 的请求体与响应集——与 routes/dm.ts + services/conversations.ts
// 的 openDm 真实状态码逐条对齐（自聊 400、目标不在工作区 404）。
const openDmRequestBodySchema = {
  type: "object",
  required: ["user_id"],
  properties: { user_id: uuidStringSchema },
  additionalProperties: false
} as const;
const openDmResultResponseSchema = {
  type: "object",
  required: ["conversation"],
  properties: { conversation: conversationResponseSchema },
  additionalProperties: false
} as const;
const dmOpenResponses = {
  responses: {
    "201": jsonDataStatusResponse(
      openDmResultResponseSchema,
      "201",
      "Opened or reused the direct-message conversation with the target user"
    ).responses["201"],
    "400": jsonErrorStatusResponse("400", "Direct-message target is malformed or is the caller themselves", [
      "malformed_json",
      "json_object_required",
      "conversation_dm_target_required",
      "conversation_dm_self",
      "conversation_invalid_input"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Direct-message target is not an active member of this workspace", [
      "conversation_dm_target_not_found"
    ]).responses["404"],
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;

// R15 批 B（人对人私聊）：GET /api/dm/list 的响应集——actor 参与的 DM 列表（参与者门控），每条 = 会话 VM
// + 恰好 2 名参与者（含对方昵称/is_self），与 services/conversations.ts 的 listDms 逐字段对齐。
const dmListResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            maxItems: 200,
            items: {
              type: "object",
              required: ["conversation", "participants"],
              properties: {
                conversation: conversationResponseSchema,
                participants: {
                  type: "array",
                  minItems: 2,
                  maxItems: 2,
                  items: {
                    type: "object",
                    required: ["user_id", "nickname", "is_self"],
                    properties: {
                      user_id: uuidStringSchema,
                      nickname: { type: "string", minLength: 1 },
                      is_self: { type: "boolean" }
                    },
                    additionalProperties: false
                  }
                }
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      },
      "Direct-message conversations the caller participates in"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "500": conversationInternalResponse
  }
} as const;

// R14 批 CHAT：消息动作（编辑/删除/reaction/置顶）、已读游标与 presence 的手写 schema——
// 与 routes/conversation-message-actions.ts / conversation-read.ts / presence.ts 的真实状态码逐条对齐。
const conversationReactionKeyPathParameter = {
  name: "key",
  in: "path",
  required: true,
  schema: { type: "string", enum: ["approve", "disagree", "done", "question", "watch"] }
} as const;
const editConversationMessageRequestBodySchema = {
  type: "object",
  required: ["text"],
  properties: { text: { type: "string", minLength: 1, maxLength: 20_000 } },
  additionalProperties: false
} as const;
const advanceReadCursorRequestBodySchema = {
  type: "object",
  required: ["last_read_seq"],
  properties: { last_read_seq: conversationSafeSequenceSchema },
  additionalProperties: false
} as const;
const conversationMessageLookupNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Conversation or message was not found",
  ["conversation_not_found", "conversation_message_not_found"]
).responses["404"];
const conversationMessageOwnershipForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Conversation guard failed, or the message belongs to someone else",
  ["invalid_client_token", "forbidden", "human_required", "conversation_message_forbidden"]
).responses["403"];
const conversationNoContentResponse = { description: "Acknowledged with no body" } as const;
// R14 批 FEEDBACK：二值反馈请求体与响应集（三主体共用）。
const putAiFeedbackRequestBodySchema = {
  type: "object",
  required: ["verdict"],
  properties: {
    verdict: { type: "string", enum: ["useful", "not_useful"] },
    note: { type: "string", maxLength: 200 }
  },
  additionalProperties: false
} as const;
const aiFeedbackForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "Feedback requires a signed-in human with access to the subject",
  ["invalid_client_token", "forbidden", "human_required", "ai_feedback_forbidden", "ai_feedback_human_required"]
).responses["403"];
function aiFeedbackPutResponses(notFoundDescription: string, notFoundCodes: string[]) {
  return {
    responses: {
      "204": conversationNoContentResponse,
      "400": jsonErrorStatusResponse("400", "Feedback payload failed validation", [
        "malformed_json",
        "json_object_required",
        "ai_feedback_note_rejected"
      ]).responses["400"],
      "401": conversationAuthRequiredResponse,
      "403": aiFeedbackForbiddenResponse,
      "404": jsonErrorStatusResponse("404", notFoundDescription, notFoundCodes).responses["404"],
      "413": conversationPayloadTooLargeResponse,
      "422": conversationValidationResponse,
      "500": conversationInternalResponse
    }
  } as const;
}
function aiFeedbackDeleteResponses(notFoundDescription: string, notFoundCodes: string[]) {
  return {
    responses: {
      "204": conversationNoContentResponse,
      "401": conversationAuthRequiredResponse,
      "403": aiFeedbackForbiddenResponse,
      "404": jsonErrorStatusResponse("404", notFoundDescription, notFoundCodes).responses["404"],
      "422": conversationValidationResponse,
      "500": conversationInternalResponse
    }
  } as const;
}
const conversationMessageEditResponses = {
  responses: {
    "200": jsonDataResponse(conversationMessageResponseSchema, "Edited message VM").responses["200"],
    "400": jsonErrorStatusResponse("400", "Edit payload is malformed", [
      "malformed_json",
      "json_object_required"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationMessageOwnershipForbiddenResponse,
    "404": conversationMessageLookupNotFoundResponse,
    "409": jsonErrorStatusResponse("409", "Message cannot be edited", [
      "conversation_message_not_editable",
      "conversation_message_edit_window_closed",
      "conversation_message_deleted"
    ]).responses["409"],
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationMessageDeleteResponses = {
  responses: {
    "200": jsonDataResponse(conversationMessageResponseSchema, "Tombstoned message VM (idempotent)").responses[
      "200"
    ],
    "401": conversationAuthRequiredResponse,
    "403": conversationMessageOwnershipForbiddenResponse,
    "404": conversationMessageLookupNotFoundResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationReactionInvalidKeyResponse = jsonErrorStatusResponse("400", "Unknown reaction key", [
  "conversation_reaction_invalid_key"
]).responses["400"];
const conversationReactionAddResponses = {
  responses: {
    "204": conversationNoContentResponse,
    "400": conversationReactionInvalidKeyResponse,
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": conversationMessageLookupNotFoundResponse,
    "409": jsonErrorStatusResponse("409", "Message was deleted", ["conversation_message_deleted"]).responses[
      "409"
    ],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationReactionRemoveResponses = {
  responses: {
    "204": conversationNoContentResponse,
    "400": conversationReactionInvalidKeyResponse,
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": conversationMessageLookupNotFoundResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationPinAddResponses = {
  responses: {
    "204": conversationNoContentResponse,
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": conversationMessageLookupNotFoundResponse,
    "409": jsonErrorStatusResponse("409", "Message was deleted", ["conversation_message_deleted"]).responses[
      "409"
    ],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationPinRemoveResponses = {
  responses: {
    "204": conversationNoContentResponse,
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": conversationMessageLookupNotFoundResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationPinListResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["messages"],
        properties: {
          messages: { type: "array", maxItems: 50, items: conversationMessageResponseSchema }
        },
        additionalProperties: false
      },
      "Pinned messages, newest sequence first"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses[
      "404"
    ],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationReadAdvanceResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["last_read_seq"],
        properties: { last_read_seq: conversationSafeSequenceSchema },
        additionalProperties: false
      },
      "Read cursor after the monotonic clamp"
    ).responses["200"],
    "400": jsonErrorStatusResponse("400", "Read cursor payload is malformed", [
      "malformed_json",
      "json_object_required"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses[
      "404"
    ],
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const conversationReceiptsResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["receipts"],
        properties: {
          receipts: {
            type: "array",
            maxItems: 500,
            items: {
              type: "object",
              required: ["user_id", "last_read_seq"],
              properties: {
                user_id: uuidStringSchema,
                last_read_seq: conversationSafeSequenceSchema
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      },
      "All read cursors for the conversation"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses[
      "404"
    ],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;

// R15 批 cuu-toggle：PATCH /api/conversations/:id/cuu 的请求体与响应集——与 routes/conversation-cuu.ts +
// services/conversations.ts 的 updateCuuEnabled 真实状态码逐条对齐（main 一律 409、非参与者 403）。
const updateConversationCuuRequestBodySchema = {
  type: "object",
  required: ["enabled"],
  properties: { enabled: { type: "boolean" } },
  additionalProperties: false
} as const;
const conversationCuuUpdateResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["conversation"],
        properties: { conversation: conversationResponseSchema },
        additionalProperties: false
      },
      "The conversation VM after the Cuu-participation toggle was flipped"
    ).responses["200"],
    "400": jsonErrorStatusResponse("400", "Cuu toggle payload is malformed", [
      "malformed_json",
      "json_object_required"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Only collab (including DM) participants may toggle Cuu participation", [
      "invalid_client_token",
      "forbidden",
      "human_required",
      "conversation_cuu_forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses[
      "404"
    ],
    "409": jsonErrorStatusResponse("409", "The main area does not support toggling Cuu participation", [
      "conversation_cuu_not_collab"
    ]).responses["409"],
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;

// R15 批 cuu-toggle：GET /api/conversations/:id/participants 的响应集——main 诚实回
// scope:"workspace" + 空列表，collab（含 DM）回 scope:"participants" + 真实参与者。参与者门控与消息
// 可见性同口径（非参与者的 collab 已经 404，与其它会话读端点一致）。
const conversationParticipantListItemResponseSchema = {
  type: "object",
  required: ["user_id", "nickname", "role"],
  properties: {
    user_id: uuidStringSchema,
    nickname: { type: "string", minLength: 1 },
    role: conversationParticipantRoleSchema
  },
  additionalProperties: false
} as const;
const conversationParticipantsResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["scope", "participants"],
        properties: {
          scope: { type: "string", enum: ["workspace", "participants"] },
          participants: {
            type: "array",
            maxItems: 100,
            items: conversationParticipantListItemResponseSchema
          }
        },
        additionalProperties: false
      },
      "Conversation participants (main: scope=workspace with an empty list; collab/DM: scope=participants with real rows)"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses[
      "404"
    ],
    "500": conversationInternalResponse
  }
} as const;

// R17 批 G1（群成员管理）：POST /participants（加人）与 DELETE /participants/:userId（退群/移出）。
const addConversationParticipantRequestBodySchema = {
  type: "object",
  required: ["user_id"],
  properties: { user_id: uuidStringSchema },
  additionalProperties: false
} as const;
const addConversationParticipantResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["added", "participants"],
        properties: {
          added: { type: "boolean" },
          participants: {
            type: "object",
            required: ["scope", "participants"],
            properties: {
              scope: { type: "string", enum: ["workspace", "participants"] },
              participants: { type: "array", maxItems: 100, items: conversationParticipantListItemResponseSchema }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      },
      "Refreshed participant list after adding a member (added=false when already present)"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses[
      "404"
    ],
    "409": jsonErrorStatusResponse("409", "Only non-dm collab conversations accept new participants", [
      "conversation_not_group",
      "conversation_dm_no_add",
      "conversation_participant_cap"
    ]).responses["409"],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const removeConversationParticipantResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["removed_user_id", "self_left", "new_owner_user_id"],
        properties: {
          removed_user_id: uuidStringSchema,
          self_left: { type: "boolean" },
          new_owner_user_id: { ...uuidStringSchema, nullable: true }
        },
        additionalProperties: false
      },
      "Result of leaving/removing a member (new_owner_user_id set when the owner left and a successor was promoted)"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Only the owner may remove other members", [
      "conversation_remove_forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Conversation or participant was not found", [
      "conversation_not_found",
      "conversation_participant_not_found"
    ]).responses["404"],
    "409": jsonErrorStatusResponse("409", "Main/DM conversations and the last member cannot leave", [
      "conversation_not_group",
      "conversation_dm_no_remove",
      "conversation_last_participant"
    ]).responses["409"],
    "500": conversationInternalResponse
  }
} as const;

// R17 批 G1（#15 工作区成员移出/角色变更）：DELETE / PATCH /api/workspace/members/:userId。
const workspaceMemberRoleSchema = { type: "string", enum: ["member", "admin", "owner"] } as const;
const updateWorkspaceMemberRoleRequestBodySchema = {
  type: "object",
  required: ["role"],
  properties: { role: workspaceMemberRoleSchema },
  additionalProperties: false
} as const;
const removeWorkspaceMemberResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["removed_user_id"],
        properties: { removed_user_id: uuidStringSchema },
        additionalProperties: false
      },
      "The removed member's user id"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Only workspace admins/owners may manage members", [
      "member_manage_forbidden",
      "human_required"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Member was not found", ["member_not_found"]).responses["404"],
    "409": jsonErrorStatusResponse("409", "Cannot remove yourself or the last admin", [
      "member_manage_self",
      "member_last_admin"
    ]).responses["409"],
    "500": conversationInternalResponse
  }
} as const;
// R18 批 H1（成员清单）：GET /api/workspace/members —— 管理员读 roster（昵称/角色/加入时间/是否本人）。
const listWorkspaceMembersResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["members"],
        properties: {
          members: {
            type: "array",
            items: {
              type: "object",
              required: ["user_id", "nickname", "role", "joined_at", "is_self"],
              properties: {
                user_id: uuidStringSchema,
                nickname: { type: "string", minLength: 1, maxLength: 96 },
                role: workspaceMemberRoleSchema,
                joined_at: dateTimeStringSchema,
                is_self: { type: "boolean" }
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      },
      "Workspace member roster"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Only workspace admins/owners may list members", [
      "member_manage_forbidden",
      "human_required"
    ]).responses["403"],
    "500": conversationInternalResponse
  }
} as const;
const updateWorkspaceMemberRoleResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["user_id", "role"],
        properties: { user_id: uuidStringSchema, role: workspaceMemberRoleSchema },
        additionalProperties: false
      },
      "The member's new role"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Only workspace admins/owners may manage members", [
      "member_manage_forbidden",
      "human_required"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Member was not found", ["member_not_found"]).responses["404"],
    "409": jsonErrorStatusResponse("409", "Cannot change your own role or demote the last admin", [
      "member_manage_self",
      "member_last_admin"
    ]).responses["409"],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
// R20 P2A（P1-08 修复 · workspace-scoped roster）：GET /api/workspace/roster —— 任意工作区成员分页读本
// 工作区花名册（取代消费端误用的全局 /api/users）。limit/offset 分页，回工作区成员总数 + 头像/在线态占位。
const workspaceRosterQueryParameters = [
  { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } }
] as const;
const listWorkspaceRosterResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["members", "total", "limit", "offset"],
        properties: {
          members: {
            type: "array",
            items: {
              type: "object",
              required: ["user_id", "nickname", "role", "joined_at", "is_self", "is_admin", "avatar_updated_at", "online"],
              properties: {
                user_id: uuidStringSchema,
                nickname: { type: "string", minLength: 1, maxLength: 96 },
                role: workspaceMemberRoleSchema,
                joined_at: dateTimeStringSchema,
                is_self: { type: "boolean" },
                // R20 P1-08 收尾：全局管理员标签（users.is_admin，非本工作区角色）——additive。
                is_admin: { type: "boolean" },
                avatar_updated_at: { ...dateTimeStringSchema, nullable: true },
                online: { type: "boolean", nullable: true }
              },
              additionalProperties: false
            }
          },
          total: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 }
        },
        additionalProperties: false
      },
      "A page of the caller's workspace member roster"
    ).responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Only members of the workspace may read its roster", [
      "roster_forbidden"
    ]).responses["403"],
    "500": conversationInternalResponse
  }
} as const;

const presenceUserIdsQueryParameter = {
  name: "user_ids",
  in: "query",
  required: true,
  description: "Comma-separated user uuids, at most 50; response keeps the request order",
  schema: { type: "string", minLength: 1 }
} as const;
// R14 批 MEM：记忆/技能管理面——与 packages/contracts/src/pages.ts 的管理面 zod 逐字段对齐。
const userMemoryProvenanceJsonSchema = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: ["agent_run", "review_correction"] },
    label: { type: "string", minLength: 1 },
    run_id: uuidStringSchema,
    conversation_id: uuidStringSchema,
    proposal_id: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;
const userMemoryManagementItemJsonSchema = {
  type: "object",
  required: ["id", "category", "key", "value_md", "confidence", "workspace_scoped", "created_at", "updated_at"],
  properties: {
    id: uuidStringSchema,
    category: { type: "string", enum: ["preference", "correction", "recurring_context"] },
    key: { type: "string", minLength: 1 },
    value_md: { type: "string", minLength: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    workspace_scoped: { type: "boolean" },
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema,
    last_used_at: dateTimeStringSchema,
    edited_at: dateTimeStringSchema,
    provenance: userMemoryProvenanceJsonSchema
  },
  additionalProperties: false
} as const;
const userMemoryManagementPageJsonSchema = {
  type: "object",
  required: ["generated_at", "memories", "totals"],
  properties: {
    generated_at: dateTimeStringSchema,
    memories: { type: "array", maxItems: 50, items: userMemoryManagementItemJsonSchema },
    totals: {
      type: "object",
      required: ["active"],
      properties: { active: { type: "integer", minimum: 0 } },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;
const teamSkillManagementItemJsonSchema = {
  type: "object",
  required: [
    "skill_key",
    "name",
    "when_to_use",
    "version",
    "source_kind",
    "created_by_kind",
    "sample_count",
    "updated_at",
    "id",
    "content_md",
    "status"
  ],
  properties: {
    skill_key: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    when_to_use: { type: "string", minLength: 1 },
    version: { type: "integer", minimum: 1 },
    source_kind: { type: "string", enum: ["distilled", "authored"] },
    created_by_kind: { type: "string", enum: ["ai", "human"] },
    confidence_score: { type: "number", minimum: 0, maximum: 1 },
    sample_count: { type: "integer", minimum: 0 },
    updated_at: dateTimeStringSchema,
    provenance: {
      type: "object",
      required: ["refined_from_version", "op_count"],
      properties: {
        refined_from_version: { type: "integer", minimum: 1 },
        op_count: { type: "integer", minimum: 0 },
        rationale_md: { type: "string" }
      },
      additionalProperties: false
    },
    id: uuidStringSchema,
    content_md: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["draft", "active", "deprecated"] },
    deprecated_reason: { type: "string" },
    deprecated_at: dateTimeStringSchema,
    source_run_id: uuidStringSchema
  },
  additionalProperties: false
} as const;
const teamSkillManagementPageJsonSchema = {
  type: "object",
  required: ["generated_at", "skills"],
  properties: {
    generated_at: dateTimeStringSchema,
    skills: { type: "array", items: teamSkillManagementItemJsonSchema }
  },
  additionalProperties: false
} as const;
// R24-P 阶段 1：插件治理。compat_report 是**安装前不执行任何插件代码**的静态体检结论；
// load_report 是宿主试加载的结果（装不上时原因在这里，而不是只在日志里一闪而过）。
const pluginCompatReportJsonSchema = {
  type: "object",
  required: ["verdict", "checks", "checked_at"],
  properties: {
    verdict: { type: "string", enum: ["ok", "warn", "blocked"] },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "level"],
        properties: {
          id: {
            type: "string",
            enum: ["manifest", "client_surface", "install_scripts", "dsh_tools_peer", "bundle_manifest"]
          },
          level: { type: "string", enum: ["pass", "warn", "block"] },
          detail: { type: "string", maxLength: 500 }
        },
        additionalProperties: false
      }
    },
    manifest_name: { type: "string", maxLength: 200 },
    manifest_version: { type: "string", maxLength: 80 },
    manifest_license: { type: "string", maxLength: 120 },
    peer_dsh_tools_range: { type: "string", maxLength: 120 },
    host_dsh_tools_version: { type: "string", maxLength: 80 },
    checked_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const pluginLoadReportJsonSchema = {
  type: "object",
  required: ["ok", "tool_count", "prompt_section_count", "loaded_at"],
  properties: {
    ok: { type: "boolean" },
    tool_count: { type: "integer", minimum: 0 },
    prompt_section_count: { type: "integer", minimum: 0 },
    error: { type: "string", maxLength: 2000 },
    loaded_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const pluginVmJsonSchema = {
  type: "object",
  required: [
    "id",
    "name",
    "source_kind",
    "source_path",
    "enabled",
    "status",
    "trust_level",
    "tool_count",
    "compat_report",
    "created_at",
    "updated_at"
  ],
  properties: {
    id: uuidStringSchema,
    name: { type: "string", minLength: 1, maxLength: 200 },
    version: { type: "string", maxLength: 80 },
    // 单值枚举不是笔误：npm 包名 / git url / tarball 会在安装期跑包自己的 prepare/postinstall。
    source_kind: { type: "string", enum: ["local_path"] },
    source_path: { type: "string", minLength: 1, maxLength: 1000 },
    enabled: { type: "boolean" },
    status: { type: "string", enum: ["installed", "load_failed", "disabled", "crashed"] },
    // Admin-asserted risk ceiling. A tool drops to the low-risk tier only when this is
    // read_only AND the tool itself reports read-only; the plugin can never raise its own tier.
    trust_level: { type: "string", enum: ["read_only", "external_effect"] },
    tool_count: { type: "integer", minimum: 0 },
    compat_report: pluginCompatReportJsonSchema,
    load_report: pluginLoadReportJsonSchema,
    installed_by: uuidStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const pluginListJsonSchema = {
  type: "object",
  required: ["plugins", "bootstrap_path_count"],
  properties: {
    plugins: { type: "array", items: pluginVmJsonSchema },
    host_dsh_tools_version: { type: "string", maxLength: 80 },
    bootstrap_path_count: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const installPluginRequestJsonSchema = {
  type: "object",
  required: ["source_path"],
  properties: {
    source_path: { type: "string", minLength: 1, maxLength: 1000 },
    trust_level: { type: "string", enum: ["read_only", "external_effect"] }
  },
  additionalProperties: false
} as const;
const updatePluginTrustRequestJsonSchema = {
  type: "object",
  required: ["trust_level"],
  properties: {
    trust_level: { type: "string", enum: ["read_only", "external_effect"] }
  },
  additionalProperties: false
} as const;
const pluginAdminForbiddenResponse = jsonErrorStatusResponse("403", "Managing plugins requires an admin", [
  "invalid_client_token",
  "forbidden",
  "plugin_admin_required"
]);
const pluginNotFoundResponse = jsonErrorStatusResponse("404", "No such plugin in this workspace", [
  "plugin_not_found"
]);
// R26 M3：MCP（Model Context Protocol）服务器治理。precheck_report 是**登记前不执行任何东西**的
// 静态体检结论（字符串判定 + 一次 access）；连接事实与行上的状态刻意分成两个字段——行说的是
// 「上一次连接尝试的结论」（重启 API 之后仍然读得到），connection 说的是「此刻还有没有活着的子进程」。
const mcpPrecheckReportJsonSchema = {
  type: "object",
  required: ["verdict", "checks", "checked_at"],
  properties: {
    verdict: { type: "string", enum: ["ok", "warn", "blocked"] },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "level"],
        properties: {
          id: {
            type: "string",
            enum: [
              "server_name",
              "command_resolvable",
              "remote_exec_launcher",
              "args_shape",
              "env_credential_shaped",
              "env_overrides_base",
              "secret_ref_scope",
              "secret_refs_present"
            ]
          },
          level: { type: "string", enum: ["pass", "warn", "block"] },
          detail: { type: "string", maxLength: 500 }
        },
        additionalProperties: false
      }
    },
    checked_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const mcpServerVmJsonSchema = {
  type: "object",
  required: [
    "id",
    "server_name",
    "transport",
    "command",
    "args",
    "env",
    "secret_refs",
    "tool_call_timeout_ms",
    "enabled",
    "status",
    "trust_level",
    "precheck_report",
    "tool_count",
    "created_at",
    "updated_at"
  ],
  properties: {
    id: uuidStringSchema,
    // 模型可见工具名的命名空间；本地配置，绝不取远端自报的 serverInfo.name。工作区内唯一。
    server_name: { type: "string", pattern: "^[A-Za-z0-9_-]{1,32}$" },
    display_name: { type: "string", minLength: 1, maxLength: 200 },
    // 单值枚举不是笔误：HTTP 传输引入出网目的地治理与密钥落库两件全新的事，放开要走新迁移。
    transport: { type: "string", enum: ["stdio"] },
    command: { type: "string", maxLength: 1000 },
    args: { type: "array", items: { type: "string" } },
    // 只允许非密键；凭据形状的键在体检就被拒，本列结构性存不进密文。
    env: { type: "object", additionalProperties: { type: "string" } },
    // {子进程 env 名: 服务端 env 名}——存指针不是值。
    secret_refs: { type: "object", additionalProperties: { type: "string" } },
    cwd: { type: "string", minLength: 1, maxLength: 1000 },
    tool_call_timeout_ms: { type: "integer", minimum: 1000, maximum: 300000 },
    enabled: { type: "boolean" },
    status: { type: "string", enum: ["connected", "connect_failed", "disabled"] },
    // 管理员断言的读写上限：服务器只能在这个上限内把风险往下降，不能自己往上抬。
    trust_level: { type: "string", enum: ["read_only", "external_effect"] },
    precheck_report: mcpPrecheckReportJsonSchema,
    last_error: { type: "string", maxLength: 2000 },
    tool_count: { type: "integer", minimum: 0 },
    tools: { type: "array", items: { type: "string" } },
    installed_by: uuidStringSchema,
    created_at: dateTimeStringSchema,
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const mcpServerConnectionJsonSchema = {
  type: "object",
  required: ["live", "tool_count"],
  properties: {
    // 空闲回收把子进程收掉之后 live=false 而 status 仍是 connected——下次用到会重新握手。
    live: { type: "boolean" },
    tool_count: { type: "integer", minimum: 0 },
    tool_ids: { type: "array", items: { type: "string", maxLength: 64 } },
    blocked_reason: { type: "string", maxLength: 2000 },
    last_error: { type: "string", maxLength: 2000 }
  },
  additionalProperties: false
} as const;
const mcpServerActionResultJsonSchema = {
  type: "object",
  required: ["server", "risk_tokens"],
  properties: {
    server: mcpServerVmJsonSchema,
    connection: mcpServerConnectionJsonSchema,
    // 服务器名里会让它的每一个工具都被判成高风险、每次调用都停下来转人的词。
    risk_tokens: { type: "array", items: { type: "string", maxLength: 64 } }
  },
  additionalProperties: false
} as const;
const mcpServerListJsonSchema = {
  type: "object",
  required: ["servers", "connections", "secret_ref_env_prefix", "available_secret_refs"],
  properties: {
    servers: { type: "array", items: mcpServerVmJsonSchema },
    connections: { type: "object", additionalProperties: mcpServerConnectionJsonSchema },
    secret_ref_env_prefix: { type: "string", minLength: 1, maxLength: 80 },
    // 只有名字，没有值——添加表单据此避免填一个还没配的引用。
    available_secret_refs: { type: "array", items: { type: "string", maxLength: 200 } }
  },
  additionalProperties: false
} as const;
const addMcpServerRequestJsonSchema = {
  type: "object",
  required: ["server_name", "command"],
  properties: {
    // 形状判定归静态体检（它给 mcp_server_name_invalid / mcp_server_name_taken 两个不同的码），
    // 契约层只限长——在这里用正则挡掉，客户端只会收到一个说不清原因的 validation_error。
    server_name: { type: "string", minLength: 1, maxLength: 200 },
    display_name: { type: "string", minLength: 1, maxLength: 200 },
    command: { type: "string", minLength: 1, maxLength: 1000 },
    args: { type: "array", items: { type: "string", maxLength: 4000 }, maxItems: 64 },
    env: { type: "object", additionalProperties: { type: "string", maxLength: 4000 } },
    secret_refs: { type: "object", additionalProperties: { type: "string", minLength: 1, maxLength: 200 } },
    cwd: { type: "string", minLength: 1, maxLength: 1000 },
    tool_call_timeout_ms: { type: "integer", minimum: 1000, maximum: 300000 },
    trust_level: { type: "string", enum: ["read_only", "external_effect"] },
    enabled: { type: "boolean" }
  },
  additionalProperties: false
} as const;
const updateMcpServerRequestJsonSchema = {
  type: "object",
  // 刻意不含 server_name / command：改名会让模型可见工具名整体换一批（历史审计还挂在旧名下），
  // 改命令等于指向另一个可执行文件——两者都走「移除再添加」，好让体检与审计重跑一遍完整流程。
  minProperties: 1,
  properties: {
    trust_level: { type: "string", enum: ["read_only", "external_effect"] },
    tool_call_timeout_ms: { type: "integer", minimum: 1000, maximum: 300000 },
    env: { type: "object", additionalProperties: { type: "string", maxLength: 4000 } },
    secret_refs: { type: "object", additionalProperties: { type: "string", minLength: 1, maxLength: 200 } }
  },
  additionalProperties: false
} as const;
const mcpAdminForbiddenResponse = jsonErrorStatusResponse("403", "Managing MCP servers requires an admin", [
  "invalid_client_token",
  "forbidden",
  "mcp_admin_required"
]);
const mcpServerNotFoundResponse = jsonErrorStatusResponse("404", "No such MCP server in this workspace", [
  "mcp_server_not_found",
  "not_found"
]);
const mcpPrecheckRefusedResponse = jsonErrorStatusResponse(
  "422",
  "The pre-start health check refused this configuration; every refusal has its own stable code so clients never parse the English diagnostic",
  [
    "validation_error",
    "mcp_server_name_invalid",
    "mcp_command_not_found",
    "mcp_remote_exec_refused",
    "mcp_args_invalid",
    "mcp_env_credential_shaped",
    "mcp_env_overrides_base",
    "mcp_secret_ref_out_of_scope",
    "mcp_precheck_refused"
  ]
);
const patchUserMemoryRequestJsonSchema = {
  type: "object",
  required: ["value_md", "expected_updated_at"],
  properties: {
    value_md: { type: "string", minLength: 1, maxLength: 2000 },
    expected_updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const patchTeamSkillRequestJsonSchema = {
  type: "object",
  required: ["ops", "base_version"],
  properties: {
    ops: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "object", maxProperties: 8, additionalProperties: true }
    },
    base_version: { type: "integer", minimum: 1 },
    rationale_md: { type: "string" }
  },
  additionalProperties: false
} as const;
// R14 批 GH：项目 GitHub 绑定——与 packages/contracts/src/domain/github.ts 的 zod 逐字段对齐。
// 响应 VM 结构性无 token 字段（安全红线：PAT 明文/密文永不下发）。
const githubBindingStatusJsonSchema = {
  type: "object",
  required: ["project_id", "bound"],
  properties: {
    project_id: uuidStringSchema,
    bound: { type: "boolean" },
    repo_full_name: { type: "string" },
    repo_default_branch: { type: "string" },
    repo_private: { type: "boolean" },
    enabled: { type: "boolean" },
    last_synced_at: dateTimeStringSchema,
    last_error: { type: "string" },
    last_error_at: dateTimeStringSchema,
    activity_count_7d: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const githubBindingRequestJsonSchema = {
  type: "object",
  required: ["repo_full_name", "personal_access_token"],
  properties: {
    repo_full_name: { type: "string", minLength: 3, maxLength: 200 },
    personal_access_token: { type: "string", minLength: 20, maxLength: 512 }
  },
  additionalProperties: false
} as const;
const githubTestConnectionRequestJsonSchema = {
  type: "object",
  properties: {
    personal_access_token: { type: "string", minLength: 20, maxLength: 512 },
    repo_full_name: { type: "string", minLength: 3, maxLength: 200 }
  },
  additionalProperties: false
} as const;
const githubTestConnectionResultJsonSchema = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
    repo_full_name: { type: "string" },
    repo_default_branch: { type: "string" },
    repo_private: { type: "boolean" },
    error: { type: "string" }
  },
  additionalProperties: false
} as const;
const githubBindingOwnerForbiddenResponse = jsonErrorStatusResponse(
  "403",
  "GitHub binding management requires the project owner",
  ["invalid_client_token", "forbidden", "human_required", "github_binding_owner_required", "github_binding_access_denied"]
).responses["403"];
const githubBindingNotFoundResponse = jsonErrorStatusResponse("404", "Project or binding was not found", [
  "github_binding_project_not_found",
  "github_binding_not_found"
]).responses["404"];
const githubEncryptionUnconfiguredResponse = jsonErrorStatusResponse(
  "503",
  "GITHUB_TOKEN_ENC_KEY is not configured; refusing to handle tokens (fail closed)",
  ["github_binding_encryption_unconfigured"]
).responses["503"];
const memoryGovernanceAuthResponses = {
  "401": conversationAuthRequiredResponse,
  "403": conversationForbiddenResponse,
  "422": conversationValidationResponse,
  "500": conversationInternalResponse
} as const;
const userMemoryNotFoundResponse = jsonErrorStatusResponse("404", "Memory was not found or is not yours", [
  "user_memory_not_found"
]).responses["404"];
const teamSkillNotFoundResponse = jsonErrorStatusResponse("404", "Active team skill was not found", [
  "team_skill_not_found"
]).responses["404"];

// R14 批 SEARCH：/api/search 响应——与 packages/contracts/src/domain/search.ts 的 zod 逐字段对齐。
function searchGroupVariant(scope: string, resultSchema: Record<string, unknown>) {
  return {
    type: "object",
    required: ["scope", "has_more", "results"],
    properties: {
      scope: { type: "string", const: scope },
      has_more: { type: "boolean" },
      results: { type: "array", maxItems: 25, items: resultSchema }
    },
    additionalProperties: false
  };
}
const searchDeepLinkSchema = {
  type: "object",
  required: ["project_id", "conversation_id", "seq"],
  properties: {
    project_id: uuidStringSchema,
    conversation_id: uuidStringSchema,
    seq: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;
const conversationSearchResultJsonSchema = {
  type: "object",
  required: [
    "message_id",
    "conversation_id",
    "project_id",
    "project_name",
    "conversation_title",
    "seq",
    "sender_type",
    "sender_user_id",
    "sender_label",
    "matched_in",
    "snippet",
    "created_at",
    "deep_link"
  ],
  properties: {
    message_id: uuidStringSchema,
    conversation_id: uuidStringSchema,
    project_id: uuidStringSchema,
    project_name: { type: "string" },
    conversation_title: { type: "string" },
    seq: { type: "integer", minimum: 0 },
    sender_type: { type: "string" },
    sender_user_id: { anyOf: [uuidStringSchema, { type: "null" }] },
    sender_label: { type: ["string", "null"] },
    matched_in: { type: "string", const: "text" },
    snippet: { type: "string" },
    created_at: dateTimeStringSchema,
    deep_link: searchDeepLinkSchema
  },
  additionalProperties: false
} as const;
const driveSearchResultJsonSchema = {
  type: "object",
  required: ["item_id", "project_id", "project_name", "name", "kind", "matched_in", "snippet", "updated_at"],
  properties: {
    item_id: uuidStringSchema,
    project_id: uuidStringSchema,
    project_name: { type: "string" },
    name: { type: "string" },
    kind: { type: "string" },
    matched_in: { type: "string", enum: ["name", "body"] },
    snippet: { type: "string" },
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const workItemSearchResultJsonSchema = {
  type: "object",
  required: [
    "work_item_id",
    "code",
    "project_id",
    "project_name",
    "title",
    "status",
    "matched_in",
    "snippet",
    "updated_at"
  ],
  properties: {
    work_item_id: uuidStringSchema,
    code: { type: "string" },
    project_id: uuidStringSchema,
    project_name: { type: "string" },
    title: { type: ["string", "null"] },
    status: { type: "string" },
    matched_in: { type: "string", enum: ["title", "description"] },
    snippet: { type: "string" },
    updated_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const meetingSearchResultJsonSchema = {
  type: "object",
  required: ["meeting_id", "project_id", "project_name", "title", "status", "matched_in", "snippet", "created_at"],
  properties: {
    meeting_id: uuidStringSchema,
    project_id: uuidStringSchema,
    project_name: { type: "string" },
    title: { type: "string" },
    status: { type: "string" },
    matched_in: { type: "string", enum: ["title", "minutes"] },
    snippet: { type: "string" },
    created_at: dateTimeStringSchema
  },
  additionalProperties: false
} as const;
const searchResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["query", "groups"],
        properties: {
          query: { type: "string" },
          groups: {
            type: "array",
            maxItems: 4,
            items: {
              oneOf: [
                searchGroupVariant("conversations", conversationSearchResultJsonSchema),
                searchGroupVariant("drive", driveSearchResultJsonSchema),
                searchGroupVariant("work_items", workItemSearchResultJsonSchema),
                searchGroupVariant("meetings", meetingSearchResultJsonSchema)
              ]
            }
          }
        },
        additionalProperties: false
      },
      "Search results grouped per requested scope, ordered conversations/drive/work_items/meetings"
    ).responses["200"],
    "400": jsonErrorStatusResponse("400", "q, scopes, or limit failed validation", ["bad_request"]).responses[
      "400"
    ],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "500": conversationInternalResponse
  }
} as const;
const presenceListResponses = {
  responses: {
    "200": jsonDataResponse(
      {
        type: "object",
        required: ["presence"],
        properties: {
          presence: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              required: ["user_id", "is_online", "last_seen_at"],
              properties: {
                user_id: uuidStringSchema,
                is_online: { type: "boolean" },
                last_seen_at: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] }
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      },
      "Presence for the visible same-workspace members, request order preserved"
    ).responses["200"],
    "400": jsonErrorStatusResponse("400", "user_ids is missing, too long, or contains an invalid id", [
      "bad_request"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "500": conversationInternalResponse
  }
} as const;

// R12 批 5(军团面板读侧)——与 packages/contracts/src/pages.ts 的 army VM zod 逐字段对齐。
const armyRunRecentStepJsonSchema = {
  type: "object",
  properties: {
    phase: { type: "string" },
    tool_name: { type: ["string", "null"], maxLength: 64 },
    output_excerpt: { type: ["string", "null"], maxLength: 240 },
    step_no: { type: "integer", minimum: 1 }
  },
  required: ["phase", "tool_name", "output_excerpt", "step_no"],
  additionalProperties: false
} as const;
const armyRunCardBaseJsonProperties = {
  id: uuidStringSchema,
  status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "escalated", "cancelled"] },
  goal_summary: { type: "string", minLength: 1, maxLength: 201 },
  assignee_user_id: { ...uuidStringSchema, type: ["string", "null"] },
  cost_cny: { type: ["string", "null"], pattern: "^\\d+(?:\\.\\d+)?$" },
  execution_hint: { type: "string", enum: ["server", "local", "any"] },
  work_item_id: uuidStringSchema,
  source_conversation_id: { ...uuidStringSchema, type: ["string", "null"] },
  source_action_card_item_id: { ...uuidStringSchema, type: ["string", "null"] },
  cat_codename: { type: "string", minLength: 1, maxLength: 16 },
  recent_step: { ...armyRunRecentStepJsonSchema, type: ["object", "null"] },
  created_at: { type: "string", format: "date-time" },
  updated_at: { type: "string", format: "date-time" }
} as const;
const armyRunCardRequiredJsonFields = [
  "id",
  "status",
  "goal_summary",
  "assignee_user_id",
  "cost_cny",
  "execution_hint",
  "work_item_id",
  "source_conversation_id",
  "source_action_card_item_id",
  "cat_codename",
  "recent_step",
  "created_at",
  "updated_at"
] as const;
const armyRunListCursorJsonSchema = {
  type: ["object", "null"],
  properties: {
    after_created_at: {
      type: "string",
      format: "date-time",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$"
    },
    after_id: uuidStringSchema
  },
  required: ["after_created_at", "after_id"],
  additionalProperties: false
} as const;
function armyRunListJsonSchema(cardProperties: Record<string, unknown>, cardRequired: readonly string[]) {
  return {
    type: "object",
    properties: {
      runs: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          properties: cardProperties,
          required: [...cardRequired],
          additionalProperties: false
        }
      },
      capped: { type: "boolean" },
      next_cursor: armyRunListCursorJsonSchema,
      empty_state: { type: "string", const: "no_army_runs" }
    },
    required: ["runs", "capped", "next_cursor"],
    additionalProperties: false,
    "x-workhub-invariants": [
      "next_cursor is non-null exactly when capped is true.",
      "empty_state is present exactly when runs is empty."
    ]
  } as const;
}
const armyOutputsJsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          proposal_id: uuidStringSchema,
          work_item_id: uuidStringSchema,
          run_id: uuidStringSchema,
          title: { type: "string", minLength: 1, maxLength: 256 },
          status: { type: "string", minLength: 1, maxLength: 32 },
          proposal_href: { type: "string", minLength: 1 },
          updated_at: { type: "string", format: "date-time" }
        },
        required: ["proposal_id", "work_item_id", "run_id", "title", "status", "proposal_href", "updated_at"],
        additionalProperties: false
      }
    },
    capped: { type: "boolean" }
  },
  required: ["items", "capped"],
  additionalProperties: false
} as const;
const armyBackgroundTasksJsonSchema = {
  type: "object",
  properties: {
    items: { type: "array", maxItems: 0, items: {} },
    empty_state: { type: "string", const: "not_yet_available" }
  },
  required: ["items", "empty_state"],
  additionalProperties: false,
  description:
    "Honestly empty until a real scheduled-task data source lands; never backed by unrelated background_jobs or schedule events."
} as const;
const conversationArmyPanelResponseSchema = {
  type: "object",
  properties: {
    generated_at: { type: "string", format: "date-time" },
    conversation_id: uuidStringSchema,
    project_id: uuidStringSchema,
    runs: armyRunListJsonSchema(armyRunCardBaseJsonProperties, armyRunCardRequiredJsonFields),
    outputs: armyOutputsJsonSchema,
    background_tasks: armyBackgroundTasksJsonSchema
  },
  required: ["generated_at", "conversation_id", "project_id", "runs", "outputs", "background_tasks"],
  additionalProperties: false
} as const;
const armyOverviewPageResponseSchema = {
  type: "object",
  properties: {
    generated_at: { type: "string", format: "date-time" },
    viewer_user_id: uuidStringSchema,
    runs: armyRunListJsonSchema(
      {
        ...armyRunCardBaseJsonProperties,
        project_id: uuidStringSchema,
        project_name: { type: "string", minLength: 1, maxLength: 128 }
      },
      [...armyRunCardRequiredJsonFields, "project_id", "project_name"]
    )
  },
  required: ["generated_at", "viewer_user_id", "runs"],
  additionalProperties: false
} as const;
const armyLimitQueryParameter = {
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: 50, default: 20 }
} as const;
const conversationArmyPanelResponses = {
  responses: {
    "200": jsonDataResponse(conversationArmyPanelResponseSchema, "Conversation army context panel").responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation army panel is inaccessible or was not found", [
      "conversation_army_not_found"
    ]).responses["404"],
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const armyOverviewResponses = {
  responses: {
    "200": jsonDataResponse(armyOverviewPageResponseSchema, "Cross-project army overview for the viewer").responses[
      "200"
    ],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
// R17 G3(#8 后台任务区接真)——与 packages/contracts/src/pages.ts 的 armyBackgroundPageVmSchema 逐字段对齐。
const armyBackgroundPageResponseSchema = {
  type: "object",
  properties: {
    generated_at: { type: "string", format: "date-time" },
    scheduler: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        tasks: {
          type: "array",
          maxItems: 32,
          items: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 64 },
              interval_ms: { type: "integer", minimum: 0 },
              running: { type: "boolean" },
              tick_count: { type: "integer", minimum: 0 },
              skipped_count: { type: "integer", minimum: 0 },
              error_count: { type: "integer", minimum: 0 },
              last_tick_at: { type: ["string", "null"], format: "date-time" }
            },
            required: [
              "name",
              "interval_ms",
              "running",
              "tick_count",
              "skipped_count",
              "error_count",
              "last_tick_at"
            ],
            additionalProperties: false
          }
        }
      },
      required: ["enabled", "tasks"],
      additionalProperties: false
    },
    proactive: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              id: uuidStringSchema,
              kind: { type: "string", minLength: 1, maxLength: 64 },
              stage: { type: ["string", "null"], minLength: 1, maxLength: 64 },
              status: { type: "string", enum: ["delivered", "suppressed"] },
              delivered_via: { type: ["string", "null"], minLength: 1, maxLength: 64 },
              created_at: { type: "string", format: "date-time" }
            },
            required: ["id", "kind", "stage", "status", "delivered_via", "created_at"],
            additionalProperties: false
          }
        },
        capped: { type: "boolean" }
      },
      required: ["items", "capped"],
      additionalProperties: false
    }
  },
  required: ["generated_at", "scheduler", "proactive"],
  additionalProperties: false,
  description:
    "Read-only army background machinery: pulse scheduler heartbeat (process-level, no per-workspace data, no error text) plus the current user's most recent proactive intents (workspace + target-user scoped)."
} as const;
const armyBackgroundResponses = {
  responses: {
    "200": jsonDataResponse(armyBackgroundPageResponseSchema, "Army background tasks and proactivity feed").responses[
      "200"
    ],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Army background is inaccessible or was not found", [
      "conversation_army_not_found"
    ]).responses["404"],
    "500": conversationInternalResponse
  }
} as const;

// R12 批3(行动卡 decide/undo)——与 routes/action-cards.ts 的 zod 请求与 ActionCardItemVM 对齐。
const actionCardItemVmJsonSchema = {
  type: "object",
  properties: {
    id: uuidStringSchema,
    action_card_id: uuidStringSchema,
    kind: { type: "string", enum: ["execute", "decide", "observe"] },
    title_md: { type: "string", minLength: 1 },
    confidence: { type: "string", enum: ["high", "mid", "low"] },
    status: {
      type: "string",
      enum: ["running", "done", "undone", "waiting_decision", "dismissed", "escalated"]
    },
    assignee_user_id: { ...uuidStringSchema, type: ["string", "null"] },
    work_item_id: { ...uuidStringSchema, type: ["string", "null"] },
    run_id: { ...uuidStringSchema, type: ["string", "null"] },
    undo_deadline_at: { type: ["string", "null"], format: "date-time" }
  },
  required: [
    "id",
    "action_card_id",
    "kind",
    "title_md",
    "confidence",
    "status",
    "assignee_user_id",
    "work_item_id",
    "run_id",
    "undo_deadline_at"
  ],
  additionalProperties: false
} as const;
const decideActionCardItemRequestBodySchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["claim", "reassign", "defer"] },
    assignee_user_id: uuidStringSchema
  },
  required: ["action"],
  additionalProperties: false,
  "x-workhub-invariants": [
    "assignee_user_id is required exactly when action is reassign and rejected otherwise."
  ]
} as const;
const actionCardConflictResponse = jsonErrorStatusResponse(
  "409",
  "Action-card item state no longer allows this operation",
  ["action_card_item_already_decided", "action_card_decision_already_resolved", "action_card_item_not_undoable"]
).responses["409"];
const actionCardNotFoundResponse = jsonErrorStatusResponse(
  "404",
  "Action-card item is inaccessible or was not found",
  ["action_card_item_not_found"]
).responses["404"];
const actionCardDecideResponses = {
  responses: {
    "200": jsonDataResponse(actionCardItemVmJsonSchema, "Decided action-card item").responses["200"],
    "400": jsonErrorStatusResponse("400", "Decision input is malformed or semantically invalid", [
      "malformed_json",
      "json_object_required",
      "action_card_reassign_requires_assignee"
    ]).responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": actionCardNotFoundResponse,
    "409": actionCardConflictResponse,
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;
const actionCardUndoResponses = {
  responses: {
    "200": jsonDataResponse(actionCardItemVmJsonSchema, "Undone action-card item").responses["200"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": actionCardNotFoundResponse,
    "409": actionCardConflictResponse,
    "422": conversationValidationResponse,
    "500": conversationInternalResponse
  }
} as const;

// R12 批4a(协同会话 turn)——与 routes/conversation-turns.ts 对齐。
const conversationTurnRequestBodySchema = {
  type: "object",
  properties: {
    user_message_id: uuidStringSchema
  },
  required: ["user_message_id"],
  additionalProperties: false
} as const;
const conversationTurnResultResponseSchema = {
  type: "object",
  properties: {
    turn_id: uuidStringSchema,
    message: {
      type: "object",
      description: "Persisted Cuu reply message VM (real seq; also broadcast as conversation.message.created with an ai actor)."
    }
  },
  required: ["turn_id", "message"],
  additionalProperties: false
} as const;
const conversationTurnResponses = {
  responses: {
    "200": jsonDataResponse(conversationTurnResultResponseSchema, "Completed collab turn with the persisted Cuu reply")
      .responses["200"],
    "400": jsonErrorStatusResponse("400", "Turn input is malformed", ["malformed_json", "json_object_required"])
      .responses["400"],
    "401": conversationAuthRequiredResponse,
    "403": conversationForbiddenResponse,
    "404": jsonErrorStatusResponse("404", "Conversation or the referenced user message was not found", [
      "conversation_not_found",
      "conversation_turn_message_not_found"
    ]).responses["404"],
    "409": jsonErrorStatusResponse("409", "Turn is not allowed in the conversation's current state", [
      "conversation_turn_not_collab",
      "conversation_turn_busy",
      "conversation_turn_mode_observe_only",
      "conversation_turn_cuu_disabled"
    ]).responses["409"],
    "429": jsonErrorStatusResponse("429", "Team budget is exhausted for AI turns", [
      "conversation_turn_budget_exhausted"
    ]).responses["429"],
    "413": conversationPayloadTooLargeResponse,
    "422": conversationValidationResponse,
    "500": jsonErrorStatusResponse("500", "Turn generation or persistence failed; nothing was saved", [
      "conversation_turn_failed",
      "internal_contract_error",
      "internal_error"
    ]).responses["500"]
  }
} as const;

const aiModelPreferenceStringSchema = {
  type: "string",
  minLength: 1,
  maxLength: 32,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$"
} as const;
const aiGranularSettingsSchema = {
  type: "object",
  properties: {
    create_work_item: { type: "boolean" },
    dispatch_run: { type: "boolean" },
    mutate_drive: { type: "boolean" },
    send_notification: { type: "boolean" }
  },
  additionalProperties: false
} as const;
// R14 批 RISK：风险巡检阈值（PATCH 侧全字段可选；GET 侧读时与保守默认值合并、每个键都有值）。
// 形状钉死 packages/contracts/src/domain/conversation.ts 的 riskMonitorSettingsSchema。
const riskMonitorSettingsSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    stall_days_threshold: { type: "integer", minimum: 1, maximum: 90 },
    deadline_lookahead_days: { type: "integer", minimum: 0, maximum: 30 },
    cost_spike_ratio_pct: { type: "integer", minimum: 100, maximum: 2000 },
    cost_spike_min_cny: { type: "number", minimum: 0 }
  },
  additionalProperties: false
} as const;
const aiQuietHoursSchema = {
  oneOf: [
    {
      type: "object",
      required: ["enabled"],
      properties: { enabled: { type: "boolean", const: false } },
      additionalProperties: false
    },
    {
      type: "object",
      required: ["enabled", "timezone", "start_minute", "end_minute", "weekdays"],
      properties: {
        enabled: { type: "boolean", const: true },
        timezone: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "IANA timezone supported by the server runtime."
        },
        start_minute: { type: "integer", minimum: 0, maximum: 1439 },
        end_minute: { type: "integer", minimum: 0, maximum: 1439 },
        weekdays: {
          type: "array",
          minItems: 1,
          maxItems: 7,
          uniqueItems: true,
          items: { type: "integer", minimum: 0, maximum: 6 }
        }
      },
      additionalProperties: false
    }
  ],
  "x-workhub-runtime-supported-timezone": true,
  "x-workhub-start-end-must-differ": true
} as const;
const aiProviderModelResponseSchema = {
  type: "object",
  required: [
    "id",
    "model",
    "display_name",
    "context_window_tokens",
    "supports_streaming",
    "supports_tools",
    "cost_input_cny_per_mtok",
    "cost_output_cny_per_mtok"
  ],
  properties: {
    id: aiModelPreferenceStringSchema,
    model: { type: "string", minLength: 1, maxLength: 128 },
    display_name: { type: "string", minLength: 1, maxLength: 128 },
    context_window_tokens: { type: "integer", minimum: 1 },
    supports_streaming: { type: "boolean" },
    supports_tools: { type: "boolean" },
    cost_input_cny_per_mtok: { type: "number", minimum: 0 },
    cost_output_cny_per_mtok: { type: "number", minimum: 0 }
  },
  additionalProperties: false
} as const;
const aiProviderResponseSchema = {
  type: "object",
  required: ["name", "configured", "default_model_id", "models"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 64 },
    configured: { type: "boolean" },
    default_model_id: aiModelPreferenceStringSchema,
    models: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: aiProviderModelResponseSchema,
      description: "Models sorted by id; id values are unique and include default_model_id.",
      "x-workhub-unique-model-ids": true,
      "x-workhub-contains-default-model-id": true
    }
  },
  additionalProperties: false
} as const;
const aiDailyQuotaResponseSchema = {
  type: "object",
  required: ["policy_id", "period", "max_tokens", "max_cost_cny", "enabled"],
  properties: {
    policy_id: { type: "string", minLength: 1 },
    period: { type: "string", const: "day" },
    max_tokens: { type: "integer", minimum: 1 },
    max_cost_cny: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
    enabled: { type: "boolean" }
  },
  additionalProperties: false
} as const;
function aiUsagePeriodResponseSchema(period: "day" | "month") {
  return {
    type: "object",
    required: ["period", "token_in", "token_out", "total_tokens", "estimated_cost_cny"],
    properties: {
      period: { type: "string", const: period },
      token_in: { type: "integer", minimum: 0 },
      token_out: { type: "integer", minimum: 0 },
      total_tokens: { type: "integer", minimum: 0 },
      estimated_cost_cny: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" }
    },
    additionalProperties: false
  } as const;
}
const aiBudgetSummaryResponseSchema = {
  type: "object",
  required: ["daily_quota", "usage"],
  properties: {
    daily_quota: { anyOf: [aiDailyQuotaResponseSchema, { type: "null" }] },
    usage: {
      type: "object",
      required: ["day", "month"],
      properties: {
        day: aiUsagePeriodResponseSchema("day"),
        month: aiUsagePeriodResponseSchema("month")
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;
const userAiProfileResponseSchema = {
  type: "object",
  required: [
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
  ],
  properties: {
    workspace_id: uuidStringSchema,
    user_id: uuidStringSchema,
    default_mode: { type: "integer", minimum: 1, maximum: 5 },
    granular_settings: aiGranularSettingsSchema,
    dispatch_policy: { type: "string", enum: ["auto", "ask", "manual"] },
    cuu_proactivity: { type: "string", enum: ["quiet", "balanced", "proactive"] },
    model_tier_preference: { anyOf: [aiModelPreferenceStringSchema, { type: "null" }] },
    providers: {
      type: "array",
      maxItems: 100,
      items: aiProviderResponseSchema,
      description: "Providers sorted by name. API keys and base URLs are never returned."
    },
    budget_summary: aiBudgetSummaryResponseSchema,
    generated_at: dateTimeStringSchema,
    updated_at: { anyOf: [dateTimeStringSchema, { type: "null" }] }
  },
  additionalProperties: false
} as const;
const projectAiGovernanceResponseSchema = {
  type: "object",
  required: [
    "project_id",
    "observer_enabled",
    "silence_window_seconds",
    "quiet_hours",
    "granular_settings",
    "risk_monitor",
    "updated_at"
  ],
  properties: {
    project_id: uuidStringSchema,
    observer_enabled: { type: "boolean" },
    silence_window_seconds: { type: "integer", minimum: 0, maximum: 86400 },
    quiet_hours: aiQuietHoursSchema,
    granular_settings: aiGranularSettingsSchema,
    risk_monitor: riskMonitorSettingsSchema,
    updated_at: { anyOf: [dateTimeStringSchema, { type: "null" }] }
  },
  additionalProperties: false
} as const;
const patchUserAiProfileRequestBodySchema = {
  type: "object",
  minProperties: 1,
  properties: {
    default_mode: { type: "integer", minimum: 1, maximum: 5 },
    granular_settings: aiGranularSettingsSchema,
    dispatch_policy: { type: "string", enum: ["auto", "ask", "manual"] },
    cuu_proactivity: { type: "string", enum: ["quiet", "balanced", "proactive"] },
    model_tier_preference: {
      anyOf: [aiModelPreferenceStringSchema, { type: "null" }],
      description: "Non-null values must match a provider model id returned by this resource."
    }
  },
  additionalProperties: false
} as const;
const patchProjectAiGovernanceRequestBodySchema = {
  type: "object",
  minProperties: 1,
  properties: {
    observer_enabled: { type: "boolean" },
    silence_window_seconds: { type: "integer", minimum: 0, maximum: 86400 },
    quiet_hours: aiQuietHoursSchema,
    granular_settings: aiGranularSettingsSchema,
    risk_monitor: riskMonitorSettingsSchema
  },
  additionalProperties: false
} as const;
const aiAuthRequiredResponse = jsonErrorStatusResponse(
  "401",
  "AI settings require an authenticated user",
  ["not_identified"]
).responses["401"];
const aiInternalResponse = jsonErrorStatusResponse(
  "500",
  "AI settings output assembly or an unexpected dependency failed",
  ["internal_contract_error", "internal_error"]
).responses["500"];
const aiPayloadTooLargeResponse = jsonErrorStatusResponse(
  "413",
  "AI settings request body exceeds the configured global JSON limit",
  ["payload_too_large"]
).responses["413"];
// R13 批 A2（派人推荐 v2）：GET/PATCH /me/profile ——「我是谁」资料面，与 /me/ai-profile
// （「AI 该怎么替我干活」）语义分开。形状钉死 packages/contracts/src/domain/user-profile.ts 的
// userProfileVmSchema / patchUserProfileRequestSchema。
const userProfileVmResponseSchema = {
  type: "object",
  required: ["user_id", "nickname", "title", "bio_md", "skill_tags", "onboarded_at"],
  properties: {
    user_id: uuidStringSchema,
    nickname: { type: "string", minLength: 1, maxLength: 64 },
    title: { type: ["string", "null"], minLength: 1, maxLength: 128 },
    bio_md: { type: ["string", "null"], minLength: 1, maxLength: 4000 },
    skill_tags: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 64 }
    },
    onboarded_at: { type: ["string", "null"], format: "date-time" }
  },
  additionalProperties: false
} as const;
const patchUserProfileRequestBodySchema = {
  type: "object",
  properties: {
    title: { type: ["string", "null"], minLength: 1, maxLength: 128 },
    bio_md: { type: ["string", "null"], minLength: 1, maxLength: 4000 },
    skill_tags: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 64 }
    }
  },
  additionalProperties: false
} as const;
// R14 批 AVATAR：头像三端点。上传为二进制 body（webp/png/jpeg magic bytes 校验+256KB 硬顶），
// 读取带 ETag（avatar_updated_at 毫秒值）/If-None-Match 304 缓存；404=不可见或没有头像。
const avatarUpdatedAtResponseSchema = {
  type: "object",
  required: ["avatar_updated_at"],
  properties: {
    avatar_updated_at: { type: ["string", "null"], format: "date-time" }
  },
  additionalProperties: false
} as const;
const userAvatarPutResponses = {
  responses: {
    "200": jsonDataResponse(avatarUpdatedAtResponseSchema, "Avatar stored").responses["200"],
    "400": jsonErrorStatusResponse("400", "Avatar payload is not a supported image", [
      "avatar_invalid_image"
    ]).responses["400"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Avatar update is not authorized", [
      "invalid_client_token",
      "user_avatar_access_denied"
    ]).responses["403"],
    "413": jsonErrorStatusResponse("413", "Avatar exceeds the 256KB limit", [
      "avatar_too_large"
    ]).responses["413"],
    "500": aiInternalResponse
  }
} as const;
const userAvatarDeleteResponses = {
  responses: {
    "200": jsonDataResponse(avatarUpdatedAtResponseSchema, "Avatar removed").responses["200"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Avatar removal is not authorized", [
      "invalid_client_token",
      "user_avatar_access_denied"
    ]).responses["403"],
    "500": aiInternalResponse
  }
} as const;
const userAvatarGetResponses = {
  responses: {
    "200": {
      description: "Avatar image bytes",
      content: {
        "image/webp": { schema: { type: "string", format: "binary" } },
        "image/png": { schema: { type: "string", format: "binary" } },
        "image/jpeg": { schema: { type: "string", format: "binary" } }
      }
    },
    "304": { description: "Not modified (If-None-Match hit)" },
    "401": aiAuthRequiredResponse,
    "404": jsonErrorStatusResponse("404", "Avatar is not visible or not set", [
      "user_avatar_not_found"
    ]).responses["404"],
    "500": aiInternalResponse
  }
} as const;

const userProfileReadResponses = {
  responses: {
    "200": jsonDataResponse(userProfileVmResponseSchema, "Current user's profile").responses["200"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Profile is not accessible", [
      "invalid_client_token",
      "user_profile_access_denied"
    ]).responses["403"],
    "500": aiInternalResponse
  }
} as const;
const userProfilePatchResponses = {
  responses: {
    "200": jsonDataResponse(userProfileVmResponseSchema, "Updated profile").responses["200"],
    "400": jsonErrorStatusResponse("400", "Profile body is not a JSON object", [
      "malformed_json",
      "json_object_required"
    ]).responses["400"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "Profile update is not authorized", [
      "invalid_client_token",
      "user_profile_access_denied"
    ]).responses["403"],
    "422": jsonErrorStatusResponse("422", "Profile patch is invalid", ["validation_error"]).responses["422"],
    "500": aiInternalResponse
  }
} as const;

const userAiProfileReadResponses = {
  responses: {
    "200": jsonDataResponse(userAiProfileResponseSchema, "Current user's AI profile and usage summary").responses["200"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "AI profile is not accessible", [
      "invalid_client_token",
      "ai_profile_access_denied"
    ]).responses["403"],
    "500": aiInternalResponse
  }
} as const;
const userAiProfilePatchResponses = {
  responses: {
    "200": jsonDataResponse(userAiProfileResponseSchema, "Updated AI profile and usage summary").responses["200"],
    "400": jsonErrorStatusResponse("400", "AI profile body is not a JSON object", [
      "malformed_json",
      "json_object_required"
    ]).responses["400"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "AI profile update is not authorized", [
      "invalid_client_token",
      "forbidden",
      "ai_profile_access_denied"
    ]).responses["403"],
    "413": aiPayloadTooLargeResponse,
    "422": jsonErrorStatusResponse("422", "AI profile patch is invalid or unavailable", [
      "validation_error",
      "ai_model_preference_unavailable"
    ]).responses["422"],
    "500": aiInternalResponse
  }
} as const;
const projectAiGovernanceReadResponses = {
  responses: {
    "200": jsonDataResponse(projectAiGovernanceResponseSchema, "Project AI governance for its owner").responses["200"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "AI governance authentication failed", [
      "invalid_client_token"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Project AI governance was not found", [
      "ai_governance_not_found"
    ]).responses["404"],
    "500": aiInternalResponse
  }
} as const;
const projectAiGovernancePatchResponses = {
  responses: {
    "200": jsonDataResponse(projectAiGovernanceResponseSchema, "Updated project AI governance").responses["200"],
    "400": jsonErrorStatusResponse("400", "AI governance body is not a JSON object", [
      "malformed_json",
      "json_object_required"
    ]).responses["400"],
    "401": aiAuthRequiredResponse,
    "403": jsonErrorStatusResponse("403", "AI governance update failed request authorization", [
      "invalid_client_token",
      "forbidden"
    ]).responses["403"],
    "404": jsonErrorStatusResponse("404", "Project AI governance was not found", [
      "ai_governance_not_found"
    ]).responses["404"],
    "413": aiPayloadTooLargeResponse,
    "422": jsonErrorStatusResponse("422", "AI governance patch does not match the contract", [
      "validation_error"
    ]).responses["422"],
    "500": aiInternalResponse
  }
} as const;

export function getOpenApiDocument() {
  return withInferredPathParameters({
    openapi: "3.1.0",
    info: {
      title: "WorkHub Headless Agent Daemon",
      version: "0.1.0"
    },
    paths: {
      "/api/health": {
        get: {
          tags: ["system"],
          summary: "Check daemon health",
          ...rawJsonResponse(healthResponseSchema, "Daemon liveness payload")
        }
      },
      "/api/ready": {
        get: {
          tags: ["system"],
          summary: "Check database and broker readiness",
          ...readinessProbeResponses
        }
      },
      "/api/auth/identify": {
        post: {
          tags: ["auth"],
          summary: "Identify or create a nickname-mode user",
          ...jsonRequestBody(identifyRequestBodySchema),
          ...identifyResponses
        }
      },
      "/api/auth/desktop-bootstrap": {
        post: {
          tags: ["auth"],
          summary: "Bootstrap a desktop client token in nickname mode",
          ...jsonRequestBody(desktopBootstrapRequestBodySchema),
          ...desktopBootstrapResponses
        }
      },
      "/api/auth/register": {
        post: {
          tags: ["auth"],
          summary: "Password registration (AUTH_MODE!=nickname); first user bootstraps as admin",
          ...jsonRequestBody(passwordRegisterRequestBodySchema),
          ...passwordRegisterResponses
        }
      },
      "/api/auth/login": {
        post: {
          tags: ["auth"],
          summary: "Password login (AUTH_MODE!=nickname); mints a server-side session cookie",
          ...jsonRequestBody(passwordLoginRequestBodySchema),
          ...passwordLoginResponses
        }
      },
      "/api/auth/logout": {
        post: {
          tags: ["auth"],
          summary: "Rotate the cookie token, revoke the session, and clear the session cookie",
          ...authLogoutResponses
        }
      },
      "/api/users": {
        get: {
          tags: ["auth"],
          summary: "List active member refs in the authenticated actor workspace for delegation pickers",
          responses: {
            "200": {
              description: "Active member refs in the actor workspace sorted by nickname (max 200)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "data"],
                    properties: {
                      ok: { type: "boolean", const: true },
                      data: {
                        type: "object",
                        required: ["users"],
                        properties: {
                          users: {
                            type: "array",
                            items: {
                              type: "object",
                              required: ["id", "nickname", "is_admin"],
                              properties: {
                                id: uuidStringSchema,
                                nickname: { type: "string", minLength: 1 },
                                is_admin: { type: "boolean" }
                              },
                              additionalProperties: false
                            }
                          }
                        },
                        additionalProperties: false
                      }
                    },
                    additionalProperties: false
                  }
                }
              }
            },
            ...jsonErrorStatusResponse("401", "Member listing requires an authenticated user", ["not_identified"]).responses,
            ...jsonErrorStatusResponse("403", "Member listing requires an active membership in the actor workspace", [
              "workspace_membership_required"
            ]).responses,
            ...jsonErrorStatusResponse("501", "Member listing is not supported by the active storage", ["users_unsupported"]).responses
          }
        }
      },
      "/api/auth/password": {
        post: {
          tags: ["auth"],
          summary: "Change the current user's password (AUTH_MODE!=nickname); rotates sessions",
          ...jsonRequestBody(passwordChangeRequestBodySchema),
          ...passwordChangeResponses
        }
      },
      "/api/auth/users/{id}/deactivate": {
        post: {
          tags: ["auth"],
          summary: "Admin: deactivate a user (soft-delete + revoke sessions/devices)",
          parameters: [pathUuidParameter("id")],
          ...authDeactivateResponses
        }
      },
      "/api/auth/invites": {
        get: {
          tags: ["auth"],
          summary: "Admin: list pending (unexpired, unaccepted) invites for the workspace (never returns tokens)",
          parameters: [
            {
              name: "status",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["pending"], default: "pending" },
              description: "Only 'pending' is supported"
            }
          ],
          ...authInviteListResponses
        },
        post: {
          tags: ["auth"],
          summary: "Admin: create an out-of-band invite, returns a one-time token",
          ...jsonRequestBody(inviteCreateRequestBodySchema),
          ...authInviteCreateResponses
        }
      },
      "/api/auth/invites/{inviteId}": {
        delete: {
          tags: ["auth"],
          summary: "Admin: revoke a pending invite in the caller's workspace (soft-delete)",
          parameters: [pathUuidParameter("inviteId")],
          ...authInviteRevokeResponses
        }
      },
      "/api/auth/invites/accept": {
        post: {
          tags: ["auth"],
          summary: "Accept an invite token: create account + credential + membership + session",
          ...jsonRequestBody(inviteAcceptRequestBodySchema),
          ...authInviteAcceptResponses
        }
      },
      "/api/auth/preferences": {
        patch: {
          tags: ["auth"],
          summary: "Update the current user's lightweight preferences such as locale",
          ...jsonRequestBody(updateUserPreferencesRequestBodySchema),
          ...authPreferencesResponses
        }
      },
      "/api/auth/me": {
        get: {
          tags: ["auth"],
          summary: "Read the current authenticated identity",
          ...rawJsonResponse(authMeResponseSchema, "Current authenticated identity or null")
        }
      },
      "/api/client-devices/register": {
        post: {
          tags: ["client-devices"],
          summary: "Register a local client device and mint a client token",
          ...jsonRequestBody(clientDeviceRegisterRequestBodySchema),
          ...clientDeviceRegisterResponse
        }
      },
      "/api/client-devices/me": {
        get: {
          tags: ["client-devices"],
          summary: "List the current user's registered client devices",
          ...clientDeviceListResponse
        }
      },
      "/api/client-devices/current": {
        get: {
          tags: ["client-devices"],
          summary: "Read the device represented by the presented client token",
          ...clientDeviceCurrentResponse
        }
      },
      "/api/client-devices/{deviceId}/revoke": {
        post: {
          tags: ["client-devices"],
          summary: "Revoke one of the current user's client devices",
          parameters: [pathUuidParameter("deviceId")],
          ...clientDeviceRevokeResponse
        }
      },
      "/api/client-devices/revoke-current": {
        post: {
          tags: ["client-devices"],
          summary: "Revoke the currently presented local client device",
          ...clientDeviceRevokeCurrentResponse
        }
      },
      "/api/approvals": {
        get: {
          tags: ["approvals"],
          summary: "List approvals visible to the current user",
          ...approvalListResponse
        }
      },
      "/api/approvals/respond-batch": {
        post: {
          tags: ["approvals"],
          summary: "Batch-allow selected pending approvals (allow only; deny requires per-item reason)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["ids"],
                  properties: {
                    ids: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 50 }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Per-item results",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      data: {
                        type: "object",
                        properties: {
                          approved: { type: "integer" },
                          skipped: { type: "integer" }
                        }
                      }
                    }
                  }
                }
              }
            },
            // API-08：空选择按全局错误信封回 422。
            ...jsonErrorStatusResponse("422", "Batch request has no usable approval ids", [
              "field_value_required"
            ]).responses
          }
        }
      },
      "/api/approvals/{id}/respond": {
        post: {
          tags: ["approvals"],
          summary: "Allow or deny a pending approval",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(respondApprovalRequestBodySchema),
          ...approvalRespondResponse
        }
      },
      "/api/approvals/{id}/delegate": {
        post: {
          tags: ["approvals"],
          summary: "Delegate a pending approval to another active user",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(delegateApprovalRequestBodySchema),
          ...approvalDelegateResponse
        }
      },
      "/api/approvals/{id}/comments": {
        get: {
          tags: ["approvals"],
          summary: "List comments for an approval",
          parameters: [pathUuidParameter("id")],
          ...approvalCommentListResponse
        },
        post: {
          tags: ["approvals"],
          summary: "Add a comment to an approval",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(addApprovalCommentRequestBodySchema),
          ...approvalCommentCreateResponse
        }
      },
      "/api/escalations/{id}/resolve": {
        post: {
          tags: ["escalations"],
          summary: "Resolve an unresolved escalation by retrying, taking over, or cancelling",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          ...jsonRequestBody(resolveEscalationRequestBodySchema),
          ...escalationResolveResponse
        }
      },
      "/api/escalations/{id}/budget-actions/{actionId}": {
        post: {
          tags: ["escalations"],
          summary: "Resolve a durable budget escalation by recording the selected budget action",
          parameters: [
            pathUuidParameter("id"),
            {
              name: "actionId",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 64 }
            },
            localeQueryParameter
          ],
          ...escalationBudgetResolveResponse
        }
      },
      "/api/escalations/{id}/delegate": {
        post: {
          tags: ["escalations"],
          summary: "Delegate an unresolved escalation to another active user",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          ...jsonRequestBody(delegateEscalationRequestBodySchema),
          ...escalationDelegateResponse
        }
      },
      "/api/memory-conflicts/{id}/resolve/{resolution}": {
        post: {
          tags: ["memory-conflicts"],
          summary: "Resolve a durable memory synchronization conflict",
          parameters: [
            pathUuidParameter("id"),
            {
              name: "resolution",
              in: "path",
              required: true,
              schema: memoryConflictResolutionResponseSchema
            },
            optionalDateTimeQueryParameter("expected_updated_at")
          ],
          ...jsonRequestBody(memoryConflictResolveRequestBodySchema, { required: false }),
          ...memoryConflictResolveResponse
        }
      },
      "/api/permissions": {
        get: {
          tags: ["permissions"],
          summary: "List permission policies",
          ...permissionPolicyListResponse
        },
        put: {
          tags: ["permissions"],
          summary: "Create or update a permission policy",
          ...jsonRequestBody(permissionPolicyWriteRequestBodySchema),
          ...permissionPolicyWriteResponse
        }
      },
      "/api/permissions/{id}": {
        delete: {
          tags: ["permissions"],
          summary: "Revoke a permission policy",
          parameters: [pathUuidParameter("id")],
          ...permissionPolicyDeleteResponse
        }
      },
      "/api/permissions/ask": {
        post: {
          tags: ["permissions"],
          summary: "Create a user-routed approval request",
          ...jsonRequestBody(createApprovalRequestBodySchema),
          ...permissionApprovalAskResponse
        }
      },
      "/api/pages/attention": {
        get: {
          tags: ["pages"],
          summary: "AI-first attention home page",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(attentionHomePageResponseSchema)
        }
      },
      "/api/pages/gold-path": {
        get: {
          tags: ["pages"],
          summary: "P0.5 gold path page VM bundle",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(goldPathSurfacePageResponseSchema)
        }
      },
      "/api/pages/workitems/{id}": {
        get: {
          tags: ["pages"],
          summary: "Work item detail page VM",
          parameters: [
            pathUuidParameter("id"),
            localeQueryParameter
          ],
          ...workItemDetailPageResponse
        }
      },
      "/api/pages/proposals/{id}": {
        get: {
          tags: ["pages"],
          summary: "Proposal detail page VM",
          parameters: [
            pathUuidParameter("id"),
            localeQueryParameter
          ],
          ...proposalDetailPageResponse
        }
      },
      "/api/pages/drive": {
        get: {
          tags: ["pages"],
          summary: "Project drive page VM",
          parameters: [
            optionalUuidQueryParameter("project_id"),
            optionalUuidQueryParameter("item_id"),
            localeQueryParameter
          ],
          ...drivePageResponse
        }
      },
      "/api/pages/project/{id}": {
        get: {
          tags: ["pages"],
          summary: "GitHub-like project home page VM",
          parameters: [
            pathUuidParameter("id"),
            localeQueryParameter
          ],
          ...projectHomePageResponse
        }
      },
      "/api/pages/project/{id}/timeline": {
        get: {
          tags: ["pages"],
          summary: "Project timeline (gantt) page VM: milestones, scheduled items, and critical path",
          parameters: [
            pathUuidParameter("id"),
            localeQueryParameter
          ],
          ...projectTimelinePageResponse
        }
      },
      "/api/pages/workbench/{projectId}": {
        get: {
          tags: ["pages"],
          summary: "Bounded desktop workbench bootstrap VM",
          description: "Returns only current tenant-safe project, conversation, workspace-member, active-plan, and recent-file sources. Conversation-scoped runs, outputs, and background tasks are intentionally deferred.",
          parameters: [
            pathUuidParameter("projectId"),
            localeQueryParameter
          ],
          "x-workhub-invariants": [
            "Exactly one conversation is kind=main; every conversation matches data.project.id and workspace_id.",
            "conversations.capped is true if and only if conversations.next_cursor is non-null.",
            "workspace_members.total is at least returned; returned equals items.length; capped is true if and only if total is greater than returned.",
            "Exactly one returned workspace member is self; it is first and matches viewer.user_id, viewer.membership_role, and viewer.is_project_owner.",
            "At most one returned workspace member is the project owner.",
            "army_summary and recent_project_files expose their empty_state exactly when their corresponding result is empty."
          ],
          ...workbenchPageResponses
        }
      },
      "/api/pages/meetings": {
        get: {
          tags: ["pages"],
          summary: "Meeting insights page VM",
          parameters: [
            optionalUuidQueryParameter("project_id"),
            optionalUuidQueryParameter("m"),
            optionalUuidQueryParameter("meeting_id"),
            localeQueryParameter
          ],
          ...meetingPageResponse
        }
      },
      "/api/pages/notifications": {
        get: {
          tags: ["pages"],
          summary: "Notification inbox page VM grouped by decision, FYI, and done",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(notificationPageResponseSchema)
        }
      },
      "/api/pages/calendar": {
        get: {
          tags: ["pages"],
          summary: "Calendar page VM with schedule events, work item due dates, and meeting follow-ups",
          parameters: [
            optionalDateOnlyQueryParameter("date"),
            calendarViewQueryParameter,
            localeQueryParameter
          ],
          ...calendarPageResponse
        }
      },
      "/api/pages/health": {
        get: {
          tags: ["pages"],
          summary: "Project health page VM with permission-filtered signal bands per project",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(projectHealthPageResponseSchema)
        }
      },
      "/api/pages/agents": {
        get: {
          tags: ["pages"],
          summary: "Agent army dashboard page VM",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(agentArmyDashboardPageResponseSchema)
        }
      },
      "/api/pages/skills": {
        get: {
          tags: ["pages"],
          summary: "Team skills page VM",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(teamSkillsPageResponseSchema)
        }
      },
      "/api/pages/settings": {
        get: {
          tags: ["pages"],
          summary: "Settings page VM",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(settingsPageResponseSchema)
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/download": {
        get: {
          tags: ["drive"],
          summary: "Download a stored project drive file",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("itemId")
          ],
          ...driveDownloadResponse
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/preview": {
        get: {
          tags: ["drive"],
          summary: "Preview a text-like project drive file",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("itemId")
          ],
          ...drivePreviewResponse
        }
      },
      "/api/drive/projects/{projectId}/files": {
        post: {
          tags: ["drive"],
          summary: "Upload a minimal project drive file and return the refreshed Drive Page VM",
          parameters: [pathUuidParameter("projectId"), localeQueryParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["filename", "parsed_text"],
                  properties: {
                    filename: { type: "string", minLength: 1, maxLength: 256 },
                    parent_id: {
                      anyOf: [
                        { type: "string", format: "uuid" },
                        { type: "null" }
                      ]
                    },
                    mime: { type: "string", minLength: 1, maxLength: 128 },
                    parsed_text: { type: "string", minLength: 1, maxLength: 200000 }
                  }
                }
              },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    filename: { type: "string", minLength: 1, maxLength: 256 },
                    parent_id: { type: "string", format: "uuid" },
                    mime: { type: "string", minLength: 1, maxLength: 128 },
                    parsed_text: { type: "string", maxLength: 200000 }
                  }
                }
              }
            }
          },
          responses: {
            ...jsonOkResponse(drivePageResponseSchema).responses,
            ...jsonErrorStatusResponse("400", "Drive upload payload is missing required file content", [
              "drive_file_missing",
              "drive_file_content_missing"
            ]).responses,
            ...driveForbiddenResponse.responses,
            ...driveProjectMissingResponse.responses,
            ...jsonErrorStatusResponse("413", "Drive upload file is too large", [
              "drive_file_too_large"
            ]).responses,
            ...jsonErrorStatusResponse("409", "Drive upload cannot be completed in the selected folder", [
              "drive_parent_deleted",
              "drive_name_conflict"
            ]).responses
          }
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/delete": {
        post: {
          tags: ["drive"],
          summary: "Move a project drive item to the recycle area",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("itemId"),
            localeQueryParameter
          ],
          ...jsonRequestBody({
            type: "object",
            properties: {
              expected_current_version_id: {
                anyOf: [
                  uuidStringSchema,
                  { type: "null" }
                ]
              }
            },
            additionalProperties: false
          }, { required: false }),
          responses: {
            ...jsonOkResponse(drivePageResponseSchema).responses,
            ...driveForbiddenResponse.responses,
            ...driveItemMissingResponse.responses,
            ...jsonErrorStatusResponse("409", "Drive item cannot be deleted in its current state", [
              "drive_current_version_changed",
              "drive_folder_not_empty",
              "drive_item_already_deleted",
              "drive_accepted_deliverable_locked"
            ]).responses
          }
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/restore": {
        post: {
          tags: ["drive"],
          summary: "Restore a recycled project drive item",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("itemId"),
            localeQueryParameter
          ],
          responses: {
            ...jsonOkResponse(drivePageResponseSchema).responses,
            ...driveForbiddenResponse.responses,
            ...driveItemMissingResponse.responses,
            ...jsonErrorStatusResponse("409", "Drive item cannot be restored in its current state", [
              "drive_item_not_deleted",
              "drive_parent_deleted",
              "drive_name_conflict"
            ]).responses
          }
        }
      },
      "/api/drive/projects/{projectId}/comments": {
        post: {
          tags: ["drive"],
          summary: "Post a drive comment (enters pending_llm; can later become a draft)",
          parameters: [pathUuidParameter("projectId"), localeQueryParameter],
          ...jsonRequestBody({
            type: "object",
            required: ["body"],
            properties: {
              body: { type: "string", minLength: 1, maxLength: 4000 },
              folder_id: uuidStringSchema
            },
            additionalProperties: false
          }),
          responses: {
            ...jsonOkResponse(drivePageResponseSchema).responses,
            ...driveForbiddenResponse.responses
          }
        }
      },
      "/api/drive/projects/{projectId}/comments/{commentId}/draft": {
        post: {
          tags: ["drive"],
          summary: "Create or return a work item draft from a project drive comment",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("commentId"),
            localeQueryParameter
          ],
          responses: {
            ...jsonOkResponse(drivePageResponseSchema).responses,
            ...driveForbiddenResponse.responses,
            ...driveCommentMissingResponse.responses,
            ...jsonErrorStatusResponse("409", "Drive comment cannot be converted to a draft in its current state", [
              "drive_comment_draft_exists",
              "drive_comment_draft_missing",
              "drive_comment_not_pending"
            ]).responses
          }
        }
      },
      "/api/drive/workitems/{workItemId}/proposal-draft": {
        post: {
          tags: ["drive"],
          summary: "Create or return a deterministic proposal from a Drive comment work item draft",
          parameters: [pathUuidParameter("workItemId"), localeQueryParameter],
          responses: {
            ...jsonOkResponse(workItemDetailResponseSchema).responses,
            ...driveDraftProposalForbiddenResponse.responses,
            ...driveDraftProposalMissingResponse.responses,
            ...jsonErrorStatusResponse("409", "Drive comment draft cannot create a proposal in its current state", [
              "drive_draft_source_missing",
              "drive_comment_dismissed"
            ]).responses
          }
        }
      },
      "/api/meetings/{meetingId}/analyze": {
        post: {
          tags: ["meetings"],
          summary: "Regenerate the AI minutes and insights for one meeting",
          parameters: [pathUuidParameter("meetingId"), localeQueryParameter],
          responses: {
            ...jsonOkResponse(meetingPageResponseSchema).responses,
            "401": meetingMutationNotIdentifiedResponse,
            "403": meetingInsightForbiddenResponse,
            "404": meetingInsightNotFoundResponse,
            ...jsonErrorStatusResponse("409", "Meeting analysis could not run", [
              "meeting_analysis_unsupported",
              "meeting_analysis_budget_exhausted",
              "meeting_analysis_failed"
            ]).responses,
            ...jsonErrorStatusResponse("503", "AI analysis is not configured on this deployment", [
              "meeting_analysis_unavailable"
            ]).responses
          }
        }
      },
      "/api/meetings/projects/{projectId}/import": {
        post: {
          tags: ["meetings"],
          summary: "Import a meeting transcript (title + text) into a project",
          parameters: [pathUuidParameter("projectId"), localeQueryParameter],
          ...jsonRequestBody({
            type: "object",
            required: ["title", "transcript_text"],
            properties: {
              title: { type: "string", minLength: 1, maxLength: 256 },
              transcript_text: { type: "string", minLength: 1, maxLength: 200000 }
            },
            additionalProperties: false
          }),
          responses: {
            ...jsonOkResponse(meetingPageResponseSchema).responses,
            "401": meetingMutationNotIdentifiedResponse,
            "403": meetingInsightForbiddenResponse,
            "404": meetingInsightNotFoundResponse,
            ...jsonErrorStatusResponse("409", "Meeting transcript import rejected", [
              "meeting_import_invalid",
              "meeting_import_unsupported"
            ]).responses
          }
        }
      },
      "/api/meetings/projects/{projectId}/insights/{insightId}/draft": {
        post: {
          tags: ["meetings"],
          summary: "Create or return a work item draft from a meeting insight",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("insightId"),
            localeQueryParameter
          ],
          responses: {
            ...jsonOkResponse(meetingPageResponseSchema).responses,
            "401": meetingMutationNotIdentifiedResponse,
            "403": meetingInsightForbiddenResponse,
            "404": meetingInsightNotFoundResponse,
            ...jsonErrorStatusResponse("409", "Meeting insight cannot be converted to a draft in its current state", [
              "meeting_insight_not_pending",
              "meeting_insight_draft_missing",
              "meeting_insight_rationale_missing"
            ]).responses
          }
        }
      },
      "/api/meetings/projects/{projectId}/insights/{insightId}/dismiss": {
        post: {
          tags: ["meetings"],
          summary: "Dismiss a pending meeting insight",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("insightId"),
            localeQueryParameter
          ],
          responses: {
            ...jsonOkResponse(meetingPageResponseSchema).responses,
            "401": meetingMutationNotIdentifiedResponse,
            "403": meetingInsightForbiddenResponse,
            "404": meetingInsightNotFoundResponse,
            ...jsonErrorStatusResponse("409", "Meeting insight cannot be dismissed in its current state", [
              "meeting_insight_not_pending"
            ]).responses
          }
        }
      },
      "/api/meetings/workitems/{workItemId}/proposal-draft": {
        post: {
          tags: ["meetings"],
          summary: "Create or return a deterministic proposal from a meeting-created work item draft",
          parameters: [pathUuidParameter("workItemId"), localeQueryParameter],
          responses: {
            ...jsonOkResponse(workItemDetailResponseSchema).responses,
            "401": meetingMutationNotIdentifiedResponse,
            "403": meetingDraftProposalForbiddenResponse,
            "404": meetingDraftProposalNotFoundResponse,
            ...jsonErrorStatusResponse("409", "Meeting insight draft cannot create a proposal in its current state", [
              "meeting_draft_source_missing",
              "meeting_insight_dismissed"
            ]).responses
          }
        }
      },
      "/api/notifications/{id}/read": {
        post: {
          tags: ["notifications"],
          summary: "Mark one notification as read",
          parameters: [pathUuidParameter("id")],
          ...notificationItemMutationResponse("Updated notification")
        }
      },
      "/api/notifications": {
        get: {
          tags: ["notifications"],
          summary: "List notifications for the current user",
          ...notificationListResponse
        }
      },
      "/api/notifications/preferences": {
        get: {
          tags: ["notifications"],
          summary: "Read notification mute preferences",
          ...notificationPreferencesReadResponse
        },
        put: {
          tags: ["notifications"],
          summary: "Update notification mute preferences",
          ...jsonRequestBody(notificationPreferencesRequestBodySchema),
          ...notificationPreferencesUpdateResponse
        }
      },
      "/api/notifications/read-all": {
        post: {
          tags: ["notifications"],
          summary: "Mark all current user's notifications as read",
          ...notificationReadAllResponse
        }
      },
      "/api/notifications/{id}/dismiss": {
        post: {
          tags: ["notifications"],
          summary: "Dismiss and archive one notification",
          parameters: [pathUuidParameter("id")],
          ...notificationItemMutationResponse("Archived notification")
        }
      },
      "/api/notifications/{id}/complete": {
        post: {
          tags: ["notifications"],
          summary: "Complete and archive an FYI notification",
          description: "Notifications that still require a decision must be opened at their source; the runtime returns notification_needs_decision instead of archiving them.",
          parameters: [pathUuidParameter("id")],
          ...notificationCompleteResponse
        }
      },
      "/api/notifications/{id}/snooze": {
        post: {
          tags: ["notifications"],
          summary: "Pause reminders for one notification",
          description: "Clears the reminder ladder (next_remind_at) without marking the notification read or archived, so it stays in the decision queue but stops the 24h nudges.",
          parameters: [pathUuidParameter("id")],
          ...notificationItemMutationResponse("Notification with reminders paused")
        }
      },
      "/api/workitems/{id}/proposals": {
        post: {
          tags: ["proposals"],
          summary: "Create a deliverable change proposal from a manifest",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(createProposalRequestSchema),
          ...createProposalResponse
        }
        // R20 R19-29：GET（list-work-item-proposals）已删——web/desktop 均无调用点，数据早已内嵌进工作项
        // 详情页 VM（GET /api/pages/workitems/{id}）。核实零消费后连路由一并删除，POST 不受影响。
      },
      "/api/workitems/{id}/task-plan": {
        post: {
          tags: ["task-plans"],
          summary: "Decompose a work item into a task plan proposal",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          ...jsonRequestBody(createTaskPlanRequestSchema, { required: false }),
          ...createTaskPlanResponse
        }
      },
      "/api/task-plans/{planId}/pause": {
        post: {
          tags: ["task-plans"],
          summary: "Pause dispatching new subtasks for a task plan (running child runs keep going)",
          parameters: [pathUuidParameter("planId")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["plan_id", "status"],
              properties: {
                plan_id: uuidStringSchema,
                status: taskPlanStatusResponseSchema
              },
              additionalProperties: false
            }, "Plan paused").responses["200"],
            ...jsonErrorStatusResponse("409", "Plan is not currently dispatching", ["task_plan_pause_conflict"]).responses
          }
        }
      },
      "/api/task-plans/{planId}/resume": {
        post: {
          tags: ["task-plans"],
          summary: "Resume dispatching for a paused task plan and kick the dispatcher once",
          parameters: [pathUuidParameter("planId")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["plan_id", "status"],
              properties: {
                plan_id: uuidStringSchema,
                status: taskPlanStatusResponseSchema
              },
              additionalProperties: false
            }, "Plan resumed").responses["200"],
            ...jsonErrorStatusResponse("409", "Plan is not paused", ["task_plan_resume_conflict"]).responses,
            ...jsonErrorStatusResponse("503", "Resume dispatch kick failed; plan reverted to paused", ["task_plan_resume_dispatch_failed"]).responses
          }
        }
      },
      "/api/workitems/{id}/conflicts": {
        get: {
          tags: ["proposals"],
          summary: "List current proposal conflicts and clickable resolution options for a work item",
          parameters: [pathUuidParameter("id")],
          ...proposalConflictListResponse
        }
      },
      "/api/projects": {
        get: {
          tags: ["projects"],
          summary: "List projects visible to the current actor",
          ...projectListResponse
        }
      },
      "/api/projects/bootstrap": {
        post: {
          tags: ["projects"],
          summary: "Bootstrap or return a project workspace",
          ...jsonRequestBody({
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 128 },
              slug: { type: "string", minLength: 1, maxLength: 64 },
              description: { type: "string", maxLength: 2000 }
            },
            additionalProperties: false
          }, { required: false }),
          ...bootstrapProjectResponse
        }
      },
      "/api/projects/{id}/conversations": {
        get: {
          tags: ["conversations"],
          summary: "List conversations visible in a project",
          "x-workhub-query-constraints": {
            allOrNone: [["afterCreatedAt", "afterId"]]
          },
          parameters: [
            pathUuidParameter("id"),
            conversationAfterCreatedAtQueryParameter,
            conversationAfterIdQueryParameter,
            conversationLimitQueryParameter
          ],
          ...conversationProjectListResponses
        },
        post: {
          tags: ["conversations"],
          summary: "Create a collaboration conversation in a project",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(createConversationRequestBodySchema),
          ...conversationProjectCreateResponses
        }
      },
      "/api/conversations/{id}/messages": {
        get: {
          tags: ["conversations"],
          summary: "List conversation messages after (or, with beforeSeq, before) a sequence cursor",
          "x-workhub-query-constraints": {
            exclusive: [["afterSeq", "beforeSeq"]]
          },
          parameters: [
            pathUuidParameter("id"),
            conversationAfterSeqQueryParameter,
            conversationBeforeSeqQueryParameter,
            conversationLimitQueryParameter
          ],
          ...conversationMessageListResponses
        },
        post: {
          tags: ["conversations"],
          summary: "Create a text message or authorized Drive file card",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(createConversationMessageRequestBodySchema),
          ...conversationMessageCreateResponses
        }
      },
      "/api/dm/open": {
        post: {
          tags: ["conversations"],
          summary: "Open (or reuse) the direct-message conversation with another workspace member",
          ...jsonRequestBody(openDmRequestBodySchema),
          ...dmOpenResponses
        }
      },
      "/api/dm/list": {
        get: {
          tags: ["conversations"],
          summary: "List the direct-message conversations the caller participates in",
          ...dmListResponses
        }
      },
      "/api/conversations/{id}": {
        patch: {
          tags: ["conversations"],
          summary: "Rename a collab conversation (main conversations cannot be renamed)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["title"],
            properties: { title: { type: "string", minLength: 1, maxLength: 256 } },
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse(
              {
                type: "object",
                required: ["conversation"],
                properties: { conversation: conversationResponseSchema },
                additionalProperties: false
              },
              "The renamed conversation VM"
            ).responses["200"],
            "400": jsonErrorStatusResponse("400", "Rename payload is malformed", [
              "malformed_json",
              "json_object_required"
            ]).responses["400"],
            "401": conversationAuthRequiredResponse,
            "403": jsonErrorStatusResponse("403", "Only collab participants may rename, and never the main area", [
              "invalid_client_token",
              "forbidden",
              "human_required",
              "conversation_rename_forbidden"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"])
              .responses["404"],
            "413": conversationPayloadTooLargeResponse,
            "422": conversationValidationResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/conversations/{id}/messages/{messageId}": {
        patch: {
          tags: ["conversations"],
          summary: "Edit your own text message within the 15-minute window",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId")],
          ...jsonRequestBody(editConversationMessageRequestBodySchema),
          ...conversationMessageEditResponses
        },
        delete: {
          tags: ["conversations"],
          summary: "Tombstone your own message (idempotent, content cleared, seq kept)",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId")],
          ...conversationMessageDeleteResponses
        }
      },
      "/api/conversations/{id}/messages/{messageId}/reactions/{key}": {
        put: {
          tags: ["conversations"],
          summary: "Add a curated reaction to a message (idempotent)",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId"), conversationReactionKeyPathParameter],
          ...conversationReactionAddResponses
        },
        delete: {
          tags: ["conversations"],
          summary: "Remove your reaction from a message (idempotent)",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId"), conversationReactionKeyPathParameter],
          ...conversationReactionRemoveResponses
        }
      },
      "/api/conversations/{id}/messages/{messageId}/pin": {
        put: {
          tags: ["conversations"],
          summary: "Pin a message for every conversation viewer",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId")],
          ...conversationPinAddResponses
        },
        delete: {
          tags: ["conversations"],
          summary: "Unpin a message (idempotent)",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId")],
          ...conversationPinRemoveResponses
        }
      },
      "/api/conversations/{id}/pins": {
        get: {
          tags: ["conversations"],
          summary: "List pinned messages, newest sequence first (cap 50)",
          parameters: [pathUuidParameter("id")],
          ...conversationPinListResponses
        }
      },
      "/api/conversations/{id}/read": {
        put: {
          tags: ["conversations"],
          summary: "Advance your read cursor (monotonic, clamped to the max sequence)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(advanceReadCursorRequestBodySchema),
          ...conversationReadAdvanceResponses
        }
      },
      "/api/conversations/{id}/receipts": {
        get: {
          tags: ["conversations"],
          summary: "List every read cursor for the aggregate read indicator",
          parameters: [pathUuidParameter("id")],
          ...conversationReceiptsResponses
        }
      },
      "/api/conversations/{id}/cuu": {
        patch: {
          tags: ["conversations"],
          summary: "Toggle whether Cuu participates in a collab conversation (main is 409)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(updateConversationCuuRequestBodySchema),
          ...conversationCuuUpdateResponses
        }
      },
      "/api/conversations/{id}/participants": {
        get: {
          tags: ["conversations"],
          summary: "List conversation participants (main: scope=workspace + empty list; collab/DM: real rows)",
          parameters: [pathUuidParameter("id")],
          ...conversationParticipantsResponses
        },
        post: {
          tags: ["conversations"],
          summary: "Add a member to a non-dm collab conversation (main/DM are 409, idempotent on duplicates)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(addConversationParticipantRequestBodySchema),
          ...addConversationParticipantResponses
        }
      },
      "/api/conversations/{id}/participants/{userId}": {
        delete: {
          tags: ["conversations"],
          summary: "Leave (self) or remove (owner) a member; owner leaving promotes the earliest successor",
          parameters: [pathUuidParameter("id"), pathUuidParameter("userId")],
          ...removeConversationParticipantResponses
        }
      },
      "/api/workspace/members": {
        get: {
          tags: ["conversations"],
          summary: "List the workspace member roster (admin/owner only): nickname, role, joined-at, is-self",
          ...listWorkspaceMembersResponses
        }
      },
      "/api/workspace/roster": {
        get: {
          tags: ["conversations"],
          summary: "Page the caller's workspace roster (any member): nickname, role, joined-at, is-self, avatar/online placeholders",
          parameters: [...workspaceRosterQueryParameters],
          ...listWorkspaceRosterResponses
        }
      },
      "/api/workspace/members/{userId}": {
        delete: {
          tags: ["conversations"],
          summary: "Remove a workspace member (admin/owner only; cannot remove self or the last admin)",
          parameters: [pathUuidParameter("userId")],
          ...removeWorkspaceMemberResponses
        },
        patch: {
          tags: ["conversations"],
          summary: "Change a workspace member's role (admin/owner only; cannot demote the last admin)",
          parameters: [pathUuidParameter("userId")],
          ...jsonRequestBody(updateWorkspaceMemberRoleRequestBodySchema),
          ...updateWorkspaceMemberRoleResponses
        }
      },
      "/api/workspace/audit": {
        get: {
          tags: ["conversations"],
          summary: "List workspace-scoped audit logs (admin only): actor/action/time filters, paginated, newest first",
          parameters: [
            optionalUuidQueryParameter("actor_user_id"),
            {
              name: "action",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 64 }
            },
            optionalDateTimeQueryParameter("from"),
            optionalDateTimeQueryParameter("to"),
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 200 }
            },
            optionalNonNegativeIntegerQueryParameter("offset")
          ],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["generated_at", "workspace_id", "audit_logs", "page"],
              properties: {
                generated_at: dateTimeStringSchema,
                workspace_id: uuidStringSchema,
                audit_logs: { type: "array", items: { type: "object", additionalProperties: true } },
                page: {
                  type: "object",
                  required: ["limit", "offset", "count"],
                  properties: {
                    limit: { type: "integer", minimum: 1 },
                    offset: { type: "integer", minimum: 0 },
                    count: { type: "integer", minimum: 0 }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            }, "Workspace audit log page").responses["200"],
            "401": jsonErrorStatusResponse("401", "Workspace audit requires an authenticated user", [
              "not_identified"
            ]).responses["401"],
            "403": jsonErrorStatusResponse("403", "Workspace audit is admin-only", [
              "forbidden"
            ]).responses["403"]
          }
        }
      },
      "/api/mcp-servers": {
        get: {
          tags: ["settings"],
          summary: "Admin-only: registered MCP servers, what this process currently sees of each connection, and which server-side secret variables can be referenced",
          responses: {
            "200": jsonDataResponse(
              mcpServerListJsonSchema,
              "Every MCP server registered in this workspace"
            ).responses["200"],
            "403": mcpAdminForbiddenResponse.responses["403"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        },
        post: {
          tags: ["settings"],
          summary: "Admin-only: register an MCP server (static health check, then register, then hand-shake with the new list)",
          ...jsonRequestBody(addMcpServerRequestJsonSchema),
          responses: {
            "201": jsonDataStatusResponse(
              mcpServerActionResultJsonSchema,
              "201",
              "Registered; status and connection say whether the handshake actually worked"
            ).responses["201"],
            "400": jsonErrorStatusResponse("400", "The request body was not a JSON object", [
              "malformed_json",
              "json_object_required"
            ]).responses["400"],
            "403": mcpAdminForbiddenResponse.responses["403"],
            "409": jsonErrorStatusResponse("409", "That name is already used by another server in this workspace", [
              "mcp_server_name_taken"
            ]).responses["409"],
            "422": mcpPrecheckRefusedResponse.responses["422"],
            "413": conversationPayloadTooLargeResponse,
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/mcp-servers/{id}/enable": {
        post: {
          tags: ["settings"],
          summary: "Admin-only: enable an MCP server and hand-shake with it again",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(
              mcpServerActionResultJsonSchema,
              "The server after the reconnect attempt"
            ).responses["200"],
            "403": mcpAdminForbiddenResponse.responses["403"],
            "404": mcpServerNotFoundResponse.responses["404"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/mcp-servers/{id}/disable": {
        post: {
          tags: ["settings"],
          summary: "Admin-only: disable an MCP server — its process is reclaimed and its tools stop appearing in any run",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(mcpServerActionResultJsonSchema, "The server, now disabled").responses["200"],
            "403": mcpAdminForbiddenResponse.responses["403"],
            "404": mcpServerNotFoundResponse.responses["404"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/mcp-servers/{id}/reload": {
        post: {
          tags: ["settings"],
          summary: "Admin-only: test the connection — hand-shake again and report honestly (a failed connection is a 200 answer, not an HTTP error)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(
              mcpServerActionResultJsonSchema,
              "The server plus what this process now sees; a failure shows up in status and last_error"
            ).responses["200"],
            "403": mcpAdminForbiddenResponse.responses["403"],
            "404": mcpServerNotFoundResponse.responses["404"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/mcp-servers/{id}": {
        patch: {
          tags: ["settings"],
          summary: "Admin-only: change the trust ceiling, the per-call timeout, the plain environment variables or the secret references",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(updateMcpServerRequestJsonSchema),
          responses: {
            "200": jsonDataResponse(
              mcpServerActionResultJsonSchema,
              "The server after the change, reconnected so the running process uses the new settings"
            ).responses["200"],
            "400": jsonErrorStatusResponse("400", "The request body was not a JSON object", [
              "malformed_json",
              "json_object_required"
            ]).responses["400"],
            "403": mcpAdminForbiddenResponse.responses["403"],
            "404": mcpServerNotFoundResponse.responses["404"],
            "422": mcpPrecheckRefusedResponse.responses["422"],
            "413": conversationPayloadTooLargeResponse,
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        },
        delete: {
          tags: ["settings"],
          summary: "Admin-only: remove an MCP server from the registry (the program on disk is left alone)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "204": conversationNoContentResponse,
            "403": mcpAdminForbiddenResponse.responses["403"],
            "404": mcpServerNotFoundResponse.responses["404"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/plugins": {
        get: {
          tags: ["settings"],
          summary: "Admin-only: installed plugins, the host's bundled dsh-tools version, and how many paths still come from the environment",
          responses: {
            "200": jsonDataResponse(pluginListJsonSchema, "Every plugin registered in this workspace").responses["200"],
            "403": pluginAdminForbiddenResponse.responses["403"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        },
        post: {
          tags: ["settings"],
          summary: "Admin-only: install a plugin from a local directory (static health check, then register, then try to load)",
          ...jsonRequestBody(installPluginRequestJsonSchema),
          responses: {
            "201": jsonDataStatusResponse(
              pluginVmJsonSchema,
              "201",
              "Registered; status says whether the host could actually load it"
            ).responses["201"],
            "400": jsonErrorStatusResponse("400", "The request body was not a JSON object", [
              "malformed_json",
              "json_object_required"
            ]).responses["400"],
            "403": pluginAdminForbiddenResponse.responses["403"],
            "409": jsonErrorStatusResponse("409", "That directory is already installed in this workspace", [
              "plugin_already_installed"
            ]).responses["409"],
            "422": jsonErrorStatusResponse(
              "422",
              "The static health check refused it: unreadable manifest, a browser-side UI/theme plugin, or install-time scripts",
              [
                "validation_error",
                "plugin_manifest_unreadable",
                "plugin_client_surface_unsupported",
                "plugin_install_scripts_refused",
                "plugin_incompatible"
              ]
            ).responses["422"],
            "413": conversationPayloadTooLargeResponse,
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/plugins/{id}": {
        patch: {
          tags: ["settings"],
          summary: "Admin-only: set the risk ceiling asserted for a plugin",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(updatePluginTrustRequestJsonSchema),
          responses: {
            "200": jsonDataResponse(pluginVmJsonSchema, "The plugin at its new trust level").responses["200"],
            "400": jsonErrorStatusResponse("400", "The request body was not a JSON object", [
              "malformed_json",
              "json_object_required"
            ]).responses["400"],
            "403": pluginAdminForbiddenResponse.responses["403"],
            "404": pluginNotFoundResponse.responses["404"],
            "422": jsonErrorStatusResponse("422", "trust_level is not one of the two accepted values", [
              "validation_error"
            ]).responses["422"],
            "413": conversationPayloadTooLargeResponse,
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        },
        delete: {
          tags: ["settings"],
          summary: "Admin-only: remove a plugin from the registry (the directory on disk is left alone)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(
              {
                type: "object",
                required: ["removed"],
                properties: { removed: { type: "boolean", const: true } },
                additionalProperties: false
              },
              "The plugin no longer contributes tools to any run"
            ).responses["200"],
            "403": pluginAdminForbiddenResponse.responses["403"],
            "404": pluginNotFoundResponse.responses["404"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/plugins/{id}/enable": {
        post: {
          tags: ["settings"],
          summary: "Admin-only: enable a plugin and try to load it again (the host hot-reloads)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(pluginVmJsonSchema, "The plugin after the reload attempt").responses["200"],
            "403": pluginAdminForbiddenResponse.responses["403"],
            "404": pluginNotFoundResponse.responses["404"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/plugins/{id}/disable": {
        post: {
          tags: ["settings"],
          summary: "Admin-only: disable a plugin — its tools stop appearing in any run",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(pluginVmJsonSchema, "The plugin, now disabled").responses["200"],
            "403": pluginAdminForbiddenResponse.responses["403"],
            "404": pluginNotFoundResponse.responses["404"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/presence": {
        get: {
          tags: ["conversations"],
          summary: "Presence for up to 50 same-workspace members, driven by SSE heartbeats",
          parameters: [presenceUserIdsQueryParameter],
          ...presenceListResponses
        }
      },
      "/api/search": {
        get: {
          tags: ["search"],
          summary: "Global substring search across conversations, drive, work items, and meetings",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              description: "Search text, 2 to 64 characters after trimming",
              schema: { type: "string", minLength: 2, maxLength: 64 }
            },
            {
              name: "scopes",
              in: "query",
              required: false,
              description: "Comma-separated subset of conversations,drive,work_items,meetings; defaults to all",
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Per-scope result cap, 1 to 25, default 10",
              schema: { type: "integer", minimum: 1, maximum: 25 }
            }
          ],
          ...searchResponses
        }
      },
      "/api/conversations/{id}/messages/{messageId}/feedback": {
        put: {
          tags: ["feedback"],
          summary: "Rate a living Cuu text reply useful or not (idempotent upsert)",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId")],
          ...jsonRequestBody(putAiFeedbackRequestBodySchema),
          ...aiFeedbackPutResponses("Conversation, message, or rateable Cuu reply was not found", [
            "conversation_not_found",
            "ai_feedback_subject_not_found"
          ])
        },
        delete: {
          tags: ["feedback"],
          summary: "Clear your feedback on a Cuu reply (idempotent)",
          parameters: [pathUuidParameter("id"), pathUuidParameter("messageId")],
          ...aiFeedbackDeleteResponses("Conversation, message, or rateable Cuu reply was not found", [
            "conversation_not_found",
            "ai_feedback_subject_not_found"
          ])
        }
      },
      "/api/proposals/{id}/feedback": {
        put: {
          tags: ["feedback"],
          summary: "Rate a proposal useful or not (idempotent upsert)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(putAiFeedbackRequestBodySchema),
          ...aiFeedbackPutResponses("Proposal was not found or is not visible", ["ai_feedback_subject_not_found"])
        },
        delete: {
          tags: ["feedback"],
          summary: "Clear your feedback on a proposal (idempotent)",
          parameters: [pathUuidParameter("id")],
          ...aiFeedbackDeleteResponses("Proposal was not found or is not visible", [
            "ai_feedback_subject_not_found"
          ])
        }
      },
      "/api/action-card-items/{id}/feedback": {
        put: {
          tags: ["feedback"],
          summary: "Rate an action card item useful or not (idempotent upsert)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(putAiFeedbackRequestBodySchema),
          ...aiFeedbackPutResponses("Action card item was not found in your workspace", [
            "ai_feedback_subject_not_found"
          ])
        },
        delete: {
          tags: ["feedback"],
          summary: "Clear your feedback on an action card item (idempotent)",
          parameters: [pathUuidParameter("id")],
          ...aiFeedbackDeleteResponses("Action card item was not found in your workspace", [
            "ai_feedback_subject_not_found"
          ])
        }
      },
      "/api/projects/{id}/github-binding": {
        get: {
          tags: ["github"],
          summary: "Read the project GitHub binding status (never returns any token material)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(githubBindingStatusJsonSchema, "Binding status").responses["200"],
            "401": conversationAuthRequiredResponse,
            "403": githubBindingOwnerForbiddenResponse,
            "404": githubBindingNotFoundResponse,
            "422": conversationValidationResponse,
            "500": conversationInternalResponse
          }
        },
        put: {
          tags: ["github"],
          summary: "Bind or update the repo and PAT (verified against GitHub before AES-GCM storage)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(githubBindingRequestJsonSchema),
          responses: {
            "200": jsonDataResponse(githubBindingStatusJsonSchema, "Binding updated").responses["200"],
            "201": jsonDataStatusResponse(githubBindingStatusJsonSchema, "201", "Binding created").responses[
              "201"
            ],
            "401": conversationAuthRequiredResponse,
            "403": githubBindingOwnerForbiddenResponse,
            "404": githubBindingNotFoundResponse,
            "413": conversationPayloadTooLargeResponse,
            "422": jsonErrorStatusResponse("422", "Request body or GitHub connection check failed", [
              "validation_error",
              "github_binding_connection_failed"
            ]).responses["422"],
            "500": conversationInternalResponse,
            "503": githubEncryptionUnconfiguredResponse
          }
        },
        delete: {
          tags: ["github"],
          summary: "Unbind and physically destroy the ciphertext (works even without the enc key)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "204": conversationNoContentResponse,
            "401": conversationAuthRequiredResponse,
            "403": githubBindingOwnerForbiddenResponse,
            "404": githubBindingNotFoundResponse,
            "422": conversationValidationResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/projects/{id}/github-binding/test": {
        post: {
          tags: ["github"],
          summary: "Test a PAT/repo pair (or the stored binding) without persisting anything",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(githubTestConnectionRequestJsonSchema),
          responses: {
            "200": jsonDataResponse(githubTestConnectionResultJsonSchema, "Connection check outcome").responses[
              "200"
            ],
            "401": conversationAuthRequiredResponse,
            "403": githubBindingOwnerForbiddenResponse,
            "404": githubBindingNotFoundResponse,
            "413": conversationPayloadTooLargeResponse,
            "422": jsonErrorStatusResponse("422", "Request body failed validation or repo is required", [
              "validation_error",
              "github_binding_repo_required"
            ]).responses["422"],
            "500": conversationInternalResponse,
            "503": githubEncryptionUnconfiguredResponse
          }
        }
      },
      "/api/me/memories": {
        get: {
          tags: ["memory"],
          summary: "List your own active memories, optionally filtered by category",
          parameters: [
            {
              name: "category",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["preference", "correction", "recurring_context"] }
            }
          ],
          responses: {
            "200": jsonDataResponse(userMemoryManagementPageJsonSchema, "Your active memories with provenance")
              .responses["200"],
            ...memoryGovernanceAuthResponses
          }
        }
      },
      "/api/me/memories/{id}": {
        get: {
          tags: ["memory"],
          summary: "Read one of your memories",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(userMemoryManagementItemJsonSchema, "One memory with provenance").responses[
              "200"
            ],
            "404": userMemoryNotFoundResponse,
            ...memoryGovernanceAuthResponses
          }
        },
        patch: {
          tags: ["memory"],
          summary: "Replace the memory text with optimistic concurrency",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(patchUserMemoryRequestJsonSchema),
          responses: {
            "200": jsonDataResponse(userMemoryManagementItemJsonSchema, "The edited memory").responses["200"],
            "400": jsonErrorStatusResponse("400", "Memory text failed validation", [
              "malformed_json",
              "json_object_required",
              "user_memory_value_required",
              "user_memory_value_too_long",
              "user_memory_value_injection"
            ]).responses["400"],
            "404": userMemoryNotFoundResponse,
            "409": jsonErrorStatusResponse("409", "Memory changed concurrently or was deleted", [
              "user_memory_version_conflict",
              "user_memory_deleted"
            ]).responses["409"],
            "413": conversationPayloadTooLargeResponse,
            ...memoryGovernanceAuthResponses
          }
        },
        delete: {
          tags: ["memory"],
          summary: "Soft-delete a memory so Cuu forgets it (idempotent)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(
              {
                type: "object",
                required: ["deleted"],
                properties: { deleted: { type: "boolean", const: true } },
                additionalProperties: false
              },
              "The memory is gone from every prompt injection"
            ).responses["200"],
            "404": userMemoryNotFoundResponse,
            ...memoryGovernanceAuthResponses
          }
        }
      },
      "/api/team-skills/manage": {
        get: {
          tags: ["memory"],
          summary: "List every team skill version for the management surface",
          responses: {
            "200": jsonDataResponse(teamSkillManagementPageJsonSchema, "All versions, active and deprecated")
              .responses["200"],
            ...memoryGovernanceAuthResponses
          }
        }
      },
      "/api/team-skills/manage/{id}": {
        get: {
          tags: ["memory"],
          summary: "Read one team skill version with its full content",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse(teamSkillManagementItemJsonSchema, "One skill version").responses["200"],
            "404": teamSkillNotFoundResponse,
            ...memoryGovernanceAuthResponses
          }
        },
        patch: {
          tags: ["memory"],
          summary: "Admin-only sectioned edit patch producing a new human version",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(patchTeamSkillRequestJsonSchema),
          responses: {
            "200": jsonDataResponse(teamSkillManagementItemJsonSchema, "The new active version").responses[
              "200"
            ],
            "400": jsonErrorStatusResponse("400", "Edit patch failed the K2 validation gates", [
              "malformed_json",
              "json_object_required",
              "team_skill_edit_no_ops_applied",
              "team_skill_edit_no_effective_change",
              "team_skill_edit_invalid_frontmatter",
              "team_skill_edit_too_short",
              "team_skill_edit_exceeds_size_budget",
              "team_skill_edit_conflict_markers",
              "team_skill_edit_injection_phrasing",
              "team_skill_edit_low_confidence"
            ]).responses["400"],
            "403": jsonErrorStatusResponse("403", "Team skill editing requires an admin", [
              "invalid_client_token",
              "forbidden",
              "human_required",
              "team_skill_admin_required"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Active team skill was not found or the version is read-only", [
              "team_skill_not_found",
              "team_skill_not_editable"
            ]).responses["404"],
            "409": jsonErrorStatusResponse("409", "base_version does not match the active version", [
              "team_skill_base_version_conflict"
            ]).responses["409"],
            "413": conversationPayloadTooLargeResponse,
            "401": conversationAuthRequiredResponse,
            "422": conversationValidationResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/team-skills/curate-now": {
        post: {
          tags: ["memory"],
          summary: "Admin-only: run one round of nightly team-skill self-learning right now",
          responses: {
            "202": jsonDataStatusResponse(
              {
                type: "object",
                required: ["started", "curation"],
                properties: {
                  started: { type: "boolean", const: true },
                  curation: teamSkillCurationStatusResponseSchema
                },
                additionalProperties: false
              },
              "202",
              "The round runs in the background; read the skills page for its outcome"
            ).responses["202"],
            "403": jsonErrorStatusResponse("403", "Triggering a self-learning round requires an admin", [
              "invalid_client_token",
              "forbidden",
              "human_required",
              "team_skill_admin_required"
            ]).responses["403"],
            "409": jsonErrorStatusResponse(
              "409",
              "A round is already running, or self-learning is switched off on this deployment",
              ["team_skill_curation_in_progress", "team_skill_curation_disabled"]
            ).responses["409"],
            "503": jsonErrorStatusResponse("503", "This deployment has no LLM API key configured", [
              "ai_provider_not_configured"
            ]).responses["503"],
            "401": conversationAuthRequiredResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/team-skills/manage/{id}/deactivate": {
        post: {
          tags: ["memory"],
          summary: "Admin-only kill switch: deprecate a team skill (idempotent)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(
            {
              type: "object",
              properties: { reason: { type: "string", maxLength: 500 } },
              additionalProperties: false
            },
            { required: false }
          ),
          responses: {
            "200": jsonDataResponse(
              {
                type: "object",
                required: ["deprecated"],
                properties: { deprecated: { type: "boolean", const: true } },
                additionalProperties: false
              },
              "The skill no longer feeds the planner"
            ).responses["200"],
            "403": jsonErrorStatusResponse("403", "Team skill deactivation requires an admin", [
              "invalid_client_token",
              "forbidden",
              "human_required",
              "team_skill_admin_required"
            ]).responses["403"],
            "404": teamSkillNotFoundResponse,
            "413": conversationPayloadTooLargeResponse,
            "401": conversationAuthRequiredResponse,
            "422": conversationValidationResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/conversations/{id}/army": {
        get: {
          tags: ["conversations"],
          summary: "Conversation context panel: derived runs, output links, background tasks",
          parameters: [
            pathUuidParameter("id"),
            conversationAfterCreatedAtQueryParameter,
            conversationAfterIdQueryParameter,
            armyLimitQueryParameter
          ],
          ...conversationArmyPanelResponses
        }
      },
      "/api/me/army": {
        get: {
          tags: ["conversations"],
          summary: "Cross-project army overview for the current user",
          parameters: [
            conversationAfterCreatedAtQueryParameter,
            conversationAfterIdQueryParameter,
            armyLimitQueryParameter
          ],
          ...armyOverviewResponses
        }
      },
      "/api/army/background": {
        get: {
          tags: ["conversations"],
          summary: "Army background: pulse scheduler heartbeat + current user's recent proactive intents",
          ...armyBackgroundResponses
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/versions": {
        get: {
          tags: ["drive"],
          summary: "List a drive file's version history (append-only, capped)",
          parameters: [pathUuidParameter("projectId"), pathUuidParameter("itemId")],
          responses: {
            "200": jsonDataResponse(
              {
                type: "object",
                properties: {
                  items: { type: "array", maxItems: 100, items: { type: "object" } },
                  capped: { type: "boolean" }
                },
                required: ["items", "capped"],
                additionalProperties: false
              },
              "Version rows, newest first"
            ).responses["200"],
            "401": conversationAuthRequiredResponse,
            "403": conversationForbiddenResponse,
            "404": jsonErrorStatusResponse("404", "Drive file is inaccessible or was not found", [
              "drive_item_not_found"
            ]).responses["404"],
            "500": conversationInternalResponse
          }
        }
      },
      "/api/drive/projects/{projectId}/items/{itemId}/versions/{versionId}/restore": {
        post: {
          tags: ["drive"],
          summary: "Restore a historical version by appending a new version (history is never deleted; audited)",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("itemId"),
            pathUuidParameter("versionId")
          ],
          responses: {
            "200": jsonDataResponse({ type: "object" }, "The newly appended current version").responses["200"],
            "401": conversationAuthRequiredResponse,
            "403": conversationForbiddenResponse,
            "404": jsonErrorStatusResponse("404", "Drive file or version is inaccessible or was not found", [
              "drive_item_not_found",
              "drive_version_not_found"
            ]).responses["404"],
            "500": conversationInternalResponse
          }
        }
      },
      "/api/me/personal-projects": {
        get: {
          tags: ["projects"],
          summary: "List the current user's personal spaces",
          responses: {
            "200": jsonDataResponse({ type: "object", description: "Personal projects list (capped)." }, "Personal spaces").responses["200"],
            "401": conversationAuthRequiredResponse,
            "403": conversationForbiddenResponse,
            "500": conversationInternalResponse
          }
        },
        post: {
          tags: ["projects"],
          summary: "Create a personal space (auto-named when the name is blank; observer defaults off)",
          ...jsonRequestBody({
            type: "object",
            properties: { name: { type: "string", maxLength: 128 } },
            additionalProperties: false
          }),
          responses: {
            "201": jsonDataStatusResponse({ type: "object", description: "Created personal project." }, "201", "Created a personal space").responses["201"],
            "400": jsonErrorStatusResponse("400", "Personal space input is malformed", ["malformed_json", "json_object_required"]).responses["400"],
            "401": conversationAuthRequiredResponse,
            "403": conversationForbiddenResponse,
            "413": conversationPayloadTooLargeResponse,
            "422": conversationValidationResponse,
            "500": conversationInternalResponse
          }
        }
      },
      "/api/spotlight/intent": {
        post: {
          tags: ["spotlight"],
          summary: "Classify a natural-language spotlight query into an actionable intent (PM persona, non-streaming)",
          ...jsonRequestBody({
            type: "object",
            properties: {
              query: { type: "string", minLength: 1, maxLength: 512 },
              capabilities: { type: "array", maxItems: 32, items: { type: "string", maxLength: 64 } }
            },
            required: ["query"],
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse(
              {
                type: "object",
                description: "Intent verdict: open_page / new_project / create_task / answer with confidence and params.",
              },
              "Classified intent"
            ).responses["200"],
            "401": conversationAuthRequiredResponse,
            "403": conversationForbiddenResponse,
            "422": conversationValidationResponse,
            "429": jsonErrorStatusResponse("429", "Team budget is exhausted for AI intents", [
              "spotlight_intent_budget_exhausted"
            ]).responses["429"],
            "500": jsonErrorStatusResponse("500", "Intent classification failed; nothing was executed", [
              "spotlight_intent_failed",
              "internal_contract_error",
              "internal_error"
            ]).responses["500"]
          }
        }
      },
      "/api/conversations/{id}/typing": {
        post: {
          tags: ["conversations"],
          summary: "Publish a transient typing presence ping (server-throttled, never persisted)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "202": jsonDataResponse(
              {
                type: "object",
                properties: { published: { type: "boolean" } },
                required: ["published"],
                additionalProperties: false,
                description: "published=false means the ping was throttled away; both outcomes are success."
              },
              "Typing ping accepted (published or throttled)"
            ).responses["200"],
            "401": conversationAuthRequiredResponse,
            "403": conversationForbiddenResponse,
            "404": jsonErrorStatusResponse("404", "Conversation was not found", ["conversation_not_found"]).responses[
              "404"
            ],
            "500": conversationInternalResponse
          }
        }
      },
      "/api/conversations/{id}/turns": {
        post: {
          tags: ["conversations"],
          summary: "Run one streaming Cuu turn in a collab conversation (deltas over SSE, final reply persisted)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(conversationTurnRequestBodySchema),
          ...conversationTurnResponses
        }
      },
      "/api/action-card-items/{id}/decide": {
        post: {
          tags: ["conversations"],
          summary: "Decide a waiting action-card item as its addressed owner (claim, reassign, or defer)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(decideActionCardItemRequestBodySchema),
          ...actionCardDecideResponses
        }
      },
      "/api/action-card-items/{id}/undo": {
        post: {
          tags: ["conversations"],
          summary: "Undo a dispatched action-card item inside its undo window (abort run, close work item, leave a trace)",
          parameters: [pathUuidParameter("id")],
          ...actionCardUndoResponses
        }
      },
      "/api/me/ai-profile": {
        get: {
          tags: ["ai-settings"],
          summary: "Read the current user's AI profile, provider metadata, and usage summary",
          ...userAiProfileReadResponses
        },
        patch: {
          tags: ["ai-settings"],
          summary: "Update the current user's AI preferences",
          ...jsonRequestBody(patchUserAiProfileRequestBodySchema),
          ...userAiProfilePatchResponses
        }
      },
      "/api/me/avatar": {
        put: {
          tags: ["user-profile"],
          summary: "Upload the current user's avatar (binary body, webp/png/jpeg, 256KB cap)",
          requestBody: {
            required: true,
            content: { "image/*": { schema: { type: "string", format: "binary" } } }
          },
          ...userAvatarPutResponses
        },
        delete: {
          tags: ["user-profile"],
          summary: "Remove the current user's avatar (falls back to the initial tile)",
          ...userAvatarDeleteResponses
        }
      },
      "/api/users/{id}/avatar": {
        get: {
          tags: ["user-profile"],
          summary: "Read a workspace member's avatar with ETag caching",
          parameters: [pathUuidParameter("id")],
          ...userAvatarGetResponses
        }
      },
      "/api/me/profile": {
        get: {
          tags: ["user-profile"],
          summary: "Read the current user's profile (title, bio, skill tags)",
          ...userProfileReadResponses
        },
        patch: {
          tags: ["user-profile"],
          summary: "Update the current user's profile",
          ...jsonRequestBody(patchUserProfileRequestBodySchema),
          ...userProfilePatchResponses
        }
      },
      "/api/projects/{id}/ai-governance": {
        get: {
          tags: ["ai-settings"],
          summary: "Read project AI governance as the active project owner",
          parameters: [pathUuidParameter("id")],
          ...projectAiGovernanceReadResponses
        },
        patch: {
          tags: ["ai-settings"],
          summary: "Update project AI governance as the active project owner",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(patchProjectAiGovernanceRequestBodySchema),
          ...projectAiGovernancePatchResponses
        }
      },
      "/api/proposals/{id}": {
        get: {
          tags: ["proposals"],
          summary: "Read a deliverable change proposal",
          parameters: [pathUuidParameter("id")],
          ...readProposalResponse
        }
      },
      "/api/proposals/{id}/changes/{changeId}/preview": {
        get: {
          tags: ["proposals"],
          summary: "Preview a proposal manifest change inline when it carries generated text",
          parameters: [pathUuidParameter("id"), pathUuidParameter("changeId")],
          ...proposalChangePreviewResponse
        }
      },
      "/api/proposals/{id}/files/{path}/diff": {
        get: {
          tags: ["proposals"],
          summary: "Tracked-changes diff (base vs proposed) for one manifest change, keyed by URL-encoded path",
          parameters: [
            pathUuidParameter("id"),
            { name: "path", in: "path", required: true, schema: { type: "string" } }
          ],
          ...proposalChangeDiffResponse
        }
      },
      "/api/proposals/{id}/review": {
        post: {
          tags: ["proposals"],
          summary: "Review a deliverable change proposal",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          ...jsonRequestBody(reviewProposalRequestBodySchema),
          ...reviewProposalResponse
        }
      },
      "/api/objectives": {
        post: {
          tags: ["objectives"],
          summary: "Create a team objective with optional key results",
          ...jsonRequestBody({
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string", minLength: 1, maxLength: 256 },
              description_md: { type: "string", maxLength: 4000 },
              key_results: {
                type: "array",
                maxItems: 8,
                items: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string", minLength: 1, maxLength: 256 },
                    target_value: { type: "string", maxLength: 64 },
                    current_value: { type: "string", maxLength: 64 },
                    unit: { type: "string", maxLength: 16 }
                  },
                  additionalProperties: false
                }
              }
            },
            additionalProperties: false
          }),
          responses: {
            "201": jsonDataResponse({
              type: "object",
              required: ["objective_id", "title", "status", "progress_percent"],
              properties: {
                objective_id: uuidStringSchema,
                title: { type: "string", minLength: 1 },
                status: { type: "string", minLength: 1 },
                progress_percent: { type: "integer" }
              },
              additionalProperties: false
            }, "Created objective").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": proposalForbiddenResponse,
            "422": proposalValidationResponse
          }
        }
      },
      "/api/objectives/{id}/link": {
        post: {
          tags: ["objectives"],
          summary: "Link a work item to an objective",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["work_item_id"],
            properties: { work_item_id: uuidStringSchema },
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["objective_id", "work_item_id"],
              properties: {
                objective_id: uuidStringSchema,
                work_item_id: uuidStringSchema
              },
              additionalProperties: false
            }, "Linked objective and work item").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": proposalForbiddenResponse,
            "404": proposalNotFoundResponse,
            "422": proposalValidationResponse
          }
        }
      },
      // R23 F-01（OKR 列表/详情持久化）：objectives 表没有 objective 级的软删/取消枚举以外的状态机变化，
      // status 字段是 objectiveStatuses/keyResultStatuses（active/paused/done/archived、
      // active/done/at_risk/cancelled）——与契约层 packages/contracts/src/enums.ts 保持一致。
      "/api/objectives/{id}": {
        get: {
          tags: ["objectives"],
          summary: "Read one objective's detail (key results + linked work items + linked task plans)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: [
                "objective_id", "title", "description_md", "status", "progress_percent",
                "owner_user_id", "created_at", "updated_at",
                "key_results", "key_results_capped",
                "linked_work_items", "linked_work_items_capped",
                "linked_task_plans", "linked_task_plans_capped"
              ],
              properties: {
                objective_id: uuidStringSchema,
                title: { type: "string", minLength: 1 },
                description_md: { anyOf: [{ type: "string" }, { type: "null" }] },
                status: { type: "string", enum: ["active", "paused", "done", "archived"] },
                progress_percent: { type: "integer" },
                owner_user_id: { anyOf: [uuidStringSchema, { type: "null" }] },
                created_at: dateTimeStringSchema,
                updated_at: dateTimeStringSchema,
                key_results: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "seq", "title", "target_value", "current_value", "unit", "status", "progress_percent"],
                    properties: {
                      id: uuidStringSchema,
                      seq: { type: "integer" },
                      title: { type: "string", minLength: 1 },
                      target_value: { anyOf: [{ type: "string" }, { type: "null" }] },
                      current_value: { anyOf: [{ type: "string" }, { type: "null" }] },
                      unit: { anyOf: [{ type: "string" }, { type: "null" }] },
                      status: { type: "string", enum: ["active", "done", "at_risk", "cancelled"] },
                      progress_percent: { type: "integer" }
                    },
                    additionalProperties: false
                  }
                },
                key_results_capped: { type: "boolean" },
                linked_work_items: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "code", "title", "status"],
                    properties: {
                      id: uuidStringSchema,
                      code: { type: "string", minLength: 1 },
                      title: { anyOf: [{ type: "string" }, { type: "null" }] },
                      status: { type: "string" }
                    },
                    additionalProperties: false
                  }
                },
                linked_work_items_capped: { type: "boolean" },
                linked_task_plans: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "work_item_id", "status", "created_at"],
                    properties: {
                      id: uuidStringSchema,
                      work_item_id: uuidStringSchema,
                      status: { type: "string" },
                      created_at: dateTimeStringSchema
                    },
                    additionalProperties: false
                  }
                },
                linked_task_plans_capped: { type: "boolean" }
              },
              additionalProperties: false
            }, "Objective detail").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": proposalForbiddenResponse,
            "404": proposalNotFoundResponse
          }
        }
      },
      "/api/projects/{id}/milestones": {
        post: {
          tags: ["projects"],
          summary: "Create a project milestone (timeline / gantt)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string", minLength: 1, maxLength: 256 },
              due_at: { anyOf: [dateTimeStringSchema, { type: "null" }] },
              sort: { type: "integer", minimum: 0, maximum: 1000000 }
            },
            additionalProperties: false
          }),
          responses: {
            "201": jsonDataResponse(timelineMilestoneSchema, "Created milestone").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": timelineForbiddenResponse,
            "404": timelineNotFoundResponse,
            "422": timelineValidationResponse
          }
        }
      },
      "/api/projects/{id}/milestones/{milestoneId}": {
        patch: {
          tags: ["projects"],
          summary: "Update a project milestone (title, due date, sort, or open/done status)",
          parameters: [pathUuidParameter("id"), pathUuidParameter("milestoneId")],
          ...jsonRequestBody({
            type: "object",
            properties: {
              title: { type: "string", minLength: 1, maxLength: 256 },
              due_at: { anyOf: [dateTimeStringSchema, { type: "null" }] },
              sort: { type: "integer", minimum: 0, maximum: 1000000 },
              status: { type: "string", enum: ["open", "done"] }
            },
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse(timelineMilestoneSchema, "Updated milestone").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": timelineForbiddenResponse,
            "404": timelineNotFoundResponse,
            "422": timelineValidationResponse
          }
        },
        delete: {
          tags: ["projects"],
          summary: "Soft-delete a project milestone",
          parameters: [pathUuidParameter("id"), pathUuidParameter("milestoneId")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["milestone_id"],
              properties: { milestone_id: uuidStringSchema },
              additionalProperties: false
            }, "Deleted milestone").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": timelineForbiddenResponse,
            "404": timelineNotFoundResponse
          }
        }
      },
      "/api/projects/{id}/instructions": {
        get: {
          tags: ["projects"],
          summary: "Read a project's custom instructions (injected into Cuu turns and agent-run worker prompts)",
          parameters: [pathUuidParameter("id")],
          ...projectInstructionsReadResponses
        },
        patch: {
          tags: ["projects"],
          summary: "Update a project's custom instructions",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(patchProjectInstructionsRequestBodySchema),
          ...projectInstructionsPatchResponses
        }
      },
      "/api/projects/{id}/archive": {
        post: {
          tags: ["projects"],
          summary: "Archive a project (soft archived=true; admin or project owner only)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["project", "archived"],
              properties: {
                project: projectResponseSchema,
                archived: { type: "boolean", const: true }
              },
              additionalProperties: false
            }, "Archived project").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": jsonErrorStatusResponse("403", "Project is not manageable by the current user", [
              "project_forbidden"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Project was not found or is already archived/deleted", [
              "project_not_found"
            ]).responses["404"]
          }
        }
      },
      "/api/projects/{id}/delete": {
        post: {
          tags: ["projects"],
          summary: "Soft-delete a project (tombstone deletedAt; admin or project owner only)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["project", "deleted"],
              properties: {
                project: projectResponseSchema,
                deleted: { type: "boolean", const: true }
              },
              additionalProperties: false
            }, "Soft-deleted project").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": jsonErrorStatusResponse("403", "Project is not manageable by the current user", [
              "project_forbidden"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Project was not found or is already deleted", [
              "project_not_found"
            ]).responses["404"]
          }
        }
      },
      // R23 F-01（OKR 列表/详情持久化）：项目主页 OKR 面板首屏——目标是工作区级实体，这条路由只是给
      // 项目主页一个顺手入口，返回该项目所在工作区的全部目标（不做项目级过滤），与
      // apps/api/src/routes/projects.ts 的实现注释一致。
      "/api/projects/{id}/objectives": {
        get: {
          tags: ["projects"],
          summary: "List a workspace's objectives from a project's home page (objectives are workspace-wide, not project-scoped)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["objectives", "capped"],
              properties: {
                objectives: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["objective_id", "title", "description_md", "status", "progress_percent", "owner_user_id", "updated_at"],
                    properties: {
                      objective_id: uuidStringSchema,
                      title: { type: "string", minLength: 1 },
                      description_md: { anyOf: [{ type: "string" }, { type: "null" }] },
                      status: { type: "string", enum: ["active", "paused", "done", "archived"] },
                      progress_percent: { type: "integer" },
                      owner_user_id: { anyOf: [uuidStringSchema, { type: "null" }] },
                      updated_at: dateTimeStringSchema
                    },
                    additionalProperties: false
                  }
                },
                capped: { type: "boolean" }
              },
              additionalProperties: false
            }, "Workspace objectives list").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": proposalForbiddenResponse,
            "404": jsonErrorStatusResponse("404", "Project was not found", ["project_not_found"]).responses["404"]
          }
        }
      },
      "/api/workitems/{id}/assign": {
        post: {
          tags: ["work-items"],
          summary: "Assign a work item to a workspace member (writes work_item_assignments)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["assignee_user_id"],
            properties: {
              assignee_user_id: uuidStringSchema,
              role: { type: "string", enum: ["lead", "collaborator"] }
            },
            additionalProperties: false
          }),
          responses: {
            "201": jsonDataResponse({
              type: "object",
              required: ["assignment"],
              properties: { assignment: workItemAssignmentResponseSchema },
              additionalProperties: false
            }, "Created or updated assignment").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": jsonErrorStatusResponse("403", "Work item assignees are not manageable by the current user", [
              "forbidden"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Work item was not found", ["not_found"]).responses["404"],
            "409": jsonErrorStatusResponse("409", "Work item has no owning workspace yet", [
              "work_item_workspace_missing"
            ]).responses["409"],
            "422": jsonErrorStatusResponse("422", "Assignee is not a workspace member or payload is invalid", [
              "assignee_not_member",
              "validation_error"
            ]).responses["422"]
          }
        }
      },
      "/api/workitems/{id}/claim": {
        post: {
          tags: ["work-items"],
          summary: "Claim an ownerless work item as the current user (CAS: only when unclaimed)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["work_item_id", "claimed_by_user_id"],
              properties: {
                work_item_id: uuidStringSchema,
                claimed_by_user_id: uuidStringSchema
              },
              additionalProperties: false
            }, "Claimed work item").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": jsonErrorStatusResponse("403", "Work item is not claimable by the current user", [
              "forbidden"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Work item was not found", ["not_found"]).responses["404"],
            "409": jsonErrorStatusResponse("409", "Work item is already claimed or no longer claimable", [
              "work_item_not_claimable"
            ]).responses["409"]
          }
        }
      },
      "/api/workitems/{id}/comments": {
        get: {
          tags: ["work-items"],
          summary: "List a work item's comment thread (workspace members who can view the item)",
          parameters: [pathUuidParameter("id")],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["work_item_id", "comments"],
              properties: {
                work_item_id: uuidStringSchema,
                comments: { type: "array", items: workItemCommentResponseSchema }
              },
              additionalProperties: false
            }, "Work item comments").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": jsonErrorStatusResponse("403", "Work item comments are not visible to the current user", [
              "forbidden"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Work item was not found", ["not_found"]).responses["404"]
          }
        },
        post: {
          tags: ["work-items"],
          summary: "Add a comment to a work item (author is the current user)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["body"],
            properties: { body: { type: "string", minLength: 1, maxLength: 4000 } },
            additionalProperties: false
          }),
          responses: {
            "201": jsonDataResponse(workItemCommentResponseSchema, "Created work item comment").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": jsonErrorStatusResponse("403", "Work item comments are not visible to the current user", [
              "forbidden"
            ]).responses["403"],
            "404": jsonErrorStatusResponse("404", "Work item was not found", ["not_found"]).responses["404"],
            "422": jsonErrorStatusResponse("422", "Comment body does not match the contract", [
              "validation_error"
            ]).responses["422"]
          }
        }
      },
      "/api/workitems/{id}/dependencies": {
        post: {
          tags: ["work-items"],
          summary: "Add a work item dependency (same-project, no self-reference, no cycle)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["depends_on"],
            properties: { depends_on: uuidStringSchema },
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["work_item_id", "depends_on", "created"],
              properties: {
                work_item_id: uuidStringSchema,
                depends_on: uuidStringSchema,
                created: { type: "boolean" }
              },
              additionalProperties: false
            }, "Dependency already present (idempotent)").responses["200"],
            "201": jsonDataResponse({
              type: "object",
              required: ["work_item_id", "depends_on", "created"],
              properties: {
                work_item_id: uuidStringSchema,
                depends_on: uuidStringSchema,
                created: { type: "boolean" }
              },
              additionalProperties: false
            }, "Dependency created").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": timelineForbiddenResponse,
            "404": timelineNotFoundResponse,
            "422": timelineValidationResponse
          }
        },
        delete: {
          tags: ["work-items"],
          summary: "Remove a work item dependency",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["depends_on"],
            properties: { depends_on: uuidStringSchema },
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["work_item_id", "depends_on", "removed"],
              properties: {
                work_item_id: uuidStringSchema,
                depends_on: uuidStringSchema,
                removed: { type: "boolean" }
              },
              additionalProperties: false
            }, "Dependency removed (or already absent)").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": timelineForbiddenResponse,
            "404": timelineNotFoundResponse
          }
        }
      },
      "/api/workitems/{id}/milestone": {
        patch: {
          tags: ["work-items"],
          summary: "Attach or detach a work item's milestone (same-project)",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody({
            type: "object",
            required: ["milestone_id"],
            properties: { milestone_id: { anyOf: [uuidStringSchema, { type: "null" }] } },
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["work_item_id", "milestone_id"],
              properties: {
                work_item_id: uuidStringSchema,
                milestone_id: { anyOf: [uuidStringSchema, { type: "null" }] }
              },
              additionalProperties: false
            }, "Milestone attachment updated").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": timelineForbiddenResponse,
            "404": timelineNotFoundResponse,
            "422": timelineValidationResponse
          }
        }
      },
      "/api/projects/{id}/plan-drafts": {
        post: {
          tags: ["projects"],
          summary: "Draft a project plan (milestones + work items + dependencies) with the planning agent",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          ...jsonRequestBody({
            type: "object",
            required: ["intent"],
            properties: {
              intent: { type: "string", minLength: 1, maxLength: 4000 }
            },
            additionalProperties: false
          }),
          responses: {
            "201": jsonDataResponse(projectPlanDraftSchema, "Created project plan draft (pending review)").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": projectPlannerForbiddenResponse,
            "404": projectPlannerNotFoundResponse,
            "409": projectPlannerConflictResponse,
            "422": projectPlannerValidationResponse,
            "503": projectPlannerUnavailableResponse
          }
        },
        get: {
          tags: ["projects"],
          summary: "List a project's plan drafts",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["drafts"],
              properties: { drafts: { type: "array", items: projectPlanDraftSchema } },
              additionalProperties: false
            }, "Project plan drafts").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": projectPlannerForbiddenResponse,
            "404": projectPlannerNotFoundResponse
          }
        }
      },
      "/api/plan-drafts/{draftId}": {
        get: {
          tags: ["projects"],
          summary: "Get a project plan draft",
          parameters: [pathUuidParameter("draftId"), localeQueryParameter],
          responses: {
            "200": jsonDataResponse(projectPlanDraftSchema, "Project plan draft").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": projectPlannerForbiddenResponse,
            "404": projectPlannerNotFoundResponse
          }
        }
      },
      "/api/plan-drafts/{draftId}/approve": {
        post: {
          tags: ["projects"],
          summary: "Approve a project plan draft (human review)",
          parameters: [pathUuidParameter("draftId"), localeQueryParameter],
          responses: {
            "200": jsonDataResponse(projectPlanDraftSchema, "Approved project plan draft").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": projectPlannerForbiddenResponse,
            "404": projectPlannerNotFoundResponse,
            "409": projectPlannerConflictResponse
          }
        }
      },
      "/api/plan-drafts/{draftId}/reject": {
        post: {
          tags: ["projects"],
          summary: "Reject a project plan draft with a reason (fed back into the next draft)",
          parameters: [pathUuidParameter("draftId"), localeQueryParameter],
          ...jsonRequestBody({
            type: "object",
            required: ["reason"],
            properties: {
              reason: { type: "string", minLength: 1, maxLength: 2000 }
            },
            additionalProperties: false
          }),
          responses: {
            "200": jsonDataResponse(projectPlanDraftSchema, "Rejected project plan draft").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": projectPlannerForbiddenResponse,
            "404": projectPlannerNotFoundResponse,
            "409": projectPlannerConflictResponse,
            "422": projectPlannerValidationResponse
          }
        }
      },
      "/api/plan-drafts/{draftId}/materialize": {
        post: {
          tags: ["projects"],
          summary: "Materialize an approved plan draft into milestones, work items, and dependencies",
          parameters: [pathUuidParameter("draftId"), localeQueryParameter],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["draft", "result"],
              properties: {
                draft: projectPlanDraftSchema,
                result: projectPlanDraftResultSchema
              },
              additionalProperties: false
            }, "Materialized plan draft with created ids").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": projectPlannerForbiddenResponse,
            "404": projectPlannerNotFoundResponse,
            "409": projectPlannerConflictResponse
          }
        }
      },
      "/api/proposals/{id}/skip-plan": {
        post: {
          tags: ["task-plans"],
          summary: "Skip the task plan and start a single agent run instead",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          responses: {
            "200": jsonDataResponse({
              type: "object",
              required: ["run_id", "work_item_id", "attention"],
              properties: {
                run_id: uuidStringSchema,
                work_item_id: uuidStringSchema,
                attention: {
                  type: "object",
                  required: ["summary_text"],
                  properties: { summary_text: { type: "string", minLength: 1 } },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            }, "Plan skipped; a single agent run was enqueued").responses["200"],
            "401": proposalNotIdentifiedResponse,
            "403": proposalForbiddenResponse,
            "404": proposalNotFoundResponse,
            ...jsonErrorStatusResponse("409", "Plan cannot be skipped in its current state", [
              "not_task_plan_proposal",
              "plan_skip_not_available",
              "proposal_already_reviewed"
            ]).responses,
            ...jsonErrorStatusResponse("402", "Run budget is exhausted", ["budget_exhausted"]).responses
          }
        }
      },
      "/api/proposals/{id}/merge": {
        post: {
          tags: ["proposals"],
          summary: "Merge an approved deliverable change proposal",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          ...jsonRequestBody(mergeProposalRequestBodySchema, { required: false }),
          ...proposalMergeResponse
        }
      },
      "/api/proposals/{id}/rebase": {
        post: {
          tags: ["proposals"],
          summary: "Refresh proposal conflicts against the latest accepted base",
          parameters: [pathUuidParameter("id")],
          ...rebaseProposalResponse
        }
      },
      "/api/merge-proposals/{id}/choose": {
        post: {
          tags: ["proposals"],
          summary: "Choose an AI fusion candidate for a merge conflict",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(chooseMergeProposalCandidateRequestBodySchema),
          ...chooseMergeProposalCandidateResponse
        }
      },
      "/api/merge-proposals/{id}/apply": {
        post: {
          tags: ["proposals"],
          summary: "Apply the selected AI fusion candidate",
          parameters: [pathUuidParameter("id"), localeQueryParameter],
          ...jsonRequestBody(applyMergeProposalCandidateRequestBodySchema, { required: false }),
          ...proposalMergeCandidateApplyResponse
        }
      },
      "/api/pages/approvals": {
        get: {
          tags: ["pages"],
          summary: "Approval center page",
          parameters: [localeQueryParameter, approvalOffsetQueryParameter, approvalLimitQueryParameter],
          ...jsonAuthenticatedPageResponse(approvalCenterResponseSchema)
        }
      },
      "/api/pages/cost": {
        get: {
          tags: ["pages"],
          summary: "Cost dashboard page",
          parameters: [localeQueryParameter],
          ...jsonAuthenticatedPageResponse(costDashboardPageResponseSchema)
        }
      },
      "/api/cost/usage": {
        get: {
          tags: ["cost"],
          summary: "Current user's lightweight AI budget and usage summary",
          ...costUsageSummaryResponse
        }
      },
      "/api/cost/policies": {
        get: {
          tags: ["cost"],
          summary: "List AI budget policies",
          ...costPolicyListResponse
        }
      },
      "/api/cost/policies/{scope}/{id}": {
        put: {
          tags: ["cost"],
          summary: "Update an AI budget policy",
          parameters: [costPolicyScopePathParameter, costPolicyIdPathParameter],
          ...jsonRequestBody(budgetPolicyUpdateRequestBodySchema),
          ...costPolicyUpdateResponse
        }
      },
      "/api/workitems/{id}/agent-runs": {
        post: {
          tags: ["agent-runs"],
          summary: "Start an AI worker run for a work item",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(startAgentRunRequestBodySchema, { required: false }),
          ...startAgentRunResponse
        }
      },
      "/api/agent-runs/{id}": {
        get: {
          tags: ["agent-runs"],
          summary: "Read the live state for an AI worker run",
          parameters: [pathUuidParameter("id")],
          ...readAgentRunResponse
        }
      },
      "/api/agent-runs/{id}/trace": {
        get: {
          tags: ["agent-runs"],
          summary: "Read live trace steps for an AI worker run",
          parameters: [
            pathUuidParameter("id"),
            optionalNonNegativeIntegerQueryParameter("after")
          ],
          ...agentRunTraceResponse
        }
      },
      // R20 R19-29：GET /api/agent-runs/{id}/handoff 已删——SDK 曾有 getAgentRunHandoff 桩但 web/desktop
      // 均无调用点，同一份结构化 handoff 数据早已内嵌进 GET /api/agent-runs/{id}/replay 的回放页。核实
      // 过零消费后连路由与本文档一并删除。
      "/api/agent-runs/{id}/abort": {
        post: {
          tags: ["agent-runs"],
          summary: "Cancel a queued or running AI worker run",
          parameters: [pathUuidParameter("id")],
          ...abortAgentRunResponse
        }
      },
      "/api/push/stream": {
        get: {
          tags: ["push"],
          summary: "Subscribe to all authorized push events",
          ...eventStreamAuthResponse("Authorized global server-sent event stream", ["invalid_client_token", "forbidden"])
        }
      },
      "/api/push/stream/me": {
        get: {
          tags: ["push"],
          summary: "Subscribe to the current user's push topic",
          ...eventStreamAuthResponse("Current user's server-sent event stream", ["invalid_client_token"])
        }
      },
      "/api/push/stream/workitem/{id}": {
        get: {
          tags: ["push"],
          summary: "Subscribe to a work item push topic",
          parameters: [pathUuidParameter("id")],
          ...eventStreamAuthResponse("Work item server-sent event stream", ["invalid_client_token", "forbidden"])
        }
      },
      "/api/push/stream/req/{id}": {
        get: {
          tags: ["push"],
          summary: "Subscribe to a requirement push topic",
          parameters: [pathUuidParameter("id")],
          ...eventStreamAuthResponse("Requirement server-sent event stream", ["invalid_client_token", "forbidden"])
        }
      },
      "/api/push/stream/run/{id}": {
        get: {
          tags: ["push"],
          summary: "Subscribe to an agent run push topic",
          parameters: [pathUuidParameter("id")],
          ...eventStreamAuthResponse("Agent run server-sent event stream", ["invalid_client_token", "forbidden"])
        }
      },
      "/api/push/stream/session/{id}": {
        get: {
          tags: ["push"],
          summary: "Subscribe to a clarification session push topic",
          parameters: [pathUuidParameter("id")],
          ...eventStreamAuthResponse("Clarification session server-sent event stream", ["invalid_client_token", "forbidden"])
        }
      },
      "/api/push/stream/proposal/{id}": {
        get: {
          tags: ["push"],
          summary: "Subscribe to a proposal push topic",
          parameters: [pathUuidParameter("id")],
          ...eventStreamAuthResponse("Proposal server-sent event stream", ["invalid_client_token", "forbidden"])
        }
      },
      "/api/push/stream/conversation/{id}": {
        get: {
          tags: ["push"],
          summary: "Subscribe to one conversation push topic",
          parameters: [pathUuidParameter("id")],
          ...eventStreamAuthResponse(
            "Live-only server-sent events for one conversation topic; no replay is provided. After connected, catch up through GET /api/conversations/{id}/messages?afterSeq=... using the highest locally durable seq.",
            ["invalid_client_token", "forbidden"]
          )
        }
      },
      "/api/sessions": {
        post: {
          tags: ["sessions"],
          summary: "Create an option-first intake session",
          ...jsonRequestBody({
            type: "object",
            properties: {
              title: { type: "string", minLength: 1 },
              intent_text: { type: "string", minLength: 1 },
              project_id: uuidStringSchema,
              work_item_id: uuidStringSchema
	            },
	            additionalProperties: false
	          }, { required: false }),
          ...createSessionResponse
	        }
	      },
	      "/api/sessions/{id}": {
	        get: {
	          tags: ["sessions"],
	          summary: "Read an option-first intake session",
          parameters: [pathUuidParameter("id")],
          ...readSessionResponse
	        }
	      },
	      "/api/sessions/{id}/next-question": {
	        post: {
	          tags: ["sessions"],
	          summary: "Return an option-first clarification card",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(nextQuestionRequestBodySchema, { required: false }),
          ...nextSessionQuestionResponse
	        }
	      },
	      "/api/workitems": {
	        post: {
	          tags: ["workitems"],
          summary: "Create a work item from an intake session or option-first payload",
          ...jsonRequestBody({
            type: "object",
            properties: {
              session_id: uuidStringSchema,
              project_id: uuidStringSchema,
              title: { type: "string", minLength: 1, maxLength: 256 },
              raw_description: { type: "string", minLength: 1 },
              selected_option_ids: {
                type: "array",
                items: { type: "string", minLength: 1 }
              },
              free_text: { type: "string", maxLength: 1000 },
              cuu_launcher_spec: cuuLauncherWorkItemSpecSchema,
              kickoff_agent: { type: "boolean" }
            },
            additionalProperties: false,
	            anyOf: [
	              { required: ["session_id"] },
	              { required: ["title"] },
	              { required: ["raw_description"] }
	            ]
	          }),
          ...createWorkItemRouteResponse
	        }
	      },
	      "/api/workitems/{id}/evidence-bindings": {
	        post: {
	          tags: ["workitems"],
	          summary: "Attach selected evidence refs to the current work item context",
          parameters: [pathUuidParameter("id")],
	          ...jsonRequestBody({
	            type: "object",
	            required: ["evidence_refs"],
            properties: {
              evidence_bubble_id: uuidStringSchema,
              evidence_refs: {
                type: "array",
                minItems: 1,
                items: evidenceRefSchema
              },
	              note: { type: "string", maxLength: 500 }
	            },
	            additionalProperties: false
	          }),
          ...bindEvidenceResponse
	        }
	      },
      "/api/workitems/{id}/deliverables/{acceptedChangeId}/download": {
        get: {
          tags: ["workitems"],
          summary: "Download an accepted formal deliverable file",
          parameters: [
            pathUuidParameter("id"),
            pathUuidParameter("acceptedChangeId")
          ],
          ...acceptedDeliverableDownloadResponse
        }
      },
      "/api/workitems/{id}/deliverables/{acceptedChangeId}/preview": {
        get: {
          tags: ["workitems"],
          summary: "Preview an accepted formal deliverable when it is text-like",
          parameters: [
            pathUuidParameter("id"),
            pathUuidParameter("acceptedChangeId")
          ],
          ...acceptedDeliverablePreviewResponse
        }
      },
      "/api/workitems/{id}/deliverables/{acceptedChangeId}/restore": {
        post: {
          tags: ["workitems"],
          summary: "Restore an accepted formal deliverable to its previous version",
          parameters: [
            pathUuidParameter("id"),
            pathUuidParameter("acceptedChangeId")
          ],
          ...acceptedDeliverableRestoreResponse
        }
      },
      "/api/knowledge/search": {
        post: {
          tags: ["knowledge"],
          summary: "Search project knowledge and return an evidence bubble",
          ...jsonRequestBody({
            type: "object",
            properties: {
              q: { type: "string", minLength: 1, maxLength: 500 },
              query: { type: "string", minLength: 1, maxLength: 500 },
              project_id: uuidStringSchema,
              work_item_id: uuidStringSchema,
              run: { type: "string", minLength: 1, maxLength: 128 },
              scope: { type: "string", minLength: 1, maxLength: 64 },
              source_ref: { type: "string", minLength: 1, maxLength: 200 },
              limit: { type: "integer", minimum: 1, maximum: 80 }
            },
            additionalProperties: false
          }, { required: false }),
          ...knowledgeSearchResponse
        }
      },
      "/api/agent-runs/{id}/replay": {
        get: {
          tags: ["agent-runs"],
          summary: "Replay an AI worker run",
          parameters: [
            pathUuidParameter("id"),
            localeQueryParameter
          ],
          ...replayAgentRunResponse
        }
      },
      "/api/agent-runs/{id}/revert": {
        post: {
          tags: ["agent-runs"],
          summary: "Restore the workdir from an agent run snapshot",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(revertAgentRunRequestBodySchema),
          ...agentRunRevertResponse
        }
      },
      "/api/workitems/{id}/audit": {
        get: {
          tags: ["audit"],
          summary: "List audit facts and snapshots for a work item",
          parameters: [pathUuidParameter("id")],
          ...workItemAuditTimelineResponse
        }
      },
      "/api/pilot/day1/metrics": {
        get: {
          tags: ["pilot"],
          summary: "Read Day 1 pilot metrics",
          parameters: [
            optionalDateTimeQueryParameter("from"),
            optionalDateTimeQueryParameter("to")
          ],
          ...pilotDay1MetricsResponses
        }
      }
      // R20 R19-29：/api/ai-worklog/today 已删——web/desktop 均无调用者（SDK 从未包装这条路径），
      // 同样的今日 AI 工作量数据早已经由 GET /api/pages/attention 等页面 VM 内嵌 AiWorklogMetricsService
      // 交付。核实过零消费后连路由（routes/ai-worklog.ts）与本文档一并删除，不留死冗余端点。
    }
  });
}
