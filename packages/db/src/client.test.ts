import assert from "node:assert/strict";
import test from "node:test";

import { formatProjectCode, allocateProjectCode } from "./sequences.js";
import { defaultSeedFixture, defaultSeedIds } from "./seed.js";
import {
  isPostgresUrl,
  normalizeNodePostgresUrl,
  sqliteToPostgresTypeMap
} from "./types.js";

test("database URL normalization accepts SQLAlchemy-style psycopg URLs for TS clients", () => {
  assert.equal(
    normalizeNodePostgresUrl("postgresql+psycopg://workhub:workhub@127.0.0.1:5432/workhub"),
    "postgresql://workhub:workhub@127.0.0.1:5432/workhub"
  );
  assert.equal(isPostgresUrl("postgresql://workhub:workhub@127.0.0.1:5432/workhub"), true);
  assert.throws(() => normalizeNodePostgresUrl("sqlite:///tmp/workhub.db"), /SQLite URLs/);
});

test("F03 type conversion matrix captures the SQLite to PostgreSQL audit targets", () => {
  const postgresTargets = sqliteToPostgresTypeMap.map((entry) => entry.postgres);

  assert.equal(postgresTargets.includes("uuid"), true);
  assert.equal(postgresTargets.includes("jsonb"), true);
  assert.equal(postgresTargets.includes("timestamp with time zone"), true);
  assert.equal(postgresTargets.includes("boolean DEFAULT false"), true);
});

test("project code allocation uses an atomic update-returning result", async () => {
  const allocation = await allocateProjectCode(
    {
      execute: async () => ({
        rows: [{ slug: "demo-project", next_seq: 7 }]
      })
    },
    "11111111-1111-4111-8111-111111111111"
  );

  assert.equal(formatProjectCode("demo-project", 7), "DEMOPROJECT-007");
  assert.equal(allocation.code, "DEMOPROJECT-007");
  assert.equal(allocation.sequence, 7);
});

test("default seed fixture links org, workspace, owner, and project", () => {
  const [org] = defaultSeedFixture.orgs;
  const [workspace] = defaultSeedFixture.workspaces;
  const [user] = defaultSeedFixture.users;
  const [project] = defaultSeedFixture.projects;

  assert.equal(org?.id, defaultSeedIds.orgId);
  assert.equal(workspace?.orgId, defaultSeedIds.orgId);
  assert.equal(user?.id, defaultSeedIds.adminUserId);
  assert.equal(project?.workspaceId, defaultSeedIds.workspaceId);
  assert.equal(project?.ownerUserId, defaultSeedIds.adminUserId);
});
