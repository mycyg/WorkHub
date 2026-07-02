# WorkHub Backend Review Status - 2026-06-28

Scope note: this pass intentionally avoided changing desktop/web frontend visual files after the handoff to Claude. The review focused on API, permissions, DB repositories, agent execution, real-LLM QA gates, and deliverable/audit mutation boundaries.

## Current Frontend Freeze Boundary

- As of the 2026-06-29 unattended continuation, the user reported that Claude is reworking the frontend pages and asked Codex not to modify them.
- The following areas are treated as read-only for this record: `apps/desktop-webview`, `apps/web`, `packages/ui`, and `client-tauri`.
- App-side visual acceptance, screenshots, and liquid-glass/Cuu/Spotlight interaction review must resume only after that frontend handoff stabilizes.

## Fixed Findings

- AgentRun execution prompt now carries resolved WorkItem context and bound evidence details, instead of only a count.
- R5.10 real-key QA prompt now keeps WorkItem context and fails deliverable samples when confidence review evidence is missing or incomplete.
- `kickoff_agent` no longer shows `ai_working` before an AgentRun is actually queued.
- Accepted deliverable restore now finds previous accepted versions by project target, including cross-work-item/cross-drive-item history.
- Proposal merge accepts action-style empty POST bodies.
- Project home summary counts visible open work beyond display and scan caps.
- Project home no longer shows `no_open_work` when the visible-open-work count is non-zero but the first scanned rows are all hidden private drafts.
- Project home open-work lists and visible counts now include private work items explicitly assigned to the viewer, matching WorkItem detail-page access instead of hiding assigned `spec_ready` work.
- Project home recent Drive cards now filter accepted-deliverable files through the backing WorkItem visibility gate, so a GitHub-like project page does not advertise a file the viewer cannot open or download.
- Project home recent Drive cards now scan beyond 50 unreadable accepted-deliverable files before slicing the visible five-card summary.
- Project home actions now keep `new_task` present in the shared VM contract; cross-workspace read-only project views point it to generic intake in the VM, avoiding a web/shared UI typecheck/runtime crash while frontend-specific click handling remains frozen for later visual/client QA.
- `AUTH_MODE=hybrid` disables the public nickname `/identify` entrypoint.
- Password registration creates a default workspace membership when the membership repository is available.
- Invite creation derives workspace and member role from the server-side admin context, ignoring client-supplied workspace/owner role escalation.
- User deactivation now returns the committed soft-delete even when post-delete credential/session/device/presence cleanup is unavailable; cleanup failures are warning-only instead of making admins see a false failure after the account is already disabled.
- Project drive/meeting gates keep admin read breadth but require non-admin owners/members to stay inside the active workspace before reading or writing project Drive/meeting surfaces.
- Claimed WorkItem reads now still respect actor workspace scope.
- Permission policy lists are filtered to the admin actor tenant while preserving legacy unscoped policies.
- Permission policy evaluation now ignores policies whose org/workspace metadata does not match the actor.
- Human actors resolved from workspace memberships now carry the membership role, so role-scoped policies can actually match HTTP users.
- Permission policy creation rejects org/workspace scopes outside the admin actor tenant.
- Approval asks and delegations now verify that the routed/delegated user can view the target WorkItem; otherwise they fail closed or escalate instead of creating an invisible inbox item.
- Work-item-less approvals now stay in the routed user's personal inbox even for admins, because `approval_requests` has no org/workspace columns to support a safe tenant-wide admin view.
- Attention home background AI runs now stay scoped to the actor workspace; admins see all active runs only within the current workspace.
- AgentRun direct live/trace/handoff/replay/abort routes now stay scoped to the run workspace before applying owner/admin or WorkItem fallback access.
- AgentRun SSE run-topic subscriptions now use the same workspace boundary as the direct run routes before opening a live stream.
- Proposal review cards on the attention home now stay scoped to the actor workspace, including admin users, instead of listing reviewable proposals from other workspaces.
- Permission ask now checks a valid target WorkItem's read access before unrelated request-body schema failures, so users probing an inaccessible item see the correct 403 instead of a misleading validation error.
- Snapshot revert and accepted-deliverable restore now require artifact mutation access, not just detail read access.
- Accepted deliverable file/restore/drive-page reads now only attach a drive version when that version belongs to the accepted drive item, preventing mismatched file-version restore/download/page metadata.
- Cost budget policy overrides are now scoped to the current settings tenant before they can override default policies; foreign workspace rows no longer affect the current team's budget view.
- Cost budget policy persistence now stores overrides under tenant-scoped storage ids while returning stable public policy ids, so two workspaces can override the same default policy without moving or clobbering each other's row. Legacy unprefixed rows remain readable.
- Cost usage summaries and AgentRun budget decisions now use the actor workspace for team-budget snapshots instead of the global default workspace.
- Persisted AgentRuns now carry org/workspace ids through the DB persistence adapter.
- AgentRun heartbeat misses now preserve a persisted remote `cancelled` terminal state instead of rewriting the local live run as `failed`.
- AgentRun budget decision contracts now validate `notice` with the shared budget notice schema instead of accepting arbitrary unknown payloads.
- Real measured LLM usage now passes the actor workspace into usage records so team ledger entries land in the correct workspace scope.
- Project knowledge search now filters WorkItem results through the same WorkItem visibility gate used by detail pages.
- Knowledge search now checks a provided `work_item_id` through WorkItem detail visibility before unrelated schema validation, so users entering search from a private/unreadable item see the correct forbidden context instead of a misleading 422 payload error.
- WorkItem detail reads now load explicit assignments into the shared visibility gate, so assigned users can open private assigned work in their workspace.
- Project knowledge search rows now also carry explicit assignments, so assigned private work remains searchable by the assigned actor while hidden from others.
- Project knowledge search now also filters document evidence refs attached to private WorkItems through the same visibility gate, and drops unsafe non-relative/non-http(s) evidence hrefs before clients render source links.
- API runtime routes are now automatically compared against `/api/openapi.json`, so added or removed backend endpoints cannot silently drift from the OpenAPI contract.
- Drive comment draft creation now locks the comment row before claiming it and only updates comments that are still `pending_llm`, preventing stale reads from moving an already-processed comment back into the draft flow.
- Meeting pages now return a 404 when the caller explicitly requests a missing project or selected meeting instead of silently showing the first/empty meeting page.
- Invite creation request contracts now expose only the server-honored `email` field; workspace and role continue to be derived server-side.
- R1 PG AgentRun smoke now verifies persisted budget policy overrides by tenant-scoped storage id, while keeping the public API/audit policy id stable.
- Approval delegation now returns the committed reassignment even if the post-commit audit write fails; the audit failure is logged as a warning instead of turning a successful delegation into a false 500.
- Notification mark-read / mark-all-read / dismiss / complete actions now return the committed notification state even when the post-write audit sink fails; the audit failure is logged as a warning.
- Notification creation now returns the committed notification even when the post-write push publish fails; the publish failure is logged as a warning instead of turning a persisted notification into a false failure.
- Notification API responses now clamp drifted DB severity values to the public `normal|high|urgent` contract instead of leaking invalid enum strings to clients.
- Schedule notification page mark-read / mark-all-read / dismiss / complete actions now return the committed state even when the post-write audit sink fails.
- Meeting insight notifications now stay visible when the insight itself is readable but its attached WorkItem is private; the unreadable WorkItem id is stripped from the VM and grounding search refs instead of hiding the whole reminder.
- Assigned private WorkItem notifications and calendar due blocks now stay visible to the assigned user; Schedule/Notify repository reads load WorkItem assignments and due queries include assignment membership, matching Project Home and WorkItem detail visibility.
- Calendar schedule events now strip `target_href` and `work_item_id` when the linked WorkItem is not readable by the viewer, so project-visible events do not render dead private WorkItem links.
- Calendar meeting follow-up blocks now strip `work_item_id` unless the linked meeting-created/target WorkItem is readable by the viewer, so meeting-visible reminders do not expose private WorkItem ids.
- AgentRun abort now releases the live budget reservation immediately, propagates an AbortSignal into the in-flight provider request, and uses an atomic active-only cancellation write so a late cancel cannot overwrite a run that has already succeeded/failed/escalated.
- AgentRun final persistence now treats a claimed-worker fenced no-op as lease drift and returns the persisted owner state before confidence/proposal/notification side effects, preventing a stale worker from opening proposals after another worker has recovered the run.
- Human-reserved WorkItem guard now returns the committed `user_forbidden` escalation even when post-state audit or push publish fails; the WorkItem still moves to PM mode and the failure is warning-only.
- Skill curation now keeps committed team-skill promotions and refinements counted as successful when the post-promote audit sink fails; the audit failure is warning-only.
- AgentRun confidence recording now returns committed confidence and escalation ids even when post-write audit logging fails; the audit failure is warning-only so proposal/replay/quality links do not lose the run decision.
- AgentRun stale-claim recovery now returns recovered queued/dead-lettered runs even when recovery audit logging fails, so the scheduler can continue draining recovered work instead of reporting a false failed tick.
- Permission policy create/revoke now return the committed policy row even when post-write audit logging fails, preventing admins from seeing false failures after the RBAC rule has already changed.
- Approval expiration now returns committed expired approvals and continues notification/escalation handling even when post-expire audit logging fails.
- AgentRun tool snapshot hooks now return the committed snapshot id even when post-snapshot audit logging fails, so a transient audit sink issue no longer makes a successful side-effect tool look like `snapshot gate failed`.
- AgentRun snapshot revert now returns the committed file restore even when the post-restore `snapshot.reverted` audit write fails; the reverted snapshot and undone source audit rows remain committed while the audit failure is warning-only.
- AgentRun snapshot revert now checks a valid `snapshot_id`'s WorkItem artifact mutation gate before unrelated request-schema validation, so read-only users see the real forbidden state instead of a misleading validation error.
- AgentRun start now requires WorkItem mutation access before parsing the start body or queueing AI work, so read-only collaborators cannot burn budget or move item state.
- Proposal review, merge, rebase, merge-candidate choice, and merge-candidate apply routes now require artifact mutation access, not just WorkItem detail read access.
- Session clarification answers and evidence bindings now check mutation access before parsing request bodies or writing chat-message records, preventing read-only users from changing WorkItem context.
- Drive delete now checks project-drive manage access before parsing the optional delete body, matching upload behavior and returning a clear 403 for read-only users instead of a misleading malformed-payload error.
- AgentRun read, trace, handoff, replay, and run SSE streams now reuse WorkItem visibility after the owner/admin fast path, so collaborators who can open the backing WorkItem are not blocked from the execution evidence chain. Abort now keeps direct queue calls owner/admin-only while allowing the API route to cancel runs after the caller passes the backing WorkItem mutation gate.
- Approval comment mentions no longer create dead-link notifications for users who cannot open work-item-less approvals; those notifications are limited to the routed user or admins unless the approval is backed by a WorkItem.
- Approval comment writes now return the committed comment even when the post-write audit sink fails; the audit failure is logged as a warning instead of turning a successful comment into a false failure.
- AgentRun startup failures before the main loop (provider/workdir/snapshot-hook initialization) now mark the run failed, emit the final error trace, and reconcile the reserved budget instead of leaving the run stuck in `running`.
- AgentRun HTTP start now cancels the just-queued run and returns a startup failure when the WorkItem kickoff status transition throws, preventing a background run from completing while the WorkItem remains stuck at `spec_ready`.
- AgentRun snapshot audit logs now use the run's org/workspace ids before falling back to default settings, so non-default workspace runs do not pollute the default workspace audit trail.
- AgentRun replay merge timelines now filter proposals by the source AgentRun when branch provenance is available, preventing a run's replay from showing merge evidence created by a different run on the same WorkItem. Legacy proposals without run provenance remain visible for backward compatibility.
- Cost policy list/update/usage routes now derive policy storage, audit tenant, and team usage scope from the authenticated actor workspace instead of global default settings.
- Drive page comment draft/proposal links and accepted-deliverable WorkItem endpoint links are now filtered through the backing WorkItem visibility gate, preventing project-drive viewers from seeing links that open to 403s.
- Drive page accepted-deliverable restore links now require artifact mutation capability; read-only WorkItem viewers still get download/preview links but no dead restore action.
- Drive page accepted-deliverable restore links now use the same assignment-aware artifact mutation capability as the WorkItem detail/restore endpoint, so assigned leads are not shown a read-only Drive surface when they can actually restore the deliverable.
- Meeting page insight draft/proposal links are now filtered through the backing WorkItem visibility gate, matching Drive comment behavior.
- Meeting page record-level and target WorkItem ids are now filtered through the backing WorkItem visibility gate, preventing project-meeting viewers from seeing private WorkItem ids they cannot open.
- Project Health WorkItem visibility now includes explicit assignments, so members assigned to private open work see correct risk bands while still hiding exact numeric counts.
- Meeting insight draft/dismiss mutations can authorize insights from older deep-linked meetings by reading the insight context directly when the default meeting page slice does not include it.
- Cross-workspace admin project-home views are now read-only: they keep the project/drive read entry, hide the project-bound new-task action, and report visible open work consistently with the empty visible list.
- Cost dashboard page budget policy reads and fallback VM settings now use the authenticated actor workspace, matching `/api/cost/usage` instead of falling back to the global default workspace.
- Cost dashboard admin ledger totals are now scoped to the authenticated actor workspace while preserving by-user/by-workitem/model breakdowns and same-workspace curation/self-improvement costs.
- Cost usage and non-admin dashboard reads now scope same-user ledger entries through the current workspace usage records, preventing a multi-workspace user's other-team spend from inflating the current workspace "me" budget and personal cost dashboard.
- AI clarification provider calls now pass the authenticated actor workspace into the LLM actor, so material-analysis usage is attributed to the correct workspace ledger instead of becoming workspace-less user spend.
- AI clarification now fails clearly before calling the LLM when the user explicitly names a project file that is not present in the loaded Drive context, preventing Cuu from asking a material-based follow-up using an unrelated file.
- AI clarification now rejects generated LLM follow-up questions that omit a project file explicitly named in the user's request, so a vague but non-template question cannot bypass the material-grounding gate.
- Persistent AI clarification now fails with `clarification_llm_unavailable` when no AI clarification generator/provider is configured, instead of silently storing a local fallback question that would look like another preset/template bubble.
- AI clarification drafts now preserve valid LLM output as-is instead of filling missing optional body text with local fallback template copy, so users do not see an AI question contaminated by preset prose.
- Session, WorkItem, and Knowledge routes now preserve `WorkItemServiceError.code` through the HTTP error envelope instead of flattening business failures into generic `http_error`, allowing the client to branch on precise states such as AI clarification template rejection or deliverable restore conflicts.
- AgentRun start/replay helpers, Permission ask prechecks, Audit timeline/revert gates, and WorkItem page routes now preserve `WorkItemServiceError.code` instead of flattening reachable business failures into generic `http_error`; the existing 403/404 visibility filters still collapse unreadable resources where existence must stay hidden.
- Page aggregate routes for Drive, Project Home, Meetings, Notifications, and Calendar now preserve their service error codes in the page envelope; Project, Notification, and Pilot API routes also preserve service-specific codes through production `app.onError`, so clients can branch on precise states such as `drive_current_version_changed`, `project_forbidden`, or `invalid_range`.
- LLM provider registry defaults now inherit `LLM_MODEL` when no provider-specific model override is set; `.env.pilot` is aligned to `deepseek-v4-pro` for the real DeepSeek-compatible test path.
- Drive uploads now keep route-level cleanup only before service ownership. Once bytes are handed to the Drive page service, repository pre-commit rejections clean the materialized file, while post-commit page-refresh failures no longer delete a DB-referenced file.
- Drive JSON uploads now normalize user-supplied filenames to a basename before materializing bytes or creating drive items, matching multipart uploads and preventing path-like names from polluting Drive paths and AI file context.
- Session finalization now requires WorkItem mutation access before converting a clarification session into a `spec_ready` item, so private-detail readers such as non-owner assignees cannot silently finalize another user's intake session.
- Session create/resume now checks a valid `work_item_id` mutation gate before unrelated request-schema validation, matching `next-question` and preventing read-only users from seeing a misleading 422 instead of the real forbidden state.
- Drive page repository reads now backfill current versions for every loaded file item, not only deep-link target chains, so large projects do not render loaded files without preview/download/current-version metadata when item and version pagination diverge.
- Drive page repository reads now also backfill active accepted-deliverable locks for every loaded drive item, including legacy `project_id = null` accepted rows and accepted rows outside the page-level accepted list cap, so the page does not expose Delete actions that the repository will later reject as formal deliverables.
- Drive page and Drive mutation UUID guards now return resource-specific domain codes (`drive_not_found`, `drive_file_not_found`, `drive_comment_not_found`) for malformed project/item/comment ids while keeping the same 404 existence-hiding behavior, so clients can show the same recovery path as for valid-but-missing Drive resources.
- Meeting page and Meeting mutation UUID guards now return meeting-specific domain codes (`meeting_not_found`, `meeting_insight_not_found`) for malformed project/meeting/insight ids while keeping the same 404 existence-hiding behavior, so clients do not have to special-case generic `http_error` / `not_found` responses.
- Project home UUID guards now return `project_not_found` for malformed project ids while keeping the same 404 existence-hiding behavior, so the GitHub-like project entry can share the valid-but-missing recovery path.
- WorkItem accepted-deliverable routes now return business-specific codes for missing indexed files (`deliverable_file_missing`) and unsupported inline previews (`deliverable_preview_unsupported`) instead of generic HTTP errors.
- WorkItem create and evidence-binding routes now use the shared JSON body parser, so malformed request bodies map to the production `malformed_json` contract consistently with the rest of the API.
- WorkItem create/finalize now checks a valid `session_id` mutation gate before unrelated request-schema validation, so read-only session viewers see the real forbidden state instead of a misleading validation error during final submission.
- Project home open-work filtering now scopes the claimed-user shortcut to the actor/project workspace, preventing cross-workspace read-only project views from listing claimed private items that would 403 on detail open.
- Drive page link-access tests now lock the inverse behavior as well: backing WorkItem links remain visible for claimed private work in the actor workspace, while unreadable WorkItems still have draft/proposal/deliverable links stripped.
- Drive page accepted-deliverable file rows now reuse the filtered accepted-deliverable download/preview links instead of exposing ordinary Drive file links; direct file reads for unreadable accepted-deliverables are also blocked through the same backing WorkItem visibility check.
- Drive direct file reads for accepted deliverables now check the current Drive version's backing WorkItem instead of allowing an older readable accepted version to unlock a newer private current version.
- Drive upload filename normalization now treats dot-segment basenames (`.` / `..`) as `upload.bin`, preventing JSON uploads from materializing bytes at a directory path.
- Drive page repository reads can hydrate a deleted deep-linked target into the recycle-bin slice when refreshing after delete, so the user immediately gets the correct restore row.
- Accepted-deliverable preview support now matches Drive preview for text-like formats including YAML, XML, HTML, and TSV.
- Auth, client-device registration, notification preferences, knowledge search, project bootstrap, and session clarification routes now all use the shared JSON body parser; malformed JSON consistently returns `malformed_json` instead of route-local Chinese 400 messages flattened to generic `bad_request`.
- Shared HTTP error-code mapping now lives outside the production `app` module, so isolated route tests can assert production-compatible error envelopes without importing and initializing the full route tree.
- OpenAPI now documents JSON request bodies for the core intake/project routes (`/api/sessions`, `/api/projects/bootstrap`, `/api/workitems`, `/api/workitems/{id}/evidence-bindings`, and `/api/knowledge/search`) instead of leaving client builders to infer payload fields from runtime validators.
- The OpenAPI knowledge-search body fields now match the runtime validator (`run` and `scope` are documented; the stray non-runtime `source_kind` field was removed).
- OpenAPI now marks optional core JSON bodies as optional for `/api/sessions`, `/api/projects/bootstrap`, and `/api/knowledge/search`, while keeping mutation-required bodies required for WorkItem creation and evidence binding.
- OpenAPI now expands the nested `cuu_launcher_spec` and `evidence_refs` schemas instead of documenting them as blank objects, so generated clients can see the actual launcher option and evidence-ref payload shape.
- OpenAPI now documents Drive and Project page path/query parameters, aligns Drive JSON upload/delete request bodies with runtime behavior, and auto-fills required path parameters for every templated route so generated clients do not miss `{id}`-style inputs.
- OpenAPI now documents the 200 response envelope and core VM fields for the Drive and Project Home page APIs, so generated clients see `ok`, `data`, `meta.locale`, and the page summary/action/file-list shapes.
- OpenAPI now documents refreshed Drive Page VM responses for Drive upload, delete, and restore mutations, matching the runtime behavior that returns the updated page after each Drive sync action.
- OpenAPI now documents Drive comment-to-draft, Drive draft-to-proposal, Meeting insight draft/dismiss, and Meeting draft-to-proposal response envelopes, including UUID path parameters and refreshed page/detail VM fields.
- OpenAPI now documents proposal create/list/read/review/merge/rebase/conflict/merge-candidate action contracts, including UUID path parameters, optional merge/apply bodies, and the core response payloads for project-management review buttons.
- OpenAPI now documents Drive preview JSON payloads and Drive download binary/file-header responses, so generated clients can handle inline preview and real file download contracts.
- OpenAPI now documents the task intake, clarification, evidence binding, AgentRun live/trace/handoff/replay/revert response chain, including 201/202 envelopes and UUID path parameters for generated clients.
- OpenAPI now documents approval decision, delegation, approval comments, permission policy CRUD, and `/api/permissions/ask` contracts, including UUID path parameters and the public snake_case permission-policy record shape with timestamps.
- Session clarification answers now use a generic WorkItem mutation precheck at both route and service layers instead of the artifact-specific gate, so read-only users see a relevant "cannot modify this item" message rather than a confusing "accepted deliverable" permission error.
- Evidence binding now uses the same generic WorkItem mutation precheck at both route and service layers, so users who can read a private item but cannot modify it see the correct item-level permission message instead of an accepted-deliverable-specific error.
- AgentRun start now uses the generic WorkItem mutation precheck before parsing the start body, so users who can read a private item but cannot start AI execution see an item-level permission message instead of an accepted-deliverable-specific error.
- Drive-comment and meeting-insight draft-to-proposal flows now require accepted-deliverable mutation access before creating or self-healing a proposal, matching the regular proposal route and preventing source-material managers from bypassing WorkItem artifact permissions.
- Proposal merge and AI-fusion apply routes now treat explicit `confirm:false` as a recoverable `confirmation_required` no-op before calling the proposal service, preventing SDK/client preview or cancel payloads from mutating official deliverables.
- Proposal `keep_current` conflict resolution now treats the target as already user-resolved before AI-fusion candidate generation, so choosing "keep current" does not silently spend LLM work or material-analysis time after the user has rejected the incoming change.
- Proposal rebase OpenAPI now documents the actual `RebaseProposalResult` shape (`proposal_id`, `work_item_id`, `conflicts`, optional `clean_after_rebase`) instead of the plain conflict-list shape, so clients can render the refreshed-base flow without guessing hidden fields.
- Approval respond OpenAPI now mirrors the runtime contract that `deny` requires `reason_md`, while `allow` can still be submitted with only `decision`; clients can disable/validate the deny button before the user hits a 422.
- WorkItem detail and AgentRun replay now hide accepted-deliverable `restore_href` for read-only viewers, matching the restore mutation gate and preventing dead "restore" actions that would only 403 after click. Download and preview links remain visible for readable deliverables.
- Drive multipart uploads now reject files over 32 MiB before reading bytes, materializing storage, or calling the Drive page service, returning `drive_file_too_large` instead of risking a local daemon OOM.
- DeepSeek provider configuration now inherits `LLM_BASE_URL` when `PROVIDER_DEEPSEEK_BASE_URL` is not explicitly set, so a single real-test base URL such as `https://api.deepseek.com/anthropic` controls the actual provider endpoint.
- Existing-session clarification now requires WorkItem mutation access before regenerating AI clarification questions, and the `next-question` route no longer calls the side-effecting session VM builder before the mutation gate; read-only users cannot burn LLM budget or write clarification chat rows.
- `getSession` now also requires WorkItem mutation access before it can generate a missing AI clarification question, so a read-only session refresh cannot trigger material analysis, chat-message writes, or LLM budget usage.
- Approval comment `@mention` notifications for WorkItem-backed approvals now filter each mentioned user through WorkItem visibility before including the comment body and `/workitems/:id` target URL, avoiding private-context notification leaks.
- Permission ask API responses now redact internal matched-policy and considered-policy details for public allow/deny decisions, while preserving only the user-meaningful decision effect, action pattern, and reason.
- Approval respond/delegate routes now check the routed actor's action ownership before request-body parsing, so unauthorized users get the correct 403 instead of learning schema details through 422 responses.
- Knowledge search now validates malformed `work_item_id` values before touching WorkItem visibility services, preserving the 422 schema boundary without accidental service/DB calls.
- Permission-policy shared contracts now accept nullable API metadata fields that the route can legitimately return for legacy/global policies.
- Desktop bootstrap and client-device registration now reject blank device names before creating local device rows.
- Project bootstrap now rejects blank names and slugs instead of silently falling back to a default project.
- Proposal creation now maps a supplied `branch_id` that belongs to a different WorkItem into `proposal_branch_workitem_mismatch` instead of letting a repository invariant escape as a 500.
- Drive delete and restore now report missing item targets as `drive_file_not_found` instead of project-level `drive_not_found`, so clients can show the correct file recovery path.
- Notification preferences now normalize drifted stored mute-type values before returning them to clients, and preference semantic payload errors now use `422 validation_error` while malformed JSON remains `400 malformed_json`.
- Invite accept now validates the out-of-band token before nickname/password semantics, so recipients with a bad or expired link see the correct invite-not-found state instead of unrelated form validation.
- Notification page OpenAPI now documents runtime `dedupe_key`, keeping generated clients aligned with the page VM emitted by `schedule-notify-pages`.
- Raw notification lists now filter out WorkItem-backed notifications the actor cannot read, including unread/total counts, instead of exposing private titles/body/project context with only the link stripped.
- Notification mark-read, mark-all-read, dismiss, and complete now reuse the same actor WorkItem visibility gate as raw notification lists, so hidden WorkItem-backed notifications cannot be mutated or counted through action endpoints after disappearing from the list.
- Approval center item detail now joins proposal manifests only when `payload_json.raw_args.proposal_id` explicitly names a proposal belonging to the approval WorkItem; tool approvals no longer fall back to an arbitrary WorkItem proposal.
- Meeting insight notification refresh now overfetches candidates before actor visibility filtering and then caps visible work, so recent private insights cannot hide the first visible meeting follow-up notification.
- Calendar due blocks now exclude `merged` WorkItems at both service and repository layers, matching the existing `done/cancelled` terminal-state behavior.
- Password-mode logout now revokes a session cookie only when that session belongs to the already-resolved current identity, so a winning client-token identity cannot accidentally revoke another user's cookie session.
- Team-skill distillation/refinement response parsing now extracts the first balanced JSON object instead of regex-slicing the first Markdown code fence, so valid SKILL.md or patch content containing fenced code blocks is no longer discarded as an empty AI result.
- SSE stream cleanup now runs presence `markStreamClosed` even when bus unsubscribe fails, preventing transient Redis/pubsub cleanup errors from leaving users falsely online after a disconnected Cuu/web stream.
- Approval center pagination and totals now filter WorkItem visibility inside the service before building the page, so hidden routed approvals cannot leak through `pending_total`/`has_more` or starve visible approvals out of the first page.
- Project bootstrap now maps same-workspace slugs occupied by archived/deleted project rows to `409 project_slug_occupied` instead of letting the repository invariant escape as a generic 500.
- Drive page repository reads now hydrate deleted ancestors for a focused recycle-bin target item, so child restore links are hidden when the parent folder is still deleted instead of rendering an action that must fail with `drive_parent_deleted`.
- Drive folder delete emptiness checks now count only same-project active children, preventing cross-project orphan/legacy rows from blocking deletion of an otherwise empty folder.
- Meeting draft-to-proposal audit recording now locks the source meeting insight before checking whether the proposal audit already exists, preventing concurrent retries from racing duplicate audit writes.
- OpenAPI now documents `409` conflict envelopes for Drive comment-to-draft, Drive draft-to-proposal, Meeting insight draft/dismiss, and Meeting draft-to-proposal actions, so generated clients can branch on stale/dismissed/missing-source states instead of treating them as generic failures.
- Meeting insight-to-draft now locks the source insight before checking existing draft state, matching Drive comment draft behavior so duplicate clicks/concurrent actors can safely return the existing draft instead of creating an inconsistent losing 409 path.
- Accepted deliverable restore OpenAPI now documents business `409` codes for not-versioned, no-previous-version, and version-changed states, letting clients explain failed restore attempts precisely.
- Approval delegation OpenAPI now documents target-not-found and semantic delegate errors (`delegate_to_requester`, `delegate_target_cannot_view`) in addition to `approval_race`, so stale member pickers and invisible-target cases are not generic failures.
- Accepted deliverable download/preview OpenAPI now documents missing-file and unsupported-preview errors, so clients can show "file missing/regenerate" or "download instead" states rather than treating formal-deliverable failures as opaque network errors.
- Drive ordinary file download/preview OpenAPI now documents missing-file and unsupported-preview errors, matching the runtime routes used by the GitHub-like project Drive so clients can show "file missing/reupload" or "download instead" states precisely.
- Drive upload OpenAPI now documents missing-content, file-too-large, deleted-parent, and same-name conflict errors, so upload UI clients can distinguish "choose a file", "JSON content required", "too large", and "rename or pick another folder" outcomes.
- Project bootstrap OpenAPI now documents the `human_required` 403 branch, so project-management clients can distinguish "needs a real user identity" from slug conflicts or generic failures.
- Drive, Project Home, and Meetings page OpenAPI now document their runtime `403`/`404` page-envelope error codes, so GitHub-like project/drive/meeting clients can distinguish missing targets from permission failures without guessing from generic network errors.
- Calendar page OpenAPI now documents the runtime `422 invalid_calendar_query` envelope for invalid `date` or `view` query strings, so clients can surface a clear query correction state instead of treating calendar navigation failures as opaque.
- Notification action OpenAPI now documents missing/hidden notification errors and the `notification_needs_decision` completion guard, so inbox clients can tell users to open the source decision instead of silently failing a Complete click. Preference update also documents missing-user and unsupported-deployment failures.
- Drive file download/preview plus Drive upload/delete/restore/comment-draft/proposal-draft OpenAPI now documents the runtime `403`/`404` envelopes, including cross-service WorkItem `forbidden`/`not_found` branches for Drive draft-to-proposal, so generated clients can distinguish permission, missing project, missing file/comment, and stale business-state failures.

