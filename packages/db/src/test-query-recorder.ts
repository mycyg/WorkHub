import type { WorkHubDb } from "./client.js";

export type RecordedQuery = {
  operation: "select" | "insert" | "update" | "delete" | "execute";
  selection?: unknown;
  fromTable?: unknown;
  targetTable?: unknown;
  rawQuery?: unknown;
  joins: Array<{ kind: "inner" | "left"; table: unknown; on: unknown }>;
  where?: unknown;
  orderBy: unknown[];
  groupBy: unknown[];
  // R13 批4c/G1：conversations 仓库新增的 listReplyJudgeCandidates 用了 .having()（聚合过滤），这个
  // 假 DB 之前没有任何调用方用到过 having，补一个和 groupBy/orderBy 同档次的透传记录字段。
  having?: unknown;
  limit?: number;
  // R20 P2A（roster 分页）：memberships.listActiveRosterPageByWorkspace 用 .limit().offset() 翻页。这个假 DB
  // 之前无调用方用过 offset，补一个与 limit 同档次的透传记录字段（校验分页而非硬 200 截断）。
  offset?: number;
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

  // R17 #18（approval-digest 扩源）：unionAll 用来把审批/升级/提议三源统一成一个待决行流子查询。
  // 每个 union 分支本身是独立的 db.select()（各自已作为一条记录进 queries），这里只记一步、返回 this 让链
  // 继续（后续 .as() 把整个 union 收成子查询别名）。
  unionAll(_subquery: unknown): this {
    this.query.steps.push("unionAll");
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

  having(condition: unknown): this {
    this.query.having = condition;
    this.query.steps.push("having");
    return this;
  }

  limit(count: number): this {
    this.query.limit = count;
    this.query.steps.push("limit");
    return this;
  }

  offset(count: number): this {
    this.query.offset = count;
    this.query.steps.push("offset");
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

  // R14 批 CHAT：conversations 仓库的 removeReaction 用 db.delete(...)——这个假 DB 之前没有任何调用方
  // 用过 delete，补一个和 update 同档次的透传记录（targetTable + where 透传，thenable 返回 seeded 行）。
  delete(table: unknown): RecordedQueryBuilder {
    return this.createBuilder("delete", { targetTable: table });
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

export function queryRawStrings(value: unknown): string[] {
  const fragments: string[] = [];
  visitSqlTree(value, (node) => {
    if (typeof node === "string") {
      fragments.push(node);
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
  // seen 检查必须先于 visitor：同一节点可经 queryChunks 分支与泛型子节点遍历两条路径到达，
  // visitor 只许触发一次，否则计数类断言（如 param/isNull 出现次数）会翻倍。
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
  }
  if (visitor(value)) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  // drizzle Column 是叶子：column.table 会带出整张表的所有列，继续下钻会让
  // 「where 不引用列 X」这类否定断言因 table→columns 间接可达而永远失败。
  if (typeof (value as { columnType?: unknown }).columnType === "string") {
    return false;
  }
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
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (visitSqlTree(child, visitor, seen)) {
      return true;
    }
  }
  return false;
}
