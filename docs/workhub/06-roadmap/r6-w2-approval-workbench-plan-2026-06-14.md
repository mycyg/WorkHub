# R6 W2 — 审批中心 diff 工作台（全量含评论流）施工计划

- status: **done**（6 增量全部 CI 绿推 main：inc1 `6cb9d0e3` / inc2 `a04ffdc2` / inc3 `a2dd3b7f` / inc4 `76af2c3a` / inc5 `5edbc310` / inc6 `216416e6`；含迁移 0019）
- 缓办：smoke 02d/02e/02f（live smoke 走 fixture，评论 POST 需桩 + 第二条 fixture 项；逻辑已由 ui marker 测试 + api 评论路由测试覆盖）；转交目标选择器 UI（api-client + 路由已就绪）。
- 来源: design 工作流 wf_99f894c5-9b1（3 架构师 + 综合评审）
- 范围: 用户拍板「全量含评论流」——100% 复刻概念图 ④ `docs/workhub/05-clients/assets/web/web-approval-center.png`
- 纪律: 每个增量独立 CI 绿、可单独回滚；既有审批 smoke（02/02a/02b/02c + approvalRespond===2）永不破。

## 增量序列（依次实现，每块 typecheck+全量 test+(web)70 步 smoke+CI 绿再下一块）

1. **inc1 契约** — approvalCenterVmSchema 加可选 items_detail/timeline/comments（纯加法、无行为变化）。
2. **inc2 DB** — 迁移 0019 approval_comments 表 + repo（仅建表，无读）。
3. **inc3 服务** — listPendingForUser 构建 items_detail（join proposal.diff_manifest + 合成时间线 + 读评论）+ fixture。
4. **inc4 API** — GET/POST /api/approvals/:id/comments + api-client（含补 delegateApproval 缺口）。
5. **inc5 UI** — renderApprovalsRouteComponent 重写为三栏工作台（中栏按 kind 条件化；所有既有 marker 保留）。
6. **inc6 Web 交互** — 行选择 + 记住勾选 + 评论提交 + delegate handler + 新增 smoke 02d/02e/02f。

---

## W2 Approval Diff Workbench — Consolidated Build-Ready Plan

Upgrade `renderApprovalsRouteComponent` (packages/ui/src/gold-path/route-components.ts:1119) from the lean 3-col wireframe to the full concept `web-approval-center.png`, including the new comment subsystem. Every increment is independently CI-green and revertible; the existing approval smoke (steps 02/02a/02b/02c + `approvalRespond===2`) never breaks.

### Verified ground truth (checked against the real repo, corrects all three drafts)
- `approvalCenterVmSchema` (pages.ts:601) = `{items, requests, filters, counts}` — extend additively.
- **CRITICAL: the stored proposal field is `diff_manifest`, NOT `manifest`.** `ProposalService.get`/`listByWorkItem` (proposals.ts:102/104) return `StoredProposal` whose manifest is `proposal.diff_manifest` (proposals.ts:1179/1463). `.manifest` is only on `ProposalDetailVM` (pages.ts:614). All three architects mislabeled this — the service MUST read `proposal.diff_manifest.changes/.checks/.risk/.summary_md`.
- **Join key is `raw_args.proposal_id`** (fixture gold-path.ts:732, `approvalPayloadSchema.raw_args` at approval.ts:38). C's invented `payload.ui.proposal_ref` does NOT exist — dropped (avoids a new write site at proposal creation).
- `renderChange` (route-components.ts:1397) + `renderCheck` (:1415) already render before→after + checks — **reuse verbatim**, no new ChangeImpactRow type.
- `deliverableChangeSchema` (experience.ts:185): target_ref.version_before/after, change_type, human_summary, machine_summary.{before_excerpt,after_excerpt,changed_fields,field_values_before}, preview_ref. `deliverableCheckSchema` (:221): status passed|failed|warning|skipped. `risk.human_label` (manifest :252).
- `projectDriveComments` (core.ts:392) is the clone template; generic `comments` (core.ts:694) is work-item-scoped with no repo — dead, not reused.
- `proposalDetailVmSchema.comments` shape `{id, author_label, body, created_at}` (pages.ts:621) — reuse verbatim for approval comments.
- `assertCanReadApproval` (approvals.ts:57) + `visibleApprovalCenter` (:68, spreads `...data`); routes `.get('/')`, `.post('/:id/respond')`, `.post('/:id/delegate')` exist.
- `delegateApproval` genuinely MISSING from api-client (client.ts:270 only `respondApproval`) — route exists, client gap.
- `audit.listAuditLogsForEntity` exists (audit.ts:49) but timeline is synthesized from the row (zero extra reads), so it is NOT used.
- Journal ends idx 18 → next migration is **0019**. `GoldPathCopyKey` (i18n.ts:25) is a compile-enforced union; both zh-CN (i18n.ts:229) and en-US (:398) maps must add every new key.
- Smoke 02a clicks `[data-action-id="deny"]` → reason gate; 02c clicks `[data-action-id="approve"]`; both are `items[0]`'s actions; `proof.counts.approvalRespond===2` (smoke :4037). Checkbox must default OFF so approve still sends `remember:'once'`.

