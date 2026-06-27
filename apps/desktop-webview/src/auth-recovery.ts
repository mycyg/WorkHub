import { WorkHubApiError } from "@workhub/api-client";

export function isStaleDesktopClientTokenError(error: unknown) {
  return error instanceof WorkHubApiError &&
    (error.code === "not_identified" || error.code === "invalid_client_token");
}
