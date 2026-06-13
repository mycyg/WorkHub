import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDatabaseClient,
  createPilotMetricsRepository
} from "@workhub/db";
import {
  pilotDay1MetricsSnapshotSchema,
  type PilotDay1MetricsSnapshot
} from "@workhub/contracts";

import {
  buildPilotDay1MetricsSnapshot,
  defaultPilotDay1MetricsRange
} from "../services/pilot-day1-metrics.js";

type GateKey =
  | "participants_declared"
  | "participants_found"
  | "real_users_observed"
  | "one_task_each"
  | "no_obvious_qa_artifacts"
  | "terminal_runs_observed"
  | "post_run_evidence_ready"
  | "all_observed_proposals_decided"
  | "no_global_opened_proposals"
  | "no_active_runs"
  | "no_pending_approvals"
  | "metrics_gates_true"
  | "day2_baseline_available";

type GateValues = Record<GateKey, boolean>;

type UserRow = {
  user_id: string;
  nickname: string;
  preferred_locale: string;
  is_admin: boolean;
  created_at: Date;
};

type WorkItemRow = {
  work_item_id: string;
  code: string;
  title: string | null;
  raw_description: string | null;
  status: string;
  submitter_user_id: string;
  submitter_nickname: string;
  created_at: Date;
  updated_at: Date;
};

type AgentRunRow = {
  run_id: string;
  work_item_id: string;
  actor_user_id: string | null;
  actor_nickname: string | null;
  status: string;
  title: string;
  model: string;
  token_in: number;
  token_out: number;
  cost_estimate: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  step_count: number;
};

type ProposalRow = {
  proposal_id: string;
  work_item_id: string;
  branch_id: string;
  agent_run_id: string | null;
  status: string;
  title: string;
  opened_by_kind: string;
  opened_by_user_id: string | null;
  reviewed_at: Date | null;
  merged_at: Date | null;
  created_at: Date;
  review_count: number;
};

type QueueCountsRow = {
  opened_proposals: string;
  active_runs: string;
  pending_approvals: string;
};

const terminalRunStatuses = new Set(["succeeded", "failed", "cancelled"]);
const qaArtifactPattern = /\b(S1\s+Day|QA|smoke|fixture|dummy|fake|preflight)\b/i;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultBaselinePath = path.join(
  repoRoot,
  "docs/workhub/05-clients/assets/audit/2026-06-13-s1-day2-feedback-hardening/s1-pilot-day2-metrics-snapshot.json"
);

