export type PostgresTypeMapping = {
  legacy: string;
  postgres: string;
  reason: string;
};

export const sqliteToPostgresTypeMap: readonly PostgresTypeMapping[] = [
  {
    legacy: "String(32) primary/foreign keys",
    postgres: "uuid",
    reason: "WorkHub keeps app-generated IDs while moving the storage type to native PostgreSQL UUID."
  },
  {
    legacy: "Text JSON payloads",
    postgres: "jsonb",
    reason: "Contracts, traces, manifests, evidence refs, and approval payloads must be typed and queryable."
  },
  {
    legacy: "naive DateTime",
    postgres: "timestamp with time zone",
    reason: "Agent budgets, stuck-job recovery, SLA, and replay ordering need aware UTC timestamps."
  },
  {
    legacy: "BOOLEAN DEFAULT 0",
    postgres: "boolean DEFAULT false",
    reason: "PostgreSQL has a real boolean type; numeric defaults are SQLite baggage."
  },
  {
    legacy: "read next_seq then insert",
    postgres: "atomic UPDATE ... RETURNING or SELECT ... FOR UPDATE",
    reason: "Project codes must survive multiple workers once F05 unlocks brokered execution."
  }
];

export function normalizeNodePostgresUrl(databaseUrl: string): string {
  const trimmed = databaseUrl.trim();

  if (trimmed.length === 0) {
    throw new Error("DATABASE_URL is required for PostgreSQL access");
  }

  if (trimmed.startsWith("sqlite:")) {
    throw new Error("SQLite URLs are not supported by the WorkHub TS-first database package");
  }

  if (trimmed.startsWith("postgresql+psycopg://")) {
    return `postgresql://${trimmed.slice("postgresql+psycopg://".length)}`;
  }

  if (trimmed.startsWith("postgres+psycopg://")) {
    return `postgres://${trimmed.slice("postgres+psycopg://".length)}`;
  }

  return trimmed;
}

export function isPostgresUrl(databaseUrl: string): boolean {
  const normalized = normalizeNodePostgresUrl(databaseUrl);
  return normalized.startsWith("postgresql://") || normalized.startsWith("postgres://");
}
