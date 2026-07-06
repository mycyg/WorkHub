import type { WorkHubDb } from "./client.js";

export type RecordedQuery = {
  operation: "select" | "insert" | "update";
  selection?: unknown;
  fromTable?: unknown;
  targetTable?: unknown;
  joins: Array<{ kind: "inner" | "left"; table: unknown; on: unknown }>;
  where?: unknown;
  orderBy: unknown[];
  groupBy: unknown[];
  limit?: number;
  lock?: string;
  alias?: string;
  setValue?: unknown;
  valuesValue?: unknown;
  onConflict?: unknown;
  returningCalled?: boolean;
  steps: string[];
};

export type RecordedTransaction = {
  outcome: "resolved" | "rejected";
  errorName?: string;
};

class RecordedQueryBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly query: RecordedQuery,
    private readonly rows: unknown[]
  ) {}

  from(table: unknown): this {
    this.query.fromTable = table;
    this.query.steps.push("from");
    return this;
  }

  innerJoin(table: unknown, on: unknown): this {
    this.query.joins.push({ kind: "inner", table, on });
    this.query.steps.push("innerJoin");
    return this;
  }

  leftJoin(table: unknown, on: unknown): this {
    this.query.joins.push({ kind: "left", table, on });
    this.query.steps.push("leftJoin");
    return this;
  }

  where(condition: unknown): this {
    this.query.where = condition;
    this.query.steps.push("where");
    return this;
  }

  orderBy(...values: unknown[]): this {
    this.query.orderBy.push(...values);
    this.query.steps.push("orderBy");
    return this;
  }

  groupBy(...values: unknown[]): this {
    this.query.groupBy.push(...values);
    this.query.steps.push("groupBy");
    return this;
  }

  limit(count: number): this {
    this.query.limit = count;
    this.query.steps.push("limit");
    return this;
  }

  for(mode: string): this {
    this.query.lock = mode;
    this.query.steps.push("for");
    return this;
  }

  set(value: unknown): this {
    this.query.setValue = value;
    this.query.steps.push("set");
    return this;
  }

  values(value: unknown): this {
    this.query.valuesValue = value;
    this.query.steps.push("values");
    return this;
  }

  onConflictDoNothing(value?: unknown): this {
    this.query.onConflict = value ?? {};
    this.query.steps.push("onConflictDoNothing");
    return this;
  }

  onConflictDoUpdate(value: unknown): this {
    this.query.onConflict = value;
    this.query.steps.push("onConflictDoUpdate");
    return this;
  }

  returning(): Promise<unknown[]> {
    this.query.returningCalled = true;
    this.query.steps.push("returning");
    return Promise.resolve([...this.rows]);
  }

  as(alias: string): Record<string, unknown> {
    this.query.alias = alias;
    this.query.steps.push("as");
    const columns = new Map<string | symbol, unknown>();
    const target = { __recordedQuery: this.query, __alias: alias };
    return new Proxy(target, {
      get(proxied, prop) {
        if (prop === "then") {
          return undefined;
        }
        if (prop in proxied) {
          return proxied[prop as keyof typeof proxied];
        }
        if (!columns.has(prop)) {
          columns.set(prop, { __subqueryAlias: alias, name: String(prop) });
        }
        return columns.get(prop);
      }
    }) as Record<string, unknown>;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve([...this.rows]).then(onfulfilled, onrejected);
  }
}

class QueryRecorderDb {
  private readonly responses: unknown[][];
  readonly queries: RecordedQuery[] = [];
  readonly transactions: RecordedTransaction[] = [];

  constructor(responses: ReadonlyArray<ReadonlyArray<unknown>>) {
    this.responses = responses.map((rows) => [...rows]);
  }

  select(selection?: unknown): RecordedQueryBuilder {
    return this.createBuilder("select", { selection });
  }

  insert(table: unknown): RecordedQueryBuilder {
    return this.createBuilder("insert", { targetTable: table });
  }

  update(table: unknown): RecordedQueryBuilder {
    return this.createBuilder("update", { targetTable: table });
  }

  async transaction<T>(callback: (tx: WorkHubDb) => T | Promise<T>): Promise<T> {
    try {
      const result = await callback(this as unknown as WorkHubDb);
      this.transactions.push({ outcome: "resolved" });
      return result;
    } catch (error) {
      this.transactions.push({
        outcome: "rejected",
        ...(error instanceof Error ? { errorName: error.name } : {})
      });
      throw error;
    }
  }

  private createBuilder(
    operation: RecordedQuery["operation"],
    values: { selection?: unknown; targetTable?: unknown } = {}
  ): RecordedQueryBuilder {
    const query: RecordedQuery = {
      operation,
      joins: [],
      orderBy: [],
      groupBy: [],
      steps: [operation]
    };
    if ("selection" in values) {
      query.selection = values.selection;
    }
    if ("targetTable" in values) {
      query.targetTable = values.targetTable;
    }
    this.queries.push(query);
    return new RecordedQueryBuilder(query, this.responses.shift() ?? []);
  }
}

export function createQueryRecorder(
  responses: ReadonlyArray<ReadonlyArray<unknown>> = []
): { db: WorkHubDb; queries: RecordedQuery[]; transactions: RecordedTransaction[] } {
  const recorder = new QueryRecorderDb(responses);
  return {
    db: recorder as unknown as WorkHubDb,
    queries: recorder.queries,
    transactions: recorder.transactions
  };
}

export function queryReferences(value: unknown, target: unknown): boolean {
  return visitSqlTree(value, (node) => Object.is(node, target));
}

export function queryParamValues(value: unknown): unknown[] {
  const values: unknown[] = [];
  visitSqlTree(value, (node) => {
    if (constructorName(node) === "Param" && node && typeof node === "object" && "value" in node) {
      values.push((node as { value: unknown }).value);
    }
    return false;
  });
  return values.filter((item, index) => index === 0 || !Object.is(item, values[index - 1]));
}

export function queryTextFragments(value: unknown): string[] {
  const fragments: string[] = [];
  visitSqlTree(value, (node) => {
    if (constructorName(node) === "StringChunk" && node && typeof node === "object" && "value" in node) {
      const raw = (node as { value: unknown }).value;
      if (Array.isArray(raw)) {
        fragments.push(...raw.filter((fragment): fragment is string => typeof fragment === "string"));
      }
    }
    return false;
  });
  return fragments;
}

function constructorName(value: unknown): string | undefined {
  return value && typeof value === "object"
    ? (value as { constructor?: { name?: string } }).constructor?.name
    : undefined;
}

function visitSqlTree(
  value: unknown,
  visitor: (node: unknown) => boolean,
  seen: Set<object> = new Set()
): boolean {
  if (visitor(value)) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => visitSqlTree(item, visitor, seen));
  }
  const queryChunks = (value as { queryChunks?: unknown }).queryChunks;
  if (Array.isArray(queryChunks) && queryChunks.some((chunk) => visitSqlTree(chunk, visitor, seen))) {
    return true;
  }
  const name = constructorName(value);
  if (name === "Param") {
    return visitSqlTree((value as { value?: unknown }).value, visitor, seen);
  }
  if (name === "StringChunk") {
    return visitSqlTree((value as { value?: unknown }).value, visitor, seen);
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (visitSqlTree(child, visitor, seen)) {
      return true;
    }
  }
  return false;
}
