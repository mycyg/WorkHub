import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { TeamSkillManagementItemVM, TeamSkillManagementPageVM, UserMemoryManagementItemVM, UserMemoryManagementPageVM } from "@workhub/contracts";

import {
  categoryLabel,
  createMemoryView,
  decideArmedConfirmation,
  memoryDetailHtml,
  memoryEditedLine,
  memoryErrorMessage,
  memoryListHtml,
  memoryProvenanceLine,
  memoryTabsHtml,
  parseSkillSections,
  skillErrorMessage,
  teamSkillDetailHtml,
  teamSkillListHtml,
  teamSkillStatusLabel
} from "./memory.js";
import type { SpotlightViewContext } from "../view-context.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// —— fake DOM (same pattern as settings.test.ts / attention.test.ts: node:test has no real DOM,
// so `target instanceof HTMLElement` and `body.querySelector(...)` are both faked explicitly) ——

class FakeElement {
  public dataset: Record<string, string> = {};
  public value = "";
  private readonly queryResults = new Map<string, FakeElement>();

  constructor(
    private readonly selectors = new Set<string>(),
    dataset: Record<string, string> = {},
    value = ""
  ) {
    this.dataset = dataset;
    this.value = value;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return (this.queryResults.get(selector) as unknown as T) ?? null;
  }

  setQueryResult(selector: string, element: FakeElement): void {
    this.queryResults.set(selector, element);
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "click") return;
    this.clickListeners.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }

  click(target: FakeElement) {
    for (const listener of this.clickListeners) {
      listener({ target });
    }
  }
}

async function withFakeHtmlElement<T>(run: () => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  try {
    return await run();
  } finally {
    globals.HTMLElement = previous;
  }
}

type FakeClientOverrides = {
  request?: (path: string, init?: RequestInit) => Promise<unknown>;
  me?: () => Promise<{ is_admin: boolean } | null>;
};

function fakeClient(overrides: FakeClientOverrides = {}) {
  return {
    request: overrides.request ?? (async () => { throw new Error("unexpected request in test"); }),
    me: overrides.me ?? (async () => null)
  } as unknown as SpotlightViewContext["client"];
}

function baseCtx(body: FakeBody, overrides: Partial<SpotlightViewContext> = {}): SpotlightViewContext {
  return {
    body: body as unknown as HTMLElement,
    locale: "zh-CN",
    back() {},
    open() {},
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal,
    ...overrides
  } as unknown as SpotlightViewContext;
}

function memoryItem(overrides: Partial<UserMemoryManagementItemVM> = {}): UserMemoryManagementItemVM {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    category: "preference",
    key: "report-format",
    value_md: "周报只要 markdown，不要 PDF。",
    confidence: 0.8,
    workspace_scoped: true,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides
  } as unknown as UserMemoryManagementItemVM;
}

function memoryPage(memories: UserMemoryManagementItemVM[]): UserMemoryManagementPageVM {
  return {
    generated_at: "2026-07-14T00:00:00.000Z",
    memories,
    totals: { active: memories.length }
  } as unknown as UserMemoryManagementPageVM;
}

function skillItem(overrides: Partial<TeamSkillManagementItemVM> = {}): TeamSkillManagementItemVM {
  return {
    skill_key: "weekly-report",
    name: "周报生成",
    when_to_use: "每周五自动生成团队周报时使用。",
    version: 3,
    source_kind: "distilled",
    created_by_kind: "ai",
    sample_count: 12,
    updated_at: "2026-07-10T00:00:00.000Z",
    id: "80000000-0000-4000-8000-000000000001",
    content_md: "## 总则\n先看结论。\n## 套路\n按项目分组列出进展。",
    status: "active",
    ...overrides
  } as unknown as TeamSkillManagementItemVM;
}

function skillPage(skills: TeamSkillManagementItemVM[]): TeamSkillManagementPageVM {
  return { generated_at: "2026-07-14T00:00:00.000Z", skills } as unknown as TeamSkillManagementPageVM;
}