## Verification

Latest non-frontend continuation checks:

- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Drive and Project|secondary page"` failed red first because Drive/Project/Meetings page VM routes documented only `200` responses, then passed after adding their runtime `403`/`404` error envelopes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed after the Drive/Project/Meetings page error-contract update.
- `pnpm --filter @workhub/api typecheck` passed after the Drive/Project/Meetings page error-contract update.
- `pnpm --filter @workhub/api-client test` passed after the OpenAPI page error-contract update: 15 tests.
- `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts apps/api/src/http-error-codes.ts packages/db/src/repositories/meetings.ts` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace in the current touched backend/doc files.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Calendar page OpenAPI"` failed red first because `/api/pages/calendar` lacked the runtime `422 invalid_calendar_query` response, then passed after documenting that error envelope.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed after the Calendar page error-contract update.
- `pnpm --filter @workhub/api typecheck` passed after the Calendar page error-contract update.
- `pnpm --filter @workhub/api-client test` passed after the Calendar page OpenAPI update: 15 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "notification OpenAPI"` failed red first because notification actions and preference updates lacked runtime `404`/`409`/`501` error envelopes, then passed after documenting the action-specific codes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed after the notification action error-contract update.
- `pnpm --filter @workhub/api typecheck` passed after the notification action error-contract update.
- `pnpm --filter @workhub/api-client test` passed after the notification action OpenAPI update: 15 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Drive and Meeting draft action|drive OpenAPI request bodies|Drive preview and download"` failed red first because Drive file transfer and Drive mutation/draft actions lacked their runtime `403`/`404` error envelopes, then passed after documenting the Drive and WorkItem-derived codes.
- `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=dot src/meeting-path.test.ts` failed red first because Meeting `recordDraftProposal` did not lock the source insight row, then passed after adding `for("update")`.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Drive and Meeting draft action OpenAPI responses document refreshed page envelopes"` failed red first because Drive/Meeting draft actions lacked `409` error envelopes, then passed after documenting the conflict code enums.
- `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=dot src/meeting-path.test.ts` failed red first because Meeting `insightToDraft` did not lock the source insight before existing-draft checks, then passed after adding `for("update")`.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Approval and permission OpenAPI"` failed red first because approval delegation lacked `404`/`422` error contracts, then passed after documenting the delegate target errors.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "work item accepted deliverable OpenAPI responses document file payloads"` failed red first because accepted-deliverable restore lacked its `409` error contract, then passed after documenting the deliverable restore conflict codes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "work item accepted deliverable OpenAPI responses document file payloads"` failed red first because accepted-deliverable download/preview lacked missing-file and unsupported-preview contracts, then passed after documenting `404` and `415` envelopes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Drive preview and download OpenAPI responses document file payloads"` failed red first because ordinary Drive download/preview lacked missing-file and unsupported-preview contracts, then passed after documenting `404` and `415` envelopes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "drive OpenAPI request bodies match the runtime upload and delete contracts"` failed red first because Drive upload lacked `400`/`413`/`409` error contracts, then passed after documenting upload-specific error envelopes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "project OpenAPI routes document list and bootstrap response payloads"` failed red first because project bootstrap lacked the `403 human_required` contract, then passed after documenting the real-user requirement.
- `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` failed red first on hidden approvals leaking `pending_total` and starving a visible approval behind 101 hidden rows, then passed after approval center pagination/counting moved visibility filtering into the service: 53 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/projects.test.ts` failed red first because an archived/deleted slug occupancy surfaced as a plain `Error`, then passed after mapping it to `409 project_slug_occupied`: 9 tests.
- `pnpm --filter @workhub/db exec node --import tsx --test src/drive-path.test.ts` failed red first on missing deleted target ancestors and same-project folder child filtering, then passed after the Drive repository fixes: 20 tests.
- `pnpm --filter @workhub/api typecheck` passed after the approval/project/drive repository continuation fixes.
- `pnpm --filter @workhub/db typecheck` passed after the approval/project/drive repository continuation fixes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed after the approval/project/drive repository continuation fixes.
- `pnpm --filter @workhub/db exec node --import tsx --test 'src/*.test.ts'` passed after the approval/project/drive repository continuation fixes: 55 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/push.test.ts` failed red first because a throwing bus unsubscribe skipped presence close, then passed after SSE cleanup isolated unsubscribe and presence-close failures: 11 tests.
- `pnpm --filter @workhub/api typecheck` passed after the SSE cleanup fix.
- `git diff --check -- apps/api/src/sse/stream.ts apps/api/src/push.test.ts` passed after the SSE cleanup fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` passed from `apps/api` after the SSE cleanup fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/skill-curation.test.ts` failed red first on fenced SKILL.md/patch content inside fenced JSON, then passed after the shared balanced-JSON extractor replaced regex fence slicing: 25 tests.
- `pnpm --filter @workhub/api typecheck` passed after the team-skill response parser fix.
- `git diff --check -- apps/api/src/services/skill-curation.ts apps/api/src/skill-curation.test.ts` passed after the team-skill response parser fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` passed from `apps/api` after the team-skill response parser fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` failed red first on `persistent intake rejects generated clarification that misses an explicitly named project file`, then passed after generated clarification drafts were required to mention user-named Drive files: 35 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts` passed after the generated-clarification grounding fix: 27 tests.
- `pnpm --filter @workhub/api typecheck` passed after the generated-clarification grounding fix.
- `git diff --check -- apps/api/src/services/work-items.ts apps/api/src/work-items-service.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the generated-clarification grounding fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` passed from `apps/api` after the generated-clarification grounding fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "secondary page OpenAPI" src/app.test.ts` failed red first because `/api/pages/notifications` item schema omitted `dedupe_key`, then passed after adding the field.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "hides unreadable" src/notifications.test.ts` failed red first because raw notification totals still counted a private WorkItem notification, then passed after filtering invisible rows before response/count generation.
- `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts src/notifications-routes.test.ts src/app.test.ts` passed after the notification filtering and OpenAPI fixes: 48 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "does not fall back" src/approvals.test.ts` failed red first because a WorkItem-backed tool approval rendered as `deliverable`, then passed after removing the no-`proposal_id` proposal fallback.
- `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed after the approval detail fallback fix: 46 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "overfetches" src/schedule-notify-pages.test.ts` failed red first because the 81st visible meeting insight was hidden behind 80 invisible candidates, then passed after overfetch-before-filtering.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "merged work items" src/schedule-notify-pages.test.ts` failed red first because merged WorkItems still appeared as calendar blocks, then passed after service and repository terminal-state filtering.
- `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` passed after the schedule/notification fixes: 12 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "different user's session" src/auth.test.ts` failed red first because Bob's session cookie was revoked during Alice's client-token logout, then passed after the session-user guard.
- `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts` passed after the logout identity fix: 62 tests.
- `pnpm --filter @workhub/api typecheck` passed after the current continuation fixes.
- `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` passed from `apps/api` after the current continuation fixes.
- `pnpm --filter @workhub/api-client test` passed after the OpenAPI notification page schema update: 15 tests.

- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "confirm:false|oversized multipart" src/proposals.test.ts src/drive-pages.test.ts` failed red first because oversized uploads reached `uploadFile` and `confirm:false` returned 200, then passed after the Drive size guard and proposal confirmation no-op.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "expose conflict cards" src/proposals.test.ts` failed red first because AI-fusion apply with `confirm:false` still applied the merge candidate, then passed after the shared confirmation guard.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "keep-current conflict action" src/proposals.test.ts` failed red first with `2 !== 1` because keep-current resolution still triggered a second fusion-generator call, then passed after service-level resolved-target filtering included `keep_current`.
- `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed after the keep-current fusion-suppression fix: 34 tests.
- `pnpm --filter @workhub/api typecheck` passed after the keep-current fusion-suppression fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Proposal OpenAPI contracts" src/app.test.ts` failed red first because `/api/proposals/{id}/rebase` documented only `conflicts`, then passed after adding the dedicated rebase result response schema.
- `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed after the rebase OpenAPI fix: 24 tests.
- `pnpm --filter @workhub/api typecheck` passed after the rebase OpenAPI fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Approval and permission OpenAPI" src/app.test.ts` failed red first because approval respond documented no deny/reason conditional branch, then passed after adding the `anyOf` allow/deny request variants.
- `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed after the approval respond OpenAPI fix: 24 tests.
- `pnpm --filter @workhub/api typecheck` passed after the approval respond OpenAPI fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "restore links for read-only" src/work-items-service.test.ts` failed red first because a read-only detail VM still exposed `/restore`, then passed after WorkItem detail mapped accepted-deliverables with actor mutation capability.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "restore links for read-only|restore requires artifact mutation" src/work-items-service.test.ts` passed after the WorkItem accepted-deliverable restore-link fix: 2 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/accepted-deliverables.test.ts` passed after the restore-link helper change: 1 test.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts src/workitems.test.ts src/drive-pages.test.ts` passed after the restore-link helper and WorkItem detail fix: 84 tests.
- `pnpm --filter @workhub/api typecheck` initially caught the new helper signature at the `Array.map` call site and exact optional property typing, then passed after explicit lambdas/options.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "persistent intake requires an AI clarification generator" src/work-items-service.test.ts` failed red first because persistent intake still returned a local fallback clarification question, then passed after the DB service required an AI clarification generator/provider before creating the question.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "persistent intake requires an AI clarification generator|persistent intake fails clearly|persistent intake passes the actor workspace|persistent intake rejects injected generic|persistent intake ignores stale" src/work-items-service.test.ts` passed after the AI-clarification no-fallback fix: 5 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "session clarification question is generated|session route preserves AI clarification|AI clarification rejects generic|AI clarification accepts material" src/gold-path.test.ts` passed after the AI-clarification no-fallback fix: 4 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "persistent getSession requires mutation" src/work-items-service.test.ts` failed red first because `getSession` could regenerate and store a clarification question for a read-only viewer, then passed after `getSession` required WorkItem mutation access before rendering a missing scope question.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "persistent getSession requires mutation|persistent intake requires mutation access|session clarification answer uses generic mutation" src/work-items-service.test.ts` passed after the `getSession` mutation gate fix: 3 tests.
- `pnpm --filter @workhub/config exec node --import tsx --test --test-name-pattern "LLM_BASE_URL" src/env.test.ts` failed red first because `PROVIDER_DEEPSEEK_BASE_URL`'s default masked `LLM_BASE_URL`, then passed after provider base URL inheritance.
- `pnpm --filter @workhub/config exec node --import tsx --test src/env.test.ts` passed after the provider URL inheritance fix: 14 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "mutation access before regenerating|next-question checks session access" src/work-items-service.test.ts src/gold-path.test.ts` failed red first because route/service paths still performed side-effecting clarification work before mutation access, then passed after the session mutation gates.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "session next-question checks mutation access" src/gold-path.test.ts` passed after the session route kept body parsing behind the mutation gate.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "mention skips users who cannot open the approval work item" src/approvals.test.ts` failed red first because an unreadable mentioned user still received the private comment body, then passed after WorkItem visibility filtering.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "mention" src/approvals.test.ts` passed after the mention visibility fix: 4 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts --test-name-pattern "hides draft, proposal, and accepted-deliverable links"` failed red first because accepted-deliverable Drive item rows still exposed ordinary `/api/drive/.../download` links, then passed after item links reused the filtered accepted-deliverable links.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts --test-name-pattern "direct file reads"` failed red first with `Missing expected rejection`, then passed after `DrivePageService.file()` blocked unreadable accepted-deliverable direct reads through backing WorkItem access.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed after the accepted-deliverable link/direct-read fix: 44 tests.
- `pnpm --filter @workhub/api typecheck` passed after the accepted-deliverable link/direct-read fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` passed from `apps/api`: 496 tests.
- `git diff --check -- apps/api/src/routes/drive.ts apps/api/src/services/drive-pages.ts apps/api/src/drive-pages.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the accepted-deliverable link/direct-read fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts --test-name-pattern "JSON filenames"` failed red first because the service received `../nested/report.md`, then passed after the JSON upload path reused `displayFilename`.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts --test-name-pattern "JSON filenames"` passed after the Drive JSON filename fix: 43 tests.
- `pnpm --filter @workhub/api typecheck` passed after the Drive JSON filename and knowledge evidence-ref fixes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` passed from `apps/api`: 495 tests.
- `git diff --check -- apps/api/src/routes/drive.ts apps/api/src/drive-pages.test.ts apps/api/src/services/work-items.ts apps/api/src/work-items-service.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the Drive JSON filename fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "knowledge (document|search hides documents)"` failed red first because private WorkItem-attached documents still surfaced and `javascript:` evidence hrefs reached the client, then passed after document refs reused the visible WorkItem id set and `safeEvidenceHref`.
- `pnpm --filter @workhub/api exec node --import tsx --test src/knowledge.test.ts` passed after the knowledge evidence-ref fix: 2 tests.
- `pnpm --filter @workhub/api typecheck` passed after the knowledge evidence-ref fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` passed from `apps/api`: 494 tests.
- `git diff --check -- apps/api/src/services/work-items.ts apps/api/src/work-items-service.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the knowledge evidence-ref fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts` failed red first on `notification list clamps drifted DB severity values to the public contract`, then passed after `toNotificationResponse` began clamping severity with the shared notification severity schema.
- `pnpm --filter @workhub/api typecheck` passed after the notification severity contract fix.
- `pnpm --filter @workhub/api test` passed after the notification severity contract fix: 492 tests.
- `git diff --check -- apps/api/src/services/notifications.ts apps/api/src/notifications.test.ts apps/api/src/services/schedule-notify-pages.ts apps/api/src/schedule-notify-pages.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the notification severity contract fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` failed red first on `meeting insight notification stays visible when its attached work item is private`, then passed after notification filtering switched to meeting-insight visibility and stripped the unreadable WorkItem id from the VM/grounding refs.
- `pnpm --filter @workhub/api typecheck` passed after the meeting-insight notification visibility fix.
- `pnpm --filter @workhub/api test` passed after the meeting-insight notification visibility fix: 491 tests.
- `git diff --check -- apps/api/src/services/schedule-notify-pages.ts apps/api/src/schedule-notify-pages.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the meeting-insight notification visibility fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "explicitly named project file"` failed red first with `Missing expected rejection`, then passed after explicit Drive filename validation stopped the LLM from using unrelated project-file context.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "explicitly named project file|clarification|provider registry"` passed after the explicit filename guard: 16 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts --test-name-pattern "AI clarification|session clarification|confirm-step|session next-question"` passed after the explicit filename guard: 25 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "session finalization requires mutation access"` failed red first with `Missing expected rejection`, then passed after session finalization reused the WorkItem mutation gate.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "session finalization requires mutation access|kickoff_agent finalize|accepted deliverable restore requires artifact mutation|assigned users can open private"` passed after the session-finalization mutation fix: 17 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts --test-name-pattern "AI clarification|session clarification|confirm-step|session next-question"` passed after the session-finalization mutation fix: 25 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts --test-name-pattern "session next-question checks mutation access"` failed red first with the artifact-specific message `你没有权限修改这个事项的正式交付物。`, then passed after Session routes switched to the generic WorkItem mutation precheck.
- `pnpm --filter @workhub/api typecheck` passed after adding the generic `assertCanMutateWorkItem` service method.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts --test-name-pattern "AI clarification|session clarification|confirm-step|session next-question"` passed after the generic session mutation precheck: 25 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "session clarification answer uses generic mutation access"` failed red first with the artifact-specific message `你没有权限修改这个事项的正式交付物。`, then passed after `WorkItemService.nextQuestion` switched to the generic WorkItem mutation gate.
- `pnpm --filter @workhub/api exec node --import tsx --test src/workitems.test.ts --test-name-pattern "evidence binding checks mutation access"` failed red first with the artifact-specific message `你没有权限修改这个事项的正式交付物。`, then passed after the evidence-binding route switched to the generic WorkItem mutation precheck before JSON body parsing.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "evidence binding uses generic mutation access"` failed red first with the artifact-specific message `你没有权限修改这个事项的正式交付物。`, then passed after `WorkItemService.bindEvidence` switched to the generic WorkItem mutation gate.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts --test-name-pattern "agent run enqueue requires mutation access"` failed red first with the artifact-specific message `你没有权限修改这个事项的正式交付物。`, then passed after AgentRun start switched to the generic WorkItem mutation gate.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts --test-name-pattern "agent run enqueue requires mutation access|agent run enqueue preserves work item service error codes"` passed after the AgentRun start mutation-gate fix: 55 tests.
- `pnpm --filter @workhub/api typecheck` passed after the AgentRun start mutation-gate fix.
- `pnpm --filter @workhub/api test` passed after the AgentRun start mutation-gate fix: 485 tests.
- `git diff --check -- apps/api/src/routes/agent-runs.ts apps/api/src/agent-runs.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the AgentRun start mutation-gate fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts --test-name-pattern "drive draftToProposal requires artifact mutation access"` failed red first by reaching `recordDraftProposal`, then passed after Drive draft-to-proposal called `assertCanMutateArtifacts` before proposal creation/self-heal: 41 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/meeting-pages.test.ts --test-name-pattern "meeting draftToProposal requires artifact mutation access"` failed red first by reaching `recordDraftProposal`, then passed after Meeting draft-to-proposal called `assertCanMutateArtifacts` before proposal creation/self-heal: 13 tests.
- `pnpm --filter @workhub/api typecheck` passed after the Drive/Meeting draft-to-proposal mutation-gate fix.
- `pnpm --filter @workhub/api test` passed after the Drive/Meeting draft-to-proposal mutation-gate fix: 487 tests.
- `git diff --check -- apps/api/src/services/drive-pages.ts apps/api/src/services/meeting-pages.ts apps/api/src/drive-pages.test.ts apps/api/src/meeting-pages.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the Drive/Meeting draft-to-proposal mutation-gate fix.
- `pnpm --filter @workhub/api typecheck` passed after aligning the evidence-binding regression fixture with the `EvidenceRef` contract fields.
- `pnpm --filter @workhub/api test` passed after the evidence-binding mutation-gate fix: 485 tests.
- `git diff --check -- apps/api/src/routes/workitems.ts apps/api/src/services/work-items.ts apps/api/src/workitems.test.ts apps/api/src/work-items-service.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the evidence-binding mutation-gate fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "session finalization requires mutation access|kickoff_agent finalize|accepted deliverable restore requires artifact mutation|assigned users can open private"` passed after the generic session mutation precheck: 17 tests.
- `pnpm --filter @workhub/api test` passed after the session mutation precheck and session-finalization guard: 483 tests.
- `git diff --check -- apps/api/src/services/work-items.ts apps/api/src/routes/sessions.ts apps/api/src/gold-path.test.ts apps/api/src/work-items-service.test.ts apps/api/src/workitems.test.ts apps/api/src/agent-runs.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the session mutation precheck.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "meeting (page route rejects a malformed selected meeting id|mutation routes reject malformed insight ids)" src/meeting-pages.test.ts` failed red first with `http_error` / `not_found`, then passed after Meeting malformed-id guards returned meeting-specific domain codes.
- `pnpm --filter @workhub/api exec node --import tsx --test src/meeting-pages.test.ts` passed after the Meeting malformed-id code fix: 12 tests.
- `pnpm --filter @workhub/api typecheck` passed after the Meeting malformed-id code fix.
- `pnpm --filter @workhub/api test` passed after the Meeting malformed-id code fix: 480 tests.
- `git diff --check -- apps/api/src/routes/meetings.ts apps/api/src/routes/pages.ts apps/api/src/meeting-pages.test.ts` passed after the Meeting malformed-id code fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "project home route preserves project domain code" src/gold-path.test.ts` failed red first with `not_found`, then passed after the project-home route guard returned `project_not_found`.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts` passed after the project-home malformed-id code fix: 25 tests.
- `pnpm --filter @workhub/api typecheck` passed after the project-home malformed-id code fix.
- `pnpm --filter @workhub/api test` passed after the project-home malformed-id code fix: 481 tests.
- `pnpm --filter @workhub/db exec node --import tsx --test --test-name-pattern "accepted-deliverable locks" src/drive-path.test.ts` failed red first, then passed after `readPage` backfilled loaded-item accepted-deliverable locks.
- `pnpm --filter @workhub/db exec node --import tsx --test src/drive-path.test.ts` passed after the loaded-item accepted-deliverable lock fix: 12 tests.
- `pnpm --filter @workhub/db typecheck` passed after the loaded-item accepted-deliverable lock fix.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed after the loaded-item accepted-deliverable lock fix: 40 tests.
- `pnpm --filter @workhub/db test` passed after the loaded-item accepted-deliverable lock fix: 44 tests.
- `pnpm --filter @workhub/api test` passed after the loaded-item accepted-deliverable lock fix: 480 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "malformed item_id|malformed path ids" src/drive-pages.test.ts` failed red first with `http_error` / `not_found`, then passed after Drive malformed-id guards returned resource-specific domain codes.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed after the Drive malformed-id code fix: 40 tests.
- `pnpm --filter @workhub/api typecheck` passed after the Drive malformed-id code fix.
- `pnpm --filter @workhub/api test` passed after the Drive malformed-id code fix: 480 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "core JSON mutation routes document optional" src/app.test.ts` passed after the optional-body and nested-schema OpenAPI correction.
- `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed after the optional-body and nested-schema OpenAPI correction: 11 tests.
- `pnpm --filter @workhub/api typecheck` passed after the optional-body and nested-schema OpenAPI correction.
- `pnpm --filter @workhub/api test` passed after the optional-body and nested-schema OpenAPI correction: 480 tests.
- `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts apps/api/src/http-error-codes.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the optional-body and nested-schema OpenAPI correction.
- `pnpm --filter @workhub/api test` passed after the shared JSON parser sweep and route-test isolation fix: 478 tests.
- `pnpm --filter @workhub/api typecheck` passed after the shared JSON parser sweep and route-test isolation fix.
- `pnpm --filter @workhub/api test` passed after the OpenAPI core request-body contract fix: 479 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed after the OpenAPI core request-body contract fix: 10 tests, including the red-first `core JSON mutation routes document their request body fields` guard.
- `pnpm --filter @workhub/api typecheck` passed after the OpenAPI core request-body contract fix.
- `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts` passed after the OpenAPI core request-body contract fix.
- Read-only reviewer found one Important mismatch in the first OpenAPI body-schema pass: `/api/knowledge/search` documented `source_kind` while runtime accepted `run`/`scope`. The test was flipped red against the runtime fields, failed on the stale OpenAPI shape, then passed after the schema correction.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "core JSON mutation routes document" src/app.test.ts` passed after the reviewer correction.
- `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed after the reviewer correction: 10 tests.
- `pnpm --filter @workhub/api test` passed after the reviewer correction: 479 tests.
- `pnpm --filter @workhub/api typecheck` passed after the reviewer correction.
- `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after the reviewer correction.
- `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 9 tests, including the source guard that isolated route tests do not import `./app.js` just for HTTP error codes.
- `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts src/gold-path.test.ts src/knowledge.test.ts src/notifications-routes.test.ts src/projects.test.ts` passed: 94 tests across the affected route parser/error-code surfaces.
- `rg -n "JSON\\.parse|c\\.req\\.json\\(|req\\.json\\(|不是有效的 JSON|请求体必须是 JSON|readJsonBody|optionalJson" apps/api/src/routes` now only reports the shared parser in `apps/api/src/routes/json-body.ts`.
- `git diff --check -- apps/api/src/app.test.ts apps/api/src/app.ts apps/api/src/http-error-codes.ts apps/api/src/auth.test.ts apps/api/src/gold-path.test.ts apps/api/src/knowledge.test.ts apps/api/src/notifications-routes.test.ts apps/api/src/projects.test.ts apps/api/src/routes/auth.ts apps/api/src/routes/client-devices.ts apps/api/src/routes/knowledge.ts apps/api/src/routes/notifications.ts apps/api/src/routes/projects.ts apps/api/src/routes/sessions.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts` passed: 59 tests, including `malformed_json` for `/api/auth/identify` and `/api/client-devices/register`.
- `pnpm --filter @workhub/api exec node --import tsx --test src/notifications-routes.test.ts` passed: 3 tests, including `malformed_json` for notification preferences.
- `pnpm --filter @workhub/api exec node --import tsx --test src/knowledge.test.ts` passed: 2 tests, including `malformed_json` for knowledge search.
- `pnpm --filter @workhub/api exec node --import tsx --test src/projects.test.ts` passed: 6 tests, including `malformed_json` for project bootstrap.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "session clarification|session route|session next-question|session create" src/gold-path.test.ts` passed: 7 tests, including `malformed_json` for session creation while preserving next-question permission-before-body order.
- `pnpm --filter @workhub/api exec node --import tsx --test src/project-home-pages.test.ts` passed: 13 tests, including the red-first cross-workspace claimed-item dead-link guard.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed: 40 tests, including claimed-private backing WorkItem links and unreadable WorkItem link stripping.
- `pnpm --filter @workhub/api test` passed after the Drive/WorkItem/config/project-home review fixes: 472 tests.
- `pnpm --filter @workhub/api typecheck` passed after the Drive/WorkItem/project-home route and service changes.
- `pnpm --filter @workhub/db test` passed after the Drive repository current-version backfill guard: 43 tests.
- `pnpm --filter @workhub/db typecheck` passed after the Drive repository change.
- `pnpm --filter @workhub/config test` passed after the LLM model fallback fix: 13 tests.
- `pnpm --filter @workhub/config typecheck` passed after the LLM model fallback fix.
- `git diff --check -- .env.pilot packages/config/src/env.ts packages/config/src/env.test.ts packages/db/src/repositories/drive.ts packages/db/src/drive-path.test.ts apps/api/src/routes/drive.ts apps/api/src/services/drive-pages.ts apps/api/src/drive-pages.test.ts apps/api/src/routes/workitems.ts apps/api/src/workitems.test.ts apps/api/src/services/project-home-pages.ts apps/api/src/project-home-pages.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed: 39 tests covering Drive page link access, upload/restore focus, parent-folder upload, materialized-byte cleanup ownership, malformed JSON, ordinary preview/download, and mutation conflict codes.
- `pnpm --filter @workhub/api exec node --import tsx --test src/workitems.test.ts` passed: 10 tests covering deliverable preview/download, missing storage files, malformed JSON, restore conflicts, UUID guards, and evidence mutation gates.
- Red-first checks were observed for: provider model fallback (`deepseek-v4-flash` vs `deepseek-v4-pro`), Drive upload cleanup ownership (`ENOENT` after service refresh failure), service-level pre-commit upload cleanup (file remained), Drive current-version backfill guard, accepted-deliverable missing-file code (`http_error`), unsupported-preview code (`http_error`), WorkItem malformed JSON (`bad_request`), and shared-parser route sweep failures where auth, client-device, notification preferences, knowledge search, project bootstrap, and session creation initially returned route-local `bad_request` instead of `malformed_json`.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts src/approvals.test.ts src/audit.test.ts src/gold-path.test.ts src/projects.test.ts src/notifications-routes.test.ts src/pilot-routes.test.ts` passed after service-error-code preservation across the touched API routes.
- `pnpm --filter @workhub/api typecheck` passed after the latest API error-handler changes.
- `pnpm --filter @workhub/api test` passed after the latest API error-handler changes: 468 tests.
- `git diff --check -- apps/api/src/app.ts apps/api/src/routes/agent-runs.ts apps/api/src/routes/permissions.ts apps/api/src/routes/audit.ts apps/api/src/routes/pages.ts apps/api/src/routes/projects.ts apps/api/src/routes/notifications.ts apps/api/src/routes/pilot.ts apps/api/src/agent-runs.test.ts apps/api/src/approvals.test.ts apps/api/src/audit.test.ts apps/api/src/gold-path.test.ts apps/api/src/projects.test.ts apps/api/src/notifications-routes.test.ts apps/api/src/pilot-routes.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "preserves work item service error codes|preserves work item service error codes before queueing|work item page route preserves" src/agent-runs.test.ts src/approvals.test.ts src/audit.test.ts src/gold-path.test.ts` failed red first with `http_error`, then passed after AgentRun/Permission/Audit/Page WorkItem routes preserved service error codes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "drive page route preserves drive service error codes" src/gold-path.test.ts` failed red first with `http_error`, then passed after page aggregate routes returned service-code envelopes for Drive and related page services.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "preserves project service error codes|genuinely-missing notification|pilot day1 metrics route preserves service error codes" src/projects.test.ts src/notifications-routes.test.ts src/pilot-routes.test.ts` failed red first with `http_error`, then passed after Project/Notification/Pilot routes preserved service-specific error codes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "session route preserves AI clarification service error codes" src/gold-path.test.ts` failed red first with `http_error`, then passed after the session route stopped wrapping `WorkItemServiceError`.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "accepted deliverable restore reports version conflicts" src/workitems.test.ts` failed red first with `http_error`, then passed after WorkItem routes preserved business error codes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "knowledge search route preserves" src/knowledge.test.ts` failed red first with `http_error`, then passed after Knowledge routes preserved WorkItem service error codes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/knowledge.test.ts src/workitems.test.ts src/gold-path.test.ts` passed after route error-code preservation.
- `pnpm --filter @workhub/api test` passed after the AI-clarification workspace attribution and route error-code preservation changes: 461 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "persistent intake passes the actor workspace" src/work-items-service.test.ts` failed red first with missing `workspaceId`, then passed after WorkItem clarification forwarded the actor workspace to the provider registry.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "AI clarification|session clarification|persistent intake" src/gold-path.test.ts src/work-items-service.test.ts` passed: 12 tests covering material-grounded AI clarification, generic-template rejection, file-context failure, and workspace-attributed clarification provider calls.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "cost dashboard page uses the actor workspace" src/cost.test.ts` failed red first with default workspace `00000000-0000-4000-8000-000000000002`, then passed after `/api/pages/cost` began deriving settings from the actor workspace.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "cost dashboard page scopes admin ledger totals" src/cost.test.ts` failed red first with cross-workspace total `3.5` vs expected `1.5`, then passed after admin dashboard ledger reads became actor-workspace scoped.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/cost.test.ts` passed after preserving admin cost breakdowns under workspace-scoped ledger reads.
- `pnpm --filter @workhub/cost test` passed after the workspace ledger reader change.
- `pnpm --filter @workhub/db typecheck` passed after the DB cost-ledger workspace reader change.
- `pnpm --filter @workhub/api test` passed after the workspace-scoped admin cost dashboard change: 458 tests.
- `pnpm --filter @workhub/db test` passed after the workspace-scoped admin cost dashboard change: 42 tests.
- `git diff --check -- apps/api/src/auth.test.ts apps/api/src/routes/auth.ts apps/api/src/cost.test.ts apps/api/src/routes/pages.ts packages/cost/src/ledger.ts packages/db/src/repositories/cost-ledger.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/auth.test.ts` passed after the user-deactivation cleanup false-failure fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/cost.test.ts` passed after the cost dashboard actor-workspace fix.
- `pnpm --filter @workhub/api typecheck` passed after the latest auth/cost backend fixes.
- `pnpm --filter @workhub/api test` passed after the latest auth/cost backend fixes: 457 tests.
- `git diff --check -- apps/api/src/auth.test.ts apps/api/src/routes/auth.ts apps/api/src/cost.test.ts apps/api/src/routes/pages.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.
- `pnpm --filter @workhub/api test` passed: 455 tests.
- `pnpm --filter @workhub/db test` passed: 42 tests.
- `pnpm --filter @workhub/contracts test` passed: 45 tests.
- `pnpm --filter @workhub/cost test` passed: 22 tests.
- `pnpm --filter @workhub/agent test -- src/providers/providers.test.ts` passed: 57 tests.
- `pnpm --filter @workhub/api test` passed: 454 tests.
- `pnpm --filter @workhub/api test` passed: 453 tests.
- `pnpm --filter @workhub/api test` passed: 452 tests.
- `pnpm --filter @workhub/api test` passed: 447 tests.
- `pnpm --filter @workhub/db test` passed: 42 tests.
- `pnpm --filter @workhub/contracts test` passed: 45 tests.
- `pnpm --filter @workhub/cost test` passed: 22 tests.
- `git diff --check -- apps/api/src/notifications.test.ts apps/api/src/services/notifications.ts apps/api/src/approvals.test.ts apps/api/src/routes/permissions.ts apps/api/src/schedule-notify-pages.test.ts apps/api/src/services/schedule-notify-pages.ts apps/api/src/agent-runs.test.ts apps/api/src/services/human-reserved-guard.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.
- `pnpm --filter @workhub/api test` passed: 445 tests.
- `pnpm --filter @workhub/api test` passed: 443 tests.
- `pnpm --filter @workhub/db test` passed: 42 tests.
- `pnpm --filter @workhub/contracts test` passed: 45 tests.
- `git diff --check -- apps/api/src/cost.test.ts apps/api/src/routes/cost.ts apps/api/src/drive-pages.test.ts apps/api/src/services/drive-pages.ts apps/api/src/meeting-pages.test.ts apps/api/src/services/meeting-pages.ts apps/api/src/project-home-pages.test.ts apps/api/src/services/project-home-pages.ts packages/db/src/repositories/meetings.ts packages/contracts/src/pages.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "post-write publish fails" src/notifications.test.ts` failed red first, then passed after notification publish failures became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/notifications.test.ts` passed after the notification publish failure fix.
- `pnpm --filter @workhub/api typecheck` passed after the notification publish failure fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "readable work item before unrelated body schema errors" src/approvals.test.ts` failed red first with 422 vs 403, then passed after permission ask added a narrow WorkItem visibility precheck.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "readable work item before unrelated body schema errors|permission ask route rejects approvals" src/approvals.test.ts` passed after the permission ask precheck.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/approvals.test.ts` passed after the permission ask precheck.
- `pnpm --filter @workhub/api typecheck` passed after the permission ask precheck.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "schedule notify page actions return committed" src/schedule-notify-pages.test.ts` failed red first, then passed after schedule notification audits became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/schedule-notify-pages.test.ts` passed after the schedule notification audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the schedule notification audit fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "human-reserved guard returns the committed escalation" src/agent-runs.test.ts` failed red first, then passed after human-reserved audit/publish failures became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "human-reserved guard returns the committed escalation|agent run enqueue opens user_forbidden|human-reserved guard does not re-mark" src/agent-runs.test.ts` passed after the human-reserved guard fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts` passed after the human-reserved guard fix.
- `pnpm --filter @workhub/api typecheck` passed after the human-reserved guard fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "committed skill promotion|committed skill refinement" src/skill-curation.test.ts` failed red first, then passed after skill-curation audit failures became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/skill-curation.test.ts` passed after the skill-curation audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the skill-curation audit fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "confidence recorder returns committed decisions" src/agent-runs.test.ts` failed red first with `audit sink unavailable`, then passed after AgentRun confidence audits became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts` passed after the AgentRun confidence audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the AgentRun confidence audit fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "recovered claims when recovery audit logging fails" src/agent-runs.test.ts` failed red first with `audit sink unavailable`, then passed after stale-claim recovery audits became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts` passed after the stale-claim recovery audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the stale-claim recovery audit fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "permission policy writes return committed rows" src/approvals.test.ts` failed red first with `audit sink unavailable`, then passed after permission-policy audits became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/approvals.test.ts` passed after the permission-policy audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the permission-policy audit fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "expireDueApprovals returns committed expirations" src/approvals.test.ts` failed red first with `audit sink unavailable`, then passed after approval-expiration audits became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/approvals.test.ts` passed after the approval-expiration audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the approval-expiration audit fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "snapshot hook returns the committed snapshot" src/agent-runs.test.ts` failed red first with `audit sink unavailable`, then passed after AgentRun snapshot audits became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts` passed after the AgentRun snapshot audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the AgentRun snapshot audit fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "post-restore audit logging fails" src/audit.test.ts` failed red first with `audit sink unavailable`, then passed after snapshot-revert audits became warning-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/audit.test.ts` passed after the snapshot-revert audit fix.
- `pnpm --filter @workhub/api typecheck` passed after the snapshot-revert audit fix.
- `pnpm --filter @workhub/api test` passed: 430 tests.
- `pnpm --filter @workhub/db test` passed: 42 tests.
- `pnpm --filter @workhub/cost test` passed: 22 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 8 tests, including runtime route/OpenAPI lockstep.
- `pnpm --filter @workhub/db exec node --import tsx --test src/drive-path.test.ts` passed: 10 tests.
- `pnpm --filter @workhub/db typecheck` passed.
- `pnpm --filter @workhub/db test` passed: 42 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` passed: 14 tests, including generic-template rejection for persistent AI clarification.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts` passed: 19 tests, including material-grounded clarification from project files, template rejection, and file-context failure handling.
- `pnpm --filter @workhub/agent test -- src/providers/providers.test.ts` passed: 57 tests, including DeepSeek anthropic-compatible transport, retry/timeout handling, routed model usage, and secret-free usage records.
- `pnpm --filter @workhub/agent typecheck` passed.
- `pnpm --filter @workhub/contracts test` passed: 45 tests.
- `pnpm --filter @workhub/contracts typecheck` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed: 35 tests.
- `pnpm --filter @workhub/api test` passed: 419 tests.
- `pnpm --filter @workhub/api typecheck` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts src/workitems.test.ts src/drive-pages.test.ts` passed: 57 tests.
- `pnpm --filter @workhub/api test` passed: 418 tests.
- `pnpm --filter @workhub/api typecheck` passed.
- `pnpm --filter @workhub/db typecheck` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test src/project-home-pages.test.ts` passed: 11 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 42 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` passed: 14 tests.
- `pnpm --filter @workhub/contracts typecheck` passed.
- `pnpm --filter @workhub/contracts test` passed: 45 tests.
- `pnpm --filter @workhub/permissions test` passed: 13 tests.
- `pnpm --filter @workhub/cost test` passed: 22 tests.
- `pnpm --filter @workhub/agent test -- src/providers/providers.test.ts` passed: 57 tests.
- `pnpm --filter @workhub/contracts test` passed: 45 tests.
- `pnpm --filter @workhub/db test` passed: 39 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/cost.test.ts` passed: 10 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts` passed: 57 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/meeting-pages.test.ts` passed: 10 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 33 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 41 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts src/cost.test.ts src/auth.test.ts` passed: 79 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/cost.test.ts src/approvals.test.ts` passed: 45 tests.
- `pnpm --filter @workhub/db exec node --import tsx --test src/budget-policies.test.ts` passed: 2 tests.
- `pnpm --filter @workhub/cost test` passed: 22 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts` passed: 6 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts --test-name-pattern "agent run abort releases reserved budget immediately|agent run abort propagates an AbortSignal"` passed: 44 tests in the file.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts --test-name-pattern "agent run abort does not overwrite a run that settled during cancellation"` passed: 45 tests in the file.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts --test-name-pattern "agent run enqueue requires mutation access before parsing the start body"` passed: 46 tests in the file.
- `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts --test-name-pattern "proposal routes require mutation access before reviewing or merging readable work"` passed: 33 tests in the file.
- `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts --test-name-pattern "session next-question checks mutation access before parsing the answer body"` passed: 20 tests in the file.
- `pnpm --filter @workhub/api exec node --import tsx --test src/workitems.test.ts --test-name-pattern "evidence binding checks mutation access before parsing the body"` passed: 9 tests in the file.
- `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts src/proposals.test.ts src/gold-path.test.ts src/workitems.test.ts src/notifications.test.ts` passed: 113 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/drive-pages.test.ts` passed: 36 tests, including delete access-before-body parsing.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "backing work item|work item access is unavailable" src/agent-runs.test.ts src/push.test.ts` failed red first with 403 vs 200, then passed after the AgentRun/Push WorkItem-visibility fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts src/push.test.ts` passed.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts src/push.test.ts src/work-items-service.test.ts` passed.
- `pnpm --filter @workhub/api typecheck` passed.
- `pnpm --filter @workhub/api test` passed: 432 tests.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "approval comment mention skips|approval comment audit failure" src/approvals.test.ts` failed red first, then passed after the approval comment mention/audit fixes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/approvals.test.ts` passed.
- `pnpm --filter @workhub/api typecheck` passed after the approval comment fixes.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "startup provider errors" src/agent-runs.test.ts` failed red first, then passed after startup initialization moved under the AgentRun failure/finally boundary.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts` passed.
- `pnpm --filter @workhub/api typecheck` passed after the AgentRun startup fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "snapshot audit logs use the run tenant" src/agent-runs.test.ts` failed red first, then passed after AgentRun snapshot audits began using run tenant ids.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts` passed after the snapshot tenant fix.
- `pnpm --filter @workhub/api typecheck` passed after the snapshot tenant fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "replay merge timeline only includes" src/agent-runs.test.ts` failed red first, then passed after replay timelines filtered by proposal source AgentRun.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts` passed after the replay timeline fix.
- `pnpm --filter @workhub/api typecheck` passed after the replay timeline fix.
- `pnpm --filter @workhub/db typecheck` passed after the proposal provenance query change.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "admin actor workspace" src/cost.test.ts` failed red first, then passed after cost routes used actor-tenant settings.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/cost.test.ts` passed after the cost route tenant fix.
- `pnpm --filter @workhub/cost test` passed after the cost route tenant fix.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "hides draft, proposal, and accepted-deliverable links|hides draft and proposal links" src/drive-pages.test.ts src/meeting-pages.test.ts` failed red first, then passed after Drive/Meeting page links were filtered by backing WorkItem visibility.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "older deep-linked meeting" src/meeting-pages.test.ts` failed red first, then passed after Meeting insight mutations gained direct insight-context authorization.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "restore links when the actor can read" src/drive-pages.test.ts` failed red first, then passed after accepted-deliverable restore links required mutation capability.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/drive-pages.test.ts src/meeting-pages.test.ts` passed after the Drive/Meeting page-link fixes.
- `pnpm --filter @workhub/db typecheck` passed after the Meeting repository insight-context extension.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "cross-workspace admin" src/project-home-pages.test.ts` failed red first, then passed after cross-workspace project-home admin views became read-only.
- `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/project-home-pages.test.ts` passed after the project-home read-only action fix.
- `pnpm --filter @workhub/contracts test` passed after making project-home `new_task` optional.
- `pnpm --filter @workhub/contracts typecheck` passed after making project-home `new_task` optional.
- `pnpm --filter @workhub/api typecheck` passed after the Drive/Meeting/Project-home fixes.
- `pnpm --filter @workhub/db typecheck` passed.
- `pnpm --filter @workhub/cost build` passed.
- `git diff --check -- apps/api/src/cost.test.ts apps/api/src/qa/r1-pg-agent-run-smoke.ts apps/api/src/approvals.test.ts apps/api/src/services/approvals.ts packages/db/src/repositories/budget-policies.ts packages/db/src/budget-policies.test.ts packages/cost/src packages/db/src/repositories/cost-ledger.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-06-30 Backend Continuation - Drive recycle-bin current-version metadata

- User-visible finding: recycle-bin files could lose current-version fidelity in the Drive page VM. The service rendered deleted files from `deletedItems`, but the version `current` flag was computed only from active `items`; the repository also only backfilled missing current versions from active items. In the real Drive UI/API this can make a deleted file look like it has stale or incomplete file metadata while the user is deciding whether to restore it.
- Fix: `packages/db/src/repositories/drive.ts` now backfills missing current versions from `items + deletedItems`; `apps/api/src/services/drive-pages.ts` now computes the current-version map from the same combined item set used for page paths.
- Regression tests added:
  - `apps/api/src/drive-pages.test.ts`: recycle-bin file VM keeps `current_version`, `size_bytes`, and `current: true`.
  - `packages/db/src/drive-path.test.ts`: `readPage` must include `deletedItems` when backfilling current versions.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts --test-name-pattern "recycle-bin file current-version"` failed first with `false !== true`, then passed after the service fix.
  - `pnpm --filter @workhub/db exec node --import tsx --test src/drive-path.test.ts --test-name-pattern "recycle-bin file items"` failed first because `deletedItems` were not included in the backfill source, then passed after the repository fix.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts --test-name-pattern "recycle-bin file current-version"` passed: 42 tests in the file.
  - `pnpm --filter @workhub/db exec node --import tsx --test src/drive-path.test.ts --test-name-pattern "current versions"` passed: 13 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api test` passed: 488 tests.
  - `pnpm --filter @workhub/db test` passed: 45 tests.

