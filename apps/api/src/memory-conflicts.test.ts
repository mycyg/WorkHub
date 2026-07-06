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
    candidateMemoryIds: [
      "86000000-0000-4000-8000-000000000101",
      "86000000-0000-4000-8000-000000000102"
    ],
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

test("memory conflict attention cards expose A/B/discard/edit resolution actions", () => {
  const item = buildMemoryConflictAttentionItem(row(), "zh-CN");

  assert.equal(item.kind, "sync_conflict");
  assert.equal(item.priority, "high");
  assert.equal(item.source_ref.entity_type, "agent_run");
  assert.match(item.reason_text ?? "", /A：回复要详细解释。/u);
  assert.match(item.reason_text ?? "", /B：回复只给结论。/u);
  assert.deepEqual(
    item.actions.map((action) => [action.id, action.label, action.method, action.href]),
    [
      ["keep_current", "要 A", "POST", `/api/memory-conflicts/${conflictId}/resolve/keep_current`],
      ["accept_incoming", "要 B", "POST", `/api/memory-conflicts/${conflictId}/resolve/accept_incoming`],
      ["discard_both", "都不要", "POST", `/api/memory-conflicts/${conflictId}/resolve/discard_both`],
      ["edit_memory", "合并成一条", "POST", `/api/memory-conflicts/${conflictId}/resolve/edit_memory`]
    ]
  );
});

test("memory conflict discard-both closes the inbox card without writing L2", async () => {
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
    resolution: "discard_both"
  });

  assert.equal(result.conflict.status, "resolved");
  assert.deepEqual(writes, []);
  assert.equal((resolved[0] as { resolution?: string }).resolution, "discard_both");
});

test("memory conflict resolve result exposes public snake_case decision fields", async () => {
  const service = createMemoryConflictService({
    now: () => now,
    conflicts: {
      listOpenForUser: async () => ({ rows: [], capped: false }),
      findOpenForUser: async () => row(),
      resolve: async (input) => row({
        status: "resolved",
        resolution: input.resolution,
        resolvedValueMd: input.resolvedValueMd ?? null,
        resolvedAt: input.resolvedAt ?? now,
        resolvedByUserId: userId
      }),
      createOrUpdateOpen: async () => {
        throw new Error("not needed");
      }
    },
    userMemories: {
      upsert: async () => ({} as never)
    }
  });

  const result = await service.resolve({
    actor: actor(),
    conflictId,
    resolution: "accept_incoming"
  });
  const conflict = result.conflict as Record<string, unknown>;

  assert.equal(conflict.id, conflictId);
  assert.equal(conflict.status, "resolved");
  assert.equal(conflict.resolution, "accept_incoming");
  assert.equal(conflict.resolved_value_md, "回复只给结论。");
  assert.equal(conflict.resolvedValueMd, undefined);
});

test("memory conflict editable merge requires the edited value before writing L2", async () => {
  const writes: unknown[] = [];
  const service = createMemoryConflictService({
    now: () => now,
    conflicts: {
      listOpenForUser: async () => ({ rows: [], capped: false }),
      findOpenForUser: async () => row(),
      resolve: async () => {
        throw new Error("must not close before edited value exists");
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
      resolution: "edit_memory"
    }),
    (error) => error instanceof MemoryConflictServiceError
      && error.status === 422
      && error.code === "memory_conflict_value_required"
  );
  assert.deepEqual(writes, []);
});