### Design decision resolutions
1. **Diff source** — service joins `raw_args.proposal_id` → `proposals.get`/`listByWorkItem` → `diff_manifest`; VM `items_detail: Record<itemId, ApprovalDetailVM>`; middle CONDITIONAL on `kind` (deliverable→table+checks via renderChange/renderCheck; permission/tool→summary+evidence+affected_targets, no table).
2. **Comments** — new `approval_comments` table (0019) cloned from projectDriveComments; repo; routes behind `assertCanReadApproval`; VM reuses proposal comment shape.
3. **Selection** — prefetch all `items_detail` into the single Page VM; client-side show/hide on row click; `items[0]` default-selected.
4. **Timeline** — synthesized created→routed→(delegated?)→decided/expired from row fields; reuse `.wh-r4-route-timeline`.
5. **Confidence** — no %; check pass/fail pills + evidence confidence_hint + plain reason + single `risk.human_label` pill via localizedEnumLabel.

### Contract additions (inc1, packages/contracts/src/pages.ts)
```ts
export const approvalCommentVmSchema = z.object({          // reuse proposalDetailVm.comments shape
  id: idSchema, author_label: z.string().min(1), body: z.string().min(1), created_at: isoDateTimeSchema
});
export const approvalRoutingStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["created","routed","delegated","decided","expired"]),
  label: z.string().min(1), actor_label: z.string().optional(),
  status: z.enum(["done","current","pending"]),
  at: isoDateTimeSchema.optional(), sla_due_at: isoDateTimeSchema.optional()
});
export const approvalConflictRowSchema = z.object({
  description: z.string().min(1), impact: z.string().optional(), suggestion: z.string().optional()
});
export const approvalDetailVmSchema = z.object({
  kind: z.enum(["deliverable","permission","tool"]),
  proposal_id: idSchema.optional(), proposal_href: z.string().optional(),
  ai_reason: z.string().optional(), expected_benefit: z.string().optional(),
  risk_label: z.string().optional(),                       // human_label, NO number
  manifest_changes: z.array(deliverableChangeSchema).default([]),  // REUSE manifest types
  checks: z.array(deliverableCheckSchema).default([]),
  conflicts: z.array(approvalConflictRowSchema).default([]),
  affected_targets: z.array(z.string()).default([]),
  timeline: z.array(approvalRoutingStepSchema).default([]),
  comments: z.array(approvalCommentVmSchema).default([])
});
// additive + defaulted → every existing fixture/smoke parses unchanged
export const approvalCenterVmSchema = z.object({
  items: z.array(attentionItemSchema),
  requests: z.array(approvalRequestSchema),
  filters: z.record(z.string(), z.unknown()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  items_detail: z.record(z.string(), approvalDetailVmSchema).default({})
});
export const addApprovalCommentRequestSchema = z.object({ body: z.string().trim().min(1).max(4000) }); // approval.ts
```

### DB migration (inc2, packages/db/migrations/0019_approval_comments.sql)
```sql
-- W2: approval discussion stream. Cloned from project_drive_comments (core.ts:392).
CREATE TABLE IF NOT EXISTS "approval_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "approval_id" uuid NOT NULL REFERENCES "approval_requests"("id") ON DELETE cascade,
  "author_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "author_nickname" varchar(64) NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "approval_comments_approval_id_created_idx"
  ON "approval_comments" ("approval_id","created_at");
```
Append journal `{idx:19, version:"7", when:1781511433742, tag:"0019_approval_comments", breakpoints:true}` + write meta/0019_snapshot.json. Add `approvalComments` pgTable to core.ts (id()/timestamps() helpers, ON DELETE cascade/restrict), register in schema export list + barrel. Repo `repositories/approval-comments.ts`: `listByApproval(approvalId)` (order by created_at asc), `create({approvalId, authorUserId, authorNickname, body})`. Validate `pnpm --filter @workhub/db migrate` on real local PG + `pnpm audit:migrations` (CREATE TABLE confined to migrations dir, exempt).

