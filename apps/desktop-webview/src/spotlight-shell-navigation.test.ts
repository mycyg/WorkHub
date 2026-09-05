import { strict as assert } from "node:assert";
import { test } from "node:test";

import { handleDesktopSpotlightShellNavigate } from "./spotlight-shell-navigation.js";

type NavigationHarness = {
  opened: Array<{ id: string; target?: { id?: string; route?: string } }>;
  savedRoutes: string[];
  resets: { count: number };
  input: Parameters<typeof handleDesktopSpotlightShellNavigate>[1];
};

function harness(): NavigationHarness {
  const opened: NavigationHarness["opened"] = [];
  const savedRoutes: string[] = [];
  const resets = { count: 0 };
  return {
    opened,
    savedRoutes,
    resets,
    input: {
      saveProjectContextFromRoute: (nextRoute) => {
        savedRoutes.push(nextRoute);
      },
      spotlight: {
        openCapability(id, target) {
          opened.push(target ? { id, target } : { id });
        },
        reset() {
          resets.count += 1;
        }
      }
    }
  };
}

test("production Spotlight shell navigate saves project context before opening a capability", () => {
  const projectId = "10000000-0000-4000-8000-000000000002";
  const route = `/drive?project_id=${projectId}`;
  const h = harness();

  const result = handleDesktopSpotlightShellNavigate({ route }, h.input);

  assert.deepEqual(h.savedRoutes, [route]);
  assert.deepEqual(h.opened, [{ id: "drive", target: { id: projectId, route } }]);
  assert.equal(h.resets.count, 0);
  assert.equal(result.kind, "open");
});

// S3-#6：壳层（window_controls.rs ShellNavigatePayload）发的是带 source/reason 的结构体，
// 老壳层发的是裸 route 字符串——两种形状都必须打开同一个能力。
test("shell navigate accepts both the structured payload and the legacy bare route string", () => {
  for (const payload of [
    "/notifications",
    { route: "/notifications" },
    { route: "/notifications", label: "main", source: "deep_link", reason: "focus-main-route" }
  ]) {
    const h = harness();
    const result = handleDesktopSpotlightShellNavigate(payload, h.input);

    assert.equal(result.kind, "open", `payload ${JSON.stringify(payload)} should open a capability`);
    assert.deepEqual(h.opened, [{ id: "notifications", target: { route: "/notifications" } }]);
    assert.equal(h.resets.count, 0);
  }
});

// 托盘「打开收件箱 / 设置」与 workhub://open/{settings,approvals} 走同一条通道，逐条钉死映射。
test("tray and deep-link routes open their capability instead of resetting the box", () => {
  const cases: Array<[string, string]> = [
    ["/inbox", "approvals"],
    ["/approvals", "approvals"],
    ["/settings", "settings"],
    ["/notifications", "notifications"]
  ];

  for (const [route, capability] of cases) {
    const h = harness();
    const result = handleDesktopSpotlightShellNavigate(
      { route, label: "main", source: "tray", reason: "focus-main-route" },
      h.input
    );

    assert.equal(result.kind, "open");
    assert.deepEqual(h.opened, [{ id: capability, target: { route } }]);
    assert.equal(h.resets.count, 0, `${route} must not wipe the open capability`);
  }
});

// S3-#6 的核心回归：认不出的路由绝不复位盒子。此前这是破坏性默认值——一条与用户意图无关的
// navigate 就把正开着的能力（设置/审批/网盘草稿）洗成 idle 搜索条。
test("unmapped and unparsable navigate payloads leave the open capability untouched", () => {
  for (const payload of [
    { route: "/workbench/10000000-0000-4000-8000-000000000002" },
    { route: "/me" },
    undefined,
    null,
    42,
    {},
    { route: "not-a-route" },
    { route: "//evil.test" },
    { route: "/settings/../secrets" }
  ]) {
    const h = harness();
    const result = handleDesktopSpotlightShellNavigate(payload, h.input);

    assert.equal(result.kind, "ignored", `payload ${JSON.stringify(payload)} should be ignored`);
    assert.equal(h.opened.length, 0);
    assert.equal(h.resets.count, 0);
  }
});

// 「把主窗显示出来」（托盘「打开 WorkHub」/全局热键/dock reopen/工作台的打开聚焦盒按钮）不是导航。
// Rust 侧已不再为它广播 navigate（shell_navigate_payload 返回 None）；这里是对旧壳层的兜底。
test("window-control-only reasons never touch the box", () => {
  for (const reason of ["show-main", "hide-main"]) {
    const h = harness();
    const result = handleDesktopSpotlightShellNavigate(
      { route: "/", label: "main", source: "setting", reason },
      h.input
    );

    assert.deepEqual(result, { kind: "ignored", reason: "window-control", route: "/" });
    assert.equal(h.resets.count, 0);
    assert.equal(h.savedRoutes.length, 0);
  }
});

// 根路径仍保留「回 launcher 主页」这一条显式语义（唯一会复位盒子的分支）。
test("an explicit root route returns the box to the launcher home", () => {
  const h = harness();

  const result = handleDesktopSpotlightShellNavigate({ route: "/" }, h.input);

  assert.deepEqual(result, { kind: "home", route: "/" });
  assert.equal(h.resets.count, 1);
  assert.equal(h.opened.length, 0);
});

// 冷启动兜底：主窗 boot 后 take_pending_deep_link 取回的是整份 ShellDeepLinkPlan（camelCase），
// 它的顶层 route 必须和热态 navigate 走同一条解析路径。
test("a replayed cold-start deep-link plan opens the same capability as the hot path", () => {
  const h = harness();

  const result = handleDesktopSpotlightShellNavigate(
    {
      rawUrl: "workhub://open/settings",
      scheme: "workhub",
      route: "/settings",
      windowControl: {
        label: "main",
        action: "show_and_focus",
        source: "deep_link",
        focus: true,
        reason: "focus-main-route",
        route: "/settings"
      }
    },
    h.input
  );

  assert.equal(result.kind, "open");
  assert.deepEqual(h.opened, [{ id: "settings", target: { route: "/settings" } }]);
});
