/**
 * dsh-plugin-echo — QA fixture plugin for WorkHub's DeepSeek Harness plugin host.
 *
 * Shaped after the real published bundle `dsh-plugin-finance-data@0.2.0`: a
 * schemastery `Config`, an `inject` list, a named `apply(ctx, config)` export,
 * one `ctx.tools.register(defineTool({...}))` call, and one guarded
 * `ctx.systemPrompt.section()` effect. It exists so `pnpm qa:plugin-smoke`
 * exercises the real `@deepseek-ai/dsh-tools` `defineTool` pipeline offline,
 * without pulling an unvetted third-party package into the build.
 *
 * @module dsh-plugin-echo
 */
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Cordis plugin name (registered with the loader). */
const name = "echo";

/** Services this plugin must resolve before it applies. */
const inject = ["tools", "systemPrompt"];

/** Composition-row configuration for the plugin entry. */
const Config = z.object({
  /** Register the echo prompt-guidance section. */
  personaSection: z.boolean().default(true),
  /** Order of the section (ascending; persona is 0). */
  sectionOrder: z.number().default(6),
});

const SECTION_TEXT = [
  "Echo plugin guidance:",
  "- Use the `echo` tool to repeat a phrase back verbatim when you need to prove the plugin bridge is live.",
].join("\n");

function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: "echo",
    description:
      "Echo a phrase back, optionally repeated and upper-cased. Use it to prove that a DeepSeek Harness plugin tool is reachable from a WorkHub agent run.",
    parameters: {
      text: { type: "string", required: true, description: "Phrase to echo back." },
      times: { type: "integer", description: "How many times to repeat the phrase (default 1)." },
      upper: { type: "boolean", description: "Upper-case the echoed phrase." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          length: { type: "integer" },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    execute: async (args) => {
      const times = Number.isInteger(args.times) && args.times > 0 ? args.times : 1;
      const once = args.upper ? String(args.text).toUpperCase() : String(args.text);
      const text = Array.from({ length: times }, () => once).join(" ");
      return { text, length: text.length };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Echo: " + args.text,
      kind: "other",
      rawInput: args,
    }),
  }));

  if (config.personaSection) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: "echo:instructions",
      order: config.sectionOrder,
      text: SECTION_TEXT,
    }), "echo.section()");
  }
}

export { Config, SECTION_TEXT, apply, inject, name };
