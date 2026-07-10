# WorkHub Release Hardening Loop Design

> Date: 2026-07-10
>
> Branch: `codex/r11-release-hardening-loop`
>
> Input audit: `docs/workhub/05-clients/workhub-user-facing-systematic-review-r10-follow-up-2026-07-10.md`
>
> Target: a LAN-first, single-deployment team Pilot that scores at least 9/10 under ordinary-user review, while preserving strict workspace isolation for every embedded multi-workspace path.

## 1. Objective

Run a durable review-fix-review loop across WorkHub Web, API, Desktop Spotlight, Tauri/Rust, and Cuu/Pet until all of the following are simultaneously true:

1. No confirmed P0 or P1 finding remains.
2. Every core user journey has current runtime evidence, not only unit tests or static screenshots.
3. Web, Desktop, Rust, and Cuu agree on identity, workspace, project, route target, action target, destructive-action policy, and runtime configuration.
4. UI/UX, design language, accessibility, recovery behavior, and operability score at least 9/10 under the rubric in this document.
5. Release evidence proves what it claims to prove; no gate may pass by checking only filenames, timestamps, copied identifiers, or self-referential manifests.

The loop does not stop after the current audit list is closed. Each batch ends in a fresh ordinary-user review. New confirmed findings return to the appropriate batch and must be fixed before the release score can rise.

## 2. Product Boundary

### 2.1 In scope

- Current LAN-first deployment with PostgreSQL, Redis, API, Web, and macOS Tauri client.
- Multi-user operation inside a deployment.
- All current Web product routes and their ready, loading, empty, forbidden, not-found, error, slow-network, and reconnect states.
- Desktop Spotlight launcher and every advertised capability.
- Tauri token, SSE, deep-link, notification, tray, window, and configuration boundaries.
- Cuu/Pet launcher, attention actions, preferences, restore behavior, and project context.
- Chinese and English product copy.
- Keyboard-only operation and macOS VoiceOver evidence for critical journeys.
- Realistic data density, including duplicate names, long paths, long text, more than 100 runs, more than 50 work items, and multiple simultaneous actions.

### 2.2 Not part of this release target

- Public multi-tenant SaaS packaging, billing, or commercial licensing.
- Full Windows/Linux physical certification.
- A redesign unrelated to a confirmed user or consistency problem.

These exclusions do not weaken security invariants. Any existing workspace-aware path must remain fail-closed and must never expose cross-workspace users or content.

## 3. Non-Negotiable Product Principles

### 3.1 Fail fast and tell the truth

- Network, authorization, database, background-processing, and reconciliation failures must remain errors.
- A failure must never become an empty list, an implicit default project, a benign skip, or a success notice.
- Unknown failures carry a request id and a human-readable recovery path.

### 3.2 Fix the source of truth

- Shared concepts have one canonical contract.
- A client may render a platform-specific presentation but may not invent its own authorization, project fallback, destructive confirmation, route grammar, or endpoint state.
- Tests must consume the canonical registry or contract rather than duplicate a hand-written list and compare it with itself.

### 3.3 The visible object is the mutated object

For every user action, the following values must refer to the same object:

- the object shown as selected;
- the object named in the button or confirmation;
- the id/path/version sent by the client;
- the object authorized by the server;
- the object named in the audit log, notification, and SSE event.

If a selected object is not eligible for an action, the action is disabled with a reason. The UI may not silently substitute another eligible object.

### 3.4 Destructive actions are consistent

- Web, Spotlight, and Cuu use one destructive-action policy.
- The policy names the target and consequence, prevents duplicate submission, handles CAS races, and reports the authoritative result.
- Irreversible or terminal transitions require explicit confirmation. Platform-specific shortcuts may not bypass it.

### 3.5 Product language hides implementation language

- User-facing copy contains no git jargon, snake_case statuses, raw route identifiers, or engineering-only confidence numbers.
- Chinese and English express the same scope and consequence.
- An action labelled “all” must actually reach all items in the stated category.

## 4. Canonical Contracts

The hardening work introduces or consolidates the following bounded contracts. Each contract has one owner and explicit consumers.

### 4.1 Workspace membership and delegation eligibility

**Owner:** API authorization/service layer backed by workspace memberships.

**Responsibilities:**

- List active members for the actor's current workspace.
- Decide whether a target may receive an approval or escalation.
- Exclude the requester, current assignee, inactive membership, and ineligible roles when required by the action.
- Return a non-enumerating error for forged cross-workspace targets.
- Complete authorization before mutation, notification, SSE, or success audit.

**Consumers:** Approval routes/services, escalation services, Web delegate picker, future Desktop delegate picker.

### 4.2 Identity generation and stream lifecycle

**Owner:** Tauri shell token state and SSE worker.

**Responsibilities:**

- Every token change increments an identity generation.
- Clearing a token broadcasts the change and cancels the active response immediately.
- Events from an earlier generation are discarded.
- Signed-out and rebind states are explicit current Spotlight states.
- Server logout failure is not represented as completed logout.

### 4.3 Project context

**Owner:** Shared client/runtime contract plus API validation.

**Responsibilities:**

