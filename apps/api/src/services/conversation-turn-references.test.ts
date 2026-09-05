import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TURN_CONVERSATION_REFS,
  mayInvokeSkill,
  mayReferenceConversation,
  resolveConversationRefs,
  resolveSkillRefs,
  type ConversationRefCandidate,
  type SkillRefCandidate
} from "./conversation-turn-references.js";

const conversationA: ConversationRefCandidate = { id: "conv-a", title: "预算复盘" };
const conversationB: ConversationRefCandidate = { id: "conv-b", title: "预算复盘 二轮" };
const conversationC: ConversationRefCandidate = { id: "conv-c", title: "投放排期" };

function skill(overrides: Partial<SkillRefCandidate> = {}): SkillRefCandidate {
  return {
    skillKey: "weekly-report",
    name: "周报模板",
    whenToUse: "写周报之前",
    contentMd: "先列三段：做完了什么 / 卡在哪 / 下周做什么",
    ...overrides
  };
}

// —— 便宜预判 —— //

test("mayReferenceConversation only fires for a # that sits at a real trigger boundary", () => {
  assert.equal(mayReferenceConversation("#预算复盘 看一下"), true);
  assert.equal(mayReferenceConversation("看一下 #预算复盘"), true);
  assert.equal(mayReferenceConversation("看一下\n#预算复盘"), true);
  // 正文里的井号（编号/话题标签写法）不算触发——不该为它多付一次会话清单查询。
  assert.equal(mayReferenceConversation("bug#123 修好了"), false);
  assert.equal(mayReferenceConversation("没有任何引用"), false);
});

test("mayInvokeSkill only fires for a leading slash immediately followed by a name", () => {
  assert.equal(mayInvokeSkill("/周报模板 帮我写一份"), true);
  // 斜杠不在开头＝正文里写路径/分数，不是唤起。
  assert.equal(mayInvokeSkill("看看 /周报模板"), false);
  assert.equal(mayInvokeSkill("/ 后面是空格"), false);
  assert.equal(mayInvokeSkill("/"), false);
});

// —— #会话引用 —— //

test("resolveConversationRefs matches a title written after # at a word boundary", () => {
  const refs = resolveConversationRefs("帮我对一下 #预算复盘 里的口径", [conversationA, conversationC]);
  assert.deepEqual(
    refs.map((ref) => ref.id),
    ["conv-a"]
  );
});

test("resolveConversationRefs prefers the longest matching title so a prefix title cannot steal the hit", () => {
  const refs = resolveConversationRefs("看 #预算复盘 二轮 的结论", [conversationA, conversationB]);
  assert.deepEqual(
    refs.map((ref) => ref.id),
    ["conv-b"]
  );
});

test("resolveConversationRefs ignores a # that is glued to preceding text", () => {
  assert.deepEqual(resolveConversationRefs("bug#预算复盘", [conversationA]), []);
});

test("resolveConversationRefs requires the title to end at a boundary, not mid-word", () => {
  // 「#预算复盘表」不该命中会话「预算复盘」——右边界规则挡住。
  assert.deepEqual(resolveConversationRefs("#预算复盘表 在哪", [conversationA]), []);
});

test("resolveConversationRefs returns hits in the order they appear in the text", () => {
  const refs = resolveConversationRefs("先看 #投放排期 再看 #预算复盘", [conversationA, conversationC]);
  assert.deepEqual(
    refs.map((ref) => ref.id),
    ["conv-c", "conv-a"]
  );
});

test("resolveConversationRefs caps the number of references it accepts", () => {
  const many = [conversationA, conversationC, { id: "conv-d", title: "招聘进度" }];
  const refs = resolveConversationRefs("#预算复盘 #投放排期 #招聘进度", many);
  assert.equal(refs.length, MAX_TURN_CONVERSATION_REFS);
  assert.deepEqual(
    refs.map((ref) => ref.id),
    ["conv-a", "conv-c"]
  );
});

test("resolveConversationRefs skips a self-reference to the conversation being spoken in", () => {
  const refs = resolveConversationRefs("#预算复盘 和 #投放排期", [conversationA, conversationC], {
    excludeConversationId: "CONV-A"
  });
  assert.deepEqual(
    refs.map((ref) => ref.id),
    ["conv-c"]
  );
});

