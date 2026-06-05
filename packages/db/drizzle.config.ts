import { defineConfig } from "drizzle-kit";

import { normalizeNodePostgresUrl } from "./src/types.js";

const databaseUrl = normalizeNodePostgresUrl(
  process.env.DATABASE_URL ?? "postgresql+psycopg://workhub:workhub@127.0.0.1:5432/workhub"
);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: databaseUrl
  },
  strict: true,
  verbose: true
});
