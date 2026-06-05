import { existsSync } from "node:fs";

const requiredPaths = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  ".env.example",
  ".github/workflows/verify.yml",
  "apps/api/src/app.ts",
  "apps/web/src/main.ts",
  "apps/desktop-webview/src/main.ts",
  "packages/config/src/env.ts",
  "packages/config/src/auth.ts",
  "packages/config/src/ports.ts",
  "packages/contracts/src/enums.ts",
  "packages/contracts/src/events.ts",
  "packages/contracts/src/experience.ts",
  "packages/contracts/src/auth.ts",
  "packages/contracts/src/identity.ts",
  "packages/contracts/src/domain/work-item.ts",
  "packages/contracts/src/domain/collaboration.ts",
  "packages/contracts/src/domain/agent.ts",
  "packages/contracts/src/domain/governance.ts",
  "packages/db/src/schema/core.ts",
  "packages/db/src/relations/core.ts",
  "packages/db/src/client.ts",
  "packages/db/src/migrate.ts",
  "packages/db/src/types.ts",
  "packages/db/src/locks.ts",
  "packages/db/src/sequences.ts",
  "packages/db/src/seed.ts",
  "packages/db/src/repositories/users.ts",
  "packages/db/src/repositories/devices.ts",
  "packages/events/src/event-types.ts",
  "packages/events/src/types.ts",
  "packages/events/src/topics.ts",
  "packages/events/src/envelope.ts",
  "packages/events/src/sse.ts",
  "packages/events/src/toAttentionItem.ts",
  "packages/events/src/toCuuState.ts",
  "packages/db/drizzle.config.ts",
  "apps/api/src/middleware/auth.ts",
  "apps/api/src/routes/auth.ts",
  "apps/api/src/routes/client-devices.ts",
  "apps/api/src/broker/index.ts",
  "apps/api/src/broker/memory.ts",
  "apps/api/src/broker/redis.ts",
  "apps/api/src/broker/presence.ts",
  "apps/api/src/sse/stream.ts",
  "apps/api/src/sse/topic-access.ts",
  "apps/api/src/routes/push.ts",
  "scripts/dev/check-portable-config.ts"
];

const missing = requiredPaths.filter((path) => !existsSync(path));

if (missing.length > 0) {
  throw new Error(`Target paths missing: ${missing.join(", ")}`);
}

console.log("target path audit passed");
