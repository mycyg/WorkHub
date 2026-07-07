import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderRegistry } from "@workhub/agent/providers";
import type { LlmActor, LlmCreateParams, TaskClass } from "@workhub/agent/providers";

import {
  createMetaPlanner,
  MetaPlannerServiceError
} from "./services/meta-planner.js";

const workItemId = "95000000-0000-4000-8000-000000000201";
const workspaceId = "95000000-0000-4000-8000-000000000202";
const userId = "95000000-0000-4000-8000-000000000203";

type RecordedCall = {
  actor: LlmActor | undefined;
  task: TaskClass;
  params: LlmCreateParams;
};

class RecordingRegistry {
  public readonly calls: RecordedCall[] = [];

  constructor(private readonly responses: unknown[]) {}

  isConfigured() {
    return true;
  }

  get(actor: LlmActor | undefined, task: TaskClass) {
    return {
      messages: {
        create: async (params: LlmCreateParams) => {
          this.calls.push({ actor, task, params });
          const response = this.responses.shift();
          if (!response) {
            throw new Error("unexpected LLM call");
          }
          return {
            id: `llm-${this.calls.length}`,
            content: [{ type: "text", text: JSON.stringify(response) }],
            usage: { inputTokens: 10, outputTokens: 20 }
          };
        }
      }
    };
  }
}

function idSequence(values: string[]) {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (!value) {
      throw new Error("id sequence exhausted");
    }
    return value;
  };
}

function validPlan(keys: readonly string[]) {
  return {
    items: keys.map((key, index) => ({
      key,
      title: index === 0 ? "Research source evidence" : index === 1 ? "Draft the short report" : "Review acceptance coverage",
      role: index === 0 ? "research" : index === 1 ? "produce" : "review",
      objective_md: index === 0 ? "Find 3 verifiable sources." : index === 1 ? "Write the report from the evidence." : "Check the report against acceptance.",
      acceptance_md: index === 0 ? "At least 3 source notes are listed." : index === 1 ? "Report includes conclusion and evidence." : "Every acceptance item is checked.",
      budget_share_pct: index === 0 ? 30 : index === 1 ? 50 : 20,
      depends_on: index === 1 ? [keys[0]] : index === 2 ? [keys[1]] : []
    }))
  };
}

test("R9.1 meta planner uses decompose LLM discipline, judge retry, and returns an auditable draft", async () => {
  const registry = new RecordingRegistry([
    validPlan(["a", "b", "c"]),
    { decision: "retry", confidence: "low", reasons: ["produce and review tasks overlap"] },
    validPlan(["research", "produce", "review"]),
    { decision: "approve", confidence: "high", reasons: ["atomic and measurable"] }
  ]);
  const planner = createMetaPlanner({
    providerRegistry: registry as unknown as ProviderRegistry,
    id: idSequence([
      "95000000-0000-4000-8000-000000000301",
      "95000000-0000-4000-8000-000000000302",
      "95000000-0000-4000-8000-000000000303"
    ])
  });

  const draft = await planner.createDraft({
    actor: { id: userId, userId, workspaceId, label: "Planner PM" },
    locale: "en-US",
    workItem: {
      id: workItemId,
      workspaceId,
      title: "Research and write a short drama topic report",
      rawDescription: "调研短剧选题并产出一篇短报告"
    },
    acceptance: ["3-5 atomic subtasks", "Every subtask has measurable acceptance"],
    memories: {
      user: ["Prefer evidence-backed output."],
      team: ["Keep reviewer and producer roles separate."],
      objectives: ["Objective: Raise R9 review quality (40%)"]
    }
  });

  assert.equal(registry.calls.length, 4);
  assert.deepEqual(registry.calls.map((call) => call.task), ["decompose", "decompose", "decompose", "decompose"]);
  assert.equal(registry.calls[0]?.actor?.workItemId, workItemId);
  assert.equal(registry.calls[0]?.actor?.workspaceId, workspaceId);
  assert.equal(registry.calls[0]?.actor?.userId, userId);
  assert.equal(registry.calls[0]?.params.source, "agent_step");
  assert.equal(typeof registry.calls[0]?.params.timeoutMs, "number");
  assert.ok((registry.calls[0]?.params.timeoutMs ?? 0) >= 1_000);
  assert.ok(registry.calls[0]!.params.maxTokens > 0);
  assert.match(String(registry.calls[0]?.params.system), /strict JSON/i);
  assert.match(String(registry.calls[0]?.params.messages[0]?.content), /Objective context/u);
  assert.match(String(registry.calls[0]?.params.messages[0]?.content), /Raise R9 review quality/u);

  assert.equal(draft.items.length, 3);
  assert.deepEqual(draft.items.map((item) => item.id), [
    "95000000-0000-4000-8000-000000000301",
    "95000000-0000-4000-8000-000000000302",
    "95000000-0000-4000-8000-000000000303"
  ]);
  assert.deepEqual(draft.items.map((item) => item.budgetSharePct), [30, 50, 20]);
  assert.deepEqual(draft.items[1]?.dependsOn, ["95000000-0000-4000-8000-000000000301"]);
  assert.deepEqual(draft.items[2]?.dependsOn, ["95000000-0000-4000-8000-000000000302"]);
});

