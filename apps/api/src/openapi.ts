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
    href: { type: "string", minLength: 1 }
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
const healthResponseSchema = {
  type: "object",
  required: ["ok", "service", "env", "runtime", "port"],
  properties: {
    ok: { type: "boolean", const: true },
    service: { type: "string", const: "workhub-api" },
    env: { type: "string", enum: ["development", "test", "production"] },
    runtime: { type: "string", const: "node" },
    port: { type: "integer", minimum: 1, maximum: 65535 }
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
    admin_secret: { type: "string", maxLength: 256 }
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
    platform: { type: "string", maxLength: 64 }
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
    nickname: { type: "string", minLength: 1, maxLength: 64 }
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
const inviteAcceptRequestBodySchema = {
  type: "object",
  required: ["token", "nickname", "password"],
  properties: {
    token: { type: "string", minLength: 1, maxLength: 512 },
    nickname: { type: "string", minLength: 1, maxLength: 64 },
    password: { type: "string", minLength: 8, maxLength: 1024 }
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
const authDeactivateResponses = {
  responses: {
    "200": rawJsonResponse(authOkResponseSchema, "Deactivated user").responses["200"],
    "400": authBadRequestResponse,
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
        merge: actionSpecSchema
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
    "merge_snapshot_missing",
    "delivery_artifact_missing",
    "delivery_artifact_changed",
    "delivery_artifact_unsafe_path"
  ]
);
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
const createTaskPlanRequestSchema = {
  type: "object",
  properties: {
    memories: {
      type: "object",
      properties: {
        user: { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, maxItems: 20 },
        team: { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, maxItems: 20 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
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
  "Task plan decomposition needs human intervention or proposal state changed",
  ["task_plan_decomposition_needs_human", "proposal_already_exists"]
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
const proposalListResponseSchema = {
  type: "array",
  items: proposalResponseSchema
} as const;
const proposalListResponse = {
  responses: {
    "200": jsonDataResponse(proposalListResponseSchema, "Work item proposals").responses["200"],
    "401": proposalNotIdentifiedResponse,
    "403": proposalForbiddenResponse,
    "404": proposalNotFoundResponse
  }
} as const;
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
    "422": proposalValidationResponse
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
    status: { type: "string", enum: ["pending", "approved", "denied", "expired", "delegated"] },
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
    work_item_status: { type: "string", enum: ["ai_working", "pm_mode", "cancelled"] },
    attention: { type: "object", additionalProperties: true }
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
const escalationDelegateRaceResponse = jsonErrorStatusResponse(
  "409",
  "Escalation delegation raced with another handler",
  ["escalation_race"]
).responses["409"];
const approvalDelegateSemanticResponse = jsonErrorStatusResponse(
  "422",
  "Approval delegation target is not valid for this request",
  ["delegate_to_requester", "delegate_target_cannot_view"]
).responses["422"];
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
    "409": approvalRaceResponse
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
    "422": escalationValidationResponse
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
  required: ["muted_notification_types"],
  properties: {
    muted_notification_types: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 64 }
    }
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
    empty_state: { type: "string", enum: ["no_project", "no_drive_items"] }
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
    recommended_action: { type: "string", enum: ["continue", "downgrade_model", "pause", "ask_admin"] },
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
    scope_kind: { type: "string", enum: ["workitem", "user", "team", "eval"] },
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
  schema: { type: "string", enum: ["workitem", "user", "team", "eval"] }
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
    model_breakdown: { type: "array", items: { type: "object", additionalProperties: true } },
    labor_split: { type: "object", additionalProperties: true },
    budget: { type: "array", items: { type: "object", additionalProperties: true } },
    notices: { type: "array", items: { type: "object", additionalProperties: true } },
    top_exhaustion_risks: { type: "array", items: { type: "object", additionalProperties: true } },
    empty_state: { type: "string", enum: ["no_agent_runs", "usage_not_connected"] }
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
const teamSkillsPageResponseSchema = {
  type: "object",
  required: ["generated_at", "skills", "totals"],
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
      items: {
        type: "object",
        required: ["source", "message"],
        properties: {
          source: { type: "string", enum: ["approvals", "proposals", "escalations"] },
          message: { type: "string", minLength: 1 }
        },
        additionalProperties: false
      }
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
    source_context: { type: "object", additionalProperties: true },
    actions: {
      type: "object",
      properties: {
        create_proposal_draft: actionSpecSchema
      },
      additionalProperties: false
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
    empty_state: { type: "string", enum: ["no_open_work"] }
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
    agent_role: { type: "string", enum: ["research", "produce", "review", "integrate"] },
    objective_md: { type: "string", minLength: 1 },
    mode: { type: "string", enum: ["worker", "pm"] },
    actor: { type: "string", minLength: 1, maxLength: 32 },
    status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "escalated", "budget_exhausted", "cancelled"] },
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
    status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "escalated", "budget_exhausted", "cancelled"] },
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
const agentRunHandoffResponseSchema = {
  anyOf: [
    structuredHandoffResponseSchema,
    { type: "null" }
  ]
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
  ["http_error"]
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
const agentRunHandoffResponse = {
  responses: {
    "200": jsonDataResponse(agentRunHandoffResponseSchema, "Escalated AI worker handoff").responses["200"],
    "401": agentRunNotIdentifiedResponse,
    "403": agentRunForbiddenResponse,
    "404": agentRunNotFoundResponse
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
const aiWorklogResponseSchema = {
  type: "object",
  required: [
    "runs_today",
    "autonomy_rate",
    "accepted_today",
    "saved_hours_estimate",
    "skills_promoted_today",
    "skills_refined_today",
    "generated_at"
  ],
  properties: {
    runs_today: { type: "integer", minimum: 0 },
    autonomy_rate: { type: "integer", minimum: 0, maximum: 100 },
    accepted_today: { type: "integer", minimum: 0 },
    saved_hours_estimate: { type: "number", minimum: 0 },
    skills_promoted_today: { type: "integer", minimum: 0 },
    skills_refined_today: { type: "integer", minimum: 0 },
    generated_at: dateTimeStringSchema,
    range_label: { type: "string", minLength: 1 }
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
const aiWorklogTodayResponses = {
  responses: {
    "200": jsonDataResponse(aiWorklogResponseSchema, "Today's AI worklog metrics").responses["200"],
    "401": jsonErrorStatusResponse("401", "AI worklog metrics require a current authenticated user", [
      "not_identified"
    ]).responses["401"]
  }
} as const;
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
        post: {
          tags: ["auth"],
          summary: "Admin: create an out-of-band invite, returns a one-time token",
          ...jsonRequestBody(inviteCreateRequestBodySchema),
          ...authInviteCreateResponses
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
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(resolveEscalationRequestBodySchema),
          ...escalationResolveResponse
        }
      },
      "/api/escalations/{id}/delegate": {
        post: {
          tags: ["escalations"],
          summary: "Delegate an unresolved escalation to another active user",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(delegateEscalationRequestBodySchema),
          ...escalationDelegateResponse
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
          parameters: [pathUuidParameter("projectId")],
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
            pathUuidParameter("itemId")
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
            pathUuidParameter("itemId")
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
      "/api/drive/projects/{projectId}/comments/{commentId}/draft": {
        post: {
          tags: ["drive"],
          summary: "Create or return a work item draft from a project drive comment",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("commentId")
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
          parameters: [pathUuidParameter("workItemId")],
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
      "/api/meetings/projects/{projectId}/insights/{insightId}/draft": {
        post: {
          tags: ["meetings"],
          summary: "Create or return a work item draft from a meeting insight",
          parameters: [
            pathUuidParameter("projectId"),
            pathUuidParameter("insightId")
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
            pathUuidParameter("insightId")
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
          parameters: [pathUuidParameter("workItemId")],
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
          ...jsonRequestBody(notificationPreferencesResponseSchema),
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
      "/api/workitems/{id}/proposals": {
        post: {
          tags: ["proposals"],
          summary: "Create a deliverable change proposal from a manifest",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(createProposalRequestSchema),
          ...createProposalResponse
        },
        get: {
          tags: ["proposals"],
          summary: "List proposals for a work item",
          parameters: [pathUuidParameter("id")],
          ...proposalListResponse
        }
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
      "/api/proposals/{id}": {
        get: {
          tags: ["proposals"],
          summary: "Read a deliverable change proposal",
          parameters: [pathUuidParameter("id")],
          ...readProposalResponse
        }
      },
      "/api/proposals/{id}/review": {
        post: {
          tags: ["proposals"],
          summary: "Review a deliverable change proposal",
          parameters: [pathUuidParameter("id")],
          ...jsonRequestBody(reviewProposalRequestBodySchema),
          ...reviewProposalResponse
        }
      },
      "/api/proposals/{id}/merge": {
        post: {
          tags: ["proposals"],
          summary: "Merge an approved deliverable change proposal",
          parameters: [pathUuidParameter("id")],
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
          parameters: [pathUuidParameter("id")],
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
      "/api/agent-runs/{id}/handoff": {
        get: {
          tags: ["agent-runs"],
          summary: "Read the structured handoff for an escalated AI worker run",
          parameters: [pathUuidParameter("id")],
          ...agentRunHandoffResponse
        }
      },
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
      },
      "/api/ai-worklog/today": {
        get: {
          tags: ["worklog"],
          summary: "Read today's AI worklog metrics",
          ...aiWorklogTodayResponses
        }
      }
    }
  });
}