// —— pure functions ——

test("categoryLabel covers all three categories bilingually", () => {
  assert.equal(categoryLabel("preference", true), "偏好");
  assert.equal(categoryLabel("preference", false), "Preference");
  assert.equal(categoryLabel("correction", true), "纠正意见");
  assert.equal(categoryLabel("recurring_context", false), "Recurring context");
});

test("teamSkillStatusLabel covers draft/active/deprecated bilingually", () => {
  assert.equal(teamSkillStatusLabel("draft", true), "草稿");
  assert.equal(teamSkillStatusLabel("active", false), "Active");
  assert.equal(teamSkillStatusLabel("deprecated", true), "已停用");
});

test("memoryProvenanceLine uses the server-composed label when present", () => {
  const item = memoryItem({ provenance: { kind: "agent_run", label: "来自会话《周报》的一次 AI 执行" } });
  assert.equal(memoryProvenanceLine(item, true), "来自会话《周报》的一次 AI 执行");
});

test("memoryProvenanceLine honestly falls back to 'source unknown' when provenance is absent (03-mem-design §2.3)", () => {
  const item = memoryItem();
  assert.equal(memoryProvenanceLine(item, true), "早期记录，出处不明");
  assert.equal(memoryProvenanceLine(item, false), "An early record — the source is unknown");
});

test("memoryEditedLine only appears when edited_at is set, and is a distinct line from provenance", () => {
  assert.equal(memoryEditedLine(memoryItem(), true), undefined);
  const edited = memoryEditedLine(memoryItem({ edited_at: "2026-07-12T09:30:00.000Z" }), true);
  assert.match(edited ?? "", /最近由你于.*修改/u);
});

test("decideArmedConfirmation arms on first click, executes on a matching second click", () => {
  assert.equal(decideArmedConfirmation(undefined, "a"), "arm");
  assert.equal(decideArmedConfirmation("a", "b"), "arm");
  assert.equal(decideArmedConfirmation("a", "a"), "execute");
});

test("memoryErrorMessage maps known error codes bilingually and falls back for unknown codes", () => {
  const conflict = new WorkHubApiError(409, "user_memory_version_conflict", "这条记忆已更新，请刷新后再编辑。");
  assert.equal(memoryErrorMessage(conflict, true), "这条记忆刚被更新，请刷新后再编辑。");
  assert.match(memoryErrorMessage(conflict, false), /refresh/u);
  const unknown = new WorkHubApiError(500, "some_new_code", "boom");
  assert.equal(memoryErrorMessage(unknown, true), "操作失败，请重试。");
  assert.equal(memoryErrorMessage(new Error("network"), false), "Something went wrong — try again.");
});

test("skillErrorMessage maps admin-required and base-version-conflict codes bilingually", () => {
  const forbidden = new WorkHubApiError(403, "team_skill_admin_required", "只有管理员可以编辑或停用团队技能。");
  assert.match(skillErrorMessage(forbidden, false), /admin/iu);
  const conflict = new WorkHubApiError(409, "team_skill_base_version_conflict", "这个技能已有更新版本，请刷新后重新编辑。");
  assert.match(skillErrorMessage(conflict, true), /已有更新版本/u);
});

test("memoryTabsHtml marks the active tab with aria-selected + data-sel", () => {
  const html = memoryTabsHtml("skills", true);
  assert.match(html, /data-mem-tab="profile" data-sel="false"/u);
  assert.match(html, /aria-selected="true" data-mem-tab="skills" data-sel="true"/u);
});

test("memoryListHtml renders an honest empty state with no memories", () => {
  const html = memoryListHtml(memoryPage([]), true);
  assert.match(html, /wh-spot-empty/u);
  assert.match(html, /Cuu 还没记住什么/u);
});