function optionalDateEnv(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be an ISO datetime.`);
  }
  return parsed;
}

function optionalPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseListEnv(name: string) {
  return Array.from(new Set((process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)));
}

function resolveRepoPath(rawPath: string) {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(repoRoot, rawPath);
}

function parseBaselineSnapshot(raw: string) {
  return pilotDay1MetricsSnapshotSchema.parse(JSON.parse(raw));
}

async function readBaselineSnapshot(baselinePath: string) {
  const rawBaselineJson = process.env.S1_DAY3_BASELINE_JSON?.trim();
  if (rawBaselineJson) {
    return {
      source: "env:S1_DAY3_BASELINE_JSON",
      snapshot: parseBaselineSnapshot(rawBaselineJson)
    };
  }

  try {
    const raw = await readFile(baselinePath, "utf8");
    return {
      source: baselinePath,
      snapshot: parseBaselineSnapshot(raw)
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function numberFromPg(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricGateFailures(snapshot: PilotDay1MetricsSnapshot) {
  return Object.entries(snapshot.gates)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
}

function summarizeMetricDelta(current: PilotDay1MetricsSnapshot, baseline: PilotDay1MetricsSnapshot | null) {
  if (!baseline) {
    return [];
  }
  const baselineMetrics = new Map(baseline.metrics.map((metric) => [metric.id, metric]));
  return current.metrics.map((metric) => {
    const before = baselineMetrics.get(metric.id);
    return {
      id: metric.id,
      label_zh: metric.label_zh,
      label_en: metric.label_en,
      baseline_value: before?.value ?? null,
      current_value: metric.value,
      numerator_delta: before ? metric.numerator - before.numerator : null,
      denominator_delta:
        before && metric.denominator !== null && before.denominator !== null
          ? metric.denominator - before.denominator
          : null,
      current_status: metric.status
    };
  });
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), row]);
  }
  return grouped;
}

function hasQaArtifactText(...values: Array<string | null | undefined>) {
  return values.some((value) => value ? qaArtifactPattern.test(value) : false);
}

function gateFailures(gates: GateValues) {
  const labels: Record<GateKey, string> = {
    participants_declared: "declare 1-3 real participant nicknames in S1_DAY3_PARTICIPANTS",
    participants_found: "every declared participant nickname must exist as a registered user",
    real_users_observed: "at least the required number of declared real users must submit a /intake WorkItem",
    one_task_each: "each declared participant must have at least one Day3 WorkItem in the audit range",
    no_obvious_qa_artifacts: "declared participants and observed WorkItems must not look like QA/smoke/preflight artifacts",
    terminal_runs_observed: "each observed Day3 WorkItem must have at least one terminal AgentRun for Day3 closeout",
    post_run_evidence_ready: "each observed terminal run must have Proposal evidence or replay trace steps",
    all_observed_proposals_decided: "all observed Day3 proposals must be merged or rejected, not left opened",
    no_global_opened_proposals: "the pilot queue must have no opened proposal at Day3 closeout",
    no_active_runs: "the pilot queue must have no queued/running AgentRun at Day3 closeout",
    no_pending_approvals: "the pilot queue must have no pending approval request at Day3 closeout",
    metrics_gates_true: "S1 metrics gates must be green under the shared metrics contract",
    day2_baseline_available: "Day2 baseline metrics JSON must be available for Day3 delta comparison"
  };
  return Object.entries(gates)
    .filter(([, value]) => value !== true)
    .map(([key]) => labels[key as GateKey]);
}

function serializeWorkItem(row: WorkItemRow, runs: AgentRunRow[], proposals: ProposalRow[]) {
  const terminalRuns = runs.filter((run) => terminalRunStatuses.has(run.status));
  const proposalByRun = groupBy(proposals.filter((proposal) => proposal.agent_run_id), (proposal) => proposal.agent_run_id ?? "");
  return {
    id: row.work_item_id,
    code: row.code,
    title: row.title,
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    runs: runs.map((run) => ({
      id: run.run_id,
      status: run.status,
      model: run.model,
      token_in: run.token_in,
      token_out: run.token_out,
      cost_estimate: run.cost_estimate,
      step_count: run.step_count,
      proposal_count: proposalByRun.get(run.run_id)?.length ?? 0,
      created_at: iso(run.created_at),
      started_at: iso(run.started_at),
      finished_at: iso(run.finished_at)
    })),
    proposals: proposals.map((proposal) => ({
      id: proposal.proposal_id,
      status: proposal.status,
      title: proposal.title,
      review_count: proposal.review_count,
      agent_run_id: proposal.agent_run_id,
      created_at: iso(proposal.created_at),
      reviewed_at: iso(proposal.reviewed_at),
      merged_at: iso(proposal.merged_at)
    })),
    gates: {
      has_terminal_run: terminalRuns.length > 0,
      post_run_evidence_ready: terminalRuns.every((run) => (proposalByRun.get(run.run_id)?.length ?? 0) > 0 || run.step_count > 0),
      proposals_decided: proposals.every((proposal) => proposal.status !== "opened")
    }
  };
}

const db = createDatabaseClient();

try {
  const now = optionalDateEnv("S1_DAY3_NOW") ?? new Date();
  const fallbackRange = defaultPilotDay1MetricsRange(now);
  const from = optionalDateEnv("S1_DAY3_FROM") ?? fallbackRange.from;
  const to = optionalDateEnv("S1_DAY3_TO") ?? fallbackRange.to;
  if (from.getTime() >= to.getTime()) {
    throw new Error("S1 Day3 observation audit range must have from before to.");
  }

  const declaredNicknames = parseListEnv("S1_DAY3_PARTICIPANTS");
  const minParticipants = optionalPositiveIntEnv("S1_DAY3_MIN_PARTICIPANTS", 1);
  const maxParticipants = optionalPositiveIntEnv("S1_DAY3_MAX_PARTICIPANTS", 3);
  const baselinePath = resolveRepoPath(process.env.S1_DAY3_BASELINE_FILE?.trim() || defaultBaselinePath);
  const baselineResult = await readBaselineSnapshot(baselinePath);

  const participantResult = declaredNicknames.length > 0
    ? await db.pool.query<UserRow>(`
        select
          id as user_id,
          nickname,
          preferred_locale,
          is_admin,
          created_at
        from users
        where deleted_at is null
          and nickname = any($1::text[])
        order by nickname asc
      `, [declaredNicknames])
    : { rows: [] as UserRow[] };
  const participantRows = participantResult.rows;
  const participantIds = participantRows.map((row) => row.user_id);
  const missingNicknames = declaredNicknames.filter((nickname) =>
    !participantRows.some((row) => row.nickname === nickname)
  );

  const workItemResult = participantIds.length > 0
    ? await db.pool.query<WorkItemRow>(`
        select
          w.id as work_item_id,
          w.code,
          w.title,
          w.raw_description,
          w.status,
          w.submitter_user_id,
          u.nickname as submitter_nickname,
          w.created_at,
          w.updated_at
        from work_items w
        join users u on u.id = w.submitter_user_id
        where w.deleted_at is null
          and w.submitter_user_id = any($1::uuid[])
          and w.created_at >= $2
          and w.created_at < $3
        order by w.created_at asc
      `, [participantIds, from, to])
    : { rows: [] as WorkItemRow[] };
  const observedWorkItems = workItemResult.rows;
  const workItemIds = observedWorkItems.map((row) => row.work_item_id);

  const [runResult, proposalResult, queueCountResult, metricsRows] = await Promise.all([
    workItemIds.length > 0
      ? db.pool.query<AgentRunRow>(`
          select
            ar.id as run_id,
            ar.work_item_id,
            ar.actor_user_id,
            u.nickname as actor_nickname,
            ar.status,
            ar.title,
            ar.model,
            ar.token_in,
            ar.token_out,
            ar.cost_estimate::text,
            ar.created_at,
            ar.started_at,
            ar.finished_at,
            coalesce(steps.step_count, 0)::int as step_count
          from agent_runs ar
          left join users u on u.id = ar.actor_user_id
          left join (
            select agent_run_id, count(*)::int as step_count
            from agent_steps
            group by agent_run_id
          ) steps on steps.agent_run_id = ar.id
          where ar.work_item_id = any($1::uuid[])
          order by ar.created_at asc
        `, [workItemIds])
      : Promise.resolve({ rows: [] as AgentRunRow[] }),
    workItemIds.length > 0
      ? db.pool.query<ProposalRow>(`
          select
            p.id as proposal_id,
            p.work_item_id,
            p.branch_id,
            b.agent_run_id,
            p.status,
            p.title,
            p.opened_by_kind,
            p.opened_by_user_id,
            p.reviewed_at,
            p.merged_at,
            p.created_at,
            count(r.id)::int as review_count
          from proposals p
          join branches b on b.id = p.branch_id
          left join reviews r on r.proposal_id = p.id
          where p.work_item_id = any($1::uuid[])
          group by p.id, b.agent_run_id
          order by p.created_at asc
        `, [workItemIds])
      : Promise.resolve({ rows: [] as ProposalRow[] }),
    db.pool.query<QueueCountsRow>(`
      select
        (select count(*) from proposals where status = 'opened') as opened_proposals,
        (select count(*) from agent_runs where status in ('queued', 'running')) as active_runs,
        (select count(*) from approval_requests where status = 'pending') as pending_approvals
    `),
    createPilotMetricsRepository(db.db).readDay1MetricsRows()
  ]);

  const runs = runResult.rows;
  const proposals = proposalResult.rows;
  const queueCounts = queueCountResult.rows[0] ?? {
    opened_proposals: "0",
    active_runs: "0",
    pending_approvals: "0"
  };
  const runsByWorkItem = groupBy(runs, (run) => run.work_item_id);
  const proposalsByWorkItem = groupBy(proposals, (proposal) => proposal.work_item_id);
  const workItemsBySubmitter = groupBy(observedWorkItems, (workItem) => workItem.submitter_user_id);
  const observedParticipants = participantRows.filter((row) => (workItemsBySubmitter.get(row.user_id)?.length ?? 0) > 0);
  const suspiciousArtifacts = [
    ...participantRows
      .filter((row) => hasQaArtifactText(row.nickname))
      .map((row) => ({ kind: "participant", id: row.user_id, label: row.nickname })),
    ...observedWorkItems
      .filter((row) => hasQaArtifactText(row.code, row.title, row.raw_description))
      .map((row) => ({ kind: "work_item", id: row.work_item_id, label: row.title ?? row.code }))
  ];
  const terminalRuns = runs.filter((run) => terminalRunStatuses.has(run.status));
  const proposalsByRun = groupBy(proposals.filter((proposal) => proposal.agent_run_id), (proposal) => proposal.agent_run_id ?? "");

  const metricsSnapshot = buildPilotDay1MetricsSnapshot({
    rows: metricsRows,
    from,
    to,
    generatedAt: now
  });
  const metricFailures = metricGateFailures(metricsSnapshot);
  const baselineSnapshot = baselineResult?.snapshot ?? null;
  const gates: GateValues = {
    participants_declared: declaredNicknames.length >= minParticipants && declaredNicknames.length <= maxParticipants,
    participants_found: missingNicknames.length === 0,
    real_users_observed: observedParticipants.length >= minParticipants,
    one_task_each: participantRows.length > 0 && participantRows.every((row) => (workItemsBySubmitter.get(row.user_id)?.length ?? 0) > 0),
    no_obvious_qa_artifacts: suspiciousArtifacts.length === 0,
    terminal_runs_observed: observedWorkItems.length > 0 && observedWorkItems.every((row) =>
      (runsByWorkItem.get(row.work_item_id) ?? []).some((run) => terminalRunStatuses.has(run.status))
    ),
    post_run_evidence_ready: terminalRuns.length > 0 && terminalRuns.every((run) =>
      (proposalsByRun.get(run.run_id)?.length ?? 0) > 0 || run.step_count > 0
    ),
    all_observed_proposals_decided: proposals.every((proposal) => proposal.status !== "opened"),
    no_global_opened_proposals: numberFromPg(queueCounts.opened_proposals) === 0,
    no_active_runs: numberFromPg(queueCounts.active_runs) === 0,
    no_pending_approvals: numberFromPg(queueCounts.pending_approvals) === 0,
    metrics_gates_true: metricFailures.length === 0,
    day2_baseline_available: baselineResult !== null
  };
  const failedGates = gateFailures(gates);
  const status = declaredNicknames.length === 0
    ? "waiting_participant_list"
    : failedGates.length === 0
      ? "ready_for_day3_exit_report"
      : observedParticipants.length > 0
        ? "in_progress_or_needs_triage"
        : "waiting_real_user_intake";

  const report = {
    generated_at: now.toISOString(),
    module: "S1 Day3 real-user observation audit",
    status,
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    declared_participants: declaredNicknames,
    participant_policy: {
      min_participants: minParticipants,
      max_participants: maxParticipants,
      requires_explicit_nicknames: true,
      qa_artifact_pattern: qaArtifactPattern.source
    },
    gates: {
      ...gates,
      day3_exit_ready: failedGates.length === 0
    },
    blockers: failedGates,
    missing_participants: missingNicknames,
    suspicious_artifacts: suspiciousArtifacts,
    participants: participantRows.map((participant) => ({
      id: participant.user_id,
      nickname: participant.nickname,
      preferred_locale: participant.preferred_locale,
      is_admin: participant.is_admin,
      created_at: iso(participant.created_at),
      work_items: (workItemsBySubmitter.get(participant.user_id) ?? []).map((workItem) =>
        serializeWorkItem(
          workItem,
          runsByWorkItem.get(workItem.work_item_id) ?? [],
          proposalsByWorkItem.get(workItem.work_item_id) ?? []
        )
      )
    })),
    queue_counts: {
      opened_proposals: numberFromPg(queueCounts.opened_proposals),
      active_runs: numberFromPg(queueCounts.active_runs),
      pending_approvals: numberFromPg(queueCounts.pending_approvals)
    },
    metrics: {
      current_snapshot: metricsSnapshot,
      current_metric_gate_failures: metricFailures,
      day2_baseline_path: baselinePath,
      day2_baseline_source: baselineResult?.source ?? null,
      day2_baseline_generated_at: baselineSnapshot?.generated_at ?? null,
      day2_to_current_delta: summarizeMetricDelta(metricsSnapshot, baselineSnapshot)
    },
    notes: [
      "This audit intentionally requires explicit participant nicknames so prior QA users cannot be counted as Day3 real users.",
      "G1 is satisfied by a declared participant creating a Day3 WorkItem through /intake; Day3 closeout additionally expects terminal runs, decided proposals, metrics, and backup/restore evidence.",
      "No session cookies, API keys, or private task content are emitted; WorkItem raw descriptions are only inspected for QA-artifact wording and are not printed."
    ]
  };

  console.log(JSON.stringify(report, null, 2));
  if (process.env.S1_DAY3_REQUIRE_OBSERVATION === "1" && failedGates.length > 0) {
    throw new Error(`S1 Day3 observation audit not ready: ${failedGates.join("; ")}`);
  }
} finally {
  await db.close();
}
