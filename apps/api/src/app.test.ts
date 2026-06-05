import assert from "node:assert/strict";
import test from "node:test";

import app from "./app.js";

interface HealthBody {
  ok: true;
  service: string;
  runtime: string;
}

interface ErrorBody {
  ok: false;
  error: {
    code: string;
  };
}

test("GET /api/health returns the daemon health payload", async () => {
  const response = await app.request("/api/health");

  assert.equal(response.status, 200);
  const body = (await response.json()) as HealthBody;
  assert.equal(body.ok, true);
  assert.equal(body.service, "workhub-api");
  assert.equal(body.runtime, "node");
});

test("unknown endpoints use the shared error shape", async () => {
  const response = await app.request("/missing");

  assert.equal(response.status, 404);
  const body = (await response.json()) as ErrorBody;
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "not_found");
});
