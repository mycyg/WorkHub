import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_SCOPE_ORDER,
  searchResultsVmSchema,
  searchScopeSchema
} from "./index.js";

// R14 批 SEARCH 契约测试：scope 枚举与固定顺序、请求边界常量、响应 VM 的判别联合按 scope 收严
// （每 scope 的 results 形状不可混用；.strict() 拒未知字段）。

test("search scope enum and its fixed output order agree", () => {
  assert.deepEqual([...SEARCH_SCOPE_ORDER], ["conversations", "drive", "work_items", "meetings"]);
  for (const scope of SEARCH_SCOPE_ORDER) {
    assert.doesNotThrow(() => searchScopeSchema.parse(scope));
  }
  assert.throws(() => searchScopeSchema.parse("bogus"));
});

test("request boundary constants stay at the designed values", () => {
  assert.equal(SEARCH_QUERY_MIN_LENGTH, 2);
  assert.equal(SEARCH_QUERY_MAX_LENGTH, 64);
  assert.equal(SEARCH_LIMIT_DEFAULT, 10);
  assert.equal(SEARCH_LIMIT_MAX, 25);
});

test("searchResultsVmSchema accepts a well-formed multi-scope response", () => {
  const vm = {
    query: "预算",
    groups: [
      {
        scope: "conversations",
        has_more: true,
        results: [
          {
            message_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            conversation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            project_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            project_name: "增长项目",
            conversation_title: "主群聊",
            seq: 128,
            sender_type: "user",
            sender_user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            sender_label: "阿珍",
            matched_in: "text",
            snippet: "…这季度的预算还没批…",
            created_at: "2026-07-14T09:00:00.000Z",
            deep_link: {
              project_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              conversation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              seq: 128
            }
          }
        ]
      },
      { scope: "drive", has_more: false, results: [] }
    ]
  };
  assert.doesNotThrow(() => searchResultsVmSchema.parse(vm));
});

test("searchResultsVmSchema rejects a result shape that belongs to a different scope", () => {
  const vm = {
    query: "预算",
    groups: [
      {
        scope: "drive",
        has_more: false,
        // a conversations-shaped result under the drive discriminant must fail.
        results: [{ message_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", matched_in: "text" }]
      }
    ]
  };
  assert.throws(() => searchResultsVmSchema.parse(vm));
});

test("searchResultsVmSchema is strict: an unknown top-level field is rejected", () => {
  assert.throws(() =>
    searchResultsVmSchema.parse({ query: "预算", groups: [], extra: true })
  );
});