### Service joins (inc3, apps/api/src/services/approvals.ts listPendingForUser:322)
Add OPTIONAL deps `proposals?: Pick<ProposalService,"get"|"listByWorkItem">` and `approvalComments?: ApprovalCommentRepository` to `ApprovalServiceDependencies` (:74) + `getDefaultApprovalServiceDependencies` (:96) — absent in legacy fixtures → degrade to empty detail, no crash. Per row:
```ts
const payload = approvalPayloadSchema.safeParse(row.payloadJson).data;
const proposalId = typeof payload?.raw_args?.proposal_id === "string" ? payload.raw_args.proposal_id : undefined;
let prop; try {
  prop = proposalId ? await deps.proposals?.get(proposalId)
       : row.workItemId ? (await deps.proposals?.listByWorkItem(row.workItemId))?.find(p => p.status==="opened"||p.status==="reviewed")
       : undefined;
} catch { prop = undefined; }
items_detail[row.id] = prop
  ? { kind:"deliverable", proposal_id:prop.id, proposal_href:`/proposals/${prop.id}`,
      manifest_changes: prop.diff_manifest.changes, checks: prop.diff_manifest.checks,   // diff_manifest, NOT manifest
      risk_label: prop.diff_manifest.risk.human_label, ai_reason: prop.diff_manifest.summary_md,
      conflicts: prop.diff_manifest.checks.filter(c=>c.status==="failed"||c.status==="warning").map(toConflictRow),
      affected_targets: [], timeline: synthesizeApprovalTimeline(row), comments: toCommentVms(await deps.approvalComments?.listByApproval(row.id) ?? []) }
  : { kind: row.actionPattern.startsWith("tool")?"tool":"permission",
      manifest_changes:[], checks:[], conflicts:[], risk_label: payload?.ui?.risk?.human_label,
      ai_reason: payload?.ui?.reason_text, affected_targets: payload?.ui?.affected_targets ?? [],
      timeline: synthesizeApprovalTimeline(row), comments: toCommentVms(await deps.approvalComments?.listByApproval(row.id) ?? []) };
```
`synthesizeApprovalTimeline(row)`: created(created_at,done) → routed(routed_to_user_id, current if pending) → delegated?(delegated_to_user_id) → decided/expired(decided_by_user_id/status). `visibleApprovalCenter` (approvals.ts:68) must additionally filter `items_detail` to surviving item ids. New service methods `listComments(id)` / `addComment(id, actor, body)` (author_nickname=actor.label, audit `approval.commented`). Fixture `gold-path.ts` approvalCenter gains `items_detail` so UI/smoke have data.

### API routes (inc4, apps/api/src/routes/approvals.ts)
```ts
routes.get("/:id/comments", mw, async c => { await assertCanReadApproval(c.req.param("id"), c.var.actor);
  return c.json({ ok:true, data: await service.listComments(c.req.param("id")) }); });
routes.post("/:id/comments", mw, async c => { await assertCanReadApproval(c.req.param("id"), c.var.actor);
  const { body } = addApprovalCommentRequestSchema.parse(await c.req.json());
  return c.json({ ok:true, data: await service.addComment(c.req.param("id"), c.var.actor, body) }); });
```
api-client (packages/api-client/src/{types,client}.ts): add `listApprovalComments(id)`, `postApprovalComment(id,{body})`, and **`delegateApproval(id,{to_user_id})`** (closes the verified gap; route /:id/delegate already exists at approvals.ts:103).

