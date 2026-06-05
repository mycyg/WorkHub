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
  "packages/config/src/ports.ts",
  "scripts/dev/check-portable-config.ts"
];

const missing = requiredPaths.filter((path) => !existsSync(path));

if (missing.length > 0) {
  throw new Error(`F01 target paths missing: ${missing.join(", ")}`);
}

console.log("target path audit passed");
