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

type PreflightGateKey =
  | "no_opened_proposals"
  | "no_active_runs"
  | "no_pending_approvals"
  | "metrics_gates_true"
  | "day2_baseline_available";

type PreflightGateValues = Record<PreflightGateKey, boolean>;

type OpenedProposalRow = {
  proposal_id: string;
  proposal_status: string;
  proposal_title: string;
  work_item_id: string;
  work_item_code: string;
  work_item_title: string | null;
  submitter_nickname: string | null;
  opened_at: Date;
};

type ActiveRunRow = {
  run_id: string;
  run_status: string;
  work_item_id: string;
  work_item_code: string;
  work_item_title: string | null;
  actor_nickname: string | null;
  started_at: Date | null;
  created_at: Date;
};

type PendingApprovalRow = {
  approval_id: string;
  approval_status: string;
  work_item_id: string | null;
  agent_run_id: string | null;
  action_pattern: string;
  created_at: Date;
};

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

function resolveRepoPath(rawPath: string) {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(repoRoot, rawPath);
}

function metricGateFailures(snapshot: PilotDay1MetricsSnapshot) {
  return Object.entries(snapshot.gates)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
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

function gateFailures(gates: PreflightGateValues) {
  const labels: Record<PreflightGateKey, string> = {
    no_opened_proposals: "opened proposals must be reviewed or rejected before inviting Day3 users",
    no_active_runs: "queued/running AgentRuns must settle before Day3 observation starts",
    no_pending_approvals: "pending approval requests must be handled before Day3 observation starts",
    metrics_gates_true: "S1 metrics gates must be green under the same metric contract",
    day2_baseline_available: "Day2 baseline metrics JSON must be available for Day3 delta comparison"
  };
  return Object.entries(gates)
    .filter(([, value]) => value !== true)
    .map(([key]) => labels[key as PreflightGateKey]);
}

const db = createDatabaseClient();

try {
  const now = optionalDateEnv("S1_DAY3_NOW") ?? new Date();
  const fallbackRange = defaultPilotDay1MetricsRange(now);
  const from = optionalDateEnv("S1_DAY3_FROM") ?? fallbackRange.from;
  const to = optionalDateEnv("S1_DAY3_TO") ?? fallbackRange.to;
  if (from.getTime() >= to.getTime()) {
    throw new Error("S1 Day3 preflight metrics range must have from before to.");
  }

  const baselinePath = resolveRepoPath(process.env.S1_DAY3_BASELINE_FILE?.trim() || defaultBaselinePath);
  const [
    openedProposalResult,
    activeRunResult,
    pendingApprovalResult,
    baselineResult,
    metricsRows
  ] = await Promise.all([
    db.pool.query<OpenedProposalRow>(`
      select
        p.id as proposal_id,
        p.status as proposal_status,
        p.title as proposal_title,
        p.work_item_id,
        w.code as work_item_code,
        w.title as work_item_title,
        u.nickname as submitter_nickname,
        p.created_at as opened_at
      from proposals p
      join work_items w on w.id = p.work_item_id
      left join users u on u.id = w.submitter_user_id
      where p.status = 'opened'
      order by p.created_at desc
    `),
    db.pool.query<ActiveRunRow>(`
      select
        ar.id as run_id,
        ar.status as run_status,
        ar.work_item_id,
        w.code as work_item_code,
        w.title as work_item_title,
        u.nickname as actor_nickname,
        ar.started_at,
        ar.created_at
      from agent_runs ar
      join work_items w on w.id = ar.work_item_id
      left join users u on u.id = ar.actor_user_id
      where ar.status in ('queued', 'running')
      order by ar.created_at desc
    `),
    db.pool.query<PendingApprovalRow>(`
      select
        id as approval_id,
        status as approval_status,
        work_item_id,
        agent_run_id,
        action_pattern,
        created_at
      from approval_requests
      where status = 'pending'
      order by created_at desc
    `),
    readBaselineSnapshot(baselinePath),
    createPilotMetricsRepository(db.db).readDay1MetricsRows()
  ]);
  const openedProposalRows = openedProposalResult.rows;
  const activeRunRows = activeRunResult.rows;
  const pendingApprovalRows = pendingApprovalResult.rows;
  const baselineSnapshot = baselineResult?.snapshot ?? null;

  const metricsSnapshot = buildPilotDay1MetricsSnapshot({
    rows: metricsRows,
    from,
    to,
    generatedAt: now
  });
  const metricsFailures = metricGateFailures(metricsSnapshot);
  const gates: PreflightGateValues = {
    no_opened_proposals: openedProposalRows.length === 0,
    no_active_runs: activeRunRows.length === 0,
    no_pending_approvals: pendingApprovalRows.length === 0,
    metrics_gates_true: metricsFailures.length === 0,
    day2_baseline_available: baselineResult !== null
  };
  const blockers = gateFailures(gates);

  const report = {
    generated_at: now.toISOString(),
    module: "S1 Day3 expansion preflight",
    status: blockers.length === 0 ? "ready_to_invite_real_users" : "blocked",
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    gates: {
      ...gates,
      ready_to_invite_real_users: blockers.length === 0,
      real_user_observation: "waiting_external_users"
    },
    blockers,
    queues: {
      opened_proposals: openedProposalRows.map((row) => ({
        ...row,
        opened_at: iso(row.opened_at)
      })),
      active_runs: activeRunRows.map((row) => ({
        ...row,
        started_at: iso(row.started_at),
        created_at: iso(row.created_at)
      })),
      pending_approvals: pendingApprovalRows.map((row) => ({
        ...row,
        created_at: iso(row.created_at)
      }))
    },
    metrics: {
      current_snapshot: metricsSnapshot,
      current_metric_gate_failures: metricsFailures,
      day2_baseline_path: baselinePath,
      day2_baseline_source: baselineResult?.source ?? null,
      day2_baseline_generated_at: baselineSnapshot?.generated_at ?? null,
      day2_to_current_delta: summarizeMetricDelta(metricsSnapshot, baselineSnapshot)
    },
    external_dependencies: [
      {
        id: "real_users",
        status: "waiting_external_users",
        note: "Day3 G1 still requires 1-3 real users to submit one real /intake task each; this preflight only proves the system is clean enough to invite them."
      }
    ],
    notes: [
      "Preflight is intentionally stricter than the metrics CLI: opened proposals, active runs, and pending approvals must be zero before real-user expansion.",
      "Metrics reuse the S1 Day1 snapshot contract so Day2 and Day3 deltas remain comparable.",
      "No secrets, session cookies, or private task content are emitted."
    ]
  };

  console.log(JSON.stringify(report, null, 2));
  if (process.env.S1_DAY3_REQUIRE_PREFLIGHT === "1" && blockers.length > 0) {
    throw new Error(`S1 Day3 preflight blocked: ${blockers.join("; ")}`);
  }
} finally {
  await db.close();
}
