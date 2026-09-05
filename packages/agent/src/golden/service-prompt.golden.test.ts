/**
 * R25 批 B1 — packages/agent 里除 turn / agent run 之外的模型可见文本 golden。
 *
 * 覆盖三条「读一段材料 → 吐严格 JSON」的判定链路，它们各自有独立的系统提示词：
 *   - observer（静默观察者，packages/agent/src/observer/prompt.ts）
 *   - reply-judge（回话判定器，packages/agent/src/reply-judge/prompt.ts）
 *   - spotlight-intent（聚焦盒意图分类，packages/agent/src/spotlight-intent/prompt.ts）
 *
 * 这三处的组装函数本来就是导出的纯函数（各自文件顶部注释都写明「不碰网络/DB，方便单测」），
 * 所以这份 golden 不需要任何重构，直接喂常量夹具即可。
 *
 * 夹具里刻意各留一处「越界」样本，让被 golden 钉住的不只是happy path：
 *   - observer：roster 传 9 条（上限 8）、repoActivity 传 13 条（上限 12），把截断行为钉死；
 *   - reply-judge：recentMessages 传 9 条（上限 8，只保留最后 8 条）；
 *   - spotlight-intent：一条 hint 超过 200 字符，把省略号尾注钉死。
 * 上限一旦被改动，这些 golden 会立刻红——而不是等到线上 prompt 悄悄膨胀才发现。
 */
import test from "node:test";

import { buildObserverSystemPrompt, buildObserverUserPrompt, type ObserverPromptInput } from "../observer/index.js";
import { buildReplyJudgeSystemPrompt, buildReplyJudgeUserPrompt } from "../reply-judge/index.js";
import {
  buildSpotlightIntentSystemPrompt,
  buildSpotlightIntentUserPrompt,
  type SpotlightIntentCapability
} from "../spotlight-intent/index.js";
import { assertGolden, expectedDirFrom, toGoldenText } from "./expected.js";

const EXPECTED_DIR = expectedDirFrom(import.meta.url, "..", "..");

// --- observer 夹具 ---------------------------------------------------------

const OBSERVER_MESSAGES: ObserverPromptInput["messages"] = [
  {
    seq: 101,
    senderKind: "user",
    senderLabel: "林岚",
    text: "季度复盘的初稿我看完了，结论那节还得再收一收。",
    createdAt: "2026-09-05T02:00:00.000Z"
  },
  {
    seq: 102,
    senderKind: "user",
    senderLabel: "周远",
    text: "预算那块要不要报到管委会？这个我拿不准。",
    createdAt: "2026-09-05T02:01:00.000Z"
  },
  {
    seq: 103,
    senderKind: "cuu",
    senderLabel: "Cuu",
    text: "已经把上一版归档在网盘的 2026-Q3 目录下了。",
    createdAt: "2026-09-05T02:02:00.000Z"
  },
  {
    seq: 104,
    senderKind: "system",
    senderLabel: "系统",
    text: "林岚 上传了文件：q3-review-draft.md",
    createdAt: "2026-09-05T02:03:00.000Z"
  }
];

// 9 条候选：越过 MAX_CANDIDATE_ROSTER_ITEMS(8)，golden 里应只看见前 8 条。
const OBSERVER_ROSTER: ObserverPromptInput["candidateRoster"] = Array.from({ length: 9 }, (_, index) => ({
  nickname: `候选${index + 1}`,
  title: index % 2 === 0 ? "产品经理" : null,
  // 第一位给 7 个技能：越过 MAX_TOP_SKILLS_PER_CANDIDATE(6)，钉住每人技能数的截断。
  topSkills: index === 0
    ? ["复盘写作", "数据分析", "汇报材料", "需求梳理", "会议纪要", "风险识别", "第七个应被截掉"]
    : ["复盘写作", "数据分析"],
  score: 90 - index
}));

// 13 条仓库动态：越过 MAX_REPO_ACTIVITY_ITEMS(12)。
const OBSERVER_REPO_ACTIVITY = Array.from(
  { length: 13 },
  (_, index) => `第 ${index + 1} 条仓库动态：有人在 q3-review 分支上改了汇总脚本。`
);