### 2026-06-30 Backend Continuation - Intake stale template cache invalidation

- User-visible finding: after the clarification UI was changed away from preset templates, an existing `clarification_question` chat message could still contain the old preset question and be returned before the AI/file-context generator ran. This explains a "still looks templated" experience even when the new generator code is present.
- Fix: `apps/api/src/services/work-items.ts` now validates stored clarification questions with the same template detector used for fresh AI output. Material-grounded stored questions are reused; stale generic/preset questions are ignored and regenerated from the current work item, actor, and project file context. The same guard was applied to the in-memory session path for QA/desktop harness consistency.
- Regression test added:
  - `apps/api/src/work-items-service.test.ts`: `persistent intake ignores stale stored generic clarification templates and regenerates`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "stale stored generic"` failed first with `0 !== 1` because the clarification generator was never called, then passed after stale-template invalidation.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "stale stored generic"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` passed: 20 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts --test-name-pattern "AI clarification|session clarification|next-question"` passed: 25 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api test` passed: 489 tests.

### 2026-06-30 Backend Continuation - Intake explicit-file cache invalidation

- User-visible finding: a stored clarification question that was not an obvious preset template could still be stale. If it mentioned the general task, such as "生成三条验收要点", but did not mention the user's explicitly named Drive file (`workhub-app-upload.txt`), the session reused it and skipped project-file context loading. Users could therefore still see a non-material-based follow-up after the file was synced or after a previous generic question had been stored.
- Fix: `apps/api/src/services/work-items.ts` now reuses stored clarification questions only when they are not templated and they cover every explicitly named Drive filename from the current intent/title. Otherwise the service reloads project-file context and regenerates the AI clarification. The same stored-draft reuse rule is applied to the in-memory QA/desktop path.
- Regression test added:
  - `apps/api/src/work-items-service.test.ts`: `persistent intake regenerates stored clarification that misses an explicitly named file`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "persistent intake regenerates stored clarification that misses an explicitly named file"` failed first with `0 !== 1` because the generator was not called, then passed after the named-file coverage guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts --test-name-pattern "persistent intake regenerates stored clarification that misses an explicitly named file"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts --test-name-pattern "AI clarification|session clarification|next-question"` passed: 25 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api test` passed: 490 tests.
  - `git diff --check -- apps/api/src/services/work-items.ts apps/api/src/work-items-service.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-06-30 Backend Continuation - Project Home recent accepted-deliverable files

- User-visible finding: the Project Home Drive summary could show an accepted-deliverable recent file even when the viewer could not open its backing WorkItem. The full Drive page and direct file reads already stripped/blocked unreadable accepted-deliverables, but the GitHub-like project overview still advertised the file card, creating a dead-entry mismatch.
- Additional contract finding: making `actions.new_task` optional for cross-workspace read-only project views made `@workhub/ui` fail typecheck, because the existing project-home renderer still treats the action as required. Since frontend/client files are frozen, the backend contract now keeps the action required and points read-only cross-workspace VMs to generic `/intake` instead of `/intake?project_id=...`; desktop-specific click binding still needs frontend QA once the freeze lifts.
- Fix: `packages/db/src/repositories/drive.ts` now annotates recent project files with active accepted-deliverable backing WorkItem ids. `apps/api/src/services/project-home-pages.ts` filters those recent-file cards through the same WorkItem visibility gate used by detail pages while keeping `drive.file_count` as the real project Drive total. Project Home now asks for 200 recent files, the DB repository allows up to 500, and the service only slices to five after visibility filtering.
- Regression tests added:
  - `apps/api/src/project-home-pages.test.ts`: `project home hides recent accepted-deliverable files the viewer cannot open`.
  - `apps/api/src/project-home-pages.test.ts`: `project home scans past unreadable accepted-deliverable recent files`.
  - `packages/db/src/drive-path.test.ts`: source-level guard that `listRecentFilesByProject` carries accepted-deliverable WorkItem ids.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/project-home-pages.test.ts --test-name-pattern "recent accepted-deliverable"` failed first because both the unreadable accepted file and the manual file were returned, then passed after Project Home filtered accepted file cards through backing WorkItem access.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/project-home-pages.test.ts --test-name-pattern "scans past unreadable accepted"` failed first with an empty recent-file list because the first 50 unreadable accepted files consumed the scan window, then passed after Project Home scanned beyond that window and sliced to five only after visibility filtering.
  - `pnpm --filter @workhub/ui typecheck` failed first with `vm.actions.new_task is possibly undefined`, then passed after the Project Home VM contract restored required `new_task` and the service returned a generic intake action for read-only cross-workspace views.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/project-home-pages.test.ts` passed: 15 tests.
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=dot src/drive-path.test.ts` passed: 14 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm --filter @workhub/contracts test` passed: 45 tests.
  - `pnpm --filter @workhub/contracts typecheck` passed.
  - `pnpm --filter @workhub/ui typecheck` passed.
  - `pnpm --filter @workhub/ui exec node --import tsx --test --test-reporter=dot src/gold-path/route-components.test.ts` passed.
  - `pnpm --filter @workhub/web typecheck` passed.
  - `pnpm --filter @workhub/web exec node --import tsx --test --test-reporter=dot src/routes.test.ts` passed.
  - `pnpm --filter @workhub/desktop-webview typecheck` passed.
  - `pnpm --filter @workhub/desktop-webview exec node --import tsx --test --test-reporter=dot src/spotlight/views/dashboards.test.ts` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed: 498 tests.
  - `pnpm --filter @workhub/db test` passed: 46 tests.
  - `git diff --check -- apps/api/src/services/project-home-pages.ts apps/api/src/project-home-pages.test.ts packages/contracts/src/pages.ts packages/db/src/repositories/drive.ts packages/db/src/drive-path.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-06-30 Backend Continuation - OpenAPI and Drive file-chain contracts

- User-visible finding: Project Home could show `open_work_item_count > 0` while still setting `empty_state: "no_open_work"` if the scanned open-work slice was consumed by hidden private drafts. The user-facing page now avoids that contradictory empty state.
- User-visible finding: Project Home recent Drive cards could still disappear when the newest 50 files were unreadable accepted-deliverables and an older readable file existed. The service now scans deeper before slicing visible recent files.
- Contract finding: OpenAPI listed Drive/Project routes but omitted the runtime path/query parameters and documented JSON upload fields (`size_bytes`, `sha256`) that the server recomputes rather than honors. It also omitted the Drive delete optimistic-concurrency body.
- Contract finding: after the targeted Drive/Project fix, 50 other templated OpenAPI operations still lacked required path parameters, which would leave generated clients without method arguments for `{id}`, `{projectId}`, `{acceptedChangeId}`, `{scope}`, and similar path variables.
- Contract finding: `/api/pages/drive` and `/api/pages/project/{id}` returned rich page VM envelopes at runtime, but OpenAPI had no 200 response schema. Generated clients therefore knew the path existed but not the `ok/data/meta` envelope or the core Project/Drive page fields.
- Contract finding: Drive upload/delete/restore mutations also return refreshed Drive Page VM envelopes at runtime, but OpenAPI omitted those 200 response schemas, leaving generated clients blind to the post-mutation page refresh payload.
- Contract finding: Drive preview/download runtime routes had concrete response behavior (`{ ok, data }` text preview and binary download headers), but OpenAPI only had summaries. Generated clients therefore lacked the inline-preview and file-download response contracts for core web-disk flows.
- Contract finding: WorkItem accepted-deliverable preview/download/restore runtime routes had concrete response behavior, but OpenAPI only had summaries. Generated clients could see the routes existed but could not type safe formal-deliverable download, preview, or restore flows.
- Contract finding: Notification center routes for list, mute preferences, mark-read, mark-all-read, dismiss, and complete had concrete runtime JSON payloads, but OpenAPI only had summaries. Generated clients could not type the notification page's core buttons or preferences form from the contract.
- Contract finding: Project list and project bootstrap are the GitHub-like project hub entrypoints, but OpenAPI documented only the bootstrap request body and route summaries. Generated clients could not type project cards, open-work counts, or the 200/201 bootstrap result.
- Contract finding: Drive comment-to-draft and Drive/Meeting draft-to-proposal runtime actions return refreshed Drive/Meeting page or WorkItem detail envelopes, while Meeting insight routes also require UUID path parameters. OpenAPI had only summaries or auto-inferred plain-string parameters, leaving generated clients blind to the next-screen payload and weakly typed Meeting action inputs.
- Contract finding: Proposal review, merge, rebase, conflict-list, AI-fusion choose/apply, and create/list/read routes are the core GitHub-like project-management loop, but OpenAPI still had only route summaries and auto-inferred plain-string ids. Generated clients could not type the review form, merge conflict cards, 201 create response, or the merged/audit event result.
- Contract finding: task intake/session, evidence binding, AgentRun start/live/trace/handoff/replay/revert are the core "AI does the work" chain, but OpenAPI still exposed several of these runtime routes as summary-only operations. Generated clients could not type the clarification card, 201 WorkItem creation, 202 AgentRun enqueue, trace polling, replay page, or snapshot revert result.
- Contract finding: Approval and permission routes were still summary-only despite driving real user decisions: generated clients could not type approval cards, approve/deny payloads, delegate targets, comment threads, admin permission-policy CRUD, or `/api/permissions/ask` result states.
- Contract finding: permission-policy HTTP responses leaked internal DB camelCase (`scopeKind`, `actionPattern`, `learnedFromSession`) while public requests and shared contracts use snake_case, and the DB repository dropped `createdAt`/`updatedAt` even though the table stores them. Generated clients would see a response shape different from the governance contract.
- User-visible finding: direct Drive download/preview access for an accepted-deliverable file checked "any accepted version on this item" rather than the current Drive version. A readable older accepted version could unlock a newer private current version.
- User-visible finding: Drive JSON upload filenames of `.` / `..` could collapse materialized storage to a directory path instead of a safe leaf filename.
- User-visible finding: accepted-deliverable previews were narrower than Drive previews, so text-like AI deliverables such as `acceptance.yaml` could appear without a usable preview path or return 415.
- Repository finding: `readPage({ includeDeleted, targetItemId })` could not hydrate a deleted target item into the recycle-bin slice because target hydration only selected active rows. Delete refreshes now have the repository support needed to show an immediate restore row.
- Fixes:
  - `apps/api/src/services/project-home-pages.ts` now suppresses `no_open_work` based on the real visible count, asks for 200 recent files, and still slices only visible recent cards to five.
  - `packages/db/src/repositories/drive.ts` allows recent-file scans up to 500 and hydrates deleted target items into `deletedItems` while only adding non-deleted target-chain rows to active `items`.
  - `apps/api/src/openapi.ts` now documents Drive/Project path/query parameters, removes non-runtime JSON upload fields, marks `parsed_text` nonblank, and documents `expected_current_version_id` for Drive delete.
  - `apps/api/src/openapi.ts` now auto-fills any missing required path parameters from the path template while preserving hand-written schemas, so specific Drive/Project UUID parameters remain precise and the rest of the API still gets usable generated-client inputs.
  - `apps/api/src/openapi.ts` now adds page VM response schemas for Drive and Project Home, documenting the runtime envelope plus the core summary/actions/file-list fields without trying to duplicate every nested renderer detail.
  - `apps/api/src/openapi.ts` now reuses the Drive Page VM response schema for Drive upload/delete/restore mutations.
  - `apps/api/src/openapi.ts` now documents Drive download as binary `application/octet-stream` with `Content-Disposition`/`Content-Length` headers, and Drive preview as a text-preview JSON payload with `download_href`.
  - `apps/api/src/openapi.ts` now documents WorkItem accepted-deliverable download as binary file bytes, preview as a text-preview JSON payload, and restore as `{ ok, data: { accepted_deliverable } }`, with explicit UUID path parameters.
  - `apps/api/src/openapi.ts` now documents Notification list/preference/action responses, the notification preference request body, and UUID path parameters for single-notification actions.
  - `apps/api/src/openapi.ts` now documents Project list responses and Project bootstrap 200/201 responses, including project card fields, open-work counts, and the `context_ready` bootstrap flag.
	  - `apps/api/src/openapi.ts` now documents Drive comment-to-draft as a refreshed Drive Page VM, Drive/Meeting draft-to-proposal as a WorkItem detail VM, and Meeting insight draft/dismiss as refreshed Meeting Page VMs with explicit UUID path parameters.
	  - `apps/api/src/openapi.ts` now documents proposal create/list/read/review/merge/rebase/conflict/AI-fusion choose/apply request and response contracts, with UUID path parameters and 201 create semantics matching runtime.
	  - `apps/api/src/openapi.ts` now documents session responses, WorkItem create/evidence-binding detail envelopes, AgentRun live/trace/handoff/replay/revert contracts, and the non-200 201/202 statuses used by the runtime execution chain.
	  - `apps/api/src/openapi.ts` now documents approval center/decision/delegation/comment contracts and permission policy list/create/revoke plus ask-result contracts, matching current runtime envelopes.
	  - `apps/api/src/routes/permissions.ts`, `apps/api/src/routes/approvals.ts`, and `apps/api/src/services/approvals.ts` now normalize permission-policy records at the HTTP boundary, keeping internal permission evaluation camelCase while returning public `scope_kind`, `action_pattern`, `learned_from_session`, `created_at`, and `updated_at` fields.
	  - `packages/db/src/repositories/permission-policies.ts` now preserves permission-policy `createdAt` and `updatedAt` from the database row instead of discarding timestamps before the API response layer.
	  - `apps/api/src/services/drive-pages.ts` now checks accepted-deliverable direct file access against the current Drive version id.
  - `apps/api/src/routes/drive.ts` now normalizes `.` / `..` filenames to `upload.bin`.
  - `apps/api/src/services/accepted-deliverables.ts` and `apps/api/src/routes/workitems.ts` now share the broader text-like preview set for YAML/XML/HTML/TSV.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/project-home-pages.test.ts` failed first on the 50-unreadable-recent-file scan and scan-window empty-state cases, then passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` failed first on missing OpenAPI parameters and stale Drive upload fields, then passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first on 50 remaining templated OpenAPI paths without required path parameters, then passed after path-template inference.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because Drive/Project page response schemas were missing, then passed after adding the VM envelope schemas.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because Drive mutation response schemas were missing, then passed after documenting the refreshed Drive Page VM envelope.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because Drive preview/download responses were missing, then passed after documenting the binary and text-preview contracts.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because WorkItem accepted-deliverable download/preview/restore responses were missing, then passed after documenting those file and restore contracts.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because Notification list/preference/action response schemas were missing, then passed after documenting those JSON contracts.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because Project list/bootstrap response schemas were missing, then passed after documenting those project-management contracts.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because Meeting action parameters were auto-inferred as plain strings and Drive/Meeting draft action response schemas were missing, then passed after documenting UUID parameters and refreshed page/detail envelopes.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` then failed first because proposal path ids were auto-inferred as plain strings and proposal create/review/merge/conflict response schemas were missing, then passed after documenting those project-management contracts.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot --test-name-pattern "Task intake and AgentRun OpenAPI responses" src/app.test.ts` failed first because `POST /api/sessions` lacked a response envelope, then passed after documenting the full intake/execution/replay contract chain.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot --test-name-pattern "Approval and permission OpenAPI contracts" src/app.test.ts` failed first because `GET /api/approvals` lacked a response envelope, then passed after documenting approval/permission request and response contracts.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "snake_case API records" src/approvals.test.ts` failed first because permission-policy responses exposed camelCase fields and then failed again on missing timestamps, then passed after route response normalization and repository timestamp preservation.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Approval and permission OpenAPI" src/app.test.ts` failed first because permission-policy response schemas still required camelCase fields, then failed again on missing `created_at`/`updated_at`, then passed after the OpenAPI schema matched the public snake_case response shape.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/drive-pages.test.ts` failed first on current-version direct-read authorization and dot-segment filename normalization, then passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/accepted-deliverables.test.ts src/workitems.test.ts` failed first on YAML preview link/route support, then passed.
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=dot src/drive-path.test.ts` failed first on the missing deleted-target hydrate guard, then passed.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/project-home-pages.test.ts` passed: 16 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed: 13 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after the global path-parameter guard: 14 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after page VM response schemas: 15 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after Drive mutation response schemas: 16 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after Drive preview/download response schemas: 17 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after WorkItem accepted-deliverable response schemas: 18 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after Notification response schemas: 19 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after Project list/bootstrap response schemas: 20 tests.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after Drive/Meeting draft action response schemas: 21 tests.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after Proposal project-management response schemas: 22 tests.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after task intake and AgentRun response schemas: 23 tests.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts` passed after approval/permission response schemas: 24 tests.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "snake_case API records" src/approvals.test.ts` passed after permission-policy route responses normalized to snake_case and included timestamps.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Approval and permission OpenAPI" src/app.test.ts` passed after permission-policy OpenAPI response schemas normalized to snake_case and included timestamps.
	  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed after permission-policy response normalization: 42 tests.
	  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed after permission-policy OpenAPI normalization: 24 tests.
	  - `pnpm --filter @workhub/api typecheck` passed after the API response mapper and permission-policy timestamp type changes.
	  - `pnpm --filter @workhub/db typecheck` passed after permission-policy records preserved `createdAt`/`updatedAt`.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/drive-pages.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/accepted-deliverables.test.ts src/workitems.test.ts` passed: 12 tests.
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=dot src/drive-path.test.ts` passed: 15 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after path-parameter inference.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after page VM response schemas.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after Drive mutation response schemas.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after Drive preview/download response schemas.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after WorkItem accepted-deliverable response schemas.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after Notification response schemas.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after Project list/bootstrap response schemas.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after Drive/Meeting draft action response schemas.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after Proposal project-management response schemas.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after task intake and AgentRun response schemas.
	  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after approval/permission response schemas.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed again after permission-policy response normalization.
	  - `pnpm --filter @workhub/api typecheck` passed.
	  - `pnpm --filter @workhub/db test` passed: 47 tests.
	  - `pnpm --filter @workhub/db typecheck` passed.
	  - `git diff --check -- apps/api/src/approvals.test.ts apps/api/src/app.test.ts apps/api/src/routes/permissions.ts apps/api/src/routes/approvals.ts apps/api/src/services/approvals.ts apps/api/src/openapi.ts packages/db/src/repositories/permission-policies.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed after permission-policy response normalization.
	  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts apps/api/src/project-home-pages.test.ts apps/api/src/services/project-home-pages.ts apps/api/src/drive-pages.test.ts apps/api/src/services/drive-pages.ts apps/api/src/routes/drive.ts apps/api/src/services/accepted-deliverables.ts apps/api/src/accepted-deliverables.test.ts apps/api/src/routes/workitems.ts apps/api/src/workitems.test.ts packages/db/src/repositories/drive.ts packages/db/src/drive-path.test.ts` passed.