test("memoryListHtml renders each memory with an excerpt, category tag, and provenance line", () => {
  const html = memoryListHtml(memoryPage([memoryItem()]), true);
  assert.match(html, /data-mem-open="70000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /周报只要 markdown/u);
  assert.match(html, /wh-spot-row-tag">偏好/u);
  assert.match(html, /早期记录，出处不明/u);
});

test("memoryDetailHtml view mode shows edit\\/delete actions; editing mode shows a textarea and hides them", () => {
  const item = memoryItem();
  const readHtml = memoryDetailHtml(item, true);
  assert.match(readHtml, /data-mem-edit/u);
  assert.match(readHtml, /data-mem-delete="70000000-0000-4000-8000-000000000001"/u);
  assert.doesNotMatch(readHtml, /data-mem-edit-text/u);

  const editHtml = memoryDetailHtml(item, true, { editing: true });
  assert.match(editHtml, /data-mem-edit-text/u);
  assert.match(editHtml, /周报只要 markdown/u);
  assert.doesNotMatch(editHtml, /data-mem-delete=/u);
});

test("memoryDetailHtml armed-delete state turns the button danger and shows the honest confirm copy", () => {
  const html = memoryDetailHtml(memoryItem(), true, { armedDelete: true });
  assert.match(html, /wh-spot-act--danger[^"]*"[^>]*data-mem-delete=/u);
  assert.match(html, /确定？再点一次删除/u);
  assert.match(html, /Cuu 将忘记这条/u);
});

test("parseSkillSections splits '## heading' blocks into title\\/body pairs", () => {
  const sections = parseSkillSections("## 总则\n先看结论。\n第二行。\n## 套路\n按项目分组。");
  assert.deepEqual(sections, [
    { title: "总则", body: "先看结论。\n第二行。" },
    { title: "套路", body: "按项目分组。" }
  ]);
});

test("parseSkillSections returns no sections for content with no '## ' headings", () => {
  assert.deepEqual(parseSkillSections("just a paragraph, no headings"), []);
});

test("teamSkillListHtml shows a read-only note for non-admins and hides it for admins", () => {
  const skills = [skillItem()];
  assert.match(teamSkillListHtml(skillPage(skills), true, false), /只有管理员可以编辑或停用/u);
  assert.doesNotMatch(teamSkillListHtml(skillPage(skills), true, true), /只有管理员可以编辑或停用/u);
});

test("teamSkillDetailHtml only shows edit/deactivate actions to admins on the active version", () => {
  const item = skillItem();
  const asAdmin = teamSkillDetailHtml(item, true, { isAdmin: true, sections: parseSkillSections(item.content_md) });
  assert.match(asAdmin, /data-skill-edit/u);
  assert.match(asAdmin, /data-skill-deactivate="80000000-0000-4000-8000-000000000001"/u);

  const asMember = teamSkillDetailHtml(item, true, { isAdmin: false, sections: parseSkillSections(item.content_md) });
  assert.doesNotMatch(asMember, /data-skill-edit[ >]/u);
  assert.doesNotMatch(asMember, /data-skill-deactivate=/u);

  const deprecated = skillItem({ status: "deprecated", deprecated_reason: "过时" });
  const asAdminOnDeprecated = teamSkillDetailHtml(deprecated, true, { isAdmin: true, sections: [] });
  assert.doesNotMatch(asAdminOnDeprecated, /data-skill-edit[ >]/u);
  assert.match(asAdminOnDeprecated, /已停用：过时/u);
});

test("teamSkillDetailHtml editing mode renders one section chip per parsed heading plus a 'new section' chip", () => {
  const item = skillItem();
  const html = teamSkillDetailHtml(item, true, {
    isAdmin: true,
    editing: true,
    sections: parseSkillSections(item.content_md),
    selectedSection: "套路"
  });
  assert.match(html, /data-skill-section-chip="总则"/u);
  assert.match(html, /data-skill-section-chip="套路" data-sel="true"/u);
  assert.match(html, /data-skill-section-new/u);
  assert.match(html, /按项目分组列出进展。/u); // prefilled with the selected section's current body
});

// —— mount()-level integration (list load, tab switch, armed confirm, PATCH/DELETE calls) ——

test("mount loads the profile tab by default and renders the memory list", async () => {
  const body = new FakeBody();
  await createMemoryView().mount(
    baseCtx(body, { client: fakeClient({ request: async () => memoryPage([memoryItem()]) }) })
  );
  await tick();
  await tick();

  assert.match(body.innerHTML, /data-mem-tab="profile" data-sel="true"/u);
  assert.match(body.innerHTML, /data-mem-open=/u);
});

test("switching to the skills tab lazy-loads team skills only once, and caches on switch-back", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let skillRequests = 0;
    await createMemoryView().mount(
      baseCtx(body, {
        client: fakeClient({
          request: async (path) => {
            if (path === "/api/me/memories") return memoryPage([]);
            skillRequests += 1;
            return skillPage([skillItem()]);
          }
        })
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-mem-tab]"]), { memTab: "skills" }));
    await tick();
    await tick();
    assert.equal(skillRequests, 1);
    assert.match(body.innerHTML, /data-skill-open=/u);

    body.click(new FakeElement(new Set(["[data-mem-tab]"]), { memTab: "profile" }));
    await tick();
    body.click(new FakeElement(new Set(["[data-mem-tab]"]), { memTab: "skills" }));
    await tick();
    await tick();
    assert.equal(skillRequests, 1, "switching back to a previously-loaded tab must not refetch");
  });
});

test("a non-admin viewer never sees the edit/deactivate actions on a skill's detail", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createMemoryView().mount(
      baseCtx(body, {
        client: fakeClient({
          request: async (path) => (path === "/api/me/memories" ? memoryPage([]) : skillPage([skillItem()])),
          me: async () => ({ is_admin: false })
        })
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-mem-tab]"]), { memTab: "skills" }));
    await tick();
    await tick();
    body.click(new FakeElement(new Set(["[data-skill-open]"]), { skillOpen: "80000000-0000-4000-8000-000000000001" }));
    await tick();

    assert.doesNotMatch(body.innerHTML, /data-skill-edit[ >]/u);
    assert.doesNotMatch(body.innerHTML, /data-skill-deactivate=/u);
  });
});

test("deleting a memory is a two-click armed confirmation; only the second click fires DELETE", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const deleteCalls: string[] = [];
    const toasts: Array<{ message: string; tone?: string | undefined }> = [];
    await createMemoryView().mount(
      baseCtx(body, {
        client: fakeClient({
          request: async (path, init) => {
            if (init?.method === "DELETE") {
              deleteCalls.push(path);
              return { deleted: true };
            }
            return memoryPage([memoryItem()]);
          }
        }),
        toast(message: string, tone?: string) {
          toasts.push({ message, tone });
        }
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-mem-open]"]), { memOpen: "70000000-0000-4000-8000-000000000001" }));
    await tick();

    const deleteTarget = new FakeElement(new Set(["[data-mem-delete]"]), { memDelete: "70000000-0000-4000-8000-000000000001" });
    body.click(deleteTarget);
    await tick();
    assert.equal(deleteCalls.length, 0, "first click only arms — must not delete yet");
    assert.match(body.innerHTML, /确定？再点一次删除/u);

    body.click(deleteTarget);
    await tick();
    await tick();

    assert.deepEqual(deleteCalls, ["/api/me/memories/70000000-0000-4000-8000-000000000001"]);
    assert.equal(toasts.some((t) => t.tone === "ok"), true);
  });
});