### Web/UI (inc5, renderApprovalsRouteComponent rewrite)
All grid children `min-width:0`; all text `overflow-wrap:anywhere`; diff cells `white-space:normal`; comment list `overflow:auto;max-height`; NEVER fixed-height+line-clamp. Hidden per-item panels use `display:none` (excluded from overflow scan).
- **LEFT** `.wh-r4-approval-list`: tabs 待处理/全部 (`data-r4-approval-tab`) + search; rows `[data-r4-approval-item][data-r4-approval-selected]` + 发起人/部门 meta + priority pill + per-row SLA span (`data-r4-approval-sla`, static text) + routed marker KEEPING `data-r4-approval-routed='true'` + `'>Routed</span>'`; keep `a[href=/workitems/{id}]`.
- **MIDDLE** `.wh-r4-approval-detail`: render ALL items' panels `[data-r4-approval-detail-for={item.id}]` (hidden except selected); header chips (申请时间/审批类型/当前节点/SLA); sub-tabs 变更对比|交付物预览|相关信息 (`data-r4-approval-subtab`); CONDITIONAL on `items_detail[id].kind` — **deliverable** → before→after table via `renderChange` (`data-r4-approval-diff`) + 合规检查 via `renderCheck` (`data-r4-approval-check`+`data-status`) + AI 解释与依据 (ai_reason + expected_benefit + evidence chips w/ `confidence_hint`) + 冲突与建议 (`data-r4-approval-conflict`); **permission/tool** → summary + evidence + affected_targets (`data-r4-approval-affected`), NO table.
- **RIGHT** `.wh-r4-approval-actions`: `renderActions(selected.actions)` as SOLE `data-action-id` source (keeps deny `data-requires-reason='true'`, approve, delegate) + KEEP `approvals.ruleText` (test:1238) + 意见说明 textarea 0/200 + 记住我的审批 checkbox DEFAULT UNCHECKED (`data-r4-approval-remember`) + 审批流程 timeline reusing `.wh-r4-route-timeline` (`data-r4-approval-timeline-step`+`data-status`) + 相关讨论 stream (`data-r4-approval-comment`, initials avatar+author+time+body) + 查看全部 + comment form (`data-r4-approval-comment-form`).
- `primaryHrefs` stays `items[0].actions.map(a=>a.href)`. escapeHtml every value, safeHref every href, localizedEnumLabel for visible enum text (raw enum in data-*).
- **NEW markers** (all additive): `data-r4-approval-tab`, `-sla`, `-detail-for`, `-subtab`, `-diff`, `-check`, `-conflict`, `-affected`, `-timeline-step`, `-comment`, `-comment-form`, `-remember`. **PRESERVE**: `data-r4-route-component="approvals"`, `-approval-pending`, `-approval-routed='true'`, `'>Routed</span>'`, `data-action-id="deny"/"approve"`, `data-requires-reason='true'`, primaryHrefs.

### Web interactivity (inc6, apps/web/src/browser.ts)
Click `[data-r4-approval-item]` → set selected, show matching `[data-r4-approval-detail-for]`, hide others (pure DOM, no fetch). Sub-tab toggle. `[data-r4-approval-remember]` checked → `respondApproval remember:'always'` (paths at browser.ts:419/434/806). Comment form → `client.postApprovalComment` + optimistic append. `data-action-id='delegate'` → `client.delegateApproval` (notice-gated picker). Deny reason-gate (browser.ts:409) untouched.

### i18n keys (inc5, BOTH zh-CN + en-US, added to GoldPathCopyKey union)
`approvals.tabPending`(待处理)/`tabAll`(全部)/`search`/`slaRemaining`(剩余)/`subtabDiff`(变更对比)/`subtabPreview`(交付物预览)/`subtabInfo`(相关信息)/`diffField`(项目)/`diffBefore`(当前)/`diffAfter`(变更后)/`diffImpact`(影响)/`complianceTitle`(合规检查)/`aiReasonTitle`(AI 解释与依据)/`expectedBenefit`(预期收益)/`conflictsTitle`(可能存在的冲突与建议)/`affectedTitle`(影响范围)/`timelineTitle`(审批流程)/`discussionTitle`(相关讨论)/`commentEmpty`(还没有人讨论这条审批 (=^･ω･^=))/`viewAllComments`(查看全部)/`commentPlaceholder`/`commentSubmit`(发表意见)/`rememberLabel`(记住我的审批（相同类型自动通过）)/`opinionPlaceholder`(意见说明…)/`headerApplied`(申请时间)/`headerType`(审批类型)/`headerNode`(当前节点)/`timeline.created`/`routed`/`delegated`/`decided`/`expired`. Plain language + kaomoji on empty/positive; visible enums via localizedEnumLabel.

### Tests / smoke
- contracts.test.ts: parse approvalCenterVm with + without new fields (back-compat).
- db: approval-comments repo unit (create+list ordering); schema.test covers presence.
- approvals.test.ts: items_detail deliverable-with-proposal / -without-proposal / tool; timeline ordering; addComment/listComments; route GET/POST 200/403/422.
- route-components.test.ts: keep ALL R4.10 asserts (frozen contract — extend, never replace) + new `data-r4-approval-diff/check/timeline-step/comment/remember` presence + permission-kind variant asserting NO diff table + primaryHrefs unchanged.
- main.test.ts: fake client postApprovalComment/delegateApproval; row-select re-render + remember:'always' payload.
- smoke r4-web-live-route-interaction.ts: extend `surface.page_vms.approvals` with items_detail+comments so 02/02a/02b/02c unchanged; ADD 02d (second-row select), 02e (comment POST), 02f (remember→'always'); assert `approvalRespond===2`; run overflow gate at 1365×1120 + 390×1180; `/approvals?empty=approvals` stays 'empty'.

### Per-increment gate
`pnpm -r typecheck` (catches tsc-only errors the tsx test runner misses, per MEMORY) + full `pnpm test` + (web/approval touched) 70-step web smoke + (inc2) `pnpm db:migrate` on local PG + `pnpm audit:migrations`. CI green before the next increment.