### 2026-06-30 Backend Continuation - Knowledge search unreadable WorkItem context

- User-visible finding: `POST /api/knowledge/search` parsed the whole request before checking a provided `work_item_id`. If a user opened knowledge search from an unreadable/private WorkItem and another field was malformed, the UI would receive a generic validation error instead of the real "you cannot access this item" state.
- Fix: `apps/api/src/routes/knowledge.ts` now reads the raw JSON once, prechecks a nonblank string `work_item_id` through `WorkItemService.detailPage`, and only then parses the knowledge search schema and calls `searchKnowledge`.
- Regression test added:
  - `apps/api/src/knowledge.test.ts`: `knowledge search checks work item access before unrelated schema errors`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "knowledge search checks work item access" src/knowledge.test.ts` failed first with `422 !== 403`, then passed after the route prechecked WorkItem visibility before schema parsing.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "knowledge search checks work item access" src/knowledge.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/knowledge.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/knowledge.test.ts src/work-items-service.test.ts` passed: 30 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.
  - `git diff --check -- apps/api/src/routes/knowledge.ts apps/api/src/knowledge.test.ts apps/api/src/services/work-items.ts apps/api/src/work-items-service.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-06-30 Backend Continuation - Session create/resume mutation gate

- User-visible finding: `POST /api/sessions` already enforced mutation access inside the WorkItem service when resuming from `work_item_id`, but the route parsed the full request first. A read-only user resuming a valid WorkItem with an unrelated malformed field could see a generic validation error rather than the correct "cannot modify this item" state.
- Fix: `apps/api/src/routes/sessions.ts` now reads the raw body once, prechecks a valid UUID `work_item_id` with `WorkItemService.assertCanMutateWorkItem`, and only then parses `createSessionRequestSchema` and calls `createSession`.
- Regression test added:
  - `apps/api/src/gold-path.test.ts`: `session create checks work item mutation before unrelated schema errors`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "session create checks work item mutation" src/gold-path.test.ts` failed first with `422 !== 403`, then passed after the route-level mutation gate.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "session create checks work item mutation" src/gold-path.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts` passed: 26 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.
  - `git diff --check -- apps/api/src/routes/sessions.ts apps/api/src/gold-path.test.ts apps/api/src/routes/knowledge.ts apps/api/src/knowledge.test.ts apps/api/src/services/work-items.ts apps/api/src/work-items-service.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-06-30 Backend Continuation - WorkItem finalization mutation gate

- User-visible finding: `POST /api/workitems` already required mutation access in the WorkItem service when finalizing from a `session_id`, but the route parsed the full request first. A read-only viewer submitting a valid session with an unrelated malformed field could see a generic validation error instead of the correct "cannot modify this item" state.
- Fix: `apps/api/src/routes/workitems.ts` now reads the raw body once, prechecks a valid UUID `session_id` with `WorkItemService.assertCanMutateWorkItem`, and only then parses `createWorkItemRequestSchema` and calls `createWorkItem`.
- Regression test added:
  - `apps/api/src/workitems.test.ts`: `work item create checks session mutation before unrelated schema errors`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "work item create checks session mutation" src/workitems.test.ts` failed first with `422 !== 403`, then passed after the route-level mutation gate.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "work item create checks session mutation" src/workitems.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/workitems.test.ts` passed: 12 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/workitems.test.ts src/gold-path.test.ts src/work-items-service.test.ts` passed: 65 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.
  - `git diff --check -- apps/api/src/routes/workitems.ts apps/api/src/workitems.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-06-30 Backend Continuation - Snapshot revert mutation gate

- User-visible finding: `POST /api/agent-runs/:id/revert` parsed the full request before resolving `snapshot_id` and checking the snapshot's WorkItem artifact-mutation permission. A read-only user submitting a valid snapshot with an unrelated invalid field could see a generic validation error instead of the correct "cannot modify deliverables" state.
- Fix: `apps/api/src/routes/audit.ts` now reads the raw body once, prechecks a valid UUID `snapshot_id` by loading the snapshot and running `WorkItemService.assertCanMutateArtifacts`, and only then parses `revertAgentRunRequestSchema`.
- Regression test added:
  - `apps/api/src/audit.test.ts`: `revert route checks snapshot mutation before unrelated schema errors`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "revert route checks snapshot mutation" src/audit.test.ts` failed first with `422 !== 403`, then passed after the route-level snapshot mutation gate.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "revert route checks snapshot mutation" src/audit.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/audit.test.ts` passed: 12 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - Permission, intake, and contract hardening

- User-visible finding: `/api/permissions/ask` returned internal `matchedPolicy` and `consideredPolicies` metadata for allow/deny outcomes. A user only needs the decision result; exposing policy internals makes the approval bubble and API clients depend on implementation details.
- Fix: `apps/api/src/routes/permissions.ts` now maps allow/deny ask results through a public response helper that returns only `outcome` and a minimal `decision` object.
- User-visible finding: approval respond/delegate routes parsed malformed bodies before checking whether the actor was allowed to act on that approval, so unauthorized users could receive schema feedback instead of the correct 403.
- Fix: `apps/api/src/routes/approvals.ts` now reuses the read gate, checks routed-user/admin action ownership, and only then parses respond/delegate bodies.
- User-visible finding: malformed `work_item_id` values in `POST /api/knowledge/search` could reach the WorkItem service path before schema validation, turning a plain bad input into a service/DB failure.
- Fix: `apps/api/src/routes/knowledge.ts` now only runs the WorkItem context precheck for valid UUID strings and otherwise lets the shared request schema return 422.
- Contract finding: permission-policy API responses can legitimately contain nullable metadata for global or legacy policy rows, but the shared governance contract rejected nulls for `created_by_user_id`, `org_id`, `workspace_id`, and `deleted_at`.
- Fix: `packages/contracts/src/domain/governance.ts` now accepts those nullable fields, matching the API response boundary.
- User-visible finding: desktop bootstrap and client-device registration accepted blank device names, creating nameless local devices that would be confusing in settings and device-management views.
- Fix: `packages/contracts/src/auth.ts` now trims and rejects blank `device_name` values for both desktop bootstrap and client-device registration.
- User-visible finding: project bootstrap accepted blank `name` / `slug` values and silently fell back to the default project path, so an empty user input could create or reuse a project different from what the user intended.
- Fix: `packages/contracts/src/domain/project.ts` now trims and rejects blank bootstrap names/slugs before service fallback.
- Regression tests added:
  - `apps/api/src/approvals.test.ts`: `permission ask route redacts matched policy internals from public allow decisions`.
  - `apps/api/src/approvals.test.ts`: `approval respond and delegate check action ownership before body schema`.
  - `apps/api/src/knowledge.test.ts`: `knowledge search validates malformed work item ids before touching the work item service`.
  - `packages/contracts/src/contracts.test.ts`: `permission policy contract accepts nullable API response metadata`.
  - `apps/api/src/auth.test.ts`: `desktop-bootstrap rejects blank device names before creating a device`.
  - `apps/api/src/auth.test.ts`: `client device register rejects blank device names before creating a device`.
  - `apps/api/src/projects.test.ts`: `project bootstrap rejects blank names and slugs before creating a default project`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "permission ask route redacts matched policy" src/approvals.test.ts` failed first because the response still included `actionPattern`, `matchedPolicy`, and `consideredPolicies`, then passed after response redaction.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "approval respond and delegate check action ownership" src/approvals.test.ts` failed first with `422 !== 403`, then passed after the action-ownership precheck moved before body parsing.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "knowledge search validates malformed work item ids" src/knowledge.test.ts` failed first with `500 !== 422`, then passed after malformed UUIDs bypassed the WorkItem context precheck.
  - `pnpm --filter @workhub/contracts exec node --import tsx --test --test-name-pattern "permission policy contract accepts nullable" src/contracts.test.ts` failed first on invalid `null` metadata fields, then passed after the governance schema accepted nullable API metadata.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "blank device names" src/auth.test.ts` failed first with `201 !== 422`, then passed after the auth contracts rejected blank device names.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "project bootstrap rejects blank" src/projects.test.ts` failed first because the project service was reached for blank inputs, then passed after bootstrap name/slug validation.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 45 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/knowledge.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/contracts exec node --import tsx --test src/contracts.test.ts` passed: 35 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts` passed: 61 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/projects.test.ts` passed: 7 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/projects-slug.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/contracts typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - Proposal branch and Drive item error codes

- User-visible finding: `POST /api/workitems/:id/proposals` accepted a caller-supplied `branch_id`, but if that branch already belonged to another WorkItem the DB repository threw a plain invariant error. The user/client would see a server failure instead of an actionable proposal payload problem.
- Fix: `packages/db/src/repositories/proposals.ts` now throws `ProposalRepositoryBranchWorkItemMismatchError`, and `apps/api/src/services/proposals.ts` maps it to `422 proposal_branch_workitem_mismatch`.
- User-visible finding: Drive delete/restore paths operate on `:itemId`, but when the repository could not find that item under the project, `apps/api/src/services/drive-pages.ts` returned project-level `drive_not_found` messages.
- Fix: missing delete/restore item targets now return `404 drive_file_not_found`, while project-level not-found behavior remains unchanged for project lookup.
- Regression tests added:
  - `apps/api/src/proposals.test.ts`: `proposal create rejects branch ids that belong to a different work item`.
  - `apps/api/src/drive-pages.test.ts`: `drive page service reports missing delete and restore targets as file-level not-found errors`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "proposal create rejects branch ids" src/proposals.test.ts` first failed with the uncaught `Proposal branch belongs to a different work item`, then passed after repository/service error mapping.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "missing delete and restore targets" src/drive-pages.test.ts` first failed because the error code was `drive_not_found`, then passed after delete/restore returned file-level not-found errors.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed: 35 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed: 49 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.

### 2026-06-30 Backend Continuation - Notification preference contract cleanup

- User-visible finding: notification preference reads returned raw DB mute-type arrays. Legacy/drifted values such as blank strings, duplicates, whitespace-padded types, or overlong strings could leak into the settings UI and generated clients.
- Fix: `apps/api/src/services/notifications.ts` now normalizes muted notification types through one helper before preference reads, preference write responses, and mute checks.
- User-visible finding: `PUT /api/notifications/preferences` correctly returned `400 malformed_json` for broken JSON bodies, but semantic payload mistakes such as non-string mute types also returned HTTP 400. That made client form validation indistinguishable from malformed request bodies.
- Fix: `apps/api/src/routes/notifications.ts` now uses a Zod request schema for preference semantics, returning `422 validation_error` while keeping malformed JSON on the shared `400 malformed_json` path.
- Regression tests added:
  - `apps/api/src/notifications.test.ts`: `notification preferences normalize drifted stored values before returning them`.
  - `apps/api/src/notifications-routes.test.ts`: `notification preferences route returns validation_error for semantic payload mistakes`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "normalize drifted stored values" src/notifications.test.ts` first failed because the raw stored values were returned unchanged, then passed after normalization.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "semantic payload mistakes" src/notifications-routes.test.ts` first failed with `400 !== 422`, then passed after route-level Zod validation.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/notifications-routes.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts` passed: 9 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - AgentRun abort permission consistency

- User-visible finding: AgentRun read/trace/handoff/replay already fell back to WorkItem visibility, and AgentRun start required WorkItem mutation access. The abort route skipped that WorkItem permission chain and only accepted the original run actor or admins, so a user who could legitimately manage the backing WorkItem could watch a runaway run but not stop it.
- Fix: `apps/api/src/routes/agent-runs.ts` now resolves the run, checks the backing WorkItem mutation gate for non-owner/non-admin actors, and only then passes an explicit `canManageRun` flag to the queue. `apps/api/src/workers/agent-runner.ts` still preserves the direct queue default of owner/admin-only unless that flag is present.
- Regression test added:
  - `apps/api/src/agent-runs.test.ts`: `agent run abort allows users who can mutate the backing work item`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "agent run abort allows users who can mutate" src/agent-runs.test.ts` first failed with `403 !== 200`, then passed after the route-level WorkItem mutation gate.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "agent run abort is limited|agent run abort allows|agent run read routes" src/agent-runs.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 56 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Invite accept bad-link ordering

- User-visible finding: `POST /api/auth/invites/accept` parsed nickname/password semantics before checking the invite token. A recipient opening an expired or mistyped invite link could see a generic form validation error first, even though the real next step is "ask for a fresh invite."
- Fix: `apps/api/src/routes/auth.ts` now reads the JSON body once, validates only the token shape, resolves the active invite, and only then parses nickname/password and runs password-strength validation.
- Regression test added:
  - `apps/api/src/auth.test.ts`: extended `invite accept rejects an invalid token (404); create requires admin (403)` with an invalid token plus invalid form fields.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "invite accept rejects an invalid token" src/auth.test.ts` first failed with `422 !== 404`, then passed after token-first invite lookup.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts` passed: 61 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Schedule assigned private work visibility

- User-visible finding: Project Home and WorkItem detail already treated explicit assignments as readable, but Schedule/Notify did not. A user assigned as lead/collaborator to a private `spec_ready` WorkItem could lose the inbox reminder and calendar due block unless they were also submitter or claimed user.
- Fix: `packages/db/src/repositories/schedule-notify.ts` now loads `work_item_assignments`, includes assigned users in due-WorkItem queries, and attaches assignments to WorkItem notification context rows. `apps/api/src/services/schedule-notify-pages.ts` passes those assignments into the shared WorkItem visibility gate.
- User-visible finding: project-visible schedule events could still expose `/workitems/:id` and `work_item_id` for a linked private WorkItem the viewer could not open, creating a calendar dead link.
- Fix: schedule event VM generation now checks the linked WorkItem through the same visibility gate before attaching `target_href` or WorkItem ids. The repository also backfills assignments for event-linked WorkItems so assigned users keep valid links.
- Regression test added:
  - `apps/api/src/schedule-notify-pages.test.ts`: `assigned private work item notifications and calendar blocks stay visible to the assignee`.
  - `apps/api/src/schedule-notify-pages.test.ts`: `calendar schedule events do not expose dead work-item links for unreadable private work`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` first failed with `assigned private work item notification should not disappear from the inbox`, then passed after repository/service assignment propagation.
  - The same command then failed red on the calendar event test because the VM still returned `/workitems/82000000-0000-4000-8000-000000000006`, then passed after event-linked WorkItem visibility filtering.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` passed: 8 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts src/notifications-routes.test.ts src/schedule-notify-pages.test.ts` passed: 21 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - Meeting private WorkItem link filtering

- User-visible finding: Meeting page VM generation already hid draft/proposal links when the actor could not open a meeting-generated WorkItem, but still exposed meeting-level `work_item_id` for linked private work. A project-meeting viewer could see an item id that would 403 if rendered as an entry point.
- Fix: `apps/api/src/services/meeting-pages.ts` now includes meeting-linked WorkItems in the existing WorkItem visibility pass and only emits meeting `work_item_id` when that item is actually readable by the actor.
- User-visible finding: Meeting insight `target_work_item_id` had the same gap; the insight itself could be readable while the target private WorkItem was not.
- Fix: target WorkItem ids now reuse the same visibility set before entering the Meeting Insight VM.
- Regression tests added:
  - `apps/api/src/meeting-pages.test.ts`: `meeting page service hides meeting work item ids when the actor cannot open the linked private work item`.
  - `apps/api/src/meeting-pages.test.ts`: `meeting page service hides target work item ids when the actor cannot open the linked private work item`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "hides meeting work item ids" src/meeting-pages.test.ts` first failed because the VM still returned `96000000-0000-4000-8000-000000000004`, then passed after meeting-level WorkItem visibility filtering.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "hides target work item ids" src/meeting-pages.test.ts` first failed because the VM still returned `96000000-0000-4000-8000-000000000004`, then passed after target WorkItem visibility filtering.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "hides (meeting|target) work item ids" src/meeting-pages.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/meeting-pages.test.ts` passed: 15 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Calendar meeting follow-up private WorkItem ids

- User-visible finding: Calendar meeting-followup blocks linked to the meeting page, but also copied `createdWorkItemId` / `targetWorkItemId` into `work_item_id` without a WorkItem visibility check. A user allowed to see the meeting could still receive a private WorkItem id in the Calendar VM.
- Fix: `packages/db/src/repositories/schedule-notify.ts` now backfills the linked meeting-created/target WorkItem and its assignments when available. `apps/api/src/services/schedule-notify-pages.ts` only emits the Calendar block `work_item_id` after that linked WorkItem passes the shared WorkItem visibility gate; missing access data fails closed.
- Regression test added:
  - `apps/api/src/schedule-notify-pages.test.ts`: `calendar meeting followups do not expose unreadable private work item ids`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "calendar meeting followups" src/schedule-notify-pages.test.ts` first failed because the block still returned `82000000-0000-4000-8000-000000000006`, then passed after linked WorkItem access filtering.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "calendar meeting followups" src/schedule-notify-pages.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` passed: 9 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.

### 2026-06-30 Backend Continuation - Project Health assigned private work

- User-visible finding: Project Home, WorkItem detail, Schedule/Notify, and Knowledge now include explicit assignments in WorkItem visibility, but Project Health did not. A member assigned to private `spec_ready` work could see a healthy project card even though their own assigned open work should push the risk band up.
- Fix: `apps/api/src/services/project-health-pages.ts` now passes assignments into the shared WorkItem visibility gate. `packages/db/src/repositories/project-health.ts` backfills WorkItem assignments for open work, pending approvals, and failed runs so the aggregate page uses the same readable-work definition as the detail routes.
- Regression test added:
  - `apps/api/src/project-health-pages.test.ts`: `project health page includes assigned private open work in member risk bands`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "assigned private open work" src/project-health-pages.test.ts` first failed with `healthy !== attention`, then passed after assignment-aware visibility.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/project-health-pages.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - WorkItem, Knowledge, and Drive data-chain pass

- User-visible finding: real WorkItem assignments use `lead` / `collaborator`, but mutation access still treated assigned private users as read-only. Assigned leads could open private work but could not answer clarification, bind evidence, or continue the task.
- Fix: `apps/api/src/services/work-items.ts` now lets explicit assignment roles participate in the generic WorkItem mutation gate while keeping non-role fixtures/read-only viewers blocked.
- User-visible finding: WorkItem detail exposed `actions.create_proposal_draft` to read-only viewers even though the POST immediately failed with 403. Detail VMs now keep `source_context` visible but hide source proposal actions unless the actor can mutate the WorkItem.
- User-visible finding: Project knowledge search returned a misleading 403 for missing, archived, or deleted project anchors. Missing/inactive project anchors now return `404 project_not_found`; real visibility failures still return 403.
- User-visible finding: Drive recycle-bin deep links could 404 even when the repository had loaded the requested deleted item. Drive page selection and target validation now accept `deleted_items` as valid selectable targets.
- User-visible finding: Drive version history labeled superseded accepted versions as `manual_upload`, but including superseded records naively would inflate the active formal-deliverable list. Repository reads now keep historical accepted rows for version labels, while the page list/count filters to active rows only.
- User-visible finding: Project-home recent Drive files could carry accepted WorkItem ids from old file versions, advertising links that the current file preview/download gate would reject. Recent-file rows now only attach accepted WorkItem ids for the current file version.
- User-visible finding: Drive draft-to-proposal manifests targeted `drive_item:<folderId>`, so multiple comment proposals in one folder collided conceptually and proposal merge would not adopt the output as a Drive file. The generated manifest now targets a `delivery` output path under `/outputs/<drive path>` and omits the folder id as target entity.
- User-visible finding: Recycle-bin rows showed restore buttons for states already known to fail: child item while parent folder is still deleted, or same-location active name conflict. Those rows now stay visible but omit `restore_href`.
- Regression tests added or extended:
  - `apps/api/src/work-items-service.test.ts`: assigned lead clarification continuation; read-only source proposal action hiding; missing/archived project knowledge anchors.
  - `apps/api/src/drive-pages.test.ts`: deleted-item deep-link selection; superseded accepted version labels; Drive draft proposal target contract; restore-link suppression for deleted parent/name-conflict states.
  - `packages/db/src/drive-path.test.ts`: current-version accepted WorkItem ids for recent files; superseded accepted rows retained for historical version labels.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts src/drive-pages.test.ts` passed: 84 tests.
  - `pnpm --filter @workhub/db exec node --import tsx --test src/drive-path.test.ts` passed: 17 tests.
- Resolved follow-up: Drive comment draft proposals created without an AgentRun workdir now include explicit generated Markdown content in the manifest and materialize that text into Drive storage during proposal merge, so review/merge creates an actual Drive file version instead of only an accepted ledger row.
- Additional regression tests:
  - `packages/contracts/src/contracts.test.ts`: `deliverable manifest preserves explicit generated markdown content for text materialization`.
  - `apps/api/src/drive-pages.test.ts`: deterministic Drive proposal manifest now asserts `generated_content_md` and matching `sha256_after`.
  - `apps/api/src/proposals.test.ts`: `db proposal merge materializes inline generated text deliverables without a workdir`.
- Additional verification:
  - `pnpm --filter @workhub/contracts exec node --import tsx --test src/contracts.test.ts` passed: 36 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts src/proposals.test.ts` passed: 89 tests.
  - `pnpm --filter @workhub/contracts typecheck` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- packages/contracts/src/experience.ts packages/contracts/src/contracts.test.ts apps/api/src/services/proposals.ts apps/api/src/proposals.test.ts apps/api/src/services/drive-pages.ts apps/api/src/drive-pages.test.ts` passed.

### 2026-06-30 Backend Continuation - Subagent API/data-chain findings