- Represent `project_id`, source, display name, and expiry/clear condition.
- Global creation entry points require explicit selection or an explicit project-creation flow.
- Leaving a project route clears or suspends route-derived context.
- Desktop and Cuu requests without project context fail closed; the API does not choose the first project for these sources.
- The active project remains visible as a chip near the action.

### 4.4 Action target and destructive-action policy

**Owner:** Shared Web/Desktop runtime types and API action contracts.

**Responsibilities:**

- Carry stable id, workspace id, project id, optional path/version, display label, and eligibility reason.
- Render full-enough labels to distinguish duplicate names.
- Use one confirmation/busy/result state machine.
- Reject stale or mismatched targets at the server boundary.

### 4.5 Route target registry

**Owner:** A generated or shared typed route registry consumed by Rust and TypeScript.

**Responsibilities:**

- Define accepted path, parameters, destination surface, focus behavior, and fallback.
- Cover Web navigation, Tauri deep links, system notification activation, tray actions, and Spotlight internal destinations.
- Reject unknown parameters during development and record a structured diagnostic in production.

### 4.6 Shell configuration

**Owner:** Tauri shell persisted configuration.

**Responsibilities:**

- Hold the effective API endpoint and locale used by WebView, SSE, tray, and system notifications.
- Apply changes atomically and restart dependent workers.
- Expose effective values to Settings for diagnosis.

### 4.7 Semantic design tokens

**Owner:** Shared UI semantic-token schema.

**Responsibilities:**

- Define typography roles, spacing, radii, elevation, focus, danger, warning, success, neutral text, and motion semantics.
- Permit platform mappings for font family, blur, native window composition, and motion implementation.
- Keep action risk, text contrast, focus behavior, and status meaning identical across clients.

## 5. Batch Architecture

### Batch 0: Security and identity boundary

Scope:

- Workspace-scoped user directory and delegation authorization.
- Safe option rendering in the delegate picker.
- Desktop token generation, active SSE cancellation, signed-out/rebind state.

Exit gate:

- Forged cross-workspace delegate requests produce no mutation, notification, SSE, or success audit.
- Logout terminates the active identity stream before the UI reports signed out.
- All covering tests show an observed red-green cycle.

### Batch 1: Project, object, and destructive-action correctness

Scope:

- Explicit Desktop/Cuu project context.
- Drive responsive row architecture and exact action targets.
- Shared destructive-action policy.
- Typed deep-link/notification route targets.
- Unified Tauri endpoint/locale configuration.

Exit gate:

- A realistic Drive fixture remains readable and unambiguous at all target widths.
- No client can cancel a subtask without the shared confirmation state.
- Every system notification reaches the exact destination object in a macOS physical test.
- Leaving a project cannot leak the old project into a new Cuu request.

### Batch 2: Honest state machines and recovery

Scope:

- Batch approval result classification.
- Proposal feedback, busy/CAS behavior, and atomic result rendering.
- Meeting import processing state and insight generation contract.
- Form-level dirty registry.
- Knowledge scope round-trip.
- Request-id propagation and explicit offline/error/empty states.

Exit gate:

- Partial failures identify the failed items and reason.
- A 200,000-character transcript survives navigation, locale change, and SSE refresh unless the user explicitly discards it.
- Meeting UI promises only states the backend implements and observes.
- Errors are never rendered as empty data.

### Batch 3: Product shell, accessibility, and design convergence

Scope:

- Shell-level bindings in every route state.
- Replay/Proposal migration out of legacy whole-page CSS.
- Ordinary-member navigation and information architecture.
- Container-responsive dense layouts.
- Native semantics, keyboard behavior, live status, contrast, reduced motion/transparency, and shortcut settings.
- Shared semantic design tokens and copy consistency.

Exit gate:

- Every state remains operable by keyboard and VoiceOver.
- All text contrast passes on final composited backgrounds.
- Web, Desktop, and Cuu are recognizably one product without forcing identical window shapes.
- No ordinary-member personal function is hidden in an admin-only group.

### Batch 4: Native-client and release evidence

Scope:

- Current macOS Tauri visual pass.
- Live2D/Pet, tray, notification activation, offline recovery, and multi-monitor behavior.
- Complete contact-sheet generation and realistic QA fixtures.
- Full build, package, migration, backup/restore, and Pilot deployment rehearsal.

Exit gate:

- Native evidence covers cold start, signed out, slow API, offline, reconnect, attention, run progress, settings recovery, notification activation, tray recovery, and two-monitor restore.
- QA artifacts prove every declared step is present.
- A clean Pilot deployment passes its runbook without hidden manual fixes.

### Batch 5: Independent ordinary-user review

Scope:

- Repeat the complete review with fresh data and a fresh reviewer.
- Triage every finding as confirmed, rejected, or unverified.
- Route new confirmed findings back to Batches 0-4.

Exit gate:

- P0 = 0, P1 = 0.
- No release-critical item remains unverified.
- Weighted product score is at least 9.0.

## 6. Review-Fix Loop

Every task and batch follows this sequence:

