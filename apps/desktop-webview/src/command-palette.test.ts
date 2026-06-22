import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  commandRegistry,
  matchCommands,
  renderCommandPalette,
  resolveCommandAction
} from "./command-palette.js";

test("registry covers every backend capability surface", () => {
  const ids = commandRegistry.map((c) => c.id).sort();
  assert.deepEqual(
    ids,
    [
      "approvals",
      "cost",
      "drive",
      "intake",
      "knowledge",
      "projects",
      "proposals",
      "replay",
      "settings",
      "team",
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
  // 英文/别名
  assert.equal(matchCommands("approve", "en")[0]?.command.id, "approvals");
  assert.equal(matchCommands("diff", "en")[0]?.command.id, "proposals");
  assert.equal(matchCommands("pr", "en")[0]?.command.id, "proposals");
  assert.equal(matchCommands("files", "en")[0]?.command.id, "drive");
});

test("ranking: exact/prefix beats substring beats subsequence", () => {
  // "项目" exact-ish on projects label/keyword should rank projects first.
  assert.equal(matchCommands("项目", "zh-CN")[0]?.command.id, "projects");
  // a query that matches nothing → no results.
  assert.equal(matchCommands("zzzzzz", "en").length, 0);
});

test("resolveCommandAction returns the routing descriptor", () => {
  assert.deepEqual(resolveCommandAction("intake"), { kind: "start-flow", target: "intake" });
  assert.deepEqual(resolveCommandAction("drive"), { kind: "open-window", target: "drive" });
  assert.equal(resolveCommandAction("nope" as never), undefined);
});

test("render emits a glass palette with routable rows + input + badges", () => {
  const html = renderCommandPalette({ query: "", locale: "zh-CN", badges: { approvals: 3 } });
  assert.match(html, /data-wh-command-palette/u);
  assert.match(html, /data-command-input/u);
  // 每行带可路由的 data 属性
  assert.match(html, /data-command-id="intake"[^>]*data-command-kind="start-flow"[^>]*data-command-target="intake"/u);
  assert.match(html, /data-command-id="drive"[^>]*data-command-target="drive"/u);
  // 徽标计数（如审批 3）
  assert.match(html, /wh-cmd-badge">3</u);
  // 用设计系统玻璃 + 入场动画类
  assert.match(html, /ds-glass-strong/u);
  assert.match(html, /ds-anim-spring-in/u);
  // 离线安全图标（内联 svg，非 emoji）
  assert.match(html, /<svg viewBox="0 0 24 24"/u);
  assert.doesNotMatch(html, /📥|📝|⚖️|💰/u);
});

test("render escapes the query (no HTML injection via the search box)", () => {
  const html = renderCommandPalette({ query: '"><img src=x onerror=alert(1)>', locale: "en" });
  assert.doesNotMatch(html, /<img src=x/u);
  assert.match(html, /&quot;&gt;&lt;img/u);
});
