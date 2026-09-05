import type { AnyToolSpec, ToolExecutionContext } from "./types.js";
import { errorToolResult } from "./types.js";
import { toJSONSchema } from "zod";

export type ToolVisibilityCheck = (spec: AnyToolSpec, ctx: ToolExecutionContext) => boolean | Promise<boolean>;

export type ToolRegistryOptions = {
  canUse?: ToolVisibilityCheck;
};

/**
 * 供 system prompt 组装的工具文案参考：
 * - snippets：有 promptSnippet 的工具，一行能力广告，进「可用工具（Available tools）」清单。
 * - guidelines：所有工具的 promptGuidelines 跨工具 Set 去重合并后的行为准则，进「Guidelines」段。
 * 与 toModelTools 的完整 description 通道相互独立。
 */
export type ToolPromptReference = {
  snippets: { id: string; snippet: string }[];
  guidelines: string[];
};

function modelInputSchema(spec: AnyToolSpec): Record<string, unknown> {
  // JSON Schema 旁路优先：插件工具（dsh defineTool）自带 JSON Schema，Zod 那份只是占位。
  if (spec.jsonSchema) {
    const bypass = { ...spec.jsonSchema };
    delete bypass["$schema"];
    return bypass;
  }
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

  /**
   * 收集已注册工具的 promptSnippet/promptGuidelines，供 system prompt 组装「可用工具」清单与
   * 「Guidelines」段。guidelines 按注册顺序跨工具用 Set 去重（同一条准则被多个工具重复声明时只保留一次）。
   * 不涉及模型 API 的 description 通道（toModelTools 不变）。
   */
  promptReference(): ToolPromptReference {
    const snippets: { id: string; snippet: string }[] = [];
    const guidelines: string[] = [];
    const seen = new Set<string>();
    for (const spec of this.specs.values()) {
      const snippet = spec.promptSnippet?.trim();
      if (snippet) {
        snippets.push({ id: spec.id, snippet });
      }
      for (const guideline of spec.promptGuidelines ?? []) {
        const normalized = guideline.trim();
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          guidelines.push(normalized);
        }
      }
    }
    return { snippets, guidelines };
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
