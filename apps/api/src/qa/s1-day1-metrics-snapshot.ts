import { createDatabaseClient, createPilotMetricsRepository } from "@workhub/db";

import {
  buildPilotDay1MetricsSnapshot,
  defaultPilotDay1MetricsRange
} from "../services/pilot-day1-metrics.js";

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

function requiredGateFailures(snapshot: ReturnType<typeof buildPilotDay1MetricsSnapshot>) {
  return Object.entries(snapshot.gates)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
}

const db = createDatabaseClient();

try {
  const now = optionalDateEnv("S1_DAY1_NOW") ?? new Date();
  const fallbackRange = defaultPilotDay1MetricsRange(now);
  const from = optionalDateEnv("S1_DAY1_FROM") ?? fallbackRange.from;
  const to = optionalDateEnv("S1_DAY1_TO") ?? fallbackRange.to;
  const snapshot = buildPilotDay1MetricsSnapshot({
    rows: await createPilotMetricsRepository(db.db).readDay1MetricsRows(),
    from,
    to,
    generatedAt: now
  });
  console.log(JSON.stringify(snapshot, null, 2));
  if (process.env.S1_DAY1_REQUIRE_GATES === "1") {
    const failures = requiredGateFailures(snapshot);
    if (failures.length > 0) {
      throw new Error(`S1 Day1 metrics gates failed: ${failures.join(", ")}`);
    }
  }
} finally {
  await db.close();
}
