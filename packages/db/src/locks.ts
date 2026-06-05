import { sql, type SQL } from "drizzle-orm";

export type DbExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

export async function lockWorkItemForUpdate(db: DbExecutor, workItemId: string) {
  await db.execute(sql`
    select "id"
    from "work_items"
    where "id" = ${workItemId}
    for update
  `);
}

export async function lockProjectForUpdate(db: DbExecutor, projectId: string) {
  await db.execute(sql`
    select "id"
    from "projects"
    where "id" = ${projectId}
    for update
  `);
}

export async function lockMainBranchForUpdate(db: DbExecutor, branchId: string) {
  await db.execute(sql`
    select "id"
    from "branches"
    where "id" = ${branchId}
    for update
  `);
}