test("golden：observer 系统提示词", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "observer-system-prompt.expected.md",
    actual: toGoldenText(buildObserverSystemPrompt())
  });
});

test("golden：observer 用户提示词（最小态——只有讨论，无引用/无名单/无仓库动态）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "observer-user-prompt.minimal.expected.md",
    actual: toGoldenText(
      buildObserverUserPrompt({ projectName: "季度复盘", messages: OBSERVER_MESSAGES })
    )
  });
});

test("golden：observer 用户提示词（完整态——引用材料 + 仓库动态 + 派活候选名单，含各处截断）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "observer-user-prompt.full.expected.md",
    actual: toGoldenText(
      buildObserverUserPrompt({
        projectName: "季度复盘",
        messages: OBSERVER_MESSAGES,
        referencedContext: ["网盘文件：q3-review-draft.md（第 3 版）", "会话：上周三的复盘对齐"],
        repoActivity: OBSERVER_REPO_ACTIVITY,
        candidateRoster: OBSERVER_ROSTER
      })
    )
  });
});

test("golden：observer 用户提示词（空讨论——水位线之后没有新消息）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "observer-user-prompt.empty.expected.md",
    actual: toGoldenText(buildObserverUserPrompt({ projectName: "季度复盘", messages: [] }))
  });
});

// --- reply-judge 夹具 ------------------------------------------------------

// 9 条：越过 MAX_RECENT_MESSAGES(8)，且取的是**最后** 8 条（slice(-8)），golden 里第 1 条应消失。
const REPLY_JUDGE_HISTORY = Array.from({ length: 9 }, (_, index) => ({
  senderLabel: index % 2 === 0 ? "林岚" : "周远",
  text: `第 ${index + 1} 句：先把结论那节的口径对齐再说。`
}));

test("golden：reply-judge 系统提示词", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "reply-judge-system-prompt.expected.md",
    actual: toGoldenText(buildReplyJudgeSystemPrompt())
  });
});

test("golden：reply-judge 用户提示词（有聊天记录——含超出上限的截断）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "reply-judge-user-prompt.with-history.expected.md",
    actual: toGoldenText(
      buildReplyJudgeUserPrompt({
        recentMessages: REPLY_JUDGE_HISTORY,
        candidateText: "那预算这块谁来拍板？"
      })
    )
  });
});

// 生产现状：apps/api/src/services/conversation-reply-judge.ts 调 judgeReply 时从不传 recentMessages
// （见该文件注释），所以这一态才是线上每次真正发出去的那份提示词——务必有 golden。
test("golden：reply-judge 用户提示词（无聊天记录——当前生产实际走的就是这一态）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "reply-judge-user-prompt.no-history.expected.md",
    actual: toGoldenText(
      buildReplyJudgeUserPrompt({ recentMessages: [], candidateText: "那预算这块谁来拍板？" })
    )
  });
});

// --- spotlight-intent 夹具 -------------------------------------------------

const SPOTLIGHT_CAPABILITIES: SpotlightIntentCapability[] = [
  { id: "approvals", label: "审批队列", hint: "等你拍板的提议" },
  { id: "drive", label: "网盘" },
  // hint 超过 MAX_HINT_CHARS(200)，钉住省略尾注的渲染形状。
  { id: "cost", label: "成本", hint: `成本口径说明：${"该字段用于说明本月预算与实际支出的差额口径。".repeat(12)}` }
];

test("golden：spotlight-intent 系统提示词", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "spotlight-intent-system-prompt.expected.md",
    actual: toGoldenText(buildSpotlightIntentSystemPrompt())
  });
});

test("golden：spotlight-intent 用户提示词（有能力清单，含 hint 截断）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "spotlight-intent-user-prompt.expected.md",
    actual: toGoldenText(
      buildSpotlightIntentUserPrompt({
        query: "  帮我看看这个月成本超没超  ",
        capabilities: SPOTLIGHT_CAPABILITIES
      })
    )
  });
});

test("golden：spotlight-intent 用户提示词（空能力清单）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "spotlight-intent-user-prompt.no-capabilities.expected.md",
    actual: toGoldenText(buildSpotlightIntentUserPrompt({ query: "新建一个 Q4 复盘项目", capabilities: [] }))
  });
});
