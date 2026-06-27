import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client";

import { isStaleDesktopClientTokenError } from "./auth-recovery.js";

test("desktop auth recovery treats invalid client tokens as stale local tokens", () => {
  assert.equal(isStaleDesktopClientTokenError(new WorkHubApiError(401, "not_identified", "not identified")), true);
  assert.equal(isStaleDesktopClientTokenError(new WorkHubApiError(403, "invalid_client_token", "invalid client token")), true);
  assert.equal(isStaleDesktopClientTokenError(new WorkHubApiError(403, "forbidden", "forbidden")), false);
  assert.equal(isStaleDesktopClientTokenError(new Error("network down")), false);
});
