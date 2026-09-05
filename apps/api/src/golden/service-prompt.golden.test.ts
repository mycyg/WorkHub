/**
 * R25 批 B1 — apps/api 各服务提示词的 golden（会议分析 / 技能策展）。
 *
 * 这两处的组装函数本来就是导出的纯函数（`buildMeetingAnalysis*Prompt`、`buildCuration*Prompt`、
 * `buildSkillRefinement*Prompt`），不需要任何重构就能直接喂常量夹具。
 *
 * 两条被刻意钉住的分支：
 *   - **locale 分支**：会议分析的系统提示词第 5 条按 `normalizeWorkHubLocale(locale) !== "en-US"`
 *     分中英两版，因此中英各落一份 golden。这是全仓少数几个「模型可见文本随 locale 变」的地方之一
 *     （另一处是 project-planner / 澄清问题，见 service-prompt-private.golden.test.ts）。
 *   - **稀疏段落的有无**：策展提示词里的「差评反例」「好评强化」两节只在真有反馈时才拼进去
 *     （skill-curation.ts 里明写不塞空「（无）」节）。有反馈/无反馈各落一份，才能同时钉住
 *     「有的时候长什么样」和「没有的时候整节确实不出现」。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { assertGolden, expectedDirFrom, toGoldenText } from "@workhub/agent/golden";

import {
  buildMeetingAnalysisSystemPrompt,
  buildMeetingAnalysisUserPrompt
} from "../services/meeting-analysis.js";
import {
  buildCurationPrompt,
  buildCurationSystemPrompt,
  buildRefinementSystemPrompt,
  buildSkillRefinementPrompt,
  type SkillCurationAnalysis
} from "../services/skill-curation.js";

const EXPECTED_DIR = expectedDirFrom(import.meta.url, "..", "..");

// --- 会议分析 --------------------------------------------------------------

const TRANSCRIPT = [
  "林岚：这次先把 Q3 的结论定下来，别再拖到下个月。",
  "周远：预算这块我这边还没数，得等财务出口径。",
  "林岚：那就先出一版不含预算的初稿，预算留空。",
  "周远：行，我周五前把财务口径要到。"
].join("\n");

test("golden：会议分析系统提示词（中文 locale）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "meeting-analysis-system-prompt.zh.expected.md",
    actual: toGoldenText(buildMeetingAnalysisSystemPrompt("zh-CN"))
  });
});

test("golden：会议分析系统提示词（英文 locale——第 5 条走另一支）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "meeting-analysis-system-prompt.en.expected.md",
    actual: toGoldenText(buildMeetingAnalysisSystemPrompt("en-US"))
  });
});

test("golden：会议分析用户提示词", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "meeting-analysis-user-prompt.expected.md",
    actual: toGoldenText(
      buildMeetingAnalysisUserPrompt({
        projectName: "季度复盘",
        meetingTitle: "Q3 复盘对齐会",
        transcript: `  ${TRANSCRIPT}  `
      })
    )
  });
});

// MEETING_TRANSCRIPT_PROMPT_MAX = 24000：超长转录会被截断，且提示词第三段换成「truncated」那句。
// 这一态**不**落整份 golden：24000 个字符的填充正文会给仓库塞进 70KB 噪声，而 firstDiff 是按行比的，
// 一整行 24000 字符的 diff 谁也读不了——那样的 expected 只是看起来像门。真正需要钉住的是这一支
// 独有的两件事，各用一条精确断言：
//   (a) 这支才会出现的那行提示语（模型可见文本，逐字比对，含 24000 这个数字本身）；
//   (b) 截断算术：正文恰好是原转录的前 24000 字符，一个不多一个不少。
// 非截断态的「Transcript:」那行由上面那份完整 golden 钉住，两支合起来覆盖完整。
test("会议分析用户提示词：超长转录走截断支（提示语逐字 + 截断算术精确）", () => {
  const transcript = `${"甲".repeat(24_000)}乙丙丁`;
  const rendered = buildMeetingAnalysisUserPrompt({
    projectName: "季度复盘",
    meetingTitle: "Q3 复盘对齐会",
    transcript
  });
  const [projectLine, meetingLine, noticeLine, body] = rendered.split("\n\n");
  assert.equal(projectLine, "Project: 季度复盘");
  assert.equal(meetingLine, "Meeting: Q3 复盘对齐会");
  assert.equal(
    noticeLine,
    "Transcript (truncated to the first 24000 characters — say so in the minutes if it matters):",
    "截断提示语是只在这一支出现的模型可见文本，改动它就是一次提示词变更"
  );
  assert.equal(body, "甲".repeat(24_000), "截断正文必须恰好是原转录的前 24000 字符");
  assert.equal(body.length, 24_000);
});

// --- 技能策展 --------------------------------------------------------------

const BASE_ANALYSIS: SkillCurationAnalysis = {
  workspaceId: "ws-golden-0001",
  acceptedDeliverables: [
    { targetKind: "markdown-report", count: 9 },
    { targetKind: "xlsx-spreadsheet", count: 4 }
  ],
  escalations: [
    { trigger: "tool_failure", count: 3, reasonMd: "反复读不到财务口径表，工人卡在取数这一步。" },
    { trigger: "low_confidence", count: 2, reasonMd: "复盘结论缺少同比口径，工人不敢下判断。" }
  ],
  existingSkills: ["quarterly-report", "data-analysis"],
  discardedSkills: [
    { skillKey: "budget-table", reason: "样本不足（sample_count=2）", count: 2, lastAt: "2026-09-01T00:00:00.000Z" }
  ],
  activeTeamSkillCount: 2,
  activeSkills: [
    {
      skillKey: "quarterly-report",
      name: "季度复盘写法",
      whenToUse: "需要产出季度/月度复盘文档时",
      version: 3,
      contentMd: "---\nname: 季度复盘写法\nwhen_to_use: 需要产出季度复盘文档时\n---\n\n## 步骤\n\n先给结论再给证据。"
    }
  ],
  totalAccepted: 13,
  negativeFeedback: [],
  positiveFeedback: []
};

const ANALYSIS_WITH_FEEDBACK: SkillCurationAnalysis = {
  ...BASE_ANALYSIS,
  negativeFeedback: [
    { subjectType: "conversation_message", excerpt: "把整张表原样贴回来当结论。", note: "要的是结论不是原始表" },
    { subjectType: "proposal", excerpt: "改了三个文件却没说改了什么。", note: null }
  ],
  positiveFeedback: [
    { subjectType: "proposal", count: 6 },
    { subjectType: "action_card_item", count: 2 }
  ]
};

test("golden：技能策展系统提示词", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "skill-curation-system-prompt.expected.md",
    actual: toGoldenText(buildCurationSystemPrompt())
  });
});

test("golden：技能策展提示词（无人类反馈——反馈两节整节不出现）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "skill-curation-prompt.no-feedback.expected.md",
    actual: toGoldenText(buildCurationPrompt(BASE_ANALYSIS))
  });
});

test("golden：技能策展提示词（含差评反例 + 好评强化两节）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "skill-curation-prompt.with-feedback.expected.md",
    actual: toGoldenText(buildCurationPrompt(ANALYSIS_WITH_FEEDBACK))
  });
});

test("golden：技能精修系统提示词", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "skill-refinement-system-prompt.expected.md",
    actual: toGoldenText(buildRefinementSystemPrompt())
  });
});

test("golden：技能精修提示词（有激活技能）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "skill-refinement-prompt.expected.md",
    actual: toGoldenText(buildSkillRefinementPrompt(BASE_ANALYSIS))
  });
});

// REFINE_CONTENT_PREVIEW_CHARS = 1600：技能正文喂回 prompt 时按此截断（技能会注入每个未来 worker
// 的 prompt，体积失控的代价是每一次 run 都多烧 token），所以这条上限值得单独钉一份。
test("golden：技能精修提示词（技能正文超 1600 字符被截断）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "skill-refinement-prompt.truncated.expected.md",
    actual: toGoldenText(
      buildSkillRefinementPrompt({
        ...BASE_ANALYSIS,
        activeSkills: [{ ...BASE_ANALYSIS.activeSkills[0]!, contentMd: `${"甲".repeat(1600)}乙丙丁` }]
      })
    )
  });
});

test("golden：技能精修提示词（无激活技能可精修）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "skill-refinement-prompt.no-active-skills.expected.md",
    actual: toGoldenText(buildSkillRefinementPrompt({ ...BASE_ANALYSIS, activeSkills: [] }))
  });
});