1. **Reproduce:** capture exact current behavior, input, route, state, and output.
2. **Trace:** follow the value across UI, client, API, service, repository, notification/SSE, and audit boundaries.
3. **Compare:** identify the closest correct implementation in the repository.
4. **Hypothesize:** state one root-cause hypothesis and the evidence supporting it.
5. **RED:** add the smallest behavioral regression test and observe the expected failure.
6. **GREEN:** implement the smallest root-cause fix that satisfies the contract.
7. **Refactor:** remove duplication only after green.
8. **Verify:** run targeted tests, affected package tests/typecheck, and the relevant runtime scenario.
9. **Review:** independent spec and code-quality review; fix every Critical/Important finding.
10. **Document:** update current contracts, QA evidence, and the living audit report in the same commit series.

No batch may close on a test name, static marker, or agent assertion alone.

## 7. Evidence Model

### 7.1 Required evidence classes

Each release requirement names at least one authoritative evidence source:

- `UNIT`: pure contract and edge-case behavior.
- `INTEGRATION`: API/service/repository/DB/Redis behavior.
- `BROWSER`: current Web with real interaction and realistic data.
- `NATIVE`: current Tauri/Rust/Pet physical behavior.
- `ACCESSIBILITY`: keyboard path plus screen-reader evidence.
- `DEPLOYMENT`: clean environment build, migrate, start, health, backup, and restore.
- `ARTIFACT`: generated report whose completeness is machine-checked.

### 7.2 Artifact completeness

A multi-step visual artifact must contain:

- the declared number of steps;
- a stable id for the first and last step;
- the route, state, viewport, locale, and data fixture for each step;
- page or image bounds large enough to include every step;
- a verifier that reads rendered output structure, not only mtimes.

### 7.3 Observability requirements

Critical operations log structured fields at boundaries:

- request id and actor identity generation;
- workspace/project/object ids;
- action id and target version;
- authorization decision and policy source;
- state transition from/to and CAS result;
- notification/SSE destination;
- background job state and retry count.

Sensitive content, tokens, and full transcripts are never logged.

## 8. Product Scoring Rubric

The final score is weighted:

| Dimension | Weight | 9/10 condition |
|---|---:|---|
| Safety and trust | 20% | No P0/P1; exact target and identity evidence |
| Core task completion | 20% | Intake-to-deliverable-to-approval-to-adoption closes without hidden fallback |
| Operability and recovery | 15% | Slow/offline/error/CAS states are explicit and recoverable |
| Web UI/UX | 12% | Dense and empty states remain clear at all target widths |
| Desktop/Cuu UX | 12% | Native flows, tray, notification, Pet, and project context are coherent |
| Cross-client consistency | 8% | Shared contracts and semantic actions agree |
| Accessibility | 8% | Keyboard, VoiceOver, semantics, contrast, and motion gates pass |
| Evidence and documentation | 5% | Current artifacts and living docs match runtime truth |

### Score caps

- Any confirmed P0 caps the total at 3.0.
- Any confirmed P1 caps the total at 8.9.
- Any release-critical unverified item caps the total at 8.9.
- Any false-success or silent-error path caps Safety and trust at 6.0.
- A green test suite cannot override a score cap.

## 9. Target Device and State Matrix

### Web widths

- 320, 375, 390, 780, 860, 1120, 1280, and 1365 CSS pixels.
- At least one 2x DPR run.

### Web states

- Onboarding, ready, loading, slow navigation, empty, forbidden, not found, offline, reconnect, partial failure, and retry.
- Chinese and English.
- Admin and ordinary member.
- Keyboard-only and reduced-motion/transparency.

### Native states

- Cold start, token bound, signed out, rebind as another user, API offline, API endpoint change, locale change, active SSE, notification activation, tray recovery, Pet hidden/pass-through, and two-monitor restore.

### Data density

- Duplicate file/folder names in different paths.
- Long Chinese and English names.
- Multiple row actions.
- More than 100 agent runs.
- More than 50 work items.
- More than 10 meetings.
- Long proposal reason and 200,000-character meeting transcript.

## 10. Delivery Discipline

- All product changes occur on `codex/r11-release-hardening-loop` or an isolated worktree attached to it.
- Production behavior changes require an observed failing test first.
- Each independently reviewable task receives a focused commit; no squash of useful task history.
- Never use `git add -A`; stage exact files.
- A task cannot advance with open Critical or Important review findings.
- Current documentation changes with the behavior it describes.
- The branch is not complete until full verification, independent review, and the final ordinary-user audit pass.

## 11. Success Definition

WorkHub is considered release-ready only when current evidence proves all of the following:

1. P0 = 0 and P1 = 0 after a fresh independent audit.
2. Every explicit requirement in this design maps to a passing authoritative evidence item.
3. All target Web states and widths are reviewed using realistic data.
4. Current macOS Tauri/Cuu behavior is physically reviewed, including notification and multi-monitor paths.
5. Full tests, typecheck, lint, build, database checks, release gates, and deployment rehearsal pass from a clean environment.
6. The final weighted score is at least 9.0 and no score cap applies.
7. The final report contains confirmed, rejected, and unverified sections, exact evidence handles, and no unsupported completion claim.