test("R9.1 meta planner escalates bad decomposition instead of silently cancelling the work item", async () => {
  const registry = new RecordingRegistry([
    validPlan(["a", "b", "c"]),
    { decision: "retry", confidence: "low", reasons: ["template tasks"] },
    validPlan(["a2", "b2", "c2"]),
    { decision: "retry", confidence: "low", reasons: ["acceptance is still unmeasurable"] }
  ]);
  const planner = createMetaPlanner({
    providerRegistry: registry as unknown as ProviderRegistry,
    id: idSequence([
      "95000000-0000-4000-8000-000000000401",
      "95000000-0000-4000-8000-000000000402",
      "95000000-0000-4000-8000-000000000403",
      "95000000-0000-4000-8000-000000000404",
      "95000000-0000-4000-8000-000000000405",
      "95000000-0000-4000-8000-000000000406"
    ])
  });

  await assert.rejects(
    planner.createDraft({
      actor: { id: userId, userId, workspaceId, label: "Planner PM" },
      locale: "zh-CN",
      workItem: {
        id: workItemId,
        workspaceId,
        title: "调研并产出短报告",
        rawDescription: "请拆解成可执行计划"
      },
      acceptance: ["不能静默取消工单"],
      memories: {}
    }),
    (error: unknown) => error instanceof MetaPlannerServiceError
      && error.code === "task_plan_decomposition_needs_human"
      && error.status === 409
  );
  assert.equal(registry.calls.length, 4);
});

test("B-R9.1 judge escalate goes straight to a human without burning another LLM round", async () => {
  // branch-review 未直通：judge 明确说 escalate（要人来澄清）时，旧实现把理由当
  // retry 反馈再烧一轮拆解+judge。现在必须立即 409 升级给人——LLM 只调 2 次。
  const registry = new RecordingRegistry([
    validPlan(["a", "b", "c"]),
    { decision: "escalate", confidence: "low", reasons: ["scope is ambiguous; a human must clarify"] },
    // 若实现错误地继续重试，会吃到下面这组并多出两次调用。
    validPlan(["a2", "b2", "c2"]),
    { decision: "approve", confidence: "high", reasons: ["ok"] }
  ]);
  const planner = createMetaPlanner({
    providerRegistry: registry as unknown as ProviderRegistry,
    id: idSequence([
      "95000000-0000-4000-8000-000000000501",
      "95000000-0000-4000-8000-000000000502",
      "95000000-0000-4000-8000-000000000503"
    ])
  });

  await assert.rejects(
    planner.createDraft({
      actor: { id: userId, userId, workspaceId, label: "Planner PM" },
      locale: "zh-CN",
      workItem: {
        id: workItemId,
        workspaceId,
        title: "调研并产出短报告",
        rawDescription: "范围含糊，需要人先澄清"
      },
      acceptance: ["judge escalate 直通升级"],
      memories: {}
    }),
    (error: unknown) => error instanceof MetaPlannerServiceError
      && error.code === "task_plan_decomposition_needs_human"
      && error.status === 409
  );
  assert.equal(registry.calls.length, 2);
});

test("R9.7 meta planner prompts and escalation copy avoid dispatch wording", async () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const registry = new RecordingRegistry([
      validPlan(["a", "b", "c"]),
      { decision: "retry", confidence: "low", reasons: ["template tasks"] },
      validPlan(["a2", "b2", "c2"]),
      { decision: "retry", confidence: "low", reasons: ["acceptance is still unmeasurable"] }
    ]);
    const planner = createMetaPlanner({
      providerRegistry: registry as unknown as ProviderRegistry,
      id: idSequence([
        "95000000-0000-4000-8000-000000000501",
        "95000000-0000-4000-8000-000000000502",
        "95000000-0000-4000-8000-000000000503",
        "95000000-0000-4000-8000-000000000504",
        "95000000-0000-4000-8000-000000000505",
        "95000000-0000-4000-8000-000000000506"
      ])
    });

    await assert.rejects(
      planner.createDraft({
        actor: { id: userId, userId, workspaceId, label: "Planner PM" },
        locale,
        workItem: {
          id: workItemId,
          workspaceId,
          title: locale === "zh-CN" ? "调研并产出短报告" : "Research and write a short report",
          rawDescription: locale === "zh-CN" ? "请拆解成可执行计划" : "Please decompose this into a reviewable plan"
        },
        acceptance: ["needs human-visible plan review"],
        memories: {}
      }),
      (error: unknown) => error instanceof MetaPlannerServiceError
        && error.code === "task_plan_decomposition_needs_human"
        && !/dispatch|派发/iu.test(error.message)
    );

    const prompts = registry.calls.map((call) => String(call.params.messages[0]?.content ?? "")).join("\n");
    assert.doesNotMatch(prompts, /dispatch|派发/iu);
  }
});