- User-visible finding: raw `/api/notifications` returned `work_item_id` and `/workitems/:id` target links for stale notifications even after the recipient could no longer open the backing private WorkItem. The page-level notification VM already stripped such links, but the raw notification API did not.
- Fix: `apps/api/src/services/notifications.ts` now accepts actor context for list reads, checks linked WorkItem visibility, and strips unreadable WorkItem ids/target URLs while keeping the notification row itself. `apps/api/src/routes/notifications.ts` passes the authenticated actor into that service path.
- User-visible finding: the proposal review queue could surface opened/reviewed proposals whose WorkItem was soft-deleted or whose project was archived/deleted, creating dead review cards on the project/home decision surface.
- Fix: `packages/db/src/repositories/proposals.ts` now joins projects during `listReviewable` and filters deleted WorkItems plus inactive projects.
- User-visible finding: the WorkItem audit timeline missed proposal merge and accepted-deliverable restore facts because those audit rows are written under `entityType=proposal` / `accepted_deliverable` with `detail_json.work_item_id`, while the WorkItem timeline only queried direct `entityType=work_item` rows.
- Fix: `packages/db/src/repositories/audit.ts` now includes audit rows anchored by `detail_json->>'work_item_id'`.
- User-visible finding: project-scoped accepted-deliverable restore could find a previous version created from another WorkItem and then return links under that other WorkItem id. Users restoring from WorkItem A could get `/api/workitems/B/...` links or lose the restored file from A's detail page.
- Fix: `packages/db/src/repositories/work-items.ts` now creates a fresh current accepted-deliverable row owned by the requesting WorkItem when restoring a previous project target version. The old row remains historical source evidence via `source_accepted_change_id`.
- User-visible finding: Drive summary mixed total counts and loaded-page counts. `file_count` could be uncapped while `item_count`, `folder_count`, `version_count`, `accepted_deliverable_count`, `pending_comment_count`, and `operation_count` were only the current loaded slice, producing impossible summaries in large projects.
- Fix: `packages/db/src/repositories/drive.ts` now returns uncapped summary totals for active items/files/folders, deleted items, versions, active accepted deliverables, pending comments, and operations. `apps/api/src/services/drive-pages.ts` renders those totals with loaded-count fallback for legacy fake repositories.
- Regression tests added or extended:
  - `apps/api/src/notifications.test.ts`: `notification list strips unreadable work item ids and dead work item links`.
  - `apps/api/src/notifications-routes.test.ts`: `raw notification list route passes actor context for work item link filtering`.
  - `packages/db/src/proposals-repository.test.ts`: `proposal review queue skips deleted work items and inactive projects`.
  - `packages/db/src/audit-repository.test.ts`: `work item audit timeline includes proposal and deliverable logs anchored by detail work_item_id`.
  - `packages/db/src/drive-path.test.ts`: `accepted deliverable restore creates a fresh current row for the requesting work item`.
  - `apps/api/src/drive-pages.test.ts`: summary total-count regression extended across all Drive summary count fields.
- Verification after fix:
  - `pnpm exec node --import tsx --test src/*.test.ts` from `packages/db` passed: 52 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts src/workitems.test.ts src/work-items-service.test.ts src/notifications.test.ts src/notifications-routes.test.ts src/proposals.test.ts src/audit.test.ts` passed: 159 tests.
  - `pnpm --filter @workhub/contracts exec node --import tsx --test src/contracts.test.ts` passed: 36 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.
  - `git diff --check -- packages/contracts/src/experience.ts packages/contracts/src/contracts.test.ts apps/api/src/services/proposals.ts apps/api/src/proposals.test.ts apps/api/src/services/drive-pages.ts apps/api/src/drive-pages.test.ts apps/api/src/services/notifications.ts apps/api/src/routes/notifications.ts apps/api/src/notifications.test.ts apps/api/src/notifications-routes.test.ts packages/db/src/repositories/proposals.ts packages/db/src/proposals-repository.test.ts packages/db/src/repositories/audit.ts packages/db/src/audit-repository.test.ts packages/db/src/repositories/work-items.ts packages/db/src/drive-path.test.ts packages/db/src/repositories/drive.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-06-30 Backend Continuation - Knowledge search OpenAPI response contract

- User-visible/client-contract finding: `/api/knowledge/search` documented its request body but omitted its 200 response. Runtime returns a standard `{ ok, data, meta }` envelope with an evidence bubble, but generated clients could not see `summary_text`, `evidence_refs`, or follow-up `actions`.
- Fix: `apps/api/src/openapi.ts` now defines an evidence-bubble response schema and attaches it to `/api/knowledge/search`.
- Regression test added:
  - `apps/api/src/app.test.ts`: `core JSON mutation routes document optional bodies and nested fields accurately` now asserts the Knowledge search response envelope and evidence-bubble fields.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "core JSON mutation routes document optional" src/app.test.ts` first failed because `knowledgeResponse` was `undefined`, then passed after the response schema was added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 24 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Push stream and audit OpenAPI runtime contract

- User-visible/client-contract finding: the runtime rejects non-UUID ids for `/api/push/stream/workitem/{id}`, `/req/{id}`, `/run/{id}`, `/session/{id}`, `/proposal/{id}`, and `/api/workitems/{id}/audit`, but the OpenAPI document only inferred those parameters as plain strings. Generated clients could treat invalid ids as contract-valid and then see confusing 403/404 behavior at runtime.
- User-visible/client-contract finding: all push stream routes returned SSE at runtime but the OpenAPI document did not declare a `text/event-stream` 200 response, so clients and QA tooling could not distinguish these endpoints from ordinary empty GET routes.
- Fix: `apps/api/src/openapi.ts` now explicitly declares UUID path parameters for push/audit routes, adds `text/event-stream` responses for every push subscription route, and documents the WorkItem audit JSON response envelope.
- Regression test added:
  - `apps/api/src/app.test.ts`: `push streams and audit OpenAPI routes document runtime UUID guards and responses`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "push streams and audit OpenAPI" src/app.test.ts` first failed because push route `id` parameters were inferred as `{ type: "string" }`, then passed after explicit UUID parameters and stream responses were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "push streams and audit OpenAPI" src/app.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 25 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Pilot metrics and AI worklog OpenAPI contract

- User-visible/client-contract finding: `/api/pilot/day1/metrics` accepts `from`/`to` ISO datetime query parameters and returns a structured pilot metrics snapshot, but the OpenAPI route had only a summary. Admin dashboards or external QA tooling could not discover the supported date window or the shape of `metrics`, `raw_counts`, `cost`, and `gates`.
- User-visible/client-contract finding: `/api/ai-worklog/today` returns the same AI worklog VM used by the home/attention surface, but OpenAPI did not declare its response fields. Clients could not rely on `runs_today`, `autonomy_rate`, accepted count, saved-hours estimate, skill-evolution counters, or `generated_at`.
- Fix: `apps/api/src/openapi.ts` now documents pilot `from`/`to` date-time query parameters, the full pilot metrics response envelope, and the AI worklog response envelope.
- Regression test added:
  - `apps/api/src/app.test.ts`: `pilot metrics and AI worklog OpenAPI routes document query and response contracts`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "pilot metrics and AI worklog OpenAPI" src/app.test.ts` first failed because the pilot `from` query parameter was `undefined`, then passed after schemas were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "pilot metrics and AI worklog OpenAPI" src/app.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 26 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Pilot datetime query validation and error code

- User-visible/client-contract finding: after OpenAPI declared pilot `from`/`to` as `date-time`, the runtime still accepted date-only strings such as `2026-06-13` because it used JavaScript's broad `new Date(...)` parsing. That let contract-invalid URLs reach the metrics service and made QA/client behavior depend on JS parser quirks.
- User-visible/client-contract finding: hand-written `HTTPException(422)` validation errors were mapped to generic `http_error`, so clients could not reliably branch on validation failures the way they already can for Zod payload errors.
- Fix: `apps/api/src/routes/pilot.ts` now requires an RFC3339-style datetime with timezone before parsing, and `apps/api/src/http-error-codes.ts` maps generic 422 HTTP exceptions to `validation_error`.
- Regression tests added or extended:
  - `apps/api/src/pilot-routes.test.ts`: `pilot day1 metrics route rejects date-only ranges before calling metrics`.
  - `apps/api/src/app.test.ts`: malformed/body error-code coverage now also asserts generic `HTTPException(422)` maps to `validation_error`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "date-only ranges" src/pilot-routes.test.ts` first failed because the metrics service was called, then passed after strict datetime parsing.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "malformed JSON request bodies" src/app.test.ts` first failed with `http_error !== validation_error`, then passed after the shared mapping was updated.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/pilot-routes.test.ts src/app.test.ts` passed: 28 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - AgentRun trace cursor validation

- User-visible/client-contract finding: `/api/agent-runs/{id}/trace?after=` is documented as a non-negative integer cursor, but the route used `Number.parseInt`. This accepted `after=-1` as a valid cursor and would accept partial strings such as `after=1abc`, producing trace windows that did not match the client contract.
- Fix: `apps/api/src/routes/agent-runs.ts` now parses `after` with a strict non-negative-integer query helper and returns 422 for malformed or negative cursors before reading trace rows.
- Regression test added:
  - `apps/api/src/agent-runs.test.ts`: `agent run trace route rejects malformed or negative after cursors`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "trace route rejects" src/agent-runs.test.ts` first failed because `after=-1` returned 200, then passed after strict cursor parsing.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 57 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 26 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Calendar page OpenAPI contract

- User-visible/client-contract finding: `/api/pages/calendar` supports `date`, `view`, and `locale` at runtime and returns a Calendar Page VM, but the OpenAPI document only had a summary. Clients and QA tooling could not discover how to request day/week views or trust the response shape for schedule blocks.
- Fix: `apps/api/src/openapi.ts` now documents `date=YYYY-MM-DD`, `view=day|week`, `locale`, and the Calendar Page VM envelope with scope, summary, days, and blocks.
- Regression test added:
  - `apps/api/src/app.test.ts`: `Calendar page OpenAPI documents query parameters and page VM response`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Calendar page OpenAPI" src/app.test.ts` first failed because `/api/pages/calendar` had no declared query parameters, then passed after the schema was added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Calendar page OpenAPI" src/app.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 27 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Secondary page OpenAPI contracts

- User-visible/client-contract finding: `/api/pages/meetings` accepts `project_id`, `m`/`meeting_id`, and `locale` at runtime, but OpenAPI exposed only a summary. Generated clients could not discover the selected-meeting deep-link parameters and would treat the Meeting Page VM as unknown JSON.
- User-visible/client-contract finding: `/api/pages/approvals`, `/notifications`, `/health`, `/cost`, `/skills`, and `/settings` all return page envelopes with stable VM fields, but OpenAPI did not declare locale parameters or response shapes. This weakened the app handoff boundary for approval queues, notification inboxes, project health, cost dashboards, skills, and settings.
- Fix: `apps/api/src/openapi.ts` now declares runtime query parameters and `ok/data/meta` page envelopes for those page routes, including top-level VM required fields and focused nested schemas where client decisions depend on them.
- Regression test added:
  - `apps/api/src/app.test.ts`: `secondary page OpenAPI routes document query parameters and page VM envelopes`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` first failed because `/api/pages/meetings` returned an empty OpenAPI parameter list, then passed after page schemas and query parameters were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 28 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - WorkItem and Proposal page OpenAPI contracts

- User-visible/client-contract finding: `/api/pages/workitems/{id}` and `/api/pages/proposals/{id}` are real page entrypoints that both read `locale` and both reject malformed ids through runtime UUID guards, but OpenAPI only documented a summary/loose string path. Generated clients could build contract-valid URLs that runtime would reject differently, and QA tooling could not validate the page VM shape.
- User-visible/client-contract finding: the Proposal detail page VM is not the same payload as raw `/api/proposals/{id}`. Without a dedicated page schema, client code could confuse review/merge page actions and comments with the raw proposal row response.
- Fix: `apps/api/src/openapi.ts` now documents UUID `id`, optional `locale`, WorkItem detail page envelopes, and a dedicated Proposal Detail Page VM response schema.
- Regression test added:
  - `apps/api/src/app.test.ts`: `work item and proposal page OpenAPI routes document id parameters and page VM envelopes`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` first failed because `/api/pages/workitems/{id}` had only a loose string `id` parameter and no `locale`, then passed after explicit parameters and response schemas were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 29 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - Attention and Gold Path page OpenAPI contracts

- User-visible/client-contract finding: `/api/pages/attention` is the first WorkHub page surface and reads `locale`, but OpenAPI had only a summary. Clients could not discover the `queue`, `background_runs`, and `cuu_state` contract that drives the user's first screen.
- User-visible/client-contract finding: `/api/pages/gold-path` is the QA/demo fixture bundle for the product flow, but OpenAPI did not declare its route map, page VM bundle, events, or Cuu state list. QA tooling could not validate the fixture handoff without app-specific knowledge.
- Fix: `apps/api/src/openapi.ts` now documents locale parameters, the Attention Home page envelope, the Gold Path fixture envelope, and the shared Cuu state enum used by both surfaces.
- Regression test added:
  - `apps/api/src/app.test.ts`: `attention and gold path page OpenAPI routes document locale and page VM envelopes`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` first failed because `/api/pages/attention` had no locale parameter, then passed after attention/gold-path page schemas were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 30 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - Startup and client-device OpenAPI contracts

- User-visible/client-contract finding: `/api/health` and `/api/ready` are the daemon startup/liveness boundary for the desktop app and operators, but OpenAPI had no success/failure payload schemas. Tooling could not distinguish liveness from dependency readiness or validate the `503` readiness shape.
- User-visible/client-contract finding: local client-device routes return raw JSON, not the usual `ok/data` envelope. Without explicit OpenAPI contracts, a generated desktop client could assume the wrong wrapper shape for device registration, current-device lookup, and revoke calls.
- Fix: `apps/api/src/openapi.ts` now documents raw JSON responses for health/readiness, readiness `200/503` variants, client-device registration request/`201` response, device list/current/revoke responses, and the UUID path parameter for device revocation.
- Regression test added:
  - `apps/api/src/app.test.ts`: `health, ready, and client-device OpenAPI routes document startup contracts`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` first failed because `/api/health` had no documented response schema, then passed after health/ready/client-device schemas were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 31 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-06-30 Backend Continuation - Auth OpenAPI contracts

- User-visible/client-contract finding: auth routes are the desktop bootstrap and account boundary, but OpenAPI did not describe the raw identity payloads, nullable `/me` response, invite payloads, or the exact request bodies. A generated client could assume the normal page envelope and fail at first-run login/bootstrap.
- User-visible/client-contract finding: `/api/auth/users/{id}/deactivate` uses a UUID path guard at runtime, but OpenAPI did not advertise that constraint. Admin tooling could build URLs that are contract-valid on paper and rejected by the server.
- Fix: `apps/api/src/openapi.ts` now documents identify/register/login/bootstrap/invite/preference request bodies, raw identity success responses, `/api/auth/me` identity-or-null response, invite creation response, password/logout/deactivate `{ ok }` responses, and UUID path validation.
- Regression test added:
  - `apps/api/src/app.test.ts`: `auth OpenAPI routes document request bodies and raw success payloads`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "auth OpenAPI" src/app.test.ts` first failed because `/api/auth/identify` had no declared required request fields, then passed after auth schemas and route responses were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "auth OpenAPI" src/app.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 32 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Cost OpenAPI contracts

- User-visible/client-contract finding: `/api/cost/usage`, `/api/cost/policies`, and `/api/cost/policies/{scope}/{id}` were the final runtime routes with no documented 2xx response schema. Cost dashboards and admin budget tooling could not safely generate a client for first-run budget usage, policy listing, or policy updates.
- User-visible/client-contract finding: the policy update route accepts a constrained `scope` path enum and logical policy id, but OpenAPI omitted both path parameters and the JSON update fields. Admin clients could send the wrong scope/id shape or omit all update fields before discovering the runtime 422.
- Fix: `apps/api/src/openapi.ts` now documents BudgetUsage, BudgetNotice, CostSummary, BudgetPolicy, BudgetPolicyUpdate, policy path parameters, and 200 responses for all cost routes.
- Regression test added:
  - `apps/api/src/app.test.ts`: `cost OpenAPI routes document budget usage, policies, and update payloads`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "cost OpenAPI" src/app.test.ts` first failed because `/api/cost/usage` had no documented `200` JSON schema, then passed after cost schemas and route responses were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "cost OpenAPI" src/app.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 33 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.
  - OpenAPI runtime 2xx coverage probe returned `all documented`.

### 2026-06-30 Backend Continuation - Cost policy runtime semantics

- User-visible/cost finding: when an admin disabled user/team budget policies, the runtime budget decision correctly returned no active usage scopes, but the cost page builder resurrected default user/team budget cards. Users would still see default quotas and believe disabled policies were active.
- User-visible/cost finding: cost page notices recomputed recommended actions from usage severity and ignored the policy decision. A `notify` warning policy could be displayed as `downgrade_model`, making the next step stricter than the admin-configured rule.
- Cross-chain execution finding: agent-run enqueue used the actor workspace for team usage snapshots, but still read budget policies with the global default settings workspace. In multi-workspace deployments, an AI run could obey a different budget policy than `/api/cost/usage` and `/api/pages/cost` showed.
- Fix: `apps/api/src/pages/cost.ts` now distinguishes explicit empty budget decisions from missing budget data, keeps required legacy `me/team` placeholders inactive, and only exposes real active budget scopes in `scopes`.
- Fix: `/api/cost/usage` and `/api/pages/cost` now pass the `decideRunBudget` notice through to the page VM, preserving policy-specific `recommended_action`.
- Fix: `apps/api/src/workers/agent-runner.ts` now derives tenant-scoped settings from `orgId/workspaceId` before reading budget policies, evaluating defaults, and selecting team budget scope.
- Regression tests added:
  - `apps/api/src/cost.test.ts`: `cost usage route does not resurrect disabled user and team budget policies as default scopes`.
  - `apps/api/src/cost.test.ts`: `cost usage route preserves budget policy notice actions`.
  - `apps/api/src/agent-runs.test.ts`: `agent run enqueue reads budget policies from the actor workspace`.
- Red-first evidence:
  - The disabled-policy test first failed because `scopes` still contained default user/team usage, then passed after the explicit-decision handling.
  - The notice-action test first failed with `downgrade_model !== continue`, then passed after decision notices were forwarded.
  - The agent-run policy-scope test first failed with default workspace `00000000-0000-4000-8000-000000000002` instead of the actor workspace, then passed after tenant-scoped settings were used.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/cost.test.ts` passed: 16 tests.
  - `pnpm --filter @workhub/cost test` passed: 22 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 58 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Approval WorkItem visibility scope

- User-visible/approval finding: approval routing, delegation, comment mentions, and approval route filtering all rely on `canViewWorkItemRecord(..., { orgId, workspaceId })`. The real DB `findWorkItemAccessRecord` path returned workspace fields but did not hydrate the project org id through `workspaces.org_id`, so scoped permission checks could falsely treat an otherwise visible WorkItem approval as invisible in the real repository path.
- Fix: `packages/db/src/repositories/work-items.ts` now joins `workspaces` for the project workspace and includes `project.orgId` in `WorkItemAccessRow`, letting the existing approvals permission mapping pass a complete scoped record to `@workhub/permissions`.
- Regression test added:
  - `packages/db/src/work-items-access.test.ts`: `findWorkItemAccessRecord carries project org id for scoped permission checks`.
- Red-first evidence:
  - `pnpm --filter @workhub/db exec node --import tsx --test src/work-items-access.test.ts` first failed because `findWorkItemAccessRecord` lacked the `workspaces` join and `projectOrgId`, then passed after the repository hydration fix.
- Verification after fix:
  - `pnpm --filter @workhub/db exec node --import tsx --test src/work-items-access.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 46 tests.
  - `pnpm --filter @workhub/db test` passed: 53 tests.
  - `pnpm --filter @workhub/permissions test` passed: 13 tests.

### 2026-06-30 Backend Continuation - Approval center comment preload cap

- User-visible/approval finding: single-approval comment reads were capped, but the approval-center batch preload path used `listByApprovals` without a per-approval limit. A busy approval could pull every historic comment into the queue VM, making the review center slow and noisy before the user even opened that approval.
- Fix: `apps/api/src/services/approvals.ts` now asks the comment repository for at most 20 prefetched comments per approval. The DB repository implements that with `row_number() over (partition by approval_id order by created_at asc)`, so each approval gets a bounded preview without losing full comment history on the dedicated comments route.
- Regression test added:
  - `apps/api/src/approvals.test.ts`: `W2 listPendingForUser caps prefetched comments per approval`.
- Red-first evidence:
  - The targeted approval test first failed because the service did not pass a per-approval limit into `listByApprovals`, then passed after the service and DB repository cap were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "caps prefetched comments" src/approvals.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 48 tests.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm --filter @workhub/db test` passed: 53 tests.

### 2026-06-30 Backend Continuation - Approval queue truncation contract

- User-visible/approval finding: the approval repository intentionally capped pending approvals to avoid unbounded N+1 work, but the service returned that capped slice as if it were the whole queue. Users could see 100 pending approvals with no indication that more were waiting behind the first page.
- Fix: `apps/api/src/services/approvals.ts` now loads `limit + 1`, returns a stable 100-item first page, and exposes additive `page_info.limit`, `page_info.returned`, and `page_info.has_more`. It also exposes `counts.pending_total` from a repository `count(*)`, while keeping legacy `counts.pending` as the returned visible count.
- Fix: `/api/approvals` and `/api/pages/approvals` keep `page_info.returned` aligned with the final visibility-filtered response. OpenAPI and the shared `approvalCenterVmSchema` now document the optional `page_info` contract.
- Regression tests added:
  - `apps/api/src/approvals.test.ts`: `W2 listPendingForUser exposes when the approval queue has more than the first page`.
  - `packages/contracts/src/contracts.test.ts`: approval-center VM parses the additive `page_info`.
- Red-first evidence:
  - The targeted approval test first failed with `101 !== 100`, proving the current service returned every loaded row and had no first-page boundary or `has_more` state. It passed after the page limit, `pending_total`, and `page_info` were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "approval queue has more" src/approvals.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 48 tests.
  - `pnpm --filter @workhub/contracts test` passed: 47 tests.
  - `pnpm --filter @workhub/db test` passed: 53 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "OpenAPI|approval|approvals" src/app.test.ts` passed: 23 tests.

### 2026-06-30 Backend Continuation - Notification complete semantics

- User-visible/notification finding: the notification page correctly hid `complete` for `needs_decision` items, but the raw `/api/notifications/{id}/complete` endpoint still archived any notification. Older clients or scripts could make an approval/review/insight notification disappear as "complete" without the user actually opening the source decision.
- Fix: `packages/db/src/repositories/notifications.ts` now exposes `findByIdForUser`, and `apps/api/src/services/notifications.ts` uses it to preflight `complete`. Decision-class notifications (`high|urgent` or type names such as approval/ask/pending/insight/review/decision/escalated) now return `notification_needs_decision` before any archive write happens. FYI notifications still complete/archive normally.
- Fix: OpenAPI now describes `/api/notifications/{id}/complete` as "Complete and archive an FYI notification" and calls out `notification_needs_decision`.
- Regression tests added:
  - `apps/api/src/notifications.test.ts`: `notification complete rejects needs-decision notifications before archiving`.
  - `apps/api/src/app.test.ts`: notification OpenAPI test now locks the FYI-only complete summary and `notification_needs_decision` description.
- Red-first evidence:
  - The targeted notification test first failed with `Missing expected rejection`, proving decision notifications were archived by `complete`; after the preflight guard it passed and asserted the archive repository method was not called.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts` passed: 11 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` passed: 12 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "notification OpenAPI" src/app.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db test` passed: 53 tests.

### 2026-07-01 Backend Continuation - Auth `/me` stale desktop token recovery

- User-visible/auth finding: ordinary protected routes must fail closed when a request presents an invalid desktop client token, but `/api/auth/me` is the identity probe used by the desktop app to decide whether to show the signed-in shell or return to onboarding. A revoked/stale desktop token previously returned a hard 403, leaving the client in an error state instead of a recoverable signed-out state.
- Fix: `apps/api/src/routes/auth.ts` now handles `/me` separately from the normal auth gate: `401` and `invalid client token` on this probe return JSON `null`, while protected routes and stream identity still keep the existing 403 fail-closed behavior.
- Regression test added:
  - `apps/api/src/auth.test.ts`: `GET /auth/me treats revoked desktop client tokens as signed-out instead of a hard 403`.
- Red-first evidence:
  - The targeted auth test first failed with `403 !== 200`, proving revoked desktop tokens made `/me` hard-fail. It passed after the route-level recovery guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts` passed: 63 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-06-30 Backend Continuation - Calendar query validation

- User-visible/client-contract finding: `/api/pages/calendar?date=...&view=...` previously accepted malformed explicit query values by silently falling back to today/week. A broken notification or copied calendar link could show a normal-looking but wrong date/view, which is harder for a user to notice than a clear validation error.
- Fix: `apps/api/src/services/schedule-notify-pages.ts` now preserves the default only when parameters are omitted, and throws `ScheduleNotifyPageServiceError(422, "invalid_calendar_query")` when an explicit date is not a valid `YYYY-MM-DD` calendar date or `view` is not `day|week`.
- Regression test added:
  - `apps/api/src/schedule-notify-pages.test.ts`: `calendar page rejects malformed date and view queries instead of silently changing scope`.
- Red-first evidence:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "malformed date and view" src/schedule-notify-pages.test.ts` first failed with `Missing expected rejection`, then passed after strict query validation.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` passed: 10 tests.
- `pnpm --filter @workhub/api typecheck` passed.
- `pnpm exec node --import tsx --test --test-reporter=dot src/*.test.ts` from `apps/api` passed.

### 2026-07-01 Backend Continuation - Permission policy duplicate/revoke semantics

- User-visible/approval finding: `remember: always` and admin policy creation could create duplicate active permission policies for the same tenant, scope, action, effect, and priority. Deleting one policy then left an equivalent duplicate active, so users could see a rule disappear in settings while the AI still bypassed approval for the same action.
- Fix: `apps/api/src/services/approvals.ts` now treats policy creation as idempotent at the service boundary: learned session policies and admin-created policies reuse an equivalent active policy instead of appending another row. `revokePolicy` also soft-deletes equivalent duplicate active rows in the actor tenant, repairing older rows left by retries.
- Regression tests added:
  - `apps/api/src/approvals.test.ts`: `remember always reuses an equivalent active policy instead of duplicating learned policies`.
  - `apps/api/src/approvals.test.ts`: `permission policy creation reuses an equivalent active policy instead of duplicating it`.
  - `apps/api/src/approvals.test.ts`: `revokePolicy removes equivalent duplicate active policies left by older remember-always retries`.
- Red-first evidence:
  - The targeted approval tests first failed with newly inserted policy ids for both create paths and a remaining duplicate id after revoke. They passed after the service-level equivalence check and duplicate soft-delete path were added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "equivalent active policy|duplicating learned|equivalent duplicate" src/approvals.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 51 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Work-item-less permission ask routing

- User-visible/approval finding: `/api/permissions/ask` could let an admin route a tool approval without `work_item_id` to another active user. Because work-item-less approvals have no shared project/work-item visibility context to check, the target could receive raw tool payload text that is unrelated to anything they can prove they should see.
- Fix: `apps/api/src/routes/permissions.ts` now requires self-routing whenever a permission ask has no `work_item_id`. Requests with a work item keep the existing work item `detailPage` visibility guard and can still route through the validated work-item context.
- Regression test added:
  - `apps/api/src/approvals.test.ts`: `permission ask route requires self-routing when no work item can prove recipient visibility`.
- Red-first evidence:
  - The targeted test first failed because the route continued into `createApproval` for a cross-user, work-item-less payload. It passed after the route-level self-routing guard was added.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "requires self-routing" src/approvals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 52 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Stable non-ASCII project bootstrap slugs

- User-visible/project-management finding: project bootstrap deliberately reuses projects by `(workspace_id, slug)`, but the backend generated a random fallback slug for names made entirely of non-ASCII characters. A user retrying or double-submitting the same Chinese project name could create duplicate projects instead of reusing the first one, making the GitHub-like project list look inconsistent.
- Fix: `apps/api/src/services/projects.ts` now derives the fallback slug from a stable SHA-256 hash of the trimmed project name. Different Chinese names still get distinct `project-...` slugs, while the same Chinese name retries through the repository's existing idempotent reuse path.
- Regression test added:
  - `apps/api/src/projects.test.ts`: `project bootstrap derives a stable slug for repeated non-ascii project names`.
