import type { WorkHubApiClient } from "@workhub/api-client";
import { memoryConflictActionFromHref } from "@workhub/web-runtime";

type MemoryConflictActionClient = Pick<WorkHubApiClient, "resolveMemoryConflict">;

export function resolveWebMemoryConflictAction(client: MemoryConflictActionClient, href: string, valueMd?: string) {
  const action = memoryConflictActionFromHref(href);
  if (!action) {
    return undefined;
  }
  // B-R9.6 §3.7：merge_both 的「合并成一条（可编辑）」——卡上文本框的内容作为 value_md 提交，
  // 空白/未改动时不传（服务端回落默认合并）。
  const trimmed = valueMd?.trim();
  return client.resolveMemoryConflict(action.conflictId, {
    resolution: action.resolution,
    expected_updated_at: action.expectedUpdatedAt,
    ...(action.resolution === "merge_both" && trimmed ? { value_md: trimmed } : {})
  });
}