test("saving a memory edit PATCHes value_md + expected_updated_at, and a 409 shows the friendly conflict message", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const patchCalls: Array<{ path: string; body: unknown }> = [];
    await createMemoryView().mount(
      baseCtx(body, {
        client: fakeClient({
          request: async (path, init) => {
            if (init?.method === "PATCH") {
              patchCalls.push({ path, body: JSON.parse(String(init.body)) });
              throw new WorkHubApiError(409, "user_memory_version_conflict", "这条记忆已更新，请刷新后再编辑。");
            }
            return memoryPage([memoryItem()]);
          }
        })
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-mem-open]"]), { memOpen: "70000000-0000-4000-8000-000000000001" }));
    await tick();
    body.click(new FakeElement(new Set(["[data-mem-edit]"])));
    await tick();

    const textarea = new FakeElement(new Set(), {}, "新的偏好文本");
    body.setQueryResult("[data-mem-edit-text]", textarea);
    body.click(new FakeElement(new Set(["[data-mem-save]"])));
    await tick();
    await tick();

    assert.equal(patchCalls.length, 1);
    assert.equal(patchCalls[0]!.path, "/api/me/memories/70000000-0000-4000-8000-000000000001");
    assert.deepEqual(patchCalls[0]!.body, { value_md: "新的偏好文本", expected_updated_at: "2026-07-10T00:00:00.000Z" });
    assert.match(body.innerHTML, /这条记忆刚被更新，请刷新后再编辑。/u);
  });
});