- Red-first evidence:
  - The targeted test first failed because the two submissions produced different `project-...` slugs. It passed after switching the fallback slug from random UUID fragments to a deterministic name hash.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "stable slug" src/projects.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/projects.test.ts src/project-home-pages.test.ts` passed: 24 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Admin desktop bootstrap token path

- User-visible/desktop-auth finding: nickname-mode `/api/auth/desktop-bootstrap` existed specifically to break the desktop first-run cookie/token deadlock, but it rejected an existing admin nickname unconditionally and told the user to sign in with `/identify` before registering a device. In the desktop first-run cross-origin path, that could leave an admin user with no local `client_token` to continue.
- Fix: `packages/contracts/src/auth.ts`, `apps/api/src/openapi.ts`, and `apps/api/src/routes/auth.ts` now allow an optional `admin_secret` on desktop bootstrap. Non-admin desktop bootstrap is unchanged; existing admin nicknames still reject without the secret, and with the correct configured admin secret they mint a normal device-bound client token in the response body.
- Regression tests added:
  - `apps/api/src/auth.test.ts`: `desktop-bootstrap mints a device token for an existing admin nickname with the admin secret`.
  - `apps/api/src/app.test.ts`: the auth OpenAPI test now asserts `admin_secret` is documented on the desktop bootstrap request schema.
- Red-first evidence:
  - The targeted auth test first failed with `403 !== 201`, proving a correct admin secret was ignored by the desktop bootstrap route. It passed after adding the optional contract field and route-level admin secret check.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "desktop-bootstrap.*admin" src/auth.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/contracts test` passed: 47 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "auth OpenAPI" src/app.test.ts` passed: 1 test.

### 2026-07-01 Backend Continuation - Proposal merge missing-snapshot error contract

- User-visible/proposal finding: the proposal merge route still contained one raw `500` path: if the merge service returned a merged proposal without `merge_snapshot_id`, the user-facing "采纳到正式版" action failed as an internal server error. This is unlikely on freshly-created data, but it is exactly the kind of historical/partial-migration state that turns an approval workflow into an opaque dead end.
- Fix: `apps/api/src/routes/proposals.ts` now surfaces that condition as `ProposalServiceError(409, "merge_snapshot_missing")`, preserving the route's typed error contract instead of falling through as a generic HTTP/server failure. Normal successful merges still require and return the snapshot id.
- Regression test added:
  - `apps/api/src/proposals.test.ts`: `proposal merge reports a typed contract error when the merged snapshot is missing`.
- Red-first evidence:
  - The targeted test first failed with `500 !== 409`, proving the route still emitted an internal server error for a missing merge snapshot. It passed after switching the route helper to the typed proposal error.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "merged snapshot is missing" src/proposals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed: 37 tests.

### 2026-07-01 Backend Continuation - Password change local client token revocation

- User-visible/desktop-auth finding: `/api/auth/password` said password changes rebuild trust and log out other devices, but it only revoked server-side sessions. WorkHub desktop and local integrations authenticate with `X-YQGL-Client-Token` / `X-WorkHub-Client-Token`, so an old local device token could keep using the API after the password changed.
- Fix: `apps/api/src/routes/auth.ts` now resolves the current local client token, revokes other active client devices for the same user after a successful password change, and keeps the current local client usable so the user is not kicked out immediately after a successful action. The existing session rotation remains unchanged.
- Regression test added:
  - `apps/api/src/auth.test.ts`: `POST /password revokes other client device tokens but keeps the current local client`.
- Red-first evidence:
  - The targeted test first failed because the other device row still had `revokedAt === null`, and its old token still authenticated. It passed after adding the route-level other-device revocation loop.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "revokes other client device tokens" src/auth.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/auth.test.ts` passed: 65 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Snapshot audit/revert output contract

- User-visible/audit finding: the work-item audit timeline converted DB snapshot rows to API VMs with direct type assertions, so a historical or partially migrated snapshot with an unknown `kind`/`createdByKind` could be returned as a successful `200` response even though it violated the public contract. The revert route had the inverse problem: the same bad row was caught inside the file-restore `try/catch` and surfaced as a misleading `409` restore failure.
- Fix: `apps/api/src/pages/replay.ts` now parses snapshot VMs through the shared output-contract guard before returning them. `apps/api/src/routes/audit.ts` now builds the validated `SnapshotRef` before reading the agent workdir and before the file-restore catch block, so contract drift fails closed as an internal output-contract error instead of leaking as a restore conflict.
- Regression tests added:
  - `apps/api/src/audit.test.ts`: `audit timeline fails closed when a stored snapshot violates the response contract`.
  - `apps/api/src/audit.test.ts`: `revert route fails closed when the selected snapshot violates the restore contract`.
- Red-first evidence:
  - The targeted audit tests first failed with `200 !== 500` for the timeline path and `409 !== 500` for the revert path, proving both contract boundaries were wrong before the fix. They passed after moving snapshot conversion through the output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "stored snapshot violates|selected snapshot violates" src/audit.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/audit.test.ts` passed: 14 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Cost policy output contract

- User-visible/cost-management finding: the cost policy admin API validated response rows with a raw `zod.parse`. If a stored or migrated budget policy violated the public response contract, WorkHub returned a `422 validation_error`, incorrectly blaming the admin's request instead of failing closed as a server-side contract drift.
- Fix: `apps/api/src/routes/cost.ts` now converts cost policy rows through the shared output-contract guard. Invalid stored policies surface as `500 internal_contract_error`, matching the rest of the page/route VM assembly boundary.
- Regression test added:
  - `apps/api/src/cost.test.ts`: `cost policy routes fail closed as server errors when stored policies violate the response contract`.
- Red-first evidence:
  - The targeted test first failed with `422 !== 500`, proving a bad stored policy was still classified as request validation. It passed after switching the policy VM conversion to `parseOutputContract(..., "cost.policy")`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "stored policies violate" src/cost.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/cost.test.ts` passed: 17 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Schedule/notification page output contract

- User-visible/notifications finding: the notifications inbox and calendar page service comments said the VM assembly should fail closed, but both pages still used raw schema parsing. If internal actor identity or assembled page fields drifted, the route would surface a `422 validation_error`, implying the user's date/view/request was bad instead of reporting an internal page assembly problem.
- Fix: `apps/api/src/services/schedule-notify-pages.ts` now wraps both `notificationPageVmSchema` and `calendarPageVmSchema` with `parseOutputContract`, using explicit contexts `notifications.page` and `calendar.page`.
- Regression test added:
  - `apps/api/src/schedule-notify-pages.test.ts`: `schedule notify pages wrap VM assembly drift as internal contract errors`.
- Red-first evidence:
  - The targeted test first failed because the caught error was a raw Zod validation issue for `actor_user_id`. It passed after moving both page builders to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "wrap VM assembly drift" src/schedule-notify-pages.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/schedule-notify-pages.test.ts` passed: 13 tests. The audit sink warnings are from an existing test that intentionally simulates post-write audit failure.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Proposal detail page output contract

- User-visible/proposal finding: the proposal detail page builder used raw schema parsing. If a stored proposal row or assembled proposal VM drifted, opening the proposal page could be reported as a `422 validation_error`, which looks like the user sent a bad request instead of WorkHub detecting an internal page contract violation.
- Fix: `apps/api/src/pages/proposals.ts` now validates proposal detail VMs with `parseOutputContract(..., "proposal.detail")`.
- Regression test added:
  - `apps/api/src/proposals.test.ts`: `proposal detail page wraps stored proposal VM drift as an internal contract error`.
- Red-first evidence:
  - The targeted test first failed because the caught error was a raw Zod issue for `proposal_id`. It passed after moving the page builder to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "stored proposal VM drift" src/proposals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed: 38 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Proposal review/merge result output contract

- User-visible/proposal finding: the approval and merge HTTP routes validated their response payloads with raw schema parsing. If the service returned a drifted proposal after "通过确认" or "采纳到正式版", WorkHub reported `422 validation_error`, incorrectly blaming the user's request instead of treating the response assembly as an internal contract violation.
- Fix: `apps/api/src/routes/proposals.ts` now validates review and merge result payloads through `parseOutputContract`, using `proposal.review-result` and `proposal.merge-result` contexts.
- Regression tests added:
  - `apps/api/src/proposals.test.ts`: `proposal review route wraps response VM drift as an internal contract error`.
  - `apps/api/src/proposals.test.ts`: `proposal merge route wraps response VM drift as an internal contract error`.
- Red-first evidence:
  - The review targeted test first failed with `422 !== 500`.
  - The merge targeted test first failed with `422 !== 500`.
  - Both passed after moving those response payload boundaries to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "proposal review route wraps" src/proposals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "proposal merge route wraps" src/proposals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed: 40 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Work item detail output contract

- User-visible/work-item finding: the DB-backed work item detail page assembled its VM with raw schema parsing. If a stored work item row drifted, opening the item detail could surface as `422 validation_error`, which incorrectly blames the user's navigation rather than WorkHub's internal page assembly.
- Follow-up finding: the in-memory work item service still used the old raw parsing boundary for the same detail VM, so demo/local fallback paths disagreed with DB behavior and could still leak raw validation issues.
- Fix: `apps/api/src/services/work-items.ts` now validates both DB-backed and in-memory work item detail VMs with `parseOutputContract(..., "work-item.detail")`.
- Regression test added:
  - `apps/api/src/work-items-service.test.ts`: `work item detail wraps VM assembly drift as an internal contract error`.
  - `apps/api/src/work-items-service.test.ts`: `in-memory work item detail wraps VM assembly drift as an internal contract error`.
- Red-first evidence:
  - The targeted test first failed because the caught error was a raw Zod issue for `workitem.id`. It passed after switching the detail VM builder to the shared output-contract guard.
  - The in-memory targeted test first failed because the caught error was also a raw Zod issue for `workitem.id`. It passed after switching the memory detail builder to the same guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "work item detail wraps" src/work-items-service.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "in-memory work item detail wraps|work item detail wraps VM" src/work-items-service.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` passed: 34 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Work item session output contract

- User-visible/AI-clarification finding: the persistent clarification session VM still used raw schema parsing. If a stored session/work-item id or generated question payload drifted, the "AI 反问/下一问" flow could leak raw validation issues instead of reporting an internal response-contract failure.
- Fix: `apps/api/src/services/work-items.ts` now validates session VMs with `parseOutputContract(..., "work-item.session")`, covering create/resume/get/next-question paths without changing the frontend interaction layer.
- Regression test added:
  - `apps/api/src/work-items-service.test.ts`: `work item session wraps VM assembly drift as an internal contract error`.
- Red-first evidence:
  - The targeted test first failed because the caught error was a raw Zod issue for `session_id`, `work_item_id`, and nested question ids. It passed after switching `sessionVmFor` to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "work item session wraps" src/work-items-service.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "assigned lead can continue" src/work-items-service.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` passed: 33 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Proposal conflict/AI-fusion output contract

- User-visible/proposal finding: the conflict list and AI-fusion candidate choice routes still validated service response payloads with raw schema parsing. If conflict-card or chosen-candidate data drifted, WorkHub could show `422 validation_error` for a project-management action the user only opened/clicked.
- Follow-up finding: the DB proposal service also parsed conflict-list and candidate-choice results before the route layer could wrap them, so real repository drift could still leak raw Zod errors even after the route boundary was hardened.
- Fix: `apps/api/src/routes/proposals.ts` and `apps/api/src/services/proposals.ts` now validate conflict list and candidate-choice responses with `parseOutputContract`, using `proposal.conflict-list` and `proposal.merge-candidate-choice` contexts.
- Regression tests added:
  - `apps/api/src/proposals.test.ts`: `proposal service wraps conflict list result drift as an internal contract error`.
  - `apps/api/src/proposals.test.ts`: `proposal service wraps merge candidate choice result drift as an internal contract error`.
  - `apps/api/src/proposals.test.ts`: `proposal conflict list route wraps response VM drift as an internal contract error`.
  - `apps/api/src/proposals.test.ts`: `merge proposal candidate choice route wraps response VM drift as an internal contract error`.
- Red-first evidence:
  - Both targeted tests first failed with `422 !== 500`, proving raw response validation was still being treated as a bad user request. Both passed after moving these route responses to the shared output-contract guard.
  - The service-layer targeted tests first failed with raw Zod issues for missing conflict fields and invalid `merge_proposal_id`. They passed after moving the service helper results to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "proposal service wraps conflict list|proposal service wraps merge candidate choice" src/proposals.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "proposal conflict list route wraps|merge proposal candidate choice route wraps" src/proposals.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed: 45 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Stored proposal row output contract

- User-visible/proposal finding: the DB proposal service mapped stored proposal and review rows into public proposal responses with raw schema parsing. If a stored row drifted, opening/listing/reviewing/merging a proposal could leak a raw validation error instead of reporting an internal stored-row contract issue.
- Fix: `apps/api/src/services/proposals.ts` now validates stored proposal and review rows with `parseOutputContract`, using `proposal.stored` and `proposal.stored-review` contexts.
- Regression test added:
  - `apps/api/src/proposals.test.ts`: `db proposal service wraps stored proposal contract drift as an internal contract error`.
- Red-first evidence:
  - The targeted test first failed because the caught error was a raw Zod issue for `id`. It passed after switching `storedRowsToProposal` to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "db proposal service wraps stored proposal" src/proposals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "DB-backed proposal service maps" src/proposals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed: 45 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - In-memory proposal output contract

- User-visible/proposal finding: the in-memory proposal service assembled review and merge responses with raw schema parsing. In local/test mode, a server-side generated review id or merge snapshot id drift could leak raw validation issues instead of reporting an internal proposal-contract failure.
- Fix: `apps/api/src/services/proposals.ts` now validates in-memory proposal, review, and generated manifest assembly with `parseOutputContract`, using `proposal.memory`, `proposal.memory-review`, and `proposal.manifest` contexts.
- Regression tests added:
  - `apps/api/src/proposals.test.ts`: `proposal service wraps generated manifest drift as an internal contract error`.
  - `apps/api/src/proposals.test.ts`: `in-memory proposal service wraps review output contract drift as an internal contract error`.
  - `apps/api/src/proposals.test.ts`: `in-memory proposal service wraps merge output contract drift as an internal contract error`.
- Red-first evidence:
  - The generated-manifest targeted test first failed with raw Zod issues for `proposal_id` and `branch_id`. It passed after moving manifest ID assembly to the shared output-contract guard.
  - The targeted tests first failed with raw Zod issues for review `id` and merge `merge_snapshot_id`. They passed after moving the in-memory service assembly points to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "generated manifest drift" src/proposals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "in-memory proposal service wraps" src/proposals.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/proposals.test.ts` passed: 48 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Pilot metrics snapshot output contract

- User-visible/pilot finding: the Day 1 pilot metrics builder assembled the admin dashboard snapshot and then used raw schema parsing. If a repository row produced non-finite token/cost math or another server-side snapshot drift, the admin metrics route could leak a raw validation error instead of reporting an internal snapshot-contract failure.
- Fix: `apps/api/src/services/pilot-day1-metrics.ts` now validates the snapshot with `parseOutputContract(..., "pilot.day1-metrics")`.
- Regression test added:
  - `apps/api/src/pilot-day1-metrics.test.ts`: `Day1 metrics snapshot wraps output contract drift as an internal contract error`.
- Red-first evidence:
  - The targeted test first failed because the caught error was a raw Zod issue for `cost.token_in` receiving `NaN`. It passed after moving the snapshot boundary to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Day1 metrics snapshot wraps|Day1 metrics snapshot counts" src/pilot-day1-metrics.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/pilot-day1-metrics.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Gold path surface output contract

- User-visible/page finding: the P0.5 gold-path preview assembled a cross-page surface bundle and then used raw schema parsing. If fixture/productization/localization drifted, the preview route could surface a raw validation issue instead of an internal page-contract failure.
- Fix: `apps/api/src/pages/gold-path.ts` now validates the generated surface with `parseOutputContract(..., "gold-path.surface")`.
- Regression test added:
  - `apps/api/src/gold-path.test.ts`: `P0.5 gold path page wraps surface VM drift as an internal contract error`.
- Red-first evidence:
  - The targeted test first failed with a raw Zod issue for `fixture_id`. It passed after moving the gold-path surface builder to the shared output-contract guard.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "gold path page wraps surface VM drift" src/gold-path.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts` passed: 27 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Merge-fusion LLM JSON extraction

- User-visible/proposal finding: the merge mediator accepted strict JSON or fenced JSON, but a real provider-style response with short surrounding prose and an unfenced JSON object was treated as malformed. That caused otherwise valid AI fusion candidates to disappear, leaving users with weaker merge choices.
- Fix: `apps/api/src/services/merge-fusion-candidates.ts` now extracts the first JSON object from unfenced provider text before applying the existing schema and quality gates.
- Regression test added:
  - `apps/api/src/merge-fusion-candidates.test.ts`: `LLM merge mediator salvages unfenced JSON when providers add surrounding prose`.
- Red-first evidence:
  - The targeted test first failed with `0 !== 1` and logged `Unexpected token '我'`, proving the parser was trying to parse the whole provider message instead of the JSON object. It passed after adding unfenced JSON extraction.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "salvages unfenced JSON" src/merge-fusion-candidates.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/merge-fusion-candidates.test.ts` passed: 13 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Redis push payload normalization

- User-visible/realtime finding: the Redis push bus trusted the embedded `topic` field in a JSON message delivered on a subscribed Redis channel. A stale or external publisher could send a valid JSON payload with the wrong topic, or valid non-object JSON, causing subscribed clients to receive a misleading topic or malformed event shape.
- Fix: `apps/api/src/broker/redis.ts` now normalizes every Redis-delivered event to the subscribed channel topic and only treats object payloads with a string `type` as structured push events; other messages degrade to `{ type: "message", data: raw }`.
- Regression test added:
  - `apps/api/src/broker.test.ts`: `redis bus normalizes malformed and cross-topic payloads before delivery`.
- Red-first evidence:
  - The targeted test first failed because the delivered event kept `topic: "user:someone-else"` while the subscription was for `workitem:w-normalize`. It passed after dispatch normalized by channel.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "normalizes malformed and cross-topic" src/broker.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/broker.test.ts` passed: 10 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Skill curation workspace metering

- User-visible/cost attribution finding: normal agent runs pass `workspace_id` into the measured LLM actor, but default skill-curation distill/refine calls used a generic `skill-curator` actor without the current workspace. In a multi-workspace install, curation spend for another workspace could be metered into the default workspace, so the cost dashboard's self-improvement split and workspace totals would disagree with the workspace actually being curated.
- Fix: `apps/api/src/workers/agent-skill-curation.ts` now creates curation provider adapters that attach `analysis.workspaceId` to the measured actor for both distill and refine calls, while keeping `source: "curation"`.
- Regression test added:
  - `apps/api/src/skill-curation.test.ts`: `curation provider adapters attach the analysis workspace to usage metering actors`.
- Red-first evidence:
  - The targeted test first failed because the production worker exposed no workspace-aware curation provider adapter. It passed after the default scheduler switched distill/refine through the new adapter.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "curation provider adapters attach" src/skill-curation.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/skill-curation.test.ts` passed: 23 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/cost.test.ts src/skill-curation.test.ts` passed: 40 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- apps/api/src/workers/agent-skill-curation.ts apps/api/src/skill-curation.test.ts` passed.

### 2026-07-01 Backend Continuation - Project bootstrap conflict contract

- User-visible/API-client finding: project bootstrap now returns `409 project_slug_occupied` when a same-workspace slug is occupied by an archived/deleted project row, but the OpenAPI document still advertised only `200/201`. Generated clients would treat the recoverable conflict as an undocumented failure instead of showing a clear rename/recover prompt.
- Fix: `apps/api/src/openapi.ts` now documents the `409` error envelope for `POST /api/projects/bootstrap`, including the stable `project_slug_occupied` code.
- Regression test added:
  - `apps/api/src/app.test.ts`: `project OpenAPI routes document list and bootstrap response payloads` now asserts the `409` error envelope.
- Red-first evidence:
  - The targeted test first failed because the `409` response schema was `undefined`. It passed after adding the explicit OpenAPI error response.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 33 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts` passed.

### 2026-07-01 Backend Continuation - Proposal confirmation branch contract

- User-visible/API-client finding: proposal merge and AI-fusion apply intentionally return `409 confirmation_required` with `recoverable: true` when clients send `confirm:false`, but the OpenAPI contract only documented the `200` merge result. Generated clients could miss the confirmation-card branch and treat a normal user-confirmation step as an unknown failure.
- Fix: `apps/api/src/openapi.ts` now documents the `409 confirmation_required` envelope for both `POST /api/proposals/{id}/merge` and `POST /api/merge-proposals/{id}/apply`.
- Regression test added:
  - `apps/api/src/app.test.ts`: `Proposal OpenAPI contracts document review, merge, and conflict action payloads` now asserts the shared confirmation-required response shape.
- Red-first evidence:
  - The targeted OpenAPI test first failed because `POST /api/proposals/{id}/merge` had no `409` response schema. It passed after documenting the recoverable confirmation envelope for both merge entrypoints.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "Proposal OpenAPI contracts" src/app.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/app.test.ts` passed: 33 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-07-01 Backend Continuation - Notification mutation visibility

- User-visible/privacy finding: raw notification lists already hid WorkItem-backed notifications the actor could not read, but the mutation endpoints still accepted the same hidden notification ids by `user_id` alone. A user with a stale/deep-linked notification id could mark it read, dismiss it, complete it, or include it in "mark all read" even though the notification was intentionally absent from their list.
- Fix: `apps/api/src/routes/notifications.ts` now passes the authenticated actor into mark-read, mark-all-read, dismiss, and complete. `apps/api/src/services/notifications.ts` now loads the notification row first, checks the backing WorkItem through the same visibility helper used by `listForUser`, and only then writes. The repository gained `markReadMany` so actor-scoped mark-all-read updates only the visible unread ids.
- Regression tests added:
  - `apps/api/src/notifications-routes.test.ts`: mutation routes pass actor context to the notification service.
  - `apps/api/src/notifications.test.ts`: hidden WorkItem-backed notification mutations reject with `404 not_found` before writes, and mark-all-read updates only the visible unread notification.
- Red-first evidence:
  - The targeted tests first failed with `actor` as `undefined`, hidden mark-read missing the expected rejection, and mark-all-read returning `{ updated: 2 }` instead of `{ updated: 1 }`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "notification mutations reject|notification mark-all-read scopes|notification mutation routes pass actor" src/notifications.test.ts src/notifications-routes.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts src/notifications-routes.test.ts` passed: 19 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db test` passed: 55 tests.

### 2026-07-01 Backend Continuation - Cost workspace-scoped user usage

- User-visible/billing finding: `/api/cost/usage` and the non-admin cost dashboard scoped team usage to the actor workspace, but user-scope ledger entries were still read by `userId` alone. A user active in two workspaces would see the other workspace's AI spend inflate the current workspace "me" budget card and personal dashboard totals.
- Fix: `packages/cost/src/ledger.ts` and `packages/db/src/repositories/cost-ledger.ts` now narrow `listEntriesForScopes` and `usageSnapshots` through workspace-owned team/curation ledger entries whenever `teamId` is present. `apps/api/src/routes/pages.ts` now uses workspace-scoped ledger reads for non-admin dashboard entries and keeps the existing fail-closed behavior when that read is unavailable.
- Regression tests added:
  - `apps/api/src/cost.test.ts`: `/api/cost/usage` now keeps `me.token_in` at the actor workspace amount when the same user has usage in another workspace.
  - `apps/api/src/cost.test.ts`: `/api/pages/cost` now keeps non-admin personal totals scoped to the current workspace even when the same user spent tokens elsewhere.
- Red-first evidence:
  - The targeted tests first failed with `me.token_in` reported as `340000` instead of `120000`, and dashboard `total_cost_cny` reported as `0.146` instead of `0.006`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "actor workspace for team budget usage|without exposing all users" src/cost.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/cost.test.ts` passed: 17 tests.
  - `pnpm --filter @workhub/cost test` passed: 22 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db test` passed: 55 tests.
  - `pnpm --filter @workhub/cost typecheck` passed.

### 2026-07-01 Backend Continuation - AgentRun final claim fencing

- User-visible/workflow finding: the runner already fenced DB writes by `claimedBy`, but `AgentRunPersistence.updateRun` did not surface whether the final `succeeded/failed` write actually matched the current worker. If a lease was recovered between loop completion and proposal opening, the stale worker could ignore the final write no-op and still create a proposal / emit follow-up side effects.
- Fix: `AgentRunPersistence.updateRun` may now return `false` for a fenced no-op. `createDbAgentRunPersistence` maps the repository update result to that boolean, and `executeRun` treats a false final/failure persist as worker drift: it reloads persisted state, skips proposal/confidence/notification side effects, and skips budget reconciliation for the stale worker.
- Regression test added:
  - `apps/api/src/agent-runs.test.ts`: `agent run does not open a proposal when final persistence loses the claim`.
- Red-first evidence:
  - The targeted test first failed with one proposal opened after the fake final fenced update returned no-op.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "final persistence loses the claim" src/agent-runs.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 59 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "final persistence loses the claim|abort does not overwrite" src/agent-runs.test.ts` passed: 2 tests.

### 2026-07-01 Backend Continuation - Work-item-less approval inbox boundary

- User-visible/privacy finding: WorkItem-backed approvals can be scoped through WorkItem visibility, but `approval_requests` itself has no org/workspace columns. Admin `includeAll` approval reads therefore had no reliable tenant boundary for work-item-less approvals and could list or decide another user's tool/permission approval by id.
- Fix: `ApprovalService.listPendingForUser` now keeps work-item-less approvals visible only to their `routedToUserId`, while still allowing admins to see WorkItem-backed approvals through the existing WorkItem visibility gate. `apps/api/src/routes/approvals.ts` applies the same rule to direct respond/delegate/comment routes, and service-level action ownership no longer lets admins override work-item-less approvals routed to another user.
- Regression test added:
  - `apps/api/src/approvals.test.ts`: `approval routes keep work-item-less approvals in the routed user's inbox even for admins`.
- Red-first evidence:
  - The targeted test first failed because the admin approval list included both the current user's approval and another user's work-item-less approval.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "work-item-less approvals in the routed user's inbox" src/approvals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 54 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/pages-i18n.test.ts src/gold-path.test.ts` passed: 30 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - AgentRun kickoff rollback

- User-visible/workflow finding: the AgentRun start route enqueued a run and then tried to push the WorkItem from `spec_ready` to `ai_working`. If that kickoff status write threw, the route only warned and returned `202`; a later successful run would still be unable to move `spec_ready` directly to `in_review`, leaving the user's item visually stuck.
- Fix: `apps/api/src/routes/agent-runs.ts` now treats kickoff writer exceptions as startup failures: it cancels the just-queued run with the same authenticated actor, returns `503`, and skips auto-run pumping.
- Regression test added:
  - `apps/api/src/agent-runs.test.ts`: `agent run route cancels the queued run when kickoff status transition fails`.
- Red-first evidence:
  - The targeted test first failed because the route returned `202` after logging `WorkHub agent-run kickoff status transition failed`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "kickoff status transition fails" src/agent-runs.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 60 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Proposal review workspace boundary

- User-visible/privacy finding: the attention home proposal-review queue reused WorkItem/project joins, but the page route passed only `currentUser` into `listReviewableForUser`. Admin users therefore queried `includeAll` without the actor workspace context, so review cards for AI-delivered proposals in another workspace could appear in the current workspace home queue.
- Fix: `apps/api/src/routes/pages.ts` now passes `{ id, isAdmin, workspaceId }` from the authenticated actor into the proposal review lookup. `apps/api/src/services/proposals.ts` preserves that workspace id through the service boundary, and `packages/db/src/repositories/proposals.ts` filters `listReviewable` by matching `workItems.workspaceId` or the joined `projects.workspaceId`.
- Regression tests added:
  - `apps/api/src/gold-path.test.ts`: `attention home scopes proposal review lookup to the actor workspace`.
  - `packages/db/src/proposals-repository.test.ts`: `proposal review queue stays scoped to the actor workspace`.
- Red-first evidence:
  - The page-route test first failed with `captured.user.workspaceId === undefined`.
  - The DB guard first failed because `listReviewable` contained no `input.workspaceId` condition.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "attention home scopes proposal review lookup" src/gold-path.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-name-pattern "proposal review queue stays scoped" src/proposals-repository.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts src/proposals.test.ts` passed: 77 tests.
  - `pnpm --filter @workhub/db test` passed: 56 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `git diff --check -- apps/api/src/routes/pages.ts apps/api/src/services/proposals.ts packages/db/src/repositories/proposals.ts apps/api/src/gold-path.test.ts packages/db/src/proposals-repository.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-07-01 Backend Continuation - Attention active-run workspace boundary

- User-visible/privacy finding: attention home `background_runs` used `actor.isAdmin || run.actor_id === actor.id` without first checking `run.workspace_id`. Since AgentRun records now carry workspace metadata, admins or the same human user active in multiple workspaces could see in-progress AI runs from another workspace on the current home page.
- Fix: `apps/api/src/routes/pages.ts` now filters active runs by `run.workspace_id === actor.workspaceId` before applying admin/owner visibility. Workspace-less legacy in-memory/old persisted runs remain visible for the rolling single-tenant path.
- Regression test added:
  - `apps/api/src/gold-path.test.ts`: `attention home background runs stay scoped to the actor workspace for admins`.
- Red-first evidence:
  - The targeted test first failed because `background_runs` contained both the current workspace run and the foreign workspace run.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "background runs stay scoped" src/gold-path.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/gold-path.test.ts src/proposals.test.ts` passed: 77 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- apps/api/src/routes/pages.ts apps/api/src/services/proposals.ts packages/db/src/repositories/proposals.ts apps/api/src/gold-path.test.ts packages/db/src/proposals-repository.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-07-01 Backend Continuation - Drive owner workspace boundary

- User-visible/privacy finding: `canViewProjectDrive` checked project ownership before tenant scope. A user who owned a project in workspace A but was currently acting in workspace B could still open that project Drive, and `canManageProjectDrive` then allowed upload/delete flows to reach the Drive repository.
- Fix: `packages/permissions/src/resource-permissions.ts` now requires project org/workspace scope before ordinary owner/member Drive access. Admin read breadth remains unchanged, but admin writes and non-admin owner/member reads/writes must match the active workspace.
- Regression tests added:
  - `packages/permissions/src/permissions.test.ts`: `drive project gate allows owner/admin only inside the active workspace`.
  - `apps/api/src/drive-pages.test.ts`: `drive page service blocks owner writes from another workspace`.
- Red-first evidence:
  - The permissions test first failed because cross-workspace owner Drive access returned `true`.
  - The Drive service test first failed because the cross-workspace owner upload reached the repository.
