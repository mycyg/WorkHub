import { sql, type SQL } from "drizzle-orm";

export type SequenceExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

export type ProjectCodeAllocation = {
  projectId: string;
  prefix: string;
  sequence: number;
  code: string;
};

function rowsFromResult(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result;
  }

  if (typeof result === "object" && result !== null && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows;
    }
  }

  return [];
}

function normalizeProjectPrefix(slug: string) {
  const prefix = slug.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase();
  return prefix.length > 0 ? prefix : "WORK";
}

export function formatProjectCode(prefix: string, sequence: number) {
  return `${normalizeProjectPrefix(prefix)}-${String(sequence).padStart(3, "0")}`;
}

export async function allocateProjectCode(
  db: SequenceExecutor,
  projectId: string
): Promise<ProjectCodeAllocation> {
  const result = await db.execute(sql`
    update "projects"
    set "next_seq" = "next_seq" + 1
    where "id" = ${projectId}
    returning "slug", "next_seq"
  `);
  const [firstRow] = rowsFromResult(result);

  if (typeof firstRow !== "object" || firstRow === null) {
    throw new Error(`Project ${projectId} was not found while allocating a project code`);
  }

  const row = firstRow as { slug?: unknown; next_seq?: unknown };
  if (typeof row.slug !== "string" || typeof row.next_seq !== "number") {
    throw new Error("Project code allocation returned an invalid row");
  }

  const prefix = normalizeProjectPrefix(row.slug);

  return {
    projectId,
    prefix,
    sequence: row.next_seq,
    code: formatProjectCode(prefix, row.next_seq)
  };
}
