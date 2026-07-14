# Contributing to WorkHub

Thanks for taking a look. This document covers how to get a dev environment running, how tests
and migrations work, and the conventions the codebase enforces (some of them mechanically, via
`pnpm lint`/CI — read this before your first PR to avoid a red build).

WorkHub is released under [PolyForm Noncommercial 1.0.0](LICENSE): contributions are welcome for
personal, research, nonprofit, educational, and government use. See the License section in
[README.md](README.md) if you're unsure whether your use case fits.

## Development environment

Prerequisites:

- Node ≥ 22 (`.node-version` pins 22), pnpm 11 — `corepack enable` picks up the pinned version from
  `package.json`'s `packageManager` field automatically.
- Docker (for local PostgreSQL 16 + Redis — `docker-compose.yml` at the repo root only runs those
  two dependencies, not the app itself).
- An LLM API key if you're touching anything in the agent loop (`packages/agent`, workers, the
  observer/judge/dispatcher services) — the default provider is DeepSeek's Anthropic-compatible
  endpoint. Everything else (routes, web, desktop UI, contracts, db) can be developed and tested
  without one.

Setup:

```bash
corepack enable
pnpm install

cp .env.example .env              # fill in LLM_API_KEY if you need it; everything else has a
                                   # working local default
docker compose up -d postgres redis
pnpm db:migrate

pnpm dev                                    # API on :8787
pnpm --filter @workhub/web dev              # Web on :5173 (separate terminal)
```

`packages/config/src/env.ts` is the single source of truth for every environment variable; if
`.env.example` and that file drift, trust `env.ts` and file an issue/PR to fix the example.

## Running tests and type checks

Every package uses Node's built-in test runner via `tsx`, not Jest or Vitest:

```bash
pnpm test                    # pnpm -r --if-present test, runs every package's tests
pnpm --filter @workhub/api test        # one package
pnpm -r typecheck            # tsc --noEmit across the whole workspace
pnpm verify                  # typecheck + test + lint (lint includes migration/doc/secret audits
                              # and several QA smoke scripts — this is what CI runs)
```

**Important:** the test runner does not type-check. If you add or edit any `*.test.ts` file, run
`pnpm -r typecheck` afterward — CI's `tsc` step will catch type errors the test run itself won't.
This has bitten people before; it's not optional.

Some smoke/QA scripts under `scripts/qa/` and `apps/*/src/qa/` need a real PostgreSQL (and
sometimes Redis) instance and are not part of the default `pnpm test` — they're wired into specific
CI jobs (see `.github/workflows/verify.yml`) and are most useful when you're touching the agent
run queue, SSE broker, or migration replay path.

## Migration discipline (replay-safe, non-negotiable)

Migrations live in `packages/db/migrations/`, generated with Drizzle (`pnpm db:generate`) and
applied with `pnpm db:migrate` (`pnpm db:check` diffs schema vs. migrations without writing).
Files are named `NNNN_description.sql` with a strictly increasing 4-digit ordinal.

From migration `0031` onward, `scripts/dev/check-migrations.ts` (run as `pnpm audit:migrations`,
part of `pnpm lint`) enforces that every migration can be **replayed against a database that
already has an older schema**, not just applied fresh. Concretely:

- `ALTER TABLE ... ADD COLUMN` must be `ADD COLUMN IF NOT EXISTS`.
- `CREATE INDEX` / `CREATE UNIQUE INDEX` must include `IF NOT EXISTS`.
- Application runtime code (outside `packages/db/migrations/`) must never mutate schema at
  runtime — no `CREATE TABLE IF NOT EXISTS`, no `ALTER TABLE`, no ORM auto-create-all pattern. All
  schema changes go through a migration file, full stop.

CI additionally spins up a real PostgreSQL container and replays the full migration history
end-to-end (`migration-audit` job) — a migration that only works against a fresh database will be
caught there even if you never run it locally against seeded data.

## Scope and commit discipline

This codebase has been built by a mix of human and AI contributors working in tightly-scoped,
parallel batches, and a few rules exist specifically because violating them caused real breakage
before:

- **Never `git add -A` or `git add .`.** Stage only the files you intentionally changed. The
  working tree in this repo frequently has other in-progress work sitting alongside yours.
- **Don't weaken a test to make it pass.** If a test goes red, assume your change is wrong first.
  If the assertion itself genuinely needs to change, say so explicitly in the PR description with a
  reason — don't silently soften it.
- **No fake tests.** An assertion that can't fail (`assert(true)`, a mock-only test that never
  exercises real logic, swapping a real-database test for an in-memory fake) doesn't count as
  coverage.
- **No fake wiring.** Every button/action in the UI must reach a real backend. If a feature can't
  be finished, don't render a control that does nothing when clicked — leave it out.
- **Bound every list query.** All list/search endpoints need a `limit`/cap and pagination; no
  unbounded queries, no N+1 queries inside a loop.
- **New endpoints:** validate UUID path params (see `apps/api/src/routes/uuid-param.ts` for the
  existing pattern), enforce membership/workspace authorization *inside the SQL* (not "fetch
  everything, then filter in application code"), and validate request bodies.
- Commit messages follow `feat(scope): ...` / `fix(scope): ...` / `docs(scope): ...` etc., scoped
  to the package or area touched.

## No emoji

UI copy and documentation in this repository do not use emoji. Icons are SVG symbols or plain
character tiles, not emoji glyphs. The one deliberate, narrow exception is the small fixed set of
emoji used for chat message reactions (a user-facing feature, not decoration) — everywhere else,
including this file, holds the line.

## UI copy language and de-jargon

Product UI copy defaults to **Chinese** — the team and most current users are Chinese-speaking.
English strings exist alongside Chinese ones in a handful of locale-aware surfaces (see
`docs/workhub/00-overview/glossary-dejargon.md` and the i18n contract docs under
`docs/workhub/05-clients/`), but when adding new user-facing copy without a specific i18n
requirement, write it in Chinese first.

User-facing copy never uses raw git/engineering jargon. This project's internal collaboration
model is branch → proposal → review → merge, but users only ever see the de-jargoned version:

| User sees | Internally is |
|---|---|
| 工作副本 (working copy) | branch |
| 提议 (proposal) | pull request |
| 确认 / 打回 (confirm / send back) | approve / request changes |
| 采纳进正式版 (adopt into the official version) | merge to `main` |
| 撞车了 (collided) | merge conflict |

If you're adding copy that talks about this collaboration model, use the left column. The full
mapping lives in `docs/workhub/00-overview/glossary-dejargon.md`.

## Parallel batch construction (context for larger changes)

Larger features in this repo are frequently built as a set of independently-scoped work packages
that land as separate branches/PRs against a shared integration branch, then get reconciled by
whoever integrates them (mounting routes, resolving migration-number collisions between parallel
batches, deduping shared test fixtures). If you're picking up a substantial feature, it's worth
scoping your own PR the same way: pick a clear file/directory boundary, say so in the PR
description, and flag anything you noticed outside that boundary instead of fixing it inline. See
`r12-desktop-workbench/04-codex-execution-guide.md` for a fuller example of how this project's own
larger batches have been scoped and reported on — the reporting format there (what changed, test
counts before/after, assertions you touched and why, out-of-scope findings, known gaps) is a decent
template for any nontrivial PR description here.

## Reporting a security issue

Please don't open a public issue for a security vulnerability. See [SECURITY.md](SECURITY.md) for
the private reporting process.
