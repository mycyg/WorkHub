/**
 * R25 批 B1 — 原先「藏在服务模块里、外部叫不到」的提示词组装点的 golden。
 *
 * 与同目录 service-prompt.golden.test.ts 的区别只有一个：那边的组装函数本来就是导出的，
 * 这边的原本是模块私有函数。为落这道门做了**只加 export 关键字**的最小重构（函数体逐字未动，
 * 见各处 `R25 批 B1：仅加 export` 注释）：
 *   - project-planner.ts    → plannerPrompt / judgePrompt
 *   - cross-agent-judge.ts  → candidatePrompt / judgePrompt / HIGH_RISK_VOTE_PERSPECTIVES
 *   - work-items.ts         → clarificationPrompt / ClarificationQuestionInput
 * 之所以敢只加 export 就算「分离了拼字符串与取数」：这三处本来就已经是纯函数——输入全在参数里，
 * 不碰 DB、不读时钟、不生成 id。真正做取数的是它们的调用方（createProjectPlanner.createDraft 等），
 * 那一层继续由既有服务单测覆盖，两边不重叠。
 *
 * 覆盖的分支（每条都是一次「模型看到的字不一样」）：
 *   - project-planner：locale 中英两支 × 有/无重拟反馈 × 有/无仓库动态；
 *   - cross-agent-judge：单视角 / 多视角（高风险三视角投票）× 候选带不带 confidence；
 *   - 澄清反问：locale 中英两支 × 有/无可见项目文件。
 */
import test from "node:test";

import { assertGolden, expectedDirFrom, toGoldenText } from "@workhub/agent/golden";

import {
  candidatePrompt,
  judgePrompt as crossAgentJudgePrompt,
  HIGH_RISK_VOTE_PERSPECTIVES,
  type CrossAgentCandidate,
  type CrossAgentJudgeInput
} from "../services/cross-agent-judge.js";
import {
  judgePrompt as projectPlanJudgePrompt,
  plannerPrompt,
  type ProjectPlannerCreateDraftInput
} from "../services/project-planner.js";
import { clarificationPrompt, type ClarificationQuestionInput } from "../services/work-items.js";

const EXPECTED_DIR = expectedDirFrom(import.meta.url, "..", "..");

// --- project-planner -------------------------------------------------------

const PLANNER_INPUT: ProjectPlannerCreateDraftInput = {
  actor: { id: "user-golden-0001", label: "林岚", workspaceId: "ws-golden-0001" },
  locale: "zh-CN",
  project: { id: "proj-golden-0001", name: "季度复盘", workspaceId: "ws-golden-0001" },
  intent: "  10 月底前产出 Q3 复盘正式版，含预算口径，法务需过一轮。  ",
  currentState: ["里程碑：Q3 初稿（已完成）", "工作项：整理交付质量数据（进行中）"]
};

test("golden：项目计划起草提示词（中文 locale，最小态）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "project-planner-prompt.zh.expected.md",
    actual: toGoldenText(plannerPrompt(PLANNER_INPUT))
  });
});

test("golden：项目计划起草提示词（英文 locale——首行与规则段走另一支）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "project-planner-prompt.en.expected.md",
    actual: toGoldenText(plannerPrompt({ ...PLANNER_INPUT, locale: "en-US" }))
  });
});

// 重拟这一支线上真的会走到（createDraft 第二次尝试会把上一轮的校验失败原因喂回去），
// 且它同时带上「人类审阅者拒绝理由」——两段措辞不同、来源不同，必须分别看得见。
test("golden：项目计划起草提示词（完整态——重拟反馈 + 人工拒绝理由 + 仓库动态）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "project-planner-prompt.retry.expected.md",
    actual: toGoldenText(
      plannerPrompt(
        {
          ...PLANNER_INPUT,
          rejectionFeedback: ["预算口径没写清楚，按哪一版财务表算要说明。"],
          repoActivity: ["有人在 q3-review 分支上改了汇总脚本（3 次提交）", "PR #128 已合并：补齐交付质量取数"]
        },
        ["milestone_ref 引用了不存在的里程碑 m9", "两个工作项互相依赖形成环"]
      )
    )
  });
});

test("golden：项目计划评审提示词", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "project-planner-judge-prompt.expected.md",
    actual: toGoldenText(
      projectPlanJudgePrompt(
        {
          milestones: [{ ref: "m1", title: "Q3 复盘正式版", due_at: "2026-10-31T00:00:00Z", sort: 0 }],
          items: [
            {
              ref: "t1",
              title: "补齐预算口径",
              objective_md: "对齐财务表口径，产出 outputs/budget-basis.md。",
              due_at: "2026-10-20T00:00:00Z",
              milestone_ref: "m1",
              depends_on_refs: [],
              assignee_suggestion: "周远"
            }
          ],
          rationale_md: "预算口径是复盘定稿的前置，先排它。"
        },
        PLANNER_INPUT
      )
    )
  });
});