test("resolveConversationRefs resolves nothing when the title is not among the visible candidates", () => {
  // 看不见的会话不在候选清单里就永远解析不上——权限收口在调用方查候选的那一步。
  assert.deepEqual(resolveConversationRefs("#别人的私密会话 借我看看", [conversationA]), []);
});

// —— /技能唤起 —— //

test("resolveSkillRefs matches a skill name at the very start of the message", () => {
  const refs = resolveSkillRefs("/周报模板 帮我起一份", [skill()]);
  assert.deepEqual(
    refs.map((ref) => ref.skillKey),
    ["weekly-report"]
  );
});

test("resolveSkillRefs matches a bare invocation with nothing after the name", () => {
  assert.equal(resolveSkillRefs("/周报模板", [skill()]).length, 1);
});

test("resolveSkillRefs ignores a slash that is not at the start of the message", () => {
  assert.deepEqual(resolveSkillRefs("帮我 /周报模板", [skill()]), []);
});

test("resolveSkillRefs does not half-match a longer name", () => {
  assert.deepEqual(resolveSkillRefs("/周报模板加强版", [skill()]), []);
});

test("resolveSkillRefs prefers the longest matching skill name", () => {
  const refs = resolveSkillRefs("/周报模板 加强版 走一下", [
    skill(),
    skill({ skillKey: "weekly-report-plus", name: "周报模板 加强版" })
  ]);
  assert.deepEqual(
    refs.map((ref) => ref.skillKey),
    ["weekly-report-plus"]
  );
});

test("resolveSkillRefs takes at most one skill per turn", () => {
  const refs = resolveSkillRefs("/周报模板", [skill(), skill({ skillKey: "other", name: "周报模板" })]);
  assert.equal(refs.length, 1);
});

// —— 两端之间的格式契约 —— //
//
// 桌面端 picker 选中一条候选后，往输入框里插的是**带尾随空格**的纯文本（view.ts 的 pickConversationRef
// / pickSkill：`#${title} ` / `/${name} `）。这条格式是前后端唯一的接头暗号——没有结构化字段兜底，
// 插入格式一变、或解析器的边界规则一收紧，引用就会静默失效（用户看正文以为引用了，Cuu 其实没拿到）。
// 所以这里逐字复刻两端的插入结果来解析一遍，把格式钉死在测试里。

test("the exact text the composer inserts for a picked conversation resolves back to that conversation", () => {
  const inserted = `#${conversationA.title} `;
  assert.deepEqual(
    resolveConversationRefs(inserted, [conversationA, conversationC]).map((ref) => ref.id),
    ["conv-a"]
  );
  // 用户在插入的引用后面接着往下写正文，引用照样成立。
  assert.deepEqual(
    resolveConversationRefs(`${inserted}这里的口径帮我核一下`, [conversationA]).map((ref) => ref.id),
    ["conv-a"]
  );
  // 引用写在句中（先打字、再从工具条点「#会话」）也成立。
  assert.deepEqual(
    resolveConversationRefs(`帮我核一下 ${inserted}的口径`, [conversationA]).map((ref) => ref.id),
    ["conv-a"]
  );
});

test("the exact text the composer inserts for a picked skill resolves back to that skill", () => {
  const picked = skill();
  const inserted = `/${picked.name} `;
  assert.deepEqual(
    resolveSkillRefs(inserted, [picked]).map((ref) => ref.skillKey),
    ["weekly-report"]
  );
  assert.deepEqual(
    resolveSkillRefs(`${inserted}这周的进度整理一下`, [picked]).map((ref) => ref.skillKey),
    ["weekly-report"]
  );
});

test("a picked conversation whose title contains spaces still resolves from the inserted text", () => {
  // picker 里选得到的标题可能带空格；插入的仍然是「#整个标题 」一段，解析靠「长标题优先 + 右边界」
  // 而不是靠"标题里没有空格"这条不成立的假设。
  assert.deepEqual(
    resolveConversationRefs(`#${conversationB.title} 看一下`, [conversationA, conversationB]).map((ref) => ref.id),
    ["conv-b"]
  );
});