- Verification after fix:
  - `pnpm --filter @workhub/permissions test` passed: 13 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed: 54 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/project-home-pages.test.ts src/meeting-pages.test.ts src/drive-pages.test.ts` passed: 85 tests.
  - `pnpm --filter @workhub/permissions typecheck` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- packages/permissions/src/resource-permissions.ts packages/permissions/src/permissions.test.ts apps/api/src/drive-pages.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-07-01 Backend Continuation - AgentRun direct-route workspace boundary

- User-visible/privacy/control finding: AgentRun detail, trace, handoff, replay, and abort routes used `run.actor_id === actor.id || actor.isAdmin` before checking `run.workspace_id`. The same user or an admin currently acting in workspace B could read or cancel a run that belongs to workspace A.
- Fix: `apps/api/src/routes/agent-runs.ts` now checks run org/workspace scope before owner/admin shortcuts and before WorkItem read/mutation fallback. Workspace-less legacy runs keep the prior single-tenant compatibility path.
- Regression test added:
  - `apps/api/src/agent-runs.test.ts`: `agent run direct routes stay scoped to the actor workspace`.
- Red-first evidence:
  - The targeted test first failed because the owner request to `/api/agent-runs/:id` returned `200` instead of `403`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "agent run direct routes stay scoped" src/agent-runs.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/agent-runs.test.ts` passed: 61 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- apps/api/src/routes/agent-runs.ts apps/api/src/agent-runs.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-07-01 Backend Continuation - AgentRun SSE workspace boundary

- User-visible/privacy/control finding: the Push/SSE default topic resolver for `/api/push/stream/run/:id` still used the owner/admin shortcut without first comparing the run workspace. That meant the direct run HTTP routes could be scoped correctly while the live run stream still opened for the same user or admin acting in another workspace.
- Fix: `apps/api/src/routes/push.ts` now checks `run.workspace_id` / `run.org_id` against the resolved stream user before owner/admin or WorkItem fallback stream access.
- Regression test added:
  - `apps/api/src/push.test.ts`: `push route run streams stay scoped to the actor workspace`.
- Red-first evidence:
  - The targeted test first failed because the cross-workspace owner stream request returned `200` instead of `403`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "push route run streams stay scoped" src/push.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/push.test.ts` passed: 12 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- apps/api/src/routes/push.ts apps/api/src/push.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-07-01 Backend Continuation - AI clarification fallback body removal

- User-visible UX finding: the clarification draft normalizer treated missing optional LLM fields as a reason to fill in local fallback body/placeholder copy. A valid LLM-generated title-only clarification therefore rendered as an AI question with preset explanatory prose, recreating the "template bubble" experience even after provider-backed material analysis was required.
- Fix: `apps/api/src/services/work-items.ts` now uses fallback only when the entire draft is invalid or absent. Valid generated/stored drafts preserve their own optional `body` and `placeholder` fields without local template fill.
- Regression test added:
  - `apps/api/src/work-items-service.test.ts`: `persistent intake does not fill AI clarification drafts with fallback template body text`.
- Red-first evidence:
  - The targeted test first failed because the session question body contained the generated fallback prose starting with `需求：请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "persistent intake does not fill AI clarification drafts" src/work-items-service.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` passed: 36 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "AI clarification|session clarification|confirm-step|session next-question" src/gold-path.test.ts` passed: 13 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "persistent intake|session clarification answer|assigned lead can continue" src/work-items-service.test.ts` passed: 11 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Drive accepted-deliverable assigned-lead restore link

- User-visible project/Drive finding: the Drive page hid accepted-deliverable `restore_href` for an assigned lead because its local restorable-link check only recognized project owner, submitter, claimer, or admin. The WorkItem restore endpoint already uses assignment-aware artifact mutation access, so the UI could render a read-only Drive surface even when the same user could restore the official deliverable through the direct endpoint.
- Fix: `apps/api/src/services/drive-pages.ts` now includes `ASSIGNMENT_ROLES` when calculating accepted-deliverable restorable link access, matching the WorkItem artifact mutation gate.
- Regression test added:
  - `apps/api/src/drive-pages.test.ts`: `drive page service shows accepted-deliverable restore links for assigned leads`.
- Red-first evidence:
  - The targeted test first failed because the assigned lead's accepted-deliverable `restore_href` was `undefined`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "assigned leads" src/drive-pages.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "accepted-deliverable restore links|assigned users can open|restore requires artifact mutation|read but cannot mutate" src/drive-pages.test.ts src/work-items-service.test.ts` passed: 5 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/drive-pages.test.ts` passed: 55 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `git diff --check -- apps/api/src/services/drive-pages.ts apps/api/src/drive-pages.test.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed.

### 2026-07-01 Backend Continuation - Meeting source draft assigned-lead proposal action

- User-visible project/meeting finding: WorkItem detail could expose the meeting source `create_proposal_draft` action to an assigned lead through artifact-mutation access, but `MeetingPageService.draftToProposal` then required project meeting manage rights again. The result was a dead action: the user could see the proposal-generation path from the WorkItem, then hit `meeting_forbidden` on click.
- Fix: `apps/api/src/services/meeting-pages.ts` now verifies that the source meeting insight is readable before generating the proposal, while the authoritative WorkItem artifact mutation gate remains the write permission for proposal creation. Direct meeting insight actions (`insightToDraft` and `dismissInsight`) still require project meeting manage rights.
- Regression test added:
  - `apps/api/src/meeting-pages.test.ts`: `meeting draftToProposal lets assigned work item leads create the proposal without project meeting manage rights`.
- Red-first evidence:
  - The targeted test first failed with `meeting_forbidden` from `ensureCanManageInsight`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "without project meeting manage rights" src/meeting-pages.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "meeting draftToProposal|meeting insight mutation|draft proposal route" src/meeting-pages.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/meeting-pages.test.ts` passed: 16 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Dismissed source proposal action visibility

- User-visible workflow finding: WorkItem detail exposed `create_proposal_draft` whenever a source context existed and no proposal had been created. If the original Drive comment or meeting insight had already been dismissed, the user could still see a "生成变更提议" button that only led to a recoverable 409 instead of a useful next step.
- Fix: `apps/api/src/services/work-items.ts` now only emits the source proposal action when the source can still be converted: Drive sources are hidden once dismissed, and meeting sources must be confirmed. Existing backend guards still reject stale direct calls.
- Regression test added:
  - `apps/api/src/work-items-service.test.ts`: `work item detail hides source proposal actions after the source was dismissed`.
- Red-first evidence:
  - The targeted test first failed because `actions.create_proposal_draft` contained `/api/drive/workitems/:id/proposal-draft` even though the source status was `dismissed`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "source proposal actions after the source was dismissed" src/work-items-service.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts` passed: 37 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/work-items-service.test.ts src/drive-pages.test.ts src/meeting-pages.test.ts` passed: 108 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Work-item-less approval mention visibility

- User-visible approval finding: approval comments could notify an admin mentioned on a work-item-less approval, but approval routes intentionally keep those approvals in the routed user's personal inbox because there is no org/workspace tenant column. The admin would receive a notification pointing at `/approvals/:id` and then hit 403.
- Fix: `apps/api/src/services/approvals.ts` now sends work-item-less approval mention notifications only to the routed user. WorkItem-backed approval mentions still use the WorkItem visibility gate.
- Regression test added:
  - `apps/api/src/approvals.test.ts`: `approval comment mention skips admins who cannot open a work-item-less approval`.
- Red-first evidence:
  - The targeted test first failed because a mention notification was created for the admin with `targetUrl: /approvals/:id`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "skips admins who cannot open a work-item-less approval" src/approvals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 56 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Approval creation missing WorkItem guard

- User-visible approval finding: service-level approval creation checked routed-user visibility only when `findWorkItemAccessRecord(workItemId)` returned a row. If the WorkItem id was stale or missing, it still created a pending approval that later page/route visibility gates would hide or reject, leaving an approval nobody could use.
- Fix: `apps/api/src/services/approvals.ts` now treats a missing WorkItem access record as `no_approver` escalation, matching the existing "routed user cannot view this WorkItem" behavior and avoiding orphaned approval rows.
- Regression test added:
  - `apps/api/src/approvals.test.ts`: `ask escalates when the approval work item no longer exists`.
- Red-first evidence:
  - The targeted test first failed with `outcome: "pending"` and one approval row written.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "approval work item no longer exists" src/approvals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "skips admins who cannot open|routed user cannot view|work-item-less approvals" src/approvals.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/approvals.test.ts` passed: 56 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Project-only notification workspace boundary

- User-visible notification finding: raw notification list visibility only checked `work_item_id`. Notifications that carried a `project_id` but no WorkItem could appear in a user's current workspace even when the project belonged to another workspace, producing a clickable project link that later failed at the project/Drive gate.
- Fix: `apps/api/src/services/notifications.ts` now filters project-only notification rows through `canViewProjectDrive` using `findProjectById`, while WorkItem-backed notifications continue to use the WorkItem visibility gate.
- Regression test added:
  - `apps/api/src/notifications.test.ts`: `notification list hides project-only notifications outside the actor workspace`.
- Red-first evidence:
  - The targeted test first failed with `counts.total === 1` for a foreign-workspace project-only notification.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "project-only notifications outside" src/notifications.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts src/notifications-routes.test.ts` passed: 20 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Notification read-all pagination

- User-visible notification finding: `/api/notifications/read-all` with actor filtering only loaded the first 500 notifications before applying visibility. Users with more than 500 visible unread notifications could click "read all" and still see unread count/red-dot residue from older visible rows.
- Fix: `packages/db/src/repositories/notifications.ts` now supports unread-only cursor pagination with stable `created_at,id` ordering, and `apps/api/src/services/notifications.ts` loops through unread pages while mutating only rows visible to the actor.
- Regression test added:
  - `apps/api/src/notifications.test.ts`: `notification mark-all-read reaches visible unread notifications beyond the first page`.
- Red-first evidence:
  - The targeted test first failed with `updated: 500` when 501 visible unread notifications existed.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "beyond the first page" src/notifications.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test src/notifications.test.ts src/notifications-routes.test.ts` passed: 21 tests.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm exec node --import tsx --test 'src/*.test.ts'` from `packages/db` passed: 56 tests.

### 2026-07-01 Backend Continuation - Drive recycle restore off-slice name conflict

- User-visible Drive finding: the recycle-bin page could show `restore_href` for a deleted file/folder when an active same-name sibling existed outside the loaded page slice. Clicking that restore button would then fail with `drive_name_conflict`, so the UI promised an action the repository would never accept.
- Fix: `packages/db/src/repositories/drive.ts` now returns `restoreBlockedItemIds` by checking each loaded deleted item against the full active sibling set, and `apps/api/src/services/drive-pages.ts` suppresses restore links for those blocked rows.
- Regression test added:
  - `apps/api/src/drive-pages.test.ts`: `drive page service hides restore links when the repository reports an off-slice active sibling conflict`.
- Red-first evidence:
  - The targeted test first failed because the deleted row exposed `/api/drive/projects/:projectId/items/:itemId/restore` even though the active sibling was outside the loaded `items` array.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern "restore links|off-slice active sibling|active sibling already" src/drive-pages.test.ts` passed: 5 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/drive-pages.test.ts` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` from `packages/db` passed.

### 2026-07-01 Backend Continuation - Project Health actor-scoped source reads

- User-visible project-management finding: Project Health read global recent projects/items first, applied fixed limits, and only then filtered by the current actor. A regular member could therefore miss their own older workspace project or assigned private work if newer inaccessible projects/items consumed the repository slice first.
- Fix: `apps/api/src/services/project-health-pages.ts` now passes actor scope to `ProjectHealthRepository`, and `packages/db/src/repositories/project-health.ts` filters projects, open work items, pending approvals, failed runs, and pending insights by actor workspace/work-item visibility before applying limits. Assigned private work is also carried through the source rows so service-level permission checks match the repository prefilter.
- Regression tests added:
  - `apps/api/src/project-health-pages.test.ts`: `project health page requests actor-scoped sources before repository limits are applied`.
  - `packages/db/src/project-health.test.ts`: `project health repository applies actor visibility before source limits`.
- Red-first evidence:
  - The targeted service test first failed with `summary.project_count` equal to 0 because the repository was called without actor scope.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec src/project-health-pages.test.ts` passed: 4 tests.
  - `pnpm exec node --import tsx --test --test-reporter=spec src/project-health.test.ts` from `packages/db` passed: 1 test.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/project-health-pages.test.ts src/drive-pages.test.ts src/notifications.test.ts src/notifications-routes.test.ts src/approvals.test.ts src/work-items-service.test.ts src/meeting-pages.test.ts` passed.
  - `pnpm exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` from `packages/db` passed.

### 2026-07-01 Backend Continuation - Accepted deliverable parsed-text fallback

- User-visible deliverable finding: WorkItem accepted-deliverable preview/download returned `deliverable_file_missing` when the indexed local storage file was gone, even if the accepted Drive version still retained `parsedText`. Drive preview already tolerated that case, so official deliverables behaved worse than regular Drive files.
- Fix: `apps/api/src/services/work-items.ts` now returns `parsedText` from `acceptedDeliverableFile`, and `apps/api/src/routes/workitems.ts` reads official deliverables through a shared helper that falls back to `parsedText` for preview/download. Rows without any stored content still return the existing 404.
- Regression test added:
  - `apps/api/src/workitems.test.ts`: `accepted deliverable routes fall back to parsed text when the indexed storage file is missing`.
- Red-first evidence:
  - The targeted route test first failed with preview status 404 instead of 200.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "fall back to parsed text" src/workitems.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/workitems.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "accepted deliverable|deliverable" src/work-items-service.test.ts src/accepted-deliverables.test.ts` passed: 5 tests.

### 2026-07-01 Backend Continuation - Admin project reads org fence

- User-visible project-management finding: admin project/Drive/home/health reads were broader than the product tenant model. An admin could pass the workspace check for a project outside their organization and see project/Drive/health surfaces that should belong to another tenant.
- Fix: `packages/permissions/src/resource-permissions.ts` now requires admin project reads to stay inside the same org, and DB repository project lookups now carry `orgId` through project home, project health, Drive, and schedule/notify access checks.
- Regression tests added:
  - `packages/permissions/src/permissions.test.ts`: same-org admin project Drive read remains allowed; cross-org admin project Drive read is denied.
  - `apps/api/src/project-home-pages.test.ts`: `project home blocks admins from opening a project in another org`.
  - `apps/api/src/project-health-pages.test.ts`: `project health page does not expose another org's project to an admin`.
- Verification after fix:
  - `pnpm --filter @workhub/permissions exec node --import tsx --test --test-reporter=spec --test-name-pattern "drive project gate" src/permissions.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "another org|another org's project" src/project-home-pages.test.ts src/project-health-pages.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/db typecheck`, `pnpm --filter @workhub/api typecheck`, and the focused permission/API page suites passed.

### 2026-07-01 Backend Continuation - Parsed-text download completeness

- User-visible deliverable/Drive finding: the parsed-text fallback is acceptable for preview, but unsafe for downloads unless it represents the full stored file. A user downloading an official deliverable or Drive file could receive truncated indexed text and believe it was the original artifact.
- Fix: Drive versions now expose `sizeBytes` and `sha256` to the route layer. Preview keeps tolerant parsed-text fallback, while download requires the parsed fallback byte length and sha to match the indexed version before returning bytes.
- Regression tests added:
  - `apps/api/src/drive-pages.test.ts`: `drive ordinary file download rejects incomplete parsed text fallback`.
  - `apps/api/src/workitems.test.ts`: `accepted deliverable download rejects incomplete parsed text fallback`.
- Red-first evidence:
  - Both targeted tests first failed with 200 responses for incomplete parsed text.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "parsed text|incomplete parsed text" src/drive-pages.test.ts src/workitems.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Accepted deliverable restore recycled item guard

- User-visible deliverable finding: restoring an official deliverable could choose a previous accepted version whose Drive item was already recycled, creating a current accepted row that pointed to a deleted Drive item.
- Fix: `packages/db/src/repositories/work-items.ts` now only considers previous accepted versions whose backing Drive item still exists and is not deleted.
- Regression test added:
  - `packages/db/src/drive-path.test.ts`: `accepted deliverable restore does not choose a previous version from a recycled drive item`.
- Red-first evidence:
  - The source-level repository test first failed because the restore query lacked the deleted-item guard.
- Verification after fix:
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=spec --test-name-pattern "recycled drive item" src/drive-path.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/db typecheck` passed.

### 2026-07-01 Backend Continuation - Recycle-bin child restore deleted-parent guard

- User-visible Drive finding: the recycle bin could show a child `restore_href` when the deleted parent folder was outside the loaded page slice. Clicking it would later fail because the parent folder was still deleted.
- Fix: `packages/db/src/repositories/drive.ts` now checks each loaded deleted item's parent row directly and blocks restore links when the parent is missing or still deleted, even if that parent is not present in the current page slice.
- Regression test added:
  - `packages/db/src/drive-path.test.ts`: `drive page readPage blocks child restore links when the deleted parent is outside the loaded slice`.
- Red-first evidence:
  - The targeted test first failed because only active same-name siblings were considered.
- Verification after fix:
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=spec --test-name-pattern "deleted parent is outside|recycled drive item" src/drive-path.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/db typecheck` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/drive-pages.test.ts` passed.

### 2026-07-01 Backend Continuation - Notification project visibility and pagination

- User-visible notification finding: notifications with a visible project but unreadable WorkItem were dropped entirely, so useful project reminders disappeared. The list also applied repository caps before actor filtering, so hidden rows could starve older visible notifications and skew visible counts.
- Fix: `apps/api/src/services/notifications.ts` now keeps project-visible notifications while stripping unreadable WorkItem ids, drops truly unreadable project-only rows, and scans repository pages until enough visible rows are collected for the requested list window.
- Regression tests added:
  - `apps/api/src/notifications.test.ts`: `notification list keeps visible project notifications while stripping unreadable work item ids`.
  - `apps/api/src/notifications.test.ts`: `notification list scans past capped hidden rows to find older visible notifications`.
- Red-first evidence:
  - Both targeted tests first failed with empty visible results.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "visible project notifications|scans past capped" src/notifications.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/notifications.test.ts src/notifications-routes.test.ts` passed.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Delegated approval timeline current step

- User-visible approval finding: delegated pending approvals rendered two current timeline steps, `routed` and `delegated`, making the next owner/action ambiguous in the approval center.
- Fix: `apps/api/src/services/approvals.ts` now marks `routed` as done once `delegatedToUserId` exists; only the delegated step remains current for a pending delegated approval.
- Regression test added:
  - `apps/api/src/approvals.test.ts`: `delegated pending approval timeline marks only delegated as current`.
- Red-first evidence:
  - The targeted test first failed because current steps were `["routed", "delegated"]`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "delegated pending approval timeline" src/approvals.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Drive accepted-deliverable unreadable detail rows

- User-visible Drive finding: when a project Drive viewer could not open the private backing WorkItem for an accepted deliverable, the page removed download/preview/restore links but still exposed the accepted-deliverable row and `work_item_id`. The user saw a formal-deliverable detail record that could not be opened.
- Fix: `apps/api/src/services/drive-pages.ts` now filters unreadable accepted-deliverable rows out of the visible VM and uses the current actor's visible count for `accepted_deliverable_count`. The underlying file still remains protected and is not downgraded to ordinary file download/preview links.
- Regression test added:
  - `apps/api/src/drive-pages.test.ts`: `drive page service hides unreadable accepted deliverable rows without exposing ordinary file downloads`.
- Red-first evidence:
  - The targeted test first failed with `accepted_deliverables.length === 1` for an unreadable private WorkItem-backed deliverable.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "unreadable accepted deliverable rows" src/drive-pages.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "accepted-deliverable|accepted deliverable|unreadable accepted|backing work item" src/drive-pages.test.ts` passed: 7 tests.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Protected accepted file delete action

- User-visible Drive finding: after hiding unreadable accepted-deliverable detail rows, the ordinary file row could still expose a delete action for a protected accepted file. The API would later reject the action, so the page promised a destructive operation the user could not perform.
- Fix: `apps/api/src/services/drive-pages.ts` now excludes protected accepted files from manual delete candidates, matching the existing preview/download protection.
- Regression test extended:
  - `apps/api/src/drive-pages.test.ts`: `drive page service hides unreadable accepted deliverable rows without exposing ordinary file downloads` now also verifies no ordinary delete action is exposed for the protected file.
- Red-first evidence:
  - The targeted test first failed because `items[1].delete_href` contained `/api/drive/projects/:projectId/items/:itemId/delete`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "unreadable accepted deliverable rows" src/drive-pages.test.ts` passed: 1 test.

### 2026-07-01 Backend Continuation - Project Health hidden/deleted source rows

- User-visible project-health finding: Health sources could still include pending approvals for soft-deleted WorkItems, failed runs for terminal/deleted WorkItems, and actor-invisible rows that consumed the source limit before visible work was considered.
- Fix: `packages/db/src/repositories/project-health.ts` now applies project and actor visibility before source limits, and filters pending approvals / failed runs to existing non-deleted WorkItems with actionable statuses.
- Regression test added:
  - `packages/db/src/project-health.test.ts`: `project health repository scopes work-item signal sources by project before limits`.
- Red-first evidence:
  - The targeted source-level test first failed because the pending-approval and failed-run source queries did not include the deleted/terminal guards.
- Verification after fix:
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=spec src/project-health.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/db typecheck` passed.

### 2026-07-01 Backend Continuation - Notification action response redaction

- User-visible notification finding: the list view correctly stripped unreadable WorkItem ids from project-visible notifications, but action responses such as mark-read rebuilt the notification response from the raw row and could re-expose the private WorkItem id.
- Fix: `apps/api/src/services/notifications.ts` now routes notification mutations through the same visibility metadata used by list responses and preserves WorkItem redaction in mark-read, dismiss, and complete results.
- Regression test added:
  - `apps/api/src/notifications.test.ts`: `notification mark-read keeps visible project notifications redacted when work item is unreadable`.
- Red-first evidence:
  - The targeted test first failed because the mark-read response returned the private `work_item_id`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "mark-read keeps visible project" src/notifications.test.ts` passed: 1 test.

### 2026-07-01 Backend Continuation - Calendar soft-deleted WorkItem dead links

- User-visible schedule finding: calendar events linked to soft-deleted WorkItems could still show a WorkItem target link, leading the user to a page that cannot load that work item.
- Fix: `packages/db/src/repositories/schedule-notify.ts` no longer hydrates deleted WorkItems for schedule events, and `apps/api/src/services/schedule-notify-pages.ts` treats a deleted WorkItem as not viewable before emitting target links.
- Regression test added:
  - `apps/api/src/schedule-notify-pages.test.ts`: `calendar schedule events do not expose dead work-item links for soft-deleted work`.
- Red-first evidence:
  - The targeted test first failed because `target_href` was `/workitems/:id`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "soft-deleted work|dead work-item links|assigned private work item|merged work items" src/schedule-notify-pages.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/db typecheck` passed.

### 2026-07-01 Backend Continuation - Notifications page summary pagination

- User-visible notification finding: `/api/pages/notifications` summary counted only the first repository page. A user with more than 200 visible notifications could see a stale summary even though list pagination could reach the older rows.
- Fix: `apps/api/src/services/schedule-notify-pages.ts` now scans notification pages for the summary using the same cursor model instead of relying on one capped read.
- Regression test added:
  - `apps/api/src/schedule-notify-pages.test.ts`: `notifications page summary scans past the first repository page`.
- Red-first evidence:
  - The targeted test first failed with `summary.total === 200` instead of 201.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "summary scans past" src/schedule-notify-pages.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-01 Backend Continuation - Drive pending comments beyond newest slice

- User-visible Drive finding: Drive summary counted all `pending_llm` comments, but the page loaded only the newest 50 comments. If the only pending comment was older than that slice, the page could show a pending count without any visible review action.
- Fix: `packages/db/src/repositories/drive.ts` now backfills pending comments into the page rows after the normal newest-comment load and deduplicates by comment id, keeping the regular list bounded while preserving a reachable action.
- Regression test added:
  - `packages/db/src/drive-path.test.ts`: `drive page readPage backfills pending comments beyond the newest comment slice`.
- Red-first evidence:
  - The targeted test first failed because `readPage` kept the initial comment slice as `comments` and never backfilled pending rows.
- Verification after fix:
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=spec --test-name-pattern "pending comments beyond" src/drive-path.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/db typecheck` passed.

### 2026-07-01 Backend Continuation - Agent run kickoff and replay attribution

- User-visible AgentRun finding: a non-startable WorkItem could still enqueue an AI run when kickoff status did not actually transition, leaving the user with a run card for work that should not have started.
- Fix: `apps/api/src/routes/agent-runs.ts` now treats a kickoff no-op as `409 agent_run_not_startable`, aborts the queued run, and keeps the WorkItem lifecycle honest.
- User-visible replay finding: replay merge timelines included manual/legacy proposals with no source run id, so a user reviewing one AI run could see unrelated merge work attributed to that run.
- Fix: replay merge timelines now include only proposals whose explicit `sourceAgentRunId` / proposal `agentRunId` equals the replayed run id.
- Regression tests added/extended:
  - `apps/api/src/agent-runs.test.ts`: `agent run route rejects queued work when kickoff status does not transition`.
  - `apps/api/src/agent-runs.test.ts`: `agent run replay merge timeline only includes proposals opened by that run`.
- Red-first evidence:
  - Kickoff no-op first returned `202`.
  - Replay first included a no-run-source proposal id in `merge_timeline`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "kickoff status does not transition|route kickoff moves work item|kickoff status transition fails" src/agent-runs.test.ts` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "merge timeline only includes proposals opened by that run|records trace for replay" src/agent-runs.test.ts` passed: 2 tests.

### 2026-07-01 Backend Continuation - Proposal duplicate merge events

- User-visible proposal finding: re-submitting merge on an already merged proposal could republish `proposal.merged` / notification events, making other clients believe a fresh merge happened.
- Fix: `apps/api/src/routes/proposals.ts` now returns `409 proposal_already_merged` before body parsing or event publishing when the proposal is already merged.
- Regression test added:
  - `apps/api/src/proposals.test.ts`: `proposal merge does not republish events when the proposal is already merged`.
- Red-first evidence:
  - The second merge first returned `200` and emitted duplicate merge/notification events.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "already merged|review and merge publish|approved proposal can be merged" src/proposals.test.ts` passed: 3 tests.

### 2026-07-01 Backend Continuation - Accepted deliverable restore accuracy

- User-visible accepted-deliverable finding: restore controls appeared even when no restorable previous accepted version existed, and stale accepted-deliverable ids could degrade to generic 404 instead of telling the user the version changed.
- Fix: `packages/db/src/repositories/work-items.ts` and `packages/db/src/repositories/drive.ts` now attach explicit `canRestore` state, skip recycled previous drive items, and return `deliverable_version_changed` for superseded stale restore ids.
- Regression tests added:
  - `packages/db/src/drive-path.test.ts`: `accepted deliverable restore reports a superseded current id as version changed`.
  - `packages/db/src/drive-path.test.ts`: `accepted deliverable reads attach explicit restore availability`.
  - `apps/api/src/accepted-deliverables.test.ts`: `accepted deliverable VM hides restore when the repository marks it non-restorable`.
- Red-first evidence:
  - Stale restore first had no stale-row detection.
  - Accepted-deliverable reads first exposed no restore availability metadata.
- Verification after fix:
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=spec --test-name-pattern "superseded current id|recycled drive item|accepted deliverable restore" src/drive-path.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec src/accepted-deliverables.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "accepted-deliverable|accepted deliverable|restore links|restore href" src/drive-pages.test.ts src/work-items-service.test.ts src/workitems.test.ts` passed: 20 tests.

### 2026-07-01 Backend Continuation - Push/SSE and session stream honesty

- User-visible SSE finding: `/api/push/stream/*` wrote the `connected` frame before `bus.subscribe(topic)` completed. A status event emitted during that gap could be lost while the client already believed it was live.
- Fix: `apps/api/src/sse/stream.ts` now subscribes first, then writes `connected`.
- User-visible status finding: abort and stale-claim recovery updated run state without publishing a run-stream status event, so progress cards could remain stale until a later poll.
- Fix: `apps/api/src/workers/agent-runner.ts` now publishes `agent_run.step` status events for cancelled, requeued, and dead-lettered runs.
- User-visible session finding: session VMs advertised `stream_href`, but `/api/sessions` and `/next-question` did not publish any session event after generating or changing the clarification question.
- Fix: `apps/api/src/routes/sessions.ts` now publishes `session.question` to `session:<sessionId>` with only visible status metadata (`session_id`, `work_item_id`, `question_id`, `input_mode`, active progress key/label), not model reasoning.
- Regression tests added:
  - `apps/api/src/push.test.ts`: `SSE connected frame is emitted only after the topic subscription is ready`.
  - `apps/api/src/agent-runs.test.ts`: `agent run abort publishes a cancelled status event to the run stream`.
  - `apps/api/src/agent-runs.test.ts`: `agent run recovery publishes a requeued status event to the run stream`.
  - `apps/api/src/gold-path.test.ts`: `session route publishes generated questions to the advertised session stream`.
  - `packages/contracts/src/contracts.test.ts`: event enum now covers `session.question`.