test("admin editing a skill section PATCHes a single modify_section op with the current base_version", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const patchCalls: Array<{ path: string; body: unknown }> = [];
    await createMemoryView().mount(
      baseCtx(body, {
        client: fakeClient({
          request: async (path, init) => {
            if (path === "/api/me/memories") return memoryPage([]);
            if (init?.method === "PATCH") {
              patchCalls.push({ path, body: JSON.parse(String(init.body)) });
              return skillItem({ version: 4 });
            }
            return skillPage([skillItem()]);
          },
          me: async () => ({ is_admin: true })
        })
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-mem-tab]"]), { memTab: "skills" }));
    await tick();
    await tick();
    body.click(new FakeElement(new Set(["[data-skill-open]"]), { skillOpen: "80000000-0000-4000-8000-000000000001" }));
    await tick();
    body.click(new FakeElement(new Set(["[data-skill-edit]"])));
    await tick();

    const textarea = new FakeElement(new Set(), {}, "先看结论，并列出风险。");
    body.setQueryResult("[data-skill-edit-text]", textarea);
    body.click(new FakeElement(new Set(["[data-skill-save]"])));
    await tick();
    await tick();

    assert.equal(patchCalls.length, 1);
    assert.equal(patchCalls[0]!.path, "/api/team-skills/manage/80000000-0000-4000-8000-000000000001");
    assert.deepEqual(patchCalls[0]!.body, {
      ops: [{ op: "modify_section", section: "总则", content_md: "先看结论，并列出风险。" }],
      base_version: 3
    });
  });
});

test("deactivating a skill is armed-confirmed and forwards an optional reason to POST .../deactivate", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const postCalls: Array<{ path: string; body: unknown }> = [];
    await createMemoryView().mount(
      baseCtx(body, {
        client: fakeClient({
          request: async (path, init) => {
            if (path === "/api/me/memories") return memoryPage([]);
            if (init?.method === "POST") {
              postCalls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
              return { deprecated: true };
            }
            return skillPage([skillItem()]);
          },
          me: async () => ({ is_admin: true })
        })
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-mem-tab]"]), { memTab: "skills" }));
    await tick();
    await tick();
    body.click(new FakeElement(new Set(["[data-skill-open]"]), { skillOpen: "80000000-0000-4000-8000-000000000001" }));
    await tick();

    const deactivateTarget = new FakeElement(new Set(["[data-skill-deactivate]"]), { skillDeactivate: "80000000-0000-4000-8000-000000000001" });
    body.click(deactivateTarget);
    await tick();
    assert.equal(postCalls.length, 0, "first click only arms — must not deactivate yet");
    assert.match(body.innerHTML, /data-skill-deactivate-reason/u);

    const reasonInput = new FakeElement(new Set(), {}, "内容过时");
    body.setQueryResult("[data-skill-deactivate-reason]", reasonInput);
    body.click(deactivateTarget);
    await tick();
    await tick();

    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0]!.path, "/api/team-skills/manage/80000000-0000-4000-8000-000000000001/deactivate");
    assert.deepEqual(postCalls[0]!.body, { reason: "内容过时" });
  });
});
