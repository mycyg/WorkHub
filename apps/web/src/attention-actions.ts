import type { WorkHubApiClient } from "@workhub/api-client";
import { memoryConflictActionFromHref } from "@workhub/web-runtime";

type MemoryConflictActionClient = Pick<WorkHubApiClient, "resolveMemoryConflict">;

export function resolveWebMemoryConflictAction(client: MemoryConflictActionClient, href: string) {
  const action = memoryConflictActionFromHref(href);
  if (!action) {
    return undefined;
  }
  return client.resolveMemoryConflict(action.conflictId, { resolution: action.resolution });
}
