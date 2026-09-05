import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  commandRegistry,
  matchCommands
} from "./command-palette.js";

test("registry covers every backend capability surface", () => {
  const ids = commandRegistry.map((c) => c.id).sort();
  assert.deepEqual(
    ids,
    [
      // R9.6 adds the live-only Agent Army command-center ability; the old list
      // was complete only before the desktop command center existed.
      "agents",
      "approvals",
      "cost",
      "drive",
      "intake",
      "knowledge",
      // R14 批 MEM：Cuu 的记忆——独立能力视图（关于我/团队技能两个 tab），见 spotlight/views/memory.ts。
      "memory",
      // R12 批 1：工作台是独立窗口(deep-link 打开)，「新建项目」是它的快捷入口，两条都只 invoke
      // open_workbench，不在盒子内联渲染——见 spotlight/views/workbench-open.ts。
      "new_project",
      // R5 双端一致：桌面补通知中心入口（通知箱+按类型静音），与 web 对齐。
      "notifications",
      "projects",
      "proposals",
      "replay",
      // R14 批 SEARCH：跨会话·网盘·工单·会议的全局搜索入口。
      "search",
      "settings",
      "team",
      "workbench",
      "workitem"
    ].sort()
  );
  // 每条命令都有动作目标（壳层据此路由），不留死命令。
  for (const c of commandRegistry) {
    assert.ok(c.action.target.length > 0, `${c.id} missing action target`);
    assert.ok(["open-window", "start-flow"].includes(c.action.kind));
  }
});

test("empty query returns every capability in registry order", () => {
  const matches = matchCommands("", "zh-CN");
  assert.equal(matches.length, commandRegistry.length);
  assert.equal(matches[0]?.command.id, commandRegistry[0]?.id);
});

test("fuzzy router: one phrase reaches the right capability (zh + en + alias)", () => {
  // 中文意图
  assert.equal(matchCommands("派活", "zh-CN")[0]?.command.id, "intake");
  assert.equal(matchCommands("网盘", "zh-CN")[0]?.command.id, "drive");
  assert.equal(matchCommands("审批", "zh-CN")[0]?.command.id, "approvals");
  assert.equal(matchCommands("成本", "zh-CN")[0]?.command.id, "cost");
  assert.equal(matchCommands("军团", "zh-CN")[0]?.command.id, "agents");
  assert.equal(matchCommands("小队", "zh-CN")[0]?.command.id, "agents");
  // 英文/别名
  assert.equal(matchCommands("approve", "en")[0]?.command.id, "approvals");
  assert.equal(matchCommands("diff", "en")[0]?.command.id, "proposals");
  assert.equal(matchCommands("pr", "en")[0]?.command.id, "proposals");
  assert.equal(matchCommands("files", "en")[0]?.command.id, "drive");
  assert.equal(matchCommands("agents", "en")[0]?.command.id, "agents");
  assert.equal(matchCommands("army", "en")[0]?.command.id, "agents");
  // R12 批 1：工作台 / 新建项目 两条新入口。
  assert.equal(matchCommands("工作台", "zh-CN")[0]?.command.id, "workbench");
  assert.equal(matchCommands("新建项目", "zh-CN")[0]?.command.id, "new_project");
  assert.equal(matchCommands("workbench", "en")[0]?.command.id, "workbench");
  assert.equal(matchCommands("new project", "en")[0]?.command.id, "new_project");
  // R14 批 SEARCH：全局搜索。「查找/全局/find/global」是它独有的关键词，无歧义。
  assert.equal(matchCommands("查找", "zh-CN")[0]?.command.id, "search");
  assert.equal(matchCommands("全局", "zh-CN")[0]?.command.id, "search");
  assert.equal(matchCommands("find", "en")[0]?.command.id, "search");
  assert.equal(matchCommands("global", "en")[0]?.command.id, "search");
});

test("R14: 'search'/'搜索' is shared between the new global-search command and the older project-scoped knowledge command — registry order (search registered first) breaks the tie in favor of the newer, broader capability", () => {
  assert.equal(matchCommands("搜索", "zh-CN")[0]?.command.id, "search");
  assert.equal(matchCommands("search", "en")[0]?.command.id, "search");
  // knowledge keeps winning on its own unambiguous keywords.
  assert.equal(matchCommands("知识检索", "zh-CN")[0]?.command.id, "knowledge");
  assert.equal(matchCommands("wiki", "en")[0]?.command.id, "knowledge");
});

test("ranking: exact/prefix beats substring beats subsequence", () => {
  // "项目" exact-ish on projects label/keyword should rank projects first.
  assert.equal(matchCommands("项目", "zh-CN")[0]?.command.id, "projects");
  // a query that matches nothing → no results.
  assert.equal(matchCommands("zzzzzz", "en").length, 0);
});

// WIRE-05：renderCommandPalette/resolveCommandAction/commandPaletteCss（玻璃命令面板浮层 UI）已随死代码
// 清理删除——文案/关键词纪律改为直接断言注册表数据（launcher 只消费 commandRegistry + matchCommands）。
test("R9.7 command registry uses new-task wording instead of dispatch copy", () => {
  const intake = commandRegistry.find((command) => command.id === "intake");

  assert.doesNotMatch(intake?.label["zh-CN"] ?? "", /派活/u);
  assert.doesNotMatch(intake?.label.en ?? "", /Dispatch|dispatch/u);
  assert.match(intake?.label["zh-CN"] ?? "", /新任务 \/ 交给 AI/u);
  assert.match(intake?.label.en ?? "", /New task/u);
  assert.equal(matchCommands("dispatch", "en")[0]?.command.id, "intake");
});

test("R9.7 desktop agents command uses Cuu squad wording instead of Agent Army copy", () => {
  const agents = commandRegistry.find((command) => command.id === "agents");

  assert.match(agents?.label["zh-CN"] ?? "", /Cuu 的小队/u);
  assert.match(agents?.label.en ?? "", /Cuu's squad/u);
  assert.doesNotMatch(`${agents?.label["zh-CN"]}${agents?.label.en}`, /Agent Army/u);
  assert.equal(matchCommands("army", "en")[0]?.command.id, "agents");
  assert.equal(matchCommands("agent army", "en")[0]?.command.id, "agents");
});
