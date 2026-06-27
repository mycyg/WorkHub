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

async function nextProjectSequence(db: SequenceExecutor, projectId: string) {
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

  return {
    prefix: normalizeProjectPrefix(row.slug),
    sequence: row.next_seq
  };
}

async function workItemCodeExists(db: SequenceExecutor, code: string) {
  const result = await db.execute(sql`
    select 1
    from "work_items"
    where "code" = ${code}
    limit 1
  `);
  return rowsFromResult(result).length > 0;
}

export async function allocateProjectCode(
  db: SequenceExecutor,
  projectId: string
): Promise<ProjectCodeAllocation> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const { prefix, sequence } = await nextProjectSequence(db, projectId);
    const code = formatProjectCode(prefix, sequence);
    if (!(await workItemCodeExists(db, code))) {
      return {
        projectId,
        prefix,
        sequence,
        code
      };
    }
  }

  throw new Error(`Unable to allocate a unique project code for ${projectId}`);
}