// --- cross-agent-judge -----------------------------------------------------

const CANDIDATE_WITH_CONFIDENCE: CrossAgentCandidate = {
  id: "cand-golden-0001",
  title: "复盘结论 A 版",
  producerRunId: "run-golden-0001",
  taskPlanItemId: "tpi-golden-0001",
  contentMd: "结论：Q3 交付质量较 Q2 提升，返工率由 12% 降到 7%。",
  confidence: {
    grade: "high",
    verdict: "auto_merge",
    rationaleMd: "两处数字都能在交付台账里对上。"
  }
};

const CANDIDATE_WITHOUT_CONFIDENCE: CrossAgentCandidate = {
  id: "cand-golden-0002",
  title: "复盘结论 B 版",
  contentMd: "结论：Q3 返工率下降，但样本偏少，建议再观察一个季度。"
};

const JUDGE_INPUT: CrossAgentJudgeInput = {
  actor: { id: "user-golden-0001", label: "林岚", workspaceId: "ws-golden-0001" },
  planId: "plan-golden-0001",
  taskPlanItemId: "tpi-golden-0001",
  acceptance: ["结论必须能在交付台账里对上数字", "结论用人话，业务方能直接读"],
  candidates: [CANDIDATE_WITH_CONFIDENCE, CANDIDATE_WITHOUT_CONFIDENCE]
};

test("golden：跨 agent 评审的单份候选片段（有 confidence / 无 confidence 两态）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "cross-agent-candidate-prompt.expected.md",
    actual: toGoldenText(
      [candidatePrompt(CANDIDATE_WITH_CONFIDENCE, 0), candidatePrompt(CANDIDATE_WITHOUT_CONFIDENCE, 1)].join("\n\n")
    )
  });
});

test("golden：跨 agent 评审提示词（单视角）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "cross-agent-judge-prompt.expected.md",
    actual: toGoldenText(crossAgentJudgePrompt(JUDGE_INPUT))
  });
});

// 高风险多视角投票：每个视角一次独立调用，判定视角那行是各次调用间唯一的差别——把三份拼在
// 一起落一份 golden，让「三个视角分别对模型说了什么」在评审里一眼可比。
test("golden：跨 agent 评审提示词（高风险三视角投票，各视角一份）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "cross-agent-judge-prompt.perspectives.expected.md",
    actual: toGoldenText(
      HIGH_RISK_VOTE_PERSPECTIVES.map(
        (perspective) => `# perspective=${perspective.id}\n\n${crossAgentJudgePrompt(JUDGE_INPUT, perspective)}`
      ).join("\n\n---\n\n")
    )
  });
});

// --- 澄清反问（intake） ----------------------------------------------------

const CLARIFICATION_ACTOR = {
  kind: "human" as const,
  id: "user-golden-0001",
  label: "林岚",
  userId: "user-golden-0001",
  isAdmin: false,
  orgId: "org-golden-0001",
  workspaceId: "ws-golden-0001"
};

const CLARIFICATION_INPUT: ClarificationQuestionInput = {
  workItem: {
    id: "wi-golden-0001",
    projectId: "proj-golden-0001",
    title: "整理 Q3 交付质量复盘",
    rawDescription: "把 Q3 的交付质量复盘一下，重点看返工率。"
  },
  files: [
    { name: "q3-delivery.csv", path: "project/q3-delivery.csv", mime: "text/csv", sizeBytes: 20_480, preview: "交付批次,返工次数\n1,2" },
    { name: "q2-review.md", path: "project/q2-review.md", mime: "text/markdown", sizeBytes: 8_192 }
  ],
  actor: CLARIFICATION_ACTOR,
  locale: "zh-CN"
};

test("golden：澄清反问提示词（中文 locale，有项目文件）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "clarification-prompt.zh.expected.md",
    actual: toGoldenText(clarificationPrompt(CLARIFICATION_INPUT))
  });
});

test("golden：澄清反问提示词（英文 locale——三条规则段全走另一支）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "clarification-prompt.en.expected.md",
    actual: toGoldenText(clarificationPrompt({ ...CLARIFICATION_INPUT, locale: "en-US" }))
  });
});

test("golden：澄清反问提示词（没有可见项目文件）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "clarification-prompt.no-files.expected.md",
    actual: toGoldenText(clarificationPrompt({ ...CLARIFICATION_INPUT, files: [] }))
  });
});
