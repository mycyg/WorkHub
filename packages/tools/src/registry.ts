import type { AnyToolSpec, ToolExecutionContext } from "./types.js";
import { errorToolResult } from "./types.js";
import { toJSONSchema } from "zod";

export type ToolVisibilityCheck = (spec: AnyToolSpec, ctx: ToolExecutionContext) => boolean | Promise<boolean>;

export type ToolRegistryOptions = {
  canUse?: ToolVisibilityCheck;
};

function modelInputSchema(spec: AnyToolSpec): Record<string, unknown> {
  try {
    const schema = toJSONSchema(spec.schema) as Record<string, unknown>;
    delete schema["$schema"];
    return schema;
  } catch {
    return { type: "object" };
  }
}

export class ToolRegistry {
  private readonly specs = new Map<string, AnyToolSpec>();

  constructor(specs: AnyToolSpec[] = [], private readonly options: ToolRegistryOptions = {}) {
    for (const spec of specs) {
      this.register(spec);
    }
  }

  register(spec: AnyToolSpec) {
    if (this.specs.has(spec.id)) {
      throw new Error(`Duplicate WorkHub tool id: ${spec.id}`);
    }
    this.specs.set(spec.id, spec);
    return this;
  }

  get(id: string) {
    return this.specs.get(id);
  }

  list() {
    return [...this.specs.values()];
  }

  async visibleFor(ctx: ToolExecutionContext) {
    const visible: AnyToolSpec[] = [];
    for (const spec of this.specs.values()) {
      if (!this.options.canUse || await this.options.canUse(spec, ctx)) {
        visible.push(spec);
      }
    }
    return visible;
  }

  async toModelTools(ctx: ToolExecutionContext) {
    const visible = await this.visibleFor(ctx);
    return visible.map((spec) => ({
      name: spec.id,
      description: spec.description,
      input_schema: modelInputSchema(spec),
      side_effect: spec.sideEffect
    }));
  }

  async execute(toolId: string, input: unknown, ctx: ToolExecutionContext) {
    const spec = this.specs.get(toolId);
    if (!spec) {
      return errorToolResult(`tool not available: ${toolId}`);
    }

    if (this.options.canUse && !(await this.options.canUse(spec, ctx))) {
      return errorToolResult(`tool not available: ${toolId}`);
    }

    const parsed = spec.schema.safeParse(input);
    if (!parsed.success) {
      return errorToolResult(`tool input does not match schema: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }

    let snapshotId: string | undefined;
    if (spec.sideEffect !== "none") {
      if (!ctx.snapshot) {
        return errorToolResult(`side-effect tool '${toolId}' requires a snapshot gate before execution`);
      }
      try {
        const snapshot = await ctx.snapshot({
          toolId,
          sideEffect: spec.sideEffect,
          input: parsed.data,
          workdir: ctx.workdir,
          ...(ctx.runId ? { runId: ctx.runId } : {}),
          ...(ctx.workItemId ? { workItemId: ctx.workItemId } : {})
        });
        snapshotId = snapshot.snapshotId;
      } catch (error) {
        return errorToolResult(`snapshot gate failed before '${toolId}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      const result = await spec.execute(parsed.data, {
        ...ctx,
        ...(snapshotId ? { snapshotId } : {})
      });
      return snapshotId && !result.snapshotId ? { ...result, snapshotId } : result;
    } catch (error) {
      return errorToolResult(error instanceof Error ? error.message : String(error), snapshotId ? { snapshotId } : {});
    }
  }
}

export function createToolRegistry(specs: AnyToolSpec[] = [], options: ToolRegistryOptions = {}) {
  return new ToolRegistry(specs, options);
}
