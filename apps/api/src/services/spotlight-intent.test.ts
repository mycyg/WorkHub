import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpotlightIntentService,
  SpotlightIntentServiceError,
  type SpotlightIntentLlmClient,
  type SpotlightIntentServiceDeps
} from "./spotlight-intent.js";
import type { AuthActor } from "../middleware/auth.js";

const now = new Date("2026-07-13T09:00:00.000Z");
const workspaceId = "16000000-0000-4000-8000-000000000001";
const userId = "16000000-0000-4000-8000-000000000002";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    label: "阿曼",
    userId,
    isAdmin: false,
    orgId: "org-1",
    workspaceId,
    ...overrides
  };
}

function jsonClient(text: string): SpotlightIntentLlmClient {
  return {
    messages: {
      async create() {
        return { content: [{ type: "text", text }] };
      }
    }
  };
}

function baseDeps(overrides: Partial<SpotlightIntentServiceDeps> = {}): SpotlightIntentServiceDeps {
  return {
    client: async () => jsonClient('{"intent":"open_page","confidence":"high","page":"cost"}'),
    policyStore: { listPolicies: () => [] },
    ledgerStore: { usageSnapshots: async () => [] },
    now: () => now,
    logger: { warn: () => {} },
    ...overrides
  };
}

function payload(query = "看看这个月花了多少钱") {
  return {
    query,
    capabilities: [
      { id: "cost", label: "成本" },
      { id: "approvals", label: "审批队列" }
    ]
  };
}

test("createIntent rejects non-human actors before calling the LLM", async () => {
  const service = createSpotlightIntentService(
    baseDeps({
      client: async () => {
        throw new Error("must not be called");
      }
    })
  );

  await assert.rejects(
    service.createIntent({
      actor: { kind: "ai", id: userId, label: "阿曼", isAdmin: false, orgId: "org-1", workspaceId },
      payload: payload()
    }),
    (error: unknown) => error instanceof SpotlightIntentServiceError && error.status === 403 && error.code === "human_required"
  );
});

test("createIntent returns 429 and never calls the LLM when the soft budget gate blocks", async () => {
  let llmCalled = false;
  const service = createSpotlightIntentService(
    baseDeps({
      policyStore: {
        listPolicies: () => [
          {
            id: "p1",
            scopeKind: "team" as const,
            period: "day" as const,
            maxTokens: 1000,
            maxCostCny: "1",
            warningRatio: 0.7,
            criticalRatio: 0.9,
            onWarning: "notify" as const,
            onExhausted: "block_new_run" as const,
            enabled: true,
            version: 1
          }
        ]
      },
      ledgerStore: {
        usageSnapshots: async () => [
          { scope: { kind: "team" as const, teamId: workspaceId }, tokenIn: 10, tokenOut: 10, estimatedCostCny: "5" }
        ]
      },
      client: async () => {
        llmCalled = true;
        throw new Error("must not be called");
      }
    })
  );

  await assert.rejects(
    service.createIntent({ actor: actor(), payload: payload() }),
    (error: unknown) =>
      error instanceof SpotlightIntentServiceError && error.status === 429 && error.code === "spotlight_intent_budget_exhausted"
  );
  assert.equal(llmCalled, false);
});

test("createIntent passes a 15s default timeout through to the LLM client", async () => {
  let seenTimeoutMs: number | undefined;
  const service = createSpotlightIntentService(
    baseDeps({
      client: async () => ({
        messages: {
          async create(params) {
            seenTimeoutMs = params.timeoutMs;
            return { content: [{ type: "text", text: '{"intent":"answer","confidence":"high","answer_md":"ok"}' }] };
          }
        }
      })
    })
  );

  await service.createIntent({ actor: actor(), payload: payload() });
  assert.equal(seenTimeoutMs, 15_000);
});

test("createIntent maps an LLM failure to a gentle 500", async () => {
  const service = createSpotlightIntentService(
    baseDeps({
      client: async () => ({
        messages: {
          async create() {
            throw new Error("provider unreachable");
          }
        }
      })
    })
  );

  await assert.rejects(
    service.createIntent({ actor: actor(), payload: payload() }),
    (error: unknown) => error instanceof SpotlightIntentServiceError && error.status === 500 && error.code === "spotlight_intent_failed"
  );
});

test("createIntent maps unparsable model output to the same gentle 500", async () => {
  const service = createSpotlightIntentService(baseDeps({ client: async () => jsonClient("not json at all") }));

  await assert.rejects(
    service.createIntent({ actor: actor(), payload: payload() }),
    (error: unknown) => error instanceof SpotlightIntentServiceError && error.status === 500 && error.code === "spotlight_intent_failed"
  );
});

test("createIntent rejects an open_page result whose page id was not in the caller-provided capability list", async () => {
  const service = createSpotlightIntentService(
    baseDeps({ client: async () => jsonClient('{"intent":"open_page","confidence":"high","page":"not_offered"}') })
  );

  await assert.rejects(
    service.createIntent({ actor: actor(), payload: payload() }),
    (error: unknown) => error instanceof SpotlightIntentServiceError && error.status === 500 && error.code === "spotlight_intent_failed"
  );
});

test("createIntent returns the parsed result verbatim for each of the four intents", async () => {
  const cases: Array<[string, unknown]> = [
    ['{"intent":"open_page","confidence":"high","page":"cost"}', { intent: "open_page", confidence: "high", page: "cost" }],
    [
      '{"intent":"new_project","confidence":"low","project_name":"稀土供应链分析"}',
      { intent: "new_project", confidence: "low", project_name: "稀土供应链分析" }
    ],
    [
      '{"intent":"create_task","confidence":"high","task_title":"整理上周访谈纪要"}',
      { intent: "create_task", confidence: "high", task_title: "整理上周访谈纪要" }
    ],
    [
      '{"intent":"answer","confidence":"low","answer_md":"这是一句回答"}',
      { intent: "answer", confidence: "low", answer_md: "这是一句回答" }
    ]
  ];

  for (const [raw, expected] of cases) {
    const service = createSpotlightIntentService(baseDeps({ client: async () => jsonClient(raw) }));
    const result = await service.createIntent({ actor: actor(), payload: payload() });
    assert.deepEqual(result, expected);
  }
});

test("createIntent forwards the actor's workspace to the budget check and the LLM client provider", async () => {
  const seenWorkspaceIds: string[] = [];
  const service = createSpotlightIntentService(
    baseDeps({
      ledgerStore: {
        usageSnapshots: async (scopeIds) => {
          if ("teamId" in scopeIds && scopeIds.teamId) {
            seenWorkspaceIds.push(scopeIds.teamId);
          }
          return [];
        }
      },
      client: async (input) => {
        seenWorkspaceIds.push(input.workspaceId);
        return jsonClient('{"intent":"answer","confidence":"high","answer_md":"ok"}');
      }
    })
  );

  await service.createIntent({ actor: actor(), payload: payload() });
  assert.deepEqual(seenWorkspaceIds, [workspaceId, workspaceId]);
});