- Red-first evidence:
  - SSE test first received a frame before the gated subscribe resolved.
  - Abort/recovery tests first found no `agent_run.step` event.
  - Session test first captured zero published events.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "connected frame is emitted only after the topic subscription is ready|connected frame advertises fresh|presence.touchUser|cleanup closes presence" src/push.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "abort publishes a cancelled status event|abort releases reserved budget|recovery publishes a requeued status event|requeues expired persistent claims" src/agent-runs.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "session route publishes generated questions|session clarification question is generated|session route preserves AI clarification|next-question" src/gold-path.test.ts` passed: 6 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/agent-runs.test.ts src/push.test.ts src/gold-path.test.ts` passed.
  - `pnpm --filter @workhub/contracts exec node --import tsx --test --test-reporter=dot src/contracts.test.ts` passed.

### 2026-07-02 Backend Continuation - Session readback and Drive comment state honesty

- User-visible session finding: after `/api/sessions` published the generated clarification question, a plain readback of `/api/sessions/:id` could publish the same `session.question` again. A client subscribed to the advertised stream would see a fresh-looking question event even though the user only reopened/read the session.
- Fix: `apps/api/src/routes/sessions.ts` now publishes `session.question` only for creation and explicit `/next-question`, not for GET readback.
- User-visible session permission finding: `/api/sessions/:id` required mutation access for the first scope question, but skipped that check when clarification answers already existed and the session rendered the confirm step. A read-only collaborator could see a confirm/submit surface that would fail only after clicking.
- Fix: `apps/api/src/services/work-items.ts` now checks mutation access before rendering any session question state, including confirm readback.
- User-visible Drive finding: the Drive comment draft-to-proposal finalizer could update a comment to `proposal_created` without checking its current status. If a comment was dismissed while proposal creation was in flight, the final write could resurrect that ignored comment.
- Fix: `packages/db/src/repositories/drive.ts` now only promotes comments currently in `draft_created` or already-idempotent `proposal_created`; dismissed comments are left untouched.
- Regression tests added/extended:
  - `apps/api/src/gold-path.test.ts`: `session route publishes generated questions to the advertised session stream` now verifies GET readback does not republish.
  - `apps/api/src/work-items-service.test.ts`: `session readback requires mutation access even after clarification answers exist`.
  - `packages/db/src/drive-path.test.ts`: `recordDraftProposal does not resurrect dismissed drive comments`.
- Red-first evidence:
  - Session readback first produced 2 published events instead of 1.
  - Session permission test first returned a confirm VM instead of rejecting the read-only actor.
  - Drive record test first found no status whitelist on the `project_drive_comments` update.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "session route publishes generated questions|session clarification question is generated|next-question" src/gold-path.test.ts` passed: 5 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "session readback requires mutation access|assigned lead can continue|session clarification answer uses generic mutation access|session finalization requires mutation access" src/work-items-service.test.ts` passed: 4 tests.
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=spec --test-name-pattern "recordDraftProposal does not resurrect|recordDraftProposal locks|commentToDraft locks" src/drive-path.test.ts` passed: 3 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "drive draftToProposal self-heals|drive recordDraftProposal stays idempotent|drive page service creates a deterministic proposal" src/drive-pages.test.ts` passed: 3 tests.

### 2026-07-02 Backend Continuation - Drive upload body limit ownership

- User-visible Drive finding: project Drive advertised and enforced a 32 MiB upload limit in its route, but the production app's global 1 MiB `Content-Length` limiter ran first. A normal 5 MiB Drive upload could return generic `payload_too_large` before reaching Drive permissions or the Drive-specific `drive_file_too_large` contract.
- Fix: `apps/api/src/app.ts` now lets the Drive upload endpoint own its body-size policy; the global 1 MiB limiter still applies to regular JSON APIs.
- User-visible API contract finding: Drive delete/restore returned meaningful 409 business errors at runtime, but OpenAPI documented only the 200 response. Generated clients could not distinguish version changes, non-empty folders, deleted parents, or name conflicts without out-of-band knowledge.
- Fix: `apps/api/src/openapi.ts` now documents Drive delete and restore 409 error envelopes with the runtime business codes.
- Regression test added:
  - `apps/api/src/app.test.ts`: `global body limit does not shadow the Drive upload size contract`.
  - `apps/api/src/app.test.ts`: `drive OpenAPI request bodies match the runtime upload and delete contracts` now asserts the delete/restore 409 code enums.
- Red-first evidence:
  - Full app request to `/api/drive/projects/:projectId/files` with `Content-Length` just over 1 MiB first returned `413 payload_too_large`.
  - OpenAPI test first found no `409` schema for Drive delete/restore.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "global body limit does not shadow|GET /api/health" src/app.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "drive upload route rejects oversized multipart files before calling the service" src/drive-pages.test.ts` passed: 1 test.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "drive OpenAPI request bodies|runtime API routes stay in lockstep|templated path parameters" src/app.test.ts` passed: 2 tests.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=spec --test-name-pattern "drive delete route" src/drive-pages.test.ts` passed: 2 tests.

### 2026-07-02 Backend Continuation - Clarification failure cleanup

- User-visible session finding: if AI material analysis failed after a new `ai_clarifying` WorkItem was created, the user could be left with an active draft that had no usable clarification question. Retrying the same request would accumulate ghost work items.
- Fix: `apps/api/src/services/work-items.ts` now best-effort cancels only the newly created draft when intent persistence or generated clarification assembly fails. Existing `work_item_id` sessions are not cancelled by a transient analysis failure.
- Regression tests added:
  - `apps/api/src/work-items-service.test.ts`: `persistent intake cancels a newly created clarification draft when AI analysis fails`.
  - `apps/api/src/work-items-service.test.ts`: `persistent intake does not cancel an existing work item when AI analysis fails`.
- Red-first evidence:
  - The new-draft failure test first saw zero `updateWorkItemFromSession` calls; the draft remained active.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/work-items-service.test.ts --test-name-pattern "persistent intake (cancels a newly created clarification draft|does not cancel an existing work item)"` passed.
  - `pnpm --filter @workhub/api typecheck` passed.

### 2026-07-02 Backend Continuation - Preview/download content honesty

- User-visible Drive and deliverable finding: text preview could fall back to incomplete `parsed_text` when the original file was missing, while download correctly rejected the same incomplete cache. The page then showed readable preview text plus a `download_href` that would 404.
- Fix: both accepted-deliverable preview and ordinary Drive file preview now use the same complete-content gate as download when falling back to cached parsed text.
- Regression tests updated:
  - `apps/api/src/workitems.test.ts`: `accepted deliverable preview and download reject incomplete parsed text fallback`.
  - `apps/api/src/drive-pages.test.ts`: `drive ordinary file preview and download reject incomplete parsed text fallback`.
- Red-first evidence:
  - Both preview routes first returned `200` for incomplete parsed-text fallback while their download routes returned `404`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/workitems.test.ts src/drive-pages.test.ts --test-name-pattern "(accepted deliverable preview and download reject incomplete parsed text fallback|drive ordinary file preview and download reject incomplete parsed text fallback)"` passed.

### 2026-07-02 Backend Continuation - Approval and Drive proposal idempotency contracts

- User-visible approval finding: approval respond/delegate can return `409 approval_race` at runtime, but OpenAPI documented only success. Generated clients could treat a handled-by-someone-else approval as an unknown failure instead of refreshing the decision state.
- Fix: `apps/api/src/openapi.ts` now documents the 409 `approval_race` envelope for both approval decision actions.
- User-visible Drive finding: Drive comment draft-to-proposal idempotency depended on scanning only the newest 50 Drive operations. In an active project, an older successful conversion could be missed and a retry could write duplicate operation/audit rows.
- Fix: `packages/db/src/repositories/drive.ts` now queries `project_drive_operations.payload_json` directly for the exact `drive_comment_id`, `work_item_id`, and `proposal_id`, with no recent-window dependency.
- Regression tests added/extended:
  - `apps/api/src/app.test.ts`: approval OpenAPI test now asserts respond/delegate 409 `approval_race`.
  - `packages/db/src/drive-path.test.ts`: `recordDraftProposal idempotency does not depend on the recent operations window`.
- Red-first evidence:
  - OpenAPI test first found no `409` schema for approval respond.
  - Drive idempotency test first found no payload-json filters and still saw `.limit(50)` in the idempotency gate.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Approval and permission OpenAPI contracts document decision and policy actions"` passed.
  - `pnpm --filter @workhub/db exec node --import tsx --test --test-reporter=dot src/drive-path.test.ts --test-name-pattern "recordDraftProposal idempotency does not depend on the recent operations window"` passed.
  - `pnpm --filter @workhub/db typecheck` passed.

### 2026-07-02 Backend Continuation - Permission OpenAPI authorization contracts

- User-visible permission finding: permission policy list/create/revoke and permission ask routes return clear `403 forbidden` or `404 not_found` states at runtime, but OpenAPI documented only success. Admin tools and approval-routing clients could not distinguish "not allowed" from a generic failure or a missing policy.
- Fix: `apps/api/src/openapi.ts` now documents the runtime authorization and not-found envelopes for `/api/permissions`, `/api/permissions/{id}`, and `/api/permissions/ask`.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `Approval and permission OpenAPI contracts document decision and policy actions` now asserts permission `403 forbidden` and revoke `404 not_found` schemas.
- Red-first evidence:
  - The OpenAPI test first failed because `GET /api/permissions` had no documented `403` response schema.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Approval and permission OpenAPI"` passed.

### 2026-07-02 Backend Continuation - Cost policy OpenAPI error contracts

- User-visible cost finding: cost policy list/update routes return admin-only, missing-policy, and invalid-update states at runtime, but OpenAPI documented only success. A settings UI could only show a generic failure instead of "admin required", "policy missing", or "fix this budget value".
- Fix: `apps/api/src/openapi.ts` now documents `403 forbidden` for cost policy list/update and `404 not_found` plus `422 validation_error` for policy updates.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `cost OpenAPI routes document budget usage, policies, and update payloads` now asserts the cost policy error envelopes.
- Red-first evidence:
  - The OpenAPI test first failed because `GET /api/cost/policies` had no documented `403` response schema.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "cost OpenAPI"` passed.

### 2026-07-02 Backend Continuation - Client device OpenAPI error contracts

- User-visible desktop finding: local-device current/revoke routes can return invalid-token, local-client-required, or missing-device states at runtime, but OpenAPI documented only success. The desktop app could not cleanly distinguish "reconnect/login again" from "this device was already revoked".
- Fix: `apps/api/src/openapi.ts` now documents `403 invalid_client_token|forbidden` for local-client-only device actions and `404 not_found` for device revoke actions.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `health, ready, and client-device OpenAPI routes document startup contracts` now asserts client-device `403` and `404` error envelopes.
- Red-first evidence:
  - The OpenAPI test first failed because `/api/client-devices/current` had no documented `403` response schema.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "health, ready, and client-device OpenAPI"` passed.

### 2026-07-02 Backend Continuation - Audit and snapshot revert error contracts

- User-visible audit finding: WorkItem audit timelines and AgentRun snapshot restores return readable auth/not-found/conflict states at runtime, but OpenAPI documented only success. A replay/rollback UI could not distinguish "you cannot view this audit", "snapshot missing", "local workdir unavailable", or "fix the request payload".
- User-visible error-code finding: hand-written `HTTPException(409)` branches still mapped to generic `http_error`, so recoverable restore conflicts were not branchable by generated clients.
- Fix: `apps/api/src/openapi.ts` now documents audit timeline `403/404` and snapshot restore `403/404/409/422` envelopes. `apps/api/src/http-error-codes.ts` now maps generic `409` HTTP exceptions to stable `conflict`.
- Regression tests updated:
  - `apps/api/src/app.test.ts`: `push streams and audit OpenAPI routes document runtime UUID guards and responses` now asserts audit `403/404` envelopes.
  - `apps/api/src/app.test.ts`: `Task intake and AgentRun OpenAPI responses document the execution chain` now asserts snapshot restore error envelopes.
  - `apps/api/src/app.test.ts`: `malformed JSON request bodies use stable client-debuggable error codes` now asserts `HTTPException(409) -> conflict`.
- Red-first evidence:
  - The audit OpenAPI test first failed because `/api/workitems/{id}/audit` had no documented `403` response schema.
  - The AgentRun OpenAPI test first failed because `/api/agent-runs/{id}/revert` had no documented `403` response schema.
  - The HTTP error-code test first failed with `http_error !== conflict`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "push streams and audit OpenAPI|Agent run OpenAPI"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "malformed JSON request bodies"` passed.

### 2026-07-02 Backend Continuation - Auth entrypoint error contracts

- User-visible auth finding: identify, desktop bootstrap, password register/login/change, invite create/accept, and user deactivate routes had rich runtime failure states but OpenAPI mostly documented only success. Login/register/settings surfaces could not distinguish disabled auth modes, duplicate email/nickname, wrong current password, invalid invite, self-deactivation, or rate limiting without hard-coded tribal knowledge.
- User-visible error-code finding: hand-written `HTTPException(429)` branches still mapped to generic `http_error`, so lockout/admin-claim throttling was not branchable by clients.
- Fix: `apps/api/src/openapi.ts` now documents the common auth error envelopes for those entrypoints while keeping their existing raw success payloads. `apps/api/src/http-error-codes.ts` now maps generic `429` HTTP exceptions to stable `rate_limited`.
- Regression tests updated:
  - `apps/api/src/app.test.ts`: `auth OpenAPI routes document request bodies and raw success payloads` now asserts auth `400/401/403/404/409/422/429` error envelopes where runtime exposes them.
  - `apps/api/src/app.test.ts`: `malformed JSON request bodies use stable client-debuggable error codes` now asserts `HTTPException(429) -> rate_limited`.
- Red-first evidence:
  - The auth OpenAPI test first failed because `/api/auth/identify` had no documented `403` response schema.
  - The HTTP error-code test first failed with `http_error !== rate_limited`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "auth OpenAPI"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "malformed JSON request bodies"` passed.

### 2026-07-02 Backend Continuation - Pilot and AI worklog metric contracts

- User-visible metrics finding: Day 1 pilot metrics can fail with admin-only or invalid-range states, and AI worklog metrics require a logged-in actor, but OpenAPI documented only success. Admin dashboards and metric probes could not distinguish "ask an admin", "fix the date range", or "log in again".
- Fix: `apps/api/src/openapi.ts` now documents `403 admin_required` and `422 validation_error|invalid_range` for `/api/pilot/day1/metrics`, plus `401 not_identified` for `/api/ai-worklog/today`.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `pilot metrics and AI worklog OpenAPI routes document query and response contracts` now asserts those metric-route error envelopes.
- Red-first evidence:
  - The OpenAPI test first failed because `/api/pilot/day1/metrics` had no documented `403` response schema.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "pilot metrics and AI worklog OpenAPI"` passed.

### 2026-07-02 Backend Continuation - WorkItem and proposal page error contracts

- User-visible page finding: WorkItem detail and proposal detail page VM routes can fail with unreadable, missing, or WorkItem state-conflict states, but OpenAPI documented only the 200 page envelope. Generated web clients could not render a precise "not found", "no permission", or "state changed" page state without hard-coded route knowledge.
- Fix: `apps/api/src/openapi.ts` now documents `403 forbidden`, `404 not_found`, and WorkItem page `409 workitem_state_conflict` for `/api/pages/workitems/{id}` and `/api/pages/proposals/{id}`.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `work item and proposal page OpenAPI routes document id parameters and page VM envelopes` now asserts the page error envelopes.
- Red-first evidence:
  - The OpenAPI test first failed because `/api/pages/workitems/{id}` had no documented `403` response schema.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "work item and proposal page OpenAPI"` passed.

### 2026-07-02 Backend Continuation - Drive action permission and missing-target contracts

- User-visible Drive finding: Drive file download/preview and Drive upload/delete/restore/comment-draft/proposal-draft actions can fail before business conflicts with permission or missing-target states, but OpenAPI still documented only success or conflict-style responses for these paths. Generated clients could not distinguish "no access", "project gone", "file/comment gone", or WorkItem-derived missing/forbidden states without hidden route knowledge.
- Fix: `apps/api/src/openapi.ts` now documents Drive `403 drive_forbidden`, Drive project/item/comment `404` envelopes, and the cross-service Drive draft-to-proposal `403 forbidden|drive_forbidden` plus `404 not_found|drive_not_found` envelopes.
- Regression tests updated:
  - `apps/api/src/app.test.ts`: `Drive preview and download OpenAPI responses document file payloads` now asserts download/preview `403 drive_forbidden`.
  - `apps/api/src/app.test.ts`: `drive OpenAPI request bodies match the runtime upload and delete contracts` now asserts upload/delete/restore `403`/`404` envelopes.
  - `apps/api/src/app.test.ts`: `Drive and Meeting draft action OpenAPI responses document refreshed page envelopes` now asserts Drive comment-draft and Drive draft-to-proposal `403`/`404` envelopes.
- Red-first evidence:
  - The focused OpenAPI test first failed because Drive comment-draft, Drive upload, and Drive download had no documented `403` response schema.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Drive and Meeting draft action|drive OpenAPI request bodies|Drive preview and download"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api-client test` passed: 15 tests.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace.

### 2026-07-02 Backend Continuation - Client-device auth and input error contracts

- User-visible desktop-client finding: local device registration and device listing/revocation routes can fail with unauthenticated, invalid-token, malformed-JSON, validation, or missing-device states, but OpenAPI only documented success for registration/listing and only partial errors for device reads. Desktop onboarding clients could not distinguish "log in", "bad local token", "fix device name", or "device already gone".
- Fix: `apps/api/src/openapi.ts` now documents client-device `400 malformed_json|json_object_required`, `401 not_identified`, `403 invalid_client_token`, `403 invalid_client_token|forbidden` where local-client presence is required, `404 not_found`, and `422 validation_error` envelopes according to each route's runtime path.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `health, ready, and client-device OpenAPI routes document startup contracts` now asserts registration, list, current-device, revoke, and revoke-current error envelopes.
- Red-first evidence:
  - The focused OpenAPI test first failed because `/api/client-devices/register` had no documented `400` error envelope despite the shared JSON parser returning `malformed_json`/`json_object_required`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "health, ready, and client-device OpenAPI"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api-client test` passed: 15 tests.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace.

### 2026-07-02 Backend Continuation - Push/SSE stream auth contracts

- User-visible realtime finding: Push/SSE routes can fail before the event stream opens when the user is not identified, presents an invalid local client token, requests a malformed/private topic, or lacks permission for a WorkItem/run/session/proposal topic. OpenAPI documented only `200 text/event-stream`, leaving clients unable to distinguish reconnect/login/token-repair/forbidden states.
- Fix: `apps/api/src/openapi.ts` now documents `401 not_identified` and route-specific `403 invalid_client_token` or `403 invalid_client_token|forbidden` envelopes while preserving the `text/event-stream` success response.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `push streams and audit OpenAPI routes document runtime UUID guards and responses` now asserts Push/SSE `401` and `403` error envelopes for global, user, WorkItem, requirement, run, session, and proposal stream topics.
- Red-first evidence:
  - The focused OpenAPI test first failed because `/api/push/stream` had no documented `401` response schema despite `resolveStreamUser` returning `not_identified` for unauthenticated users.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "push streams and audit OpenAPI"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api-client test` passed: 15 tests.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace.

### 2026-07-02 Backend Continuation - AgentRun start/read/trace/handoff/abort/replay contracts

- User-visible AgentRun finding: the AI execution control chain can fail with malformed JSON, unauthenticated/invalid local token, unreadable or missing WorkItems/runs, exhausted budget, already-active/human-reserved/not-startable WorkItem state, invalid trace cursor, kickoff write failure, or an already-settled abort target. OpenAPI documented only the successful run/trace/handoff/replay envelopes, so generated clients could not render precise "log in", "repair token", "budget exhausted", "already running", "refresh state", or "cannot cancel" UI states.
- Fix: `apps/api/src/openapi.ts` now documents AgentRun `400 malformed_json|json_object_required`, `401 not_identified`, `402 budget_exhausted`, `403 invalid_client_token|forbidden`, abort-specific `403 invalid_client_token|forbidden|agent_run_abort_forbidden`, `404 not_found`, start-specific `409 agent_run_already_active|agent_run_not_startable|human_reserved`, abort-specific `409 agent_run_already_settled`, `422 validation_error`, and kickoff `503 http_error` envelopes.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `Task intake and AgentRun OpenAPI responses document the execution chain` now asserts the start/read/trace/handoff/abort/replay error envelopes in addition to the existing success envelopes and trace query parameter.
- Red-first evidence:
  - The focused OpenAPI test first failed because `/api/workitems/{id}/agent-runs` had no documented `400` response schema despite the shared JSON parser returning `malformed_json`/`json_object_required`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Task intake and AgentRun OpenAPI responses"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api-client test` passed: 15 tests.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace.

### 2026-07-02 Backend Continuation - Proposal and merge-proposal action contracts

- User-visible GitHub-like review finding: proposal creation/listing/detail/review/merge/rebase/conflict-list and merge-proposal choose/apply routes can fail with login/token/permission/not-found states, malformed request bodies, domain validation failures, duplicate proposals, already-reviewed merge candidates, stale bases, merge conflicts, and non-reviewed/already-merged proposal states. OpenAPI still left most of that review chain success-only, making generated clients unable to show the right "refresh", "choose a conflict option", "confirm merge", "proposal already changed", or "bad manifest" state.
- Fix: `apps/api/src/openapi.ts` now documents Proposal `400 malformed_json|json_object_required`, `401 not_identified`, `403 invalid_client_token|forbidden`, `404 not_found`, create-specific `409 proposal_already_exists`, create-specific `422 validation_error|manifest_workitem_mismatch|duplicate_target_key|proposal_branch_workitem_mismatch`, review `409 proposal_already_merged|proposal_rejected|proposal_state_changed`, rebase `409 not_reviewed`, choose `409 merge_proposal_already_chosen`, choose `422 validation_error|invalid_merge_proposal_candidate`, and richer merge/apply `409` enums while preserving optional `recoverable`/`details` fields for conflict flows.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `Proposal OpenAPI contracts document review, merge, and conflict action payloads` now asserts proposal and merge-proposal auth, missing-target, malformed body, validation, conflict, and success envelopes.
- Red-first evidence:
  - The focused OpenAPI test first failed because `/api/workitems/{id}/proposals` had no documented `401` response schema despite the shared current-user middleware returning `not_identified` for unauthenticated users.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Proposal OpenAPI contracts"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api-client test` passed: 15 tests.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace.

### 2026-07-02 Backend Continuation - Intake, clarification, WorkItem creation, and knowledge-search contracts

- User-visible intake finding: clarification sessions, WorkItem creation, evidence binding, and knowledge search can fail with unauthenticated/invalid-token states, unreadable/missing WorkItems or projects, malformed JSON, Zod validation, finalization state conflicts, and material-analysis failures. OpenAPI documented only successful `SessionVM`, `WorkItemDetail`, and `EvidenceBubble` envelopes, so generated clients could not distinguish "log in", "bad local token", "project missing", "cannot finalize this session", or "AI could not produce a real material-grounded clarification question".
- User-visible clarification finding: the backend now explicitly rejects generic/template clarification output (`clarification_llm_templated_response`), missing named project files (`clarification_file_context_failed` / `clarification_llm_missing_named_file`), empty or invalid LLM output, failed LLM calls, and missing provider configuration. Those runtime states were invisible to OpenAPI, making the desktop/web client likely to show a vague failure instead of a clear "sync/upload files" or "AI analysis unavailable" state.
- Fix: `apps/api/src/openapi.ts` now documents session `400/401/403/404/422/502/503` envelopes, WorkItem create `400/401/403/404/409/422`, evidence binding `400/401/403/404/422`, and knowledge search `400/401/403/404/422` while keeping their successful page/data envelopes unchanged.
- Regression test updated:
  - `apps/api/src/app.test.ts`: `Task intake and AgentRun OpenAPI responses document the execution chain` now asserts session, WorkItem, evidence-binding, and knowledge-search error envelopes alongside their success schemas.
- Red-first evidence:
  - The focused OpenAPI test first failed because `/api/sessions` had no documented `401` response schema despite the shared current-user middleware returning `not_identified` for unauthenticated users.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Task intake and AgentRun OpenAPI responses"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api-client test` passed: 15 tests.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace.

### 2026-07-02 Backend Continuation - Approval comments, notifications, and project-list contracts

- User-visible approval finding: the approval center and approval comment stream can fail with missing identity, invalid desktop token, unreadable/missing approvals, malformed JSON, invalid comment bodies, or unavailable comment storage. OpenAPI still showed those paths as success-only, so generated clients could not decide between "log in", "repair local token", "approval disappeared", "fix the comment", or "comments temporarily unavailable".
- User-visible notification/project finding: notification list, mute-preferences, bulk read-all, item actions, and project list also depended on current-user auth, but their OpenAPI entries did not expose the `401 not_identified` / `403 invalid_client_token` envelopes. Notification preferences additionally missed `400 malformed_json|json_object_required` and `422 validation_error`, hiding the exact recovery path for a bad preferences save.
- Fix: `apps/api/src/openapi.ts` now documents approval-list `401/403`, approval comments `400/401/403/404/422/503`, notification list/preferences/read-all/item actions `401/403` plus preferences `400/422`, and project list `401/403` while preserving each successful data envelope.
- Regression tests updated:
  - `apps/api/src/app.test.ts`: `Approval and permission OpenAPI contracts document decision and policy actions` now asserts approval-list and approval-comment error envelopes.
  - `apps/api/src/app.test.ts`: `notification OpenAPI routes document list, preferences, and action payloads` now asserts notification auth and preferences parse/validation envelopes.
  - `apps/api/src/app.test.ts`: `project OpenAPI routes document list and bootstrap response payloads` now asserts project-list auth envelopes.
- Red-first evidence:
  - The focused OpenAPI test first failed because `/api/approvals`, `/api/notifications`, and `/api/projects` had no documented `401` response schema despite the shared current-user middleware returning `not_identified`.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "Approval and permission OpenAPI|notification OpenAPI|project OpenAPI"` passed.
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot 'src/*.test.ts'` passed.
  - `pnpm --filter @workhub/api typecheck` passed.
  - `pnpm --filter @workhub/api-client test` passed: 15 tests.
  - `git diff --check -- apps/api/src/app.test.ts apps/api/src/openapi.ts docs/workhub/05-clients/assets/audit/2026-06-28-backend-review/backend-review-status.md` passed, and `rg -n "[ \t]+$" ...` found no trailing whitespace.

### 2026-07-02 Backend Continuation - Auth preferences, page VM, and cost-usage auth contracts

- User-visible auth finding: `/api/auth/logout` and `/api/auth/preferences` both go through `resolveCurrentUser`, but OpenAPI still showed only successful responses. The preferences endpoint also has malformed JSON, validation, current-user missing, and unsupported-deployment paths that clients need to render precise recovery states.
- User-visible page/cost finding: attention home, gold path, approvals page, notifications page, health, cost, skills, settings, and lightweight cost usage all depend on current-user auth in runtime, but their OpenAPI entries only documented the successful page/data envelope. Generated clients would treat login expiry or a bad local client token as an untyped failure instead of showing "log in again" or "repair desktop token".
- Fix: `apps/api/src/openapi.ts` now documents auth logout `401/403`, auth preferences `400/401/403/404/422/501`, authenticated page VM `401/403`, and cost usage `401/403` while preserving the existing successful raw/page/data payload schemas.
- Regression tests updated:
  - `apps/api/src/app.test.ts`: `auth OpenAPI routes document request bodies and raw success payloads` now asserts logout and preferences error envelopes.
  - `apps/api/src/app.test.ts`: `attention and gold path page OpenAPI routes document locale and page VM envelopes` and `secondary page OpenAPI routes document query parameters and page VM envelopes` now assert page VM auth envelopes.
  - `apps/api/src/app.test.ts`: `cost OpenAPI routes document budget usage, policies, and update payloads` now asserts cost-usage auth envelopes.
- Red-first evidence:
  - The focused OpenAPI test first failed because `/api/auth/logout`, `/api/pages/attention`, `/api/pages/approvals`, and `/api/cost/usage` had no documented `401` response schema despite the shared current-user auth path.
- Verification after fix:
  - `pnpm --filter @workhub/api exec node --import tsx --test --test-reporter=dot src/app.test.ts --test-name-pattern "auth OpenAPI|attention and gold path|secondary page OpenAPI|cost OpenAPI"` passed.

Prior full-backend checkpoint retained from the earlier sweep:

- API focused suite passed: 196 tests across auth, approvals, audit, work-items, workitems routes, agent-runs, proposals, and project-home pages.
- `git diff --check -- apps/api packages/db packages/permissions packages/contracts docs/workhub/README.md` passed.

## Remaining Boundaries

- Frontend/client visual validation is intentionally not included in this record because the user asked to stop editing frontend and said Claude is reworking those pages.
- Existing R5.10 real-key limited-sample evidence remains valid for the prior run, but the post-fix confidence/context gate has been verified by source-level tests rather than another paid network run.
- Next non-frontend continuation point: keep reviewing API route/contract coverage and generated docs, then wait for the frontend freeze to lift before building the real app and producing the required screenshot-heavy HTML acceptance report.
