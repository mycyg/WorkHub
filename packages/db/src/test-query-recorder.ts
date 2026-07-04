import type { WorkHubDb } from "./client.js";

export type RecordedQuery = {
  operation: "select" | "insert" | "update" | "execute";
  fromTable?: unknown;
  targetTable?: unknown;
  rawQuery?: unknown;
  joins: Array<{ kind: "inner" | "left"; table: unknown; on: unknown }>;
  where?: unknown;
  orderBy: unknown[];
  groupBy: unknown[];
  limit?: number;
  lock?: string;
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

  onConflictDoUpdate(config: unknown): this {
    this.query.onConflict = config;
    this.query.steps.push("onConflictDoUpdate");
    return this;
  }

  onConflictDoNothing(config?: unknown): this {
    this.query.onConflict = config ?? {};
    this.query.steps.push("onConflictDoNothing");
    return this;
  }

  returning(): Promise<unknown[]> {
    this.query.returningCalled = true;
    this.query.steps.push("returning");
    return Promise.resolve([...this.rows]);
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

  async execute(query: unknown): Promise<unknown[]> {
    const response = this.responses.shift() ?? [];
    this.queries.push({
      operation: "execute",
      rawQuery: query,
      joins: [],
      orderBy: [],
      groupBy: [],
      steps: ["execute"]
    });
    return [...response];
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
      (query as RecordedQuery & { selection?: unknown }).selection = values.selection;
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
  return values;
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
    const param = value as { value?: unknown; encoder?: unknown };
    return visitSqlTree(param.value, visitor, seen) || visitSqlTree(param.encoder, visitor, seen);
  }
  if (name === "StringChunk") {
    return visitSqlTree((value as { value?: unknown }).value, visitor, seen);
  }
  return false;
}
