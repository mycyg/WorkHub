import assert from "node:assert/strict";
import test from "node:test";

import type { MemoryConflictRow } from "@workhub/db";

import {
  buildMemoryConflictAttentionItem,
  createMemoryConflictService,
  MemoryConflictServiceError
} from "./services/memory-conflicts.js";
import type { AuthActor } from "./middleware/auth.js";

const conflictId = "86000000-0000-4000-8000-000000000001";
const workspaceId = "86000000-0000-4000-8000-000000000002";
const userId = "86000000-0000-4000-8000-000000000003";
const sourceRunId = "86000000-0000-4000-8000-000000000004";
const now = new Date("2026-07-03T10:40:00.000Z");

function actor(over: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    userId,
    label: "Cuu User",
    isAdmin: false,
    orgId: "86000000-0000-4000-8000-000000000005",
    workspaceId,
    ...over
  };
}

function row(over: Partial<MemoryConflictRow> = {}): MemoryConflictRow {
  return {
    id: conflictId,
    workspaceId,
    userId,
    sourceRunId,
    category: "preference",
    key: "reply_style",
    currentValueMd: "回复要详细解释。",
    incomingValueMd: "回复只给结论。",
    baseValueMd: "回复要简洁。",
    candidateMemoryIds: ["86000000-0000-4000-8000-000000000101"],
    status: "open",
    resolution: null,
    resolvedValueMd: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over
  } as MemoryConflictRow;
}

test("memory conflict attention cards expose concrete resolution actions", () => {
  const item = buildMemoryConflictAttentionItem(row(), "zh-CN");
  const expectedUpdatedAt = encodeURIComponent(now.toISOString());

  assert.equal(item.kind, "sync_conflict");
  assert.equal(item.priority, "high");
  assert.equal(item.source_ref.entity_type, "agent_run");
  assert.deepEqual(
    item.actions.map((action) => [action.id, action.method, action.href]),
    [
      ["keep_current", "POST", `/api/memory-conflicts/${conflictId}/resolve/keep_current?expected_updated_at=${expectedUpdatedAt}`],
      ["accept_incoming", "POST", `/api/memory-conflicts/${conflictId}/resolve/accept_incoming?expected_updated_at=${expectedUpdatedAt}`],
      ["merge_both", "POST", `/api/memory-conflicts/${conflictId}/resolve/merge_both?expected_updated_at=${expectedUpdatedAt}`],
      ["open_settings", "GET", "/settings"]
    ]
  );
});

test("memory conflict accept-incoming writes L2 and closes the inbox card", async () => {
  const writes: unknown[] = [];
  const resolved: unknown[] = [];
  const service = createMemoryConflictService({
    now: () => now,
    conflicts: {
      listOpenForUser: async () => ({ rows: [], capped: false }),
      findOpenForUser: async () => row(),
      resolve: async (input) => {
        resolved.push(input);
        return row({
          status: "resolved",
          resolution: input.resolution,
          resolvedValueMd: input.resolvedValueMd ?? null,
          resolvedAt: input.resolvedAt ?? now,
          resolvedByUserId: userId
        });
      },
      createOrUpdateOpen: async () => {
        throw new Error("not needed");
      }
    },
    userMemories: {
      upsert: async (input) => {
        writes.push(input);
        return {} as never;
      }
    }
  });

  const result = await service.resolve({
    actor: actor(),
    conflictId,
    resolution: "accept_incoming",
    expectedUpdatedAt: now
  });

  assert.equal(result.conflict.status, "resolved");
  assert.deepEqual(writes, [{
    userId,
    workspaceId,
    category: "preference",
    key: "reply_style",
    valueMd: "回复只给结论。",
    confidence: 0.9,
    sourceRunId
  }]);
  assert.equal((resolved[0] as { resolution?: string }).resolution, "accept_incoming");
});

test("stale memory conflict resolution does not write L2 before closing the card", async () => {
  const writes: unknown[] = [];
  const service = createMemoryConflictService({
    now: () => now,
    conflicts: {
      listOpenForUser: async () => ({ rows: [], capped: false }),
      findOpenForUser: async () => row(),
      resolve: async () => null,
      createOrUpdateOpen: async () => {
        throw new Error("not needed");
      }
    },
    userMemories: {
      upsert: async (input) => {
        writes.push(input);
        return {} as never;
      }
    }
  });

  await assert.rejects(
    service.resolve({
      actor: actor(),
      conflictId,
      resolution: "accept_incoming",
      expectedUpdatedAt: now
    }),
    (error) => error instanceof MemoryConflictServiceError
      && error.status === 409
      && error.code === "memory_conflict_status_changed"
  );
  assert.deepEqual(writes, []);
});

test("stale memory conflict version does not resolve or write stale L2", async () => {
  const staleAt = new Date("2026-07-03T10:41:00.000Z");
  const concurrentAt = new Date("2026-07-03T10:42:00.000Z");
  const writes: unknown[] = [];
  const resolved: unknown[] = [];
  const service = createMemoryConflictService({
    now: () => now,
    conflicts: {
      listOpenForUser: async () => ({ rows: [], capped: false }),
      findOpenForUser: async () => row({ updatedAt: concurrentAt, incomingValueMd: "覆盖后的新 B。" }),
      resolve: async (input) => {
        resolved.push(input);
        return row({
          status: "resolved",
          resolution: input.resolution,
          resolvedValueMd: input.resolvedValueMd ?? null,
          resolvedAt: input.resolvedAt ?? now,
          resolvedByUserId: userId,
          updatedAt: concurrentAt
        });
      },
      createOrUpdateOpen: async () => {
        throw new Error("not needed");
      }
    },
    userMemories: {
      upsert: async (input) => {
        writes.push(input);
        return {} as never;
      }
    }
  });

  await assert.rejects(
    service.resolve({
      actor: actor(),
      conflictId,
      resolution: "accept_incoming",
      expectedUpdatedAt: staleAt
    }),
    (error) => error instanceof MemoryConflictServiceError
      && error.status === 409
      && error.code === "memory_conflict_status_changed"
  );

  assert.deepEqual(resolved, []);
  assert.deepEqual(writes, []);
});
