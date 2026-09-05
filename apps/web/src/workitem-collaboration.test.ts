import assert from "node:assert/strict";
import test from "node:test";

import { WORK_ITEM_COMMENT_MAX_CHARS } from "@workhub/contracts";

import {
  checkAssigneeSelection,
  checkWorkItemCommentBody,
  humanizeWorkItemCollaborationError
} from "./workitem-collaboration.js";

// R23 P4（R20 P2A 端点上界面）：认领/指派/留言三个动作的失败必须说人话，且要按动作分开说——
// 同一个 forbidden 在「认领」和「指派」下的成因不一样，糊成一句会让用户不知道下一步该做什么。
test("humanizeWorkItemCollaborationError maps server codes per action and never leaks raw messages", () => {
  assert.equal(
    humanizeWorkItemCollaborationError({ code: "forbidden" }, "claim", "zh-CN"),
    "你现在还不能认领这个任务。"
  );
  assert.equal(
    humanizeWorkItemCollaborationError({ code: "forbidden" }, "assign", "zh-CN"),
    "你没有权限指派这个任务。"
  );
  assert.equal(
    humanizeWorkItemCollaborationError({ code: "forbidden" }, "comment", "zh-CN"),
    "你没有权限在这个任务下留言。"
  );

  // 认领的并发落空（CAS 409）要说清「已经被别人拿走了」，不能只说「失败」。
  assert.match(
    humanizeWorkItemCollaborationError({ code: "work_item_not_claimable" }, "claim", "zh-CN"),
    /已经被别人认领/u
  );
  assert.match(
    humanizeWorkItemCollaborationError({ code: "assignee_not_member" }, "assign", "zh-CN"),
    /不在这个工作区/u
  );
  assert.match(
    humanizeWorkItemCollaborationError({ code: "assignee_not_active" }, "assign", "en-US"),
    /account is disabled/u
  );
  assert.match(
    humanizeWorkItemCollaborationError({ code: "assign_user_directory_unavailable" }, "assign", "zh-CN"),
    /没有被指派/u
  );
  assert.match(
    humanizeWorkItemCollaborationError({ code: "not_found" }, "comment", "en-US"),
    /wasn't found/u
  );

  // 未知错误兜底：给可重试的通用文案，绝不把裸 Error.message（可能带内部细节）吐给用户。
  const leaky = new Error("connect ECONNREFUSED 127.0.0.1:5432");
  assert.equal(humanizeWorkItemCollaborationError(leaky, "claim", "zh-CN"), "认领失败，稍后重试。");
  assert.equal(humanizeWorkItemCollaborationError(leaky, "assign", "zh-CN"), "指派失败，稍后重试。");
  assert.equal(humanizeWorkItemCollaborationError(leaky, "comment", "zh-CN"), "留言没发出去，稍后重试。");
  assert.equal(
    humanizeWorkItemCollaborationError(leaky, "comment", "zh-CN").includes("ECONNREFUSED"),
    false
  );
});

// 提交前的本地校验：空白不算内容（与服务端 trim().min(1) 同口径），超长在本地就拦下——
// 不拿服务端 422 当交互反馈。
test("checkWorkItemCommentBody trims, rejects blanks, and enforces the contract length cap", () => {
  assert.deepEqual(checkWorkItemCommentBody("  你好  ", "zh-CN"), { ok: true, body: "你好" });

  const blank = checkWorkItemCommentBody("   \n  ", "zh-CN");
  assert.equal(blank.ok, false);
  assert.equal(blank.ok === false && blank.message, "先写点内容再发布。");
  assert.equal(checkWorkItemCommentBody("", "en-US").ok, false);

  const tooLong = checkWorkItemCommentBody("x".repeat(WORK_ITEM_COMMENT_MAX_CHARS + 1), "zh-CN");
  assert.equal(tooLong.ok, false);
  // 超长提示要把上限和当前长度都说出来，用户才知道要删多少。
  assert.equal(
    tooLong.ok === false && tooLong.message.includes(String(WORK_ITEM_COMMENT_MAX_CHARS)),
    true
  );
  assert.equal(
    tooLong.ok === false && tooLong.message.includes(String(WORK_ITEM_COMMENT_MAX_CHARS + 1)),
    true
  );

  // 正好等于上限仍然放行（边界不能少收一个字）。
  assert.equal(checkWorkItemCommentBody("x".repeat(WORK_ITEM_COMMENT_MAX_CHARS), "zh-CN").ok, true);
});

test("checkAssigneeSelection refuses an empty pick so no request is wasted", () => {
  assert.deepEqual(checkAssigneeSelection(" u-1 ", "zh-CN"), { ok: true, body: "u-1" });
  const empty = checkAssigneeSelection("", "zh-CN");
  assert.equal(empty.ok, false);
  assert.equal(empty.ok === false && empty.message, "先选一位同事再确认指派。");
  assert.equal(checkAssigneeSelection("   ", "en-US").ok, false);
});
