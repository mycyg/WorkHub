import assert from "node:assert/strict";
import test from "node:test";

import {
  humanizeProjectLifecycleError,
  projectLifecycleConfirmLabel,
  projectLifecycleSuccessMessage
} from "./project-lifecycle.js";

// R23 P4（R20 P2A 端点上界面）：归档/删除是破坏性动作，两段式确认的第二段必须明说这一下会发生什么，
// 而不是含糊的「确认？」——两个动作的文案也不能长得一样，否则武装态下用户分不清自己点的是哪个。
test("projectLifecycleConfirmLabel spells out which destructive action is armed", () => {
  assert.equal(projectLifecycleConfirmLabel("archive", "zh-CN"), "确认归档？再点一次");
  assert.equal(projectLifecycleConfirmLabel("delete", "zh-CN"), "确认删除？再点一次");
  assert.notEqual(
    projectLifecycleConfirmLabel("archive", "zh-CN"),
    projectLifecycleConfirmLabel("delete", "zh-CN")
  );
  assert.equal(projectLifecycleConfirmLabel("archive", "en-US"), "Archive — click again");
  assert.equal(projectLifecycleConfirmLabel("delete", "en-US"), "Delete — click again");
});

test("projectLifecycleSuccessMessage names the project and says what changed", () => {
  const archived = projectLifecycleSuccessMessage("archive", "R5 工作区", "zh-CN");
  assert.equal(archived.includes("R5 工作区"), true);
  assert.match(archived, /不会再出现在团队项目列表/u);

  const deleted = projectLifecycleSuccessMessage("delete", "R5 工作区", "zh-CN");
  assert.match(deleted, /已删除/u);
  assert.notEqual(archived, deleted);

  // 名字缺失（服务端回了空名）时不能渲出「已归档「」」这种破碎文案。
  const noName = projectLifecycleSuccessMessage("archive", "   ", "zh-CN");
  assert.equal(noName.includes("「"), false);
  assert.equal(projectLifecycleSuccessMessage("archive", "Alpha", "en-US").includes("Alpha"), true);
});

// 破坏性动作失败绝不静默：403/404 各有各的下一步，未知错误兜底成可重试文案。
test("humanizeProjectLifecycleError separates gone-already from not-allowed and falls back safely", () => {
  assert.match(
    humanizeProjectLifecycleError({ code: "project_not_found" }, "archive", "zh-CN"),
    /可能刚刚已经被别人归档或删除/u
  );
  assert.match(
    humanizeProjectLifecycleError({ code: "project_forbidden" }, "delete", "zh-CN"),
    /只有管理员或项目负责人/u
  );
  // app.onError 也可能把它映射成通用 forbidden——两个码都要认。
  assert.match(
    humanizeProjectLifecycleError({ code: "forbidden" }, "delete", "en-US"),
    /Only admins or the project owner/u
  );

  const leaky = new Error("relation \"projects\" does not exist");
  assert.equal(humanizeProjectLifecycleError(leaky, "archive", "zh-CN"), "归档失败，稍后重试。");
  assert.equal(humanizeProjectLifecycleError(leaky, "delete", "zh-CN"), "删除失败，稍后重试。");
  assert.equal(humanizeProjectLifecycleError(leaky, "delete", "zh-CN").includes("relation"), false);
});
